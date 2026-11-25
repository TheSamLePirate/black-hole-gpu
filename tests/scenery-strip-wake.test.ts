import { expect, test } from "bun:test";
import trace from "../src/shaders/trace.wgsl" with { type: "text" };
import { kelvinSlope, kelvinSlopeOld, sceneryStrip, zebra } from "./e2e/lib/strip-wake-models";

// (25 Nov 2026) Two of the campaign's defects, their shader logic modelled on the CPU (tests/e2e/lib/strip-wake-models.ts — the GPU
// slice tests/e2e/strip-wake-slice.e2e.test.ts runs trace.wgsl's own functions against the same models), the old shapes the positive
// witnesses:
//  - a pedestrian crossing (scenerySurface, kind 5) drawn as a striped pill: a segment's strip ended in round caps (its distance clamped
//    to its ends), right for a road's pieces — they join —, wrong for a junction's paint: now cut straight across at its ends;
//  - a ship's wake drawn as a target of regular concentric rings (seaWake): its Kelvin waves' heights ∝ the hull's length whatever its
//    speed — slopes of 0.3–0.75 behind a fishing boat at 2 m/s —, the transverse arcs as strong as the cusps, unbroken. Now their
//    steepness by the Froude number, the transverse smoothed over the turbulent wake, the divergent strongest on the cusps, the crests
//    broken by the sea's own noise.

const AA = 0.12;

test("a crossing's strip is square-ended: no paint past its ends (the old round caps: a half-disc each)", () => {
  // (a zebra across a 10 m carriageway: its strip 4 m deep — scenery-worker.ts surfaceSegment(a, b, 4, 5) —, along x from 0 to 10)
  const a: [number, number] = [0, 0],
    b: [number, number] = [10, 0];
  let pastSquare = 0,
    pastRound = 0,
    inside = 0;
  const step = 0.05;
  for (let x = -3; x <= 13; x += step)
    for (let y = -3; y <= 3; y += step) {
      const sq = sceneryStrip([x, y], a, b, 2, AA, true)[2];
      const rd = sceneryStrip([x, y], a, b, 2, AA, false)[2];
      const past = x < -AA || x > 10 + AA;
      if (past) {
        pastSquare += sq * step * step;
        pastRound += rd * step * step;
      } else if (Math.abs(y) < 2 - AA) inside += sq * step * step;
    }
  // (positive witness: the round caps paint two half-discs of 2 m radius — 12.6 m² — past the ends)
  expect(pastRound).toBeGreaterThan(10);
  expect(pastSquare).toBe(0);
  // (inside its rectangle, whole: ~10 × (4 − 2 aa) m², its ends filtered over ± aa)
  expect(inside).toBeGreaterThan(0.97 * 10 * (4 - 2 * AA));
  expect(inside).toBeLessThan(1.03 * (10 + 2 * AA) * (4 - 2 * AA));
  // (its corners square: the round cap's corner empty, the square's full)
  expect(sceneryStrip([10 - 0.2, 1.8], a, b, 2, AA, true)[2]).toBeGreaterThan(0.99);
  expect(sceneryStrip([10 + 1.2, 1.0], a, b, 2, AA, false)[2]).toBeGreaterThan(0.99);
  expect(sceneryStrip([10 + 1.2, 1.0], a, b, 2, AA, true)[2]).toBe(0);
  // (its bars: half of each metre along it, the same across the strip — bars across the carriageway, parallel to the traffic)
  let painted = 0,
    n = 0;
  for (let x = 0.01; x < 10; x += 0.01) {
    const s = sceneryStrip([x, 1.2], a, b, 2, AA, true);
    painted += s[2] * zebra(s[1], AA);
    n++;
  }
  expect(painted / n).toBeCloseTo(0.5, 1);
  // (the roads' pieces keep their round caps: their distance, abscissa and cover as before)
  const r = sceneryStrip([11, 1], a, b, 2, AA, false);
  expect(r[0]).toBeCloseTo(Math.SQRT2, 6);
  expect(r[1]).toBe(10);
  // (the shader carries it: the walk's lines through sceneryStrip, square for kind 5)
  const walk = trace.slice(trace.indexOf("fn scenerySurface("), trace.indexOf("fn sceneryMirror("));
  expect(walk).toContain("sceneryStrip(point,p.xy,p.zw,half,aa,kind==5.0)");
  const fn = trace.slice(trace.indexOf("fn sceneryStrip("), trace.indexOf("fn scenerySurface("));
  expect(fn).toContain("let ends=1.0-smoothstep(-aa,aa,max(-s,s-len));");
});

/** max |slope| and mean |slope| over a set of points of the wake */
function slopes(f: (x: number, ay: number, k: number) => readonly number[], pts: [number, number][]) {
  let max = 0,
    sum = 0;
  pts.forEach(([x, ay], k) => {
    const g = f(x, ay, k);
    const m = Math.hypot(g[0]!, g[1]!);
    max = Math.max(max, m);
    sum += m;
  });
  return { max, mean: sum / Math.max(pts.length, 1) };
}
/** the sea's noise stand-in (−1…1): a fixed sequence */
const jitAt = (k: number) => Math.sin(k * 12.9898) * 0.95;

test("a fishing boat at 2 m/s: gentle waves — the old ones' slopes up to 1.8 (the concentric rings)", () => {
  const U = 2,
    L = 20,
    reach = 40 * L + 2500,
    foot = 0.05;
  const pts: [number, number][] = [];
  for (let x = 0.5; x < 20 * L; x += 0.37) for (let r = 0; r < 0.4; r += 0.013) pts.push([x, r * x]);
  const old = slopes((x, ay) => kelvinSlopeOld(x, ay, U, L, reach, foot), pts);
  const now = slopes((x, ay, k) => kelvinSlope(x, ay, U, L, reach, foot, jitAt(k), 0), pts);
  // (positive witness: the old waves' steepest slope behind it, and their mean over the wedge)
  expect(old.max).toBeGreaterThan(1);
  expect(now.max).toBeLessThanOrEqual(0.4 + 1e-6);
  expect(now.mean).toBeLessThan(old.mean / 4);
  // (still there: its divergent waves near it)
  expect(now.max).toBeGreaterThan(0.02);
});

test("a ship's Kelvin waves: the V's arms on the cusps, the transverse waves smoothed over the turbulent wake, the crests broken", () => {
  // (a 60 m ship at 6 m/s — Fn 0.25 —, 5 lengths behind its bow)
  const U = 6,
    L = 60,
    reach = 40 * L + 2500,
    foot = 0.1,
    x = 5 * L;
  const band = (r0: number, r1: number, axis: number, old = false) => {
    const pts: [number, number][] = [];
    for (let r = r0; r <= r1; r += 0.0005) pts.push([x, r * x]);
    return slopes(
      (xx, ay, k) => (old ? kelvinSlopeOld(xx, ay, U, L, reach, foot) : kelvinSlope(xx, ay, U, L, reach, foot, jitAt(k), axis)),
      pts,
    ).mean;
  };
  // (the arms: the cusps' band ~19.5° steeper than the wedge's inside)
  expect(band(0.31, 0.36, 0)).toBeGreaterThan(1.3 * band(0.08, 0.22, 0));
  // (nothing outside the wedge)
  expect(band(0.405, 0.6, 0)).toBe(0);
  // (the turbulent wake's strip: the transverse waves on the axis smoothed — three quarters off)
  expect(band(0, 0.02, 1)).toBeLessThan(0.4 * band(0, 0.02, 0));
  // (the crests broken: the waves' envelope — their steepest slope over a wavelength along x — across the wedge's inside varies with
  // the sea's noise; the old one's smooth)
  const lam = (2 * Math.PI * U * U) / 9.81;
  const along = (old: boolean) => {
    const v: number[] = [];
    for (let k = 0; k < 64; k++) {
      const ay = (0.06 + (k / 64) * 0.14) * x;
      let e = 0;
      for (let i = 0; i < 32; i++) {
        const xx = x + (i / 32) * lam;
        const g = old ? kelvinSlopeOld(xx, ay, U, L, reach, foot) : kelvinSlope(xx, ay, U, L, reach, foot, jitAt(k), 0);
        e = Math.max(e, Math.hypot(g[0], g[1]));
      }
      v.push(e);
    }
    const m = v.reduce((s, e) => s + e, 0) / v.length;
    return Math.sqrt(v.reduce((s, e) => s + (e - m) ** 2, 0) / v.length) / Math.max(m, 1e-9);
  };
  // (25 Nov 2026: 0.39 against 0.32)
  expect(along(false)).toBeGreaterThan(1.15 * along(true));
  // (a big ship's waves stay physical: under the breaking limit everywhere — ak ~0.45: the bow wave's cusp near the hull at most)
  const pts: [number, number][] = [];
  for (let xx = 1; xx < 10 * L; xx += 1.3) for (let r = 0; r < 0.4; r += 0.01) pts.push([xx, r * xx]);
  expect(slopes((xx, ay, k) => kelvinSlope(xx, ay, U, L, reach, foot, jitAt(k), 0), pts).max).toBeLessThanOrEqual(0.4 + 1e-6);
});

test("seaWake carries the model: kelvinSlope, no atan/cos/sin per train, the turbulent wake's strip and the screw's wash", () => {
  const fn = trace.slice(trace.indexOf("fn kelvinSlope("), trace.indexOf("fn seaWake("));
  expect(fn).toContain("let steep = smoothstep(0.08, 0.35, U / sqrt(9.81 * max(L, 1.0)));");
  expect(fn).toContain("(0.02 + 0.035 * steep) * q * (1.0 - 0.75 * axis)");
  expect(fn).toContain("-a * a * (1.0 - seen) * lit");
  expect(fn).toContain("let ct = inverseSqrt(1.0 + tt * tt);");
  expect(fn).not.toContain("atan(");
  const wake = trace.slice(trace.indexOf("fn seaWake("), trace.indexOf("// The FFT's waves at the point SEA_D"));
  expect(wake).toContain("kelvinSlope(x, ay, U, L, reach, footM, pn, axis)");
  expect(wake).toContain("let wash = 0.55 * slow * exp(-xw / (L + 15.0));");
});
