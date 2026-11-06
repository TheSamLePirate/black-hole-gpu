// The war's ground units drawn (scripts/build-ground-units.ts): each target kind's mesh, its turret's pivot (about y, at z =
// turretZ) and its arm's or gun's (about x, at y = armY, z = armZ — before the turret's turn); and their pose from the fight:
// the turret turned onto the threat it engages, the arm raised, the missiles left on the rails, a wreck burnt out.
//
// Their record for ship.wgsl (groundPos): model[0] = (turret yaw [rad], arm pitch [rad, + up], missiles left, burnt 0…1),
// model[1] = (turretZ, armY, armZ, 0).

import type { TargetKind } from "./combat";

export type GroundUnitId = "gu-tel" | "gu-tank" | "gu-truck" | "gu-bunker" | "gu-has" | "gu-tower" | "gu-fuel" | "gu-crater";

export interface GroundUnitShape {
  turretZ: number;
  armY: number;
  armZ: number;
  /** its arm's or gun's rest and its elevation when it engages [rad]; its rails' missiles (0: none) */
  rest: number;
  raised: number;
  rails: number;
  /** where a guided bomb aims on it: its middle's height over the ground [m] (a tower's shaft, not its foot) */
  aimH?: number;
}

export const GROUND_UNITS: Record<GroundUnitId, GroundUnitShape> = {
  "gu-tel": { turretZ: -0.5, armY: 2.45, armZ: -2.6, rest: 0, raised: 0.5, rails: 4, aimH: 2 },
  "gu-tank": { turretZ: -0.3, armY: 1.9, armZ: 1.6, rest: 0, raised: 0.12, rails: 0, aimH: 1.3 },
  "gu-truck": { turretZ: 0, armY: 0, armZ: 0, rest: 0, raised: 0, rails: 0, aimH: 1.6 },
  "gu-bunker": { turretZ: 0, armY: 0, armZ: 0, rest: 0, raised: 0, rails: 0, aimH: 2.2 },
  "gu-has": { turretZ: 0, armY: 0, armZ: 0, rest: 0, raised: 0, rails: 0, aimH: 3.5 },
  "gu-tower": { turretZ: 0, armY: 0, armZ: 0, rest: 0, raised: 0, rails: 0, aimH: 12 },
  "gu-fuel": { turretZ: 0, armY: 0, armZ: 0, rest: 0, raised: 0, rails: 0, aimH: 4 },
  "gu-crater": { turretZ: 0, armY: 0, armZ: 0, rest: 0, raised: 0, rails: 0 },
};

/** a target's mesh: its own (a mission's, a scenario's — a bunker drawn as a shelter, a tower, a fuel tank) when it is a ground
 *  unit's, else its kind's */
export const groundMeshOf = (q: { kind: TargetKind; mesh?: string }): GroundUnitId | undefined =>
  q.mesh && q.mesh in GROUND_UNITS ? (q.mesh as GroundUnitId) : GROUND_MESH[q.kind];

/** each ground kind's mesh (none: not a ground unit) */
export const GROUND_MESH: Partial<Record<TargetKind, GroundUnitId>> = {
  sam: "gu-tel",
  tank: "gu-tank",
  truck: "gu-truck",
  bunker: "gu-bunker",
};

/**
 * A unit's pose now: its turret turned from its heading `hdg` towards `threat` (east, north from it [m]; null none) — eased at
 * `slew` rad/s from its last —, its arm raised while it engages, the rails' missiles left, burnt once dead (over 3 s).
 */
export function groundPose(
  shape: GroundUnitShape,
  hdg: number,
  threat: [number, number] | null,
  last: { yaw: number; pitch: number } | undefined,
  dt: number,
  left: number,
  deadFor: number | null,
): { yaw: number; pitch: number; left: number; burnt: number } {
  const slew = 0.6;
  // (its turret's yaw about its own up: + to its left — the mesh's x —, the threat's bearing less its heading)
  const want = threat ? wrap(hdg - Math.atan2(threat[0], threat[1])) : 0;
  const y0 = last?.yaw ?? want;
  const yaw = y0 + Math.max(-slew * dt, Math.min(slew * dt, wrap(want - y0)));
  const pWant = threat && deadFor === null ? shape.raised : shape.rest;
  const p0 = last?.pitch ?? pWant;
  const pitch = p0 + Math.max(-0.3 * dt, Math.min(0.3 * dt, pWant - p0));
  return { yaw, pitch, left, burnt: deadFor === null ? 0 : Math.min(1, deadFor / 3) };
}
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
