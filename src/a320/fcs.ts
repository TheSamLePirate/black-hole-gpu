// The A320 flown (docs/PLAN-A320.md, A3): its state each frame — the surfaces as the flight control computers move
// them (the elevators, the ailerons with the roll spoilers, the rudder within its travel limiter, the stabiliser
// trimmed by itself), the slats and the flaps by configuration (FlightGear's SFCC: CONF 1, 1+F, 2, 3, FULL, the
// 1+F's retraction at 210 kt), the speed brakes and the ground spoilers, the gear, the two CFM56s and their FADEC
// (src/a320/fadec.ts), the five tanks and their feed. What the aerodynamics (src/a320/aero.ts), the thrust, the fuel
// and the moving parts (src/a320/pose.ts) read. Pure.

import { type A320Surfaces, restSurfaces, rudderTravel } from "./aero";
import {
  detentOf,
  type Engine,
  type EngineAir,
  type EngineCtl,
  leverN1,
  type Limits,
  limits,
  newEngine,
  stepEngine,
  thrustAt,
  n2Of,
} from "./fadec";
import type { Powered } from "./failures";
import { CONF, confOf } from "./pose";

/** The tanks (FDE/A320-200-CFM.xml): the left outer and inner, the centre, the right inner and outer [kg]. */
export const TANKS_KG = [690.8, 5711.6, 6632.9, 5711.6, 690.8] as const;
export const FUEL_MAX = TANKS_KG.reduce((a, b) => a + b, 0);

/** The tanks filled as a refuelling does: the wings' (outer, then inner) first, the centre's last. */
export function fillTanks(kg: number): number[] {
  const t = [0, 0, 0, 0, 0];
  let left = Math.min(Math.max(kg, 0), FUEL_MAX);
  const put = (i: number, j: number) => {
    const each = Math.min(left / 2, TANKS_KG[i]!);
    t[i] = t[j] = each;
    left -= 2 * each;
  };
  put(0, 4);
  put(1, 3);
  t[2] = Math.min(left, TANKS_KG[2]);
  return t;
}

/** What the flight gives the systems each frame. */
export interface FcsInputs {
  dt: number;
  /** the flight control computer's effort asked (pilot.ts fired.torque: pitch up, yaw right, roll LEFT — each −1…1) */
  torque: [number, number, number];
  /** in normal flight (the auto-trim's: not on the ground, not in direct law); the trim frozen (the protections, the
   *  flare); α floor asked by the law */
  airborne: boolean;
  trimFreeze?: boolean;
  alphaFloor?: boolean;
  onGround: boolean;
  /** the thrust levers 0…1 (both), the reverse lever 0…1, the flap lever 0–4, the speed brake lever 0…1, the ground
   *  spoilers deployed, the gear's extension 0…1, the landing lights */
  lever: number;
  reverse: number;
  flapLever: number;
  speedBrake: number;
  groundSpoilers: boolean;
  gear: number;
  lights: boolean;
  /** the equivalent airspeed [kt], the speed along the ground [m/s], the air (the engines'), the angle of attack's
   *  rate [rad/s] */
  ias: number;
  groundSpeed: number;
  air: EngineAir;
  alphaDot: number;
  /** the autothrust's N1 [%] (the FMGC's — its orders under the levers' limit): the levers' own when null */
  n1Cmd?: number | null;
  /** each engine's starter and fuel cutoff (the systems' ignition — systems/index.ts); none: running as they are */
  engineCtl?: [EngineCtl, EngineCtl] | null;
  /** what the hydraulics and the computers still move (failures.ts surfacesPowered); none: everything */
  powered?: Powered | null;
  /** the fuel leaking from the left and right wings [kg/s] (failures.ts fuelLeak) */
  fuelLeak?: [number, number] | null;
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const toward = (x: number, to: number, rate: number, dt: number) => x + clamp(to - x, -rate * dt, rate * dt);

export class A320Fcs {
  surfaces: A320Surfaces = restSurfaces();
  /** each spoiler panel L1…L5, R1…R5 [deg] */
  spoilers = new Array(10).fill(0) as number[];
  /** the configuration now (CONF's index: 0, 1, 1+F, 2, 3, FULL) */
  conf = 0;
  /** the flight control law (src/a320/fbw.ts): normal, alternate (computers or hydraulics lost), direct */
  law: "normal" | "alternate" | "direct" = "normal";
  /** α floor's TOGA latched (the autothrust's TOGA LK — the levers' own once the incidence is back) */
  alphaFloor = false;
  engines: [Engine, Engine] = [newEngine(), newEngine()];
  limits: Limits | null = null;
  /** the FLEX temperature set for the take-off [°C] (none: TOGA), the FLEX thrust flown (the levers in FLX/MCT) */
  flexTemp: number | null = null;
  flexOn = false;
  tanks = fillTanks(8000);
  /** the thrust both give [N] (reversed < 0), the most they could give now — TOGA's [N] */
  thrust = 0;
  thrustMax = 1;
  /** the fuel burnt this frame [kg] */
  burnt = 0;
  /** the autobrake: 0 off, 1 LO, 2 MED, 3 MAX; braking now (the ground spoilers out on the ground); its pressure 0…1
   *  and its integral; the deceleration measured [m/s²] */
  autobrake = 0;
  abActive = false;
  brake = 0;
  private abI = 0;
  decel = 0;
  private lastSpeed = Number.NaN;

  /** the fuel aboard [kg] */
  get fuel() {
    return this.tanks.reduce((a, b) => a + b, 0);
  }
  setFuel(kg: number) {
    this.tanks = fillTanks(kg);
  }
  /** the engines running or stopped (a start state: cold and dark, the APU's — systems/index.ts) */
  setEngines(running: boolean) {
    this.engines = [newEngine(running), newEngine(running)];
  }

  step(i: FcsInputs) {
    const dt = clamp(i.dt, 0, 0.25);
    const s = this.surfaces;
    // ---- the autobrake (FlightGear's brakesystem.nas): LO 1.7 m/s², MED 3, MAX the most the brakes give — braking once
    // on the ground with the ground spoilers out above 40 kt, the levers at idle; a PI on the deceleration measured
    if (Number.isFinite(this.lastSpeed) && dt > 0)
      this.decel += ((this.lastSpeed - i.groundSpeed) / dt - this.decel) * Math.min(dt / 0.3, 1);
    this.lastSpeed = i.groundSpeed;
    if (this.autobrake && i.onGround && i.groundSpoilers && i.lever <= 0.01 && i.groundSpeed > 20.6) this.abActive = true;
    const H = i.powered ?? null;
    // (the autobrake works on the normal brakes only — the green's)
    if (!i.onGround || i.lever > 0.05 || this.autobrake === 0 || (H && !H.brakes.normal)) this.abActive = false;
    if (this.abActive) {
      const target = [0, 1.7, 3, 12][this.autobrake]!;
      const e = target - this.decel;
      this.abI = clamp(this.abI + 0.25 * e * dt, 0, 1);
      this.brake = clamp(0.45 * (e / 3) + this.abI + (this.autobrake === 3 ? 1 : 0), 0, 1);
      if (i.groundSpeed < 1) this.brake = Math.max(this.brake, 0.3);
    } else {
      this.abI = 0;
      this.brake = 0;
    }
    // ---- the surfaces (JSBSim's signs: the trailing edges down > 0 — the elevator's nose down —, the rudder's nose right)
    const pitch = clamp(i.torque[0], -1, 1);
    const yaw = clamp(i.torque[1], -1, 1);
    const roll = clamp(-i.torque[2], -1, 1);
    // (the hydraulics lost — failures.ts —: an elevator alone moving the pair at half the rate, none holding where it is;
    // an aileron without its two actuators floating back to neutral; the rudder held)
    const elev = H ? (H.elevator[0] ? 0.5 : 0) + (H.elevator[1] ? 0.5 : 0) : 1;
    if (elev > 0) s.elevator = toward(s.elevator, pitch > 0 ? -30 * pitch : -15 * pitch, 45 * elev, dt);
    // (the ailerons drooped 5° with the flaps out — FlightGear's: they help the flaps' lift)
    const droop = s.flap > 1 ? 5 : 0;
    s.aileronL = toward(s.aileronL, H && !H.aileron[0] ? 0 : clamp(25 * roll + droop, -25, 25), H && !H.aileron[0] ? 5 : 82, dt);
    s.aileronR = toward(s.aileronR, H && !H.aileron[1] ? 0 : clamp(-25 * roll + droop, -25, 25), H && !H.aileron[1] ? 5 : 82, dt);
    const rt = rudderTravel(i.ias);
    if (!H || H.rudder) s.rudder = toward(s.rudder, clamp(yaw * rt, -rt, rt), 80, dt);
    // (the stabiliser trims by itself in flight: the elevator's steady deflection taken over, 0.3°/s at most — +4° nose
    // down … −13.5° nose up; on the ground left where it is)
    if (i.airborne && !i.trimFreeze && this.law !== "direct" && (!H || H.ths))
      s.stab = clamp(s.stab + clamp(0.08 * s.elevator, -0.3, 0.3) * dt, -13.5, 4);
    // ---- the spoilers: the ground spoilers all out to 50°; the speed brakes 2–4 (40°, 25° above 300 kt is not an
    // A320's: its lever's travel); the roll spoilers 2–5 on the wing going down, up to 35°
    const gs = i.groundSpoilers && i.onGround ? 50 : 0;
    const sb = clamp(i.speedBrake, 0, 1) * 40;
    for (let side = 0; side < 2; side++) {
      const down = side === 0 ? Math.max(-roll, 0) : Math.max(roll, 0);
      for (let k = 0; k < 5; k++) {
        const want = Math.max(gs, clamp((k >= 1 && k <= 3 ? sb : 0) + (k >= 1 ? down * 35 : 0), 0, 50));
        // (a panel without its hydraulics or its SEC: blown back down)
        const live = !H || H.spoilers[side * 5 + k];
        this.spoilers[side * 5 + k] = toward(this.spoilers[side * 5 + k]!, live ? want : 0, live ? 60 : 10, dt);
      }
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const L = this.spoilers.slice(0, 5);
    const R = this.spoilers.slice(5);
    s.spoilerSym = Math.min(mean(L), mean(R));
    s.spoilerL = mean(L) - s.spoilerSym;
    s.spoilerR = mean(R) - s.spoilerSym;
    // ---- the slats and flaps (1.17°/s, 1°/s: FULL from clean in some 30 s)
    this.conf = confOf(i.flapLever, i.ias, i.onGround);
    // (1+F's flaps retract by themselves at 210 kt: CONF 1)
    if (this.conf === 2 && i.ias > 210) this.conf = 1;
    const c = CONF[this.conf]!;
    // (one of their two systems lost: half the rate; both: stuck)
    s.slat = toward(s.slat, c.slats, 1.0 * (H ? H.slatRate : 1), dt);
    s.flap = toward(s.flap, c.flaps, 1.17 * (H ? H.flapRate : 1), dt);
    s.gear = clamp(i.gear, 0, 1);
    s.lights = [i.lights ? 1 : 0, i.lights ? 1 : 0];
    s.alphaDot = i.alphaDot;
    // ---- the engines: the FADEC's limits, the N1 the levers ask (FLX/MCT with a FLEX temperature on the ground: FLEX)
    // (FLEX: set on the ground with a FLEX temperature and the levers in FLX/MCT, kept after the lift-off until they move)
    const inFlx = detentOf(i.lever) === 4;
    if (this.flexTemp !== null && i.onGround && inFlx) this.flexOn = true;
    if (!inFlx || this.flexTemp === null) this.flexOn = false;
    const flex = this.flexOn;
    const L1 = (this.limits = limits(i.air, flex || i.onGround ? this.flexTemp : null));
    const rev = clamp(i.reverse, 0, 1);
    // (α floor: TOGA whatever the levers, until the incidence is back below it and the levers moved)
    if (i.alphaFloor && !i.onGround) this.alphaFloor = true;
    if (this.alphaFloor && (i.onGround || (!i.alphaFloor && i.lever > 0.9))) this.alphaFloor = false;
    const lever = this.alphaFloor ? 1 : i.lever;
    const auto = i.n1Cmd !== null && i.n1Cmd !== undefined && !this.alphaFloor;
    const want =
      rev > 0
        ? { n1: L1.idle + rev * (L1.mrev - L1.idle), reverse: rev }
        : { n1: auto ? Math.min(i.n1Cmd!, Math.max(leverN1(lever, L1, flex), i.n1Cmd!)) : leverN1(lever, L1, flex), reverse: 0 };
    // (a reverser without its hydraulics — 1 the green's, 2 the yellow's —: stowed, that engine at reverse idle)
    this.engines = this.engines.map((e, k) =>
      stepEngine(e, H && !H.reversers[k] && want.reverse > 0 ? { n1: L1.idle, reverse: 0 } : want, i.air, dt, i.engineCtl?.[k]),
    ) as [Engine, Engine];
    this.thrust = this.engines.reduce((a, e) => a + e.thrust, 0);
    this.thrustMax = Math.max(2 * thrustAt(n2Of(L1.toga), i.air), 1);
    // ---- the fuel: each engine fed from its side (the centre's first, the inner's after; the outer's flowing into the
    // inner once below 750 kg)
    this.burnt = 0;
    const T = this.tanks;
    this.engines.forEach((e, k) => {
      let need = e.ff * dt;
      this.burnt += need;
      const inner = k === 0 ? 1 : 3;
      const outer = k === 0 ? 0 : 4;
      const take = (j: number) => {
        const x = Math.min(need, T[j]!);
        T[j]! -= x;
        need -= x;
      };
      take(2);
      take(inner);
      take(outer);
      // (a leak: that wing's tanks, the outer's first)
      const leak = (i.fuelLeak?.[k] ?? 0) * dt;
      if (leak > 0) {
        const lo = Math.min(leak, T[outer]!);
        T[outer]! -= lo;
        T[inner]! = Math.max(T[inner]! - (leak - lo), 0);
      }
      if (T[inner]! < 750 && T[outer]! > 0) {
        const x = Math.min(T[outer]!, 3 * dt);
        T[outer]! -= x;
        T[inner]! += x;
      }
      // (dry: the engine flames out)
      if (need > 1e-9) {
        e.running = false;
        e.flamedOut = true;
      }
    });
  }
}
