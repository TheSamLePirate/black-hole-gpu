// The A320's flight guidance (docs/PLAN-A320.md, A8): the FCU, the autopilots, the flight directors, the autothrust —
// FlightGear's ITAF (Nasal/FMGC/FMGC-b.nas, FCU.nas) as Airbus's modes: lateral HDG / TRK, NAV, LOC* / LOC, RWY,
// GA TRK, LAND, FLARE, ROLL OUT; vertical SRS, CLB / DES and OP CLB / OP DES (the speed on the elevator, the thrust
// CLB or IDLE), ALT* / ALT (and ALT CST), V/S, FPA, G/S* / G/S, EXPED; their arming (blue) and captures; the A/THR's
// SPEED / MACH, THR CLB / IDLE / MCT, A.FLOOR, TOGA LK, MAN TOGA / FLX / MCT / THR. Its outputs: the flight path angle
// and the bank the Airbus law flies (src/a320/fbw.ts gammaCmd / bankCmd) with an autopilot engaged, the N1 the A/THR
// asks (the FADEC's: under the levers' limit), the FMA, the flight directors' orders, and FlightGear's properties the
// deck reads (the FCU's windows, its lights). Pure: a frame's figures in.

const D = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const FT = 0.3048;
const KT = 0.514444;

export type Lat = "" | "HDG" | "TRK" | "NAV" | "LOC*" | "LOC" | "RWY" | "RWY TRK" | "GA TRK" | "LAND" | "FLARE" | "ROLL OUT";
export type Vert =
  | ""
  | "SRS"
  | "CLB"
  | "DES"
  | "OP CLB"
  | "OP DES"
  | "ALT*"
  | "ALT"
  | "ALT CST*"
  | "ALT CST"
  | "V/S"
  | "FPA"
  | "G/S*"
  | "G/S"
  | "EXP CLB"
  | "EXP DES"
  | "LAND"
  | "FLARE"
  | "ROLL OUT";
export type Phase = "preflight" | "takeoff" | "climb" | "cruise" | "descent" | "approach" | "go around" | "done";

/** What the guidance reads each frame. */
export interface FmgcIn {
  dt: number;
  /** the speeds [kt], Mach; the altitude [ft] (the baro's), the vertical speed [ft/min], the radio altitude [ft] (null:
   *  above its range), the heading and the track [deg], the ground speed [kt], the flight path angle [deg] */
  ias: number;
  mach: number;
  tas: number;
  alt: number;
  vs: number;
  ra: number | null;
  hdg: number;
  trk: number;
  gs: number;
  fpa: number;
  onGround: boolean;
  /** the thrust levers 0…1 (the FADEC's detents: src/a320/fadec.ts detentOf: 0 idle … 2 CL, 4 FLX/MCT, 6 TOGA) */
  lever: number;
  detent: number;
  /** a FLEX temperature set (the take-off at FLX) */
  flex: boolean;
  flapLever: number;
  gearDown: boolean;
  /** the FMGC's speeds [kt]: VLS, VMAX, green dot, S, F, V2 */
  vls: number;
  vmax: number;
  greenDot: number;
  s: number;
  f: number;
  v2: number;
  /** α floor's TOGA (the FADEC's latch) */
  alphaFloor: boolean;
  /** the FADEC's N1 limits [%] and the N1 now */
  n1: { idle: number; clb: number; mct: number; flex: number; toga: number; now: number };
  /** the ILS tuned: its deviations [dots — the localizer + when the course is right of us, the glideslope + when it is
   *  above], its course [deg], its distance [NM]; null: none */
  ils: { loc: number | null; gs: number | null; course: number; dme: number; across: number } | null;
  /** the flight plan's lateral guidance: the heading to fly [deg], the waypoint's name; null: no plan */
  lnav: { hdg: number; active: string } | null;
  /** the managed altitude's constraint [ft] (null: none) */
  cstr: number | null;
  /** the side sticks' deflections now (−1…1): an autopilot's instinctive disconnection past ½ */
  stick: [number, number];
  /** the take-off's runway heading [deg] (RWY), the acceleration's height [ft over the field] */
  rwyHdg: number | null;
  accelAgl: number;
  /** the field's elevation [ft] (the take-off's, the landing's) */
  elev: number;
}

export interface FmgcOut {
  /** the flight path angle [rad] and the bank [rad, right +] the law flies — null: the pilot's (no autopilot) */
  gammaCmd: number | null;
  bankCmd: number | null;
  /** the N1 the autothrust asks [%] (null: the levers') */
  n1Cmd: number | null;
  /** the nose wheel's steering on the ROLL OUT (−1…1, right +: the pedals') — null: the pilot's */
  steer: number | null;
  /** RETARD: the levers to be brought back to idle (the autoland's 20 ft — the pilot's hand, done for him) */
  retard: boolean;
  /** the flight directors' orders: the pitch they ask more [deg], the bank they ask [deg, right +] (null: bars off) */
  fd: { pitch: number; bank: number } | null;
  /** an event this frame: the autopilot or the autothrust disconnected (the cavalry charge, the chime — A12) */
  event: "" | "ap off" | "athr off" | "ap engaged" | "athr engaged" | "alt alert";
}

/** The FMA's five columns as the PFD shows them. */
export interface Fma {
  thrust: string;
  vert: string;
  lat: string;
  vertArmed: string;
  latArmed: string;
  ap: string;
  fd: string;
  athr: string;
  /** the A/THR's state: off, armed (blue), active (white) */
  athrState: "" | "armed" | "active";
  /** the modes engaged in the last 10 s: boxed (Airbus's FMA) */
  boxed: { thrust: boolean; vert: boolean; lat: boolean; ap: boolean; athr: boolean };
}

export class Fmgc {
  // ---- the FCU's selections: the speed [kt] or Mach, managed or selected; the heading or track [deg], managed (dashes)
  // or selected; the altitude [ft] and its knob's step; the V/S [ft/min] or FPA [deg]; HDG-V/S or TRK-FPA
  spd = 160;
  mach = 0.78;
  machMode = false;
  spdManaged = true;
  hdg = 0;
  hdgManaged = true;
  alt = 5000;
  altStep: 100 | 1000 = 100;
  vs = 0;
  fpa = 0;
  trkFpa = false;
  // ---- the systems engaged
  ap1 = false;
  ap2 = false;
  fd1 = true;
  fd2 = true;
  athr = false;
  athrActive = false;
  locArm = false;
  apprArm = false;
  exped = false;
  // ---- the modes
  lat: Lat = "";
  latArmed = "";
  vert: Vert = "";
  vertArmed: string[] = [];
  thrust = "";
  phase: Phase = "preflight";
  /** the selected speed and heading shown in the FCU's windows for a while after a turn of their knobs (FlightGear's
   *  preselection: 10 s, 45 s) */
  private spdShowT = 0;
  private hdgShowT = 0;
  private airborneT = 0;
  private n1Cmd = 0;
  private spdI = 0;
  private flareGamma = 0;
  private lastIas = 0;
  private iasRate = 0;
  private now = 0;
  private event: FmgcOut["event"] = "";
  /** the TOGA LK's latch (α floor let go: TOGA held until the A/THR is pressed off) */
  private togaLk = false;

  get ap() {
    return this.ap1 || this.ap2;
  }

  // ---------------------------------------------------------------- the FCU's knobs and buttons (FCU.nas)

  /** A knob turned [notches, + clockwise]. */
  spdTurn(n: number) {
    if (this.machMode) this.mach = clamp(Math.round((this.mach + n * 0.01) * 100) / 100, 0.1, 0.99);
    else this.spd = clamp(Math.round(this.spd + n), 100, 399);
    // (managed: the knob preselects — shown, still managed)
    this.spdShowT = this.now;
  }
  hdgTurn(n: number) {
    this.hdg = ((Math.round(this.hdg + n) % 360) + 360) % 360 || 360;
    this.hdgShowT = this.now;
  }
  altTurn(n: number) {
    this.alt = clamp(Math.round((this.alt + n * this.altStep) / 100) * 100, 100, 49000);
  }
  vsTurn(n: number) {
    if (this.trkFpa) this.fpa = clamp(Math.round((this.fpa + n * 0.1) * 10) / 10, -9.9, 9.9);
    else this.vs = clamp(this.vs + n * 100, -6000, 6000);
  }
  /** pushed: managed; pulled: selected (the speed, the heading, the altitude's climb or descent, the V/S) */
  spdPush() {
    this.spdManaged = true;
  }
  spdPull(i?: FmgcIn) {
    if (this.spdManaged && i) {
      this.spd = Math.round(i.ias);
      this.mach = Math.round(i.mach * 100) / 100;
    }
    this.spdManaged = false;
  }
  hdgPush() {
    if (this.lnavOk) this.latArmed = this.lat === "NAV" ? "" : "NAV";
    if (this.lnavOk && this.lat !== "" && this.lat !== "RWY") this.setLat("NAV");
  }
  hdgPull(i?: FmgcIn) {
    if (this.hdgManaged && i) this.hdg = Math.round(this.trkFpa ? i.trk : i.hdg) || 360;
    this.hdgManaged = false;
    this.latArmed = this.latArmed === "NAV" ? "" : this.latArmed;
    this.locArm = this.apprArm = false;
    if (this.lat !== "RWY" || !this.onGround) this.setLat(this.trkFpa ? "TRK" : "HDG");
  }
  altPush(i?: FmgcIn) {
    // (managed: CLB or DES towards the FCU's altitude by the constraints)
    if (!i || i.onGround) return;
    this.setVert(this.alt > i.alt ? "CLB" : "DES");
  }
  altPull(i?: FmgcIn) {
    if (!i || i.onGround) return;
    if (Math.abs(this.alt - i.alt) < 250) return;
    this.setVert(this.alt > i.alt ? (this.exped ? "EXP CLB" : "OP CLB") : this.exped ? "EXP DES" : "OP DES");
  }
  vsPush(i?: FmgcIn) {
    // (pushed: a level-off — V/S 0)
    if (!i || i.onGround) return;
    this.vs = 0;
    this.fpa = 0;
    this.setVert(this.trkFpa ? "FPA" : "V/S");
  }
  vsPull(i?: FmgcIn) {
    if (!i || i.onGround) return;
    this.vs = Math.round(i.vs / 100) * 100;
    this.fpa = Math.round(i.fpa * 10) / 10;
    this.setVert(this.trkFpa ? "FPA" : "V/S");
  }
  ap1Toggle(i?: FmgcIn) {
    this.toggleAp(1, i);
  }
  ap2Toggle(i?: FmgcIn) {
    this.toggleAp(2, i);
  }
  private toggleAp(k: 1 | 2, i?: FmgcIn) {
    const on = k === 1 ? this.ap1 : this.ap2;
    if (on) {
      if (k === 1) this.ap1 = false;
      else this.ap2 = false;
      if (!this.ap) this.event = "ap off";
      return;
    }
    // (engaged: 5 s after the lift-off, 100 ft up — or on the ground for the take-off's RWY; one at a time but in LAND)
    if (!i || (!i.onGround && (this.airborneT < 5 || (i.ra ?? 1e9) < 100))) return;
    if (k === 1) this.ap1 = true;
    else this.ap2 = true;
    if (!(this.apprArm || this.lat === "LOC" || this.lat === "LAND")) {
      if (k === 1) this.ap2 = false;
      else this.ap1 = false;
    }
    // (engaged with no mode: the basic ones — HDG / V/S — at what is flown)
    if (!this.lat || (this.lat === "RWY" && !i.onGround))
      this.setLat(this.trkFpa ? "TRK" : "HDG"), (this.hdg = Math.round(this.trkFpa ? i.trk : i.hdg) || 360);
    if (!this.vert) this.vsPull(i);
    this.event = "ap engaged";
  }
  athrToggle() {
    if (this.athr) {
      this.athr = false;
      this.athrActive = false;
      this.togaLk = false;
      this.event = "athr off";
    } else {
      this.athr = true;
      this.event = "athr engaged";
    }
  }
  /** the instinctive buttons: the sticks' (the autopilots off), the levers' (the autothrust off) */
  apDisc() {
    if (this.ap) this.event = "ap off";
    this.ap1 = this.ap2 = false;
  }
  athrDisc() {
    if (this.athr) this.event = "athr off";
    this.athr = this.athrActive = this.togaLk = false;
  }
  locToggle() {
    this.apprArm = false;
    this.locArm = !this.locArm;
    if (!this.locArm && (this.lat === "LOC*" || this.lat === "LOC")) this.setLat(this.trkFpa ? "TRK" : "HDG");
  }
  apprToggle() {
    this.apprArm = !this.apprArm;
    this.locArm = this.apprArm;
    if (!this.apprArm) {
      if (this.lat === "LOC*" || this.lat === "LOC") this.setLat(this.trkFpa ? "TRK" : "HDG");
      if (this.vert === "G/S*" || this.vert === "G/S") this.setVert("V/S");
    }
  }
  expedToggle() {
    this.exped = !this.exped;
  }
  trkFpaToggle() {
    this.trkFpa = !this.trkFpa;
    if (this.lat === "HDG" || this.lat === "TRK") this.setLat(this.trkFpa ? "TRK" : "HDG");
    if (this.vert === "V/S" || this.vert === "FPA") this.setVert(this.trkFpa ? "FPA" : "V/S");
  }
  spdMachToggle(i?: FmgcIn) {
    this.machMode = !this.machMode;
    if (i) {
      if (this.machMode) this.mach = Math.round(i.mach * 100) / 100;
      else this.spd = Math.round(i.ias);
    }
  }
  altStepToggle() {
    this.altStep = this.altStep === 100 ? 1000 : 100;
  }

  // ---------------------------------------------------------------- the modes

  private onGround = true;
  private lnavOk = false;
  private setLat(m: Lat) {
    this.lat = m;
    if (m === "NAV" && this.latArmed === "NAV") this.latArmed = "";
  }
  private setVert(m: Vert) {
    this.vert = m;
    this.spdI = 0;
    if (m === "ALT" || m === "ALT*") this.vertArmed = this.vertArmed.filter((x) => x !== "ALT");
  }

  /** The managed speed [kt] by the phase and the configuration (the FMGC's: A9 refines it — the PERF pages). */
  managedSpeed(i: FmgcIn): number {
    switch (this.phase) {
      case "preflight":
      case "takeoff":
        return i.v2 + 10;
      case "go around":
        return Math.max(i.v2, i.vls);
      case "approach":
        return i.flapLever >= 4 ? i.vls + 5 : i.flapLever >= 3 ? i.f : i.flapLever >= 2 ? i.f : i.flapLever >= 1 ? i.s : i.greenDot;
      default:
        // (250 kt below FL100; 290 kt then Mach 0.78 above)
        return i.alt < 10000 ? 250 : Math.min(290, (0.78 / Math.max(i.mach, 0.3)) * i.ias);
    }
  }

  /** The speed the guidance holds now [kt]. */
  targetSpeed(i: FmgcIn): number {
    const sel = this.machMode ? (this.mach / Math.max(i.mach, 0.1)) * i.ias : this.spd;
    const t = this.spdManaged ? this.managedSpeed(i) : sel;
    return clamp(t, i.vls, i.vmax);
  }

  /** The heading or track the FCU selects now [deg] (managed: the plan's) */
  private selHdg(i: FmgcIn) {
    return this.hdg;
  }

  step(i: FmgcIn): FmgcOut {
    const dt = clamp(i.dt, 0, 0.25);
    this.now += dt;
    const ev = this.event;
    this.event = "";
    this.onGround = i.onGround;
    this.lnavOk = !!i.lnav;
    this.airborneT = i.onGround ? 0 : this.airborneT + dt;
    if (dt > 0) this.iasRate += ((i.ias - this.lastIas) / dt - this.iasRate) * Math.min(dt / 0.8, 1);
    this.lastIas = i.ias;
    const agl = i.ra ?? i.alt - i.elev;
    // ---- the autopilots let go: the sticks pushed past ½ (FlightGear's ITAF: 0.2 of the elevator's)
    if (this.ap && (Math.abs(i.stick[0]) > 0.5 || Math.abs(i.stick[1]) > 0.5)) this.apDisc();
    // ---- the flight's phase (made in the air — a flight placed there —: cruise, or the approach with the flaps out)
    if (this.phase === "preflight" && !i.onGround) this.phase = i.flapLever > 0 ? "approach" : "cruise";
    const take = i.onGround && i.detent >= 4;
    if (this.phase === "preflight" && take) this.phase = "takeoff";
    if (this.phase === "takeoff" && !i.onGround && agl > i.accelAgl) this.phase = "climb";
    if (
      (this.phase === "climb" || this.phase === "descent") &&
      !i.onGround &&
      Math.abs(i.alt - this.alt) < 200 &&
      (this.vert === "ALT" || this.vert === "ALT CST")
    )
      this.phase = this.phase === "climb" ? "cruise" : "descent";
    if ((this.phase === "cruise" || this.phase === "climb") && (this.vert === "DES" || this.vert === "OP DES") && this.alt < i.alt - 500)
      this.phase = "descent";
    if ((this.phase === "descent" || this.phase === "cruise") && (i.flapLever > 0 || (this.apprArm && agl < 8000))) this.phase = "approach";
    if (this.phase !== "go around" && !i.onGround && i.detent >= 6 && (this.phase === "approach" || this.lat === "LAND")) this.goAround(i);
    if (this.phase === "go around" && agl > i.accelAgl + 500) this.phase = "climb";
    if (i.onGround && i.gs < 30 && (this.phase === "approach" || this.lat === "ROLL OUT")) this.phase = "done";
    if (this.phase === "done" && take) this.phase = "takeoff";

    // ---- the take-off: RWY and SRS with the levers at FLX or TOGA on the ground (the FDs on), the autothrust armed
    if (i.onGround && take && this.lat !== "RWY") {
      this.setLat("RWY");
      this.setVert("SRS");
      if (this.lnavOk) this.latArmed = "NAV";
      this.vertArmed = ["CLB"];
      this.athr = true;
    }
    if (!i.onGround && this.lat === "RWY" && (i.ra ?? 1e9) > 30) this.setLat(this.latArmed === "NAV" && this.lnavOk ? "NAV" : "RWY TRK");
    if (!i.onGround && this.lat === "RWY TRK" && this.latArmed === "NAV" && this.lnavOk) this.setLat("NAV");
    // (SRS until the acceleration's height: CLB, the speed managed)
    if (this.vert === "SRS" && !i.onGround && agl > i.accelAgl) {
      this.setVert(this.alt > i.alt + 200 ? "CLB" : "ALT*");
      this.vertArmed = [];
    }
    // ---- NAV armed, engaged (the plan's), lost (no plan)
    if (this.latArmed === "NAV" && this.lnavOk && !i.onGround && (i.ra ?? 1e9) > 30 && this.lat !== "LOC*" && this.lat !== "LOC")
      this.setLat("NAV");
    if (this.lat === "NAV" && !this.lnavOk) this.setLat("HDG"), (this.hdg = Math.round(i.hdg) || 360);
    // ---- LOC and G/S captured (FMGC-b.nas checkLoc / checkGs): the localizer within 1.5 dots, closing; the glideslope
    // within 1 dot once the localizer is
    if (this.locArm && i.ils?.loc !== null && i.ils && !i.onGround && Math.abs(i.ils.loc!) < 1.5) {
      this.setLat("LOC*");
      this.locArm = false;
    }
    if (this.lat === "LOC*" && i.ils?.loc !== null && i.ils && Math.abs(i.ils.loc!) < 0.25 && Math.abs(wrap180(i.trk - i.ils.course)) < 10)
      this.setLat("LOC");
    if (
      this.apprArm &&
      (this.lat === "LOC*" || this.lat === "LOC") &&
      i.ils?.gs !== null &&
      i.ils &&
      Math.abs(i.ils.gs!) < 1 &&
      this.vert !== "G/S*" &&
      this.vert !== "G/S"
    ) {
      this.setVert("G/S*");
      this.apprArm = false;
    }
    if (this.vert === "G/S*" && i.ils?.gs !== null && i.ils && Math.abs(i.ils.gs!) < 0.2) this.setVert("G/S");
    // (the radio lost: back to the basic modes)
    if ((this.lat === "LOC" || this.lat === "LOC*") && (!i.ils || i.ils.loc === null) && !i.onGround)
      this.setLat("HDG"), (this.hdg = Math.round(i.hdg) || 360);
    if ((this.vert === "G/S" || this.vert === "G/S*") && (!i.ils || i.ils.gs === null) && agl > 100)
      this.setVert("V/S"), (this.vs = Math.round(i.vs / 100) * 100);
    // ---- the landing: LAND below 400 ft on LOC and G/S, FLARE at 50 ft — an autopilot's —, ROLL OUT on the wheels
    if (this.lat === "LOC" && this.vert === "G/S" && agl < 400 && agl > 0) {
      this.setLat("LAND");
      this.setVert("LAND");
    }
    if (this.vert === "LAND" && agl < 50 && this.ap) {
      this.setLat("FLARE");
      this.setVert("FLARE");
      this.flareGamma = i.fpa * D;
    }
    if ((this.vert === "FLARE" || this.vert === "LAND") && i.onGround) {
      this.setLat("ROLL OUT");
      this.setVert("ROLL OUT");
    }
    // ---- the altitude's capture (FMGC-b.nas: within |V/S|/5, at least 50 ft; going its way) and hold
    const toAlt = this.alt - i.alt;
    const climbing = ["CLB", "OP CLB", "EXP CLB", "V/S", "FPA", "SRS"].includes(this.vert);
    const capt = clamp(Math.round(Math.abs(i.vs) / 5 / 100) * 100, 50, 2500);
    if (climbing || ["DES", "OP DES", "EXP DES"].includes(this.vert)) {
      if (Math.abs(toAlt) <= capt && ((toAlt >= 0 && i.vs >= -25) || (toAlt < 0 && i.vs <= 25)) && !i.onGround && (this.ap || this.fd1)) {
        this.setVert(this.vert === "CLB" || this.vert === "DES" ? (i.cstr !== null ? "ALT CST*" : "ALT*") : "ALT*");
        this.event = this.event || "alt alert";
      }
    }
    if ((this.vert === "ALT*" || this.vert === "ALT CST*") && Math.abs(toAlt) < 20) this.setVert(this.vert === "ALT*" ? "ALT" : "ALT CST");
    // (ALT armed, blue, while climbing or descending towards the FCU's altitude)
    this.vertArmed = this.vertArmed.filter((x) => x !== "ALT");
    if (["CLB", "DES", "OP CLB", "OP DES", "V/S", "FPA", "EXP CLB", "EXP DES"].includes(this.vert) && Math.abs(toAlt) > 50)
      this.vertArmed.unshift("ALT");
    if (this.apprArm) {
      if (!this.vertArmed.includes("G/S")) this.vertArmed.push("G/S");
      if (this.latArmed !== "LOC") this.latArmed = "LOC";
    } else this.vertArmed = this.vertArmed.filter((x) => x !== "G/S");
    if (this.locArm && !this.apprArm) this.latArmed = "LOC";
    if (!this.locArm && this.latArmed === "LOC") this.latArmed = "";

    // ---- the guidance: the lateral order (a bank), the vertical (a flight path angle)
    const V = Math.max(i.tas, 60) * KT;
    let bank: number | null = null;
    // (the bank towards a heading or a track: 2.5° a degree off, 25° at most — the game's heading hold's)
    const toward = (want: number, track: boolean) => clamp(2.5 * wrap180(want - (track ? i.trk : i.hdg)), -25, 25) * D;
    switch (this.lat) {
      case "HDG":
        bank = toward(this.selHdg(i), false);
        break;
      case "TRK":
      case "RWY TRK":
      case "GA TRK":
        bank = toward(this.lat === "TRK" ? this.selHdg(i) : (i.rwyHdg ?? i.trk), true);
        break;
      case "NAV":
        bank = i.lnav ? toward(i.lnav.hdg, false) : 0;
        break;
      case "LOC*":
      case "LOC":
      case "LAND":
      case "FLARE": {
        // (the course and the deviation: a dot ≈ 0.8°: the intercept up to 30° to it, closer the nearer)
        const L = i.ils;
        const dev = L?.loc ?? 0;
        const cut = clamp(dev * (this.lat === "LOC*" ? 14 : 12), -30, 30);
        const lim = this.lat === "LAND" || this.lat === "FLARE" ? 10 : 25;
        bank = clamp(2.5 * wrap180(L ? L.course + cut - i.trk : 0), -lim, lim) * D;
        break;
      }
      case "RWY":
      case "ROLL OUT":
        bank = 0;
        break;
    }
    let gamma: number | null = null;
    const tgtSpd = this.targetSpeed(i);
    // (the speed on the elevator: the path's angle more as the speed is above its target — OP CLB, CLB, SRS, DES)
    const speedOnPitch = (base: number, lo: number, hi: number) => {
      const err = i.ias - tgtSpd;
      this.spdI = clamp(this.spdI + err * dt * 0.02, -3, 3);
      return clamp(base + 0.35 * err + this.spdI + 4 * this.iasRate, lo, hi) * D;
    };
    const vsGamma = (vs: number) => Math.asin(clamp((vs * FT) / 60 / V, -0.5, 0.5));
    switch (this.vert) {
      case "SRS":
        // (V2 + 10 held, the pitch at most 18°: a climb the engines allow)
        gamma = i.onGround ? null : speedOnPitch(i.fpa, 2, 15);
        break;
      case "CLB":
      case "OP CLB":
      case "EXP CLB":
        gamma = speedOnPitch(i.fpa, 0.5, 15);
        break;
      case "DES":
      case "OP DES":
      case "EXP DES":
        gamma = speedOnPitch(i.fpa, -8, -0.5);
        break;
      case "ALT*":
      case "ALT CST*":
        // (towards the altitude by a V/S closing on it: |V/S| ≈ its distance ÷ 0.1 min, at most what was flown)
        gamma = vsGamma(clamp(toAlt * 6, -Math.max(Math.abs(i.vs), 500), Math.max(Math.abs(i.vs), 500)));
        break;
      case "ALT":
      case "ALT CST":
        gamma = vsGamma(clamp(toAlt * 4, -1500, 1500));
        break;
      case "V/S":
        gamma = vsGamma(this.vs);
        break;
      case "FPA":
        gamma = this.fpa * D;
        break;
      case "G/S*":
      case "G/S":
      case "LAND": {
        // (the glideslope: 3° down, the deviation closed — a dot ≈ 0.35°)
        const g = i.ils?.gs ?? 0;
        gamma = (-3 + clamp(g * (this.vert === "G/S*" ? 1.2 : 0.8), -2.5, 2.5)) * D;
        break;
      }
      case "FLARE": {
        // (the sink brought to ~100 ft/min at the wheels: the path flattened as the height comes down)
        const want = -Math.max(agl * 8 + 60, 60);
        this.flareGamma += (vsGamma(want) - this.flareGamma) * Math.min(dt * 2, 1);
        gamma = this.flareGamma;
        break;
      }
      case "ROLL OUT":
        gamma = null;
        break;
    }
    // ---- the autothrust (A/THR): armed by its button or the take-off's levers; active with the levers at or under CL
    // (MCT with an engine out), its N1 under their limit
    const lim = i.detent >= 6 ? i.n1.toga : i.detent >= 4 ? (i.flex && i.onGround ? i.n1.flex : i.n1.mct) : i.detent >= 2 ? i.n1.clb : null;
    if (i.alphaFloor && this.athr) this.togaLk = true;
    this.athrActive =
      this.athr &&
      (this.togaLk || (i.detent > 0 && i.detent <= 3 && !i.onGround) || (i.detent > 0 && i.detent <= 3 && this.phase === "done"));
    let n1: number | null = null;
    if (this.togaLk) {
      n1 = i.n1.toga;
      this.thrust = i.alphaFloor ? "A.FLOOR" : "TOGA LK";
    } else if (this.athrActive) {
      const maxN1 = i.detent >= 2 ? i.n1.clb : Math.max(i.n1.idle, (i.lever / 0.6) * i.n1.clb);
      const idleV = ["DES", "OP DES", "EXP DES"].includes(this.vert);
      const clbV = ["CLB", "OP CLB", "EXP CLB", "SRS"].includes(this.vert);
      if (this.vert === "FLARE" && agl < 30) {
        n1 = i.n1.idle;
        this.thrust = "IDLE";
      } else if (this.vert === "ROLL OUT") {
        n1 = i.n1.idle;
        this.thrust = "";
      } else if (clbV) {
        n1 = maxN1;
        this.thrust = "THR CLB";
      } else if (idleV) {
        n1 = i.n1.idle;
        this.thrust = "THR IDLE";
      } else {
        // (SPEED / MACH: the N1 moved to the speed — its rate's own damping)
        if (!Number.isFinite(this.n1Cmd) || this.n1Cmd <= 0) this.n1Cmd = i.n1.now;
        const err = tgtSpd - i.ias;
        this.n1Cmd = clamp(this.n1Cmd + (0.5 * err - 4 * this.iasRate) * dt, i.n1.idle, maxN1);
        n1 = this.n1Cmd;
        this.thrust = this.machMode && !this.spdManaged ? "MACH" : "SPEED";
      }
      if (n1 !== this.n1Cmd) this.n1Cmd = n1;
    } else {
      this.n1Cmd = i.n1.now;
      this.thrust =
        i.detent >= 6
          ? "MAN TOGA"
          : i.detent >= 4
            ? i.flex && i.onGround
              ? "MAN FLX"
              : "MAN MCT"
            : this.athr && i.detent > 3
              ? "MAN THR"
              : "";
    }
    if (lim === null && !this.athrActive && this.athr && i.detent === 0 && !i.onGround) {
      // (the levers at idle in flight with the A/THR on: it stays armed, the thrust the levers' — idle)
    }
    // ---- out: the autopilot's orders to the law; the flight directors' — what they would ask more
    const apOn = this.ap && !i.onGround;
    const fdOn = (this.fd1 || this.fd2) && !!this.lat && this.vert !== "ROLL OUT";
    const fd = fdOn
      ? {
          pitch: clamp(((gamma ?? i.fpa * D) - i.fpa * D) / D, -10, 10),
          bank: clamp((bank ?? 0) / D, -30, 30),
        }
      : null;
    // (the ROLL OUT: the nose wheel onto the centreline — the course, the distance off it closed —, the autopilot's)
    let steer: number | null = null;
    if (this.vert === "ROLL OUT" && this.ap && i.ils) {
      const want = i.ils.course - clamp(i.ils.across * 0.6, -15, 15);
      steer = clamp(0.06 * wrap180(want - i.trk), -1, 1);
    }
    // (RETARD at 20 ft: the levers to idle — then the autothrust let go, as the levers at idle do)
    const retard = (this.vert === "FLARE" && agl < 20 && i.lever > 0.01) || (this.vert === "ROLL OUT" && i.lever > 0.01 && this.ap);
    if (this.vert === "ROLL OUT" && this.athr && i.lever <= 0.01) this.athrDisc();
    return { gammaCmd: apOn ? gamma : null, bankCmd: apOn ? bank : null, n1Cmd: n1, fd, steer, retard, event: this.event || ev };
  }

  private goAround(i: FmgcIn) {
    this.phase = "go around";
    this.setLat("GA TRK");
    this.setVert("SRS");
    this.locArm = this.apprArm = false;
    this.vertArmed = ["CLB"];
    if (this.lnavOk) this.latArmed = "NAV";
    this.athr = true;
    void i;
  }

  /** when each column's mode last changed (the FMA's boxes) */
  private changed = { thrust: -1e9, vert: -1e9, lat: -1e9, ap: -1e9, athr: -1e9 };
  private shown = { thrust: "", vert: "", lat: "", ap: "", athr: "" };

  /** The FMA now. */
  fma(): Fma {
    const latArmed = this.latArmed;
    const cols = {
      thrust: this.thrust,
      vert: this.vert as string,
      lat: this.lat as string,
      ap: this.ap ? "ap" : "",
      athr: this.athrActive ? "on" : "",
    };
    for (const k of Object.keys(cols) as (keyof typeof cols)[])
      if (cols[k] !== this.shown[k]) {
        this.shown[k] = cols[k];
        if (cols[k]) this.changed[k] = this.now;
      }
    const box = (k: keyof typeof cols) => !!cols[k] && this.now - this.changed[k] < 10;
    return {
      thrust: this.thrust,
      vert: this.vert,
      lat: this.lat,
      vertArmed: this.vertArmed.join(" "),
      latArmed,
      ap: this.ap1 && this.ap2 ? "AP1+2" : this.ap1 ? "AP1" : this.ap2 ? "AP2" : "",
      fd: this.fd1 || this.fd2 ? `${this.fd1 ? 1 : "-"} FD ${this.fd2 ? 2 : "-"}` : "",
      athr: this.athr ? "A/THR" : "",
      athrState: !this.athr ? "" : this.athrActive ? "active" : "armed",
      boxed: { thrust: box("thrust"), vert: box("vert"), lat: box("lat"), ap: box("ap"), athr: box("athr") },
    };
  }

  /** FlightGear's properties the deck reads (the FCU's windows and dots, its lights; paths as the deck keys them). */
  deckProps(i: FmgcIn | null): Record<string, number | string> {
    const showSpd = !this.spdManaged || this.now - this.spdShowT < 10;
    const showHdg = !this.hdgManaged || this.now - this.hdgShowT < 45;
    const vsShown = this.vert === "V/S" || this.vert === "FPA";
    const vsAbs = Math.abs(this.vs);
    return {
      "FMGC/FCU-working": 1,
      "it-autoflight/input/kts-mach": this.machMode ? 1 : 0,
      "it-autoflight/custom/show-spd": showSpd ? 1 : 0,
      "it-autoflight/custom/show-hdg": showHdg ? 1 : 0,
      "it-autoflight/input/kts-display": this.spd,
      "it-autoflight/input/mach-display": this.mach,
      "it-autoflight/input/hdg": this.hdg,
      "it-autoflight/input/alt": this.alt,
      "it-autoflight/input/fpa": this.fpa,
      // (V/S: its hundreds as four digits and a sign — the last two "oo" in the window; dashes when not flown)
      "it-autoflight/output/vs-fcu-display": vsShown
        ? `${this.vs < 0 ? "-" : "+"}${String(Math.round(vsAbs / 100)).padStart(2, "0")}`
        : "-----",
      "it-autoflight/output/vert": this.vert === "V/S" ? 1 : this.vert === "FPA" ? 5 : this.vert === "" ? 0 : 4,
      "it-autoflight/config/altitude-dial-mode": this.altStep === 1000 ? 1 : 0,
      "controls/indicators/fcu-ap1": this.ap1 ? 1 : 0,
      "controls/indicators/fcu-ap2": this.ap2 ? 1 : 0,
      "controls/indicators/fcu-athr": this.athr ? 1 : 0,
      "controls/indicators/fcu-loc": this.locArm || this.lat === "LOC*" || this.lat === "LOC" ? 1 : 0,
      "controls/indicators/fcu-appr": this.apprArm || this.vert === "G/S*" || this.vert === "G/S" || this.lat === "LAND" ? 1 : 0,
      "controls/indicators/fcu-exped": this.exped ? 1 : 0,
      "controls/indicators/fcu-hdg-vs": this.trkFpa ? 0 : 1,
      "controls/indicators/fcu-trk-fpa": this.trkFpa ? 1 : 0,
      "controls/indicators/fcu-alt": 1,
      "it-autoflight/custom/spd-knb": this.spdManaged ? 1 : 0,
      "it-autoflight/custom/hdg-knb": this.hdgManaged ? 1 : 0,
      "it-autoflight/custom/alt-knb": 0,
      "it-autoflight/custom/vs-knb": vsShown ? 0 : 1,
      ...(i ? {} : {}),
    };
  }
}
