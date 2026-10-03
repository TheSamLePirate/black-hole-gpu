// Attach points of the camera on the spaceship (the craft flown: vessels.ts — the Ranger's here).
import { VESSELS, type VesselId } from "./vessels";
import { cross, dot, sub } from "./math/vec3";

export type V3 = [number, number, number];

/**
 * Attach points: eye and aim in the ship's frame (x to its left, y up, z towards the nose; ≈ metres),
 * a short name for the flight displays.
 */
export const MOUNTS = {
  // (inside: the pilot's seat — the Ranger's cabin drawn instead of its hull)
  cockpit: { label: "Cockpit, the pilot's seat", short: "Cockpit", eye: [1.0, 1.45, 3.1], aim: [1.0, 1.22, 13] },
  // (inside, free: the keys move the camera about the cabin — the ship flies on —, the drag turns the look)
  cabin: { label: "Cabin, free — the keys move about it", short: "Cabin", eye: [1.0, 1.45, 3.1], aim: [1.0, 1.45, 13] },
  quarter: { label: "Hull quarter (film)", short: "Film", eye: [6.2, 3.9, -10.5], aim: [-3.5, 2.6, 14] },
  chase: { label: "Chase, above the tail", short: "Chase", eye: [0, 4.4, -13.5], aim: [0, 1.3, 12] },
  dorsal: { label: "Dorsal, behind the cockpit", short: "Dorsal", eye: [0, 3.7, -3.0], aim: [0, 2.4, 20] },
  wing: { label: "Wingtip", short: "Wing", eye: [-6.2, 2.3, -6.5], aim: [-0.5, 1.0, 14] },
  belly: { label: "Belly", short: "Belly", eye: [0.6, -0.55, -4.5], aim: [0.2, -0.1, 20] },
  rear: { label: "Nose, looking back", short: "Rear", eye: [0, 2.0, 11.2], aim: [0, 1.5, -6] },
  // (the docking camera: in the rear hatch, on its axis, looking out — the port to back onto)
  dock: { label: "Docking camera, rear hatch", short: "Dock", eye: [0.04, 1.11, -5.5], aim: [0.04, 1.11, -40] },
  // outside the ship (controls.ts: their poses move — around it: drag turns about it, the wheel its
  // distance; free: the keys move the camera, the drag turns it; it follows the ship's motion)
  around: { label: "Outside, around the ship", short: "Around", eye: [0, 9, -42], aim: [0, 1.5, 0], outside: "around" },
  free: { label: "Outside, free", short: "Free", eye: [18, 6, -36], aim: [0, 1.5, 0], outside: "free" },
  // (a fly-by: the camera stands still where the ship will pass — in the frame of the body it flies by —,
  // turns to follow it, and waits for it further on once it is gone)
  flyby: { label: "Fly-by, the ship passing", short: "Fly-by", eye: [22, 6, 40], aim: [0, 1.5, 0], outside: "flyby" },
  // (the docking camera of what the ship docks to — the space station, another craft: on the nearest
  // port's axis, looking out at the ship coming in, moving with it; elsewhere, around the ship)
  station: { label: "Docking camera, on the target's port (the ISS, a craft)", short: "Port cam", eye: [0, 9, -42], aim: [0, 1.5, 0], outside: "station" },
} satisfies Record<string, { label: string; short: string; eye: V3; aim: V3; outside?: OutsideView }>;
/** The views from outside the ship: around it, free, a fly-by. */
export type OutsideView = "around" | "free" | "flyby" | "station";
export type Mount = keyof typeof MOUNTS;
export const MOUNT_KEYS = Object.keys(MOUNTS) as Mount[];

/** A camera placement on the ship (an attach point, or between two while the view moves). */
export interface MountPose { eye: V3; aim: V3 }

/** The craft flown (vessels.ts): its own places for the attach points on the hull. */
let mountVessel: VesselId = "ranger";
export function setMountVessel(id: VesselId) {
  mountVessel = id;
}
/** An attach point on the craft flown: its eye and aim (the outside views: the table's defaults). */
export function mountPose(m: Mount): MountPose {
  const own = (VESSELS[mountVessel].mounts as Record<string, MountPose | undefined>)[m];
  return own ?? (MOUNTS[m] as MountPose);
}


export type M3 = [V3, V3, V3]; // rows

const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Ship → camera frame C (x right, y up, z forward): rows = the camera's axes in the ship's frame,
 * and the translation. `lookYaw` / `lookPitch` [deg]: the camera turned on its mount (free look;
 * positive: to the right / up).
 */
export function shipToCamera(m: Mount | MountPose, lookYaw = 0, lookPitch = 0): { S: M3; t: V3 } {
  const { eye, aim } = typeof m === "string" ? mountPose(m) : m;
  const fwd = norm(sub(aim, eye));
  // the ship's right (−x) on the screen's right: like the tracer's camera basis, (right, up, forward)
  // is left-handed in a right-handed frame (the screen's x right, y up, z into it); looking straight up
  // or down the ship (the Lander's hatch camera), its nose at the image's top
  const right = norm(cross(fwd, Math.abs(fwd[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0]));
  const up = cross(right, fwd);
  let S: M3 = [right, up, fwd];
  if (lookYaw || lookPitch) {
    const y = (lookYaw * Math.PI) / 180;
    const p = (lookPitch * Math.PI) / 180;
    // the turned camera's axes in the mount's frame
    const f: V3 = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
    const r: V3 = [Math.cos(y), 0, -Math.sin(y)];
    const L: M3 = [r, cross(f, r), f];
    S = L.map((row) => [0, 1, 2].map((k) => row[0] * S[0][k] + row[1] * S[1][k] + row[2] * S[2][k]) as V3) as M3;
  }
  return { S, t: S.map((row) => -dot(row, eye)) as V3 };
}

/** A ship axis (ship frame, e.g. [0, 0, 1]: the nose) in camera coordinates. */
export function shipAxis(S: M3, e: V3): V3 {
  return [dot(S[0], e), dot(S[1], e), dot(S[2], e)];
}
