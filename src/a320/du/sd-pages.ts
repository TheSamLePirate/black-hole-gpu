// The A320's SD's pages (docs/PLAN-A320.md, A7, A11 — sd.ts): each FlightGear page's SVG set at its start (its
// abnormal elements hidden: XX, faults, clogs, the transit parts) and driven each refresh as Lower-ECAM-*.nas drives
// it — its elements, their conditions, their colours — from the systems' bag (`d.deck`: the properties FlightGear's
// systems write, src/a320/systems — the buses, the sources and contactors, the hydraulics and their pumps, the bleed
// and the packs, the APU, the fuel's pumps and valves, the cabin's pressure, the oxygen, the brakes' modes) and from
// what the game flies (the engines, the tanks, the gear, the autobrake, the spoilers, the surfaces). What no system
// computes in the game — the engines' oil, the vibrations, the IDGs' temperatures, the brakes' heat, the gear doors —
// keeps A7's models; a property the bag lacks (no systems run: a capture, a test) its nominal figure.

import apuSvg from "../../../assets/a320/du/sd-apu.svg";
import bleedSvg from "../../../assets/a320/du/sd-bleed.svg";
import condSvg from "../../../assets/a320/du/sd-cond.svg";
import crzSvg from "../../../assets/a320/du/sd-crz.svg";
import doorSvg from "../../../assets/a320/du/sd-door.svg";
import elecSvg from "../../../assets/a320/du/sd-elec.svg";
import engSvg from "../../../assets/a320/du/sd-eng.svg";
import fctlSvg from "../../../assets/a320/du/sd-fctl.svg";
import fuelSvg from "../../../assets/a320/du/sd-fuel.svg";
import hydSvg from "../../../assets/a320/du/sd-hyd.svg";
import pressSvg from "../../../assets/a320/du/sd-press.svg";
import statusSvg from "../../../assets/a320/du/sd-status.svg";
import wheelSvg from "../../../assets/a320/du/sd-wheel.svg";
import type { Props } from "../rig";
import type { DuData } from "./data";
import { css, D2R, type EcColour, roundTo, table, txt, vis } from "./ecam-common";
import type { El, SvgDoc } from "./svg";

export interface SdState {
  /** the F/CTL page shown until then [s] (a flight controls' check) */
  fctlUntil: number;
  /** the page drawn last */
  last: string;
}

export interface SdPage {
  url: string;
  init(doc: SvgDoc): void;
  update(doc: SvgDoc, d: DuData, s: SdState, t: number): void;
}

const rot = (doc: SvgDoc, id: string, deg: number) => doc.get(id).setRotation(deg * D2R);
const running = (d: DuData, i: 0 | 1) => d.eng[i].running && d.eng[i].n2 > 50;
const LB = 0.45359237;

// ---------------------------------------------------------------------------------------------- the bag

/** A property of the systems' bag: a finite number, else `dflt` (a property no system writes here, a NaN). */
function num(P: Props, k: string, dflt = 0): number {
  const v = P[k];
  const x = typeof v === "number" ? v : v === undefined ? Number.NaN : Number(v);
  return Number.isFinite(x) ? x : dflt;
}
/** a switch's or a relay's state (FlightGear's booleans: > 0.5) */
const on = (P: Props, k: string, dflt = false) => (P[k] === undefined ? dflt : num(P, k) > 0.5);
/** a bus's voltage [V] (no systems: the deck's, all powered) */
const bus = (P: Props, b: string) => num(P, `systems/electrical/bus/${b}`, b.startsWith("dc") ? 28 : 115);
/** a hydraulic system's pressure [psi] (no systems: the engines' pumps', the blue's electric one) */
const hyd = (d: DuData, s: "green" | "blue" | "yellow") =>
  num(
    d.deck,
    `systems/hydraulic/${s}-psi`,
    (s === "green" ? running(d, 0) : s === "yellow" ? running(d, 1) : running(d, 0) || running(d, 1)) ? 3000 : 0,
  );

// (the colours set only when they change: FlightGear's UpdateManager — each set copies an element's style)
const stroke = new WeakMap<El, EcColour>();
const filled = new WeakMap<El, EcColour>();
/** an element's colour (a text's, a line's) */
function col(doc: SvgDoc, id: string, c: EcColour) {
  const e = doc.get(id);
  if (stroke.get(e) === c) return;
  stroke.set(e, c);
  e.setColor(css(c));
}
/** an element's fill */
function fill(doc: SvgDoc, id: string, c: EcColour | "black") {
  const e = doc.get(id);
  const k = c === "black" ? ("black" as EcColour) : c;
  if (filled.get(e) === k) return;
  filled.set(e, k);
  e.setColorFill(c === "black" ? "#000" : css(c));
}
/** a valve's drawing: its stroke and its cross's fill */
function valve(doc: SvgDoc, id: string, c: EcColour, cross = `${id}-Cross`) {
  col(doc, id, c);
  fill(doc, cross, c);
}
const ok = (b: boolean): EcColour => (b ? "green" : "amber");

// ---------------------------------------------------------------------------------------------- the figures not flown

/** the oil's quantity [qt] (CFM56: 17 full, a little burnt with the hours), pressure [psi] by N2, temperature [°C] */
const oilQt = (d: DuData, i: 0 | 1) => num(d.deck, `engines/engine${i ? "[1]" : ""}/oil-qt-actual`, 15.5 - 0.0002 * d.fuelUsed + 0.3 * i);
const oilPsi = (d: DuData, i: 0 | 1) =>
  num(d.deck, `engines/engine${i ? "[1]" : ""}/oil-psi-actual`, running(d, i) ? 30 + 0.45 * Math.max(d.eng[i].n2 - 55, 0) : 0);
const oilTemp = (d: DuData, i: 0 | 1) => (running(d, i) ? 55 + 0.6 * Math.max(d.eng[i].n2 - 55, 0) : Math.round(d.sat + 10));
/** the vibrations (N1, N2: a few tenths, with the speeds) */
const vib = (n: number) => (0.15 + 0.004 * n).toFixed(1);
/** the fuel each engine used [kg] (the systems' FUEL USED: lb, from their start), else half the flight's */
const fuelUsed = (d: DuData, i: 0 | 1) => {
  const lb = num(d.deck, `systems/fuel/fuel-used-${i + 1}`, Number.NaN);
  return Number.isFinite(lb) ? lb * LB : d.fuelUsed / 2;
};

/** the cabin: its altitude [ft], the pressure difference [psi], its vertical speed [ft/min] — Airbus's schedule
 *  (≈ 8 000 ft at FL390), or the pressurization's own altitude (src/a320/systems/nasal/pneumatics.ts) when it climbs
 *  above it (a leak, the outflow valve open, a manual control) */
const cabin = (d: DuData) => {
  const p = (h: number) => 14.696 * (1 - 6.8756e-6 * h) ** 5.2559;
  let alt = d.onGround ? d.alt : Math.max(Math.min(d.alt * 0.205, 8000), Math.min(d.alt, 0));
  let vs = d.onGround || alt >= 8000 ? 0 : d.vs * 0.205;
  const P = d.deck;
  // (FlightGear's filtered altitude where its rules run, else the Nasal's own — the higher)
  const own = Math.max(num(P, "systems/pressurization/cabinalt-norm", -1e9), num(P, "systems/pressurization/cabinalt", -1e9));
  if (!d.onGround && own > alt + 50) {
    alt = own;
    vs = num(P, "systems/pressurization/vs-norm", num(P, "systems/pressurization/vs", 0));
  }
  return { alt, dp: p(alt) - p(d.alt), vs };
};

// ---------------------------------------------------------------------------------------------- the pages

const ENG: SdPage = {
  url: engSvg,
  init(doc) {
    vis(doc, false, "FUEL-clog-1", "FUEL-clog-2", "OIL-clog-1", "OIL-clog-2", "OilQT1-XX", "OilQT2-XX");
    txt(doc, "Fused-weight-unit", "KG");
    txt(doc, "Fused-oil-unit", "QT");
  },
  update(doc, d) {
    const P = d.deck;
    for (const i of [0, 1] as const) {
      const k = i + 1;
      // (Lower-ECAM-eng.nas: the oil's figures on DC 1 / DC 2, the temperatures on DC BAT / DC ESS)
      const dc = bus(P, i ? "dc-2" : "dc-1") >= 25;
      const q = oilQt(d, i);
      vis(doc, dc, `OilQT${k}`, `OilQT${k}-decimalpt`, `OilQT${k}-decimal`, `OilQT${k}-needle`, `OilPSI${k}-needle`);
      vis(doc, !dc, `OilQT${k}-XX`);
      txt(doc, `OilQT${k}`, Math.floor(q));
      txt(doc, `OilQT${k}-decimal`, Math.floor((q % 1) * 2) * 5);
      doc.get(`OilQT${k}-needle`).setRotation(Math.min(Math.max(q, 0), 27) * 6.66 * D2R);
      const psi = oilPsi(d, i);
      txt(doc, `OilPSI${k}`, dc ? Math.min(roundTo(psi, 2), 998) : "XX");
      col(doc, `OilPSI${k}`, !dc ? "amber" : psi >= 13 ? "green" : "red");
      doc.get(`OilPSI${k}-needle`).setRotation(Math.min(Math.max(psi, 0), 100) * 1.8 * D2R);
      col(doc, `OilPSI${k}-needle`, psi >= 13 ? "green" : "red");
      const tOk = bus(P, i ? "dc-ess" : "dc-bat") >= 25;
      txt(doc, `OilTemp${k}`, tOk ? Math.round(oilTemp(d, i)) : "XX", tOk ? "green" : "amber");
      txt(doc, `FUEL-used-${k}`, roundTo(fuelUsed(d, i), 10));
      txt(doc, `VIB-N1-${k}`, vib(d.eng[i].n1));
      txt(doc, `VIB-N2-${k}`, vib(d.eng[i].n2 * 0.8));
    }
  },
};

const WHEEL: SdPage = {
  url: wheelSvg,
  init(doc) {
    vis(
      doc,
      false,
      "leftuplock",
      "noseuplock",
      "rightuplock",
      "tirepress1",
      "tirepress2",
      "tirepress3",
      "tirepress4",
      "tirepress5",
      "tirepress6",
    );
    for (const s of ["L", "R"]) for (let i = 1; i <= 5; i++) vis(doc, false, `spoiler${i}${s}f`);
  },
  update(doc, d, _s, t) {
    const P = d.deck;
    // (the gear: its triangles, green down and locked, red in transit; L/G CTL while the gear and its lever disagree)
    const g = d.gear.ext;
    for (const leg of ["Nose", "Left", "Right"]) {
      vis(doc, g >= 0.2, `Triangle-${leg}1`, `Triangle-${leg}2`);
      col(doc, `Triangle-${leg}1`, g >= 0.99 ? "green" : "red");
      col(doc, `Triangle-${leg}2`, g >= 0.99 ? "green" : "red");
    }
    vis(doc, (d.gear.down && g <= 0.99) || (!d.gear.down && g >= 0.01), "lgctltext");
    // (the doors: open while the gear moves — turned, amber —, closed green)
    const doorOpen = g > 0.01 && g < 0.99 ? 1 : 0;
    for (const [id, deg] of [
      ["leftdoor", -80],
      ["rightdoor", 80],
      ["nosegeardoorL", -80],
      ["nosegeardoorR", 80],
    ] as const) {
      rot(doc, id, deg * doorOpen);
      fill(doc, id, doorOpen ? "amber" : "green");
    }
    // (Lower-ECAM-wheel.nas: the steering and the brakes by the yellow and green systems, the A/SKID & N/W STRG switch,
    // the brakes' mode — 1 normal (the BSCU's, green), 2 alternate (yellow, its accumulator))
    const G = hyd(d, "green"),
      Y = hyd(d, "yellow");
    const nws = on(P, "controls/gear/nws-switch", true);
    const mode = num(P, "systems/hydraulic/brakes/mode", 1) || 1;
    const accu = num(P, "systems/hydraulic/yellow-accumulator-psi", 3000);
    vis(doc, !(nws && Y >= 1500), "NWStext", "NWS", "NWSrect");
    col(doc, "NWS", Y >= 1500 ? "green" : "amber");
    const skid = (Y < 1500 && mode === 1) || !nws;
    vis(doc, skid, "antiskidtext", "BSCUrect1", "BSCUrect2", "BSCU1", "BSCU2");
    col(doc, "antiskidtext", "amber");
    vis(doc, !nws || G < 1500, "NORMbrk", "normbrk-rect", "normbrkhyd");
    const altn = !(mode !== 2 || G < 1500 || Y < 1500 || !nws);
    vis(doc, altn, "ALTNbrk", "altnbrk-rect", "altnbrkhyd");
    col(doc, "ALTNbrk", Y < 1500 && accu < 1500 ? "amber" : "green");
    const accuLo = mode === 2 && accu < 200 && Y < 1500;
    const accuOk = mode === 2 && nws && accu > 200 && Y >= 1500;
    const accuOnly = mode === 2 && accu > 200 && Y < 1500;
    vis(doc, accuOnly, "accuonlyarrow", "accuonly");
    vis(doc, accuLo || accuOk, "accupress_text");
    vis(doc, accuOk, "brakearrow");
    col(doc, "accupress_text", accuLo ? "amber" : "green");
    col(doc, "normbrkhyd", ok(G >= 1500));
    col(doc, "altnbrkhyd", ok(Y >= 1500));
    // (the brakes released in alternate braking: their pressure off)
    const relL = mode !== 1 && num(P, "systems/hydraulic/brakes/pressure-left-psi") <= 300;
    const relR = mode !== 1 && num(P, "systems/hydraulic/brakes/pressure-right-psi") <= 300;
    for (let i = 1; i <= 4; i++) {
      vis(doc, relL, `releaseL${i}`);
      vis(doc, relR, `releaseR${i}`);
    }
    // (the autobrake)
    vis(doc, d.autobrake > 0, "autobrkind");
    txt(doc, "autobrkind", ["", "LO", "MED", "MAX"][d.autobrake]!);
    vis(doc, d.autobrake > 0 || !nws, "autobrk");
    col(doc, "autobrk", nws ? "green" : "amber");
    // (the brakes' temperatures: warmed by their work — the deceleration on the ground — and cooling; the hottest's arc
    // over 100 °C)
    let hot = 0;
    for (let i = 0; i < 4; i++) hot = Math.max(hot, brakeTemp(d, t, i));
    for (let i = 0; i < 4; i++) {
      const T = brakeTemp(d, t, i);
      txt(doc, `braketemp${i + 1}`, roundTo(T, 5), T > 300 ? "amber" : "green");
      vis(doc, T > 100 && T === hot, `toparc${i + 1}`);
      col(doc, `toparc${i + 1}`, T > 300 ? "amber" : T > 100 ? "green" : "white");
    }
    spoilers(doc, d);
  },
};

/** the brakes' temperatures [°C]: the air's, warmed by the braking (its work), cooling with a time constant of ≈ 15
 *  min — one model for the four (the inner ones a few degrees warmer) */
const brakes = { T: Number.NaN, t: 0, v: 0 };
function brakeTemp(d: DuData, t: number, i: number) {
  if (i === 0 && t !== brakes.t) {
    const amb = d.sat;
    if (!Number.isFinite(brakes.T)) brakes.T = amb + 15;
    const dt = Math.min(Math.max(t - brakes.t, 0), 1);
    const dv = Math.max(brakes.v - d.gs, 0);
    // (the energy of the speed lost on the brakes, the reversers' and the drag's share left out: 60 % — a stop from
    // 130 kt at 64 t warms them some 150 °C)
    if (d.onGround && dv > 0 && d.eng.every((e) => e.n1 < 40)) brakes.T += dv * 0.514 * d.gs * 0.514 * d.gw * 0.6 * 1e-6 * 3.5;
    brakes.T += (amb + 10 - brakes.T) * (1 - Math.exp(-dt / 900));
    brakes.t = t;
    brakes.v = d.gs;
  }
  return brakes.T + (i === 1 || i === 2 ? 5 : 0);
}

/** the spoilers: extended past 1.5°; amber with their system lost (Lower-ECAM-fctl.nas: 1 and 5 green, 2 and 4
 *  yellow, 3 blue) or their failure — an F under a retracted one */
const SPLR_SYS = ["green", "yellow", "blue", "yellow", "green"] as const;
function spoilers(doc: SvgDoc, d: DuData) {
  const P = d.deck;
  ["L", "R"].forEach((s, side) => {
    for (let i = 1; i <= 5; i++) {
      const out = (d.spoilers[side * 5 + i - 1] ?? 0) >= 1.5;
      vis(doc, out, `spoiler${i}${s}ex`);
      vis(doc, !out, `spoiler${i}${s}rt`);
      const failed = on(P, `systems/failures/spoilers/spoiler-${s.toLowerCase()}${i}`) || hyd(d, SPLR_SYS[i - 1]!) < 1500;
      col(doc, `spoiler${i}${s}ex`, ok(!failed));
      col(doc, `spoiler${i}${s}rt`, ok(!failed));
      vis(doc, failed && !out, `spoiler${i}${s}f`);
    }
  });
}

/** the flight control computers working: their pushbutton in, no failure, their bus (ELAC 1 DC ESS, ELAC 2 DC 2,
 *  SEC 1 DC ESS, SEC 2 and 3 DC 2) — the FBW's own (systems/fctl/*) where it runs */
function computer(P: Props, c: "elac1" | "elac2" | "sec1" | "sec2" | "sec3") {
  if (P[`systems/fctl/${c}`] !== undefined) return on(P, `systems/fctl/${c}`);
  const b = c === "elac1" || c === "sec1" ? "dc-ess" : "dc-2";
  return on(P, `controls/fctl/switches/${c}`, true) && !on(P, `systems/failures/fctl/${c}`) && bus(P, b) >= 25;
}

const FCTL: SdPage = {
  url: fctlSvg,
  init(doc) {
    for (const s of ["L", "R"]) for (let i = 1; i <= 5; i++) vis(doc, false, `spoiler${i}${s}f`);
  },
  update(doc, d) {
    const P = d.deck;
    const S = d.surfaces;
    // (Systems/lower-ecam.xml: the ailerons' and elevators' marks along their scales)
    const ail = [
      [-25, -0.83],
      [0, 0],
      [25, 0.73],
    ] as const;
    const elev = [
      [-30, -1.03],
      [0, 0],
      [15, 0.63],
    ] as const;
    doc.get("ailL").setTranslation(0, table(S.ailL, ail) * 100);
    doc.get("ailR").setTranslation(0, table(-S.ailR, ail) * -100);
    doc.get("elevL").setTranslation(0, table(S.elevL, elev) * 100);
    doc.get("elevR").setTranslation(0, table(S.elevR, elev) * 100);
    doc.get("rudder").setRotation(S.rudder * -0.024);
    doc.get("rudderTrimInd").setRotation(num(P, "systems/fcs/rudder/trim-deg") * -0.024);
    // (the stabiliser's trim [°], UP / DN)
    const pt = -S.stab;
    txt(doc, "PT", pt.toFixed(1));
    vis(doc, Math.abs(pt) >= 0.09, "PTupdn");
    txt(doc, "PTupdn", pt >= 0.09 ? "UP" : "DN");
    // (Lower-ECAM-fctl.nas: each surface's actuators by their system and their computers)
    const G = hyd(d, "green") >= 1450,
      Y = hyd(d, "yellow") >= 1450,
      B = hyd(d, "blue") >= 1500;
    const e1 = computer(P, "elac1"),
      e2 = computer(P, "elac2"),
      s1 = computer(P, "sec1"),
      s2 = computer(P, "sec2"),
      s3 = computer(P, "sec3");
    col(doc, "elevLgreen", ok(G && (e2 || s2)));
    col(doc, "ailLgreen", ok(G && e2));
    col(doc, "ailRgreen", ok(G && e1));
    for (const id of ["ruddergreen", "PTgreen", "spdbrkgreen"]) col(doc, id, ok(G));
    col(doc, "elevRyellow", ok(Y && (e2 || s2)));
    for (const id of ["rudderyellow", "PTyellow", "spdbrkyellow"]) col(doc, id, ok(Y));
    col(doc, "ailLblue", ok(B && e1));
    col(doc, "elevLblue", ok(B && (e1 || s1)));
    col(doc, "elevRblue", ok(B && (e1 || s1)));
    col(doc, "ailRblue", ok(B && e2));
    for (const id of ["rudderblue", "spdbrkblue"]) col(doc, id, ok(B));
    // (the surfaces themselves: amber with none of their actuators driven)
    const Bp = hyd(d, "blue") >= 1500,
      Gp = hyd(d, "green") >= 1500,
      Yp = hyd(d, "yellow") >= 1500;
    col(doc, "ailL", ok(!((!Bp || !e1) && (!Gp || !e2))));
    col(doc, "ailR", ok(!((!Gp || !e1) && (!Bp || !e2))));
    col(doc, "elevL", ok(!((!Bp || (!e1 && !s1)) && (!Gp || (!e2 && !s2)))));
    col(doc, "elevR", ok(!((!Bp || (!e1 && !s1)) && (!Yp || (!e2 && !s2)))));
    col(doc, "rudder", ok(Bp || Gp || Yp));
    const trim = Gp || Yp;
    col(doc, "PT", ok(trim));
    col(doc, "PTupdn", ok(trim));
    col(doc, "PTcc", trim ? "cyan" : "amber");
    col(doc, "pitchTrimStatus", on(P, "systems/failures/fctl/ths-jam") ? "amber" : "white");
    // (the computers' boxes)
    for (const [id, line, w] of [
      ["elac1", "path4249", e1],
      ["elac2", "path4249-3", e2],
      ["sec1", "path4249-3-6-7", s1],
      ["sec2", "path4249-3-6-7-5", s2],
      ["sec3", "path4249-3-6", s3],
    ] as const) {
      col(doc, id, ok(w));
      col(doc, line, ok(w));
    }
    spoilers(doc, d);
  },
};

const FUEL: SdPage = {
  url: fuelSvg,
  init(doc) {
    vis(doc, false, "FUEL-Left-blocked", "FUEL-Right-blocked");
    vis(
      doc,
      false,
      "FUEL-Left-Outer-Inacc",
      "FUEL-Left-Inner-Inacc",
      "FUEL-Center-Inacc",
      "FUEL-Right-Inner-Inacc",
      "FUEL-Right-Outer-Inacc",
    );
    txt(doc, "FOB-weight-unit", "KG");
    txt(doc, "Fused-weight-unit", "KG");
    txt(doc, "FFlow-weight-unit", "KG/MIN");
  },
  update(doc, d) {
    const P = d.deck;
    const T = d.tanks;
    txt(doc, "FUEL-Left-Outer-quantity", roundTo(T[0] ?? 0, 10));
    txt(doc, "FUEL-Left-Inner-quantity", roundTo(T[1] ?? 0, 10));
    txt(doc, "FUEL-Center-quantity", roundTo(T[2] ?? 0, 10));
    txt(doc, "FUEL-Right-Inner-quantity", roundTo(T[3] ?? 0, 10));
    txt(doc, "FUEL-Right-Outer-quantity", roundTo(T[4] ?? 0, 10));
    txt(doc, "FUEL-On-Board", roundTo(d.fob, 10));
    const u1 = fuelUsed(d, 0),
      u2 = fuelUsed(d, 1);
    txt(doc, "FUEL-used-1", roundTo(u1, 10));
    txt(doc, "FUEL-used-2", roundTo(u2, 10));
    txt(doc, "FUEL-used-both", roundTo(u1 + u2, 10));
    // (the flow, the FADECs powered: an engine turning, or the AC to start them)
    const fadec = d.eng.some((e) => e.n2 > 3.5) || bus(P, "ac-ess") >= 110;
    txt(doc, "FUEL-Flow-per-min", fadec ? roundTo((d.eng[0].ff + d.eng[1].ff) / 60, 10) : "XX", fadec ? "green" : "amber");
    // (the pumps: their pushbuttons — Lower-ECAM-fuel.nas —; the centre's two off: its tank blocked)
    for (const p of ["Left-1", "Left-2", "Center-1", "Center-2", "Right-1", "Right-2"]) {
      const w = on(P, `controls/fuel/switches/pump-${p.toLowerCase()}`, true);
      const c = ok(w);
      vis(doc, w, `FUEL-Pump-${p}-Open`);
      vis(doc, !w, `FUEL-Pump-${p}-Closed`);
      col(doc, `FUEL-Pump-${p}`, c);
      fill(doc, `FUEL-Pump-${p}`, c);
      fill(doc, `FUEL-Pump-${p}-Square`, c);
      fill(doc, `FUEL-Pump-${p}-Open`, c);
      fill(doc, `FUEL-Pump-${p}-Closed`, c);
    }
    vis(
      doc,
      !on(P, "controls/fuel/switches/pump-center-1", true) && !on(P, "controls/fuel/switches/pump-center-2", true),
      "FUEL-Center-blocked",
    );
    // (the cross-feed: open, closed, in transit — amber when it disagrees with its pushbutton)
    const xv = num(P, "systems/fuel/valves/crossfeed-valve"),
      xs = on(P, "controls/fuel/switches/crossfeed");
    rot(doc, "FUEL-XFEED", xv >= 0.9 ? 0 : xv <= 0.1 ? 90 : 45);
    vis(doc, xv >= 0.9, "FUEL-XFEED-pipes");
    const xc = ok((xv >= 0.9 && xs) || (xv <= 0.1 && !xs));
    col(doc, "FUEL-XFEED", xc);
    fill(doc, "FUEL-XFEED", xc);
    fill(doc, "FUEL-XFEED-Cross", xc);
    // (the engines' LP valves, their ENG MASTERs; the engine's figures amber below 18.8 % N1)
    for (const i of [0, 1] as const) {
      const k = i + 1;
      const v = num(P, `systems/fuel/valves/engine-${k}-lp-valve`, d.eng[i].running ? 1 : 0);
      const cut = on(P, `controls/engines/engine${i ? "[1]" : ""}/cutoff-switch`, !d.eng[i].running);
      rot(doc, `FUEL-ENG-Master-${k}`, v > 0.1 ? (v >= 0.9 ? 0 : 45) : 90);
      const c = ok(v > 0.1 && !cut);
      col(doc, `FUEL-ENG-Master-${k}`, c);
      fill(doc, `FUEL-ENG-Master-${k}`, c);
      fill(doc, `FUEL-ENG-Master-${k}-Cross`, c);
      col(doc, `FUEL-ENG-${k}-pipe`, c);
      fill(doc, `FUEL-ENG-${k}-pipe`, c);
      const lit = d.eng[i].n1 > 18.8;
      col(doc, `ENG${k}idFFlow`, lit ? "white" : "amber");
      col(doc, `FUEL-ENG-${k}-label`, lit ? "white" : "amber");
      // (the outer tanks' transfer valves)
      const tv = num(P, `systems/fuel/valves/outer-inner-transfer-valve-${k}`);
      const id = i ? "FUEL-Right-Transfer" : "FUEL-Left-Transfer";
      vis(doc, tv > 0.1, id);
      col(doc, id, ok(tv >= 0.9));
    }
    // (the APU's feed: its LP valve)
    const apuV = num(P, "systems/fuel/valves/apu-lp-valve") > 0.5,
      apuM = on(P, "controls/apu/master"),
      apuF = on(P, "controls/apu/fire-btn");
    if (!apuV) {
      col(doc, "FUEL-APU-label", apuM || apuF ? "amber" : "white");
      col(doc, "FUEL-APU-arrow", "white");
      vis(doc, false, "FUEL-APU-line");
      vis(doc, !(apuM || apuF), "FUEL-APU-arrow");
    } else {
      const bad = !apuM || apuF;
      col(doc, "FUEL-APU-label", bad ? "amber" : "white");
      col(doc, "FUEL-APU-line", bad ? "amber" : "green");
      col(doc, "FUEL-APU-arrow", bad ? "amber" : "green");
      vis(doc, true, "FUEL-APU-line", "FUEL-APU-arrow");
    }
    // (the wings' fuel temperatures: the tanks' where the systems give them, else the outer air's, warmed)
    for (const [id, k, hi] of [
      ["FUEL-Left-Outer-temp", "", 55],
      ["FUEL-Left-Inner-temp", "[1]", 45],
      ["FUEL-Right-Inner-temp", "[3]", 45],
      ["FUEL-Right-Outer-temp", "[4]", 55],
    ] as const) {
      const T = num(P, `consumables/fuel/tank${k}/temperature_degC`, Math.max(d.sat + 15, -40));
      txt(doc, id, Math.round(T), T > hi || T < -40 ? "amber" : "green");
    }
  },
};

const CRZ: SdPage = {
  url: crzSvg,
  init(doc) {
    txt(doc, "Fused-weight-unit", "KG");
    txt(doc, "OilUnit", "QT");
  },
  update(doc, d) {
    const P = d.deck;
    const u1 = fuelUsed(d, 0),
      u2 = fuelUsed(d, 1);
    txt(doc, "FUsed1", roundTo(u1, 10));
    txt(doc, "FUsed2", roundTo(u2, 10));
    txt(doc, "FUsed", roundTo(u1 + u2, 10));
    const dc1 = bus(P, "dc-1") >= 25,
      dc2 = bus(P, "dc-2") >= 25;
    txt(doc, "Oil1", dc1 ? oilQt(d, 0).toFixed(1) : "XX", ok(dc1));
    txt(doc, "Oil2", dc2 ? oilQt(d, 1).toFixed(1) : "XX", ok(dc2));
    txt(doc, "VIB1N1", vib(d.eng[0].n1));
    txt(doc, "VIB1N2", vib(d.eng[0].n2 * 0.8));
    txt(doc, "VIB2N1", vib(d.eng[1].n1));
    txt(doc, "VIB2N2", vib(d.eng[1].n2 * 0.8));
    const c = cabin(d);
    txt(doc, "deltaPSI", Math.min(Math.max(c.dp, -9.9), 31.9).toFixed(1), c.dp < -0.4 || c.dp > 8.5 ? "amber" : "green");
    txt(doc, "CABVS", roundTo(c.vs, 50));
    txt(doc, "CABALT", roundTo(c.alt, 50), c.alt > 9550 ? "red" : "green");
    vis(doc, c.vs >= 25, "VS-Arrow-UP");
    vis(doc, c.vs <= -25, "VS-Arrow-DN");
    txt(doc, "LDGELEV", 0);
    txt(doc, "CKPT-TEMP", Math.round(num(P, "systems/air-conditioning/temperatures/cockpit-temp", 23)));
    txt(doc, "FWD-TEMP", Math.round(num(P, "systems/air-conditioning/temperatures/cabin-fwd-temp", 23)));
    txt(doc, "AFT-TEMP", Math.round(num(P, "systems/air-conditioning/temperatures/cabin-aft-temp", 23)));
  },
};

/** the doors (Lower-ECAM-door.nas): open past a tenth — amber, labelled, its slide away —, closed green, its slide
 *  armed */
const DOORS = [
  ["doorl1", "Cabin1Left", true],
  ["doorl4", "Cabin4Left", true],
  ["doorr1", "Cabin1Right", true],
  ["doorr4", "Cabin4Right", true],
  ["cargofwd", "Cargo1", false],
  ["cargoaft", "Cargo2", false],
  ["cargobulk", "Bulk", false],
] as const;

const DOOR: SdPage = {
  url: doorSvg,
  init(doc) {
    // (FlightGear's start: the A320's doors 2 and 3 are the overwing exits; the avionics' hatches closed)
    vis(doc, false, "AvionicsLine1", "AvionicsLine2", "AvionicsLbl1", "AvionicsLbl2", "ExitLLine", "ExitLLbl", "ExitRLine", "ExitRLbl");
    for (const n of [2, 3])
      for (const s of ["Left", "Right"]) vis(doc, false, `Cabin${n}${s}`, `Cabin${n}${s}Line`, `Cabin${n}${s}Lbl`, `Cabin${n}${s}Slide`);
  },
  update(doc, d) {
    const P = d.deck;
    for (const [prop, id, cabinDoor] of DOORS) {
      const open = num(P, `sim/model/door-positions/${prop}/position-norm`) >= 0.1;
      const shape = cabinDoor ? id : id === "Bulk" ? "Bulk" : `${id}Door`;
      col(doc, shape, open ? "amber" : "green");
      fill(doc, shape, open ? "amber" : "black");
      vis(doc, open, `${id}Lbl`, `${id}Line`);
      if (cabinDoor) vis(doc, !open, `${id}Slide`);
    }
    // (the crew's oxygen: the bottle's pressure, its regulator; the pushbutton off: the indication amber)
    const psi = num(P, "systems/oxygen/cockpit-oxygen/bottle-psi", 1850);
    const lo = on(P, "systems/oxygen/cockpit-oxygen/regul-lo-pr");
    const pb = on(P, "controls/oxygen/cockpit-oxygen-supply-pb");
    col(doc, "DOOROXY-OxyIndicator", pb && psi >= 300 && !lo ? "white" : "amber");
    txt(doc, "DOOROXY-PR", roundTo(psi, 10), ok(psi >= 300));
    vis(doc, lo, "DOOROXY-REGUL-LO-PR");
    const c = cabin(d);
    txt(doc, "DOOR-VS", `${c.vs >= 0 ? "+" : ""}${roundTo(c.vs, 50)}`, Math.abs(c.vs) > 2000 ? "amber" : "green");
    vis(doc, !d.onGround, "DOOR-VS", "DOOR-VS-Container");
  },
};

/** The STATUS page's lines (the ECAM's — src/a320/ecam: `d.ecamStatus`), drawn as runs of the page's NORMAL text: the
 *  limitations and procedures on the left, the inoperative systems on the right; NORMAL alone without any. */
const STS_COLOUR: Record<string, EcColour> = {
  r: "red",
  red: "red",
  a: "amber",
  amber: "amber",
  g: "green",
  green: "green",
  c: "cyan",
  cyan: "cyan",
  m: "magenta",
  magenta: "magenta",
  w: "white",
  white: "white",
};
const sts = { normal: null as El["runs"] | null, sig: "" };
const STATUS: SdPage = {
  url: statusSvg,
  init(doc) {
    sts.normal = doc.get("NORMAL").runs.slice();
    sts.sig = "";
  },
  update(doc, d) {
    const S = d.ecamStatus;
    const L = S?.left ?? [],
      R = S?.right ?? [];
    let sig = "";
    for (const l of L) sig += `${l.colour}${l.text}\n`;
    sig += "|";
    for (const l of R) sig += `${l.colour}${l.text}\n`;
    if (sig === sts.sig) return;
    sts.sig = sig;
    const el = doc.get("NORMAL");
    const base = sts.normal ?? el.runs;
    if (!L.length && !R.length) {
      el.runs = base.slice();
      return;
    }
    const st = base[0]?.style ?? el.style;
    const run = (x: number, y: number, text: string, colour: string) => ({
      x,
      y,
      text,
      style: { ...st, fontSize: 30, anchor: "start" as const, fill: css(STS_COLOUR[colour] ?? "white") },
    });
    el.runs = [
      ...L.slice(0, 18).map((l, i) => run(18, 112 + 38 * i, l.text, l.colour)),
      ...R.slice(0, 18).map((l, i) => run(560, 112 + 38 * i, l.text, l.colour)),
    ];
  },
};

const APU: SdPage = {
  url: apuSvg,
  init(doc) {
    vis(doc, false, "APUGenOff");
  },
  update(doc, d) {
    const P = d.deck;
    const master = on(P, "controls/apu/master"),
      avail = on(P, "systems/apu/available"),
      genPb = on(P, "controls/electrical/switches/apu", true);
    // (Lower-ECAM-APU.nas: the generator's box with the master or the APU available; its figures with its pushbutton)
    const box = master || avail;
    vis(doc, box, "APUGenbox");
    vis(doc, box && !genPb, "APUGenOff");
    vis(doc, box && genPb, "APUGenHz", "APUGenVolt", "APUGenLoad", "text3724", "text3728", "text3732");
    col(doc, "APUGentext", box && !genPb ? "amber" : "white");
    const hz = num(P, "systems/electrical/sources/apu/output-hertz"),
      volt = num(P, "systems/electrical/sources/apu/output-volt"),
      glc = on(P, "systems/electrical/relay/apu-glc/contact-pos");
    const load = num(P, "systems/electrical/extra/apu-load", num(P, "systems/apu/apu-load", glc ? 30 : 0));
    txt(doc, "APUGenHz", Math.round(hz), ok(hz >= 390 && hz <= 410));
    txt(doc, "APUGenVolt", Math.round(volt), ok(volt >= 110 && volt <= 120));
    txt(doc, "APUGenLoad", Math.round(load), ok(load <= 100));
    vis(doc, glc, "APUGenOnline");
    vis(doc, avail, "APUAvail");
    vis(doc, num(P, "controls/apu/inlet-flap/position-norm") > 0.5, "APUFlapOpen");
    vis(doc, on(P, "systems/fuel/pumps/all-eng-pump-off") && !on(P, "systems/fuel/pumps/apu-operate"), "APUfuelLO");
    // (the bleed valve: open past 0.9; amber while it disagrees with its command)
    const bv = num(P, "systems/pneumatics/valves/apu-bleed-valve"),
      bc = num(P, "systems/pneumatics/valves/apu-bleed-valve-cmd");
    rot(doc, "APUBleedValve", bv >= 0.9 ? 90 : 0);
    vis(doc, bv >= 0.9, "APUBleedOnline");
    const match = ok((bc >= 0.95 && bv > 0.5) || (bc <= 0.05 && bv <= 0.5));
    col(doc, "APUBleedValveCrossBar", match);
    fill(doc, "APUBleedValveCrossBar", match);
    col(doc, "APUBleedValve", match);
    // (N, EGT — Systems/lower-ecam.xml's needles —: XX below 0.5 %; N amber past 102 %, red past 107 %)
    const n = num(P, "engines/engine[2]/n1"),
      egt = num(P, "systems/apu/egt-degC", d.sat);
    const shown = n >= 0.5;
    const nc: EcColour = !shown ? "amber" : n >= 107 ? "red" : n >= 102 ? "amber" : "green";
    txt(doc, "APUN", shown ? Math.round(n) : "XX", nc);
    col(doc, "APUN-needle", nc);
    txt(doc, "APUEGT", shown ? Math.min(Math.max(roundTo(egt, 5), 0), 9995) : "XX", shown ? "green" : "amber");
    vis(doc, shown, "APUN-needle", "APUEGT-needle");
    const nRot = table(n, [
      [0, -127],
      [100, 53],
      [110, 70],
    ]);
    const eRot = table(egt, [
      [0, -115],
      [275, -115],
      [300, -108],
      [700, -19],
      [1000, 67],
      [1100, 86],
    ]);
    doc.get("APUN-needle").setRotation((nRot + 90) * D2R);
    doc.get("APUEGT-needle").setRotation((eRot + 90) * D2R);
    // (the oil: LOW OIL available on the ground under 3.7 l; the bleed's pressure with the ADR 1 and the APU turning)
    vis(doc, avail && d.onGround && num(P, "systems/apu/oil/level-l", 5.4) < 3.7, "APU-low-oil");
    const adr = on(P, "systems/navigation/adr/operating-1", true);
    txt(doc, "APUBleedPSI", adr && shown ? Math.round(num(P, "systems/pneumatics/source/apu-psi")) : "XX", ok(adr && shown));
  },
};

/** a valve's position agreeing with its command (open past 0.95, closed under 0.05) */
const agree = (pos: number, cmd: boolean) => (pos >= 0.95 && cmd) || (pos <= 0.05 && !cmd);

const BLEED: SdPage = {
  url: bleedSvg,
  init(doc) {
    vis(doc, false, "BLEED-ANTI-ICE-ARROW-LEFT", "BLEED-ANTI-ICE-ARROW-RIGHT");
  },
  update(doc, d) {
    const P = d.deck;
    const nominal = running(d, 0) || running(d, 1);
    // (the APU's bleed and the cross-bleed: Lower-ECAM-bleed.nas)
    const apuM = on(P, "controls/apu/master"),
      apuV = num(P, "systems/pneumatics/valves/apu-bleed-valve");
    const xb = num(P, "systems/pneumatics/valves/crossbleed-valve"),
      xbCmd = on(P, "systems/pneumatics/valves/crossbleed-valve-cmd");
    const apuOpen = apuM && apuV >= 0.9;
    rot(doc, "BLEED-APU-CIRCLE", apuOpen ? 0 : 90);
    vis(doc, apuOpen, "BLEED-APU-connectionTop");
    vis(doc, apuOpen || xb >= 0.9, "BLEED-xbleedLeft");
    vis(doc, apuM, "BLEED-APU-LINES");
    col(doc, "BLEED-APU-CIRCLE", on(P, "systems/pneumatics/warnings/apu-bleed-not-on") ? "amber" : "green");
    const xm = agree(xb, xbCmd);
    valve(doc, "BLEED-XFEED", ok(xm));
    rot(doc, "BLEED-XFEED", xm ? (xbCmd ? 0 : 90) : 45);
    vis(doc, xb >= 0.9, "BLEED-xbleedCenter", "BLEED-xbleedRight");
    // (the ram air: closed, open — amber on the ground —, in transit)
    const ram = num(P, "systems/air-conditioning/valves/ram-air");
    const wow = on(P, "gear/gear[1]/wow", d.onGround);
    const ramC: EcColour = ram <= 0.1 ? "green" : ram >= 0.9 && !wow ? "green" : "amber";
    rot(doc, "BLEED-Ram-Air", ram <= 0.1 ? 90 : ram >= 0.9 ? 0 : 45);
    col(doc, "BLEED-Ram-Air", ramC);
    fill(doc, "BLEED-Ram-Air", ramC);
    fill(doc, "BLEED-Ram-Air-Cross", ramC);
    vis(doc, ram > 0.1, "BLEED-Ram-Air-connection");
    col(doc, "BLEED-Ram-Air-connection", ramC);
    fill(doc, "BLEED-Ram-Air-connection", ramC);
    // (the mixer's lines: amber with both packs closed on the ground or the ram air closed)
    const fcv = [
      num(P, "systems/air-conditioning/valves/flow-control-valve-1", nominal ? 1 : 0),
      num(P, "systems/air-conditioning/valves/flow-control-valve-2", nominal ? 1 : 0),
    ];
    const condC = ok(!(fcv[0]! <= 0.1 && fcv[1]! <= 0.1 && (wow || ram < 0.9)));
    for (const id of ["BLEED-cond-1", "BLEED-cond-2", "BLEED-cond-3"]) col(doc, id, condC);
    vis(doc, wow, "BLEED-GND");
    vis(doc, on(P, "controls/ice-protection/wing"), "BLEED-Anti-Ice-Left", "BLEED-Anti-Ice-Right");
    for (const i of [0, 1] as const) {
      const k = i + 1;
      const E = i ? "engine[1]" : "engine";
      // (the engines' labels amber under 59 % N2 — idle)
      col(doc, `BLEED-ENG-${k}-label`, num(P, `engines/${E}/n2-actual`, d.eng[i].n2) >= 59 ? "white" : "amber");
      // (the HP valves, the bleed valves — PRVs —: open turned, amber when they disagree with their command)
      const hp = num(P, `systems/pneumatics/valves/engine-${k}-hp-valve`, nominal && d.eng[i].n1 < 30 ? 1 : 0),
        hpCmd = on(P, `systems/pneumatics/valves/engine-${k}-hp-valve-cmd`, hp > 0.5);
      rot(doc, `BLEED-HP-Valve-${k}`, hpCmd ? 90 : 0);
      vis(doc, hpCmd, `BLEED-HP-${k}-connection`);
      col(doc, `BLEED-HP-Valve-${k}`, ok(agree(hp, hpCmd)));
      const prv = num(P, `systems/pneumatics/valves/engine-${k}-prv-valve`, running(d, i) ? 1 : 0),
        prvCmd = on(P, `controls/pneumatics/switches/bleed-${k}`, true);
      rot(doc, `BLEED-ENG-${k}`, prv <= 0.1 ? 0 : 90);
      valve(doc, `BLEED-ENG-${k}`, ok(agree(prv, prvCmd)));
      // (the precooler: its inlet's pressure, its outlet's temperature — XX without its BMC)
      const bmc = on(P, `systems/pneumatics/indicating/bmc${k}-working`, true);
      const psi = num(P, `systems/pneumatics/psi/engine-${k}-psi`, running(d, i) ? 28 + 0.08 * d.eng[i].n1 : 0);
      const temp = num(P, `systems/pneumatics/precooler/temp-${k}`, running(d, i) ? 170 + 0.4 * d.eng[i].n1 : d.sat);
      txt(
        doc,
        `BLEED-Precooler-${k}-Inlet-Press`,
        bmc ? Math.min(Math.max(roundTo(psi, 2), -99), 98) : "XX",
        ok(bmc && psi >= 4 && psi <= 57),
      );
      const tBad = prvCmd && (temp < 150 || on(P, `systems/pneumatics/precooler/ovht-${k}`));
      txt(doc, `BLEED-Precooler-${k}-Outlet-Temp`, bmc ? Math.min(Math.max(roundTo(temp, 5), -999), 510) : "XX", ok(bmc && !tBad));
      // (the packs: their flow valves, flows, temperatures, bypass)
      const v = fcv[i]!,
        sw = on(P, `controls/pneumatics/switches/pack-${k}`, true);
      rot(doc, `BLEED-Pack-${k}-Flow-Valve`, v <= 0.1 ? 90 : 0);
      valve(doc, `BLEED-Pack-${k}-Flow-Valve`, ok(agree(v, sw)));
      fill(doc, `BLEED-Pack-${k}-Packflow-needle`, ok(v > 0.1));
      col(doc, `BLEED-Pack-${k}-connection`, ok(v > 0.1));
      fill(doc, `BLEED-Pack-${k}-connection`, ok(v > 0.1));
      const flow = num(P, `systems/air-conditioning/packs/pack-flow-${k}`, v > 0.1 ? 1 : 0.8);
      doc.get(`BLEED-Pack-${k}-Packflow-needle`).setRotation(
        table(flow, [
          [0.8, -80],
          [1, 0],
          [1.2, 80],
        ]) * D2R,
      );
      const out = num(P, `systems/air-conditioning/packs/pack-${k}-output-temp`, v > 0.1 ? 12 : d.sat);
      const comp = num(P, `systems/air-conditioning/packs/pack-${k}-outlet-temp`, v > 0.1 ? 150 : d.sat);
      txt(doc, `BLEED-Pack-${k}-Out-Temp`, roundTo(out, 5), ok(out <= 90));
      txt(doc, `BLEED-Pack-${k}-Comp-Out-Temp`, roundTo(comp, 5), ok(comp <= 230));
      doc.get(`BLEED-Pack-${k}-Bypass-needle`).setRotation((num(P, `systems/pneumatics/pack-${k}-bypass`, 50) - 50) * D2R);
    }
  },
};

const COND: SdPage = {
  url: condSvg,
  init(doc) {
    vis(doc, false, "CONDFanFwdFault", "CONDFanAftFault", "CargoCond");
  },
  update(doc, d) {
    const P = d.deck;
    const T = "systems/air-conditioning/temperatures/";
    for (const [z, zone] of [
      ["CKPT", "cockpit"],
      ["FWD", "cabin-fwd"],
      ["AFT", "cabin-aft"],
    ] as const) {
      txt(doc, `CONDTemp${z}`, Math.round(num(P, `${T}${zone}-temp`, 23)));
      txt(doc, `CONDDuctTemp${z}`, Math.round(num(P, `${T}${zone}-duct`, 21)));
      // (the trim valves: Systems/lower-ecam.xml, 0 … 1 → −50° … 50°)
      const tv = num(P, `systems/air-conditioning/valves/trim-${zone === "cockpit" ? "cockpit" : zone.slice(6)}`, 0.5);
      rot(doc, `CONDTrimValve${z}`, (Math.min(Math.max(tv, 0), 1) - 0.5) * 100);
    }
    // (the hot air valve: closed turned; amber when it disagrees with its command)
    const hv = num(P, "systems/air-conditioning/valves/hot-air", 1),
      hc = on(P, "systems/air-conditioning/valves/hot-air-cmd", true);
    rot(doc, "CONDHotAirValve", hv <= 0.01 ? 90 : 0);
    const c = ok(hv <= 0.01 ? !hc : hc);
    col(doc, "CONDHotAirValve", c);
    fill(doc, "CONDHotAirValveCross", c);
  },
};

const ELEC: SdPage = {
  url: elecSvg,
  init(doc) {
    vis(doc, false, "IDG1-LOPR", "IDG2-LOPR", "Shed-label", "IDG1-RISE-label", "IDG1-RISE-Value", "IDG2-RISE-label", "IDG2-RISE-Value");
  },
  update(doc, d) {
    const P = d.deck;
    const R = "systems/electrical/relay/",
      SRC = "systems/electrical/sources/",
      SW = "controls/electrical/switches/";
    const relay = (r: string) => on(P, `${R}${r}/contact-pos`);
    const ac1 = bus(P, "ac-1"),
      ac2 = bus(P, "ac-2");
    // (the APU's generator: its box with the master switch, its figures with its pushbutton)
    const apuM = on(P, "controls/apu/master"),
      apuPb = on(P, `${SW}apu`, true),
      apuGlc = relay("apu-glc");
    const apuV = num(P, `${SRC}apu/output-volt`),
      apuHz = num(P, `${SRC}apu/output-hertz`),
      apuLoad = num(P, "systems/electrical/extra/apu-load", num(P, "systems/apu/apu-load", apuGlc ? 30 : 0));
    vis(doc, apuM, "APU-border");
    vis(doc, apuM && apuPb, "APU-content");
    vis(doc, apuM && !apuPb, "APUGEN-off");
    txt(doc, "APUGenLoad", Math.round(apuLoad), ok(apuLoad <= 100));
    txt(doc, "APUGenHz", Math.round(apuHz), ok(apuHz >= 390 && apuHz <= 410));
    txt(doc, "APUGenVolt", Math.round(apuV), ok(apuV >= 110 && apuV <= 120));
    col(
      doc,
      "APUGentext",
      apuM && (!apuGlc || apuV > 120 || apuV < 110 || apuHz > 410 || apuHz < 390 || apuLoad >= 100) ? "amber" : "white",
    );
    vis(doc, apuGlc, "APU-out");
    // (the buses' labels: green powered, amber not)
    col(doc, "ELEC-DC1-label", ok(bus(P, "dc-1") > 25));
    col(doc, "ELEC-DC2-label", ok(bus(P, "dc-2") > 25));
    col(doc, "ELEC-DCESS-label", ok(bus(P, "dc-ess") > 25));
    col(doc, "ELEC-AC1-label", ok(ac1 >= 110));
    col(doc, "ELEC-Line-AC1-TR1", ok(ac1 >= 110));
    col(doc, "ELEC-AC2-label", ok(ac2 >= 110));
    col(doc, "ELEC-Line-AC2-TR2", ok(ac2 >= 110));
    col(doc, "ELEC-ACESS-label", ok(bus(P, "ac-ess") >= 110));
    vis(doc, bus(P, "ac-ess-shed") < 110, "ACESS-SHED");
    vis(doc, on(P, "systems/electrical/some-electric-thingie/galley-shed"), "GalleyShed");
    const tie1 = relay("ac-bus-ac-bus-tie-1"),
      tie2 = relay("ac-bus-ac-bus-tie-2");
    // (the batteries: DC BAT — XX with both off —, each one's volts, amps, its charge or discharge arrow)
    const bat: [boolean, boolean] = [on(P, `${SW}bat-1`), on(P, `${SW}bat-2`)];
    const dcBat = bus(P, "dc-bat");
    txt(doc, "ELEC-DCBAT-label", bat[0] || bat[1] ? "DC BAT" : "XX", ok((bat[0] || bat[1]) && dcBat > 25));
    for (const i of [0, 1] as const) {
      const k = i + 1;
      // (a battery's volts: its own — FlightGear's table by its charge, ≈ 26 V at 80 % where the bag gives none)
      const v = num(P, `${SRC}bat-${k}/volt`, 26.4),
        a = num(P, `${SRC}bat-${k}/amps`),
        dir = num(P, `${SRC}bat-${k}/direction`);
      vis(doc, !bat[i], `BAT${k}-OFF`);
      vis(doc, bat[i]!, `BAT${k}-content`);
      vis(doc, bat[i]! && dir === -1, `BAT${k}-charge`);
      vis(doc, bat[i]! && dir === 1, `BAT${k}-discharge`);
      txt(doc, `Bat${k}Volt`, Math.round(v), ok(v >= 25 && v <= 31));
      txt(doc, `Bat${k}Ampere`, Math.round(a), a > 5 && dir === 1 ? "amber" : "green");
      col(doc, `BAT${k}-label`, on(P, `systems/electrical/light/bat-${k}-fault`) || v < 25 || v > 31 || a > 5 ? "amber" : "white");
      // (the TRs: their volts and amps, their contactors' lines)
      const tv = num(P, `${R}tr-contactor-${k}/output`),
        ta = num(P, `${R}tr-contactor-${k}/output-amp`);
      txt(doc, `TR${k}Volt`, Math.round(tv), ok(tv >= 25 && tv <= 31));
      txt(doc, `TR${k}Ampere`, Math.round(ta), ok(ta >= 5));
      col(doc, `TR${k}-label`, tv < 25 || tv > 31 || ta < 5 ? "amber" : "white");
      vis(doc, relay(`tr-contactor-${k}`), `ELEC-Line-TR${k}-DC${k}`);
      // (the IDGs: disconnected, their engine stopped; the generators: off, their figures, their contactors)
      const disc = !on(P, `${SW}idg-${k}-disc`, true);
      vis(doc, disc, `IDG${k}-DISC`);
      col(doc, `ELEC-IDG-${k}-label`, disc ? "amber" : "white");
      const run = num(P, `engines/engine${i ? "[1]" : ""}/state`, running(d, i) ? 3 : 0) === 3;
      col(doc, `ELEC-IDG-${k}-num-label`, run ? "white" : "amber");
      col(doc, `GEN${k}-num-label`, run ? "white" : "amber");
      txt(doc, `ELEC-IDG-${k}-Temp`, run ? Math.round(45 + 0.2 * d.eng[i].n2) : Math.round(d.sat));
      const genSw = on(P, `${SW}gen-${k}`, true),
        gv = num(P, `${SRC}idg-${k}/output-volt`),
        ghz = num(P, `${SRC}idg-${k}/output-hertz`),
        glc = relay(`gen-${k}-glc`);
      vis(doc, genSw, `GEN${k}-content`);
      vis(doc, !genSw, `GEN${k}-off`);
      const bad = gv > 120 || gv < 110 || ghz > 410 || ghz < 390;
      col(doc, `GEN${k}-label`, genSw ? (bad ? "amber" : "white") : on(P, `${SRC}idg-${k}/gcr-relay`) ? "amber" : "white");
      txt(doc, `Gen${k}Volt`, Math.round(gv), ok(gv >= 110 && gv <= 120));
      txt(doc, `Gen${k}Hz`, ghz === 0 ? "XX" : Math.round(ghz), ok(ghz >= 390 && ghz <= 410));
      txt(doc, `Gen${k}Load`, glc ? Math.round(18 + 0.05 * d.eng[i].n2) : 0);
      vis(doc, gv >= 110 && glc, `ELEC-Line-GEN${k}-AC${k}`);
      vis(doc, glc || (i ? tie2 : tie1), `AC${k}-in`);
    }
    // (DC BAT's ties, DC ESS fed by the batteries, the ESS TR)
    const dcTie1 = relay("dc-bat-tie-dc-1"),
      dcTie2 = relay("dc-bat-tie-dc-2");
    vis(doc, dcTie1, "ELEC-Line-DC1-DCESS_DCBAT", "ELEC-Line-DC1-DCBAT");
    vis(doc, dcTie2, "ELEC-Line-DC2-DCESS_DCBAT", "ELEC-Line-DC2-DCBAT");
    vis(doc, relay("dc-bat-tie-dc-ess"), "ELEC-Line-DC1-DCESS");
    const essTr = relay("ess-tr-contactor");
    vis(doc, essTr, "ELEC-Line-ESSTR-DCESS", "ESSTR-group");
    if (essTr) {
      const ev = num(P, `${R}ess-tr-contactor/output`),
        ea = num(P, `${R}ess-tr-contactor/output-amp`);
      txt(doc, "ESSTR-Volt", Math.round(ev), ok(ev >= 25 && ev <= 31));
      txt(doc, "ESSTR-Ampere", Math.round(ea), ok(ea >= 5));
      col(doc, "ESSTR", ev < 25 || ev > 31 || ea < 5 ? "amber" : "white");
    }
    // (the emergency generator — the RAT's —, the static inverter)
    const emerV = num(P, `${SRC}emer-gen/output-volt`),
      emerHz = num(P, `${SRC}emer-gen/output-hertz`),
      emerRelay = num(P, `${R}emer-glc/output`),
      x15e1 = relay("relay-15XE1");
    const emer = emerV >= 110;
    vis(doc, emer, "EMERGEN-group", "ELEC-Line-Emergen-ESSTR");
    vis(doc, !emer, "ELEC-Line-Emergen-ESSTR-off", "EMERGEN-Label-off");
    vis(doc, emerRelay > 0.5 && x15e1, "EMERGEN-out");
    if (emer) {
      txt(doc, "EmergenVolt", Math.round(emerRelay), ok(emerRelay >= 110 && emerRelay <= 120));
      txt(doc, "EmergenHz", Math.round(emerHz), ok(emerHz >= 390 && emerHz <= 410));
      col(doc, "Emergen-Label", emerRelay > 120 || emerRelay < 110 || emerHz > 410 || emerHz < 390 ? "amber" : "white");
    }
    vis(doc, emerRelay <= 0.5 && x15e1, "ELEC-Line-ACESS-TRESS");
    vis(doc, relay("relay-15XE2"), "STATINV-group");
    txt(doc, "StatVolt", Math.round(num(P, `${SRC}si-1/output-volt`)));
    txt(doc, "StatHz", Math.round(num(P, `${SRC}si-1/output-hertz`)));
    // (AC ESS fed by AC 1 or AC 2; the ties: the APU's and the ground's power across)
    const f1 = relay("ac-ess-feed-1"),
      f2 = relay("ac-ess-feed-2");
    vis(doc, f1 && ac1 >= 110, "ELEC-Line-AC1-ACESS");
    vis(doc, !f1 && f2 && ac2 >= 110, "ELEC-Line-AC2-ACESS");
    vis(doc, tie1, "ELEC-Line-APU-AC1");
    vis(doc, tie2, "ELEC-Line-EXT-AC2");
    const epc = relay("ext-epc");
    vis(doc, (apuGlc && tie2) || (epc && tie1) || (tie1 && tie2), "ELEC-Line-APU-EXT");
    vis(doc, epc, "EXT-out");
    // (the external power: shown connected)
    const cart = on(P, `${SW}ground-cart`);
    vis(doc, cart, "EXTPWR-group");
    if (cart) {
      const xv = num(P, `${SRC}ext/output-volt`),
        xhz = num(P, `${SRC}ext/output-hertz`);
      txt(doc, "ExtVolt", Math.round(xv), ok(xv >= 110 && xv <= 120));
      txt(doc, "ExtHz", Math.round(xhz), ok(xhz >= 390 && xhz <= 410));
      col(doc, "EXTPWR-label", ok(xv >= 110 && xv <= 120 && xhz >= 390 && xhz <= 410));
    }
  },
};

/** the hydraulic systems' drawings (Lower-ECAM-hyd.nas): their lines and the parts each has */
const HYD_SYS = [
  ["green", "Green", ["Green-Line", "Green-Line-Top", "Green-Line-Middle", "Green-Line-Bottom"]],
  ["blue", "Blue", ["Blue-Line", "Blue-Line-Top", "Blue-Line-Bottom"]],
  ["yellow", "Yellow", ["Yellow-Line", "Yellow-Line-Top", "Yellow-Line-Middle", "Yellow-Line-Bottom"]],
] as const;

const HYD: SdPage = {
  url: hydSvg,
  init() {},
  update(doc, d) {
    const P = d.deck;
    const H = "systems/hydraulic/";
    // (each system's pressure — XX without DC ESS SHED —, its lines green past 1 450 psi)
    const shed = bus(P, "dc-ess-shed") >= 25;
    for (const [s, Id, lines] of HYD_SYS) {
      const p = hyd(d, s);
      const c = ok(shed && p > 1450);
      txt(doc, `Press-${Id}`, !shed ? "XX" : p >= 100 ? roundTo(p, 50) : 0, c);
      for (const l of lines) fill(doc, l, c);
      col(doc, lines[0], c);
      col(doc, `${Id}-Indicator`, c);
      col(doc, `${Id}-label`, shed && p > 1450 ? "white" : "amber");
      // (the reservoir's quantity [l] along its scale: blue 8, green 18, yellow 15; LO AIR PRESS, OVHT)
      const qty = num(P, `${H}${s}-qty`, s === "blue" ? 6.5 : s === "green" ? 14.5 : 12.5);
      const full = s === "blue" ? 8 : s === "green" ? 18 : 15;
      doc.get(`Quantity-Indicator-${Id}`).setTranslation(0, (Math.min(qty, full) / full) * -140 + 140);
      col(doc, `Quantity-Indicator-${Id}`, ok(qty >= (s === "blue" ? 2.4 : 3.5)));
      vis(doc, on(P, `systems/failures/hydraulic/${s}-reservoir-air-press-lo`), `LO-AIR-PRESS-${Id}`);
      vis(doc, on(P, `${H}relays/${s}-reservoir-overheat`), `OVHT-${Id}`);
    }
    vis(doc, on(P, "systems/failures/hydraulic/yellow-elec-ovht"), "ELEC-OVHT-Yellow", "ELEC-OVTH-Yellow");
    vis(doc, on(P, "systems/failures/hydraulic/blue-elec-ovht"), "ELEC-OVHT-Blue");
    // (the engines' pumps' labels: their engine under 59 % N2 amber)
    col(doc, "Pump-Green-label", num(P, "engines/engine/n2-actual", d.eng[0].n2) >= 59 ? "white" : "amber");
    col(doc, "Pump-Yellow-label", num(P, "engines/engine[1]/n2-actual", d.eng[1].n2) >= 59 ? "white" : "amber");
    // (the pumps: off, on, LO pressure)
    for (const [Id, sw, s] of [
      ["Green", "green-edp", "green"],
      ["Yellow", "yellow-edp", "yellow"],
      ["Blue", "blue-elec", "blue"],
    ] as const) {
      const w = on(P, `controls/hydraulic/switches/${sw}`, true),
        p = hyd(d, s) > 1450;
      vis(doc, !w, `Pump-${Id}-off`);
      vis(doc, w && p, `Pump-${Id}-on`);
      vis(doc, w && !p, `Pump-LOPR-${Id}`);
      col(doc, `Pump-${Id}`, ok(w && p));
      fill(doc, `Pump-${Id}`, ok(w && p));
    }
    // (the yellow electric pump, the electric pumps' labels by their buses)
    const ye = on(P, "controls/hydraulic/switches/yellow-elec");
    vis(doc, ye, "ELEC-Yellow-on");
    vis(doc, !ye, "ELEC-Yellow-off");
    col(doc, "ELEC-Yellow-on", ok(hyd(d, "yellow") > 1450));
    col(doc, "ELEC-Blue-label", bus(P, "ac-1") >= 110 && bus(P, "dc-ess") >= 25 ? "white" : "amber");
    col(doc, "ELEC-Yellow-label", bus(P, "ac-2") >= 110 && bus(P, "dc-2") >= 25 ? "white" : "amber");
    // (the PTU: transferring — its arrow toward the system it feeds —, else AUTO / OFF)
    const ptu = on(P, "controls/hydraulic/switches/ptu", true) && !on(P, "systems/failures/hydraulic/ptu");
    const active = ptu && on(P, `${H}sources/ptu/ptu-loop-sound-cmd`);
    const diff = num(P, `${H}yellow-psi-diff`);
    vis(doc, active, "PTU-Supply-Line");
    vis(doc, active && diff < 0, "PTU-supply-yellow");
    vis(doc, active && diff >= 0, "PTU-supply-green");
    vis(doc, !active, "PTU-Auto-or-off");
    // (the RAT, the engines' fire valves)
    const rat = num(P, `${H}sources/rat/position`) > 0.5;
    vis(doc, !rat, "RAT-stowed");
    vis(doc, rat, "RAT-not-stowed");
    for (const [Id, src] of [
      ["Green", "green-edp"],
      ["Yellow", "yellow-edp"],
    ] as const) {
      const shut = num(P, `${H}sources/${src}/fire-valve`) >= 0.1;
      rot(doc, `Fire-Valve-${Id}`, shut ? 90 : 0);
      col(doc, `Fire-Valve-${Id}`, ok(!shut));
      fill(doc, `Fire-Valve-${Id}-Cross`, ok(!shut));
    }
  },
};

const PRESS: SdPage = {
  url: pressSvg,
  init(doc) {
    vis(doc, false, "PRESS-Sys-2", "PRESS-Outlet-Transit-Failed", "PRESS-Inlet-Transit-Failed", "PRESS-Cab-VS-neg");
  },
  update(doc, d) {
    const P = d.deck;
    const c = cabin(d);
    // (Lower-ECAM-press.nas: ΔP amber off −0.4 … 8.5 psi, V/S amber past 2 000 ft/min, the altitude red past 9 550 ft)
    txt(doc, "PRESS-deltaP", Math.min(Math.max(c.dp, -9.9), 31.9).toFixed(1), c.dp < -0.4 || c.dp > 8.5 ? "amber" : "green");
    txt(doc, "PRESS-Cab-VS", Math.min(Math.max(roundTo(c.vs, 50), -9950), 9950), Math.abs(c.vs) > 2000 ? "amber" : "green");
    txt(doc, "PRESS-Cab-Alt", Math.min(Math.max(roundTo(c.alt, 50), -9950), 32750), c.alt > 9550 ? "red" : "green");
    txt(doc, "PRESS-LDG-Elev", 0);
    const auto = on(P, "systems/pressurization/auto", true);
    vis(doc, !auto, "PRESS-Man");
    vis(doc, auto, "PRESS-Sys-1");
    // (the packs: amber closed with their engine running)
    for (const i of [0, 1] as const) {
      const k = i + 1;
      const v = num(P, `systems/air-conditioning/valves/flow-control-valve-${k}`, running(d, 0) || running(d, 1) ? 1 : 0);
      const st = num(P, `engines/engine${i ? "[1]" : ""}/state`, running(d, i) ? 3 : 0);
      const bad = v <= 0.1 && st === 3;
      col(doc, `PRESS-Pack-${k}-Triangle`, bad ? "amber" : "green");
      col(doc, `PRESS-Pack-${k}`, bad ? "amber" : "white");
    }
  },
};

/** the pages by FlightGear's names (the ECAM control panel's buttons: deckgame.ts) */
export const PAGES: Record<string, SdPage> = {
  enginePage: ENG,
  wheelPage: WHEEL,
  fctlPage: FCTL,
  fuelPage: FUEL,
  cruisePage: CRZ,
  doorPage: DOOR,
  statusPage: STATUS,
  apuPage: APU,
  bleedPage: BLEED,
  condPage: COND,
  elecPage: ELEC,
  hydPage: HYD,
  pressPage: PRESS,
};
