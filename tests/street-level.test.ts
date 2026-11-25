import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FADE_M, KERB_M, type LevelRoad, levelTile } from "../src/system/street-level";

// (25 Nov 2026, PROBLEMES « Ponts et routes : géométrie, supports et parité incomplets »: roadProfile/roadBank had no reader; the survey's
// ground about Paris's streets stepped by a metre at the buildings' feet, seen in silhouette.) A national relief tile levelled under its
// streets before it is kept — the one ground both the raster and the contact read (earth-tiles.ts nationalHeights).

const SIDE = 256;
const Z = 17,
  X = 66_400,
  Y = 45_100;
const D = Math.PI / 180;
const n = 2 ** Z;
const latOf = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) / D;
const lon0 = ((X + 0.5) / n) * 360 - 180,
  lat0 = latOf(Y + 0.5);
const kx = 111_320 * Math.cos(lat0 * D),
  ky = 111_132;
/** a pixel's place in the tile's local metres (east, north from its centre) */
const place = (i: number, j: number): [number, number] => [
  (((X + (i + 0.5) / SIDE) / n) * 360 - 180 - lon0) * kx,
  (latOf(Y + (j + 0.5) / SIDE) - lat0) * ky,
];
/** a road along the tile's middle, west to east: its carriageway 5 m each side, its pavements 3 m */
const road: LevelRoad = {
  pts: [
    [lat0, lon0 - 120 / kx],
    [lat0, lon0 + 120 / kx],
  ],
  r: 5,
  R: 8,
  cls: "secondary",
  urban: true,
};

/** a street's survey: a gentle slope east, noise of ±0.3 m, and the façades' feet — a metre's step from 7 m off the axis */
function survey(): Float32Array {
  const h = new Float32Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++)
    for (let i = 0; i < SIDE; i++) {
      const [e, nn] = place(i, j);
      const noise = 0.3 * Math.sin(e * 1.7) * Math.cos(nn * 2.3);
      h[j * SIDE + i] = 30 + 0.02 * e + noise + (Math.abs(nn) > 7 ? 1 : 0);
    }
  return h;
}

/** the steepest step between neighbouring pixels across the road (north–south) within its reach, at mid-length */
function steps(h: Float32Array) {
  let carriage = 0,
    pavement = 0;
  for (let j = 1; j < SIDE; j++)
    for (let i = 100; i < 156; i++) {
      const [, n0] = place(i, j - 1),
        [, n1] = place(i, j);
      const dh = Math.abs(h[j * SIDE + i]! - h[(j - 1) * SIDE + i]!);
      const a = Math.min(Math.abs(n0), Math.abs(n1)),
        b = Math.max(Math.abs(n0), Math.abs(n1));
      if (b <= 5) carriage = Math.max(carriage, dh);
      else if (a > 5.5 && b <= 8) pavement = Math.max(pavement, dh);
    }
  return { carriage, pavement };
}

test("a street laid on the survey: its carriageway smooth, its pavements a kerb over it, the step at the façades' feet gone", () => {
  const before = survey();
  const h = survey();
  const moved = levelTile(h, SIDE, Z, X, Y, [road]);
  expect(moved).toBeGreaterThan(1000);
  // (positive witness: the survey's metre at 7 m off the axis, inside the pavement, and its ±0.3 m across the carriageway)
  const s0 = steps(before),
    s1 = steps(h);
  expect(s0.pavement).toBeGreaterThan(0.9);
  expect(s1.pavement).toBeLessThan(0.1);
  expect(s1.carriage).toBeLessThan(0.05);
  // (the pavement a kerb over the carriageway's edge; the ground 2 m past the fade untouched)
  for (let j = 0; j < SIDE; j++) {
    const [, nn] = place(128, j);
    const k = j * SIDE + 128;
    if (Math.abs(nn) > 5.3 && Math.abs(nn) < 7.5) {
      const edge = place(128, j);
      void edge;
    }
    if (Math.abs(nn) > 8 + FADE_M + 0.5) expect(h[k]).toBe(before[k]!);
  }
  // (along the axis: the class's grade — a secondary road's 9 % — and the slope kept, its noise smoothed)
  let jc = 0;
  for (let j = 0; j < SIDE; j++) if (Math.abs(place(128, j)[1]) < Math.abs(place(128, jc)[1])) jc = j;
  const axis = Array.from({ length: SIDE }, (_, i) => h[jc * SIDE + i]!);
  for (let i = 1; i < SIDE; i++) {
    const de = place(i, jc)[0] - place(i - 1, jc)[0];
    expect(Math.abs(axis[i]! - axis[i - 1]!) / de).toBeLessThan(0.09 + 1e-3);
  }
  // (a pavement point a kerb over the carriageway's edge at the same abscissa)
  let jp = 0,
    je = 0;
  for (let j = 0; j < SIDE; j++) {
    const nn = place(128, j)[1];
    if (Math.abs(nn - 6.5) < Math.abs(place(128, jp)[1] - 6.5)) jp = j;
    if (Math.abs(nn - 4.5) < Math.abs(place(128, je)[1] - 4.5)) je = j;
  }
  expect(h[jp * SIDE + 128]! - h[je * SIDE + 128]!).toBeCloseTo(KERB_M, 1);
});

test("no road about, a hole in the survey: untouched", () => {
  const h = survey();
  const far: LevelRoad = { ...road, pts: road.pts.map(([la, lo]) => [la + 0.01, lo]) as [number, number][] };
  expect(levelTile(h, SIDE, Z, X, Y, [far])).toBe(0);
  h[128 * SIDE + 128] = Number.NaN;
  levelTile(h, SIDE, Z, X, Y, [road]);
  expect(Number.isNaN(h[128 * SIDE + 128]!)).toBe(true);
});

test("the leveller sits where the national relief's tiles come, before they are marked and kept — one ground for the raster and the contact", () => {
  const src = readFileSync(`${import.meta.dir}/../src/system/earth-tiles.ts`, "utf8");
  const fn = src.slice(src.indexOf("async function nationalHeights("), src.indexOf("/** The heights of a tile from its PNG"));
  const at = fn.indexOf("await streetLeveller(z, x, y, h.subarray(0, TILE * TILE));");
  expect(at).toBeGreaterThan(0);
  expect(at).toBeLessThan(fn.indexOf("markFine(h, true);"));
  const r = readFileSync(`${import.meta.dir}/../src/renderer.ts`, "utf8");
  expect(r).toContain("setStreetLeveller(async (z, x, y, h) => {");
});
