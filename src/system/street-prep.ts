// PLAN-J8 J8-L and J8-VB (VB1, VB2, VB4, VB5a, VB6's data, VB7) — the streets' cells prepared (street-cells.ts, format 3 — its rules in its
// header): an OpenMapTiles z 14
// tile (OpenFreeMap's, its `transportation` layer) and, in France, the BD TOPO's z 15 tiles under it (their `troncon_de_route` — the very
// tiles the building cells are prepared from) into its four z 15 street cells: the lamps (streetlamps.ts lampsAlong on the town streets,
// where the building cells say built-up — builtUp —, as the scenery worker's own), every road's segments (Douglas-Peucker to SIMPLIFY_M,
// cut to SEGMENT_MAX_M, each in the cell of its middle — the BD TOPO's in France, OpenMapTiles' elsewhere, its width and lanes inferred by
// its class), its junctions (the roads' ends met within JUNCTION_M, three or more), its places (VB4), and the details street-detail-prep.ts
// derives (the surfaces, the continuations, the furniture). No ground. Pure: the cell workers run it, the tests too.
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { inBdtopoBox } from "./bdtopo";
import { cellBounds, cellOrigin, fromCell, readHeader, readRecord, sourceKey, toCell } from "./building-cells";
import { roadWidth } from "./scenery-geometry";
import { builtUp, LAMP_CLASSES, lampsAlong } from "./streetlamps";
import { omtSurfaces } from "./forest-exclusions";
import { type BridgePiece, chainBridges, type PieceEnds, segmentNexts, segmentSurface, streetFurniture } from "./street-detail-prep";
import {
  type BridgeRecord,
  CellStreetFlag,
  drivesLeft,
  NO_BRIDGE,
  encodeStreetCell,
  type FurnitureRecord,
  LAMP_VARIANTS,
  PLACE_BUILDING_M,
  PLACE_JUNCTION_M,
  PLACE_KEEP,
  PLACE_MAX,
  PLACE_OTHER_ROAD_M,
  PLACE_SPACING_M,
  PlaceFlag,
  PlaceKind,
  type PlaceRecord,
  type JunctionRecord,
  JunctionFlag,
  JUNCTION_M,
  type LAMP_CODES,
  type RoadClass,
  type RoadSegmentRecord,
  SEGMENT_MAX_M,
  SegmentFlag,
  SIMPLIFY_M,
  StreetFlag,
  type StreetLampRecord,
} from "./street-cells";
import { ROAD_TRAFFIC } from "./traffic";

const D = Math.PI / 180;
const OSM_Z = 14;

export interface PreparedStreetCell {
  x: number;
  y: number;
  buf: ArrayBuffer;
  lamps: StreetLampRecord[];
  segments: RoadSegmentRecord[];
  junctions: JunctionRecord[];
  /** its parked cars' places (VB4), and whether they were thinned to PLACE_MAX */
  places: PlaceRecord[];
  /** its junctions' and fast roads' furniture (VB7), its tunnels' mouths (J8-RP RP8) */
  furniture: FurnitureRecord[];
  /** its bridges (J8-RP RP4): every bridge holding one of its segments, whole as its tile holds it, in its frame */
  bridges: BridgeRecord[];
  thinned: boolean;
  /** with `measure`: the places without the assumed lanes (−1 else) */
  placesBefore: number;
  /** the roads' vertices before and after the simplification (the fiche's count) */
  vertices: { before: number; after: number };
}

/** a class's inferred lanes and speed [m/s] (a road without them in its source) */
const LANES: Record<string, number> = {
  motorway: 4,
  trunk: 2,
  primary: 2,
  secondary: 2,
  tertiary: 2,
  minor: 2,
  service: 1,
  track: 1,
  path: 0,
  steps: 0,
};
const SPEED: Record<string, number> = {
  motorway: 36,
  trunk: 28,
  primary: 22,
  secondary: 20,
  tertiary: 14,
  minor: 11,
  service: 6,
  track: 4,
  path: 1.4,
  steps: 1,
};
const OMT_CLASSES = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track", "path"]);

/** Douglas-Peucker: the points kept within `tol` [m] of the line (planar, metres) */
export function simplify(points: readonly [number, number][], tol: number): [number, number][] {
  if (points.length <= 2) return points.slice() as [number, number][];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = points[i]!,
      [bx, by] = points[j]!;
    const vx = bx - ax,
      vy = by - ay,
      L = Math.hypot(vx, vy);
    let far = -1,
      best = tol;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = points[k]!;
      const d = L > 1e-9 ? Math.abs((px - ax) * vy - (py - ay) * vx) / L : Math.hypot(px - ax, py - ay);
      if (d > best) {
        best = d;
        far = k;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** a road's attributes, from either source */
interface RoadMeta {
  cls: RoadClass;
  width: number;
  lanes: number;
  flags: number;
  level: number;
  speed: number;
  roadId: number;
}

/** the BD TOPO's troncon_de_route as a road's attributes (null: not a road the cells keep — a ferry) */
function bdtopoRoad(pr: Record<string, unknown>): RoadMeta | null {
  const nature = String(pr.nature ?? "");
  if (nature.startsWith("Bac")) return null;
  const imp = String(pr.importance ?? "");
  const cls: RoadClass =
    nature === "Type autoroutier"
      ? "motorway"
      : nature === "Sentier"
        ? "path"
        : nature === "Escalier"
          ? "steps"
          : nature === "Chemin" || nature === "Route empierrée"
            ? "track"
            : imp === "1"
              ? "trunk"
              : imp === "2"
                ? "primary"
                : imp === "3"
                  ? "secondary"
                  : imp === "4"
                    ? "tertiary"
                    : imp === "5"
                      ? "minor"
                      : "service";
  let flags = 0;
  const sens = String(pr.sens_de_circulation ?? "");
  if (sens === "Sens direct") flags |= SegmentFlag.OnewayAlong;
  else if (sens === "Sens inverse") flags |= SegmentFlag.OnewayAgainst;
  const pos = String(pr.position_par_rapport_au_sol ?? "0");
  let level = 0;
  if (pos.startsWith("Gué")) flags |= SegmentFlag.Ford;
  else level = Number(pos) || 0;
  if (level > 0) flags |= SegmentFlag.Bridge;
  if (level < 0) flags |= SegmentFlag.Tunnel;
  if (pr.urbain === true) flags |= SegmentFlag.Urban;
  if (nature === "Rond-point") flags |= SegmentFlag.Roundabout;
  const w = typeof pr.largeur_de_chaussee === "number" && pr.largeur_de_chaussee > 0 ? pr.largeur_de_chaussee : null;
  const n = typeof pr.nombre_de_voies === "number" ? pr.nombre_de_voies : null;
  if (w === null) flags |= SegmentFlag.InferredWidth;
  const v = typeof pr.vitesse_moyenne_vl === "number" && pr.vitesse_moyenne_vl > 1 ? pr.vitesse_moyenne_vl / 3.6 : SPEED[cls]!;
  return {
    cls,
    width: w ?? roadWidth(cls === "steps" ? "path" : cls),
    lanes: n ?? LANES[cls] ?? 1,
    flags,
    level,
    speed: v,
    roadId: sourceKey(String(pr.cleabs ?? "")),
  };
}

/** OpenMapTiles' transportation as a road's attributes (null: not a road — rail, ferry, aerialway) */
function omtRoad(pr: Record<string, unknown>, id: number | undefined): RoadMeta | null {
  const c = String(pr.class ?? "").replace("_construction", "");
  if (!OMT_CLASSES.has(c)) return null;
  const cls = (pr.subclass === "steps" ? "steps" : c) as RoadClass;
  let flags = SegmentFlag.InferredWidth;
  const one = Number(pr.oneway) || 0;
  if (one > 0) flags |= SegmentFlag.OnewayAlong;
  else if (one < 0) flags |= SegmentFlag.OnewayAgainst;
  const level = pr.brunnel === "bridge" ? 1 : pr.brunnel === "tunnel" ? -1 : 0;
  if (level > 0) flags |= SegmentFlag.Bridge;
  if (level < 0) flags |= SegmentFlag.Tunnel;
  if (pr.brunnel === "ford") flags |= SegmentFlag.Ford;
  return {
    cls,
    width: roadWidth(cls === "steps" ? "path" : cls, String(pr.subclass ?? "")),
    lanes: LANES[cls] ?? 1,
    flags,
    level,
    speed: ROAD_TRAFFIC[cls]?.speed ?? SPEED[cls]!,
    roadId: sourceKey(`osm:${id ?? 0}:${c}`),
  };
}

/** a building's oriented box in its cell's frame (building-cells.ts: centre, half-sides, heading) */
interface Box {
  e: number;
  n: number;
  hl: number;
  hw: number;
  h: number;
}
/** a u32 hash of four numbers (the places' seeds) */
function hash4(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1) ^ d;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 16)) >>> 0;
}
const PARKED = new Set(["tertiary", "minor", "service"]);

/**
 * A cell's parked cars' places (VB4 — street-cells.ts's rules): along the urban streets, both sides, every PLACE_SPACING_M; none near a
 * junction or a building; each kept by its seed (PLACE_KEEP), at most PLACE_MAX, thinned evenly by the seeds past it.
 */
export function placesOf(
  segments: readonly RoadSegmentRecord[],
  junctions: readonly JunctionRecord[],
  boxes: readonly Box[],
  /** the assumed lanes of the narrow one ways (false: the 5 m rule alone — the fiche's before) */
  assumed = true,
): { places: PlaceRecord[]; thinned: boolean } {
  // (the buildings and junctions in a grid of 50 m: the places' neighbours looked up)
  const G = 50;
  const key = (e: number, n: number) => `${Math.floor(e / G)},${Math.floor(n / G)}`;
  const bgrid = new Map<string, Box[]>();
  for (const b of boxes) {
    const r = Math.hypot(b.hl, b.hw) + PLACE_BUILDING_M + 2;
    for (let i = Math.floor((b.e - r) / G); i <= Math.floor((b.e + r) / G); i++)
      for (let j = Math.floor((b.n - r) / G); j <= Math.floor((b.n + r) / G); j++) {
        const k = `${i},${j}`;
        (bgrid.get(k) ?? bgrid.set(k, []).get(k)!).push(b);
      }
  }
  const jgrid = new Map<string, JunctionRecord[]>();
  for (const j of junctions)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const k = `${Math.floor(j.east / G) + a},${Math.floor(j.north / G) + b}`;
        (jgrid.get(k) ?? jgrid.set(k, []).get(k)!).push(j);
      }
  // (a car's footprint — 4.4 × 1.8 m — against a building's box widened by PLACE_BUILDING_M: its centre within half its length more)
  const inBuilding = (e: number, n: number) => {
    for (const b of bgrid.get(key(e, n)) ?? []) {
      const c = Math.cos(b.h),
        s = Math.sin(b.h);
      const u = (e - b.e) * c + (n - b.n) * s,
        v = -(e - b.e) * s + (n - b.n) * c;
      if (Math.abs(u) <= b.hl + PLACE_BUILDING_M + 1.1 && Math.abs(v) <= b.hw + PLACE_BUILDING_M + 1.1) return true;
    }
    return false;
  };
  // (the segments in the same grid: an assumed lane's place against another road)
  const sgrid = new Map<string, number[]>();
  segments.forEach((sg, si) => {
    const L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
    const steps = Math.max(1, Math.ceil(L / (G / 2)));
    const seen = new Set<string>();
    for (let q = 0; q <= steps; q++) {
      const e = sg.a[0] + ((sg.b[0] - sg.a[0]) * q) / steps,
        n = sg.a[1] + ((sg.b[1] - sg.a[1]) * q) / steps;
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const k = `${Math.floor(e / G) + a},${Math.floor(n / G) + b}`;
          if (seen.has(k)) continue;
          seen.add(k);
          (sgrid.get(k) ?? sgrid.set(k, []).get(k)!).push(si);
        }
    }
  });
  const nearOtherRoad = (e: number, n: number, own: number) =>
    (sgrid.get(key(e, n)) ?? []).some((si) => {
      if (si === own) return false;
      const sg = segments[si]!;
      const vx = sg.b[0] - sg.a[0],
        vy = sg.b[1] - sg.a[1],
        l2 = vx * vx + vy * vy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((e - sg.a[0]) * vx + (n - sg.a[1]) * vy) / l2)) : 0;
      return Math.hypot(e - sg.a[0] - t * vx, n - sg.a[1] - t * vy) < PLACE_OTHER_ROAD_M;
    });
  const nearJunction = (e: number, n: number) =>
    (jgrid.get(key(e, n)) ?? []).some((j) => Math.hypot(j.east - e, j.north - n) < PLACE_JUNCTION_M);
  const out: PlaceRecord[] = [];
  segments.forEach((sg, si) => {
    if (!(sg.flags & SegmentFlag.Urban) || !PARKED.has(sg.cls)) return;
    if (sg.flags & (SegmentFlag.Bridge | SegmentFlag.Tunnel | SegmentFlag.Ford)) return;
    const oneway = !!(sg.flags & (SegmentFlag.OnewayAlong | SegmentFlag.OnewayAgainst));
    // (an urban one way of 3–5 m: an assumed lane off its carriageway, on the right)
    const lane = assumed && oneway && sg.width >= 3 && sg.width < 5;
    if (sg.width < 5 && !lane) return;
    const [ax, ay] = sg.a,
      [bx, by] = sg.b;
    const L = Math.hypot(bx - ax, by - ay);
    if (L < PLACE_SPACING_M) return;
    const dx = (bx - ax) / L,
      dy = (by - ay) / L;
    const heading = Math.atan2(dy, dx);
    const sides = oneway && sg.width < 6 ? [-1] : [-1, 1];
    const off = lane ? sg.width / 2 + 1.1 : sg.width / 2 - 1.1;
    for (let k = 0; PLACE_SPACING_M / 2 + k * PLACE_SPACING_M <= L - PLACE_SPACING_M / 2; k++) {
      const t = PLACE_SPACING_M / 2 + k * PLACE_SPACING_M;
      for (const side of sides) {
        // (side −1 the right of the direction, (dy, −dx); +1 the left, (−dy, dx))
        const e = ax + dx * t + side * -dy * off,
          n = ay + dy * t + side * dx * off;
        const seed = hash4(sg.roadId, si, k, side);
        if ((seed & 0xffff) / 0x10000 >= PLACE_KEEP) continue;
        if (nearJunction(e, n) || inBuilding(e, n)) continue;
        if (lane && nearOtherRoad(e, n, si)) continue;
        out.push({
          east: e,
          north: n,
          heading: side > 0 ? heading + Math.PI : heading,
          kind: PlaceKind.Along,
          flags: (side > 0 ? PlaceFlag.Left : 0) | (lane ? PlaceFlag.AssumedLane : 0),
          seed: seed >>> 8,
          width: sg.width,
        });
      }
    }
  });
  if (out.length <= PLACE_MAX) return { places: out, thinned: false };
  // (past the bound: thinned evenly — the lowest seeds kept, wherever they are in the cell)
  const kept = out
    .map((p, i) => ({ p, r: hash4(p.seed, i, 0x51ace, 7) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, PLACE_MAX)
    .map((x) => x.p);
  return { places: kept, thinned: true };
}

/**
 * An OpenMapTiles z 14 tile's four z 15 street cells (north-west, north-east, south-west, south-east, as cell-prep-overture.ts orders
 * them). `buildings(x, y)`: the building cell of a z 15 cell (its bytes, or null) — the town's test for the lamps; `bdtopo(x, y)`: in
 * France, the BD TOPO's z 15 tile of a cell (its bytes, or null: its roads OpenMapTiles' then); `generation`: the roads' revision.
 */
export function prepareStreetCells(
  bytes: ArrayBuffer | Uint8Array,
  x14: number,
  y14: number,
  buildings: (x: number, y: number) => ArrayBuffer | null,
  generation = 0,
  bdtopo: (x: number, y: number) => ArrayBuffer | Uint8Array | null = () => null,
  /** the fiche's measure: the places without the assumed lanes counted too (placesBefore) */
  measure = false,
): PreparedStreetCell[] {
  const n = 2 ** OSM_Z;
  const tileOrigin = cellOrigin(x14, y14, OSM_Z);
  const cells = [0, 1, 2, 3].map((k) => {
    const x = x14 * 2 + (k % 2),
      y = y14 * 2 + Math.floor(k / 2);
    const bd = inBdtopoBox(x, y) ? bdtopo(x, y) : null;
    return {
      x,
      y,
      origin: cellOrigin(x, y, OSM_Z + 1),
      bd,
      lamps: [] as StreetLampRecord[],
      segments: [] as RoadSegmentRecord[],
      pieces: [] as PieceEnds[],
      ends: [] as { e: number; n: number; width: number; level: number; round: boolean }[],
      vertices: { before: 0, after: 0 },
      boxes: [] as Box[],
    };
  });
  // (which of the four a place falls in — null: outside this tile)
  const cellAt = (lat: number, lon: number) => {
    const fx = ((lon + 180) / 360) * n * 2 - x14 * 2,
      fy = ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n * 2 - y14 * 2;
    if (fx < 0 || fx >= 2 || fy < 0 || fy >= 2) return null;
    return cells[Math.floor(fy) * 2 + Math.floor(fx)]!;
  };
  /** a road's line (its points in `origin`'s frame) simplified and cut into segments, each kept in the cell of its middle (`accept`:
   *  whether that cell takes this source's roads) — its ends noted for the junctions */
  const road = (
    xy: [number, number][],
    origin: { lat: number; lon: number },
    meta: RoadMeta,
    accept: (c: (typeof cells)[number]) => boolean,
  ) => {
    const pts = simplify(xy, SIMPLIFY_M);
    const toGeo = (p: [number, number]) => fromCell(origin, p[0], p[1]);
    let s = 0;
    for (let j = 0; j + 1 < pts.length; j++) {
      const [ax, ay] = pts[j]!,
        [bx, by] = pts[j + 1]!;
      const L = Math.hypot(bx - ax, by - ay);
      const k = Math.max(1, Math.ceil(L / SEGMENT_MAX_M));
      for (let q = 0; q < k; q++) {
        const pa: [number, number] = [ax + ((bx - ax) * q) / k, ay + ((by - ay) * q) / k],
          pb: [number, number] = [ax + ((bx - ax) * (q + 1)) / k, ay + ((by - ay) * (q + 1)) / k];
        const mid = toGeo([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]);
        const c = cellAt(mid.lat, mid.lon);
        if (c && accept(c)) {
          const ga = toGeo(pa),
            gb = toGeo(pb);
          const ma = toCell(c.origin, ga.lat, ga.lon),
            mb = toCell(c.origin, gb.lat, gb.lon);
          c.segments.push({ ...meta, a: [ma.east, ma.north], b: [mb.east, mb.north], s0: s + (L * q) / k });
          // (whether its ends are its road piece's own — the continuations': an end inside the piece goes on to its next segment)
          c.pieces.push({ a: j === 0 && q === 0, b: j === pts.length - 2 && q === k - 1 });
        }
      }
      s += L;
    }
    // (its ends — the junctions' index —, each in its own cell)
    for (const p of [pts[0]!, pts[pts.length - 1]!]) {
      const g = toGeo(p);
      const c = cellAt(g.lat, g.lon);
      if (!c || !accept(c)) continue;
      const m = toCell(c.origin, g.lat, g.lon);
      c.ends.push({ e: m.east, n: m.north, width: meta.width, level: meta.level, round: !!(meta.flags & SegmentFlag.Roundabout) });
    }
    return { before: xy.length, after: pts.length };
  };
  // (the BD TOPO's roads in France: each cell's own tile, its segments kept where their middle is that cell's)
  for (const c of cells) {
    if (!c.bd?.byteLength) continue;
    const layer = new VectorTile(new PbfReader(c.bd)).layers.troncon_de_route;
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 2) continue;
      const meta = bdtopoRoad(f.properties as Record<string, unknown>);
      if (!meta) continue;
      const e = f.extent,
        nz = 2 ** (OSM_Z + 1);
      for (const line of f.loadGeometry()) {
        const xy = line.map((v) => {
          const lon = ((c.x + v.x / e) / nz) * 360 - 180,
            lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (c.y + v.y / e)) / nz))) / D;
          const m = toCell(c.origin, lat, lon);
          return [m.east, m.north] as [number, number];
        });
        const r = road(xy, c.origin, meta, (k) => k === c);
        c.vertices.before += r.before;
        c.vertices.after += r.after;
      }
    }
  }
  // (the town: the four building cells' records, their centres in the tile's frame — the lamps')
  const centres: [number, number][] = [];
  for (const c of cells) {
    const buf = buildings(c.x, c.y);
    const h = buf ? readHeader(buf) : null;
    if (!buf || !h) continue;
    for (let i = 0; i < h.count; i++) {
      const r = readRecord(buf, i);
      const g = fromCell(c.origin, r.east, r.north);
      const m = toCell(tileOrigin, g.lat, g.lon);
      centres.push([m.east, m.north]);
      // (its box in its own cell's frame — the places' exclusion, VB4)
      c.boxes.push({ e: r.east, n: r.north, hl: r.halfLength, hw: r.halfWidth, h: r.heading });
    }
  }
  const town = builtUp(centres);
  // (OpenMapTiles' roads: the lamps everywhere; the segments in the cells the BD TOPO does not give)
  const layer = bytes.byteLength ? new VectorTile(new PbfReader(bytes)).layers.transportation : undefined;
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 2) continue;
    const pr = f.properties as Record<string, unknown>;
    const cls = String(pr.class ?? "");
    const lamp = LAMP_CLASSES[cls] && !pr.brunnel;
    const meta = omtRoad(pr, f.id);
    if (!lamp && !meta) continue;
    const e = f.extent;
    for (const line of f.loadGeometry()) {
      const xy = line.map((v) => {
        const lon = ((x14 + v.x / e) / n) * 360 - 180,
          lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y14 + v.y / e)) / n))) / D;
        const m = toCell(tileOrigin, lat, lon);
        return [m.east, m.north] as [number, number];
      });
      if (lamp) {
        const width = roadWidth(cls, String(pr.subclass ?? ""));
        for (const l of lampsAlong(xy, cls, width)) {
          if (!town(l.foot[0], l.foot[1])) continue;
          const g = fromCell(tileOrigin, l.foot[0], l.foot[1]);
          const c = cellAt(g.lat, g.lon);
          if (!c) continue;
          const m = toCell(c.origin, g.lat, g.lon);
          // (left of the direction: the foot on the side of (−dy, dx))
          const left = (l.foot[0] - xy[l.seg]![0]) * -l.dir[1] + (l.foot[1] - xy[l.seg]![1]) * l.dir[0] > 0;
          // (its arm, VB5a: from the foot to the head over the street — lampsAlong's —; its variant a seed of its foot)
          const ax = l.head[0] - l.foot[0],
            ay = l.head[1] - l.foot[1];
          c.lamps.push({
            east: m.east,
            north: m.north,
            height: l.head[2],
            cls: cls as (typeof LAMP_CODES)[number],
            flags: left ? StreetFlag.Left : 0,
            heading: Math.atan2(ay, ax),
            reach: Math.hypot(ax, ay),
            variant: hash4(Math.round(m.east * 10), Math.round(m.north * 10), c.x, c.y) % LAMP_VARIANTS,
          });
        }
      }
      if (meta) {
        const r = road(xy, tileOrigin, meta, (k) => !k.bd);
        // (counted in the cell of its first point, when it is one OpenMapTiles' roads serve)
        const g = fromCell(tileOrigin, xy[0]![0], xy[0]![1]);
        const c = cellAt(g.lat, g.lon);
        if (c && !c.bd) {
          c.vertices.before += r.before;
          c.vertices.after += r.after;
        }
      }
    }
  }
  // (J8-RP RP4: the tile's bridges — its four cells' bridge segments chained in the tile's frame, what they cross from OpenMapTiles'
  // surfaces, the BD TOPO's « Pont » constructions confirming them, cut where the tile's edge cuts them)
  const tileOf = (c: (typeof cells)[number], p: readonly [number, number]): [number, number] => {
    const g = fromCell(c.origin, p[0], p[1]);
    const m = toCell(tileOrigin, g.lat, g.lon);
    return [m.east, m.north];
  };
  const bridgePieces: BridgePiece[] = [];
  cells.forEach((c, k) =>
    c.segments.forEach((sg, i) => {
      if (sg.flags & SegmentFlag.Bridge) bridgePieces.push({ cell: k, index: i, a: tileOf(c, sg.a), b: tileOf(c, sg.b), seg: sg });
    }),
  );
  let bridgesOfTile: ReturnType<typeof chainBridges> = [];
  if (bridgePieces.length) {
    const surfaces = bytes.byteLength ? omtSurfaces(bytes, x14, y14, tileOrigin) : [];
    const ponts: [[number, number], [number, number]][] = [];
    for (const c of cells) {
      if (!c.bd?.byteLength) continue;
      const L = new VectorTile(new PbfReader(c.bd)).layers;
      for (const name of ["construction_lineaire", "construction_surfacique"]) {
        const l = L[name];
        for (let i = 0; l && i < l.length; i++) {
          const f = l.feature(i);
          if (String(f.properties.nature ?? "") !== "Pont") continue;
          const e = f.extent,
            nz = 2 ** (OSM_Z + 1);
          for (const line of f.loadGeometry()) {
            const xy = line.map((v) => {
              const lon = ((c.x + v.x / e) / nz) * 360 - 180,
                lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (c.y + v.y / e)) / nz))) / D;
              const m = toCell(tileOrigin, lat, lon);
              return [m.east, m.north] as [number, number];
            });
            for (let k = 0; k + 1 < xy.length; k++) ponts.push([xy[k]!, xy[k + 1]!]);
          }
        }
      }
    }
    const tb = cellBounds(x14, y14, OSM_Z);
    const tsw = toCell(tileOrigin, tb.south, tb.west),
      tne = toCell(tileOrigin, tb.north, tb.east);
    const atEdge = (p: [number, number]) => p[0] - tsw.east < 3 || tne.east - p[0] < 3 || p[1] - tsw.north < 3 || tne.north - p[1] < 3;
    bridgesOfTile = chainBridges(bridgePieces, surfaces, ponts, atEdge);
  }
  return cells.map((c, k) => {
    // (its bridges: those holding one of its segments, in its frame; each segment on one its index — J8-RP RP6)
    const bridges: BridgeRecord[] = [];
    const bridgeOf = new Map<number, number>();
    for (const cb of bridgesOfTile) {
      const mine = cb.pieces.filter((pc) => pc.cell === k);
      if (!mine.length || bridges.length >= NO_BRIDGE) continue;
      for (const pc of mine) bridgeOf.set(pc.index, bridges.length);
      bridges.push({
        ...cb.bridge,
        points: cb.bridge.points.map((p) => {
          const g = fromCell(tileOrigin, p[0], p[1]);
          const m = toCell(c.origin, g.lat, g.lon);
          return [m.east, m.north] as [number, number];
        }),
      });
    }
    // (the junctions: the ends met within JUNCTION_M — a grid of that side, its neighbours looked in —, three or more)
    const grid = new Map<string, number[]>();
    const key = (i: number, j: number) => `${i},${j}`;
    c.ends.forEach((p, k) => {
      const kk = key(Math.floor(p.e / JUNCTION_M), Math.floor(p.n / JUNCTION_M));
      (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(k);
    });
    const used = new Uint8Array(c.ends.length);
    const junctions: JunctionRecord[] = [];
    c.ends.forEach((p, k) => {
      if (used[k]) return;
      const gi = Math.floor(p.e / JUNCTION_M),
        gj = Math.floor(p.n / JUNCTION_M);
      const near: number[] = [];
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const q of grid.get(key(gi + a, gj + b)) ?? [])
            if (!used[q] && Math.hypot(c.ends[q]!.e - p.e, c.ends[q]!.n - p.n) <= JUNCTION_M) near.push(q);
      if (near.length < 3) return;
      for (const q of near) used[q] = 1;
      const ps = near.map((q) => c.ends[q]!);
      let flags = 0;
      if (ps.some((q) => q.round)) flags |= JunctionFlag.Roundabout;
      if (new Set(ps.map((q) => q.level)).size > 1) flags |= JunctionFlag.Levels;
      junctions.push({
        east: ps.reduce((s, q) => s + q.e, 0) / ps.length,
        north: ps.reduce((s, q) => s + q.n, 0) / ps.length,
        degree: near.length,
        width: Math.max(...ps.map((q) => q.width)),
        flags,
      });
    });
    const P = placesOf(c.segments, junctions, c.boxes);
    const placesBefore = measure ? placesOf(c.segments, junctions, c.boxes, false).places.length : -1;
    // (the details, VB2/VB6/VB7: the cell's edges in its frame — an end within 3 m of one may go on in a neighbour —; the traffic's side)
    const b = cellBounds(c.x, c.y, OSM_Z + 1);
    const sw = toCell(c.origin, b.south, b.west),
      ne = toCell(c.origin, b.north, b.east);
    const nearEdge = (e: number, n: number) => e - sw.east < 3 || ne.east - e < 3 || n - sw.north < 3 || ne.north - n < 3;
    const leftHand = drivesLeft(c.origin.lat, c.origin.lon);
    const next = segmentNexts(c.segments, c.pieces, nearEdge);
    const surfaces = c.segments.map((sg, i) => ({ ...segmentSurface(sg), bridge: bridgeOf.get(i) ?? NO_BRIDGE }));
    const furniture = streetFurniture(c.segments, junctions, leftHand);
    const flags = (P.thinned ? CellStreetFlag.Thinned : 0) | (leftHand ? CellStreetFlag.LeftHand : 0);
    return {
      x: c.x,
      y: c.y,
      lamps: c.lamps,
      segments: c.segments,
      junctions,
      places: P.places,
      furniture,
      bridges,
      thinned: P.thinned,
      placesBefore,
      vertices: c.vertices,
      buf: encodeStreetCell(
        { z: OSM_Z + 1, x: c.x, y: c.y, generation, originLat: c.origin.lat, originLon: c.origin.lon },
        c.lamps,
        c.segments,
        junctions,
        P.places,
        flags,
        next,
        furniture,
        surfaces,
        bridges,
      ),
    };
  });
}
