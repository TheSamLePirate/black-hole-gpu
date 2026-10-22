// The A320's SD's pages (docs/PLAN-A320.md, A7 — sd.ts): each FlightGear page's SVG set at its start (its
// abnormal elements hidden: XX, faults, clogs, the transit parts) and driven each refresh as Lower-ECAM-*.nas drives
// it, from the displays' data. What the game flies is shown as it is: the engines (oil, vibrations, fuel used), the
// fuel's five tanks and flow, the gear and its doors, the autobrake, the spoilers, the flight control surfaces and the
// stabiliser, the configuration. The systems it does not simulate yet (A10: the hydraulics, the electrics, the bleed,
// the packs and the pressurisation, the APU, the doors, the oxygen) show a normal aircraft's figures: the engines'
// pumps and generators online while they run, the APU off, the doors closed with their slides armed, the cabin
// pressurised on Airbus's schedule (≈ 8 000 ft at FL390) — green, nominal — until their step.

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
import type { DuData } from "./data";
import { colour, D2R, roundTo, table, txt, vis } from "./ecam-common";
import type { SvgDoc } from "./svg";

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

// ---------------------------------------------------------------------------------------------- the figures not flown

/** the oil's quantity [qt] (CFM56: 17 full, a little burnt with the hours), pressure [psi] by N2, temperature [°C] */
const oilQt = (d: DuData, i: 0 | 1) => 15.5 - 0.0002 * d.fuelUsed + 0.3 * i;
const oilPsi = (d: DuData, i: 0 | 1) => (running(d, i) ? 30 + 0.45 * Math.max(d.eng[i].n2 - 55, 0) : 0);
const oilTemp = (d: DuData, i: 0 | 1) => (running(d, i) ? 55 + 0.6 * Math.max(d.eng[i].n2 - 55, 0) : Math.round(d.sat + 10));
/** the vibrations (N1, N2: a few tenths, with the speeds) */
const vib = (n: number) => (0.15 + 0.004 * n).toFixed(1);
/** the cabin on Airbus's schedule: its altitude [ft], the pressure difference [psi], its vertical speed [ft/min] */
const cabin = (d: DuData) => {
  const p = (h: number) => 14.696 * (1 - 6.8756e-6 * h) ** 5.2559;
  const alt = d.onGround ? d.alt : Math.max(Math.min(d.alt * 0.205, 8000), Math.min(d.alt, 0));
  return { alt, dp: Math.max(p(alt) - p(d.alt), 0), vs: d.onGround || alt >= 8000 ? 0 : d.vs * 0.205 };
};
/** a hydraulic system's pressure [psi]: the engine-driven pumps' (green: engine 1, yellow: 2), the blue's electric */
const hydPsi = (d: DuData) => ({
  green: running(d, 0) ? 3000 : 0,
  yellow: running(d, 1) ? 3000 : 0,
  blue: running(d, 0) || running(d, 1) ? 3000 : 0,
});

// ---------------------------------------------------------------------------------------------- the pages

const ENG: SdPage = {
  url: engSvg,
  init(doc) {
    vis(doc, false, "FUEL-clog-1", "FUEL-clog-2", "OIL-clog-1", "OIL-clog-2", "OilQT1-XX", "OilQT2-XX");
    txt(doc, "Fused-weight-unit", "KG");
    txt(doc, "Fused-oil-unit", "QT");
  },
  update(doc, d) {
    for (const i of [0, 1] as const) {
      const k = i + 1;
      const q = oilQt(d, i);
      txt(doc, `OilQT${k}`, Math.floor(q));
      txt(doc, `OilQT${k}-decimal`, Math.floor((q % 1) * 2) * 5);
      doc.get(`OilQT${k}-needle`).setRotation(Math.min(Math.max(q, 0), 27) * 6.66 * D2R);
      const psi = oilPsi(d, i);
      txt(doc, `OilPSI${k}`, Math.min(roundTo(psi, 2), 998), psi >= 13 ? "green" : "red");
      doc.get(`OilPSI${k}-needle`).setRotation(Math.min(Math.max(psi, 0), 100) * 1.8 * D2R);
      colour(doc, `OilPSI${k}-needle`, psi >= 13 ? "green" : "red");
      txt(doc, `OilTemp${k}`, Math.round(oilTemp(d, i)), "green");
      txt(doc, `FUEL-used-${k}`, roundTo(d.fuelUsed / 2, 10));
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
    // (normal braking on the green system, the anti-skid and the nose wheel steering working: their warnings away)
    vis(
      doc,
      false,
      "NWStext",
      "NWS",
      "NWSrect",
      "antiskidtext",
      "BSCUrect1",
      "BSCUrect2",
      "BSCU1",
      "BSCU2",
      "NORMbrk",
      "normbrk-rect",
      "normbrkhyd",
    );
    vis(doc, false, "ALTNbrk", "altnbrk-rect", "altnbrkhyd", "accuonlyarrow", "accuonly", "brakearrow", "accupress_text");
    for (const s of ["L", "R"]) for (let i = 1; i <= 4; i++) vis(doc, false, `release${s}${i}`);
    for (const s of ["L", "R"]) for (let i = 1; i <= 5; i++) vis(doc, false, `spoiler${i}${s}f`);
  },
  update(doc, d, _s, t) {
    // (the gear: its triangles, green down and locked, red in transit; L/G CTL while the gear and its lever disagree)
    const g = d.gear.ext;
    for (const leg of ["Nose", "Left", "Right"]) {
      vis(doc, g >= 0.2, `Triangle-${leg}1`, `Triangle-${leg}2`);
      colour(doc, `Triangle-${leg}1`, g >= 0.99 ? "green" : "red");
      colour(doc, `Triangle-${leg}2`, g >= 0.99 ? "green" : "red");
    }
    vis(doc, (d.gear.down && g < 0.99) || (!d.gear.down && g > 0.01), "lgctltext");
    // (the doors: open while the gear moves — turned, amber —, closed green)
    const doorOpen = g > 0.01 && g < 0.99 ? 1 : 0;
    for (const [id, deg] of [
      ["leftdoor", -80],
      ["rightdoor", 80],
      ["nosegeardoorL", -80],
      ["nosegeardoorR", 80],
    ] as const) {
      rot(doc, id, deg * doorOpen);
      doc.get(id).setColorFill(doorOpen ? "rgb(187,97,0)" : "rgb(13,192,75)");
    }
    // (the autobrake)
    vis(doc, d.autobrake > 0, "autobrkind", "autobrk");
    txt(doc, "autobrkind", ["", "LO", "MED", "MAX"][d.autobrake]!);
    // (the brakes' temperatures: warmed by their work — the deceleration on the ground — and cooling)
    for (let i = 0; i < 4; i++) {
      const T = brakeTemp(d, t, i);
      txt(doc, `braketemp${i + 1}`, roundTo(T, 5), T > 300 ? "amber" : "green");
      vis(doc, T > 100 && T === Math.max(...[0, 1, 2, 3].map((j) => brakeTemp(d, t, j))), `toparc${i + 1}`);
    }
    // (the spoilers: extended past 1.5°)
    spoilers(doc, d);
  },
};

/** the brakes' temperatures [°C]: the air's, warmed by the braking (its work), cooling with a time constant of ≈ 15
 *  min — one model for the four (the inner ones a few degrees warmer) */
const brakes = { T: Number.NaN, t: 0, v: 0 };
function brakeTemp(d: DuData, t: number, i: number) {
  if (i === 0) {
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

function spoilers(doc: SvgDoc, d: DuData) {
  ["L", "R"].forEach((s, side) => {
    for (let i = 1; i <= 5; i++) {
      const out = (d.spoilers[side * 5 + i - 1] ?? 0) >= 1.5;
      vis(doc, out, `spoiler${i}${s}ex`);
      vis(doc, !out, `spoiler${i}${s}rt`);
    }
  });
}

const FCTL: SdPage = {
  url: fctlSvg,
  init(doc) {
    for (const s of ["L", "R"]) for (let i = 1; i <= 5; i++) vis(doc, false, `spoiler${i}${s}f`);
  },
  update(doc, d) {
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
    doc.get("rudderTrimInd").setRotation(0);
    // (the stabiliser's trim [°], UP / DN)
    const pt = -S.stab;
    txt(doc, "PT", pt.toFixed(1));
    vis(doc, Math.abs(pt) >= 0.09, "PTupdn");
    txt(doc, "PTupdn", pt >= 0.09 ? "UP" : "DN");
    // (the computers and the hydraulics feeding each surface: green — A10 for their failures)
    const h = hydPsi(d);
    for (const [id, sys] of [
      ["ailLblue", "blue"],
      ["ailRblue", "blue"],
      ["elevLblue", "blue"],
      ["elevRblue", "blue"],
      ["rudderblue", "blue"],
      ["spdbrkblue", "blue"],
      ["ailLgreen", "green"],
      ["ailRgreen", "green"],
      ["elevLgreen", "green"],
      ["ruddergreen", "green"],
      ["PTgreen", "green"],
      ["spdbrkgreen", "green"],
      ["elevRyellow", "yellow"],
      ["rudderyellow", "yellow"],
      ["PTyellow", "yellow"],
      ["spdbrkyellow", "yellow"],
    ] as const)
      colour(doc, id, h[sys] >= 1500 ? "green" : "amber");
    spoilers(doc, d);
  },
};

const FUEL: SdPage = {
  url: fuelSvg,
  init(doc) {
    vis(doc, false, "FUEL-Left-blocked", "FUEL-Right-blocked", "FUEL-Center-blocked", "FUEL-Left-Transfer", "FUEL-Right-Transfer");
    vis(
      doc,
      false,
      "FUEL-Left-Outer-Inacc",
      "FUEL-Left-Inner-Inacc",
      "FUEL-Center-Inacc",
      "FUEL-Right-Inner-Inacc",
      "FUEL-Right-Outer-Inacc",
    );
    // (the APU's feed: the APU off)
    vis(doc, false, "FUEL-APU-arrow", "FUEL-APU-line");
    // (the cross-feed valve closed, its pipes dry)
    vis(doc, false, "FUEL-XFEED-pipes");
    rot(doc, "FUEL-XFEED", 90);
    txt(doc, "FOB-weight-unit", "KG");
    txt(doc, "Fused-weight-unit", "KG");
    txt(doc, "FFlow-weight-unit", "KG/MIN");
  },
  update(doc, d) {
    const T = d.tanks;
    txt(doc, "FUEL-Left-Outer-quantity", roundTo(T[0] ?? 0, 10));
    txt(doc, "FUEL-Left-Inner-quantity", roundTo(T[1] ?? 0, 10));
    txt(doc, "FUEL-Center-quantity", roundTo(T[2] ?? 0, 10));
    txt(doc, "FUEL-Right-Inner-quantity", roundTo(T[3] ?? 0, 10));
    txt(doc, "FUEL-Right-Outer-quantity", roundTo(T[4] ?? 0, 10));
    txt(doc, "FUEL-On-Board", roundTo(d.fob, 10));
    txt(doc, "FUEL-used-1", roundTo(d.fuelUsed / 2, 10));
    txt(doc, "FUEL-used-2", roundTo(d.fuelUsed / 2, 10));
    txt(doc, "FUEL-used-both", roundTo(d.fuelUsed, 10));
    txt(doc, "FUEL-Flow-per-min", Math.round((d.eng[0].ff + d.eng[1].ff) / 60));
    // (the pumps: running — the centre's with fuel in it, else stopped, white —; the engines' LP valves open while they
    // run)
    const centre = (T[2] ?? 0) > 10;
    for (const [p, on] of [
      ["Left-1", true],
      ["Left-2", true],
      ["Right-1", true],
      ["Right-2", true],
      ["Center-1", centre],
      ["Center-2", centre],
    ] as const) {
      vis(doc, on, `FUEL-Pump-${p}-Open`);
      vis(doc, !on, `FUEL-Pump-${p}-Closed`);
      colour(doc, `FUEL-Pump-${p}`, on ? "green" : "white");
    }
    for (const i of [0, 1] as const) {
      const k = i + 1;
      rot(doc, `FUEL-ENG-Master-${k}`, d.eng[i].running ? 0 : 90);
      colour(doc, `FUEL-ENG-${k}-label`, d.eng[i].running ? "white" : "amber");
    }
    // (the wings' fuel temperatures: the outer air's, warmed in the tanks)
    for (const id of ["FUEL-Left-Outer-temp", "FUEL-Left-Inner-temp", "FUEL-Right-Inner-temp", "FUEL-Right-Outer-temp"])
      txt(doc, id, Math.round(Math.max(d.sat + 15, -40)));
  },
};

const CRZ: SdPage = {
  url: crzSvg,
  init(doc) {
    txt(doc, "Fused-weight-unit", "KG");
    txt(doc, "OilUnit", "QT");
  },
  update(doc, d) {
    txt(doc, "FUsed1", roundTo(d.fuelUsed / 2, 10));
    txt(doc, "FUsed2", roundTo(d.fuelUsed / 2, 10));
    txt(doc, "FUsed", roundTo(d.fuelUsed, 10));
    txt(doc, "Oil1", oilQt(d, 0).toFixed(1));
    txt(doc, "Oil2", oilQt(d, 1).toFixed(1));
    txt(doc, "VIB1N1", vib(d.eng[0].n1));
    txt(doc, "VIB1N2", vib(d.eng[0].n2 * 0.8));
    txt(doc, "VIB2N1", vib(d.eng[1].n1));
    txt(doc, "VIB2N2", vib(d.eng[1].n2 * 0.8));
    const c = cabin(d);
    txt(doc, "deltaPSI", Math.min(c.dp, 31.9).toFixed(1));
    txt(doc, "CABVS", roundTo(c.vs, 50));
    txt(doc, "CABALT", roundTo(c.alt, 50));
    vis(doc, c.vs > 50, "VS-Arrow-UP");
    vis(doc, c.vs < -50, "VS-Arrow-DN");
    txt(doc, "LDGELEV", 0);
    for (const id of ["CKPT-TEMP", "FWD-TEMP", "AFT-TEMP"]) txt(doc, id, 23);
  },
};

const DOOR: SdPage = {
  url: doorSvg,
  init(doc) {
    // (FlightGear's start: the A320's doors 2 and 3 are the overwing exits; the avionics' hatches closed)
    vis(doc, false, "AvionicsLine1", "AvionicsLine2", "AvionicsLbl1", "AvionicsLbl2", "ExitLLine", "ExitLLbl", "ExitRLine", "ExitRLbl");
    for (const n of [2, 3])
      for (const s of ["Left", "Right"]) vis(doc, false, `Cabin${n}${s}`, `Cabin${n}${s}Line`, `Cabin${n}${s}Lbl`, `Cabin${n}${s}Slide`);
    // (all closed: their outlines green, their labels away, the slides armed)
    for (const n of [1, 4])
      for (const s of ["Left", "Right"]) {
        colour(doc, `Cabin${n}${s}`, "green");
        doc.get(`Cabin${n}${s}`).setColorFill("#000");
        vis(doc, false, `Cabin${n}${s}Lbl`, `Cabin${n}${s}Line`);
        vis(doc, true, `Cabin${n}${s}Slide`);
      }
    for (const c of ["Cargo1", "Cargo2"]) {
      colour(doc, `${c}Door`, "green");
      doc.get(`${c}Door`).setColorFill("#000");
      vis(doc, false, `${c}Lbl`, `${c}Line`);
    }
    colour(doc, "Bulk", "green");
    doc.get("Bulk").setColorFill("#000");
    vis(doc, false, "BulkLbl", "BulkLine", "DOOROXY-REGUL-LO-PR");
  },
  update(doc, d) {
    txt(doc, "DOOROXY-PR", 1850);
    const c = cabin(d);
    txt(doc, "DOOR-VS", `${c.vs >= 0 ? "+" : ""}${roundTo(c.vs, 50)}`);
    vis(doc, !d.onGround, "DOOR-VS", "DOOR-VS-Container");
  },
};

const STATUS: SdPage = {
  url: statusSvg,
  init() {},
  update() {},
};

const APU: SdPage = {
  url: apuSvg,
  init(doc) {
    // (the APU off — its master switch, its start: A10 —: its generator's figures away, its bleed valve closed)
    vis(doc, false, "APUAvail", "APUFlapOpen", "APUfuelLO", "APU-low-oil", "APUGenOnline", "APUGenOff", "APUBleedOnline");
    vis(doc, false, "APUGenbox", "APUGenHz", "APUGenVolt", "APUGenLoad", "text3724", "text3728", "text3732");
    rot(doc, "APUBleedValve", 0);
  },
  update(doc, d) {
    txt(doc, "APUN", 0);
    txt(doc, "APUEGT", roundTo(d.sat + 10, 5));
    doc.get("APUN-needle").setRotation(
      (table(0, [
        [0, -120],
        [100, 0],
      ]) +
        90) *
        D2R,
    );
    txt(doc, "APUBleedPSI", "XX", "amber");
  },
};

const BLEED: SdPage = {
  url: bleedSvg,
  init(doc) {
    vis(
      doc,
      false,
      "BLEED-ANTI-ICE-ARROW-LEFT",
      "BLEED-ANTI-ICE-ARROW-RIGHT",
      "BLEED-xbleedLeft",
      "BLEED-xbleedCenter",
      "BLEED-xbleedRight",
    );
    vis(
      doc,
      false,
      "BLEED-APU-LINES",
      "BLEED-APU-connectionTop",
      "BLEED-HP-1-connection",
      "BLEED-HP-2-connection",
      "BLEED-Ram-Air-connection",
    );
    vis(doc, false, "BLEED-Anti-Ice-Left", "BLEED-Anti-Ice-Right");
  },
  update(doc, d) {
    const both = [running(d, 0), running(d, 1)];
    // (the engines' bleed valves open while they run, the HP valves closed above idle, the cross-bleed and the APU's
    // closed, the ram air closed; the packs' flow valves open)
    rot(doc, "BLEED-ENG-1", both[0] ? 90 : 0);
    rot(doc, "BLEED-ENG-2", both[1] ? 90 : 0);
    rot(doc, "BLEED-HP-Valve-1", d.eng[0].n1 < 30 && both[0] ? 90 : 0);
    rot(doc, "BLEED-HP-Valve-2", d.eng[1].n1 < 30 && both[1] ? 90 : 0);
    rot(doc, "BLEED-XFEED", 90);
    // (each valve's drawing its own: FlightGear's angles — the APU's, the packs', the cross-bleed's open at 0°)
    rot(doc, "BLEED-APU-CIRCLE", 90);
    rot(doc, "BLEED-Ram-Air", 90);
    rot(doc, "BLEED-Pack-1-Flow-Valve", both[0] || both[1] ? 0 : 90);
    rot(doc, "BLEED-Pack-2-Flow-Valve", both[0] || both[1] ? 0 : 90);
    vis(doc, d.onGround, "BLEED-GND");
    for (const i of [0, 1] as const) {
      const k = i + 1;
      txt(doc, `BLEED-Precooler-${k}-Inlet-Press`, both[i] ? Math.round(28 + 0.08 * d.eng[i].n1) : 0);
      txt(doc, `BLEED-Precooler-${k}-Outlet-Temp`, both[i] ? roundTo(170 + 0.4 * d.eng[i].n1, 5) : roundTo(d.sat, 5));
      txt(doc, `BLEED-Pack-${k}-Out-Temp`, both[i] ? 12 : Math.round(d.sat));
      txt(doc, `BLEED-Pack-${k}-Comp-Out-Temp`, both[i] ? roundTo(150, 5) : Math.round(d.sat));
      doc.get(`BLEED-Pack-${k}-Packflow-needle`).setRotation((both[i] ? 0 : -50) * D2R);
      doc.get(`BLEED-Pack-${k}-Bypass-needle`).setRotation(0);
    }
  },
};

const COND: SdPage = {
  url: condSvg,
  init(doc) {
    vis(doc, false, "CONDFanFwdFault", "CONDFanAftFault");
    rot(doc, "CONDHotAirValve", 0);
  },
  update(doc) {
    for (const z of ["CKPT", "FWD", "AFT"]) {
      txt(doc, `CONDTemp${z}`, 23);
      txt(doc, `CONDDuctTemp${z}`, 21);
      rot(doc, `CONDTrimValve${z}`, 0);
    }
  },
};

const ELEC: SdPage = {
  url: elecSvg,
  init(doc) {
    // (normal: the two engine generators on their AC buses, the APU's and the ground's away, the emergency generator
    // and the static inverter idle; nothing shed)
    vis(
      doc,
      false,
      "EXTPWR-group",
      "APU-content",
      "APUGEN-off",
      "EMERGEN-group",
      "EMERGEN-Label-off",
      "STATINV-group",
      "ACESS-SHED",
      "Shed-label",
      "GalleyShed",
    );
    vis(
      doc,
      false,
      "IDG1-LOPR",
      "IDG1-DISC",
      "IDG2-LOPR",
      "IDG2-DISC",
      "BAT1-OFF",
      "BAT2-OFF",
      "BAT1-charge",
      "BAT1-discharge",
      "BAT2-charge",
      "BAT2-discharge",
    );
    vis(
      doc,
      false,
      "ELEC-Line-APU-AC1",
      "ELEC-Line-APU-EXT",
      "ELEC-Line-EXT-AC2",
      "APU-out",
      "EXT-out",
      "ELEC-Line-Emergen-ESSTR",
      "ELEC-Line-Emergen-ESSTR-off",
      "ESSTR-group",
    );
    vis(doc, false, "ELEC-Line-ESSTR-DCESS", "ELEC-Line-ESSTR-DCESS-off", "ELEC-ACESS-SHED-label", "EMERGEN-out");
  },
  update(doc, d) {
    for (const i of [0, 1] as const) {
      const k = i + 1;
      const on = running(d, i);
      vis(doc, !on, `GEN${k}-off`);
      vis(doc, on, `ELEC-Line-GEN${k}-AC${k}`);
      txt(doc, `Gen${k}Load`, on ? Math.round(18 + 0.05 * d.eng[i].n2) : 0);
      txt(doc, `Gen${k}Volt`, on ? 115 : 0);
      txt(doc, `Gen${k}Hz`, on ? 400 : 0);
      txt(doc, `ELEC-IDG-${k}-Temp`, on ? Math.round(45 + 0.2 * d.eng[i].n2) : Math.round(d.sat));
      txt(doc, `TR${k}Volt`, 28);
      txt(doc, `TR${k}Ampere`, 150);
      txt(doc, `Bat${k}Volt`, 28);
      txt(doc, `Bat${k}Ampere`, 0);
    }
  },
};

const HYD: SdPage = {
  url: hydSvg,
  init(doc) {
    vis(
      doc,
      false,
      "ELEC-OVTH-Yellow",
      "ELEC-OVHT-Blue",
      "ELEC-OVHT-Yellow",
      "LO-AIR-PRESS-Green",
      "LO-AIR-PRESS-Yellow",
      "LO-AIR-PRESS-Blue",
    );
    vis(
      doc,
      false,
      "OVHT-Green",
      "OVHT-Blue",
      "OVHT-Yellow",
      "RAT-not-stowed",
      "ELEC-Yellow-on",
      "Pump-Green-off",
      "Pump-Yellow-off",
      "Pump-Blue-off",
    );
    vis(
      doc,
      false,
      "Pump-LOPR-Green",
      "Pump-LOPR-Yellow",
      "Pump-LOPR-Blue",
      "PTU-supply-yellow",
      "PTU-supply-green",
      "Fire-Valve-Yellow-Cross",
      "Fire-Valve-Green-Cross",
    );
    rot(doc, "Fire-Valve-Green", 0);
    rot(doc, "Fire-Valve-Yellow", 0);
  },
  update(doc, d) {
    const h = hydPsi(d);
    for (const [s, Id] of [
      ["green", "Green"],
      ["blue", "Blue"],
      ["yellow", "Yellow"],
    ] as const) {
      const p = h[s];
      txt(doc, `Press-${Id}`, roundTo(p, 50), p >= 1500 ? "green" : "amber");
      colour(doc, `${Id}-label`, p >= 1500 ? "white" : "amber");
      vis(doc, p >= 1500, `Pump-${Id}-on`);
      vis(doc, p < 1500, `Pump-LOPR-${Id}`);
    }
    // (the reservoirs full: Systems' 8, 18, 15 l scales)
    doc.get("Quantity-Indicator-Blue").setTranslation(0, (6.5 / 8) * -140 + 140);
    doc.get("Quantity-Indicator-Green").setTranslation(0, (14.5 / 18) * -140 + 140);
    doc.get("Quantity-Indicator-Yellow").setTranslation(0, (12.5 / 15) * -140 + 140);
  },
};

const PRESS: SdPage = {
  url: pressSvg,
  init(doc) {
    vis(doc, false, "PRESS-Man", "PRESS-Sys-2", "PRESS-Outlet-Transit-Failed", "PRESS-Inlet-Transit-Failed", "PRESS-Cab-VS-neg");
  },
  update(doc, d) {
    const c = cabin(d);
    txt(doc, "PRESS-deltaP", Math.min(c.dp, 31.9).toFixed(1));
    txt(doc, "PRESS-Cab-VS", roundTo(c.vs, 50));
    txt(doc, "PRESS-Cab-Alt", roundTo(c.alt, 50));
    txt(doc, "PRESS-LDG-Elev", 0);
    const on = running(d, 0) || running(d, 1);
    colour(doc, "PRESS-Pack-1", on ? "white" : "amber");
    colour(doc, "PRESS-Pack-2", on ? "white" : "amber");
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
