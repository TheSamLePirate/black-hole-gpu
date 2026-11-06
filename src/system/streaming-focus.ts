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

/** (T8m) the speed over the ground [m/s] (the velocity's horizontal part at c; 0 none) */
export function groundSpeed(c: Vec3 | null, velocity: Vec3 | null): number {
  if (!c || !velocity) return 0;
  const up = unit([c[0], c[1], c[2] / (1 - WGS84_F) ** 2]);
  return len(sub(velocity, scale(up, dot(velocity, up))));
}

/**
 * (T8m) Where a scene asked now will be wanted when it is ready: along the ground track, the speed × `buildS` (the last
 * scene's preparation, with a margin) ahead, at most `maxM` (a share of its box's radius: the craft still inside it). Null
 * when the craft is slow (under `minSpeed` m/s): the view's lead decides there. c, Earth-fixed [equatorial radii]; velocity,
 * Earth-fixed [m/s].
 */
export function buildLead(c: Vec3, velocity: Vec3 | null, buildS: number, maxM: number, minSpeed = 25): Vec3 | null {
  if (!velocity) return null;
  const up = unit([c[0], c[1], c[2] / (1 - WGS84_F) ** 2]);
  const horizontal = sub(velocity, scale(up, dot(velocity, up)));
  const speed = len(horizontal);
  if (speed < minSpeed) return null;
  return scale(horizontal, Math.min(speed * buildS, maxM) / speed / WGS84_A);
}

/**
 * Where the detail is wanted ahead (the relief's finest windows, the scenery's box): the eye led along where the view
 * looks — its horizontal part —, out to the ground it looks at (the look down: the eye's height over it ÷ the angle's
 * tangent), at most `maxM`. c, Earth-fixed [equatorial radii]; d, the view's direction there (unit); hM, the eye's
 * height over the ground [m]. A view looking up or level: `maxM` ahead; straight down: none.
 */
export function gazeLead(c: Vec3, d: Vec3, hM: number, maxM: number): Vec3 {
  const up = unit([c[0], c[1], c[2] / (1 - WGS84_F) ** 2]);
  const dv = dot(d, up);
  const horizontal = sub(d, scale(up, dv));
  const hl = len(horizontal);
  if (hl < 0.05) return [0, 0, 0];
  const down = Math.asin(Math.min(Math.max(-dv, -1), 1));
  const ground = down > 0.002 ? Math.max(hM, 1) / Math.tan(down) : maxM;
  return scale(horizontal, Math.min(ground, maxM) / hl / WGS84_A);
}
