// The streets laid on the relief (25 Nov 2026; PROBLEMES « Ponts et routes : géométrie, supports et parité incomplets »: « le nivellement
// roadProfile/roadBank existe comme fonctions, sans lecteur de production » — the survey's ground about a town's streets stepped by a
// metre at the buildings' feet, seen in silhouette along the façades). A national relief tile's heights (earth-tiles.ts nationalHeights:
// the one ground both the raster and the contact read — its tiles, the terrain cache baked from them, the craft's ground sampled from
// them) levelled under each road of the street cell holding it, before they are kept: along its axis the profile the road's class
// allows (street-detail-prep.ts roadProfile: smoothed over a window, its grade bounded), across its carriageway its banking
// (roadBank: none in a town), its pavements a kerb's height over the carriageway's edge, faded into the ground over FADE_M past them.
// Bridges and tunnels left out (their decks are the scene's). (26 Nov 2026) A kerbed street's pavements levelled out to its façades —
// each segment, each side, the footprints of the building cells about the tile met across it (pavement-reach.ts facadeSides, the
// scene's own rule) —, and where carriageways meet (a junction, a crossing street) the carriageways first, blended by how central each
// is: no kerb across a crossing street, no step between two roads' profiles. Run in the decode worker (tile-decode.ts "level"), in the
// order street-level-book.ts keeps. Pure.
import { cellOrigin, fromCell, readHeader, readRecord } from "./building-cells";
import { facadeSides, PAVEMENT_REACH_MAX_M } from "./pavement-reach";
import type { Primitive } from "./scenery-data";
import { PAVEMENT_M, type RoadClass, readSegment, readStreetHeader, readSurface, roadRuns, SegmentFlag, SurfaceFlag } from "./street-cells";
import { ROAD_PROFILE, roadBank, roadProfile } from "./street-detail-prep";

/** a kerb's height over the carriageway's edge [m] */
export const KERB_M = 0.12;
/** the width past a road's pavements over which its level fades into the ground [m] */
export const FADE_M = 1.5;
/** the axis's samples' spacing [m] */
const STEP_M = 1;
/** the street cells' level (building-cells.ts CELL_Z): a relief tile at z ≥ 15 lies in one */
export const STREET_CELL_Z = 15;

/** A road to level: its axis [lat, lon], its carriageway's half-width and its pavements' reach from the axis [m], its class, a town's. */
export interface LevelRoad {
  pts: [number, number][];
  r: number;
  R: number;
  cls: RoadClass;
  urban: boolean;
}

/** A building's footprint as its cell holds it: its centre [°], its half-sides [m], its long side's angle from east [rad]. */
export interface FootBox {
  lat: number;
  lon: number;
  hl: number;
  hw: number;
  heading: number;
}
/** A building cell's footprints (building-cells.ts — its records' boxes) */
export function cellFootBoxes(buf: ArrayBuffer): FootBox[] {
  const hd = readHeader(buf);
  if (!hd) return [];
  const o = cellOrigin(hd.x, hd.y, hd.z);
  const out: FootBox[] = [];
  for (let i = 0; i < hd.count; i++) {
    const r = readRecord(buf, i);
    const g = fromCell(o, r.east, r.north);
    out.push({ lat: g.lat, lon: g.lon, hl: r.halfLength, hw: r.halfWidth, heading: r.heading });
  }
  return out;
}

/** A street cell's roads to level: its runs (street-cells.ts roadRuns) — no bridge, no tunnel, a class with a profile —, their axis as
 *  places, their carriageway the run's widest, their pavements its kerbed segments' (the class's otherwise none). */
export function cellLevelRoads(buf: ArrayBuffer): LevelRoad[] {
  const h = readStreetHeader(buf);
  if (!h) return [];
  const o = cellOrigin(h.x, h.y, h.z);
  const out: LevelRoad[] = [];
  for (const run of roadRuns(buf)) {
    if (run.flags & (SegmentFlag.Bridge | SegmentFlag.Tunnel) || !ROAD_PROFILE[run.cls] || run.cls === "rail") continue;
    let r = 0,
      pave = 0;
    for (const i of run.segments) {
      const s = readSegment(buf, i);
      if (s.flags & (SegmentFlag.Bridge | SegmentFlag.Tunnel)) continue;
      r = Math.max(r, Math.max(1, s.width) / 2);
      const sf = readSurface(buf, i);
      if (sf.flags & SurfaceFlag.Kerb) pave = Math.max(pave, sf.pavement > 0 ? sf.pavement : (PAVEMENT_M[run.cls] ?? 0));
    }
    if (r <= 0) continue;
    out.push({
      pts: run.points.map(([e, n]) => {
        const g = fromCell(o, e, n);
        return [g.lat, g.lon];
      }),
      r,
      R: r + pave,
      cls: run.cls,
      urban: !!(run.flags & SegmentFlag.Urban),
    });
  }
  return out;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * A relief tile's heights (z, x, y — Web Mercator; `side` × `side`, rows from the north) levelled under `roads`, in place: each pixel
 * within a road's reach set to its level there — the axis's profile, the banking across the carriageway, a kerb over its pavements —,
 * faded into the ground over FADE_M beyond. A kerbed road's pavements reach, each segment and side, the façades of `boxes` across them
 * (facadeSides: within PAVEMENT_REACH_MAX_M of the carriageway; none — a square, a park — the class's). Where reaches overlap the
 * carriageways first (blended, the more central the heavier), else the nearest pavement. NaN pixels (the source's holes) untouched.
 * Returns how many pixels moved.
 */
export function levelTile(
  h: Float32Array,
  side: number,
  z: number,
  x: number,
  y: number,
  roads: readonly LevelRoad[],
  boxes: readonly FootBox[] = [],
): number {
  if (!roads.length) return 0;
  const n = 2 ** z;
  const D = Math.PI / 180;
  const latOf = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) / D;
  const lon0 = ((x + 0.5) / n) * 360 - 180,
    lat0 = latOf(y + 0.5);
  const kx = 111_320 * Math.cos(lat0 * D),
    ky = 111_132;
  // (the tile's pixels' places in its local metres: x east from its west edge's, y north)
  const west = (x / n) * 360 - 180,
    east = ((x + 1) / n) * 360 - 180;
  const toM = (lat: number, lon: number): [number, number] => [(lon - lon0) * kx, (lat - lat0) * ky];
  const pxE = (i: number) => (west + ((i + 0.5) / side) * (east - west) - lon0) * kx;
  const pxN = (j: number) => (latOf(y + (j + 0.5) / side) - lat0) * ky;
  const colE = Float64Array.from({ length: side }, (_, i) => pxE(i));
  const rowN = Float64Array.from({ length: side }, (_, j) => pxN(j));
  const half = Math.max(Math.abs(colE[side - 1]! - colE[0]!), Math.abs(rowN[0]! - rowN[side - 1]!)) / 2 + 1;
  // (the ground at a place of the tile [m east, m north]: bilinear over its pixels — NaN off it or in a hole)
  const sample = (e: number, nn: number) => {
    const fi = ((e / kx + lon0 - west) / (east - west)) * side - 0.5;
    // (rows: the Mercator's — the place's row by its latitude)
    const lat = nn / ky + lat0;
    const yt = (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2)) / (2 * Math.PI)) * n;
    const fj = (yt - y) * side - 0.5;
    if (fi < 0 || fj < 0 || fi > side - 1 || fj > side - 1) return Number.NaN;
    const i0 = Math.floor(fi),
      j0 = Math.floor(fj),
      i1 = Math.min(i0 + 1, side - 1),
      j1 = Math.min(j0 + 1, side - 1),
      a = fi - i0,
      b = fj - j0;
    return (1 - b) * ((1 - a) * h[j0 * side + i0]! + a * h[j0 * side + i1]!) + b * ((1 - a) * h[j1 * side + i0]! + a * h[j1 * side + i1]!);
  };
  // (the footprints about the tile as polygons of its metres — pavement-reach.ts's primitives: 4 edges from data[12] —, in a 32 m grid)
  const GRID = 32;
  const grid = new Map<string, Primitive[]>();
  const far = half + PAVEMENT_REACH_MAX_M + 40;
  for (const b of boxes) {
    const [ce, cn] = toM(b.lat, b.lon);
    if (Math.abs(ce) > far + b.hl || Math.abs(cn) > far + b.hl) continue;
    const c = Math.cos(b.heading),
      sn = Math.sin(b.heading);
    const ux = c * b.hl,
      uy = sn * b.hl,
      vx = -sn * b.hw,
      vy = c * b.hw;
    const k: [number, number][] = [
      [ce + ux + vx, cn + uy + vy],
      [ce - ux + vx, cn - uy + vy],
      [ce - ux - vx, cn - uy - vy],
      [ce + ux - vx, cn + uy - vy],
    ];
    const data = [0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 4; i++) data.push(k[i]![0], k[i]![1], k[(i + 1) % 4]![0], k[(i + 1) % 4]![1]);
    const xs = k.map((q) => q[0]),
      ys = k.map((q) => q[1]);
    const poly: Primitive = { min: [Math.min(...xs), Math.min(...ys), 0], max: [Math.max(...xs), Math.max(...ys), 0], data };
    for (let gy = Math.floor(poly.min[1] / GRID); gy <= Math.floor(poly.max[1] / GRID); gy++)
      for (let gx = Math.floor(poly.min[0] / GRID); gx <= Math.floor(poly.max[0] / GRID); gx++) {
        const key = `${gx}/${gy}`;
        let l = grid.get(key);
        if (!l) {
          l = [];
          grid.set(key, l);
        }
        l.push(poly);
      }
  }
  const near = (x0: number, y0: number, x1: number, y1: number) => {
    const out = new Set<Primitive>();
    for (let gy = Math.floor(y0 / GRID); gy <= Math.floor(y1 / GRID); gy++)
      for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) for (const v of grid.get(`${gx}/${gy}`) ?? []) out.add(v);
    return [...out];
  };
  // (each road's level: its axis in metres, its samples' abscissae, profile and banking — from the ground as it was —, its segments'
  // pavements' reach each side)
  type Lv = {
    p: [number, number][];
    cum: number[];
    s: number[];
    prof: number[];
    bank: number[];
    road: LevelRoad;
    left: number[];
    right: number[];
    box: number[];
  };
  const levels: Lv[] = [];
  for (const road of roads) {
    const p = road.pts.map(([la, lo]) => toM(la, lo));
    let minE = Infinity,
      maxE = -Infinity,
      minN = Infinity,
      maxN = -Infinity;
    for (const [e, nn] of p) {
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
      minN = Math.min(minN, nn);
      maxN = Math.max(maxN, nn);
    }
    const kerbed = road.R > road.r + 0.01;
    const reach = (kerbed ? Math.max(road.R, road.r + PAVEMENT_REACH_MAX_M) : road.R) + FADE_M;
    if (maxE < -half - reach || minE > half + reach || maxN < -half - reach || minN > half + reach) continue;
    const cum = [0];
    for (let k = 1; k < p.length; k++) cum.push(cum[k - 1]! + Math.hypot(p[k]![0] - p[k - 1]![0], p[k]![1] - p[k - 1]![1]));
    const total = cum[cum.length - 1]!;
    if (total < 1) continue;
    const s: number[] = [],
      hs: number[] = [];
    for (let d = 0; d <= total; d += STEP_M) {
      const [e, nn] = along(p, cum, d);
      const v = sample(e, nn);
      if (Number.isFinite(v)) {
        s.push(d);
        hs.push(v);
      }
    }
    if (s.length < 2) continue;
    const prof = roadProfile(s, hs, road.cls).heights;
    // (the banking at the axis's vertices — none in a town —, along it by their abscissae)
    const bankV = roadBank(p, road.cls, road.urban);
    const bank = s.map((d) => {
      let k = 1;
      while (k < cum.length - 1 && cum[k]! < d) k++;
      const f = (d - cum[k - 1]!) / Math.max(cum[k]! - cum[k - 1]!, 1e-6);
      return bankV[k - 1]! + (bankV[k]! - bankV[k - 1]!) * Math.min(1, Math.max(0, f));
    });
    // (the façades each side, segment by segment — a kerbed road's)
    const left: number[] = [],
      right: number[] = [];
    for (let k = 1; k < p.length; k++) {
      const w = kerbed && grid.size ? facadeSides(p[k - 1]!, p[k]!, road.r, road.R, near) : null;
      left.push(w ? w.left : road.R);
      right.push(w ? w.right : road.R);
    }
    levels.push({ p, cum, s, prof, bank, road, left, right, box: [minE - reach, minN - reach, maxE + reach, maxN + reach] });
  }
  if (!levels.length) return 0;
  let moved = 0;
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      const h0 = h[k]!;
      if (!Number.isFinite(h0)) continue;
      const e = colE[i]!,
        nn = rowN[j]!;
      // (every road reaching it: its carriageway's level there — the edge's beyond it — blended by an influence whole on its
      // carriageway and falling smoothly to none across its pavements and fade: where two roads meet, one surface warped between
      // their levels, no step; its kerb blended alike, none on a carriageway; how much of the survey replaced: whole on a
      // carriageway, else its pavements' cover — whole to the façade, fading past it)
      let iW = 0,
        iT = 0,
        iK = 0,
        cover = 0,
        onRoad = false;
      for (const L of levels) {
        if (e < L.box[0]! || nn < L.box[1]! || e > L.box[2]! || nn > L.box[3]!) continue;
        const q = nearestOn(L.p, L.cum, e, nn);
        const ad = Math.abs(q.d);
        const r = L.road.r;
        const Rs = q.d >= 0 ? L.left[q.k]! : L.right[q.k]!;
        const reach = Rs + FADE_M;
        if (ad > reach) continue;
        // (the profile and the banking at its abscissa — the nearest sample's, linear between)
        const at = interp(L.s, L.prof, q.s);
        const bk = interp(L.s, L.bank, q.s);
        const inf = 1 - smooth(r, reach, ad);
        if (inf <= 0) continue;
        iW += inf;
        iT += inf * (at + bk * Math.max(-r, Math.min(r, q.d)));
        if (Rs > r + 0.01) iK += inf * KERB_M;
        if (ad <= r) onRoad = true;
        cover = Math.max(cover, 1 - smooth(Rs, reach, ad));
      }
      if (iW <= 0) continue;
      const w = onRoad ? 1 : cover;
      if (w <= 0) continue;
      const t = (iT + (onRoad ? 0 : iK)) / iW;
      const v = h0 + (t - h0) * w;
      if (Math.abs(v - h0) > 1e-4) {
        h[k] = v;
        moved++;
      }
    }
  return moved;
}

/** levelTile keeping each pixel's last bit (earth-tiles.ts markFine: the survey's mark, its own) — the decode worker's */
export function levelTileMarked(
  h: Float32Array,
  side: number,
  z: number,
  x: number,
  y: number,
  roads: readonly LevelRoad[],
  boxes: readonly FootBox[] = [],
): number {
  const u = new Uint32Array(h.buffer, h.byteOffset, h.length);
  const marks = new Uint8Array(u.length);
  for (let i = 0; i < u.length; i++) marks[i] = u[i]! & 1;
  const moved = levelTile(h, side, z, x, y, roads, boxes);
  if (moved) for (let i = 0; i < u.length; i++) u[i] = (u[i]! & ~1) | marks[i]!;
  return moved;
}

/** a polyline's point at an abscissa [m] */
function along(p: [number, number][], cum: number[], d: number): [number, number] {
  let k = 1;
  while (k < p.length - 1 && cum[k]! < d) k++;
  const f = Math.min(1, Math.max(0, (d - cum[k - 1]!) / Math.max(cum[k]! - cum[k - 1]!, 1e-9)));
  return [p[k - 1]![0] + (p[k]![0] - p[k - 1]![0]) * f, p[k - 1]![1] + (p[k]![1] - p[k - 1]![1]) * f];
}
/** a place's nearest point on a polyline: its signed distance (left of the way positive), abscissa [m] and segment (0: p[0] → p[1]) */
function nearestOn(p: [number, number][], cum: number[], e: number, n: number): { d: number; s: number; k: number } {
  let best = Infinity,
    d = 0,
    s = 0,
    seg = 0;
  for (let k = 1; k < p.length; k++) {
    const ax = p[k - 1]![0],
      ay = p[k - 1]![1],
      lx = p[k]![0] - ax,
      ly = p[k]![1] - ay;
    const L2 = lx * lx + ly * ly;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((e - ax) * lx + (n - ay) * ly) / L2)) : 0;
    const qx = ax + lx * t,
      qy = ay + ly * t;
    const dist = Math.hypot(e - qx, n - qy);
    if (dist < best) {
      best = dist;
      const side = lx * (n - ay) - ly * (e - ax);
      d = side >= 0 ? dist : -dist;
      s = cum[k - 1]! + Math.sqrt(L2) * t;
      seg = k - 1;
    }
  }
  return { d, s, k: seg };
}
/** linear interpolation of ys over xs (ascending) at x, clamped */
function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]!) return ys[0]!;
  const last = xs.length - 1;
  if (x >= xs[last]!) return ys[last]!;
  let lo = 0,
    hi = last;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m]! <= x) lo = m;
    else hi = m;
  }
  const f = (x - xs[lo]!) / Math.max(xs[hi]! - xs[lo]!, 1e-9);
  return ys[lo]! + (ys[hi]! - ys[lo]!) * f;
}
