import { expect, test } from "bun:test";
import trace from "../src/shaders/trace.wgsl" with { type: "text" };
import type { Vec3 } from "../src/physics";
import { facadeSides, kerbedRoad, PAVEMENT_REACH_MAX_M, widenRecordSides } from "../src/system/pavement-reach";
import type { Primitive } from "../src/system/scenery-data";
import { polygonPrimitive, surfaceSegment } from "../src/system/scenery-geometry";

// (25 Nov 2026, PROBLEMES « Ponts et routes, campagne e2e 2 »: in Paris the relief's grass and photograph between a kerbed street's
// pavement — its class's 2–3 m — and the façades along it.) A kerbed town road's record widened to the footprints beside it, each side
// its own: a street wider on one side kept a strip of ground there while the record was symmetric (the nearer row's width both ways).

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

/** a kerbed road along x from 0 to 40 m: its carriageway 4 m each side, its pavement 3 m (the record's R 7 m, the word's 30 dm) */
function street(): Primitive {
  const p = surfaceSegment([0, 0, 0], [40, 0, 0], 14, 1, [0.3, 0.3, 0.3]);
  p.data[6] = 8 + 512 * 30;
  p.data[7] = -4;
  return p;
}

/** trace.wgsl scenerySurface's strip half-width for a kerbed road's record at a point (the right of a → b: the word's pavement) */
function half(p: Primitive, pt: [number, number]): number {
  const d = p.data;
  const lx = d[2]! - d[0]!,
    ly = d[3]! - d[1]!;
  const right = lx * (pt[1] - d[1]!) - ly * (pt[0] - d[0]!) < 0;
  return right ? Math.abs(d[7]!) + (Math.floor(d[6]! / 512) % 64) * 0.1 : d[4]!;
}

test("a street between two rows of façades, one nearer: each pavement out to its own row — no strip of ground left", () => {
  // (the buildings' walls 10 m off the axis north — left of a → b —, 8.5 m south — right)
  const rows = [box(-5, 10, 45, 30), box(-5, -30, 45, -8.5)];
  const p = street();
  expect(kerbedRoad(p)).toBe(true);
  // (the old record — symmetric, the class's: the strip of ground before each wall)
  expect(half(p, [20, 9])).toBe(7);
  expect(half(p, [20, -8])).toBe(7);
  const w = facadeSides([0, 0], [40, 0], 4, 7, lookup(rows));
  expect(w!.left).toBeCloseTo(10, 6);
  expect(w!.right).toBeCloseTo(8.5, 6);
  widenRecordSides(p, w!.left, w!.right);
  // (each side's strip as the shader reads it: to the north wall, to the south wall)
  expect(half(p, [20, 9])).toBeCloseTo(10, 6);
  expect(half(p, [20, -8])).toBeCloseTo(8.5, 6);
  // (positive witness: the symmetric rule — the nearer row's — left 1.5 m of ground before the north wall)
  expect(w!.left - Math.min(w!.left, w!.right)).toBeCloseTo(1.5, 6);
  // (and a wall past the reach — r + 6.3 m —: that side's the class's)
  expect(facadeSides([0, 0], [40, 0], 4, 7, lookup([box(-5, 11, 45, 30), box(-5, -30, 45, -8.5)]))!.left).toBe(7);
  // (the word kept but its pavement: kerb, the record's box the wider side's)
  expect(p.data[6]! % 512).toBe(8);
  expect(p.max[1]).toBeCloseTo(10, 6);
});

test("a square, a park, a far façade: the class's pavement kept that side; a façade nearer than it: kept; a building at its end: not counted", () => {
  // (nothing about)
  expect(facadeSides([0, 0], [40, 0], 4, 7, lookup([]))).toBeNull();
  // (a façade past the reach — a forecourt, a square)
  expect(facadeSides([0, 0], [40, 0], 4, 7, lookup([box(-5, 4 + PAVEMENT_REACH_MAX_M + 1, 45, 30)]))).toBeNull();
  // (a façade nearer than the pavement's edge: the record kept — never narrowed)
  expect(facadeSides([0, 0], [40, 0], 4, 7, lookup([box(-5, 6, 45, 30)]))).toBeNull();
  // (one building along a quarter of it: fewer than half its points meet a façade — kept)
  expect(facadeSides([0, 0], [40, 0], 4, 7, lookup([box(0, 9, 9, 30)]))).toBeNull();
  // (a corner building across its end — the cross street's —: none of its points meets it across)
  expect(facadeSides([0, 0], [40, 0], 4, 7, lookup([box(42, -20, 60, 20)]))).toBeNull();
  // (a park on one side — the south —, façades on the other: the façade side widened, the park's kept at the class's)
  const w = facadeSides([0, 0], [40, 0], 4, 7, lookup([box(-5, 9.5, 45, 30)]));
  expect(w!.left).toBeCloseTo(9.5, 6);
  expect(w!.right).toBe(7);
  // (a bridge's road, an unkerbed one: never)
  const bridge = street();
  bridge.data[6] = 8 + 32768;
  expect(kerbedRoad(bridge)).toBe(false);
  const open = street();
  open.data[6] = 1;
  expect(kerbedRoad(open)).toBe(false);
});

test("the shader: each side's strip; a carriageway outranks any pavement", () => {
  const walk = trace.slice(trace.indexOf("fn scenerySurface("), trace.indexOf("fn sceneryMirror("));
  expect(walk).toContain("half=abs(size.w)+f32((mkW>>9u)&63u)*.1;");
  expect(walk).toContain("let strip=sceneryStrip(point,p.xy,p.zw,half,aa,kind==5.0);");
  expect(walk).toContain("key=select(half-distance,64.0+crK-distance,distance<=crK);");
  // (a symmetric record — the class's pavement both ways, the cells' as packed — reads as before: its right side's the same)
  const p = street();
  expect(half(p, [20, -5])).toBe(half(p, [20, 5]));
  // (the rule's model at a junction's mouth: a carriageway's point before any pavement's)
  const key = (R: number, cr: number, d: number) => (d <= cr ? 64 + cr - d : R - d);
  expect(key(7, 4, 3.5)).toBeGreaterThan(key(10, 4, 5.5));
});
