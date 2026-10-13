// The F-35's moving parts from the flight (docs/PLAN-F35.md, F2): the control surfaces as its flight control
// system moves them — the pitch on the stabilators, the roll on the flaperons and the stabilators together,
// the yaw on the rudders, the leading-edge flaps scheduled on the angle of attack, the flaperons down with the
// flaps, the rudders toed in as an air brake —, each at its actuator's rate; the gear on its clip, the oleos,
// the wheels rolling; the nozzle's petals opening with the afterburner; the canopy raised parked. Pure.

import { restPose, type F35Pose } from "./model";

type V3 = [number, number, number];

/** What the flight gives each frame. */
export interface JetInputs {
  /** seconds since the last frame (real time: the actuators move in it) */
  dt: number;
  /** the attitude commands as the flight computer gives them (pilot.ts: > 0 the nose up, the nose right, a
   *  roll to the right — about the ship's x, y, z), −1…1 */
  torque: V3;
  /** the throttle 0…1, the afterburner lit */
  throttle: number;
  afterburner: boolean;
  /** the angle of attack [rad], the flaps 0…1, the air brake 0…1 */
  alpha: number;
  flaps: number;
  brake: number;
  /** the gear out 0…1, each oleo compressed [m] (nose, left, right), on the ground and the speed along it [m/s] */
  gear: number;
  comp: V3;
  onGround: boolean;
  groundSpeed: number;
  /** the nose wheel's steering, −1…1 (> 0: to the right) */
  steer: number;
  /** parked: on the ground, stopped, the engine at idle — the canopy may open */
  parked: boolean;
}

const D = Math.PI / 180;
/** the surfaces' travel [rad] and their actuators' rates [rad/s] (the F-35's: stabilators ±20° at 60°/s…) */
const TRAVEL = { stab: 20 * D, flaperon: 25 * D, rudder: 25 * D, lef: 30 * D };
const RATE = { stab: 60 * D, flaperon: 80 * D, rudder: 60 * D, lef: 40 * D, canopy: 0.12, petals: 0.8, steer: 1.5 };
const WHEEL_R: V3 = [0.25, 0.37, 0.37];

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
/** x moved towards `to` by at most rate·dt */
const toward = (x: number, to: number, rate: number, dt: number) => x + clamp(to - x, -rate * dt, rate * dt);

export class JetPoser {
  pose: F35Pose = restPose();

  step(i: JetInputs): F35Pose {
    const p = this.pose;
    const dt = clamp(i.dt, 0, 0.25);
    const [pitch, yaw, roll] = [clamp(i.torque[0], -1, 1), clamp(i.torque[1], -1, 1), clamp(i.torque[2], -1, 1)];
    // (the stabilators: the nose up — their trailing edges up —, and a share of the roll differentially)
    const stab = -pitch * TRAVEL.stab * 0.8;
    const sRoll = roll * TRAVEL.stab * 0.35;
    p.stab = [toward(p.stab[0], stab + sRoll, RATE.stab, dt), toward(p.stab[1], stab - sRoll, RATE.stab, dt)];
    // (the flaperons: the roll, down together with the flaps — and drooped a little low and slow)
    const flap = i.flaps * 18 * D;
    const fRoll = roll * TRAVEL.flaperon * 0.8;
    p.flaperon = [
      toward(p.flaperon[0], clamp(flap + fRoll, -TRAVEL.flaperon, TRAVEL.flaperon), RATE.flaperon, dt),
      toward(p.flaperon[1], clamp(flap - fRoll, -TRAVEL.flaperon, TRAVEL.flaperon), RATE.flaperon, dt),
    ];
    // (the rudders: the nose right — their trailing edges right —; toed in as an air brake, each inwards)
    const toe = i.brake * 20 * D;
    const r = -yaw * TRAVEL.rudder;
    p.rudder = [
      toward(p.rudder[0], clamp(r - toe, -TRAVEL.rudder, TRAVEL.rudder), RATE.rudder, dt),
      toward(p.rudder[1], clamp(r + toe, -TRAVEL.rudder, TRAVEL.rudder), RATE.rudder, dt),
    ];
    // (the leading-edge flaps: down with the angle of attack, up to 30°; a little on the ground with the flaps)
    const lef = i.onGround ? i.flaps * 15 * D : clamp((i.alpha - 2 * D) * 0.8, 0, TRAVEL.lef);
    p.lef = [toward(p.lef[0], lef, RATE.lef, dt), toward(p.lef[1], lef, RATE.lef, dt)];
    // the gear, its oleos, its wheels rolling on the ground (and spun down in the air)
    p.gear = clamp(i.gear, 0, 1);
    p.comp = [...i.comp];
    for (let k = 0; k < 3; k++) {
      const w = i.onGround ? i.groundSpeed / WHEEL_R[k]! : 0;
      p.spin[k] = (p.spin[k]! + w * dt) % (2 * Math.PI);
    }
    p.steer = toward(p.steer, i.onGround ? -clamp(i.steer, -1, 1) * 20 * D : 0, RATE.steer, dt);
    // the nozzle: wide at idle, closed at full dry thrust, open again with the afterburner
    const want = i.afterburner ? 1 : 0.45 * (1 - clamp(i.throttle, 0, 1));
    p.petals = toward(p.petals, want, RATE.petals, dt);
    // the canopy: raised parked, lowered otherwise (some 8 s to travel)
    p.canopy = toward(p.canopy, i.parked ? 1 : 0, RATE.canopy, dt);
    return p;
  }
}
