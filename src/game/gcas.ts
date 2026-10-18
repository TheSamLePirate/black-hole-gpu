// The F-35's own protections (docs/PLAN-AVIATION-AAA.md, A2), as the real aircraft has them: the Auto-GCAS — the
// automatic ground collision avoidance: the recovery the jet would fly now (the wings rolled level at its roll rate,
// then a 5 g pull until climbing) foreseen over the terrain ahead, taken over the instant it would no longer clear the
// ground by its margin, given back once clear —; and the Auto-ACAS — the air collision avoidance: another aircraft
// whose closest approach falls within 150 m in the next seconds, escaped vertically, away from its side. Pure: the
// state, the terrain along the track and the others in; what to fly out.

const D = Math.PI / 180;
const G0 = 9.80665;

export const GCAS = {
  /** the roll's rate [rad/s] and the system's delay — the load's onset counted — [s]; the pull's load [g]; the fly-up's
   *  flight path (the prediction's climb held under it, by 5°: on the safe side) [rad] */
  rollRate: 180 * D,
  delay: 0.5,
  n: 5,
  climb: 25 * D,
  /** the clearance kept [m]: its floor, and its part of the speed [s] (a fast jet's margin larger) */
  buffer: 45,
  bufferV: 0.12,
  /** the look ahead at most [s] */
  horizon: 25,
  /** given back once this much clearer than its margin [×] and climbing */
  release: 2,
};

export const ACAS = {
  /** the closest approach that is a conflict [m], the time ahead looked at [s], the escape's flight path [rad] */
  miss: 150,
  ahead: 8,
  /** closer than this [m]: a conflict whatever the motion; a closing speed under this [m/s]: none */
  close: 25,
  closing: 2,
  escape: 15 * D,
};

/** The jet's state for the prediction: its height over the sea [m], flight path and bank [rad], speed [m/s]. */
export interface GcasState {
  alt: number;
  gamma: number;
  bank: number;
  V: number;
}

/**
 * The recovery foreseen from now (the delay, the roll to wings level — the load 1 g meanwhile: the path falling as
 * the bank tips the lift away —, then the pull at GCAS.n until climbing): its least clearance over the ground along
 * the track [m] (`ground(x)`: the terrain's height `x` m ahead), and where.
 */
export function gcasRecovery(s: GcasState, ground: (x: number) => number): { clear: number; at: number; t: number } {
  const dt = 0.1;
  let g = s.gamma;
  let h = s.alt;
  let x = 0;
  let clear = Infinity,
    at = 0;
  const bank0 = Math.abs(s.bank);
  const tRoll = GCAS.delay + bank0 / GCAS.rollRate;
  const V = Math.max(s.V, 50);
  for (let t = 0; t < GCAS.horizon; t += dt) {
    const rolling = t < tRoll;
    const bank = rolling ? Math.max(bank0 - Math.max(t - GCAS.delay, 0) * GCAS.rollRate, 0) : 0;
    const n = rolling ? 1 : GCAS.n;
    g += (G0 / V) * (n * Math.cos(bank) - Math.cos(g)) * dt;
    if (!rolling && g > 5 * D) g = Math.min(g, GCAS.climb - 5 * D);
    x += V * Math.cos(g) * dt;
    h += V * Math.sin(g) * dt;
    const c = h - ground(x);
    if (c < clear) (clear = c), (at = x);
  }
  return { clear, at, t: tRoll };
}

/** The margin [m] the recovery must keep at a speed. */
export const gcasMargin = (V: number) => GCAS.buffer + GCAS.bufferV * V;

/** Another aircraft as the ACAS reads it: its place and velocity relative to ours [m, m/s, the local east, north,
 *  up], its name. */
export interface AcasOther {
  id: string;
  r: readonly number[];
  vRel: readonly number[];
  name: string;
}

/** The worst conflict ahead: the other whose closest approach within ACAS.ahead s falls nearest under `missMax` —
 *  its time to it [s], the miss [m], its height over ours there [m]. Null: none. */
export function acasConflict(
  others: AcasOther[],
  missMax = ACAS.miss,
): { id: string; name: string; t: number; miss: number; above: number } | null {
  let best: { id: string; name: string; t: number; miss: number; above: number } | null = null;
  for (const o of others) {
    const v2 = o.vRel[0]! ** 2 + o.vRel[1]! ** 2 + o.vRel[2]! ** 2;
    const now = Math.hypot(o.r[0]!, o.r[1]!, o.r[2]!);
    // (closer than a wingspan's few: a conflict whatever the motion)
    if (now < ACAS.close) {
      if (!best || now < best.miss) best = { id: o.id, name: o.name, t: 0, miss: now, above: o.r[2]! };
      continue;
    }
    // (else only closing on us: two craft side by side at the same speed — a wingman left beside his leader — are no
    // conflict; they had both climbing away for ever)
    const closing = -(o.r[0]! * o.vRel[0]! + o.r[1]! * o.vRel[1]! + o.r[2]! * o.vRel[2]!) / Math.max(now, 1);
    if (v2 < 1 || closing < ACAS.closing) continue;
    const t = -(o.r[0]! * o.vRel[0]! + o.r[1]! * o.vRel[1]! + o.r[2]! * o.vRel[2]!) / v2;
    if (t < 0 || t > ACAS.ahead) continue;
    const c = [o.r[0]! + o.vRel[0]! * t, o.r[1]! + o.vRel[1]! * t, o.r[2]! + o.vRel[2]! * t];
    const miss = Math.hypot(c[0]!, c[1]!, c[2]!);
    if (miss < missMax && (!best || miss < best.miss)) best = { id: o.id, name: o.name, t, miss, above: c[2]! };
  }
  return best;
}
