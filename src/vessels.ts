// The spacecraft the player flies: Interstellar's Ranger, its Lander and the Endurance itself. One is
// flown at a time — the camera rides it (controls.ts); the others coast on Kepler orbits, or stay docked
// (fleet.ts). Each has its mesh (ship.ts draws them together), its mass and engines, how fast it turns,
// its docking ports, its thrusters and the camera's attach points on it.
//
// Ship frame (as the Ranger's, mounts.ts): x to its left, y up, z towards the nose; metres; the belly at
// y ≈ 0 (the landing gear's reference: landing.ts GEAR).

import type { V3 } from "./mounts";
import type { VesselAero } from "./aero";

export type VesselId = "ranger" | "lander" | "endurance";
export const VESSEL_IDS: VesselId[] = ["ranger", "lander", "endurance"];

/** A docking port: the centre of its ring and the axis out of it (ship frame). */
export interface Port {
  name: string;
  centre: V3;
  axis: V3;
}

/** A thruster (ship frame, metres): exit centre, exhaust direction, the exit's half-sizes and width axis. */
export interface JetDef {
  p: V3;
  d: V3;
  half: [number, number];
  u: V3;
  main: boolean;
}

export interface VesselDef {
  id: VesselId;
  name: string;
  /** dry mass with its propellant [kg] */
  mass: number;
  /** its engines' acceleration alone, as a share of the crew setting's (the Ranger's: 1) — at full tanks */
  accel: number;
  /** its main engine's thrust at sea level over its thrust in a vacuum (the nozzle's exit against the air) */
  slThrust: number;
  /** its main engine's answer to the throttle: a lag's time constant [s] */
  spool: number;
  /** its radius of gyration [m]: the moment of inertia, m k² — how fast it turns (the Ranger's turn rates
   *  for its own) */
  gyr: number;
  /** how fast its own reaction wheels and thrusters turn it alone (× the Ranger's turn settings) */
  agility: number;
  /** its centre of mass (ship frame) */
  com: V3;
  /** where the outside views circle (ship frame), and their distance [m] */
  centre: V3;
  viewDist: number;
  ports: Port[];
  /** a ground under it: its gear (the Endurance has none — it never lands) */
  lands: boolean;
  jets: JetDef[];
  /** the camera's attach points on it (mounts.ts: the same names, its own places) */
  mounts: Record<"cockpit" | "cabin" | "quarter" | "chase" | "dorsal" | "wing" | "belly" | "rear" | "dock", { eye: V3; aim: V3 }>;
  /** the main engines' flame length scale (× the Ranger's) */
  flame: number;
  /** its aerodynamics and heat protection (aero.ts) */
  aero: VesselAero;
  /** built for the air: its three ways of flying there (plane, rocket, the flight computer's) */
  flies: boolean;
}

/** Attitude thrusters: a quad at each corner (lateral, up, down) and fore / aft pairs. */
function rcsQuads(corners: V3[], fore: V3[]): JetDef[] {
  const jets: JetDef[] = [];
  const rcs = (p: V3, d: V3, u: V3) =>
    jets.push({ p: [p[0] + 0.06 * d[0], p[1] + 0.06 * d[1], p[2] + 0.06 * d[2]], d, half: [0.08, 0.08], u, main: false });
  for (const c of corners) {
    const sx = Math.sign(c[0]) || 1;
    rcs(c, [sx, 0, 0], [0, 0, 1]);
    rcs([c[0] - 0.25 * sx, c[1] + 0.12, c[2]], [0, 1, 0], [1, 0, 0]);
    rcs([c[0] - 0.25 * sx, c[1] - 0.12, c[2]], [0, -1, 0], [1, 0, 0]);
  }
  for (const f of fore) {
    rcs([f[0], f[1], f[2] - 0.25], [0, 0, -1], [1, 0, 0]);
    rcs([f[0], f[1], f[2] + 0.25], [0, 0, 1], [1, 0, 0]);
  }
  return jets;
}

// the Ranger: its two main engines in the rear bays (the mesh's "nozzle" parts: 1.55 × 0.85 m, exits at
// z = −4.65); quads on the nose's and the tail wing's corners, a pair at each wingtip for roll
const RANGER_JETS: JetDef[] = (() => {
  const jets: JetDef[] = (
    [
      [1.76, 1.19, -4.62],
      [-1.76, 1.19, -4.62],
    ] as V3[]
  ).map((p) => ({ p, d: [0, 0, -1] as V3, half: [0.6, 0.33] as [number, number], u: [1, 0, 0] as V3, main: true }));
  const rcs = (p: V3, d: V3, u: V3) =>
    jets.push({ p: [p[0] + 0.06 * d[0], p[1] + 0.06 * d[1], p[2] + 0.06 * d[2]], d, half: [0.08, 0.08], u, main: false });
  for (const sx of [1, -1]) {
    const nose: V3 = [2.52 * sx, 1.38, 7.55];
    const tail: V3 = [3.12 * sx, 1.5, -3.0];
    const tip: V3 = [4.1 * sx, 0.44, 0.1];
    rcs(nose, [sx, 0, 0], [0, 0, 1]);
    rcs([nose[0] - 0.25 * sx, nose[1] + 0.12, nose[2]], [0, 1, 0], [1, 0, 0]);
    rcs([nose[0] - 0.25 * sx, nose[1] - 0.12, nose[2]], [0, -1, 0], [1, 0, 0]);
    rcs(tail, [sx, 0, 0], [0, 0, 1]);
    rcs([tail[0] - 0.25 * sx, tail[1] + 0.12, tail[2]], [0, 1, 0], [1, 0, 0]);
    rcs([tail[0] - 0.25 * sx, tail[1] - 0.12, tail[2]], [0, -1, 0], [1, 0, 0]);
    rcs([tail[0] - 0.3 * sx, tail[1], tail[2] - 0.25], [0, 0, -1], [1, 0, 0]);
    rcs([tail[0] - 0.3 * sx, tail[1], tail[2] + 0.25], [0, 0, 1], [1, 0, 0]);
    rcs([tip[0], tip[1] + 0.08, tip[2]], [0, 1, 0], [0, 0, 1]);
    rcs([tip[0], tip[1] - 0.08, tip[2]], [0, -1, 0], [0, 0, 1]);
  }
  return jets;
})();

// the Lander: six nozzles, three in each of the canted pods at its tail (0.6 m exits, from the model's
// rear view), quads on its four corners, pairs fore and aft on the spine
const LANDER_JETS: JetDef[] = [
  ...(
    [
      [3.5, 3.8],
      [4.35, 2.7],
      [5.0, 1.55],
    ] as [number, number][]
  ).flatMap(([x, y]) =>
    [x, -x].map((px) => ({
      p: [px, y, -11.7] as V3,
      d: [0, 0, -1] as V3,
      half: [0.55, 0.55] as [number, number],
      u: [1, 0, 0] as V3,
      main: true,
    })),
  ),
  ...rcsQuads(
    [
      [8.2, 3.2, 8.5],
      [-8.2, 3.2, 8.5],
      [8.4, 3.0, -8.5],
      [-8.4, 3.0, -8.5],
    ],
    [
      [0, 5.4, 9.5],
      [0, 5.4, -9.5],
    ],
  ),
];

// the Endurance: four engines at the back of its hub's frame (the film's ring of modules pushed along the
// hub), quads on four of its ring modules
const ENDURANCE_JETS: JetDef[] = [
  ...(
    [
      [0, 9],
      [9, 0],
      [0, -9],
      [-9, 0],
    ] as [number, number][]
  ).map(([x, y]) => ({
    p: [x, y, -10.4] as V3,
    d: [0, 0, -1] as V3,
    half: [1.1, 1.1] as [number, number],
    u: [1, 0, 0] as V3,
    main: true,
  })),
  ...rcsQuads(
    [
      [31.5, 0, 0],
      [-31.5, 0, 0],
      [22.3, 22.3, 0],
      [-22.3, -22.3, 0],
    ],
    [
      [0, 31.5, 0],
      [0, -31.5, 0],
    ],
  ),
];

export const VESSELS: Record<VesselId, VesselDef> = {
  ranger: {
    id: "ranger",
    name: "Ranger",
    mass: 40e3,
    accel: 1,
    // (a spaceplane's engines: a short nozzle, quick)
    slThrust: 0.9,
    spool: 0.4,
    gyr: 4.2,
    agility: 1,
    com: [0, 1.25, 1.5],
    centre: [0, 1.5, 0],
    viewDist: 42,
    // the rear hatch: its ring's centre, the axis out of the ship's back
    ports: [{ name: "rear hatch", centre: [0.04, 1.11, -5.34], axis: [0, 0, -1] }],
    lands: true,
    jets: RANGER_JETS,
    flame: 1,
    flies: true,
    // a lifting body (8.3 m span, 14.8 m long, 91 m² of planform: the hull, scripts/hullsize): a flat
    // belly, a fine nose; the shield under the belly and round the nose (the Shuttle's tiles and RCC) —
    // 98 m/s at 16° on the approach, L/D ≈ 6 gliding, ≈ 1 at 40° in hypersonic flow
    aero: {
      area: [23, 91, 1.3],
      cdA0: 1.6,
      wing: { S: 91, AR: 2, cla: 2.6, stall: 0.4, e: 0.85 },
      cp: [
        [0, 0.3, -2.5],
        [0, 0, -0.25],
        [0, 0.6, 0],
      ],
      cw: [0, 0, -0.9],
      curve: [0, 0.1, 0.6],
      damp: [4, 4, 0.6],
      len: 14.8,
      noseR: 1.2,
      shield: { dir: [0, -0.94, 0.34], cos: 0.42, tMax: 1950, cap: 2.2e4, eps: 0.85 },
      hull: { tMax: 1150, cap: 9e3, eps: 0.7 },
      gMax: 9,
      ctrl: [0.22, 0.1, 0.45],
    },
    mounts: {
      // (the pilot's seat, front left: the cabin, scripts/build-cockpit.ts)
      cockpit: { eye: [1.0, 1.45, 3.1], aim: [1.0, 1.22, 13] },
      cabin: { eye: [1.0, 1.45, 3.1], aim: [1.0, 1.45, 13] },
      quarter: { eye: [6.2, 3.9, -10.5], aim: [-3.5, 2.6, 14] },
      chase: { eye: [0, 4.4, -13.5], aim: [0, 1.3, 12] },
      dorsal: { eye: [0, 3.7, -3.0], aim: [0, 2.4, 20] },
      wing: { eye: [-6.2, 2.3, -6.5], aim: [-0.5, 1.0, 14] },
      belly: { eye: [0.6, -0.55, -4.5], aim: [0.2, -0.1, 20] },
      rear: { eye: [0, 2.0, 11.2], aim: [0, 1.5, -6] },
      dock: { eye: [0.04, 1.11, -5.5], aim: [0.04, 1.11, -40] },
    },
  },
  lander: {
    id: "lander",
    name: "Lander",
    mass: 160e3,
    accel: 0.75,
    // (a lander's throttleable engine)
    slThrust: 0.85,
    spool: 0.3,
    gyr: 7.5,
    agility: 0.55,
    com: [0, 2.6, 0.5],
    centre: [0, 2.8, 0],
    viewDist: 62,
    // the round hatch on its back, amidships (scripts/build-lander.ts)
    ports: [{ name: "dorsal hatch", centre: [0, 5.55, 0.58], axis: [0, 1, 0] }],
    lands: true,
    jets: LANDER_JETS,
    flame: 1.6,
    flies: true,
    // a broad lifting body (17.3 × 24 m, 304 m² of planform), blunt: its shield the whole belly
    aero: {
      area: [92, 304, 26],
      cdA0: 4,
      wing: { S: 304, AR: 1, cla: 1.5, stall: 0.45, e: 0.8 },
      cp: [
        [0, 0.6, -2.5],
        [0, 3.5, -0.1],
        [0, 1.2, 0],
      ],
      cw: [0, 0, -0.8],
      curve: [0.3, 0.7, 0.5],
      damp: [3, 3, 0.5],
      len: 24,
      noseR: 3,
      shield: { dir: [0, -1, 0], cos: 0.5, tMax: 2300, cap: 3e4, eps: 0.85 },
      hull: { tMax: 1000, cap: 1e4, eps: 0.7 },
      gMax: 6,
      ctrl: [0.08, 0.04, 0.15],
    },
    mounts: {
      // (behind the nose's windows — the Lander's cabin is not modelled: the hull seen from within)
      cockpit: { eye: [0, 3.4, 10.4], aim: [0, 3.1, 30] },
      cabin: { eye: [0, 3.4, 10.4], aim: [0, 3.4, 30] },
      quarter: { eye: [10.5, 8.5, -19], aim: [-5, 3.5, 22] },
      chase: { eye: [0, 9.5, -24], aim: [0, 3, 20] },
      dorsal: { eye: [0, 7.6, -7.5], aim: [0, 5, 30] },
      wing: { eye: [-10, 5, -12], aim: [-1, 2.5, 22] },
      belly: { eye: [0.8, -0.6, -6], aim: [0.3, -0.2, 30] },
      rear: { eye: [0, 4.6, 12.8], aim: [0, 3, -10] },
      // (on the hatch, looking up out of it)
      dock: { eye: [0, 5.7, 0.58], aim: [0, 40, 0.58] },
    },
  },
  endurance: {
    id: "endurance",
    name: "Endurance",
    mass: 900e3,
    accel: 0.12,
    // (a vacuum engine's long bell: little thrust left at sea level; a big engine, slow)
    slThrust: 0.4,
    spool: 1.5,
    gyr: 24,
    agility: 0.2,
    com: [0, 0, 0],
    centre: [0, 0, 0],
    viewDist: 150,
    // the hub's two ends, on its axis (assets/endurance: the hub's tips at z = 9.2 and −10.7 m)
    ports: [
      { name: "hub, fore", centre: [0, 0, 9.3], axis: [0, 0, 1] },
      { name: "hub, aft", centre: [0, 0, -10.7], axis: [0, 0, -1] },
    ],
    lands: false,
    jets: ENDURANCE_JETS,
    flame: 2.2,
    flies: false,
    // a ring of modules, no shield, no wing: it tumbles and burns
    aero: {
      area: [900, 900, 1500],
      cdA0: 60,
      cp: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      cw: [0, 0, 0],
      curve: [0.8, 0.8, 0.8],
      damp: [1, 1, 1],
      len: 64,
      noseR: 2,
      shield: null,
      hull: { tMax: 700, cap: 6e3, eps: 0.6 },
      gMax: 1.5,
      ctrl: [0, 0, 0],
    },
    mounts: {
      // (in the hub, looking ahead along it)
      cockpit: { eye: [0, 1.2, 7.5], aim: [0, 1.0, 40] },
      cabin: { eye: [0, 1.2, 7.5], aim: [0, 1.2, 40] },
      quarter: { eye: [46, 26, -62], aim: [-10, 0, 40] },
      chase: { eye: [0, 30, -80], aim: [0, 0, 40] },
      dorsal: { eye: [0, 38, -12], aim: [0, 30, 60] },
      wing: { eye: [-44, 6, -34], aim: [0, 0, 40] },
      belly: { eye: [0, -38, -12], aim: [0, -30, 60] },
      rear: { eye: [0, 3, 16], aim: [0, 0, -10] },
      dock: { eye: [0, 0, 9.6], aim: [0, 0, 60] },
    },
  },
};

/** The ship frame's axes of a vessel docked on another: its ring on the other's, its port's axis against
 *  the other's, the roll given by `up` (a vector in the host's frame, kept as close as it can be). */
export function dockedFrame(guest: Port, host: Port, up: V3): { c: V3; ax: [V3, V3, V3] } {
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: V3): V3 => {
    const l = Math.hypot(...a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  // the guest's frame (columns: its x, y, z in the host's frame) from two pairs: its port's axis → −host's;
  // a reference perpendicular to it → `up` projected
  const a = guest.axis,
    b: V3 = [-host.axis[0], -host.axis[1], -host.axis[2]];
  const ra: V3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const pa = unit(cross(a, cross(ra, a)));
  let pb = cross(b, cross(up, b));
  if (Math.hypot(...pb) < 1e-6) pb = cross(b, cross(Math.abs(b[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], b));
  pb = unit(pb);
  const qa = cross(a, pa),
    qb = cross(b, pb);
  // R maps (a, pa, qa) to (b, pb, qb): R = Σ b_i ⊗ a_i
  const R = (v: V3): V3 => {
    const x = dot(v, a),
      y = dot(v, pa),
      z = dot(v, qa);
    return [b[0] * x + pb[0] * y + qb[0] * z, b[1] * x + pb[1] * y + qb[1] * z, b[2] * x + pb[2] * y + qb[2] * z];
  };
  const ax: [V3, V3, V3] = [R([1, 0, 0]), R([0, 1, 0]), R([0, 0, 1])];
  const g = R(guest.centre);
  return { c: [host.centre[0] - g[0], host.centre[1] - g[1], host.centre[2] - g[2]], ax };
}
