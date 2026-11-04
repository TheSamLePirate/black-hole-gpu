import { expect, test } from "bun:test";
import { GOPRO, GOPRO_F, GOPRO_SRC_TAN, goproRenderFov, lensAngle, lensSource } from "../src/lens";

// The GoPro mode's lens (Q6 I8, decision 38): 100° across the output, rectilinear within 28°, the corners of the 2.39:1 band
// read within the render, the centre ~0.84 of a source pixel per output pixel.

test("the lens: rectilinear within 28°, 100° across, continuous", () => {
  const deg = 180 / Math.PI;
  // (the output's edge at 50°)
  expect(lensAngle(1) * deg).toBeCloseTo(50, 6);
  // (rectilinear near the axis: r = f tan θ)
  expect(lensAngle(0.3)).toBeCloseTo(Math.atan(0.3 / GOPRO_F), 9);
  // (continuous and monotone across the rectilinear part's end)
  const r0 = GOPRO_F * Math.tan(GOPRO.theta0);
  expect(lensAngle(r0 + 1e-7) - lensAngle(r0 - 1e-7)).toBeLessThan(1e-6);
  for (let r = 0; r < 1.1; r += 0.01) expect(lensAngle(r + 0.01)).toBeGreaterThan(lensAngle(r));
});

test("the band's corners read within the render; outside the band, nothing", () => {
  const aspect = 16 / 9;
  const v = 1 / GOPRO.band;
  for (const [u, w] of [
    [1, v],
    [-1, -v],
    [1, 0],
    [0, v],
  ] as const) {
    const s = lensSource(u, w, aspect)!;
    expect(s[0]).toBeGreaterThanOrEqual(-1e-9);
    expect(s[0]).toBeLessThanOrEqual(1 + 1e-9);
    expect(s[1]).toBeGreaterThanOrEqual(-1e-9);
    expect(s[1]).toBeLessThanOrEqual(1 + 1e-9);
  }
  expect(lensSource(0, v * 1.01, aspect)).toBeNull();
  // (the render's field: 104.6° across)
  expect((2 * Math.atan(GOPRO_SRC_TAN) * 180) / Math.PI).toBeCloseTo(104.6, 0);
  expect(goproRenderFov(aspect)).toBeGreaterThan(60);
  // (the centre's sampling: a source pixel per output pixel × renderScale / (f · srcTan) — about 0.84)
  expect(GOPRO.renderScale / (GOPRO_F * GOPRO_SRC_TAN)).toBeCloseTo(0.84, 1);
});
