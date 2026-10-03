// Three-vectors, once: the helpers each module used to redefine (29 cross, 38 dot…). Plain tuples,
// no classes — the float64 arithmetic and the allocations exactly as the local copies had them.
import type { Vec3 } from "../physics";

export type { Vec3 };

/** a + k b */
export const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
/** ka a + kb b */
export const lin = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** |a| */
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
/** a / |a| (a zero vector stays zero) */
export const unit = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
/** a / |a| (no guard: a zero vector gives NaN, as the copies it replaces did) */
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
