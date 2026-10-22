// The A320's engine and warning display, the upper ECAM (docs/PLAN-A320.md, A7): FlightGear's CFM56 E/WD
// (Models/Instruments/Upper-ECAM/res/cfm-eis2.svg) driven as Upper-ECAM.nas drives it — the N1 gauges (the needle, the
// thrust lever's N1 — the blue circle —, the TOGA limit's amber mark, the reversers' REV), the EGT gauges, N2, the fuel
// flow, the fuel on board, the thrust limit's mode and N1 (the FLEX temperature), the slats' and flaps' indicator with
// its configuration (Systems/upper-ecam.xml's tables), the IDLE indication, A FLOOR — and the memo area: a simple
// FWC's take-off and landing memos and its right-hand memos (the parking brake, the speed brakes, the autobrake, the
// ground spoilers, the seat belts) — the full warnings come with A11. Kilograms, as the CFM's option.

import ewdSvg from "../../../assets/a320/du/ewd-cfm.svg";
import type { DuData } from "./data";
import { type Ctx, Display, fontOf } from "./display";
import { colour, css, D2R, EcamSvg, type EcColour, roundTo, table, txt, vis } from "./ecam-common";

/** the N1 gauge's angle by N1 [%] (Systems/a320-cfm56-5b4-engine-fadec.xml "Upper ECAM Needles") — the needle
 *  turned (angle + 90)° */
const N1_DEG = [
  [20, -131],
  [50, -64],
  [100, 48],
  [110, 65],
] as const;
/** the EGT gauge's, by EGT [°C] */
const EGT_DEG = [
  [0, -90],
  [500, 0],
  [1000, 90],
] as const;
/** the slats' and flaps' indicator moved by their angles (Systems/upper-ecam.xml, the 35° flaps) */
const FLAP_X = [
  [0, -192],
  [10, -135],
  [15, -89],
  [20, -43],
  [35, 0],
] as const;
const FLAP_Y = [
  [0, -47],
  [10, -33],
  [15, -21],
  [20, -10],
  [35, 0],
] as const;
const FLAP_XT = [
  [0, -200],
  [10, -135],
  [15, -95],
  [20, -48.5],
  [35, 0],
] as const;
const FLAP_YT = [
  [0, -49],
  [10, -33],
  [15, -23],
  [20, -11.25],
  [35, 0],
] as const;
const SLAT_X = [
  [0, 131],
  [18, 92],
  [22, 46],
  [27, 0],
] as const;
const SLAT_Y = [
  [0, -42],
  [18, -28],
  [22, -14],
  [27, 0],
] as const;
const SLAT_XT = [
  [0, 135],
  [18, 95],
  [22, 50],
  [27, 0],
] as const;
const SLAT_YT = [
  [0, -43],
  [18, -29],
  [22, -15],
  [27, 0],
] as const;

/** a memo line: its text and colour */
type Line = [string, EcColour];
const EC_OF: Record<string, EcColour> = { r: "red", a: "amber", g: "green", c: "cyan", w: "white", m: "magenta" };
/** an ECAM line (src/a320/ecam) as the E/WD draws it */
const ecLine = (l: { text: string; colour: string }): Line => [l.text, EC_OF[l.colour] ?? (l.colour as EcColour)];

export class Ewd extends Display {
  private svg = new EcamSvg(ewdSvg);
  private inited = false;
  /** when both engines last ran — the T.O memo two minutes after the second start */
  private enginesSince: number | null = null;

  constructor() {
    super(0, null);
    this.hz = 10;
  }

  override ready(): boolean {
    return !!this.svg.get();
  }

  private setup() {
    const doc = this.svg.doc!;
    // (FlightGear's start: the weights in kilograms, the IAE's and the test's parts away)
    txt(doc, "FOB-weight-unit", "KG");
    txt(doc, "FFlow-weight-unit", "KG/H");
    vis(doc, false, "SlatAlphaLock", "aFloor", "idleIndication");
    for (const k of [1, 2]) vis(doc, false, `N1${k}-XX`, `N1${k}-XX2`, `N1${k}-XX-box`, `EGT${k}-XX`, `N2${k}-XX`, `FF${k}-XX`);
    vis(doc, false, "N1Lim-XX", "N1Lim-XX2");
    this.inited = true;
  }

  draw(ctx: Ctx, d: DuData, t: number) {
    const doc = this.svg.doc;
    if (!doc) return;
    if (!this.inited) this.setup();
    // ---- the engines
    d.eng.forEach((e, i) => {
      const k = i + 1;
      // (FADEC powered: the figures, else amber XX — the scales amber)
      const on = e.running || e.n2 > 5;
      const n1 = Math.max(e.n1, 0);
      vis(
        doc,
        on,
        `N1${k}`,
        `N1${k}-decimal`,
        `N1${k}-decpnt`,
        `N1${k}-needle`,
        `N1${k}-scaletick`,
        `N1${k}-scalenum`,
        `N1${k}-ylim`,
        `N1${k}-box`,
      );
      vis(doc, !on, `N1${k}-XX`, `N1${k}-XX2`, `N1${k}-XX-box`);
      doc.get(`N1${k}-scale`).setColor(css(on ? "white" : "amber"));
      doc.get(`N1${k}-scale2`).setColor(css(on ? "red" : "amber"));
      txt(doc, `N1${k}`, Math.floor(n1 + 0.05));
      txt(doc, `N1${k}-decimal`, Math.floor(10 * ((n1 + 0.05) % 1)));
      doc.get(`N1${k}-needle`).setRotation((table(n1, N1_DEG) + 90) * D2R);
      doc.get(`N1${k}-ylim`).setRotation((table(d.togaN1 > 0 ? d.togaN1 : 95, N1_DEG) + 90) * D2R);
      // (the thrust lever's N1: the blue circle — hidden with the reversers out, REV shown)
      const rev = e.rev >= 0.01;
      vis(doc, on && !rev, `N1${k}-thr`);
      doc.get(`N1${k}-thr`).setRotation((table(Math.max(d.leverN1, 20), N1_DEG) + 90) * D2R);
      vis(doc, on && rev, `REV${k}`, `REV${k}-box`);
      colour(doc, `REV${k}`, e.rev >= 0.95 ? "green" : "amber");
      // (EGT, N2, the fuel flow [kg/h, by 10])
      vis(doc, on, `EGT${k}`, `EGT${k}-needle`, `EGT${k}-scaletick`, `EGT${k}-box`);
      vis(doc, !on, `EGT${k}-XX`);
      doc.get(`EGT${k}-scale`).setColor(css(on ? "white" : "amber"));
      doc.get(`EGT${k}-scale2`).setColor(css(on ? "red" : "amber"));
      txt(doc, `EGT${k}`, Math.round(e.egt));
      doc.get(`EGT${k}-needle`).setRotation((table(e.egt, EGT_DEG) + 90) * D2R);
      const n2 = Math.max(e.n2, 0);
      vis(doc, on, `N2${k}`, `N2${k}-decimal`, `N2${k}-decpnt`);
      vis(doc, !on, `N2${k}-XX`);
      txt(doc, `N2${k}`, Math.floor(n2 + 0.05));
      txt(doc, `N2${k}-decimal`, Math.floor(10 * ((n2 + 0.05) % 1)));
      vis(doc, on, `FF${k}`);
      vis(doc, !on, `FF${k}-XX`);
      txt(doc, `FF${k}`, roundTo(e.ff, 10));
    });
    // ---- the fuel on board, the thrust limit
    txt(doc, "FOB-LBS", roundTo(d.fob, 10));
    const lim = d.thrLimit;
    const powered = d.eng.some((e) => e.running || e.n2 > 5);
    vis(doc, powered && !!lim.mode, "N1Lim", "N1Lim-decimal", "N1Lim-decpnt", "N1Lim-percent", "N1Lim-mode");
    vis(doc, !powered || !lim.mode, "N1Lim-XX", "N1Lim-XX2");
    txt(doc, "N1Lim-mode", lim.mode);
    txt(doc, "N1Lim", Math.floor(lim.n1 + 0.05));
    txt(doc, "N1Lim-decimal", Math.floor(10 * ((lim.n1 + 0.05) % 1)));
    const flx = powered && lim.mode === "FLX" && d.flexTemp !== null;
    vis(doc, flx, "FlxLimDegreesC", "FlxLimTemp");
    if (flx) txt(doc, "FlxLimTemp", Math.round(d.flexTemp!));
    // ---- the slats and flaps: their indicator, their configuration's name
    doc.get("FlapIndicator").setTranslation(table(d.flap, FLAP_X), table(d.flap, FLAP_Y));
    doc.get("FlapLine").setTranslation(table(d.flap, FLAP_XT), table(d.flap, FLAP_YT));
    doc.get("SlatIndicator").setTranslation(table(d.slat, SLAT_X), table(d.slat, SLAT_Y));
    doc.get("SlatLine").setTranslation(table(d.slat, SLAT_XT), table(d.slat, SLAT_YT));
    txt(doc, "FlapTxt", d.confName === "0" ? " " : d.confName);
    vis(doc, d.confName !== "0" || d.slat > 0.5 || d.flap > 0.5, "FlapDots");
    // ---- A FLOOR; IDLE (both engines at idle, in the air)
    vis(doc, d.alphaFloor, "aFloor");
    const idle = !d.onGround && d.eng.every((e) => e.running && e.n1 < 32) && d.leverN1 <= (d.thrLimit.n1 ? 30 : 0);
    vis(doc, idle, "idleIndication");
    // ---- the memos
    const now = t;
    if (d.eng.every((e) => e.running)) this.enginesSince ??= now;
    else this.enginesSince = null;
    // (the ECAM's — src/a320/ecam: FlightGear's FWC, its warnings, procedures and memos —, else the simple one here)
    const [left, right] = d.ecam ? [d.ecam.left.map(ecLine), d.ecam.right.map(ecLine)] : this.memos(d, now);
    // (STATUS has lines: its reminder, the right column's last)
    if (d.ecam?.sts && !right.some((l) => l[0] === "STS")) right.splice(7, 0, ["STS", "white"]);
    for (let i = 0; i < 8; i++) {
      const L = left[i],
        R = right[i];
      txt(doc, `ECAML${i + 1}`, L ? L[0] : "", L?.[1] ?? "white");
      txt(doc, `ECAMR${i + 1}`, R ? R[0] : "", R?.[1] ?? "green");
    }
    doc.draw(ctx, 1024, 1024, fontOf);
  }

  /** A simple FWC's memos (A11 brings the warnings): the T.O memo on the ground two minutes after the second engine's
   *  start until the take-off power; the LDG memo below 2000 ft with the gear down (or in CONF 3 / FULL); the right
   *  side's memos. Each item green once done, cyan to do. */
  private memos(d: DuData, now: number): [Line[], Line[]] {
    const L: Line[] = [];
    const R: Line[] = [];
    const deck = d.deck;
    const belts = Number(deck["controls/switches/seatbelt-sign"] ?? 0) > 0.25;
    const armed = Number(deck["controls/flight/speedbrake-arm"] ?? 0) > 0.5;
    const takeoffPower = d.eng.some((e) => e.n1 > 70);
    const item = (done: boolean, label: string, todo: string, ok = todo): Line => [
      done ? `${label} ${ok}` : `${label}${".".repeat(Math.max(2, 13 - label.length))}${todo}`,
      done ? "green" : "cyan",
    ];
    if (d.onGround && this.enginesSince !== null && now - this.enginesSince > 120 && !takeoffPower) {
      L.push(["T.O", "white"]);
      L.push(item(d.autobrake === 3, "AUTO BRK", "MAX"));
      L.push(item(belts, "SIGNS", "ON"));
      L.push(["CABIN..........CHECK", "cyan"]);
      L.push(item(armed, "SPLRS", "ARM"));
      L.push(item(d.flapLever >= 1 && d.flapLever <= 3, "FLAPS", "T.O"));
      L.push(["T.O CONFIG.....TEST", "cyan"]);
    } else if (!d.onGround && (d.ra ?? 99999) < 2000 && (d.gear.down || d.flapLever >= 3)) {
      L.push(["LDG", "white"]);
      L.push(item(d.gear.down && d.gear.ext > 0.99, "LDG GEAR", "DN"));
      L.push(item(belts, "SIGNS", "ON"));
      L.push(["CABIN..........CHECK", "cyan"]);
      L.push(item(armed, "SPLRS", "ARM"));
      L.push(item(d.flapLever === 4, "FLAPS", "FULL"));
    }
    if (d.parkBrake) R.push(["PARK BRK", "green"]);
    if (d.speedBrake > 0.05) R.push(["SPEED BRK", d.eng.some((e) => e.n1 > 50) ? "amber" : "green"]);
    if (d.autobrake) R.push([`AUTO BRK ${["", "LO", "MED", "MAX"][d.autobrake]}`, "green"]);
    if (armed && !L.length) R.push(["GND SPLRS ARMED", "green"]);
    if (belts) R.push(["SEAT BELTS", "green"]);
    if (d.law !== "normal") R.push([d.law === "direct" ? "DIRECT LAW" : "ALTN LAW", "amber"]);
    return [L, R];
  }
}
