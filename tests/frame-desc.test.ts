import { expect, test } from "bun:test";
import { type FrameCamera, nextFrameDesc } from "../src/frame-desc";

// PLAN-J1 J1-1: the frame's frozen description — its id counts, its real clock's step, the camera before carried, nothing shared
// with the caller's objects.
const cam = (x: number): FrameCamera => ({ right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, x], tanHalf: 0.5 });

test("the first frame: id 1, no step, no camera before", () => {
  const f = nextFrameDesc(null, { realMs: 1000, flightMs: 50, simTime: 3, camera: cam(1) });
  expect(f.id).toBe(1);
  expect(f.dtRealMs).toBe(0);
  expect(f.prev).toBeNull();
  expect(f.flightMs).toBe(50);
  expect(f.simTime).toBe(3);
});

test("the next frame: its step, the camera before, copies", () => {
  const c0 = cam(1);
  const f0 = nextFrameDesc(null, { realMs: 1000, flightMs: 0, simTime: 0, camera: c0 });
  const c1 = cam(-1);
  const f1 = nextFrameDesc(f0, { realMs: 1016.7, flightMs: 16.7, simTime: 0.0167, camera: c1 });
  expect(f1.id).toBe(2);
  expect(f1.dtRealMs).toBeCloseTo(16.7, 6);
  expect(f1.prev!.fwd).toEqual([0, 0, 1]);
  expect(f1.camera.fwd).toEqual([0, 0, -1]);
  // (the caller's camera changed afterwards: the frame's own is not)
  c1.fwd[2] = 5;
  c0.fwd[2] = 7;
  expect(f1.camera.fwd[2]).toBe(-1);
  expect(f1.prev!.fwd[2]).toBe(1);
});

test("a clock that went back (a reset): no negative step", () => {
  const f0 = nextFrameDesc(null, { realMs: 2000, flightMs: 0, simTime: 0, camera: cam(1) });
  const f1 = nextFrameDesc(f0, { realMs: 1500, flightMs: 0, simTime: 0, camera: cam(1) });
  expect(f1.dtRealMs).toBe(0);
});
