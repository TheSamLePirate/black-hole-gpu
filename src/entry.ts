// An entry into a planet's air, predicted and guided: the craft as a point mass with its own
// aerodynamics (aero.ts) at a held angle of attack, its lift banked about its motion — integrated
// (RK4) through the air to the handover (slow enough for the last phase: the glide to the runway, or
// the engines' landing), or to the ground. Then:
//   · the guidance (predictor–corrector, as the Shuttle's and Apollo's descendants fly): the bank's
//     size sets the downrange — more bank, less lift up, a deeper, shorter fall; its side the
//     crossrange, reversed when the place drifts past a deadband narrowing with the speed;
//   · the deorbit: when and how hard to brake from an orbit so that the entry ends over a place —
//     the burn's time scanned over the coming orbits, the pass whose ground track comes nearest the
//     place chosen, the time refined until the downrange closes.
// Any frame centred on the body (our side: the home axes, not turning; Gargantua's worlds: their
// turning frames), given by its gravity (with the frame's own terms) and the air's velocity; SI.

import { aeroForces, airAt, airTop, coldSkin, heatStep, type AeroOut, type Atmosphere, type Thermal, type V3, type VesselAero } from "./aero";
import { G0 } from "./units";
import { add, cross, dot, len, scale } from "./math/vec3";

const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A body and its frame (body-centred, SI). */
export interface EntryEnv {
  /** the surface's radius [m] (a sphere: the relief left to the last phase) */
  R: number;
  atm: Atmosphere | null;
  /** gravity and the frame's own accelerations at (x, v) [m/s²] */
  gravity: (x: V3, v: V3) => V3;
  /** the air's (the ground's) velocity at x [m/s] */
  ground: (x: V3) => V3;
  /** where a place fixed on the ground (its position now [m]) is dt seconds on, in the frame */
  carry: (p: V3, dt: number) => V3;
}

/** The craft: its aerodynamics, mass [kg], the angle of attack held [rad]. */
export interface EntryCraft {
  aero: VesselAero;
  mass: number;
  alpha: number;
}

export interface EntryState {
  x: V3;
  v: V3;
}

/** The attitude for an angle of attack and a bank about the motion through the air: the ship's axes
 *  (x left, y up, z the nose) in the frame. Bank > 0: the lift to the right. */
export function attitudeFor(x: V3, va: V3, alpha: number, bank: number): [V3, V3, V3] {
  const vh = unit(va);
  const up = unit(x);
  let n0 = add(up, vh, -dot(up, vh));
  if (len(n0) < 1e-9) n0 = add([0, 0, 1], vh, -vh[2]);
  n0 = unit(n0);
  const right = cross(vh, n0);
  const l = add([n0[0] * Math.cos(bank), n0[1] * Math.cos(bank), n0[2] * Math.cos(bank)], right, Math.sin(bank));
  const z = unit(add([vh[0] * Math.cos(alpha), vh[1] * Math.cos(alpha), vh[2] * Math.cos(alpha)], l, Math.sin(alpha)));
  const y = unit(add([l[0] * Math.cos(alpha), l[1] * Math.cos(alpha), l[2] * Math.cos(alpha)], vh, -Math.sin(alpha)));
  return [cross(y, z), y, z];
}

/** The air's acceleration on the craft at a state, bank given [m/s²], with its figures. */
function airAccel(env: EntryEnv, c: EntryCraft, x: V3, v: V3, bank: number): { a: V3; out: AeroOut | null; h: number } {
  const h = len(x) - env.R;
  const air = airAt(env.atm, h);
  if (air.rho <= 0) return { a: [0, 0, 0], out: null, h };
  const va = add(v, env.ground(x), -1);
  if (len(va) < 1) return { a: [0, 0, 0], out: null, h };
  const ax = attitudeFor(x, va, c.alpha, bank);
  const out = aeroForces(c.aero, [dot(va, ax[0]), dot(va, ax[1]), dot(va, ax[2])], air);
  const k = 1 / c.mass;
  return { a: [(out.F[0] * ax[0][0] + out.F[1] * ax[1][0] + out.F[2] * ax[2][0]) * k, (out.F[0] * ax[0][1] + out.F[1] * ax[1][1] + out.F[2] * ax[2][1]) * k, (out.F[0] * ax[0][2] + out.F[1] * ax[1][2] + out.F[2] * ax[2][2]) * k], out, h };
}

export interface EntryResult {
  /** where it ends (handover, or the ground), the time it takes [s], its speed through the air [m/s], height [m] */
  end: EntryState;
  t: number;
  speed: number;
  h: number;
  /** ended at the handover (else: the ground, or out of the air again — a skip) */
  handover: boolean;
  skip: boolean;
  /** the peaks: heat flux [W/m²], load [g], dynamic pressure [Pa], the shield's and hull's temperatures [K] */
  heatPeak: number;
  gPeak: number;
  qPeak: number;
  shieldPeak: number;
  hullPeak: number;
  /** the path (frame positions, sampled) */
  path: V3[];
}

/**
 * The fall from a state through the air, the bank given by a law of time and state (a constant, the
 * guidance's), the angle of attack held: to the handover speed (Mach, or below a height), to the
 * ground, or back out of the air (a skip). The skin's temperatures integrated too.
 */
export function predictEntry(env: EntryEnv, c: EntryCraft, s0: EntryState, bank: (t: number, x: V3, v: V3) => number,
  o: { handoverMach?: number; handoverH?: number; tMax?: number; skin?: Thermal; sample?: number } = {}): EntryResult {
  let { x, v } = s0;
  let t = 0;
  const tMax = o.tMax ?? 4000;
  const top = env.atm ? Math.max(len(x) - env.R, 0) + 1 : 0;
  let skin = o.skin ?? coldSkin();
  const res: EntryResult = { end: s0, t: 0, speed: 0, h: len(x) - env.R, handover: false, skip: false, heatPeak: 0, gPeak: 0, qPeak: 0, shieldPeak: skin.shield, hullPeak: skin.hull, path: [x] };
  let sampled = 0;
  let wasIn = false;
  const acc = (xq: V3, vq: V3, tq: number) => add(env.gravity(xq, vq), airAccel(env, c, xq, vq, bank(tq, xq, vq)).a);
  const airH = airTop(env.atm);
  for (let i = 0; i < 40000 && t < tMax; i++) {
    const sp = len(add(v, env.ground(x), -1));
    const h = len(x) - env.R;
    // (steps: out of the air, 5 s — or to its top; in it, ~1.5 km of the way, finer low and slow)
    const vr = dot(unit(x), v);
    let dt = h > airH ? Math.min(5, vr < 0 ? Math.max((h - airH) / -vr, 0.5) : 5) : Math.min(Math.max(1500 / Math.max(sp, 1), 0.1), 2);
    dt = Math.max(Math.min(dt, (0.1 * h) / Math.max(-vr, 1e-3) + 0.05), 0.02);
    // RK4
    const k1v = acc(x, v, t), k1x = v;
    const x2 = add(x, k1x, dt / 2), v2 = add(v, k1v, dt / 2);
    const k2v = acc(x2, v2, t + dt / 2), k2x = v2;
    const x3 = add(x, k2x, dt / 2), v3 = add(v, k2v, dt / 2);
    const k3v = acc(x3, v3, t + dt / 2), k3x = v3;
    const x4 = add(x, k3x, dt), v4 = add(v, k3v, dt);
    const k4v = acc(x4, v4, t + dt), k4x = v4;
    x = [0, 1, 2].map((j) => x[j]! + (dt / 6) * (k1x[j]! + 2 * k2x[j]! + 2 * k3x[j]! + k4x[j]!)) as V3;
    v = [0, 1, 2].map((j) => v[j]! + (dt / 6) * (k1v[j]! + 2 * k2v[j]! + 2 * k3v[j]! + k4v[j]!)) as V3;
    t += dt;
    const A = airAccel(env, c, x, v, bank(t, x, v));
    if (A.out) {
      wasIn = true;
      const va = add(v, env.ground(x), -1);
      const ax = attitudeFor(x, va, c.alpha, bank(t, x, v));
      const u = unit([dot(va, ax[0]), dot(va, ax[1]), dot(va, ax[2])]);
      skin = heatStep(c.aero, skin, airAt(env.atm, A.h), A.out, u, dt);
      res.heatPeak = Math.max(res.heatPeak, A.out.heat);
      res.qPeak = Math.max(res.qPeak, A.out.q);
      res.gPeak = Math.max(res.gPeak, len(A.a) / G0);
      res.shieldPeak = Math.max(res.shieldPeak, skin.shield);
      res.hullPeak = Math.max(res.hullPeak, skin.hull);
      if ((o.handoverMach && A.out.mach < o.handoverMach) || (o.handoverH !== undefined && A.h < o.handoverH)) {
        res.handover = true;
        break;
      }
    } else if (wasIn && A.h > top) {
      res.skip = true;
      break;
    }
    if (A.h <= 0) break;
    if (t - sampled > (o.sample ?? 10)) {
      sampled = t;
      res.path.push(x);
    }
  }
  res.path.push(x);
  res.end = { x, v };
  res.t = t;
  res.speed = len(add(v, env.ground(x), -1));
  res.h = len(x) - env.R;
  return res;
}

/** The miss of an end point against a place [m], on the sphere, measured from where the craft is
 *  (`from`: its position and velocity) along its track's plane — the arcs to each forward, 0…2π (an
 *  orbit's coast and an entry: more than half a turn) —: along it (+: the end beyond the place) and
 *  across it (+: the place to the right of the track). */
export function miss(from: EntryState, end: V3, place: V3): { along: number; across: number; dist: number } {
  const R = len(place);
  const u0 = unit(from.x), ue = unit(end), p = unit(place);
  const n = unit(cross(from.x, from.v));
  const fwd = cross(n, u0);
  const arc = (q: V3) => {
    const a = Math.atan2(dot(q, fwd), dot(q, u0));
    return a < -0.05 ? a + 2 * Math.PI : a;
  };
  const right = scale(n, -1);
  // (the end and the place within half a turn of each other: a difference past it is the other way)
  let d = arc(ue) - arc(p);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return {
    along: R * d,
    across: R * Math.asin(Math.min(Math.max(dot(p, right), -1), 1)),
    dist: R * Math.acos(Math.min(Math.max(dot(ue, p), -1), 1)),
  };
}

/**
 * The entry's guidance: the bank that brings the handover over the aim point (a place, an offset
 * short of it along the track). Each update predicts the rest of the fall with the bank's size now and
 * corrects it by the secant of the downrange miss; its side follows the crossrange, reversed past a
 * deadband (≈ 0.7 % of the speed in km: 50 km at 7 km/s, 7 km at 1 km/s).
 */
export class EntryGuidance {
  /** the bank's size [rad] — the deorbit planner's nominal to start with */
  bank = 0.75;
  sign = 1;
  last: EntryResult | null = null;
  lastMiss: { along: number; across: number; dist: number } | null = null;
  prev: { b: number; e: number } | null = null;
  constructor(public o: { handoverMach: number; short: number }) {}

  /** The signed bank [rad] to fly now, from the state and where the place is now (the ground carries
   *  it on while the craft falls). */
  update(env: EntryEnv, c: EntryCraft, s: EntryState, placeNow: V3): number {
    // (above the air the bank does nothing: the nominal kept, no prediction run)
    if (len(s.x) - env.R > airTop(env.atm)) return this.sign * this.bank;
    const r = predictEntry(env, c, s, () => this.sign * this.bank, { handoverMach: this.o.handoverMach, tMax: 8000, sample: 30 });
    this.last = r;
    const place = env.carry(placeNow, r.t);
    const m = miss(s, r.end.x, place);
    this.lastMiss = m;
    // the downrange: the aim `short` before the place
    const e = m.along + this.o.short;
    if (r.skip) this.bank = Math.min(this.bank + 0.2, 1.4);
    else if (this.prev && Math.abs(this.bank - this.prev.b) > 1e-4 && Math.abs(e - this.prev.e) > 1 && (e - this.prev.e) / (this.bank - this.prev.b) < 0) {
      // (the secant — the slope as the physics has it: more bank, less range; else the fixed step below)
      const slope = (e - this.prev.e) / (this.bank - this.prev.b);
      const nb = this.bank - e / slope;
      this.prev = { b: this.bank, e };
      this.bank = Math.min(Math.max(nb, Math.max(this.bank - 0.25, 0)), Math.min(this.bank + 0.25, 1.4));
    } else {
      this.prev = { b: this.bank, e };
      // (beyond the place: more bank; short of it: less)
      this.bank = Math.min(Math.max(this.bank + (e > 0 ? 0.08 : -0.08), 0), 1.4);
    }
    // the side: towards the place, past a deadband narrowing with the speed
    const v = len(add(s.v, env.ground(s.x), -1));
    const band = Math.max(4e3, 7 * v);
    if (m.across * this.sign < -band) this.sign = -this.sign;
    return this.sign * this.bank;
  }
}

/**
 * The deorbit: when and how hard to brake (against the motion over the body) so that the entry ends
 * over a place. The burn sized for a vacuum periapsis `peH` [m] above the surface. One entry flown in
 * full gives the fall's arc and time from a burn; carried along the orbit, it gives every later burn's
 * end at once — the coming `orbits` turns scanned for the downrange's zero crossings, the pass with the
 * least crossrange kept, its time refined with whole entries by the secant.
 */
export function planDeorbit(env: EntryEnv, c: EntryCraft, s0: EntryState, place: V3,
  o: { peH: number; handoverMach: number; short: number; orbits?: number; bank?: number; reach?: number }): { t: number; dv: number; result: EntryResult; miss: { along: number; across: number; dist: number } } | null {
  const mu = len(env.gravity(s0.x, [0, 0, 0])) * dot(s0.x, s0.x);
  const bank = o.bank ?? 0.75;
  const reach = o.reach ?? 600e3;
  // the burn's size: the periapsis at peH (Kepler, a horizontal burn where it is)
  const burned = (s: EntryState): { b: EntryState; dv: number } => {
    const r = len(s.x);
    const rp = env.R + o.peH;
    const up = unit(s.x);
    const vt = len(add(s.v, up, -dot(s.v, up)));
    const vWant = Math.sqrt((2 * mu * rp) / (r * (r + rp)));
    const dv = rp < r ? Math.max(vt - vWant, 0) : 0;
    const dir = unit(add(s.v, env.ground(s.x), -1));
    return { b: { x: s.x, v: add(s.v, dir, -dv) }, dv };
  };
  // the coast (the frame's gravity, RK4), from a state over a time, in steps
  const coast = (s: EntryState, T: number, steps: number): EntryState[] => {
    const out: EntryState[] = [s];
    let { x, v } = s;
    const sub = Math.max(1, Math.ceil(Math.abs(T) / steps / 5));
    const h = T / steps / sub;
    const a = (xq: V3, vq: V3) => env.gravity(xq, vq);
    for (let i = 0; i < steps; i++) {
      for (let k = 0; k < sub; k++) {
        const k1v = a(x, v), k1x = v;
        const k2v = a(add(x, k1x, h / 2), add(v, k1v, h / 2)), k2x = add(v, k1v, h / 2);
        const k3v = a(add(x, k2x, h / 2), add(v, k2v, h / 2)), k3x = add(v, k2v, h / 2);
        const k4v = a(add(x, k3x, h), add(v, k3v, h)), k4x = add(v, k3v, h);
        x = [0, 1, 2].map((j) => x[j]! + (h / 6) * (k1x[j]! + 2 * k2x[j]! + 2 * k3x[j]! + k4x[j]!)) as V3;
        v = [0, 1, 2].map((j) => v[j]! + (h / 6) * (k1v[j]! + 2 * k2v[j]! + 2 * k3v[j]! + k4v[j]!)) as V3;
      }
      out.push({ x, v });
    }
    return out;
  };
  const full = (s: EntryState, tb: number) => {
    const { b, dv } = burned(s);
    const res = predictEntry(env, c, b, () => bank, { handoverMach: o.handoverMach, tMax: 8000, sample: 60 });
    const m = miss(s, res.end.x, env.carry(place, tb + res.t));
    return { dv, res, m, e: m.along + o.short };
  };
  // one entry flown in full: its arc (in the orbit's plane, from the burn) and its time
  const nom = full(s0, 0);
  if (nom.res.skip || nom.dv <= 0) return null;
  // (the arc forward along the orbit's plane, 0…2π: a coast and an entry span more than half a turn)
  const n0 = unit(cross(s0.x, s0.v));
  const u00 = unit(s0.x), f00 = cross(n0, u00), ue0 = unit(nom.res.end.x);
  let arc = Math.atan2(dot(ue0, f00), dot(ue0, u00));
  if (arc < 0) arc += 2 * Math.PI;
  const r0 = len(s0.x);
  const period = 2 * Math.PI * Math.sqrt(r0 ** 3 / mu);
  const T = period * (o.orbits ?? 16);
  const N = Math.ceil(120 * (o.orbits ?? 16));
  const states = coast(s0, T, N);
  // the scan: each burn's end, the nominal arc carried along its own orbit
  const quick = (s: EntryState, tb: number) => {
    const u = unit(s.x);
    const f = unit(add(s.v, u, -dot(s.v, u)));
    const end: V3 = add([u[0] * Math.cos(arc), u[1] * Math.cos(arc), u[2] * Math.cos(arc)], f, Math.sin(arc));
    const m = miss(s, end, env.carry(place, tb + nom.res.t));
    return { m, e: m.along + o.short };
  };
  const cands: { t: number; across: number; lo: { t: number; s: EntryState }; hi: number; slope: number }[] = [];
  let prev: { t: number; e: number; s: EntryState } | null = null;
  for (let i = 0; i <= N; i++) {
    const tb = (i * T) / N;
    const q = quick(states[i]!, tb);
    if (prev && Math.sign(prev.e) !== Math.sign(q.e) && Math.abs(prev.e - q.e) < Math.PI * env.R) cands.push({ t: tb, across: Math.abs(q.m.across), lo: { t: prev.t, s: prev.s }, hi: tb, slope: Math.sign(q.e - prev.e) });
    prev = { t: tb, e: q.e, s: states[i]! };
  }
  // (the first pass the lift can reach — its crossrange within the craft's reach —, else the nearest)
  const rank = (c: { t: number; across: number }) => (c.across < reach ? c.t : 1e15 + c.across);
  cands.sort((a, b) => rank(a) - rank(b));
  // the best two refined with whole entries: Newton's step from the candidate (the slope the quick
  // model gives: the burn later, the end that much farther), then false position within the bracket
  let best: { t: number; dv: number; res: EntryResult; m: { along: number; across: number; dist: number } } | null = null;
  for (const cd of cands.slice(0, 2)) {
    const slope = (() => {
      const a = quick(cd.lo.s, cd.lo.t), sh = coast(cd.lo.s, cd.hi - cd.lo.t, 1)[1]!, b = quick(sh, cd.hi);
      return (b.e - a.e) / Math.max(cd.hi - cd.lo.t, 1e-9);
    })();
    let p0 = { t: cd.lo.t, s: cd.lo.s, ...full(cd.lo.s, cd.lo.t) };
    if (p0.res.skip || !Number.isFinite(slope) || slope === 0) continue;
    let p1 = p0;
    for (let k = 0; k < 4; k++) {
      const tn = Math.max(p1.t - p1.e / slope, 0);
      const sn = coast(cd.lo.s, tn - cd.lo.t, Math.max(1, Math.ceil(Math.abs(tn - cd.lo.t) / 60))).at(-1)!;
      const pn = { t: tn, s: sn, ...full(sn, tn) };
      p0 = p1;
      p1 = pn;
      if (Math.abs(p1.e) < 300 || Math.sign(p1.e) !== Math.sign(p0.e)) break;
    }
    let m = Math.abs(p1.e) < Math.abs(p0.e) ? p1 : p0;
    if (Math.sign(p1.e) !== Math.sign(p0.e) && Math.abs(m.e) > 300) {
      // (false position — Illinois — between them, the coast from the earlier)
      let lo = p0.t < p1.t ? p0 : p1, hi = p0.t < p1.t ? p1 : p0;
      let fl = lo.e, fh = hi.e, side = 0;
      for (let k = 0; k < 10 && Math.abs(m.e) > 300; k++) {
        const tm = Math.min(Math.max(hi.t - (fh * (hi.t - lo.t)) / (fh - fl), lo.t), hi.t);
        const sm = coast(lo.s, tm - lo.t, 1)[1]!;
        m = { t: tm, s: sm, ...full(sm, tm) };
        if (Math.sign(m.e) === Math.sign(fl)) {
          lo = m;
          fl = m.e;
          if (side === -1) fh /= 2;
          side = -1;
        } else {
          hi = m;
          fh = m.e;
          if (side === 1) fl /= 2;
          side = 1;
        }
      }
    }
    if (!m.res.skip && Math.abs(m.e) < 30e3 && (!best || rank({ t: m.t, across: Math.abs(m.m.across) }) < rank({ t: best.t, across: Math.abs(best.m.across) }))) best = { t: m.t, dv: m.dv, res: m.res, m: m.m };
    if (best && Math.abs(best.m.across) < reach) break;
  }
  return best ? { t: best.t, dv: best.dv, result: best.res, miss: best.m } : null;
}

/** The skin as it starts an entry: cold (space's average). */
export const startSkin = (): Thermal => coldSkin();
