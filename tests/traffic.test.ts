import { expect, test } from "bun:test";
import { carsOn } from "../src/system/traffic";

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
