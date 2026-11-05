// PLAN-REFRACTION-HORIZONS R4 (contract C0-3) — the ground seen lifted by the air: a point P at a distance d from the eye is seen
// along the ray that reaches it, curved by the refractivity's fall with height; to the eye it stands Λ higher along its up than
// it is. For a ray from the eye at hE to the point at hP, the curvature κ(h) = −dN/dh (n ≈ 1) along the chord between them:
//   Λ = ∫₀^d (d − s) κ(h(s)) ds,   h(s) = hE (1 − u) + hP u − s (d − s) / 2R,   u = s/d
// (uniform κ: Λ = κ d²/2 — k = κR ≈ 0.13: 1 m at 10 km, 16 m at 39 km, 250 m at 156 km). One table a frame for the eye's height:
// LIFT_ND distances (quadratic to LIFT_DMAX) × LIFT_NH point heights (quadratic to LIFT_HMAX), from the R2 refractivity the
// GPU reads (refraction-gpu.ts N, gpuN): the tracer's march (R4a) and the rasters' projection (R4b) read the same numbers.
// Λ fades in under 0.1′ (Λ/d) by a smoothstep — not a threshold. Never lifted: the shadow maps, the cache's bake, the CPU's
// collisions and WGS84 positions (the projection alone).
import { gpuN } from "./refraction-gpu";
import { LIFT_DMAX, LIFT_FLOATS, LIFT_HMAX, LIFT_ND, LIFT_NH, LIFT_VEC4S } from "./refraction-lift-layout";

export { LIFT_DMAX, LIFT_FLOATS, LIFT_HMAX, LIFT_ND, LIFT_NH, LIFT_VEC4S };

/** the angle under which the lift fades out [rad]: 0.1′ */
export const LIFT_FADE = (0.1 / 60) * (Math.PI / 180);
const R_E = 6371e3;
/** Gauss–Legendre nodes and weights on [0, 1], 12 points */
const GL_X: number[] = [];
const GL_W: number[] = [];
{
  const x = [0.1252334085114689, 0.3678314989981802, 0.5873179542866175, 0.7699026741943047, 0.9041172563704749, 0.9815606342467192];
  const w = [0.2491470458134028, 0.2334925365383548, 0.2031674267230659, 0.1600783285433462, 0.1069393259953184, 0.0471753363865118];
  for (let i = 0; i < 6; i++) {
    GL_X.push(0.5 - 0.5 * x[i]!, 0.5 + 0.5 * x[i]!);
    GL_W.push(0.5 * w[i]!, 0.5 * w[i]!);
  }
}

/** the table's distance of index i [m] and its point height of index j [m] */
export const liftDistance = (i: number) => LIFT_DMAX * (i / (LIFT_ND - 1)) ** 2;
export const liftHeight = (j: number) => LIFT_HMAX * (j / (LIFT_NH - 1)) ** 2;

/** dN/dh [1/m] at h from a refractivity N(h) */
function slope(N: (h: number) => number, h: number): number {
  const a = Math.max(h - 250, 0);
  return (N(a + 500) - N(a)) / 500;
}

/** Λ [m] — the lift of a point at a slant distance d [m] and height hP [m] seen from hE [m] —, the refractivity N(h); unfaded.
 *  The chord between them exact on the sphere (the eye high — from orbit the limb 2 300 km away —, its heights not a flat
 *  approximation's): Λ = ∫ σ κ dσ, σ the distance from the point, κ = −N′(h) cos ψ the ray's curvature across the chord (ψ its
 *  elevation there) — the angle at the eye Λ/d, the first order in the bending (the chord's own heights) */
export function liftOf(N: (h: number) => number, hE: number, hP: number, d: number): number {
  if (d <= 0) return 0;
  const rE = R_E + hE,
    rP = R_E + hP;
  const c = Math.min(Math.max((rE * rE + rP * rP - d * d) / (2 * rE * rP), -1), 1);
  const sn = Math.sqrt(1 - c * c);
  // (the eye at (0, rE), the point at (rP sin φ, rP cos φ); the chord's direction)
  const tx = (rP * sn) / d,
    ty = (rP * c - rE) / d;
  const pieces = Math.max(1, Math.ceil(d / 20000));
  let L = 0;
  for (let p = 0; p < pieces; p++) {
    for (let k = 0; k < GL_X.length; k++) {
      const u = (p + GL_X[k]!) / pieces;
      const px = u * d * tx,
        py = rE + u * d * ty;
      const r = Math.hypot(px, py);
      const h = r - R_E;
      if (h > 120000) continue;
      // (the ray's elevation there: the chord's direction against the radius)
      const sinPsi = (px * tx + py * ty) / r;
      const cosPsi = Math.sqrt(Math.max(1 - sinPsi * sinPsi, 0));
      L += (GL_W[k]! / pieces) * d * ((1 - u) * d) * -slope(N, Math.max(h, 0)) * cosPsi;
    }
  }
  return L;
}

/** the fade under LIFT_FADE: Λ kept whole over it, none under half of it */
export function liftFade(L: number, d: number): number {
  const a = L / Math.max(d, 1);
  const t = Math.min(Math.max((a - 0.5 * LIFT_FADE) / (0.5 * LIFT_FADE), 0), 1);
  return L * t * t * (3 - 2 * t);
}

/** The eye's table from the GPU's refraction table f (refraction-gpu.ts gpuTableData) — packed as the shader reads it */
export function liftTable(f: Float32Array, hE: number): Float32Array {
  const out = new Float32Array(LIFT_VEC4S * 4);
  out.set([1, hE, LIFT_ND, LIFT_NH], 0);
  const N = (h: number) => gpuN(f, h);
  for (let j = 0; j < LIFT_NH; j++)
    for (let i = 0; i < LIFT_ND; i++) {
      const d = liftDistance(i);
      out[8 + j * LIFT_ND + i] = liftFade(liftOf(N, hE, liftHeight(j), d), d);
    }
  return out;
}

/** The table read as the shader reads it (trace.wgsl refrLiftM): Λ [m] at a slant distance d [m], a point height hP [m] */
export function liftAt(t: Float32Array, d: number, hP: number): number {
  if (t[0]! < 0.5) return 0;
  const x = Math.sqrt(Math.min(Math.max(d, 0), LIFT_DMAX) / LIFT_DMAX) * (LIFT_ND - 1);
  const y = Math.sqrt(Math.min(Math.max(hP, 0), LIFT_HMAX) / LIFT_HMAX) * (LIFT_NH - 1);
  const i = Math.min(Math.floor(x), LIFT_ND - 2),
    j = Math.min(Math.floor(y), LIFT_NH - 2);
  const fx = x - i,
    fy = y - j;
  const at = (a: number, b: number) => t[8 + b * LIFT_ND + a]!;
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
}

/** (R4b) the scenery's lift near the ground: Λ ≈ (c2 + c3 d) d², least squares on Λ/d² over 4–60 km from the table at a point
 *  height hP — the scenery's raster, the tracer's scenery and the other craft read it (a uniform, not the table) */
export function liftPolynomial(t: Float32Array, hP: number): [number, number] {
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let d = 4000; d <= 60000; d += 2000) {
    const y = liftAt(t, d, hP) / (d * d);
    n++;
    sx += d;
    sy += y;
    sxx += d * d;
    sxy += d * y;
  }
  const c3 = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return [(sy - c3 * sx) / n, c3];
}

type V3 = [number, number, number];
/** C0-3 (1): a physical point P (camera-relative [m]) with its height hP [m] and up (unit), seen at P + Λ up */
export function projectApparent(t: Float32Array, P: V3, hP: number, up: V3): V3 {
  const L = liftAt(t, Math.hypot(P[0], P[1], P[2]), hP);
  return [P[0] + L * up[0], P[1] + L * up[1], P[2] + L * up[2]];
}
/** C0-3 (2): the inverse — from the apparent point A (the camera ray × its apparent distance), the physical one: A − Λ(|·|) up,
 *  iterated (Λ ≪ d: two steps to the millimetre) */
export function unprojectApparent(t: Float32Array, A: V3, hP: number, up: V3): V3 {
  let P: V3 = A;
  for (let k = 0; k < 3; k++) {
    const L = liftAt(t, Math.hypot(P[0], P[1], P[2]), hP);
    P = [A[0] - L * up[0], A[1] - L * up[1], A[2] - L * up[2]];
  }
  return P;
}
