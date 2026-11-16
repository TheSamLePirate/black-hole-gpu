import { expect, test } from "bun:test";
import { CRUISE, type FlightState, expectFlight, flightProblems } from "./e2e/lib/flight-state";

// The flight state's judge (docs/E2E-VOLS.md, rule 13 — tests/e2e/lib/flight-state.ts), without a browser: a cruise flown as a pilot
// leaves it passes; each absurd state — the glide at idle, the holds off, the gear out in cruise or up on the final, the stall's edge,
// a steep bank, the simulation frozen — is named.

const D = Math.PI / 180;
const cruise: FlightState = {
  craft: "f35",
  inAir: true,
  onGround: false,
  ap: true,
  athr: true,
  engine: 0.55,
  lever: 0.55,
  gearDown: false,
  gearExt: 0,
  speed: 150,
  gs: 150,
  vs: 0,
  agl: 900,
  alpha: 3 * D,
  stallA: 20 * D,
  stalled: false,
  pitch: 3,
  bank: 0,
  frozen: false,
  spdTarget: 150,
  axis: null,
};

test("a cruise flown as a pilot leaves it: no problem; the cruise's bounds pass", () => {
  expect(flightProblems(cruise, "cruise")).toEqual([]);
  expectFlight(cruise, "cruise", CRUISE);
});

test("each absurd state named: the glide at idle, the holds off, the gear, the stall, the attitude", () => {
  expect(flightProblems({ ...cruise, engine: 0, lever: 0 }, "cruise").join()).toMatch(/no thrust/);
  expect(flightProblems({ ...cruise, ap: false }, "cruise").join()).toMatch(/no autopilot/);
  expect(flightProblems({ ...cruise, athr: false }, "cruise").join()).toMatch(/no autothrottle/);
  expect(flightProblems({ ...cruise, gearDown: true, gearExt: 1 }, "cruise").join()).toMatch(/gear not up/);
  expect(flightProblems({ ...cruise, agl: 200 }, "final").join()).toMatch(/gear not down and locked/);
  expect(flightProblems({ ...cruise, gearDown: true, gearExt: 0.5, agl: 200 }, "final").join()).toMatch(
    /gear not down and locked \(lever true, 50 %\)/,
  );
  expect(flightProblems({ ...cruise, alpha: 19.5 * D }, "cruise").join()).toMatch(/stall's edge/);
  expect(flightProblems({ ...cruise, stalled: true }, "cruise").join()).toMatch(/stalled/);
  expect(flightProblems({ ...cruise, bank: 70 }, "cruise").join()).toMatch(/bank 70/);
  expect(flightProblems({ ...cruise, pitch: 50, speed: 60 }, "cruise").join()).toMatch(/pitch 50/);
  // (frozen is no fault: a stepped flight is read frozen)
  expect(flightProblems({ ...cruise, frozen: true }, "cruise")).toEqual([]);
  // (the flare: the thrust at idle allowed, the gear down asked; on the ground: only the gear)
  expect(flightProblems({ ...cruise, engine: 0, gearDown: true, gearExt: 1, agl: 5, ap: false, athr: false }, "flare")).toEqual([]);
  expect(
    flightProblems({ ...cruise, onGround: true, inAir: false, engine: 0, ap: false, athr: false, gearDown: true, gearExt: 1 }, "ground"),
  ).toEqual([]);
  // (idle under an autothrottle slowing to its target, or its target not known (an ILS): a pilot's; without one, a glide)
  expect(flightProblems({ ...cruise, engine: 0, speed: 169, spdTarget: 160 }, "cruise")).toEqual([]);
  expect(flightProblems({ ...cruise, engine: 0, speed: 139, spdTarget: null }, "approach")).toEqual([]);
  expect(flightProblems({ ...cruise, engine: 0, speed: 150, spdTarget: 150 }, "cruise").join()).toMatch(/no thrust/);
  expect(flightProblems({ ...cruise, engine: 0, athr: false }, "approach", { athr: false }).join()).toMatch(/no thrust/);
  expectFlight({ ...cruise, engine: 0, speed: 169, spdTarget: 160 }, "slowing", CRUISE);
  // (on the runway: lined up within 1° and 3 m, rolling within 3° and 6 m — Sam, 16 Nov 2026: an A320 seen off the axis)
  const ground = { ...cruise, inAir: false, onGround: true, ap: false, athr: false, gearDown: true, gearExt: 1, speed: 0, gs: 0 };
  const axis = { des: "25", hdgErr: 0.3, trkErr: null, across: 1.2, along: 60 };
  expect(flightProblems({ ...ground, axis }, "lineup")).toEqual([]);
  expect(flightProblems({ ...ground, axis: { ...axis, hdgErr: 2.1 } }, "lineup").join()).toMatch(/heading 2.1° off runway 25/);
  expect(flightProblems({ ...ground, axis: { ...axis, across: -4 } }, "lineup").join()).toMatch(/4.0 m left of runway 25/);
  expect(flightProblems({ ...ground, axis: { ...axis, hdgErr: 2.1, across: 5 } }, "roll")).toEqual([]);
  expect(flightProblems({ ...ground, axis: null }, "roll").join()).toMatch(/no runway/);
  // (the bounds' assertion fails on a glide at idle)
  expect(() => expectFlight({ ...cruise, engine: 0 }, "glide", CRUISE)).toThrow();
});

test("the take-off roll's watch (axisWatchProblems): on the axis passes; a drift, a swerve, no roll do not", async () => {
  const { axisWatchProblems } = await import("./e2e/lib/flight-state");
  const w = { rows: [], worstHdg: 1.2, worstTrk: 1, worstAcross: 2.5, rolled: 200, des: "25" };
  expect(axisWatchProblems(w)).toEqual([]);
  expect(axisWatchProblems({ ...w, worstAcross: 9 }).join()).toMatch(/9.0 m off runway 25's centreline/);
  expect(axisWatchProblems({ ...w, worstHdg: 4 }).join()).toMatch(/4.0° off/);
  expect(axisWatchProblems({ ...w, rolled: 0 }).join()).toMatch(/no roll/);
});

test("the step monitor's judge (lib/held.ts monitorProblems): a managed descent at idle passes; a glide with nobody on the throttle, the stall's edge, the gear up at the touch do not", async () => {
  const { monitorProblems } = await import("./e2e/lib/held");
  const good = {
    n: 100,
    minEngine: 0,
    maxAlpha: 0.4,
    maxBank: 30,
    maxPitch: 8,
    minPitch: -5,
    minSpeed: 86,
    apOff: 0,
    athrOff: 0,
    idleUnheld: 0,
    touchGear: { down: true, ext: 1 },
  };
  expect(monitorProblems(good, { landed: true })).toEqual([]);
  expect(monitorProblems({ ...good, idleUnheld: 12, athrOff: 12 }, { landed: true }).join()).toMatch(/glide at idle with no autothrottle/);
  expect(monitorProblems({ ...good, maxAlpha: 0.95 }).join()).toMatch(/stall's edge/);
  expect(monitorProblems({ ...good, touchGear: { down: false, ext: 0 } }, { landed: true }).join()).toMatch(/gear not down and locked/);
  expect(monitorProblems({ ...good, apOff: 5 }, { ap: false })).toEqual([]);
  expect(monitorProblems({ ...good, n: 0 }).join()).toMatch(/no step watched/);
});
