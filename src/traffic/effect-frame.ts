import type { Vec3 } from "../physics";

/** A point between two rigid frames, with metre origins and the source basis in the destination.
 * Both aircraft and their emissions must use the same rotation: no spherical ENU reconstruction. */
export function pointInFrame(p: readonly number[], from: readonly number[], to: readonly number[], basis: readonly Vec3[]): Vec3 {
  const d = [p[0]! - from[0]!, p[1]! - from[1]!, p[2]! - from[2]!];
  return [0, 1, 2].map((k) => to[k]! + basis[0]![k]! * d[0]! + basis[1]![k]! * d[1]! + basis[2]![k]! * d[2]!) as Vec3;
}
