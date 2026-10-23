import { describe, expect, test } from "bun:test";
import type { Props } from "../src/a320/rig";
import { JsbSystems, type SysData } from "../src/a320/systems/jsbsys";
import data from "../src/a320/systems/sysdata.json";

// The A320's systems as FlightGear's JSBSim files write them (docs/PLAN-A320.md, A10 — src/a320/systems/jsbsys.ts):
// from cold and dark, the batteries on: the DC BAT bus at ≈ 28 V; the external power, then the engines' generators:
// the AC buses at 115 V; the engines at idle: the green and yellow hydraulics at 3 000 psi; a pushbutton's OFF light
// following its switch. What FlightGear's Nasal or FDM would set is set here by hand (src/a320/systems/inputs.md).

const SYS = data as unknown as SysData;

/** The A320 parked, cold and dark: the -set file's values, the pushbuttons as the crew leaves them (pumps, PTU in), the
 *  reservoirs filled (hydraulics.nas), fuel in the feed tanks, on its wheels, a minute after the flight's start. */
function parked() {
  const S = new JsbSystems(SYS);
  const P: Props = {};
  S.reset(P);
  Object.assign(P, {
    "sim/time/elapsed-sec": 60,
    "gear/gear/wow": 1,
    "gear/gear[1]/wow": 1,
    "gear/gear[2]/wow": 1,
    "fdm/jsbsim/position/wow": 1,
    "fdm/jsbsim/gear/unit/WOW": 1,
    "gear/gear/position-norm": 1,
    "gear/gear[1]/position-norm": 1,
    "gear/gear[2]/position-norm": 1,
    "controls/hydraulic/switches/green-edp": 1,
    "controls/hydraulic/switches/yellow-edp": 1,
    "controls/hydraulic/switches/blue-elec": 1,
    "controls/hydraulic/switches/ptu": 1,
    "systems/hydraulic/blue-qty-input": 8,
    "systems/hydraulic/green-qty-input": 16,
    "systems/hydraulic/yellow-qty-input": 15,
    "fdm/jsbsim/propulsion/tank[5]/contents-lbs": 100,
    "fdm/jsbsim/propulsion/tank[6]/contents-lbs": 100,
  });
  let t = 60;
  const run = (s: number, dt = 1 / 60) => {
    for (let k = 0; k < s / dt; k++) {
      t += dt;
      P["sim/time/elapsed-sec"] = t;
      S.step(P, dt);
    }
  };
  run(1);
  return { S, P, run };
}

const n = (v: number | string | undefined) => Number(v ?? 0);

describe("A320 systems (FlightGear's JSBSim files)", () => {
  test("the batteries: DC BAT ≈ 28 V, the AC buses dead", () => {
    const { P, run } = parked();
    expect(n(P["systems/electrical/bus/dc-bat"])).toBe(0);
    P["controls/electrical/switches/bat-1"] = 1;
    P["controls/electrical/switches/bat-2"] = 1;
    run(3);
    const v = n(P["systems/electrical/bus/dc-bat"]);
    console.log(`  BAT 1+2: DC BAT ${v.toFixed(1)} V, DC ESS ${n(P["systems/electrical/bus/dc-ess"]).toFixed(1)} V`);
    expect(v).toBeGreaterThan(25);
    expect(v).toBeLessThan(29);
    expect(n(P["systems/electrical/bus/ac-1"])).toBe(0);
  });

  test("the external power, then the engines' generators: the AC buses at 115 V", () => {
    const { P, run } = parked();
    P["controls/electrical/switches/bat-1"] = 1;
    P["controls/electrical/switches/bat-2"] = 1;
    P["controls/electrical/switches/ground-cart"] = 1;
    P["controls/electrical/switches/ext-pwr"] = 1;
    run(3);
    const ac = (b: string) => n(P[`systems/electrical/bus/${b}`]);
    console.log(`  EXT PWR: AC 1 ${ac("ac-1")}, AC 2 ${ac("ac-2")}, AC ESS ${ac("ac-ess")}, DC 1 ${ac("dc-1")} V`);
    expect(ac("ac-1")).toBeCloseTo(115, 0);
    expect(ac("ac-2")).toBeCloseTo(115, 0);
    expect(ac("ac-ess")).toBeCloseTo(115, 0);
    expect(ac("dc-1")).toBeGreaterThan(27);
    // (the engines at idle — N2 60 % —, the external power off: the IDGs take the buses)
    P["controls/electrical/switches/ext-pwr"] = 0;
    P["controls/electrical/switches/ground-cart"] = 0;
    P["engines/engine/n2-actual"] = 60;
    P["engines/engine[1]/n2-actual"] = 60;
    run(3);
    console.log(
      `  GEN 1+2: AC 1 ${ac("ac-1").toFixed(1)}, AC 2 ${ac("ac-2").toFixed(1)} V, ${n(P["systems/electrical/sources/idg-1/output-hertz"]).toFixed(0)} Hz`,
    );
    expect(n(P["systems/electrical/relay/gen-1-glc/contact-pos"])).toBe(1);
    expect(ac("ac-1")).toBeCloseTo(115, 0);
    expect(ac("ac-2")).toBeCloseTo(115, 0);
  });

  test("the engines at idle: the green and yellow hydraulics at 3 000 psi, the engines running", () => {
    const { P, run } = parked();
    P["controls/electrical/switches/bat-1"] = 1;
    P["controls/electrical/switches/bat-2"] = 1;
    run(1);
    expect(n(P["systems/hydraulic/green-psi"])).toBe(0);
    P["controls/engines/engine/cutoff-switch"] = 0;
    P["controls/engines/engine[1]/cutoff-switch"] = 0;
    P["engines/engine/n2-actual"] = 60;
    P["engines/engine[1]/n2-actual"] = 60;
    run(1);
    const psi = (s: string) => n(P[`systems/hydraulic/${s}-psi`]);
    const rising = psi("green");
    run(10);
    console.log(
      `  idle: green ${psi("green")}, yellow ${psi("yellow")}, blue ${psi("blue")} psi (green ${rising.toFixed(0)} after 1 s); engines ${P["engines/engine/state"]}, ${P["engines/engine[1]/state"]}`,
    );
    expect(rising).toBeLessThan(3000);
    expect(psi("green")).toBeCloseTo(3000, -1);
    expect(psi("yellow")).toBeCloseTo(3000, -1);
    expect(psi("blue")).toBeGreaterThan(2500);
    expect(n(P["engines/engine/state"])).toBe(3);
  });

  test("a pushbutton's light follows its switch: BAT 1 OFF, GREEN ENG 1 PUMP OFF", () => {
    const { P, run } = parked();
    const L = (k: string) => n(P[`controls/indicators/${k}`]);
    // (BAT 2 alone on: the DC BAT bus powered, BAT 1's OFF lit)
    P["controls/electrical/switches/bat-2"] = 1;
    run(1);
    expect(L("bat1-off")).toBe(1);
    expect(L("bat2-off")).toBe(0);
    P["controls/electrical/switches/bat-1"] = 1;
    run(1);
    expect(L("bat1-off")).toBe(0);
    // (the green pump's OFF light, with AC 1 powered)
    P["controls/electrical/switches/ground-cart"] = 1;
    P["controls/electrical/switches/ext-pwr"] = 1;
    run(2);
    expect(L("hyd-green-eng-pump-off")).toBe(0);
    P["controls/hydraulic/switches/green-edp"] = 0;
    run(1);
    expect(L("hyd-green-eng-pump-off")).toBe(1);
    // (the annunciator test: every one lit)
    P["controls/switches/annun-test"] = 1;
    run(1);
    expect(L("bat1-off")).toBe(1);
    expect(L("bat1-fault")).toBe(1);
  });

  test("the cost: one frame of the 1 102 components", () => {
    const { S, P } = parked();
    Object.assign(P, { "controls/electrical/switches/bat-1": 1, "controls/electrical/switches/bat-2": 1, "engines/engine/n2-actual": 60 });
    for (let k = 0; k < 600; k++) S.step(P, 1 / 60);
    const N = 6000;
    const t0 = performance.now();
    for (let k = 0; k < N; k++) S.step(P, 1 / 60);
    const us = ((performance.now() - t0) / N) * 1000;
    console.log(`  ${us.toFixed(1)} µs a frame`);
    expect(us).toBeLessThan(500);
  });
});
