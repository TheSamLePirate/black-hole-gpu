// PROBLEMES « L'eau sous Cheviré » (25 Nov 2026): the relief under inland water made level where the relief's tiles are prepared
// (water-flatten.ts — earth-tiles.ts refine → the decode worker): a spike and a deck's ridge in a river's bed taken down to the water
// about them; the banks, the land and a tile without water as they are; never raised. The positive witnesses fail on the code before
// (nothing levelled: the ridge's 5 m stayed).
import { expect, test } from "bun:test";
import { isFine, markFine } from "../src/system/earth-tiles";
import { FLATTEN_RADIUS_M, flattenUnderWater } from "../src/system/water-flatten";

const T = 256;
/** a river 60 texels wide (x 100–160) at 2 m, the land at 8 m; mpp 2 */
function scene() {
  const h = new Float32Array(T * T),
    cover = new Float32Array(T * T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const wet = x >= 100 && x < 160;
      h[y * T + x] = wet ? 2 : 8;
      cover[y * T + x] = wet ? 1 : x === 99 || x === 160 ? 0.5 : 0;
    }
  return { h, cover };
}

test("a deck's ridge across the river (5 m, 10 texels) and a spike in its bed taken down to the water about them", () => {
  const { h, cover } = scene();
  for (let y = 120; y < 130; y++) for (let x = 100; x < 160; x++) h[y * T + x] = 5.1;
  h[60 * T + 130] = 4.6;
  const lowered = flattenUnderWater(h, cover, 2);
  expect(lowered).toBe(10 * 60 + 1);
  for (let x = 100; x < 160; x++) expect(h[125 * T + x]!).toBeCloseTo(2, 5);
  expect(h[60 * T + 130]!).toBeCloseTo(2, 5);
});

test("the land beside it, the banks, a tile without water as they are; never raised; a pool wider than the reach kept", () => {
  const { h, cover } = scene();
  // (a hole in the bed: lower than the water — kept, never raised, never spread to its neighbours)
  h[40 * T + 120] = 0.5;
  const before = h.slice();
  flattenUnderWater(h, cover, 2);
  expect(h[40 * T + 120]).toBe(0.5);
  expect(h[40 * T + 121]).toBe(2);
  expect(h[40 * T + 50]).toBe(8);
  expect(h[40 * T + 99]).toBe(8);
  expect(h[40 * T + 160]).toBe(8);
  // (no water: nothing)
  expect(flattenUnderWater(before.slice(), new Float32Array(T * T), 2)).toBe(0);
  // (a pool higher than the water downstream — over a weir —, past the reach: kept)
  const g = scene();
  const far = Math.ceil(FLATTEN_RADIUS_M / 2) + 4;
  for (let y = 0; y < 128; y++) for (let x = 100; x < 160; x++) g.h[y * T + x] = 6;
  flattenUnderWater(g.h, g.cover, 2);
  expect(g.h[(128 - far) * T + 130]).toBe(6);
});

test("each texel's survey mark (its last bit — markFine) kept", () => {
  const { h, cover } = scene();
  h[60 * T + 130] = 4.6;
  markFine(h, true);
  flattenUnderWater(h, cover, 2);
  expect(isFine(h[60 * T + 130]!)).toBe(true);
  expect(Math.abs(h[60 * T + 130]! - 2)).toBeLessThan(1e-5);
});
