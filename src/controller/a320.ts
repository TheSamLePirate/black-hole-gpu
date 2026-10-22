// The A320 flown (docs/PLAN-A320.md, A3): its systems each frame (src/a320/fcs.ts — made with its first frame, its
// tanks the fleet's fuel), their configuration given to its aerodynamics; the pilot's own A320 controls — the thrust
// reversers (⇧Z: the afterburner's key on the F-35), the autobrake (⇧B: the STOVL's), the brakes it applies.

import { detentOf } from "../a320/fadec";
import { A320Fcs } from "../a320/fcs";
import { A320Systems, type StartState, type SysFrame } from "../a320/systems";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    a320Step(dt: number, onWheels: boolean): A320Fcs;
    a320ReverseToggle(): string;
    a320AutobrakeCycle(): string;
  }
}

const AB_NAMES = ["OFF", "LO", "MED", "MAX"];

/** The systems over a frame of flight time dt [s]: the effort the computer asked last frame, the levers, the flaps,
 *  the speed brakes, the gear; their configuration given to the aerodynamics. */
function a320Step(this: CameraController, dt: number, onWheels: boolean): A320Fcs {
  let fresh = false;
  if (!this.a320) {
    this.a320 = new A320Fcs();
    this.a320.setFuel(fleet.fuel.a320 ?? VESSELS.a320.fuelKg ?? 8000);
    fresh = true;
  }
  const A = this.a320;
  // (its systems — src/a320/systems —, made with it: on the ground as the settings start it — cold and dark, the
  // APU's, ready —, in flight running; the engines the FADEC's as they are)
  if (!this.a320Sys || fresh) {
    const state: StartState = onWheels ? (this.s.a320Start ?? "ready") : "air";
    A.setEngines(state === "ready" || state === "air");
    this.a320Sys = new A320Systems(this.a320Props);
    this.a320Sys.reset(state, sysFrame(this, A, onWheels));
  }
  this.a320Sys.step(dt, sysFrame(this, A, onWheels));
  // (the FLEX temperature: the MCDU's PERF TAKE OFF — fmgc/fms.ts)
  A.flexTemp = this.a320Fmgc?.fms.flex ?? null;
  // (the fuel changed by another — a refuelling, a flight prepared —: the tanks filled again)
  if (Math.abs((fleet.fuel.a320 ?? A.fuel) - A.fuel) > 1) A.setFuel(fleet.fuel.a320!);
  const L = this.airFlight.last;
  const air = L?.air;
  const V = L?.speed ?? 0;
  const T = air?.T ?? 288.15;
  const rho = air?.rho ?? 1.225;
  // (the reversers: on the ground, the levers at idle; stowed off the ground)
  if (!onWheels) this.a320Reverse = 0;
  const reverse = onWheels && this.pilot.throttle <= 0.01 ? this.a320Reverse : 0;
  A.step({
    dt,
    torque: [...this.pilot.fired.torque] as [number, number, number],
    airborne: !onWheels && this.airFlight.inAir,
    trimFreeze: !!this.pilot.airbusOut && (this.pilot.airbusOut.alphaProt || this.pilot.airbusOut.highSpeed || this.pilot.airbusOut.flare),
    alphaFloor: !!this.pilot.airbusOut?.alphaFloor,
    onGround: onWheels,
    lever: this.pilot.throttle,
    // (the autothrust's N1 — the FMGC's last frame's: controller/a320ap.ts)
    n1Cmd: this.a320FmgcOut?.n1Cmd ?? null,
    // (the engines' starters and fuel: the ignition's — its ENG MASTERs, ENG MODE)
    engineCtl: this.a320Sys.engineCtl(),
    reverse,
    flapLever: Math.round((this.airFlight.cfg.flaps ?? 0) * 4),
    speedBrake: this.airBrake,
    groundSpoilers: this.groundSpoilers,
    gear: this.gearExt,
    lights: this.s.landingLights,
    ias: Math.sqrt((2 * (L?.out.q ?? 0)) / 1.225) * 1.9438,
    groundSpeed: V,
    air: {
      altFt: (L?.h ?? 0) / 0.3048,
      // (the density altitude: ISA's troposphere inverted)
      densFt: (1 - (rho / 1.225) ** 0.235) * 145442,
      tatC: T + (V * V) / 2009 - 273.15,
      mach: L?.out.mach ?? 0,
      onGround: onWheels,
      flapLever: this.airFlight.cfg.flaps ?? 0,
    },
    // (the angle of attack's rate: the pitch's less the flight path's)
    alphaDot: this.pilot.omega[0] + this.airFlight.pathRate[0],
  });
  this.airFlight.cfg.a320 = A.surfaces;
  return A;
}

const DETENT = ["IDLE", "MAN", "CL", "MAN", "MCT", "MAN", "TOGA"];

/** The flight's figures for the systems (src/a320/systems/sysinputs.ts). */
function sysFrame(c: CameraController, A: A320Fcs, onWheels: boolean): SysFrame {
  const L = c.airFlight.last;
  const g = c.geoNow();
  const air = L?.air;
  const T = air?.T ?? 288.15;
  const V = L?.speed ?? 0;
  const agl = c.airFlight.cfg.agl !== undefined ? (c.airFlight.cfg.agl - 1.59) / 0.3048 : 10000;
  return {
    elapsed: 0,
    lat: g?.lat ?? 0,
    lon: g?.lon ?? 0,
    altFt: (g?.alt ?? 0) / 0.3048,
    aglFt: onWheels ? 0 : agl,
    vsFpm: ((g?.vs ?? 0) / 0.3048) * 60,
    onGround: onWheels,
    gear: c.gearExt,
    ias: Math.sqrt((2 * (L?.out.q ?? 0)) / 1.225) * 1.9438,
    gs: (g?.gs ?? 0) * 1.9438,
    mach: L?.out.mach ?? 0,
    tatC: T + (V * V) / 2009 - 273.15,
    oatC: T - 273.15,
    staticInHg: ((air?.rho ?? 1.225) * 287.05 * T) / 3386.39,
    alphaDeg: ((L?.out.alpha ?? 0) * 180) / Math.PI,
    flapDeg: A.surfaces.flap,
    slatDeg: A.surfaces.slat,
    engines: A.engines,
    tanks: A.tanks,
    detent: DETENT[detentOf(c.pilot.throttle)]!,
  };
}

/** ⇧Z: the reversers deployed (on the ground, the levers at idle: full reverse) or stowed. */
function a320ReverseToggle(this: CameraController): string {
  const onWheels = !!this.rolling || !!this.ourLanded;
  if (!onWheels) return t("Reversers: on the ground only");
  if (this.a320Reverse > 0) {
    this.a320Reverse = 0;
    return t("Reversers stowed");
  }
  this.pilot.throttle = 0;
  this.a320Reverse = 1;
  return t("Reverse thrust: full");
}

/** ⇧B: the autobrake's setting, OFF → LO → MED → MAX (MAX, the rejected take-off's: armed on the ground). */
function a320AutobrakeCycle(this: CameraController): string {
  const A = this.a320;
  if (!A) return t("Autobrake: the A320's");
  const onWheels = !!this.rolling || !!this.ourLanded;
  let k = (A.autobrake + 1) % 4;
  if (k === 3 && !onWheels) k = 0;
  A.autobrake = k;
  return k ? tf("Autobrake {0}", AB_NAMES[k]!) : t("Autobrake off");
}

export function installA320(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { a320Step, a320ReverseToggle, a320AutobrakeCycle });
}
