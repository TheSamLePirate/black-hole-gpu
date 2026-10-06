import { afterEach, expect, test } from "bun:test";
import { setHomePose } from "../src/camera";
import { CameraController } from "../src/controls";
import { fleet } from "../src/fleet";
import { ourOrbitPose } from "../src/game/place";
import { defaultSettings, presets } from "../src/settings";
import { C_MPS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// A manoeuvre node executed in our universe (the node autopilot), flown headless frame by frame: the
// Crew engine answers its throttle with a lag (the Ranger's 0.4 s), so a burn cut when its Δv is given
// still gets the engine's run-down — 8 m/s more at full thrust. The cut comes that much early: the burn
// gives its Δv, the run-down included.

// (the propellant these flights burn is the fleet's — global: given back for the other tests)
afterEach(() => {
  fleet.tanks = null;
  fleet.spent = {};
});

test("a node's burn gives its Δv, the engine's run-down included", () => {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, target: "earth" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const p = ourOrbitPose({ body: "earth", altKm: 400, inc: 51.6 }, c.nowTime());
  setHomePose(s, p.X, p.fwd, p.up, p.vel);
  s.motion = "geodesic";
  c.setPilot(true);
  c.newFlight();
  c.sync();
  // (50 m/s prograde in two minutes)
  c.fcSetPlan([{ t: 120, dv: [50, 0, 0], label: "test" }], "test");
  const sp0 = c.spent;
  c.fcExecute();
  for (let i = 0; i < 20000 && c.pilot.auto !== "none"; i++) c.flyShip(1 / 30, null as never);
  expect(c.pilot.auto).toBe("none");
  // (the engine run down: its last thrust counted)
  for (let i = 0; i < 300; i++) c.flyShip(1 / 30, null as never);
  expect(c.pilot.engineNow).toBeLessThan(1e-3);
  expect(Math.abs((c.spent - sp0) * C_MPS - 50)).toBeLessThan(0.3);
}, 60_000);
