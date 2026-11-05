import { expect, test } from "bun:test";
import { ISS_CAMERAS, issCamera, issCameraFrame } from "../src/system/iss-cameras";
import { station } from "../src/system/iss";

// Q6-ISS ISS1 — the live streams' cameras on the station (src/system/iss-cameras.ts): every line of sight a unit vector; the Sen
// cameras on Bartolomeo (starboard of Harmony, forward); the docking camera looking to port at IDA-2, whose port the station's own
// table (iss.ts station.ports) puts within a metre of the model's ring.
test("ISS1: the cameras' mounts and lines of sight", () => {
  for (const c of ISS_CAMERAS) expect(Math.hypot(...c.look)).toBeCloseTo(1, 9);
  // (the docking camera: from Bartolomeo forward and to port — at the Dragon on IDA-2 —, 15° down, its wide framing 74° across)
  const dock = issCamera("sen-docking");
  expect(dock.mount[1]).toBeGreaterThan(2);
  expect(dock.look[0]).toBeGreaterThan(0.5);
  expect(dock.look[1]).toBeLessThan(-0.5);
  expect((Math.asin(dock.look[2]) * 180) / Math.PI).toBeCloseTo(15, 0);
  expect(dock.fovDeg).toBe(74);
  const ida2 = station.ports[0]!.centre;
  // (IDA-2 ahead of the mount and to port: the camera's side)
  expect(ida2[0] - dock.mount[0]).toBeGreaterThan(0);
  expect(ida2[1] - dock.mount[1]).toBeLessThan(0);
  expect(issCamera("sen-nadir").look).toEqual([0, 0, 1]);
  // (ISS2: the horizon camera looks aft, 47.5° down — the ground's flow, scripts/iss-flow-yaw.py)
  const hz = issCamera("sen-horizon");
  expect(hz.look[0]).toBeLessThan(-0.6);
  expect((Math.asin(hz.look[2]) * 180) / Math.PI).toBeCloseTo(45.5, 1);
  // (the NASA stream's camera: down, its picture's right aft, a 36° field)
  const nasa = issCamera("nasa-harmony");
  expect(nasa.look).toEqual([0, 0, 1]);
  expect(nasa.right![0]).toBe(-1);
  expect(nasa.fovDeg).toBe(36);
  // (the horizon's picture direct — ISS5, the Sun's fit —: its up the zenith's side)
  const hf = issCameraFrame("sen-horizon");
  expect(hf.mirrored).toBe(false);
  expect(hf.up[2]).toBeLessThan(0);
  expect(issCameraFrame("nasa-harmony").mirrored).toBe(false);
});
