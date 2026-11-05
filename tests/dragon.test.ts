import { expect, test } from "bun:test";
import { dragonMesh } from "../src/system/dragon";

// Q6-ISS — the visiting Crew Dragon (src/system/dragon.ts): built along a port's outward axis from its ring, 6.55 m long, at
// most 2 m from its axis, its normals unit, its indices within its vertices (offset by the base given)
test("the Dragon's mesh along its port", () => {
  const centre: [number, number, number] = [15.655, -0.017, 5.56];
  const m = dragonMesh(centre, [1, 0, 0], 100);
  const n = m.vertices.byteLength / 24;
  expect(m.count % 3).toBe(0);
  expect(Math.min(...m.indices)).toBe(100);
  expect(Math.max(...m.indices)).toBe(100 + n - 1);
  const dv = new DataView(m.vertices.buffer);
  let sMin = Infinity,
    sMax = -Infinity,
    rMax = 0,
    solar = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 24;
    const p = [0, 1, 2].map((k) => dv.getFloat32(o + 4 * k, true));
    const s = p[0]! - centre[0];
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
    rMax = Math.max(rMax, Math.hypot(p[1]! - centre[1], p[2]! - centre[2]));
    const nn = [0, 1, 2].map((k) => dv.getInt8(o + 12 + k) / 127);
    expect(Math.abs(Math.hypot(...nn) - 1)).toBeLessThan(0.02);
    if (dv.getUint8(o + 19) === 1) solar++;
    expect(dv.getUint8(o + 20)).toBe(0);
  }
  expect(sMin).toBeCloseTo(0, 5);
  expect(sMax).toBeCloseTo(6.55, 4);
  expect(rMax).toBeLessThanOrEqual(2.0001);
  expect(solar).toBeGreaterThan(0);
});
