import { expect, test } from "bun:test";
import { hudShown } from "../src/ui/hud/declutter";
import type { FlightPhase } from "../src/game/phase";

const ph = (mode: FlightPhase["mode"], stage: FlightPhase["stage"]): FlightPhase => ({ mode, control: "manual", stage, detail: "" });

test("each phase draws what has meaning there", () => {
  // (no phase yet: nothing withheld)
  expect(Object.values(hudShown(null)).every(Boolean)).toBe(true);
  const orbit = hudShown(ph("flight", "orbit"));
  expect([orbit.markers, orbit.future, orbit.burn, orbit.horizon]).toEqual([true, true, true, true]);
  expect([orbit.bank, orbit.airData]).toEqual([false, false]);
  const fin = hudShown(ph("flight", "approach"));
  expect([fin.runway, fin.airData, fin.horizon, fin.bank]).toEqual([true, true, true, true]);
  expect([fin.markers, fin.future, fin.burn, fin.impact]).toEqual([false, false, false, false]);
  const ground = hudShown(ph("landed", "ground"));
  expect([ground.heading, ground.horizon, ground.markers, ground.impact]).toEqual([true, true, false, false]);
  const docking = hudShown(ph("docked", "docking"));
  expect([docking.dock, docking.markers, docking.horizon, docking.future]).toEqual([true, true, false, false]);
  const hole = hudShown(ph("flight", "kerr"));
  expect([hole.relativity, hole.markers, hole.horizon]).toEqual([true, true, false]);
});
