// Review A9 (24 Nov 2026): a bridge's parts wound counter-clockwise seen from outside, its piers along its axis (their collision strip's
// box), its slices mitred at a bend (no crack between them).
import { describe, expect, test } from "bun:test";
import { buildContinuousPierMesh, buildContinuousRailMesh, buildContinuousSliceMesh, mitres } from "../src/system/bridge-mesh";

/** the triangles whose normal ((b − a) × (c − a)) does not point away from the prism's centre */
const inward = (m: { positions: number[]; triangles: number[] }) => {
  const P = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
  const n = m.positions.length / 3;
  const c = [0, 1, 2].map((k) => Array.from({ length: n }, (_, i) => m.positions[i * 3 + k]!).reduce((a, b) => a + b, 0) / n);
  let bad = 0;
  for (let t = 0; t < m.triangles.length; t += 3) {
    const [a, b, d] = [P(m.triangles[t]!), P(m.triangles[t + 1]!), P(m.triangles[t + 2]!)];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!],
      v = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
    const nx = u[1]! * v[2]! - u[2]! * v[1]!,
      ny = u[2]! * v[0]! - u[0]! * v[2]!,
      nz = u[0]! * v[1]! - u[1]! * v[0]!;
    const mid = [(a[0]! + b[0]! + d[0]!) / 3 - c[0]!, (a[1]! + b[1]! + d[1]!) / 3 - c[1]!, (a[2]! + b[2]! + d[2]!) / 3 - c[2]!];
    if (nx * mid[0]! + ny * mid[1]! + nz * mid[2]! <= 0) bad++;
  }
  return bad;
};

describe("review A9 — faces wound outward, piers along the axis, slices mitred", () => {
  test("a deck slice, a parapet slice and a pier: every face counter-clockwise seen from outside", () => {
    const cases: [[number, number, number], [number, number, number]][] = [
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      [
        [3, 4, 0],
        [-5, 12, 0],
      ],
    ];
    for (const [pa, pb] of cases) {
      const deck = buildContinuousSliceMesh({ pa, pb, width: 12, top0: 10, top1: 10.6, thick: 1.2, isStart: true, isEnd: true });
      expect(deck.triangles.length).toBe(36);
      expect(inward(deck)).toBe(0);
      for (const side of [-1, 1] as const) {
        const rail = buildContinuousRailMesh({
          pa,
          pb,
          width: 12,
          railW: 0.3,
          railH: 1,
          side,
          top0: 10,
          top1: 10.6,
          isStart: true,
          isEnd: true,
        });
        expect(inward(rail)).toBe(0);
      }
    }
    const pier = buildContinuousPierMesh({ p: [0, 0, 0], width: 12, pierWidth: 3, groundFooting: -2, intradosTop: 8, axis: [0.6, 0.8] });
    expect(inward(pier)).toBe(0);
  });

  test("a pier's mesh is its collision strip: 2 m along the bridge's axis, its width across", () => {
    const ax: [number, number] = [0.6, 0.8];
    const m = buildContinuousPierMesh({ p: [10, 20, 0], width: 12, pierWidth: 3, groundFooting: -2, intradosTop: 8, axis: ax });
    for (let i = 0; i < m.positions.length; i += 3) {
      const dx = m.positions[i]! - 10,
        dy = m.positions[i + 1]! - 20;
      expect(Math.abs(dx * ax[0] + dy * ax[1])).toBeCloseTo(1, 9);
      expect(Math.abs(-dx * ax[1] + dy * ax[0])).toBeCloseTo(1.5, 9);
    }
  });

  test("two slices at a 20° bend share their corners (mitred): no crack, no overlap at the outer edge", () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10 + 10 * Math.cos(0.349), 10 * Math.sin(0.349)],
    ];
    const m = mitres(pts, 6);
    const s1 = buildContinuousSliceMesh({
      pa: [...pts[0]!, 0],
      pb: [...pts[1]!, 0],
      width: 12,
      top0: 5,
      top1: 5.5,
      thick: 1,
      acrossA: m[0],
      acrossB: m[1],
    });
    const s2 = buildContinuousSliceMesh({
      pa: [...pts[1]!, 0],
      pb: [...pts[2]!, 0],
      width: 12,
      top0: 5.5,
      top1: 6,
      thick: 1,
      acrossA: m[1],
      acrossB: m[2],
    });
    // (the first's end corners — 2 left, 3 right — are the second's start corners — 1 left, 0 right)
    for (const [i, j] of [
      [2, 1],
      [3, 0],
    ]) {
      for (let k = 0; k < 3; k++) expect(s1.positions[i! * 3 + k]!).toBeCloseTo(s2.positions[j! * 3 + k]!, 9);
    }
    expect(inward(s1) + inward(s2)).toBe(0);
  });
});
