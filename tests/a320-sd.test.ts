// The A320's SD pages on its systems (docs/PLAN-A320.md, A11 — src/a320/du/sd-pages.ts): the systems run
// (src/a320/systems — cold and dark, ready) and each page driven from their bag as FlightGear's Lower-ECAM-*.nas drive
// it: cold and dark, the ELEC page's buses amber, DC BAT XX, the HYD page's pressures amber; ready, AC 1 at 115 V, the
// generators online, the three systems at 3 000 psi green; a hydraulic system lost (its pump's failure), it amber and
// LO; the FCTL page's surfaces amber without their systems; the APU page's N and its generator once AVAIL; the bleed's
// valves, the fuel's pumps, the cabin, the doors; the STATUS page's lines.
import { describe, expect, test } from "bun:test";
import { css } from "../src/a320/du/ecam-common";
import type { DuData } from "../src/a320/du/data";
import { PAGES, type SdState } from "../src/a320/du/sd-pages";
import { SvgDoc } from "../src/a320/du/svg";
import { newEngine } from "../src/a320/fadec";
import type { Props } from "../src/a320/rig";
import { A320Systems, type StartState, type SysFrame } from "../src/a320/systems";

const FILES: Record<string, string> = {
  elecPage: "sd-elec.svg",
  hydPage: "sd-hyd.svg",
  fctlPage: "sd-fctl.svg",
  apuPage: "sd-apu.svg",
  bleedPage: "sd-bleed.svg",
  fuelPage: "sd-fuel.svg",
  enginePage: "sd-eng.svg",
  wheelPage: "sd-wheel.svg",
  doorPage: "sd-door.svg",
  pressPage: "sd-press.svg",
  condPage: "sd-cond.svg",
  cruisePage: "sd-crz.svg",
  statusPage: "sd-status.svg",
};

/** The A320 parked at Le Bourget, its systems from a start, run a few seconds. */
function parked(state: StartState, set: Props = {}) {
  const P: Props = {};
  const S = new A320Systems(P, { rand: () => 0.5 });
  const run = state === "ready";
  const es = [newEngine(run), newEngine(run)];
  const frame = (): SysFrame => ({
    elapsed: 0,
    lat: 48.97,
    lon: 2.44,
    altFt: 220,
    aglFt: 0,
    vsFpm: 0,
    onGround: true,
    gear: 1,
    ias: 0,
    gs: 0,
    mach: 0,
    tatC: 15,
    oatC: 15,
    staticInHg: 29.7,
    alphaDeg: 0,
    flapDeg: 0,
    slatDeg: 0,
    engines: es,
    tanks: [690, 5000, 2000, 5000, 690],
    detent: "IDLE",
  });
  S.reset(state, frame());
  Object.assign(P, set);
  for (let k = 0; k < 30 * 20; k++) S.step(1 / 30, frame());
  return { P, S, es };
}

/** the displays' data, the bag's figures and a parked A320's */
function du(P: Props, running: boolean, extra: Partial<DuData> = {}): DuData {
  const eng = { running, n1: running ? 19 : 0, n2: running ? 59.4 : 0, egt: running ? 390 : 15, ff: running ? 300 : 0, rev: 0 };
  return {
    deck: P,
    eng: [eng, { ...eng }],
    onGround: true,
    alt: 220,
    vs: 0,
    gs: 0,
    gw: 64000,
    sat: 15,
    tat: 15,
    tanks: [690, 5000, 2000, 5000, 690],
    fob: 13380,
    fuelUsed: 0,
    gear: { down: true, ext: 1 },
    autobrake: 0,
    spoilers: new Array(10).fill(0),
    surfaces: { ailL: 0, ailR: 0, elevL: 0, elevR: 0, rudder: 0, stab: 0 },
    ...extra,
  } as DuData;
}

const docs = new Map<string, SvgDoc>();
async function page(name: string, d: DuData) {
  let doc = docs.get(name);
  if (!doc) {
    doc = new SvgDoc(await Bun.file(`assets/a320/du/${FILES[name]}`).text());
    PAGES[name]!.init(doc);
    docs.set(name, doc);
  }
  const s: SdState = { fctlUntil: -Infinity, last: "" };
  PAGES[name]!.update(doc, d, s, 1);
  return doc;
}
/** an element's colour: its text's (a text's fill), else its stroke */
const colourOf = (doc: SvgDoc, id: string) => {
  const e = doc.get(id);
  return e.runs[0]?.style.fill ?? e.style.stroke ?? e.style.fill;
};
const AMBER = css("amber"),
  GREEN = css("green");

describe("A320 SD pages on the systems", () => {
  test("cold and dark, the batteries on: ELEC's AC buses amber, DC BAT powered; HYD's pressures amber", async () => {
    const { P } = parked("cold", { "controls/electrical/switches/bat-1": 1, "controls/electrical/switches/bat-2": 1 });
    const elec = await page("elecPage", du(P, false));
    expect(colourOf(elec, "ELEC-AC1-label")).toBe(AMBER);
    expect(colourOf(elec, "ELEC-AC2-label")).toBe(AMBER);
    expect(elec.get("ELEC-DCBAT-label").getText()).toBe("DC BAT");
    expect(colourOf(elec, "ELEC-DCBAT-label")).toBe(GREEN);
    expect(elec.get("BAT1-OFF").visible).toBeFalse();
    expect(elec.get("GEN1-content").visible).toBeTrue();
    expect(elec.get("ELEC-Line-GEN1-AC1").visible).toBeFalse();
    const hyd = await page("hydPage", du(P, false));
    for (const s of ["Green", "Blue", "Yellow"]) expect(colourOf(hyd, `Press-${s}`)).toBe(AMBER);
    // (the batteries off: DC BAT XX, their OFF shown)
    const off = parked("cold");
    const e2 = await page("elecPage", du(off.P, false));
    expect(e2.get("ELEC-DCBAT-label").getText()).toBe("XX");
    expect(e2.get("BAT1-OFF").visible).toBeTrue();
    // (no DC ESS SHED: the pressures XX)
    const h2 = await page("hydPage", du(off.P, false));
    expect(h2.get("Press-Green").getText()).toBe("XX");
  });

  test("ready: AC 1 at 115 V from GEN 1, the three hydraulics at 3 000 psi green, the bleeds open", async () => {
    const { P } = parked("ready");
    const elec = await page("elecPage", du(P, true));
    expect(colourOf(elec, "ELEC-AC1-label")).toBe(GREEN);
    expect(elec.get("Gen1Volt").getText()).toBe("115");
    expect(elec.get("Gen1Hz").getText()).toBe("400");
    expect(elec.get("ELEC-Line-GEN1-AC1").visible).toBeTrue();
    expect(elec.get("ELEC-Line-TR1-DC1").visible).toBeTrue();
    expect(elec.get("TR1Volt").getText()).toBe("28");
    const hyd = await page("hydPage", du(P, true));
    for (const s of ["Green", "Blue", "Yellow"]) {
      expect(hyd.get(`Press-${s}`).getText()).toBe("3000");
      expect(colourOf(hyd, `Press-${s}`)).toBe(GREEN);
      expect(hyd.get(`Pump-LOPR-${s}`).visible).toBeFalse();
    }
    const bleed = await page("bleedPage", du(P, true));
    expect(bleed.get("BLEED-ENG-1").rot).toBeCloseTo(Math.PI / 2, 6);
    expect(bleed.get("BLEED-GND").visible).toBeTrue();
    const fuel = await page("fuelPage", du(P, true));
    expect(fuel.get("FUEL-Pump-Left-1-Open").visible).toBeTrue();
    expect(fuel.get("FUEL-ENG-Master-1").rot).toBe(0);
    expect(fuel.get("FUEL-On-Board").getText()).toBe("13380");
    const fctl = await page("fctlPage", du(P, true));
    expect(colourOf(fctl, "elac1")).toBe(GREEN);
    expect(colourOf(fctl, "ailLblue")).toBe(GREEN);
  });

  test("the green system lost: HYD amber and LO, F/CTL's green actuators amber", async () => {
    const { P } = parked("ready", {
      "controls/hydraulic/switches/ptu": 0,
      "systems/failures/hydraulic/green-edp": 1,
      "systems/failures/hydraulic/green-leak": 1,
    });
    const g = Number(P["systems/hydraulic/green-psi"]);
    console.log(`  green ${g.toFixed(0)} psi, qty ${Number(P["systems/hydraulic/green-qty"]).toFixed(1)} l`);
    expect(g).toBeLessThan(1450);
    const hyd = await page("hydPage", du(P, true));
    expect(colourOf(hyd, "Press-Green")).toBe(AMBER);
    expect(hyd.get("Pump-LOPR-Green").visible).toBeTrue();
    expect(colourOf(hyd, "Press-Blue")).toBe(GREEN);
    const fctl = await page("fctlPage", du(P, true));
    expect(colourOf(fctl, "ailLgreen")).toBe(AMBER);
    expect(colourOf(fctl, "PTgreen")).toBe(AMBER);
    expect(colourOf(fctl, "ailLblue")).toBe(GREEN);
  });

  test("the APU: off, N XX; started — AVAIL, its generator's figures", async () => {
    const off = parked("cold", { "controls/electrical/switches/bat-1": 1, "controls/electrical/switches/bat-2": 1 });
    const apu = await page("apuPage", du(off.P, false));
    expect(apu.get("APUN").getText()).toBe("XX");
    expect(apu.get("APUGenbox").visible).toBeFalse();
    // (MASTER, START: a minute later, AVAIL)
    const { P, S } = parked("cold", { "controls/electrical/switches/bat-1": 1, "controls/electrical/switches/bat-2": 1 });
    P["controls/apu/master"] = 1;
    const es = [newEngine(false), newEngine(false)];
    const frame = (): SysFrame => ({
      elapsed: 0,
      lat: 48.97,
      lon: 2.44,
      altFt: 220,
      aglFt: 0,
      vsFpm: 0,
      onGround: true,
      gear: 1,
      ias: 0,
      gs: 0,
      mach: 0,
      tatC: 15,
      oatC: 15,
      staticInHg: 29.7,
      alphaDeg: 0,
      flapDeg: 0,
      slatDeg: 0,
      engines: es,
      tanks: [690, 5000, 2000, 5000, 690],
      detent: "IDLE",
    });
    for (let k = 0; k < 30 * 4; k++) S.step(1 / 30, frame());
    S.call("systems.APUController.APU.startCommand", []);
    for (let k = 0; k < 30 * 90 && Number(P["systems/apu/available"]) !== 1; k++) S.step(1 / 30, frame());
    for (let k = 0; k < 30 * 5; k++) S.step(1 / 30, frame());
    const on = await page("apuPage", du(P, false));
    expect(on.get("APUAvail").visible).toBeTrue();
    expect(Number(on.get("APUN").getText())).toBeGreaterThan(95);
    expect(colourOf(on, "APUN")).toBe(GREEN);
    expect(on.get("APUGenbox").visible).toBeTrue();
    expect(on.get("APUGenVolt").getText()).toBe("115");
    const elec = await page("elecPage", du(P, false));
    expect(elec.get("APU-content").visible).toBeTrue();
    expect(colourOf(elec, "ELEC-AC1-label")).toBe(GREEN);
  });

  test("the doors, the cabin, the STATUS lines", async () => {
    const { P } = parked("ready", { "sim/model/door-positions/doorl1/position-norm": 1 });
    const door = await page("doorPage", du(P, true));
    expect(door.get("Cabin1LeftLbl").visible).toBeTrue();
    expect(door.get("Cabin1LeftSlide").visible).toBeFalse();
    expect(door.get("Cabin1RightSlide").visible).toBeTrue();
    // (in cruise at FL350: the cabin at some 7 000 ft, ΔP ≈ 8 psi)
    const press = await page("pressPage", du(P, true, { onGround: false, alt: 35000, vs: 0 }));
    const alt = Number(press.get("PRESS-Cab-Alt").getText());
    const dp = Number(press.get("PRESS-deltaP").getText());
    console.log(`  FL350: cabin ${alt} ft, ΔP ${dp} psi`);
    expect(alt).toBeGreaterThan(6000);
    expect(alt).toBeLessThan(8100);
    expect(dp).toBeGreaterThan(7);
    expect(dp).toBeLessThan(8.6);
    // (a leak: the pressurization's own altitude above the schedule — shown, red past 9 550 ft)
    P["systems/pressurization/cabinalt"] = 14000;
    const leak = await page("pressPage", du(P, true, { onGround: false, alt: 35000, vs: 0 }));
    expect(leak.get("PRESS-Cab-Alt").getText()).toBe("14000");
    expect(colourOf(leak, "PRESS-Cab-Alt")).toBe(css("red"));
    // (STATUS: NORMAL alone; the ECAM's lines in their colours)
    const sts = await page("statusPage", du(P, true));
    expect(sts.get("NORMAL").getText()).toBe("NORMAL");
    const lines = await page(
      "statusPage",
      du(P, true, {
        ecamStatus: {
          left: [
            { text: "APPR PROC", colour: "w" },
            { text: "-FOR LDG.....USE FLAP 3", colour: "c" },
          ],
          right: [{ text: "G HYD", colour: "a" }],
        },
      }),
    );
    const runs = lines.get("NORMAL").runs;
    expect(runs.map((r) => r.text)).toEqual(["APPR PROC", "-FOR LDG.....USE FLAP 3", "G HYD"]);
    expect(runs[1]!.style.fill).toBe(css("cyan"));
    expect(runs[2]!.style.fill).toBe(AMBER);
    expect(runs[2]!.x).toBeGreaterThan(500);
  });
});
