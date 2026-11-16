import { expect, test } from "bun:test";
import { GEAR_WARN, GearWarn } from "../src/game/gear-warn";

// The gear's alarm (« GEAR UP · TOO LOW », « Too low, gear! » — src/game/gear-warn.ts): the GPWS's mode 4A, as the A320's own
// voice has it — the gear up, under 500 ft and 190 kt, coming down, not in the take-off's climb. Before 16 Nov 2026 every aeroplane
// under 300 m and 150 m/s with its gear up was warned: the F-35 climbing out of Toulon-Hyères at 34 m and cruising level 275 m over
// the hills at 140 m/s (the render session's parcours-*). Each case below: the old rule's verdict, the new one's.

const air = { inAir: true, gearDown: false, agl: 100, speed: 80, vs: -4 };
/** the old rule (computer.ts until 16 Nov 2026) */
const old = (i: typeof air) => i.inAir && !i.gearDown && i.agl < 300 && i.speed < 150;

test("the take-off's climb: no alarm from the lift-off to 1 500 ft, the gear up — then armed", () => {
  const w = new GearWarn();
  expect(w.step({ ...air, inAir: false, agl: 0, speed: 60, vs: 0 })).toBe(false);
  // (the wheels off: 2 m up)
  expect(w.step({ ...air, agl: 2, speed: 75, vs: 2 })).toBe(false);
  // (34 m, climbing at 9 m/s, 98 m/s — parcours-debarquer's: the old rule warned)
  const climb = { ...air, agl: 34, speed: 98, vs: 9 };
  expect(old(climb)).toBe(true);
  expect(w.step(climb)).toBe(false);
  // (a dip in the climb: still the take-off's — no alarm)
  expect(w.step({ ...air, agl: 120, speed: 90, vs: -1 })).toBe(false);
  expect(w.step({ ...air, agl: GEAR_WARN.climbOut + 5, speed: 120, vs: 5 })).toBe(false);
  // (past 1 500 ft: armed — back down low and slow, coming down, the gear up: warned)
  expect(w.step({ ...air, agl: 120, speed: 80, vs: -4 })).toBe(true);
});

test("cruising level or fast over the hills: no alarm; low, slow and coming down: the alarm; the gear lowered: none", () => {
  const w = new GearWarn();
  // (placed in the air — flyAt —: no take-off's climb, armed at once)
  // (275 m over the hills, 140 m/s, level — parcours-camera's: the old rule warned)
  const cruise = { ...air, agl: 275, speed: 140, vs: 0 };
  expect(old(cruise)).toBe(true);
  expect(w.step(cruise)).toBe(false);
  // (130 m, 120 m/s, coming down: too fast for mode 4A's « gear »)
  expect(w.step({ ...air, agl: 130, speed: 120, vs: -3 })).toBe(false);
  // (130 m, 80 m/s, level: not coming down)
  expect(w.step({ ...air, agl: 130, speed: 80, vs: 0.5 })).toBe(false);
  // (130 m, 80 m/s, coming down, the gear up: warned)
  expect(w.step({ ...air, agl: 130, speed: 80, vs: -4 })).toBe(true);
  // (the gear lowered: silent)
  expect(w.step({ ...air, agl: 130, speed: 80, vs: -4, gearDown: true })).toBe(false);
});

test("a placing in the air straight from the ground is no take-off: the alarm armed at once", () => {
  const w = new GearWarn();
  expect(w.step({ ...air, inAir: false, agl: 0 })).toBe(false);
  // (the next frame 140 m up — flyAt from the runway —: not a lift-off)
  expect(w.step({ ...air, agl: 140, speed: 80, vs: -4 })).toBe(true);
});
