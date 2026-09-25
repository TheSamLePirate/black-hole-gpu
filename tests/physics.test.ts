import { describe, expect, test } from "bun:test";
import {
  blackbodyXYZ,
  buildBlackbodyLUT,
  captureTolerance,
  criticalImpact,
  hamiltonian,
  horizon,
  isco,
  ntFlux,
  ntFluxMax,
  traceBackward,
  xyzToLinearSRGB,
  type State,
} from "../src/physics";

/** Photon received by a distant equatorial observer with impact parameter b (= L, E = 1). */
function equatorialRay(b: number, a: number, r0 = 2000): State {
  const del = r0 * r0 - 2 * r0 + a * a;
  const W = r0 * r0 + a * a - a * b;
  const pr = Math.sqrt(Math.max(0, W * W / del - (b - a) ** 2) / del);
  return { x: [r0, Math.PI / 2, 0, 0], p: [pr, 0] };
}

const opts = (a: number) => ({ eps: 0.02, maxSteps: 20000, rEscape: 3000, captureTol: captureTolerance(a) });

describe("Kerr constants", () => {
  test("horizon & ISCO", () => {
    expect(horizon(0)).toBeCloseTo(2, 10);
    expect(isco(0)).toBeCloseTo(6, 10);
    expect(isco(0.998)).toBeCloseTo(1.2370, 3);
    expect(isco(-1)).toBeCloseTo(9, 6);
  });
  test("Schwarzschild critical impact parameter is 3√3", () => {
    expect(criticalImpact(0).pro).toBeCloseTo(3 * Math.sqrt(3), 10);
  });
});

describe("geodesic integrator (RK4, backward)", () => {
  for (const a of [0, 0.6, 0.94, 0.998]) {
    const { pro, retro } = criticalImpact(a);
    test(`a=${a}: capture/escape brackets the critical curve (pro ${pro.toFixed(3)}, retro ${retro.toFixed(3)})`, () => {
      const d = 0.01;
      // Prograde photons (L > 0).
      expect(traceBackward(equatorialRay(pro - d, a), pro - d, a, opts(a)).fate).toBe("horizon");
      expect(traceBackward(equatorialRay(pro + d, a), pro + d, a, opts(a)).fate).toBe("escape");
      // Retrograde photons (L < 0).
      expect(traceBackward(equatorialRay(-retro + d, a), -retro + d, a, opts(a)).fate).toBe("horizon");
      expect(traceBackward(equatorialRay(-retro - d, a), -retro - d, a, opts(a)).fate).toBe("escape");
    });
  }

  test("null constraint H = 0 is preserved along an off-plane ray", () => {
    const a = 0.9;
    const r0 = 30, th0 = 1.2, L = 3, pth = 2.5;
    const del = r0 * r0 - 2 * r0 + a * a;
    const s2 = Math.sin(th0) ** 2;
    const W = r0 * r0 + a * a - a * L;
    const pr = Math.sqrt(W * W / del - pth * pth - (L - a * s2) ** 2 / s2) / Math.sqrt(del);
    const st: State = { x: [r0, th0, 0, 0], p: [pr, pth] };
    expect(Math.abs(hamiltonian(st, L, a))).toBeLessThan(1e-9);
    const res = traceBackward(st, L, a, { eps: 0.05, maxSteps: 5000, rEscape: 1000, captureTol: captureTolerance(a) });
    expect(res.maxDH).toBeLessThan(1e-4);
  });
});

describe("Novikov–Thorne disk", () => {
  test("flux vanishes at ISCO and approaches Newtonian r^-3 far away", () => {
    for (const a of [-0.9, 0, 0.5, 0.998]) {
      const rin = isco(a);
      expect(ntFlux(rin * 1.000001, a, rin)).toBeLessThan(1e-6);
      const r = 1e9;
      expect(ntFlux(r, a, rin) * r ** 3).toBeCloseTo(1, 2);
    }
  });
  test("Schwarzschild flux peaks near r ≈ 9.55M", () => {
    expect(ntFluxMax(0, 6).rPeak).toBeCloseTo(9.55, 1);
  });
});

describe("colorimetry", () => {
  test("6500 K blackbody is close to the sRGB white point", () => {
    const [X, Y, Z] = blackbodyXYZ(6504);
    const rgb = xyzToLinearSRGB([X / Y, 1, Z / Y]);
    for (const c of rgb) expect(c).toBeCloseTo(1, 1);
  });
  test("LUT is monotone in luminance", () => {
    const lut = buildBlackbodyLUT();
    for (let i = 1; i < lut.length / 4; i++) expect(lut[i * 4 + 3]!).toBeGreaterThan(lut[(i - 1) * 4 + 3]!);
  });
});
