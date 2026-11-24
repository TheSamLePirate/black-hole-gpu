// PLAN-J8 J8-L and J8-VB (VB1) — the streets' cells (Sam, 16 Nov 2026: « idem pour les lampadaires, charger toute la vue — et les voitures
// aussi »; the low flight's details, docs/PLAN-DETAILS-VOL-BAS-FABLEFLIGHT.md): a cell « rue » beside each building cell (building-cells.ts:
// the same z 15 key, origin and east-north frame), prepared in workers (street-prep.ts), kept in the prepared cache (kerr-street-v<format>),
// counted in the zones and in `flightReady`. Format 2 (KSC2) agreed with the render session (16 Nov 2026, ~18:40 UTC); format 3 (KSC3,
// 17 Nov 2026, proposed to the render session for J8-VB's VB2, VB5a, VB6 and VB7): the lamp's arm, the segments' continuations and
// surfaces, the junctions' furniture. Formats 1 and 2 are not read any more — the cache's name carries the format (the older ones' caches swept: cell-workers.ts).
//
// The bytes (little-endian): a header of STREET_HEADER_BYTES, then `lampCount` lamps of LAMP_BYTES, then `segmentCount` road segments of
// SEGMENT_BYTES, then `junctionCount` junctions of JUNCTION_BYTES, then `placeCount` places of PLACE_BYTES, then `segmentCount`
// continuations of NEXT_BYTES, then `segmentCount` surfaces of SURFACE_BYTES, then `furnitureCount` pieces of furniture of
// FURNITURE_BYTES.
//   header  0 u32 magic "KSC5"   4 u16 format (STREET_FORMAT)   6 u16 junctionCount   8 u8 z   9 u8 flags (CellStreetFlag)   10 u16 placeCount
//          12 u32 x   16 u32 y   20 u32 lampCount   24 u32 segmentCount   28 u32 generation (the roads' source revision: YYYYMMDD)
//          32 f64 origin latitude [°]   40 f64 origin longitude [°]   48 u32 furnitureCount   52 u32 bridgeCount   56..63 reserved (0)
//   lamp      0 f32 east [m]   4 f32 north [m] (the pole's foot, in the cell's frame)   8 u16 head height [cm over the ground]
//            10 u8 road class (LAMP_CODES)   11 u8 flags (StreetFlag.Left)   12 u16 the arm's heading (from the foot to the head, over the
//            street: 0 … 2π anticlockwise from east over 0 … 65535)   14 u8 the arm's reach [dm]   15 u8 variant (0 … LAMP_VARIANTS − 1, by
//            a seed of its foot)
//   segment   0 f32 east a   4 f32 north a   8 f32 east b   12 f32 north b [m]   16 u16 carriageway width [cm]   18 u8 lanes
//            19 u8 class (ROAD_CODES)   20 u8 flags (SegmentFlag)   21 i8 level (the BD TOPO's position_par_rapport_au_sol: 0 the ground,
//            1 … 3 over it — bridges —, −1 … −4 under it — tunnels)   22 u16 speed [cm/s]   24 f32 abscissa of a along its road [m]
//            28 u32 the road's identity (a hash of the BD TOPO's cleabs, of OpenMapTiles' feature id)
//   junction  0 f32 east   4 f32 north [m]   8 u8 degree (the segments' ends met there, ≥ 3)   9 u8 widest carriageway [dm / 2]
//            10 u16 flags (JunctionFlag)
//   place     0 f32 east   4 f32 north [m] (a parked car's centre)   8 u16 heading (the street's direction there, 0 … 2π over
//            0 … 65535)   10 u8 kind (PlaceKind: 0 along the kerb; 1 angled — reserved: only where the data say it)   11 u8 flags
//            (PlaceFlag)   12 u24 seed (its car's model and colour — VB3)   15 u8 the carriageway's width there [dm / 2]
//   next      (one a segment, in the segments' order — VB6's traffic) 0 u16 the next at b (driving a → b, b reached)   2 u16 the next at a
//            (driving b → a): a segment's index in this cell, its bit 15 set when that one is driven b → a (entered at its b); NEXT_NONE none
//            (a dead end, a one way against, a level not met), NEXT_ELSEWHERE its road going on into a neighbouring cell
//   surface   (one a segment — VB2's carriageway) 0 u8 flags (SurfaceFlag: edge lines, the centre line dashed or solid, a kerb)
//            1 u8 the lane lines besides the centre's   2 u8 each pavement's width [dm] (0: none)   3 u8 its bridge's index in this
//            cell (NO_BRIDGE: on none — J8-RP RP6: what rides on it takes the deck's height)
//   furniture (VB7) 0 f32 east   4 f32 north [m] (its centre)   8 u16 heading (0 … 2π over 0 … 65535: the arm's way out of the junction —
//            a line's and a crossing's stripes across it; a signal facing the traffic coming in; a guardrail along its road)   10 u16 length
//            [cm] (a line's and a crossing's across the road, a guardrail's along it; a signal's 0)   12 u8 kind (FurnitureKind)   13 u8 flags (FurnitureFlag)   14 u16 its junction's index (NO_JUNCTION none)
//   bridge    (J8-RP RP4, RP7 — one a bridge, its length varying; after the furniture) 0 u32 its identity (its first segment's road's)
//            4 u16 its axis's points   6 u8 kind (BridgeKind)   7 u8 flags (BridgeFlag)   8 f32 the deck's width [m] (the carriageway and
//            its pavements or parapets)   12 i8 its layer (the source's level)   13 u8 what it crosses (Crossed: bits)   14 u8 the least
//            clearance over it [dm]   15 u8 reserved (0)   16 f32 its length [m]   20 its axis's points, each f32 east, f32 north [m]
//            (the first and the last its abutments)
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
//  - the places (VB4, agreed with the render session ~18:55 UTC): along the urban streets of the tertiary, minor and service classes, not
//    on a bridge nor in a tunnel, their carriageway 5 m wide at least; a place every PLACE_SPACING_M on each side (one side only on a one
//    way under 6 m), its centre `width / 2 − 1.1 m` off the axis; none within PLACE_JUNCTION_M of a junction, nor within PLACE_BUILDING_M
//    of a building's box (the building cell's); each kept by its seed with PLACE_KEEP's chance (no wall of the same cars); at most
//    PLACE_MAX a cell, thinned evenly by their seeds past it (CellStreetFlag.Thinned — a cap by the centre would leave a ring at the
//    cells' edges). The vegetation and the crossings are in neither source: not excluded yet, never simulated. Angled parking (kind 1)
//    only where the data say it (OSM parking:lane, the BD TOPO's car parks): later.
//  - an urban one way of 3–5 m (agreed ~19:25 UTC: the BD TOPO gives the driven width, without its parking lane — Paris's streets): one
//    side, the right, the car off the carriageway at `width / 2 + 1.1 m` (PlaceFlag.AssumedLane); none within PLACE_OTHER_ROAD_M of
//    another segment (a service road alongside), the buildings' exclusion the same (a lane against the façades: none).
//  - the lamp's arm (VB5a): its heading and reach as lampsAlong sets the head over the street (the foot off the kerb, the head ARM_M
//    nearer the axis); its variant a seed of the foot's place.
//  - the continuations (VB6): each segment's end matched to the other ends within JUNCTION_M — on its own road first (a road's pieces),
//    else through a junction the straightest way the one ways allow, on the same level; none a dead end; NEXT_ELSEWHERE when its road's
//    next piece lies in another cell (the cells are prepared per tile: a neighbour's index is not known — its road's identity and
//    abscissa find it there).
//  - the surfaces (VB2), from the class, width, lanes, way and place of each segment — inferred, the sources give no markings: edge
//    lines on the motorways, trunks, and outside the towns on the primary to tertiary roads SURFACE_EDGE_MIN_M wide or more; a centre line
//    on a two-way road of two lanes or more SURFACE_CENTRE_MIN_M wide or more (the classes motorway to tertiary; a town's minor street
//    from SURFACE_MINOR_CENTRE_M), solid on the trunks, dashed elsewhere, none on a roundabout; the lane lines between the lanes of
//    each way (lanes − 1 on a one way, lanes − 2 on a two-way); a kerb and pavements in the towns on the primary to minor classes
//    (PAVEMENT_M by class), a kerb alone on a town's service road; nothing on a track, a path, steps, nor a ford.
//  - the furniture (VB7): at the urban junctions of three arms or more, none of them a bridge or a tunnel: for each arm long enough
//    (FURNITURE_ARM_MIN_M past its line): a stop line (FurnitureKind.StopLine — a yield line, FurnitureFlag.Yield, entering a roundabout)
//    `widest / 2 + STOP_BACK_M` from the centre across the lanes coming in (the right half of a two-way; the whole of a one way coming in;
//    none on a one way going out); a crossing CROSSING_BEYOND_M further, across the whole carriageway (none on the motorway, trunk,
//    service, track, path and steps classes); a signal at the kerb of each line coming in (FurnitureKind.Signal) where four arms or more
//    meet with two of the secondary class or above, or the widest is SIGNAL_WIDE_M or more — none at a roundabout. Every piece inferred
//    (FurnitureFlag.Inferred): neither the BD TOPO nor OpenMapTiles give the real crossings or signals. The side is the traffic's
//    (CellStreetFlag.LeftHand: drivesLeft's countries). Guardrails (FurnitureKind.Guardrail): along both sides of a motorway's or a
//    trunk's segment outside the towns, and of a bridge's of the tertiary class or above, GUARDRAIL_OFF_M past the carriageway's edge.
//  - the bridges (J8-RP RP4, 17 Nov 2026, proposed to the render session): a tile's bridge segments (its four cells') chained by their
//    ends on one level into decks, whichever their roads — a viaduct cut into several BD TOPO sections one deck —; its axis's ends its
//    abutments, BridgeFlag.OpenA/OpenB where the tile's edge cuts it (the rest in the next tile's cells, the same point); its width the
//    widest carriageway and its pavements (in the towns) or parapets; what it crosses from OpenMapTiles' water, rails and roads under its
//    axis (its approaches left out); its least clearance CLEARANCE_M (RAIL_CLEARANCE_M over a railway); BridgeFlag.Confirmed where the
//    BD TOPO's construction_lineaire or construction_surfacique « Pont » lies near; written in every cell holding one of its segments,
//    whole — the drawing and the far layer keep one by its identity. No height (the BD TOPO's sections have none): the drawing sets the
//    deck between its abutments' ground as drawn (FableFlight's bridge_end), raised to its clearance; its piers bridgePiers', kept where
//    the deck stands PIER_MIN_M over the ground. Each segment on a bridge names it (its surface's byte 3: RP6).
//  - the tunnels' mouths (J8-RP RP8): FurnitureKind.TunnelPortal where a tunnel's segment meets one out of it on the ground.
//  - the railways (J8-RP RP9, format 5): their tracks as segments of the class « rail » — the BD TOPO's troncon_de_voie_ferree in France
//    (its nature, its tracks as `lanes`, its level: bridges and tunnels — the metro under the ground —, electrified: the surface's
//    SurfaceFlag.Electrified), OpenMapTiles' rail and transit elsewhere (not known electrified); their width the tracks' (RAIL_TRACK_M
//    apart) and their ballast; no junction, no place, no lamp, no furniture of the roads' (no stop line on a track), no continuation
//    between a track and a road; a railway's bridge BridgeKind.Rail; its tunnels' mouths as a road's.
import { CELL_Z } from "./building-cells";

export const STREET_FORMAT = 5;
export const STREET_MAGIC = 0x3543534b; // "KSC5"
export const STREET_HEADER_BYTES = 64;
export const LAMP_BYTES = 16;
export const NEXT_BYTES = 4;
export const SURFACE_BYTES = 4;
export const FURNITURE_BYTES = 16;
/** a bridge record's fixed part and a point of its axis */
export const BRIDGE_HEAD_BYTES = 20;
export const BRIDGE_POINT_BYTES = 8;
/** a segment on no bridge (its surface's byte 3) */
export const NO_BRIDGE = 0xff;
/** the piers' spacing (FableFlight's roads.rs: 34 m; a viaduct's — longer than VIADUCT_M — 130 m) and where a pier stands: the deck
 *  PIER_MIN_M or more over the ground at its foot (the drawing's test, on its relief) [m] */
export const PIER_SPACING_M = 34;
export const VIADUCT_PIER_SPACING_M = 130;
export const VIADUCT_M = 400;
export const PIER_MIN_M = 3.5;
/** a bridge's least clearance over what it crosses [m] (FableFlight's 5.5 m; a railway's catenary 6 m) */
export const CLEARANCE_M = 5.5;
export const RAIL_CLEARANCE_M = 6;
/** a railway's tracks apart and its ballast's width beyond its outer rails [m] (J8-RP RP9) */
export const RAIL_TRACK_M = 4.5;
export const RAIL_BALLAST_M = 3;
/** a continuation's none, its road going on in a neighbouring cell, its bit for « driven b → a » */
export const NEXT_NONE = 0xffff;
export const NEXT_ELSEWHERE = 0xfffe;
export const NEXT_REVERSED = 0x8000;
/** a piece of furniture with no junction */
export const NO_JUNCTION = 0xffff;
/** the lamps' arm: its reach [m] (streetlamps.ts lampsAlong's head), its variants */
export const ARM_M = 1.2;
export const LAMP_VARIANTS = 3;
/** the furniture's rules (VB7) [m] */
export const STOP_BACK_M = 1;
export const CROSSING_BEYOND_M = 3;
export const FURNITURE_ARM_MIN_M = 2;
export const SIGNAL_WIDE_M = 10;
export const GUARDRAIL_OFF_M = 0.5;
/** the surfaces' rules (VB2) [m] */
export const SURFACE_EDGE_MIN_M = 5.5;
export const SURFACE_CENTRE_MIN_M = 5;
export const SURFACE_MINOR_CENTRE_M = 7;
/** a town's pavement by class [m] (none: no kerb) */
export const PAVEMENT_M: Partial<Record<RoadClass, number>> = { primary: 3, secondary: 3, tertiary: 2.5, minor: 2, service: 0 };
export const SEGMENT_BYTES = 32;
export const JUNCTION_BYTES = 12;
export const PLACE_BYTES = 16;
/** the places' rules (VB4) */
export const PLACE_SPACING_M = 6;
export const PLACE_JUNCTION_M = 12;
export const PLACE_BUILDING_M = 1;
export const PLACE_KEEP = 0.6;
export const PLACE_MAX = 4000;
/** an assumed lane's place: none this near another segment [m] */
export const PLACE_OTHER_ROAD_M = 3;
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
  // (J8-RP RP9, format 5: a railway's track — the BD TOPO's troncon_de_voie_ferree, OpenMapTiles' rail and transit)
  "rail",
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
export enum CellStreetFlag {
  /** its places thinned evenly to PLACE_MAX */
  Thinned = 1,
  /** its traffic drives on the left (drivesLeft) */
  LeftHand = 2,
  /** (review A3, 24 Nov 2026) prepared with its building cell (its lamps' town, its places' exclusions): a cell without it and without
   *  a generation — the scene worker's own since e633d82b, its buildings left out — is incomplete: streetCellComplete */
  Built = 4,
  /** (review A4) its guardrails' FurnitureFlag.OnBridge written: their absence says a rail on the ground */
  FurnitureBridges = 8,
}

/**
 * (review A3) Whether a cached street cell is whole: prepared with its building cell (CellStreetFlag.Built), or — a cell of an older
 * preparation, before the flag — dated by its source (a generation) or holding lamps (its town was known). The scene worker's cells of
 * e633d82b (buildings left out, generation 0, no lamp) fail it: the pool prepares them again, the scene reads them as missing.
 */
export function streetCellComplete(buf: ArrayBuffer): boolean {
  const h = readStreetHeader(buf);
  if (!h) return false;
  return (h.flags & CellStreetFlag.Built) !== 0 || h.generation !== 0 || h.lampCount > 0;
}
export enum FurnitureKind {
  StopLine = 1,
  Crossing = 2,
  Signal = 3,
  Guardrail = 4,
  /** J8-RP RP8: a tunnel's mouth — where a segment goes from the ground into a tunnel; heading into it, length the carriageway's */
  TunnelPortal = 5,
}
export enum BridgeKind {
  Road = 1,
  Rail = 2,
  /** a footbridge (a path's, steps') */
  Foot = 3,
}
export enum BridgeFlag {
  /** the BD TOPO's own bridge (a construction_lineaire or construction_surfacique « Pont ») within BRIDGE_CONFIRM_M of its axis */
  Confirmed = 1,
  /** longer than VIADUCT_M: its piers every VIADUCT_PIER_SPACING_M */
  Viaduct = 2,
  /** its first (A) or last (B) point is not an abutment: the bridge goes on in another tile's cells (the same point there) */
  OpenA = 4,
  OpenB = 8,
}
export enum Crossed {
  Water = 1,
  Road = 2,
  Rail = 4,
}
/** a bridge (J8-RP RP4) — no height: the drawing sets its deck between its abutments' ground as drawn (FableFlight's bridge_end), raised
 *  to its clearance over what it crosses */
export interface BridgeRecord {
  id: number;
  kind: BridgeKind;
  flags: number;
  width: number;
  layer: number;
  crossed: number;
  /** [m] */
  clearance: number;
  length: number;
  points: [number, number][];
}
export enum SurfaceFlag {
  EdgeLines = 1,
  CentreDashed = 2,
  CentreSolid = 4,
  Kerb = 8,
  /** J8-RP RP9: a railway's track under a catenary (the BD TOPO's electrifie; abroad unknown: none) */
  Electrified = 16,
}
/** a segment's carriageway (VB2) */
export interface SegmentSurface {
  flags: number;
  /** the lane lines besides the centre's */
  laneLines: number;
  /** each pavement's width [m] (0 none) */
  pavement: number;
  /** its bridge's index in the cell (NO_BRIDGE or absent: none) */
  bridge?: number;
}
export enum FurnitureFlag {
  /** inferred from the junction's shape (the data give none) */
  Inferred = 1,
  /** a yield line (entering a roundabout), not a stop line */
  Yield = 2,
  /** (review A4) a guardrail along a bridge's segment: on its deck (CellStreetFlag.FurnitureBridges says the flag is written) */
  OnBridge = 4,
}
export enum PlaceKind {
  Along = 0,
  /** angled, perpendicular — reserved: only where the data say it */
  Angled = 1,
}
export enum PlaceFlag {
  /** on the left of its segment's direction */
  Left = 1,
  /** off the carriageway, on an assumed parking lane (a one way of 3–5 m: the BD TOPO's width is the driven one) */
  AssumedLane = 2,
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
  /** the arm's heading, from the foot to the head [rad, anticlockwise from east, 0 … 2π] (VB5a; 0 when not given) */
  heading?: number;
  /** the arm's reach [m] (ARM_M when not given) */
  reach?: number;
  /** its variant (0 … LAMP_VARIANTS − 1) */
  variant?: number;
}
/** a segment's continuations (VB6): the next at b, at a — NEXT_* */
export interface SegmentNext {
  b: number;
  a: number;
}
export interface FurnitureRecord {
  east: number;
  north: number;
  /** [rad, anticlockwise from east, 0 … 2π) */
  heading: number;
  /** across the road [m] */
  length: number;
  kind: FurnitureKind;
  flags: number;
  junction: number;
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
  /** a railway's track electrified (J8-RP RP9: the preparation's; in the bytes its surface's SurfaceFlag.Electrified, not the segment's) */
  electric?: boolean;
}
export interface JunctionRecord {
  east: number;
  north: number;
  degree: number;
  /** the widest carriageway met there [m] */
  width: number;
  flags: number;
}
export interface PlaceRecord {
  east: number;
  north: number;
  /** the street's direction there [rad, anticlockwise from east, 0 … 2π) */
  heading: number;
  kind: PlaceKind;
  flags: number;
  /** a 24-bit seed */
  seed: number;
  /** the carriageway's width there [m] */
  width: number;
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
  furnitureCount: number;
  bridgeCount: number;
  /** CellStreetFlag */
  flags: number;
  generation: number;
  originLat: number;
  originLon: number;
}

/** an angle [rad] on 16 bits (0 … 2π over 0 … 65535) */
const angle16 = (a: number) => {
  const h = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.min(65535, Math.round((h / (2 * Math.PI)) * 65536));
};

/** A street cell's bytes. `next` one a segment (none given: NEXT_NONE everywhere). */
export function encodeStreetCell(
  h: Pick<StreetHeader, "z" | "x" | "y" | "generation" | "originLat" | "originLon">,
  lamps: readonly StreetLampRecord[],
  segments: readonly RoadSegmentRecord[],
  junctions: readonly JunctionRecord[],
  places: readonly PlaceRecord[] = [],
  flags = 0,
  next: readonly SegmentNext[] = [],
  furniture: readonly FurnitureRecord[] = [],
  surfaces: readonly SegmentSurface[] = [],
  bridges: readonly BridgeRecord[] = [],
): ArrayBuffer {
  const js = junctions.slice(0, 65535),
    ps = places.slice(0, 65535);
  const buf = new ArrayBuffer(
    STREET_HEADER_BYTES +
      lamps.length * LAMP_BYTES +
      segments.length * SEGMENT_BYTES +
      js.length * JUNCTION_BYTES +
      ps.length * PLACE_BYTES +
      segments.length * NEXT_BYTES +
      segments.length * SURFACE_BYTES +
      furniture.length * FURNITURE_BYTES +
      bridges.reduce((n, b) => n + BRIDGE_HEAD_BYTES + b.points.length * BRIDGE_POINT_BYTES, 0),
  );
  const v = new DataView(buf);
  v.setUint32(0, STREET_MAGIC, true);
  v.setUint16(4, STREET_FORMAT, true);
  v.setUint16(6, js.length, true);
  v.setUint8(8, h.z ?? CELL_Z);
  v.setUint8(9, flags & 255);
  v.setUint16(10, ps.length, true);
  v.setUint32(12, h.x, true);
  v.setUint32(16, h.y, true);
  v.setUint32(20, lamps.length, true);
  v.setUint32(24, segments.length, true);
  v.setUint32(28, h.generation >>> 0, true);
  v.setFloat64(32, h.originLat, true);
  v.setFloat64(40, h.originLon, true);
  v.setUint32(48, furniture.length, true);
  v.setUint32(52, bridges.length, true);
  let o = STREET_HEADER_BYTES;
  for (const l of lamps) {
    v.setFloat32(o, l.east, true);
    v.setFloat32(o + 4, l.north, true);
    v.setUint16(o + 8, Math.max(0, Math.min(65535, Math.round(l.height * 100))), true);
    v.setUint8(o + 10, Math.max(0, LAMP_CODES.indexOf(l.cls)));
    v.setUint8(o + 11, l.flags & 255);
    v.setUint16(o + 12, angle16(l.heading ?? 0), true);
    v.setUint8(o + 14, Math.max(0, Math.min(255, Math.round((l.reach ?? ARM_M) * 10))));
    v.setUint8(o + 15, Math.max(0, Math.min(LAMP_VARIANTS - 1, l.variant ?? 0)));
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
  for (const j of js) {
    v.setFloat32(o, j.east, true);
    v.setFloat32(o + 4, j.north, true);
    v.setUint8(o + 8, Math.max(0, Math.min(255, j.degree)));
    v.setUint8(o + 9, Math.max(0, Math.min(255, Math.round(j.width * 5))));
    v.setUint16(o + 10, j.flags & 65535, true);
    o += JUNCTION_BYTES;
  }
  for (const p of ps) {
    v.setFloat32(o, p.east, true);
    v.setFloat32(o + 4, p.north, true);
    v.setUint16(o + 8, angle16(p.heading), true);
    v.setUint8(o + 10, p.kind & 255);
    v.setUint8(o + 11, p.flags & 255);
    const seed = p.seed & 0xffffff;
    v.setUint8(o + 12, seed & 255);
    v.setUint8(o + 13, (seed >> 8) & 255);
    v.setUint8(o + 14, (seed >> 16) & 255);
    v.setUint8(o + 15, Math.max(0, Math.min(255, Math.round(p.width * 5))));
    o += PLACE_BYTES;
  }
  for (let i = 0; i < segments.length; i++) {
    v.setUint16(o, next[i]?.b ?? NEXT_NONE, true);
    v.setUint16(o + 2, next[i]?.a ?? NEXT_NONE, true);
    o += NEXT_BYTES;
  }
  for (let i = 0; i < segments.length; i++) {
    const f = surfaces[i];
    v.setUint8(o, (f?.flags ?? 0) & 255);
    v.setUint8(o + 1, Math.max(0, Math.min(255, f?.laneLines ?? 0)));
    v.setUint8(o + 2, Math.max(0, Math.min(255, Math.round((f?.pavement ?? 0) * 10))));
    v.setUint8(o + 3, f?.bridge ?? NO_BRIDGE);
    o += SURFACE_BYTES;
  }
  for (const f of furniture) {
    v.setFloat32(o, f.east, true);
    v.setFloat32(o + 4, f.north, true);
    v.setUint16(o + 8, angle16(f.heading), true);
    v.setUint16(o + 10, Math.max(0, Math.min(65535, Math.round(f.length * 100))), true);
    v.setUint8(o + 12, f.kind & 255);
    v.setUint8(o + 13, f.flags & 255);
    v.setUint16(o + 14, f.junction & 65535, true);
    o += FURNITURE_BYTES;
  }
  for (const b of bridges) {
    v.setUint32(o, b.id >>> 0, true);
    v.setUint16(o + 4, b.points.length, true);
    v.setUint8(o + 6, b.kind);
    v.setUint8(o + 7, b.flags & 255);
    v.setFloat32(o + 8, b.width, true);
    v.setInt8(o + 12, Math.max(-128, Math.min(127, Math.round(b.layer))));
    v.setUint8(o + 13, b.crossed & 255);
    v.setUint8(o + 14, Math.max(0, Math.min(255, Math.round(b.clearance * 10))));
    v.setFloat32(o + 16, b.length, true);
    o += BRIDGE_HEAD_BYTES;
    for (const [e, n] of b.points) {
      v.setFloat32(o, e, true);
      v.setFloat32(o + 4, n, true);
      o += BRIDGE_POINT_BYTES;
    }
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
    furnitureCount: v.getUint32(48, true),
    bridgeCount: v.getUint32(52, true),
    flags: v.getUint8(9),
    generation: v.getUint32(28, true),
    originLat: v.getFloat64(32, true),
    originLon: v.getFloat64(40, true),
  };
  const size =
    STREET_HEADER_BYTES +
    h.lampCount * LAMP_BYTES +
    h.segmentCount * SEGMENT_BYTES +
    h.junctionCount * JUNCTION_BYTES +
    h.placeCount * PLACE_BYTES +
    h.segmentCount * NEXT_BYTES +
    h.segmentCount * SURFACE_BYTES +
    h.furnitureCount * FURNITURE_BYTES;
  // (the bridges' records, of their own lengths: walked to the end, each inside the bytes)
  let o = size;
  for (let i = 0; i < h.bridgeCount; i++) {
    if (o + BRIDGE_HEAD_BYTES > buf.byteLength) return null;
    o += BRIDGE_HEAD_BYTES + v.getUint16(o + 4, true) * BRIDGE_POINT_BYTES;
  }
  return buf.byteLength === o ? h : null;
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
    heading: (v.getUint16(o + 12, true) / 65536) * 2 * Math.PI,
    reach: v.getUint8(o + 14) / 10,
    variant: v.getUint8(o + 15),
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

/** a street cell's i-th place (VB4) */
export function readPlace(buf: ArrayBuffer, i: number): PlaceRecord {
  const v = new DataView(buf);
  const h = readStreetHeader(buf)!;
  const o =
    STREET_HEADER_BYTES + h.lampCount * LAMP_BYTES + h.segmentCount * SEGMENT_BYTES + h.junctionCount * JUNCTION_BYTES + i * PLACE_BYTES;
  return {
    east: v.getFloat32(o, true),
    north: v.getFloat32(o + 4, true),
    heading: (v.getUint16(o + 8, true) / 65536) * 2 * Math.PI,
    kind: v.getUint8(o + 10),
    flags: v.getUint8(o + 11),
    seed: v.getUint8(o + 12) | (v.getUint8(o + 13) << 8) | (v.getUint8(o + 14) << 16),
    width: v.getUint8(o + 15) / 5,
  };
}

/** where the continuations begin (after the places) */
const nextBase = (h: StreetHeader) =>
  STREET_HEADER_BYTES +
  h.lampCount * LAMP_BYTES +
  h.segmentCount * SEGMENT_BYTES +
  h.junctionCount * JUNCTION_BYTES +
  h.placeCount * PLACE_BYTES;

/** a street cell's i-th segment's continuations (VB6) */
export function readNext(buf: ArrayBuffer, i: number): SegmentNext {
  const v = new DataView(buf);
  const o = nextBase(readStreetHeader(buf)!) + i * NEXT_BYTES;
  return { b: v.getUint16(o, true), a: v.getUint16(o + 2, true) };
}

/** a street cell's i-th segment's surface (VB2) */
export function readSurface(buf: ArrayBuffer, i: number): SegmentSurface {
  const v = new DataView(buf);
  const h = readStreetHeader(buf)!;
  const o = nextBase(h) + h.segmentCount * NEXT_BYTES + i * SURFACE_BYTES;
  return { flags: v.getUint8(o), laneLines: v.getUint8(o + 1), pavement: v.getUint8(o + 2) / 10, bridge: v.getUint8(o + 3) };
}

/** a street cell's i-th piece of furniture (VB7) */
export function readFurniture(buf: ArrayBuffer, i: number): FurnitureRecord {
  const v = new DataView(buf);
  const h = readStreetHeader(buf)!;
  const o = nextBase(h) + h.segmentCount * (NEXT_BYTES + SURFACE_BYTES) + i * FURNITURE_BYTES;
  return {
    east: v.getFloat32(o, true),
    north: v.getFloat32(o + 4, true),
    heading: (v.getUint16(o + 8, true) / 65536) * 2 * Math.PI,
    length: v.getUint16(o + 10, true) / 100,
    kind: v.getUint8(o + 12),
    flags: v.getUint8(o + 13),
    junction: v.getUint16(o + 14, true),
  };
}

/** a street cell's bridges (J8-RP RP4), in their order (a segment's surface names one by its index) */
export function readBridges(buf: ArrayBuffer): BridgeRecord[] {
  const v = new DataView(buf);
  const h = readStreetHeader(buf);
  if (!h) return [];
  let o = nextBase(h) + h.segmentCount * (NEXT_BYTES + SURFACE_BYTES) + h.furnitureCount * FURNITURE_BYTES;
  const out: BridgeRecord[] = [];
  for (let i = 0; i < h.bridgeCount; i++) {
    const n = v.getUint16(o + 4, true);
    const points: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const p = o + BRIDGE_HEAD_BYTES + k * BRIDGE_POINT_BYTES;
      points.push([v.getFloat32(p, true), v.getFloat32(p + 4, true)]);
    }
    out.push({
      id: v.getUint32(o, true),
      kind: v.getUint8(o + 6),
      flags: v.getUint8(o + 7),
      width: v.getFloat32(o + 8, true),
      layer: v.getInt8(o + 12),
      crossed: v.getUint8(o + 13),
      clearance: v.getUint8(o + 14) / 10,
      length: v.getFloat32(o + 16, true),
      points,
    });
    o += BRIDGE_HEAD_BYTES + n * BRIDGE_POINT_BYTES;
  }
  return out;
}

/**
 * A bridge's piers (J8-RP RP4 — the drawing keeps those where the deck stands PIER_MIN_M or more over the ground at the foot): their
 * abscissas along its axis [m], evenly spaced about PIER_SPACING_M (VIADUCT_PIER_SPACING_M for a viaduct), none at the abutments.
 */
export function bridgePiers(length: number, viaduct: boolean): number[] {
  const spacing = viaduct ? VIADUCT_PIER_SPACING_M : PIER_SPACING_M;
  const n = Math.max(0, Math.round(length / spacing) - 1);
  return Array.from({ length: n }, (_, i) => (length * (i + 1)) / (n + 1));
}

/** A road's run in a cell (J8-RP RP2): its segments sewn by their continuations along the same road — the BD TOPO's surveyed axis in
 *  France —, its points and its attributes (its first segment's). */
export interface RoadRun {
  points: [number, number][];
  /** each point's abscissa along its road [m] — its segments' (`s0`): continuous within a tile's cells, not from one tile to the next */
  s: number[];
  width: number;
  lanes: number;
  cls: RoadClass;
  flags: number;
  level: number;
  roadId: number;
  /** its segments' indices, in order */
  segments: number[];
}

/**
 * A street cell's roads as runs (J8-RP RP2): each segment once, sewn to the next one of its own road driven forward (its continuation
 * at b, not reversed, the same road's identity), from those no such segment leads to. The scene draws its roads in France from them
 * — the BD TOPO's axis and width — rather than from OpenMapTiles' lines. A road crossing a cell's edge is cut there: each cell keeps
 * the segments whose middles are its own, so the run ends on a point a little past the edge where the next cell's run of the same
 * `roadId` begins (the same point, the same abscissa within a tile).
 */
export function roadRuns(buf: ArrayBuffer): RoadRun[] {
  const h = readStreetHeader(buf);
  if (!h) return [];
  const segs = Array.from({ length: h.segmentCount }, (_, i) => readSegment(buf, i));
  const after = segs.map((s, i) => {
    const b = readNext(buf, i).b;
    if (b >= NEXT_ELSEWHERE || b & NEXT_REVERSED) return -1;
    return segs[b]?.roadId === s.roadId ? b : -1;
  });
  const led = new Uint8Array(segs.length);
  for (const j of after) if (j >= 0) led[j] = 1;
  const used = new Uint8Array(segs.length);
  const out: RoadRun[] = [];
  const walk = (start: number) => {
    const s = segs[start]!;
    const run: RoadRun = {
      points: [s.a],
      s: [s.s0],
      width: s.width,
      lanes: s.lanes,
      cls: s.cls,
      flags: s.flags,
      level: s.level,
      roadId: s.roadId,
      segments: [],
    };
    for (let i = start; i >= 0 && !used[i]; i = after[i]!) {
      used[i] = 1;
      const g = segs[i]!;
      run.points.push(g.b);
      run.s.push(g.s0 + Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]));
      run.segments.push(i);
    }
    out.push(run);
  };
  for (let i = 0; i < segs.length; i++) if (!led[i]) walk(i);
  // (a loop of one road — a roundabout's ring — has no start: its rest walked from any of its segments)
  for (let i = 0; i < segs.length; i++) if (!used[i]) walk(i);
  return out;
}

/**
 * Whether a place's traffic drives on the left (VB7's side): the countries that do, by coarse boxes — Great Britain, Ireland, Japan,
 * Australia, New Zealand. Others that do (southern Africa, the Indian subcontinent, Indonesia, Thailand…) are not listed yet: their
 * furniture is set for the right (said, not hidden).
 */
export function drivesLeft(lat: number, lon: number): boolean {
  const boxes: [number, number, number, number][] = [
    // [south, west, north, east]
    [49.8, -8.7, 60.9, 1.8], // Great Britain (its Channel Islands, the Isle of Man)
    [51.3, -10.7, 55.5, -5.9], // Ireland and Northern Ireland
    [24, 122.9, 46, 146], // Japan
    [-44, 112, -10, 154], // Australia
    [-47.5, 166, -34, 179], // New Zealand
  ];
  // (the French coast the British box reaches — Boulogne, Calais, east of 1.4° E under 51.0° N — drives on the right)
  const right: [number, number, number, number][] = [[49.8, 1.4, 51.0, 1.8]];
  const inside = (b: [number, number, number, number]) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
  return boxes.some(inside) && !right.some(inside);
}

/** a street cell's bytes (format 3) and its preparation's time in a zone's own worker — measured (j8-zone-paris, kerr-mini, 17 Nov 2026:
 *  Paris 4 332 cells, 121 MB, 36 s — 27.9 kB a cell, 23.0 in format 2 —; Toulon-Hyères 2 600, 32.9 MB, 12.3 s — 12.7 kB, 9.6 in format
 *  2) — the two zones' mean by cell, for a zone's estimate (pwa-zones.ts) */
export const STREET_CELL_BYTES_EST = 22_200;
export const STREET_CELL_SECONDS_EST = 0.0069;

/** the prepared streets' cache (Cache Storage): the format in its name — a new format never reads an old one's cells */
export const STREET_CACHE = `kerr-street-v${STREET_FORMAT}`;
/** a street cell's key in it (a URL: Cache Storage's keys are requests; never fetched) */
export const streetCacheUrl = (origin: string, x: number, y: number) => `${origin}/__street/${STREET_FORMAT}/${CELL_Z}/${x}/${y}.ksc`;
/** OpenMapTiles' z 14 tile a street cell is prepared from (OpenFreeMap's — scenery-sources.ts osmUrl's, built here without that module) */
export const streetRoadsUrl = (x: number, y: number) => {
  const n = 2 ** (CELL_Z - 1);
  return `https://tiles.openfreemap.org/planet/latest/${CELL_Z - 1}/${(((x >> 1) % n) + n) % n}/${y >> 1}.pbf`;
};
