// PLAN-J8 J8-7 — the building cells outside the BD TOPO's France, from Overture Maps (docs/PLAN-J8-BATIMENTS.md §8): its buildings'
// z 14 tile (pmtiles.ts OVERTURE_Z: OSM's buildings with Microsoft's and Google's footprints, their heights, storeys, roofs' shapes,
// materials and colours where mapped) decoded into the contract's records (building-cells.ts) — the same four z 15 cells a z 14 tile
// covers, the same rules as the BD TOPO's cells (cell-prep.ts) and as the scenery worker's own reading of these tiles (scenery-worker.ts
// overtureTiles: its heights — `height`, else storeys × 3.2 + 1, else 6 m —, a measured `roof_height` the roof's own, its shape and
// materials by roofs.ts overtureShape, overtureRoofMaterial, overtureWallMaterial). Pure: the cell workers run it, the tests too.
//
// What differs from the BD TOPO's:
//  - the outlines alone (layer `building`): a building's parts (`building_part`: a tower, a nave) are the near scene's detail;
//  - a building cut by two tiles: one record, kept in the first (north, then west) of the z 14 tiles it touches (cell-prep.ts's rule),
//    then in the first of that tile's z 15 cells it touches — its cell always within the tile that keeps it;
//  - no ground in the data: GroundKnown unset, the far layer (J8-4) sets it on the relief as drawn;
//  - the generation: the release's date (« 2025-10-22.0 » → 20251022); the source key: Overture's `id` (stable across releases);
//  - no use in the registry's sense (Overture's `class` is not the BD TOPO's usage): left empty.
import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { CellSource, type CellRecord, cellOrigin, encodeCell, RecordFlag, sourceKey, toCell } from "./building-cells";
import type { PreparedCell } from "./cell-prep";
import { OVERTURE_Z } from "./pmtiles";
import { orientedBox, overtureRoofMaterial, overtureShape, overtureWallMaterial, type RoofShape } from "./roofs";

const D = Math.PI / 180;
/** the tile edge's snap [tile units of 4 096]: a vertex this close to an edge counts on its south or east side */
const SNAP = 2;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** a release's name (« 2025-10-22.0 ») as YYYYMMDD — a growing u32 (0: none) */
export function releaseDay(release: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(release);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}

/** a colour as the data give it (« #b4a995 », « #abc ») as 0x00RRGGBB; 0 when none or not a hex colour */
export function colourCode(v: unknown): number {
  if (typeof v !== "string") return 0;
  let h = v.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(h) ? Number.parseInt(h, 16) : 0;
}

/**
 * An Overture z 14 tile's four z 15 cells (north-west, north-east, south-west, south-east: `x14 * 2 + i`, `y14 * 2 + j`): each its
 * buildings' records, ranked by their Overture id. An empty tile (`bytes` empty: none there) gives four empty cells.
 */
export function prepareOvertureCells(bytes: ArrayBuffer | Uint8Array, x14: number, y14: number, release: string): PreparedCell[] {
  const t0 = performance.now();
  const n14 = 2 ** OVERTURE_Z;
  const generation = releaseDay(release);
  const layer = bytes.byteLength ? new VectorTile(new PbfReader(bytes)).layers.building : undefined;
  const geoOf = (px: number, py: number, e: number) => ({
    lon: ((x14 + px / e) / n14) * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y14 + py / e)) / n14))) / D,
  });
  const cells = [0, 1, 2, 3].map((k) => {
    const x = x14 * 2 + (k % 2),
      y = y14 * 2 + Math.floor(k / 2);
    return { x, y, origin: cellOrigin(x, y, OVERTURE_Z + 1), out: [] as (CellRecord & { id: string })[], partial: 0, polygons: 0 };
  });
  let features = 0;
  // (the buffer's reach past the square, in tile units: a footprint touching it is cut there — Partial)
  let reach = 0;
  const feats: { f: ReturnType<NonNullable<typeof layer>["feature"]>; polys: { x: number; y: number }[][][] }[] = [];
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.is_underground === true) continue;
    const polys = classifyRings(f.loadGeometry());
    const e = f.extent;
    for (const p of polys) for (const v of p[0] ?? []) reach = Math.max(reach, -v.x, -v.y, v.x - e, v.y - e);
    feats.push({ f, polys });
  }
  features = feats.length;
  for (const { f, polys } of feats) {
    const pr = f.properties;
    const e = f.extent;
    const outer = polys.map((rings) => rings[0] ?? []).filter((r) => r.length >= 4);
    if (!outer.length) continue;
    const all = outer.flat();
    // (the z 14 tile that keeps it: the first — north, then west — of those it touches; then its first z 15 cell within this tile. A
    // vertex within SNAP units of a tile's edge counts on its south or east side: two copies of a building at a four-tile corner,
    // quantised each in its own tile, disagreed by a unit — Brussels, 16 Nov 2026: one building at 4095 of 4096 in one copy, 0 in the
    // other, kept twice in 24 249)
    let ox = Infinity,
      oy = Infinity;
    for (const v of all) {
      const tx = Math.floor((v.x + SNAP) / e),
        ty = Math.floor((v.y + SNAP) / e);
      if (ty < oy || (ty === oy && tx < ox)) (ox = tx), (oy = ty);
    }
    if (ox !== 0 || oy !== 0) continue;
    let cx15 = Infinity,
      cy15 = Infinity;
    for (const v of all) {
      if (v.x < 0 || v.x >= e || v.y < 0 || v.y >= e) continue;
      const tx = Math.floor((2 * v.x) / e),
        ty = Math.floor((2 * v.y) / e);
      if (ty < cy15 || (ty === cy15 && tx < cx15)) (cx15 = tx), (cy15 = ty);
    }
    if (!Number.isFinite(cx15)) continue;
    const cell = cells[cy15 * 2 + cx15]!;
    cell.polygons += outer.length;
    const cut = reach > 0 && all.some((v) => -v.x >= reach - 1 || -v.y >= reach - 1 || v.x - e >= reach - 1 || v.y - e >= reach - 1);
    const pts = all.map((v) => {
      const g = geoOf(v.x, v.y, e);
      const m = toCell(cell.origin, g.lat, g.lon);
      return [m.east, m.north] as [number, number];
    });
    const b = orientedBox(pts);
    // (the scenery worker's heights: to the top; a measured roof its own, the walls under it)
    const floors = num(pr.num_floors);
    const top = Math.min(500, Math.max(2, num(pr.height) ?? (floors !== null ? floors * 3.2 + 1 : 6)));
    const low = Math.min(top - 1, Math.max(0, num(pr.min_height) ?? (num(pr.min_floor) ?? 0) * 3.2));
    const rh = num(pr.roof_height);
    const measured = rh !== null && rh > 0 && rh < top - low - 1;
    const roof = measured ? Math.min(30, rh!) : 0;
    const given = overtureShape(pr.roof_shape);
    const shape: RoofShape = given ?? (roof > 1 ? (b.hu > 1.4 * b.hv ? "gabled" : "hipped") : "flat");
    let flags = 0;
    if (cut) {
      flags |= RecordFlag.Partial;
      cell.partial++;
    }
    const id = String(pr.id ?? "");
    cell.out.push({
      id,
      east: b.cx,
      north: b.cy,
      ground: 0,
      eave: top - roof,
      roof,
      halfLength: b.hu,
      halfWidth: b.hv,
      heading: Math.atan2(b.uy, b.ux),
      roofShape: shape,
      flags,
      roofMaterial: overtureRoofMaterial(pr.roof_material),
      wallMaterial: overtureWallMaterial(pr.facade_material),
      usage: "",
      storeys: floors !== null && floors > 0 ? Math.min(255, Math.round(floors)) : 0,
      rank: 0,
      sourceKey: sourceKey(id),
      roofColour: colourCode(pr.roof_color),
    });
  }
  const ms = performance.now() - t0;
  return cells.map((c) => {
    c.out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const records: CellRecord[] = c.out.map(({ id: _id, ...r }, i) => ({ ...r, rank: i }));
    const buf = encodeCell(
      { source: CellSource.Overture, z: OVERTURE_Z + 1, x: c.x, y: c.y, generation, originLat: c.origin.lat, originLon: c.origin.lon },
      records,
    );
    return { buf, records, generation, stats: { features, polygons: c.polygons, kept: records.length, partial: c.partial, ms } };
  });
}
