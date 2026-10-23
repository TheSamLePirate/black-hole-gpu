import { afterEach, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320 flown frame by frame by the controller itself (docs/PLAN-A320.md, A2 — its first-cut figures until A3
// reads FlightGear's FDM): a take-off run at full thrust, CONF 1+F, rotated at 145 kt; level flight held.

afterEach(resetFlights);

/** The pilot's stick held (pitch, roll: −1…1) while `f` runs. */
function withStick(c: ReturnType<typeof flight>["c"], s: { pitch?: number; roll?: number }, f: () => void) {
  const input = c.pilotInput.bind(c);
  c.pilotInput = (pad) => ({ ...input(pad), ...s });
  f();
  c.pilotInput = input;
}

test("a take-off at full thrust: airborne within 2.5 km, past 140 kt, climbing", () => {
  const g = ourGroundPose("earth", 34.905, -117.884, 0);
  const run = flight({ ...g, landed: g.landed }, false, "a320");
  const { c, fly } = run;
  c.s.flightMode = "plane";
  c.airFlight.cfg.flaps = 0.25;
  c.pilot.throttle = 1;
  let dist = 0;
  let rolled = 0;
  for (let i = 0; i < 60 * 30; i++) {
    const v = c.airFlight.last?.speed ?? 0;
    withStick(c, { pitch: v > 75 && (c.rolling || c.ourLanded) ? 0.7 : 0 }, () => fly(1 / 30));
    dist += v / 30;
    if (!c.rolling && !c.ourLanded && v > 60) break;
    rolled = i / 30;
  }
  const L = c.airFlight.last!;
  console.log(`  airborne after ${rolled.toFixed(1)} s, ${dist.toFixed(0)} m, at ${(L.speed / 0.5144).toFixed(0)} kt`);
  expect(c.rolling || c.ourLanded).toBeFalsy();
  expect(dist).toBeLessThan(2500);
  // (then the pitch held up 6 s — the pilot's rotation to the climb's attitude —, then 14 s released: climbing)
  const h0 = c.airFlight.last!.h;
  withStick(c, { pitch: 0.3 }, () => fly(3));
  fly(17);
  const h1 = c.airFlight.last!.h;
  console.log(`  20 s later: ${(h1 - h0).toFixed(0)} m higher, ${(c.airFlight.last!.speed / 0.5144).toFixed(0)} kt`);
  expect(h1 - h0).toBeGreaterThan(80);
  expect(c.airFlight.last!.speed / 0.5144).toBeGreaterThan(140);
}, 120_000);

test("cruise: FL350 at Mach 0.78 held on the thrust it has", () => {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, 10668 / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 230 / C_MPS)), landed: undefined }, false, "a320");
  const { c, fly } = run;
  c.s.flightMode = "plane";
  c.pilot.throttle = 0.85;
  c.pilot.engineNow = 0.85;
  fly(30);
  const L = c.airFlight.last!;
  console.log(`  after 30 s: Mach ${L.out.mach.toFixed(3)}, ${L.h.toFixed(0)} m`);
  expect(L.out.mach).toBeGreaterThan(0.7);
  expect(Math.abs(L.h - 10668)).toBeLessThan(400);
}, 120_000);
