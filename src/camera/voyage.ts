// The relativistic voyage (docs/PLAN-CAMERA-AAA.md CAM4): from a start to a goal, both carried by what they move with
// (a planet, a craft, nothing), at a constant proper acceleration to midway and as constant a deceleration after — the
// relativistic rocket —, its speed held under the sphere of influence's bound near any body (k × the height over its
// surface: relativistic in the void, slow by the ground), planned once into a table s → (t, τ) so its playback is exact:
// paused, warped, the world's time advancing by t while the traveller's clock advances by τ.
//
// Units: geometric (c = 1) — lengths and times in M (the home frame's), speeds in c, accelerations in 1/M. The path:
// X(t, u) = A(t) + u (B(t) − A(t)) + b sin(πu) n̂ — the start and the goal carried by their bodies (so a moving goal is
// met where it is when one gets there: the plan iterated on its arrival time), bent clear of any body in between.
// Pure.

import type { Vec3 } from "../physics";
import { C_MPS, G0, M_METRES, M_SECONDS } from "../units";

/** a body the voyage keeps clear of and slows by: its centre and radius [M] at a time */
export interface VoyageBody {
  id: string;
  C: (t: number) => Vec3;
  R: number;
}

export interface VoyageEnds {
  /** the start and the goal [M, home frame] at a time [M] */
  A: (t: number) => Vec3;
  B: (t: number) => Vec3;
  bodies: VoyageBody[];
}

/** what the player chose: the speed reached (peak β), a duration (the traveller's τ or the world's t, seconds), an
 *  acceleration (g), or the voyage's own (by the trip: AUTO_G, capped at AUTO_BETA) */
export type VoyageChoice =
  | { kind: "auto" }
  | { kind: "beta"; beta: number }
  | { kind: "tau"; seconds: number }
  | { kind: "t"; seconds: number }
  | { kind: "accel"; g: number };

export interface VoyageOptions {
  /** the bound by the ground: speed ≤ k × height [1/s] (1: a height a second) */
  k?: number;
  /** the fastest allowed */
  betaMax?: number;
  /** samples of the table */
  n?: number;
}

/** the voyage's own acceleration [g] — by the trip: a few % of c to the Moon, ~0.9 c to Mars, ~0.99 c to Saturn */
export const AUTO_G = 1e5;
/** and its cruise's ceiling */
export const AUTO_BETA = 0.999;

/** g in 1/M (c = 1) */
export const G_PER_M = (G0 * M_METRES) / (C_MPS * C_MPS);

export interface VoyageState {
  /** place [M] and coordinate velocity [c] (home frame), the speed, γ */
  X: Vec3;
  V: Vec3;
  beta: number;
  gamma: number;
  /** the traveller's time since the start [M], the world's [M] */
  tau: number;
  t: number;
  /** the share of the way, the speed's phase */
  u: number;
  phase: "accel" | "cruise" | "decel" | "bound" | "done";
  /** the distance left [M] */
  left: number;
}

export interface VoyagePlan {
  t0: number;
  /** the world's duration, the traveller's [M] */
  T: number;
  Tau: number;
  /** the distance [M] (at the arrival), the proper acceleration [1/M], the peak speed reached */
  D: number;
  a: number;
  betaPeak: number;
  /** the bend clear of the bodies [M] (0: straight), its direction */
  bend: number;
  /** the choice could not be met (a duration shorter than the ground's bound allows): the nearest one */
  limited: boolean;
  /** the state at a coordinate time [M] */
  at(t: number): VoyageState;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The rocket's speed after a distance s from rest at proper acceleration a (c = 1): γ = 1 + a s. */
export function rocketBeta(a: number, s: number) {
  const g = 1 + a * Math.max(0, s);
  return Math.sqrt(Math.max(0, 1 - 1 / (g * g)));
}

/** The pure flip (no bound, no cruise) over D at a: the world's time, the traveller's, the peak speed. */
export function flipTimes(D: number, a: number) {
  const gm = 1 + (a * D) / 2;
  return { T: (2 / a) * Math.sqrt(gm * gm - 1), Tau: (2 / a) * Math.acosh(gm), betaPeak: Math.sqrt(1 - 1 / (gm * gm)) };
}

/** The acceleration that peaks at β over D (a pure flip). */
export function accelForBeta(D: number, beta: number) {
  const g = 1 / Math.sqrt(1 - Math.min(beta, 0.999999999) ** 2);
  return (2 * (g - 1)) / D;
}

interface Table {
  s: Float64Array;
  t: Float64Array;
  tau: Float64Array;
  b: Float64Array;
  /** the speed's phase at each sample: 0 accel, 1 cruise, 2 decel, 3 bound */
  ph: Uint8Array;
  /** the world's and the traveller's times from x0 to x1, exactly (within an interval) */
  span: (x0: number, x1: number) => [number, number];
}

/** The distances sampled: geometric from each end (dense where the ground's bound is), to midway. */
function grid(D: number, h0: number, n: number): Float64Array {
  const half = Math.max(8, n >> 1);
  const e = Math.max(Math.min(h0 * 1e-3, D * 1e-6), D * 1e-12);
  const q: number[] = [0];
  const r = (D / 2 / e) ** (1 / (half - 1));
  for (let i = 0; i < half; i++) q.push(e * r ** i);
  q[q.length - 1] = D / 2;
  const out = new Float64Array(2 * q.length - 1);
  for (let i = 0; i < q.length; i++) {
    out[i] = q[i]!;
    out[out.length - 1 - i] = D - q[i]!;
  }
  return out;
}

/** The table s → (t, τ) for an acceleration, a ceiling and the bound by the ground along the way (vmax(s)). */
function table(D: number, a: number, betaMax: number, vmax: (s: number) => number, s: Float64Array): Table {
  const N = s.length;
  const t = new Float64Array(N),
    tau = new Float64Array(N),
    b = new Float64Array(N),
    ph = new Uint8Array(N);
  const speed = (x: number): [number, number] => {
    const up = rocketBeta(a, x),
      down = rocketBeta(a, D - x);
    let v = Math.min(up, down);
    let p = up <= down ? 0 : 2;
    if (v > betaMax) (v = betaMax), (p = 1);
    const cap = vmax(x);
    if (cap < v) (v = cap), (p = 3);
    return [Math.max(v, 1e-300), p];
  };
  for (let i = 0; i < N; i++) {
    const [v, p] = speed(s[i]!);
    b[i] = s[i] === 0 || s[i] === D ? 0 : v;
    ph[i] = p;
  }
  // each interval in pieces, each integrated exactly by its regime (its midpoint's): the rocket's in γ = 1 + a s
  // (t = √(γ² − 1)/a, τ = arcosh γ / a), the cruise's at βmax, the bound's at k × h linear (a logarithm)
  const piece = (x0: number, x1: number): [number, number] => {
    const xm = 0.5 * (x0 + x1);
    const [v, p] = speed(xm);
    if (p === 0 || p === 2) {
      const d0 = p === 0 ? x0 : D - x1,
        d1 = p === 0 ? x1 : D - x0;
      const g0 = 1 + a * d0,
        g1 = 1 + a * d1;
      return [(Math.sqrt(g1 * g1 - 1) - Math.sqrt(g0 * g0 - 1)) / a, (Math.acosh(g1) - Math.acosh(g0)) / a];
    }
    const dx = x1 - x0;
    let dt = dx / v;
    if (p === 3) {
      const v0 = Math.max(vmax(x0), 1e-300),
        v1 = Math.max(vmax(x1), 1e-300);
      if (Math.abs(v1 - v0) > 1e-9 * v0) dt = (dx * Math.log(v1 / v0)) / (v1 - v0);
    }
    const g = 1 / Math.sqrt(1 - Math.min(v * v, 1 - 1e-15));
    return [dt, dt / g];
  };
  const span = (x0: number, x1: number): [number, number] => {
    let dt = 0,
      dtau = 0;
    for (let j = 0; j < 4; j++) {
      const [a1, b1] = piece(x0 + ((x1 - x0) * j) / 4, x0 + ((x1 - x0) * (j + 1)) / 4);
      dt += a1;
      dtau += b1;
    }
    return [dt, dtau];
  };
  for (let i = 1; i < N; i++) {
    const [dt, dtau] = span(s[i - 1]!, s[i]!);
    t[i] = t[i - 1]! + dt;
    tau[i] = tau[i - 1]! + dtau;
  }
  return { s, t, tau, b, ph, span };
}

/** the index of the last entry ≤ x in a sorted array */
function seek(A: Float64Array, x: number) {
  let lo = 0,
    hi = A.length - 1;
  if (x <= A[0]!) return 0;
  if (x >= A[hi]!) return hi - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (A[m]! <= x) lo = m;
    else hi = m;
  }
  return lo;
}

/** The point at u of the path at time t, the bend's direction and size given. */
function pathAt(e: VoyageEnds, t: number, u: number, n: Vec3, bend: number): Vec3 {
  const A = e.A(t),
    B = e.B(t);
  return addS(addS(A, sub(B, A), u), n, bend * Math.sin(Math.PI * u));
}

/** The bend needed to clear the bodies between A and B (none: 0) and its direction. */
function clearance(e: VoyageEnds, t0: number, t1: number): { n: Vec3; bend: number } {
  const A = e.A(t0),
    B = e.B(t1);
  const d = sub(B, A);
  const D = len(d);
  let best = { n: [0, 0, 1] as Vec3, bend: 0 };
  if (D <= 0) return best;
  const f = unit(d);
  for (const b of e.bodies) {
    // (the body when the path passes it, its nearest point to the line)
    const C0 = b.C(t0);
    const u = Math.min(1, Math.max(0, dot(sub(C0, A), f) / D));
    const C = b.C(t0 + (t1 - t0) * u);
    const w = sub(C, A);
    const along = Math.min(D, Math.max(0, dot(w, f)));
    const P = addS(A, f, along);
    const off = sub(P, C);
    const miss = len(off);
    const need = 1.25 * b.R;
    // (an end inside its clearance — leaving or reaching the body itself — is no crossing)
    const endNear = Math.min(len(sub(A, C)), len(sub(B, C))) < need * 1.02;
    if (miss >= need || endNear || u <= 0 || u >= 1) continue;
    let n = miss > 1e-9 * D ? unit(off) : unit(cross(f, Math.abs(f[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    // (the side away from the body; sin(πu) at that u carries the path out by need − miss)
    n = unit(sub(n, addS([0, 0, 0], f, dot(n, f))));
    const k = Math.sin(Math.PI * Math.min(Math.max(u, 0.05), 0.95));
    const bend = (need - miss) / k + (miss < 0 ? 0 : 0);
    if (bend > best.bend) best = { n, bend };
  }
  return best;
}

/** The height over the nearest body's sphere at a point and time [M] (∞: none). */
function heightAt(e: VoyageEnds, X: Vec3, t: number) {
  let h = Number.POSITIVE_INFINITY;
  for (const b of e.bodies) h = Math.min(h, len(sub(X, b.C(t))) - b.R);
  return h;
}

/** Plans the voyage from time t0 [M]. */
export function planVoyage(e: VoyageEnds, choice: VoyageChoice, t0: number, o: VoyageOptions = {}): VoyagePlan {
  const k = (o.k ?? 1) * M_SECONDS; // [1/M]
  const betaMax = Math.min(o.betaMax ?? (choice.kind === "auto" ? AUTO_BETA : 0.9999), 0.9999);
  const n = o.n ?? 1600;
  let T = 0,
    tab: Table | null = null,
    a = AUTO_G * G_PER_M,
    D = len(sub(e.B(t0), e.A(t0))),
    cl = { n: [0, 0, 1] as Vec3, bend: 0 },
    limited = false;
  const h0 = Math.max(1e-12, Math.min(heightAt(e, e.A(t0), t0), heightAt(e, e.B(t0), t0), D));
  // (the arrival's time, the distance then, the bend, the table: iterated together — the goal met where it will be)
  for (let it = 0; it < 6; it++) {
    const t1 = t0 + T;
    D = Math.max(len(sub(e.B(t1), e.A(t1))), 1e-15);
    cl = clearance(e, t0, t1);
    const s = grid(D, h0, n);
    // (the bound along the way: the height at each sample, the sample's time from the last estimate)
    const tEst = (x: number) => {
      if (!tab) return t0 + (T * x) / D;
      const i = seek(tab.s, x);
      return t0 + tab.t[i]!;
    };
    const hs = new Float64Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const u = s[i]! / D;
      const tt = tEst(s[i]!);
      hs[i] = Math.max(0, heightAt(e, pathAt(e, tt, u, cl.n, cl.bend), tt));
    }
    const vmax = (x: number) => {
      const i = seek(s, x);
      const f = (x - s[i]!) / Math.max(s[i + 1]! - s[i]!, 1e-300);
      return k * (hs[i]! * (1 - f) + hs[i + 1]! * f);
    };
    const build = (acc: number) => table(D, acc, betaMax, vmax, s);
    if (choice.kind === "auto") a = AUTO_G * G_PER_M;
    else if (choice.kind === "accel") a = Math.max(choice.g, 1e-6) * G_PER_M;
    else if (choice.kind === "beta") a = accelForBeta(D, Math.min(choice.beta, betaMax));
    else {
      // (a duration: the acceleration found by bisection on its logarithm — the times fall as it grows)
      const want = (choice.seconds / M_SECONDS) as number;
      const dur = (acc: number) => {
        const tb = build(acc);
        return choice.kind === "tau" ? tb.tau[tb.tau.length - 1]! : tb.t[tb.t.length - 1]!;
      };
      let lo = Math.log(1e-3 * G_PER_M),
        hi = Math.log(1e12 * G_PER_M);
      limited = dur(Math.exp(hi)) > want * 1.0001;
      for (let j = 0; j < 60; j++) {
        const m = 0.5 * (lo + hi);
        if (dur(Math.exp(m)) > want) lo = m;
        else hi = m;
      }
      a = Math.exp(hi);
    }
    tab = build(a);
    const T1 = tab.t[tab.t.length - 1]!;
    if (Math.abs(T1 - T) <= 1e-9 * Math.max(T1, 1e-12) && it > 0) {
      T = T1;
      break;
    }
    T = T1;
  }
  const tb = tab!;
  let betaPeak = 0;
  for (let i = 0; i < tb.b.length; i++) betaPeak = Math.max(betaPeak, tb.b[i]!);
  const Tau = tb.tau[tb.tau.length - 1]!;
  const N = tb.s.length;
  const sAt = (dt: number) => {
    if (dt <= 0) return { s: 0, tau: 0, i: 0 };
    if (dt >= T) return { s: D, tau: Tau, i: N - 2 };
    const i = seek(tb.t, dt);
    // (within the interval, the place whose exact time is dt: bisection — linear, a speed was left at the ends)
    let lo = tb.s[i]!,
      hi = tb.s[i + 1]!;
    for (let j = 0; j < 40 && hi - lo > 1e-15 * D; j++) {
      const m = 0.5 * (lo + hi);
      if (tb.t[i]! + tb.span(tb.s[i]!, m)[0] < dt) lo = m;
      else hi = m;
    }
    const x = 0.5 * (lo + hi);
    return { s: x, tau: tb.tau[i]! + tb.span(tb.s[i]!, x)[1], i };
  };
  const PH = ["accel", "cruise", "decel", "bound"] as const;
  return {
    t0,
    T,
    Tau,
    D,
    a,
    betaPeak,
    bend: cl.bend,
    limited,
    at(t: number): VoyageState {
      const dt = t - t0;
      const p = sAt(dt);
      const u = p.s / D;
      const X = pathAt(e, t, u, cl.n, cl.bend);
      // (the velocity: the path's at that time — the ends' motion and the way's —, by a symmetric difference)
      const h = Math.max(T * 1e-6, 1e-9);
      const pa = sAt(dt - h),
        pb = sAt(dt + h);
      const Xa = pathAt(e, t - h, pa.s / D, cl.n, cl.bend),
        Xb = pathAt(e, t + h, pb.s / D, cl.n, cl.bend);
      const V: Vec3 = [(Xb[0] - Xa[0]) / (2 * h), (Xb[1] - Xa[1]) / (2 * h), (Xb[2] - Xa[2]) / (2 * h)];
      let beta = len(V);
      if (beta >= 0.99999) {
        const k2 = 0.99999 / beta;
        V[0] *= k2;
        V[1] *= k2;
        V[2] *= k2;
        beta = 0.99999;
      }
      const done = dt >= T;
      return {
        X,
        V,
        beta,
        gamma: 1 / Math.sqrt(1 - beta * beta),
        tau: p.tau,
        t: Math.min(Math.max(dt, 0), T),
        u,
        phase: done ? "done" : PH[tb.ph[Math.min(p.i + 1, N - 1)]!]!,
        left: Math.max(0, D - p.s),
      };
    },
  };
}
