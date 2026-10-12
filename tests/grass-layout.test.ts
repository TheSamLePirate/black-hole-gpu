// The living ground's layout and the ground grid under it: the kinds of vegetation by WorldCover class, the
// table the shader reads, the thinning and widening with distance, the levels' budgets against their
// capacities, and the CPU grid (its frame, its recentring keeping the cells it knows, its atomic publication).
import { expect, test } from "bun:test";
import {
  GRASS_GRID,
  GRASS_GRID_SNAP,
  GRASS_LODS,
  GRASS_REACH_MAX,
  VEGETATION,
  VEGETATION_VEC4S,
  grassBudget,
  grassKeep,
  grassLod,
  grassRise,
  grassWiden,
  packVegetation,
  vegetationOf,
} from "../src/grass-layout";
import { GRASS_FRAME_REACH, GrassGround } from "../src/system/grass-ground";
import { runwayPaved, EARTH_RUNWAYS, RUNWAY_LENGTH } from "../src/game/sites";
import type { Vec3 } from "../src/physics";

test("each WorldCover class grows its kind; built ground, snow, water and the unknown grow nothing", () => {
  const names = (c: number) => VEGETATION[vegetationOf(c)]!.name;
  expect(names(30)).toBe("meadow");
  expect(names(40)).toBe("crop");
  expect(names(20)).toBe("scrub");
  expect(names(10)).toBe("forest floor");
  expect(names(95)).toBe("forest floor");
  expect(names(90)).toBe("reeds");
  expect(names(60)).toBe("sparse");
  expect(names(100)).toBe("moss");
  for (const c of [0, 50, 70, 80, 255]) expect(vegetationOf(c)).toBe(0);
  // (the shader decodes the kind on 4 bits)
  expect(VEGETATION.length).toBeLessThanOrEqual(16);
});

test("the kinds are plausible plants: heights, widths and bends ordered, colours dark at the root, a crop in rows", () => {
  for (const v of VEGETATION.slice(1)) {
    expect(v.density).toBeGreaterThan(0);
    expect(v.density).toBeLessThanOrEqual(1);
    expect(v.height[0]).toBeLessThan(v.height[1]);
    expect(v.width[0]).toBeLessThan(v.width[1]);
    expect(v.bend[0]).toBeLessThanOrEqual(v.bend[1]);
    expect(v.height[1]).toBeLessThan(2);
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(lum(v.base)).toBeLessThan(lum(v.tip));
    // (albedos of plants: never brighter than straw)
    expect(Math.max(...v.tip)).toBeLessThan(0.5);
  }
  const crop = VEGETATION[vegetationOf(40)]!;
  expect(crop.rows).toBeGreaterThan(0.1);
  expect(crop.head).toBe(1);
  expect(VEGETATION[vegetationOf(90)]!.height[1]).toBeGreaterThan(1);
  expect(VEGETATION[vegetationOf(100)]!.height[1]).toBeLessThan(0.1);
});

test("the table the shader reads: five vec4 a kind, each field in its place", () => {
  const t = packVegetation();
  expect(t.length).toBe(VEGETATION.length * VEGETATION_VEC4S * 4);
  VEGETATION.forEach((v, k) => {
    const o = k * VEGETATION_VEC4S * 4;
    expect(Array.from(t.slice(o, o + 4))).toEqual([v.density, v.height[0], v.height[1], v.flowers].map(Math.fround));
    expect(Array.from(t.slice(o + 4, o + 8))).toEqual([v.width[0], v.width[1], v.bend[0], v.bend[1]].map(Math.fround));
    expect(Array.from(t.slice(o + 8, o + 12))).toEqual([v.clump, v.rows, v.satellite, v.head].map(Math.fround));
    expect(Array.from(t.slice(o + 12, o + 15))).toEqual(v.base.map(Math.fround));
    expect(Array.from(t.slice(o + 16, o + 19))).toEqual(v.tip.map(Math.fround));
  });
});

test("thinning with distance: all near, fewer far, the cover kept by wider blades; the field sinks at its reach", () => {
  expect(grassKeep(0)).toBe(1);
  expect(grassKeep(5)).toBe(1);
  let last = 1;
  for (let d = 5; d <= GRASS_REACH_MAX; d += 0.25) {
    const k = grassKeep(d);
    expect(k).toBeLessThanOrEqual(last + 1e-12);
    last = k;
  }
  expect(grassKeep(GRASS_REACH_MAX)).toBeGreaterThanOrEqual(0.18);
  // (the widening holds the cover — keep × widen — within a factor of the near field's, never wider than 2.4)
  for (const d of [6, 10, 15, 22, 30]) {
    const k = grassKeep(d);
    expect(grassWiden(k)).toBeLessThanOrEqual(2.4);
    expect(k * grassWiden(k)).toBeGreaterThan(0.4);
  }
  expect(grassRise(10, 28)).toBe(1);
  expect(grassRise(28, 28)).toBe(0);
  expect(grassRise(26, 28)).toBeGreaterThan(0);
  expect(grassRise(26, 28)).toBeLessThan(1);
});

test("the levels' capacities hold the densest field seen whole (straight down, the farthest reach)", () => {
  const budget = grassBudget(GRASS_REACH_MAX, 1);
  budget.forEach((b, i) => expect(b).toBeLessThan(GRASS_LODS[i]!.capacity));
  // (and they are sized to it: not ten times too big)
  budget.forEach((b, i) => expect(GRASS_LODS[i]!.capacity / b).toBeLessThan(3));
  expect(grassLod(1)).toBe(0);
  expect(grassLod(GRASS_LODS[0].until + 0.01)).toBe(1);
  expect(grassLod(GRASS_LODS[1].until + 0.01)).toBe(2);
  expect(GRASS_LODS[0].segments).toBeGreaterThan(GRASS_LODS[2].segments);
});

/** A test ground: a plane at z = R tilted 2 % along x, its own kinds by place (a road at |x| < 1.5 — nothing). */
function world(R = 6371000) {
  let calls = 0;
  const raw = (p: Vec3) => {
    calls++;
    return p[2] - (R + 0.02 * p[0]);
  };
  const vegetation = (q: Vec3) => {
    calls++;
    return Math.abs(q[0]) < 1.5 ? { cover: 0, rgb: 0 } : { cover: q[1] > 10 ? 40 : 30, rgb: 0x204060 };
  };
  return { raw, vegetation, count: () => calls, R };
}
const build = (g: GrassGround, q: Vec3, w: ReturnType<typeof world>, revision = 1) => {
  let n = 0;
  do g.build(q, [0, 0, 1], w.raw, w.vegetation, revision, 1000);
  while (g.remaining > 0 && ++n < 50);
};

test("the ground grid: published whole, its heights on the ground, its cells the kind and colour, a road bare", () => {
  const w = world();
  const g = new GrassGround();
  const q: Vec3 = [0, 0, w.R];
  // (a millisecond's slice: not done in one call, nothing published meanwhile)
  g.build(q, [0, 0, 1], w.raw, w.vegetation, 1, 0);
  expect(g.ready).toBe(false);
  build(g, q, w);
  expect(g.ready).toBe(true);
  expect(g.heights.length).toBe(GRASS_GRID * GRASS_GRID);
  const half = (GRASS_GRID - 1) / 2;
  // (a cell's height: the ground's along the frame's up at its place)
  for (const [i, j] of [
    [0, 0],
    [half, half],
    [GRASS_GRID - 1, 10],
  ] as const) {
    const x = g.centre[0] + i - half,
      z = g.centre[1] + j - half;
    const p = g.point(x, z);
    expect(g.heights[j * GRASS_GRID + i]!).toBeCloseTo(-w.raw(p), 6);
    const cell = g.cells[j * GRASS_GRID + i]!;
    const ground = [p[0], p[1], p[2] + g.heights[j * GRASS_GRID + i]!] as Vec3;
    if (Math.abs(ground[0]) < 1.5) expect(cell).toBe(0);
    else {
      expect(cell >>> 24).toBe(vegetationOf(ground[1] > 10 ? 40 : 30));
      expect(cell & 0xffffff).toBe(0x204060);
    }
  }
  expect(g.vegetated).toBeGreaterThan(GRASS_GRID * GRASS_GRID * 0.9);
  expect(g.vegetated).toBeLessThan(GRASS_GRID * GRASS_GRID);
});

test("the ground grid recentres by whole steps and keeps the cells it knows; new data rebuild it; far away, a new frame", () => {
  const w = world();
  const g = new GrassGround();
  build(g, [0, 0, w.R], w);
  const stamp = g.stamp,
    frame = g.frameStamp,
    before = w.count();
  // (within half a step: nothing to do)
  build(g, [3, 2, w.R], w);
  expect(g.stamp).toBe(stamp);
  // (a step on: recentred, only the new strip computed — the rest copied)
  const l = g.local([0, GRASS_GRID_SNAP, w.R]);
  build(g, [0, GRASS_GRID_SNAP, w.R], w);
  expect(g.stamp).toBe(stamp + 1);
  expect(
    Math.abs(g.centre[0] - Math.round(l[0] / GRASS_GRID_SNAP) * GRASS_GRID_SNAP) +
      Math.abs(g.centre[1] - Math.round(l[2] / GRASS_GRID_SNAP) * GRASS_GRID_SNAP),
  ).toBe(0);
  const strip = (w.count() - before) / 2;
  expect(strip).toBe(GRASS_GRID * GRASS_GRID_SNAP);
  // (the copied cells are the same as computed afresh)
  const fresh = new GrassGround();
  fresh.frame = g.frame;
  build(fresh, [0, GRASS_GRID_SNAP, w.R], w);
  expect(Array.from(fresh.heights)).toEqual(Array.from(g.heights));
  expect(Array.from(fresh.cells)).toEqual(Array.from(g.cells));
  // (new ground data: rebuilt whole)
  const b2 = w.count();
  build(g, [0, GRASS_GRID_SNAP, w.R], w, 2);
  expect((w.count() - b2) / 2).toBe(GRASS_GRID * GRASS_GRID);
  // (beyond the frame's reach: a new frame)
  build(g, [GRASS_FRAME_REACH + 10, 0, w.R], w, 2);
  expect(g.frameStamp).toBe(frame + 1);
  expect(g.ready).toBe(true);
  g.clear();
  expect(g.ready).toBe(false);
  expect(g.frame).toBeNull();
});

test("new ground data arriving while a grid is made never starve it: that one is finished, then made again", () => {
  const w = world();
  const g = new GrassGround();
  let revision = 1;
  for (let i = 0; i < 400 && !g.ready; i++) g.build([0, 0, w.R], [0, 0, 1], w.raw, w.vegetation, revision++, 0.05);
  expect(g.ready).toBe(true);
});

test("a runway's pavement and shoulders grow nothing; the airfield's grass beside it does", () => {
  const r = EARTH_RUNWAYS[0]!;
  const at = (along: number, across: number): Vec3 =>
    [0, 1, 2].map((i) => r.origin[i]! + r.along[i]! * along + r.across[i]! * across) as Vec3;
  expect(runwayPaved(at(100, 0))).toBe(true);
  expect(runwayPaved(at(RUNWAY_LENGTH - 10, 40))).toBe(true);
  expect(runwayPaved(at(1000, 80))).toBe(false);
  expect(runwayPaved(at(-500, 0))).toBe(false);
});
