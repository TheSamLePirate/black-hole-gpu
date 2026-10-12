import { expect, test } from "bun:test";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import {
  FOREST_BLOCK,
  FOREST_CELL,
  FOREST_KINDS,
  FOREST_SINK,
  ForestKind,
  forestBlockBounds,
  forestBlocks,
  forestCellOf,
  forestColumn,
  forestColumns,
  forestDensity,
  forestFrame,
  forestHash,
  forestHeight,
  forestJitter,
  forestKind,
  forestPlaceOf,
  forestTree,
  forestTreesNear,
  growForest,
  treeline,
  KIND_SHAPES,
  packCell,
  readForest,
  unpackCell,
} from "../src/system/forest";
import { localPoint, packScenery, SCENERY_GRID, sceneryFrame } from "../src/system/scenery-data";
import type { Vec3 } from "../src/physics";

const D = Math.PI / 180;

test("the hash: fixed values (forest.wgsl computes the same bits), spread evenly", () => {
  // (a change here moves every tree in the world: the GPU twin must change with it)
  expect([forestHash(0, 0, 0), forestHash(1, 0, 0), forestHash(0, 1, 0), forestHash(123456, -7, 3)]).toMatchSnapshot();
  expect(forestHash(-1, 5, 2)).toBe(forestHash(0xffffffff, 5, 2));
  let mean = 0;
  for (let i = 0; i < 4000; i++) mean += forestHash(i, i * 7, 1) / 4294967296 / 4000;
  expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
});

test("a cell's word: its ground to the centimetre, its kind, its height to half a metre; 0 is no tree", () => {
  for (const [z, kind, h] of [
    [1234.567, ForestKind.conifer, 27.3],
    [-412.3, ForestKind.palm, 9],
    [8000.01, ForestKind.shrub, 2],
  ] as const) {
    const c = unpackCell(packCell(z, kind, h));
    expect(Math.abs(c.z - z)).toBeLessThan(0.006);
    expect(c.kind).toBe(kind);
    expect(Math.abs(c.height - h)).toBeLessThanOrEqual(0.25);
  }
  expect(packCell(100, ForestKind.none, 10)).toBe(0);
  expect(unpackCell(packCell(0, ForestKind.broadleaf, 99)).height).toBe(33.5);
});

test("the grid closes round the world; Mercator cells are FOREST_CELL metres in their band", () => {
  for (const lat of [0, 30, 47, 63, 80]) {
    const n = forestColumns(lat);
    expect(Number.isInteger(n)).toBe(true);
    // (the cell on the ground at the band's middle)
    const band = (Math.floor(lat / 4) + 0.5) * 4;
    expect(Math.abs((2 * Math.PI * 6378137 * Math.cos(band * D)) / n - FOREST_CELL)).toBeLessThan(0.01);
    const [x, y] = forestCellOf(lat + 0.3, 12.5, n);
    const [la, lo] = forestPlaceOf(x, y, n);
    expect(la).toBeCloseTo(lat + 0.3, 9);
    expect(lo).toBeCloseTo(12.5, 9);
  }
  // (across the antimeridian, unwrapped about the area's longitude: continuous)
  const n = forestColumns(10);
  const a = forestCellOf(10, 179.999, n, 179.99),
    b = forestCellOf(10, -179.999, n, 179.99);
  expect(b[0] - a[0]).toBeCloseTo((0.002 * D * 6378137) / ((2 * Math.PI * 6378137) / n), 6);
});

/** a frame point's place on the Earth's axes [m] */
function world(lat0: number, lon0: number, p: Vec3): Vec3 {
  const f = sceneryFrame(lat0, lon0);
  return [0, 1, 2].map((k) => f.origin[k]! + f.east[k]! * p[0] + f.north[k]! * p[1] + f.up[k]! * p[2]) as Vec3;
}

test("world-fixed: the same tree from two sceneries 550 m apart stands within centimetres of itself", () => {
  for (const [lat, lon] of [
    [44.233, 4.143],
    [61.5, 7.2],
    [-3.1, -60.0],
  ] as const) {
    const A = [lat, lon] as const,
      B = [lat + 0.005, lon + 0.005 / Math.cos(lat * D)] as const;
    const fa = forestFrame(A[0], A[1], 3000, (la, lo) => localPoint(sceneryFrame(A[0], A[1]), la, lo, 0));
    const fb = forestFrame(B[0], B[1], 3000, (la, lo) => localPoint(sceneryFrame(B[0], B[1]), la, lo, 0));
    expect(fa.columns).toBe(fb.columns);
    // (affine maps' round trip)
    const u = fa.a[0] + fa.a[1] * 123 + fa.a[2] * -456,
      v = fa.b[0] + fa.b[1] * 123 + fa.b[2] * -456;
    expect(fa.c[0] + fa.c[1] * u + fa.c[2] * v).toBeCloseTo(123, 6);
    expect(fa.d[0] + fa.d[1] * u + fa.d[2] * v).toBeCloseTo(-456, 6);
    // a tree half-way between the two origins, and one 1.2 km out
    for (const off of [0.0025, 0.011]) {
      const [gx, gy] = forestCellOf(lat + off, lon + off / 2, fa.columns, lon);
      const gi = Math.floor(gx),
        gj = Math.floor(gy);
      const word = packCell(0, ForestKind.broadleaf, 20);
      const ta = forestTree(fa, word, gi - fa.i0, gj - fa.j0)!,
        tb = forestTree(fb, word, gi - fb.i0, gj - fb.j0)!;
      const pa = world(A[0], A[1], [ta.x, ta.y, 0]),
        pb = world(B[0], B[1], [tb.x, tb.y, 0]);
      // (horizontal: the frames' ups differ by the arc between them)
      const gap = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      expect(gap).toBeLessThan(off < 0.005 ? 0.08 : 0.25);
      expect(ta.radius).toBeCloseTo(tb.radius, 2);
      expect(ta.seed).toBe(tb.seed);
    }
  }
});

test("the tracer's invariant: every crown stays within half a cell of its own and under the tree's height", () => {
  const ff = forestFrame(47, 8, 1000, (la, lo) => localPoint(sceneryFrame(47, 8), la, lo, 0));
  expect(Math.abs(ff.cell - FOREST_CELL)).toBeLessThan(0.05 * FOREST_CELL);
  expect(KIND_SHAPES.length).toBe(FOREST_KINDS);
  for (let k = 1; k < FOREST_KINDS; k++) {
    const s = KIND_SHAPES[k]!;
    expect(s.width).toBeLessThanOrEqual(1);
    expect(s.cone ? 1 : s.crown + s.depth).toBeLessThanOrEqual(1.0001);
    // (the lowest leaf above the block's floor — the foot less the sinking — at the kind's tallest)
    const tallest = forestHeight(k as ForestKind, 0, 0, 1);
    expect((s.cone ? s.crown : s.crown - s.depth) * tallest).toBeGreaterThan(-FOREST_SINK);
    expect(s.tint).toBeGreaterThanOrEqual(0);
    expect(s.tint).toBeLessThanOrEqual(1);
  }
  for (let i = 0; i < 2000; i++) {
    const [jx, jy, size] = forestJitter(i * 31, -i * 17);
    expect(jx).toBeGreaterThanOrEqual(0.12);
    expect(jx).toBeLessThanOrEqual(0.88);
    expect(jy).toBeGreaterThanOrEqual(0.12);
    expect(jy).toBeLessThanOrEqual(0.88);
    // (the crown's radius over the cell's smaller side: ≤ ½ with the jitter's margin)
    expect(0.3 + 0.17 * size).toBeLessThan(0.5);
  }
});

test("what grows where: density by land cover, the climate's kinds, the tree line", () => {
  const share = (cls: number, lat: number, alt: number, kind?: ForestKind) => {
    let n = 0;
    for (let i = 0; i < 4000; i++) {
      const k = forestKind(cls, lat, alt, (i % 100) / 100 + 0.005, Math.floor(i / 100) / 40 + 0.0125);
      if (kind === undefined ? k !== ForestKind.none : k === kind) n++;
    }
    return n / 4000;
  };
  expect(share(10, 47, 400)).toBeCloseTo(forestDensity(10), 1);
  expect(share(30, 47, 400)).toBeLessThan(0.05);
  expect(share(40, 47, 400)).toBe(0);
  expect(share(50, 47, 400)).toBe(0);
  expect(share(95, 5, 0, ForestKind.shrub)).toBeCloseTo(forestDensity(95), 1);
  // the Amazon: broadleaf, palms by the coast; the taiga: conifers; the Alps above 1 600 m: conifers; above 2 400 m: none
  expect(share(10, -3, 50, ForestKind.palm)).toBeGreaterThan(0.08);
  expect(share(10, -3, 50, ForestKind.broadleaf)).toBeGreaterThan(0.6);
  expect(share(10, 62, 200, ForestKind.conifer)).toBeGreaterThan(0.6);
  expect(share(10, 46, 1700, ForestKind.conifer)).toBeGreaterThan(0.8);
  expect(share(10, 46, 2600)).toBe(0);
  expect(share(10, 43.5, 200, ForestKind.pine)).toBeGreaterThan(0.2);
  expect(treeline(0)).toBe(4000);
  expect(treeline(46)).toBe(2100);
  expect(treeline(61)).toBeCloseTo(840, 0);
  expect(treeline(80)).toBe(0);
  // heights: by kind, lower near the tree line
  expect(forestHeight(ForestKind.conifer, 46, 500, 1)).toBeGreaterThan(forestHeight(ForestKind.conifer, 46, 2100, 1));
  expect(forestHeight(ForestKind.shrub, 46, 500, 1)).toBeLessThanOrEqual(6);
  expect(forestHeight(ForestKind.broadleaf, 0, 100, 1)).toBeGreaterThan(30);
});

test("the blocks hold every tree a dual cell may meet: dilated by one cell, the ground less the sinking", () => {
  const ff = forestFrame(45, 5, 400, (la, lo) => localPoint(sceneryFrame(45, 5), la, lo, 0));
  const cells = new Uint32Array(ff.w * ff.h);
  // a tree on a block's last column: its dual cells reach into the next block
  const i = FOREST_BLOCK - 1,
    j = 3;
  cells[j * ff.w + i] = packCell(250, ForestKind.pine, 18);
  const b = forestBlockBounds(ff, cells);
  const [bw] = forestBlocks(ff);
  for (const bi of [0, 1]) {
    expect(b[bi * 2]).toBeCloseTo(250 - FOREST_SINK, 2);
    expect(b[bi * 2 + 1]).toBeCloseTo(268, 2);
  }
  expect(b[2 * 2 + 0]).toBe(Infinity);
  expect(b[bw * 2 + 1]).toBe(-Infinity);
});

test("the packed section reads back whole: the frame, the cells, the trees near a point", () => {
  const frame = sceneryFrame(46, 7);
  const ff = forestFrame(46, 7, 300, (la, lo) => localPoint(frame, la, lo, 0));
  const cells = new Uint32Array(ff.w * ff.h);
  let n = 0;
  for (let k = 0; k < cells.length; k += 7) {
    cells[k] = packCell(500 + (k % 13), ForestKind.conifer, 20);
    n++;
  }
  const buffer = packScenery([], new Uint32Array(SCENERY_GRID ** 2), [], { frame: ff, cells, trees: n });
  const back = readForest(new Float32Array(buffer), new Uint32Array(buffer))!;
  expect(back.frame.w).toBe(ff.w);
  expect(back.frame.i0).toBe(ff.i0);
  expect(back.frame.j0).toBe(ff.j0);
  expect(back.frame.columns).toBe(ff.columns);
  expect(back.frame.c[1]).toBeCloseTo(ff.c[1], 5);
  expect(Array.from(back.cells)).toEqual(Array.from(cells));
  const near = forestTreesNear(back.frame, back.cells, 0, 0, 20);
  expect(near.length).toBeGreaterThan(0);
  for (let k = 1; k < near.length; k++)
    expect(Math.hypot(near[k]!.x, near[k]!.y)).toBeGreaterThanOrEqual(Math.hypot(near[k - 1]!.x, near[k - 1]!.y));
  expect(
    readForest(new Float32Array(packScenery([], new Uint32Array(16))), new Uint32Array(packScenery([], new Uint32Array(16)))),
  ).toBeNull();
  // (a whole high-mode grid within its share of the 16 MiB budget)
  const big = forestFrame(46, 7, 3250, (la, lo) => localPoint(frame, la, lo, 0));
  expect(big.w * big.h * 4).toBeLessThan(4 * 1024 * 1024);
  expect(geodeticToCart(WGS84_A, WGS84_F, 46 * D, 7 * D, 0)[0]).toBeGreaterThan(0);
});

test("growing a forest: where the cover says, not on the road, its feet on the ground; a failed tile leaves its trees out", async () => {
  const frame = sceneryFrame(48.05, 7);
  const ff = forestFrame(48.05, 7, 1200, (la, lo) => localPoint(frame, la, lo, 0));
  const ground = (lat: number) => 400 + (lat - 48) * 1000;
  const road = (lat: number) => Math.abs(lat - 48.053) < 0.00006;
  const io = {
    cover: (lat: number) => (lat > 48.05 ? 10 : 40),
    excluded: (lat: number) => road(lat),
    ground: async (lat: number) => ground(lat),
    local: (lat: number, lon: number, h: number) => localPoint(frame, lat, lon, h),
  };
  const t0 = performance.now();
  const { cells, trees } = await growForest(ff, io);
  const ms = performance.now() - t0;
  let north = 0,
    planted = 0,
    inner = 0,
    conifers = 0;
  for (let j = 0; j < ff.h; j++)
    for (let i = 0; i < ff.w; i++) {
      const t = forestTree(ff, cells[j * ff.w + i]!, i, j);
      if (t) planted++;
      const at = forestTree(ff, packCell(0, ForestKind.broadleaf, 10), i, j)!;
      if (Math.hypot(at.x, at.y) > 1200 - 10) continue;
      const lat = 48.05 + at.y / 111200;
      const counted = lat > 48.0505 && Math.abs(lat - 48.053) > 0.0001;
      if (counted) north++;
      if (!t) continue;
      if (counted) inner++;
      if (t.kind === ForestKind.conifer) conifers++;
      // (north of the line only, never on the road)
      expect(lat).toBeGreaterThan(48.0498);
      expect(Math.abs(lat - 48.053)).toBeGreaterThan(0.00004);
    }
  expect(planted).toBe(trees);
  // (the share of the forest's cells holding a tree: its density, less the road)
  expect(inner / north).toBeGreaterThan(0.8);
  expect(inner / north).toBeLessThan(0.92);
  expect(conifers / trees).toBeGreaterThan(0.2);
  // a tree's foot: the ground at its place, sunk FOREST_SINK, in the frame (to the word's centimetre)
  const k = cells.findIndex((w) => w !== 0);
  const tree = forestTree(ff, cells[k]!, k % ff.w, Math.floor(k / ff.w))!;
  const [jx, jy] = forestJitter(forestColumn(ff, k % ff.w), ff.j0 + Math.floor(k / ff.w));
  const lat = forestPlaceOf(ff.i0 + (k % ff.w) + jx, ff.j0 + Math.floor(k / ff.w) + jy, ff.columns)[0];
  expect(Math.abs(tree.z - (ground(lat) - FOREST_SINK))).toBeLessThan(1.2);
  // the same grid again: the same trees (a pure function of the place)
  expect(Array.from((await growForest(ff, io)).cells)).toEqual(Array.from(cells));
  // a ground that fails for half the places: their trees left out, none at sea level
  const failing = await growForest(ff, {
    ...io,
    ground: async (lat: number, lon: number) => {
      if (Math.floor(lon * 2000) % 2) throw new Error("tile");
      return ground(lat);
    },
  });
  expect(failing.trees).toBeGreaterThan(0);
  expect(failing.trees).toBeLessThan(trees);
  for (const w of failing.cells) if (w) expect(unpackCell(w).z).toBeGreaterThan(300);
  // (the worker's whole high-mode grid: this one is 1.2 km; the 3.25 km grid is ~7× — a few seconds here)
  expect(ms).toBeLessThan(5000);
});
