import { expect, test } from "bun:test";
import { gpuTableData, NN, NSTEP, REFR_OFF_N, REFR_VEC4S } from "../src/system/refraction-gpu";
import { BENNETT_AIR } from "../src/system/refraction-layered";
import {
  LIFT_FADE,
  liftAt,
  liftFade,
  liftOf,
  liftPolynomial,
  liftTable,
  projectApparent,
  unprojectApparent,
} from "../src/system/refraction-lift";

// R4 (contract C0-3): the lift of the ground seen through the air — its integral against the uniform curvature's κd²/2, the
// fade under 0.1′, the table read back, and the projection's inverse (≤ 1 mm at 10 km, ≤ 0.1 m at 300 km).
const R = 6371e3;

test("a uniform gradient lifts by κ d²/2", () => {
  const k = 0.13;
  const N = (h: number) => 3e-4 - (k / R) * h;
  for (const d of [10e3, 39e3, 156e3]) {
    const L = liftOf(N, 0, 0, d);
    expect(Math.abs(L / ((k / R) * d * d * 0.5) - 1)).toBeLessThan(0.01);
  }
  // (1 m at 10 km, 16 m at 39 km, 250 m at 156 km — the plan's figures)
  expect(liftOf(N, 0, 0, 10e3)).toBeCloseTo(1.02, 1);
  expect(liftOf(N, 0, 0, 156e3)).toBeGreaterThan(240);
});

test("the fade: none under half of 0.1′, whole over it, smooth between", () => {
  expect(liftFade(0.4 * LIFT_FADE * 1000, 1000)).toBe(0);
  expect(liftFade(1.2 * LIFT_FADE * 1000, 1000)).toBeCloseTo(1.2 * LIFT_FADE * 1000, 9);
  const mid = liftFade(0.75 * LIFT_FADE * 1000, 1000) / (0.75 * LIFT_FADE * 1000);
  expect(mid).toBeGreaterThan(0.4);
  expect(mid).toBeLessThan(0.6);
});

test("the eye's table from the layered air: k near the ground ~0.13–0.2, read back within 2 % of the integral", () => {
  const f = gpuTableData(BENNETT_AIR);
  const N = (h: number) => {
    const x = Math.min(Math.max(h, 0), (NN - 1) * NSTEP) / NSTEP;
    const i = Math.min(Math.floor(x), NN - 2);
    return f[REFR_OFF_N + i]! * (1 - (x - i)) + f[REFR_OFF_N + i + 1]! * (x - i);
  };
  expect(f.length).toBe(REFR_VEC4S * 4);
  const t = liftTable(f, 10);
  for (const [d, hP] of [
    [20e3, 0],
    [80e3, 500],
    [300e3, 4000],
  ] as const) {
    const L = liftAt(t, d, hP);
    const ref = liftFade(liftOf(N, 10, hP, d), d);
    expect(Math.abs(L / ref - 1)).toBeLessThan(0.02);
  }
  const k = (2 * R * liftAt(t, 20e3, 0)) / (20e3 * 20e3);
  expect(k).toBeGreaterThan(0.1);
  expect(k).toBeLessThan(0.25);
});

test("the scenery's polynomial follows the table: within 0.1 m and 3 % from 4 to 60 km", () => {
  for (const hE of [10, 1500]) {
    const t = liftTable(gpuTableData(BENNETT_AIR), hE);
    const [c2, c3] = liftPolynomial(t, 0);
    for (let d = 4000; d <= 60000; d += 4000) {
      const L = liftAt(t, d, 0);
      const P = (c2 + c3 * d) * d * d;
      expect(Math.abs(P - L)).toBeLessThan(Math.max(0.1, 0.03 * L));
    }
  }
});

test("from orbit, the ground at the limb lifted as Bouguer's invariant says (n r cos e = const)", () => {
  // (from 420 km the ray grazing the ground: cos e = n₀ R / r — its apparent dip over the geometric tangent's)
  const f = gpuTableData(BENNETT_AIR);
  const N = (h: number) => {
    const x = Math.min(Math.max(h, 0), (NN - 1) * NSTEP) / NSTEP;
    const i = Math.min(Math.floor(x), NN - 2);
    return f[REFR_OFF_N + i]! * (1 - (x - i)) + f[REFR_OFF_N + i + 1]! * (x - i);
  };
  const hE = 420e3;
  const rE = R + hE;
  const d = Math.sqrt(rE * rE - R * R);
  const geo = Math.acos(R / rE);
  const app = Math.acos(Math.min(((1 + N(0)) * R) / rE, 1));
  const bouguer = geo - app;
  const lifted = liftOf(N, hE, 0, d) / d;
  expect(Math.abs(lifted / bouguer - 1)).toBeLessThan(0.15);
});

test("the projection and its inverse: ≤ 1 mm at 10 km, ≤ 0.1 m at 300 km", () => {
  const t = liftTable(gpuTableData(BENNETT_AIR), 10);
  for (const [d, tol] of [
    [10e3, 1e-3],
    [300e3, 0.1],
  ] as const) {
    const P: [number, number, number] = [d, 0, -(d * d) / (2 * R)];
    const up: [number, number, number] = [d / R, 0, 1];
    const n = Math.hypot(...up);
    const u: [number, number, number] = [up[0] / n, up[1] / n, up[2] / n];
    const A = projectApparent(t, P, 0, u);
    const back = unprojectApparent(t, A, 0, u);
    expect(Math.hypot(back[0] - P[0], back[1] - P[1], back[2] - P[2])).toBeLessThan(tol);
  }
});
