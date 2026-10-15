// The gun's sight (docs/PLAN-AVIATION-AAA.md, C3): where to shoot for the rounds to meet the target where it will
// be — its velocity AND its acceleration (its turn) carried over the rounds' time of flight, their drag and their
// fall flown as the fight flies them (game/combat.ts's rounds) —, the range and whether it is within the gun's
// reach; the funnel (the stream of the rounds fired along the gun's line over the last second and a half, where
// they are now: a target its wingspan wide between its edges is at their range); the tracers. In the fight's
// frame (east, north, up [m], flat). Pure.

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const G = 9.80665;

export const SIGHT = {
  /** the muzzle's speed [m/s], the rounds' drag [1/m] (dv/dt = −k |v| v), the gun's muzzle ahead of the craft [m] */
  muzzle: 1040,
  drag: 2.5e-4,
  ahead: 8,
  /** the gun's reach: its effective range [m], its least [m]; the longest time of flight shown [s] */
  reach: 1200,
  least: 150,
  tofMax: 2.2,
  /** the target's acceleration taken at most [m/s²] (9 g) */
  aMax: 90,
  /** the funnel: the rounds fired this far back [s], every [s] */
  funnelSpan: 1.5,
  funnelStep: 0.1,
} as const;

/** A frame of a round's flight [s]: its fall, its drag (game/combat.ts flies its rounds by this). */
export function roundStep(r: { p: V3; v: V3 }, dt: number) {
  r.v = add(r.v, [0, 0, -G * dt]);
  r.v = mul(r.v, 1 - SIGHT.drag * len(r.v) * dt);
  r.p = add(r.p, mul(r.v, dt));
}

/** A round fired from `p` (the craft's place; the muzzle `ahead` of it along `dir`) at the craft's velocity `v`
 *  plus the muzzle's along `dir`: where it is after `t` [s], its velocity then. */
export function roundAt(p: V3, v: V3, dir: V3, t: number): { p: V3; v: V3 } {
  const r = { p: add(p, mul(dir, SIGHT.ahead)), v: add(v, mul(dir, SIGHT.muzzle)) };
  const n = Math.max(1, Math.ceil(t * 60));
  const h = t / n;
  for (let i = 0; i < n; i++) roundStep(r, h);
  return r;
}

export interface GunSolution {
  /** the direction to fire along (the gun's line on it: a hit), the rounds' time of flight [s] */
  dir: V3;
  tof: number;
  /** where the target will be then (the fight's frame), its range [m] now */
  future: V3;
  range: number;
  /** within the gun's reach (its time of flight and range) */
  inRange: boolean;
}

/**
 * Where to fire from the craft (`p`, `v`) at a target (`p`, `v`, its acceleration `a` — none: straight on) for the
 * rounds to meet it: the time of flight and the direction solved together — the target's place then, the round
 * flown to it, its miss taken off the aim — a few times over. Null: beyond the longest time of flight.
 */
export function gunSolution(shooter: { p: V3; v: V3 }, target: { p: V3; v: V3; a?: V3 | null }): GunSolution | null {
  const a0 = target.a ?? [0, 0, 0];
  const aL = len(a0);
  const a = aL > SIGHT.aMax ? mul(a0, SIGHT.aMax / aL) : a0;
  const at = (t: number): V3 => add(add(target.p, mul(target.v, t)), mul(a, 0.5 * t * t));
  const range = len(sub(target.p, shooter.p));
  let tof = range / SIGHT.muzzle;
  let dir = unit(sub(target.p, shooter.p));
  for (let k = 0; k < 6; k++) {
    if (tof > SIGHT.tofMax * 1.5) return null;
    const F = at(tof);
    const r = roundAt(shooter.p, shooter.v, dir, tof);
    const e = sub(F, r.p);
    // (the miss: along the round's way — a time of flight longer or shorter —, across — the aim moved by it)
    const w = unit(r.v);
    const along = dot(e, w);
    tof = Math.max(0.01, tof + along / Math.max(len(r.v), 1));
    const across = sub(e, mul(w, along));
    dir = unit(add(dir, mul(across, 1 / Math.max(len(sub(r.p, shooter.p)), 1))));
  }
  if (tof > SIGHT.tofMax) return null;
  const future = at(tof);
  return { dir, tof, future, range, inRange: range <= SIGHT.reach && range >= SIGHT.least };
}

/** The craft's state at a time (the funnel's history): its place, velocity and gun's line (its nose). */
export interface GunState {
  t: number;
  p: V3;
  v: V3;
  fwd: V3;
}

/**
 * The funnel: the rounds that would have been fired along the gun's line over the last `funnelSpan` [s], where
 * they are at `now` — each its place (the fight's frame) and its range from the craft now. From the history,
 * the oldest first.
 */
export function gunFunnel(hist: readonly GunState[], now: number, pNow: V3): { p: V3; range: number }[] {
  const out: { p: V3; range: number }[] = [];
  let next = now - SIGHT.funnelStep;
  for (let i = hist.length - 1; i >= 0 && next >= now - SIGHT.funnelSpan - 1e-9; i--) {
    const h = hist[i]!;
    if (h.t > next + 1e-9) continue;
    const r = roundAt(h.p, h.v, h.fwd, now - h.t);
    out.push({ p: r.p, range: len(sub(r.p, pNow)) });
    next -= SIGHT.funnelStep;
  }
  return out.reverse();
}

/** The target's acceleration from its velocity's changes [m/s²], eased over `tau` [s]: kept in `m`. */
export function trackAccel(m: { v: V3 | null; a: V3; t: number }, v: V3, t: number, tau = 0.5) {
  if (!m.v) {
    m.v = [...v];
    m.t = t;
    return m.a;
  }
  const dt = t - m.t;
  if (dt < 1 / 30) return m.a;
  const k = Math.min(1, dt / tau);
  m.a = add(m.a, mul(sub(mul(sub(v, m.v), 1 / dt), m.a), k));
  m.v = [...v];
  m.t = t;
  return m.a;
}
