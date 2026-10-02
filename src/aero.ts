// The air of the planets and what it does to a ship: its density, temperature and speed of sound at a
// height; the forces and moments on a craft from its motion through it (lift, drag, side force), the
// heat it takes, its skin's temperatures. SI units throughout (m, s, kg, K, N, W).
//
// Atmospheres. The Earth's is the U.S. Standard Atmosphere 1976 (seven layers of constant lapse rate on
// the geopotential height up to 86 km, then its tabulated densities and temperatures to 1000 km); the
// others are isothermal exponentials (their surface density, scale height, temperature, gas).
//
// Forces (the ship's frame: x to its left, y up, z the nose; v the ship's velocity through the air).
//  · a "Newtonian box": three faces of effective areas A (seen along x, y, z), each pushed back along
//    its normal by q Cp A (v̂·n)² — the bluff body and, at hypersonic speeds, modified Newtonian flow
//    (Cp up to its stagnation value ((γ+1)²/4γ)^(γ/(γ−1))·4/(γ+1), 1.84 in air) — a flat belly at an
//    angle of attack α gets a normal force ∝ sin²α: L/D ≈ 1 at 40°, as the Shuttle's;
//  · skin friction (C_f × wetted area) along the motion; the transonic drag rise near Mach 1;
//  · a wing (its plane the ship's xz): attached-flow lift C_Lα α (Prandtl–Glauert below Mach 0.8,
//    Ackeret's 4/√(M²−1) above 1.2, faded out by Mach 5 where the box takes over), stall, induced drag
//    C_L²/(π e AR); flaps (+C_L, + drag), air brake and gear (+ drag);
//  · the moments: each face's push and the wing's lift where they act (downstream of the centre of
//    mass: the craft weathervanes into its motion), and damping −q S L²/(2V) C ω.
// Heat. The stagnation point's convective flux, Sutton & Graves (1971): q = k √(ρ/Rₙ) V³ (k by the
// gas); above 9 km/s in air the shock layer's radiation, Tauber & Sutton (1991). Two thermal nodes —
// the heat shield (where the craft has one) and the hull — each C dT/dt = q_in − εσ(T⁴ − T_sink⁴), the
// convective flux scaled by (1 − T/T_r) (T_r the recovery temperature: the skin cools in slow air).

export type V3 = [number, number, number];

/** A gas: its ratio of specific heats, specific gas constant [J/(kg K)], Sutton–Graves constant. */
export interface Gas {
  gamma: number;
  R: number;
  ksg: number;
  /** the shock layer radiates (Tauber–Sutton's air fit) */
  radiative: boolean;
  /** the plasma's colour (linear rgb, the emission lines: N₂⁺/O in air, CO/C₂ in CO₂, CN in N₂/CH₄) */
  glow: V3;
}

export const GASES = {
  air: { gamma: 1.4, R: 287.05, ksg: 1.7415e-4, radiative: true, glow: [1.0, 0.45, 0.32] as V3 },
  co2: { gamma: 1.29, R: 188.92, ksg: 1.8960e-4, radiative: false, glow: [1.0, 0.62, 0.38] as V3 },
  n2ch4: { gamma: 1.4, R: 296.8, ksg: 1.7407e-4, radiative: false, glow: [0.75, 0.42, 1.0] as V3 },
} satisfies Record<string, Gas>;
export type GasId = keyof typeof GASES;

/** A body's atmosphere: an isothermal exponential (surface density, scale height, temperature, gas) or
 *  the Earth's standard atmosphere. */
export interface Atmosphere {
  rho0: number;
  H: number;
  /** temperature [K] (the exponential's); the Earth's from its model */
  T?: number;
  gas?: GasId;
  model?: "us76";
}

/** The air at a height. */
export interface Air {
  rho: number;
  T: number;
  /** speed of sound [m/s] */
  a: number;
  gas: Gas;
}

const VACUUM: Air = { rho: 0, T: 3, a: 1, gas: GASES.air };

/** Below this density [kg/m³] the air is left out (the Earth: ~230 km): the ship's drag there is a
 *  millionth of a metre per second per second — orbits on rails above. */
export const AIR_FLOOR = 1e-10;

// ---- the U.S. Standard Atmosphere 1976
const G0 = 9.80665, M0 = 0.0289644, RSTAR = 8.31432, R_EARTH76 = 6356766;
// (layers: base geopotential height [m'], base temperature [K], lapse rate [K/m'], base pressure [Pa])
const LAYERS: [number, number, number, number][] = [];
{
  const base: [number, number][] = [[0, -0.0065], [11000, 0], [20000, 0.001], [32000, 0.0028], [47000, 0], [51000, -0.0028], [71000, -0.002], [84852, 0]];
  let T = 288.15, P = 101325;
  for (let i = 0; i < base.length; i++) {
    const [hb, L] = base[i]!;
    LAYERS.push([hb, T, L, P]);
    const h1 = base[i + 1]?.[0];
    if (h1 === undefined) break;
    const dh = h1 - hb;
    const T1 = T + L * dh;
    P = L === 0 ? P * Math.exp((-G0 * M0 * dh) / (RSTAR * T)) : P * (T / T1) ** ((G0 * M0) / (RSTAR * L));
    T = T1;
  }
}
// (above 86 km: the standard's densities and temperatures, interpolated in log ρ)
const HIGH: [number, number, number][] = [
  [86e3, 6.958e-6, 186.87], [90e3, 3.416e-6, 186.87], [100e3, 5.604e-7, 195.08], [110e3, 9.708e-8, 240.0],
  [120e3, 2.222e-8, 360.0], [130e3, 8.152e-9, 469.27], [150e3, 2.076e-9, 634.39], [180e3, 5.194e-10, 787.6],
  [200e3, 2.541e-10, 854.56], [250e3, 6.073e-11, 941.3], [300e3, 1.916e-11, 976.0], [350e3, 7.014e-12, 990.1],
  [400e3, 2.803e-12, 995.8], [450e3, 1.184e-12, 998.2], [500e3, 5.215e-13, 999.2], [600e3, 1.137e-13, 999.9],
  [700e3, 3.07e-14, 1000], [800e3, 1.136e-14, 1000], [900e3, 5.759e-15, 1000], [1000e3, 3.561e-15, 1000],
];

/** The 1976 standard atmosphere at a geometric height [m]: density, temperature. */
export function us76(h: number): { rho: number; T: number } {
  if (h < 86e3) {
    const hp = (R_EARTH76 * Math.max(h, -5000)) / (R_EARTH76 + Math.max(h, -5000));
    let k = LAYERS.length - 1;
    while (k > 0 && hp < LAYERS[k]![0]) k--;
    const [hb, Tb, L, Pb] = LAYERS[k]!;
    const T = Tb + L * (hp - hb);
    const P = L === 0 ? Pb * Math.exp((-G0 * M0 * (hp - hb)) / (RSTAR * Tb)) : Pb * (Tb / T) ** ((G0 * M0) / (RSTAR * L));
    return { rho: (P * M0) / (RSTAR * T), T };
  }
  if (h >= 1000e3) return { rho: HIGH[HIGH.length - 1]![1] * Math.exp(-(h - 1000e3) / 60e3), T: 1000 };
  let k = 0;
  while (HIGH[k + 1]![0] < h) k++;
  const [h0, r0, T0] = HIGH[k]!, [h1, r1, T1] = HIGH[k + 1]!;
  const f = (h - h0) / (h1 - h0);
  return { rho: Math.exp(Math.log(r0) + f * (Math.log(r1) - Math.log(r0))), T: T0 + f * (T1 - T0) };
}

/** The air at a height [m] above the surface (none: vacuum). */
export function airAt(atm: Atmosphere | null | undefined, h: number): Air {
  if (!atm) return VACUUM;
  const gas = GASES[atm.gas ?? "air"];
  let rho: number, T: number;
  if (atm.model === "us76") ({ rho, T } = us76(h));
  else {
    rho = atm.rho0 * Math.exp(-Math.max(h, -0.5 * atm.H) / atm.H);
    T = atm.T ?? 288;
  }
  if (rho < AIR_FLOOR) return { ...VACUUM, T };
  return { rho, T, a: Math.sqrt(gas.gamma * gas.R * T), gas };
}

/** The air's top: the height where its density falls to AIR_FLOOR [m]. */
export function airTop(atm: Atmosphere | null | undefined): number {
  if (!atm) return 0;
  if (atm.model === "us76") {
    let lo = 86e3, hi = 1000e3;
    for (let i = 0; i < 50; i++) {
      const m = (lo + hi) / 2;
      if (us76(m).rho > AIR_FLOOR) lo = m;
      else hi = m;
    }
    return lo;
  }
  return atm.H * Math.log(atm.rho0 / AIR_FLOOR);
}

// ---- the craft

/** A craft's aerodynamics and thermal protection (its own frame: x left, y up, z the nose). */
export interface VesselAero {
  /** effective areas [m²] of the Newtonian box's faces, seen along x (side), y (belly), z (nose) — the
   *  projected areas × how blunt each side is */
  area: V3;
  /** skin friction and base drag, C_D·A [m²] */
  cdA0: number;
  /** the wing (in the xz plane): area [m²], aspect ratio, lift slope [/rad], stall angle [rad], Oswald's e */
  wing?: { S: number; AR: number; cla: number; stall: number; e: number };
  /** where each face's push acts (x, y, z faces) and the wing's lift, from the centre of mass [m] —
   *  downstream of it: stable (the side and belly faces behind it for a nose-first flight, the nose face
   *  above it for a belly-first one) */
  cp: [V3, V3, V3];
  cw: V3;
  /** how curved each face is (0 flat … 1 a sphere): a curved face's push turns from its normal towards
   *  the motion — through its centre of curvature, where cp puts it (a capsule's shield: stable) */
  curve: V3;
  /** damping coefficients about x, y, z (× q S L²/2V) and the reference length [m] */
  damp: V3;
  len: number;
  /** nose radius [m] (the stagnation point's) */
  noseR: number;
  /** the heat shield: its outward direction (ship frame), the cosine of the cone it protects, its
   *  temperature limit [K], areal heat capacity [J/(m² K)], emissivity */
  shield: { dir: V3; cos: number; tMax: number; cap: number; eps: number } | null;
  /** the rest of the hull: its limit, capacity, emissivity */
  hull: { tMax: number; cap: number; eps: number };
  /** structural limit [g] */
  gMax: number;
  /** the control surfaces' authority: angular acceleration per kPa of dynamic pressure about the
   *  pitch, yaw and roll axes [rad/s² / kPa] (none: 0) */
  ctrl: V3;
}

/** The configuration: flaps (0…1), air brake (0…1), gear down. */
export interface AeroConfig {
  flaps?: number;
  brake?: number;
  gear?: boolean;
}

export interface AeroOut {
  /** force [N] and moment about the centre of mass [N m], ship frame */
  F: V3;
  M: V3;
  /** dynamic pressure [Pa], Mach number, angle of attack and sideslip [rad] */
  q: number;
  mach: number;
  alpha: number;
  beta: number;
  /** lift and drag [N] (lift: the force across the motion; drag: against it) */
  L: number;
  D: number;
  /** the wing's lift coefficient (0 without one), stalled */
  cl: number;
  stalled: boolean;
  /** the stagnation point's heat flux [W/m²] (convective + radiative) */
  heat: number;
  /** the recovery temperature [K] */
  Tr: number;
}

const ZERO: AeroOut = { F: [0, 0, 0], M: [0, 0, 0], q: 0, mach: 0, alpha: 0, beta: 0, L: 0, D: 0, cl: 0, stalled: false, heat: 0, Tr: 0 };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Modified Newtonian flow's stagnation pressure coefficient (γ). */
export const cpMax = (g: number) => ((g + 1) ** 2 / (4 * g)) ** (g / (g - 1)) * (4 / (g + 1));

// (Tauber & Sutton's f(V), air, V in km/s → W/cm² factor)
const TS_V = [9, 9.25, 9.5, 9.75, 10, 10.25, 10.5, 10.75, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16];
const TS_F = [1.5, 4.3, 9.7, 19.5, 35, 55, 81, 115, 151, 238, 359, 495, 660, 850, 1065, 1313, 1550, 1780, 2040];

/** The stagnation point's heat flux [W/m²]: Sutton–Graves' convection, Tauber–Sutton's radiation (air). */
export function heatFlux(air: Air, V: number, noseR: number): number {
  if (air.rho <= 0 || V <= 0) return 0;
  const conv = air.gas.ksg * Math.sqrt(air.rho / noseR) * V ** 3;
  let rad = 0;
  const vk = V / 1000;
  if (air.gas.radiative && vk > 9) {
    let k = 0;
    while (k < TS_V.length - 2 && TS_V[k + 1]! < vk) k++;
    const f = Math.max(0, TS_F[k]! + ((vk - TS_V[k]!) / (TS_V[k + 1]! - TS_V[k]!)) * (TS_F[k + 1]! - TS_F[k]!));
    const a = Math.min(1.072e6 * V ** -1.88 * air.rho ** -0.325, 1);
    rad = 4.736e4 * noseR ** a * air.rho ** 1.22 * f * 1e4;
  }
  return conv + rad;
}

/**
 * The air's force and moment on a craft moving at v (ship frame, m/s, relative to the air), turning at
 * w (ship frame, right-handed, rad/s).
 */
export function aeroForces(A: VesselAero, v: V3, air: Air, w: V3 = [0, 0, 0], cfg: AeroConfig = {}): AeroOut {
  const V = Math.hypot(v[0], v[1], v[2]);
  if (air.rho <= 0 || V < 1e-3) return ZERO;
  const u: V3 = [v[0] / V, v[1] / V, v[2] / V];
  const q = 0.5 * air.rho * V * V;
  const M = V / air.a;
  const g = air.gas.gamma;
  // the box: subsonic bluff-body Cp → the modified Newtonian stagnation value
  const cp = 1.15 + (cpMax(g) - 1.15) * smooth(0.6, 2.5, M);
  const F: V3 = [0, 0, 0];
  const Mo: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const p = q * cp * A.area[i]! * u[i]! * u[i]!;
    const k = A.curve[i]!;
    const f: V3 = [-k * p * u[0], -k * p * u[1], -k * p * u[2]];
    f[i]! -= (1 - k) * p * Math.sign(u[i]!);
    const m = cross(A.cp[i]!, f);
    for (let j = 0; j < 3; j++) (F[j]! += f[j]!), (Mo[j]! += m[j]!);
  }
  // skin friction, base drag, brake and gear; the transonic rise
  const extra = A.cdA0 + (cfg.brake ?? 0) * 0.04 * A.area[1] + (cfg.gear ? 0.012 * A.area[1] : 0);
  const wave = 1 + 1.4 * Math.exp(-(((M - 1.05) / 0.22) ** 2)) + 0.4 * smooth(0.9, 1.3, M) * (1 - smooth(2, 5, M));
  // (the zero-lift drag — the box's and the friction's — raised through Mach 1)
  const boxD = -(F[0] * u[0] + F[1] * u[1] + F[2] * u[2]);
  const D0 = q * extra + (boxD + q * extra) * (wave - 1);
  for (let i = 0; i < 3; i++) F[i]! -= D0 * u[i]!;
  const alpha = Math.atan2(-u[1], u[2]);
  const beta = Math.asin(Math.max(-1, Math.min(1, u[0])));
  let cl = 0, stalled = false;
  if (A.wing && u[2] > 0.05) {
    const W = A.wing;
    // the lift slope with Mach: Prandtl–Glauert, Ackeret, faded where Newtonian flow takes over
    const sub = W.cla / Math.sqrt(Math.max(1 - Math.min(M, 0.8) ** 2, 0.36));
    const sup = Math.min(4 / Math.sqrt(Math.max(M * M - 1, 0.25)), sub);
    const cla = (sub + (sup - sub) * smooth(0.85, 1.25, M)) * (1 - smooth(3, 6, M));
    const s = W.stall;
    const a = Math.abs(alpha);
    // linear to the stall, then a fall to 60 % (the box carries the flat plate beyond)
    const lin = cla * Math.min(a, s);
    cl = Math.sign(alpha) * lin * (1 - 0.4 * smooth(s, s + 0.15, a)) * (1 - smooth(s + 0.3, s + 0.9, a)) + (cfg.flaps ?? 0) * 0.45 * (1 - smooth(3, 6, M));
    stalled = a > s;
    // (the spoilers — the air brake — spoil the lift)
    cl *= 1 - 0.65 * (cfg.brake ?? 0);
    // (sideslip: the wing sees the flow's part in its plane)
    const cb = Math.cos(beta);
    const Lw = q * W.S * cl * cb * cb;
    // lift: across the motion, in the plane of the motion and the ship's up
    const up: V3 = [-u[1] * u[0], 1 - u[1] * u[1], -u[1] * u[2]];
    const ul = Math.hypot(...up) || 1;
    const Di = q * W.S * (cl * cl / (Math.PI * W.e * W.AR) + (cfg.flaps ?? 0) * 0.03);
    const fw: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) fw[i] = (Lw * up[i]!) / ul - Di * u[i]!;
    const m = cross(A.cw, fw);
    for (let i = 0; i < 3; i++) (F[i]! += fw[i]!), (Mo[i]! += m[i]!);
  }
  // lift and drag
  const fu = F[0] * u[0] + F[1] * u[1] + F[2] * u[2];
  const D = -fu;
  const L = Math.hypot(F[0] - fu * u[0], F[1] - fu * u[1], F[2] - fu * u[2]);
  // damping
  const Sref = A.wing?.S ?? A.area[1];
  const kd = (q * Sref * A.len * A.len) / (2 * V);
  for (let i = 0; i < 3; i++) Mo[i]! -= kd * A.damp[i]! * w[i]!;
  const Tr = air.T * (1 + 0.85 * ((g - 1) / 2) * M * M);
  return { F, M: Mo, q, mach: M, alpha, beta, L, D, cl, stalled, heat: heatFlux(air, V, A.noseR), Tr };
}

// ---- the skin's temperatures

export interface Thermal {
  /** the heat shield's and the hull's temperatures [K] */
  shield: number;
  hull: number;
  /** the heat fluxes they took last [W/m²] */
  qShield: number;
  qHull: number;
}

const SIGMA = 5.670374e-8;
/** the radiative sink in space (sunlight and planet-shine on average) [K] */
const T_SPACE = 260;

export const coldSkin = (T = T_SPACE): Thermal => ({ shield: T, hull: T, qShield: 0, qHull: 0 });

/** How the stagnation heat splits between the shield and the hull for a motion along u (ship frame). */
export function heatShares(A: VesselAero, u: V3): { shield: number; hull: number } {
  if (!A.shield) return { shield: 0, hull: 1 };
  const s = A.shield.dir[0] * u[0] + A.shield.dir[1] * u[1] + A.shield.dir[2] * u[2];
  // (the shield facing the flow: it takes the stagnation point; the hull its lee, ~5 % — the Shuttle's
  // upper surfaces at 600–900 K)
  const f = smooth(A.shield.cos - 0.12, A.shield.cos + 0.05, s);
  return { shield: f, hull: 0.05 + 0.95 * (1 - f) };
}

/**
 * Advances the skin's temperatures by dt [s]: the stagnation flux q, shared by the attitude, scaled by
 * (1 − T/T_r); radiation to the air's temperature (or to space); a little natural convection. Each
 * node linearised and stepped implicitly (stiff when hot).
 */
export function heatStep(A: VesselAero, th: Thermal, air: Air, out: AeroOut, u: V3, dt: number): Thermal {
  const sh = heatShares(A, u);
  const sink = air.rho > 0 ? Math.max(air.T, 150) : T_SPACE;
  // (forced convection towards T_r: a turbulent flat plate the craft's length, 0.037 Re^0.8 Pr^⅓ k/L —
  // what cools the skin in slow air; natural convection at rest)
  const V = out.mach * air.a;
  const Re = (air.rho * V * A.len) / 1.7e-5;
  const hNat = 10 * Math.min(air.rho / 1.225, 2) + (Re > 0 ? (0.037 * Re ** 0.8 * 0.89 * 0.024) / A.len : 0);
  // (towards T_r below Mach 2; faster, Sutton–Graves carries the heating — the plate only cools)
  const Tc = air.T + (Math.max(out.Tr, air.T) - air.T) * (1 - smooth(2, 4, out.mach));
  const node = (T: number, share: number, cap: number, eps: number) => {
    const Tr = Math.max(out.Tr, sink);
    const qc = out.heat * share;
    // (the convective flux falls as the wall nears T_r, and turns to cooling above it)
    const f = (x: number) => qc * (1 - x / Tr) - eps * SIGMA * (x ** 4 - sink ** 4) - hNat * (x - Tc);
    const df = -qc / Tr - 4 * eps * SIGMA * T ** 3 - hNat;
    let x = T;
    // (sub-steps: the implicit step's error small against the time constant)
    const n = Math.min(Math.max(Math.ceil((dt * Math.abs(df)) / cap / 0.5), 1), 64);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const d = -qc / Tr - 4 * eps * SIGMA * x ** 3 - hNat;
      x = Math.max(x + (h * f(x)) / (cap - h * d), 3);
    }
    return { T: x, q: Math.max(qc * (1 - x / Tr), 0) };
  };
  const S = A.shield ? node(th.shield, sh.shield, A.shield.cap, A.shield.eps) : { T: th.hull, q: 0 };
  const H = node(th.hull, sh.hull, A.hull.cap, A.hull.eps);
  return { shield: S.T, hull: H.T, qShield: S.q, qHull: H.q };
}

/** The radiative equilibrium temperature under a flux [K]. */
export const equilibriumT = (q: number, eps: number) => (q / (eps * SIGMA)) ** 0.25;
