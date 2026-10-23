import { describe, expect, test } from "bun:test";
import { limits, newEngine, stepEngine } from "../src/a320/fadec";
import type { Props } from "../src/a320/rig";
import { A320Systems, type SysFrame } from "../src/a320/systems";

// The A320's engine start (docs/PLAN-A320.md, A10 — src/a320/fadec.ts stepEngine's phases, FGTurbine's): the starter
// spins N2 to its ignition's 28.5 % at 1.845 %/s; the fuel lit past 15 %, both spools up to idle at their start rates
// (N2 at 1.127 %/s: some 30 s from light-off), the EGT up; running at idle; the fuel cut: spooling down.

const air = { altFt: 0, densFt: 0, tatC: 15, mach: 0, onGround: true, flapLever: 0 };

describe("A320 engine start", () => {
  test("starter, light-off, idle; then the fuel cut", () => {
    let e = newEngine(false);
    const L = limits(air);
    const want = { n1: L.idle, reverse: 0 };
    let t = 0;
    // (the starter alone: N2 to 28.5 %)
    while (e.n2 < 28.4 && t < 60) {
      e = stepEngine(e, want, air, 0.1, { starter: true, cutoff: true });
      t += 0.1;
    }
    console.log(`  cranked to N2 ${e.n2.toFixed(1)} % in ${t.toFixed(1)} s`);
    expect(t).toBeGreaterThan(12);
    expect(t).toBeLessThan(20);
    expect(e.running).toBeFalse();
    // (the fuel: light-off, idle)
    let s = 0,
      egtMax = 0;
    while (!e.running && s < 120) {
      e = stepEngine(e, want, air, 0.1, { starter: true, cutoff: false });
      egtMax = Math.max(egtMax, e.egt);
      s += 0.1;
    }
    console.log(
      `  idle after ${s.toFixed(1)} s: N1 ${e.n1.toFixed(1)}, N2 ${e.n2.toFixed(1)}, EGT ${e.egt.toFixed(0)} (max ${egtMax.toFixed(0)})`,
    );
    expect(e.running).toBeTrue();
    expect(s).toBeGreaterThan(20);
    expect(s).toBeLessThan(60);
    expect(egtMax).toBeGreaterThan(550);
    expect(egtMax).toBeLessThan(750);
    // (the fuel cut: running no more, spooling down)
    for (let k = 0; k < 100; k++) e = stepEngine(e, want, air, 0.1, { starter: false, cutoff: true });
    expect(e.running).toBeFalse();
    expect(e.n2).toBeLessThan(10);
  });
});

// The whole start, from cold and dark, the systems (src/a320/systems) and the FADEC together: the batteries, the
// APU's MASTER and START, its bleed; the ENG MODE at IGN/START, ENG 1 MASTER ON: the starter, the fuel, idle — the
// IDG's AC 1 at 115 V, the green hydraulics at 3 000 psi.

const frame = (es: { n1: number; n2: number; egt: number; ff: number }[]): SysFrame => ({
  elapsed: 0,
  lat: 48.7,
  lon: 2.4,
  altFt: 300,
  aglFt: 0,
  vsFpm: 0,
  onGround: true,
  gear: 1,
  ias: 0,
  gs: 0,
  mach: 0,
  tatC: 15,
  oatC: 15,
  staticInHg: 29.6,
  alphaDeg: 0,
  flapDeg: 0,
  slatDeg: 0,
  engines: es,
  tanks: [690, 5000, 0, 5000, 690],
  detent: "IDLE",
  fuelUsed: [0, 0],
});

describe("A320 start from cold and dark", () => {
  test("the batteries, the APU, its bleed, ENG 1: idle, AC 1, green", () => {
    const P: Props = {};
    const S = new A320Systems(P, { rand: () => 0.5 });
    let es = [newEngine(false), newEngine(false)];
    S.reset("cold", frame(es));
    const L = limits(air);
    const want = { n1: L.idle, reverse: 0 };
    const run = (s: number, until?: () => boolean) => {
      for (let k = 0; k < s * 30; k++) {
        S.step(1 / 30, frame(es));
        const c = S.engineCtl();
        es = es.map((e, i) => stepEngine(e, want, air, 1 / 30, c[i]));
        if (until?.()) return k / 30;
      }
      return s;
    };
    run(1);
    expect(S.bus("dc-bat")).toBeLessThan(5);
    expect(S.acEss).toBeFalse();
    P["controls/electrical/switches/bat-1"] = P["controls/electrical/switches/bat-2"] = 1;
    run(2);
    console.log(`  BAT: DC BAT ${S.bus("dc-bat").toFixed(1)} V`);
    expect(S.bus("dc-bat")).toBeGreaterThan(25);
    // (the APU: MASTER, START; available a minute later; its generator, its bleed)
    P["controls/apu/master"] = 1;
    run(4);
    S.call("systems.APUController.APU.startCommand", []);
    const tApu = run(120, () => Number(P["systems/apu/available"]) === 1);
    run(5);
    console.log(`  APU AVAIL after ${tApu.toFixed(0)} s: AC 1 ${S.bus("ac-1").toFixed(0)} V`);
    expect(Number(P["systems/apu/available"])).toBe(1);
    expect(S.bus("ac-1")).toBeGreaterThan(100);
    P["controls/pneumatics/switches/apu"] = 1;
    run(5);
    // (ENG MODE IGN/START, ENG 1 MASTER ON)
    P["controls/ignition/start-sw"] = 2;
    run(2);
    P["controls/engines/engine/cutoff-switch"] = 0;
    const tStart = run(120, () => es[0]!.running);
    console.log(`  ENG 1 at idle after ${tStart.toFixed(0)} s: N2 ${es[0]!.n2.toFixed(1)}, state ${P["engines/engine/state"]}`);
    expect(es[0]!.running).toBeTrue();
    expect(es[1]!.running).toBeFalse();
    run(15);
    expect(Number(P["engines/engine/state"])).toBe(3);
    expect(S.psi("green")).toBeGreaterThan(2500);
    // (the starter valve closed past the cut-out — JSBSim's starter held on while the engine runs: its rule)
    expect(Number(P["systems/ignition/starter-1"])).toBe(0);
  });

  test("ready: the engines running, the buses and the hydraulics on, the APU off", () => {
    const P: Props = {};
    const S = new A320Systems(P, { rand: () => 0.5 });
    const es = [newEngine(true), newEngine(true)];
    S.reset("ready", frame(es));
    for (let k = 0; k < 60; k++) S.step(1 / 30, frame(es));
    console.log(
      `  AC 1 ${S.bus("ac-1").toFixed(0)}, AC 2 ${S.bus("ac-2").toFixed(0)}, DC ESS ${S.bus("dc-ess").toFixed(1)}, G ${S.psi("green").toFixed(0)} Y ${S.psi("yellow").toFixed(0)} B ${S.psi("blue").toFixed(0)}`,
    );
    expect(S.bus("ac-1")).toBeGreaterThan(100);
    expect(S.bus("ac-2")).toBeGreaterThan(100);
    expect(S.acEss).toBeTrue();
    expect(S.psi("green")).toBeGreaterThan(2500);
    expect(S.psi("yellow")).toBeGreaterThan(2500);
    expect(S.engineCtl().every((c) => !c.cutoff)).toBeTrue();
    expect(Number(P["systems/ignition/starter-1"]) + Number(P["systems/ignition/starter-2"])).toBe(0);
    expect(Number(P["systems/apu/available"] ?? 0)).toBe(0);
  });
});
