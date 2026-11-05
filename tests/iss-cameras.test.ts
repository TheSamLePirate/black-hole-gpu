import { expect, test } from "bun:test";
import { ISS_CAMERAS, issCamera } from "../src/system/iss-cameras";
import { station } from "../src/system/iss";

// Q6-ISS ISS1 — the live streams' cameras on the station (src/system/iss-cameras.ts): every line of sight a unit vector; the Sen
// cameras on Bartolomeo (starboard of Harmony, forward); the docking camera looking to port at IDA-2, whose port the station's own
// table (iss.ts station.ports) puts within a metre of the model's ring.
test("ISS1: the cameras' mounts and lines of sight", () => {
  for (const c of ISS_CAMERAS) expect(Math.hypot(...c.look)).toBeCloseTo(1, 9);
  const dock = issCamera("sen-docking");
  expect(dock.mount[1]).toBeGreaterThan(2);
  expect(dock.look[1]).toBeLessThan(-0.8);
  const ida2 = station.ports[0]!.centre;
  const d = Math.hypot(ida2[0] - dock.mount[0], ida2[1] - dock.mount[1], ida2[2] - dock.mount[2]);
  const target = dock.mount.map((m, i) => m + dock.look[i]! * d);
  expect(Math.hypot(target[0]! - ida2[0], target[1]! - ida2[1], target[2]! - ida2[2])).toBeLessThan(1);
  expect(issCamera("sen-nadir").look).toEqual([0, 0, 1]);
});
