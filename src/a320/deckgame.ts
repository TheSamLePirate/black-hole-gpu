// The A320's flight deck tied to the game (docs/PLAN-A320.md, A6): what its controls' FlightGear bindings do here —
// the Nasal calls the game answers (the gear lever, the flap lever, the speed brake lever, the thrust levers, the
// reversers, the autobrake's buttons, the SD's page buttons, the EFIS's ND mode and range knobs and its layers), the
// properties it follows (the lights' switches, the parking brake, the ground spoilers' arming, the panels' lighting),
// and the game's state written back on the switches each frame (a key that turns the strobes on flips their switch).
// The others move on the deck alone, their systems to come (A8–A11: the tooltip says so).

import type { Settings } from "../settings";
import { t, tf } from "../i18n";
import type { A320Fcs } from "./fcs";
import type { DeckBinding, DeckControl } from "./deck";
import { nasalCalls, type NasalCall } from "./deckctl";
import type { Props } from "./rig";
import type { Fmgc, FmgcIn } from "./fmgc/fmgc";
import type { McduApi } from "./mcdu/types";

/** The game the deck works on (main.ts: the camera, the settings, the actions the keys share). */
export interface DeckGame {
  settings: Pick<Settings, "navLights" | "strobeLights" | "landingLights" | "cabinLight">;
  craft: {
    gearDown: boolean;
    pilot: { throttle: number };
    airBrake: number;
    groundSpoilers: boolean;
    a320Reverse: number;
    a320Park: boolean;
    a320: A320Fcs | null;
    onWheels(): boolean;
  };
  setGear(down: boolean): void;
  /** the flight guidance (controller/a320ap.ts): its FCU, and the figures it read last */
  fmgc(): { F: Fmgc; i: FmgcIn | null } | null;
  /** a MCDU (0 the captain's, 1 the first officer's — src/a320/mcdu) */
  mcdu(side: number): McduApi | null;
  /** the flap lever a notch (+1: more flaps) */
  flaps(step: number): void;
  toast(m: string): void;
  /** settings changed by a switch (their menus refreshed, the URL saved) */
  changed(keys: (keyof Settings)[]): void;
}

const ND_MODES = ["ILS", "VOR", "NAV", "ARC", "PLAN"] as const;
/** the SD's pages by FlightGear's names (ecam.ECAMControlPanel.sysPageBtn) */
const SD_PAGES = new Set([
  "enginePage",
  "apuPage",
  "bleedPage",
  "condPage",
  "pressPage",
  "doorPage",
  "elecPage",
  "wheelPage",
  "hydPage",
  "fctlPage",
  "fuelPage",
]);

/** the Nasal functions the game answers */
const CALLS = new Set([
  "controls.gearDownSmart",
  "controls.flapsDown",
  "core.deploySpeedbrake",
  "core.retractSpeedbrake",
  "systems.doRevThrust",
  "systems.unRevThrust",
  "systems.Autobrake.arm_autobrake",
  "ecam.ECAMControlPanel.sysPageBtn",
  "ecam.ECAMControlPanel.stsBtn",
  "fcu.setCptND",
  "fcu.setFoND",
  "fcu.setNDRange",
  "fcu.cpt_efis_btns",
  "fcu.fo_efis_btns",
  "core.lTray",
  "core.rTray",
  "core.lFootrest",
  "core.rFootrest",
  "core.triggerDoor",
  "fcu.FCUController.MetricAlt",
  "core.toggleSTD",
  "core.toggleSTDIESI",
]);
/** the FCU's (FlightGear's FCU.nas): its knobs pushed, pulled, turned; its buttons */
const FCU =
  /^fcu\.FCUController\.(SPD|HDG|ALT|VS)(Push|Pull|Adjust)$|^fcu\.FCUController\.(AP1|AP2|ATHR|ATDisc|FD1|FD2|IASMach|LOCButton|APPRButton|TRKFPA)$/;
/** the properties the game follows */
const FOLLOWED = new Set([
  "controls/engines/engine/throttle",
  "controls/engines/engine[1]/throttle",
  "controls/flight/speedbrake",
  "controls/flight/speedbrake-arm",
  "controls/gear/brake-parking",
  "controls/switches/landing-lights-l",
  "controls/switches/landing-lights-r",
  "controls/switches/strobe",
  "controls/switches/beacon",
  "controls/lighting/nav-lights-switch",
  "controls/lighting/main-panel-knb",
  "controls/switches/annun-test",
  "controls/lighting/taxi-light-switch",
  "controls/lighting/turnoff-light-switch",
  "controls/switches/wing-lights",
  "controls/switches/wiperLspd",
  "controls/switches/wiperRspd",
  "controls/cockpit/captain-visor",
  "controls/cockpit/fo-visor",
  "it-autoflight/config/altitude-dial-mode",
  "FMGC/keyboard-left",
  "FMGC/keyboard-right",
  "instrumentation/altimeter/inhg-left",
]);

/** A Nasal call done on the game: true if done. */
export function deckCall(g: DeckGame, P: Props, c: NasalCall): boolean {
  const C = g.craft;
  const a0 = c.args[0],
    a1 = c.args[1];
  // (the MCDUs' keys: FlightGear's mcdu.button("A", side), lskbutton("1", side), rskbutton, pagebutton("f-pln", side),
  // arrowbutton("up", side))
  if (/^mcdu\.(button|lskbutton|rskbutton|pagebutton|arrowbutton)$/.test(c.fn)) {
    const M = g.mcdu(Number(a1) || 0);
    const k = String(a0 ?? "");
    if (!M) return true;
    // (FlightGear's names for the "/" and "." keys)
    if (c.fn === "mcdu.button") M.button(k === "SLASH" ? "/" : k === "DOT" ? "." : k);
    else if (c.fn === "mcdu.lskbutton") M.lsk("L", Number(k));
    else if (c.fn === "mcdu.rskbutton") M.lsk("R", Number(k));
    else if (c.fn === "mcdu.pagebutton") M.page(k);
    else M.arrow(k as "left" | "right" | "up" | "down");
    return true;
  }
  // (the FCU)
  const fm = FCU.exec(c.fn);
  if (fm) {
    const G = g.fmgc();
    if (!G) return true;
    const { F, i } = G;
    const n = Number(a0) || 1;
    const fi = i ?? undefined;
    if (fm[1]) {
      const knob = fm[1] as "SPD" | "HDG" | "ALT" | "VS";
      const act = fm[2]!;
      const turn = { SPD: () => F.spdTurn(n), HDG: () => F.hdgTurn(n), ALT: () => F.altTurn(n), VS: () => F.vsTurn(n) };
      const push = { SPD: () => F.spdPush(), HDG: () => F.hdgPush(), ALT: () => F.altPush(fi), VS: () => F.vsPush(fi) };
      const pull = { SPD: () => F.spdPull(fi), HDG: () => F.hdgPull(fi), ALT: () => F.altPull(fi), VS: () => F.vsPull(fi) };
      (act === "Adjust" ? turn : act === "Push" ? push : pull)[knob]();
      return true;
    }
    switch (fm[3]) {
      case "AP1":
        F.ap1Toggle(fi);
        break;
      case "AP2":
        F.ap2Toggle(fi);
        break;
      case "ATHR":
        F.athrToggle();
        break;
      case "ATDisc":
        F.athrDisc();
        break;
      case "FD1":
        F.fd1 = !F.fd1;
        break;
      case "FD2":
        F.fd2 = !F.fd2;
        break;
      case "IASMach":
        F.spdMachToggle(fi);
        break;
      case "LOCButton":
        F.locToggle();
        break;
      case "APPRButton":
        F.apprToggle();
        break;
      case "TRKFPA":
        F.trkFpaToggle();
        break;
    }
    return true;
  }
  switch (c.fn) {
    case "core.toggleSTD":
    case "core.toggleSTDIESI":
      P["instrumentation/altimeter/std"] = Number(P["instrumentation/altimeter/std"] ?? 0) > 0.5 ? 0 : 1;
      return true;
    case "controls.gearDownSmart":
      // (pressed: 1 — the lever pulled and moved; let go: 0, nothing)
      if (a0 === 1) g.setGear(!C.gearDown);
      return true;
    case "controls.flapsDown":
      g.flaps(Number(a0) > 0 ? 1 : -1);
      return true;
    case "core.deploySpeedbrake":
    case "core.retractSpeedbrake": {
      // (the lever's halves: retracted, ½, full)
      const d = c.fn === "core.deploySpeedbrake" ? 0.5 : -0.5;
      C.airBrake = Math.min(Math.max(Math.round((C.airBrake + d) * 2) / 2, 0), 1);
      g.toast(C.airBrake ? tf("Speed brakes {0} %", Math.round(C.airBrake * 100)) : t("Speed brakes retracted"));
      return true;
    }
    case "systems.doRevThrust":
      if (!C.onWheels()) g.toast(t("Reversers: on the ground only"));
      else {
        C.pilot.throttle = 0;
        C.a320Reverse = 1;
        g.toast(t("Reverse thrust: full"));
      }
      return true;
    case "systems.unRevThrust":
      if (C.a320Reverse > 0) g.toast(t("Reversers stowed"));
      C.a320Reverse = 0;
      return true;
    case "systems.Autobrake.arm_autobrake": {
      const A = C.a320;
      if (!A) return true;
      const k = Number(a0);
      // (pressed again: disarmed; MAX — the rejected take-off's — armed on the ground only)
      A.autobrake = A.autobrake === k || (k === 3 && !C.onWheels()) ? 0 : k;
      g.toast(A.autobrake ? tf("Autobrake {0}", ["", "LO", "MED", "MAX"][A.autobrake]!) : t("Autobrake off"));
      return true;
    }
    case "ecam.ECAMControlPanel.sysPageBtn":
      // (the SD's page: pressed again, back to the automatic one — "REL" is the button let go)
      if (typeof a0 === "string" && SD_PAGES.has(a0)) P["ecam/sd-page"] = P["ecam/sd-page"] === a0 ? "" : a0;
      return true;
    case "ecam.ECAMControlPanel.stsBtn":
      P["ecam/sd-page"] = P["ecam/sd-page"] === "statusPage" ? "" : "statusPage";
      return true;
    case "fcu.setCptND":
    case "fcu.setFoND": {
      const e = c.fn === "fcu.setCptND" ? "instrumentation/efis" : "instrumentation/efis[1]";
      const i = Math.min(Math.max(ND_MODES.indexOf(String(P[`${e}/nd/display-mode`] ?? "ARC") as never) + Math.sign(Number(a0)), 0), 4);
      P[`${e}/nd/display-mode`] = ND_MODES[i]!;
      P[`${e}/mfd/pnl_mode-num`] = i;
      return true;
    }
    case "fcu.setNDRange": {
      const e = Number(a0) === 1 ? "instrumentation/efis[1]" : "instrumentation/efis";
      const r = Number(P[`${e}/inputs/range-nm`] ?? 40);
      P[`${e}/inputs/range-nm`] = Math.min(Math.max(Number(a1) > 0 ? r * 2 : r / 2, 10), 320);
      return true;
    }
    case "fcu.cpt_efis_btns":
    case "fcu.fo_efis_btns": {
      // (one layer at a time: pressed again, none)
      const e = c.fn === "fcu.cpt_efis_btns" ? "instrumentation/efis" : "instrumentation/efis[1]";
      P[`${e}/nd/layer`] = P[`${e}/nd/layer`] === a0 ? "" : String(a0);
      return true;
    }
    case "fcu.FCUController.MetricAlt":
      // (the PFDs' metric altitude: the button's state — du/pfd.ts)
      P["deck/metric-alt"] = Number(P["deck/metric-alt"] ?? 0) > 0.5 ? 0 : 1;
      return true;
    case "core.lTray":
    case "core.rTray": {
      const k = c.fn === "core.lTray" ? "controls/tray/lefttrayext" : "controls/tray/righttrayext";
      P[k] = Number(P[k] ?? 0) > 0.5 ? 0 : 1;
      return true;
    }
    case "core.lFootrest":
    case "core.rFootrest": {
      const k = c.fn === "core.lFootrest" ? "controls/footrest-cpt" : "controls/footrest-fo";
      P[k] = Number(P[k] ?? 0) > 0.5 ? 0 : 1;
      return true;
    }
    case "core.triggerDoor": {
      // (the sliding windows: core.windowLeft / windowRight)
      const side = String(c.args[0] ?? "");
      const k = `sim/model/door-positions/${/Right/.test(side) ? "windowRight" : "windowLeft"}/position-norm`;
      P[`${k}#target`] = Number(P[`${k}#target`] ?? 0) > 0.5 ? 0 : 1;
      return true;
    }
  }
  return false;
}

/** A property set by the deck: true if the game follows it. */
export function deckChanged(g: DeckGame, P: Props, prop: string, v: number | string): boolean {
  const C = g.craft,
    S = g.settings;
  const n = Number(v);
  const set = <K extends keyof DeckGame["settings"]>(k: K, x: DeckGame["settings"][K]) => {
    if (S[k] === x) return;
    S[k] = x;
    g.changed([k]);
  };
  switch (prop) {
    case "controls/engines/engine/throttle":
    case "controls/engines/engine[1]/throttle":
      C.pilot.throttle = Math.min(Math.max(n, 0), 1);
      return true;
    case "controls/flight/speedbrake":
      C.airBrake = Math.min(Math.max(n, 0), 1);
      return true;
    case "controls/flight/speedbrake-arm":
      C.groundSpoilers = n > 0.5;
      g.toast(C.groundSpoilers ? t("Ground spoilers armed") : t("Ground spoilers disarmed"));
      return true;
    case "controls/gear/brake-parking":
      C.a320Park = n > 0.5;
      g.toast(C.a320Park ? t("Parking brake set") : t("Parking brake released"));
      return true;
    case "controls/switches/landing-lights-l":
    case "controls/switches/landing-lights-r":
      // (RETRACT 0, OFF ½, ON 1: lit when either is ON)
      set(
        "landingLights",
        Number(P["controls/switches/landing-lights-l"] ?? 0) > 0.9 || Number(P["controls/switches/landing-lights-r"] ?? 0) > 0.9,
      );
      return true;
    case "controls/switches/strobe":
      // (OFF, AUTO, ON: AUTO lit — the game's strobes have no air/ground switch)
      set("strobeLights", n > 0.25);
      return true;
    case "controls/switches/beacon":
    case "controls/lighting/nav-lights-switch":
      set("navLights", Number(P["controls/switches/beacon"] ?? 0) > 0.5 || Number(P["controls/lighting/nav-lights-switch"] ?? 0) > 0.5);
      return true;
    case "controls/lighting/main-panel-knb":
      // (the panels' integral lighting: the cabin's level — ship.wgsl S.cab)
      set("cabinLight", Math.min(Math.max(n, 0), 1));
      return true;
    case "FMGC/keyboard-left":
    case "FMGC/keyboard-right":
      if (n > 0.5) g.toast(t("MCDU: keyboard mode — type into it, Escape to leave"));
      return true;
    case "it-autoflight/config/altitude-dial-mode": {
      // (the FCU's altitude knob's step: 100 or 1000 ft)
      const G = g.fmgc();
      if (G) G.F.altStep = n > 0.5 ? 1000 : 100;
      return true;
    }
    case "controls/cockpit/captain-visor":
    case "controls/cockpit/fo-visor":
      return true;
  }
  return FOLLOWED.has(prop);
}

/** The game's state on the deck's switches (each frame, before the poser): a key that changed it moves them. */
export function deckSync(g: DeckGame, P: Props) {
  const S = g.settings,
    C = g.craft;
  const L = Number(P["controls/switches/landing-lights-l"] ?? 0),
    R = Number(P["controls/switches/landing-lights-r"] ?? 0);
  if (S.landingLights && L < 0.9 && R < 0.9) P["controls/switches/landing-lights-l"] = P["controls/switches/landing-lights-r"] = 1;
  if (!S.landingLights && (L > 0.9 || R > 0.9)) P["controls/switches/landing-lights-l"] = P["controls/switches/landing-lights-r"] = 0.5;
  const st = Number(P["controls/switches/strobe"] ?? 0);
  if (S.strobeLights !== st > 0.25) P["controls/switches/strobe"] = S.strobeLights ? 1 : 0;
  const nav = Number(P["controls/lighting/nav-lights-switch"] ?? 0) > 0.5 || Number(P["controls/switches/beacon"] ?? 0) > 0.5;
  if (S.navLights !== nav) P["controls/lighting/nav-lights-switch"] = P["controls/switches/beacon"] = S.navLights ? 1 : 0;
  if (Math.abs(Number(P["controls/lighting/main-panel-knb"] ?? -1) - S.cabinLight) > 1e-3)
    P["controls/lighting/main-panel-knb"] = S.cabinLight;
  // (the FCU's windows, its lights: the flight guidance's state — fmgc.ts deckProps)
  const G = g.fmgc();
  if (G) Object.assign(P, G.F.deckProps(G.i));
  P["instrumentation/altimeter/setting-hpa"] ??= 1013;
  P["instrumentation/altimeter/setting-inhg"] ??= 29.92;
  // (the sliding windows: eased to where they were sent)
  for (const side of ["windowLeft", "windowRight"]) {
    const k = `sim/model/door-positions/${side}/position-norm`;
    const want = Number(P[`${k}#target`] ?? 0);
    const now = Number(P[k] ?? 0);
    P[k] = now + Math.min(Math.max(want - now, -0.02), 0.02);
  }
  void C;
}

/** The exterior's lights as the deck's switches set them (pose.ts / ship.ts: the taxi and turn-off lights, the
 *  wing's; the landing lights extended, the wipers running). */
export function deckExterior(P: Props) {
  return {
    taxi: Number(P["controls/lighting/taxi-light-switch"] ?? 1) > 0.25,
    turnoff: Number(P["controls/lighting/turnoff-light-switch"] ?? 1) > 0.5,
    wing: Number(P["controls/switches/wing-lights"] ?? 1) > 0.5,
    landingOut: Number(P["controls/switches/landing-lights-l"] ?? 0) > 0.25 || Number(P["controls/switches/landing-lights-r"] ?? 0) > 0.25,
    wipers: Number(P["controls/switches/wiperLspd"] ?? 0) > 0.5 || Number(P["controls/switches/wiperRspd"] ?? 0) > 0.5,
  };
}

/** Whether the game answers a control (one of its bindings: a call it does, a property it follows). */
export function deckWired(c: DeckControl): boolean {
  const all: DeckBinding[] = c.actions.flatMap((a) => [...a.bindings, ...(a.up ?? [])]);
  return all.some((b) =>
    b.command === "nasal"
      ? nasalCalls(b.script ?? "").some(
          (x) => CALLS.has(x.fn) || FCU.test(x.fn) || x.fn.startsWith("mcdu.") || (x.fn === "setprop" && FOLLOWED.has(String(x.args[0]))),
        )
      : !!b.property && FOLLOWED.has(b.property.replace(/^\//, "").replace(/\[0\]/g, "")),
  );
}

/** a control's name for the tooltip: FlightGear's label (in French: src/i18n/fr-a320-deck.ts), else from its object —
 *  the MCDUs' keys, the fire tests and agents, the IDGs… */
export function deckName(c: DeckControl): string {
  if (c.label) return t(c.label).replace("%s", "");
  const o = c.objects[0] ?? "";
  const m = /^(.{1,12})\.(cpt|fo)$/.exec(o);
  if (m) {
    const side = m[2] === "cpt" ? 1 : 2;
    const k = m[1]!;
    const key = /^[LR][1-6]$/.test(k) ? tf("line key {0}", k) : k === "sp" ? t("space") : k.toUpperCase();
    return tf("MCDU {0}: {1}", side, key);
  }
  const named: Record<string, string> = {
    torch_cpt: "Flashlight",
    WindowOpenerCpt: "Captain's sliding window",
    WindowOpenerFo: "First officer's sliding window",
    tiller: "Nose wheel tiller",
    clock_set: "Clock setting",
    dcduScreenL: "DCDU",
    ecam_att_hdg: "ATT HDG switching",
    CVRErase: "Voice recorder: erase",
    CVRTest: "Voice recorder: test",
    Eng1FireTst: "Engine 1 fire test",
    Eng2FireTst: "Engine 2 fire test",
    APUFireTst: "APU fire test",
    Eng1FireAgt1Btn1S: "Engine 1 fire agent 1",
    Eng1FireAgt2Btn1S: "Engine 1 fire agent 2",
    APUFireAgtBtn1S: "APU fire agent",
    Eng2FireAgt1Btn1S: "Engine 2 fire agent 1",
    Eng2FireAgt2Btn1S: "Engine 2 fire agent 2",
    IDG1Prot: "IDG 1 guard",
    IDG1Btn: "IDG 1 disconnect",
    IDG2Prot: "IDG 2 guard",
    IDG2Btn: "IDG 2 disconnect",
    CargoHotAirBtn2O: "Cargo hot air",
    CargoHotAirBtn1F: "Cargo hot air",
    "mcdu1.screen": "MCDU 1",
    "mcdu2.screen": "MCDU 2",
  };
  return named[o] ? t(named[o]) : o;
}

/** The tooltip: the control's name, whether the game answers it yet. */
export function deckTip(c: DeckControl, wired: boolean): { name: string; state: string; key: string | null } {
  return { name: deckName(c), state: wired ? "" : t("Not wired yet: its system comes later"), key: null };
}
