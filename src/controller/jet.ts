// The CameraController — the jet's systems in the plane mode (game/jet.ts): the autopilot's altitude and
// heading holds flown through the plane law's held flight path and bank, the autothrottle on the throttle,
// the afterburner's thrust and propellant. The stick flies through the holds: moved, the pilot flies; let
// go, the altitude or heading then is the one held. Off when the craft no longer flies as a plane in the air
// (another mode, an autopilot of the computer's, on the ground — the afterburner kept for the take-off run).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { JET, jetCommands, noJetModes } from "../game/jet";
import { formGrace } from "./formation";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { altitudeOver, solidBody } from "../system/our-surface";
import { C_MPS, M_METRES } from "../units";
import { VESSELS } from "../vessels";
import { wetRatio } from "../f35/engine";
import { STOVL } from "../f35/stovl";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    jetToggle: typeof jetToggle;
    apSet: typeof apSet;
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
    // (the F-35B's lift fan engaged: its shaft's power a thrust of its own — 184 kN of the 120 dry)
    if (this.stovl.clutch > 0) return 1 + (STOVL.boost - 1) * this.stovl.clutch;
    return 1 + (wetRatio(T, e.mach, e.sigma) - 1) * this.abLevel;
  }
  return this.jetModes.ab ? JET.abThrust : 1;
}

/** Whether the jet's systems can be flown: a craft built for the air, flown as a plane. */
function jetReady(c: CameraController) {
  return VESSELS[fleet.active].flies && c.flightModeNow() === "plane";
}

/**
 * The autopilot's selectors set as on an MCP (the crew's orders — docs/PLAN-CREW-ACTIONS.md A3): the altitude [m],
 * the heading [rad], the speed [m/s], the holds (ap) and the autothrottle (athr) engaged or let go — a target given
 * engages its system. A selected altitude or speed takes VNAV off (it would move them back), a selected heading
 * LNAV, as the stick does. Never the throttle, never the afterburner. What was done.
 */
function apSet(this: CameraController, want: { alt?: number; hdg?: number; spd?: number; ap?: boolean; athr?: boolean }): string {
  if (!jetReady(this)) return t("The jet's systems: in plane mode (F)");
  const m = this.jetModes;
  const N = this.nav;
  const said: string[] = [];
  const apOn = () => m.alt !== null || m.hdg !== null;
  if (want.ap === false && apOn()) said.push(this.jetToggle("ap"));
  if (want.athr === false && m.spd !== null) said.push(this.jetToggle("athr"));
  if ((want.ap || want.alt !== undefined || want.hdg !== undefined) && !apOn()) said.push(this.jetToggle("ap"));
  if ((want.athr || want.spd !== undefined) && m.spd === null) said.push(this.jetToggle("athr"));
  if (want.alt !== undefined && apOn()) {
    m.alt = Math.round(Math.max(0, Math.min(20_000, want.alt)) / 10) * 10;
    if (N.on.v) N.on.v = false;
    said.push(tf("Altitude {0} m selected", m.alt));
  }
  if (want.hdg !== undefined && apOn()) {
    m.hdg = ((want.hdg % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 0;
    if (N.on.l) N.on.l = false;
    said.push(tf("Heading {0}° selected", String(Math.round(m.hdg / D) % 360).padStart(3, "0")));
  }
  if (want.spd !== undefined && m.spd !== null) {
    m.spd = Math.round(Math.max(30, Math.min(700, want.spd)));
    if (N.on.v) N.on.v = false;
    said.push(tf("Speed {0} m/s selected", m.spd));
  }
  return said.join(" — ") || t("The autopilot as it was");
}

/**
 * A system engaged or let go (the keys): "ap" the altitude and heading holds (the altitude and heading now),
 * "athr" the autothrottle (the speed now), "ab" the afterburner (the throttle full). Returns what to say.
 */
function jetToggle(this: CameraController, what: "ap" | "athr" | "ab"): string {
  if (!jetReady(this)) return t("The jet's systems: in plane mode (F)");
  const m = this.jetModes;
  // (the holds or the autothrottle taken while in formation: the formation let go, them on as they are)
  if (this.form && what !== "ab") {
    this.formOff();
    return t("Formation off — altitude, heading and speed held");
  }
  if (this.icpt && what !== "ab") {
    this.icptOff();
    return t("Intercept off — altitude, heading and speed held");
  }
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
    // (a break's, a hold's flying let go with the holds)
    this.brk = this.holdPat = null;
    m.bankMax = m.order = undefined;
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
  if (this.stovl.on) m.ab = false;
  const abOn = m.ab && jetReady(this);
  this.abLevel = T ? Math.min(Math.max(this.abLevel + (abOn ? 1 : -1) * (dt / T.light), 0), 1) : abOn ? 1 : 0;
  if (!jetReady(this)) {
    if (this.form && !formGrace(this.form)) this.formOff(t("Formation off — not flown as a plane"));
    if (this.icpt) this.icptOff(t("Intercept off — not flown as a plane"));
    // (the refuelling kept: a moment out of the plane's law — a placing, the flight mode switched — and it takes up
    // again where it was, its rendezvous too; the ground or another autopilot let it go below)
    if (!this.form && (m.alt !== null || m.hdg !== null || m.spd !== null || m.ab)) this.jetModes = noJetModes();
    return none;
  }
  // (the throttle moved by another hand — full, cut, the lever, a hold of the computer's —: the autothrottle off)
  if (m.spd !== null && Number.isFinite(this.jetCws.thr) && Math.abs(this.pilot.throttle - this.jetCws.thr) > 1e-6) m.spd = null;
  // (the afterburner out of its detent: off)
  if (m.ab && this.pilot.throttle < 0.95) m.ab = false;
  const f = this.jetFigures();
  if (!f || this.rolling || this.pilot.auto !== "none") {
    if (this.form && (this.pilot.auto !== "none" || !formGrace(this.form)))
      this.formOff(this.pilot.auto !== "none" ? t("Formation off — the autopilot") : t("Formation off — on the ground"));
    if (this.icpt) this.icptOff(this.pilot.auto !== "none" ? t("Intercept off — the autopilot") : t("Intercept off — on the ground"));
    // (the refuelling let go by another autopilot or a real roll on the ground — not by a frame without the plane's
    // figures, as just after a placing: taken up again)
    if (this.aar && this.pilot.auto !== "none") this.aarOff(t("Refuelling off — the autopilot"));
    else if (this.aar && this.rolling && f) this.aarOff(t("Refuelling off — on the ground"));
    m.alt = m.hdg = m.spd = null;
    this.jetCws.thr = Number.NaN;
    return none;
  }
  const cws = this.jetCws;
  // (a deck's recovery flown: its holds set — controller/deckland.ts)
  this.deckJet(inp);
  // (a formation flown: its bank, its flight path, its speed — the holds' own laws left aside)
  // (the levels of assistance — controller/assistlevel.ts —: back to stable flight, the beginner's ring; the assisted
  // level's auto-throttle)
  this.assistThrottle(f);
  const fm: { gamma: number; bank: number; spd: number; acc: number; thr?: number } | null =
    this.gcasJet(inp) ??
    this.assistJet(inp, f, dt, "recover") ??
    // (a demonstration's guns: TARS's aim — controller/course.ts)
    this.courseJet(f) ??
    // (the air refuelling — controller/aar.ts —: the probe flown into the basket; its rendezvous the intercept's)
    this.aarJet(inp, f, dt) ??
    this.icptStep(inp, f) ??
    this.trapJet(inp) ??
    this.ilsJet(inp) ??
    this.formStep(inp, f, dt) ??
    this.orbitJet(f) ??
    this.assistJet(inp, f, dt, "aim");
  if (fm) {
    cws.pitch = cws.roll = false;
    // (the afterburner when the dry engine at full cannot keep up — he speeds up, we are behind —, out once eased)
    // (a throttle set by the mode itself — the refuelling's last metres, flown on the speed over the ground: the
    // autothrottle's on the air's would chase every gust)
    if (fm.thr !== undefined) {
      m.ab = false;
      this.pilot.throttle = fm.thr;
      this.jetAthr.reset();
      cws.thr = this.pilot.throttle;
      return { gamma: fm.gamma, bank: fm.bank };
    }
    if (!m.ab && this.pilot.throttle >= 0.98 && fm.acc > 1.2) {
      m.ab = true;
      this.pilot.throttle = 1;
    } else if (m.ab && fm.acc < 0.3) m.ab = false;
    const aFull = ((this.thrustMax() * C_MPS ** 2) / M_METRES) * this.jetThrust();
    this.pilot.throttle = this.jetAthr.step(this.pilot.throttle, f.V, fm.spd, aFull, dt);
    cws.thr = this.pilot.throttle;
    return { gamma: fm.gamma, bank: fm.bank };
  }
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
  // (a break, a hold — the leader's orders: controller/orders.ts —; the flight plan's guidance: the holds' targets —
  // controller/fplan.ts)
  this.orderStep(inp, f);
  // (the new modes — controller/jetmodes.ts —: the orbit's heading, the tanker's rendezvous)
  this.modesStep(inp, f);
  this.navStep(inp, f);
  if (m.spd !== null) {
    // (the throttle keys: the speed selected)
    m.spd = Math.max(30, m.spd + inp.throttle * JET.spdRate * dt);
    inp.throttle = 0;
    const aFull = ((this.thrustMax() * C_MPS ** 2) / M_METRES) * this.jetThrust();
    this.pilot.throttle = this.jetAthr.step(this.pilot.throttle, f.V, m.spd, aFull, dt);
  }
  cws.thr = this.pilot.throttle;
  const c = jetCommands(m, f);
  // (the terrain following's flight path in place of the altitude hold's)
  const tfg = this.tfCommand(f);
  return { gamma: cws.pitch ? null : (tfg ?? c.gamma), bank: cws.roll ? null : c.bank };
}

export function installJet(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { jetToggle, apSet, jetStep, jetFigures, jetThrust });
}
