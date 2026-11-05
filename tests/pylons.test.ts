import { expect, test } from "bun:test";
import { lineVolts, pylonHeight, pylonMesh } from "../src/system/pylons";

// Q8 D1 — the high-voltage pylons (src/system/pylons.ts): a line's voltage read from its tags, a tower's height by it, and its
// triangles — its top at its height, its arms across the line (along the frame's y for a line running east).
test("D1: a line's voltage and its pylons' height", () => {
  expect(lineVolts({ voltage: "225000" })).toBe(225000);
  expect(lineVolts({ voltage: "400000;225000" })).toBe(400000);
  expect(lineVolts({})).toBe(0);
  expect(pylonHeight(400000)).toBe(50);
  expect(pylonHeight(225000)).toBe(38);
  expect(pylonHeight(90000)).toBe(25);
});

test("D1: a pylon's triangles — its top at its height, its widest arm across the line", () => {
  const m = pylonMesh({ x: 0, y: 0, h: 38, along: 0 }, 100);
  expect(m.triangles.length % 3).toBe(0);
  let top = -Infinity,
    across = 0,
    along = 0;
  for (let i = 0; i < m.positions.length / 3; i++) {
    top = Math.max(top, m.positions[3 * i + 2]!);
    along = Math.max(along, Math.abs(m.positions[3 * i]!));
    across = Math.max(across, Math.abs(m.positions[3 * i + 1]!));
  }
  expect(top - 100).toBeCloseTo(38, 5);
  expect(across).toBeCloseTo(0.3 * 38, 5);
  expect(along).toBeLessThan(across);
});
