import { expect, test } from "bun:test";
import { coarseUnknown, lidarSuspect, overground } from "../src/system/earth-tiles";

// The LiDAR HD's terrain interpolated over the sea (the Calanques, 5 Nov 2026 — a ramp of 76 to 274 m across a z 16 tile where
// RGE ALTI has the sea at 0): a tile standing 40 m off the coarser levels is suspect (ignGround then takes RGE ALTI wherever
// they part by more than 15 m); no overground over the sea's level (the surface model's ramps over the water).

const T = 256;

test("a LiDAR ramp over a coarse sea: suspect; the same land as the coarse levels: not", () => {
  const ramp = new Float32Array(T * T).map((_, i) => 76 + (Math.floor(i / T) / T) * 200);
  const sea = new Float32Array(256).fill(0);
  expect(lidarSuspect(ramp, sea)).toBeTrue();
  const land = new Float32Array(T * T).fill(120);
  expect(lidarSuspect(land, new Float32Array(256).fill(110))).toBeFalse();
  expect(lidarSuspect(land, new Float32Array(256).fill(Number.NaN))).toBeFalse();
});

test("coarser levels that cannot judge (Giens, 10 Nov 2026 — a z 17 tile wholly interpolated over the sea, no hole): unknown", () => {
  expect(coarseUnknown(new Float32Array(256).fill(Number.NaN))).toBeTrue();
  const few = new Float32Array(256).fill(Number.NaN);
  few.fill(0, 0, 40);
  expect(coarseUnknown(few)).toBeTrue();
  expect(coarseUnknown(new Float32Array(256).fill(0))).toBeFalse();
});

test("no overground over the sea: a surface ramp over a ground at 0 adds nothing; over land it stays", () => {
  const ground = new Float32Array(T * T).fill(0);
  const surface = new Float32Array(T * T).map((_, i) => 50 + (Math.floor(i / T) / T) * 200);
  expect(Math.max(...overground(ground, surface, T))).toBe(0);
  const land = new Float32Array(T * T).fill(20);
  const trees = new Float32Array(T * T).fill(45);
  expect(Math.max(...overground(land, trees, T))).toBeCloseTo(25, 3);
});
