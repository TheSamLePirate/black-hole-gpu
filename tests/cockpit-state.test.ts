import { expect, test } from "bun:test";
import { controlTip } from "../src/cockpit/actions";
import { Chrono } from "../src/cockpit/chrono";
import { CONTROLS } from "../src/cockpit/controls";
import { ControlTravel } from "../src/cockpit/state";

// PLAN-COCKPIT K5: the controls as the flight has them — each moving part travelling to its state (a lever
// moved by a key or an autopilot seen going), held by the pointer where the hand is; the flight's phases'
// buttons on the autopilot's panel, named with their keys.

test("the travel: the flaps' lever runs to its detent, the gear's swiftly, a switch snaps; held: at once", () => {
  const T = new ControlTravel();
  // (the first frame: where the flight has them)
  T.step({ flaps: { pos: 0 }, gear: { pos: 0 }, navLights: { pos: 0 } }, 1 / 60);
  const a = T.step({ flaps: { pos: 1 }, gear: { pos: 1 }, navLights: { pos: 1 } }, 0.2);
  expect(a.flaps!.pos).toBeCloseTo(0.3, 9);
  expect(a.gear!.pos).toBeCloseTo(0.8, 9);
  expect(a.navLights!.pos).toBe(1);
  let s = a;
  for (let i = 0; i < 30; i++) s = T.step({ flaps: { pos: 1 }, gear: { pos: 1 }, navLights: { pos: 1 } }, 1 / 30);
  expect(s.flaps!.pos).toBe(1);
  expect(s.gear!.pos).toBe(1);
  // (dragged by the pointer: no lag behind the hand)
  expect(T.step({ flaps: { pos: 0.2, pressed: true } }, 1 / 60).flaps!.pos).toBe(0.2);
  // (and back down the other way, at its pace)
  expect(T.step({ flaps: { pos: 1 } }, 0.1).flaps!.pos).toBeCloseTo(0.35, 9);
});

test("the flight's phases on the autopilot's panel: take-off, circularize, approach — their keys", () => {
  const d = { chrono: new Chrono(), gearNow: () => ({ down: true, ext: 1 }) };
  for (const [id, key] of [
    ["autoTakeoff", "U"],
    ["autoCirc", "9"],
    ["autoApproach", "0"],
  ] as const) {
    const c = CONTROLS.find((x) => x.id === id)!;
    expect(c.panel).toBe("C");
    expect(c.kind).toBe("button");
    const tip = controlTip(id, { pos: 0, lit: 1 }, d)!;
    expect(tip.key).toBe(key);
    expect(tip.state).toMatch(/ON/);
  }
});
