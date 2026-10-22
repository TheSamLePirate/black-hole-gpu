// The A320's moving parts from the flight (docs/PLAN-A320.md, A2): FlightGear's properties its animations read
// (src/a320/rig.ts) — the gear and its doors in their sequence, the oleos, the wheels rolling, the nose wheel
// steered; the slats and flaps by configuration (CONF 1, 1+F, 2, 3, FULL), the ailerons and the roll spoilers, the
// elevators, the trimmable stabiliser, the rudder, the speed brakes and the ground spoilers; the reversers, the
// fans turning with N1 (their blur disc past 40 %); the landing lights, the doors, the RAT, the AoA vanes, the
// wipers — each at its actuator's rate. Pure.

import type { Props } from "./rig";

type V3 = [number, number, number];

/** What the flight gives each frame. */
export interface A320Inputs {
  /** seconds since the last frame (real time: the actuators move in it) */
  dt: number;
  /** the surfaces' commands −1…1: the nose up, the nose right, a roll to the right (the flight computer's) */
  pitch: number;
  yaw: number;
  roll: number;
  /** the stabiliser's trim [deg] (+ nose up: its leading edge down) */
  trim: number;
  /** the flap lever: 0, 1, 2, 3, 4 (FULL) — 1 gives 1+F on the ground and below 100 kt —, the speed [kt] */
  flapLever: number;
  ias: number;
  /** the speed brake lever 0…1, the ground spoilers deployed 0…1 */
  speedBrake: number;
  groundSpoilers: number;
  /** the gear out 0…1 (the lever's sequence), each oleo compressed [m] (nose, left, right), on the ground, the
   *  speed along it [m/s], the nose wheel's steering −1…1 (> 0 to the right) */
  gear: number;
  comp: V3;
  onGround: boolean;
  groundSpeed: number;
  steer: number;
  /** each engine's N1 [%] and reverser 0…1 */
  n1: [number, number];
  reverser: [number, number];
  /** the angle of attack [deg] */
  alpha: number;
  /** the landing lights extended (on or off), the wipers running, the doors open (L1, L2, R1, R2, cargo fwd, aft,
   *  bulk) 0…1, the RAT out, the APU running (its inlet open) */
  landingLights?: boolean;
  wipers?: boolean;
  doors?: number[];
  rat?: boolean;
  apu?: boolean;
  /** the sharklets (a neo's) instead of the wingtip fences */
  sharklets?: boolean;
}

/** The slats' and flaps' angles for each configuration [deg] (FlightGear's SFCC, Systems/a320-fcs.xml; the
 *  CFM's FULL flaps at 35°) */
export const CONF = [
  { name: "0", slats: 0, flaps: 0 },
  { name: "1", slats: 18, flaps: 0 },
  { name: "1+F", slats: 18, flaps: 10 },
  { name: "2", slats: 22, flaps: 15 },
  { name: "3", slats: 22, flaps: 20 },
  { name: "FULL", slats: 27, flaps: 35 },
] as const;

/** The configuration the lever and the speed give (1 → 1+F on the ground or below 100 kt; FlightGear's rule). */
export function confOf(lever: number, ias: number, onGround: boolean): number {
  const l = Math.round(Math.min(Math.max(lever, 0), 4));
  if (l === 0) return 0;
  if (l === 1) return onGround || ias < 100 ? 2 : 1;
  return l + 1;
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
/** x moved towards `to` by at most rate·dt */
const toward = (x: number, to: number, rate: number, dt: number) => x + clamp(to - x, -rate * dt, rate * dt);

/** the wheels' radii [m] (the nose's 30 × 8.8 in tyres, the mains' 46 × 17 in) */
const WHEEL_R: V3 = [0.38, 0.585, 0.585];
/** the actuators' rates: [deg/s] for the surfaces, [/s] for the normalised ones */
const RATE = {
  aileron: 82,
  elevator: 45,
  rudder: 80,
  stab: 0.25,
  spoiler: 60,
  // (FlightGear's SFCC: 1.17°/s with both hydraulic systems — FULL from 0 in half a minute)
  slats: 1.0,
  flaps: 1.17,
  door: 0.7,
  reverser: 0.9,
  steer: 1.2,
  light: 0.25,
  wiper: 1.6,
  vane: 120,
  cabinDoor: 0.15,
};

export class A320Poser {
  /** the properties (FlightGear's paths) and the spinning parts' angles [rad] */
  props: Props = {};
  spins: Props = {};
  private s = {
    ail: [0, 0],
    elev: 0,
    rud: 0,
    stab: 0,
    spl: new Array(10).fill(0) as number[],
    slats: 0,
    flaps: 0,
    door: [0, 0, 0],
    rev: [0, 0],
    steer: 0,
    light: 0,
    wiper: 0,
    wiperDir: 1,
    vane: 0,
    doors: new Array(7).fill(0) as number[],
    rat: 0,
  };

  step(i: A320Inputs): { props: Props; spins: Props } {
    const s = this.s;
    const dt = clamp(i.dt, 0, 0.25);
    const P = this.props;
    // ---- the flight controls (deg): the ailerons ±25° (drooped 5° with the flaps), spoilers 2–5 helping the roll
    const roll = clamp(i.roll, -1, 1);
    const droop = s.flaps > 1 ? 5 : 0;
    const ail = [clamp(-roll * 25 + droop, -25, 25), clamp(roll * 25 + droop, -25, 25)];
    s.ail = s.ail.map((a, k) => toward(a, ail[k]!, RATE.aileron, dt));
    s.elev = toward(s.elev, clamp(-i.pitch, -1, 1) * (i.pitch > 0 ? 30 : 15), RATE.elevator, dt);
    s.rud = toward(s.rud, clamp(i.yaw, -1, 1) * 25, RATE.rudder, dt);
    s.stab = toward(s.stab, clamp(i.trim, -13.5, 4), RATE.stab * 4, dt);
    // (the spoilers L1…L5, R1…R5: the ground spoilers all out to 50°; the speed brakes 2–4 to 40° (25° in flight —
    // its lever's full travel); the roll: 2–5 on the side whose wing goes down, up to 35°)
    const gs = clamp(i.groundSpoilers, 0, 1) * 50;
    const sb = clamp(i.speedBrake, 0, 1) * (i.onGround ? 40 : 25);
    for (let side = 0; side < 2; side++) {
      const down = side === 0 ? Math.max(-roll, 0) : Math.max(roll, 0);
      for (let k = 0; k < 5; k++) {
        const sbk = k >= 1 && k <= 3 ? sb : 0;
        const rk = k >= 1 ? down * 35 : 0;
        const want = Math.max(gs, clamp(sbk + rk, 0, 50));
        s.spl[side * 5 + k] = toward(s.spl[side * 5 + k]!, want, RATE.spoiler, dt);
      }
    }
    // ---- the slats and flaps by configuration, at their own rates (FULL in some 30 s from 0)
    const c = CONF[confOf(i.flapLever, i.ias, i.onGround)]!;
    s.slats = toward(s.slats, c.slats, RATE.slats, dt);
    s.flaps = toward(s.flaps, c.flaps, RATE.flaps, dt);
    // ---- the gear: its doors open for the travel (the legs move between 0.2 and 0.8 of it: FlightGear's tables)
    const g = clamp(i.gear, 0, 1);
    const transit = g > 0.005 && g < 0.995;
    s.door = s.door.map((d) => toward(d, transit ? 1 : 0, RATE.door, dt));
    for (let k = 0; k < 3; k++) {
      P[`gear/gear[${k}]/position-norm`] = g;
      P[`gear/gear[${k}]/compression-norm`] = clamp(i.comp[k]! / 0.3048, 0, 1.2);
      // (the wheels: rolling on the ground, braked to a stop after lift-off)
      const w = i.onGround ? i.groundSpeed / WHEEL_R[k]! : 0;
      const sp = `gear/gear[${k}]/rollspeed-ms`;
      this.spins[sp] = ((this.spins[sp] ?? 0) + w * dt) % (2 * Math.PI);
    }
    P["systems/hydraulic/gear/door-left"] = s.door[1]!;
    P["systems/hydraulic/gear/door-right"] = s.door[2]!;
    P["systems/hydraulic/gear/door-nose"] = s.door[0]!;
    s.steer = toward(s.steer, i.onGround ? clamp(i.steer, -1, 1) : 0, RATE.steer, dt);
    P["sim/multiplay/generic/float[1]"] = -s.steer;
    // ---- the surfaces' properties (FlightGear's multiplayer aliases: A320-main.xml)
    P["sim/multiplay/generic/float[4]"] = s.elev;
    P["sim/multiplay/generic/float[5]"] = s.elev;
    P["sim/multiplay/generic/float[6]"] = s.ail[0]!;
    P["sim/multiplay/generic/float[7]"] = s.ail[1]!;
    P["sim/multiplay/generic/float[8]"] = s.rud;
    P["sim/multiplay/generic/float[9]"] = s.stab;
    P["sim/multiplay/generic/float[11]"] = s.slats / 27;
    P["sim/multiplay/generic/float[12]"] = s.flaps / 40;
    for (let k = 0; k < 5; k++) {
      P[`systems/fcs/spoiler-l${k + 1}/final-deg`] = s.spl[k]!;
      P[`systems/fcs/spoiler-r${k + 1}/final-deg`] = s.spl[5 + k]!;
    }
    // ---- the engines: the reversers' doors, the fans (5 000 rpm at 100 % N1 — their blur disc past 40 %)
    s.rev = s.rev.map((r, k) => toward(r, clamp(i.reverser[k]!, 0, 1), RATE.reverser, dt));
    for (let k = 0; k < 2; k++) {
      P[`engines/engine[${k}]/reverser-pos-norm`] = s.rev[k]!;
      const n1 = clamp(i.n1[k]!, 0, 110);
      P[`engines/engine[${k + 3}]/n1`] = n1;
      const sp = `engines/engine[${k + 3}]/n1`;
      // (FlightGear's two spins share the property: the slow blades' factor 50, the blur's 5 — one angle here,
      // the blades' — the blur turning a tenth as fast reads as its own)
      this.spins[sp] = ((this.spins[sp] ?? 0) + ((50 * n1) / 60) * 2 * Math.PI * dt) % (2 * Math.PI);
    }
    // ---- the rest: landing lights, wipers, AoA vanes, doors, RAT, APU, wingtips
    s.light = toward(s.light, i.landingLights ? 1 : 0, RATE.light, dt);
    P["controls/lighting/landing-light-pos-l"] = s.light;
    P["controls/lighting/landing-light-pos-r"] = s.light;
    if (i.wipers || s.wiper > 0) {
      s.wiper += s.wiperDir * RATE.wiper * dt;
      if (s.wiper >= 1) (s.wiper = 1), (s.wiperDir = -1);
      if (s.wiper <= 0) (s.wiper = 0), (s.wiperDir = i.wipers ? 1 : 0);
    }
    P["fdm/jsbsim/fcs/left-wiper-pos-norm"] = s.wiper;
    P["fdm/jsbsim/fcs/right-wiper-pos-norm"] = s.wiper;
    s.vane = toward(s.vane, i.groundSpeed < 30 && i.onGround ? 0 : clamp(i.alpha, -60, 60), RATE.vane, dt);
    P["fdm/jsbsim/aero/alpha-deg-fixed"] = s.vane;
    const names = ["doorl1", "doorl4", "doorr1", "doorr4", "cargofwd", "cargoaft", "cargobulk"];
    s.doors = s.doors.map((d, k) => toward(d, clamp(i.doors?.[k] ?? 0, 0, 1), RATE.cabinDoor, dt));
    names.forEach((n, k) => (P[`sim/model/door-positions/${n}/position-norm`] = s.doors[k]!));
    s.rat = toward(s.rat, i.rat ? 1 : 0, 0.5, dt);
    P["systems/hydraulic/sources/rat/door-position"] = clamp(s.rat * 3, 0, 1);
    P["systems/hydraulic/sources/rat/arm-position"] = clamp(s.rat * 1.5 - 0.5, 0, 1);
    P["controls/apu/inlet-flap/position-norm"] = i.apu ? 1 : 0;
    P["sim/multiplay/generic/int[12]"] = i.sharklets ? 1 : 0;
    return { props: P, spins: this.spins };
  }
}

/** The rig at rest on the ground: gear down, everything neutral (the others' A320s, a parked one). */
export function restA320(): { props: Props; spins: Props } {
  const p = new A320Poser();
  return p.step({
    dt: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    trim: 0,
    flapLever: 0,
    ias: 0,
    speedBrake: 0,
    groundSpoilers: 0,
    gear: 1,
    comp: [0, 0, 0],
    onGround: true,
    groundSpeed: 0,
    steer: 0,
    n1: [0, 0],
    reverser: [0, 0],
    alpha: 0,
  });
}
