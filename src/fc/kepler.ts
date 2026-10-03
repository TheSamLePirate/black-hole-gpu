// The flight computer's orbital mechanics: two bodies, any units as long as they agree (SI here: m, s,
// m³/s²). Elements from a state and back, Kepler's propagation (universal variable), the times to a
// true anomaly, to the nodes against a plane, the relative inclination, the phase angle, the synodic
// period, the closest approach of two orbits, Lambert's problem; the burns' frame (prograde, normal,
// radial — as our-predict's nodes: P the motion, N the orbit's normal, R = N × P).

export type V3 = [number, number, number];

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
const TAU = 2 * Math.PI;
const wrap = (x: number) => ((x % TAU) + TAU) % TAU;

export interface Elements {
  mu: number;
  /** semi-major axis (< 0: hyperbolic), eccentricity, inclination, node, periapsis argument, true anomaly [rad] */
  a: number;
  e: number;
  i: number;
  raan: number;
  argp: number;
  nu: number;
  /** periapsis, apoapsis (∞ unbound) distances; period (∞ unbound); specific angular momentum vector */
  rp: number;
  ra: number;
  T: number;
  h: V3;
  /** the eccentricity vector, the periapsis' direction and the in-plane perpendicular (unit) */
  ev: V3;
  P: V3;
  Q: V3;
}

/** Elements against a reference frame whose pole is `k` (unit; default z) and x axis its node line's
 *  origin `xr` (default x). */
export function elements(mu: number, r: V3, v: V3, k: V3 = [0, 0, 1], xr: V3 = [1, 0, 0]): Elements {
  const R = len(r);
  const h = cross(r, v);
  const hl = len(h);
  const ev = add(scale(cross(v, h), 1 / mu), scale(r, -1 / R));
  const e = len(ev);
  const eps = dot(v, v) / 2 - mu / R;
  const a = Math.abs(eps) > 1e-30 ? -mu / (2 * eps) : Infinity;
  const W = unit(h);
  const i = Math.acos(Math.min(Math.max(dot(W, k), -1), 1));
  // the node line, measured from xr about k
  let n = cross(k, W);
  if (len(n) < 1e-12) n = xr;
  n = unit(n);
  const yr = cross(k, xr);
  const raan = wrap(Math.atan2(dot(n, yr), dot(n, xr)));
  const P = e > 1e-9 ? unit(ev) : n;
  const Q = cross(W, P);
  const argp = e > 1e-9 ? wrap(Math.atan2(dot(cross(n, P), W), dot(n, P))) : 0;
  const nu = wrap(Math.atan2(dot(r, Q), dot(r, P)));
  const p = (hl * hl) / mu;
  const rp = p / (1 + e);
  const ra = e < 1 ? p / (1 - e) : Infinity;
  const T = e < 1 ? TAU * Math.sqrt(a ** 3 / mu) : Infinity;
  return { mu, a, e, i, raan, argp, nu, rp, ra, T, h, ev, P, Q };
}

/** The state at a true anomaly on an orbit (its plane's axes P, Q). */
export function stateAt(el: Elements, nu: number): { r: V3; v: V3 } {
  const hl = len(el.h);
  const p = (hl * hl) / el.mu;
  const rr = p / (1 + el.e * Math.cos(nu));
  const r = add(scale(el.P, rr * Math.cos(nu)), scale(el.Q, rr * Math.sin(nu)));
  const k = el.mu / hl;
  const v = add(scale(el.P, -k * Math.sin(nu)), scale(el.Q, k * (el.e + Math.cos(nu))));
  return { r, v };
}

/** Stumpff's functions. */
function stumpff(z: number): [number, number] {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * z)];
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return [(Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (s * -z)];
  }
  return [1 / 2 - z / 24, 1 / 6 - z / 120];
}

/** Kepler's propagation by a time dt (universal variable, Newton's method). */
export function propagate(mu: number, r0: V3, v0: V3, dt: number): { r: V3; v: V3 } {
  if (dt === 0) return { r: r0, v: v0 };
  const R0 = len(r0);
  const vr0 = dot(r0, v0) / R0;
  const alpha = 2 / R0 - dot(v0, v0) / mu;
  const sm = Math.sqrt(mu);
  let x = alpha > 1e-12 ? sm * alpha * dt : Math.sign(dt) * Math.sqrt(mu) * Math.abs(dt) / R0;
  for (let it = 0; it < 60; it++) {
    const z = alpha * x * x;
    const [C, S] = stumpff(z);
    const F = ((R0 * vr0) / sm) * x * x * C + (1 - alpha * R0) * x * x * x * S + R0 * x - sm * dt;
    const dF = ((R0 * vr0) / sm) * x * (1 - alpha * x * x * S) + (1 - alpha * R0) * x * x * C + R0;
    const dx = F / dF;
    x -= dx;
    if (Math.abs(dx) < 1e-10 * (Math.abs(x) + 1)) break;
  }
  const z = alpha * x * x;
  const [C, S] = stumpff(z);
  const f = 1 - (x * x * C) / R0;
  const g = dt - (x * x * x * S) / sm;
  const r = add(scale(r0, f), scale(v0, g));
  const R = len(r);
  const fd = (sm / (R * R0)) * (alpha * x * x * x * S - x);
  const gd = 1 - (x * x * C) / R;
  return { r, v: add(scale(r0, fd), scale(v0, gd)) };
}

/** The time from the current true anomaly to another (the next passage; ∞ unreachable on an escape). */
export function timeTo(el: Elements, nuTo: number): number {
  const e = el.e;
  if (e < 1) {
    const M = (nu: number) => {
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      return E - e * Math.sin(E);
    };
    const n = TAU / el.T;
    return wrap(M(nuTo) - M(el.nu)) / n;
  }
  const lim = Math.acos(-1 / e);
  const ok = (nu: number) => Math.abs(((nu + Math.PI) % TAU) - Math.PI) < lim;
  if (!ok(nuTo)) return Infinity;
  const Mh = (nu: number) => {
    const s = ((nu + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(s / 2));
    return e * Math.sinh(H) - H;
  };
  const n = Math.sqrt(el.mu / -(el.a ** 3));
  const dt = (Mh(nuTo) - Mh(el.nu)) / n;
  return dt >= 0 ? dt : Infinity;
}

/** The true anomaly at a distance r, outbound (inbound: its negative). NaN if never there. */
export function nuAtRadius(el: Elements, r: number): number {
  const p = (len(el.h) ** 2) / el.mu;
  const c = (p / r - 1) / (el.e || 1e-12);
  if (Math.abs(c) > 1) return NaN;
  return Math.acos(c);
}

/** The ascending node against a plane of pole k (where the orbit crosses it going to +k): its true
 *  anomaly, and the descending node's (+π). */
export function nodesAgainst(el: Elements, k: V3): { an: number; dn: number } | null {
  const W = unit(el.h);
  const line = cross(k, W);
  if (len(line) < 1e-9) return null;
  const n = unit(line);
  const an = wrap(Math.atan2(dot(n, el.Q), dot(n, el.P)));
  return { an, dn: wrap(an + Math.PI) };
}

/** The angle between two orbits' planes [rad]. */
export const relInclination = (h1: V3, h2: V3) => Math.acos(Math.min(Math.max(dot(unit(h1), unit(h2)), -1), 1));

/** The phase angle: how far ahead the target is along the ship's motion, in its plane [rad, −π…π]. */
export function phaseAngle(rS: V3, vS: V3, rT: V3): number {
  const W = unit(cross(rS, vS));
  const t = add(rT, W, -dot(rT, W));
  return Math.atan2(dot(cross(rS, t), W), dot(rS, t));
}

/** The synodic period of two periods. */
export const synodic = (T1: number, T2: number) => (Math.abs(1 / T1 - 1 / T2) > 1e-30 ? 1 / Math.abs(1 / T1 - 1 / T2) : Infinity);

/** The closest approach of two Kepler orbits within a span [s]: its time and distance, the relative speed. */
export function closestApproach(mu: number, s1: { r: V3; v: V3 }, s2: { r: V3; v: V3 }, span: number, samples = 400) {
  const d = (t: number) => {
    const a = propagate(mu, s1.r, s1.v, t), b = propagate(mu, s2.r, s2.v, t);
    return len(add(a.r, b.r, -1));
  };
  let best = 0, bd = Infinity;
  for (let k = 0; k <= samples; k++) {
    const t = (span * k) / samples;
    const x = d(t);
    if (x < bd) (bd = x), (best = t);
  }
  // (golden section about the best sample)
  let lo = Math.max(best - span / samples, 0), hi = Math.min(best + span / samples, span);
  const g = 0.6180339887;
  for (let k = 0; k < 40; k++) {
    const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo);
    if (d(m1) < d(m2)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const a = propagate(mu, s1.r, s1.v, t), b = propagate(mu, s2.r, s2.v, t);
  return { t, dist: len(add(a.r, b.r, -1)), vRel: len(add(a.v, b.v, -1)) };
}

/** Lambert's problem (universal variables, the short way about `normal`; prograde): the velocities
 *  leaving r1 and arriving at r2 after tof. Null if none. */
export function lambert(mu: number, r1: V3, r2: V3, tof: number, normal: V3 = [0, 0, 1]): { v1: V3; v2: V3 } | null {
  const R1 = len(r1), R2 = len(r2);
  let dnu = Math.acos(Math.min(Math.max(dot(r1, r2) / (R1 * R2), -1), 1));
  if (dot(cross(r1, r2), normal) < 0) dnu = TAU - dnu;
  const A = Math.sin(dnu) * Math.sqrt((R1 * R2) / (1 - Math.cos(dnu)));
  if (Math.abs(A) < 1e-12) return null;
  const y = (z: number) => {
    const [C, S] = stumpff(z);
    return R1 + R2 + (A * (z * S - 1)) / Math.sqrt(C);
  };
  const F = (z: number) => {
    const [C, S] = stumpff(z);
    const yz = y(z);
    if (yz < 0) return NaN;
    return (yz / C) ** 1.5 * S + A * Math.sqrt(yz) - Math.sqrt(mu) * tof;
  };
  // (bracket z: from where y > 0 up to 4π²)
  let lo = -4 * Math.PI * Math.PI, hi = 4 * Math.PI * Math.PI - 1e-6;
  while (y(lo) < 0 || Number.isNaN(F(lo))) {
    lo += 0.1;
    if (lo > hi) return null;
  }
  if (F(lo) > 0 || F(hi) < 0) return null;
  for (let k = 0; k < 200; k++) {
    const m = (lo + hi) / 2;
    const f = F(m);
    if (Number.isNaN(f) || f < 0) lo = m;
    else hi = m;
    if (hi - lo < 1e-12) break;
  }
  const z = (lo + hi) / 2;
  const yz = y(z);
  const f = 1 - yz / R1;
  const g = A * Math.sqrt(yz / mu);
  const gd = 1 - yz / R2;
  const v1 = scale(add(r2, r1, -f), 1 / g);
  const v2 = scale(add(scale(r2, gd), r1, -1), 1 / g);
  return { v1, v2 };
}

/** The burns' frame at a state: prograde, normal, radial (R = N × P). */
export function pnr(r: V3, v: V3): [V3, V3, V3] {
  const P = unit(v);
  let N = cross(r, P);
  if (len(N) < 1e-12) N = cross([0, 0, 1], P);
  N = unit(N);
  return [P, N, cross(N, P)];
}

/** A velocity change as its P, N, R parts at a state. */
export function toPNR(r: V3, v: V3, dv: V3): V3 {
  const [P, N, R] = pnr(r, v);
  return [dot(dv, P), dot(dv, N), dot(dv, R)];
}

/** P, N, R parts back to a vector. */
export function fromPNR(r: V3, v: V3, c: V3): V3 {
  const [P, N, R] = pnr(r, v);
  return add(add(scale(P, c[0]), N, c[1]), R, c[2]);
}

/**
 * An impulsive Δv [P, N, R] at speed v as a burn flown along the orbital frame must deliver it — the
 * frame turning with the velocity the burn changes (our universe's node autopilot): its prograde part the
 * change of speed |v + Δv| − v, its normal and radial parts the turn of the velocity — the arc at the
 * burn's mean speed, not the chord. The same Δv when small; a plane change of 25° otherwise would take 9 %
 * of the speed off along the prograde, the chord's — the orbit dropped into the air.
 */
export function followDv(dv: V3, v: number): V3 {
  const p = v + dv[0];
  const side = Math.hypot(dv[1], dv[2]);
  if (!(v > 0) || p <= 0 || side <= 1e-12 * v) return dv;
  const s = Math.hypot(p, side);
  const arc = (Math.atan2(side, p) * (v + s)) / 2;
  return [s - v, (dv[1] / side) * arc, (dv[2] / side) * arc];
}

/** Vis-viva: the speed at r on an orbit of semi-major axis a. */
export const visViva = (mu: number, r: number, a: number) => Math.sqrt(Math.max(mu * (2 / r - 1 / a), 0));
