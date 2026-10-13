// The CameraController — the jet's systems in the plane mode (game/jet.ts): the autopilot's altitude and
// heading holds flown through the plane law's held flight path and bank, the autothrottle on the throttle,
// the afterburner's thrust and propellant. The stick flies through the holds: moved, the pilot flies; let
// go, the altitude or heading then is the one held. Off when the craft no longer flies as a plane in the air
// (another mode, an autopilot of the computer's, on the ground — the afterburner kept for the take-off run).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { JET, jetCommands, noJetModes } from "../game/jet";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { altitudeOver, solidBody } from "../system/our-surface";
import { C_MPS, M_METRES } from "../units";
import { VESSELS } from "../vessels";
import { wetRatio } from "../f35/engine";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    jetToggle: typeof jetToggle;
    jetStep: typeof jetStep;
    jetFigures: typeof jetFigures;
    jetThrust: typeof jetThrust;
  }
}

const D = Math.PI / 180;

/** The figures the holds read: the altitude over the sea (our worlds; the height over the ground on
 *  Gargantua's), the nose's heading [rad], the speed through the air [m/s]. Null: not in the air. */
function jetFigures(this: CameraController): { h: number; hdg: number; V: number } | null {
  const L = this.airFlight.last;
  if (!this.airFlight.inAir || !L) return null;
  const cam = cameraFrame(this.s);
  const nav = this.local ? null : this.ourNav(cam);
  const h = nav && nav.ref !== "sun" && solidBody(nav.ref) ? altitudeOver(nav.ref, nav.X, nav.t) : L.h;
  const att = this.attitudeNow() as { heading?: number };
  return { h, hdg: att.heading ?? Number.NaN, V: L.speed };
}

/** The afterburner's thrust factor now (1: dry). */
function jetThrust(this: CameraController): number {
  // (an aircraft's own turbofan — the F-35's —: its afterburner's factor where it flies, lit by degrees)
  const T = VESSELS[fleet.active].turbofan;
  if (T) {
    const e = this.jetAir();
    return 1 + (wetRatio(T, e.mach, e.sigma) - 1) * this.abLevel;
  }
  return this.jetModes.ab ? JET.abThrust : 1;
}

/** Whether the jet's systems can be flown: a craft built for the air, flown as a plane. */
function jetReady(c: CameraController) {
  return VESSELS[fleet.active].flies && c.flightModeNow() === "plane";
}

/**
 * A system engaged or let go (the keys): "ap" the altitude and heading holds (the altitude and heading now),
 * "athr" the autothrottle (the speed now), "ab" the afterburner (the throttle full). Returns what to say.
 */
function jetToggle(this: CameraController, what: "ap" | "athr" | "ab"): string {
  if (!jetReady(this)) return t("The jet's systems: in plane mode (F)");
  const m = this.jetModes;
  if (what === "ab") {
    m.ab = !m.ab;
    if (m.ab) {
      // (the afterburner and the autothrottle: one or the other — the throttle lever's in the detent)
      m.spd = null;
      this.pilot.throttle = 1;
    }
    this.jetCws.thr = this.pilot.throttle;
    return m.ab ? t("Afterburner on — the thrust ×1.5, the propellant ×3") : t("Afterburner off");
  }
  const f = this.jetFigures();
  if (!f || this.rolling) return t("The autopilot's holds: in the air");
  if (this.pilot.auto !== "none") this.pilot.setAuto(this.pilot.auto);
  if (what === "ap") {
    if (m.alt !== null || m.hdg !== null) {
      m.alt = m.hdg = null;
      return t("Autopilot off");
    }
    m.alt = Math.round(f.h / 10) * 10;
    m.hdg = Number.isFinite(f.hdg) ? Math.round(f.hdg / D) * D : null;
    this.jetCws.pitch = this.jetCws.roll = false;
    return tf("Autopilot: altitude {0} m, heading {1}°", Math.round(m.alt), Math.round((((m.hdg ?? 0) / D) % 360) + 360) % 360);
  }
  if (m.spd !== null) {
    m.spd = null;
    return t("Autothrottle off");
  }
  m.spd = Math.round(f.V);
  m.ab = false;
  this.jetAthr.reset();
  this.jetCws.thr = this.pilot.throttle;
  return tf("Autothrottle: {0} m/s — the throttle keys set the speed", m.spd);
}

/**
 * A frame of the systems, before the pilot's step: the holds' flight path and bank for the plane law (null:
 * its own), the autothrottle's throttle set and the throttle keys taken as its speed's. The stick's input
 * flies through the holds, its release the new altitude or heading.
 */
function jetStep(this: CameraController, inp: PilotInput, dt: number): { gamma: number | null; bank: number | null } {
  const m = this.jetModes;
  const none = { gamma: null, bank: null };
  // (a turbofan's afterburner lights up and goes out over its own time)
  const T = VESSELS[fleet.active].turbofan;
  const abOn = m.ab && jetReady(this);
  this.abLevel = T ? Math.min(Math.max(this.abLevel + (abOn ? 1 : -1) * (dt / T.light), 0), 1) : abOn ? 1 : 0;
  if (!jetReady(this)) {
    if (m.alt !== null || m.hdg !== null || m.spd !== null || m.ab) this.jetModes = noJetModes();
    return none;
  }
  // (the throttle moved by another hand — full, cut, the lever, a hold of the computer's —: the autothrottle off)
  if (m.spd !== null && Number.isFinite(this.jetCws.thr) && Math.abs(this.pilot.throttle - this.jetCws.thr) > 1e-6) m.spd = null;
  // (the afterburner out of its detent: off)
  if (m.ab && this.pilot.throttle < 0.95) m.ab = false;
  const f = this.jetFigures();
  if (!f || this.rolling || this.pilot.auto !== "none") {
    m.alt = m.hdg = m.spd = null;
    this.jetCws.thr = Number.NaN;
    return none;
  }
  const cws = this.jetCws;
  if (m.alt !== null) {
    if (inp.pitch !== 0) cws.pitch = true;
    else if (cws.pitch) {
      cws.pitch = false;
      m.alt = Math.round(f.h / 10) * 10;
    }
  }
  if (m.hdg !== null) {
    if (inp.roll !== 0) cws.roll = true;
    else if (cws.roll) {
      cws.roll = false;
      if (Number.isFinite(f.hdg)) m.hdg = f.hdg;
    }
  }
  if (m.spd !== null) {
    // (the throttle keys: the speed selected)
    m.spd = Math.max(30, m.spd + inp.throttle * JET.spdRate * dt);
    inp.throttle = 0;
    const aFull = ((this.thrustMax() * C_MPS ** 2) / M_METRES) * this.jetThrust();
    this.pilot.throttle = this.jetAthr.step(this.pilot.throttle, f.V, m.spd, aFull, dt);
  }
  cws.thr = this.pilot.throttle;
  const c = jetCommands(m, f);
  return { gamma: cws.pitch ? null : c.gamma, bank: cws.roll ? null : c.bank };
}

export function installJet(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { jetToggle, jetStep, jetFigures, jetThrust });
}
