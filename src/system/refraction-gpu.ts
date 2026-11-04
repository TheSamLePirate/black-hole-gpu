// R2 — the layered air's tables as the GPU reads them (docs/PLAN-REFRACTION-HORIZONS.md R2): resampled from R1's
// (refraction-layered.ts) onto regular grids a shader indexes without searching —
//   B_haut: GH observer heights at h = H_TOP (i / (GH − 1))², GE elevations at e = 90° (j / (GE − 1))²: the bending's log,
//     bilinear (the air exponential in the height; the horizon's fall in u = √e);
//   B_limbe: GL tangent heights at ht = 120 km (k / (GL − 1))², linear (dense enough for the kinks' √ — measured);
//   N: the refractivity every NSTEP m to 120 km (a ray's tangent height under the horizon: Bouguer's n r = c solved).
// gpuTableData packs them for the tracer's table (gpu-tables.ts TABLE_REFR, its offsets fixed); gpuBending reads them as the
// shader does (trace.wgsl airBend) — the CPU's figures and the image's from the same numbers, its accuracy tested against the
// integral (tests/refraction-gpu.test.ts).
import { type AirProfile, airProfile, type AirState, bendingUp, LAYER_TOP, limbBending } from "./refraction-layered";

export const GH = 128;
export const GE = 128;
export const GL = 4096;
/** B_haut's top height [m]: above it the camera is out of the air (its rays read in B_limbe) */
export const H_TOP = 80_000;
export const NSTEP = 500;
export const NN = Math.round(LAYER_TOP / NSTEP) + 1;
const R_E = 6371e3;
/** the packed table: a header vec4 (1 when in, GH, GE, GL), then ln B_haut (GH × GE), B_limbe (GL), N (NN) — floats */
export const REFR_FLOATS = 4 + GH * GE + GL + NN;
export const REFR_VEC4S = Math.ceil(REFR_FLOATS / 4);
export const REFR_OFF_HAUT = 4;
export const REFR_OFF_LIMB = 4 + GH * GE;
export const REFR_OFF_N = 4 + GH * GE + GL;

/** The tables of an air, packed (a few seconds: a worker's) */
export function gpuTableData(state: AirState, P: AirProfile = airProfile(state)): Float32Array {
  const f = new Float32Array(REFR_VEC4S * 4);
  f.set([1, GH, GE, GL], 0);
  const D = Math.PI / 180;
  for (let i = 0; i < GH; i++) {
    const h = H_TOP * (i / (GH - 1)) ** 2;
    for (let j = 0; j < GE; j++) {
      const e = 90 * D * (j / (GE - 1)) ** 2;
      f[REFR_OFF_HAUT + i * GE + j] = Math.log(Math.max(bendingUp(P, h, e, 1500), 1e-12));
    }
  }
  for (let k = 0; k < GL; k++) f[REFR_OFF_LIMB + k] = limbBending(P, LAYER_TOP * (k / (GL - 1)) ** 2);
  for (let k = 0; k < NN; k++) f[REFR_OFF_N + k] = P.N[Math.min(Math.round((k * NSTEP) / 10), P.N.length - 1)]!;
  return f;
}

/** B_haut read as the shader does: the bending [rad] up from h [m] at an elevation e [rad] ≥ 0 */
export function gpuHaut(f: Float32Array, h: number, e: number): number {
  const x = Math.sqrt(Math.min(Math.max(h, 0), H_TOP) / H_TOP) * (GH - 1);
  const y = Math.sqrt(Math.min(Math.max(e, 0), Math.PI / 2) / (Math.PI / 2)) * (GE - 1);
  const i = Math.min(Math.floor(x), GH - 2),
    j = Math.min(Math.floor(y), GE - 2);
  const fx = x - i,
    fy = y - j;
  const at = (a: number, b: number) => f[REFR_OFF_HAUT + a * GE + b]!;
  const top = at(i, j) * (1 - fy) + at(i, j + 1) * fy;
  const bot = at(i + 1, j) * (1 - fy) + at(i + 1, j + 1) * fy;
  return Math.exp(top * (1 - fx) + bot * fx);
}
/** B_limbe read as the shader does: a tangent ray's whole bending [rad] at a tangent height [m] */
export function gpuLimb(f: Float32Array, ht: number): number {
  const x = Math.sqrt(Math.min(Math.max(ht, 0), LAYER_TOP) / LAYER_TOP) * (GL - 1);
  const k = Math.min(Math.floor(x), GL - 2);
  return f[REFR_OFF_LIMB + k]! * (1 - (x - k)) + f[REFR_OFF_LIMB + k + 1]! * (x - k);
}
/** B_limbe and its slope [rad/m] over ±1 km read as the shader does (trace.wgsl refrLimbSlope): the eclipse's Newton and
 *  defocusing — a segment's own slope turned up on the tropopause's kink (its denominator 1 − α′R/ρ to −1 270: caustics) */
export function gpuLimbSlope(f: Float32Array, ht: number): [number, number] {
  const lo = Math.max(ht - 1000, 0);
  return [gpuLimb(f, ht), (gpuLimb(f, ht + 1000) - gpuLimb(f, lo)) / (ht + 1000 - lo)];
}
/** N read as the shader does: the refractivity at a height [m] */
export function gpuN(f: Float32Array, h: number): number {
  const x = Math.min(Math.max(h, 0), LAYER_TOP) / NSTEP;
  const k = Math.min(Math.floor(x), NN - 2);
  return f[REFR_OFF_N + k]! * (1 - (x - k)) + f[REFR_OFF_N + k + 1]! * (x - k);
}

/**
 * A ray's bending [rad] from a camera h [m] up at an apparent elevation e [rad], as the shader reads it: above the horizon
 * B_haut (in the air) — from orbit none —; under it, its tangent height by Bouguer (n r = n₀ r₀ cos e, six steps), the whole
 * chord B_limbe (both halves) less the part behind the camera B_haut(h, |e|) — from orbit the whole B_limbe. null: the ray meets the sea.
 * R: the sphere the tangent point is taken on, r0 the camera's distance from its centre — the shader's: the squashed space's
 * (radius WGS84's a, the camera at its distance there); the integral's tests: the tables' own 6 371 km.
 */
export function gpuBending(f: Float32Array, h: number, e: number, R = R_E, r0 = R + h): number | null {
  const inAir = h < H_TOP;
  if (e >= 0) return inAir ? gpuHaut(f, h, e) : 0;
  const c = (1 + gpuN(f, h)) * r0 * Math.cos(e);
  let rt = c;
  // (a fixed point contracting by N′R ≈ 0.22 a step: six to the decimetre — two left 60 m)
  for (let k = 0; k < 6; k++) rt = c / (1 + gpuN(f, rt - R));
  const ht = rt - R;
  if (ht < 0) return null;
  if (ht >= LAYER_TOP) return 0;
  return inAir ? gpuLimb(f, ht) - gpuHaut(f, h, -e) : gpuLimb(f, ht);
}

/**
 * The packed table built a slice at a time (~0.7 s of rays in all): step(budget) works for at most budget ms — a frame's share,
 * no frame held — and returns the table once whole. A worker is the plan's; the slices keep the frame free without a bundle more.
 */
export class RefrTableBuilder {
  private f = new Float32Array(REFR_VEC4S * 4);
  private P: AirProfile | null = null;
  private row = 0;
  private limb = 0;
  done: Float32Array | null = null;
  constructor(readonly state: AirState) {}
  step(budgetMs = 2): Float32Array | null {
    if (this.done) return this.done;
    const t0 = performance.now();
    const D = Math.PI / 180;
    if (!this.P) {
      this.P = airProfile(this.state);
      this.f.set([0, GH, GE, GL], 0);
      for (let k = 0; k < NN; k++) this.f[REFR_OFF_N + k] = this.P.N[Math.min(Math.round((k * NSTEP) / 10), this.P.N.length - 1)]!;
      if (performance.now() - t0 > budgetMs) return null;
    }
    while (this.row < GH && performance.now() - t0 < budgetMs) {
      const h = H_TOP * (this.row / (GH - 1)) ** 2;
      for (let j = 0; j < GE; j++)
        this.f[REFR_OFF_HAUT + this.row * GE + j] = Math.log(Math.max(bendingUp(this.P, h, 90 * D * (j / (GE - 1)) ** 2, 1500), 1e-12));
      this.row++;
    }
    while (this.row >= GH && this.limb < GL && performance.now() - t0 < budgetMs) {
      this.f[REFR_OFF_LIMB + this.limb] = limbBending(this.P, LAYER_TOP * (this.limb / (GL - 1)) ** 2);
      this.limb++;
    }
    if (this.row < GH || this.limb < GL) return null;
    this.f[0] = 1;
    this.done = this.f;
    return this.done;
  }
}
