import { expect, test } from "bun:test";
import trace from "../src/shaders/trace.wgsl" with { type: "text" };
import type { Vec3 } from "../src/physics";
import { facadeReach, kerbedRoad, PAVEMENT_OPEN_SIDE_M, PAVEMENT_REACH_MAX_M, widenRecord } from "../src/system/pavement-reach";
import type { Primitive } from "../src/system/scenery-data";
import { polygonPrimitive, surfaceSegment } from "../src/system/scenery-geometry";

// (25 Nov 2026, PROBLEMES « Ponts et routes, campagne e2e 2 »: in Paris the relief's grass and photograph between a kerbed street's
// pavement — its class's 2–3 m — and the façades along it.) A kerbed town road's record widened to the footprints beside it.

const box = (x0: number, y0: number, x1: number, y1: number): Primitive =>
  polygonPrimitive(
    [
      [
        [x0, y0, 0],
        [x1, y0, 0],
        [x1, y1, 0],
        [x0, y1, 0],
        [x0, y0, 0],
      ] as Vec3[],
    ],
    0,
    1,
    1,
    [0, 0, 0],
  )!;
const lookup = (list: Primitive[]) => (x0: number, y0: number, x1: number, y1: number) =>
  list.filter((p) => p.max[0] >= x0 && p.min[0] <= x1 && p.max[1] >= y0 && p.min[1] <= y1);

/** a kerbed road along x from 0 to 40 m: its carriageway 4 m each side, its pavement 3 m (the record's R 7 m) */
function street(): Primitive {
  const p = surfaceSegment([0, 0, 0], [40, 0, 0], 14, 1, [0.3, 0.3, 0.3]);
  p.data[6] = 8 + 512 * 30;
  p.data[7] = -4;
  return p;
}

test("a street between two rows of façades: its pavements out to them", () => {
  // (the buildings' walls 11 m off the axis north, 10 m south — the ground between pavement (7 m) and wall: the defect)
  const rows = [box(-5, 11, 45, 30), box(-5, -30, 45, -10)];
  const p = street();
  expect(kerbedRoad(p)).toBe(true);
  const R = facadeReach([0, 0], [40, 0], 4, 7, lookup(rows));
  // (the nearer façade's: 10 m — the strip of ground left before, 3 m of it on the near side, 4 on the far)
  expect(R).toBeCloseTo(10, 6);
  widenRecord(p, R!);
  expect(p.data[4]).toBe(10);
  expect(p.min[1]).toBe(-10);
  expect(p.max[0]).toBe(50);
});

test("a square, a park, a far façade: the class's pavement kept; a façade nearer than it: kept; a building at its end: not counted", () => {
  const p = street();
  // (nothing about)
  expect(facadeReach([0, 0], [40, 0], 4, 7, lookup([]))).toBeNull();
  // (a façade past the reach — a forecourt, a square: 4 + 8 m)
  expect(facadeReach([0, 0], [40, 0], 4, 7, lookup([box(-5, 4 + PAVEMENT_REACH_MAX_M + 1, 45, 30)]))).toBeNull();
  // (a façade nearer than the pavement's edge: the record kept — never narrowed)
  expect(facadeReach([0, 0], [40, 0], 4, 7, lookup([box(-5, 6, 45, 30)]))).toBeNull();
  // (one building along a quarter of it: fewer than half its points meet a façade — kept)
  expect(facadeReach([0, 0], [40, 0], 4, 7, lookup([box(0, 9, 9, 30)]))).toBeNull();
  // (a corner building across its end — the cross street's —: none of its points meets it across)
  expect(facadeReach([0, 0], [40, 0], 4, 7, lookup([box(42, -20, 60, 20)]))).toBeNull();
  // (a park on one side, façades on the other: towards them by 2.5 m at most — the lawn across not paved over more)
  expect(facadeReach([0, 0], [40, 0], 4, 7, lookup([box(-5, -30, 45, -8.5)]))).toBeCloseTo(8.5, 6);
  expect(facadeReach([0, 0], [40, 0], 4, 7, lookup([box(-5, -30, 45, -11)]))).toBeCloseTo(7 + PAVEMENT_OPEN_SIDE_M, 6);
  // (a bridge's road, an unkerbed one: never)
  const bridge = street();
  bridge.data[6] = 8 + 32768;
  expect(kerbedRoad(bridge)).toBe(false);
  const open = street();
  open.data[6] = 1;
  expect(kerbedRoad(open)).toBe(false);
  expect(p.data[4]).toBe(7);
});

test("the shader: a carriageway outranks any pavement — a widened pavement never covers a crossing street's mouth", () => {
  const walk = trace.slice(trace.indexOf("fn scenerySurface("), trace.indexOf("fn sceneryMirror("));
  expect(walk).toContain("key=select(size.x-distance,64.0+crK-distance,distance<=crK);");
  // (the rule's model at a junction's mouth: a point 0.5 m inside street B's kerb — carriageway 4 m, record 7 m —, 1.5 m into street
  // A's widened pavement — carriageway 4 m, record 10 m —; the old key, size.x − distance, the positive witness: A's pavement won)
  const oldKey = (R: number, _cr: number, d: number) => R - d;
  const key = (R: number, cr: number, d: number) => (d <= cr ? 64 + cr - d : R - d);
  expect(oldKey(10, 4, 5.5)).toBeGreaterThan(oldKey(7, 4, 3.5));
  expect(key(7, 4, 3.5)).toBeGreaterThan(key(10, 4, 5.5));
  // (within carriageways the nearest axis still wins — ffbecf26's rule)
  expect(key(7, 4, 1)).toBeGreaterThan(key(7, 4, 2));
});
