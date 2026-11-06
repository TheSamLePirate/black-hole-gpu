// The missiles drawn (Sam, 6 Nov 2026: « vue missile — les missiles du F-35 en objets 3D, avec les ailerons, les gouvernes
// qui fonctionnent »): each kind's mesh (scripts/build-missiles.ts — procedural, no licence: lathed bodies, plates for the
// wings and fins), its control fins' hinge and roll, its nozzle; and the fins' deflections from the guidance's command
// (game/combat.ts Missile.lat), the attitude from its velocity — the nose leading it by the angle of attack the turn asks.
//
// The mesh's frame: x the missile's left, y its top, z its nose; the origin at its middle. The control fins are materials
// 93–96 (fin k at roll `roll0 + k·90°` about z, turned about its radial hinge at z = hingeZ: ship.wgsl finPos); the body's
// paint 92, the seeker's dome 97, the nozzle 98.

import type { MissileKind } from "./combat";

export type MissileMeshId = "msl-aim120" | "msl-aim9x" | "msl-sam" | "msl-jsm";

export interface MissileShape {
  /** length, body radius [m] */
  len: number;
  radius: number;
  /** the control fins' hinge station on z [m], the first fin's roll [rad] (π/4: an X, 0: a +) */
  hingeZ: number;
  roll0: number;
  /** the fins' throw [rad] */
  finMax: number;
  /** the nozzle's exit on z [m] and its radius [m]; the motor's plume length at sea level [m] */
  nozzleZ: number;
  nozzleR: number;
  plume: number;
}

export const MISSILE_SHAPES: Record<MissileMeshId, MissileShape> = {
  // AIM-120C: 3.66 m, 178 mm; clipped mid wings, four tail control fins in an X
  "msl-aim120": { len: 3.66, radius: 0.089, hingeZ: -1.55, roll0: Math.PI / 4, finMax: 0.35, nozzleZ: -1.83, nozzleR: 0.06, plume: 9 },
  // AIM-9X: 3.02 m, 127 mm; small fixed fins forward, tail control fins (and its thrust vanes)
  "msl-aim9x": { len: 3.02, radius: 0.0635, hingeZ: -1.3, roll0: Math.PI / 4, finMax: 0.4, nozzleZ: -1.51, nozzleR: 0.045, plume: 7 },
  // 9M38 (SA-11): 5.55 m, 400 mm; long low wings, tail control fins in a +
  "msl-sam": { len: 5.55, radius: 0.2, hingeZ: -2.4, roll0: 0, finMax: 0.3, nozzleZ: -2.775, nozzleR: 0.14, plume: 16 },
  // JSM: 4 m, a faceted body (lathed in 6 sides), folded-out wings, tail fins in an X
  "msl-jsm": { len: 4.0, radius: 0.24, hingeZ: -1.75, roll0: Math.PI / 4, finMax: 0.3, nozzleZ: -2.0, nozzleR: 0.1, plume: 4 },
};

/** each kind's mesh (the R-73 drawn as an AIM-9X: the same size, a small IR missile) */
export const MISSILE_MESH: Record<MissileKind, MissileMeshId> = {
  aim120: "msl-aim120",
  aim9x: "msl-aim9x",
  r73: "msl-aim9x",
  sam: "msl-sam",
  jsm: "msl-jsm",
};

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A missile's axes from its velocity and its guidance's lateral command `lat` [m/s²] (east, north, up): its nose leading the
 * velocity towards the command by the angle of attack the turn takes (¼° a g, 12° at most), its top the world's up off the
 * nose — roll-stabilised, as an AMRAAM's skid-to-turn autopilot holds it. → [left, up, nose].
 */
export function missileAxes(v: V3, lat: V3 | undefined): [V3, V3, V3] {
  const u = unit(v);
  let f = u;
  if (lat) {
    const perp: V3 = [lat[0] - u[0] * dot(lat, u), lat[1] - u[1] * dot(lat, u), lat[2] - u[2] * dot(lat, u)];
    const g = Math.hypot(...perp) / 9.81;
    if (g > 0.01) {
      const t = Math.tan(Math.min((g * 0.25 * Math.PI) / 180, (12 * Math.PI) / 180));
      const pu = unit(perp);
      f = unit([u[0] + t * pu[0], u[1] + t * pu[1], u[2] + t * pu[2]]);
    }
  }
  const ref: V3 = Math.abs(f[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1];
  const left = unit(cross(ref, f));
  const up = cross(f, left);
  return [left, up, f];
}

/**
 * The four control fins' commanded deflections [rad] for a lateral command `lat` (world axes) on a missile with axes
 * [left, up, nose] at `speed` [m/s] and air density `rho`: each fin's share of the force along its own normal — fin k's
 * plane holds the nose and its radial line at roll0 + k·90° —, tail control pushing the tail the other way; the
 * deflection the command's share of what the dynamic pressure gives at the fins' throw (40 g at Mach 3 at sea level),
 * clamped to it. A small roll trim on all four — the autopilot holding its roll.
 */
export function finCommand(shape: MissileShape, axes: [V3, V3, V3], lat: V3 | undefined, speed: number, rho: number, t: number): number[] {
  const out = [0, 0, 0, 0];
  const q = 0.5 * rho * speed * speed;
  // (the command the fins' full throw gives at this pressure: 40 g at 5.4e5 Pa, Mach 3 low; a slow missile's fins at their stops)
  const aFull = Math.max((40 * 9.81 * q) / 5.4e5, 1);
  const ax = lat ? dot(lat, axes[0]) : 0,
    ay = lat ? dot(lat, axes[1]) : 0;
  const trim = 0.012 * Math.sin(t * 7.3) + 0.008 * Math.sin(t * 13.1);
  for (let k = 0; k < 4; k++) {
    const phi = shape.roll0 + (k * Math.PI) / 2;
    // (the fin's normal in the body: z × its radial line)
    const nx = -Math.sin(phi),
      ny = Math.cos(phi);
    const share = (ax * nx + ay * ny) / aFull;
    out[k] = Math.max(-shape.finMax, Math.min(shape.finMax, -share * shape.finMax + trim));
  }
  return out;
}

/** the air's density at a height [m] (the exponential atmosphere, 8.5 km scale) */
export const airDensity = (h: number) => 1.225 * Math.exp(-Math.max(h, 0) / 8500);
