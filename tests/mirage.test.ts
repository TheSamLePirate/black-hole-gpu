import { expect, test } from "bun:test";
import { imagesOf, MIRAGE_N, MIRAGE_VEC4S, mirageProfile, mirageRay, mirageTable, mirageTables } from "../src/system/mirage";
import { airProfile, refraction } from "../src/system/refraction-layered";

// R6a-ciel, first lot — the mirages' rays from the eye (system/mirage.ts): RK4 through the turning points, under forced profiles.
const D = Math.PI / 180;
const air = { pMsl: 101325, tGround: 20, rh: 0.5 };

test("the standard air: the rays as the layered model bends them, the table monotonic", () => {
  const P = mirageProfile("standard", air);
  const L = airProfile(air);
  for (const e of [0.1, 0.3, 1]) {
    const t = mirageRay(P, 10, e * D)!;
    // (the layered model's refraction from the same eye — its own low air the standard one, not the forced profile's grid)
    expect(Math.abs(t - (e * D - refraction(L, e * D, 10)!)) / D).toBeLessThan(0.02);
  }
  const T = mirageTable(P, 10, -0.4 * D, 0.4 * D, 81);
  let prev = Number.NEGATIVE_INFINITY;
  for (const v of T.trueAlt) {
    if (Number.isNaN(v)) continue;
    expect(v).toBeGreaterThan(prev);
    prev = v;
  }
  // (one image of a body: the Sun at −0.3° true seen once)
  expect(imagesOf(T, -0.3 * D).length).toBe(1);
});

test("a warm sea: rays below the horizon turn up — the Sun just set seen twice, upright and inverted (the Etruscan vase)", () => {
  const S = mirageTable(mirageProfile("standard", air), 10, -0.4 * D, 0.4 * D, 161);
  const W = mirageTable(mirageProfile("warmSea", air), 10, -0.4 * D, 0.4 * D, 161);
  const firstClear = (T: typeof S) => T.lo + ((T.hi - T.lo) * T.trueAlt.findIndex((v) => !Number.isNaN(v))) / (T.trueAlt.length - 1);
  // (the sea's line lower: rays the standard air sends into the sea escape)
  expect(firstClear(W)).toBeLessThan(firstClear(S) - 0.05 * D);
  // (a body at −0.45° true: two images, one under the other, the lower one under the standard horizon)
  const im = imagesOf(W, -0.45 * D);
  expect(im.length).toBe(2);
  expect(Math.min(...im)).toBeLessThan(firstClear(S));
  expect(imagesOf(S, -0.45 * D).length).toBeLessThanOrEqual(1);
});

test("an inversion aloft: a duct — the low rays trapped down to the sea, the horizon raised", () => {
  const S = mirageTable(mirageProfile("standard", air), 10, -0.2 * D, 0.3 * D, 51);
  const I = mirageTable(mirageProfile("inversion", air), 10, -0.2 * D, 0.3 * D, 51);
  const firstClear = (T: typeof S) => T.lo + ((T.hi - T.lo) * T.trueAlt.findIndex((v) => !Number.isNaN(v))) / (T.trueAlt.length - 1);
  expect(firstClear(I)).toBeGreaterThan(firstClear(S) + 0.1 * D);
});

test("the GPU's tables: a header, three colours, the sea marked; the colours' elevations a little apart (dispersion)", () => {
  const f = mirageTables("warmSea", air, 10);
  expect(f.length).toBe(MIRAGE_VEC4S * 4);
  expect(f[0]).toBe(1);
  expect(f[1]).toBe(10);
  const col = (c: number) => f.subarray(4 + c * MIRAGE_N, 4 + (c + 1) * MIRAGE_N);
  // (the band's lowest rays into the sea, its highest out)
  expect(col(1)[0]).toBe(-10);
  expect(col(1)[MIRAGE_N - 1]!).toBeGreaterThan(-0.01);
  // (blue bent more than red near the horizon: its true elevation a little lower for the same apparent one)
  const i = MIRAGE_N - 1;
  expect(col(2)[i]!).toBeLessThan(col(0)[i]!);
});
