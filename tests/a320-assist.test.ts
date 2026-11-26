import { afterEach, expect, test } from "bun:test";
import { Fmgc } from "../src/a320/fmgc/fmgc";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's assisted level (docs/PLAN-A320-VOL-AAA.md W2 — controller/a320assist.ts): its « levers to idle at 20 ft » is a landing's
// only. Before 26 Nov 2026 it fired at a take-off's rotation (the radio altimeter under 20 ft, the gear's spring a few ft/min down):
// the KSFO → KLAX flight's A320 lifted off at idle and fell back from 78 m.

afterEach(resetFlights);
const FT = 0.3048;

/** the A320 at h over the sea, v [m/s] forward, sinking vz [m/s] */
function at(h: number, v: number, vz: number) {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, h / M_METRES));
  const run = flight({ ...g, X, vel: add(add(g.vel, scale(g.fwd, v / C_MPS)), scale(g.up, vz / C_MPS)), landed: undefined }, false, "a320");
  run.c.s.flightMode = "plane";
  run.c.s.a320Assist = "assisted";
  run.c.gearDown = true;
  run.c.gearExt = 1;
  run.c.gearInit = true;
  return run;
}

test("assisted: a lift-off at TOGA keeps its thrust under 20 ft (the rotation's sink no landing)", () => {
  const { c, fly } = at(4, 80, -0.05);
  c.pilot.throttle = 1;
  c.airFlight.cfg.flaps = 0.25;
  c.a320Fmgc ??= new Fmgc();
  c.a320Fmgc.phase = "takeoff";
  fly(0.5);
  expect(c.pilot.throttle).toBe(1);
});

test("assisted: a landing hand-flown — the levers to idle at 20 ft", () => {
  const { c, fly } = at(5.5, 70, -3.5);
  c.pilot.throttle = 0.35;
  c.airFlight.cfg.flaps = 1;
  const F = (c.a320Fmgc ??= new Fmgc());
  fly(0.05);
  F.phase = "approach";
  fly(0.3, () => c.pilot.throttle === 0);
  expect(c.pilot.throttle).toBe(0);
  void FT;
});
