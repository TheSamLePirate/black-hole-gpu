import type { Vec3 } from "../physics";
import { dot, len, scale, sub, add, unit } from "../math/vec3";
import { WGS84_A, WGS84_F } from "./ellipsoid";

/** Predict six seconds on the ground, bounded so the current position retains surrounding coverage.
 * c is Earth-fixed in equatorial radii; velocity is Earth-fixed m/s, relative to the rotating ground. */
export function streamingLead(c: Vec3, velocity: Vec3 | null): Vec3 {
  if (!velocity) return [0, 0, 0];
  const up = unit([c[0], c[1], c[2] / (1 - WGS84_F) ** 2]);
  const horizontal = sub(velocity, scale(up, dot(velocity, up)));
  const speed = len(horizontal);
  if (speed < 5) return [0, 0, 0];
  return scale(horizontal, Math.min(6, 650 / speed) / WGS84_A);
}
export const aheadFocus = (c: Vec3, lead: Vec3): Vec3 => add(c, lead);
