import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FADE_M, type FootBox, KERB_M, type LevelRoad, levelTile, levelTileMarked } from "../src/system/street-level";

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

test("the leveller sits where the national relief's tiles come, before their water and before they are kept — one ground for the raster and the contact", () => {
  // (26 Nov 2026: in refine, after nationalHeights — the heights marked, the marks kept by the worker's levelling — and before the
  // inland water's flattening, the order streetCellsArrived repeats; the page hands the cells, the tiles level)
  const src = readFileSync(`${import.meta.dir}/../src/system/earth-tiles.ts`, "utf8");
  const fn = src.slice(src.indexOf("  private async refine("), src.indexOf("  private imageryLater("));
  const at = fn.indexOf("await this.streetBook.level(key, L.z,");
  expect(at).toBeGreaterThan(fn.indexOf("h = await nationalHeights("));
  expect(at).toBeLessThan(fn.indexOf("h = await flattenInland("));
  const again = src.slice(src.indexOf("  async streetCellsArrived("));
  expect(again.indexOf("this.streetBook.arrived(cells)")).toBeLessThan(again.indexOf("h = await flattenInland("));
  const r = readFileSync(`${import.meta.dir}/../src/renderer.ts`, "utf8");
  expect(r).toContain("this.earthTiles.setStreetCells((cx, cy) => this.streetCellRead(cx, cy));");
  expect(r).toContain("onStreetCell((c) => void this.earthTiles.streetCellsArrived([[c.x, c.y]]))");
});

test("the levelling keeps each pixel's survey mark (the decode worker's levelTileMarked)", () => {
  const h = survey();
  const u = new Uint32Array(h.buffer);
  for (let i = 0; i < u.length; i++) u[i] = i % 3 === 0 ? u[i]! | 1 : u[i]! & ~1;
  const before = u.map((v) => v & 1);
  expect(levelTileMarked(h, SIDE, Z, X, Y, [road])).toBeGreaterThan(1000);
  let lost = 0;
  for (let i = 0; i < u.length; i++) if ((u[i]! & 1) !== before[i]) lost++;
  expect(lost).toBe(0);
});

/** the survey with its step at `stepN` off the axis (the façades' feet beyond the class's pavement) */
function surveyStep(stepN: number, slopeN = 0): Float32Array {
  const h = new Float32Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++)
    for (let i = 0; i < SIDE; i++) {
      const [e, nn] = place(i, j);
      h[j * SIDE + i] = 30 + 0.02 * e + slopeN * nn + (Math.abs(nn) > stepN ? 1 : 0);
    }
  return h;
}
/** a row of buildings along the road, its wall `wall` m off the axis (north +, south −) */
const row = (wall: number): FootBox => {
  const hw = 5;
  const c = wall + Math.sign(wall) * hw;
  return { lat: lat0 + c / ky, lon: lon0, hl: 100, hw, heading: 0 };
};

test("(26 Nov) the pavements levelled out to the façades: the step between the class's pavement and the wall gone", () => {
  // (the class's pavement to 8 m, the walls at 11 m north and 9.5 m south, the survey's metre at 9 m off the axis)
  const boxes = [row(11), row(-9.5)];
  const bare = surveyStep(9);
  levelTile(bare, SIDE, Z, X, Y, [road]);
  const walls = surveyStep(9);
  levelTile(walls, SIDE, Z, X, Y, [road], boxes);
  const spread = (h: Float32Array, n0: number, n1: number) => {
    let lo = Infinity,
      hi = -Infinity;
    for (let j = 0; j < SIDE; j++) {
      const nn = place(128, j)[1];
      if (nn < n0 || nn > n1) continue;
      lo = Math.min(lo, h[j * SIDE + 128]!);
      hi = Math.max(hi, h[j * SIDE + 128]!);
    }
    return hi - lo;
  };
  // (positive witness: the class's pavement alone leaves the metre between 8 m and the north wall)
  expect(spread(bare, 5.5, 10.8)).toBeGreaterThan(0.5);
  // (the pavement one level to each wall)
  expect(spread(walls, 5.5, 10.8)).toBeLessThan(0.03);
  expect(spread(walls, -9.3, -5.5)).toBeLessThan(0.03);
  // (no wall: the class's reach — the road alone)
  const none = surveyStep(9);
  levelTile(none, SIDE, Z, X, Y, [road], []);
  expect(Buffer.from(none.buffer).equals(Buffer.from(bare.buffer))).toBe(true);
});

test("(26 Nov) a junction: the carriageways blended — no step where one road's level meets the other's", () => {
  // (the ground climbing north at 5 %: the west–east road level across it, the south–north one climbing — 0.22 m apart at 4.5 m)
  const ns: LevelRoad = {
    pts: [
      [lat0 - 120 / ky, lon0 + 40 / kx],
      [lat0 + 120 / ky, lon0 + 40 / kx],
    ],
    r: 4,
    R: 6,
    cls: "minor",
    urban: true,
  };
  const both = surveyStep(1e9, 0.05);
  levelTile(both, SIDE, Z, X, Y, [road, ns]);
  // (along the west–east carriageway's edge, 4.5 m north, from 25 to 55 m east: the steepest step between neighbouring pixels)
  let jr = 0;
  for (let j = 0; j < SIDE; j++) if (Math.abs(place(128, j)[1] - 4.5) < Math.abs(place(128, jr)[1] - 4.5)) jr = j;
  let worst = 0;
  for (let i = 1; i < SIDE; i++) {
    const e = place(i, jr)[0];
    if (e < 25 || e > 55) continue;
    worst = Math.max(worst, Math.abs(both[jr * SIDE + i]! - both[jr * SIDE + i - 1]!));
  }
  // (positive witness: each road's own level there — what the nearest road's alone would put side by side)
  const ew1 = surveyStep(1e9, 0.05),
    ns1 = surveyStep(1e9, 0.05);
  levelTile(ew1, SIDE, Z, X, Y, [road]);
  levelTile(ns1, SIDE, Z, X, Y, [ns]);
  let ic = 0;
  for (let i = 0; i < SIDE; i++) if (Math.abs(place(i, jr)[0] - 40) < Math.abs(place(ic, jr)[0] - 40)) ic = i;
  const gap = Math.abs(ns1[jr * SIDE + ic]! - ew1[jr * SIDE + ic]!);
  expect(gap).toBeGreaterThan(0.15);
  // (one surface warped between them over the crossing road's pavement — 0.07 m a 0.78 m pixel for a 0.3 m gap —, no step: the
  // carriageways alone blended, 26 Nov's first try, stepped 0.14 m at its edge)
  expect(worst).toBeLessThan(0.08);
  expect(worst).toBeLessThan(gap / 3);
});
