import { expect, test } from "bun:test";
import { SHORE_FAR, SHORE_LAND, SHORE_REACH, shoreDistance } from "../src/system/earth-shore";
import { SHORE_LEVELS } from "../src/system/earth-shore-layout";
import { TERRAIN_CACHE_LEVELS } from "../src/system/terrain-cache-layout";

// T7 — the shore's distances (system/earth-shore.ts: the GPU's bake searches the same neighbours): a sea node's distance to the
// nearest land node, land nodes 0, the open sea SHORE_FAR.

test("a straight coast: the sea's nodes their distance to it, the land 0, beyond reach the open sea", () => {
  // (land where i < 10, the sea beyond; 6 m nodes)
  const h = (i: number) => (i < 10 ? 5 : -3);
  expect(shoreDistance((i) => h(i), 5, 0, 6)).toBe(0);
  expect(shoreDistance((i) => h(i), 10, 0, 6)).toBeCloseTo(6, 6);
  expect(shoreDistance((i) => h(i), 12, 0, 6)).toBeCloseTo(18, 6);
  expect(shoreDistance((i) => h(i), 9 + SHORE_REACH + 1, 0, 6)).toBe(SHORE_FAR);
});

test("a rock out of the sea a node wide: the diagonal distance; a node at the land's threshold is sea", () => {
  const h = (i: number, j: number) => (i === 0 && j === 0 ? 12 : 0);
  expect(shoreDistance(h, 2, 2, 6)).toBeCloseTo(Math.hypot(2, 2) * 6, 6);
  expect(shoreDistance(() => SHORE_LAND, 0, 0, 6)).toBe(SHORE_FAR);
});

test("the levels are the cache's", () => {
  for (const l of SHORE_LEVELS) expect(l).toBeLessThan(TERRAIN_CACHE_LEVELS);
});
