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
import { mouthAccel, SOLAR_BODIES, solarState, spinVector } from "./solar";
import { bodyFixedOf, fromBodyFixed, GEAR, groundVelocity } from "./our-surface";

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

/**
 * The body whose sphere of influence holds a home-frame point (the smallest one: a moon's within its
 * planet's, a planet's within the Sun's): r_SOI = a (m / M)^0.4 around its primary. The Sun otherwise.
 */
export function referenceBody(X: Vec3, t: number): string {
  let best = "sun", bestR = Infinity;
  for (const b of SOLAR_BODIES) {
    if (!b.parent) continue;
    const p = SOLAR_BODIES.find((q) => q.id === b.parent)!;
    const P = solarState(b.id, t).pos;
    const Q = solarState(p.id, t).pos;
    const a = Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]);
    const soi = a * (b.mass / p.mass) ** 0.4;
    const d = Math.hypot(X[0] - P[0], X[1] - P[1], X[2] - P[2]);
    if (d < soi && soi < bestR) (best = b.id), (bestR = soi);
  }
  return best;
}

/** A body's sphere of influence around its primary: a (m / M)^0.4 (the Sun: everything). */
export function soiOf(id: string, t: number): number {
  const b = SOLAR_BODIES.find((q) => q.id === id);
  if (!b || !b.parent) return Infinity;
  const p = SOLAR_BODIES.find((q) => q.id === b.parent)!;
  const P = solarState(b.id, t).pos, Q = solarState(p.id, t).pos;
  return Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]) * (b.mass / p.mass) ** 0.4;
}

/**
 * The game's start (game:interstellar): a circular orbit 400 km above the Earth, over its day side
 * (60° from the point under the Sun), the nose prograde and the Earth below. Home frame, at time t.
 */
export function earthStart(t = 0, altKm = 400, moonPlane = false): { X: Vec3; fwd: Vec3; up: Vec3; vel: Vec3 } {
  const E = ourState("earth", t);
  const sun = ourState("sun", t).pos;
  const earth = SOLAR_BODIES.find((b) => b.id === "earth")!;
  // the orbit's plane: the ecliptic's, or the Moon's (a launch timed for the Moon: Artemis)
  let n: Vec3 = [0, 0, 1];
  if (moonPlane) {
    const M = ourState("moon", t);
    const r = [M.pos[0] - E.pos[0], M.pos[1] - E.pos[1], M.pos[2] - E.pos[2]] as Vec3;
    const v = [M.vel[0] - E.vel[0], M.vel[1] - E.vel[1], M.vel[2] - E.vel[2]] as Vec3;
    const h: Vec3 = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
    const hl = Math.hypot(...h);
    n = [h[0] / hl, h[1] / hl, h[2] / hl];
  }
  // (60° from the point under the Sun, in the plane)
  const s0: Vec3 = [sun[0] - E.pos[0], sun[1] - E.pos[1], sun[2] - E.pos[2]];
  const sd = s0[0] * n[0] + s0[1] * n[1] + s0[2] * n[2];
  const sp: Vec3 = [s0[0] - sd * n[0], s0[1] - sd * n[1], s0[2] - sd * n[2]];
  const sl = Math.hypot(...sp);
  const s: Vec3 = [sp[0] / sl, sp[1] / sl, sp[2] / sl];
  const e: Vec3 = [n[1] * s[2] - n[2] * s[1], n[2] * s[0] - n[0] * s[2], n[0] * s[1] - n[1] * s[0]];
  const c = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
  const u: Vec3 = [c * s[0] + sn * e[0], c * s[1] + sn * e[1], c * s[2] + sn * e[2]];
  const r = earth.radius + (altKm * 1e3) / 1.476625e11;
  const X: Vec3 = [E.pos[0] + r * u[0], E.pos[1] + r * u[1], E.pos[2] + r * u[2]];
  // prograde: counter-clockwise about the plane's normal
  const f: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const vc = Math.sqrt(earth.mass / r);
  return { X, fwd: f, up: u, vel: [E.vel[0] + vc * f[0], E.vel[1] + vc * f[1], E.vel[2] + vc * f[2]] };
}

/**
 * The game's start on the ground (game:interstellar): the Kennedy Space Center pad by default
 * (28.57° N, 80.65° W), the ship resting on it, nose east, the Earth turning under it. Home frame, at t.
 */
export function earthGround(t = 0, lat = 28.573, lon = -80.649) {
  const q = bodyFixedOf("earth", lat, lon, GEAR);
  const X = fromBodyFixed("earth", q, t);
  const E = ourState("earth", t).pos;
  const r = [X[0] - E[0], X[1] - E[1], X[2] - E[2]] as Vec3;
  const rl = Math.hypot(...r);
  const up: Vec3 = [r[0] / rl, r[1] / rl, r[2] / rl];
  const w = spinVector(SOLAR_BODIES.find((b) => b.id === "earth")!);
  const e: Vec3 = [w[1] * up[2] - w[2] * up[1], w[2] * up[0] - w[0] * up[2], w[0] * up[1] - w[1] * up[0]];
  const el = Math.hypot(...e);
  return { X, fwd: [e[0] / el, e[1] / el, e[2] / el] as Vec3, up, vel: groundVelocity("earth", X, t), landed: { body: "earth", q } };
}
