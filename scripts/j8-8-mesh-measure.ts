// PLAN-J8 J8-8 lot (1), before the format is written — what preparing the near buildings' meshes cell by cell (z 15) would cost:
// each BD TOPO cell kept on the disk (the e2e's Earth data, tests/e2e/lib/earth-cache.ts) around a centre, its buildings planned
// (roofs.ts planBuilding, 24 parts — the scenery worker's near detail), their party walls found with the eight neighbours' footprints
// within a metre of the cell (partyEdges), their meshes made (roof-mesh.ts buildingMesh) and their records' size counted as packScenery
// writes them (the scenery worker's leafBytes, a chimney's leaf apart). Per cell: buildings, parts, triangles, vertices, the records' and
// the mesh's bytes (f32 × 3 a vertex, u32 × 3 + a u32 tag a triangle), the time (decoding, neighbours, roofs, meshes) on this machine.
// No network. The attributes are read as the scenery worker reads them (scenery-worker.ts ~L 815); its LiDAR roofs (B6) are not — a
// ridgeless roof stays guessed —, nor the ground (the base 0): neither changes the triangles' count, the LiDAR one the roofs' shapes a
// little. A measure for the format's discussion, not the preparation itself.
//   bun scripts/j8-8-mesh-measure.ts [lat lon radiusKm] …   (default: Paris centre 48.857 2.34 1, Toulon 43.124 5.93 1)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { bdtopoHeight, bdtopoStands, clipRing } from "../src/system/bdtopo";
import { buildingMesh } from "../src/system/roof-mesh";
import { partyEdges, planBuilding, type Pt, type RoofInput, regionOf, roofMaterial, stacksOf, wallMaterial } from "../src/system/roofs";
import { PARAPET_M } from "../src/system/scenery-data";
import { earthDataDir } from "../tests/e2e/lib/earth-cache";

const D = Math.PI / 180;
const Z = 15,
  T = 2 ** Z;
const args = process.argv.slice(2).map(Number);
const places: { name: string; lat: number; lon: number; r: number }[] = [];
for (let i = 0; i + 2 < args.length; i += 3)
  places.push({ name: `${args[i]},${args[i + 1]}`, lat: args[i]!, lon: args[i + 1]!, r: args[i + 2]! });
if (!places.length) places.push({ name: "Paris centre", lat: 48.857, lon: 2.34, r: 1 }, { name: "Toulon", lat: 43.124, lon: 5.93, r: 1 });

// (the BD TOPO tiles on the disk: each body's URL in the .json beside it)
const tiles = new Map<string, string>();
const geopf = join(earthDataDir(), "data.geopf.fr");
if (existsSync(geopf))
  for (const f of readdirSync(geopf)) {
    if (!f.endsWith(".json")) continue;
    const meta = JSON.parse(readFileSync(join(geopf, f), "utf8")) as { url?: string; status?: number };
    const m = meta.url?.match(/\/BDTOPO\/15\/(\d+)\/(\d+)\.pbf/);
    if (m && meta.status === 200) tiles.set(`${m[1]}/${m[2]}`, join(geopf, f.replace(/\.json$/, ".bin")));
  }
console.log(`${tiles.size} BD TOPO z 15 tiles on the disk (${geopf})`);

const tileX = (lon: number) => Math.floor(((lon + 180) / 360) * T);
const tileY = (lat: number) => Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * T);
const lonOf = (x: number) => (x / T) * 360 - 180;
const latOf = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / T))) / D;

type B = { rings: Pt[][]; h: number; pr: Record<string, unknown> };
/** a cell's buildings, clipped to it, in metres about (lat0, lon0) — a flat frame over a few km: the counts, not the heights */
function cellBuildings(x: number, y: number, lat0: number, lon0: number): B[] | null {
  const file = tiles.get(`${x}/${y}`);
  if (!file) return null;
  const raw = gunzipSync(readFileSync(file));
  const layer = new VectorTile(new PbfReader(new Uint8Array(raw))).layers.batiment;
  const out: B[] = [];
  const k = Math.cos(lat0 * D) * 111320;
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || !bdtopoStands(f.properties)) continue;
    const e = f.extent;
    for (const rings of classifyRings(f.loadGeometry())) {
      const clipped = rings.map((r) => clipRing(r, e)).filter((r) => r.length >= 4);
      if (!clipped.length || clipped[0]!.length < 4) continue;
      if (clipped.reduce((s, r) => s + r.length, 0) > 8192) continue;
      const loc = clipped.map((r) =>
        r.slice(0, -1).map((v) => [(lonOf(x + v.x / e) - lon0) * k, (latOf(y + v.y / e) - lat0) * 111320] as Pt),
      );
      out.push({ rings: loc, h: bdtopoHeight(f.properties), pr: f.properties as Record<string, unknown> });
    }
  }
  return out;
}
const leafBytes = (parts: { rings: Pt[][]; planes: unknown[] }[]) =>
  parts.reduce((t, p) => t + 112 + p.rings.reduce((e, r) => e + r.length, 0) * 16 + 16 + p.planes.length * 16, 0);

const report: Record<string, unknown> = { at: new Date().toISOString(), machine: process.platform, cells: {} };
for (const P of places) {
  const x0 = tileX(P.lon),
    y0 = tileY(P.lat);
  const n = Math.ceil((P.r * 1000) / ((40_075_016 * Math.cos(P.lat * D)) / T));
  const rows: Record<string, number | string>[] = [];
  for (let y = y0 - n; y <= y0 + n; y++)
    for (let x = x0 - n; x <= x0 + n; x++) {
      if (!tiles.has(`${x}/${y}`)) continue;
      const lat0 = latOf(y + 0.5),
        lon0 = lonOf(x + 0.5);
      const t0 = performance.now();
      const own = cellBuildings(x, y, lat0, lon0)!;
      const t1 = performance.now();
      // (the neighbours' footprints within 1 m of the cell's box — partyEdges' gap is 0.8 m)
      const hw = ((lonOf(x + 1) - lonOf(x)) * Math.cos(lat0 * D) * 111320) / 2 + 1,
        hh = ((latOf(y) - latOf(y + 1)) * 111320) / 2 + 1;
      const near: Pt[][][] = [];
      let missing = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nb = cellBuildings(x + dx, y + dy, lat0, lon0);
          if (!nb) {
            missing++;
            continue;
          }
          for (const b of nb) if (b.rings[0]!.some(([px, py]) => Math.abs(px) <= hw && Math.abs(py) <= hh)) near.push([b.rings[0]!]);
        }
      const t2 = performance.now();
      const party = partyEdges([...own.map((b) => b.rings), ...near]);
      const t3 = performance.now();
      const region = regionOf(lat0, lon0);
      let parts = 0,
        records = 0,
        stacks = 0,
        verts = 0,
        tris = 0;
      const plansAll = [];
      for (const [i, b] of own.entries()) {
        const pr = b.pr;
        const ridge = pr.altitude_maximale_toit,
          eave = pr.altitude_minimale_toit;
        const input: RoofInput = {
          rings: b.rings,
          party: party[i]![0],
          height: b.h,
          roof: typeof ridge === "number" && typeof eave === "number" && ridge >= eave ? Math.min(30, ridge - eave) : null,
          storeys: typeof pr.nombre_d_etages === "number" && pr.nombre_d_etages > 0 ? pr.nombre_d_etages : null,
          roofMat: roofMaterial(pr.materiaux_de_la_toiture, region),
          wallMat: wallMaterial(pr.materiaux_des_murs),
          usage: typeof pr.usage_1 === "string" ? pr.usage_1 : undefined,
          nature: typeof pr.nature === "string" ? pr.nature : undefined,
          light: pr.construction_legere === true,
          region,
          seed: (i * 0.618) % 1,
        };
        try {
          plansAll.push({ b, plans: planBuilding(input, 24) });
        } catch {}
      }
      const t4 = performance.now();
      for (const { b, plans } of plansAll) {
        const lip = plans.length === 1 && plans[0]!.shape === "flat" && b.h > 4 ? PARAPET_M : 0;
        parts += plans.length;
        records += leafBytes(plans);
        for (const [k, p] of plans.entries()) {
          const m = buildingMesh(p.rings, -1, 0, p.planes, lip);
          verts += m.positions.length / 3;
          tris += m.triangles.length / 3;
          const st = stacksOf(p, (k * 0.31) % 1, p.shape === "mansard");
          stacks += st.length;
          records += st.length * (112 + 4 * 16 + 16 + 16);
        }
      }
      const t5 = performance.now();
      const meshBytes = verts * 12 + tris * 16;
      rows.push({
        cell: `${x}/${y}`,
        buildings: own.length,
        parts,
        stacks,
        vertices: verts,
        triangles: tris,
        recordKB: +(records / 1024).toFixed(1),
        meshKB: +(meshBytes / 1024).toFixed(1),
        neighboursMissing: missing,
        msDecode: +(t1 - t0).toFixed(1),
        msNeighbours: +(t2 - t1).toFixed(1),
        msParty: +(t3 - t2).toFixed(1),
        msRoofs: +(t4 - t3).toFixed(1),
        msMeshes: +(t5 - t4).toFixed(1),
        msTotal: +(t5 - t0).toFixed(1),
      });
    }
  const sum = (k: string) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const ms = rows.map((r) => r.msTotal as number).sort((a, b) => a - b);
  const B = sum("buildings");
  const summary = {
    cells: rows.length,
    buildings: B,
    bytesPerBuilding: B ? Math.round(((sum("recordKB") + sum("meshKB")) * 1024) / B) : 0,
    recordBytesPerBuilding: B ? Math.round((sum("recordKB") * 1024) / B) : 0,
    meshBytesPerBuilding: B ? Math.round((sum("meshKB") * 1024) / B) : 0,
    totalMB: +((sum("recordKB") + sum("meshKB")) / 1024).toFixed(1),
    msPerCellP50: ms[Math.floor(ms.length / 2)] ?? 0,
    msPerCellMax: ms[ms.length - 1] ?? 0,
    msAll: Math.round(sum("msTotal")),
    msNeighbours: Math.round(sum("msNeighbours")),
    msParty: Math.round(sum("msParty")),
    msRoofs: Math.round(sum("msRoofs")),
    msMeshes: Math.round(sum("msMeshes")),
  };
  console.log(`${P.name} (${P.lat}, ${P.lon}, ${P.r} km): ${JSON.stringify(summary)}`);
  (report.cells as Record<string, unknown>)[P.name] = { place: P, summary, rows };
}
writeFileSync("docs/progress/j8/j8-8-mesh-measure.json", `${JSON.stringify(report, null, 1)}\n`);
console.log("→ docs/progress/j8/j8-8-mesh-measure.json");
