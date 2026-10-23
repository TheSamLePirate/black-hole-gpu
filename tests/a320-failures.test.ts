import { describe, expect, test } from "bun:test";
import { type EngineCtl, limits, newEngine, stepEngine } from "../src/a320/fadec";
import { A320Fcs, type FcsInputs } from "../src/a320/fcs";
import { AdrSet, engineFault, FAILURES, FailureSet, fuelLeak, lawOf, surfacesPowered, thrustYaw } from "../src/a320/failures";
import type { Props } from "../src/a320/rig";
import { A320Systems, type SysFrame } from "../src/a320/systems";

// The A320's failures (docs/PLAN-A320.md, A11 — src/a320/failures.ts): an engine failed at V1 (its thrust gone, the
// yaw it leaves), relit in flight once cleared and its MASTER cycled; green and yellow lost: the alternate law, the
// flaps stuck, the slats at half rate, direct with the gear down; both engines out in cruise: the RAT, the emergency
// generator, AC ESS back and the rest dark; a pitot iced: its ADR voted out, then a second ADR lost: disagree, the
// alternate law; an engine fire: its warning from the systems' loops; the cabin's leak; a fuel leak.

const air = (onGround: boolean, mach = 0) => ({
  altFt: onGround ? 0 : 30000,
  densFt: onGround ? 0 : 30000,
  tatC: 15,
  mach,
  onGround,
  flapLever: 0,
});

/** a frame of the FCS (the levers, the air, the ignition's controls, the hydraulics) */
const fcsIn = (o: Partial<FcsInputs>): FcsInputs => ({
  dt: 1 / 30,
  torque: [0, 0, 0],
  airborne: false,
  onGround: true,
  lever: 0,
  reverse: 0,
  flapLever: 0,
  speedBrake: 0,
  groundSpoilers: false,
  gear: 1,
  lights: false,
  ias: 0,
  groundSpeed: 0,
  air: air(true),
  alphaDot: 0,
  ...o,
});

/** the systems' frame in cruise (FL300, 280 kt), the engines given */
const cruise = (es: { n1: number; n2: number; egt: number; ff: number }[], gear = 0): SysFrame => ({
  elapsed: 0,
  lat: 45,
  lon: 0,
  altFt: 30000,
  aglFt: 30000,
  vsFpm: 0,
  onGround: false,
  gear,
  ias: 280,
  gs: 450,
  mach: 0.78,
  tatC: -20,
  oatC: -45,
  staticInHg: 8.9,
  alphaDeg: 2,
  flapDeg: 0,
  slatDeg: 0,
  engines: es,
  tanks: [690, 5000, 0, 5000, 690],
  detent: "CL",
});

const run = (S: A320Systems, s: number, f: () => SysFrame, each?: () => void) => {
  for (let k = 0; k < s * 30; k++) {
    S.step(1 / 30, f());
    each?.();
  }
};

describe("A320 failures", () => {
  test("the catalogue: ids unique, FlightGear's properties under systems/failures", () => {
    const ids = new Set(FAILURES.map((f) => f.id));
    expect(ids.size).toBe(FAILURES.length);
    for (const f of FAILURES) for (const p of f.props) expect(p.startsWith("systems/failures/")).toBeTrue();
    expect(FAILURES.length).toBeGreaterThan(60);
  });

  test("engine 1 at V1: its thrust gone, the yaw it leaves; relit in flight once cleared and its MASTER cycled", () => {
    const P: Props = {};
    const F = new FailureSet(() => 0.5);
    F.arm("eng1-fail", { at: "v1" });
    const A = new A320Fcs();
    let ias = 0;
    let fired: string[] = [];
    for (let k = 0; k < 40 * 30; k++) {
      ias = Math.min(ias + 4.5 / 30, 160);
      fired = fired.concat(F.step(P, 1 / 30, { ias, onGround: true, v1: 140 }));
      const ctl: [EngineCtl, EngineCtl] = [0, 1].map((e) => ({ starter: false, cutoff: false, ...engineFault(P, e) })) as [
        EngineCtl,
        EngineCtl,
      ];
      A.step(fcsIn({ lever: 1, ias, groundSpeed: ias * 0.514, engineCtl: ctl }));
    }
    const [l, r] = A.engines;
    console.log(
      `  failed at V1 (${fired.join()}): N1 ${l.n1.toFixed(1)} / ${r.n1.toFixed(1)}, thrust ${(l.thrust / 1000).toFixed(1)} / ${(r.thrust / 1000).toFixed(1)} kN, yaw ${(thrustYaw(l.thrust, r.thrust) / 1000).toFixed(0)} kN·m`,
    );
    expect(fired).toEqual(["eng1-fail"]);
    expect(l.running).toBeFalse();
    expect(l.thrust).toBe(0);
    expect(r.thrust).toBeGreaterThan(80_000);
    // (the nose pulled to the dead side: the live engine's thrust at FlightGear's 2.88 m)
    expect(thrustYaw(l.thrust, r.thrust)).toBeLessThan(-200_000);
    // (in flight at M 0.6: windmilling; the failure cleared — no relight before the MASTER is cycled)
    let e = { ...l };
    const a = air(false, 0.6);
    const want = { n1: limits(a).idle, reverse: 0 };
    for (let k = 0; k < 300; k++) e = stepEngine(e, want, a, 0.1, { starter: false, cutoff: false, failed: true });
    console.log(`  windmilling at M 0.6: N1 ${e.n1.toFixed(1)}, N2 ${e.n2.toFixed(1)}`);
    expect(e.n2).toBeGreaterThan(15);
    F.clear(P, "eng1-fail");
    expect(engineFault(P, 0).failed).toBeFalse();
    for (let k = 0; k < 50; k++) e = stepEngine(e, want, a, 0.1, { starter: false, cutoff: false });
    expect(e.running).toBeFalse();
    for (let k = 0; k < 10; k++) e = stepEngine(e, want, a, 0.1, { starter: false, cutoff: true });
    for (let k = 0; k < 900 && !e.running; k++) e = stepEngine(e, want, a, 0.1, { starter: false, cutoff: false });
    expect(e.running).toBeTrue();
  });

  test("green and yellow lost: the alternate law, the flaps stuck, the slats at half rate; direct with the gear down", () => {
    const P: Props = {};
    const S = new A320Systems(P, { rand: () => 0.5 });
    const es = [newEngine(true), newEngine(true)];
    S.reset("air", cruise(es));
    expect(lawOf(P).law).toBe("normal");
    const F = new FailureSet();
    F.fail(P, "hyd-gy");
    run(S, 100, () => cruise(es));
    const L = lawOf(P, false);
    const H = surfacesPowered(P);
    console.log(
      `  G ${S.psi("green").toFixed(0)} B ${S.psi("blue").toFixed(0)} Y ${S.psi("yellow").toFixed(0)}: ${L.law} (${L.reasons.join(", ")})`,
    );
    expect(L.law).toBe("alternate");
    expect(L.reasons.join()).toContain("HYD G+Y");
    expect(H.flapRate).toBe(0);
    expect(H.slatRate).toBe(0.5);
    expect(H.gear).toBeFalse();
    expect(H.brakes.normal).toBeFalse();
    expect(H.spoilers.filter(Boolean).length).toBe(2);
    expect(lawOf(P, true).law).toBe("direct");
    // (the FCS with it: the flap lever to 1 — the slats out at half rate, the flaps stuck)
    const A = new A320Fcs();
    for (let k = 0; k < 10 * 30; k++)
      A.step(fcsIn({ onGround: false, airborne: true, flapLever: 2, ias: 200, groundSpeed: 103, air: air(false, 0.4), powered: H }));
    console.log(`  10 s at CONF 2: slats ${A.surfaces.slat.toFixed(1)}°, flaps ${A.surfaces.flap.toFixed(1)}°`);
    expect(A.surfaces.flap).toBe(0);
    expect(A.surfaces.slat).toBeCloseTo(5, 1);
  }, 60_000);

  test("both engines out in cruise: the RAT, the emergency generator — AC ESS back, AC 1 and 2 dark —, alternate", () => {
    const P: Props = {};
    const S = new A320Systems(P, { rand: () => 0.5 });
    const A = new A320Fcs();
    S.reset("air", cruise(A.engines));
    const F = new FailureSet();
    F.fail(P, "eng-dual");
    const a = air(false, 0.78);
    run(
      S,
      40,
      () => cruise(A.engines),
      () => {
        const c = S.engineCtl().map((x, k) => ({ ...x, ...engineFault(P, k) })) as [EngineCtl, EngineCtl];
        A.step(fcsIn({ onGround: false, airborne: true, lever: 0.62, ias: 280, groundSpeed: 230, air: a, engineCtl: c, gear: 0 }));
      },
    );
    const L = lawOf(P, false);
    console.log(
      `  N2 ${A.engines.map((e) => e.n2.toFixed(0)).join("/")}: RAT ${P["systems/electrical/some-electric-thingie/rat-deploy"]}, AC ESS ${S.bus("ac-ess").toFixed(0)}, AC 1 ${S.bus("ac-1").toFixed(0)}, AC 2 ${S.bus("ac-2").toFixed(0)}, B ${S.psi("blue").toFixed(0)}; ${L.law} (${L.reasons.join(", ")})`,
    );
    expect(A.engines.every((e) => !e.running)).toBeTrue();
    expect(Number(P["systems/electrical/some-electric-thingie/rat-deploy"])).toBe(1);
    expect(S.bus("ac-ess")).toBeGreaterThan(100);
    expect(S.bus("ac-1")).toBeLessThan(10);
    expect(S.bus("ac-2")).toBeLessThan(10);
    expect(S.bus("dc-1")).toBeLessThan(10);
    expect(S.psi("blue")).toBeGreaterThan(2000);
    expect(L.law).toBe("alternate");
  }, 60_000);

  test("a pitot iced: its speed wrong, its ADR voted out; a second ADR lost: disagree, the alternate law", () => {
    const P: Props = {};
    const D = new AdrSet();
    D.step(P, 280, 10000);
    P["systems/failures/navigation/pitot-1"] = 1;
    D.step(P, 280, 10000);
    // (the climb at the same speed: the trapped pitot reads high, like an altimeter)
    const r = D.step(P, 280, 20000);
    console.log(`  pitot 1 iced, FL100 → FL200 at 280 kt: ADR 1 ${r.cpt.ias.toFixed(0)} kt, ADR 2 ${r.fo.ias.toFixed(0)} kt`);
    expect(r.cpt.ias).toBeGreaterThan(310);
    expect(Math.abs(r.fo.ias - 280)).toBeLessThan(0.5);
    expect(P["systems/navigation/adr/output/rejected-1"]).toBe(1);
    expect(r.disagree).toBeFalse();
    expect(lawOf(P).law).toBe("normal");
    // (the AIR DATA selector on CAPT 3: the captain's back on a good one)
    P["controls/navigation/switching/air-data"] = -1;
    expect(Math.abs(D.step(P, 280, 20000).cpt.ias - 280)).toBeLessThan(0.5);
    P["controls/navigation/switching/air-data"] = 0;
    // (ADR 3 lost as well: one good, one wrong — no vote left)
    P["systems/failures/navigation/adr-3"] = 1;
    expect(D.step(P, 280, 20000).disagree).toBeTrue();
    const L = lawOf(P);
    expect(L.law).toBe("alternate");
    expect(L.reasons).toContain("ADR DISAGREE");
    // (the ice gone: the readings back)
    P["systems/failures/navigation/pitot-1"] = P["systems/failures/navigation/adr-3"] = 0;
    expect(D.step(P, 280, 20000).disagree).toBeFalse();
    expect(lawOf(P).law).toBe("normal");
  });

  test("an engine fire: the loops see it, its warning; cleared: the warning gone", () => {
    const P: Props = {};
    const S = new A320Systems(P, { rand: () => 0.5 });
    const es = [newEngine(true), newEngine(true)];
    S.reset("air", cruise(es));
    expect(Number(P["systems/fire/engine1/warning-active"] ?? 0)).toBe(0);
    const F = new FailureSet();
    F.fail(P, "eng1-fire");
    run(S, 10, () => cruise(es));
    console.log(`  ENG 1 FIRE: loop ${P["systems/fire/engine1/temperature"]} °C, warning ${P["systems/fire/engine1/warning-active"]}`);
    expect(Number(P["systems/fire/engine1/warning-active"])).toBe(1);
    expect(Number(P["systems/fire/engine2/warning-active"] ?? 0)).toBe(0);
    F.clear(P, "eng1-fire");
    run(S, 20, () => cruise(es));
    expect(Number(P["systems/fire/engine1/warning-active"])).toBe(0);
    expect(F.active.size).toBe(0);
  }, 60_000);

  test("armed at random within a window, at the lift-off; the cabin's leak; a fuel leak; the APU's fault", () => {
    const P: Props = { "systems/pressurization/cabinalt": 8000 };
    const F = new FailureSet(() => 0.5);
    F.arm("cab-leak", { at: "random", from: 10, to: 20 });
    F.arm("fuel-leak-l", { at: "takeoff" });
    let t = 0;
    for (; t < 30 && !F.active.has("cab-leak"); t += 0.1) F.step(P, 0.1, { ias: 0, onGround: true, altFt: 35000 });
    expect(t).toBeGreaterThan(14.8);
    expect(t).toBeLessThan(15.3);
    expect(F.active.has("fuel-leak-l")).toBeFalse();
    F.step(P, 0.1, { ias: 160, onGround: false, altFt: 35000 });
    expect(F.active.has("fuel-leak-l")).toBeTrue();
    for (let k = 0; k < 600; k++) F.step(P, 0.1, { ias: 280, onGround: false, altFt: 35000 });
    const ca = Number(P["systems/pressurization/cabinalt"]);
    console.log(`  a minute of leak: cabin at ${ca.toFixed(0)} ft`);
    expect(ca).toBeGreaterThan(9900);
    // (the explosive decompression: the cabin at the aircraft's altitude within a minute)
    F.fail(P, "cab-decomp");
    for (let k = 0; k < 600; k++) F.step(P, 0.1, { ias: 280, onGround: false, altFt: 35000 });
    expect(Number(P["systems/pressurization/cabinalt"])).toBe(35000);
    // (the fuel leak: 2 t/h out of the left wing)
    const A = new A320Fcs();
    A.setFuel(10000);
    const left0 = A.tanks[0]! + A.tanks[1]!,
      right0 = A.tanks[3]! + A.tanks[4]!;
    for (let k = 0; k < 600 * 30; k++)
      A.step(
        fcsIn({ onGround: false, airborne: true, lever: 0.62, ias: 280, groundSpeed: 230, air: air(false, 0.78), fuelLeak: fuelLeak(P) }),
      );
    const dl = left0 - A.tanks[0]! - A.tanks[1]!,
      dr = right0 - A.tanks[3]! - A.tanks[4]!;
    console.log(`  10 min: left wing −${dl.toFixed(0)} kg, right −${dr.toFixed(0)} kg`);
    expect(dl - dr).toBeGreaterThan(300);
    // (the APU's fault: its oil overheating, read by its auto shutdown)
    P["engines/engine[2]/n1"] = 100;
    F.fail(P, "apu-fault");
    F.step(P, 0.1, { ias: 0, onGround: true });
    expect(Number(P["systems/apu/oil/oil-temperature-degC"])).toBeGreaterThan(135);
    // (all cleared: every property back to 0)
    F.clearAll(P);
    expect(F.active.size).toBe(0);
    expect(FAILURES.flatMap((f) => f.props).every((p) => P[p] === 0)).toBeTrue();
  }, 60_000);
});
