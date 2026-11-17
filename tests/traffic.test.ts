import { expect, test } from "bun:test";
import { CHORD_M, carsAlong, carsOn, PIECE_M } from "../src/system/traffic";

// Q8 D1 — the road traffic (src/system/traffic.ts): the cars on a piece of road by its class.
// (a car's mesh: tests/car-shapes.test.ts — PLAN-J8 VB3)
test("D1: the cars on a piece of road — by its class's spacing, none on an unknown class", () => {
  const a: [number, number, number] = [0, 0, 0],
    b: [number, number, number] = [250, 0, 0];
  expect(carsOn(a, b, "motorway", 1).length).toBe(3);
  expect(carsOn(a, b, "primary", 1).length).toBe(1);
  expect(carsOn(a, b, "track", 1).length).toBe(0);
  for (const c of carsOn(a, b, "motorway", 2)) {
    expect(c.phase).toBeGreaterThanOrEqual(0);
    expect(c.phase).toBeLessThan(1);
    expect(c.speed).toBeGreaterThan(30);
  }
});

test("VB6: a road's cars as one stream — one speed, evenly spaced across its pieces at every moment", () => {
  // (a straight motorway of 1 km: four pieces of 250 m, the cars every 62.5 m — round(250 / 70) a piece —, one speed)
  const line: [number, number, number][] = [
    [0, 0, 0],
    [1000, 0, 0],
  ];
  const pieces = carsAlong(line, "motorway", 7);
  expect(pieces.length).toBe(1000 / PIECE_M);
  const cars = pieces.flatMap((p) => p.cars);
  expect(new Set(cars.map((c) => c.speed)).size).toBe(1);
  const v = cars[0]!.speed;
  // (the cars' places along the road at a few moments: each gap the same — no car leaves a piece without one entering the next)
  for (const t of [0, 1.3, 4.7, 11]) {
    const at = pieces
      .flatMap((p) => p.cars.map((c) => p.a[0] + ((((c.phase + (v * t) / PIECE_M) % 1) + 1) % 1) * PIECE_M))
      .sort((a, b) => a - b);
    const gaps = at.slice(1).map((x, i) => x - at[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(62.5, 6);
  }
});

test("VB6: a curve's short segments become a few chords; a secondary road sparser; the minor streets and an unknown class none", () => {
  // (a quarter circle of 200 m radius in 100 segments: chords within CHORD_M — a handful of pieces)
  const arc: [number, number, number][] = Array.from({ length: 101 }, (_, i) => {
    const a = (i / 100) * (Math.PI / 2);
    return [200 * Math.cos(a), 200 * Math.sin(a), 0];
  });
  const pieces = carsAlong(arc, "primary", 3);
  expect(pieces.length).toBeLessThan(10);
  // (every chord within CHORD_M of the arc it replaces: its middle no farther in than the sagitta)
  const mid = pieces.map((p) => Math.hypot((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2));
  for (const r of mid) expect(200 - r).toBeLessThanOrEqual(CHORD_M + 1e-6);
  // (a secondary road sparser than a primary one; the town's minor streets none — VB4's parked cars hold them)
  const km: [number, number, number][] = [
    [0, 0, 0],
    [20_000, 0, 0],
  ];
  const n = (cls: string) => carsAlong(km, cls, 1).flatMap((p) => p.cars).length;
  // (20 km: a car every ~320 m on the secondary road by its pieces' seeds, every 250 m on the primary — one a piece)
  expect(Math.abs(n("secondary") - 20_000 / 320) / (20_000 / 320)).toBeLessThan(0.3);
  expect(n("secondary")).toBeGreaterThan(0);
  expect(n("secondary")).toBeLessThan(n("primary"));
  expect(carsAlong(km, "minor", 1)).toEqual([]);
  expect(carsAlong(km, "path", 1)).toEqual([]);
});
