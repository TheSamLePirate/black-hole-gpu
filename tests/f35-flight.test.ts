import { afterEach, expect, test } from "bun:test";
import { fleet } from "../src/fleet";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The F-35B flown frame by frame by the controller itself (docs/PLAN-F35.md, F3): its turbofan's thrust and
// fuel, its flight control system's rates and limits — a take-off run on the afterburner, a roll at full stick,
// a pull at full stick held at 7 g, the fuel burnt.

afterEach(resetFlights);

const D = Math.PI / 180;

/** The F-35 in the air over the Atlantic: `h` up, `v` m/s eastwards, the throttle at `thr`. */
function cruise(h = 3000, v = 240, thr = 0.75) {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, h / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, v / C_MPS)), landed: undefined }, false, "f35");
  run.c.s.flightMode = "plane";
  run.c.pilot.throttle = thr;
  run.c.pilot.engineNow = thr;
  run.fly(1);
  return run;
}

/** The pilot's stick held (pitch, roll: −1…1) while `fly` runs. */
function withStick(c: ReturnType<typeof flight>["c"], s: { pitch?: number; roll?: number }, f: () => void) {
  const input = c.pilotInput.bind(c);
  c.pilotInput = (pad) => ({ ...input(pad), ...s });
  f();
  c.pilotInput = input;
}

test("a take-off on the afterburner: off the runway within a kilometre, past 150 kt", () => {
  // (Edwards's level, the nose east along the ground)
  const g = ourGroundPose("earth", 34.905, -117.884, 0);
  const run = flight({ ...g, landed: g.landed }, false, "f35");
  const { c, fly } = run;
  c.s.flightMode = "plane";
  c.pilot.throttle = 1;
  c.jetToggle("ab");
  // (the run measured on the ground: body-fixed — the home frame moves with the Earth)
  const along = () => Number(c.airFlight.last?.speed ?? 0);
  let dist = 0;
  let rolled = 0;
  // (the stick back past 130 kt — the rotation —, released once off)
  for (let i = 0; i < 60 * 30; i++) {
    const L = c.airFlight.last;
    const v = L?.speed ?? 0;
    withStick(c, { pitch: v > 67 && (c.rolling || c.ourLanded) ? 0.8 : 0 }, () => fly(1 / 30));
    dist += along() / 30;
    if (!c.rolling && !c.ourLanded && v > 50) break;
    rolled = i / 30;
  }
  const L = c.airFlight.last!;
  const run_m = dist;
  console.log(`  airborne after ${rolled.toFixed(1)} s, ${run_m.toFixed(0)} m, at ${(L.speed / 0.5144).toFixed(0)} kt`);
  expect(c.rolling || c.ourLanded).toBeFalsy();
  expect(run_m).toBeLessThan(1100);
  expect(L.speed / 0.5144).toBeGreaterThan(130);
}, 120_000);

test("a full-stick roll: some 180°/s, the wings round in two seconds", () => {
  const { c, fly } = cruise(4000, 250);
  let peak = 0;
  withStick(c, { roll: 1 }, () => {
    for (let i = 0; i < 45; i++) {
      fly(1 / 30);
      peak = Math.max(peak, Math.abs(c.pilot.omega[2]));
    }
  });
  console.log(`  roll rate ${(peak / D).toFixed(0)}°/s`);
  expect(peak / D).toBeGreaterThan(150);
  expect(peak / D).toBeLessThan(230);
}, 120_000);

test("a full-stick pull: held at 7 g, never past it", () => {
  const { c, fly } = cruise(3000, 260, 1);
  let gPeak = 0;
  withStick(c, { pitch: 1 }, () => {
    for (let i = 0; i < 90; i++) {
      fly(1 / 30);
      gPeak = Math.max(gPeak, c.airFlight.g);
    }
  });
  console.log(`  load ${gPeak.toFixed(2)} g`);
  expect(gPeak).toBeGreaterThan(6);
  expect(gPeak).toBeLessThan(7.6);
  expect(c.airFlight.failure ?? null).toBeNull();
}, 120_000);

test("its fuel burnt by its thrust: a minute at full dry thrust ~ 150 kg, the mass lighter by it", () => {
  const { c, fly } = cruise(1000, 230, 1);
  const m0 = fleet.massProps().mass;
  const f0 = fleet.fuel.f35 ?? 6125;
  fly(60);
  const burnt = f0 - fleet.fuel.f35!;
  console.log(`  ${burnt.toFixed(0)} kg in a minute at full dry thrust`);
  expect(burnt).toBeGreaterThan(100);
  expect(burnt).toBeLessThan(220);
  expect(m0 - fleet.massProps().mass).toBeCloseTo(burnt, 0);
  void c;
}, 120_000);
