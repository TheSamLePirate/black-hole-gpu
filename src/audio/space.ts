// The sound's space (PLAN-AUDIO S1): where each source is from the ear — the camera — and how it reaches
// it. Pure: the director gives the camera's pose on the ship (or the spectator's view of it), the sources'
// places on the ship and the air; the engine places its panners and pitches its voices from what comes out.
//
// Frames: a ship point p (ship frame, metres: x left, y up, z the nose) is at S·p + t in the camera's
// (x right, y up, z into the view — mounts.ts shipToCamera, the renderer's shipPlace); Web Audio's listener
// faces −z with y up, its right +x: the camera's z turned round.

export type V3 = [number, number, number];
export type M3 = [V3, V3, V3];

/** The camera's pose against the ship: a ship point p is at S·p + t in the camera's frame. */
export interface ShipPose {
  S: M3;
  t: V3;
}

/** How a camera hears the ship: from the cabin (the pressure hull's air: everything, muffled by the walls),
 *  on the hull (its structure: the engine heavy and close), outside (through the air — or, in vacuum, a
 *  game's licence: dulled and further). */
export type Hearing = "cabin" | "hull" | "outside";

/** the mounts inside the pressure hull, and the ones riding on its structure (mounts.ts) */
const CABIN = new Set(["cockpit", "cabin"]);
const HULL = new Set(["dorsal", "belly", "rear", "dock"]);

/** How the camera hears the ship from a mount (an outside view, a spectator's: outside). */
export function hearing(mount: string, spectator = false): Hearing {
  if (spectator) return "outside";
  return CABIN.has(mount) ? "cabin" : HULL.has(mount) ? "hull" : "outside";
}

/** A ship point in the camera's frame. */
export function inCamera(pose: ShipPose, p: V3): V3 {
  const { S, t } = pose;
  return [
    S[0][0] * p[0] + S[0][1] * p[1] + S[0][2] * p[2] + t[0],
    S[1][0] * p[0] + S[1][1] * p[1] + S[1][2] * p[2] + t[1],
    S[2][0] * p[0] + S[2][1] * p[1] + S[2][2] * p[2] + t[2],
  ];
}

/** A camera-frame point in Web Audio's listener frame (the listener at the origin, facing −z, y up). */
export function toListener(c: V3): V3 {
  return [c[0], c[1], -c[2]];
}

/** A ship point where the panner wants it. */
export function shipSource(pose: ShipPose, p: V3): V3 {
  return toListener(inCamera(pose, p));
}

/** The middle of a set of points (a cluster of thrusters, the main nozzles); none: the origin. */
export function centroid(ps: V3[]): V3 {
  if (!ps.length) return [0, 0, 0];
  const c: V3 = [0, 0, 0];
  for (const p of ps) for (let k = 0; k < 3; k++) c[k]! += p[k]! / ps.length;
  return c;
}

/** the speed of sound [m/s] in the air at `air` (its density over the sea level's): ~340 near the ground,
 *  ~295 in the stratosphere's cold (the density's fall standing for the temperature's, roughly) */
export function soundSpeed(air: number): number {
  if (!(air > 0)) return 0;
  return 295 + 45 * Math.min(Math.max(air, 0), 1) ** 0.3;
}

/**
 * The Doppler factor of a source receding at `vr` [m/s, < 0: approaching] in air carrying sound at `c`
 * [m/s] (the listener still in the air, the source moving): c / (c + vr), held within an octave either way
 * (a supersonic source's own cone is the bang's, S7). No air: none (1).
 */
export function doppler(vr: number, c: number): number {
  if (!(c > 0) || !Number.isFinite(vr)) return 1;
  return Math.min(Math.max(c / Math.max(c + vr, 1e-6), 0.5), 2);
}

/** The air's own absorption with the distance: a low-pass's cutoff [Hz] — the high frequencies lost over
 *  hundreds of metres (20 kHz near, ~4 kHz at 1 km, ~1 kHz at 3 km); no air: none (the game's licence). */
export function airCutoff(d: number, air: number): number {
  if (!(air > 0)) return 20000;
  return Math.max(20000 * Math.exp(-Math.max(d, 0) / 620), 400);
}

/** The radial speed [m/s, > 0: receding] from two distances `dt` [s] apart (the camera's frame moves with
 *  the ship's on board: none; a spectator's sees the ship pass). */
export function radialSpeed(d0: number, d1: number, dt: number): number {
  return dt > 1e-4 && Number.isFinite(d0) && Number.isFinite(d1) ? (d1 - d0) / dt : 0;
}
