import { describe, expect, test } from "bun:test";
import { newEngine } from "../src/a320/fadec";
import type { Props } from "../src/a320/rig";
import { FUEL_RATE, fgToShip, GroundServices, tugVehicle } from "../src/a320/services";
import { A320Systems, type SysFrame } from "../src/a320/systems";

// The A320's ground services (docs/PLAN-A320.md, A14 — src/a320/services.ts): from cold and dark, the GPU connected —
// FlightGear's ground cart: EXT PWR available, its pushbutton in: the AC buses at 115 V without an engine nor the APU —;
// the fuel truck at FlightGear's ~1 000 kg a minute up to its target; the stairs and the catering opening their doors,
// the catering's box rising; everything withdrawn when the aircraft moves; the vehicles at FlightGear's places.

const frame = (): SysFrame => ({
  elapsed: 0,
  lat: 48.96,
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
  staticInHg: 29.9,
  alphaDeg: 0,
  flapDeg: 0,
  slatDeg: 0,
  engines: [newEngine(false), newEngine(false)],
  tanks: [690, 3000, 0, 3000, 690],
  detent: "IDLE",
});
const ctx = { onGround: true, gs: 0, fuelKg: 7380, fuelMax: 18730 };

describe("A320 ground services", () => {
  test("the GPU: EXT PWR available, its pushbutton in — the AC buses powered from cold and dark", () => {
    const P: Props = {};
    const S = new A320Systems(P, { rand: () => 0.5 });
    S.reset("cold", frame());
    const G = new GroundServices();
    const run = (s: number) => {
      for (let k = 0; k < s * 30; k++) {
        G.step(P, 1 / 30, ctx);
        S.step(1 / 30, frame());
      }
    };
    run(2);
    expect(S.bus("ac-1")).toBeLessThan(5);
    expect(G.toggle("gpu", ctx)).toBe("on");
    run(3);
    expect(Number(P["controls/electrical/switches/ground-cart"])).toBe(1);
    P["controls/electrical/switches/ext-pwr"] = 1;
    run(5);
    console.log(`  EXT PWR: AC 1 ${S.bus("ac-1").toFixed(0)} V, AC 2 ${S.bus("ac-2").toFixed(0)} V, DC 1 ${S.bus("dc-1").toFixed(1)} V`);
    expect(S.bus("ac-1")).toBeGreaterThan(100);
    expect(S.bus("ac-2")).toBeGreaterThan(100);
    // (the GPU withdrawn: the buses dead again)
    G.toggle("gpu", ctx);
    run(3);
    expect(S.bus("ac-1")).toBeLessThan(5);
  });

  test("the fuel truck: ~1 000 kg a minute, stopping at its target", () => {
    const G = new GroundServices();
    const P: Props = {};
    let fuel = 5000;
    G.toggle("fuel", { ...ctx, fuelKg: fuel }, 6500);
    for (let k = 0; k < 60 * 10; k++) fuel += G.step(P, 0.1, { ...ctx, fuelKg: fuel }).fuelAdded;
    // (60 s: some 1 000 kg)
    expect(Math.abs(fuel - 6000)).toBeLessThan(5);
    for (let k = 0; k < 60 * 10; k++) fuel += G.step(P, 0.1, { ...ctx, fuelKg: fuel }).fuelAdded;
    expect(fuel).toBeCloseTo(6500, 3);
    expect(G.fuelTarget).toBeNull();
    expect(FUEL_RATE * 60).toBeCloseTo(1000, 6);
  });

  test("the doors: the stairs and the catering open theirs; the box rising; all gone when the aircraft moves", () => {
    const G = new GroundServices();
    const P: Props = {};
    G.toggle("stairs", ctx);
    G.toggle("catering", ctx);
    G.toggle("belt", ctx);
    expect(G.doors()).toEqual([1, 0, 1, 0, 1, 1, 0]);
    for (let k = 0; k < 100; k++) G.step(P, 0.1, ctx);
    expect(G.rise[0]).toBeCloseTo(0.5, 6);
    const box = G.vehicles().find((v) => v.id === "gs-catering-box")!;
    const truck = G.vehicles().find((v) => v.id === "gs-catering")!;
    expect(box.p[1] - truck.p[1]).toBeCloseTo(3.11 * 0.5, 4);
    // (at rest on the ground only; moving off: withdrawn)
    expect(G.toggle("gpu", { ...ctx, gs: 5 })).toBe("only at rest on the ground");
    const r = G.step(P, 0.1, { ...ctx, gs: 3 });
    expect(r.moved).toBeTrue();
    expect(G.on.size).toBe(0);
    expect(G.doors()).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test("the vehicles at FlightGear's places; the tug at the nose gear, turned with its bar", () => {
    const G = new GroundServices();
    G.toggle("gpu", ctx);
    G.toggle("stairs", ctx);
    G.toggle("chocks", ctx);
    const V = G.vehicles();
    expect(V.map((v) => v.id).sort()).toEqual(["gs-chock-left", "gs-chock-nose", "gs-chock-right", "gs-gpu", "gs-stairs"]);
    // (FlightGear's model frame: x aft, y right, z up — the ship's x left, y up, z forward)
    expect(fgToShip(-14, 1, -4.24)).toEqual([-1, -4.24 + 2.648, 14]);
    const T0 = tugVehicle(0, 1),
      T1 = tugVehicle(30, 1),
      far = tugVehicle(0, 0);
    expect(T0.p[2]).toBeCloseTo(13.8, 6);
    expect(far.p[2]).toBeCloseTo(33.8, 6);
    // (the bar 30° right: the tug to the right — the ship's −x)
    expect(T1.p[0]).toBeLessThan(0);
    expect(T1.yaw).toBeCloseTo((-30 * Math.PI) / 180, 6);
  });
});
