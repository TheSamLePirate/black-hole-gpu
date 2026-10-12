import { expect, test } from "bun:test";
import { SceneryContact } from "../src/system/scenery-contact";
import { polygonPrimitive, surfaceSegment } from "../src/system/scenery-geometry";
import { packScenery, SCENERY_GRID, sceneryFrame } from "../src/system/scenery-data";
import { add, scale } from "../src/math/vec3";
import type { Vec3 } from "../src/physics";
const ring = (r: number): Vec3[] => [
  [-r, -r, 0],
  [r, -r, 0],
  [r, r, 0],
  [-r, r, 0],
  [-r, -r, 0],
];
const frame = sceneryFrame(0, 0),
  point = (x: number, y: number, z = 0) => add(add(add(frame.origin, frame.east, x), frame.north, y), frame.up, z);
const reply = { id: 1, lat: 0, lon: 0, bounds: [-0.01, -0.01, 0.01, 0.01] as [number, number, number, number] };
const pixels = new Uint32Array(SCENERY_GRID ** 2).fill(30 << 24);
test("OSM building courtyards and capsule radius match the rendered footprint", () => {
  const p = polygonPrimitive([ring(10), ring(4)], 0, 8, 1, [0.5, 0.5, 0.5])!;
  const c = new SceneryContact(reply, packScenery([p], pixels));
  expect(c.at(point(7, 0)).blocked).toBe(true);
  expect(c.at(point(0, 0)).blocked).toBe(false);
  expect(c.at(point(3.8, 0)).blocked).toBe(true);
  expect(c.at(point(12, 0)).blocked).toBe(false);
  expect(c.grass(point(7, 0))).toBe(false);
  expect(c.grass(point(0, 0))).toBe(true);
});
test("a bridge has a floor above and an open passage underneath", () => {
  const bridge = polygonPrimitive([ring(5)], 4, 4.5, 2, [0.1, 0.1, 0.1])!;
  const c = new SceneryContact(reply, packScenery([bridge], pixels));
  expect(c.at(point(0, 0, 0)).blocked).toBe(false);
  expect(c.at(point(0, 0, 3)).blocked).toBe(true);
  expect(c.at(point(0, 0, 4.5)).blocked).toBe(false);
  expect(c.at(point(0, 0, 4.52)).support).toBeCloseTo(-0.02, 3);
});
test("roads and water exclude grass even when WorldCover says grassland", () => {
  const road = surfaceSegment([-10, 0, 0], [10, 0, 0], 4, 1, [0.1, 0.1, 0.1]);
  const water = polygonPrimitive([ring(5)], 0, 0, 4, [0, 0, 1])!;
  const a = new SceneryContact(reply, packScenery([], pixels, [road]));
  expect(a.grass(point(0, 0))).toBe(false);
  expect(a.grass(point(0, 8))).toBe(true);
  const b = new SceneryContact(reply, packScenery([], pixels, [water]));
  expect(b.grass(point(0, 0))).toBe(false);
  expect(b.grass(point(0, 8))).toBe(true);
  const empty = new SceneryContact(reply, packScenery([], new Uint32Array(SCENERY_GRID ** 2)));
  expect(empty.grass(point(0, 0))).toBe(false);
  expect(a.cover(scale(point(0, 0), 1))).toBe(30);
});
test("what grows: the class and the satellite's colour, bare under roads, buildings and on built, snowy or water ground", () => {
  const road = surfaceSegment([-10, 0, 0], [10, 0, 0], 4, 1, [0.1, 0.1, 0.1]);
  const house = polygonPrimitive([ring(3)], 0, 6, 1, [0.5, 0.5, 0.5])!;
  const field = new Uint32Array(SCENERY_GRID ** 2).fill(((40 << 24) | 0x3080c0) >>> 0);
  const c = new SceneryContact({ ...reply, rgbPixels: 1 }, packScenery([house], field, [road]));
  const crop = c.vegetation(point(0, 12));
  expect(crop.cover).toBe(40);
  expect(crop.rgb).toBe(0x3080c0);
  expect(c.vegetation(point(0, 0)).cover).toBe(0);
  expect(c.vegetation(point(0, 0, 0)).cover).toBe(0);
  expect(c.excluded(point(0, 2.2))).toBe(true);
  expect(c.excluded(point(0, 12))).toBe(false);
  // (no satellite colour fetched: the class alone)
  expect(new SceneryContact(reply, packScenery([], field)).vegetation(point(0, 12)).rgb).toBe(0);
  for (const cls of [50, 70, 80]) {
    const ground = new Uint32Array(SCENERY_GRID ** 2).fill((cls << 24) >>> 0);
    expect(new SceneryContact(reply, packScenery([], ground)).vegetation(point(0, 12)).cover).toBe(0);
  }
});
