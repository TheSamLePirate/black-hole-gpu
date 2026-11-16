// PLAN-J8 J8-L and J8-VB (VB1) — the streets' cells (Sam, 16 Nov 2026: « idem pour les lampadaires, charger toute la vue — et les voitures
// aussi »; the low flight's details, docs/PLAN-DETAILS-VOL-BAS-FABLEFLIGHT.md): a cell « rue » beside each building cell (building-cells.ts:
// the same z 15 key, origin and east-north frame), prepared in workers (street-prep.ts), kept in the prepared cache (kerr-street-v<format>),
// counted in the zones and in `flightReady`. Format 2 (KSC2) agreed with the render session (16 Nov 2026, ~18:40 UTC); format 1 (KSC1: lamps
// and the cars' pieces alone) is not read any more — the cache's name carries the format.
//
// The bytes (little-endian): a header of STREET_HEADER_BYTES, then `lampCount` lamps of LAMP_BYTES, then `segmentCount` road segments of
// SEGMENT_BYTES, then `junctionCount` junctions of JUNCTION_BYTES, then `placeCount` places of PLACE_BYTES (VB4: none yet).
//   header  0 u32 magic "KSC2"   4 u16 format (STREET_FORMAT)   6 u16 junctionCount   8 u8 z   9 u8 reserved   10 u16 placeCount
//          12 u32 x   16 u32 y   20 u32 lampCount   24 u32 segmentCount   28 u32 generation (the roads' source revision: YYYYMMDD)
//          32 f64 origin latitude [°]   40 f64 origin longitude [°]   48 u32 a section to come's count (0)   52..63 reserved (0)
//   lamp      0 f32 east [m]   4 f32 north [m] (the pole's foot, in the cell's frame)   8 u16 head height [cm over the ground]
//            10 u8 road class (LAMP_CODES)   11 u8 flags (StreetFlag.Left)
//   segment   0 f32 east a   4 f32 north a   8 f32 east b   12 f32 north b [m]   16 u16 carriageway width [cm]   18 u8 lanes
//            19 u8 class (ROAD_CODES)   20 u8 flags (SegmentFlag)   21 i8 level (the BD TOPO's position_par_rapport_au_sol: 0 the ground,
//            1 … 3 over it — bridges —, −1 … −4 under it — tunnels)   22 u16 speed [cm/s]   24 f32 abscissa of a along its road [m]
//            28 u32 the road's identity (a hash of the BD TOPO's cleabs, of OpenMapTiles' feature id)
//   junction  0 f32 east   4 f32 north [m]   8 u8 degree (the segments' ends met there, ≥ 3)   9 u8 widest carriageway [dm / 2]
//            10 u16 flags (JunctionFlag)
//   place     (VB4: its record to be defined there — PLACE_BYTES reserved; none written in format 2's first cells)
//
// The rules (agreed with the render session):
//  - the sources: in France (the IGN's box, bdtopo.ts inBdtopoBox) the BD TOPO's `troncon_de_route`, from the very tile the building
//    cell is prepared from (no download more); elsewhere OpenMapTiles' `transportation` (z 14), the width and lanes inferred by the class
//    (SegmentFlag.InferredWidth) — the BD TOPO's paths, tracks and stairs carry none either (VB0: 0 %), inferred the same way;
//  - the cut: each road's line simplified by Douglas-Peucker to SIMPLIFY_M (0.3 m — the near drawing's markings and edges: no error seen
//    from above), then cut into straight segments of SEGMENT_MAX_M at most; each segment kept in the cell of its middle (a road cut by
//    two tiles: each tile keeps the segments whose middle is its own — its neighbour's buffer copy the rest); its abscissa from the start
//    of the road's piece in the tile (continuous within a cell and a tile, not across tiles: a road's whole length is not in one tile);
//  - every class kept, the paths and the stairs too (the low flight's and the walker's); the far layer filters by class (no cars, no far
//    lamps on them);
//  - the junctions: the roads' ends that meet within JUNCTION_M (an index of their ends, once at the preparation), three or more;
//  - no ground: the far layer sets the lamps, segments and junctions on the relief as drawn; the level says only a bridge or a tunnel;
//  - the lamps as in format 1 (OpenMapTiles' town streets, streetlamps.ts lampsAlong, where the building cells say built-up).
import { CELL_Z } from "./building-cells";

export const STREET_FORMAT = 2;
export const STREET_MAGIC = 0x3243534b; // "KSC2"
export const STREET_HEADER_BYTES = 64;
export const LAMP_BYTES = 12;
export const SEGMENT_BYTES = 32;
export const JUNCTION_BYTES = 12;
export const PLACE_BYTES = 16;
/** the simplification's tolerance [m] (Douglas-Peucker) */
export const SIMPLIFY_M = 0.3;
/** a segment's longest [m] */
export const SEGMENT_MAX_M = 250;
/** the ends that make one junction [m] */
export const JUNCTION_M = 1;

/** the lamps' road classes on one byte (streetlamps.ts LAMP_CLASSES) */
export const LAMP_CODES = ["", "primary", "secondary", "tertiary", "minor"] as const;
/** the roads' classes on one byte (OpenMapTiles' names; the BD TOPO's mapped onto them — street-prep.ts) */
export const ROAD_CODES = [
  "",
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "track",
  "path",
  "steps",
] as const;
export type RoadClass = (typeof ROAD_CODES)[number];

export enum StreetFlag {
  /** a lamp on the left of its street's direction (the staggered side) */
  Left = 1,
}
export enum SegmentFlag {
  /** one way along a → b */
  OnewayAlong = 1,
  /** one way against it */
  OnewayAgainst = 2,
  Bridge = 4,
  Tunnel = 8,
  Urban = 16,
  /** its width and lanes inferred by its class — not given by the source */
  InferredWidth = 32,
  /** a ford (the BD TOPO's « Gué ou radier ») */
  Ford = 64,
  Roundabout = 128,
}
export enum JunctionFlag {
  Roundabout = 1,
  /** its segments on different levels (a bridge's end over a road) */
  Levels = 2,
}

export interface StreetLampRecord {
  east: number;
  north: number;
  /** the head's height over the ground [m] */
  height: number;
  cls: (typeof LAMP_CODES)[number];
  flags: number;
}
export interface RoadSegmentRecord {
  a: [number, number];
  b: [number, number];
  /** the carriageway's width [m] */
  width: number;
  lanes: number;
  cls: RoadClass;
  flags: number;
  level: number;
  /** its speed [m/s] */
  speed: number;
  /** a's abscissa along its road's piece [m] */
  s0: number;
  roadId: number;
}
export interface JunctionRecord {
  east: number;
  north: number;
  degree: number;
  /** the widest carriageway met there [m] */
  width: number;
  flags: number;
}
export interface StreetHeader {
  format: number;
  z: number;
  x: number;
  y: number;
  lampCount: number;
  segmentCount: number;
  junctionCount: number;
  placeCount: number;
  generation: number;
  originLat: number;
  originLon: number;
}

/** A street cell's bytes (no places yet: VB4). */
export function encodeStreetCell(
  h: Pick<StreetHeader, "z" | "x" | "y" | "generation" | "originLat" | "originLon">,
  lamps: readonly StreetLampRecord[],
  segments: readonly RoadSegmentRecord[],
  junctions: readonly JunctionRecord[],
): ArrayBuffer {
  const buf = new ArrayBuffer(
    STREET_HEADER_BYTES + lamps.length * LAMP_BYTES + segments.length * SEGMENT_BYTES + junctions.length * JUNCTION_BYTES,
  );
  const v = new DataView(buf);
  v.setUint32(0, STREET_MAGIC, true);
  v.setUint16(4, STREET_FORMAT, true);
  v.setUint16(6, Math.min(65535, junctions.length), true);
  v.setUint8(8, h.z ?? CELL_Z);
  v.setUint16(10, 0, true);
  v.setUint32(12, h.x, true);
  v.setUint32(16, h.y, true);
  v.setUint32(20, lamps.length, true);
  v.setUint32(24, segments.length, true);
  v.setUint32(28, h.generation >>> 0, true);
  v.setFloat64(32, h.originLat, true);
  v.setFloat64(40, h.originLon, true);
  let o = STREET_HEADER_BYTES;
  for (const l of lamps) {
    v.setFloat32(o, l.east, true);
    v.setFloat32(o + 4, l.north, true);
    v.setUint16(o + 8, Math.max(0, Math.min(65535, Math.round(l.height * 100))), true);
    v.setUint8(o + 10, Math.max(0, LAMP_CODES.indexOf(l.cls)));
    v.setUint8(o + 11, l.flags & 255);
    o += LAMP_BYTES;
  }
  for (const s of segments) {
    v.setFloat32(o, s.a[0], true);
    v.setFloat32(o + 4, s.a[1], true);
    v.setFloat32(o + 8, s.b[0], true);
    v.setFloat32(o + 12, s.b[1], true);
    v.setUint16(o + 16, Math.max(0, Math.min(65535, Math.round(s.width * 100))), true);
    v.setUint8(o + 18, Math.max(0, Math.min(255, Math.round(s.lanes))));
    v.setUint8(o + 19, Math.max(0, ROAD_CODES.indexOf(s.cls)));
    v.setUint8(o + 20, s.flags & 255);
    v.setInt8(o + 21, Math.max(-128, Math.min(127, Math.round(s.level))));
    v.setUint16(o + 22, Math.max(0, Math.min(65535, Math.round(s.speed * 100))), true);
    v.setFloat32(o + 24, s.s0, true);
    v.setUint32(o + 28, s.roadId >>> 0, true);
    o += SEGMENT_BYTES;
  }
  for (const j of junctions.slice(0, 65535)) {
    v.setFloat32(o, j.east, true);
    v.setFloat32(o + 4, j.north, true);
    v.setUint8(o + 8, Math.max(0, Math.min(255, j.degree)));
    v.setUint8(o + 9, Math.max(0, Math.min(255, Math.round(j.width * 5))));
    v.setUint16(o + 10, j.flags & 65535, true);
    o += JUNCTION_BYTES;
  }
  return buf;
}

/** A street cell's header, or null when the bytes are not one of this format (magic, format, size). */
export function readStreetHeader(buf: ArrayBuffer): StreetHeader | null {
  if (buf.byteLength < STREET_HEADER_BYTES) return null;
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== STREET_MAGIC || v.getUint16(4, true) !== STREET_FORMAT) return null;
  const h: StreetHeader = {
    format: STREET_FORMAT,
    z: v.getUint8(8),
    x: v.getUint32(12, true),
    y: v.getUint32(16, true),
    lampCount: v.getUint32(20, true),
    segmentCount: v.getUint32(24, true),
    junctionCount: v.getUint16(6, true),
    placeCount: v.getUint16(10, true),
    generation: v.getUint32(28, true),
    originLat: v.getFloat64(32, true),
    originLon: v.getFloat64(40, true),
  };
  const size =
    STREET_HEADER_BYTES +
    h.lampCount * LAMP_BYTES +
    h.segmentCount * SEGMENT_BYTES +
    h.junctionCount * JUNCTION_BYTES +
    h.placeCount * PLACE_BYTES;
  return buf.byteLength === size ? h : null;
}

/** a street cell's i-th lamp */
export function readLamp(buf: ArrayBuffer, i: number): StreetLampRecord {
  const v = new DataView(buf);
  const o = STREET_HEADER_BYTES + i * LAMP_BYTES;
  return {
    east: v.getFloat32(o, true),
    north: v.getFloat32(o + 4, true),
    height: v.getUint16(o + 8, true) / 100,
    cls: LAMP_CODES[v.getUint8(o + 10)] ?? "",
    flags: v.getUint8(o + 11),
  };
}

/** a street cell's i-th road segment */
export function readSegment(buf: ArrayBuffer, i: number): RoadSegmentRecord {
  const v = new DataView(buf);
  const h = readStreetHeader(buf)!;
  const o = STREET_HEADER_BYTES + h.lampCount * LAMP_BYTES + i * SEGMENT_BYTES;
  return {
    a: [v.getFloat32(o, true), v.getFloat32(o + 4, true)],
    b: [v.getFloat32(o + 8, true), v.getFloat32(o + 12, true)],
    width: v.getUint16(o + 16, true) / 100,
    lanes: v.getUint8(o + 18),
    cls: ROAD_CODES[v.getUint8(o + 19)] ?? "",
    flags: v.getUint8(o + 20),
    level: v.getInt8(o + 21),
    speed: v.getUint16(o + 22, true) / 100,
    s0: v.getFloat32(o + 24, true),
    roadId: v.getUint32(o + 28, true),
  };
}

/** a street cell's i-th junction */
export function readJunction(buf: ArrayBuffer, i: number): JunctionRecord {
  const v = new DataView(buf);
  const h = readStreetHeader(buf)!;
  const o = STREET_HEADER_BYTES + h.lampCount * LAMP_BYTES + h.segmentCount * SEGMENT_BYTES + i * JUNCTION_BYTES;
  return {
    east: v.getFloat32(o, true),
    north: v.getFloat32(o + 4, true),
    degree: v.getUint8(o + 8),
    width: v.getUint8(o + 9) / 5,
    flags: v.getUint16(o + 10, true),
  };
}

/** the prepared streets' cache (Cache Storage): the format in its name — a new format never reads an old one's cells */
export const STREET_CACHE = `kerr-street-v${STREET_FORMAT}`;
/** a street cell's key in it (a URL: Cache Storage's keys are requests; never fetched) */
export const streetCacheUrl = (origin: string, x: number, y: number) => `${origin}/__street/${STREET_FORMAT}/${CELL_Z}/${x}/${y}.ksc`;
/** OpenMapTiles' z 14 tile a street cell is prepared from (OpenFreeMap's — scenery-sources.ts osmUrl's, built here without that module) */
export const streetRoadsUrl = (x: number, y: number) => {
  const n = 2 ** (CELL_Z - 1);
  return `https://tiles.openfreemap.org/planet/latest/${CELL_Z - 1}/${(((x >> 1) % n) + n) % n}/${y >> 1}.pbf`;
};
