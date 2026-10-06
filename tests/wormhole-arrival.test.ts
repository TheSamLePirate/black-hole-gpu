import { afterEach, expect, test } from "bun:test";
import { cameraFrame, setHomePose } from "../src/camera";
import { CameraController } from "../src/controls";
import { fleet } from "../src/fleet";
import { ourOrbitPose } from "../src/game/place";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { ourTarget } from "../src/targeting";
import { M_SECONDS } from "../src/units";
import { mouth, setSceneTime } from "../src/wormhole";

// Our side, a mission into the wormhole: its arrival node was flown as a burn of nothing at its planned
// instant — the plan over, the craft short of the mouth at real time for months (flight lab
// tour-jupiter-wormhole); handing the crossing's warp over there instead flung a craft that then missed
// round the Sun at ×2 million. The arrival is now kept ahead of the craft until the mouth's reach takes
// it, the coast's warp bringing it in; going away from the mouth, it is said missed, at real time.

afterEach(() => {
  fleet.tanks = null;
  fleet.spent = {};
});

function flight() {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, whOrbit: false };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  c.setPilot(true);
  c.newFlight();
  const said: string[] = [];
  c.onPilotMessage = (m) => said.push(String(m));
  const arrive = () => {
    c.plan = { nodes: [{ t: c.nowTime() + 1e-4, dv: [0, 0, 0], role: "arrive", body: "wormhole" }], path: null, at: 0, note: "" };
    c.pilot.auto = "none";
    c.pilot.setAuto("node");
  };
  return { s, c, said, arrive };
}

test("on its way into the mouth: the arrival kept, the coast sped up to it", () => {
  const { s, c, arrive } = flight();
  const M = ourTarget(s, "wormhole", c.nowTime()).pos;
  const r = 60 * mouth(s).w.rho;
  setHomePose(s, [M[0] + r, M[1], M[2]] as Vec3, [-1, 0, 0], [0, 0, 1], [-0.01, 0, 0]);
  s.motion = "geodesic";
  c.sync();
  s.timeSpeed = 1 / M_SECONDS;
  arrive();
  for (let i = 0; i < 60; i++) c.flyShip(1 / 30, null as never);
  expect(c.plan.nodes.length).toBe(1);
  expect(c.pilot.auto).toBe("node");
  expect(s.timeSpeed * M_SECONDS).toBeGreaterThan(100);
});

test("going away from the mouth at its arrival: missed, said, at real time", () => {
  const { s, c, said, arrive } = flight();
  const p = ourOrbitPose({ body: "earth", altKm: 400, inc: 30 }, c.nowTime());
  setHomePose(s, p.X, p.fwd, p.up, p.vel);
  s.motion = "geodesic";
  c.sync();
  arrive();
  for (let i = 0; i < 3000 && c.plan.nodes.length; i++) c.flyShip(1 / 30, null as never);
  expect(c.plan.nodes.length).toBe(0);
  expect(said.some((m) => m.startsWith("The wormhole's mouth missed"))).toBe(true);
  expect(s.timeSpeed * M_SECONDS).toBeCloseTo(1, 6);
  expect(cameraFrame(s).region).not.toBe("hole");
});
