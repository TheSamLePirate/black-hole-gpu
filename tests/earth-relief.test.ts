import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { ourGroundPose } from "../src/game/place";
import { earthGround } from "../src/system/our-side";
import { gearHeight, groundRelief, setGroundRelief, toBodyFixed } from "../src/system/our-surface";
import { sunThroughY } from "../src/system/earth-air";
import { earthDetail, earthHeightSampler, toHalf } from "../src/terrain";

// The Earth's relief on the CPU (the ground the ship stands on, the tracer's earthHeight): its height
// map (metres, ETOPO 2022) as the tracer samples it near (a cubic B-spline over the texels, half floats),
// the detail finer than it.

const W = 64, H = 32;
const t0 = 109.6;

test("half floats: what the GPU's r16float keeps", () => {
  expect(toHalf(0)).toBe(0);
  expect(toHalf(1023)).toBe(1023);
  expect(toHalf(2049)).toBe(2050); // (2 m steps: ties to even)
  expect(toHalf(4807)).toBe(4808);
  expect(toHalf(-430)).toBe(-430);
  expect(toHalf(8849)).toBe(8848);
});

test("the map's sampler: a flat map gives its height, the sea stays at sea level", () => {
  const flat = earthHeightSampler(new Int16Array(W * H).fill(1770), W, H);
  const q: Vec3 = [0.6, 0.64, 0.48];
  const h0 = 1770;
  expect(flat(q)).toBeCloseTo(h0 + earthDetail(q, h0), 6);
  // (the sea floor below the sea: the sea's surface)
  const sea = earthHeightSampler(new Int16Array(W * H).fill(-3800), W, H);
  expect(sea([1, 0, 0])).toBe(0);
  expect(sea([0, 0, 1])).toBe(0);
  // (the tracer's half floats: 4 m steps above 4 096 m)
  expect(earthHeightSampler(new Int16Array(W * H).fill(4807), W, H)([1, 0, 0]) - earthDetail([1, 0, 0], 4808)).toBeCloseTo(4808, 6);
});

test("the B-spline: smooth across texels and across the date line", () => {
  const map = new Int16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) map[y * W + x] = 3500 + 35 * ((x * 37 + y * 11) % 50);
  const f = earthHeightSampler(map, W, H);
  // (just either side of lon ±180°: the same height)
  const e = 1e-10; // (0.6 mm apart: the rocks alike)
  expect(Math.abs(f([-1, e, 0]) - f([-1, -e, 0]))).toBeLessThan(0.01);
  // (no jump between neighbouring points: continuous)
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * 2 * Math.PI, b = a + 1e-9;
    worst = Math.max(worst, Math.abs(f([Math.cos(a), Math.sin(a), 0.1]) - f([Math.cos(b), Math.sin(b), 0.1])));
  }
  expect(worst).toBeLessThan(0.1);
});

test("with the relief known, the gear stands on it: landing on a 2 000 m plateau", () => {
  setGroundRelief("earth", () => 2000);
  try {
    const p = ourGroundPose("earth", 39.1, -106.45, t0);
    expect(Math.abs(gearHeight("earth", p.X, t0))).toBeLessThan(1e-3);
    expect(groundRelief("earth", toBodyFixed("earth", p.X, t0))).toBe(2000);
    const g = earthGround(t0);
    expect(Math.abs(gearHeight("earth", g.X, t0))).toBeLessThan(1e-3);
  } finally {
    setGroundRelief("earth", null);
  }
  expect(Math.abs(gearHeight("earth", earthGround(t0).X, t0))).toBeLessThan(1e-3);
});

test("the sunlight through the air: full overhead, reddened low, none in the planet's shadow", () => {
  expect(sunThroughY(400e3, 1)).toBeGreaterThan(0.999);
  const noon = sunThroughY(0, 1), low = sunThroughY(0, 0.05);
  expect(noon).toBeGreaterThan(0.7);
  expect(low).toBeLessThan(0.5 * noon);
  expect(sunThroughY(0, -0.2)).toBeLessThan(1e-6);
});
