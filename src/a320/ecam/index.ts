// The A320's ECAM and its flight warning computer (docs/PLAN-A320.md, A11): FlightGear's, run on the systems' bag —
// its FWC's JSBSim files (fwcdata.json: the phases' and the warnings' timers, flip-flops, conditions), its property
// rules (proprules.ts), its Nasal logic (logic.ts, generated from ECAM-logic.nas: each warning's condition and each
// of its procedure's lines'), and here its controller (ECAM-controller.nas: the E/WD written in priority order, the
// master lights and the aurals once, CLR, RCL, STATUS), its phases (ECAM-phases.nas: 1 power on … 10 five minutes
// after the second engine's shutdown; the take-off's and the landing's inhibitions), its main loop (ECAM-main.nas:
// the AP's and the A/THR's disconnection warnings, the engines' start time for the T.O memo, the control panel) and
// its system display's page (sd.ts).

import type { Props } from "../rig";
import { JsbSystems, type SysData } from "../systems/jsbsys";
import type { NasalModule } from "../systems/types";
import fwcdata from "./fwcdata.json";
import { AURAL, Fwc, LIGHT, type Msg } from "./fwc";
import { hydraulicLoPr } from "./extra";
import { LOGIC } from "./logic";
import { PropRules, type Rule } from "./proprules";
import proprules from "./proprules.json";
import { SystemDisplay } from "./sd";

export { PAGES } from "./sd";
export { type EcamGame, ecamInputs } from "./inputs";

export interface EcamLine {
  text: string;
  colour: "r" | "a" | "g" | "c" | "w" | "m";
}
/** the ECAM's aural cues: the continuous repetitive chime (a red warning), the single chime (amber), the stall's
 *  cricket, the AP's disconnection cavalry charge, the altitude alert's C-chord, a gong */
export type Aural = "crc" | "chime" | "cricket" | "cavalry" | "cchord" | "gong";

const num = (P: Props, k: string) => Number(P[k] ?? 0) || 0;
const line = (m: { msg: string; colour: string }): EcamLine => ({ text: m.msg, colour: m.colour as EcamLine["colour"] });
/** the aurals' properties to their cues (ECAM-controller.nas's aural vector: crc, chime, cricket, retard, cchord, click
 *  — the RETARD callout and the click are A12's sounds, not the ECAM's cues) */
const CUE: Record<string, Aural> = {
  "sim/sound/warnings/crc": "crc",
  "sim/sound/warnings/chime": "chime",
  "sim/sound/warnings/cricket": "cricket",
  "sim/sound/warnings/stall-voice": "cricket",
  "sim/sound/warnings/cchord": "cchord",
};

/** The STATUS page's lines (FlightGear's STATUS page is empty: these are the FCOM's, ours) — each with its condition
 *  on the bag: limitations and procedures on its left, the systems inoperative on its right. */
type StatusCase = { on: (P: Props) => boolean; left?: [string, EcamLine["colour"]][]; inop?: string[] };
const lo = (P: Props, s: string) => num(P, `systems/hydraulic/${s}-psi`) < 1450;
const flying = (P: Props) => {
  const ph = num(P, "ECAM/warning-phase");
  return ph >= 2 && ph <= 9;
};
const engOut = (P: Props, k: 0 | 1) => {
  const ph = num(P, "ECAM/warning-phase");
  return ph >= 3 && ph <= 8 && num(P, `engines/engine${k ? "[1]" : ""}/state`) !== 3;
};
const LDG_DIST: [string, EcamLine["colour"]] = ["LDG DIST PROC....APPLY", "c"];
const MAX_320: [string, EcamLine["colour"]] = ["MAX SPD........320/.77", "c"];
const STATUS: StatusCase[] = [
  {
    on: (P) => flying(P) && lo(P, "green") && lo(P, "yellow"),
    left: [MAX_320, LDG_DIST],
    inop: ["G+Y HYD", "CAT 2", "AP 1+2", "REVERSER 1+2"],
  },
  {
    on: (P) => flying(P) && lo(P, "green") && lo(P, "blue"),
    left: [MAX_320, LDG_DIST],
    inop: ["G+B HYD", "CAT 2", "AP 1+2", "REVERSER 1"],
  },
  {
    on: (P) => flying(P) && lo(P, "blue") && lo(P, "yellow"),
    left: [MAX_320, LDG_DIST],
    inop: ["B+Y HYD", "CAT 2", "AP 1+2", "REVERSER 2"],
  },
  {
    on: (P) => flying(P) && lo(P, "green"),
    left: [["SLATS/FLAPS SLOW", "c"], LDG_DIST],
    inop: ["G HYD", "CAT 3 DUAL", "REVERSER 1", "NORM BRK", "AUTO BRK"],
  },
  { on: (P) => flying(P) && lo(P, "blue"), left: [LDG_DIST], inop: ["B HYD", "CAT 3 DUAL"] },
  { on: (P) => flying(P) && lo(P, "yellow"), left: [LDG_DIST], inop: ["Y HYD", "CAT 3 DUAL", "REVERSER 2", "N/W STRG"] },
  { on: (P) => engOut(P, 0) && engOut(P, 1), left: [["MIN RAT SPD.....140 KT", "c"]], inop: ["ENG 1", "ENG 2"] },
  { on: (P) => engOut(P, 0), left: [LDG_DIST, ["AVOID ICING CONDITIONS", "c"]], inop: ["ENG 1", "CAT 3 DUAL", "REVERSER 1"] },
  { on: (P) => engOut(P, 1), left: [LDG_DIST, ["AVOID ICING CONDITIONS", "c"]], inop: ["ENG 2", "CAT 3 DUAL", "REVERSER 2"] },
  { on: (P) => !!num(P, "systems/fire/engine1/warning-active"), inop: ["ENG 1", "CAT 3 DUAL"] },
  { on: (P) => !!num(P, "systems/fire/engine2/warning-active"), inop: ["ENG 2", "CAT 3 DUAL"] },
  { on: (P) => !!num(P, "systems/fire/apu/warning-active"), inop: ["APU"] },
  { on: (P) => !!num(P, "ECAM/warnings/flipflop/gen-1-fault"), inop: ["GEN 1"] },
  { on: (P) => !!num(P, "ECAM/warnings/flipflop/gen-2-fault"), inop: ["GEN 2"] },
  { on: (P) => num(P, "it-fbw/law") === 1, left: [["ALTN LAW : PROT LOST", "a"], MAX_320], inop: ["CAT 3 DUAL"] },
  {
    on: (P) => num(P, "it-fbw/law") >= 2,
    left: [
      ["DIRECT LAW", "a"],
      ["MANOEUVER WITH CARE", "c"],
      ["USE SPD BRK WITH CARE", "c"],
    ],
    inop: ["CAT 2", "AP 1+2", "A/THR"],
  },
  {
    on: (P) => flying(P) && ![1, 2, 3].some((k) => num(P, `systems/navigation/adr/operating-${k}`)),
    left: [MAX_320],
    inop: ["ADR 1+2+3", "AP 1+2", "A/THR"],
  },
  {
    on: (P) => flying(P) && num(P, "systems/electrical/bus/ac-1") < 110 && num(P, "systems/electrical/bus/ac-2") < 110,
    left: [MAX_320],
    inop: ["MAIN GALLEY", "CAT 2"],
  },
];

export class Ecam {
  readonly F = new Fwc();
  readonly sd = new SystemDisplay();
  private jsb = new JsbSystems(fwcdata as unknown as SysData);
  private rules = new PropRules((proprules as { rules: Rule[] }).rules);
  /** the E/WD's lines as last written (eight a side) */
  private L: EcamLine[] = [];
  private Rt: EcamLine[] = [];
  private overflowL = false;
  /** ECAM-controller.nas's clear() and recall()'s state */
  private statusFlag = false;
  private recallCounter = 0;
  /** the Nasal loops' periods: the controller's and the main loop's every 5 frames (12 Hz), the phases' every 10, the
   *  SD's each second */
  private acc = { ctl: 0, phase: 0, sd: 0, flash: 0 };
  private lastPhase: number | null = null;
  private cues: Aural[] = [];
  private seen: Record<string, number> = {};
  private engKey = "";
  private dcEssUp = false;
  /** the Nasal modules the logic reads objects of (systems/nasal: the fire's detectors, the ADIRS's units, the APU's
   *  signals) — given by bind() */
  private mods: NasalModule[] = [];

  /** the flight phase (FWC: 1 power on, 2 engines started, 3 take-off power, 4 80 kt, 5 lift-off, 6 above 1 500 ft, 7
   *  below 800 ft, 8 touchdown, 9 below 80 kt, 10 five minutes after the engines' shutdown) */
  phase = 1;

  constructor() {
    // (the MCDU's received messages: none — FlightGear's -99)
    this.F.calls["mcdu.ReceivedMessagesDatabase.firstUnviewed"] = () => -99;
  }

  /** The flight's start: everything quiet, the phase its first. */
  reset(P: Props) {
    this.jsb.reset(P);
    this.rules.reset();
    const F = this.F;
    F.P = P;
    F.clock.clear();
    for (const v of [F.warnings, F.configmemos, F.leftmemos, F.specialLines, F.secondaryFailures, F.memos])
      for (const m of v) Object.assign(m, { active: 0, noRepeat: 0, noRepeat2: 0, clearFlag: 0, hasCalled: 0, wasActive: 0 });
    F.V = { ...F.V, ...Object.fromEntries(Object.keys(F.V).map((k) => [k, k === "thrustState" ? [null, null] : null])) };
    for (const k of ["takeoffConfig", "transmitFlag1", "transmitFlag2", "fltCtlLandAsap", "altAlertSteady", "altAlertFlash"]) F.V[k] = 0;
    // (ECAM-messages.nas's msgSave: the THRUST LOCKED's own text, the logic flashing it)
    P["@msgSave"] = F.M.athr_lock?.msg ?? "";
    P["@ecam.ap_active"] = P["@ecam.athr_active"] = 0;
    for (const k of [...LIGHT, ...AURAL, "ECAM/warnings/master-warning-flash"]) P[k] = 0;
    P["ECAM/warning-phase"] = P["ECAM/warning-phase"] ?? 1;
    P["ECAM/engine-start-time"] = 0;
    P["ECAM/engine-start-time-switch"] = 0;
    P["it-autoflight/output/ap-warning"] = P["it-autoflight/output/athr-warning"] = 0;
    this.sd.reset();
    this.L = [];
    this.Rt = [];
    this.statusFlag = false;
    this.lastPhase = null;
    this.cues = [];
    this.seen = {};
    this.acc = { ctl: 0, phase: 0, sd: 0, flash: 0 };
    this.phase = num(P, "ECAM/warning-phase") || 1;
  }

  /** the systems' Nasal modules (src/a320/systems: A320Systems.nasal), whose objects the logic reads */
  bind(mods: NasalModule[]) {
    this.mods = mods;
  }

  /** A frame [s]: the FWC's JSBSim channels, the property rules, the Nasal's loops at their rates. */
  step(P: Props, dt: number) {
    const F = this.F;
    F.P = P;
    this.objects(P);
    F.clock.tick(dt);
    this.jsb.step(P, dt);
    this.rules.step(P, dt);
    // (the DC ESS bus lost: the controller reset — its listener)
    const up = num(P, "systems/electrical/bus/dc-ess") >= 25;
    if (!up && this.dcEssUp) this.ctlReset();
    this.dcEssUp = up;
    this.acc.ctl += dt;
    this.acc.phase += dt;
    this.acc.sd += dt;
    if (this.acc.phase >= 1 / 6) {
      this.acc.phase = 0;
      this.phaseLoop(P);
    }
    if (this.acc.ctl >= 1 / 12) {
      this.acc.ctl = 0;
      this.mainLoop(P);
      this.loop(P);
    }
    if (this.acc.sd >= 1) {
      this.acc.sd = 0;
      this.sd.update(P, num(P, "sim/time/elapsed-sec"));
    }
    // (the master warning flashing at 4 Hz while on — its warnTimer)
    if (num(P, LIGHT[0]!)) {
      this.acc.flash += dt;
      if (this.acc.flash >= 0.25) {
        this.acc.flash = 0;
        P["ECAM/warnings/master-warning-flash"] = num(P, "ECAM/warnings/master-warning-flash") ? 0 : 1;
      }
    } else P["ECAM/warnings/master-warning-flash"] = this.acc.flash = 0;
    // (the aurals started: their properties' rising edges)
    for (const k in CUE) {
      const v = num(P, k);
      if (v && !this.seen[k]) this.cues.push(CUE[k]!);
      this.seen[k] = v;
    }
    this.phase = num(P, "ECAM/warning-phase") || 1;
  }

  // ---- the Nasal objects the logic reads, on the bag under their names ("@…" — inputs.md)
  private objects(P: Props) {
    for (const m of this.mods) {
      const o = m as unknown as Record<string, unknown>;
      if (m.name === "FIRE") {
        const units = o.units as { condition: number; loop: number[] }[] | undefined;
        units?.forEach((u, i) => {
          P[`@systems.engFireDetectorUnits.vector[${i}].condition`] = u.condition;
          P[`@systems.engFireDetectorUnits.vector[${i}].loopOne`] = u.loop[0]!;
          P[`@systems.engFireDetectorUnits.vector[${i}].loopTwo`] = u.loop[1]!;
        });
        const cargo = o.cargo as { loop: number[] }[] | undefined;
        cargo?.forEach((u, i) => {
          P[`@systems.cargoSmokeDetectorUnits.vector[${i}].condition`] = 100;
          P[`@systems.cargoSmokeDetectorUnits.vector[${i}].loopOne`] = u.loop[0]!;
          P[`@systems.cargoSmokeDetectorUnits.vector[${i}].loopTwo`] = u.loop[1]!;
        });
      } else if (m.name === "ADIRS") {
        const units = o.units as { inAlign: boolean; alignTime: number }[] | undefined;
        const clock = o.clock as { t: number } | undefined;
        const now = num(P, "sim/time/elapsed-sec");
        units?.forEach((u, i) => {
          P[`@systems.ADIRS.ADIRunits[${i}].inAlign`] = u.inAlign ? 1 : 0;
          // (its time on its own clock: on the flight's)
          P[`@systems.ADIRS.ADIRunits[${i}]._alignTime`] = u.alignTime - (clock?.t ?? 0) + now;
        });
      } else if (m.name === "APU") {
        const a = o as { autoshutdown?: boolean; emer?: boolean };
        for (const p of ["systems.APU", "systems.APUController.APU"]) {
          P[`@${p}.signals.autoshutdown`] = a.autoshutdown ? 1 : 0;
          P[`@${p}.signals.emer`] = a.emer ? 1 : 0;
        }
        P["@systems.APUController.APU"] = 1;
        P["@systems.APUController.APU.signals.available"] = num(P, "systems/apu/available");
      }
    }
  }

  // ---- ECAM-phases.nas
  private phaseLoop(P: Props) {
    if (
      (num(P, "systems/electrical/bus/ac-ess") < 110 && num(P, "systems/electrical/bus/ac-2") < 110) ||
      num(P, "systems/acconfig/autoconfig-running")
    )
      return;
    const cur = num(P, "ECAM/warning-phase");
    const gnd = !!num(P, "ECAM/logic/ground-calc-immediate");
    const gndTimer = num(P, "ECAM/timer/ground-calc");
    if (num(P, "ECAM/flipflop/recall-reset")) P["ECAM/flipflop/recall-reset"] = 0;
    const toPower = !!num(P, "ECAM/phases/phase-calculation/takeoff-power");
    const off = !!num(P, "ECAM/phases/phase-calculation/engines-1-2-not-running");
    const run = !!num(P, "ECAM/phases/phase-calculation/engine-1-or-2-running");
    const s80 = !!num(P, "ECAM/phases/speed-gt-80");
    const ph1 = !!num(P, "ECAM/phases/monostable/phase-1-300-output");
    const ph2 = !!num(P, "ECAM/phases/flipflop/phase-2-output");
    const ph5 = !!num(P, "ECAM/phases/monostable/phase-5") && !!num(P, "ECAM/phases/monostable/phase-5-output");
    const ph7 = !!num(P, "ECAM/phases/monostable/phase-7") && !!num(P, "ECAM/phases/monostable/phase-7-output");
    const set = (n: number) => {
      if (this.lastPhase !== n) {
        P["ECAM/warning-phase"] = n;
        P["ECAM/flipflop/recall-reset"] = 1;
        this.lastPhase = n;
      }
    };
    if (gnd && off && cur !== 9 && !ph1) set(1);
    if (run && gnd && !toPower && !s80 && !ph2) set(2);
    if (run && gndTimer === 1 && toPower && !s80) set(3);
    if (gndTimer === 1 && toPower && s80) set(4);
    if (ph5) set(5);
    if (!gnd && num(P, "ECAM/phases/monostable/gnd-output-2") !== 1 && !ph5 && !ph7) set(6);
    if (ph7 && cur !== 8) set(7);
    if (!toPower && s80 && (gnd || num(P, "ECAM/phases/monostable/gnd-output") === 1)) set(8);
    if (ph2 && gnd && !toPower && !s80 && num(P, "ECAM/phases/phase-calculation/one-engine-running") !== 0) set(9);
    if (gnd && off && cur === 9 && ph1) set(10);
    // (the inhibitions: T.O INHIBIT in phases 3–5, LDG INHIBIT in 7–8, unless RCL — FlightGear's own precedence kept)
    const now = num(P, "ECAM/warning-phase");
    const rcl = !!num(P, "ECAM/flipflop/recall-output");
    P["ECAM/phases/timer/to-inhibit"] = now >= 3 && now <= 5 && !rcl ? 1 : 0;
    P["ECAM/phases/timer/ldg-inhibit"] = now === 7 || (now === 8 && !rcl) ? 1 : 0;
  }

  // ---- ECAM-main.nas
  private mainLoop(P: Props) {
    const now = num(P, "sim/time/elapsed-sec");
    const apWarn = num(P, "it-autoflight/output/ap-warning");
    const athrWarn = num(P, "it-autoflight/output/athr-warning");
    let ap = num(P, "@ecam.ap_active");
    if (ap === 1 && !apWarn) ap = 0;
    else if (ap === 1 && apWarn === 1 && now > num(P, "ECAM/warnings/ap-off-time") + 9) {
      ap = 0;
      P["it-autoflight/output/ap-warning"] = 0;
    } else if (ap === 0 && apWarn !== 0) ap = 1;
    if (ap === 1 && apWarn === 1 && now > num(P, "ECAM/warnings/ap-off-time") + 3 && num(P, LIGHT[0]!)) P[LIGHT[0]!] = 0;
    P["@ecam.ap_active"] = ap;
    let athr = num(P, "@ecam.athr_active");
    if (athr === 1 && !athrWarn) athr = 0;
    else if (athr === 1 && athrWarn === 1 && now > num(P, "ECAM/warnings/athr-off-time") + 9) {
      athr = 0;
      P["it-autoflight/output/athr-warning"] = 0;
    } else if (athr === 0 && athrWarn !== 0) athr = 1;
    if (athr === 1 && athrWarn === 1 && now > num(P, "ECAM/warnings/athr-off-time") + 3 && num(P, LIGHT[1]!)) P[LIGHT[1]!] = 0;
    P["@ecam.athr_active"] = athr;
    // (its update items: the AP's hard warning cleared by an AP engaged, the A/THR's by the A/THR; the engines' start
    // time — both running on the ground — for the T.O memo two minutes after)
    if (apWarn === 2 && (num(P, "it-autoflight/output/ap1") || num(P, "it-autoflight/output/ap2"))) {
      P["it-autoflight/output/ap-warning"] = 0;
      P[LIGHT[0]!] = 0;
    }
    if (athrWarn === 2 && num(P, "it-autoflight/output/athr")) P["it-autoflight/output/athr-warning"] = 0;
    const s1 = num(P, "engines/engine/state"),
      s2 = num(P, "engines/engine[1]/state"),
      wow = num(P, "gear/gear/wow");
    const key = `${s1}|${s2}|${wow}`;
    if (key !== this.engKey) {
      this.engKey = key;
      if (s1 !== 3 || s2 !== 3) {
        P["ECAM/engine-start-time-switch"] = 0;
        P["ECAM/engine-start-time"] = 0;
      } else if (wow) {
        P["ECAM/engine-start-time"] = now;
        P["ECAM/engine-start-time-switch"] = 1;
      }
    }
  }

  /** The AP's disconnection (ECAM-main.nas doApWarn): "soft" — the instinctive button: AP OFF 3 s, the cavalry charge
   *  —, "hard" — any other: the master warning until cleared. */
  apWarn(type: "soft" | "hard") {
    const P = this.F.P;
    if (type === "soft") {
      P["ECAM/warnings/ap-off-time"] = num(P, "sim/time/elapsed-sec");
      P["it-autoflight/output/ap-warning"] = 1;
      P[LIGHT[0]!] = 1;
    } else P["it-autoflight/output/ap-warning"] = 2;
    this.cues.push("cavalry");
  }

  /** The A/THR's disconnection (doAthrWarn): the master caution, "hard" — the CLR light on. */
  athrWarn(type: "soft" | "hard") {
    const P = this.F.P;
    if (type === "soft") {
      P["ECAM/warnings/athr-off-time"] = num(P, "sim/time/elapsed-sec");
      P["it-autoflight/output/athr-warning"] = 1;
    } else {
      P["ECAM/Lower/light/clr"] = 1;
      P["it-autoflight/output/athr-warning"] = 2;
    }
    P[LIGHT[1]!] = 1;
  }

  // ---- ECAM-controller.nas
  private ctlReset() {
    const F = this.F;
    for (const v of [F.warnings, F.configmemos, F.leftmemos, F.specialLines, F.secondaryFailures, F.memos]) for (const m of v) m.active = 0;
  }

  private loop(P: Props) {
    const F = this.F;
    const acconfig = !!num(P, "systems/acconfig/autoconfig-running");
    if ((num(P, "systems/electrical/bus/ac-ess") >= 110 || num(P, "systems/electrical/bus/ac-2") >= 110) && !acconfig) {
      for (const f of LOGIC) f(F);
      hydraulicLoPr(F);
    } else {
      for (const w of F.warnings) w.active = 0;
      P[LIGHT[0]!] = 0;
    }
    const L: EcamLine[] = [];
    const R: EcamLine[] = [];
    let counter = 0;
    if (!acconfig) {
      for (const w of F.warnings) {
        if (w.active === 1) {
          if (counter < 9) {
            this.write(w, L);
            counter++;
            if (w.sdPage && w.sdPage !== "nil" && !w.hasCalled) {
              this.sd.failure(P, w.sdPage);
              w.hasCalled = 1;
            }
          }
          this.warnlight(w, P);
          this.sound(w, P);
        } else if (w.wasActive === 1) {
          this.warnlight(w, P);
          this.sound(w, P);
        }
      }
    }
    // (the left memos — T.O, LDG, then the others — only with no warning)
    if (!L.length) for (const c of [...F.configmemos, ...F.leftmemos]) this.write(c, L);
    for (const m of [...F.specialLines, ...F.secondaryFailures, ...F.memos]) if (m.active === 1 && R.length < 8) R.push(line(m));
    this.L = L;
    this.Rt = R;
  }

  /** warning.write: on the first empty line of eight (a message with no text — the stall's — takes none) */
  private write(w: Msg, L: EcamLine[]) {
    if (w.active !== 1) return;
    w.wasActive = 1;
    this.overflowL = L.length >= 8;
    if (L.length < 8 && w.msg !== "") L.push(line(w));
  }

  /** warning.warnlight: the master light on once (until its warning is gone or the crew presses it) */
  private warnlight(w: Msg, P: Props) {
    const l = w.light ?? 9;
    if (l > 1) return;
    if (w.active === 0 && w.wasActive === 1) {
      P[LIGHT[l]!] = 0;
      w.wasActive = 0;
    }
    if (w.noRepeat === 1 || w.active === 0) return;
    P[LIGHT[l]!] = 1;
    w.noRepeat = 1;
  }

  /** warning.sound: the aural once (a chime restarted 0.15 s after; the CRC on) */
  private sound(w: Msg, P: Props) {
    const a = w.aural ?? 9;
    if (a === 9) return;
    const k = AURAL[a]!;
    if (w.active === 0 && w.wasActive === 1) {
      P[k] = 0;
      w.wasActive = 0;
    }
    if (w.noRepeat2 === 1 || w.active === 0) return;
    if (a !== 0) {
      P[k] = 0;
      this.F.after(0.15, () => {
        P[k] = 1;
      });
    } else P[k] = 1;
    w.noRepeat2 = 1;
  }

  /** clear(): the first main warning shown cleared (with its procedure's lines), else the overflow's lines; nothing
   *  left: the STATUS page, then back to the automatic page */
  private clear() {
    const F = this.F,
      P = F.P;
    let hasCleared = false,
      count = 0,
      mains = 0;
    let first: Msg | null = null;
    for (const w of F.warnings) {
      if (count >= 8) break;
      if (w.active === 1 && w.clearFlag !== 1 && w.isMemo !== 1) {
        count++;
        if (w.isMainMsg === 1) {
          if (mains === 0) first = w;
          mains++;
        }
      }
    }
    if (this.overflowL && mains === 1) {
      count = 0;
      for (const w of F.warnings) {
        if (count >= 8) break;
        if (w.active === 1 && w.clearFlag !== 1 && w.isMemo !== 1) {
          count++;
          if (w.isMainMsg === 1) continue;
          w.clearFlag = 1;
          hasCleared = this.statusFlag = true;
        }
      }
    } else if (first && first.active === 1 && first.clearFlag !== 1 && first.isMainMsg === 1 && first.isMemo !== 1) {
      first.clearFlag = 1;
      hasCleared = this.statusFlag = true;
    }
    if (!hasCleared && this.statusFlag) {
      this.statusFlag = false;
      this.sd.man(P, "statusPage");
      return;
    }
    if (!hasCleared) this.sd.man(P, "CLR");
  }

  /** recall(): the cleared warnings back; none at all — "NORMAL" a moment */
  private recall() {
    const F = this.F,
      P = F.P;
    let none = true;
    this.recallCounter = 0;
    for (const w of F.warnings) {
      if (w.clearFlag === 1) {
        w.noRepeat = 0;
        w.clearFlag = 0;
        this.recallCounter++;
      }
      if (w.active === 1) none = false;
    }
    if (this.recallCounter === 0 && none) {
      P["ECAM/buttons/recall-status-normal"] = 1;
      F.after(0.1, () => {
        P["ECAM/buttons/recall-status-normal"] = 0;
      });
    }
  }

  // ---- what is shown
  left(): EcamLine[] {
    return this.L;
  }
  right(): EcamLine[] {
    return this.Rt;
  }

  /** The STATUS page: the limitations and procedures of the failures now, the systems inoperative; "NORMAL" with
   *  none; the STS reminder on the E/WD while there is some and the page is not shown. */
  status(): { left: EcamLine[]; right: EcamLine[]; sts: boolean } {
    const P = this.F.P;
    const left: EcamLine[] = [],
      right: EcamLine[] = [];
    for (const c of STATUS) {
      if (!c.on(P)) continue;
      for (const [text, colour] of c.left ?? []) if (!left.some((l) => l.text === text)) left.push({ text, colour });
      for (const text of c.inop ?? []) if (!right.some((l) => l.text === text)) right.push({ text, colour: "a" });
    }
    const some = left.length + right.length > 0;
    if (!some) left.push({ text: "NORMAL", colour: "g" });
    return { left, right, sts: some && this.sd.page !== "statusPage" };
  }

  get masterWarning(): boolean {
    return num(this.F.P, LIGHT[0]!) !== 0;
  }
  get masterCaution(): boolean {
    return num(this.F.P, LIGHT[1]!) !== 0;
  }
  /** the SD's page as the ECAM wants it (FlightGear's page name), null: automatic */
  get sdPage(): string | null {
    return this.sd.mode === 3 ? null : this.sd.page;
  }

  /** the aural cues started since the last call */
  takeAurals(): Aural[] {
    const c = this.cues;
    this.cues = [];
    return c;
  }

  /** The control panel's and the glareshield's buttons (ECAM-main.nas ECAMControlPanel; the deck's bindings). */
  button(b: "clr" | "rcl" | "sts" | "emerCanc" | "toConfig" | "masterWarn" | "masterCaut" | "all") {
    const P = this.F.P;
    switch (b) {
      case "clr":
        P["ECAM/Lower/light/clr"] = 0;
        if (num(P, "it-autoflight/output/ap-warning") === 2) P["it-autoflight/output/ap-warning"] = 0;
        else if (num(P, "it-autoflight/output/athr-warning") === 2) P["it-autoflight/output/athr-warning"] = 0;
        else this.clear();
        break;
      case "rcl":
        this.recall();
        P["ECAM/buttons/recall-btn"] = 1;
        this.F.after(0.2, () => {
          P["ECAM/buttons/recall-btn"] = 0;
        });
        break;
      case "sts":
        this.sd.man(P, "statusPage");
        break;
      case "masterWarn":
        if (num(P, "systems/electrical/bus/dc-ess") >= 25) P[LIGHT[0]!] = P["sim/sound/warnings/crc"] = 0;
        break;
      case "masterCaut":
        if (num(P, "systems/electrical/bus/dc-ess") >= 25) P[LIGHT[1]!] = P["sim/sound/warnings/chime"] = 0;
        break;
      case "toConfig":
        // (the T.O CONFIG button held a moment: its test — the logic's ECAM/to-config-test)
        P["ECAM/to-config-test"] = 1;
        this.F.after(0.5, () => {
          P["ECAM/to-config-test"] = 0;
        });
        break;
      case "emerCanc":
        // (FlightGear's "todo": here, as the aircraft's, the aural silenced and the master caution off)
        for (const k of AURAL) P[k] = 0;
        P[LIGHT[1]!] = 0;
        break;
      case "all":
        // (FlightGear's "todo": the pages one after the other — the next page)
        this.sd.man(P, nextPage(this.sd.page));
        break;
    }
  }
}

const ORDER = [
  "enginePage",
  "bleedPage",
  "cabPressPage",
  "elecPage",
  "hydraulicPage",
  "fuelPage",
  "apuPage",
  "condPage",
  "doorPage",
  "wheelPage",
  "fctlPage",
  "cruisePage",
];
const nextPage = (p: string) => ORDER[(ORDER.indexOf(p) + 1) % ORDER.length]!;

/** The deck's Nasal calls for the ECAM (its control panel's bindings: ecam.ECAMControlPanel.sysPageBtn("apuPage"),
 *  clrBtn(), rclBtn(), stsBtn(nil), ecam.FWC.Btn.clr.setValue(1)…; ecam.shutUpYou()): true if answered. */
export function ecamCall(E: Ecam, fn: string, args: (number | string)[], P: Props): boolean {
  E.F.P = P;
  switch (fn) {
    case "ecam.ECAMControlPanel.sysPageBtn": {
      const page = String(args[0] ?? "");
      if (page === "REL") P["ECAM/du-xfr"] = 0;
      else E.sd.man(P, page);
      return true;
    }
    case "ecam.ECAMControlPanel.clrBtn":
      E.button("clr");
      return true;
    case "ecam.ECAMControlPanel.rclBtn":
      E.button("rcl");
      return true;
    case "ecam.ECAMControlPanel.stsBtn":
      if (String(args[0] ?? "") !== "REL") E.button("sts");
      return true;
    case "ecam.ECAMControlPanel.allBtn":
      E.button("all");
      return true;
    case "ecam.ECAMControlPanel.toConfigBtn":
      E.button("toConfig");
      return true;
    case "ecam.ECAMControlPanel.emerCancBtn":
      E.button("emerCanc");
      return true;
    case "ecam.shutUpYou":
      P[LIGHT[0]!] = 0;
      return true;
    case "ecam.FWC.Btn.clr.setValue":
      P["ECAM/buttons/clear-btn"] = Number(args[0]) || 0;
      return true;
    case "ecam.FWC.Btn.recall.setValue":
      P["ECAM/buttons/recall-btn"] = Number(args[0]) || 0;
      return true;
  }
  return false;
}
