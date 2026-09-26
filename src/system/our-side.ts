// Our universe, beyond our end of the wormhole (ANALYSE-INTEGRATION.md §3.9): the solar system
// (solar.ts), in the home frame of our mouth. The ship feels the Newtonian pull of all its bodies,
// less the frame's own acceleration (the mouth falls around the Sun with Saturn); the Dneg metric has
// no gravity (g_tt = −1) and their bending of light (~10⁻⁸ rad at Saturn) is left out.
//
// Far from the mouth the Dneg space is flat to 10⁻³ (beyond 100 ρ): the ship then moves in the home
// frame's Cartesian coordinates; near it, along the Dneg metric's geodesics (controls.ts).

import type { Vec3 } from "../physics";
import { ellOfR, radius, repToSide, sidePosition, sideToRep, type Dneg } from "../wormhole";
import { GARGANTUA_SYSTEM } from "./bodies";
import { bodyState } from "./ephemeris";
import { mouthAccel, solarState } from "./solar";

/** Our universe's massive bodies: the Sun, the planets and their moons. */
export const OUR_BODIES = GARGANTUA_SYSTEM.bodies
  .filter((b) => b.universe === "ours" && b.mass > 0)
  .map((b) => ({ id: b.id, mass: b.mass, radius: b.radius }));

/** A point of our side (ℓ < 0, rep direction n) in the home frame. */
export function homeOf(w: Dneg, l: number, n: Vec3): Vec3 {
  const r = radius(w, l)[0];
  return [r * n[0], -r * n[1], r * n[2]];
}

/** A home-frame point → (ℓ < 0, rep direction n). */
export function repOf(w: Dneg, X: Vec3): { l: number; n: Vec3 } {
  const r = Math.hypot(...X);
  return { l: -ellOfR(w, r), n: sidePosition(-1, [X[0] / r, X[1] / r, X[2] / r]) };
}

/** Home vector at (ℓ, n) → rep vector (radial part in proper length), and back. */
export function homeToRep(w: Dneg, l: number, n: Vec3, v: Vec3): Vec3 {
  const nh: Vec3 = [n[0], -n[1], n[2]];
  const slope = Math.max(Math.abs(radius(w, l)[1]), 1e-3);
  const k = (v[0] * nh[0] + v[1] * nh[1] + v[2] * nh[2]) * (1 / slope - 1);
  return sideToRep(-1, n, [v[0] + k * nh[0], v[1] + k * nh[1], v[2] + k * nh[2]]);
}
export function repToHomeVec(w: Dneg, l: number, n: Vec3, v: Vec3): Vec3 {
  const u = repToSide(-1, n, v);
  const nh: Vec3 = [n[0], -n[1], n[2]];
  const slope = Math.max(Math.abs(radius(w, l)[1]), 1e-3);
  const k = (u[0] * nh[0] + u[1] * nh[1] + u[2] * nh[2]) * (slope - 1);
  return [u[0] + k * nh[0], u[1] + k * nh[1], u[2] + k * nh[2]];
}

/** The pull at a home-frame point at time t (the frame's own acceleration taken off). */
export function gravityHome(X: Vec3, t: number): { acc: Vec3; inside: string | null; tDyn: number } {
  const f = mouthAccel(t);
  let a: Vec3 = [-f[0], -f[1], -f[2]];
  let inside: string | null = null;
  let tDyn = Infinity;
  for (const b of OUR_BODIES) {
    const P = solarState(b.id, t).pos;
    const d: Vec3 = [P[0] - X[0], P[1] - X[1], P[2] - X[2]];
    const r = Math.hypot(...d);
    if (r < b.radius) inside = b.id;
    const re = Math.max(r, b.radius);
    const k = b.mass / re ** 3;
    a = [a[0] + k * d[0], a[1] + k * d[1], a[2] + k * d[2]];
    tDyn = Math.min(tDyn, Math.sqrt(re ** 3 / b.mass));
  }
  return { acc: a, inside, tDyn };
}

/**
 * The pull at (ℓ, n) on our side as a rep vector (its radial part in proper length, like the
 * camera's velocity); inside: the body it is within; tDyn: the shortest fall time there.
 */
export function ourGravity(w: Dneg, l: number, n: Vec3, t: number) {
  const g = gravityHome(homeOf(w, l, n), t);
  return { acc: homeToRep(w, l, n, g.acc), inside: g.inside, tDyn: g.tDyn };
}

/** A body's place and velocity in the home frame at t. */
export const ourState = (id: string, t: number) => bodyState(GARGANTUA_SYSTEM, id, t);

/**
 * The mission's departure (§3.9): 10⁶ km from Saturn, beyond it from the mouth and 14° aside
 * (towards the Sun), so that Saturn with its rings (≈ 16°) and the throat behind it (≈ 8.5°) stand
 * side by side; looking between them. Home frame, at time t.
 */
export function saturnDeparture(t = 0): { X: Vec3; fwd: Vec3; up: Vec3; vel: Vec3 } {
  const st = ourState("saturn", t);
  const S = st.pos;
  const r = Math.hypot(...S);
  const s: Vec3 = [S[0] / r, S[1] / r, S[2] / r];
  // (aside towards the Sun: its direction from Saturn, less its part along s)
  const sun = ourState("sun", t).pos;
  const toSun: Vec3 = [sun[0] - S[0], sun[1] - S[1], sun[2] - S[2]];
  const ts = toSun[0] * s[0] + toSun[1] * s[1] + toSun[2] * s[2];
  const e: Vec3 = [toSun[0] - ts * s[0], toSun[1] - ts * s[1], toSun[2] - ts * s[2]];
  const el = Math.hypot(...e);
  const a = (14 * Math.PI) / 180;
  const d = 1e9 / 1.476625e11; // 10⁶ km in M (10⁸ M☉)
  const u: Vec3 = [0, 1, 2].map((i) => s[i]! * Math.cos(a) + (e[i]! / el) * Math.sin(a)) as Vec3;
  const X: Vec3 = [S[0] + d * u[0], S[1] + d * u[1], S[2] + d * u[2]];
  const toSat: Vec3 = [-u[0], -u[1], -u[2]];
  const xl = Math.hypot(...X);
  const f: Vec3 = [toSat[0] - X[0] / xl, toSat[1] - X[1] / xl, toSat[2] - X[2] / xl];
  const fl = Math.hypot(...f);
  return { X, fwd: [f[0] / fl, f[1] / fl, f[2] / fl], up: [0, 0, 1], vel: st.vel };
}
