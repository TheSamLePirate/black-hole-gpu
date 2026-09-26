// Attach points of the camera on the spaceship (Interstellar's Ranger, see ship.ts).
export type V3 = [number, number, number];

/** Attach points: eye and aim in the ship's frame (x to its left, y up, z towards the nose; ≈ metres). */
export const MOUNTS = {
  quarter: { label: "Hull quarter (film)", eye: [6.2, 3.9, -10.5], aim: [-3.5, 2.6, 14] },
  chase: { label: "Chase, above the tail", eye: [0, 4.4, -13.5], aim: [0, 1.3, 12] },
  dorsal: { label: "Dorsal, behind the cockpit", eye: [0, 3.7, -3.0], aim: [0, 2.4, 20] },
  wing: { label: "Wingtip", eye: [-6.2, 2.3, -6.5], aim: [-0.5, 1.0, 14] },
  belly: { label: "Belly", eye: [0.6, -0.55, -4.5], aim: [0.2, -0.1, 20] },
  rear: { label: "Nose, looking back", eye: [0, 2.0, 11.2], aim: [0, 1.5, -6] },
} satisfies Record<string, { label: string; eye: V3; aim: V3 }>;
export type Mount = keyof typeof MOUNTS;


export type M3 = [V3, V3, V3]; // rows

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Ship → camera frame C (x right, y up, z forward): rows = the camera's axes in the ship's frame,
 * and the translation. `lookYaw` / `lookPitch` [deg]: the camera turned on its mount (free look;
 * positive: to the right / up).
 */
export function shipToCamera(m: Mount, lookYaw = 0, lookPitch = 0): { S: M3; t: V3 } {
  const { eye, aim } = MOUNTS[m] as { eye: V3; aim: V3 };
  const fwd = norm(sub(aim, eye));
  // the ship's right (−x) on the screen's right: like the tracer's camera basis, (right, up, forward)
  // is left-handed in a right-handed frame (the screen's x right, y up, z into it)
  const right = norm(cross(fwd, [0, 1, 0]));
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
