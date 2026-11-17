// PLAN-J8 J8-8 lot (1) — a mesh cell prepared from a BD TOPO z 15 tile (mesh-cells.ts, kerr-mesh-v1): the tile's buildings as J8-2
// keeps and ranks them (cell-prep.ts bdtopoOwned — rank i here is rank i in the building cell), each planned as the near scene plans
// it (roofs.ts planBuilding, 24 parts; its party walls found among every footprint the tile holds — its buffer's neighbours too: a
// wall against a building of the next cell is blind as well), its leaves and meshes made by the near scene's own code
// (building-mesh-prep.ts). Every height over the building's foot (z 0), the walls from SKIRT_M below it; the foot's height over the
// ellipsoid the J8-2 record's ground (the BD TOPO's altitude_minimale_sol + N), NaN when the source has none. Pure: the cells'
// workers run it (cell-worker.ts), the tests and the tools too.
//
// A BD TOPO feature of several polygons (the registry's multi-part building) is one building here as in J8-2: its polygons planned
// each, their leaves and triangles together under its rank. A roof without a ridge in the source measured by the IGN's canopy (B6 —
// building-mesh-prep.ts lidarRoof, the scene's own: RecordFlag.Measured) when the cells' worker has it — the cell's Canopy flag and
// key: made again once its canopy comes —, else guessed (MeshFlag.RoofGuessed).
import { BDTOPO_Z, bdtopoHeight } from "./bdtopo";
import { CellSource, cellOrigin, fromCell, RecordFlag, toCell } from "./building-cells";
import { buildingLeaves, lidarRoof, partMeshes } from "./building-mesh-prep";
import { bdtopoOwned } from "./cell-prep";
import { overtureOwned, releaseDay } from "./cell-prep-overture";
import { encodeMeshCell, type MeshBuilding, MeshCellFlag, MeshFlag, SKIRT_M } from "./mesh-cells";
import { OVERTURE_Z } from "./pmtiles";
import {
  overtureRoofMaterial,
  overtureShape,
  overtureWallMaterial,
  partyEdges,
  planBuilding,
  type Pt,
  type RoofInput,
  regionOf,
  roofMaterial,
  wallMaterial,
} from "./roofs";
import { seed } from "./scenery-data";

const D = Math.PI / 180;

export interface PreparedMeshCell {
  buf: ArrayBuffer;
  generation: number;
  stats: {
    buildings: number;
    parts: number;
    leaves: number;
    triangles: number;
    vertices: number;
    unplanned: number;
    guessed: number;
    measured: number;
    ms: number;
  };
}

/** an open ring (the vector tile's are closed: its last point its first) */
const open = <T extends { x: number; y: number }>(r: T[]) =>
  r.length > 1 && r[0]!.x === r[r.length - 1]!.x && r[0]!.y === r[r.length - 1]!.y ? r.slice(0, -1) : r;

/**
 * A BD TOPO tile's mesh cell. `geoid` (lat, lon) → N [m] (geoid-grid.ts geoidDeg once its grid is in; 0 leaves the foot over the sea).
 */
export function prepareMeshCell(
  bytes: ArrayBuffer | Uint8Array,
  x: number,
  y: number,
  geoid: (lat: number, lon: number) => number,
  /** the IGN's canopy over the cell (ign-canopy.ts IgnLand.canopy: (lat, lon) → m, NaN where none): the roofs without a ridge
   *  measured, the cell flagged Canopy; none: guessed */
  canopy?: (lat: number, lon: number) => number,
): PreparedMeshCell {
  const t0 = performance.now();
  const n = 2 ** BDTOPO_Z;
  const origin = cellOrigin(x, y, BDTOPO_Z);
  const region = regionOf(origin.lat, origin.lon);
  const geoOf = (px: number, py: number, e: number) => ({
    lon: ((x + px / e) / n) * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / e)) / n))) / D,
  });
  const metres = (ring: { x: number; y: number }[], e: number): Pt[] =>
    open(ring).map((v) => {
      const g = geoOf(v.x, v.y, e);
      const m = toCell(origin, g.lat, g.lon);
      return [m.east, m.north];
    });
  const { owned, others, generation } = bdtopoOwned(bytes);
  // (every footprint the tile holds in the cell's metres — the kept buildings' polygons first, in their order, then the buffer's
  // neighbours —: the party walls among them all)
  const kept = owned.map((b) =>
    b.polys.map((rings) => rings.filter((r) => r.length >= 4).map((r) => metres(r, b.extent))).filter((rings) => rings.length > 0),
  );
  const around = others.flatMap((o) =>
    o.polys.map((rings) => rings.filter((r) => r.length >= 4).map((r) => metres(r, o.extent))).filter((rings) => rings.length > 0),
  );
  const party = partyEdges([...kept.flat(), ...around]);
  const stats = { buildings: owned.length, parts: 0, leaves: 0, triangles: 0, vertices: 0, unplanned: 0, guessed: 0, measured: 0, ms: 0 };
  /** the canopy at a point of the cell's metres */
  const canopyAt = canopy
    ? (e: number, nn: number) => {
        const g = fromCell(origin, e, nn);
        return canopy(g.lat, g.lon);
      }
    : null;
  const buildings: MeshBuilding[] = [];
  let p = 0;
  for (const [i, b] of owned.entries()) {
    const pr = b.properties;
    const ridge = pr.altitude_maximale_toit,
      eave = pr.altitude_minimale_toit;
    const roof = typeof ridge === "number" && typeof eave === "number" && ridge >= eave ? Math.min(30, ridge - eave) : null;
    const a = {
      wallMat: wallMaterial(pr.materiaux_des_murs),
      usage: typeof pr.usage_1 === "string" ? pr.usage_1 : undefined,
      nature: typeof pr.nature === "string" ? pr.nature : undefined,
      light: pr.construction_legere === true,
    };
    // (its flags as J8-2 sets them, its foot the J8-2 record's ground: the outer rings' mean point, as cell-prep.ts takes it)
    const all = b.polys
      .map((rings) => rings[0] ?? [])
      .filter((r) => r.length >= 4)
      .flat();
    const cx = all.reduce((s, v) => s + v.x, 0) / all.length,
      cy = all.reduce((s, v) => s + v.y, 0) / all.length;
    const c = geoOf(cx, cy, b.extent);
    const solMsl = pr.altitude_minimale_sol;
    const groundKnown = typeof solMsl === "number" && Number.isFinite(solMsl);
    let flags = 0;
    if (a.light) flags |= RecordFlag.Light;
    if (a.usage === "Annexe") flags |= RecordFlag.Annex;
    if (groundKnown) flags |= RecordFlag.GroundKnown;
    if (b.cut) flags |= RecordFlag.Partial;
    const out: MeshBuilding = { leaves: [], parts: [], flags, foot: groundKnown ? (solMsl as number) + geoid(c.lat, c.lon) : Number.NaN };
    const polys = kept[i]!;
    for (const rings of polys) {
      const flagsOf = party[p++]!;
      // (its seed as the scene's: its outer ring's mean point, to 1e-5°)
      const outer = rings[0]!;
      const mx = outer.reduce((s, q) => s + q[0], 0) / outer.length,
        my = outer.reduce((s, q) => s + q[1], 0) / outer.length;
      const g = fromCell(origin, mx, my);
      const s = seed(Math.round(g.lat * 1e5), Math.round(g.lon * 1e5));
      // (its ridge measured by the canopy where the source has none — the scene's B6)
      const eaveH = bdtopoHeight(pr);
      let roofH = roof;
      if (roofH === null && canopyAt) {
        roofH = lidarRoof(rings, eaveH, canopyAt);
        if (roofH !== null) out.flags |= RecordFlag.Measured;
      }
      if (roofH === null) out.flags |= MeshFlag.RoofGuessed;
      const input: RoofInput = {
        rings,
        party: flagsOf[0],
        height: eaveH,
        top: false,
        roof: roofH,
        storeys: typeof pr.nombre_d_etages === "number" && pr.nombre_d_etages > 0 ? pr.nombre_d_etages : null,
        roofMat: roofMaterial(pr.materiaux_de_la_toiture, region),
        wallMat: a.wallMat,
        usage: a.usage,
        nature: a.nature,
        light: a.light,
        region,
        seed: s,
      };
      let plans: ReturnType<typeof planBuilding>;
      try {
        plans = planBuilding(input, 24);
      } catch {
        continue;
      }
      if (!plans.length) continue;
      const meshes = partMeshes(a, plans, -SKIRT_M, 0).map((m) => (m.triangles.length ? m : undefined));
      const leaves = buildingLeaves({ plans, a, region, seed: s, floor: 0, bottom: -SKIRT_M, mesh: meshes, stacks: () => true });
      const base = out.leaves.length;
      for (const l of leaves.prims) out.leaves.push(l.data);
      for (const [k, m] of meshes.entries())
        if (m) out.parts.push({ leaf: base + leaves.partLeaf[k]!, positions: m.positions, triangles: m.triangles });
      stats.parts += plans.length;
    }
    if (!out.leaves.length) {
      out.flags |= MeshFlag.Unplanned;
      stats.unplanned++;
    }
    if (out.flags & MeshFlag.RoofGuessed) stats.guessed++;
    if (out.flags & RecordFlag.Measured) stats.measured++;
    stats.leaves += out.leaves.length;
    for (const m of out.parts) {
      stats.triangles += m.triangles.length / 3;
      stats.vertices += m.positions.length / 3;
    }
    buildings.push(out);
  }
  const buf = encodeMeshCell(
    {
      source: CellSource.BdTopo,
      z: BDTOPO_Z,
      x,
      y,
      flags: canopy ? MeshCellFlag.Canopy : 0,
      generation,
      originLat: origin.lat,
      originLon: origin.lon,
    },
    buildings,
  );
  stats.ms = performance.now() - t0;
  return { buf, generation, stats };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * An Overture z 14 tile's four mesh cells (PLAN-J8 J8-7's cells: cell-prep-overture.ts overtureOwned — the same buildings, the same
 * ranks). Each building planned as the near scene reads Overture (scenery-worker.ts overtureTiles): its parts (`building_part` — a
 * tower, a nave, a spire) in its outline's stead where the tile has them, each piece's heights — `height`, else storeys × 3.2 + 1, else
 * 6 m; `min_height` its low; a measured `roof_height` the roof's own, else the walls to the top and the roof planned in them
 * (RoofGuessed) —, its shape's hint, its colours. No ground in the data: the foot NaN (the draw sets it on its relief); the walls from
 * SKIRT_M below the foot, a piece standing higher (`min_height`) from 1 m below its low as the scene's.
 */
export function prepareOvertureMeshCells(bytes: ArrayBuffer | Uint8Array, x14: number, y14: number, release: string): PreparedMeshCell[] {
  const t0 = performance.now();
  const n14 = 2 ** OVERTURE_Z;
  const generation = releaseDay(release);
  const decoded = overtureOwned(bytes, x14, y14);
  return decoded.cells.map((cell) => {
    const origin = cell.origin;
    const region = regionOf(origin.lat, origin.lon);
    const metres = (ring: { x: number; y: number }[], e: number): Pt[] =>
      open(ring).map((v) => {
        const m = toCell(
          origin,
          Math.atan(Math.sinh(Math.PI * (1 - (2 * (y14 + v.y / e)) / n14))) / D,
          ((x14 + v.x / e) / n14) * 360 - 180,
        );
        return [m.east, m.north];
      });
    const ringsOf = (polys: { x: number; y: number }[][][], e: number) =>
      polys.map((rings) => rings.filter((r) => r.length >= 4).map((r) => metres(r, e))).filter((rings) => rings.length > 0);
    // (each kept building's pieces — its parts where the tile has them, else its outline's polygons —, then every other outline the
    // tile holds: the party walls among them all)
    const kept = cell.owned.map((b) => {
      const parts = b.properties.has_parts === true ? decoded.parts.get(b.id) : undefined;
      return parts?.length
        ? parts.flatMap((q) => ringsOf(q.polys, q.extent).map((rings) => ({ rings, pr: q.properties })))
        : ringsOf(b.polys, b.extent).map((rings) => ({ rings, pr: b.properties }));
    });
    const mine = new Set(cell.owned.map((b) => b.id));
    const around = decoded.outlines.filter((o) => !mine.has(o.id)).flatMap((o) => ringsOf(o.polys, o.extent));
    const party = partyEdges([...kept.flat().map((k) => k.rings), ...around]);
    const stats = {
      buildings: cell.owned.length,
      parts: 0,
      leaves: 0,
      triangles: 0,
      vertices: 0,
      unplanned: 0,
      guessed: 0,
      measured: 0,
      ms: 0,
    };
    const buildings: MeshBuilding[] = [];
    let p = 0;
    for (const [i, b] of cell.owned.entries()) {
      const out: MeshBuilding = { leaves: [], parts: [], flags: b.cut ? RecordFlag.Partial : 0, foot: Number.NaN };
      for (const { rings, pr } of kept[i]!) {
        const flagsOf = party[p++]!;
        const floors = num(pr.num_floors);
        const top = Math.min(500, Math.max(2, num(pr.height) ?? (floors !== null ? floors * 3.2 + 1 : 6)));
        const low = Math.min(top - 1, Math.max(0, num(pr.min_height) ?? (num(pr.min_floor) ?? 0) * 3.2));
        // (a measured roof: the walls under it, the roof its own — as the BD TOPO's —; else OSM's way, all to the top)
        const rh = num(pr.roof_height);
        const measured = rh !== null && rh > 0 && rh < top - low - 1;
        if (!measured) out.flags |= MeshFlag.RoofGuessed;
        const shape = overtureShape(pr.roof_shape);
        const a = {
          wallMat: overtureWallMaterial(pr.facade_material),
          colour: pr.facade_color,
          roofColour: pr.roof_color,
        };
        const outer = rings[0]!;
        const g = fromCell(origin, outer.reduce((t, q) => t + q[0], 0) / outer.length, outer.reduce((t, q) => t + q[1], 0) / outer.length);
        const s = seed(Math.round(g.lat * 1e5), Math.round(g.lon * 1e5));
        const input: RoofInput = {
          rings,
          party: flagsOf[0],
          height: (measured ? top - rh! : top) - low,
          top: !measured,
          roof: measured ? rh! : null,
          storeys: floors,
          roofMat: overtureRoofMaterial(pr.roof_material),
          wallMat: a.wallMat,
          region,
          seed: s,
          hint: shape ? { shape, across: pr.roof_orientation === "across", direction: num(pr.roof_direction) ?? undefined } : undefined,
        };
        let plans: ReturnType<typeof planBuilding>;
        try {
          plans = planBuilding(input, 24);
        } catch {
          continue;
        }
        if (!plans.length) continue;
        const bottom = low > 0 ? low - 1 : -SKIRT_M;
        const meshes = partMeshes(a, plans, bottom, low).map((m) => (m.triangles.length ? m : undefined));
        const leaves = buildingLeaves({ plans, a, region, seed: s, floor: low, bottom, mesh: meshes, stacks: () => true });
        const base = out.leaves.length;
        for (const l of leaves.prims) out.leaves.push(l.data);
        for (const [k, m] of meshes.entries())
          if (m) out.parts.push({ leaf: base + leaves.partLeaf[k]!, positions: m.positions, triangles: m.triangles });
        stats.parts += plans.length;
      }
      if (!out.leaves.length) {
        out.flags |= MeshFlag.Unplanned;
        stats.unplanned++;
      }
      if (out.flags & MeshFlag.RoofGuessed) stats.guessed++;
      stats.leaves += out.leaves.length;
      for (const m of out.parts) {
        stats.triangles += m.triangles.length / 3;
        stats.vertices += m.positions.length / 3;
      }
      buildings.push(out);
    }
    const buf = encodeMeshCell(
      {
        source: CellSource.Overture,
        z: OVERTURE_Z + 1,
        x: cell.x,
        y: cell.y,
        flags: 0,
        generation,
        originLat: origin.lat,
        originLon: origin.lon,
      },
      buildings,
    );
    stats.ms = performance.now() - t0;
    return { buf, generation, stats };
  });
}
