// Our universe, beyond our end of the wormhole (ANALYSE-INTEGRATION.md §3.9): the Sun and Saturn,
// fixed in the home frame (our mouth at the origin). Their Newtonian pull on the ship — the Dneg metric
// itself has no gravity (g_tt = −1) and their bending of light (~10⁻⁸ rad) is left out.

import type { Vec3 } from "../physics";
import { radius, sideToRep, type Dneg } from "../wormhole";
import { GARGANTUA_SYSTEM } from "./bodies";
import { bodyState } from "./ephemeris";

/** Our universe's massive bodies (home frame: our mouth at the origin): the Sun and Saturn. */
export const OUR_BODIES = GARGANTUA_SYSTEM.bodies
  .filter((b) => b.universe === "ours" && b.mass > 0)
  .map((b) => ({ id: b.id, pos: bodyState(GARGANTUA_SYSTEM, b.id, 0).pos, mass: b.mass, radius: b.radius }));

/** A point of our side (ℓ < 0, rep direction n) in the home frame. */
export function homeOf(w: Dneg, l: number, n: Vec3): Vec3 {
  const r = radius(w, l)[0];
  return [r * n[0], -r * n[1], r * n[2]];
}

/**
 * Newtonian acceleration by the Sun and Saturn at (ℓ, n) on our side, as a rep vector (its radial
 * part in proper length, like the camera's velocity); inside: within a body.
 */
export function ourGravity(w: Dneg, l: number, n: Vec3): { acc: Vec3; inside: boolean } {
  const X = homeOf(w, l, n);
  let a: Vec3 = [0, 0, 0];
  let inside = false;
  for (const b of OUR_BODIES) {
    const d: Vec3 = [b.pos[0] - X[0], b.pos[1] - X[1], b.pos[2] - X[2]];
    const r = Math.hypot(...d);
    if (r < b.radius) inside = true;
    const k = b.mass / Math.max(r, b.radius) ** 3;
    a = [a[0] + k * d[0], a[1] + k * d[1], a[2] + k * d[2]];
  }
  const nh: Vec3 = [n[0], -n[1], n[2]];
  const slope = Math.max(Math.abs(radius(w, l)[1]), 1e-3);
  const ar = a[0] * nh[0] + a[1] * nh[1] + a[2] * nh[2];
  const k = ar * (1 / slope - 1);
  return { acc: sideToRep(-1, n, [a[0] + k * nh[0], a[1] + k * nh[1], a[2] + k * nh[2]]), inside };
}

/**
 * The mission's departure (§3.9): 10⁶ km from Saturn, beyond it from the mouth and 14° aside
 * (towards the Sun), so that Saturn with its rings (≈ 16°) and the throat behind it (≈ 8.5°) stand
 * side by side; looking between them. Home frame.
 */
export function saturnDeparture(): { X: Vec3; fwd: Vec3; up: Vec3 } {
  const S = bodyState(GARGANTUA_SYSTEM, "saturn", 0).pos;
  const r = Math.hypot(...S);
  const s: Vec3 = [S[0] / r, S[1] / r, S[2] / r];
  const e: Vec3 = [-s[1], s[0], 0].map((x) => -x) as Vec3; // (s rotated −90° about z: the Sun's side)
  const a = (14 * Math.PI) / 180;
  const d = 1e9 / 1.476625e11; // 10⁶ km in M (10⁸ M☉)
  const u: Vec3 = [s[0] * Math.cos(a) + e[0] * Math.sin(a), s[1] * Math.cos(a) + e[1] * Math.sin(a), 0];
  const X: Vec3 = [S[0] + d * u[0], S[1] + d * u[1], S[2] + d * u[2]];
  // (between Saturn and the mouth)
  const toSat: Vec3 = [-u[0], -u[1], -u[2]];
  const toMouth: Vec3 = [-X[0] / Math.hypot(...X), -X[1] / Math.hypot(...X), -X[2] / Math.hypot(...X)];
  const f: Vec3 = [toSat[0] + toMouth[0], toSat[1] + toMouth[1], toSat[2] + toMouth[2]];
  const fl = Math.hypot(...f);
  return { X, fwd: [f[0] / fl, f[1] / fl, f[2] / fl], up: [0, 0, 1] };
}
