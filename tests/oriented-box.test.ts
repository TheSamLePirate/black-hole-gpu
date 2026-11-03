import { expect, test } from "bun:test";
import { orientedBox } from "../src/system/scenery-data";

// The buildings' oriented boxes (scenery-data.ts orientedBox): a footprint turned 30° — a Paris block along its avenue —
// gets its own box, not the frame's east–north one far wider than it.
const ring = (pts: [number, number][]) => pts.flatMap((p, i) => [p[0], p[1], pts[(i + 1) % pts.length]![0], pts[(i + 1) % pts.length]![1]]);
const corners = (b: [number, number, number, number]) => {
  const hu = Math.floor(b[3] / 4096) / 10,
    hv = (b[3] % 4096) / 10;
  const c = Math.cos(b[2]),
    s = Math.sin(b[2]);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, d]) => [b[0] + c * a! * hu - s * d! * hv, b[1] + s * a! * hu + c * d! * hv]);
};

test("a rectangle turned 30°: its box is itself, within a decimetre", () => {
  const a = Math.PI / 6,
    c = Math.cos(a),
    s = Math.sin(a);
  // (40 × 12 m, centred on (100, −50))
  const pts: [number, number][] = [
    [-20, -6],
    [20, -6],
    [20, 6],
    [-20, 6],
  ].map(([x, y]) => [100 + c * x! - s * y!, -50 + s * x! + c * y!]);
  const b = orientedBox(ring(pts));
  expect(b[3]).toBeGreaterThan(0);
  expect(b[0]).toBeCloseTo(100, 1);
  expect(b[1]).toBeCloseTo(-50, 1);
  const hu = Math.floor(b[3] / 4096) / 10,
    hv = (b[3] % 4096) / 10;
  // (the long side along the angle; the halves rounded up, at most 0.1 m over)
  expect(hu).toBeGreaterThanOrEqual(20);
  expect(hu).toBeLessThanOrEqual(20.1);
  expect(hv).toBeGreaterThanOrEqual(6);
  expect(hv).toBeLessThanOrEqual(6.1);
  // (every footprint corner inside its box's)
  const box = corners(b);
  for (const p of pts) expect(Math.min(...box.map((q) => Math.hypot(q[0]! - p[0], q[1]! - p[1])))).toBeLessThan(0.2);
});

test("an L-shaped footprint: every vertex inside the box; a side past 409.5 m: none (−1)", () => {
  const pts: [number, number][] = [
    [0, 0],
    [30, 0],
    [30, 10],
    [10, 10],
    [10, 25],
    [0, 25],
  ];
  const b = orientedBox(ring(pts));
  const hu = Math.floor(b[3] / 4096) / 10,
    hv = (b[3] % 4096) / 10;
  const c = Math.cos(b[2]),
    s = Math.sin(b[2]);
  for (const [x, y] of pts) {
    const u = (x - b[0]) * c + (y - b[1]) * s,
      v = -(x - b[0]) * s + (y - b[1]) * c;
    expect(Math.abs(u)).toBeLessThanOrEqual(hu + 1e-6);
    expect(Math.abs(v)).toBeLessThanOrEqual(hv + 1e-6);
  }
  expect(
    orientedBox(
      ring([
        [0, 0],
        [900, 0],
        [900, 10],
        [0, 10],
      ]),
    )[3],
  ).toBe(-1);
});
