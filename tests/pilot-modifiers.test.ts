import { afterEach, expect, test } from "bun:test";
import { advanceFrameClock } from "../src/frameclock";
import { ourGroundPose } from "../src/game/place";
import { heldCode } from "../src/input/bindings";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// Shift and Alt: the throttle, and the modifiers of some fifteen shortcuts (audit 2026-11-10, FX-01; wave 3.5). Held
// for a shortcut (⇧P the air brake, ⇧V the last view, ⇧K…) they must not move the throttle: before 13 Nov 2026 ⇧P on the
// runway raised it past 5 % in a tenth of a second, ⇧V at a dock undocked the ship, Alt and the wheel cut an ILS. Held
// alone, or with the flight's own keys (pitch, roll, yaw, translation), they are the throttle as before.

afterEach(resetFlights);

/** An F-35 at 3 000 m over the Atlantic, its keys read as the frame reads them. */
function f35() {
  const g = ourGroundPose("earth", 38.5, -14, 0);
  const X = add(g.X, scale(g.up, 3000 / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 160 / C_MPS)), landed: undefined }, false, "f35");
  run.c.s.flightMode = "plane";
  run.c.gearInit = true;
  return run.c;
}
/** the throttle the keys give over `ms` of frames (each 1/30 s): its last value, and whether it ever moved */
const throttleOver = (c: ReturnType<typeof f35>, ms: number) => {
  let last = 0,
    moved = false;
  for (let t = 0; t < ms; t += 1000 / 30) {
    advanceFrameClock(1000 / 30);
    last = c.pilotInput(null as never).throttle;
    if (last !== 0) moved = true;
  }
  return { last, moved };
};

test("Shift held for a shortcut (⇧P, ⇧V, ⇧K): the throttle untouched, from its first frame", () => {
  for (const key of ["KeyP", "KeyV", "KeyK"]) {
    const c = f35();
    // (the modifier first, as the hand presses it, then the key a frame later)
    c.codes.add("ShiftLeft");
    advanceFrameClock(1000 / 30);
    const first = c.pilotInput(null as never).throttle;
    c.codes.add(key);
    const r = throttleOver(c, 500);
    expect([key, first, r.moved]).toEqual([key, 0, false]);
    // (the shortcut's key let go, Shift still held: still not the throttle until Shift is let go)
    c.codes.delete(key);
    expect(throttleOver(c, 300).moved).toBe(false);
    c.codes.clear();
  }
});

test("Alt held with a key or the wheel's chord (⌥V): the throttle untouched", () => {
  const c = f35();
  c.codes.add("AltLeft");
  c.codes.add("KeyV");
  expect(throttleOver(c, 500).moved).toBe(false);
});

test("Shift or Alt alone, or with the flight's own keys: the throttle, as before", () => {
  const c = f35();
  c.codes.add("ShiftLeft");
  expect(throttleOver(c, 300).last).toBe(1);
  c.codes.add(heldCode("rollRight"));
  const r = throttleOver(c, 200);
  expect(r.last).toBe(1);
  expect(c.pilotInput(null as never).roll).toBe(1);
  c.codes.clear();
  c.codes.add("AltLeft");
  expect(throttleOver(c, 300).last).toBe(-1);
  c.codes.add(heldCode("pitchUp"));
  expect(throttleOver(c, 200).last).toBe(-1);
});
