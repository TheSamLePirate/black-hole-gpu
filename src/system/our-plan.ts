// Flight planning in our universe (Newton, home frame): orbits and transfers between the solar
// system's bodies, as a mission control would draw them — a first guess from two-body mechanics
// (Hohmann, Lambert, the patched conics of an escape hyperbola), then aimed with the n-body
// predictor (our-predict.ts) by Newton's method on the arrival's B-plane (the impact parameter
// that sets the periapsis there) and, for a free return, on the perigee back home. The burns are
// impulses in the P/N/R frame of the reference body (our-predict.ts); the plan carries mid-course
// corrections and the capture, each re-aimed in flight from the ship's real state (refineOurNode).
//
// Units: lengths and times in M, velocities in c, GM in M (G = c = 1).

import type { Vec3 } from "../physics";
import { nodeDvComponents, nodeDvHome, predictOurs, type OurNode, type OurPath } from "./our-predict";
import { referenceBody, soiOf } from "./our-side";
import { M_METRES, M_SECONDS, solarBody, solarState, SOLAR_BODIES } from "./solar";

const C = 299792458;
const MS = 1 / C; // 1 m/s
const KM = 1e3 / M_METRES; // 1 km
const DAY = 86400 / M_SECONDS;

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / (norm(a) || 1));

/** What to do at the target: go round it, pass it, or pass it and fall back home (a free return). */
export type Arrival = "orbit" | "flyby" | "freeReturn";
export type Role = "depart" | "circ" | "mcc" | "capture" | "mccReturn" | "captureHome";

export interface PlanNode extends OurNode {
  role: Role;
  /** the autopilot after this, the plan's last node */
  then?: "circularize";
  /** the body a capture or a circularization is around */
  body?: string;
}

export interface OurGoal {
  /** "orbit": a circular orbit around the reference body; "transfer": to the target */
  kind: "orbit" | "transfer";
  target: string;
  arrival: Arrival;
  /** the periapsis height at the target (the orbit's height) [m] */
  altM: number;
  /** a free return's perigee height back home [m] */
  returnAltM: number;
}

/** What the flight is aiming for — kept to re-aim the burns in flight. */
export interface OurMission {
  goal: OurGoal;
  /** the reference body at the departure */
  home: string;
  /** "direct": the target goes round home; "parent": home goes round the target; "sibling": both
   *  go round the same body; "orbit": around home */
  type: "direct" | "parent" | "sibling" | "orbit";
  /** the chosen side of the target (B-plane direction: T, R components) */
  bDir: [number, number];
  /** the plan's end (arrival, or the free return's perigee), to size the predictions [M] */
  tEnd: number;
  /** the target's periapsis time on the plan [M] */
  tArrive: number;
  /** back home: the sense of the return (+1 as the passed body goes round, −1 the other way) */
  retSign?: number;
  /** a departure across the planets: the way out wanted from home (v∞, home frame axes) [c] */
  vinf?: Vec3;
}

export interface OurPlanOk {
  nodes: PlanNode[];
  mission: OurMission;
  note: string;
  path: OurPath;
}
export type OurPlanResult = OurPlanOk | { error: string };

export interface PlanOptions {
  /** time to the first burn at least (to turn the ship) [M] */
  lead: number;
  /** the engine's acceleration [c²/M]: burns of finite length, as flown (0: impulses) */
  accel?: number;
  /** the wormhole mouth's radius [M] (the predictor stops there) */
  mouthR: number;
}

// ---- bodies (the mouth of the wormhole a massless point at rest at the home frame's origin,
// going round the Sun with Saturn)

interface BodyInfo {
  id: string;
  name: string;
  mass: number;
  radius: number;
  parent: string | null;
}
function info(id: string, mouthR = 0): BodyInfo | null {
  if (id === "wormhole") return { id, name: "the wormhole", mass: 0, radius: mouthR, parent: "sun" };
  const b = solarBody(id);
  return b ? { id, name: b.name, mass: b.mass, radius: b.radius, parent: b.parent } : null;
}
function stateOf(id: string, t: number): { pos: Vec3; vel: Vec3 } {
  if (id === "wormhole") return { pos: [0, 0, 0], vel: [0, 0, 0] };
  return solarState(id, t);
}
function sphereOf(id: string, t: number, mouthR: number) {
  return id === "wormhole" ? 20 * mouthR : soiOf(id, t);
}

// ---- two-body mechanics

/** Osculating orbit of (r, v) around a mass mu: periapsis radius, eccentricity, period (∞ unbound)… */
export function elementsOf(mu: number, r: Vec3, v: Vec3) {
  const R = norm(r);
  const h = cross(r, v);
  const eps = dot(v, v) / 2 - mu / R;
  const evec = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / R));
  const e = norm(evec);
  const hh = dot(h, h);
  const rp = hh / mu / (1 + e);
  const a = eps < 0 ? -mu / (2 * eps) : Infinity;
  return { h, e, evec, rp, a, ra: eps < 0 ? a * (1 + e) : Infinity, period: eps < 0 ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity, eps };
}

const stumpC = (z: number) => (z > 1e-6 ? (1 - Math.cos(Math.sqrt(z))) / z : z < -1e-6 ? (Math.cosh(Math.sqrt(-z)) - 1) / -z : 0.5 - z / 24);
const stumpS = (z: number) => {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120;
};

/**
 * Lambert's problem (universal variables, one revolution): the velocities at r1 and r2 of the
 * orbit around mu from r1 to r2 in tof, going round in the sense of `normal`.
 */
export function lambert(mu: number, r1: Vec3, r2: Vec3, tof: number, normal: Vec3): { v1: Vec3; v2: Vec3 } | null {
  const R1 = norm(r1), R2 = norm(r2);
  const cosd = Math.max(-1, Math.min(1, dot(r1, r2) / (R1 * R2)));
  let dnu = Math.acos(cosd);
  if (dot(cross(r1, r2), normal) < 0) dnu = 2 * Math.PI - dnu;
  const A = Math.sin(dnu) * Math.sqrt((R1 * R2) / (1 - cosd));
  if (!Number.isFinite(A) || Math.abs(A) < 1e-9 * (R1 + R2)) return null;
  const y = (z: number) => R1 + R2 + (A * (z * stumpS(z) - 1)) / Math.sqrt(stumpC(z));
  const time = (z: number) => {
    const yy = y(z);
    if (yy < 0) return -Infinity;
    const x = Math.sqrt(yy / stumpC(z));
    return (x ** 3 * stumpS(z) + A * Math.sqrt(yy)) / Math.sqrt(mu);
  };
  let lo = -400, hi = 4 * Math.PI ** 2 - 1e-7;
  if (time(lo) > tof || !(time(hi) > tof)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (time(mid) < tof) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-13) break;
  }
  const z = (lo + hi) / 2;
  const yy = y(z);
  const f = 1 - yy / R1, g = A * Math.sqrt(yy / mu), gd = 1 - yy / R2;
  return { v1: scale(sub(r2, scale(r1, f)), 1 / g), v2: scale(sub(scale(r2, gd), r1), 1 / g) };
}

/** Kepler's problem (universal variables): (r, v) around mu after dt. */
export function keplerProp(mu: number, r0: Vec3, v0: Vec3, dt: number): { r: Vec3; v: Vec3 } {
  const R0 = norm(r0);
  const vr0 = dot(r0, v0) / R0;
  const alpha = 2 / R0 - dot(v0, v0) / mu;
  const sq = Math.sqrt(mu);
  let x = sq * Math.abs(alpha) * dt;
  if (!(Math.abs(alpha) > 1e-12)) x = sq * dt / R0;
  for (let i = 0; i < 60; i++) {
    const z = alpha * x * x;
    const Cz = stumpC(z), Sz = stumpS(z);
    const F = ((R0 * vr0) / sq) * x * x * Cz + (1 - alpha * R0) * x ** 3 * Sz + R0 * x - sq * dt;
    const dF = ((R0 * vr0) / sq) * x * (1 - z * Sz) + (1 - alpha * R0) * x * x * Cz + R0;
    const d = F / dF;
    x -= d;
    if (Math.abs(d) < 1e-12 * Math.max(1, Math.abs(x))) break;
  }
  const z = alpha * x * x;
  const f = 1 - ((x * x) / R0) * stumpC(z);
  const g = dt - (x ** 3 / sq) * stumpS(z);
  const r = add(scale(r0, f), v0, g);
  const R = norm(r);
  const fd = (sq / (R * R0)) * (alpha * x ** 3 * stumpS(z) - x);
  const gd = 1 - ((x * x) / R) * stumpC(z);
  return { r, v: add(scale(r0, fd), v0, gd) };
}

// ---- along a predicted path

/** The ship's state at time t on a path (cubic Hermite between its points). */
export function stateAt(p: OurPath, t: number): { X: Vec3; V: Vec3 } | null {
  const T = p.times;
  if (!T.length || t < T[0]! - 1e-9 || t > T[T.length - 1]! + 1e-9) return null;
  let lo = 0, hi = T.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (T[m]! <= t) lo = m;
    else hi = m;
  }
  const h = T[hi]! - T[lo]!;
  if (!(h > 0)) return { X: p.pts[lo]!, V: p.vels[lo]! };
  const s = Math.min(Math.max((t - T[lo]!) / h, 0), 1);
  const s2 = s * s, s3 = s2 * s;
  const P0 = p.pts[lo]!, P1 = p.pts[hi]!, V0 = p.vels[lo]!, V1 = p.vels[hi]!;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const d00 = (6 * s2 - 6 * s) / h, d10 = 3 * s2 - 4 * s + 1, d01 = (-6 * s2 + 6 * s) / h, d11 = 3 * s2 - 2 * s;
  const X = [0, 1, 2].map((i) => h00 * P0[i]! + h10 * h * V0[i]! + h01 * P1[i]! + h11 * h * V1[i]!) as Vec3;
  const V = [0, 1, 2].map((i) => d00 * P0[i]! + d10 * V0[i]! + d01 * P1[i]! + d11 * V1[i]!) as Vec3;
  return { X, V };
}

/** The closest approach to a body from index `from` on. */
function closest(p: OurPath, id: string, from = 0) {
  let best = { d: Infinity, i: -1 };
  for (let i = from; i < p.pts.length; i++) {
    const d = norm(sub(p.pts[i]!, stateOf(id, p.times[i]!).pos));
    if (d < best.d) best = { d, i };
  }
  return best;
}

/** The normal of a body's orbit round its primary (the ecliptic's for the Sun). */
function orbitNormal(id: string, t: number): Vec3 {
  const b = info(id);
  if (!b || !b.parent) return [0, 0, 1];
  const s = stateOf(id, t), q = stateOf(b.parent, t);
  return unit(cross(sub(s.pos, q.pos), sub(s.vel, q.vel)));
}

/**
 * The arrival at a body on a path: the B-plane of its hyperbola (the osculating one where the path
 * enters its sphere of influence, or at the closest approach): the impact parameter's components
 * along T (in the body's orbital plane) and R, the speed at infinity, the closest approach.
 */
export function bPlane(p: OurPath, id: string, from = 0, mouthR = 0) {
  const b = info(id, mouthR)!;
  const ca = closest(p, id, from);
  if (ca.i < 0) return null;
  const soi = sphereOf(id, p.times[ca.i]!, mouthR);
  let j = ca.i;
  for (let i = from; i <= ca.i; i++) {
    if (norm(sub(p.pts[i]!, stateOf(id, p.times[i]!).pos)) < soi) {
      j = i;
      break;
    }
  }
  const st = stateOf(id, p.times[j]!);
  const r = sub(p.pts[j]!, st.pos), v = sub(p.vels[j]!, st.vel);
  let S: Vec3, B: Vec3, vinf: number;
  let rpOsc = ca.d;
  const vi2 = dot(v, v) - (2 * b.mass) / norm(r);
  if (b.mass > 0 && vi2 > 0) {
    const el = elementsOf(b.mass, r, v);
    rpOsc = el.rp;
    const hh = unit(el.h), ph = unit(el.evec), qh = cross(hh, ph);
    const s = Math.sqrt(Math.max(1 - 1 / (el.e * el.e), 0));
    S = unit(add(scale(ph, s), qh, el.e - 1 / el.e));
    vinf = Math.sqrt(vi2);
    B = scale(cross(S, hh), norm(el.h) / vinf);
  } else {
    S = unit(v);
    vinf = norm(v);
    B = sub(r, scale(S, dot(r, S)));
  }
  let T = cross(S, orbitNormal(id, p.times[j]!));
  if (norm(T) < 1e-9) T = cross(S, [0, 0, 1]);
  T = unit(T);
  const R = cross(S, T);
  // (the pass's height: as flown, or — into the body, where the path stops — the hyperbola's own
  // periapsis below the ground, which goes on smoothly)
  const impact = p.fate === "impact" && p.hit === id;
  return { bT: dot(B, T), bR: dot(B, R), vinf, ca, entry: j, captured: b.mass > 0 && !(vi2 > 0), rp: impact ? Math.min(rpOsc, ca.d) : ca.d };
}

/** The impact parameter that gives a periapsis radius rp at a body (gravity's focusing). */
const bFor = (mass: number, rp: number, vinf: number) => (mass > 0 ? rp * Math.sqrt(1 + (2 * mass) / (rp * Math.max(vinf * vinf, 1e-30))) : rp);

/**
 * Back home after passing a body (or leaving it): the perigee of the osculating orbit around home
 * where the path leaves the passed body's sphere of influence [radius, M] — below the ground too, to
 * stay smooth — and the index of the real closest approach home after that.
 */
export function returnPerigee(p: OurPath, passed: string, home: string, from = 0) {
  const hb = info(home)!;
  const ca = closest(p, passed, from);
  if (ca.i < 0) return null;
  const soi = soiOf(passed, p.times[ca.i]!);
  let j = -1, j2 = -1;
  for (let i = ca.i; i < p.pts.length; i++) {
    const d = norm(sub(p.pts[i]!, stateOf(passed, p.times[i]!).pos));
    if (j < 0 && d > soi) j = i;
    if (d > 2 * soi) {
      j2 = i;
      break;
    }
  }
  if (j < 0) return null;
  const pe = closest(p, home, j);
  // (signed by the sense the ship goes round home, against the passed body's: a figure-8 free return
  // comes back the other way — the perigee's radius crosses zero smoothly as the fall turns radial)
  const n = orbitNormal(home === info(passed)?.parent ? passed : home, p.times[j]!);
  const hAt = (i: number) => {
    const st = stateOf(home, p.times[i]!);
    return elementsOf(hb.mass, sub(p.pts[i]!, st.pos), sub(p.vels[i]!, st.vel));
  };
  // the perigee as flown (smooth); into home or not reached, the osculating one well clear of the
  // passed body (below the ground too)
  const flown = pe.i > j && pe.i < p.pts.length - 1 && !(p.fate === "impact" && p.hit === home);
  const k = flown ? pe.i : j2 >= 0 ? j2 : j;
  const el = hAt(k);
  const rp = flown ? pe.d : el.rp;
  const sg = dot(el.h, n) >= 0 ? 1 : -1;
  return { rp, rps: sg * rp, exit: j, pe };
}

// ---- Newton's method, aimed with the n-body predictor

/**
 * Solves goals(x) = 0 (m goals, n ≥ m unknowns: the least change), the Jacobian by finite
 * differences; `step` the unknowns' differencing steps, `tol` the goals' tolerances.
 */
function solve(goals: (x: number[]) => number[] | null, x0: number[], step: number[], tol: number[], maxIt = 14) {
  let x = x0.slice();
  let r = goals(x);
  if (!r) return null;
  const cost = (q: number[]) => q.reduce((a, v, i) => a + (v / tol[i]!) ** 2, 0);
  for (let it = 0; it < maxIt; it++) {
    if ((globalThis as { __planDebug?: boolean }).__planDebug) console.log("solve", it, r.map((v, i) => (v / tol[i]!).toFixed(1)).join(" "), x.map((v) => (v * C).toFixed(2)).join(" "));
    if (r.every((v, i) => Math.abs(v) < tol[i]!)) return { x, r, ok: true };
    const m = r.length, n = x.length;
    // J scaled: columns by the steps (dimensionless unknowns), rows by the tolerances
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xp = x.slice();
      xp[j] = xp[j]! + step[j]!;
      const rp = goals(xp);
      if (!rp) return { x, r, ok: false };
      for (let i = 0; i < m; i++) J[i]![j] = (rp[i]! - r[i]!) / tol[i]!;
    }
    // least-norm step: dx = −Jᵀ (J Jᵀ + λI)⁻¹ r
    const rs = r.map((v, i) => v / tol[i]!);
    const JJ = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => J[a]!.reduce((s, _v, k) => s + J[a]![k]! * J[b]![k]!, 0) + (a === b ? 1e-9 : 0)));
    const y = gauss(JJ, rs);
    if (!y) return { x, r, ok: false };
    const dx = Array.from({ length: n }, (_, k) => -J.reduce((s, row, i) => s + row[k]! * y[i]!, 0) * step[k]!);
    // (damped: halve the step until the goals get closer)
    let lam = 1, done = false;
    const c0 = cost(r);
    for (let k = 0; k < 8; k++) {
      const xn = x.map((v, i) => v + lam * dx[i]!);
      const rn = goals(xn);
      if (rn && cost(rn) < c0) {
        x = xn;
        r = rn;
        done = true;
        break;
      }
      lam /= 2;
    }
    if (!done) return { x, r, ok: false };
  }
  return { x, r, ok: r.every((v, i) => Math.abs(v) < tol[i]!) };
}

function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-300) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

// ---- the goals of a mission, measured on a predicted path

/** Tolerances of the aim: a few km at a moon, more across the planets (mid-course corrections follow). */
function aimTol(m: OurMission, inFlight = false) {
  if (m.goal.target === "wormhole") return 1e6 * KM;
  const far = m.type === "sibling" || (m.home === "sun" && m.goal.target !== "moon");
  // (in flight, the corrections close in: 30 km across the planets, 10 km near home)
  return far ? (inFlight ? 30 : 300) * KM : 10 * KM;
}

/** The goals' residuals on a path: B-plane at the target, and/or the perigee back home. */
function residuals(m: OurMission, p: OurPath, from: number, stage: Stage, mouthR: number, cart = false, withTime = false): number[] | null {
  const r = residualsCore(m, p, from, stage, mouthR, cart);
  // (a correction keeps the planned meeting time: without it the least change may slide along the
  // family of paths — the same pass a day later)
  if (!r || !withTime || stage !== "out" || m.type === "parent") return r;
  const bp = bPlane(p, m.goal.target, from, mouthR);
  if (!bp || bp.ca.i < 0) return null;
  return [...r, p.times[bp.ca.i]! - m.tArrive];
}

function residualsCore(m: OurMission, p: OurPath, from: number, stage: Stage, mouthR: number, cart = false): number[] | null {
  const g = m.goal;
  if (stage === "escape") {
    // (leaving home: the hyperbola's way out, where the path leaves home's sphere, against v∞)
    const hb = info(m.home)!;
    let j = -1;
    for (let i = from; i < p.pts.length; i++) {
      if (norm(sub(p.pts[i]!, stateOf(m.home, p.times[i]!).pos)) > soiOf(m.home, p.times[i]!)) {
        j = i;
        break;
      }
    }
    if (j < 0) return null;
    const st = stateOf(m.home, p.times[j]!);
    const r = sub(p.pts[j]!, st.pos), v = sub(p.vels[j]!, st.vel);
    const el = elementsOf(hb.mass, r, v);
    const vi2 = dot(v, v) - (2 * hb.mass) / norm(r);
    if (!(vi2 > 0) || el.e <= 1) return null;
    const hh = unit(el.h), ph = unit(el.evec), qh = cross(hh, ph);
    const S = unit(add(scale(ph, -Math.sqrt(1 - 1 / (el.e * el.e))), qh, el.e - 1 / el.e));
    const w = scale(S, Math.sqrt(vi2));
    return [w[0] - m.vinf![0], w[1] - m.vinf![1], w[2] - m.vinf![2]];
  }
  if (m.type === "parent") {
    const rp = returnPerigee(p, m.home, g.target, from);
    if (!rp) return null;
    m.retSign ??= rp.rps >= 0 ? 1 : -1;
    return [rp.rps - m.retSign * (info(g.target)!.radius + g.altM / M_METRES)];
  }
  if (stage === "back") {
    const rp = returnPerigee(p, g.target, m.home, from);
    if (!rp) return null;
    m.retSign ??= rp.rps >= 0 ? 1 : -1;
    return [rp.rps - m.retSign * (info(m.home)!.radius + g.returnAltM / M_METRES)];
  }
  const tb = info(g.target, mouthR)!;
  const bp = bPlane(p, g.target, from, mouthR);
  if (!bp) return null;
  const bStar = bFor(tb.mass, tb.radius + (tb.mass > 0 ? g.altM / M_METRES : 0), bp.vinf) * (tb.mass > 0 ? 1 : 0);
  // (the pass's height as flown — the closest approach: home's pull inside the target's sphere
  // moves it from the B-plane's two-body value)
  const rpT = tb.radius + (tb.mass > 0 ? g.altM / M_METRES : 0);
  if (g.arrival === "freeReturn") {
    // (a free return: the pass's height and the perigee back home — the pass's side kept by
    // continuity from the first aim, its direction in the B-plane left free)
    const rp = returnPerigee(p, g.target, m.home, from);
    if (!rp) return null;
    m.retSign ??= rp.rps >= 0 ? 1 : -1;
    return [bp.rp - rpT, rp.rps - m.retSign * (info(m.home)!.radius + g.returnAltM / M_METRES)];
  }
  // (a massless target — the mouth: straight at it; far off, the B-plane's point (linear);
  // near, the height as flown, on the chosen side)
  if (!(tb.mass > 0)) return [bp.bT, bp.bR];
  if (cart) return [bp.bT - bStar * m.bDir[0], bp.bR - bStar * m.bDir[1]];
  // (the side: the angle from the chosen direction in the B-plane, as an arc at the pass)
  const ang = Math.atan2(m.bDir[0] * bp.bR - m.bDir[1] * bp.bT, m.bDir[0] * bp.bT + m.bDir[1] * bp.bR);
  return [bp.rp - rpT, ang * bStar];
}

/**
 * Aims a burn at time tn from (X, V, t) — the burn's Δv [P, N, R] the unknowns (3), from dv0 —
 * so that the mission's goals are met. Returns the Δv and the path, or null.
 */
type Stage = "out" | "back" | "escape";

function aim(m: OurMission, X: Vec3, V: Vec3, t: number, tn: number, dv0: Vec3, stage: Stage, o: PlanOptions, moveTime = false, coarse = false, withTime = false, inFlight = false) {
  const tMax = Math.max(m.tEnd - t, 0) * 1.15 + 2 * DAY;
  // (a finer integration than the map's: the aim differentiates the path)
  const run = (dv: Vec3, tb: number) => predictOurs(X, V, t, [{ t: tb, dv }], { tMax, maxSteps: 200000, mouthR: o.mouthR, accel: o.accel, step: coarse ? 0.05 : 0.02 });
  let cart = false;
  const timed = withTime && stage === "out" && m.type !== "parent";
  const goals = (x: number[]) => residuals(m, run([x[0]!, x[1]!, x[2]!], moveTime ? tn + x[3]! : tn), 0, stage, o.mouthR, cart, timed);
  const nGoals = stage === "escape" ? 3 : stage === "back" || m.type === "parent" ? 1 : 2;
  // (leaving a moon for its planet: the perigee is very sensitive to the burn — tens of km of it
  // are the integration's noise; the correction halfway down takes the rest)
  const tol: number[] = new Array(nGoals).fill(stage === "escape" ? 0.3 * MS : m.type === "parent" && stage === "out" && !inFlight ? 60 * KM : aimTol(m, inFlight));
  if (timed) tol.push((m.type === "sibling" ? 3600 : 300) / M_SECONDS);
  // (the burn's time too, for a departure: moving it along the orbit turns the way out — cheaper
  // than a radial Δv; its step, a second, weighs as 0.05 m/s in the least change)
  const x0 = moveTime ? [...dv0, 0] : [...dv0];
  const step = moveTime ? [0.05 * MS, 0.05 * MS, 0.05 * MS, 1 / M_SECONDS] : [0.05 * MS, 0.05 * MS, 0.05 * MS];
  // (a B-plane aim from afar: its point first, then the height as flown)
  let start = x0;
  if (stage === "out" && m.goal.arrival !== "freeReturn" && m.type !== "parent") {
    cart = true;
    const r0 = solve(goals, x0, step, tol.map((x) => 5 * x), 10);
    cart = false;
    if (r0) start = r0.x;
  }
  const res = solve(goals, start, step, coarse ? tol.map((x) => 10 * x) : tol, coarse ? 5 : 10);
  if (!res) return null;
  const dv: Vec3 = [res.x[0]!, res.x[1]!, res.x[2]!];
  const tb = moveTime ? tn + res.x[3]! : tn;
  return { dv, t: tb, ok: res.ok, path: run(dv, tb), r: res.r };
}

// ---- the plans

/** The ship's orbit around the reference body now. */
function parking(X: Vec3, V: Vec3, t: number) {
  const ref = referenceBody(X, t);
  const b = info(ref)!;
  const st = stateOf(ref, t);
  return { ref, b, el: elementsOf(b.mass, sub(X, st.pos), sub(V, st.vel)) };
}

const km = (d: number) => `${Math.round(d / KM).toLocaleString("en-US")} km`;
const kms = (v: number) => (v * C >= 1000 ? `${((v * C) / 1000).toFixed(2)} km/s` : `${(v * C).toFixed(0)} m/s`);
const days = (dt: number) => (dt >= 2 * DAY ? `${(dt / DAY).toFixed(1)} d` : `${(dt / (DAY / 24)).toFixed(1)} h`);

/** A circular orbit at a height around the reference body: two burns (Hohmann), or one. */
export function planOurOrbit(X: Vec3, V: Vec3, t: number, altM: number, o: PlanOptions): OurPlanResult {
  const { ref, b } = parking(X, V, t);
  if (ref === "sun" && !(altM > 0)) return { error: "Orbit: near a body first" };
  const rt = b.radius + altM / M_METRES;
  const t1 = t + o.lead;
  const free = predictOurs(X, V, t, [], { tMax: o.lead * 1.2 + 1e-3, maxSteps: 20000, mouthR: o.mouthR, accel: o.accel });
  const s1 = stateAt(free, t1);
  if (!s1) return { error: "Orbit: no path to plan from" };
  const P = stateOf(ref, t1);
  const r = sub(s1.X, P.pos), v = sub(s1.V, P.vel);
  const R = norm(r);
  let n = cross(r, v);
  if (norm(n) < 1e-30) n = cross(r, [0, 0, 1]);
  const along = unit(cross(unit(n), r)); // horizontal, in the orbit's sense
  const mission: OurMission = { goal: { kind: "orbit", target: ref, arrival: "orbit", altM, returnAltM: 0 }, home: ref, type: "orbit", bDir: [1, 0], tEnd: t1, tArrive: t1 };
  const want = (vmag: number) => nodeDvComponents(s1.X, s1.V, t1, sub(scale(along, vmag), v));
  if (Math.abs(R - rt) < 0.01 * rt) {
    const dv = want(Math.sqrt(b.mass / R));
    const nodes: PlanNode[] = [{ t: t1, dv, role: "circ", body: ref, then: "circularize" }];
    const path = predictOurs(X, V, t, nodes, { mouthR: o.mouthR, accel: o.accel, maxSteps: 4000 });
    return { nodes, mission, path, note: `circular orbit at ${km(R - b.radius)} around ${b.name} · Δv ${kms(norm(dv))}` };
  }
  const a = (R + rt) / 2;
  const dv1 = want(Math.sqrt(b.mass * (2 / R - 1 / a)));
  const t2 = t1 + Math.PI * Math.sqrt(a ** 3 / b.mass);
  const vApo = Math.sqrt(b.mass * (2 / rt - 1 / a));
  const dv2: Vec3 = [Math.sqrt(b.mass / rt) - vApo, 0, 0];
  const nodes: PlanNode[] = [
    { t: t1, dv: dv1, role: "depart" },
    { t: t2, dv: dv2, role: "circ", body: ref, then: "circularize" },
  ];
  mission.tEnd = t2;
  mission.tArrive = t2;
  const path = predictOurs(X, V, t, nodes, { mouthR: o.mouthR, accel: o.accel, maxSteps: 8000, tMax: t2 - t + Math.PI * Math.sqrt(rt ** 3 / b.mass) });
  return {
    nodes, mission, path,
    note: `Hohmann to ${km(rt - b.radius)} around ${b.name} · ${kms(norm(dv1))} then ${kms(Math.abs(dv2[0]))} in ${days(t2 - t1)}`,
  };
}

/** A transfer from the reference body's neighbourhood to a target body (or the wormhole's mouth). */
export function planOurTransfer(X: Vec3, V: Vec3, t: number, goal: OurGoal, o: PlanOptions): OurPlanResult {
  const home = referenceBody(X, t);
  const tb = info(goal.target, o.mouthR);
  const hb = info(home)!;
  if (!tb) return { error: "Transfer: select a target (Tab, or a click on the map)" };
  if (goal.target === home) return planOurOrbit(X, V, t, goal.altM, o);
  if (goal.arrival === "freeReturn" && tb.parent !== home) return { error: `Free return: from an orbit around ${info(tb.parent ?? "sun")?.name ?? "its planet"} (a moon's)` };
  if (tb.parent === home) return planDirect(X, V, t, goal, home, o);
  if (hb.parent === goal.target) return planToParent(X, V, t, goal, home, o);
  if (tb.parent && tb.parent === hb.parent) return planSibling(X, V, t, goal, home, o);
  // (further: through a stop — the target's planet first, or home's planet)
  if (tb.parent && info(tb.parent)?.parent === hb.parent) {
    const r = planSibling(X, V, t, { ...goal, target: tb.parent, arrival: "orbit", altM: Math.max(goal.altM, 0.5 * info(tb.parent)!.radius * M_METRES) }, home, o);
    return "error" in r ? r : { ...r, note: `first to ${info(tb.parent)!.name}: ${r.note} — then plan ${tb.name} from there` };
  }
  if (hb.parent && hb.parent !== "sun") {
    const r = planToParent(X, V, t, { ...goal, target: hb.parent, arrival: "orbit", altM: 400e3 }, home, o);
    return "error" in r ? r : { ...r, note: `first back to ${info(hb.parent)!.name}: ${r.note} — then plan ${tb.name} from there` };
  }
  return { error: `Transfer: no plan from ${hb.name} to ${tb.name}` };
}

/**
 * The target goes round the body the ship is near (the Earth → the Moon; the Sun → a planet):
 * Lambert over the departure times of a turn of the ship's orbit and a range of flight times (the
 * least Δv), then aimed on the target's B-plane — and for a free return on the perigee back home.
 */
function planDirect(X: Vec3, V: Vec3, t: number, goal: OurGoal, home: string, o: PlanOptions): OurPlanResult {
  const hb = info(home)!, tb = info(goal.target, o.mouthR)!;
  const mu = hb.mass;
  const P0 = stateOf(home, t);
  const el = elementsOf(mu, sub(X, P0.pos), sub(V, P0.vel));
  const T0 = stateOf(goal.target, t);
  const rT = norm(sub(T0.pos, P0.pos));
  const r0 = norm(sub(X, P0.pos));
  const Ttgt = 2 * Math.PI * Math.sqrt(rT ** 3 / mu);
  // (a low orbit, the target far out: a tangent burn when the target crosses the orbit's plane)
  if (Number.isFinite(el.period) && el.period < 0.2 * Ttgt) return planFromParking(X, V, t, goal, home, el, o);
  // (else Lambert, over the synodic period)
  const window = Number.isFinite(el.period) ? Math.min(1 / Math.abs(1 / el.period - 1 / Ttgt), 2 * 365.25 * DAY) : Ttgt / 4;
  const free = predictOurs(X, V, t, [], { tMax: o.lead + window * 1.02, maxSteps: 60000, mouthR: o.mouthR, accel: o.accel });
  const tofH = Math.PI * Math.sqrt(((r0 + rT) / 2) ** 3 / mu);
  const tofs = goal.arrival === "freeReturn" ? [0.62, 0.7, 0.78, 0.86, 0.94] : [0.7, 0.8, 0.9, 1, 1.1, 1.25];
  const nT = 72;
  let best: { cost: number; t1: number; tof: number; dv: Vec3; X1: Vec3; V1: Vec3 } | null = null;
  const nrm = unit(el.h);
  for (let i = 0; i < nT; i++) {
    const t1 = t + o.lead + (window * i) / nT;
    const s1 = stateAt(free, t1);
    if (!s1) break;
    const A1 = stateOf(home, t1);
    const r1 = sub(s1.X, A1.pos), v1s = sub(s1.V, A1.vel);
    for (const k of tofs) {
      const tof = k * tofH;
      const A2 = stateOf(home, t1 + tof), B2 = stateOf(goal.target, t1 + tof);
      const L = lambert(mu, r1, sub(B2.pos, A2.pos), tof, nrm);
      if (!L) continue;
      const dvH = sub(L.v1, v1s);
      const vinf = norm(sub(L.v2, sub(B2.vel, A2.vel)));
      const rp = tb.radius + goal.altM / M_METRES;
      const cap = goal.arrival === "orbit" && tb.mass > 0 ? Math.sqrt(vinf * vinf + (2 * tb.mass) / rp) - Math.sqrt(tb.mass / rp) : 0;
      const cost = norm(dvH) + cap;
      if (!best || cost < best.cost) best = { cost, t1, tof, dv: dvH, X1: s1.X, V1: s1.V };
    }
  }
  if (!best) return { error: `Transfer: no path to ${tb.name} found` };
  const mission: OurMission = { goal, home, type: "direct", bDir: [1, 0], tEnd: best.t1 + best.tof * (goal.arrival === "freeReturn" ? 2.4 : 1.1), tArrive: best.t1 + best.tof };
  const dv0 = nodeDvComponents(best.X1, best.V1, best.t1, best.dv);
  return aimAndBuild(X, V, t, mission, best.t1, dv0, o);
}

/** Time from periapsis to radius r on an ellipse (a, e) around mu (the outbound leg). */
function timeToRadius(mu: number, a: number, e: number, r: number) {
  const cE = Math.max(-1, Math.min(1, (1 - r / a) / e));
  const E = Math.acos(cE);
  return (E - e * Math.sin(E)) / Math.sqrt(mu / a ** 3);
}

/**
 * From a low orbit to a moon far out (the Earth's to the Moon): as the Apollo and Artemis flights,
 * one burn along the velocity at the point opposite where the ellipse meets the moon — when the
 * moon crosses the orbit's plane, so that no plane change is paid (the wait: up to half its month).
 * The flight time: 70 % of a Hohmann transfer's for a free return (~3.5 days to the Moon), 85 %
 * else. The ship's orbit is carried to the burn by two-body mechanics; then aimed from there.
 */
function planFromParking(X: Vec3, V: Vec3, t: number, goal: OurGoal, home: string, el: ReturnType<typeof elementsOf>, o: PlanOptions): OurPlanResult {
  const hb = info(home)!;
  const mu = hb.mass;
  const P0 = stateOf(home, t);
  const r0v = sub(X, P0.pos), v0v = sub(V, P0.vel);
  const r0 = norm(r0v);
  const hh = unit(el.h);
  const rT = norm(sub(stateOf(goal.target, t).pos, P0.pos));
  const Ttgt = 2 * Math.PI * Math.sqrt(rT ** 3 / mu);
  const tofH = Math.PI * Math.sqrt(((r0 + rT) / 2) ** 3 / mu);
  const tof = (goal.arrival === "freeReturn" ? 0.7 : 0.85) * tofH;
  const rel = (tt: number) => sub(stateOf(goal.target, tt).pos, stateOf(home, tt).pos);
  // the arrival: the first crossing of the orbit's plane by the target (or now, if it stays in it)
  const tA0 = t + o.lead + el.period + tof;
  const off = (tt: number) => dot(rel(tt), hh) / rT;
  let tArr = tA0;
  const nS = 240;
  let prev = off(tA0);
  if (Math.abs(prev) > 0.01) {
    for (let i = 1; i <= nS; i++) {
      const tt = tA0 + (Ttgt * i) / nS;
      const cur = off(tt);
      if (Math.sign(cur) !== Math.sign(prev)) {
        let lo = tt - Ttgt / nS, hi = tt;
        for (let k = 0; k < 50; k++) {
          const mid = (lo + hi) / 2;
          if (Math.sign(off(mid)) === Math.sign(off(lo))) lo = mid;
          else hi = mid;
        }
        tArr = (lo + hi) / 2;
        break;
      }
      prev = cur;
    }
  }
  // the ellipse from r0 that reaches the target's distance in tof (its apoapsis a little beyond)
  const rArr = norm(rel(tArr));
  let lo = rArr * 1.0001, hi = rArr * 50;
  const tofAt = (ra: number) => timeToRadius(mu, (r0 + ra) / 2, (ra - r0) / (ra + r0), rArr);
  for (let k = 0; k < 80; k++) {
    const mid = Math.sqrt(lo * hi);
    if (tofAt(mid) > tof) lo = mid;
    else hi = mid;
  }
  const ra = Math.sqrt(lo * hi);
  const a = (r0 + ra) / 2, e = (ra - r0) / (ra + r0);
  const nu = Math.acos(Math.max(-1, Math.min(1, ((a * (1 - e * e)) / rArr - 1) / e)));
  // the burn's place: the target's direction at the arrival, in the plane, turned back by ν
  const u = unit(sub(rel(tArr), scale(hh, dot(rel(tArr), hh))));
  const ph = add(scale(u, Math.cos(nu)), cross(hh, u), -Math.sin(nu));
  const tAim = tArr - tofAt(ra);
  let t1 = tAim, bc = -2;
  for (let i = -120; i <= 120; i++) {
    const tt = tAim + (el.period * i) / 240;
    if (tt < t + o.lead) continue;
    const c = dot(unit(keplerProp(mu, r0v, v0v, tt - t).r), ph);
    if (c > bc) (bc = c), (t1 = tt);
  }
  const k1 = keplerProp(mu, r0v, v0v, t1 - t);
  const r1 = norm(k1.r);
  const vp = Math.sqrt(mu * (2 / r1 - 2 / (r1 + ra)));
  const dv0: Vec3 = [vp - norm(k1.v), 0, 0];
  const mission: OurMission = { goal, home, type: "direct", bDir: [1, 0], tEnd: t1 + tof * (goal.arrival === "freeReturn" ? 2.5 : 1.1), tArrive: t1 + tof };
  // (aimed from a quarter turn before the burn — a wait of days in a low orbit is not integrated;
  // the burn may move along the orbit)
  const ts = Math.max(t, t1 - 0.25 * el.period);
  const k0 = ts > t ? keplerProp(mu, r0v, v0v, ts - t) : { r: r0v, v: v0v };
  const As = stateOf(home, ts);
  const plan = aimAndBuild(add(As.pos, k0.r), add(As.vel, k0.v), ts, mission, t1, dv0, o, t);
  if ("error" in plan) return plan;
  if (t1 - t > 0.5 * DAY) plan.note = `${info(goal.target)!.name} in the orbit's plane in ${days(t1 - t)} · ${plan.note}`;
  return plan;
}

/**
 * Home goes round the target (the Moon → the Earth): an escape from the ship's orbit whose way out
 * leaves the ship behind home's motion, so that it falls to the target's perigee; then aimed.
 */
function planToParent(X: Vec3, V: Vec3, t: number, goal: OurGoal, home: string, o: PlanOptions): OurPlanResult {
  const hb = info(home)!, tb = info(goal.target)!;
  const A = stateOf(home, t), B = stateOf(goal.target, t);
  const el = elementsOf(hb.mass, sub(X, A.pos), sub(V, A.vel));
  if (!Number.isFinite(el.period)) return { error: `Transfer: in an orbit around ${hb.name} first` };
  const rA = norm(sub(A.pos, B.pos));
  const vA = sub(A.vel, B.vel);
  const rpT = tb.radius + goal.altM / M_METRES;
  const vApo = Math.sqrt((2 * tb.mass * rpT) / (rA * (rA + rpT)));
  const vinf = Math.max(norm(vA) - vApo, 1e-9);
  const S = unit(scale(vA, -1));
  const r0 = norm(sub(X, A.pos));
  const e = 1 + (r0 * vinf * vinf) / hb.mass;
  const s = Math.sqrt(1 - 1 / (e * e));
  const phi = Math.atan2(e - 1 / e, -s);
  const hh = unit(el.h);
  const Sp = unit(sub(S, scale(hh, dot(S, hh))));
  const ph = add(scale(Sp, Math.cos(phi)), cross(hh, Sp), -Math.sin(phi));
  const free = predictOurs(X, V, t, [], { tMax: o.lead + el.period * 1.05, maxSteps: 20000, mouthR: o.mouthR, accel: o.accel });
  let bestT = t + o.lead, bestC = -2;
  for (let i = 0; i < 180; i++) {
    const t1 = t + o.lead + (el.period * i) / 180;
    const s1 = stateAt(free, t1);
    if (!s1) break;
    const c = dot(unit(sub(s1.X, stateOf(home, t1).pos)), ph);
    if (c > bestC) (bestC = c), (bestT = t1);
  }
  const s1 = stateAt(free, bestT)!;
  const v1 = norm(sub(s1.V, stateOf(home, bestT).vel));
  const r1 = norm(sub(s1.X, stateOf(home, bestT).pos));
  const dv0: Vec3 = [Math.sqrt(vinf * vinf + (2 * hb.mass) / r1) - v1, 0, 0];
  const tFall = Math.PI * Math.sqrt(((rA + rpT) / 2) ** 3 / tb.mass);
  const mission: OurMission = { goal, home, type: "parent", bDir: [1, 0], tEnd: bestT + tFall * 1.1, tArrive: bestT + tFall };
  return aimAndBuild(X, V, t, mission, bestT, dv0, o);
}

/**
 * Home and the target go round the same body (the Earth → Mars; Io → Europa): the least-Δv Lambert
 * transfer over a synodic period (the launch window), the escape hyperbola from the ship's orbit
 * turned onto its way out, then aimed on the target's B-plane.
 */
function planSibling(X: Vec3, V: Vec3, t: number, goal: OurGoal, home: string, o: PlanOptions): OurPlanResult {
  const hb = info(home)!, tb = info(goal.target, o.mouthR)!;
  const par = info(hb.parent!)!;
  const mu = par.mass;
  const A0 = stateOf(home, t);
  const el = elementsOf(hb.mass, sub(X, A0.pos), sub(V, A0.vel));
  if (!Number.isFinite(el.period)) return { error: `Transfer: in an orbit around ${hb.name} first` };
  const rA = norm(sub(A0.pos, stateOf(par.id, t).pos));
  const rB = norm(sub(stateOf(goal.target, t).pos, stateOf(par.id, t).pos));
  const TA = 2 * Math.PI * Math.sqrt(rA ** 3 / mu), TB = 2 * Math.PI * Math.sqrt(rB ** 3 / mu);
  const syn = Math.min(1 / Math.abs(1 / TA - 1 / TB), 3 * 365.25 * DAY);
  const tofH = Math.PI * Math.sqrt(((rA + rB) / 2) ** 3 / mu);
  const r0 = norm(sub(X, A0.pos));
  const rp = tb.radius + goal.altM / M_METRES;
  const cost = (td: number, tof: number) => {
    const Pd = stateOf(par.id, td), Pa = stateOf(par.id, td + tof);
    const Ad = stateOf(home, td), Ba = stateOf(goal.target, td + tof);
    const r1 = sub(Ad.pos, Pd.pos), r2 = sub(Ba.pos, Pa.pos);
    const L = lambert(mu, r1, r2, tof, orbitNormal(home, td));
    if (!L) return null;
    const vinfD = sub(L.v1, sub(Ad.vel, Pd.vel));
    const vinfA = norm(sub(L.v2, sub(Ba.vel, Pa.vel)));
    // (from the ship's orbit as it is: a way out off its plane costs a turn of the hyperbola there)
    const vpH = Math.sqrt(dot(vinfD, vinfD) + (2 * hb.mass) / r0);
    const dec = Math.abs(dot(unit(vinfD), unit(el.h)));
    const dep = vpH - Math.sqrt(hb.mass / r0) + vpH * dec;
    const arr = goal.arrival === "orbit" && tb.mass > 0 ? Math.sqrt(vinfA * vinfA + (2 * tb.mass) / rp) - Math.sqrt(tb.mass / rp) : 0;
    return { c: dep + arr, vinfD, dep, arr };
  };
  let best: { c: number; td: number; tof: number } | null = null;
  const nD = 120, nF = 14;
  const t0 = t + o.lead + el.period;
  for (let i = 0; i < nD; i++) {
    const td = t0 + (syn * i) / nD;
    for (let j = 0; j < nF; j++) {
      const tof = tofH * (0.5 + j / (nF - 1));
      const q = cost(td, tof);
      if (q && (!best || q.c < best.c)) best = { c: q.c, td, tof };
    }
  }
  if (!best) return { error: `Transfer: no path to ${tb.name} found` };
  // (finer, around the best)
  for (let pass = 0; pass < 2; pass++) {
    const dT = syn / nD / (pass ? 8 : 2), dF = (tofH / (nF - 1)) / (pass ? 8 : 2);
    const b0: { c: number; td: number; tof: number } = best;
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const td: number = Math.max(b0.td + (i * dT) / 4, t + o.lead + 0.5 * el.period);
        const tof: number = b0.tof + (j * dF) / 4;
        if (tof <= 0) continue;
        const q = cost(td, tof);
        if (q && q.c < best.c) best = { c: q.c, td, tof };
      }
    }
  }
  const q = cost(best.td, best.tof)!;
  // the escape: the periapsis where the hyperbola's way out points along v∞ (projected on the orbit)
  const vinf = norm(q.vinfD);
  const S = unit(q.vinfD);
  const hh = unit(el.h);
  const e = 1 + (r0 * vinf * vinf) / hb.mass;
  const phi = Math.atan2(e - 1 / e, -Math.sqrt(1 - 1 / (e * e)));
  const Sp = unit(sub(S, scale(hh, dot(S, hh))));
  const ph = add(scale(Sp, Math.cos(phi)), cross(hh, Sp), -Math.sin(phi));
  // (the ship's orbit carried on by two-body mechanics to the window: the burn where it passes ph
  // about a day of escape before the departure)
  const tEsc = Math.min(2 * DAY * Math.sqrt(hb.mass / info("earth")!.mass), 0.3 * best.tof);
  const tAim = best.td - tEsc;
  const r0v = sub(X, A0.pos), v0v = sub(V, A0.vel);
  let tb1 = tAim, bc = -2;
  for (let i = -90; i <= 90; i++) {
    const tt = tAim + (el.period * i) / 180;
    if (tt < t + o.lead) continue;
    const k = keplerProp(hb.mass, r0v, v0v, tt - t);
    const c = dot(unit(k.r), ph);
    if (c > bc) (bc = c), (tb1 = tt);
  }
  const k1 = keplerProp(hb.mass, r0v, v0v, tb1 - t);
  const dv0: Vec3 = [Math.sqrt(vinf * vinf + (2 * hb.mass) / norm(k1.r)) - norm(k1.v), 0, 0];
  const mission: OurMission = { goal, home, type: "sibling", bDir: [1, 0], tEnd: best.td + best.tof * 1.05, tArrive: best.td + best.tof, vinf: q.vinfD };
  // (aimed from a quarter turn before the burn — months of a low orbit are not integrated)
  const ts = Math.max(t, tb1 - 0.25 * el.period);
  const k0 = ts > t ? keplerProp(hb.mass, r0v, v0v, ts - t) : { r: r0v, v: v0v };
  const As = stateOf(home, ts);
  const plan = aimAndBuild(add(As.pos, k0.r), add(As.vel, k0.v), ts, mission, tb1, dv0, o, t);
  if ("error" in plan) return plan;
  plan.note = `window ${tb1 - t > 2 * DAY ? `in ${days(tb1 - t)}` : "now"} · ${plan.note}`;
  return plan;
}

/**
 * A free return (Apollo 13, Artemis II), found as a mission designer does: the burn along the
 * velocity only; for each of its sizes, its time moved (along the orbit) until the moon is passed at
 * the height asked, on one side; over the sizes, the perigee back home bracketed and bisected. Both
 * sides and both senses of the return are tried; the smallest burn wins.
 */
function freeReturnSearch(m: OurMission, X: Vec3, V: Vec3, t: number, t1: number, dP0: number, o: PlanOptions) {
  const g = m.goal;
  const tb = info(g.target)!, hb = info(m.home)!;
  const rpT = tb.radius + g.altM / M_METRES;
  const rpH = hb.radius + g.returnAltM / M_METRES;
  const tMax = Math.max(m.tEnd - t, 0) * 1.15 + 2 * DAY;
  let runs = 0;
  const run = (dP: number, dt: number, fine: boolean) => {
    runs++;
    return predictOurs(X, V, t, [{ t: t1 + dt, dv: [dP, 0, 0] }], { tMax, maxSteps: 200000, mouthR: o.mouthR, accel: o.accel, step: fine ? 0.02 : 0.05 });
  };
  const passSigned = (p: OurPath) => {
    const bp = bPlane(p, g.target, 0, o.mouthR);
    return bp ? (bp.bT >= 0 ? 1 : -1) * bp.rp : null;
  };
  // (the pass's height on a side, by the burn's time: secant steps)
  const inner = (dP: number, side: number, dt0: number, fine: boolean, tol: number) => {
    let a = dt0, b = dt0 + 20 / M_SECONDS;
    const fa0 = passSigned(run(dP, a, fine));
    let pb = run(dP, b, fine);
    const fb0 = passSigned(pb);
    if (fa0 === null || fb0 === null) return null;
    let fa = fa0 - side * rpT, fb = fb0 - side * rpT;
    for (let k = 0; k < 8; k++) {
      if (Math.abs(fb) < tol) return { dt: b, path: pb };
      if (fb === fa) return null;
      const lim = 0.02 * DAY;
      const c = Math.min(Math.max(b - (fb * (b - a)) / (fb - fa), b - lim), b + lim);
      a = b;
      fa = fb;
      b = c;
      pb = run(dP, b, fine);
      const f = passSigned(pb);
      if (f === null) return null;
      fb = f - side * rpT;
    }
    return null;
  };
  const retOf = (p: OurPath) => returnPerigee(p, g.target, m.home)?.rps ?? null;
  let best: { dP: number; t: number; side: number; sign: number; path: OurPath } | null = null;
  for (const side of [1, -1]) {
    // the burn's size scanned (coarse paths), the time kept on the pass's height
    // (from the first guess outwards, up then down, each size starting from its neighbour's time)
    const pts: { dP: number; dt: number; r: number }[] = [];
    let dt0 = 0;
    for (const dir of [1, -1]) {
      let dt = dt0;
      for (let k = dir > 0 ? 0 : -1; Math.abs(k) <= 12; k += dir) {
        const dP = dP0 + (k * 2.5) / C;
        const q = inner(dP, side, dt, false, 40 * KM);
        if (!q) continue;
        dt = q.dt;
        if (k === 0) dt0 = q.dt;
        const r = retOf(q.path);
        if (r !== null) pts.push({ dP, dt: q.dt, r });
      }
    }
    pts.sort((a, b) => a.dP - b.dP);
    // the brackets of the perigee back home (either sense), nearest the first guess first
    const brackets: { A: (typeof pts)[0]; B: (typeof pts)[0]; sign: number }[] = [];
    for (const sign of [1, -1]) {
      for (let k = 0; k + 1 < pts.length; k++) {
        const A = pts[k]!, B = pts[k + 1]!;
        if (Math.sign(A.r - sign * rpH) !== Math.sign(B.r - sign * rpH)) brackets.push({ A, B, sign });
      }
    }
    brackets.sort((a, b) => Math.abs(a.A.dP + a.B.dP - 2 * dP0) - Math.abs(b.A.dP + b.B.dP - 2 * dP0));
    for (const { A, B, sign } of brackets) {
      // false position (Illinois), fine paths once close
      let lo = { dP: A.dP, dt: A.dt, f: A.r - sign * rpH }, hi = { dP: B.dP, dt: B.dt, f: B.r - sign * rpH };
      let found: { dP: number; dt: number; path: OurPath } | null = null;
      let fine = false, side0 = 0;
      for (let it = 0; it < 12; it++) {
        const dP = (lo.dP * hi.f - hi.dP * lo.f) / (hi.f - lo.f);
        const q = inner(dP, side, lo.dt + ((hi.dt - lo.dt) * (dP - lo.dP)) / (hi.dP - lo.dP || 1), fine, fine ? 5 * KM : 40 * KM);
        if (!q) break;
        const r = retOf(q.path);
        if (r === null) break;
        const f = r - sign * rpH;
        found = { dP, dt: q.dt, path: q.path };
        if (Math.abs(f) < (fine ? 5 : 60) * KM || (!fine && (it >= 5 || Math.abs(hi.dP - lo.dP) < 0.2 * MS))) {
          if (fine && Math.abs(f) < 5 * KM) break;
          fine = true;
          if (Math.abs(f) >= 60 * KM) {
            if (Math.sign(f) === Math.sign(lo.f)) lo = { dP, dt: q.dt, f };
            else hi = { dP, dt: q.dt, f };
          }
          continue;
        }
        if (Math.sign(f) === Math.sign(lo.f)) {
          lo = { dP, dt: q.dt, f };
          if (side0 === -1) hi.f /= 2;
          side0 = -1;
        } else {
          hi = { dP, dt: q.dt, f };
          if (side0 === 1) lo.f /= 2;
          side0 = 1;
        }
      }
      // (every bracket tried: the least burn wins — the classic figure-8, ~4 days out and back)
      if (found && fine && (!best || Math.abs(found.dP) < Math.abs(best.dP))) best = { dP: found.dP, t: t1 + found.dt, side, sign, path: found.path };
    }
  }
  if ((globalThis as { __planDebug?: boolean }).__planDebug) console.log("free return: paths", runs);
  return best;
}

/**
 * The first burn aimed (the side of the target chosen: as the first guess passes it, or — a free
 * return — the side that brings the ship home), then the plan's nodes: corrections, capture.
 */
function aimAndBuild(X: Vec3, V: Vec3, t: number, m: OurMission, t1: number, dv0: Vec3, o: PlanOptions, tNow = t): OurPlanResult {
  const goal = m.goal;
  const tb = info(goal.target, o.mouthR)!, hb = info(m.home)!;
  let result: ReturnType<typeof aim> = null;
  let mcc: PlanNode | null = null;
  if (m.type === "parent") {
    result = aim(m, X, V, t, t1, dv0, "out", o, true);
  } else if (m.type === "sibling") {
    // across the planets: the escape aimed on the Lambert way out, then — past home's sphere — a
    // first correction aimed on the target's B-plane (from there, not from the low orbit: 1 m/s
    // at the burn is ~10⁵ km at Mars)
    let esc = aim(m, X, V, t, t1, dv0, "escape", o, true);
    if (!esc) return { error: `Transfer: no escape towards ${tb.name} found` };
    const exitAt = (p: OurPath) => {
      for (let i = 0; i < p.pts.length; i++) if (norm(sub(p.pts[i]!, stateOf(m.home, p.times[i]!).pos)) > 1.5 * soiOf(m.home, p.times[i]!)) return p.times[i]!;
      return null;
    };
    // (a differential correction: the first correction's Δv, found past home's sphere, is folded
    // back into the way out asked of the escape — the Lambert v∞ is two-body, the flight is not —
    // until what is left for the correction is small)
    let c: ReturnType<typeof aim> = null;
    for (let k = 0; k < 4; k++) {
      const tx = exitAt(esc.path);
      const s0 = tx !== null ? stateAt(esc.path, tx) : null;
      if (!s0 || tx === null) return { error: `Transfer: the escape towards ${tb.name} does not leave ${hb.name}` };
      if (k === 0) {
        const side = predictOurs(s0.X, s0.V, tx, [], { tMax: (m.tEnd - tx) * 1.15, maxSteps: 60000, mouthR: o.mouthR, accel: o.accel });
        const bp0 = bPlane(side, goal.target, 0, o.mouthR);
        if (bp0 && Math.hypot(bp0.bT, bp0.bR) > 0) m.bDir = [bp0.bT / Math.hypot(bp0.bT, bp0.bR), bp0.bR / Math.hypot(bp0.bT, bp0.bR)];
      }
      c = aim(m, s0.X, s0.V, tx, tx + o.lead, [0, 0, 0], "out", o);
      if (!c || norm(c.dv) < 1 * MS || k === 3) break;
      const d = nodeDvHome(s0.X, s0.V, c.t, c.dv);
      m.vinf = add(m.vinf!, d);
      const e2 = aim(m, X, V, t, esc.t, esc.dv, "escape", o, true);
      if (!e2) break;
      esc = e2;
    }
    // (the correction aimed once more from the path the whole plan flies: what the map shows)
    if (c) {
      const full = predictOurs(X, V, t, [{ t: esc.t, dv: esc.dv }], { tMax: c.t - t + 1e-6, maxSteps: 200000, mouthR: o.mouthR, accel: o.accel, step: 0.02 });
      // (from one of its own points — not interpolated: steps of days there, ~300 km at Mars)
      let j = full.times.length - 1;
      while (j > 0 && full.times[j]! > c.t - 0.5 * o.lead) j--;
      const c2 = j > 0 ? aim(m, full.pts[j]!, full.vels[j]!, full.times[j]!, c.t, c.dv, "out", o) : null;
      if (c2 && c2.ok) c = c2;
    }
    if (c) mcc = { t: c.t, dv: c.dv, role: "mcc" };
    const nodes = [{ t: esc.t, dv: esc.dv }, ...(mcc ? [{ t: mcc.t, dv: mcc.dv }] : [])];
    result = { ...esc, path: predictOurs(X, V, t, nodes, { tMax: (m.tEnd - t) * 1.15, maxSteps: 200000, mouthR: o.mouthR, accel: o.accel, step: 0.02 }), ok: esc.ok && !!c?.ok };
  } else if (goal.arrival === "freeReturn") {
    const fr = freeReturnSearch(m, X, V, t, t1, dv0[0], o);
    if (!fr) return { error: `Free return: no path round ${tb.name} and back found from this orbit` };
    t1 = fr.t;
    m.bDir = [fr.side, 0];
    m.retSign = fr.sign;
    // (polished with the plane's components free: the burn is then exact)
    result = aim(m, X, V, t, t1, [fr.dP, 0, 0], "out", o, true) ?? { dv: [fr.dP, 0, 0] as Vec3, t: t1, ok: false, path: fr.path, r: [] };
  } else {
    // the side the first guess passes on (the centre: T)
    const first = predictOurs(X, V, t, [{ t: t1, dv: dv0 }], { tMax: (m.tEnd - t) * 1.15 + 2 * DAY, maxSteps: 60000, mouthR: o.mouthR, accel: o.accel });
    const bp = bPlane(first, goal.target, 0, o.mouthR);
    if (bp && Math.hypot(bp.bT, bp.bR) > 0.2 * tb.radius) {
      const l = Math.hypot(bp.bT, bp.bR);
      m.bDir = [bp.bT / l, bp.bR / l];
    }
    result = aim(m, X, V, t, t1, dv0, "out", o, true);
  }
  if (!result) return { error: `Transfer: the aim at ${tb.name} did not converge` };
  const { dv, path } = result;
  t1 = result.t;
  // what the path does: the pass, the way home
  const nodes: PlanNode[] = [{ t: t1, dv, role: "depart" }];
  let note = `${kms(norm(dv))} burn in ${days(t1 - tNow)}`;
  if (m.type === "parent") {
    const rp = returnPerigee(path, m.home, goal.target);
    const pe = rp?.pe;
    const tPe = pe && pe.i >= 0 ? path.times[pe.i]! : m.tArrive;
    const tExit = rp ? path.times[rp.exit]! : t1 + 0.3 * (m.tArrive - t1);
    m.tArrive = tPe;
    m.tEnd = tPe + 0.1 * (tPe - t1);
    nodes.push({ t: tExit + 0.3 * (tPe - tExit), dv: [0, 0, 0], role: "mccReturn" });
    if (goal.arrival === "orbit") nodes.push({ t: tPe, dv: [0, 0, 0], role: "captureHome", body: goal.target, then: "circularize" });
    note += ` · ${tb.name} perigee ${km((rp?.rp ?? 0) - tb.radius)} at +${days(tPe - t1)}`;
  } else {
    const bp = bPlane(path, goal.target, 0, o.mouthR);
    const ca = bp?.ca ?? { d: Infinity, i: -1 };
    const tCa = ca.i >= 0 ? path.times[ca.i]! : m.tArrive;
    m.tArrive = tCa;
    const hit = path.fate === "wormhole" ? " · into the wormhole" : "";
    note += ` · ${tb.name} ${goal.target === "wormhole" ? "reached" : `${goal.arrival === "orbit" ? "periapsis" : "pass"} ${km(ca.d - tb.radius)}`} at +${days(tCa - t1)}${hit}`;
    if (mcc) {
      nodes.push(mcc);
      note += ` · correction ${kms(norm(mcc.dv))}`;
    } else nodes.push({ t: t1 + 0.3 * (tCa - t1), dv: [0, 0, 0], role: "mcc" });
    if (m.type === "sibling") nodes.push({ t: t1 + 0.8 * (tCa - t1), dv: [0, 0, 0], role: "mcc" });
    if (goal.arrival === "orbit" && tb.mass > 0) {
      const st = stateOf(goal.target, tCa);
      const vp = norm(sub(path.vels[ca.i]!, st.vel));
      const dvc = Math.sqrt(tb.mass / ca.d) - vp;
      nodes.push({ t: tCa, dv: [dvc, 0, 0], role: "capture", body: goal.target, then: "circularize" });
      note += ` · capture ${kms(Math.abs(dvc))}`;
      m.tEnd = tCa;
    } else if (goal.arrival === "freeReturn") {
      const rp = returnPerigee(path, goal.target, m.home);
      const pe = rp?.pe;
      const tPe = pe && pe.i >= 0 ? path.times[pe.i]! : m.tEnd;
      m.tEnd = tPe + 0.05 * (tPe - t1);
      const tExit = rp ? path.times[rp.exit]! : tCa;
      nodes.push({ t: tExit + 0.3 * (tPe - tExit), dv: [0, 0, 0], role: "mccReturn" });
      const peM = rp ? rp.rp - hb.radius : NaN;
      let cap = "";
      if (pe && pe.i >= 0) {
        const hs = stateOf(m.home, tPe);
        const vp = norm(sub(path.vels[pe.i]!, hs.vel));
        const dvc = Math.sqrt(hb.mass / pe.d) - vp;
        nodes.push({ t: tPe, dv: [dvc, 0, 0], role: "captureHome", body: m.home, then: "circularize" });
        cap = ` · capture ${kms(Math.abs(dvc))}`;
      }
      note += ` · back to ${hb.name} perigee ${km(peM)} at +${days(tPe - t1)}${cap}`;
    } else m.tEnd = tCa + 0.05 * (tCa - t1);
  }
  if (!result.ok) note += " (aim rough — corrections will refine it)";
  return { nodes, mission: m, note, path };
}

/**
 * In flight: re-aims the next node from the ship's real state (X, V at t) — a correction for the
 * mission's goals, a capture at the periapsis the path now reaches. Returns the node (its time may
 * move), or null when it is no longer needed (a correction under a few cm/s).
 */
export function refineOurNode(X: Vec3, V: Vec3, t: number, m: OurMission, node: PlanNode, o: PlanOptions): PlanNode | null {
  const tn = Math.max(node.t, t + o.lead);
  const g = m.goal;
  if (node.role === "capture" || node.role === "captureHome" || node.role === "circ") {
    const body = node.body ?? g.target;
    const b = info(body)!;
    const span = Math.max(m.tEnd - t, node.t - t) * 1.3 + 0.2 * DAY;
    const path = predictOurs(X, V, t, [], { tMax: span, maxSteps: 60000, mouthR: o.mouthR, accel: o.accel });
    const ca = closest(path, body);
    if (ca.i < 0) return node;
    // (circ: the next apsis — the farthest or the nearest point before a turn is done)
    let i = ca.i;
    if (node.role === "circ") {
      const target = b.radius + g.altM / M_METRES;
      let bestI = -1, bestE = Infinity;
      for (let k = 1; k < path.pts.length - 1; k++) {
        const d = norm(sub(path.pts[k]!, stateOf(body, path.times[k]!).pos));
        const e = Math.abs(d - target);
        if (e < bestE && path.times[k]! > t + o.lead) (bestE = e), (bestI = k);
      }
      if (bestI >= 0) i = bestI;
    }
    const tt = Math.max(path.times[i]!, t + o.lead);
    const s = stateAt(path, tt) ?? { X: path.pts[i]!, V: path.vels[i]! };
    const st = stateOf(body, tt);
    const r = sub(s.X, st.pos), v = sub(s.V, st.vel);
    let n = cross(r, v);
    if (norm(n) < 1e-30) n = cross(r, [0, 0, 1]);
    const along = unit(cross(unit(n), r));
    const dv = nodeDvComponents(s.X, s.V, tt, sub(scale(along, Math.sqrt(b.mass / norm(r))), v));
    return { ...node, t: tt, dv };
  }
  const stage: Stage = node.role === "mccReturn" ? "back" : node.role === "depart" && m.type === "sibling" ? "escape" : "out";
  let tAim = tn;
  if (node.role === "mccReturn") {
    // (the return's correction: a third of the way home from where the ship leaves the moon's
    // sphere, as the path now goes)
    const span = Math.max(m.tEnd - t, 0) * 1.2 + 1 * DAY;
    const path = predictOurs(X, V, t, [], { tMax: span, maxSteps: 60000, mouthR: o.mouthR, accel: o.accel });
    const passed = m.type === "parent" ? m.home : g.target, home = m.type === "parent" ? g.target : m.home;
    const rp = returnPerigee(path, passed, home);
    if (rp && rp.pe.i >= 0) {
      const tx = path.times[rp.exit]!, tp = path.times[rp.pe.i]!;
      tAim = Math.max(t + o.lead, tx + 0.3 * (tp - tx));
    }
  }
  const r = aim(m, X, V, t, tAim, node.role === "depart" ? node.dv : [0, 0, 0], stage, o, node.role === "depart", false, node.role === "mcc", node.role !== "depart");
  if (!r) return { ...node, t: tAim };
  // (dropped only when the aim is met without it — a failed aim is no reason to skip a correction)
  if (node.role !== "depart" && norm(r.dv) < 0.03 * MS) return r.ok ? null : { ...node, t: tAim };
  // (a correction of more than 500 m/s is no correction: the aim failed — kept for the next try)
  if (node.role !== "depart" && norm(r.dv) > 500 * MS) return { ...node, t: tAim };
  return { ...node, t: r.t, dv: r.dv };
}

/** The bodies one can plan for (targets of our universe). */
export const PLANNABLE = SOLAR_BODIES.map((b) => b.id);

