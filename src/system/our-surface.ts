// Our universe's grounds: the solar system's solid bodies (the Earth, the Moon, Mars, the moons…)
// turning under a ship, their air, touching down and lifting off (Newton, home frame). The same
// landing gear, crash speed and ballistic coefficient as near the hole (landing.ts).

import type { Vec3 } from "../physics";
import { BALLISTIC, CRASH_SPEED, GEAR } from "../landing";
import { bodyAxes, M_METRES, solarBody, solarState, spinVector } from "./solar";

export { CRASH_SPEED, GEAR };

const C = 299792458;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A body one can stand on (not a gas giant, not the Sun). */
export function solidBody(id: string) {
  const b = solarBody(id);
  return !!b && b.kind === "planet" && b.surface !== "gas";
}

/** The ground's velocity under a home-frame point (the body's motion plus its turning). */
export function groundVelocity(id: string, X: Vec3, t: number): Vec3 {
  const b = solarBody(id)!;
  const st = solarState(id, t);
  const w = spinVector(b);
  const r = sub(X, st.pos);
  const v = cross(w, r);
  return [st.vel[0] + v[0], st.vel[1] + v[1], st.vel[2] + v[2]];
}

/** Air density [kg/m³] at a height [m] above a body (none: 0). */
export function airDensity(id: string, hM: number) {
  const a = solarBody(id)?.atmosphere;
  if (!a || hM > 30 * a.H) return 0;
  return a.rho0 * Math.exp(-Math.max(hM, 0) / a.H);
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
  const k = (-0.5 * rho * v * M_METRES) / BALLISTIC;
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
  const f = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180;
  return [R * Math.cos(f) * Math.cos(l), R * Math.cos(f) * Math.sin(l), R * Math.sin(f)];
}

/** Height of the ship's gear above the ground [m] (a sphere: the mean radius). */
export function gearHeight(id: string, X: Vec3, t: number) {
  const b = solarBody(id)!;
  return (Math.hypot(...sub(X, solarState(id, t).pos)) - b.radius) * M_METRES - GEAR;
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
