// Lambert's problem by Izzo's method (D. Izzo, "Revisiting Lambert's problem", Celest. Mech. Dyn. Astr.
// 121, 2015 — audit P7: the planner's solver did one revolution and was singular at 180°): from r1 to r2
// in a time of flight about a mass mu, every solution — the direct one and, for long flights, the
// multi-revolution pairs (N turns, a left and a right branch). One variable x on a single curve
// T(x) for all geometries (λ from the chord), Householder's third-order iterations from good guesses,
// Battin's series near the parabola; the transfer's plane chosen by a normal (180° is not singular).

import { cross, dot, len as norm, scale, unit, type Vec3 } from "../math/vec3";

export interface LambertSolution {
  v1: Vec3;
  v2: Vec3;
  /** the revolutions made (0: the direct transfer) and, for N > 0, its branch */
  revs: number;
  branch: "direct" | "left" | "right";
}

/** Gauss's hypergeometric ₂F₁(3, 1; 5/2; z) (Battin's series near the parabola). */
function hyp(z: number, tol = 1e-11) {
  let Sj = 1,
    Cj = 1,
    err = 1,
    j = 0;
  while (err > tol && j < 200) {
    const Cj1 = ((Cj * (3 + j) * (1 + j)) / (2.5 + j)) * (z / (j + 1));
    Sj += Cj1;
    err = Math.abs(Cj1);
    Cj = Cj1;
    j++;
  }
  return Sj;
}

/** The non-dimensional time of flight T(x) for λ and N revolutions. */
function x2tof(x: number, lam: number, N: number): number {
  const battin = 0.01,
    lagrange = 0.2;
  const dist = Math.abs(x - 1);
  if (dist < lagrange && dist > battin) {
    // (Lagrange's form)
    const a = 1 / (1 - x * x);
    if (a > 0) {
      const alfa = 2 * Math.acos(x);
      let beta = 2 * Math.asin(Math.sqrt((lam * lam) / a));
      if (lam < 0) beta = -beta;
      return (a * Math.sqrt(a) * (alfa - Math.sin(alfa) - (beta - Math.sin(beta)) + 2 * Math.PI * N)) / 2;
    }
    const alfa = 2 * Math.acosh(x);
    let beta = 2 * Math.asinh(Math.sqrt((-lam * lam) / a));
    if (lam < 0) beta = -beta;
    return (-a * Math.sqrt(-a) * (beta - Math.sinh(beta) - (alfa - Math.sinh(alfa)))) / 2;
  }
  const K = lam * lam,
    E = x * x - 1;
  const rho = Math.abs(E),
    z = Math.sqrt(1 + K * E);
  if (dist < battin) {
    // (Battin's series)
    const eta = z - lam * x;
    const S1 = 0.5 * (1 - lam - x * eta);
    const Q = (4 / 3) * hyp(S1);
    return (eta ** 3 * Q + 4 * lam * eta) / 2 + (N * Math.PI) / rho ** 1.5;
  }
  // (Lancaster's form)
  const y = Math.sqrt(rho);
  const g = x * z - lam * E;
  let d: number;
  if (E < 0) d = N * Math.PI + Math.acos(g);
  else {
    const f = y * (z - lam * x);
    d = Math.log(f + g);
  }
  return (x - lam * z - d / y) / E;
}

/** T′, T″, T‴ at x (Izzo's closed forms). */
function derivs(x: number, T: number, lam: number) {
  const l2 = lam * lam,
    l3 = l2 * lam;
  const umx2 = 1 - x * x;
  const y = Math.sqrt(1 - l2 * umx2);
  const y2 = y * y,
    y3 = y2 * y;
  const d1 = (3 * T * x - 2 + (2 * l3 * x) / y) / umx2;
  const d2 = (3 * T + 5 * x * d1 + (2 * (1 - l2) * l3) / y3) / umx2;
  const d3 = (7 * x * d2 + 8 * d1 - (6 * (1 - l2) * l2 * l3 * x) / (y3 * y2)) / umx2;
  return { d1, d2, d3 };
}

/** Householder's iterations on T(x) = T. */
function householder(T: number, x0: number, N: number, lam: number, eps = 1e-12, iters = 30): number {
  let x = x0;
  for (let it = 0; it < iters; it++) {
    const tof = x2tof(x, lam, N);
    const { d1, d2, d3 } = derivs(x, tof, lam);
    const delta = tof - T;
    const d1s = d1 * d1;
    const xn = x - (delta * (d1s - (delta * d2) / 2)) / (d1 * (d1s - delta * d2) + (d3 * delta * delta) / 6);
    const err = Math.abs(x - xn);
    x = xn;
    if (err < eps) break;
  }
  return x;
}

/** The shortest non-dimensional time an N-revolution transfer can take (Halley's iterations on T′ = 0). */
function tmin(lam: number, N: number): { x: number; T: number } {
  let x = 0;
  let T = x2tof(x, lam, N);
  for (let it = 0; it < 30; it++) {
    const { d1, d2, d3 } = derivs(x, T, lam);
    if (d1 === 0) break;
    const xn = x - (2 * d1 * d2) / (2 * d2 * d2 - d1 * d3);
    const err = Math.abs(x - xn);
    x = xn;
    T = x2tof(x, lam, N);
    if (err < 1e-13) break;
  }
  return { x, T };
}

/**
 * All of Lambert's solutions from r1 to r2 in `tof` about `mu`, up to `maxRevs` revolutions: the
 * direct transfer, and for each N ≤ maxRevs the flight can last, a left and a right one. The transfer
 * goes round `normal` (prograde about it); `retrograde` the other way. Any consistent units.
 */
export function lambertAll(mu: number, r1: Vec3, r2: Vec3, tof: number, normal: Vec3, maxRevs = 0, retrograde = false): LambertSolution[] {
  if (!(tof > 0)) return [];
  const c = [r2[0] - r1[0], r2[1] - r1[1], r2[2] - r1[2]] as Vec3;
  const cn = norm(c),
    r1n = norm(r1),
    r2n = norm(r2);
  const s = (r1n + r2n + cn) / 2;
  const ir1 = scale(r1, 1 / r1n),
    ir2 = scale(r2, 1 / r2n);
  let ih = cross(ir1, ir2);
  // (r1 and r2 aligned: the plane the normal gives)
  if (norm(ih) < 1e-12) ih = unit(cross(cross(normal, ir1), ir1)).map((x) => -x) as Vec3;
  ih = unit(ih);
  const l2 = Math.max(1 - cn / s, 0);
  let lam = Math.sqrt(l2);
  let it1: Vec3, it2: Vec3;
  if (dot(ih, normal) < 0) {
    // (the short way goes against the normal: the transfer round it takes the long way)
    lam = -lam;
    it1 = cross(ir1, ih);
    it2 = cross(ir2, ih);
  } else {
    it1 = cross(ih, ir1);
    it2 = cross(ih, ir2);
  }
  if (retrograde) {
    lam = -lam;
    it1 = scale(it1, -1);
    it2 = scale(it2, -1);
  }
  it1 = unit(it1);
  it2 = unit(it2);
  const T = Math.sqrt((2 * mu) / s ** 3) * tof;
  // the revolutions the flight can make
  const T00 = Math.acos(lam) + lam * Math.sqrt(1 - lam * lam);
  const T1 = (2 / 3) * (1 - lam ** 3);
  let Nmax = Math.min(Math.floor(T / Math.PI), maxRevs);
  if (Nmax > 0 && T < T00 + Nmax * Math.PI) {
    const m = tmin(lam, Nmax);
    if (m.T > T) Nmax--;
  }
  const xs: { x: number; N: number; branch: LambertSolution["branch"] }[] = [];
  // the direct transfer
  let x0: number;
  if (T >= T00) x0 = -(T - T00) / (T - T00 + 4);
  else if (T <= T1) x0 = (T1 * (T1 - T)) / ((2 / 5) * (1 - lam ** 5) * T) + 1;
  else x0 = (T / T00) ** (Math.LN2 / Math.log(T1 / T00)) - 1;
  xs.push({ x: householder(T, x0, 0, lam), N: 0, branch: "direct" });
  for (let N = 1; N <= Nmax; N++) {
    let xl = ((N * Math.PI + Math.PI) / (8 * T)) ** (2 / 3);
    xl = (xl - 1) / (xl + 1);
    let xr = ((8 * T) / (N * Math.PI)) ** (2 / 3);
    xr = (xr - 1) / (xr + 1);
    xs.push({ x: householder(T, xl, N, lam), N, branch: "left" });
    xs.push({ x: householder(T, xr, N, lam), N, branch: "right" });
  }
  // the velocities from x
  const gamma = Math.sqrt((mu * s) / 2);
  const rho = (r1n - r2n) / cn;
  const sigma = Math.sqrt(Math.max(1 - rho * rho, 0));
  const out: LambertSolution[] = [];
  for (const { x, N, branch } of xs) {
    if (!Number.isFinite(x)) continue;
    const y = Math.sqrt(1 - lam * lam * (1 - x * x));
    const vr1 = (gamma * (lam * y - x - rho * (lam * y + x))) / r1n;
    const vr2 = (-gamma * (lam * y - x + rho * (lam * y + x))) / r2n;
    const vt = gamma * sigma * (y + lam * x);
    const v1: Vec3 = [0, 1, 2].map((i) => vr1 * ir1[i]! + (vt / r1n) * it1[i]!) as Vec3;
    const v2: Vec3 = [0, 1, 2].map((i) => vr2 * ir2[i]! + (vt / r2n) * it2[i]!) as Vec3;
    if (v1.every(Number.isFinite) && v2.every(Number.isFinite)) out.push({ v1, v2, revs: N, branch });
  }
  return out;
}
