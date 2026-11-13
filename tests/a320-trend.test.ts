import { afterEach, expect, test } from "bun:test";
import { duData } from "../src/a320/du/data";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's speed trend on its PFD (audit 2026-11-10, FX-19): the rate of the speed, where it will be in 10 s — taken on the
// wall's clock before 13 Nov 2026 (performance.now()): wrong under the time's warp (×4 in the air) and in a flight stepped
// (__bh.step, the tests: many steps for a few wall milliseconds). Taken now on the flight's own time. The A320 over the Atlantic,
// no wind, its levers full, settled 25 s — its speed then falling steadily as it climbs —, 6 s stepped frame by frame; the arrow
// against the speed's own rate.

afterEach(resetFlights);

test("the speed trend is the speed's rate over the flight's time, however fast it is stepped", () => {
  // (a speed changing steadily: no wind, no gusts)
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, 3048 / M_METRES));
  const { c, fly } = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 110 / C_MPS)), landed: undefined }, false, "a320");
  c.s.flightMode = "plane";
  c.gearDown = false;
  c.gearExt = 0;
  c.gearInit = true;
  c.pilot.throttle = 1;
  c.s.wind = 0;
  fly(25);
  const ias: number[] = [];
  let trend = 0;
  for (let i = 0; i < 180; i++) {
    fly(1 / 30);
    const d = duData(c, c.s, {}, new Date("2026-07-10T12:00:00Z"))!;
    ias.push(d.ias);
    trend = d.iasTrend;
  }
  // (the speed's own rate over the last 2 s [kt/s], and the arrow's — 10 s ahead)
  const rate = (ias[179]! - ias[119]!) / 2;
  console.log(
    `  the speed's rate ${rate.toFixed(2)} kt/s · the trend arrow ${trend.toFixed(1)} kt in 10 s (${(trend / 10).toFixed(2)} kt/s)`,
  );
  expect(Math.abs(rate)).toBeGreaterThan(1);
  expect(Math.abs(trend / 10 - rate)).toBeLessThan(0.15 * Math.abs(rate));
});
