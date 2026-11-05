// PLAN-REFRACTION-HORIZONS R5, first lot — the refraction of Venus's and Titan's airs, on the CPU: their own gases (Venus's CO₂
// with 3.5 % N₂, Titan's N₂ with ~1.5 % CH₄) and their own profiles, not the Earth's air at the same density. Each air a
// temperature profile by height, its pressure integrated hydrostatically (g falling as 1/r²); its refractivity N = (n − 1) at
// a wavelength from the gas's at standard conditions (0 °C, 1 atm) scaled by the density — the Lorentz–Lorenz limit, N ≪ 1 at
// the heights the limb's light crosses —; the bending of a ray grazing the limb at a tangent height ht by Abel's integral
//   α(ht) = −2 a ∫_{r_t}^∞ (dn/dr) / (n √(n² r² − a²)) dr,   a = n(r_t) r_t
// (the substitution r = r_t + x² taking the root's singularity away). The GPU's reading — the near body's limb band bent by its
// own table (airBend), and its lens for the Sun's arc round Venus — is the next lot.
//
// Sources (illustrative profiles, their figures rounded — never presented as a measured day):
//   Venus: the Venus International Reference Atmosphere (Seiff et al. 1985, Adv. Space Res. 5), the equatorial profile —
//     735 K and 92 bar at the ground, the cloud deck 48–70 km, ~170 K near 90–100 km.
//   Titan: the Huygens probe's descent (HASI, Fulchignoni et al. 2005, Nature 438) — 93.7 K and 1 467 hPa at the ground, the
//     tropopause ~70 K at ~44 km, the stratosphere warming to ~180 K by ~250 km.
//   The gases' refractivities at standard conditions and 0.55 µm: CO₂ 4.49·10⁻⁴, N₂ 2.98·10⁻⁴, CH₄ 4.41·10⁻⁴; their dispersion
//     by a two-term Cauchy form N(λ) = N₀ (1 + B/λ²)/(1 + B/0.55²) (B: CO₂ 7.3·10⁻³ µm², N₂ 6.0·10⁻³, CH₄ 9.0·10⁻³) — within
//     ~1 % of the measured dispersions over the visible.

import { PREFR_FLOATS, PREFR_GL, PREFR_VEC4S } from "./refraction-planets-layout";

export { PREFR_FLOATS, PREFR_GL, PREFR_VEC4S };
export type PlanetAir = "venus" | "titan";

interface AirSpec {
  /** the body's mean radius [m], the gravity at the ground [m/s²], the air's mean molar mass [kg/mol] */
  R: number;
  g0: number;
  M: number;
  /** the pressure at the ground [Pa] */
  p0: number;
  /** temperature [K] at heights [m] (linear between) */
  T: [number, number][];
  /** the mixture: each gas's share, its refractivity at STP and 0.55 µm, its Cauchy B [µm²] */
  gases: { x: number; n0: number; B: number }[];
  /** the top of the profile [m] */
  top: number;
}

const SPECS: Record<PlanetAir, AirSpec> = {
  venus: {
    R: 6051.8e3,
    g0: 8.87,
    M: 0.04341,
    p0: 92.1e5,
    T: [
      [0, 735],
      [10e3, 658],
      [20e3, 586],
      [30e3, 496],
      [40e3, 417],
      [50e3, 350],
      [60e3, 263],
      [70e3, 230],
      [80e3, 196],
      [90e3, 170],
      [100e3, 172],
      [120e3, 175],
      [160e3, 180],
    ],
    gases: [
      { x: 0.965, n0: 4.49e-4, B: 7.3e-3 },
      { x: 0.035, n0: 2.98e-4, B: 6.0e-3 },
    ],
    top: 160e3,
  },
  titan: {
    R: 2574.7e3,
    g0: 1.352,
    M: 0.02792,
    p0: 1.467e5,
    T: [
      [0, 93.7],
      [10e3, 84],
      [20e3, 77],
      [44e3, 70.4],
      [60e3, 74],
      [80e3, 95],
      [100e3, 120],
      [150e3, 160],
      [250e3, 180],
      [400e3, 175],
      [600e3, 165],
    ],
    gases: [
      { x: 0.985, n0: 2.98e-4, B: 6.0e-3 },
      { x: 0.015, n0: 4.41e-4, B: 9.0e-3 },
    ],
    top: 600e3,
  },
};

const RG = 8.314462;
const P_STP = 101325;
const T_STP = 273.15;

export interface PlanetProfile {
  body: PlanetAir;
  R: number;
  /** the profile's step [m] and top [m] */
  step: number;
  top: number;
  /** N = n − 1 every step from the ground */
  N: Float64Array;
  /** temperature [K] and pressure [Pa] every step (for the tests, the reports) */
  T: Float64Array;
  p: Float64Array;
}

function tempAt(s: AirSpec, h: number): number {
  const t = s.T;
  if (h <= t[0]![0]) return t[0]![1];
  for (let i = 1; i < t.length; i++)
    if (h <= t[i]![0]) {
      const [h0, T0] = t[i - 1]!;
      const [h1, T1] = t[i]!;
      return T0 + ((T1 - T0) * (h - h0)) / (h1 - h0);
    }
  return t[t.length - 1]![1];
}

/** The air's refractivity at standard conditions for a wavelength [µm] */
export function stpRefractivity(body: PlanetAir, lambdaUm = 0.55): number {
  return SPECS[body].gases.reduce((a, g) => a + (g.x * g.n0 * (1 + g.B / (lambdaUm * lambdaUm))) / (1 + g.B / 0.3025), 0);
}

/** The body's air: N, T, p every step [m] from the ground to the profile's top, at a wavelength [µm] */
export function planetProfile(body: PlanetAir, lambdaUm = 0.55, step = 50): PlanetProfile {
  const s = SPECS[body];
  const n = Math.round(s.top / step) + 1;
  const N = new Float64Array(n);
  const T = new Float64Array(n);
  const p = new Float64Array(n);
  const n0 = stpRefractivity(body, lambdaUm);
  let pr = s.p0;
  for (let i = 0; i < n; i++) {
    const h = i * step;
    const t = tempAt(s, h);
    T[i] = t;
    p[i] = pr;
    // (the number density against the standard one: N ∝ ρ — ideal gas)
    N[i] = n0 * (pr / P_STP) * (T_STP / t);
    // (hydrostatic, over the step at its middle: g at that height, T there)
    const hm = h + step / 2;
    const g = s.g0 * (s.R / (s.R + hm)) ** 2;
    pr *= Math.exp((-s.M * g * step) / (RG * tempAt(s, hm)));
  }
  return { body, R: s.R, step, top: s.top, N, T, p };
}

function nAt(P: PlanetProfile, h: number): [number, number] {
  const x = Math.min(Math.max(h, 0), P.top) / P.step;
  const i = Math.min(Math.floor(x), P.N.length - 2);
  const f = x - i;
  const a = P.N[i]!,
    b = P.N[i + 1]!;
  return [a + (b - a) * f, (b - a) / P.step];
}

/** The bending [rad] of a ray grazing the limb at a tangent height ht [m] — both halves of its path (Abel's integral) */
export function planetLimbBending(P: PlanetProfile, ht: number): number {
  const rt = P.R + ht;
  const [Nt] = nAt(P, ht);
  const a = (1 + Nt) * rt;
  // (r = rt + x²: dr = 2x dx; the integrand's 1/√(n²r² − a²) ~ 1/(x √(2 a)) near x = 0 — finite after the substitution)
  const xMax = Math.sqrt(Math.max(P.top - ht, 0));
  const n = 4000;
  let s = 0;
  for (let k = 0; k < n; k++) {
    const x = ((k + 0.5) / n) * xMax;
    const r = rt + x * x;
    const [N, dN] = nAt(P, r - P.R);
    const nn = 1 + N;
    const q = nn * nn * r * r - a * a;
    if (q <= 0) continue;
    s += ((dN / nn) * 2 * x) / Math.sqrt(q);
  }
  return -2 * a * s * (xMax / n);
}

/** The critical height [m]: the lowest where r dN/dr > −1 (under it a grazing ray circles the body — trapped); 0 if none */
export function criticalHeight(P: PlanetProfile): number {
  for (let i = 1; i < P.N.length - 1; i++) {
    const r = P.R + i * P.step;
    if ((r * (P.N[i + 1]! - P.N[i - 1]!)) / (2 * P.step) > -1) return i === 1 ? 0 : i * P.step;
  }
  return 0;
}

/** the table's tangent height of index i [m] */
export const prefrHeight = (top: number, i: number) => top * (i / (PREFR_GL - 1)) ** 2;

/** The near body's table for the GPU (gpu-tables.ts TABLE_PREFR; trace.wgsl planetBend): its header and ln B by tangent height,
 *  green's; red's and blue's as ratios (the gases' dispersion: B ∝ N at a height) */
export function planetRefractionTable(body: PlanetAir, index: number): Float32Array {
  const out = new Float32Array(PREFR_VEC4S * 4);
  const P = planetProfile(body, 0.55, 100);
  const crit = criticalHeight(P);
  const g = stpRefractivity(body, 0.55);
  out.set([index + 1, P.R, P.top, crit, stpRefractivity(body, 0.65) / g - 1, stpRefractivity(body, 0.45) / g - 1, PREFR_GL, 0], 0);
  for (let i = 0; i < PREFR_GL; i++) {
    const ht = Math.max(prefrHeight(P.top, i), crit);
    out[8 + i] = Math.log(Math.max(planetLimbBending(P, ht), 1e-12));
  }
  return out;
}

/** The table read as the shader reads it: the bending [rad] at a tangent height [m]; −1 under the critical height */
export function prefrAt(t: Float32Array, ht: number): number {
  if (t[0]! < 0.5) return 0;
  const top = t[2]!;
  if (ht >= top) return 0;
  if (ht < t[3]!) return -1;
  const x = Math.sqrt(Math.max(ht, 0) / top) * (PREFR_GL - 1);
  const i = Math.min(Math.floor(x), PREFR_GL - 2);
  const f = x - i;
  return Math.exp(t[8 + i]! * (1 - f) + t[8 + i + 1]! * f);
}
