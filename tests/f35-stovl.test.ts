import { afterEach, expect, test } from "bun:test";
import { cameraFrame } from "../src/camera";
import { fleet } from "../src/fleet";
import { swivelDeflection, swivelFor, thrustDir } from "../src/f35/stovl";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The F-35B's STOVL mode (docs/PLAN-F35.md, F4): the swivelling nozzle's geometry, the conversion, the hover law
// flown frame by frame by the controller itself — slowed to a hover, held in place, set down vertically.

afterEach(resetFlights);

const D = Math.PI / 180;

test("the three-bearing swivel: 95° at its end; the thrust's tilt aimed by it", () => {
  expect(swivelDeflection(0)).toBeCloseTo(0, 6);
  expect(swivelDeflection(1) / D).toBeCloseTo(95, 1);
  // (the fan's share up, the nozzle's forward at 0: 45°; a little back at 95°)
  expect(Math.atan2(thrustDir(0, 1)[2], thrustDir(0, 1)[1]) / D).toBeCloseTo(45, 0);
  expect(Math.atan2(thrustDir(1, 1)[2], thrustDir(1, 1)[1]) / D).toBeLessThan(0);
  const s = swivelFor(6 * D, 1);
  const d = thrustDir(s, 1);
  expect(Math.atan2(d[2], d[1]) / D).toBeCloseTo(6, 1);
});

/** The F-35B 120 m over the Atlantic, eastwards at `v` m/s, light (2.5 t of fuel), its STOVL mode on. */
function slow(v = 60) {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, 120 / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, v / C_MPS)), landed: undefined }, false, "f35");
  run.c.s.flightMode = "plane";
  fleet.fuel.f35 = 2500;
  run.c.pilot.throttle = 0.7;
  run.c.pilot.engineNow = 0.7;
  run.fly(0.5);
  run.c.stovlToggle();
  return run;
}

test("converted at 60 m/s, the hover law slows it to a stop and holds it there, its height kept", () => {
  const { c, fly } = slow(60);
  fly(8);
  expect(c.stovl.conv).toBe(1);
  expect(c.stovl.hover).toBe(true);
  for (let k = 0; k < 8; k++) {
    fly(5);
    const L = c.airFlight.last!;
    if (process.env.TRACE)
      console.log(
        `  t+${8 + 5 * (k + 1)} s: ${L.speed.toFixed(1)} m/s, swivel ${c.stovl.swivel.toFixed(2)}, thr ${c.pilot.throttle.toFixed(2)}, hover ${c.stovl.hover}, cmd ${c.stovl.cmd?.fwd.toFixed(1)}`,
      );
  }
  // (over the ground: the air may blow)
  const fr = c.sfFrame(cameraFrame(c.s))!;
  const gs = Math.hypot(...fr.vRel);
  console.log(
    `  after 48 s: ${gs.toFixed(2)} m/s over the ground, ${fr.h.toFixed(0)} m up, swivel ${c.stovl.swivel.toFixed(2)}, throttle ${c.pilot.throttle.toFixed(2)}`,
  );
  expect(gs).toBeLessThan(1);
  expect(Math.abs(fr.h - 120)).toBeLessThan(25);
  expect(c.stovl.swivel).toBeGreaterThan(0.55);
  expect(c.airFlight.failure ?? null).toBeNull();
}, 120_000);

test("in the hover, the throttle keys down: set down on its wheels, softly", () => {
  const run = slow(40);
  const { c, fly, msgs } = run;
  fly(40);
  const input = c.pilotInput.bind(c);
  c.pilotInput = (pad) => ({ ...input(pad), throttle: -1 });
  fly(90, () => !!c.rolling || !!c.ourLanded);
  fly(3);
  c.pilotInput = input;
  const td = msgs.find((m) => /Touchdown|crash|Hard/i.test(m)) ?? "";
  console.log(`  ${td}`);
  expect(!!c.rolling || !!c.ourLanded).toBe(true);
  expect(/crash|Hard|collapsed/i.test(td)).toBe(false);
}, 120_000);
