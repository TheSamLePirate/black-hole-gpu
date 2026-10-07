// The powered descent's guidance — the landing autopilot (G), the Lander's after its entry, a descent to a
// site on an airless world (⇧G): from wherever the craft is (an orbit, a hover, an entry's end) to a stop on
// the ground, on its pad when it has one. A field of velocities over the ground, flown by the pilot's
// velocity law (pilot.ts) with the weight held first:
//   - across the ground, towards the pad: a braking curve at a share of the thrust the weight leaves
//     (√(2 a d)), linear near it (d / τ: no overshoot), never faster than the craft already goes or a
//     hover's translation — so from an orbit it coasts, unpowered, until the curve meets its speed; an
//     orbit high over the pad lowered first (half a turn before the braking, as Apollo's descent orbit:
//     the braking starts low, not with a fall of tens of kilometres after it);
//     without a pad ("here") the sideways speed is killed at once, and the place under the craft is
//     held once it is slow;
//   - down: the vertical braking curve (√(v_td² + 2 a h), a share of the net thrust — a stop always in
//     hand) and no faster than the height to the gate over the time to the pad (it comes down as it
//     closes); low and still far from the pad, the height held; the touchdown at v_td;
//   - low and slow, the thrust vectored (the craft level, its gear under it: the Ranger's and the Lander's
//     legs are under their bellies, their main engines aft) — higher and faster the main engine along the
//     burn, as a rocket brakes.
// SI throughout (metres, seconds); the vectors in the caller's frame, `up` its local vertical.
import { add, cross, dot, len, scale, sub, type Vec3 } from "./math/vec3";

/** The touchdown's sink [m/s], held over the last metres [m] (the gear's springs take it). */
export const V_TD = 0.8;
export const H_TD = 3;
/** the share of the net thrust (over the weight) the vertical braking curve asks for: half kept in hand */
const KV = 0.45;
/** the share of what the weight and the vertical braking leave that the braking across the ground asks for */
const KH = 0.8;
/** the time constant of the last hundreds of metres to the pad [s] (d / τ: no overshoot) */
const TAU_H = 4;
/** a hover's translation to a pad at most [m/s] (and below it the craft is "slow": the thrust vectored) */
export const V_TRANS = 25;
/** the gate: the height the descent aims at over the pad, coming down as it closes [m] */
const H_GATE = 40;
/** over the pad: within this the touchdown's descent goes on [m] */
const D_OVER = 12;
/** the descent orbit's low point over the pad's ground [m] (clear of the relief between) */
export const H_PDI = 8000;
/** the descent orbit's burn: within this of half a turn before the braking [rad] */
const DOI_WINDOW = 0.04;

export interface DescentState {
  /** the local vertical (unit) */
  up: Vec3;
  /** the gear's height over the ground [m] */
  h: number;
  /** the velocity over the ground [m/s] */
  v: Vec3;
  /** the weight per mass the engine must hold [m/s²]: gravity less the motion's own centrifugal */
  g: number;
  /** the engine's most [m/s²] */
  aT: number;
  /** from the craft to the pad, across the ground [m] (its horizontal part is used); null: land here */
  pad: Vec3 | null;
  /** the orbit (an orbit's coast to the pad, its descent orbit): the body's μ [m³/s²], the craft from its
   *  centre [m], its velocity in the body's non-turning frame [m/s] */
  orbit?: { mu: number; r: Vec3; vi: Vec3 };
  /** the last command vectored (low and slow): kept so up to 1.4 × the hover's translation — the modes'
   *  edge not crossed back and forth */
  wasVectored?: boolean;
}

export interface DescentCmd {
  /** the velocity wanted over the ground, across it (its vertical part: none — the rate below) */
  vh: Vec3;
  /** the descent rate wanted [m/s, > 0 down] */
  down: number;
  /** far from the pad and fast (an orbit): no thrust yet — the braking curve not yet met */
  coast: boolean;
  /** the descent orbit's burn: the velocity to fly [m/s, over the ground] (its whole: no weight held) — else null */
  doi: Vec3 | null;
  /** low and slow: the thrust vectored, the craft level */
  vectored: boolean;
  /** across the ground to the pad [m] (NaN: none) and the time to it [s]; to the braking's start [s] (coasting) */
  dist: number;
  tGo: number;
  tBrake: number;
  /** the braking curves' accelerations [m/s²]: across the ground, down */
  aH: number;
  aV: number;
  /** the feed-forward that follows the curves as they slow (a velocity law alone lags a time constant
   *  behind a curve — 10 m/s, the touchdown's speed): across the ground [m/s²], and up [m/s²] */
  ffH: Vec3;
  ffUp: number;
}

/** The accelerations the braking curves ask for [m/s²]: down — a share of the net thrust —, across — a share of what is left. */
export function brakingAccels(aT: number, g: number) {
  const net = Math.max(aT - g, 0.05 * aT);
  const aV = KV * net;
  const aH = Math.max(KH * Math.sqrt(Math.max(aT * aT - (g + aV) ** 2, 0)), 0.1 * aT);
  return { aV, aH, net };
}

/** The descent rate the vertical braking curve allows at a height [m/s]: v_td over the last metres. */
export function descentCurve(h: number, aV: number) {
  return Math.sqrt(V_TD * V_TD + 2 * aV * Math.max(h - H_TD, 0));
}

export function descentCommand(s: DescentState): DescentCmd {
  const { up, h, aT, g } = s;
  const { aV, aH } = brakingAccels(aT, g);
  const vv = dot(s.v, up);
  const vhv = add(s.v, scale(up, -vv));
  const vh = len(vhv);
  const vB = descentCurve(h, aV);
  // (with a margin once vectored: at the edge, translating at the hover's 25 m/s, the Lander swung between
  // level and standing on its tail 26 m over the Earth — tilted 20°, its marginal thrust no longer held it)
  const slow = h < 5000 && (vh < V_TRANS || (!!s.wasVectored && vh < 1.4 * V_TRANS));
  if (!s.pad) {
    // here: the sideways speed killed at once — the descent no faster than what reaches the gate as it stops
    const tGo = vh / aH;
    const down = Math.min(vB, Math.max(h - H_GATE, 0) / Math.max(tGo, 1e-3) + (vh < 1 ? V_TD : 0));
    return {
      vh: [0, 0, 0],
      down,
      coast: false,
      doi: null,
      vectored: slow,
      dist: Number.NaN,
      tGo,
      tBrake: 0,
      aH,
      aV,
      ffH: [0, 0, 0],
      ffUp: follow(down, vB, vv, aV),
    };
  }
  const p = add(s.pad, scale(up, -dot(s.pad, up)));
  const u = len(p) > 1e-6 ? scale(p, 1 / len(p)) : ([0, 0, 0] as Vec3);
  const O = s.orbit;
  // (the distance over the ground: the arc to the pad on its sphere — a chord's level part shrinks past a
  // quarter turn, a pad behind would seem near)
  const padR = O ? add(O.r, s.pad) : null;
  const d = O && padR ? len(padR) * angle(O.r, padR) : len(p);
  const vCurve = Math.sqrt(2 * aH * d);
  // (never faster than the craft already goes or a hover's translation — slow, 0.8 of it: clear of the edge)
  const cap = slow ? 0.8 * V_TRANS : Math.max(vh, V_TRANS);
  // (an orbit, clear of the ground: a pad behind comes round again)
  const el = O ? orbitOf(O.mu, O.r, O.vi) : null;
  const orbiting = !!el && !!padR && el.rp > len(padR) + 1000;
  const behind = dot(u, vhv) < 0;
  // (an orbit high over the pad: its descent orbit first — the pad let go by meanwhile. Wanted past twice
  // its aim, H_PDI; once begun, burned on to it within its window. A body's uneven gravity lifts the low
  // point a few km in a turn: judged high at 2 km over the aim, Shackleton's was lowered again every turn —
  // a burn of nothing there, its point no longer the orbit's high one —, and the braking never began)
  const high = orbiting && el!.rp > len(padR!) + 2 * H_PDI;
  const lower = orbiting && el!.rp > len(padR!) + H_PDI + 500;
  // (and, off an orbit, coasting only while the fall at the braking's start will still be within the
  // vertical braking curve: into the air from an entry the craft fell at 400 m/s towards a far pad, the
  // engine never lit — and lit only as the fall met the curve, it coasted again as soon as it was back
  // under it, down to the ground at full speed)
  const tC = Math.max((d - (vh * vh) / (2 * aH)) / Math.max(vh, 1), 0);
  const hC = h + vv * tC - 0.5 * g * tC * tC;
  const fallOk = orbiting || (hC > H_GATE && -vv + g * tC < descentCurve(hC, aV));
  if (vh > V_TRANS && fallOk && (vCurve > 1.02 * vh || (orbiting && behind) || high)) {
    const base = { vh: vhv, down: -vv, vectored: false, dist: d, aH, aV, ffH: [0, 0, 0] as Vec3, ffUp: 0 };
    const sBrake = (vh * vh) / (2 * aH);
    let tBrake = (d - sBrake) / vh;
    // the descent orbit: an orbit high over the pad lowered half a turn before the braking — its low point
    // there, H_PDI over the pad's ground (the burn's point its high one: an impulse there, retrograde)
    if (lower) {
      const n = scale(el!.h, 1 / len(el!.h));
      const ahead = (Math.atan2(dot(n, cross(O!.r, padR!)), dot(O!.r, padR!)) + 2 * Math.PI) % (2 * Math.PI);
      let wait = ahead - sBrake / len(padR!) - Math.PI;
      if (wait < -DOI_WINDOW) wait += 2 * Math.PI;
      const rl = len(O!.r);
      const w = len(el!.h) / (rl * rl);
      if (wait <= DOI_WINDOW) {
        const vr = dot(O!.vi, up);
        const vt = sub(O!.vi, scale(up, vr));
        const vtl = len(vt);
        const want = Math.sqrt(Math.max(O!.mu * (2 / rl - 2 / (rl + len(padR!) + H_PDI)), 0));
        return { ...base, coast: false, doi: sub(s.v, scale(vt, Math.max(vtl - want, 0) / vtl)), tGo: Number.NaN, tBrake: 0 };
      }
      if (high) tBrake = wait / w;
    }
    return { ...base, coast: true, doi: null, tGo: tBrake + vh / aH, tBrake };
  }
  const vw = Math.min(vCurve, d / TAU_H, cap);
  // (to the pad: the cruise there, then its braking)
  const tGo = d / Math.max(vw, 0.3) + vw / (2 * aH);
  const over = d < D_OVER;
  // (down to the gate as the pad nears; over it, the rest down the curve; low and off it, the height held)
  const toGate = Math.max(h - H_GATE, 0) / Math.max(tGo, 1e-3);
  // (and below the gate, off the pad, back up to it gently: across the ground at 26 m, a tilt's lost lift was
  // the ground)
  const down = over ? vB : h < H_GATE && d > 3 * D_OVER ? -Math.min((H_GATE - h) / 4, 2) : Math.min(vB, toGate);
  // (on the braking curve across: its deceleration along it, as the craft goes there)
  const along = dot(vhv, u);
  const ffH = vw === vCurve && along > 0 ? scale(u, -aH * Math.min(along / Math.max(vCurve, 1e-6), 2)) : ([0, 0, 0] as Vec3);
  return {
    vh: scale(u, vw),
    down,
    coast: false,
    doi: null,
    vectored: slow,
    dist: d,
    tGo,
    tBrake: 0,
    aH,
    aV,
    ffH,
    ffUp: follow(down, vB, vv, aV),
  };
}

const angle = (a: Vec3, b: Vec3) => Math.atan2(len(cross(a, b)), dot(a, b));

/** A two-body orbit's angular momentum and its low point's radius (r, v in the body's non-turning frame). */
function orbitOf(mu: number, r: Vec3, v: Vec3) {
  const h = cross(r, v);
  const rl = len(r);
  const ev = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rl));
  const e = len(ev);
  const a = 1 / (2 / rl - dot(v, v) / mu);
  const rp = e < 1 ? a * (1 - e) : dot(h, h) / mu / (1 + e);
  return { h, rp };
}

/** On the vertical braking curve (above its last metres): its deceleration as the craft falls along it. */
function follow(down: number, vB: number, vv: number, aV: number) {
  return down === vB && vB > V_TD && vv < 0 ? aV * Math.min(-vv / vB, 2) : 0;
}
