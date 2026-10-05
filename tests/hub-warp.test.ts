import { expect, test } from "bun:test";
import { CameraController } from "../src/controls";

function controller(autoWarp: boolean, speed: number) {
  return Object.assign(Object.create(CameraController.prototype), {
    s: { autoWarp, timeSpeed: speed },
    hubWarpWant: null,
    hubWarpLimit: null,
    warpWant: 9999,
    warpSet: speed,
  }) as CameraController;
}

test("manual hub warp retains slow motion and recovers the user's choice after a tighter ceiling", () => {
  const c = controller(false, 0.25);
  c.setHubWarp(100);
  expect(c.s.timeSpeed).toBe(0.25);
  expect(c.warpWant).toBeNull();
  c.hubWarpWant = 50;
  c.hubWarpLimit = null;
  c.setHubWarp(1);
  expect(c.s.timeSpeed).toBe(1);
  expect(c.hubWarpWant).toBe(50);
  c.hubWarpLimit = null;
  c.setHubWarp(100);
  expect(c.s.timeSpeed).toBe(50);
});

test("hub constraints combine and auto warp can be resumed independently of flight assistance", () => {
  const c = controller(true, 1);
  c.setHubWarp(4);
  c.setHubWarp(1000);
  expect(c.s.timeSpeed).toBe(4);
  c.setHubWarp(1);
  expect(c.s.timeSpeed).toBe(1);
  c.s.autoWarp = false;
  c.setHubWarp(4);
  expect(c.s.timeSpeed).toBe(1);
  c.s.autoWarp = true;
  c.hubWarpLimit = null;
  c.setHubWarp(4);
  expect(c.s.timeSpeed).toBe(4);
  expect(c.hubWarpWant).toBeNull();
});

test("node guidance exposes the same ceiling and retains a higher manual request while held", () => {
  const c = controller(false, 1);
  c.nodeWarpWant = 20;
  c.nodeWarpSet = 1;
  c.setNodeWarp(4);
  expect(c.hubWarpLimit).toBe(4);
  expect(c.s.timeSpeed).toBe(4);
  expect(c.nodeWarp).toBe("held");
  c.setNodeWarp(40);
  expect(c.s.timeSpeed).toBe(20);
  expect(c.nodeWarp).toBe("manual");
});
