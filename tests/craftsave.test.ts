import { afterEach, expect, test } from "bun:test";
import { captureCraft, checkCraft, restoreCraft } from "../src/controller/craftsave";
import { fleet } from "../src/fleet";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The craft's own state in a save (audit FX-09/AR-09): what a load's new flight resets — the fuel, the gear, the flaps,
// the brakes, the engine, the jet's holds, the spacecraft's systems — captured and given back; a block that is not one
// refused (the flight still loads without it).

afterEach(resetFlights);

/** An F-35 at 3 000 m over the Atlantic, 160 m/s east. */
function f35() {
  const g = ourGroundPose("earth", 38.5, -14, 0);
  const X = add(g.X, scale(g.up, 3000 / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 160 / C_MPS)), landed: undefined }, false, "f35");
  run.c.s.flightMode = "plane";
  run.c.gearInit = true;
  run.fly(1);
  return run;
}

test("a load's new flight resets the craft; restored, it is as captured", () => {
  const { c, fly } = f35();
  fleet.fuel.f35 = 2500;
  c.gearDown = true;
  c.gearExt = 1;
  c.airFlight.cfg.flaps = 0.5;
  c.airBrake = 0.6;
  c.jetModes = { ...c.jetModes, alt: 3000, hdg: 1.2, spd: 160, ab: false, bankMax: 0.4 };
  fly(0.2);
  const saved = captureCraft(c);
  // (through JSON, as stored)
  const back = checkCraft(JSON.parse(JSON.stringify(saved)));
  expect(back).not.toBeNull();
  // (what the load does first: a new flight — tanks full, the gear decided again, flaps up, the air brake in)
  c.newFlight();
  expect(fleet.fuel.f35).toBeUndefined();
  expect(c.gearInit).toBe(false);
  expect(c.airBrake).toBe(0);
  c.jetModes = { alt: null, hdg: null, spd: null, ab: false };
  c.airFlight.cfg.flaps = 0;
  restoreCraft(c, back!);
  expect(fleet.fuel.f35).toBeCloseTo(saved.fuel.f35!, 6);
  expect(c.gearInit).toBe(true);
  expect(c.gearDown).toBe(true);
  expect(c.airFlight.cfg.flaps).toBe(0.5);
  expect(c.airBrake).toBeCloseTo(0.6, 6);
  expect(c.jetModes.alt).toBe(3000);
  expect(c.jetModes.spd).toBe(160);
  expect(c.jetModes.bankMax).toBe(0.4);
  // (flown on: the gear kept down — not decided again by the height —, the fuel burning from 2 500 kg)
  fly(1);
  expect(c.gearDown).toBe(true);
  expect(fleet.fuel.f35!).toBeLessThan(2500);
  expect(fleet.fuel.f35!).toBeGreaterThan(2400);
});

test("the spacecraft's systems: the save's, not the flight flown before the load", () => {
  const { c } = f35();
  fleet.systems = {};
  const none = captureCraft(c);
  fleet.systems = {
    ranger: { battery: 1, o2: 2, scrub: 3, failures: [], seed: 7, t: 100, engineFactor: 0.5, rcsFactor: 1 },
  };
  restoreCraft(c, checkCraft(JSON.parse(JSON.stringify(none)))!);
  expect(fleet.systems).toEqual({});
});

test("a block that is not one is refused, not half-restored", () => {
  const { c } = f35();
  const ok = JSON.parse(JSON.stringify(captureCraft(c)));
  expect(checkCraft(ok)).not.toBeNull();
  expect(checkCraft(null)).toBeNull();
  expect(checkCraft({ ...ok, v: 2 })).toBeNull();
  expect(checkCraft({ ...ok, fuel: { zeppelin: 3 } })).toBeNull();
  expect(checkCraft({ ...ok, fuel: { f35: -1 } })).toBeNull();
  expect(checkCraft({ ...ok, flaps: 2 })).toBeNull();
  expect(checkCraft({ ...ok, gear: { down: "yes", ext: 1 } })).toBeNull();
  expect(checkCraft({ ...ok, jet: { ...ok.jet, alt: "high" } })).toBeNull();
});
