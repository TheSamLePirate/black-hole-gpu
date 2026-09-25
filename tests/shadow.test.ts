import { describe, expect, test } from "bun:test";
import { cameraFrame } from "../src/camera";
import { captureTolerance, traceBackward, type Vec3 } from "../src/physics";
import { defaultSettings } from "../src/settings";
import { cameraRay, criticalCurveDirections } from "../src/shadow";

const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};

describe("analytic shadow guide", () => {
  test("Schwarzschild: angular radius sin α = 3√3 √(1 − 2/r) / r for a static observer", () => {
    const s = { ...defaultSettings(), spin: 0, distance: 30, inclination: 60 };
    const cam = cameraFrame(s);
    const [curve] = criticalCurveDirections(cam, 0);
    const expected = Math.asin((3 * Math.sqrt(3) * Math.sqrt(1 - 2 / 30)) / 30);
    expect(curve!.length).toBeGreaterThan(100);
    for (const d of curve!) expect(Math.acos(-d[0])).toBeCloseTo(expected, 4);
  });

  for (const [spin, incl, motion] of [
    [0.9, 60, "static"],
    [0.998, 85, "static"],
    [0.7, 80, "orbit"],
  ] as const) {
    test(`a=${spin}, θ=${incl}°, ${motion} observer: guide separates captured from escaping rays`, () => {
      const s = { ...defaultSettings(), spin, distance: 40, inclination: incl, motion };
      const cam = cameraFrame(s);
      const [curve] = criticalCurveDirections(cam, spin, 400);
      // centroid direction of the shadow
      const c = norm(curve!.reduce((acc, d) => [acc[0] + d[0], acc[1] + d[1], acc[2] + d[2]] as Vec3, [0, 0, 0]));
      const opts = { eps: 0.01, maxSteps: 60000, rEscape: 2000, captureTol: captureTolerance(spin) };
      for (let i = 0; i < curve!.length; i += 37) {
        const d = curve![i]!;
        const toward = (f: number): Vec3 => norm([d[0] + f * (c[0] - d[0]), d[1] + f * (c[1] - d[1]), d[2] + f * (c[2] - d[2])]);
        const inside = cameraRay(cam, toward(0.03))!;
        const outside = cameraRay(cam, toward(-0.03))!;
        expect(traceBackward(inside.state, inside.L, spin, opts).fate).toBe("horizon");
        expect(traceBackward(outside.state, outside.L, spin, opts).fate).toBe("escape");
      }
    });
  }
});
