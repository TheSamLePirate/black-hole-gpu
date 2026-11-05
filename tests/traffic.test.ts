import { expect, test } from "bun:test";
import { carMesh, carsOn, LANE_M } from "../src/system/traffic";

// Q8 D1 — the road traffic (src/system/traffic.ts): the car's mesh (its body and four lamps' quads, each from a vertex ≡ 0 mod 4,
// in its lane to the right), and the cars on a piece of road by its class.
test("D1: a car's mesh — 8 body vertices and four lamp quads, 20 triangles, in its lane", () => {
  const m = carMesh();
  expect(m.positions.length / 3).toBe(24);
  expect(m.triangles.length / 3).toBe(20);
  // (each lamp's quad: four vertices at one place, from an index ≡ 0 mod 4)
  for (let q = 8; q < 24; q += 4) {
    expect(q % 4).toBe(0);
    for (let k = 1; k < 4; k++) expect(m.positions.slice(3 * (q + k), 3 * (q + k) + 3)).toEqual(m.positions.slice(3 * q, 3 * q + 3));
  }
  // (the lane: the body's middle LANE_M to the right — y negative, the car's frame's y its left)
  const ys = Array.from({ length: 8 }, (_, i) => m.positions[3 * i + 1]!);
  expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(-LANE_M, 6);
});

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
