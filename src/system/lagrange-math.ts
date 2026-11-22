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
  Ax: number;
  Az: number;
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

  const Az = Math.min(Math.max(azDimless, 0.01), 0.65);
  const ax2 = (-l2 * Az * Az - delta) / l1;
  const Ax = ax2 > 0 ? Math.sqrt(ax2) : Az;
  const omega = 1 + s1 * Ax * Ax + s2 * Az * Az;
  return { gamma, lam, k, omega, Ax, Az, a21, a22, a23, a24, a31, a32, b21, b22, b31, b32, d21, d31, d32 };
}

/**
 * Pure Halo loop from raw body states (km, km/s, km³/s²) — used by the Crew Console's 3D System Map
 * so it can draw exact 3D Halo orbits around L1/L2 without depending on full solar ephemerides.
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
): V3[] {
  const L0 = lagrangeFromStates(p1, v1, m1, p2, v2, m2, index);
  const { frame, gamma } = L0;
  const scaleL = gamma * frame.R;
  const azDim = azUnits / Math.max(scaleL, 1e-30);
  const C = richardsonCoeffs(frame.mu, index, gamma, azDim);
  const Ax = C.Ax,
    Az = C.Az,
    Ax2 = Ax * Ax,
    Az2 = Az * Az,
    Ax3 = Ax2 * Ax;
  const k2x = C.a23 * Ax2 - C.a24 * Az2;
  const k3x = C.a31 * Ax3 - C.a32 * Ax * Az2;
  const k2y = C.b21 * Ax2 - C.b22 * Az2;
  const k3y = C.b31 * Ax3 - C.b32 * Ax * Az2;
  const k3z = C.d32 * Az * Ax2 - C.d31 * Az * Az2;
  const pts: V3[] = [];
  for (let j = 0; j <= n; j++) {
    const ph = (j / n) * 2 * Math.PI;
    const xs = C.a21 * Ax2 + C.a22 * Az2 - Ax * Math.cos(ph) + k2x * Math.cos(2 * ph) + k3x * Math.cos(3 * ph);
    const ys = C.k * Ax * Math.sin(ph) + k2y * Math.sin(2 * ph) + k3y * Math.sin(3 * ph);
    const zs = branch * (Az * Math.cos(ph) + C.d21 * Ax * Az * (Math.cos(2 * ph) - 3) + k3z * Math.cos(3 * ph));
    pts.push(add(L0.pos, add(add(scale(frame.ex, scaleL * xs), frame.ey, scaleL * ys), frame.ez, scaleL * zs)));
  }
  return pts;
}
