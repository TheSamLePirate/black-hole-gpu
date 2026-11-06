import { expect, test } from "bun:test";
import { MAGNETOSPHERES, type V3 } from "../src/system/magnetic-fields";
import { boundaries, fieldLines, SHELLS } from "../src/system/magneto-lines";

// The magnetospheres' diagram (src/system/magneto-lines.ts — PLAN-AURORES-MAGNETOSPHERES AM7): the shells' field lines and the
// boundaries' outlines.

const len = (p: V3) => Math.hypot(...p);

test("the Earth's shells: 8 lines each, from the figure to the figure, reaching about their L at the dipole's equator", () => {
  const lines = fieldLines("earth");
  expect(lines.length).toBe(8 * SHELLS.earth!.length);
  for (const l of lines) {
    expect(l.points.length).toBe(160);
    expect(l.logB.length).toBe(160);
    // (both ends on the ground — 1.0 to 1.03 radii: the figure, the trace's last step —, the farthest point near L)
    expect(len(l.points[0]!)).toBeLessThan(1.05);
    expect(len(l.points[l.points.length - 1]!)).toBeLessThan(1.05);
    const far = Math.max(...l.points.map(len));
    expect(far / l.L).toBeGreaterThan(0.85);
    expect(far / l.L).toBeLessThan(1.25);
  }
});

test("the boundaries' silhouettes: the magnetopause's nose at its standoff, the shock's ahead of it, towards the Sun", () => {
  const sun: V3 = [0, 1, 0];
  const B = boundaries("earth", sun, [1, 0, 0]);
  const M = MAGNETOSPHERES.earth;
  const nose = B.magnetopause[60]!,
    shock = B.shock[60]!;
  expect(nose[1]).toBeCloseTo(M.standoff, 6);
  expect(shock[1]).toBeCloseTo(M.shock, 6);
  // (the outline across the line of sight: no part along it)
  for (const p of B.magnetopause) expect(Math.abs(p[0])).toBeLessThan(1e-9);
});
