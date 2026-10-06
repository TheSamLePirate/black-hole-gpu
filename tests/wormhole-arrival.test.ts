import { afterEach, expect, test } from "bun:test";
import { cameraFrame, setHomePose } from "../src/camera";
import { CameraController } from "../src/controls";
import { fleet } from "../src/fleet";
import { ourOrbitPose } from "../src/game/place";
import { defaultSettings, presets } from "../src/settings";
import { M_SECONDS } from "../src/units";
import { mouth, setSceneTime } from "../src/wormhole";

// Our side, a mission into the wormhole: at its arrival node the throat is months wide at the craft's
// speed — the autopilot hands over a warp that crosses it in ~20 s. That warp was worked out, then dropped
// with the plan: the grand tour's craft (flight lab tour-jupiter-wormhole) waited at real time, short of
// the mouth, for ever.

afterEach(() => {
  fleet.tanks = null;
  fleet.spent = {};
});

test("into the wormhole: the arrival node hands over the crossing's warp, kept until out of the throat", () => {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, whOrbit: false };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const p = ourOrbitPose({ body: "earth", altKm: 400, inc: 30 }, c.nowTime());
  setHomePose(s, p.X, p.fwd, p.up, p.vel);
  s.motion = "geodesic";
  c.setPilot(true);
  c.newFlight();
  c.sync();
  s.timeSpeed = 1 / M_SECONDS;
  c.plan = { nodes: [{ t: c.nowTime() + 1e-4, dv: [0, 0, 0], role: "arrive", body: "wormhole" }], path: null, at: 0, note: "" };
  c.pilot.auto = "none";
  c.pilot.setAuto("node");
  for (let i = 0; i < 30 && c.plan.nodes.length; i++) c.flyShip(1 / 30, null as never);
  expect(c.plan.nodes.length).toBe(0);
  const nav = c.ourNav(cameraFrame(s))!;
  const want = Math.min((24 * mouth(s).w.rho) / Math.hypot(...nav.V) / 20, 1e4);
  expect(Math.abs(s.timeSpeed - want) / want).toBeLessThan(0.05);
  expect(c.traversing && c.crossingWarp).toBe(true);
});
