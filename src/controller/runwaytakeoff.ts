// The CameraController — the F-35's automatic take-off from a runway (U on the ground, off a carrier's deck): the run
// at full power and afterburner, the runway's axis held by the nose wheel (the yaw), the rotation at 67 m/s (the
// stick back to ~12° of pitch), off the ground the gear up and the pitch flown to 8 m/s of climb, to 110 m/s and 100 m; then the jet's holds —
// the altitude 1 500 m over the field, the runway's heading, 210 m/s by the autothrottle, the afterburner off. (The
// holds handed over at the lift-off, at 74 m/s, pitched the jet to 55° and the Auto-GCAS took it back.) The stick, the throttle keys or U
// again take it back. (Before it, U on a runway started the orbital take-off, which refused: 0.6 g of thrust.)
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import { unitsOf } from "../ui/unitsys";
import type { PilotInput } from "../pilot";
import type { CameraController } from "../controls";

/** The run's figures (the course's lesson 3: rotation near 70 m/s, 10–12° of pitch) */
export const RWY_TAKEOFF = {
  /** the rotation's speed [m/s] */
  vRotate: 67,
  /** the pitch aimed at during the rotation [rad] */
  pitch: (12 * Math.PI) / 180,
  /** the first climb at that pitch, to that speed [m/s] and height over the field [m], or that long [s] */
  vHolds: 110,
  hHolds: 100,
  climbMaxS: 30,
  /** in the air, the climb rate aimed at [m/s] and the pitch it asks, its gain [rad per m/s] and range [rad] (12° just off
   *  the runway climbed at 2 m/s: the wing still slow) */
  vsAim: 8,
  vsGain: (1.5 * Math.PI) / 180,
  pitchMin: (8 * Math.PI) / 180,
  pitchMax: (20 * Math.PI) / 180,
  /** the stick's gain on the pitch's error [input a radian] */
  pitchGain: 3,
  /** the climb's height over the field [m], its airspeed [m/s] */
  climbM: 1500,
  climbSpeed: 210,
  /** the nose wheel's gain on the heading's error [yaw input a radian], its most */
  steer: 4,
  steerMax: 0.6,
  /** the run's longest before giving up [s] */
  maxRunS: 60,
};

export interface RwyRun {
  phase: "roll" | "rotate" | "climb";
  t: number;
  /** off the ground at [s of the run] */
  off?: number;
  /** the runway's heading [rad, clockwise from true north] and the field's height over the sea [m] */
  hdg: number;
  field: number;
}

declare module "../controls" {
  interface CameraController {
    rwyRun?: RwyRun | null;
    runwayTakeoff: typeof runwayTakeoff;
    rwyStep: typeof rwyStep;
  }
}

export function installRunwayTakeoff(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { runwayTakeoff, rwyStep });
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** U on the ground with the F-35 (not on a deck): its automatic take-off started — or, running, stopped. What to say;
 *  null: not the F-35, or not on the ground. */
function runwayTakeoff(this: CameraController): string | null {
  if (fleet.active !== "f35") return null;
  if (this.rwyRun) {
    this.rwyRun = null;
    return t("Automatic take-off off");
  }
  if (!(this.ourLanded || this.rolling) || this.onBelly) return null;
  const at = this.attitudeNow() as { heading?: number };
  const g = this.geoNow();
  if (at.heading === undefined || !g) return null;
  this.pilot.auto = "none";
  this.stovl.on = false;
  this.gearDown = true;
  this.rwyRun = { phase: "roll", t: 0, hdg: at.heading, field: g.alt };
  this.pilot.throttle = 1;
  if (!this.jetModes.ab) this.jetToggle("ab");
  return tf("Automatic take-off: full power, rotation at {0}", unitsOf(this.s.units).fSpd(RWY_TAKEOFF.vRotate));
}

/** A frame of the run: its throttle and its stick on `inp`; the stick, or the throttle pulled, takes it back. */
function rwyStep(this: CameraController, inp: PilotInput, dt: number) {
  const R = this.rwyRun;
  if (!R) return;
  const end = (why: string) => {
    this.rwyRun = null;
    this.onPilotMessage?.(why);
  };
  if (fleet.active !== "f35") return end(t("Automatic take-off off"));
  if (inp.pitch !== 0 || inp.roll !== 0 || inp.throttle < 0) return end(t("Automatic take-off off — the stick"));
  R.t += dt;
  const down = !!(this.ourLanded || this.rolling);
  const at = this.attitudeNow() as { heading?: number; pitch?: number };
  const V = this.airFlight.last?.speed ?? 0;
  if (this.airFlight.failure) return end(t("Automatic take-off off"));
  if (down) {
    if (R.t > RWY_TAKEOFF.maxRunS) {
      this.pilot.throttle = 0;
      return end(tf("Automatic take-off off: not airborne after {0} s", RWY_TAKEOFF.maxRunS));
    }
    this.pilot.throttle = 1;
    // (the axis: the nose wheel on the heading's error)
    const err = at.heading === undefined ? 0 : wrap(R.hdg - at.heading);
    inp.yaw = Math.max(-RWY_TAKEOFF.steerMax, Math.min(RWY_TAKEOFF.steerMax, RWY_TAKEOFF.steer * err));
    if (V > RWY_TAKEOFF.vRotate) R.phase = "rotate";
    if (R.phase === "rotate") inp.pitch = Math.max(0, Math.min(0.8, 0.8 * (1 + 4 * (RWY_TAKEOFF.pitch - (at.pitch ?? 0)))));
    return;
  }
  // (off the ground: the gear up once clear, the pitch held, the wings level, full power)
  if (R.phase !== "climb") {
    R.phase = "climb";
    R.off = R.t;
  }
  const g = this.geoNow();
  const hf = g ? g.alt - R.field : 0;
  const vs = g?.vs ?? 0;
  if (hf > 15 && vs > 2) this.gearDown = false;
  if (V < RWY_TAKEOFF.vHolds || hf < RWY_TAKEOFF.hHolds) {
    if (R.t - (R.off ?? R.t) < RWY_TAKEOFF.climbMaxS) {
      this.pilot.throttle = 1;
      const aim = Math.max(
        RWY_TAKEOFF.pitchMin,
        Math.min(RWY_TAKEOFF.pitchMax, RWY_TAKEOFF.pitch + RWY_TAKEOFF.vsGain * (RWY_TAKEOFF.vsAim - vs)),
      );
      inp.pitch = Math.max(-0.5, Math.min(0.8, RWY_TAKEOFF.pitchGain * (aim - (at.pitch ?? 0))));
      // (the runway's heading by a bank of 10° at most — the wings let go drifted 4° off it)
      const bank = (at as { bank?: number }).bank ?? 0;
      const err = at.heading === undefined ? 0 : wrap(R.hdg - at.heading);
      const want = Math.max(-0.17, Math.min(0.17, 2 * err));
      inp.roll = Math.max(-0.5, Math.min(0.5, 2 * (want - bank)));
      return;
    }
  }
  // (fast and high enough: the holds on — the climb, the runway's heading, the autothrottle, dry)
  this.gearDown = false;
  if (this.jetModes.ab) this.jetToggle("ab");
  const m = this.jetModes;
  m.alt = R.field + RWY_TAKEOFF.climbM;
  m.hdg = R.hdg;
  m.spd = RWY_TAKEOFF.climbSpeed;
  end(
    tf(
      "Airborne — gear up, climbing to {0} m on {1}°, {2} m/s",
      Math.round(m.alt),
      Math.round((((R.hdg * 180) / Math.PI) % 360) + 360) % 360,
      RWY_TAKEOFF.climbSpeed,
    ),
  );
}
