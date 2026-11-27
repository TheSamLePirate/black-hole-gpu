import { expect, test } from "bun:test";
import { crabStep } from "../src/traffic/attitude";

test("ADS-B heading jumps turn progressively, stay bounded and converge", () => {
  let a = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 1800; i++) {
    const next = crabStep(a, 40, 100, false, dt);
    expect(Math.abs(next - a)).toBeLessThanOrEqual(((2 * Math.PI) / 180) * dt + 1e-12);
    a = next;
  }
  expect((a * 180) / Math.PI).toBeCloseTo(20, 2);
  expect(crabStep(a, -20, 100, false, 0)).toBe(a);
  expect(Math.abs(crabStep(a, -20, 100, false, 30) - a)).toBeLessThanOrEqual(Math.PI / 360 + 1e-12);
});

test("decrab starts before touchdown and settles without a snap at ground contact", () => {
  let a = (10 * Math.PI) / 180;
  for (let i = 0; i < 1200; i++) a = crabStep(a, 10, 1, false, 1 / 60, 1);
  expect(a).toBeLessThan(0.001);
  const landed = crabStep(0.1, 10, 0, true, 1 / 60);
  expect(landed).toBeGreaterThan(0.098);
  expect(landed).toBeLessThan(0.1);
});
