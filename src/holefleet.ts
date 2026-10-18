// The fleet's craft on Gargantua's side to draw near the camera (docs/PLAN-VAISSEAUX-AAA.md, X2c): the Endurance at its
// true size within 60 km (controller/holeendurance.ts holeCraft — main.ts sets the source); the renderer reads it,
// draws it as a ship and leaves the cinematic one (endurance.ts) out.
import type { Vec3 } from "./physics";

export const holeFleet: { source: (() => { rel: Vec3; axes: [Vec3, Vec3, Vec3] } | null) | null } = { source: null };
