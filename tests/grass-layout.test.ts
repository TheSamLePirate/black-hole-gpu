import { expect, test } from "bun:test";
import { bladesInCell, grassDensity } from "../src/grass-layout";

const ring = (r0: number, r1: number) => {
  let sum = 0,
    area = 0;
  for (let r = r0; r < r1; r += 0.01) {
    sum += grassDensity(r + 0.005) * 2 * Math.PI * r * 0.01;
    area += 2 * Math.PI * r * 0.01;
  }
  return sum / area;
};

test("grass density has no ring: continuous and non-increasing, with the former bands' means", () => {
  expect(grassDensity(0)).toBeCloseTo(130, 9);
  expect(grassDensity(16)).toBeCloseTo(8, 9);
  expect(grassDensity(29)).toBeCloseTo(8, 9);
  let worstStep = 0;
  for (let d = 0; d < 29; d += 0.01) {
    worstStep = Math.max(worstStep, Math.abs(grassDensity(d + 0.01) - grassDensity(d)));
    expect(grassDensity(d + 0.01)).toBeLessThanOrEqual(grassDensity(d) + 1e-9);
  }
  // The steepest slope is about 13 blades/m² per metre: a 1 cm step is under a fifth of a blade. No edge anywhere.
  expect(worstStep).toBeLessThan(0.2);
  expect(Math.abs(ring(0, 6) - 120)).toBeLessThan(3);
  expect(Math.abs(ring(6, 16) - 40)).toBeLessThan(2);
  expect(Math.abs(ring(16, 29) - 8)).toBeLessThan(0.1);
});

test("whole blades per cell average to the expected count, deterministically", () => {
  let sum = 0;
  const cells = 200;
  for (let i = 0; i < cells; i++) sum += bladesInCell(12.4, i * 3 - 300, i * 7 + 5);
  expect(Math.abs(sum / cells - 12.4)).toBeLessThan(0.25);
  expect(bladesInCell(12.4, 4, -9)).toBe(bladesInCell(12.4, 4, -9));
  expect(bladesInCell(7, 1, 2)).toBe(7);
});

test("the whole field stays under the 65 536 roots budget at full density, as the former one", () => {
  let total = 0;
  for (let x = -32; x < 32; x++)
    for (let z = -32; z < 32; z++) {
      const d = Math.hypot(x, z);
      if (d > 29) continue;
      total += bladesInCell(grassDensity(d), x * 13 + 1, z * 17 + 2);
    }
  expect(total).toBeLessThan(65536);
  expect(total).toBeGreaterThan(50000);
});
