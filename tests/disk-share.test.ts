import { test, expect } from "bun:test";
import { diskShare } from "../src/system/solar";

test("totality leaves exactly zero light, including at internal contact", () => {
  // This angular radius left 2.22e-16 when the covered area was divided back out.
  const rs = 0.0047,
    rm = rs * 1.1;
  for (const d of [0, (rm - rs) / 2, rm - rs]) expect(diskShare(rs, rm, d)).toBe(0);
  expect(diskShare(rs, rs, 0)).toBe(0);
  expect(diskShare(rs, rm, rm - rs + 0.00001)).toBeGreaterThan(0);
});

test("annular, partial and disjoint disks keep their uncovered areas", () => {
  expect(diskShare(1, 0.5, 0)).toBe(0.75);
  expect(diskShare(1, 0.5, 0.5)).toBe(0.75);
  expect(diskShare(1, 1, 1)).toBeCloseTo(1 / 3 + Math.sqrt(3) / (2 * Math.PI), 14);
  expect(diskShare(1, 1, 2)).toBe(1);
  expect(diskShare(1, 1, 3)).toBe(1);
});
