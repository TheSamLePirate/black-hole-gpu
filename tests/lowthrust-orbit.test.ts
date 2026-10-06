import { afterEach, expect, test } from "bun:test";
import { cameraFrame, setHolePose } from "../src/camera";
import { CameraController } from "../src/controls";
import { fleet } from "../src/fleet";
import { theirOrbitPose } from "../src/game/place";
import { defaultSettings, presets } from "../src/settings";
import { setSceneTime } from "../src/wormhole";

// PLAN TRANSFER about Gargantua at 2 g (flight lab garg-lt-orbit-30-45): a spiral 30 → 45 M stops when the
// radius asked is reached, then rounds the orbit there. It once
// stopped where the climb reached the radius, its drift outwards still to take out: the circle ended at
// 50 M. Now within 1 M (the circling's own share of the thrust).

afterEach(() => {
  fleet.tanks = null;
  fleet.spent = {};
});

test("PLAN TRANSFER, a circular orbit 30 → 45 M at 2 g: circular at 45 M", () => {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["game:interstellar"]!, engine: "crew" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const p = theirOrbitPose({ body: "gargantua", rM: 30 }, 0, s.spin, s.massSolar);
  setHolePose(s, p.X, p.fwd, p.up, p.vel);
  s.motion = "geodesic";
  c.sync();
  c.setPilot(true);
  for (let i = 0; i < 3; i++) c.flyShip(1 / 30, null as never);
  c.planTransfer("orbit", 45);
  c.pilot.auto = "none";
  c.pilot.setAuto("transfer");
  for (let i = 0; i < 60000 && (c.pilot.auto as string) === "transfer"; i++) c.flyShip(1 / 30, null as never);
  expect(c.pilot.auto).not.toBe("transfer");
  expect(Math.abs(cameraFrame(s).r - 45)).toBeLessThan(1);
}, 300_000);
