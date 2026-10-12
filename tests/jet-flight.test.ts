import { afterEach, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The jet's systems flown frame by frame by the controller itself (no page): the Ranger in plane mode over
// the Atlantic, 2 km up at 200 m/s eastwards — the autopilot's altitude and heading holds, the autothrottle,
// the stick flying through the holds, the afterburner.

afterEach(resetFlights);

const D = Math.PI / 180;

function cruise() {
  const g = ourGroundPose("earth", 45, -30, 0);
  const X = add(g.X, scale(g.up, 2000 / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 200 / C_MPS)), landed: undefined }, false);
  run.c.s.flightMode = "plane";
  run.c.pilot.throttle = 0.3;
  // (a second to let the air take it)
  run.fly(1);
  return run;
}

test("altitude, heading and speed held: the autopilot and the autothrottle", () => {
  const { c, fly } = cruise();
  const f0 = c.jetFigures()!;
  expect(f0).not.toBeNull();
  c.jetToggle("ap");
  c.jetToggle("athr");
  const m = c.jetModes;
  expect(m.alt).not.toBeNull();
  expect(m.hdg).not.toBeNull();
  expect(m.spd).not.toBeNull();
  // (a new heading and a new speed: 20° right, 230 m/s)
  m.hdg = m.hdg! + 20 * D;
  m.spd = 230;
  fly(90);
  const f = c.jetFigures()!;
  expect(Math.abs(f.h - m.alt!)).toBeLessThan(25);
  expect(Math.abs(((f.hdg - m.hdg! + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) / D).toBeLessThan(2);
  expect(Math.abs(f.V - 230)).toBeLessThan(6);
}, 120_000);

test("the altitude selected: climbs to it and levels off", () => {
  const { c, fly } = cruise();
  c.jetToggle("ap");
  c.jetToggle("athr");
  const m = c.jetModes;
  m.alt = m.alt! + 400;
  let peak = -Infinity;
  for (let k = 0; k < 120; k++) {
    fly(1);
    peak = Math.max(peak, c.jetFigures()!.h);
  }
  expect(Math.abs(c.jetFigures()!.h - m.alt)).toBeLessThan(25);
  expect(peak - m.alt).toBeLessThan(60);
}, 120_000);

test("the stick flies through the holds; let go, the new altitude held", () => {
  const { c, fly } = cruise();
  c.jetToggle("ap");
  const alt0 = c.jetModes.alt!;
  // (the stick back for 3 s: the pilot climbs — the hold does not fight it)
  const input = c.pilotInput.bind(c);
  c.pilotInput = (pad) => ({ ...input(pad), pitch: 1 });
  fly(3);
  c.pilotInput = input;
  fly(1 / 30);
  expect(c.jetModes.alt!).toBeGreaterThan(alt0 + 20);
  expect(c.jetModes.alt).not.toBeNull();
}, 120_000);

test("the afterburner: full throttle, more thrust; out of the detent, off; the throttle moved, the autothrottle off", () => {
  const { c, fly } = cruise();
  c.jetToggle("athr");
  expect(c.jetModes.spd).not.toBeNull();
  c.jetToggle("ab");
  expect(c.jetModes.ab).toBe(true);
  expect(c.jetModes.spd).toBeNull();
  expect(c.pilot.throttle).toBe(1);
  expect(c.jetThrust()).toBeCloseTo(1.5, 9);
  fly(1);
  c.pilot.throttle = 0.5;
  fly(1 / 30);
  expect(c.jetModes.ab).toBe(false);
  c.jetToggle("athr");
  fly(1);
  // (the lever moved by hand, somewhere the autothrottle did not leave it)
  c.pilot.throttle = c.pilot.throttle > 0.5 ? 0.137 : 0.863;
  fly(1 / 30);
  expect(c.jetModes.spd).toBeNull();
}, 120_000);

test("another flight mode: the systems off", () => {
  const { c, fly } = cruise();
  c.jetToggle("ap");
  c.s.flightMode = "rocket";
  fly(1 / 30);
  expect(c.jetModes.alt).toBeNull();
  expect(c.jetToggle("ap")).toMatch(/plane mode/);
}, 120_000);
