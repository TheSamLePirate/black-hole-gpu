// Lagrange points (L1–L5), linear & Routh stability analysis, 3rd-order Richardson Halo orbits about L1–L3 and the
// linear libration loops about L4/L5, for any two-body pair in our solar system (Sun–planet via the planet system's
// barycentre — Sun–(Earth+Moon) —, and planet–moon pairs like Earth–Moon).
//
// Units match solar.ts / our-side.ts: lengths and times in M (10⁸ M☉), velocities in c, GM in M.
// The pure math (lagrange-math.ts) also works in arbitrary consistent units (km, km/s, km³/s² on the crew
// console's 3D system map) — one owner for both screens.
//
// Kinematics: every state here (a point, a Halo) is pos/vel/acc with vel and acc the exact time derivatives of pos
// (the pair's frame turning, tilting and breathing — synodicKinematics —, the barycentre's own fall); the orbits' phase
// runs with the pair's synodic angle θ(t), counted in a fixed plane and unwrapped about the mean motion (pairConst).

import type { Vec3 } from "../physics";
import { add, cross, dot, len, scale, sub, unit } from "../math/vec3";
import { M_METRES, M_SECONDS, SOLAR_BODIES, solarBody, solarState } from "./solar";
import { ephemerisVersion } from "./de440";
import { eclDir } from "./orientation";
import { predictOurs } from "./our-predict";
import { t, tf } from "../i18n";
import {
  collinearCn,
  collinearGamma,
  defaultLibrationAz,
  haloLoopFromStates,
  isLagrangeId,
  lagrangeFromStates,
  lagrangeId,
  lagrangeShortName,
  lagrangeSynodicCoords,
  librationAzRange,
  librationAz,
  librationLoop,
  librationModel,
  librationOffset,
  PAIR_SHORT,
  pairMeanMotion,
  pairRefLength,
  ROUTH_MU,
  synodicFrameFromStates,
  synodicKinematics,
  synodicPoint,
  systemBarycentre,
  type LagrangeId,
  type LagrangeIndex,
  type LibrationModel,
  type SynodicFrame,
  type SynodicKinematics,
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
 * barycentre and combined mass so Sun–Earth L1–L5 match JPL's real Sun–EMB CR3BP without monthly wobble
 * (lagrange-math.ts systemBarycentre: the crew console's map merges them the same way).
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
  const moons = b1.id === "sun" ? (MOONS_BY_PARENT.get(b2.id) ?? []) : [];
  const sys = systemBarycentre(
    { p: s2.pos, v: s2.vel, m: b2.mass },
    moons.map((q) => {
      const sq = solarState(q.id, t);
      return { p: sq.pos, v: sq.vel, m: q.mass };
    }),
  );
  return { primary: b1.id, secondary: b2.id, p1: s1.pos, v1: s1.vel, m1: b1.mass, p2: sys.p, v2: sys.v, m2: sys.m };
}

/**
 * A pair's constants: its mean motion n̄ [rad/M] (lagrange-math PAIR_PERIOD_DAYS, else the osculating one at t = 0),
 * its reference length R̄ [M] (amplitudes' unit), the fixed plane the synodic angle θ is counted in — the secondary's
 * Laplace plane (solar.ts `orbit.laplace`), the ecliptic for the planets and the Moon —, oriented so θ grows, and θ's
 * branch anchor (θ at t = 0 on the mean motion's line: it only picks the 2π branch, robust to the ephemeris loaded),
 * the finite-difference step of the pair's accelerations [M] (10⁻⁴ of its period).
 */
interface PairConst {
  n: number;
  Rref: number;
  gm: number;
  pole: Vec3;
  a: Vec3;
  b: Vec3;
  theta0: number;
  h: number;
}
const PAIR_CONST = new Map<string, PairConst | null>();

function pairConst(secondary: string): PairConst | null {
  if (PAIR_CONST.has(secondary)) return PAIR_CONST.get(secondary)!;
  const P = pairStates(secondary, 0);
  const b2 = solarBody(secondary);
  let out: PairConst | null = null;
  if (P && b2) {
    const gm = P.m1 + P.m2;
    const d = sub(P.p2, P.p1);
    const dv = sub(P.v2, P.v1);
    const hv = cross(d, dv);
    let n = pairMeanMotion(secondary, M_SECONDS);
    if (!n) {
      // (osculating: vis-viva's semi-major axis)
      const a = 1 / (2 / len(d) - dot(dv, dv) / gm);
      n = a > 0 ? Math.sqrt(gm / (a * a * a)) : len(hv) / dot(d, d);
    }
    let pole: Vec3 = b2.orbit ? eclDir(b2.orbit.laplace[0], b2.orbit.laplace[1]) : [0, 0, 1];
    if (dot(pole, hv) < 0) pole = scale(pole, -1);
    const a = unit(cross(pole, Math.abs(pole[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const b = cross(pole, a);
    out = {
      n,
      Rref: pairRefLength(gm, n),
      gm,
      pole,
      a,
      b,
      theta0: Math.atan2(dot(d, b), dot(d, a)),
      h: (2 * Math.PI * 1e-4) / n,
    };
  }
  PAIR_CONST.set(secondary, out);
  return out;
}

/** A pair's synodic angle θ(t) [rad] — counted in its fixed reference plane, unwrapped about its mean motion's line —
 *  and its first and second time derivatives [rad/M, rad/M²], from the relative position and its derivatives. */
function synodicAngle(c: PairConst, t: number, d: Vec3, d1: Vec3, d2: Vec3): { theta: number; dTheta: number; ddTheta: number } {
  const x = dot(d, c.a),
    y = dot(d, c.b);
  const rho2 = x * x + y * y;
  const mean = c.theta0 + c.n * t;
  const w = Math.atan2(y, x) - mean;
  const theta = mean + (w - 2 * Math.PI * Math.round(w / (2 * Math.PI)));
  const N = dot(c.pole, cross(d, d1));
  const N1 = dot(c.pole, cross(d, d2));
  const rho21 = 2 * (x * dot(d1, c.a) + y * dot(d1, c.b));
  return { theta, dTheta: N / rho2, ddTheta: N1 / rho2 - (N * rho21) / (rho2 * rho2) };
}

/** The pair's kinematics at t: its states, its synodic frame with that frame's exact derivatives (the bodies'
 *  accelerations and jerks by central differences of their velocities over the pair's step), and its synodic angle. */
interface PairKinematics {
  pair: NonNullable<ReturnType<typeof pairStates>>;
  c: PairConst;
  kin: SynodicKinematics;
  theta: number;
  dTheta: number;
  ddTheta: number;
}
const KIN_CACHE = new Map<string, PairKinematics | null>();

function pairKinematics(secondary: string, t: number): PairKinematics | null {
  // (a few calls a frame ask the same instant — the map, the HUD, the tracker, the autopilot: kept, the last 32;
  // the ephemeris's version in the key: DE440 loaded after a first look changes them)
  const key = `${secondary}|${t}|${ephemerisVersion}`;
  const hit = KIN_CACHE.get(key);
  if (hit !== undefined) return hit;
  const c = pairConst(secondary);
  const P = pairStates(secondary, t);
  let out: PairKinematics | null = null;
  if (c && P) {
    const h = c.h;
    const Pp = pairStates(secondary, t + h)!;
    const Pm = pairStates(secondary, t - h)!;
    const acc = (vp: Vec3, vm: Vec3): Vec3 => scale(sub(vp, vm), 1 / (2 * h));
    const jerk = (vp: Vec3, v: Vec3, vm: Vec3): Vec3 => scale(add(sub(vp, v), sub(vm, v)), 1 / (h * h));
    const a1 = acc(Pp.v1, Pm.v1),
      a2 = acc(Pp.v2, Pm.v2);
    const j1 = jerk(Pp.v1, P.v1, Pm.v1),
      j2 = jerk(Pp.v2, P.v2, Pm.v2);
    const kin = synodicKinematics(P.p1, P.v1, a1, j1, P.m1, P.p2, P.v2, a2, j2, P.m2);
    const th = synodicAngle(c, t, sub(P.p2, P.p1), sub(P.v2, P.v1), sub(a2, a1));
    out = { pair: P, c, kin, ...th };
  }
  if (KIN_CACHE.size >= 32) KIN_CACHE.delete(KIN_CACHE.keys().next().value!);
  KIN_CACHE.set(key, out);
  return out;
}

export interface LagrangeState {
  id: LagrangeId;
  primary: string;
  secondary: string;
  index: LagrangeIndex;
  /** home-frame position [M], velocity [c] and acceleration [c²/M] — exact derivatives of the position (the pair's
   *  frame turning, tilting and breathing) */
  pos: Vec3;
  vel: Vec3;
  acc: Vec3;
  /** instantaneous synodic frame (its omegaVec the full rotation: the turn and the plane's tilt) */
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
  const K = pairKinematics(parsed.secondary, t);
  if (!K) return null;
  const { frame } = K.kin;
  const { xi, eta, gamma } = lagrangeSynodicCoords(frame.mu, parsed.index);
  const P = synodicPoint(K.kin, [xi, eta, 0], [0, 0, 0], [0, 0, 0]);
  const distSecondary = len(sub(P.pos, K.pair.p2));
  const hill = frame.R * Math.cbrt(frame.mu / 3);
  return {
    id: id as LagrangeId,
    primary: parsed.primary,
    secondary: parsed.secondary,
    index: parsed.index,
    pos: P.pos,
    vel: P.vel,
    acc: P.acc,
    frame,
    gamma,
    xi,
    eta,
    distSecondary,
    hill,
  };
}

/** A pair's mean motion n̄ [rad/M] and reference length R̄ [M] (null: no such pair). */
export function pairMean(secondary: string): { n: number; Rref: number } | null {
  const c = pairConst(secondary);
  return c ? { n: c.n, Rref: c.Rref } : null;
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
  const { mu } = st.frame;
  // (the CR3BP's time unit: the pair's mean motion — its periods the same any day of the year)
  const omega = pairConst(st.secondary)?.n ?? st.frame.omega;
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
  /** vertical (out-of-plane) amplitude A_z [m] (about L4/L5 also the loop's in-plane semi-major axis) */
  azM: number;
  /** +1 northern Halo, −1 southern Halo (JWST flies a southern Halo orbit around Sun–Earth L2) */
  branch: 1 | -1;
  /** phase at synodic angle θ = 0 [rad]: τ = ν θ(t) + phase0 (haloPhase0At gives the one for a phase at a date) */
  phase0: number;
}

/** Realistic default Halo amplitude A_z [m] for a Lagrange point (JWST ≈ 260,000 km at SE-L2, 12,000 km at EM-L2).
 *  A constant of the point — from the pair's reference length R̄, not its distance that day: an orbit asked with the
 *  default at two instants is one orbit (`_t` kept for the callers, unused). */
export function defaultHaloAzM(id: string, _t = 0): number {
  const p = parseLagrangeId(id);
  const c = p ? pairConst(p.secondary) : null;
  if (!p || !c) return 100_000e3;
  // (lagrange-math's rule, the crew console's too: JWST-like 260,000 km at SE-L1/L2, 12,000 km at EM-L1/L2…)
  return defaultLibrationAz(p.secondary, p.index, pairMu(p.primary, c), c.Rref * M_METRES, 1);
}

/** The pair's mass ratio μ = m₂/(m₁ + m₂) (the secondary with its moons about the Sun). */
function pairMu(primary: string, c: PairConst): number {
  return (c.gm - solarBody(primary)!.mass) / c.gm;
}

/** The libration model of a point for an amplitude [m] (kept: a few amplitudes a session), with its pair's constants. */
const MODELS = new Map<string, { m: LibrationModel; c: PairConst; mu: number } | null>();
function modelFor(id: string, azM: number): { m: LibrationModel; c: PairConst; mu: number } | null {
  const key = `${id}|${azM}`;
  const hit = MODELS.get(key);
  if (hit !== undefined) return hit;
  const p = parseLagrangeId(id);
  const c = p ? pairConst(p.secondary) : null;
  let out: { m: LibrationModel; c: PairConst; mu: number } | null = null;
  if (p && c) {
    const b1 = solarBody(p.primary)!;
    const mu = (c.gm - b1.mass) / c.gm;
    out = { m: librationModel(mu, p.index, azM / M_METRES / c.Rref), c, mu };
  }
  if (MODELS.size >= 64) MODELS.delete(MODELS.keys().next().value!);
  MODELS.set(key, out);
  return out;
}

/**
 * The amplitudes a point's orbits can take [m] — Richardson's expansion's range about L1–L3 (HALO_AZ_DIM × γ R̄),
 * the linear loops' about L4/L5 (LOOP_AMP_DIM × R̄) — and the one a request becomes (`effective(azM)`): what the
 * flight computer's field and the planner's note show, so no amplitude is changed silently.
 */
export function haloAzRangeM(id: string): { minM: number; maxM: number } | null {
  const p = parseLagrangeId(id);
  const c = p ? pairConst(p.secondary) : null;
  if (!p || !c) return null;
  const [minM, maxM] = librationAzRange(pairMu(p.primary, c), p.index, c.Rref * M_METRES);
  return { minM, maxM };
}

/** The vertical amplitude [m] an orbit asked with `azM` is flown at (after the model's range). */
export function haloEffectiveAzM(id: string, azM: number): number | null {
  const M = modelFor(id, azM);
  return M ? librationAz(M.m) * M.c.Rref * M_METRES : null;
}

/**
 * A request's amplitude [m] (≤ 1,000 km or none: the point's default) as it will be flown: `azM` the effective one,
 * `clamped` when the range changed it, the range itself — the planner's note and the flight computer's field say it.
 */
export function haloAzOf(id: string, askedM?: number): { azM: number; askedM: number; clamped: boolean; minM: number; maxM: number } {
  const asked = askedM !== undefined && askedM > 1000e3 ? askedM : defaultHaloAzM(id);
  const r = haloAzRangeM(id) ?? { minM: 0, maxM: Infinity };
  const azM = haloEffectiveAzM(id, asked) ?? asked;
  // (a relative 10⁻⁹: the range's round trip through R̄)
  return { azM, askedM: asked, clamped: Math.abs(azM - asked) > 1e-9 * asked, ...r };
}

export interface HaloStateResult {
  /** home-frame position [M], velocity [c] and inertial acceleration [c²/M] — the exact first and second time
   *  derivatives of the reference orbit's position (the pair's frame, the clock θ(t), the barycentre's own fall) */
  pos: Vec3;
  vel: Vec3;
  acc: Vec3;
  /** synodic offset from the Lagrange point [m] (along ex, ey, ez) */
  synM: Vec3;
  /** the orbit's mean period [M of scene time] (2π / (ν n̄)) */
  periodM: number;
  /** its mean period [days] */
  periodDays: number;
  /** current phase τ = ν θ(t) + phase0 [rad] (the loop's in-plane one about L4/L5) */
  phase: number;
  /** the vertical amplitude flown [m] (the one asked, brought within haloAzRangeM) */
  azM: number;
  /** Lagrange point state at t */
  lagrange: LagrangeState;
}

/** Everything of an orbit at t but its phase: the point, the pair's kinematics, the model (shared by the phase scans). */
function haloContext(id: string, t: number, params?: Partial<HaloParams>) {
  const L = lagrangeState(id, t);
  if (!L) return null;
  const K = pairKinematics(L.secondary, t)!;
  const azM = params?.azM ?? defaultHaloAzM(id, t);
  const M = modelFor(id, azM);
  if (!M) return null;
  return { L, K, M, branch: (params?.branch ?? -1) as 1 | -1 };
}

function haloAt(ctx: NonNullable<ReturnType<typeof haloContext>>, phase0: number): HaloStateResult {
  const { L, K, M, branch } = ctx;
  const o = librationOffset(M.m, branch, phase0, K.theta);
  const th1 = K.dTheta,
    th2 = K.ddTheta;
  const du: Vec3 = [o.du[0] * th1, o.du[1] * th1, o.du[2] * th1];
  const ddu: Vec3 = [o.ddu[0] * th1 * th1 + o.du[0] * th2, o.ddu[1] * th1 * th1 + o.du[1] * th2, o.ddu[2] * th1 * th1 + o.du[2] * th2];
  const P = synodicPoint(K.kin, o.u, du, ddu);
  const R = K.kin.R * M_METRES;
  const periodM = (2 * Math.PI) / (M.m.nu * M.c.n);
  return {
    pos: P.pos,
    vel: P.vel,
    acc: P.acc,
    synM: [(o.u[0] - L.xi) * R, (o.u[1] - L.eta) * R, o.u[2] * R],
    periodM,
    periodDays: (periodM * M_SECONDS) / 86400,
    phase: M.m.nu * K.theta + phase0,
    azM: librationAz(M.m) * M.c.Rref * M_METRES,
    lagrange: L,
  };
}

/**
 * Evaluates a 3D Halo (for L1/L2/L3) or the libration loop (for L4/L5: the short-period mode and the vertical one)
 * around `id` at scene time `t` [M]. Its phase runs with the pair's synodic angle θ(t) (lagrange-math LibrationModel):
 * the same at any date, across the network, without the instantaneous rate integrated from the epoch. Returns the
 * position, velocity and inertial acceleration in the home frame, each the exact derivative of the one before.
 */
export function haloState(id: string, t: number, params?: Partial<HaloParams>): HaloStateResult | null {
  const ctx = haloContext(id, t, params);
  return ctx ? haloAt(ctx, params?.phase0 ?? 0) : null;
}

/** The phase0 that puts an orbit at phase `tau` at time t (e.g. 0: the Halo's x–z plane crossing nearest the secondary). */
export function haloPhase0At(id: string, t: number, tau: number, params?: Partial<HaloParams>): number {
  const ctx = haloContext(id, t, params);
  if (!ctx) return tau;
  const p = tau - ctx.M.m.nu * ctx.K.theta;
  return p - 2 * Math.PI * Math.floor(p / (2 * Math.PI));
}

/**
 * Samples one revolution of the orbit around `id` at epoch `t0` [M] (drawn in the synodic frame held at t0, so the 3D
 * map shows a clean loop around the Lagrange point: the Halo's closed one; about L4/L5 the next in-plane period from
 * the phase at t0, its vertical swing at the pair's rate).
 */
export function haloOrbitLoop(id: string, t0: number, params?: Partial<HaloParams>, n = 96): Vec3[] {
  const ctx = haloContext(id, t0, params);
  if (!ctx) return [];
  const k = ctx.K.kin;
  return librationLoop(ctx.M.m, ctx.branch, params?.phase0 ?? 0, ctx.K.theta, k.B, k.e, k.R, n);
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
 * Fits the closest orbit phase φ0 at time `t` to a spacecraft's current position `X` around `id`,
 * so engaging the Halo autopilot smoothly locks onto the orbit without unnecessary phasing burns.
 */
export function matchHaloPhase(id: string, X: Vec3, t: number, azM?: number, branch: 1 | -1 = -1): { phase0: number; azM: number } | null {
  const ctx = haloContext(id, t, { azM, branch });
  if (!ctx) return null;
  const az = azM ?? defaultHaloAzM(id, t);
  const miss = (ph0: number) => len(sub(haloAt(ctx, ph0).pos, X));
  let bestPh = 0,
    bestD = Infinity;
  for (let k = 0; k < 36; k++) {
    const ph0 = (k / 36) * 2 * Math.PI;
    const d = miss(ph0);
    if (d < bestD) (bestD = d), (bestPh = ph0);
  }
  // Golden-section polish around bestPh
  let lo = bestPh - Math.PI / 18,
    hi = bestPh + Math.PI / 18;
  for (let it = 0; it < 20; it++) {
    const a = lo + (hi - lo) / 3,
      b = hi - (hi - lo) / 3;
    if (miss(a) < miss(b)) hi = b;
    else lo = a;
  }
  const p = (lo + hi) / 2;
  return { phase0: p - 2 * Math.PI * Math.floor(p / (2 * Math.PI)), azM: az };
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
  const P0 = { azM: params?.azM, branch: params?.branch ?? -1 };
  // (phase 0 at t0: the x–z plane crossing, y = 0 — the clock's phase0 that puts it there)
  const h0 = haloState(id, t0, { ...P0, phase0: haloPhase0At(id, t0, 0, P0) });
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
