import { expect, test } from "bun:test";
import { intervals, J0_SCENE } from "./e2e/lib/j0-scene";

// J0's statistics (docs/J0-CONTRAT.md §4): the intervals between new images, their percentiles, the episodes over 33.3 ms
// and the GPU time of the images — what every fiche is written from.

test("the intervals between new images and their statistics", () => {
  // (images at 0, 25, 50, 75, then one late at 125 ms; GPU times 20, 22, 24, 26, 40 ms)
  const s = intervals([
    [0, 1, 20],
    [25, 1, 22],
    [50, 1, 24],
    [75, 1, 26],
    [125, 1, 40],
  ]);
  expect(s.images).toBe(5);
  expect(s.imagesPerS).toBe(32); // 4 intervals over 0.125 s
  expect(s.p50).toBe(25);
  expect(s.max).toBe(50);
  expect(s.p99).toBe(50);
  expect(s.over33).toBe(1);
  expect(s.over33ms).toBe(50);
  expect(s.gpuP50).toBe(24);
  expect(s.gpuP95).toBe(40);
});

test("no images: zeros, never NaN", () => {
  const s = intervals([]);
  expect(s).toEqual({ images: 0, imagesPerS: 0, p50: 0, p95: 0, p99: 0, max: 0, over33: 0, over33ms: 0, gpuP50: 0, gpuP95: 0 });
});

test("the scene is the one the contract names", () => {
  expect(J0_SCENE.id).toBe("toulon-hyeres-v1");
  expect(J0_SCENE.turnAtS).toBeLessThan(J0_SCENE.flightS);
});
