// Where the bodies are: positions and velocities (float64) at a coordinate time t, following the
// hierarchy (Edmunds around its star, the star around the hole), and each body's clock.
//
// Gargantua's universe: the flat map of Boyer–Lindquist (x, y, z), equatorial orbits in z = 0, the
// coordinate time t of the far observer. Velocities are coordinate velocities dx/dt.

import { body, type BodyDef, type System } from "./bodies";
import { circularOrbit, omega } from "./kerr-orbits";

export type Vec3 = [number, number, number];

export interface BodyState {
  pos: Vec3;
  vel: Vec3;
  /** dτ/dt of the body's centre */
  dtau: number;
}

const circle = (R: number, phi: number, w: number): { pos: Vec3; vel: Vec3 } => ({
  pos: [R * Math.cos(phi), R * Math.sin(phi), 0],
  vel: [-R * w * Math.sin(phi), R * w * Math.cos(phi), 0],
});

/** Mean motion of a body on its orbit (dφ/dt). */
export function meanMotion(sys: System, b: BodyDef): number {
  const o = b.orbit;
  if (o.type === "kerr") return omega(o.r, sys.spin);
  if (o.type === "kepler") {
    const p = body(sys, b.parent!);
    return Math.sqrt((p.mass + b.mass) / o.a ** 3);
  }
  return 0;
}

/** Position, velocity and clock rate of a body at coordinate time t. */
export function bodyState(sys: System, id: string, t: number): BodyState {
  const b = body(sys, id);
  const o = b.orbit;
  if (o.type === "fixed") return { pos: [...o.pos] as Vec3, vel: [0, 0, 0], dtau: 1 };
  const w = meanMotion(sys, b);
  if (o.type === "kerr") {
    const c = circle(o.r, o.phase + w * t, w);
    return { ...c, dtau: 1 / circularOrbit(o.r, sys.spin).ut };
  }
  // Keplerian around the parent: add the parent's motion; the clock: the parent's, times the
  // weak-field factor of the orbit around it (1 − v²/2 − m/a)
  const p = bodyState(sys, b.parent!, t);
  const c = circle(o.a, o.phase + w * t, w);
  const v2 = (o.a * w) ** 2;
  const pm = body(sys, b.parent!).mass;
  return {
    pos: [p.pos[0] + c.pos[0], p.pos[1] + c.pos[1], p.pos[2] + c.pos[2]],
    vel: [p.vel[0] + c.vel[0], p.vel[1] + c.vel[1], p.vel[2] + c.vel[2]],
    dtau: p.dtau * (1 - 0.5 * v2 - pm / o.a),
  };
}

/** A body's proper time since t = 0 (its clock rate is constant on these circular orbits). */
export function properTime(sys: System, id: string, t: number): number {
  return bodyState(sys, id, 0).dtau * t;
}
