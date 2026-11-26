// A real aircraft against the game's runways (Sam, 24 Nov 2026: « les avions de ligne cohérents avec les pistes du jeu,
// au sol sur le sol, décollant et se posant sur les pistes, train sorti au décollage et à l'atterrissage, rentré en
// croisière »). The one owner of « this traffic aircraft is on or near runway X, in phase P, its gear so »: from its
// place and motion at the moment drawn (controller/traffic.ts — its reports' path) and the runways as the game draws and
// grades them (game/sites.ts EARTH_RUNWAYS: the sites', the world's near the eye — their level the ground the player's
// gear stands on). Pure: no ground asked here — heights are over its wheels' rest (the ground under it, plus its wheels),
// the caller turns them back into heights over the WGS84 ellipsoid at the place this gives.
//
// - Lined up with a runway (its track within 15°, near its axis — the tolerance widening on the final and the climb-out):
//   drawn on the axis — the ADS-B position a few tens of metres off the game's runway —, fully on the runway and low over
//   it, faded out higher (450 m) and farther off it, never a jump (each weight a smooth function of the place).
// - Descending on its final: its height brought onto the runway's glide — 3°, flared, its wheels down 300 m past the
//   threshold — over the last 5 km (fully the last 1.5), the reported height elsewhere (ADS-B's ±10–50 m, a barometric
//   one's QNH: floating over the runway or sunk into it otherwise). Low and level over the runway (rolled out, its report
//   still « airborne »): on it.
// - The phase: parked, taxi, take-off roll, landing (flare, rollout), approach, climb, cruise, descent; a rotorcraft left
//   alone. The gear: down on the ground, on the approach and descending under 600 m; up climbing past 150 m, and above
//   1 500 m; otherwise as it was. Moved over GEAR.travel seconds (the rig's legs and doors follow: a320/pose.ts).

import type { RunwayFrame } from "../game/sites";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { descent, LANDING, type Way, waysOf } from "./landing";

const D = Math.PI / 180;

export type TrafficPhase = "parked" | "taxi" | "takeoff" | "landing" | "approach" | "climb" | "cruise" | "descent" | "rotor";

/** The rules' thresholds. */
export const RUNWAY_PHASE = {
  /** lined up: its track within `align` of the runway's [°] (fading from `alignIn`); moving at least `gsMin` [m/s] */
  alignIn: 8,
  align: 15,
  gsMin: 3,
  /** near its axis: half its width and `crossIn` [m] on it (fading out to `crossOut` times that), widening by `splayFinal`
   *  per metre before its threshold (≈ 2°) and `splayClimb` past its far end, at most `crossMax` [m] */
  crossIn: 25,
  crossOut: 1.6,
  splayFinal: 0.035,
  splayClimb: 0.05,
  crossMax: 400,
  /** how far before the threshold the final is followed, past the far end the climb-out [m] */
  final: 15_000,
  climbOut: 3_000,
  /** the lateral pull fades out over its wheels' height [m] */
  lowFull: 150,
  lowNone: 450,
  /** the glide: its slope [°], its touchdown past the threshold [m]; fully on it within `glideFull` of its touchdown, none
   *  beyond `glideNone` [m]; reported heights this far off it [m] left as they are (`gateIn` → `gateOut`) */
  slope: 3,
  touch: LANDING.touch,
  glideFull: 1_500,
  glideNone: 5_000,
  gateIn: 80,
  gateOut: 200,
  /** on the runway, rolled out: under `rollLow` [m] (none from `rollHigh`), not climbing faster than `rollClimb` [m/s] */
  rollLow: 15,
  rollHigh: 40,
  rollClimb: 2,
  /** on the ground: rolling on the runway over `rollGs` [m/s]; parked under `parkGs` [m/s] */
  rollGs: 15,
  parkGs: 0.5,
  /** the approach: descending faster than `sink` [m/s] — within the final, under `approachOver` [m]; else under `gearDown` */
  sink: 0.5,
  approachOver: 900,
} as const;

/** The gear's rules [m over its wheels' rest, m/s], its travel's time [s]. */
export const GEAR = { down: 600, up: 150, climb: 1, sink: 1, high: 1_500, initial: 300, travel: 8, positive: 10 } as const;

/** smooth 0 → 1 from e0 to e1 */
const ss = (e0: number, e1: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
};
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * A height over the ground as reported [m] — ADS-B's own errors, a descent carried on past its last report, a path's knots
 * between the air and the ground — drawn never under its wheels' rest: over FLOOR as it is, under it eased onto the ground
 * (C¹: d' = H·e^{(d−H)/H}); `k` the slope dd'/dd, its vertical rate's scale.
 */
export const FLOOR = 8;
export function floorOver(d: number): { d: number; k: number } {
  if (d >= FLOOR) return { d, k: 1 };
  const k = Math.exp(Math.max(-30, (d - FLOOR) / FLOOR));
  return { d: FLOOR * k, k };
}

/** Where an aircraft is drawn and how it moves at the moment drawn, before the runways. */
export interface RunwayIn {
  /** its place [°, WGS84 geodetic] */
  lat: number;
  lon: number;
  /** its wheels' height over the ground there [m] as reported (on the ground: 0) */
  over: number;
  /** on the ground as reported */
  gnd: boolean;
  /** its velocity east, north, up [m/s]; its acceleration along its track [m/s²] */
  ve: number;
  vn: number;
  vu: number;
  acc: number;
  /** a rotorcraft (or a type without a mesh): left alone */
  rotor?: boolean;
  /** its height made up — its landing through the gap in its reports (landing.ts) —: trusted down to the ground, not
   *  eased over it */
  sure?: boolean;
}

/** Its runway: the way, its distance past the threshold and off the axis [m] as reported, how lined up 0…1. */
export interface RunwayMatch {
  way: Way;
  a: number;
  c: number;
  w: number;
}

/** Where it is drawn, its phase, its runway. */
export interface RunwayOut {
  lat: number;
  lon: number;
  /** its wheels' height over the ground [m] drawn, its vertical speed drawn [m/s] */
  over: number;
  vu: number;
  /** on the ground as drawn (reported so, or rolled onto the runway) */
  gnd: boolean;
  phase: TrafficPhase;
  /** the runway it lines up with (null: none) */
  rwy: RunwayMatch | null;
  /** the pulls applied 0…1: onto the axis, onto the glide */
  wLat: number;
  wV: number;
}

/** How far off its axis it may be at `a` [m] past the threshold (on its final, on its climb-out: wider). */
function tolOf(w: Way, a: number): number {
  const R = RUNWAY_PHASE;
  const base = w.halfWidth + R.crossIn;
  const splay = a < 0 ? -a * R.splayFinal : a > w.len ? (a - w.len) * R.splayClimb : 0;
  return Math.min(base + splay, R.crossMax);
}

/** The runway way it lines up with — its track, its place — and how well (null: none). */
export function matchRunway(
  lat: number,
  lon: number,
  trk: number,
  gs: number,
  gnd: boolean,
  runways: readonly RunwayFrame[],
): RunwayMatch | null {
  const R = RUNWAY_PHASE;
  if (!(gs > R.gsMin) || !runways.length) return null;
  const q = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, 0);
  let best: RunwayMatch | null = null;
  for (const F of runways) {
    // (far from it: none — a box about its threshold)
    const reach = F.len + R.final;
    if (Math.abs(q[0] - F.origin[0]) > reach || Math.abs(q[1] - F.origin[1]) > reach || Math.abs(q[2] - F.origin[2]) > reach) continue;
    for (const w of waysOf(F)) {
      const al = angle(trk, w.hdg);
      if (al >= R.align) continue;
      const v = [q[0] - w.o[0], q[1] - w.o[1], q[2] - w.o[2]];
      const a = dot(v, w.d),
        c = dot(v, w.r);
      // (along it: the final and the climb-out in the air; its pavement on the ground — 60 m past its ends)
      const ext = gnd
        ? ss(-120, -60, a) * (1 - ss(w.len + 60, w.len + 120, a))
        : ss(-R.final, -R.final + 1000, a) * (1 - ss(w.len + R.climbOut - 1000, w.len + R.climbOut, a));
      if (ext <= 0) continue;
      const tol = tolOf(w, a);
      const wc = 1 - ss(tol, tol * R.crossOut, Math.abs(c));
      const wt = 1 - ss(R.alignIn, R.align, al);
      const k = wc * wt * ext;
      if (k > 0 && (!best || k > best.w || (k === best.w && Math.abs(c) < Math.abs(best.c)))) best = { way: w, a, c, w: k };
    }
  }
  return best;
}

/** The glide's height [m over the wheels' rest] `x` [m] short of its touchdown (past it: 0), and its slope dh/dx. */
export function glideAt(x: number, gs: number): { h: number; k: number } {
  if (x <= 0) return { h: 0, k: 0 };
  const P = descent(2000, Math.tan(RUNWAY_PHASE.slope * D), LANDING.sinkTd / Math.max(gs, 20));
  const h = P.h(x);
  return { h, k: (h - P.h(Math.max(0, x - 1))) / Math.min(1, x) };
}

/**
 * An aircraft against the runways: drawn on the axis of the one it lines up with, low over it — onto its glide on its
 * final, onto it rolled out —; its phase. `prev`: its phase the frame before (the roll's take-off or landing kept).
 */
export function runwayPlace(s: RunwayIn, runways: readonly RunwayFrame[], prev: TrafficPhase | null = null): RunwayOut {
  const R = RUNWAY_PHASE;
  const gs = Math.hypot(s.ve, s.vn);
  // (the reported height: on the ground 0; made up, trusted to the ground; else never under the wheels' rest — eased)
  const fl = s.gnd ? { d: 0, k: 0 } : s.sure ? { d: Math.max(s.over, 0), k: s.over > 0 ? 1 : 0 } : floorOver(s.over);
  const none: RunwayOut = { lat: s.lat, lon: s.lon, over: fl.d, vu: s.vu * fl.k, gnd: s.gnd, phase: "cruise", rwy: null, wLat: 0, wV: 0 };
  if (s.rotor) return { ...none, phase: "rotor" };
  const trk = Math.atan2(s.ve, s.vn) / D;
  const M = matchRunway(s.lat, s.lon, trk, gs, s.gnd, runways);
  let lat = s.lat,
    lon = s.lon,
    over = fl.d,
    vu = s.vu * fl.k,
    gnd = s.gnd,
    wLat = 0,
    wV = 0;
  if (M) {
    const { way: w, a, c } = M;
    // (onto its axis: on the ground fully, in the air the lower the more)
    wLat = M.w * (s.gnd ? 1 : 1 - ss(R.lowFull, R.lowNone, fl.d));
    if (wLat > 0) {
      const q = geodeticToCart(WGS84_A, WGS84_F, s.lat * D, s.lon * D, 0);
      const k = c * wLat;
      const g = cartToGeodetic(WGS84_A, WGS84_F, [q[0] - w.r[0] * k, q[1] - w.r[1] * k, q[2] - w.r[2] * k]);
      lat = g.lat / D;
      lon = g.lon / D;
    }
    if (!s.gnd) {
      // (onto its glide: descending on its final, near its touchdown, its reported height not far off it; on the runway,
      // low and not climbing: rolled out on it)
      const x = Math.min(R.touch, w.len / 5) - a;
      const G = glideAt(x, gs);
      const gate = 1 - ss(R.gateIn, R.gateOut, Math.abs(fl.d - G.h));
      const onFinal = (1 - ss(R.glideFull, R.glideNone, x)) * ss(0.3, 1.5, -s.vu);
      const rolled =
        ss(-60, 0, a) * (1 - ss(w.len, w.len + 60, a)) * (1 - ss(R.rollLow, R.rollHigh, fl.d)) * (1 - ss(0.5, R.rollClimb, s.vu));
      wV = M.w * gate * Math.max(onFinal, rolled);
      if (wV > 0) {
        over = fl.d + (G.h - fl.d) * wV;
        vu = vu + (-gs * G.k - vu) * wV;
        if (wV > 0.999 && G.h <= 0) {
          over = 0;
          vu = 0;
          gnd = true;
        }
      }
    }
  }
  const phase = phaseOf({ gnd, over, vu, gs, acc: s.acc, rwy: M, onAxis: wLat }, prev);
  return { lat, lon, over, vu, gnd, phase, rwy: M, wLat, wV };
}

/** Its phase from its state drawn (`prev`: the frame before's — the roll's take-off or landing kept). */
export function phaseOf(
  s: { gnd: boolean; over: number; vu: number; gs: number; acc: number; rwy: RunwayMatch | null; onAxis: number },
  prev: TrafficPhase | null,
): TrafficPhase {
  const R = RUNWAY_PHASE;
  const M = s.rwy;
  if (s.gnd) {
    if (s.gs < R.parkGs) return "parked";
    // (rolling fast down a runway: accelerating a take-off, braking a landing's rollout; neither, as it was — after its
    // approach a landing, else a take-off)
    if (M && M.w > 0.5 && s.gs > R.rollGs && M.a > -60 && M.a < M.way.len + 60) {
      if (s.acc > 0.3) return "takeoff";
      if (s.acc < -0.3) return "landing";
      if (prev === "approach" || prev === "landing") return "landing";
      return "takeoff";
    }
    // (slowed down on it after landing: still its landing until it taxis off)
    if (prev === "landing" && M && M.w > 0.5) return "landing";
    return "taxi";
  }
  // (just over its runway, not climbing: flaring, rolled out)
  if (M && M.w > 0.5 && M.a > -60 && M.a < M.way.len && s.over < R.rollHigh && s.vu < R.rollClimb && prev !== "takeoff" && prev !== "climb")
    return "landing";
  // (descending on its final; descending low near the ground, its runway unknown — not drawn —: the approach all the same)
  if (s.vu < -R.sink && ((M && M.w > 0.5 && M.a < M.way.len && s.over < R.approachOver) || s.over < GEAR.down)) return "approach";
  if (s.vu > 1.5) return "climb";
  if (s.vu < -1.5) return "descent";
  // (the climb-out levelling a moment after the take-off: its climb still)
  if (prev === "takeoff" && s.over < GEAR.up) return "climb";
  return "cruise";
}

/** The gear's position wanted (1 down, 0 up) — `prev` the one wanted before (null: none yet). */
export function gearTarget(prev: 0 | 1 | null, phase: TrafficPhase, over: number, vu: number): 0 | 1 {
  if (phase === "parked" || phase === "taxi" || phase === "takeoff" || phase === "landing" || phase === "approach") return 1;
  if (vu < -GEAR.sink && over < GEAR.down) return 1;
  // (a take-off's climb: « positive climb, gear up » — a few seconds after the lift-off, 10 m up; before 26 Nov 2026 at 150 m, the
  // airport view's climb-outs filmed gear down)
  if (phase === "climb" && vu > GEAR.climb && over > GEAR.positive) return 0;
  if (vu > GEAR.climb && over > GEAR.up) return 0;
  if (over > GEAR.high) return 0;
  return prev ?? (over < GEAR.initial ? 1 : 0);
}

/** The gear moved towards its target over `dt` [s] (its whole travel in GEAR.travel). */
export function gearStep(pos: number, target: 0 | 1, dt: number): number {
  const step = Math.max(0, dt) / GEAR.travel;
  return target > pos ? Math.min(target, pos + step) : Math.max(target, pos - step);
}
