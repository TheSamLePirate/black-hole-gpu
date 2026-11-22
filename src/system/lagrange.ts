// Lagrange points (L1–L5), linear & Routh stability analysis, and 3rd-order Richardson Halo /
// Lissajous orbits for any two-body pair in our solar system (Sun–planet via system barycentre
// for planets with massive moons like Earth–Moon, and planet–moon pairs like Earth–Moon).
//
// Units match solar.ts / our-side.ts: lengths and times in M (10⁸ M☉), velocities in c, GM in M.
// Pure functions `lagrangeFromStates` also work in arbitrary consistent units (e.g. km, km/s, km³/s²
// on the crew console's 3D system map).

import type { Vec3 } from "../physics";
import { add, cross, dot, len, scale, sub } from "../math/vec3";
import { M_METRES, M_SECONDS, SOLAR_BODIES, solarBody, solarState } from "./solar";
import { predictOurs } from "./our-predict";
import { t, tf } from "../i18n";
import {
  collinearCn,
  collinearGamma,
  haloLoopFromStates,
  isLagrangeId,
  lagrangeFromStates,
  lagrangeId,
  lagrangeShortName,
  lagrangeSynodicCoords,
  PAIR_SHORT,
  richardsonCoeffs,
  ROUTH_MU,
  synodicFrameFromStates,
  type LagrangeId,
  type LagrangeIndex,
  type SynodicFrame,
} from "./lagrange-math";

export {
  collinearCn,
  collinearGamma,
  haloLoopFromStates,
  isLagrangeId,
  lagrangeFromStates,
  lagrangeId,
  lagrangeShortName,
  lagrangeSynodicCoords,
  ROUTH_MU,
  synodicFrameFromStates,
  type LagrangeId,
  type LagrangeIndex,
  type SynodicFrame,
};

/** Secondary bodies whose (parent, secondary) Lagrange points are shown/available by default. */
export const LAGRANGE_SECONDARIES: readonly string[] = [
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "venus",
  "mercury",
  "uranus",
  "neptune",
  "io",
  "europa",
  "ganymede",
  "callisto",
  "titan",
  "pluto",
  "charon",
];

/** Parses a canonical Lagrange point id into its primary, secondary, and L-index (null if invalid). */
export function parseLagrangeId(id: string): { primary: string; secondary: string; index: LagrangeIndex } | null {
  const m = /^lag:([a-z0-9]+):([1-5])$/.exec(id);
  if (!m) return null;
  const secondary = m[1]!;
  const index = Number(m[2]!) as LagrangeIndex;
  const b = solarBody(secondary);
  if (!b || !b.parent) return null;
  return { primary: b.parent, secondary, index };
}

/** Human-readable localized name ("Sun–Earth L2", "Soleil–Terre L2", "Earth–Moon L4"…). */
export function lagrangeName(id: string): string {
  const p = parseLagrangeId(id);
  if (!p) return id;
  const b1 = solarBody(p.primary);
  const b2 = solarBody(p.secondary);
  const n1 = b1 ? t(b1.name) : p.primary;
  const n2 = b2 ? t(b2.name) : p.secondary;
  return `${n1}–${n2} L${p.index}`;
}

/** All 5 Lagrange point ids for a secondary body (e.g. "earth" → Sun–Earth L1..L5). */
export function lagrangeIdsFor(secondary: string): LagrangeId[] {
  const b = solarBody(secondary);
  if (!b || !b.parent) return [];
  return ([1, 2, 3, 4, 5] as const).map((i) => lagrangeId(secondary, i));
}

const foldStr = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const BODY_ALIAS: Record<string, string> = {
  sun: "sun",
  soleil: "sun",
  earth: "earth",
  terre: "earth",
  moon: "moon",
  lune: "moon",
  mars: "mars",
  venus: "venus",
  mercury: "mercury",
  mercure: "mercury",
  jupiter: "jupiter",
  saturn: "saturn",
  saturne: "saturn",
  uranus: "uranus",
  neptune: "neptune",
  pluto: "pluto",
  pluton: "pluto",
  io: "io",
  europa: "europa",
  europe: "europa",
  ganymede: "ganymede",
  callisto: "callisto",
  titan: "titan",
  charon: "charon",
  triton: "triton",
};

/**
 * Resolves a human query (French or English, short or long) into a canonical LagrangeId:
 * "lag:earth:2", "SE-L2", "Sun-Earth L2", "Soleil-Terre L2", "Earth-Moon L4", "Terre-Lune L1",
 * "L2" (defaults to Sun–Earth L2, or current context secondary if passed), "Mars L2", "Jupiter L4"…
 */
export function resolveLagrangeName(query: string, contextSecondary = "earth"): LagrangeId | null {
  const raw = query.trim();
  if (isLagrangeId(raw.toLowerCase())) return raw.toLowerCase() as LagrangeId;
  const f = foldStr(raw).replace(/[–—_]/g, "-");
  // match L1..L5 anywhere as a token
  const lm = f.match(/(?:^|[\s-])l([1-5])(?:$|[\s-])/);
  if (!lm) return null;
  const index = Number(lm[1]!) as LagrangeIndex;
  // strip the L-token to inspect the pair/body
  const rest = f.replace(/(?:^|[\s-])l[1-5](?:$|[\s-])/, " ").trim();
  if (!rest) {
    const sec = solarBody(contextSecondary)?.parent ? contextSecondary : "earth";
    return lagrangeId(sec, index);
  }
  // short codes: SE, EM, SJ, SMa, SS, etc.
  const compact = rest.replace(/[\s-]+/g, "");
  for (const [sec, code] of Object.entries(PAIR_SHORT)) {
    if (code.toLowerCase() === compact) return lagrangeId(sec, index);
  }
  // explicit pair or single secondary name ("sun-earth", "soleil terre", "earth-moon", "terre-lune", "mars", "jupiter")
  const tokens = rest.split(/[\s\-/]+/).filter(Boolean);
  const resolved = tokens.map((tok) => BODY_ALIAS[tok] ?? (solarBody(tok) ? tok : null)).filter((x): x is string => !!x);
  if (resolved.length === 1) {
    const b = solarBody(resolved[0]!);
    if (b?.parent) return lagrangeId(b.id, index);
  }
  if (resolved.length >= 2) {
    const [a, b] = [resolved[0]!, resolved[1]!];
    if (solarBody(b)?.parent === a) return lagrangeId(b, index);
    if (solarBody(a)?.parent === b) return lagrangeId(a, index);
  }
  return null;
}

// ------------------------------------------------------------------------------------ solar-system pairs (with system barycentre)

const MOONS_BY_PARENT = new Map<string, typeof SOLAR_BODIES>();
for (const b of SOLAR_BODIES) {
  if (b.parent && b.parent !== "sun") {
    MOONS_BY_PARENT.set(b.parent, [...(MOONS_BY_PARENT.get(b.parent) ?? []), b]);
  }
}

/**
 * Effective state and mass of a pair (primary, secondary) at scene time t [M]:
 * For Sun–Planet pairs whose planet has moons (crucially Sun–Earth + Moon!), uses the planet system's
 * barycentre and combined mass so Sun–Earth L1–L5 match JPL's real Sun–EMB CR3BP without monthly wobble.
 */
export function pairStates(
  secondary: string,
  t: number,
): {
  primary: string;
  secondary: string;
  p1: Vec3;
  v1: Vec3;
  m1: number;
  p2: Vec3;
  v2: Vec3;
  m2: number;
} | null {
  const b2 = solarBody(secondary);
  if (!b2 || !b2.parent) return null;
  const b1 = solarBody(b2.parent);
  if (!b1) return null;
  const s1 = solarState(b1.id, t);
  const s2 = solarState(b2.id, t);
  let p2 = s2.pos;
  let v2 = s2.vel;
  let m2 = b2.mass;
  if (b1.id === "sun") {
    const moons = MOONS_BY_PARENT.get(b2.id);
    if (moons && moons.length) {
      let mTot = m2;
      let px = p2[0] * m2,
        py = p2[1] * m2,
        pz = p2[2] * m2;
      let vx = v2[0] * m2,
        vy = v2[1] * m2,
        vz = v2[2] * m2;
      for (const q of moons) {
        const sq = solarState(q.id, t);
        mTot += q.mass;
        px += sq.pos[0] * q.mass;
        py += sq.pos[1] * q.mass;
        pz += sq.pos[2] * q.mass;
        vx += sq.vel[0] * q.mass;
        vy += sq.vel[1] * q.mass;
        vz += sq.vel[2] * q.mass;
      }
      p2 = [px / mTot, py / mTot, pz / mTot];
      v2 = [vx / mTot, vy / mTot, vz / mTot];
      m2 = mTot;
    }
  }
  return { primary: b1.id, secondary: b2.id, p1: s1.pos, v1: s1.vel, m1: b1.mass, p2, v2, m2 };
}

export interface LagrangeState {
  id: LagrangeId;
  primary: string;
  secondary: string;
  index: LagrangeIndex;
  /** home-frame position [M] and velocity [c] */
  pos: Vec3;
  vel: Vec3;
  /** instantaneous synodic frame */
  frame: SynodicFrame;
  /** dimensionless offset γ (distance from secondary for L1/L2, from primary for L3, 1 for L4/L5) */
  gamma: number;
  /** barycentric synodic coordinates (ξ, η) */
  xi: number;
  eta: number;
  /** distance from the secondary body [M] */
  distSecondary: number;
  /** Hill radius of the secondary [M] */
  hill: number;
}

/** State of a solar-system Lagrange point at scene time t [M] in the home frame. */
export function lagrangeState(id: string, t: number): LagrangeState | null {
  const parsed = parseLagrangeId(id);
  if (!parsed) return null;
  const pair = pairStates(parsed.secondary, t);
  if (!pair) return null;
  const r = lagrangeFromStates(pair.p1, pair.v1, pair.m1, pair.p2, pair.v2, pair.m2, parsed.index);
  const distSecondary = len(sub(r.pos, pair.p2));
  const hill = r.frame.R * Math.cbrt(r.frame.mu / 3);
  return {
    id: id as LagrangeId,
    primary: parsed.primary,
    secondary: parsed.secondary,
    index: parsed.index,
    pos: r.pos,
    vel: r.vel,
    frame: r.frame,
    gamma: r.gamma,
    xi: r.xi,
    eta: r.eta,
    distSecondary,
    hill,
  };
}

// ------------------------------------------------------------------------------------ linear & Routh stability analysis

export interface LagrangeStability {
  id: LagrangeId;
  index: LagrangeIndex;
  mu: number;
  /** true for L4/L5 when μ < μ_Routh (≈ 0.0385209); always false for L1/L2/L3 */
  linearlyStable: boolean;
  kind: "saddle" | "stable" | "unstable-triangular";
  /** collinear: real exponential growth eigenvalue λ (dimensionless); triangular unstable: Re(λ) */
  lambdaReal: number;
  /** e-folding divergence timescale τ = 1/(λ·ω) [days] (Infinity when linearly stable) */
  eFoldDays: number;
  /** in-plane natural oscillation period [days] (Halo / short libration period) */
  inPlanePeriodDays: number;
  /** vertical out-of-plane period [days] (for L1–L3: 2π/(ω√c2); for L4–L5: orbital period) */
  verticalPeriodDays: number;
  /** long-period libration period [days] for stable L4/L5 (undefined for L1–L3) */
  librationPeriodDays?: number;
  /** CR3BP Jacobi constant C_J at the equilibrium point */
  jacobi: number;
  /** dimensionless Legendre coefficients c2, c3, c4 (for L1–L3) */
  c2?: number;
  c3?: number;
  c4?: number;
}

/** Computes exact linear CR3BP stability metrics for a Lagrange point at scene time t [M]. */
export function lagrangeStability(id: string, t = 0): LagrangeStability | null {
  const st = lagrangeState(id, t);
  if (!st) return null;
  const { mu, omega } = st.frame;
  const secPerRad = M_SECONDS / Math.max(omega, 1e-30);
  const toDays = (dimlessRate: number) => (dimlessRate > 1e-15 ? (2 * Math.PI * secPerRad) / (dimlessRate * 86400) : Infinity);
  const toEfoldDays = (dimlessRate: number) => (dimlessRate > 1e-15 ? secPerRad / (dimlessRate * 86400) : Infinity);
  // Jacobi constant C_J = x^2 + y^2 + 2(1-μ)/r1 + 2μ/r2
  const r1 = Math.hypot(st.xi + mu, st.eta);
  const r2 = Math.hypot(st.xi - (1 - mu), st.eta);
  const jacobi = st.xi * st.xi + st.eta * st.eta + (2 * (1 - mu)) / r1 + (2 * mu) / r2;

  if (st.index <= 3) {
    const idx = st.index as 1 | 2 | 3;
    const c2 = collinearCn(mu, idx, st.gamma, 2);
    const c3 = collinearCn(mu, idx, st.gamma, 3);
    const c4 = collinearCn(mu, idx, st.gamma, 4);
    const disc = Math.sqrt(Math.max(0, 9 * c2 * c2 - 8 * c2));
    const lamReal = Math.sqrt(Math.max(0, (c2 - 2 + disc) / 2));
    const wp = Math.sqrt(Math.max(0, (2 - c2 + disc) / 2));
    const wz = Math.sqrt(Math.max(0, c2));
    return {
      id: st.id,
      index: st.index,
      mu,
      linearlyStable: false,
      kind: "saddle",
      lambdaReal: lamReal,
      eFoldDays: toEfoldDays(lamReal),
      inPlanePeriodDays: toDays(wp),
      verticalPeriodDays: toDays(wz),
      jacobi,
      c2,
      c3,
      c4,
    };
  }
  // L4 / L5: characteristic equation λ^4 + λ^2 + (27/4) μ(1−μ) = 0
  const disc = 1 - 27 * mu * (1 - mu);
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    const wShort = Math.sqrt((1 + s) / 2);
    const wLong = Math.sqrt(Math.max((1 - s) / 2, 0));
    return {
      id: st.id,
      index: st.index,
      mu,
      linearlyStable: true,
      kind: "stable",
      lambdaReal: 0,
      eFoldDays: Infinity,
      inPlanePeriodDays: toDays(wShort),
      verticalPeriodDays: toDays(1),
      librationPeriodDays: toDays(wLong),
      jacobi,
    };
  }
  // Unstable triangular point (μ > μ_Routh, e.g. Pluto–Charon!)
  // λ^2 = (-1 ± i √(-disc)) / 2 => Re(λ) = √((√(1 - disc) - 1) / 4)
  const mod = Math.sqrt(27 * mu * (1 - mu));
  const re = Math.sqrt(Math.max(0, (mod - 1) / 4));
  const im = Math.sqrt(Math.max(0, (mod + 1) / 4));
  return {
    id: st.id,
    index: st.index,
    mu,
    linearlyStable: false,
    kind: "unstable-triangular",
    lambdaReal: re,
    eFoldDays: toEfoldDays(re),
    inPlanePeriodDays: toDays(im),
    verticalPeriodDays: toDays(1),
    jacobi,
  };
}

// ------------------------------------------------------------------------------------ 3rd-order Richardson Halo orbits (JWST-style)

export interface HaloParams {
  /** vertical (out-of-plane) amplitude A_z [m] */
  azM: number;
  /** +1 northern Halo, −1 southern Halo (JWST flies a southern Halo orbit around Sun–Earth L2) */
  branch: 1 | -1;
  /** phase offset at t = 0 [rad] */
  phase0: number;
}

/** Realistic default Halo amplitude A_z [m] for a Lagrange point (JWST ≈ 260,000 km at SE-L2, 12,000 km at EM-L2). */
export function defaultHaloAzM(id: string, t = 0): number {
  const p = parseLagrangeId(id);
  if (!p) return 100_000e3;
  if (p.secondary === "earth" && (p.index === 1 || p.index === 2)) return 260_000e3; // JWST-like (~260k km z, ~750k km y)
  if (p.secondary === "moon" && (p.index === 1 || p.index === 2)) return 12_000e3; // Lunar Gateway / Queqiao scale
  const st = lagrangeState(id, t);
  if (!st) return 100_000e3;
  if (p.index <= 2) return Math.max(5_000e3, st.gamma * st.frame.R * M_METRES * 0.18);
  if (p.index === 3) return Math.max(50_000e3, st.frame.R * M_METRES * 0.04);
  // L4/L5: modest 3D tadpole/inclined libration orbit
  return Math.max(10_000e3, st.hill * M_METRES * 0.25);
}

export interface HaloStateResult {
  /** home-frame position [M], velocity [c], and inertial acceleration [c²/M] */
  pos: Vec3;
  vel: Vec3;
  acc: Vec3;
  /** synodic offset from the Lagrange point [m] (along ex, ey, ez) */
  synM: Vec3;
  /** Halo period [M of scene time] */
  periodM: number;
  /** Halo period [days] */
  periodDays: number;
  /** current Halo phase angle τ1 [rad] */
  phase: number;
  /** Lagrange point state at t */
  lagrange: LagrangeState;
}

/**
 * Evaluates a 3D Halo (for L1/L2/L3) or Lissajous/tadpole libration orbit (for L4/L5) around `id`
 * at scene time `t` [M]. Returns exact inertial position, velocity, and acceleration in the home frame.
 */
export function haloState(id: string, t: number, params?: Partial<HaloParams>): HaloStateResult | null {
  const L = lagrangeState(id, t);
  if (!L) return null;
  const { frame, gamma, index } = L;
  const azM = params?.azM ?? defaultHaloAzM(id, t);
  const branch: 1 | -1 = params?.branch ?? -1;
  const phase0 = params?.phase0 ?? 0;

  let dx = 0,
    dy = 0,
    dz = 0; // synodic offset from L-point [M]
  let vx = 0,
    vy = 0,
    vz = 0; // time derivative in synodic frame [c]
  let ax = 0,
    ay = 0,
    az = 0; // 2nd derivative in synodic frame [c²/M]
  let periodM = (2 * Math.PI) / Math.max(frame.omega, 1e-30);
  let phase = 0;

  if (index <= 3) {
    const scaleL = gamma * frame.R;
    const azDim = azM / M_METRES / Math.max(scaleL, 1e-30);
    const C = richardsonCoeffs(frame.mu, index as 1 | 2 | 3, gamma, azDim);
    const rate = C.lam * C.omega * frame.omega; // dτ1/dt [rad/M]
    periodM = (2 * Math.PI) / Math.max(rate, 1e-30);
    phase = rate * t + phase0;
    const c1 = Math.cos(phase),
      s1 = Math.sin(phase);
    const c2 = Math.cos(2 * phase),
      s2 = Math.sin(2 * phase);
    const c3 = Math.cos(3 * phase),
      s3 = Math.sin(3 * phase);
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

    const xs = C.a21 * Ax2 + C.a22 * Az2 - Ax * c1 + k2x * c2 + k3x * c3;
    const ys = C.k * Ax * s1 + k2y * s2 + k3y * s3;
    const zs = branch * (Az * c1 + C.d21 * Ax * Az * (c2 - 3) + k3z * c3);

    const dxs = Ax * s1 - 2 * k2x * s2 - 3 * k3x * s3;
    const dys = C.k * Ax * c1 + 2 * k2y * c2 + 3 * k3y * c3;
    const dzs = branch * (-Az * s1 - 2 * C.d21 * Ax * Az * s2 - 3 * k3z * s3);

    const ddxs = Ax * c1 - 4 * k2x * c2 - 9 * k3x * c3;
    const ddys = -C.k * Ax * s1 - 4 * k2y * s2 - 9 * k3y * s3;
    const ddzs = branch * (-Az * c1 - 4 * C.d21 * Ax * Az * c2 - 9 * k3z * c3);

    dx = scaleL * xs;
    dy = scaleL * ys;
    dz = scaleL * zs;
    vx = scaleL * rate * dxs;
    vy = scaleL * rate * dys;
    vz = scaleL * rate * dzs;
    ax = scaleL * rate * rate * ddxs;
    ay = scaleL * rate * rate * ddys;
    az = scaleL * rate * rate * ddzs;
  } else {
    // L4 / L5: gentle 3D stable epicyclic/libration loop around the equilateral point
    const disc = Math.max(0, 1 - 27 * frame.mu * (1 - frame.mu));
    const wShort = Math.sqrt((1 + Math.sqrt(disc)) / 2);
    const rate = wShort * frame.omega;
    periodM = (2 * Math.PI) / Math.max(rate, 1e-30);
    phase = rate * t + phase0;
    const A = azM / M_METRES;
    // Slight 2:1 ellipse aligned with the tangent at L4/L5 + out-of-plane inclination
    const c1 = Math.cos(phase),
      s1 = Math.sin(phase);
    dx = 0.6 * A * c1;
    dy = 1.2 * A * s1;
    dz = branch * 0.5 * A * c1;
    vx = -0.6 * A * rate * s1;
    vy = 1.2 * A * rate * c1;
    vz = -branch * 0.5 * A * rate * s1;
    ax = -0.6 * A * rate * rate * c1;
    ay = -1.2 * A * rate * rate * s1;
    az = -branch * 0.5 * A * rate * rate * c1;
  }

  // Transform synodic offset (dx, dy, dz) from L-point into the inertial home frame
  const offSyn = add(add(scale(frame.ex, dx), frame.ey, dy), frame.ez, dz);
  const velSyn = add(add(scale(frame.ex, vx), frame.ey, vy), frame.ez, vz);
  const accSyn = add(add(scale(frame.ex, ax), frame.ey, ay), frame.ez, az);
  const pos = add(L.pos, offSyn);
  // v = v_L + v_syn + ω × offSyn + (Rdot/R) * offSyn
  const breath = frame.Rdot / Math.max(frame.R, 1e-30);
  const vel = add(add(add(L.vel, velSyn), cross(frame.omegaVec, offSyn)), offSyn, breath);
  // Inertial acceleration of the Halo reference point: a_L_centrip + a_syn + 2 ω × v_syn + ω × (ω × offSyn)
  const rFromB = sub(pos, frame.B);
  const acc = add(
    add(add(accSyn, cross(frame.omegaVec, velSyn), 2), cross(frame.omegaVec, cross(frame.omegaVec, rFromB))),
    scale(frame.B, 0),
  );
  // Add barycentre's own inertial acceleration around its host (approx −GM_host/r^3 or central diff if needed)
  return {
    pos,
    vel,
    acc,
    synM: [dx * M_METRES, dy * M_METRES, dz * M_METRES],
    periodM,
    periodDays: (periodM * M_SECONDS) / 86400,
    phase,
    lagrange: L,
  };
}

/**
 * Samples a closed 3D Halo orbit loop around `id` at epoch `t0` [M] (drawn in the instantaneous synodic
 * frame anchored at L(t0), so the 3D map renders a clean closed loop around the Lagrange point!).
 */
export function haloOrbitLoop(id: string, t0: number, params?: Partial<HaloParams>, n = 96): Vec3[] {
  const L0 = lagrangeState(id, t0);
  if (!L0) return [];
  const azM = params?.azM ?? defaultHaloAzM(id, t0);
  const branch: 1 | -1 = params?.branch ?? -1;
  const h0 = haloState(id, t0, { azM, branch, phase0: params?.phase0 ?? 0 });
  if (!h0) return [];
  const { frame, gamma, index } = L0;
  const pts: Vec3[] = [];
  if (index <= 3) {
    const scaleL = gamma * frame.R;
    const azDim = azM / M_METRES / Math.max(scaleL, 1e-30);
    const C = richardsonCoeffs(frame.mu, index as 1 | 2 | 3, gamma, azDim);
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
    for (let j = 0; j <= n; j++) {
      const ph = (j / n) * 2 * Math.PI;
      const xs = C.a21 * Ax2 + C.a22 * Az2 - Ax * Math.cos(ph) + k2x * Math.cos(2 * ph) + k3x * Math.cos(3 * ph);
      const ys = C.k * Ax * Math.sin(ph) + k2y * Math.sin(2 * ph) + k3y * Math.sin(3 * ph);
      const zs = branch * (Az * Math.cos(ph) + C.d21 * Ax * Az * (Math.cos(2 * ph) - 3) + k3z * Math.cos(3 * ph));
      pts.push(add(L0.pos, add(add(scale(frame.ex, scaleL * xs), frame.ey, scaleL * ys), frame.ez, scaleL * zs)));
    }
  } else {
    const A = azM / M_METRES;
    for (let j = 0; j <= n; j++) {
      const ph = (j / n) * 2 * Math.PI;
      const dx = 0.6 * A * Math.cos(ph);
      const dy = 1.2 * A * Math.sin(ph);
      const dz = branch * 0.5 * A * Math.cos(ph);
      pts.push(add(L0.pos, add(add(scale(frame.ex, dx), frame.ey, dy), frame.ez, dz)));
    }
  }
  return pts;
}

/**
 * Computes the synodic position & velocity of a spacecraft (X, V) relative to a Lagrange point at time t [M].
 * Returns coordinates in metres and m/s along (ex, ey, ez).
 */
export function synodicRelState(id: string, X: Vec3, V: Vec3, t: number): { rM: Vec3; vMs: Vec3; distM: number; speedMs: number } | null {
  const L = lagrangeState(id, t);
  if (!L) return null;
  const { frame } = L;
  const dr = sub(X, L.pos);
  // Velocity in rotating frame: v_rot = V - v_L - ω × dr - (Rdot/R) dr
  const breath = frame.Rdot / Math.max(frame.R, 1e-30);
  const dv = sub(sub(sub(V, L.vel), cross(frame.omegaVec, dr)), scale(dr, breath));
  const rM: Vec3 = [dot(dr, frame.ex) * M_METRES, dot(dr, frame.ey) * M_METRES, dot(dr, frame.ez) * M_METRES];
  const vMs: Vec3 = [dot(dv, frame.ex) * 299792458, dot(dv, frame.ey) * 299792458, dot(dv, frame.ez) * 299792458];
  return { rM, vMs, distM: len(rM), speedMs: len(vMs) };
}

/**
 * Fits the closest Halo orbit phase φ0 at time `t` to a spacecraft's current position `X` around `id`,
 * so engaging the Halo autopilot smoothly locks onto the Halo orbit without unnecessary phasing burns.
 */
export function matchHaloPhase(id: string, X: Vec3, t: number, azM?: number, branch: 1 | -1 = -1): { phase0: number; azM: number } | null {
  const L = lagrangeState(id, t);
  if (!L) return null;
  const az = azM ?? defaultHaloAzM(id, t);
  let bestPh = 0,
    bestD = Infinity;
  for (let k = 0; k < 36; k++) {
    const ph0 = (k / 36) * 2 * Math.PI;
    const h = haloState(id, t, { azM: az, branch, phase0: ph0 });
    if (!h) continue;
    const d = len(sub(h.pos, X));
    if (d < bestD) (bestD = d), (bestPh = ph0);
  }
  // Golden-section polish around bestPh
  let lo = bestPh - Math.PI / 18,
    hi = bestPh + Math.PI / 18;
  for (let it = 0; it < 20; it++) {
    const a = lo + (hi - lo) / 3,
      b = hi - (hi - lo) / 3;
    const da = len(sub(haloState(id, t, { azM: az, branch, phase0: a })!.pos, X));
    const db = len(sub(haloState(id, t, { azM: az, branch, phase0: b })!.pos, X));
    if (da < db) hi = b;
    else lo = a;
  }
  return { phase0: (lo + hi) / 2, azM: az };
}

/**
 * N-body differential corrector (single-shooting x–z plane crossing):
 * Starts from Richardson's 3rd-order Halo state at phase = 0 (y = 0, ẋ = 0, ż = 0) and tunes the
 * initial synodic velocity (Δvy) in our full N-body `predictOurs` integrator so that at the half-period
 * crossing (y = 0 again), the radial velocity ẋ = 0 (perpendicular crossing → periodic Halo orbit!).
 */
export function refineHaloOrbit(
  id: string,
  t0: number,
  params?: Partial<HaloParams>,
): { X0: Vec3; V0: Vec3; halfPeriodM: number; dvCorrectionMs: number; residualVxMs: number; ok: boolean } | null {
  const h0 = haloState(id, t0, { azM: params?.azM, branch: params?.branch ?? -1, phase0: 0 });
  if (!h0) return null;
  const L0 = h0.lagrange;
  const { frame } = L0;
  const halfT = h0.periodM * 0.5;
  const C_MS = 299792458;

  // Evaluate vx (synodic) at the y = 0 half-period crossing for a perturbation dvy [c] along ey
  const evalCross = (dvy: number): { vx: number; tCross: number } | null => {
    const V = add(h0.vel, frame.ey, dvy);
    const p = predictOurs(h0.pos, V, t0, [], { tMax: halfT * 1.45, maxSteps: 12000, step: 0.015 });
    if (p.pts.length < 4 || p.fate !== "continues") return null;
    // Find the first y-crossing past 0.4 * halfT
    let prevY = 0;
    let prevIdx = -1;
    for (let i = 1; i < p.pts.length; i++) {
      const ti = p.times[i]!;
      const rel = synodicRelState(id, p.pts[i]!, p.vels[i]!, ti);
      if (!rel) continue;
      const y = rel.rM[1];
      if (ti - t0 > halfT * 0.35 && prevIdx >= 0 && prevY * y <= 0) {
        const u = Math.abs(prevY) / Math.max(Math.abs(prevY) + Math.abs(y), 1e-12);
        const tC = p.times[prevIdx]! + u * (ti - p.times[prevIdx]!);
        const rPrev = synodicRelState(id, p.pts[prevIdx]!, p.vels[prevIdx]!, p.times[prevIdx]!)!;
        const vx = rPrev.vMs[0] + u * (rel.vMs[0] - rPrev.vMs[0]);
        return { vx, tCross: tC };
      }
      prevY = y;
      prevIdx = i;
    }
    return null;
  };

  let dvy = 0;
  let cur = evalCross(dvy);
  if (!cur) return null;
  const eps = 0.05 / C_MS; // 5 cm/s finite difference
  for (let it = 0; it < 8 && Math.abs(cur.vx) > 0.02; it++) {
    const probe = evalCross(dvy + eps);
    if (!probe) break;
    const slope = (probe.vx - cur.vx) / eps;
    if (!(Math.abs(slope) > 1e-6)) break;
    let step = -cur.vx / slope;
    // cap single correction step to 50 m/s
    const cap = 50 / C_MS;
    if (Math.abs(step) > cap) step = Math.sign(step) * cap;
    const next = evalCross(dvy + step);
    if (next && Math.abs(next.vx) < Math.abs(cur.vx)) {
      dvy += step;
      cur = next;
    } else {
      const half = evalCross(dvy + 0.5 * step);
      if (half && Math.abs(half.vx) < Math.abs(cur.vx)) {
        dvy += 0.5 * step;
        cur = half;
      } else break;
    }
  }
  const V0 = add(h0.vel, frame.ey, dvy);
  return {
    X0: h0.pos,
    V0,
    halfPeriodM: cur.tCross - t0,
    dvCorrectionMs: dvy * C_MS,
    residualVxMs: cur.vx,
    ok: Math.abs(cur.vx) < 2.0,
  };
}

/**
 * Runs a real N-body stability probe at a Lagrange point in `predictOurs`:
 * places a test particle at L (with optional initial synodic offset `perturbKm`), integrates for `days`,
 * and measures max drift, final drift, and whether the trajectory stayed bound to the point.
 */
export function testLagrangeStabilityNBody(
  id: string,
  t0: number,
  days: number,
  perturbKm = 100,
): {
  id: LagrangeId;
  linear: LagrangeStability;
  days: number;
  initialOffsetKm: number;
  maxOffsetKm: number;
  finalOffsetKm: number;
  growthRatio: number;
  samples: { day: number; offsetKm: number }[];
} | null {
  const L = lagrangeState(id, t0);
  const linear = lagrangeStability(id, t0);
  if (!L || !linear) return null;
  const X0 = add(L.pos, L.frame.ex, (perturbKm * 1e3) / M_METRES);
  const V0 = L.vel;
  const tMax = (days * 86400) / M_SECONDS;
  const p = predictOurs(X0, V0, t0, [], { tMax, maxSteps: 20000, step: 0.015 });
  const samples: { day: number; offsetKm: number }[] = [];
  let maxOffsetKm = 0;
  let finalOffsetKm = 0;
  const stride = Math.max(1, Math.floor(p.pts.length / 80));
  for (let i = 0; i < p.pts.length; i++) {
    const ti = p.times[i]!;
    const Li = lagrangeState(id, ti)!;
    const offKm = (len(sub(p.pts[i]!, Li.pos)) * M_METRES) / 1e3;
    if (offKm > maxOffsetKm) maxOffsetKm = offKm;
    finalOffsetKm = offKm;
    if (i % stride === 0 || i === p.pts.length - 1) {
      samples.push({ day: ((ti - t0) * M_SECONDS) / 86400, offsetKm: offKm });
    }
  }
  return {
    id: L.id,
    linear,
    days,
    initialOffsetKm: perturbKm,
    maxOffsetKm,
    finalOffsetKm,
    growthRatio: finalOffsetKm / Math.max(perturbKm, 1e-6),
    samples,
  };
}

/** Human-readable localized stability summary line for HUD / 3D map hover cards / crew console. */
export function lagrangeStabilityText(st: LagrangeStability): string {
  if (st.linearlyStable) {
    return tf(
      "Stable (Routh μ = {0}) · libration {1} d",
      st.mu.toExponential(2),
      Math.round(st.librationPeriodDays ?? st.inPlanePeriodDays),
    );
  }
  if (st.kind === "unstable-triangular") {
    return tf("Unstable (μ = {0} > 0.0385) · τ ≈ {1} d", st.mu.toFixed(4), st.eFoldDays.toFixed(1));
  }
  return tf("Unstable (saddle) · τ ≈ {0} d · Halo ~{1} d", st.eFoldDays.toFixed(1), Math.round(st.inPlanePeriodDays));
}
