import { describe, expect, test } from "bun:test";
import type { Props } from "../src/a320/rig";
import { Adirs, Apu, calcAlignTime, Fire, nasalModules } from "../src/a320/systems/nasal";
import type { NasalModule, StartState } from "../src/a320/systems/types";

// FlightGear's A320 Nasal systems ported (docs/PLAN-A320.md, A10 — src/a320/systems/nasal/): the APU from its MASTER SW
// to AVAIL in about a minute, then its stop and cooldown; the IRs aligned in a time by the latitude, NAV and the PFD's
// attitude; the fire TEST lighting the fire pushbuttons, an agent discharged; each module's cold and ready states.

/** the buses as a320-electrical.xml would have them with the batteries on (and the AC with power) */
const BUSES = (P: Props, ac = false) => {
  for (const b of ["dc-bat", "dc-ess", "dc-hot-1", "dc-hot-2", "dc-1", "dc-2"]) P[`systems/electrical/bus/${b}`] = 28;
  for (const b of ["ac-ess", "ac-ess-shed", "ac-1", "ac-2"]) P[`systems/electrical/bus/${b}`] = ac ? 115 : 0;
};
const run = (m: NasalModule, P: Props, s: number, until?: () => boolean, dt = 0.05) => {
  for (let t = 0; t < s; t += dt) {
    m.step(P, dt);
    if (until?.()) return t + dt;
  }
  return null;
};

describe("A320 Nasal systems", () => {
  test("the APU: MASTER SW on, START, AVAIL in about a minute; off: the cooldown after the bleed, the run down", () => {
    const P: Props = {};
    const A = new Apu();
    A.reset(P, "cold");
    BUSES(P);
    P["controls/apu/master"] = 1;
    A.step(P, 0.05);
    expect(P["systems/apu/dc-bat-three-minutes"]).toBe(1);
    expect(P["systems/fuel/valves/apu-lp-valve-cmd"]).toBe(1);
    // (START pushed 2 s later — as the deck does, the call answered)
    run(A, P, 2);
    expect(A.call("systems.APUController.APU.startCommand", [], P)).toBeTrue();
    expect(P["systems/apu/start"]).toBe(1);
    const t = run(A, P, 120, () => P["systems/apu/available"] === 1);
    const total = 2.05 + (t ?? Infinity);
    console.log(`  APU: AVAIL ${total.toFixed(1)} s after the MASTER SW, N1 ${Number(P["engines/engine[2]/n1"]).toFixed(1)} %`);
    expect(total).toBeGreaterThan(45);
    expect(total).toBeLessThan(75);
    expect(P["systems/apu/start"]).toBe(0);
    expect(P["controls/engines/engine[2]/starter"]).toBe(0);
    expect(P["controls/apu/inlet-flap/position-norm"]).toBe(1);
    expect(A.state).toBe(5);
    // (the bleed used, then the MASTER off: 2 minutes' cooldown, then the run down, the flap shut)
    P["controls/pneumatics/switches/apu"] = 1;
    run(A, P, 5);
    P["controls/pneumatics/switches/apu"] = 0;
    A.step(P, 0.05);
    P["controls/apu/master"] = 0;
    run(A, P, 60);
    expect(A.state).toBe(6);
    expect(P["systems/apu/available"]).toBe(1);
    const off = run(A, P, 200, () => A.state === 0);
    expect(off).not.toBeNull();
    expect(P["systems/apu/available"]).toBe(0);
    expect(Number(P["engines/engine[2]/n1"])).toBeLessThan(7);
    run(A, P, 15);
    expect(P["controls/apu/inlet-flap/position-norm"]).toBe(0);
    expect(P["systems/fuel/valves/apu-lp-valve-cmd"]).toBe(0);
  });

  test("the APU: no start without the batteries; its fire button stops it at once", () => {
    const P: Props = {};
    const A = new Apu();
    A.reset(P, "cold");
    P["controls/apu/master"] = 1;
    run(A, P, 1);
    expect(A.state).toBe(0);
    const Q: Props = {};
    A.reset(Q, "apu");
    BUSES(Q, true);
    expect(Q["systems/apu/available"]).toBe(1);
    A.call("systems.APUController.APU.emergencyStop", [], Q);
    run(A, Q, 1);
    expect(Q["systems/apu/fault"]).toBe(1);
    expect(Q["systems/fuel/valves/apu-lp-valve-cmd"]).toBe(0);
  });

  test("the IRs: aligned in a time by the latitude, NAV, the attitude on the PFD first; OFF loses it", () => {
    expect(calcAlignTime(0)).toBe(300);
    expect(Math.round(calcAlignTime(45))).toBe(543);
    for (const lat of [0, 45, 70]) {
      const P: Props = { "position/latitude-deg": lat };
      const D = new Adirs(() => 0.5);
      D.reset(P, "cold");
      BUSES(P, true);
      D.step(P, 0.1);
      // (the three knobs to NAV, a notch each — the deck's "….getValue() + 1")
      for (const n of [0, 1, 2])
        expect(D.call("systems.ADIRSControlPanel.irModeSw", [n, `systems.ADIRS.Switches.irModeSw[${n}].getValue() + 1`], P)).toBeTrue();
      expect(P["controls/navigation/adirscp/switches/ir-1-mode"]).toBe(1);
      const pfd = run(D, P, 60, () => P["systems/navigation/ir/operating-1"] === 1, 0.1);
      const t = run(D, P, 1200, () => P["systems/navigation/aligned-1"] === 1, 0.1);
      const total = (pfd ?? 0) + (t ?? Infinity);
      console.log(`  ${lat}°: the attitude at ${pfd?.toFixed(1)} s, aligned at ${total.toFixed(0)} s (${calcAlignTime(lat).toFixed(0)})`);
      expect(pfd!).toBeGreaterThan(20);
      expect(pfd!).toBeLessThan(26);
      expect(Math.abs(total - calcAlignTime(lat))).toBeLessThan(1);
      expect(P["systems/navigation/aligned-2"]).toBe(1);
      expect(P["systems/navigation/aligned-3"]).toBe(1);
      expect(P["systems/navigation/adr/operating-1"]).toBe(1);
      expect(P["instrumentation/efis/nd/ir-1"]).toBe(1);
      // (back to OFF: the IR lost at once)
      D.call("systems.ADIRSControlPanel.irModeSw", [0, "systems.ADIRS.Switches.irModeSw[0].getValue() - 1"], P);
      D.step(P, 0.1);
      expect(P["systems/navigation/aligned-1"]).toBe(0);
      expect(P["controls/navigation/adirscp/switches/ir-1-mode"]).toBe(0);
    }
  });

  test("the IRs on battery: ON BAT; ADR pushbutton off: its OFF light, its data gone", () => {
    const P: Props = { "position/latitude-deg": 48.7 };
    const D = new Adirs(() => 0);
    D.reset(P, "cold");
    BUSES(P, false);
    D.call("systems.ADIRSControlPanel.irModeSw", [0, 1], P);
    D.step(P, 0.1);
    expect(P["controls/navigation/adirscp/lights/on-bat"]).toBe(1);
    // (the self test: ON BAT 5 s, then on the battery still)
    run(D, P, 6, undefined, 0.1);
    expect(P["controls/navigation/adirscp/lights/on-bat"]).toBe(1);
    BUSES(P, true);
    run(D, P, 1, undefined, 0.1);
    expect(P["controls/navigation/adirscp/lights/on-bat"]).toBe(0);
    expect(P["systems/navigation/adr/operating-1"]).toBe(1);
    D.call("systems.ADIRSControlPanel.adrSw", [0], P);
    D.step(P, 0.1);
    expect(P["controls/navigation/adirscp/lights/adr-1-off"]).toBe(1);
    expect(P["systems/navigation/adr/operating-1"]).toBe(0);
  });

  test("the fire TEST lights the fire pushbuttons while held, with power; an agent discharged puts a fire out", () => {
    const P: Props = {};
    const F = new Fire(undefined, () => 0.5);
    F.reset(P, "cold");
    // (no power: nothing)
    P["controls/fire/test-btn-1"] = 1;
    F.step(P, 0.05);
    expect(P["systems/fire/engine1/warning-active"]).toBe(0);
    P["controls/fire/test-btn-1"] = 0;
    F.step(P, 0.05);
    BUSES(P);
    for (const [btn, warn] of [
      ["controls/fire/test-btn-1", "systems/fire/engine1/warning-active"],
      ["controls/fire/test-btn-2", "systems/fire/engine2/warning-active"],
      ["controls/fire/apu-test-btn", "systems/fire/apu/warning-active"],
    ] as const) {
      P[btn] = 1;
      run(F, P, 1);
      expect(P[warn]).toBe(1);
      P[btn] = 0;
      run(F, P, 0.5);
      expect(P[warn]).toBe(0);
    }
    // (an engine 1 fire: detected, the fire button out — AGENT 1's 10 s —, AGENT 1: DISCH, the fire out, AGENT 2's 30 s)
    P["systems/failures/fire/engine-left-fire"] = 1;
    run(F, P, 1);
    expect(P["systems/fire/engine1/warning-active"]).toBe(1);
    P["controls/engines/engine/fire-btn"] = 1;
    run(F, P, 1);
    expect([9, 10]).toContain(P["systems/fire/engine1/agent1-timer"] as number);
    run(F, P, 10.5);
    expect(P["systems/fire/engine1/agent1-timer"]).toBe(99);
    P["controls/engines/engine/agent1-btn"] = 1;
    run(F, P, 0.7);
    expect(P["systems/fire/engine1/disch1"]).toBe(1);
    expect(P["systems/fire/engine1/agent2-timer"]).toBe(30);
    run(F, P, 3);
    expect(P["systems/failures/fire/engine-left-fire"]).toBe(0);
    expect(P["systems/fire/engine1/warning-active"]).toBe(0);
  });

  test("the cargo smoke TEST: the warnings, DISCH, the warnings, 3 s apart", () => {
    const P: Props = {};
    const F = new Fire();
    F.reset(P, "cold");
    BUSES(P);
    P["controls/fire/cargo/test"] = 1;
    const seen: string[] = [];
    run(F, P, 14, () => {
      const s = `${P["systems/fire/cargo/aft/warning-active"]}${P["systems/fire/cargo/disch-test"]}`;
      if (seen.at(-1) !== s) seen.push(s);
      return false;
    });
    expect(seen).toEqual(["00", "10", "01", "10", "00"]);
  });

  test("an APU fire on the ground: the APU stopped, its bottle fired 3 s later", () => {
    const P: Props = { "fdm/jsbsim/position/wow": 1 };
    const [, , , , , apu, fire] = nasalModules({ rand: () => 0.5 });
    apu!.reset!(P, "apu");
    fire!.reset!(P, "apu");
    BUSES(P, true);
    P["systems/failures/fire/apu-fire"] = 1;
    for (let t = 0; t < 5; t += 0.05) {
      apu!.step(P, 0.05);
      fire!.step(P, 0.05);
    }
    expect(P["systems/apu/fault"]).toBe(1);
    expect(P["systems/fire/apu/disch"]).toBe(1);
  });

  test("each module's cold and ready states", () => {
    const states: StartState[] = ["cold", "apu", "ready", "air"];
    const bags = states.map((s) => {
      const P: Props = {};
      for (const m of nasalModules()) m.reset?.(P, s);
      return P;
    });
    const [cold, apu, ready, air] = bags as [Props, Props, Props, Props];
    const names = nasalModules().map((m) => m.name);
    expect(names).toEqual(["ELEC", "PNEU", "HYD", "FUEL", "ADIRS", "APU", "FIRE"]);
    // (ELEC: the batteries)
    expect(cold["controls/electrical/switches/bat-1"]).toBe(0);
    expect(ready["controls/electrical/switches/bat-1"]).toBe(1);
    // (PNEU: the packs; GN on the ground, CL in the air)
    expect(cold["controls/pneumatics/switches/pack-1"]).toBe(0);
    expect(ready["controls/pneumatics/switches/pack-1"]).toBe(1);
    expect(ready["systems/pressurization/mode"]).toBe("GN");
    expect(air["systems/pressurization/mode"]).toBe("CL");
    // (HYD: the same pumps)
    expect(cold["controls/hydraulic/switches/green-edp"]).toBe(1);
    expect(ready["controls/hydraulic/switches/yellow-elec"]).toBe(0);
    // (FUEL: the pumps)
    expect(cold["controls/fuel/switches/pump-left-1"]).toBe(0);
    expect(ready["controls/fuel/switches/pump-center-2"]).toBe(1);
    // (ADIRS: OFF and dark, NAV aligned)
    expect(cold["controls/navigation/adirscp/switches/ir-1-mode"]).toBe(0);
    expect(cold["systems/navigation/aligned-1"]).toBe(0);
    expect(ready["controls/navigation/adirscp/switches/ir-3-mode"]).toBe(1);
    expect(ready["systems/navigation/aligned-3"]).toBe(1);
    expect(ready["systems/navigation/adr/operating-2"]).toBe(1);
    // (APU: off, running before the start, off again once the engines are)
    expect(cold["systems/apu/available"]).toBe(0);
    expect(apu["systems/apu/available"]).toBe(1);
    expect(apu["engines/engine[2]/n1"]).toBe(100);
    expect(apu["controls/pneumatics/switches/apu"]).toBe(1);
    expect(ready["controls/apu/master"]).toBe(0);
    expect(ready["controls/pneumatics/switches/apu"]).toBe(0);
    // (FIRE: quiet, the agents' timers at 99)
    for (const P of bags) {
      expect(P["systems/fire/engine1/warning-active"]).toBe(0);
      expect(P["systems/fire/apu/agent-timer"]).toBe(99);
    }
    // (a ready bag stays as it is when stepped — nothing starts or stops by itself)
    const P = { ...ready };
    BUSES(P, true);
    const ms = nasalModules({ rand: () => 0.5 });
    for (const m of ms) m.reset?.(P, "ready");
    for (let t = 0; t < 30; t += 0.05) for (const m of ms) m.step(P, 0.05);
    expect(P["systems/navigation/aligned-1"]).toBe(1);
    expect(P["systems/apu/state"]).toBe(0);
    expect(P["systems/fire/engine1/warning-active"]).toBe(0);
  });
});
