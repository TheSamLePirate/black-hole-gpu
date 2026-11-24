// Pure CR3BP / ER3BP Lagrange-point and 3rd-order Richardson Halo math (unit-invariant).
// Zero simulator-engine imports so the independent Crew Console bundle (`src/crew/`) stays tiny.

import { add, cross, dot, len, scale, sub } from "../math/vec3";

export type V3 = [number, number, number];
export type LagrangeIndex = 1 | 2 | 3 | 4 | 5;
export type LagrangeId = `lag:${string}:${LagrangeIndex}`;

/** Routh's critical mass ratio μ_c = (1 − √(23/27)) / 2 ≈ 0.0385208965: L4 & L5 are linearly stable iff μ < μ_c. */
export const ROUTH_MU = (1 - Math.sqrt(23 / 27)) / 2;

/** Short pair codes for crisp map & HUD badges (e.g. "SE-L2", "EM-L1", "SJ-L4"). */
export const PAIR_SHORT: Record<string, string> = {
  mercury: "SMe",
  venus: "SV",
  earth: "SE",
  moon: "EM",
  mars: "SMa",
  ceres: "SC",
  jupiter: "SJ",
  saturn: "SS",
  uranus: "SU",
  neptune: "SN",
  pluto: "SP",
  io: "JI",
  europa: "JE",
  ganymede: "JG",
  callisto: "JC",
  titan: "ST",
  triton: "NT",
  charon: "PC",
};

/**
 * Sidereal orbital period [days] of each secondary about its primary (retrograde moons: < 0) — the one owner of the
 * pairs' mean motions n̄ for the Lagrange code of the game (system/lagrange.ts) and of the crew console (crew/sys3d):
 * the planets' from their mean longitude's rate (J2000 elements of solar.ts: 360° × 36525 / L̇), the Moon's sidereal
 * month, the moons' from their JPL mean elements (solar.ts `circle.period`); tests/lagrange-kinematics.test.ts checks
 * every body of solar.ts against it. n̄ sets the Halo clock's unwrapping and the pair's reference length R̄.
 */
export const PAIR_PERIOD_DAYS: Record<string, number> = {
  mercury: 87.96925644,
  venus: 224.70080117,
  earth: 365.25636713,
  moon: 27.321661,
  mars: 686.97973153,
  ceres: 1680.4478127,
  jupiter: 4332.81712752,
  saturn: 10755.88433613,
  uranus: 30687.4014436,
  neptune: 60189.65901628,
  pluto: 90552.98361143,
  phobos: 0.31891023,
  deimos: 1.26244,
  io: 1.769137786,
  europa: 3.551181041,
  ganymede: 7.15455296,
  callisto: 16.6890184,
  mimas: 0.942421959,
  enceladus: 1.370218,
  tethys: 1.887802,
  dione: 2.736915,
  rhea: 4.518212,
  titan: 15.945421,
  iapetus: 79.3215,
  triton: -5.876854,
  charon: 6.3872273,
};

/** A pair's mean motion n̄ [rad per time unit] (`secondsPerUnit`: 1 for seconds, M_SECONDS for the game's M), or null. */
export function pairMeanMotion(secondary: string, secondsPerUnit: number): number | null {
  const P = PAIR_PERIOD_DAYS[secondary];
  return P ? (2 * Math.PI * secondsPerUnit) / (Math.abs(P) * 86400) : null;
}

/**
 * The pair's time-independent reference length R̄ = (G(m₁+m₂)/n̄²)^⅓ [length unit of `gm`]: Halo and libration
 * amplitudes are made dimensionless by it (Az/(γ R̄)), so the orbit's shape and frequency stay constant while the
 * pulsating synodic frame scales them with the pair's distance R(t) (elliptic restricted problem).
 */
export function pairRefLength(gm: number, n: number): number {
  return Math.cbrt(gm / (n * n));
}

/** A body and its moons as one: their barycentre's position, velocity and summed GM (any consistent units). The game's
 *  Sun–planet pairs (lagrange.ts pairStates) and the crew console's map (crew/sys3d/scene.ts) both use it, so a Sun–Earth
 *  point is the Sun–(Earth+Moon) one on both screens. */
export function systemBarycentre(
  body: { p: V3; v: V3; m: number },
  moons: readonly { p: V3; v: V3; m: number }[],
): { p: V3; v: V3; m: number } {
  if (!moons.length) return body;
  let m = body.m;
  const p: V3 = [body.p[0] * body.m, body.p[1] * body.m, body.p[2] * body.m];
  const v: V3 = [body.v[0] * body.m, body.v[1] * body.m, body.v[2] * body.m];
  for (const q of moons) {
    m += q.m;
    for (let k = 0; k < 3; k++) {
      p[k]! += q.p[k]! * q.m;
      v[k]! += q.v[k]! * q.m;
    }
  }
  return { p: [p[0] / m, p[1] / m, p[2] / m], v: [v[0] / m, v[1] / m, v[2] / m], m };
}

const LAG_RE = /^lag:([a-z0-9]+):([1-5])$/;

/** True if `id` is a canonical Lagrange point target id ("lag:<secondary>:<1..5>"). */
export function isLagrangeId(id: string | unknown): id is LagrangeId {
  return typeof id === "string" && LAG_RE.test(id);
}

/** Builds a canonical Lagrange point id ("lag:earth:2" = Sun–Earth L2, "lag:moon:1" = Earth–Moon L1). */
export function lagrangeId(secondary: string, index: LagrangeIndex): LagrangeId {
  return `lag:${secondary}:${index}`;
}

/** Compact label for 3D map pins & badges ("SE-L2", "EM-L4", …). */
export function lagrangeShortName(id: string): string {
  const m = LAG_RE.exec(id);
  if (!m) return id;
  const secondary = m[1]!;
  const index = m[2]!;
  const code = PAIR_SHORT[secondary] ?? secondary.slice(0, 2).toUpperCase();
  return `${code}-L${index}`;
}

/**
 * Exact dimensionless collinear Lagrange point offsets (CR3BP, barycentric x-axis from P1 at −μ to P2 at 1−μ):
 *  - L1: x = 1 − μ − γ1  (between P1 and P2, distance γ1 from P2)
 *  - L2: x = 1 − μ + γ2  (beyond P2, distance γ2 from P2)
 *  - L3: x = −μ − γ3     (beyond P1, distance γ3 from P1)
 */
export function collinearGamma(mu: number, index: 1 | 2 | 3): number {
  const m1 = 1 - mu;
  if (index === 1) {
    const rh = Math.cbrt(mu / 3);
    let g = Math.min(Math.max(rh * (1 - rh / 3 - (rh * rh) / 9), 1e-12), 0.999999);
    for (let it = 0; it < 20; it++) {
      const a = 1 - g;
      const f = m1 / (a * a) - mu / (g * g) - (m1 - g);
      const df = (2 * m1) / (a * a * a) + (2 * mu) / (g * g * g) + 1;
      const dg = f / df;
      g = Math.min(Math.max(g - dg, 1e-15), 1 - 1e-15);
      if (Math.abs(dg) < 1e-15 * g) break;
    }
    return g;
  }
  if (index === 2) {
    const rh = Math.cbrt(mu / 3);
    let g = Math.max(rh * (1 + rh / 3 - (rh * rh) / 9), 1e-12);
    for (let it = 0; it < 20; it++) {
      const a = 1 + g;
      const f = m1 / (a * a) + mu / (g * g) - (m1 + g);
      const df = -(2 * m1) / (a * a * a) - (2 * mu) / (g * g * g) - 1;
      const dg = f / df;
      g = Math.max(g - dg, 1e-15);
      if (Math.abs(dg) < 1e-15 * g) break;
    }
    return g;
  }
  let g = Math.max(1 - (7 / 12) * mu, 0.5);
  for (let it = 0; it < 20; it++) {
    const a = 1 + g;
    const f = m1 / (g * g) + mu / (a * a) - (mu + g);
    const df = -(2 * m1) / (g * g * g) - (2 * mu) / (a * a * a) - 1;
    const dg = f / df;
    g = Math.max(g - dg, 1e-12);
    if (Math.abs(dg) < 1e-15 * g) break;
  }
  return g;
}

/** Dimensionless barycentric synodic coordinates (ξ, η) of L1..L5 for mass ratio μ = m2/(m1+m2). */
export function lagrangeSynodicCoords(mu: number, index: LagrangeIndex): { xi: number; eta: number; gamma: number } {
  if (index === 1) {
    const g = collinearGamma(mu, 1);
    return { xi: 1 - mu - g, eta: 0, gamma: g };
  }
  if (index === 2) {
    const g = collinearGamma(mu, 2);
    return { xi: 1 - mu + g, eta: 0, gamma: g };
  }
  if (index === 3) {
    const g = collinearGamma(mu, 3);
    return { xi: -mu - g, eta: 0, gamma: g };
  }
  if (index === 4) return { xi: 0.5 - mu, eta: Math.sqrt(3) / 2, gamma: 1 };
  return { xi: 0.5 - mu, eta: -Math.sqrt(3) / 2, gamma: 1 };
}

/** Synodic rotating frame built from two bodies' instantaneous positions, velocities, and masses (any consistent units). */
export interface SynodicFrame {
  B: V3;
  vB: V3;
  ex: V3;
  ey: V3;
  ez: V3;
  R: number;
  Rdot: number;
  omega: number;
  omegaVec: V3;
  mu: number;
  gm: number;
}

export function synodicFrameFromStates(p1: V3, v1: V3, m1: number, p2: V3, v2: V3, m2: number): SynodicFrame {
  const gm = m1 + m2;
  const mu = m2 / gm;
  const B: V3 = [(1 - mu) * p1[0] + mu * p2[0], (1 - mu) * p1[1] + mu * p2[1], (1 - mu) * p1[2] + mu * p2[2]];
  const vB: V3 = [(1 - mu) * v1[0] + mu * v2[0], (1 - mu) * v1[1] + mu * v2[1], (1 - mu) * v1[2] + mu * v2[2]];
  const d = sub(p2, p1);
  const vr = sub(v2, v1);
  const R = len(d);
  const ex = scale(d, 1 / Math.max(R, 1e-30));
  let h = cross(d, vr);
  let hl = len(h);
  if (!(hl > 1e-30)) {
    h = cross(ex, Math.abs(ex[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]);
    hl = len(h);
  }
  const ez = scale(h, 1 / hl);
  const ey = cross(ez, ex);
  const Rdot = dot(d, vr) / Math.max(R, 1e-30);
  const omega = hl / Math.max(R * R, 1e-30);
  const omegaVec = scale(ez, omega);
  return { B, vB, ex, ey, ez, R, Rdot, omega, omegaVec, mu, gm };
}

/**
 * Computes a Lagrange point's position and velocity directly from two bodies' states (arbitrary consistent units:
 * works both in home-frame M/c and on the crew console in km / km/s).
 */
export function lagrangeFromStates(
  p1: V3,
  v1: V3,
  m1: number,
  p2: V3,
  v2: V3,
  m2: number,
  index: LagrangeIndex,
): { pos: V3; vel: V3; frame: SynodicFrame; gamma: number; xi: number; eta: number } {
  const frame = synodicFrameFromStates(p1, v1, m1, p2, v2, m2);
  const { xi, eta, gamma } = lagrangeSynodicCoords(frame.mu, index);
  const relUnit = add(scale(frame.ex, xi), frame.ey, eta);
  const offset = scale(relUnit, frame.R);
  const pos = add(frame.B, offset);
  const vel = add(add(frame.vB, relUnit, frame.Rdot), cross(frame.omegaVec, offset));
  return { pos, vel, frame, gamma, xi, eta };
}

/** Legendre expansion coefficients c_n (Richardson 1980) for collinear L1, L2, L3. */
export function collinearCn(mu: number, index: 1 | 2 | 3, gamma: number, n: number): number {
  const m1 = 1 - mu;
  const g3 = gamma * gamma * gamma;
  if (index === 1) {
    return (1 / g3) * (mu + ((-1) ** n * m1 * gamma ** (n + 1)) / (1 - gamma) ** (n + 1));
  }
  if (index === 2) {
    return ((-1) ** n / g3) * (mu + (m1 * gamma ** (n + 1)) / (1 + gamma) ** (n + 1));
  }
  return (1 / g3) * (m1 + (mu * gamma ** (n + 1)) / (1 + gamma) ** (n + 1));
}

export interface RichardsonCoeffs {
  gamma: number;
  lam: number;
  k: number;
  omega: number;
  /** in-plane and vertical amplitudes (units of γ R̄) */
  Ax: number;
  Az: number;
  /** the amplitude asked was outside HALO_AZ_DIM and was brought into it */
  clamped: boolean;
  /** no Halo family at that amplitude (the planar Lyapunov limit kept for Ax) */
  noFamily: boolean;
  a21: number;
  a22: number;
  a23: number;
  a24: number;
  a31: number;
  a32: number;
  b21: number;
  b22: number;
  b31: number;
  b32: number;
  d21: number;
  d31: number;
  d32: number;
}

/** Richardson (1980) 3rd-order Halo expansion coefficients for collinear L1, L2, L3. */
export function richardsonCoeffs(mu: number, index: 1 | 2 | 3, gamma: number, azDimless: number): RichardsonCoeffs {
  const c2 = collinearCn(mu, index, gamma, 2);
  const c3 = collinearCn(mu, index, gamma, 3);
  const c4 = collinearCn(mu, index, gamma, 4);
  const disc = Math.sqrt(Math.max(0, 9 * c2 * c2 - 8 * c2));
  const lam = Math.sqrt(Math.max(1e-12, (2 - c2 + disc) / 2));
  const k = (lam * lam + 1 + 2 * c2) / (2 * lam);
  const d1 = ((3 * lam * lam) / k) * (k * (6 * lam * lam - 1) - 2 * lam);
  const d2 = ((8 * lam * lam) / k) * (k * (11 * lam * lam - 1) - 2 * lam);

  const a21 = (3 * c3 * (k * k - 2)) / (4 * (1 + 2 * c2));
  const a22 = (3 * c3) / (4 * (1 + 2 * c2));
  const a23 = ((-3 * c3 * lam) / (4 * k * d1)) * (3 * k * k * k * lam - 6 * k * (k - lam) + 4);
  const a24 = ((-3 * c3 * lam) / (4 * k * d1)) * (2 + 3 * k * lam);
  const b21 = ((-3 * c3 * lam) / (2 * d1)) * (3 * k * lam - 4);
  const b22 = (3 * c3 * lam) / d1;
  const d21 = -c3 / (2 * lam * lam);

  const a31 =
    ((-9 * lam) / (4 * d2)) * (4 * c3 * (k * a23 - b21) + k * c4 * (4 + k * k)) +
    ((9 * lam * lam + 1 - c2) / (2 * d2)) * (3 * c3 * (2 * a23 - k * b21) + c4 * (2 + 3 * k * k));
  const a32 =
    (-1 / d2) *
    (((9 * lam) / 4) * (4 * c3 * (k * a24 - b22) + k * c4) + 1.5 * (9 * lam * lam + 1 - c2) * (c3 * (k * b22 + d21 - 2 * a24) - c4));
  const b31 =
    (3 / (8 * d2)) *
    (8 * lam * (3 * c3 * (k * b21 - 2 * a23) - c4 * (2 + 3 * k * k)) +
      (9 * lam * lam + 1 + 2 * c2) * (4 * c3 * (k * a23 - b21) + k * c4 * (4 + k * k)));
  const b32 =
    (1 / d2) *
    (9 * lam * (c3 * (k * b22 + d21 - 2 * a24) - c4) + (3 / 8) * (9 * lam * lam + 1 + 2 * c2) * (4 * c3 * (k * a24 - b22) + k * c4));
  const d31 = (3 / (64 * lam * lam)) * (4 * c3 * a24 + c4);
  const d32 = (3 / (64 * lam * lam)) * (4 * c3 * (a23 - d21) + c4 * (4 + k * k));

  const denS = 2 * lam * (lam * (1 + k * k) - 2 * k);
  const s1 =
    (1 / denS) * (1.5 * c3 * (2 * a21 * (k * k - 2) - a23 * (k * k + 2) - 2 * k * b21) - 0.375 * c4 * (3 * k ** 4 - 8 * k * k + 8));
  const s2 = (1 / denS) * (1.5 * c3 * (2 * a22 * (k * k - 2) + a24 * (k * k + 2) + 2 * k * b22 + 5 * d21) + 0.375 * c4 * (12 - k * k));

  const l1 = -1.5 * c3 * (2 * a21 + a23 + 5 * d21) - 0.375 * c4 * (12 - k * k) + 2 * lam * lam * s1;
  const l2 = 1.5 * c3 * (a24 - 2 * a22) + (9 / 8) * c4 + 2 * lam * lam * s2;
  const delta = lam * lam - c2;

  // (the amplitude asked, kept within the expansion's range — HALO_AZ_DIM; what was done to it said, not hidden: the
  // callers report the effective amplitude — lagrange.ts haloAzRangeM, the FC's field, the planner's note)
  const Az = Math.min(Math.max(azDimless, HALO_AZ_DIM[0]), HALO_AZ_DIM[1]);
  // the in-plane amplitude the Halo's frequency condition ties to Az (Richardson's l₁Ax² + l₂Az² + Δ = 0); none real:
  // no Halo family there — the planar Lyapunov limit Ax = √(−Δ/l₁) kept, flagged (never met for the solar system's
  // pairs over HALO_AZ_DIM: tests/lagrange-kinematics.test.ts)
  const ax2 = (-l2 * Az * Az - delta) / l1;
  const noFamily = !(ax2 > 0);
  const Ax = noFamily ? Math.sqrt(Math.max(-delta / l1, 0)) : Math.sqrt(ax2);
  const omega = 1 + s1 * Ax * Ax + s2 * Az * Az;
  return {
    gamma,
    lam,
    k,
    omega,
    Ax,
    Az,
    clamped: Az !== azDimless,
    noFamily,
    a21,
    a22,
    a23,
    a24,
    a31,
    a32,
    b21,
    b22,
    b31,
    b32,
    d21,
    d31,
    d32,
  };
}

/** The range of dimensionless vertical amplitudes Az/(γ R̄) over which the 3rd-order expansion is used: below, the
 *  orbit is a Lissajous of vanishing height better flown as a Lyapunov orbit; above, the series is out of its depth. */
export const HALO_AZ_DIM: readonly [number, number] = [0.01, 0.65];

/** Richardson's 3rd-order Halo shape s(τ) about a collinear point (units of γ, synodic axes from the point) and its
 *  first and second derivatives with respect to the phase τ. `branch` −1: southern (JWST's), +1: northern. */
export function richardsonShape(C: RichardsonCoeffs, branch: 1 | -1, tau: number): { s: V3; ds: V3; dds: V3 } {
  const c1 = Math.cos(tau),
    s1 = Math.sin(tau);
  const c2 = Math.cos(2 * tau),
    s2 = Math.sin(2 * tau);
  const c3 = Math.cos(3 * tau),
    s3 = Math.sin(3 * tau);
  const Ax = C.Ax,
    Az = C.Az;
  const Ax2 = Ax * Ax,
    Az2 = Az * Az,
    Ax3 = Ax2 * Ax;
  const k2x = C.a23 * Ax2 - C.a24 * Az2;
  const k3x = C.a31 * Ax3 - C.a32 * Ax * Az2;
  const k2y = C.b21 * Ax2 - C.b22 * Az2;
  const k3y = C.b31 * Ax3 - C.b32 * Ax * Az2;
  const k3z = C.d32 * Az * Ax2 - C.d31 * Az * Az2;
  return {
    s: [
      C.a21 * Ax2 + C.a22 * Az2 - Ax * c1 + k2x * c2 + k3x * c3,
      C.k * Ax * s1 + k2y * s2 + k3y * s3,
      branch * (Az * c1 + C.d21 * Ax * Az * (c2 - 3) + k3z * c3),
    ],
    ds: [
      Ax * s1 - 2 * k2x * s2 - 3 * k3x * s3,
      C.k * Ax * c1 + 2 * k2y * c2 + 3 * k3y * c3,
      branch * (-Az * s1 - 2 * C.d21 * Ax * Az * s2 - 3 * k3z * s3),
    ],
    dds: [
      Ax * c1 - 4 * k2x * c2 - 9 * k3x * c3,
      -C.k * Ax * s1 - 4 * k2y * s2 - 9 * k3y * s3,
      branch * (-Az * c1 - 4 * C.d21 * Ax * Az * c2 - 9 * k3z * c3),
    ],
  };
}

/**
 * The linear libration modes about a triangular point L4/L5 (CR3BP, unit distance and rate): the in-plane short-period
 * mode — the epicycle of the Trojans, ν_s = √((1 + √(1 − 27μ(1−μ)))/2), period ≈ the pair's — as its complex
 * eigenvector (a, b) on the synodic axes (x along the primaries' line, y ahead), normalised to a unit semi-major axis,
 * and the vertical one (frequency 1: U_zz = −1 at L4/L5, independent of the in-plane one). For μ above Routh's limit
 * (Pluto–Charon) no oscillating mode exists: `stable` false, the loop then a forced circle at the pair's rate
 * (radial/tangential about the point), held by thrust.
 */
export function triangularMode(mu: number, index: 4 | 5): { stable: boolean; nu: number; a: [number, number]; b: [number, number] } {
  const eta = index === 4 ? Math.sqrt(3) / 2 : -Math.sqrt(3) / 2;
  // the effective potential's Hessian at the point (r₁ = r₂ = 1)
  const x = 0.5 - mu;
  const xp = x + mu,
    xs = x - 1 + mu;
  // (U_yy = 9/4 completes it; the eigenvector needs only the first row)
  const Uxx = 1 - (1 - mu) - mu + 3 * (1 - mu) * xp * xp + 3 * mu * xs * xs;
  const Uxy = 3 * (1 - mu) * xp * eta + 3 * mu * xs * eta;
  const disc = 1 - 27 * mu * (1 - mu);
  if (!(disc >= 0)) {
    // (forced loop: x = cos τ, y = sin τ on the radial/tangential axes of the point, expressed on the synodic axes)
    const r: [number, number] = [x, eta];
    const rl = Math.hypot(...r);
    const er: [number, number] = [r[0] / rl, r[1] / rl];
    const et: [number, number] = [-er[1], er[0]];
    // Re((a, b) e^{iτ}) = er cos τ + et sin τ: a = er_x − i et_x, b = er_y − i et_y
    return { stable: false, nu: 1, a: [er[0], -et[0]], b: [er[1], -et[1]] };
  }
  const nu = Math.sqrt((1 + Math.sqrt(disc)) / 2);
  // (−ν² − Uxx) a + (−2iν − Uxy) b = 0 with a = 1: b = (ν² + Uxx) / (−Uxy − 2iν)
  const nr = nu * nu + Uxx;
  const dr = -Uxy,
    di = -2 * nu;
  const dd = dr * dr + di * di;
  let a: [number, number] = [1, 0];
  let b: [number, number] = [(nr * dr) / dd, (-nr * di) / dd];
  // the ellipse Re((a, b) e^{iτ}): its semi-major axis √((|a|² + |b|² + |a² + b²|)/2) made 1
  const sq = (z: [number, number]): [number, number] => [z[0] * z[0] - z[1] * z[1], 2 * z[0] * z[1]];
  const a2 = sq(a),
    b2 = sq(b);
  const semi = Math.sqrt((1 + b[0] * b[0] + b[1] * b[1] + Math.hypot(a2[0] + b2[0], a2[1] + b2[1])) / 2);
  a = [a[0] / semi, a[1] / semi];
  b = [b[0] / semi, b[1] / semi];
  return { stable: true, nu, a, b };
}

/** The triangular loop's offset from L4/L5 (units of R̄, synodic axes) and its derivatives with respect to the in-plane
 *  phase τ and the vertical phase τ_z: Re((a, b) e^{iτ}) in the plane, branch · cos τ_z out of it. */
export function triangularShape(
  m: { a: [number, number]; b: [number, number] },
  branch: 1 | -1,
  tau: number,
  tauZ: number,
): { s: V3; dsIn: V3; ddsIn: V3; dsZ: number; ddsZ: number } {
  const c = Math.cos(tau),
    sn = Math.sin(tau);
  // Re((p + iq)(cos τ + i sin τ)) = p cos τ − q sin τ
  const re = (z: [number, number]) => z[0] * c - z[1] * sn;
  const dre = (z: [number, number]) => -z[0] * sn - z[1] * c;
  const cz = Math.cos(tauZ),
    sz = Math.sin(tauZ);
  return {
    s: [re(m.a), re(m.b), branch * cz],
    dsIn: [dre(m.a), dre(m.b), 0],
    ddsIn: [-re(m.a), -re(m.b), 0],
    dsZ: -branch * sz,
    ddsZ: -branch * cz,
  };
}

/** A pair's synodic frame with its time derivatives: the barycentre's motion, the distance R and its rates, the axes
 *  (e_x from the primary to the secondary, e_z along their relative angular momentum) and their first and second
 *  derivatives, the frame's full rotation vector Ω (e_i′ = Ω × e_i: the turn about e_z and the plane's own tilt). */
export interface SynodicKinematics {
  B: V3;
  vB: V3;
  aB: V3;
  R: number;
  dR: number;
  ddR: number;
  e: [V3, V3, V3];
  de: [V3, V3, V3];
  dde: [V3, V3, V3];
  frame: SynodicFrame;
}

/**
 * The synodic frame's kinematics from the two bodies' positions, velocities, accelerations and jerks (any consistent
 * units; the accelerations and jerks of the game's ephemerides are finite differences of their velocities —
 * lagrange.ts pairKinematics). Exact derivatives of the frame the positions define: a point at fixed synodic
 * coordinates gets its true inertial velocity and acceleration from `synodicPoint`.
 */
export function synodicKinematics(
  p1: V3,
  v1: V3,
  a1: V3,
  j1: V3,
  m1: number,
  p2: V3,
  v2: V3,
  a2: V3,
  j2: V3,
  m2: number,
): SynodicKinematics {
  const gm = m1 + m2;
  const mu = m2 / gm;
  const mix = (x: V3, y: V3): V3 => [(1 - mu) * x[0] + mu * y[0], (1 - mu) * x[1] + mu * y[1], (1 - mu) * x[2] + mu * y[2]];
  const B = mix(p1, p2),
    vB = mix(v1, v2),
    aB = mix(a1, a2);
  const d = sub(p2, p1),
    d1 = sub(v2, v1),
    d2 = sub(a2, a1),
    d3 = sub(j2, j1);
  const R = len(d);
  const ex = scale(d, 1 / R);
  const dR = dot(ex, d1);
  const dex = scale(sub(d1, scale(ex, dR)), 1 / R);
  const ddR = dot(dex, d1) + dot(ex, d2);
  const ddex = scale(sub(sub(d2, scale(ex, ddR)), scale(dex, 2 * dR)), 1 / R);
  // e_z = h/|h|, h = d × d′: h′ = d × d″, h″ = d′ × d″ + d × d‴
  const h = cross(d, d1);
  const hk = len(h);
  const ez = scale(h, 1 / hk);
  const h1 = cross(d, d2);
  const h2 = add(cross(d1, d2), cross(d, d3));
  const k1 = dot(ez, h1);
  const dez = scale(sub(h1, scale(ez, k1)), 1 / hk);
  const k2 = dot(dez, h1) + dot(ez, h2);
  // n″ = h″/k − 2h′k′/k² − h k″/k² + 2h k′²/k³
  const ddez = add(add(scale(h2, 1 / hk), scale(h1, (-2 * k1) / (hk * hk))), scale(h, (-k2 + (2 * k1 * k1) / hk) / (hk * hk)));
  const ey = cross(ez, ex);
  const dey = add(cross(dez, ex), cross(ez, dex));
  const ddey = add(add(cross(ddez, ex), scale(cross(dez, dex), 2)), cross(ez, ddex));
  const omega = hk / (R * R);
  // Ω = (e_y′·e_z) e_x + (e_z′·e_x) e_y + (e_x′·e_y) e_z
  const omegaVec = add(add(scale(ex, dot(dey, ez)), ey, dot(dez, ex)), ez, dot(dex, ey));
  return {
    B,
    vB,
    aB,
    R,
    dR,
    ddR,
    e: [ex, ey, ez],
    de: [dex, dey, dez],
    dde: [ddex, ddey, ddez],
    frame: { B, vB, ex, ey, ez, R, Rdot: dR, omega, omegaVec, mu, gm },
  };
}

/**
 * The inertial position, velocity and acceleration of a point given by its dimensionless synodic coordinates u(t)
 * (barycentric, in units of the pair's distance R(t) — the pulsating frame of the elliptic problem) and their first
 * and second time derivatives: pos = B + R Σ uᵢ eᵢ, differentiated exactly.
 */
export function synodicPoint(k: SynodicKinematics, u: V3, du: V3, ddu: V3): { pos: V3; vel: V3; acc: V3 } {
  const pos: V3 = [k.B[0], k.B[1], k.B[2]];
  const vel: V3 = [k.vB[0], k.vB[1], k.vB[2]];
  const acc: V3 = [k.aB[0], k.aB[1], k.aB[2]];
  for (let i = 0; i < 3; i++) {
    const w = k.R * u[i]!;
    const w1 = k.dR * u[i]! + k.R * du[i]!;
    const w2 = k.ddR * u[i]! + 2 * k.dR * du[i]! + k.R * ddu[i]!;
    const e = k.e[i]!,
      e1 = k.de[i]!,
      e2 = k.dde[i]!;
    for (let c = 0; c < 3; c++) {
      pos[c]! += w * e[c]!;
      vel[c]! += w1 * e[c]! + w * e1[c]!;
      acc[c]! += w2 * e[c]! + 2 * w1 * e1[c]! + w * e2[c]!;
    }
  }
  return { pos, vel, acc };
}

/**
 * A libration orbit about a Lagrange point, in dimensionless synodic coordinates (barycentric, units of the pair's
 * distance R(t)), clocked by the pair's synodic angle θ (the secondary's angle about the primary — its true anomaly
 * in the elliptic problem): about L1–L3, Richardson's 3rd-order Halo with phase τ = ν θ + φ₀, ν = λ ω_c (its
 * frequency in units of the pair's rate); about L4/L5, the short-period libration mode in the plane (ν_s θ + φ₀)
 * and the vertical one (θ + φ₀). Its shape and ν are constant (amplitudes in units of the reference length R̄,
 * pairRefLength), so the phase τ(t) needs only θ(t), unwrapped: no instantaneous rate integrated over decades.
 */
export type LibrationModel =
  | { kind: "halo"; index: 1 | 2 | 3; xi: number; eta: number; gamma: number; nu: number; C: RichardsonCoeffs }
  | {
      kind: "loop";
      index: 4 | 5;
      xi: number;
      eta: number;
      nu: number;
      amp: number;
      mode: ReturnType<typeof triangularMode>;
      clamped: boolean;
    };

/** The triangular loops' amplitude range [units of R̄]: from a 10⁻⁵ wobble to 5 % of the pair's distance, where the
 *  linear modes still describe the motion. */
export const LOOP_AMP_DIM: readonly [number, number] = [1e-5, 0.05];

/** The libration model of `index` for mass ratio μ and amplitude `azOverRef` = A_z / R̄ (A_z: the vertical amplitude;
 *  about L4/L5 also the in-plane semi-major axis). */
export function librationModel(mu: number, index: LagrangeIndex, azOverRef: number): LibrationModel {
  const { xi, eta, gamma } = lagrangeSynodicCoords(mu, index);
  if (index <= 3) {
    const C = richardsonCoeffs(mu, index as 1 | 2 | 3, gamma, azOverRef / gamma);
    return { kind: "halo", index: index as 1 | 2 | 3, xi, eta, gamma, nu: C.lam * C.omega, C };
  }
  const mode = triangularMode(mu, index as 4 | 5);
  const amp = Math.min(Math.max(azOverRef, LOOP_AMP_DIM[0]), LOOP_AMP_DIM[1]);
  return { kind: "loop", index: index as 4 | 5, xi, eta, nu: mode.nu, amp, mode, clamped: amp !== azOverRef };
}

/** The vertical amplitudes a point's orbits can take, in the unit of `Rref` (the pair's reference length): Richardson's
 *  range about L1–L3 (HALO_AZ_DIM × γ R̄), the linear loops' about L4/L5 (LOOP_AMP_DIM × R̄). */
export function librationAzRange(mu: number, index: LagrangeIndex, Rref: number): [number, number] {
  const u = Rref * (index <= 3 ? lagrangeSynodicCoords(mu, index).gamma : 1);
  const r = index <= 3 ? HALO_AZ_DIM : LOOP_AMP_DIM;
  return [r[0] * u, r[1] * u];
}

/**
 * A point's default orbit amplitude A_z, in the unit of `Rref` (`metresPerUnit`: 1 in metres, 1000 in km) — the game's
 * and the crew console's, one rule: JWST's 260,000 km about Sun–Earth L1/L2, the Gateway's 12,000 km about Earth–Moon
 * L1/L2, else 18 % of γ R̄ about L1/L2 (≥ 5,000 km), 4 % of R̄ about L3 (≥ 50,000 km), a quarter of the Hill radius
 * about L4/L5 (≥ 10,000 km) — within the model's range. A constant of the point (R̄, not the day's distance).
 */
export function defaultLibrationAz(secondary: string, index: LagrangeIndex, mu: number, Rref: number, metresPerUnit: number): number {
  const m = (x: number) => x / metresPerUnit;
  let want: number;
  if (secondary === "earth" && index <= 2) want = m(260_000e3);
  else if (secondary === "moon" && index <= 2) want = m(12_000e3);
  else if (index <= 2) want = Math.max(m(5_000e3), lagrangeSynodicCoords(mu, index).gamma * Rref * 0.18);
  else if (index === 3) want = Math.max(m(50_000e3), Rref * 0.04);
  else want = Math.max(m(10_000e3), Rref * Math.cbrt(mu / 3) * 0.25);
  const [lo, hi] = librationAzRange(mu, index, Rref);
  return Math.min(Math.max(want, lo), hi);
}

/** The model's effective vertical amplitude [units of R̄] (after its range). */
export function librationAz(m: LibrationModel): number {
  return m.kind === "halo" ? m.C.Az * m.gamma : m.amp;
}

/** The orbit's synodic coordinates u(θ) (barycentric, units of R) and their first and second derivatives with respect
 *  to θ. */
export function librationOffset(m: LibrationModel, branch: 1 | -1, phase0: number, theta: number): { u: V3; du: V3; ddu: V3 } {
  if (m.kind === "halo") {
    const g = m.gamma,
      nu = m.nu;
    const S = richardsonShape(m.C, branch, nu * theta + phase0);
    // (Richardson's x counted from the point along e_x, in units of γ)
    return {
      u: [m.xi + g * S.s[0], m.eta + g * S.s[1], g * S.s[2]],
      du: [g * nu * S.ds[0], g * nu * S.ds[1], g * nu * S.ds[2]],
      ddu: [g * nu * nu * S.dds[0], g * nu * nu * S.dds[1], g * nu * nu * S.dds[2]],
    };
  }
  const A = m.amp,
    nu = m.nu;
  const S = triangularShape(m.mode, branch, nu * theta + phase0, theta + phase0);
  return {
    u: [m.xi + A * S.s[0], m.eta + A * S.s[1], A * S.s[2]],
    du: [A * nu * S.dsIn[0], A * nu * S.dsIn[1], A * S.dsZ],
    ddu: [A * nu * nu * S.ddsIn[0], A * nu * nu * S.ddsIn[1], A * S.ddsZ],
  };
}

/** One revolution of the orbit (the Halo's closed loop; the triangular loop over one in-plane period, its vertical
 *  swing at its own frequency) as points in a frame held at one instant: `B` the barycentre, `e` the axes, `R` the
 *  pair's distance then. */
export function librationLoop(
  m: LibrationModel,
  branch: 1 | -1,
  phase0: number,
  theta0: number,
  B: V3,
  e: readonly [V3, V3, V3],
  R: number,
  n: number,
): V3[] {
  const pts: V3[] = [];
  const span = (2 * Math.PI) / m.nu;
  for (let j = 0; j <= n; j++) {
    const { u } = librationOffset(m, branch, phase0, theta0 + (j / n) * span);
    pts.push(add(B, add(add(scale(e[0], R * u[0]), e[1], R * u[1]), e[2], R * u[2])));
  }
  return pts;
}

/**
 * Pure Halo loop from raw body states (km, km/s, km³/s²) — the crew console's 3D system map draws the game's own
 * orbits with it (the same model, normalised by the same reference length: `refLength` = pairRefLength(GM, n̄) of
 * the pair, km), so the network's JWST mark sits on its loop. Without `refLength` the instantaneous distance stands in.
 */
export function haloLoopFromStates(
  p1: V3,
  v1: V3,
  m1: number,
  p2: V3,
  v2: V3,
  m2: number,
  index: 1 | 2 | 3,
  azUnits: number,
  branch: 1 | -1 = -1,
  n = 72,
  refLength?: number,
): V3[] {
  const f = synodicFrameFromStates(p1, v1, m1, p2, v2, m2);
  const m = librationModel(f.mu, index, azUnits / (refLength ?? f.R));
  return librationLoop(m, branch, 0, 0, f.B, [f.ex, f.ey, f.ez], f.R, n);
}
