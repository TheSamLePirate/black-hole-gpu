// Our universe's grounds: the solar system's solid bodies (the Earth, the Moon, Mars, the moons…)
// turning under a ship, their air, touching down and lifting off (Newton, home frame). The same
// landing gear, crash speed and ballistic coefficient as near the hole (landing.ts).

import type { Vec3 } from "../physics";
import { GEAR } from "../landing";
import { TUNING } from "../game/tuning";
import { bodyAxes, M_METRES, mapIndex, SOLAR_BODIES, solarBody, solarState, spinVector } from "./solar";
import { craterRelief } from "../terrain";
import { airAt } from "../aero";
import { C_MPS } from "../units";
import { cross, dot, sub } from "../math/vec3";

export { GEAR };

const C = C_MPS;

/** A body one can stand on (not a gas giant, not the Sun). */
export function solidBody(id: string) {
  const b = solarBody(id);
  return !!b && b.kind === "planet" && b.surface !== "gas";
}

/** The ground's velocity under a home-frame point (the body's motion plus its turning). */
export function groundVelocity(id: string, X: Vec3, t: number): Vec3 {
  const b = solarBody(id)!;
  const st = solarState(id, t);
  const w = spinVector(b, t);
  const r = sub(X, st.pos);
  const v = cross(w, r);
  return [st.vel[0] + v[0], st.vel[1] + v[1], st.vel[2] + v[2]];
}

/** Air density [kg/m³] at a height [m] above a body (none: 0). */
export function airDensity(id: string, hM: number) {
  return airAt(solarBody(id)?.atmosphere, Math.max(hM, 0)).rho;
}

/** The air's drag on the ship (home frame, c²/M): ½ ρ v² / B against its motion through the air. */
export function dragAccel(id: string, X: Vec3, V: Vec3, t: number): Vec3 {
  const b = solarBody(id)!;
  const st = solarState(id, t);
  const h = (Math.hypot(...sub(X, st.pos)) - b.radius) * M_METRES;
  const rho = airDensity(id, h);
  if (rho <= 0) return [0, 0, 0];
  const va = sub(V, groundVelocity(id, X, t));
  const v = Math.hypot(...va);
  // (a = ½ ρ (v c)² / B in m/s², × M/c² in the code's units)
  const k = (-0.5 * rho * v * M_METRES) / TUNING.ballistic;
  return [va[0] * k, va[1] * k, va[2] * k];
}

/** Home-frame point ↔ the body's own coordinates (fixed on its ground), at time t. */
export function toBodyFixed(id: string, X: Vec3, t: number): Vec3 {
  const A = bodyAxes(solarBody(id)!, t);
  const d = sub(X, solarState(id, t).pos);
  return [dot(d, A[0]), dot(d, A[1]), dot(d, A[2])];
}
export function fromBodyFixed(id: string, q: Vec3, t: number): Vec3 {
  const A = bodyAxes(solarBody(id)!, t);
  const P = solarState(id, t).pos;
  return [0, 1, 2].map((i) => P[i]! + q[0] * A[0][i]! + q[1] * A[1][i]! + q[2] * A[2][i]!) as Vec3;
}

/** A place on a body: latitude, east longitude [°], height above its mean radius [m] → its own coordinates. */
export function bodyFixedOf(id: string, lat: number, lon: number, hM = GEAR): Vec3 {
  const R = solarBody(id)!.radius + hM / M_METRES;
  const f = (lat * Math.PI) / 180,
    l = (lon * Math.PI) / 180;
  return [R * Math.cos(f) * Math.cos(l), R * Math.cos(f) * Math.sin(l), R * Math.sin(f)];
}

/**
 * A body's relief above its sphere, once known (the Earth's: its height map read back from the
 * tracer's — the ground drawn): height [m] at a unit direction on its own axes.
 */
const reliefs = new Map<string, (q: Vec3) => number>();
export function setGroundRelief(id: string, f: ((q: Vec3) => number) | null) {
  if (f) reliefs.set(id, f);
  else reliefs.delete(id);
}
// our airless worlds' ground: the tracer's craters (by their maps' indices: the Moon, Mercury, Ceres,
// Phobos … Rhea — trace.wgsl: airless)
for (const b of SOLAR_BODIES) {
  const m = b.map ? mapIndex(b.map) : -1;
  if (m === 1 || m === 3 || (m >= 7 && m <= 18)) {
    const mR = b.radius * M_METRES;
    reliefs.set(b.id, (q) => craterRelief(m, q, mR));
  }
}

/** The ground's height above the mean radius [m] under a body-fixed point (0: a sphere). */
export function groundRelief(id: string, q: Vec3): number {
  const f = reliefs.get(id);
  if (!f) return 0;
  const l = Math.hypot(...q) || 1;
  return f([q[0] / l, q[1] / l, q[2] / l]);
}

/** Height of the ship's gear above the ground [m] (the mean radius, and the relief when known). */
export function gearHeight(id: string, X: Vec3, t: number) {
  const b = solarBody(id)!;
  const r = (Math.hypot(...sub(X, solarState(id, t).pos)) - b.radius) * M_METRES - GEAR;
  return reliefs.has(id) ? r - groundRelief(id, toBodyFixed(id, X, t)) : r;
}

/** Speeds relative to the ground [m/s]: vertical (> 0 up), horizontal; the local up. */
export function groundSpeeds(id: string, X: Vec3, V: Vec3, t: number) {
  const P = solarState(id, t).pos;
  const r = sub(X, P);
  const d = Math.hypot(...r);
  const up: Vec3 = [r[0] / d, r[1] / d, r[2] / d];
  const va = sub(V, groundVelocity(id, X, t));
  const vv = dot(va, up);
  const vh = Math.hypot(va[0] - vv * up[0], va[1] - vv * up[1], va[2] - vv * up[2]);
  return { vv: vv * C, vh: vh * C, up, va };
}
