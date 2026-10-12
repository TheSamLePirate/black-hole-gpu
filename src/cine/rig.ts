// The camera's mechanics (a film camera's rig, as Cinemachine builds its virtual cameras): critically damped
// springs for the body and the aim (no overshoot, the lag set by a time), smooth noise for the hand-held and
// the buffeting, the blends' curve. Pure.

export type V3 = [number, number, number];

export const add3 = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit3 = (a: V3, fallback: V3 = [0, 0, 1]): V3 => {
  const l = len3(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback;
};
export const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** a with its part along the unit n taken off */
export const tangent3 = (a: V3, n: V3): V3 => add3(a, n, -dot3(a, n));

/** The blends' curve: eased in and out (smootherstep). */
export const ease = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * x * (x * (6 * x - 15) + 10);
};

/**
 * A critically damped spring towards a target, stepped exactly (any dt: no overshoot, no instability): its
 * time `tau` [s] — about the lag behind a target moving steadily (0: rigid).
 */
export class Spring3 {
  x: V3 | null = null;
  v: V3 = [0, 0, 0];
  reset(x: V3 | null = null) {
    this.x = x ? [...x] : null;
    this.v = [0, 0, 0];
  }
  step(target: V3, tau: number, dt: number): V3 {
    if (!this.x || tau <= 0 || !(dt > 0)) {
      this.x = [...target];
      this.v = [0, 0, 0];
      return this.x;
    }
    const w = 1 / tau;
    const e = Math.exp(-w * dt);
    const out: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      // (x(t) = target + (c1 + c2 t) e^(−ωt), c1 = x0 − target, c2 = v0 + ω c1)
      const c1 = this.x[i]! - target[i]!;
      const c2 = this.v[i]! + w * c1;
      out[i] = target[i]! + (c1 + c2 * dt) * e;
      this.v[i] = (c2 - w * (c1 + c2 * dt)) * e;
    }
    this.x = out;
    return out;
  }
}

/** A damped scalar (the lens): towards x over tau. */
export const damp = (x: number, target: number, tau: number, dt: number) =>
  tau > 0 ? target + (x - target) * Math.exp(-dt / tau) : target;

// ---- noise: smooth, repeatable (a value noise's octaves), −1 … 1 about 0
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return 2 * (s - Math.floor(s)) - 1;
};
/** Value noise along t: smooth, −1 … 1, its features about 1 apart. */
export function noise1(t: number, seed: number): number {
  const i = Math.floor(t),
    f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed * 57.3) * (1 - u) + hash(i + 1 + seed * 57.3) * u;
}
/** Three octaves of it (the hand, the airframe's shake): its main frequency [Hz] at time t [s]. */
export function fbm(t: number, freq: number, seed: number): number {
  return (noise1(t * freq, seed) * 0.6 + noise1(t * freq * 2.1, seed + 1.7) * 0.28 + noise1(t * freq * 4.3, seed + 3.1) * 0.12) / 1;
}
