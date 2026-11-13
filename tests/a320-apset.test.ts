import { afterEach, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's autopilot as the crew console and TARS set it (controller/jet.ts apSet — audit 2026-11-10, TA-03; wave
// 3.7): « AP on » asked twice leaves it on, the selectors go to its FCU (the altitude in feet, the speed in knots, the
// heading), each pulled — selected. Before 13 Nov 2026 apSet judged the A320's AP by the F-35's holds (always empty):
// every ask toggled the FMGC's AP1 (on, then off), and the selectors were written where the A320 never reads them.

afterEach(resetFlights);

function cruise() {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, 3048 / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 128 / C_MPS)), landed: undefined }, false, "a320");
  run.c.s.flightMode = "plane";
  run.c.gearDown = false;
  run.c.gearExt = 0;
  run.c.gearInit = true;
  run.c.pilot.throttle = 0.62;
  run.fly(8);
  return run;
}

test("the A320: AP asked on twice stays on; the selectors set its FCU, selected", () => {
  const { c, fly } = cruise();
  c.apSet({ ap: true, athr: true });
  fly(1);
  c.apSet({ ap: true });
  fly(1);
  const F = c.a320Fmgc!;
  expect(F.ap).toBe(true);
  expect(F.athr).toBe(true);
  c.apSet({ alt: 3500, hdg: Math.PI / 2, spd: 140 });
  fly(1);
  expect(F.alt).toBe(Math.round(3500 / 0.3048 / 100) * 100);
  expect(F.hdg).toBe(90);
  expect(F.spd).toBe(Math.round(140 / 0.514444));
  expect(F.ap).toBe(true);
  c.apSet({ ap: false });
  expect(F.ap).toBe(false);
});
