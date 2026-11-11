import { expect, test } from "bun:test";
import { coarseUnknown, lidarSuspect, lidarYields, overground } from "../src/system/earth-tiles";

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

test("a low LiDAR ramp across water (the étang des Pesquiers, 11 Nov 2026 — up to 14.7 m, under 15 and 40 m): suspect, and yields to RGE ALTI's sea; a dune stays", () => {
  // (a tile whose half over the coarse sea's cells stands 14.7 m up)
  const ramp = new Float32Array(T * T).map((_, i) => ((i % T) > T / 2 ? 14.7 : 0.8));
  expect(lidarSuspect(ramp, new Float32Array(256).fill(0))).toBeTrue();
  // (a dune: RGE ALTI has it too — the LiDAR kept; the same height over RGE ALTI's sea — given way; within a few metres: kept)
  expect(lidarYields(12, 11)).toBeFalse();
  expect(lidarYields(14.7, 0)).toBeTrue();
  expect(lidarYields(2.5, 0.2)).toBeFalse();
  expect(lidarYields(Number.NaN, 0)).toBeTrue();
  expect(lidarYields(40, 20)).toBeTrue();
  // (a land tile on a land's coarse cells: not suspect)
  expect(lidarSuspect(new Float32Array(T * T).fill(9), new Float32Array(256).fill(8))).toBeFalse();
});
