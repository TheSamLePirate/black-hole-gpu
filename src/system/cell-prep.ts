// PLAN-J8 J8-3 — a building cell prepared from a BD TOPO z 15 tile (docs/PLAN-J8-BATIMENTS.md §2): the tile's buildings decoded
// into the contract's records (building-cells.ts: 48 bytes each) — no roof planned, no mesh: those stay the near scene's. Pure: the
// pool's workers run it (cell-worker.ts), the tests and the tools too. The same rules as the scenery worker's own decoding
// (scenery-worker.ts, its BD TOPO tiles): a building standing (`bdtopoStands`), its eave `bdtopoHeight`, its roof's height the ridge
// less the eave (≤ 30 m), its storeys, materials (roofs.ts, the region's), use and light construction as the registry says.
//
// What a far envelope needs and the near scene does not: one record per building — a building cut by two tiles comes in both (the
// vector tile's buffer round its square): kept in the first (north, then west) of the tiles it touches — both copies agree —, the box
// taken on the geometry as the tile gives it, past its square (flagged Partial when it reaches the buffer's edge: the rest beyond it
// unknown) —; its oriented box
// (roofs.ts orientedBox, in the cell's east-north metres); its ground over the ellipsoid (the registry's `altitude_minimale_sol`, over
// the sea, plus the geoid's N — CLAUDE.md: WGS84 everywhere); a roof shape guessed without planning (a roof over 1 m: two slopes
// on a long footprint, four on a squarish one; else flat).
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { BDTOPO_Z, bdtopoHeight, bdtopoStands } from "./bdtopo";
import {
  CellSource,
  type CellRecord,
  cellOrigin,
  encodeCell,
  RecordFlag,
  sourceKey,
  toCell,
  type UsageName,
  USAGE_CODES,
} from "./building-cells";
import { orientedBox, regionOf, roofMaterial, type RoofShape, wallMaterial } from "./roofs";

const D = Math.PI / 180;

export interface PreparedCell {
  /** the cell's bytes (building-cells.ts encodeCell) */
  buf: ArrayBuffer;
  records: CellRecord[];
  /** the tile's own count of standing buildings' polygons, those kept here (the first of the tiles they touch), those partial */
  stats: { features: number; polygons: number; kept: number; partial: number; ms: number };
  generation: number;
}

/** the registry's date (« 2024-03-05 … ») as YYYYMMDD — a growing u32 */
function dayOf(v: unknown): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}

/** the use's code name (unknown: "") */
const usageOf = (v: unknown): UsageName => ((USAGE_CODES as readonly string[]).includes(String(v)) ? (String(v) as UsageName) : "");

/** a building the tile keeps (the first — north, then west — of the tiles it touches), its parts' rings in the tile's units */
export interface OwnedBuilding {
  id: string;
  properties: Record<string, unknown>;
  /** its parts (classifyRings): each its outer ring then its courtyards', in the tile's units (past its square: the buffer's) */
  polys: { x: number; y: number }[][][];
  extent: number;
  /** its footprint reaches the buffer's edge: the rest beyond it unknown */
  cut: boolean;
}
/**
 * A BD TOPO tile's standing buildings decoded: those it keeps, ranked by their identity (`cleabs`) — the rank J8-2's records and J8-8's
 * meshes share —, and every standing footprint it holds, kept or not (its buffer's neighbours: the party walls across its edges).
 */
export function bdtopoOwned(bytes: ArrayBuffer | Uint8Array) {
  const layer = bytes.byteLength ? new VectorTile(new PbfReader(bytes)).layers.batiment : undefined;
  // (the buffer's reach past the square, in tile units: the farthest any vertex goes — a footprint touching it is cut there)
  let reach = 0;
  const feats: { f: ReturnType<NonNullable<typeof layer>["feature"]>; polys: { x: number; y: number }[][][] }[] = [];
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || !bdtopoStands(f.properties)) continue;
    const polys = classifyRings(f.loadGeometry());
    const e = f.extent;
    for (const p of polys) for (const v of p[0] ?? []) reach = Math.max(reach, -v.x, -v.y, v.x - e, v.y - e);
    feats.push({ f, polys });
  }
  const owned: OwnedBuilding[] = [];
  const others: { polys: { x: number; y: number }[][][]; extent: number }[] = [];
  let generation = 0,
    polygons = 0;
  for (const { f, polys } of feats) {
    const e = f.extent;
    generation = Math.max(generation, dayOf(f.properties.date_modification), dayOf(f.properties.date_creation));
    // (one record a building: its parts' outer rings together — the tile splits a building at its buffer into parts its neighbour
    // numbers otherwise: an identity of building and part did not survive from one copy to the other)
    const outer = polys.map((rings) => rings[0] ?? []).filter((r) => r.length >= 4);
    if (!outer.length) continue;
    polygons += outer.length;
    const all = outer.flat();
    // (which cell keeps it: the first — north, then west — of the tiles it touches: the two copies of a building across a seam
    // agree, each seeing the tiles on both sides — its centre did not, each copy cut at its own tile's buffer)
    let ox = Infinity,
      oy = Infinity;
    for (const v of all) {
      const tx = Math.floor(v.x / e),
        ty = Math.floor(v.y / e);
      if (ty < oy || (ty === oy && tx < ox)) (ox = tx), (oy = ty);
    }
    if (ox !== 0 || oy !== 0) {
      others.push({ polys, extent: e });
      continue;
    }
    const cut = reach > 0 && all.some((v) => -v.x >= reach - 1 || -v.y >= reach - 1 || v.x - e >= reach - 1 || v.y - e >= reach - 1);
    owned.push({ id: String(f.properties.cleabs ?? ""), properties: f.properties as Record<string, unknown>, polys, extent: e, cut });
  }
  // (ranked by their identity: the same order whatever the tile's own)
  owned.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { owned, others, features: feats.length, polygons, generation };
}

/**
 * A BD TOPO tile's cell: its buildings' records — one a building, its parts together —, ranked by their identity (`cleabs`).
 * `geoid` (lat, lon) → N [m] (geoid-grid.ts geoidDeg once its grid is in; 0 leaves the ground over the sea).
 */
export function prepareBdtopoCell(
  bytes: ArrayBuffer | Uint8Array,
  x: number,
  y: number,
  geoid: (lat: number, lon: number) => number,
): PreparedCell {
  const t0 = performance.now();
  const n = 2 ** BDTOPO_Z;
  const origin = cellOrigin(x, y, BDTOPO_Z);
  const region = regionOf(origin.lat, origin.lon);
  const geoOf = (px: number, py: number, e: number) => ({
    lon: ((x + px / e) / n) * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / e)) / n))) / D,
  });
  const { owned, features, polygons, generation } = bdtopoOwned(bytes);
  const out: (CellRecord & { id: string })[] = [];
  let partial = 0;
  for (const { properties: pr, polys, extent: e, cut } of owned) {
    const eave = bdtopoHeight(pr);
    const ridge = pr.altitude_maximale_toit,
      low = pr.altitude_minimale_toit;
    const roof = typeof ridge === "number" && typeof low === "number" && ridge >= low ? Math.min(30, ridge - low) : 0;
    const storeys = typeof pr.nombre_d_etages === "number" && pr.nombre_d_etages > 0 ? pr.nombre_d_etages : 0;
    const usage = usageOf(pr.usage_1);
    const id0 = String(pr.cleabs ?? "");
    const all = polys
      .map((rings) => rings[0] ?? [])
      .filter((r) => r.length >= 4)
      .flat();
    const cx = all.reduce((s, v) => s + v.x, 0) / all.length,
      cy = all.reduce((s, v) => s + v.y, 0) / all.length;
    const pts = all.map((v) => {
      const g = geoOf(v.x, v.y, e);
      const m = toCell(origin, g.lat, g.lon);
      return [m.east, m.north] as [number, number];
    });
    const b = orientedBox(pts);
    const c = geoOf(cx, cy, e);
    const solMsl = pr.altitude_minimale_sol;
    const groundKnown = typeof solMsl === "number" && Number.isFinite(solMsl);
    const shape: RoofShape = roof > 1 ? (b.hu > 1.4 * b.hv ? "gabled" : "hipped") : "flat";
    let flags = 0;
    if (pr.construction_legere === true) flags |= RecordFlag.Light;
    if (usage === "Annexe") flags |= RecordFlag.Annex;
    if (groundKnown) flags |= RecordFlag.GroundKnown;
    if (cut) {
      flags |= RecordFlag.Partial;
      partial++;
    }
    out.push({
      id: id0,
      east: b.cx,
      north: b.cy,
      ground: groundKnown ? (solMsl as number) + geoid(c.lat, c.lon) : 0,
      eave,
      roof,
      halfLength: b.hu,
      halfWidth: b.hv,
      heading: Math.atan2(b.uy, b.ux),
      roofShape: shape,
      flags,
      roofMaterial: roofMaterial(pr.materiaux_de_la_toiture, region),
      wallMaterial: wallMaterial(pr.materiaux_des_murs),
      usage,
      storeys,
      rank: 0,
      sourceKey: sourceKey(id0),
      roofColour: 0,
    });
  }
  // (ranked by their identity — bdtopoOwned's order)
  const records: CellRecord[] = out.map(({ id: _id, ...r }, i) => ({ ...r, rank: i }));
  const buf = encodeCell(
    { source: CellSource.BdTopo, z: BDTOPO_Z, x, y, generation, originLat: origin.lat, originLon: origin.lon },
    records,
  );
  return {
    buf,
    records,
    generation,
    stats: { features, polygons, kept: records.length, partial, ms: performance.now() - t0 },
  };
}
