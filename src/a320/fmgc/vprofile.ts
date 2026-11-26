// The A320's managed vertical profile (docs/PLAN-A320-VOL-AAA.md N3 — what an FMS computes from its flight plan): the descent path
// built backwards from the destination on a 3° slope (the idle descent's, ~318 ft a nautical mile), held under each « at or below »
// and over each « at or above » of the plan; the climb ahead predicted from the craft at its climb gradient, levelled under the « at or
// below » it meets, up to the cruise level. From them: the altitude predicted at each point and whether its constraint is met, the
// time there, the top of climb (T/C), the top of descent (T/D — where the path leaves the cruise level), the deceleration point
// (DECEL — where the approach phase begins, before the approach's first fix) and, past the T/D, the craft's deviation from the path
// (VDEV). Pure: the plan, the place along it, the figures in; distances along the plan from the craft [NM], heights [ft over the sea].
//
// Limits (said, not hidden): one slope for the whole descent (no idle-thrust model of the speed and the wind), the times at the
// ground speed now, no speed constraint.

import { gcDist, type Waypoint } from "../../game/flightplan";

const NM = 1852;
const FT = 0.3048;
/** the descent path's slope [ft per NM]: 3° (tan 3° × 6 076 ft) */
export const PATH_FT_NM = Math.tan((3 * Math.PI) / 180) * (NM / FT);
/** the height over the destination the path ends at [ft] (the threshold's crossing height) */
const END_FT = 50;
/** how far before the approach's first fix the DECEL point stands [NM] (the speed brought to green dot by it) */
const DECEL_NM = 5;
/** the speed limit's altitude [ft] (250 kt under it) and the level stretch the path keeps there to slow down [NM] */
const LIMIT_FT = 10000;
const DECEL_10K_NM = 5;
/** a constraint missed when the prediction is off by more than this [ft] */
const MISS_FT = 100;

export interface VPoint {
  /** the plan's index */
  i: number;
  /** its distance along the plan from the craft [NM] */
  along: number;
  /** the altitude predicted there [ft], the time to it [s] */
  alt: number;
  t: number;
  /** its constraint [ft] (at or above, at or below; null: none of that side) and whether the prediction misses it */
  lo: number | null;
  hi: number | null;
  missed: boolean;
}

export interface VProfile {
  pts: VPoint[];
  /** T/C and T/D along the plan from the craft [NM] (null: none ahead — passed, or none in this plan); DECEL's (negative: passed,
   *  the approach's fix still ahead; null: none) */
  tc: number | null;
  td: number | null;
  decel: number | null;
  /** the craft's height over the descent path [ft] (+ above it) — past the T/D only, else null */
  vdev: number | null;
  /** the ground speed the times are reckoned at [kt] */
  gs: number;
  /** the descent path's altitude at a distance along the plan from the craft [ft] */
  pathAt(along: number): number;
}

export interface VProfileIn {
  wps: Waypoint[];
  /** the active waypoint's index, the distance to it [m] */
  active: number;
  distTo: number;
  /** the craft's altitude [ft over the sea], the cruise level [ft], the ground speed [kt], the climb's rate now [ft/min] */
  alt: number;
  crz: number;
  gs: number;
  vs: number;
  /** the craft already descending (the FMGC's descent or approach phase): no climb predicted ahead */
  descending: boolean;
}

/** A waypoint's constraint [ft]: the published one (`cstr`), else a typed altitude (« at »). */
function cstrOf(w: Waypoint): [number | null, number | null] {
  if (w.cstr) return [w.cstr[0] === null ? null : w.cstr[0] / FT, w.cstr[1] === null ? null : w.cstr[1] / FT];
  if (w.alt !== undefined) return [w.alt / FT, w.alt / FT];
  return [null, null];
}

export function vprofile(p: VProfileIn): VProfile | null {
  const W = p.wps;
  if (p.active < 0 || p.active >= W.length || W.length < 2) return null;
  const n = W.length;
  // (the distances along the plan from the craft)
  const along: number[] = new Array(n).fill(0);
  along[p.active] = p.distTo / NM;
  for (let k = p.active + 1; k < n; k++) along[k] = along[k - 1]! + gcDist(W[k - 1]!, W[k]!) / NM;
  const C = W.map(cstrOf);
  // (a constraint is the climb's or the descent's, as the FMS files it: a SID's the climb's, a STAR's and an approach's the descent's,
  // one of the plan's own by its half of the route — a SID's « at or below » never pulls the descent's top back to the departure)
  const total = along[n - 1]!;
  const climbSide = W.map((w, k) => (w.proc ? w.proc.kind === "dep" : along[k]! < total / 2));
  // ---- the descent path, walked backwards from the destination every 0.25 NM: the 3° slope up, each descent constraint applied at its
  // point (« at or below » a ceiling there, « at or above » a floor), never over the cruise level; at FL100 a level stretch of
  // DECEL_10K_NM — where the A320 slows to its 250 kt before going on down (a 3° slope at idle holds ~300 kt: no room to slow)
  const dest = W[n - 1]!;
  const end = dest.field ? dest.field.elev / FT + END_FT : (C[n - 1]![0] ?? C[n - 1]![1] ?? p.alt);
  const xs: number[] = [],
    hs: number[] = [];
  let h = Math.min(end, p.crz);
  let flatLeft = p.crz > LIMIT_FT + 500 ? DECEL_10K_NM : 0;
  // (and a level stretch before the approach's first fix — from DECEL to it: the slowing to green dot, then S, F —, as the FMS plans)
  const app = W.findIndex((w, k) => k >= p.active && w.proc?.kind === "arr" && !w.proc.star);
  let appLeft = 0;
  xs.push(along[n - 1]!);
  hs.push(h);
  for (let k = n - 1; k >= p.active; k--) {
    const x1 = k > p.active ? along[k - 1]! : 0;
    let x = along[k]!;
    while (x > x1 + 1e-9) {
      const step = Math.min(0.25, x - x1);
      x -= step;
      if (appLeft > 0) appLeft -= step;
      else if (flatLeft > 0 && h >= LIMIT_FT - 1e-6) flatLeft -= step;
      else {
        h += step * PATH_FT_NM;
        if (flatLeft > 0 && h > LIMIT_FT) h = LIMIT_FT;
      }
      h = Math.min(h, p.crz);
      xs.push(x);
      hs.push(h);
    }
    if (k > p.active && !climbSide[k - 1]) {
      const [lo, hi] = C[k - 1]!;
      if (hi !== null) h = Math.min(h, hi);
      if (lo !== null) h = Math.max(h, lo);
      h = Math.min(h, p.crz);
      hs[hs.length - 1] = h;
    }
    if (k - 1 === app) appLeft = DECEL_NM;
  }
  xs.reverse();
  hs.reverse();
  const pathAt = (x: number): number => {
    if (x <= xs[0]!) return hs[0]!;
    if (x >= xs[xs.length - 1]!) return hs[hs.length - 1]!;
    let lo = 0,
      hi = xs.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m]! <= x) lo = m;
      else hi = m;
    }
    const f = xs[hi]! > xs[lo]! ? (x - xs[lo]!) / (xs[hi]! - xs[lo]!) : 0;
    return hs[lo]! + (hs[hi]! - hs[lo]!) * f;
  };
  // ---- the T/D: the first place where the path is under the cruise level (sampled every 0.25 NM — the plan's few hundred NM)
  let td: number | null = null;
  for (let j = 0; j < xs.length; j++)
    if (hs[j]! < p.crz - 20) {
      // (between the samples: where the slope crosses the level)
      td =
        j > 0 && hs[j - 1]! > hs[j]! ? xs[j - 1]! + ((xs[j]! - xs[j - 1]!) * (hs[j - 1]! - (p.crz - 20))) / (hs[j - 1]! - hs[j]!) : xs[j]!;
      break;
    }
  // (descending already, the path under the level here: no T/D ahead)
  if (p.descending && hs[0]! < p.crz - 20) td = null;
  // ---- the climb ahead: from the craft at its gradient, levelled under the « at or below » it meets, up to the cruise level
  const climbFpm = p.vs > 500 ? p.vs : 2000;
  const grad = (climbFpm * 60) / Math.max(p.gs, 150);
  const climb: number[] = new Array(n).fill(p.alt);
  let prev = p.alt,
    prevX = 0,
    tc: number | null = null;
  for (let k = p.active; k < n; k++) {
    let a = Math.min(p.crz, prev + (along[k]! - prevX) * grad);
    if (tc === null && a >= p.crz - 1 && prev < p.crz - 1) tc = prevX + (p.crz - prev) / grad;
    const hi = climbSide[k] ? C[k]![1] : null;
    if (hi !== null && a > hi && hi >= p.alt - 100) a = hi;
    climb[k] = a;
    prev = a;
    prevX = along[k]!;
  }
  if (p.descending || p.alt >= p.crz - 50) tc = null;
  // ---- the predictions: the lower of the climb and the path (descending: of the craft's altitude and the path)
  const gsKt = Math.max(p.gs, 150);
  const pts: VPoint[] = [];
  for (let k = p.active; k < n; k++) {
    const alt = Math.round(Math.min(p.descending ? p.alt : climb[k]!, pathAt(along[k]!)));
    const [lo, hi] = C[k]!;
    pts.push({
      i: k,
      along: along[k]!,
      alt,
      t: (along[k]! / gsKt) * 3600,
      lo,
      hi,
      missed: (lo !== null && alt < lo - MISS_FT) || (hi !== null && alt > hi + MISS_FT),
    });
  }
  // ---- DECEL: before the approach's first fix (its points: the arrival's, not the STAR's) — else 15 NM before the destination
  const dAt = app >= 0 ? along[app]! - DECEL_NM : dest.field ? total - 15 : null;
  // (passed but the approach's fix still ahead: negative — the FMGC's « passed »; the ND draws it ahead only)
  const decel = dAt;
  const vdev = td === null && p.descending ? Math.round(p.alt - pathAt(0)) : null;
  return { pts, tc, td, decel, vdev, gs: gsKt, pathAt };
}

/** A place along the plan [°]: `x` NM from the craft (its own place `here`), on the legs ahead. */
export function placeAlong(
  wps: Waypoint[],
  active: number,
  here: { lat: number; lon: number },
  x: number,
): { lat: number; lon: number } | null {
  let a: { lat: number; lon: number } = here;
  let s = 0;
  for (let k = active; k < wps.length; k++) {
    const b = wps[k]!;
    const d = gcDist(a, b) / NM;
    if (s + d >= x && d > 0) {
      const f = (x - s) / d;
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
    s += d;
    a = b;
  }
  return null;
}
