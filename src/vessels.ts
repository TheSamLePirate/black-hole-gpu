// The craft the player flies: Interstellar's Ranger, its Lander and the Endurance itself — and for the Earth's
// air a fighter, the F-35B (docs/PLAN-F35.md), and an airliner, the A320 (docs/PLAN-A320.md). One is flown at a time — the camera rides it (controls.ts); the others coast on Kepler orbits, or stay docked
// (fleet.ts). Each has its mesh (ship.ts draws them together), its mass and engines, how fast it turns,
// its docking ports, its thrusters and the camera's attach points on it.
//
// Ship frame (as the Ranger's, mounts.ts): x to its left, y up, z towards the nose; metres; the belly at
// y ≈ 0 (the landing gear's reference: landing.ts GEAR).

import type { V3 } from "./mounts";
import type { VesselAero } from "./aero";
import { F135, type TurbofanDef } from "./f35/engine";
import { CFM56_PAIR } from "./a320/engine";
// (the A320's JSBSim aerodynamics registered: VesselAero.model "a320")
import "./a320/aero";

export type VesselId = "ranger" | "lander" | "endurance" | "f35" | "a320";
export const VESSEL_IDS: VesselId[] = ["ranger", "lander", "endurance", "f35", "a320"];
/** The aircraft: only where they are flown — put on a runway when chosen (controller/fleet.ts). */
export type AircraftId = "f35" | "a320";
export const isAircraft = (id: VesselId): id is AircraftId => id === "f35" || id === "a320";
/** The spacecraft: the fleet near the Earth, always somewhere (fleet.ts fleetStart). */
export type SpacecraftId = Exclude<VesselId, AircraftId>;
/** The craft that fly as aeroplanes in the air (the plane law by default, a runway's take-off and landing). */
export const isPlane = (id: VesselId) => id === "ranger" || isAircraft(id);
export const SPACECRAFT: SpacecraftId[] = ["ranger", "lander", "endurance"];

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
  /** its principal radii of gyration [m] about its x (left: pitch), y (up: yaw), z (nose: roll) axes —
   *  its inertia tensor, m k², full of propellant (phase 2: Euler's equations) */
  rg: V3;
  /** where its propellant sits (ship frame): the centre of mass moves as it burns */
  tank: V3;
  /** how fast its own reaction wheels and thrusters turn it alone (× the Ranger's turn settings) */
  agility: number;
  /** its centre of mass (ship frame) */
  com: V3;
  /** where the outside views circle (ship frame), and their distance [m] */
  centre: V3;
  viewDist: number;
  ports: Port[];
  /** a craft turned about its long axis for its crew's weight (the Endurance — the whole of it turns, as in the film):
   *  its ring's radius [m] (PLAN-VAISSEAUX X2a) */
  ring?: { radius: number };
  /** a spacecraft's own HUD (docs/PLAN-VAISSEAUX-AAA.md, X4; game/craftpanel.ts): its panel — the Lander's descent, the
   *  Endurance's mothership's */
  space?: { panel?: "descent" | "mothership" };
  /** the cabin drawn from inside (PLAN-VAISSEAUX X6b–c): the Ranger's own (scripts/build-cockpit.ts — "the endurance
   *  lander cockpit": the film's three craft share it), placed in this craft's frame by its offset [m] (the
   *  Ranger's: none); none: its hull seen from within */
  cabin?: { offset: V3 };
  /** its voice (PLAN-VAISSEAUX X7): the main engine's pitch, the thrusters' tone, the structure's rumble (× the
   *  Ranger's: a lively one; the Lander heavy and low; the Endurance deep and slow) */
  sound?: { pitch: number; rcs: number; sub: number };
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
  /** its wingtips (ship frame, the left one): where the tip vortices' trails start (contrails.ts) */
  wingtip?: V3;
  /** a fighter's: its left wing's upper surface (root and tip, a little above it — the high-g vapour sheet's
   *  line) and its leading-edge extension's apex (the vortex that condenses at a high angle of attack) */
  vapour?: { root: V3; tip: V3; apex: V3 };
  /** an aircraft's engine — an afterburning turbofan (src/f35/engine.ts) — instead of a rocket's: its thrust
   *  from the air it breathes; its fuel [kg] (in `mass`, burnt by the engine's consumption: no rocket tank) */
  turbofan?: TurbofanDef;
  fuelKg?: number;
  /** its flight control system (pilot.ts's plane law): the rates the stick asks (pitch, yaw, roll) [rad/s],
   *  the load factor's limits [g] and the angle of attack's [rad] */
  fbw?: { rates: V3; gMax: number; gMin: number; alphaMax: number };
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

// the F-35B: its one engine's nozzle (scripts/build-f35.py: the petals' ring 1.13 m across, its exit 7.7 m
// behind the centre — the plume's start —, 1.05 m up); no attitude thrusters (its roll posts: F4)
const F35_JETS: JetDef[] = [{ p: [0, 1.05, -6.2], d: [0, 0, -1], half: [0.42, 0.42], u: [1, 0, 0], main: true }];

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
    // (a delta: long and wide, thin — least about the nose)
    rg: [4.6, 4.9, 3.0],
    tank: [0, 1.1, -1.5],
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
    wingtip: [4.1, 0.44, -0.3],
    // a lifting body (8.3 m span, 14.8 m long, 91 m² of planform: the hull, scripts/hullsize): a flat
    // belly, a fine nose; the shield under the belly and round the nose (the Shuttle's tiles and RCC) —
    // 98 m/s at 16° on the approach, L/D ≈ 6 gliding, ≈ 1 at 40° in hypersonic flow
    aero: {
      area: [23, 91, 1.3],
      cdA0: 1.6,
      wing: { S: 91, AR: 2, cla: 2.6, stall: 0.4, e: 0.85, dihedral: 0.05 },
      // (its twin fins, as one: 8 m² some 6.5 m behind the centre of mass)
      fin: { S: 8, cla: 2.2, at: [0, 1.6, -6.5] },
      cp: [
        [0, 0.3, -2.5],
        [0, 0, -0.25],
        [0, 0.6, 0],
      ],
      cw: [0, 0, -0.9],
      curve: [0, 0.1, 0.6],
      // (the roll's own damping now partly the wing halves': 0.6 → 0.3)
      damp: [4, 4, 0.3],
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
    rg: [7.3, 7.0, 8.2],
    tank: [0, 1.8, 0.5],
    agility: 0.55,
    com: [0, 2.6, 0.5],
    centre: [0, 2.8, 0],
    viewDist: 62,
    // the round hatch on its back, amidships (scripts/build-lander.ts)
    ports: [{ name: "dorsal hatch", centre: [0, 5.55, 0.58], axis: [0, 1, 0] }],
    space: { panel: "descent" },
    lands: true,
    // (the Ranger's cabin behind its nose's windows: the pilot's eye at its cockpit's — X6b)
    cabin: { offset: [-1.0, 1.95, 7.3] },
    // (a descent stage's heavy throttled engine, its thrusters' deeper hiss)
    sound: { pitch: 0.72, rcs: 0.8, sub: 0.8 },
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
      // (behind the nose's windows: the Ranger's cabin placed there — its pilot's eye on the Lander's)
      cockpit: { eye: [0, 3.4, 10.4], aim: [0, 3.17, 20.3] },
      cabin: { eye: [0, 3.4, 10.4], aim: [0, 3.4, 20.3] },
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
    // (a ring: most about its axis)
    rg: [21, 21, 30],
    tank: [0, 0, 0],
    agility: 0.2,
    com: [0, 0, 0],
    centre: [0, 0, 0],
    viewDist: 150,
    // the hub's two ends, on its axis (assets/endurance: the hub's tips at z = 9.2 and −10.7 m)
    ports: [
      { name: "hub, fore", centre: [0, 0, 9.3], axis: [0, 0, 1] },
      { name: "hub, aft", centre: [0, 0, -10.7], axis: [0, 0, -1] },
    ],
    // (its modules' ring about the hub: the radius of gyration about the axis)
    space: { panel: "mothership" },
    ring: { radius: 30 },
    lands: false,
    // (the Ranger's cabin in its command module: the pilot's eye at its cockpit's — X6c)
    cabin: { offset: [-1.0, -0.25, 4.4] },
    // (a ship of a hundred metres: its engines' voice an octave down, its thrusters a low roar, its frame groaning)
    sound: { pitch: 0.48, rcs: 0.6, sub: 0.6 },
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
      // (in the hub's command module, looking ahead along it: the Ranger's cabin placed there)
      cockpit: { eye: [0, 1.2, 7.5], aim: [0, 0.97, 17.4] },
      cabin: { eye: [0, 1.2, 7.5], aim: [0, 1.2, 17.4] },
      quarter: { eye: [46, 26, -62], aim: [-10, 0, 40] },
      chase: { eye: [0, 30, -80], aim: [0, 0, 40] },
      dorsal: { eye: [0, 38, -12], aim: [0, 30, 60] },
      wing: { eye: [-44, 6, -34], aim: [0, 0, 40] },
      belly: { eye: [0, -38, -12], aim: [0, -30, 60] },
      rear: { eye: [0, 3, 16], aim: [0, 0, -10] },
      dock: { eye: [0, 0, 9.6], aim: [0, 0, 60] },
    },
  },
  // the F-35B (assets/f35: scripts/build-f35.py — 15.4 m long, 10.7 m span, its belly gear up at y = 0, the
  // wheels 1.17 m under it): 14.7 t empty, the pilot and his kit, 6.1 t of fuel — 20.9 t as it leaves the ramp
  f35: {
    id: "f35",
    name: "F-35B",
    mass: 14650 + 150 + 6125,
    fuelKg: 6125,
    turbofan: F135,
    // (the stick's rates: 30°/s in pitch, 10°/s of sideslip's yaw, 190°/s of roll; +7 / −3 g; 50° of angle of
    // attack — the real aircraft's commanded limit, its chines' vortices lifting past the wing's stall: aero.highAlpha)
    fbw: { rates: [0.52, 0.18, 3.3], gMax: 7, gMin: -3, alphaMax: 0.87 },
    accel: 1,
    slThrust: 1,
    spool: F135.spool,
    gyr: 3.2,
    // (a fighter's: long, its wings short — least about the nose; F-16's scaled: 0.22 L, 0.24 L, 0.1 L)
    rg: [3.4, 3.7, 1.6],
    tank: [0, 1.3, -1.2],
    // (no reaction wheels: it turns by its control surfaces — its roll posts in a hover, F4)
    agility: 0.05,
    // (a quarter of the wing's mean chord: 1.1 m ahead of the main wheels)
    com: [0, 1.25, -1.6],
    centre: [0, 1.2, -0.4],
    viewDist: 24,
    ports: [],
    lands: true,
    jets: F35_JETS,
    flame: 0.35,
    flies: true,
    wingtip: [5.36, 1.16, -3.0],
    vapour: { root: [1.8, 1.32, -1.9], tip: [5.0, 1.27, -2.85], apex: [0.85, 1.55, 3.0] },
    // a fighter (42.7 m² of wing, aspect ratio 2.7; two canted fins of 4.6 m² each; the fuselage's
    // planform with the wing ~62 m²): low drag (C_D0 ≈ 0.021)
    // (the nose's face nearly nothing — a fine nose, its drag in cdA0; the lift slope the whole craft's
    // over the wing's area, its body and chines included: 3.8/rad — the F-16's 4)
    aero: {
      area: [20, 62, 0.25],
      cdA0: 0.62,
      wave: 0.95,
      wing: { S: 42.7, AR: 2.68, cla: 3.8, stall: 0.45, e: 0.7, dihedral: -0.03 },
      fin: { S: 9.2, cla: 2.4, at: [0, 1.6, -4.2] },
      cp: [
        [0, 0.3, -1.0],
        [0, 0, -0.2],
        [0, 0.2, 0],
      ],
      cw: [0, 0, -0.35],
      curve: [0, 0.1, 0.4],
      // (the roll's damping the wing halves' own — aero.ts —: little more)
      damp: [1.5, 1.5, 0.03],
      len: 15.4,
      noseR: 0.25,
      shield: null,
      hull: { tMax: 480, cap: 8e3, eps: 0.85 },
      // (it breaks past 1.5 × its limit: the flight control system holds it at 7)
      gMax: 10.5,
      ctrl: [0.6, 0.25, 2.2],
      // its high incidence (docs/PLAN-AVIATION-AAA.md, V2; F/A-18 HARV's and the F-16's published shapes, the
      // F-35's own figures — 50° commanded, recoverable from every departure flown in its tests):
      highAlpha: {
        // (the lift slope 3.8/rad to 20°, its vortices' lift on to a peak of 1.74 at 35°, a flat plate's past 60°)
        cl: [
          [0, 0],
          [10, 0.663],
          [20, 1.27],
          [25, 1.5],
          [30, 1.66],
          [35, 1.74],
          [40, 1.7],
          [45, 1.58],
          [50, 1.44],
          [60, 1.15],
          [70, 0.82],
          [80, 0.43],
          [90, 0],
        ],
        // (its pitch break from 30°, strongest at 40–48° — the wing's own restoring moment there nearly
        // cancelled: the deep stall a law keeps off —, a flat plate's nose-down past 60° that brings it back)
        cm: [
          [0, 0],
          [28, 0],
          [34, 0.07],
          [40, 0.16],
          [48, 0.15],
          [55, 0.04],
          [62, -0.06],
          [72, -0.2],
          [82, -0.34],
          [90, -0.42],
        ],
        chord: 4.0,
        fin: [
          [0, 1],
          [20, 1],
          [35, 0.5],
          [50, 0.25],
          [70, 0.15],
          [90, 0.1],
        ],
        // (its forebody against the sideslip: the fins' 0.2 at low incidence, half that at 35°, outdone past 40°)
        cnBeta: [
          [0, 0],
          [20, 0],
          [30, 0.06],
          [40, 0.12],
          [55, 0.1],
          [70, 0.04],
          [90, 0.02],
        ],
        sweepDihedral: 0.12,
        // (past 50° the yaw's damping turns propelling — the spin's own moment —; the roll's nearly gone)
        damp60: [1.4, -0.6, 0.25],
        ctrl60: [0.7, 0.35, 0.4],
        buffet: [18, 32],
      },
    },
    mounts: {
      // (the pilot's eyes: in the helmet the model sits — scripts/build-f35.py)
      cockpit: { eye: [0, 2.0, 4.6], aim: [0, 1.78, 30] },
      cabin: { eye: [0, 2.0, 4.6], aim: [0, 2.0, 30] },
      quarter: { eye: [7.5, 3.6, -9.5], aim: [-2, 1.2, 8] },
      chase: { eye: [0, 3.9, -17], aim: [0, 1.4, 10] },
      dorsal: { eye: [0, 3.0, -1.2], aim: [0, 2.2, 20] },
      wing: { eye: [-5.6, 2.1, -3.8], aim: [-0.4, 1.2, 10] },
      belly: { eye: [0.4, -0.35, -2.4], aim: [0.1, 0.1, 20] },
      rear: { eye: [0, 1.9, 10.5], aim: [0, 1.3, -6] },
      dock: { eye: [0, 1.9, 4.55], aim: [0, 1.72, 30] },
    },
  },
  // the A320-214 (assets/a320: scripts/build-a320.py from FlightGear's A320-family — 37.57 m long, 35.80 m span, its
  // belly at y = 0, the wheels 1.74 m under it; ship = (−y, z + 2.648, −x) of JSBSim's frame): 43.3 t empty (the FDM's),
  // 150 passengers and their bags 13.5 t, 8 t of fuel — 64.8 t (docs/PLAN-A320.md: A3 reads the rest of the FDM)
  a320: {
    id: "a320",
    name: "A320",
    mass: 43277 + 13500 + 8000,
    fuelKg: 8000,
    turbofan: CFM56_PAIR,
    // (Airbus's normal law: 15°/s of roll at full stick, +2.5 / −1 g, the angle of attack held under α max)
    fbw: { rates: [0.12, 0.05, 0.26], gMax: 2.5, gMin: -1, alphaMax: 0.26 },
    accel: 1,
    slThrust: 1,
    spool: CFM56_PAIR.spool,
    gyr: 7,
    // (the FDM's inertia, empty: Ixx 0.96, Iyy 2.49, Izz 1.89 × 10⁶ kg m² — radii 7.6, 6.6, 4.7 m)
    rg: [7.6, 6.6, 4.7],
    tank: [0, 1.6, 1.5],
    agility: 0.02,
    // (28.5 % of the mean chord: JSBSim's CG at x = −2.4335, z = −0.934)
    com: [0, 1.714, 2.43],
    centre: [0, 2.6, 0],
    viewDist: 52,
    ports: [],
    lands: true,
    // (its two CFM56s' exhausts: their cores at JSBSim's x = 4.5, y = ±5.63, z = −2.22 — FlightGear's contrails)
    jets: [5.63, -5.63].map((x) => ({
      p: [x, 0.43, -1.5] as V3,
      d: [0, 0, -1] as V3,
      half: [0.45, 0.45] as [number, number],
      u: [1, 0, 0] as V3,
      main: true,
    })),
    flame: 0.2,
    flies: true,
    wingtip: [17.0, 2.95, -2.0],
    aero: {
      // (its own: FlightGear's JSBSim model — src/a320/aero.ts —; the rest below its heat's and limits', and the
      // generic model's figures for what reads them — the map's drag, a stand-in's)
      model: "a320",
      area: [90, 150, 0.5],
      // (C_D0 0.019 on 122.6 m²: the FDM's)
      cdA0: 2.33,
      wing: { S: 122.6, AR: 10.45, cla: 4.8, stall: 0.22, e: 0.78, dihedral: 0.087 },
      fin: { S: 21.5, cla: 2.5, at: [0, 5.4, -17.9] },
      cp: [
        [0, 0.5, -3.0],
        [0, 0, -1.0],
        [0, 0.3, 0],
      ],
      cw: [0, 0, -0.17],
      curve: [0, 0.2, 0.6],
      damp: [2.0, 2.0, 0.03],
      len: 37.57,
      noseR: 2.0,
      shield: null,
      hull: { tMax: 400, cap: 8e3, eps: 0.85 },
      gMax: 3.75,
      ctrl: [0.05, 0.07, 0.3],
    },
    mounts: {
      // (the captain's eyes: FlightGear's "Captain View")
      cockpit: { eye: [0.45, 3.4, 16.0], aim: [0.45, 3.1, 60] },
      cabin: { eye: [0.45, 3.4, 16.0], aim: [0.45, 3.4, 60] },
      quarter: { eye: [22, 9, -26], aim: [-2, 2.4, 8] },
      chase: { eye: [0, 8.5, -48], aim: [0, 2.6, 10] },
      dorsal: { eye: [0, 5.2, 6], aim: [0, 4.6, 40] },
      wing: { eye: [-9.5, 4.6, -3], aim: [-14, 2.4, 0] },
      belly: { eye: [0.4, -0.5, 2], aim: [0.1, -0.2, 30] },
      rear: { eye: [0, 4.5, 30], aim: [0, 2.6, -10] },
      dock: { eye: [0.45, 3.4, 16.0], aim: [0.45, 3.1, 60] },
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
