// The crew console's two-body orbit (PLAN-VAISSEAUX K2–K4): from the K1 state (km, km/s, GM km³/s²) its conic — its
// plane, its shape, where the craft is on it — and a place on it some seconds on (the burns' marks). Pure, no
// simulator: what a console can rebuild from four numbers a second.

export type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V3): V3 => scale(a, 1 / (norm(a) || 1));

export interface Conic {
  /** semi-latus rectum [km], eccentricity, semi-major axis [km] (< 0: hyperbolic) */
  p: number;
  e: number;
  a: number;
  /** the plane's axes: P toward the periapsis, Q 90° on, W its normal */
  P: V3;
  Q: V3;
  W: V3;
  /** the craft's true anomaly now [rad], inclination [rad] to the frame's equator */
  nu: number;
  inc: number;
  /** periapsis and apoapsis radii [km] (apoapsis Infinity when unbound), period [s] (Infinity unbound) */
  rp: number;
  ra: number;
  period: number;
  mu: number;
}

/** The conic of a state about a body. */
export function conicOf(r: V3, v: V3, mu: number): Conic | null {
  const rn = norm(r);
  if (!(rn > 0) || !(mu > 0)) return null;
  const h = cross(r, v);
  const hn = norm(h);
  if (!(hn > 0)) return null;
  const W = scale(h, 1 / hn);
  // the eccentricity vector: (v × h)/μ − r̂
  const ev = cross(v, h).map((x, i) => x / mu - r[i]! / rn) as V3;
  const e = norm(ev);
  const p = (hn * hn) / mu;
  const energy = dot(v, v) / 2 - mu / rn;
  const a = Math.abs(energy) < 1e-12 ? Infinity : -mu / (2 * energy);
  // (circular: the periapsis's direction is the craft's own)
  const P = e > 1e-6 ? unit(ev) : unit(r);
  const Q = cross(W, P);
  const nu = Math.atan2(dot(r, Q), dot(r, P));
  const rp = p / (1 + e);
  const ra = e < 1 ? p / (1 - e) : Infinity;
  const period = e < 1 && a > 0 ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity;
  return { p, e, a, P, Q, W, nu, inc: Math.acos(Math.max(-1, Math.min(1, W[2]))), rp, ra, period, mu };
}

/** The radius at a true anomaly [km] (NaN beyond a hyperbola's asymptotes). */
export function radiusAt(o: Conic, nu: number): number {
  const d = 1 + o.e * Math.cos(nu);
  return d > 1e-9 ? o.p / d : Number.NaN;
}

/** The true anomaly some seconds on (Kepler's equation, elliptic or hyperbolic). */
export function nuAfter(o: Conic, dt: number): number {
  const { e, mu } = o;
  if (e < 1) {
    const a = o.a;
    const n = Math.sqrt(mu / (a * a * a));
    const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(o.nu / 2), Math.sqrt(1 + e) * Math.cos(o.nu / 2));
    const M = E0 - e * Math.sin(E0) + n * dt;
    let E = M;
    for (let k = 0; k < 30; k++) {
      const f = E - e * Math.sin(E) - M;
      E -= f / (1 - e * Math.cos(E));
      if (Math.abs(f) < 1e-12) break;
    }
    return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  }
  // (hyperbolic: −a > 0)
  const A = -o.a;
  const n = Math.sqrt(mu / (A * A * A));
  const H0 = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(o.nu / 2));
  const M = e * Math.sinh(H0) - H0 + n * dt;
  let H = Math.asinh(M / e);
  for (let k = 0; k < 40; k++) {
    const f = e * Math.sinh(H) - H - M;
    H -= f / (e * Math.cosh(H) - 1);
    if (Math.abs(f) < 1e-12) break;
  }
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2));
}

/** The conic's points in its plane [km] (x toward the periapsis), a hyperbola's arm cut at `rMax`. */
export function conicPoints(o: Conic, rMax: number, n = 180): [number, number][] {
  const out: [number, number][] = [];
  const lim = o.e < 1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, (o.p / rMax - 1) / o.e)));
  for (let k = 0; k <= n; k++) {
    const nu = -lim + (2 * lim * k) / n;
    const r = radiusAt(o, nu);
    if (Number.isFinite(r) && r <= rMax * 1.0001) out.push([r * Math.cos(nu), r * Math.sin(nu)]);
  }
  return out;
}

/** A point of the frame [km] in the conic's plane (x toward the periapsis, y 90° on). */
export const inPlane = (o: Conic, q: V3): [number, number] => [dot(q, o.P), dot(q, o.Q)];

/** The time from one true anomaly to another along the conic [s]: the shortest way about an ellipse (within half a
 *  period, either side), along a hyperbola's arm as it is flown. */
export function timeBetween(o: Conic, nu1: number, nu2: number): number {
  const { e, mu } = o;
  if (e < 1) {
    const n = Math.sqrt(mu / (o.a * o.a * o.a));
    const M = (nu: number) => {
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      return E - e * Math.sin(E);
    };
    let dM = M(nu2) - M(nu1);
    dM = Math.atan2(Math.sin(dM), Math.cos(dM));
    return dM / n;
  }
  const A = -o.a;
  const n = Math.sqrt(mu / (A * A * A));
  const M = (nu: number) => {
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    return e * Math.sinh(H) - H;
  };
  return (M(nu2) - M(nu1)) / n;
}
