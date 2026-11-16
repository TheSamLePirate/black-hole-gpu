// PLAN-J8 J8-2 — the building cell's contract (docs/PLAN-J8-BATIMENTS.md §2): the unit the far buildings live in, from the
// preparation (J8-3, a pool of workers: the BD TOPO's z 15 tiles — elsewhere Overture's, OSM's, brought to the same grid — decoded
// into these records) through the prepared cache (Cache Storage, under CELL_FORMAT) to the GPU's pool (J8-4: the records uploaded as
// they are, 12 words each). Pure: no DOM, no WebGPU — the page, the workers and the tests share it. Common to the render session and
// the approaches' (PLAN-J8 §4): small commits, said in the journal.
//
// A cell is a Web Mercator tile at CELL_Z. Its frame: the local east-north-up tangent plane at its origin (the tile's centre, on the
// WGS84 ellipsoid, h = 0) — east and north in metres there (a few hundred metres: flat is exact to millimetres), every height over
// the ellipsoid (the Earth is WGS84 everywhere — CLAUDE.md: a building's ground is the bare ground under it, MSL data + N).
//
// The bytes (little-endian): a header of HEADER_BYTES, then `count` records of RECORD_BYTES.
//   header  0 u32 magic "KBC1"   4 u16 format (CELL_FORMAT)   6 u16 source (CellSource)   8 u8 z   9 u8 flags   10 u16 reserved
//          12 u32 x   16 u32 y   20 u32 count   24 u32 generation (the source's revision: a newer replaces an older)
//          28 u32 reserved   32 f64 origin latitude [°]   40 f64 origin longitude [°]   48..63 reserved (0)
//   record  0 f32 east [m]   4 f32 north [m] (the footprint's oriented box's centre, in the cell's frame)
//           8 f32 ground [m over the ellipsoid] (the bare ground under the centre)
//          12 f32 eave [m over the ground] (the walls' top — the BD TOPO's hauteur, to the gutter)
//          16 f32 roof [m over the eave] (the roof's own height: 0 flat)
//          20 u16 half length [dm]   22 u16 half width [dm] (the oriented box's half-sides, length ≥ width)
//          24 u16 heading (the long side's angle from east, anticlockwise, 0 … π over 0 … 65535)
//          26 u8 roof shape (RoofCode)   27 u8 flags (RecordFlag)
//          28 u8 roof material (roofs.ts RoofMaterial)   29 u8 wall material (WallMaterial)   30 u8 usage (UsageCode)   31 u8 storeys
//          32 u32 rank (its place in the cell: stable — the source's own order by its identity —, the stable id = cell + rank)
//          36 u32 source key (a hash of the source's own identity: the BD TOPO's cleabs, Overture's id — the same building across
//             two generations)
//          40 u32 roof colour (0x00RRGGBB; 0: none given)   44 u32 reserved (0)
//
// The rules both sides keep (agreed with the approaches' session, 16 Nov 2026, on Toulon's densest tile — 2 497 buildings):
//  - the ground: the source's (the BD TOPO's altitude_minimale_sol, over the sea, + the geoid's N — flag GroundKnown); the far layer
//    (J8-4) sets an envelope on the relief as drawn, its record's ground the fallback and the check (a coarse far relief would leave
//    one floating or sunk by metres);
//  - a building cut by two tiles: one record — its parts together (the tile splits a building at its buffer into parts its
//    neighbour numbers otherwise) —, in the first (north, then west) of the cells it touches, its box on the geometry the tile gives
//    past its square (the vector tile's buffer); the other copy left out by the same rule, each tile alone (its footprint's centre
//    did not agree between the two copies, each cut at its own tile's buffer: 16 doubles and 5 lost over 25 tiles of Toulon; this
//    rule none — tests/cell-prep.test.ts); flag Partial when the footprint reaches the buffer;
//  - the generation: the source's newest change in the cell (the BD TOPO's date_modification, as YYYYMMDD), else the response's
//    Last-Modified — a newer replaces an older;
//  - the identity: cell + rank stable within a generation (the ranks by the source's identity — cleabs); across generations the
//    source key (cleabs, or identifiants_rnb when present);
//  - the roof's shape without planning (the near scene alone plans roofs): its height (ridge less eave) over 1 m and the footprint
//    long → gabled, squarish → hipped, else flat; the materials by roofs.ts (roofMaterial, wallMaterial, regionOf).
import type { RoofMaterial, RoofShape, WallMaterial } from "./roofs";

/** the cells' level: the BD TOPO's tiles (≈ 0.9 km a side at 43° N) */
export const CELL_Z = 15;
/** PLAN-J8 J8-8: the near meshes' reach from the track [m] — the cells within it prepared whole (mesh-cells.ts, kerr-mesh-v1), counted in
 *  the zones and in `flightReady({ track })`; past it, the far layer (agreed by the render and approaches' sessions, 17 Nov 2026) */
export const MESH_NEAR_M = 1500;
/** the records' format: a cache keyed by it — a new one is never read as an old one */
export const CELL_FORMAT = 1;
export const CELL_MAGIC = 0x3143424b; // "KBC1"
export const HEADER_BYTES = 64;
export const RECORD_BYTES = 48;
/** a record's 32-bit words (the GPU's view: 12 a building) */
export const RECORD_WORDS = RECORD_BYTES / 4;

export enum CellSource {
  BdTopo = 1,
  Overture = 2,
  Osm = 3,
}
/** the roof's shape on one byte (roofs.ts RoofShape; 0 flat) */
export const ROOF_CODES: readonly RoofShape[] = ["flat", "gabled", "hipped", "mansard", "shed"];
export enum RecordFlag {
  /** a light construction (a shed, a greenhouse — the BD TOPO's « construction légère ») */
  Light = 1,
  /** an annex (no windows lit at night) */
  Annex = 2,
  /** its height measured by the IGN's canopy (I4/B6), not the registry's */
  Measured = 4,
  /** its ground the source's own (the BD TOPO's altitude_minimale_sol + N); absent (Overture, OSM): the drawn relief alone */
  GroundKnown = 8,
  /** its footprint past the vector tile's buffer: its box taken on a piece of it */
  Partial = 16,
}
/** the use on one byte (the BD TOPO's usage_1; 0 unknown) — what `buildingLook` reads: day materials, night windows */
export const USAGE_CODES = [
  "",
  "Résidentiel",
  "Commercial et services",
  "Industriel",
  "Agricole",
  "Religieux",
  "Sportif",
  "Annexe",
  "Indifférencié",
] as const;
export type UsageName = (typeof USAGE_CODES)[number];

/** A building as the cell holds it (its frame's metres, its heights over the ellipsoid and its ground). */
export interface CellRecord {
  east: number;
  north: number;
  ground: number;
  eave: number;
  roof: number;
  /** half-sides [m], length ≥ width (swapped and turned a quarter if not); 0.1 m steps, at most 6 553.5 m */
  halfLength: number;
  halfWidth: number;
  /** the long side's angle from east, anticlockwise [rad], folded into [0, π) */
  heading: number;
  roofShape: RoofShape;
  flags: number;
  roofMaterial: RoofMaterial;
  wallMaterial: WallMaterial;
  usage: UsageName;
  storeys: number;
  rank: number;
  sourceKey: number;
  roofColour: number;
}
export interface CellHeader {
  format: number;
  source: CellSource;
  z: number;
  x: number;
  y: number;
  count: number;
  generation: number;
  originLat: number;
  originLon: number;
}

const DEG = Math.PI / 180;
/** a cell's key — its z 15 tile — for maps and the cache ("15/16758/11957") */
export const cellKey = (x: number, y: number, z = CELL_Z) => `${z}/${x}/${y}`;
/** a building's stable identity: its cell and its rank there ("15/16758/11957#42") */
export const buildingId = (x: number, y: number, rank: number, z = CELL_Z) => `${cellKey(x, y, z)}#${rank}`;

/** the cell (Web Mercator tile at z) holding a place [°] */
export function cellOf(lat: number, lon: number, z = CELL_Z): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * DEG);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  return { x: ((x % n) + n) % n, y: Math.max(0, Math.min(n - 1, y)) };
}
/** a cell's bounds [°]: west, south, east, north */
export function cellBounds(x: number, y: number, z = CELL_Z): { west: number; south: number; east: number; north: number } {
  const n = 2 ** z;
  const lat = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) / DEG;
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y), south: lat(y + 1) };
}
/** a cell's origin: its tile's centre [°] (the centre of its Mercator square, a latitude between its bounds) */
export function cellOrigin(x: number, y: number, z = CELL_Z): { lat: number; lon: number } {
  const n = 2 ** z;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) / DEG, lon: ((x + 0.5) / n) * 360 - 180 };
}

/** The ellipsoid's radii of curvature at a latitude [°]: the meridian's (M) and the prime vertical's (N) [m]. */
function radii(lat: number): { M: number; N: number } {
  const a = 6378137,
    f = 1 / 298.257223563,
    e2 = f * (2 - f);
  const s = Math.sin(lat * DEG);
  const w = Math.sqrt(1 - e2 * s * s);
  return { M: (a * (1 - e2)) / (w * w * w), N: a / w };
}
/** a place [°] in a cell's frame: east and north [m] from its origin (the tangent plane — a cell's extent: flat to millimetres) */
export function toCell(origin: { lat: number; lon: number }, lat: number, lon: number): { east: number; north: number } {
  const { M, N } = radii(origin.lat);
  let dl = lon - origin.lon;
  dl = ((((dl + 180) % 360) + 360) % 360) - 180;
  return { east: dl * DEG * N * Math.cos(origin.lat * DEG), north: (lat - origin.lat) * DEG * M };
}
/** back: a point of a cell's frame [m] as a place [°] */
export function fromCell(origin: { lat: number; lon: number }, east: number, north: number): { lat: number; lon: number } {
  const { M, N } = radii(origin.lat);
  const lon = origin.lon + east / (N * Math.cos(origin.lat * DEG)) / DEG;
  return { lat: origin.lat + north / M / DEG, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
}

const clampU16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));

/** The cell's bytes: its header and its records (ranked as given — the caller orders them by their source's identity). */
export function encodeCell(h: Omit<CellHeader, "count" | "format">, records: readonly CellRecord[]): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + records.length * RECORD_BYTES);
  const v = new DataView(buf);
  v.setUint32(0, CELL_MAGIC, true);
  v.setUint16(4, CELL_FORMAT, true);
  v.setUint16(6, h.source, true);
  v.setUint8(8, h.z);
  v.setUint32(12, h.x, true);
  v.setUint32(16, h.y, true);
  v.setUint32(20, records.length, true);
  v.setUint32(24, h.generation >>> 0, true);
  v.setFloat64(32, h.originLat, true);
  v.setFloat64(40, h.originLon, true);
  for (const [i, r] of records.entries()) {
    const o = HEADER_BYTES + i * RECORD_BYTES;
    // (length ≥ width: a footprint given the other way round turned a quarter)
    let L = r.halfLength,
      W = r.halfWidth,
      a = r.heading;
    if (W > L) {
      [L, W] = [W, L];
      a += Math.PI / 2;
    }
    a = ((a % Math.PI) + Math.PI) % Math.PI;
    v.setFloat32(o, r.east, true);
    v.setFloat32(o + 4, r.north, true);
    v.setFloat32(o + 8, r.ground, true);
    v.setFloat32(o + 12, r.eave, true);
    v.setFloat32(o + 16, r.roof, true);
    v.setUint16(o + 20, clampU16(L * 10), true);
    v.setUint16(o + 22, clampU16(W * 10), true);
    v.setUint16(o + 24, clampU16((a / Math.PI) * 65535) % 65536, true);
    v.setUint8(o + 26, Math.max(0, ROOF_CODES.indexOf(r.roofShape)));
    v.setUint8(o + 27, r.flags & 255);
    v.setUint8(o + 28, r.roofMaterial & 255);
    v.setUint8(o + 29, r.wallMaterial & 255);
    v.setUint8(o + 30, Math.max(0, USAGE_CODES.indexOf(r.usage)));
    v.setUint8(o + 31, Math.max(0, Math.min(255, Math.round(r.storeys))));
    v.setUint32(o + 32, r.rank >>> 0, true);
    v.setUint32(o + 36, r.sourceKey >>> 0, true);
    v.setUint32(o + 40, r.roofColour >>> 0, true);
  }
  return buf;
}

/** A cell's header read; null: not a cell of this format (another format's cache, a truncated download — prepared again). */
export function readHeader(buf: ArrayBuffer): CellHeader | null {
  if (buf.byteLength < HEADER_BYTES) return null;
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== CELL_MAGIC || v.getUint16(4, true) !== CELL_FORMAT) return null;
  const count = v.getUint32(20, true);
  if (buf.byteLength !== HEADER_BYTES + count * RECORD_BYTES) return null;
  return {
    format: CELL_FORMAT,
    source: v.getUint16(6, true) as CellSource,
    z: v.getUint8(8),
    x: v.getUint32(12, true),
    y: v.getUint32(16, true),
    count,
    generation: v.getUint32(24, true),
    originLat: v.getFloat64(32, true),
    originLon: v.getFloat64(40, true),
  };
}

/** A record read back (the tests', the tools'; the GPU reads the words — recordWords). */
export function readRecord(buf: ArrayBuffer, i: number): CellRecord {
  const v = new DataView(buf);
  const o = HEADER_BYTES + i * RECORD_BYTES;
  return {
    east: v.getFloat32(o, true),
    north: v.getFloat32(o + 4, true),
    ground: v.getFloat32(o + 8, true),
    eave: v.getFloat32(o + 12, true),
    roof: v.getFloat32(o + 16, true),
    halfLength: v.getUint16(o + 20, true) / 10,
    halfWidth: v.getUint16(o + 22, true) / 10,
    heading: (v.getUint16(o + 24, true) / 65535) * Math.PI,
    roofShape: ROOF_CODES[v.getUint8(o + 26)] ?? "flat",
    flags: v.getUint8(o + 27),
    roofMaterial: v.getUint8(o + 28) as RoofMaterial,
    wallMaterial: v.getUint8(o + 29) as WallMaterial,
    usage: USAGE_CODES[v.getUint8(o + 30)] ?? "",
    storeys: v.getUint8(o + 31),
    rank: v.getUint32(o + 32, true),
    sourceKey: v.getUint32(o + 36, true),
    roofColour: v.getUint32(o + 40, true),
  };
}

/** The records as the GPU's words (12 a building, no copy): what the pool uploads. */
export function recordWords(buf: ArrayBuffer): Uint32Array {
  const h = readHeader(buf);
  if (!h) throw new Error("not a building cell of this format");
  return new Uint32Array(buf, HEADER_BYTES, h.count * RECORD_WORDS);
}

/** A source's identity hashed into a record's source key (FNV-1a, 32 bits): the same building across generations. */
export function sourceKey(id: string): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    x ^= id.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}
