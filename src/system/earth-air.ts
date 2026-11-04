// The Earth's air on the CPU: the sunlight's way down through it (the tracer's sunThrough — Rayleigh,
// ozone, aerosols; Chapman's grazing incidence in Schüler's approximation; the planet's shadow), for
// the light meter: the light falling on a camera near the Earth.

import { EARTH_RM } from "../terrain";
import { MSLUT_N, MSLUT_OFF, TLUT_H, TLUT_VEC4S, TLUT_W } from "./earth-air-layout";

export { MSLUT_N, MSLUT_OFF, TLUT_H, TLUT_VEC4S, TLUT_W } from "./earth-air-layout";

/** The air drawn thicker than it is (the tracer's airK: scale heights × k, densities / k) — 1 since Q5 C2 (decision 27: one
 *  physical air): drawn 3 × thicker, its twilight fell ~20 × too slowly (−6.3 mag at −15° against Patat et al. 2006's −9.5 at
 *  Paranal), the renderer's twilightK made up for it from the camera's place; the air as it is, with the multiple scattering's
 *  table, follows the measured fall within 0.1–0.8 mag (−6° … −15°). */
export const AIR_K = 1;
const HR = 8000 * AIR_K,
  HM = 1200 * AIR_K;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];
const BO = [1.22e-6, 3.53e-6, 0.16e-6];
const BME = 2.33e-5;
/** the aerosols' scattering [1/m] (their albedo × their extinction: the tracer's AIR.bms) */
const BMS = 2.1e-5;

const chUp = (x: number, mu: number) => {
  const c = Math.sqrt(1.5707963 * x);
  return c / ((c - 1) * mu + 1);
};
/** The air's column [m at sea level density] from a height h [m] towards the zenith cosine mu, scale height H. */
function airColumn(h: number, mu: number, H: number) {
  const X = EARTH_RM / H,
    x = X + h / H;
  if (mu >= 0) return chUp(x, mu) * Math.exp(-h / H) * H;
  const x0 = x * Math.sqrt(Math.max(1 - mu * mu, 0));
  return (2 * chUp(x0, 0) * Math.exp(Math.min(X - x0, 60)) - chUp(x, -mu) * Math.exp(-h / H)) * H;
}

/** The sunlight's transmission (linear rgb) down to a height h [m], the sun at mu from the zenith: the transmittance table's
 *  when it is drawn (Q5 C1, the GPU's numbers), else Chapman's column (Schüler's approximation — 10–35 % too bright with the
 *  Sun 1–10° up). */
export function sunThrough(h: number, mu: number): [number, number, number] {
  if (drawnLut) return lutThrough(drawnLut, h, mu);
  const cR = airColumn(h, mu, HR),
    cM = airColumn(h, mu, HM);
  return [0, 1, 2].map((i) => Math.exp(-((BR[i]! + BO[i]!) * cR + BME * cM) / AIR_K)) as [number, number, number];
}

// ---- Q5 C1: the transmittance table (Hillaire's first; Bruneton's parametrisation) — the Earth's air as drawn (scale heights
// × AIR_K, densities / AIR_K, its top 100 km × AIR_K), from each height towards each zenith cosine, to the air's top: the
// optical depth per colour integrated exactly (a march of 400 steps) on a 256 × 64 grid in (x_mu, x_r) — x_r = ρ/H the
// height's, x_mu the ray's length to the top between its least and its most —, read bilinear: within 0.7 % of the integral under
// 40 km where T > 1 %, ≤ 12 % on the darkest rays just over the horizon (T 0.1–1 %: an optical depth
// 2 % off) (tests/earth-air-lut.test.ts). The tracer reads the same
// floats (trace.wgsl sunThrough, gpu-tables.ts TABLE_TLUT).
const R_G = EARTH_RM;
const R_T = EARTH_RM + 100e3 * AIR_K;
const H_T = Math.sqrt(R_T * R_T - R_G * R_G);
const LUT_STEPS = 400;

/** (x_mu, x_r) ∈ [0, 1]² → (r, mu): a ray from r at mu reaching the top without meeting the ground */
function lutRMu(xm: number, xr: number): [number, number] {
  const rho = H_T * xr;
  const r = Math.sqrt(rho * rho + R_G * R_G);
  const dMin = R_T - r,
    dMax = rho + H_T;
  const d = dMin + xm * (dMax - dMin);
  return [r, d === 0 ? 1 : Math.max(-1, Math.min(1, (H_T * H_T - rho * rho - d * d) / (2 * r * d)))];
}
/** The optical depth [rgb] from r along mu to the top, integrated: the ray cut at its lowest point (where the air is densest —
 *  a grazing ray's middle), each part's steps crowded towards it (u² spacing), LUT_STEPS in all */
export function opticalDepthExact(r: number, mu: number, steps = LUT_STEPS, aerosols = 1): [number, number, number] {
  const d = -r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + R_T * R_T, 0));
  const tLow = Math.min(Math.max(-r * mu, 0), d);
  let cR = 0,
    cM = 0;
  const part = (a: number, b: number, n: number) => {
    // (from the lowest point a towards b: t = a + (b − a) u², dt = 2 (b − a) u du)
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const t = a + (b - a) * u * u;
      const w = (2 * Math.abs(b - a) * u) / n;
      const h = Math.sqrt(Math.max(r * r + t * t + 2 * r * mu * t, 0)) - R_G;
      cR += Math.exp(-h / HR) * w;
      cM += Math.exp(-h / HM) * w;
    }
  };
  const n1 = tLow > 0 ? Math.max(Math.round((steps * tLow) / d), 8) : 0;
  if (n1) part(tLow, 0, n1);
  part(tLow, d, steps - n1);
  return [0, 1, 2].map((i) => ((BR[i]! + BO[i]!) * cR + BME * aerosols * cM) / AIR_K) as [number, number, number];
}

/** The table built a row at a time (~0.2 s in all): step(budget) works for at most budget ms and returns the table once whole */
export class TransmittanceLutBuilder {
  /** aerosols: the day's aerosols over an ordinary day's (C3: the optical depth at 550 nm over aerosols.ts AOD_DEFAULT) */
  constructor(readonly aerosols = 1) {}
  private f = new Float32Array(TLUT_VEC4S * 4);
  private row = 0;
  done: Float32Array | null = null;
  step(budgetMs = 2): Float32Array | null {
    if (this.done) return this.done;
    const t0 = performance.now();
    while (this.row < TLUT_H && performance.now() - t0 < budgetMs) {
      for (let i = 0; i < TLUT_W; i++) {
        const [r, mu] = lutRMu(i / (TLUT_W - 1), this.row / (TLUT_H - 1));
        this.f.set(opticalDepthExact(r, mu, LUT_STEPS, this.aerosols), 4 * (1 + this.row * TLUT_W + i));
      }
      this.row++;
    }
    if (this.row < TLUT_H) return null;
    this.f.set([1, TLUT_W, TLUT_H, R_T / R_G], 0);
    // (then the multiple scattering's rows, on the transmittance just built)
    while (this.msRow < MSLUT_N && performance.now() - t0 < budgetMs) {
      for (let i = 0; i < MSLUT_N; i++)
        this.f.set(
          multipleScattering(this.f, ((this.msRow + 0.5) / MSLUT_N) * (R_T - R_G), (2 * (i + 0.5)) / MSLUT_N - 1),
          4 * (MSLUT_OFF + 1 + this.msRow * MSLUT_N + i),
        );
      this.msRow++;
    }
    if (this.msRow < MSLUT_N) return null;
    this.f.set([1, MSLUT_N, MSLUT_N, R_T - R_G], 4 * MSLUT_OFF);
    this.done = this.f;
    return this.done;
  }
  private msRow = 0;
}

// ---- Q5 C1, second lot: the multiple scattering (Hillaire 2020, §5.5): at a height h, the Sun at a zenith cosine mu, the light
// scattered twice and more towards a point, every order summed as a geometric series — Ψ_ms = L₂ / (1 − f_ms): L₂ the
// second order (the sunlit air and the ground seen all round, scattered isotropically), f_ms the share an isotropic scattering
// returns. 64 directions (a Fibonacci sphere), 24 steps each, the Sun's light at each step read in the transmittance table;
// the ground's albedo 0.3. The tracer adds σ_s Ψ_ms at each step of its air (trace.wgsl earthAir): the sky's light past the
// terminator — the twilight's — where the single scattering's isotropic stand-in (0.8 and 0.3 of it) died with the Sun's ray.
const MS_DIRS = 64;
const MS_STEPS = 24;
const GROUND_ALBEDO = 0.3;
const FIB = Array.from({ length: MS_DIRS }, (_, k) => {
  const z = 1 - (2 * (k + 0.5)) / MS_DIRS;
  const a = k * Math.PI * (3 - Math.sqrt(5));
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), s * Math.sin(a), z] as const;
});
/** Ψ_ms [rgb, per unit of the Sun's irradiance] at a height h [m] under the air's top, the Sun at a zenith cosine mu */
export function multipleScattering(tlut: Float32Array, h: number, mu: number, aerosols = 1): [number, number, number] {
  const r = R_G + h;
  const sun = [Math.sqrt(Math.max(1 - mu * mu, 0)), 0, mu];
  const L2 = [0, 0, 0],
    fms = [0, 0, 0];
  for (const w of FIB) {
    // (the ray from (0, 0, r) along w: to the ground if it meets it, else to the top)
    const b = r * w[2];
    const disc = b * b - r * r + R_G * R_G;
    const hitsGround = b < 0 && disc >= 0;
    const len = hitsGround ? -b - Math.sqrt(disc) : -b + Math.sqrt(Math.max(b * b - r * r + R_T * R_T, 0));
    const dt = len / MS_STEPS;
    const tau = [0, 0, 0];
    for (let k = 0; k < MS_STEPS; k++) {
      const t = (k + 0.5) * dt;
      const px = w[0] * t,
        py = w[1] * t,
        pz = r + w[2] * t;
      const pr = Math.hypot(px, py, pz);
      const hp = pr - R_G;
      const dR = Math.exp(-hp / HR) / AIR_K,
        dM = Math.exp(-hp / HM) / AIR_K;
      const muP = (px * sun[0]! + pz * sun[2]!) / pr;
      const Ts = lutThrough(tlut, hp, muP);
      for (let c = 0; c < 3; c++) {
        const ext = (BR[c]! + BO[c]!) * dR + BME * aerosols * dM;
        const T = Math.exp(-(tau[c]! + 0.5 * ext * dt));
        const ss = BR[c]! * dR + BMS * aerosols * dM;
        L2[c]! += (T * ss * Ts[c]! * dt) / (4 * Math.PI);
        fms[c]! += T * ss * dt;
        tau[c]! += ext * dt;
      }
    }
    if (hitsGround) {
      // (the ground lit by the Sun, Lambertian, seen through the air before it)
      const gx = w[0] * len,
        gy = w[1] * len,
        gz = r + w[2] * len;
      const gr = Math.hypot(gx, gy, gz);
      const muG = (gx * sun[0]! + gz * sun[2]!) / gr;
      const Tg = lutThrough(tlut, 0, muG);
      for (let c = 0; c < 3; c++) L2[c]! += (Math.exp(-tau[c]!) * Tg[c]! * Math.max(muG, 0) * GROUND_ALBEDO) / Math.PI;
    }
  }
  return [0, 1, 2].map((c) => L2[c]! / MS_DIRS / (1 - fms[c]! / MS_DIRS)) as [number, number, number];
}
/** Ψ_ms read as the shader reads it (bilinear on the texels' centres) */
export function msThrough(f: Float32Array, h: number, mu: number): [number, number, number] {
  const x = Math.min(Math.max(((mu + 1) / 2) * MSLUT_N - 0.5, 0), MSLUT_N - 1);
  const y = Math.min(Math.max((h / (R_T - R_G)) * MSLUT_N - 0.5, 0), MSLUT_N - 1);
  const i = Math.min(Math.floor(x), MSLUT_N - 2),
    j = Math.min(Math.floor(y), MSLUT_N - 2);
  const fx = x - i,
    fy = y - j;
  const at = (a: number, b: number, c: number) => f[4 * (MSLUT_OFF + 1 + b * MSLUT_N + a) + c]!;
  return [0, 1, 2].map(
    (c) => (at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fy) + (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fy,
  ) as [number, number, number];
}
/** The whole table at once (the tests') */
export function transmittanceLut(aerosols = 1): Float32Array {
  const b = new TransmittanceLutBuilder(aerosols);
  let f: Float32Array | null = null;
  while (!(f = b.step(1e9)));
  return f;
}

/** The table read as the shader reads it: the transmission [rgb] from a height h [m] towards mu — under the horizon the
 *  horizon's ray, the ground's shade (groundShade) taking the Sun down */
export function lutThrough(f: Float32Array, h: number, mu: number): [number, number, number] {
  // (over the air's top: the ray taken where it enters the air, its zenith cosine there — none met, nothing lost)
  let r0 = Math.max(R_G + h, R_G);
  if (r0 > R_T) {
    const b = r0 * mu;
    const disc = b * b - r0 * r0 + R_T * R_T;
    if (mu >= 0 || disc < 0) return [1, 1, 1].map((x) => x * groundShadeOf(h, mu)) as [number, number, number];
    // (at the entry, r0 μ + t = −√disc)
    mu = -Math.sqrt(disc) / R_T;
    r0 = R_T;
  }
  const r = Math.min(r0, R_T);
  const rho = Math.sqrt(Math.max(r * r - R_G * R_G, 0));
  const d = -r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + R_T * R_T, 0));
  const dMin = R_T - r,
    dMax = rho + H_T;
  const x = Math.min(Math.max((d - dMin) / Math.max(dMax - dMin, 1e-6), 0), 1) * (TLUT_W - 1);
  const y = Math.min(Math.max(rho / H_T, 0), 1) * (TLUT_H - 1);
  const i = Math.min(Math.floor(x), TLUT_W - 2),
    j = Math.min(Math.floor(y), TLUT_H - 2);
  const fx = x - i,
    fy = y - j;
  const at = (a: number, b: number, c: number) => f[4 * (1 + b * TLUT_W + a) + c]!;
  const shade = groundShadeOf(h, mu);
  return [0, 1, 2].map(
    (c) =>
      Math.exp(
        -((at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fy) + (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fy),
      ) * shade,
  ) as [number, number, number];
}
/** The tracer's groundShade: the Sun under the point's geometric horizon set for it, soft over its disc and the refraction */
function groundShadeOf(h: number, mu: number): number {
  if (mu >= 0) return 1;
  const dip = Math.acos(Math.min(Math.max(R_G / (R_G + Math.max(h, 0)), 0), 1));
  const e = Math.asin(Math.max(-1, Math.min(1, mu)));
  const a = -dip - 0.0151,
    b = -dip + 0.0047;
  const x = Math.min(Math.max((e - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
}
let drawnLut: Float32Array | null = null;
/** (renderer) the table the frame draws with — the light meter's numbers then the image's; null: Chapman's column */
export function setTransmittanceLut(f: Float32Array | null) {
  drawnLut = f;
}

/** …its luminance. */
export function sunThroughY(h: number, mu: number) {
  const T = sunThrough(h, mu);
  return 0.2126 * T[0] + 0.7152 * T[1] + 0.0722 * T[2];
}
