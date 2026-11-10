import { expect, test } from "bun:test";
import { SHORE_FAR, SHORE_LAND, shoreDistance, shoreDistancesJfa } from "../src/system/earth-shore";
import { SHORE_LEVELS } from "../src/system/earth-shore-layout";
import { TERRAIN_CACHE_LEVELS } from "../src/system/terrain-cache-layout";

// T7 / PLAN-MER-WEBGPU L4 — the shore's distances (system/earth-shore.ts): a sea node's distance to the nearest land node over the
// whole window, land nodes 0, no land at all SHORE_FAR; the GPU's jump flood (its algorithm run on the CPU) against the exact search.

test("a straight coast: the sea's nodes their distance to it, however far, the land 0", () => {
  // (land where i < 10, the sea beyond; 6 m nodes; a 64-node window)
  const h = (i: number) => (i < 10 ? 5 : -3);
  expect(shoreDistance((i) => h(i), 5, 0, 6, 64)).toBe(0);
  expect(shoreDistance((i) => h(i), 10, 0, 6, 64)).toBeCloseTo(6, 6);
  expect(shoreDistance((i) => h(i), 12, 0, 6, 64)).toBeCloseTo(18, 6);
  expect(shoreDistance((i) => h(i), 60, 0, 6, 64)).toBeCloseTo(51 * 6, 6);
});

test("a rock out of the sea a node wide: the diagonal distance; a node at the land's threshold is sea; no land: far", () => {
  const h = (i: number, j: number) => (i === 0 && j === 0 ? 12 : 0);
  expect(shoreDistance(h, 2, 2, 6, 16)).toBeCloseTo(Math.hypot(2, 2) * 6, 6);
  expect(shoreDistance(() => SHORE_LAND, 0, 0, 6, 8)).toBe(SHORE_FAR);
});

test("the jump flood matches the exact search on an irregular coast (within a node at worst, mostly exact)", () => {
  const n = 96;
  // (a cape, a bay, islands — a pseudo-random coast, fixed)
  const land = (x: number, y: number) => {
    const coast = 30 + 12 * Math.sin(y / 9) + 6 * Math.sin(y / 3.1);
    const island = (x - 70) ** 2 + (y - 20) ** 2 < 25 || (x - 55) ** 2 + (y - 75) ** 2 < 9;
    return x < coast || island ? 5 : -10;
  };
  const jfa = shoreDistancesJfa(land, n, 24);
  let worst = 0;
  let exact = 0;
  for (let y = 0; y < n; y += 3)
    for (let x = 0; x < n; x += 3) {
      const e = shoreDistance(land, x, y, 24, n);
      const d = jfa[y * n + x]!;
      worst = Math.max(worst, Math.abs(d - e));
      if (Math.abs(d - e) < 1e-6) exact++;
    }
  expect(worst).toBeLessThanOrEqual(24);
  expect(exact / (32 * 32)).toBeGreaterThan(0.97);
});

test("the levels are the cache's", () => {
  for (const l of SHORE_LEVELS) expect(l).toBeLessThan(TERRAIN_CACHE_LEVELS);
});
