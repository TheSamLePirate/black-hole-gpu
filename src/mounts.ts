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

