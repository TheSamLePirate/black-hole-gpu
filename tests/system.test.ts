// Phase 0 of ANALYSE-INTEGRATION.md: the Gargantua system's model against the study's audit
// (tests/data/gargantua-results.json, from ../interstellar-system/calculations.py), and the validation of
// the configuration retained (Miller at 1.3 g, a K2 dwarf at 2 000 AU for Edmunds, a 0.05 M throat).

import { expect, test } from "bun:test";
import ref from "./data/gargantua-results.json";
import { body, GARGANTUA_SYSTEM as SYS } from "../src/system/bodies";
import { bodyState, meanMotion } from "../src/system/ephemeris";
import {
  circularOrbit, hillRadius, horizon, integrateHierarchy, isco, rocheLimit, SI, throatTide, tideRatio, tides, units,
} from "../src/system/kerr-orbits";
import { radius, W_OVER_M } from "../src/wormhole";

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const U = units(1e8);
const base = ref.baseline.bodies;

test("units of a 10⁸ M☉ hole match the audit", () => {
  expect(rel(U.rg, ref.constants.rg_m)).toBeLessThan(1e-13);
  expect(rel(U.tg, ref.constants.tg_s)).toBeLessThan(1e-13);
  expect(rel(horizon(0.998), ref.baseline.horizon_x)).toBeLessThan(1e-13);
  expect(rel(isco(0.998), ref.baseline.isco_x)).toBeLessThan(1e-12);
});

test("analytic checks of the audit: Schwarzschild ISCO, uᵗ(10, 0), weak-field limit", () => {
  expect(Math.abs(isco(0) - 6)).toBeLessThan(1e-12);
  expect(Math.abs(circularOrbit(10, 0).ut - 1 / Math.sqrt(0.7))).toBeLessThan(1e-14);
  const far = circularOrbit(1e8, 0.998);
  expect(Math.abs(far.period / far.newtonPeriod - 1)).toBeLessThan(1e-10);
});

test("Kerr circular orbits of Miller, Mann, the star and the mouth reproduce results.json", () => {
  const cases: [keyof typeof base, number][] = [
    ["miller", 10], ["mann", 40], ["star", base.star.x], ["wormhole", base.wormhole.x],
  ];
  for (const [name, x] of cases) {
    const o = circularOrbit(x, 0.998);
    const r = base[name];
    expect(rel(o.ut, r.ut)).toBeLessThan(1e-12);
    expect(rel(o.E, r.energy)).toBeLessThan(1e-12);
    expect(rel(o.L, r.ell)).toBeLessThan(1e-12);
    expect(rel(o.radialFactor, r.radial_factor)).toBeLessThan(1e-11);
    expect(rel(o.verticalFactor, r.vertical_factor)).toBeLessThan(1e-11);
    expect(rel(o.vZamo, r.v_zamo_c)).toBeLessThan(1e-11);
    expect(rel(o.period * U.tg, r.period_s)).toBeLessThan(1e-12);
    expect(rel(o.properPeriod * U.tg, r.proper_period_s)).toBeLessThan(1e-12);
    // the audit's consistency checks, in float64
    expect(o.checks.normalisation).toBeLessThan(1e-13);
    expect(o.checks.potential).toBeLessThan(1e-12);
    expect(o.checks.derivative).toBeLessThan(1e-11);
    expect(o.radialFactor).toBeGreaterThan(0);
    expect(o.verticalFactor).toBeGreaterThan(0);
  }
});

test("tides: the audit's Earth-sized Miller and Mann; Miller at 1.3 g keeps 0.58 % of its gravity", () => {
  for (const name of ["miller", "mann"] as const) {
    const t = tides(base[name].x, 0.998, 1e8, SI.earthRadius, SI.muEarth);
    expect(rel(t.kerr, base[name].tide_kerr_ms2)).toBeLessThan(1e-11);
    expect(rel(t.newton, base[name].tide_newton_ms2)).toBeLessThan(1e-11);
    expect(rel(t.overSelfG, base[name].tide_over_self_g)).toBeLessThan(1e-11);
  }
  // Miller of the retained system: R = 1.3 R⊕ at the Earth's density (m = 1.3³ M⊕) → 1.3 g
  const R = 1.3 * SI.earthRadius, mu = 1.3 ** 3 * SI.muEarth;
  expect(rel(mu / R ** 2 / (SI.muEarth / SI.earthRadius ** 2), 1.3)).toBeLessThan(1e-12);
  const t = tides(10, 0.998, 1e8, R, mu);
  expect(rel(t.overSelfG, base.miller.tide_over_self_g)).toBeLessThan(1e-11); // same density: same ratio
  expect(t.kerr).toBeCloseTo(0.0746, 3);
  // the registry agrees: 8 280 km, 1.3 g
  const miller = body(SYS, "miller");
  expect(miller.radius * U.rg / 1000).toBeCloseTo(8282, 0);
  expect(miller.surface!.gravity).toBe(1.3);
});

test("Miller's clock: 1 hour there is 1 h 10 min 51 s far away; a turn is 28.04 h far, 23.75 h proper", () => {
  const o = circularOrbit(10, 0.998);
  const far = o.ut * 3600;
  expect(Math.floor(far / 3600)).toBe(1);
  expect(Math.floor((far % 3600) / 60)).toBe(10);
  expect(Math.round(far % 60)).toBe(51);
  expect(o.period * U.tg / 3600).toBeCloseTo(28.0428, 3);
  expect(o.properPeriod * U.tg / 3600).toBeCloseTo(23.7478, 3);
  expect(circularOrbit(40, 0.998).ut).toBeCloseTo(1.0394, 4);
});

test("the audit's checks: the solar star's Hill radius, Edmunds' year, the Roche limit", () => {
  expect(rel(hillRadius(10000, SI.muSun, SI.muSun * 1e8), ref.checks.star_hill_au)).toBeLessThan(1e-12);
  expect(rel(2 * Math.PI * Math.sqrt(SI.au ** 3 / SI.muSun) / 86400, ref.checks.edmunds_period_days)).toBeLessThan(1e-12);
  expect(rel(rocheLimit(SI.earthRadius, SI.muEarth, SI.muSun * 1e8) / SI.au, ref.checks.roche_newton_earth_au)).toBeLessThan(1e-12);
  expect(rel(tideRatio(1e8, 1, 1, 10000), ref.checks.star_tide_relative_on_edmunds)).toBeLessThan(1e-12);
});

test("the audit's Edmunds integration is reproduced (2 000 years, step 0.0025 yr)", () => {
  const r = integrateHierarchy({ mStar: 1, mHole: 1e8, A: 10000, a: 1, step: 0.0025, years: 2000 });
  const q = ref.integration[0]!;
  expect(r.steps).toBe(q.steps);
  expect(Math.abs(r.rMin - q.r_min_au)).toBeLessThan(1e-9);
  expect(Math.abs(r.rMax - q.r_max_au)).toBeLessThan(1e-9);
  expect(Math.abs(r.eMax - q.e_max)).toBeLessThan(1e-9);
  expect(rel(r.jDrift, q.jacobi_drift_over_local_binding_scale)).toBeLessThan(1e-3);
});

test("the retained K2 dwarf at 2 000 AU keeps Edmunds over 10 000 years (Hill 0.215, tide 0.66 %)", () => {
  const K2 = { m: 0.78, L: 0.35 }, A = 2000, a = Math.sqrt(K2.L);
  const rH = hillRadius(A, K2.m, 1e8);
  expect(a / rH).toBeCloseTo(0.215, 3);
  expect(a / rH).toBeLessThan(0.25); // ×2 margin under the empirical 0.4895
  expect(tideRatio(1e8, K2.m, a, A)).toBeCloseTo(0.0066, 4);
  const coarse = integrateHierarchy({ mStar: K2.m, mHole: 1e8, A, a, step: 0.0025, years: 10000 });
  const fine = integrateHierarchy({ mStar: K2.m, mHole: 1e8, A, a, step: 0.00125, years: 10000 });
  for (const r of [coarse, fine]) {
    expect(r.rMin / a).toBeGreaterThan(0.97);
    expect(r.rMax / a).toBeLessThan(1.03);
    expect(r.eMax).toBeLessThan(0.03);
  }
  // second order: halving the step divides the Jacobi drift by ≈ 4
  expect(coarse.jDrift / fine.jDrift).toBeGreaterThan(3);
  expect(fine.jDrift).toBeLessThan(1e-5);
  // the registry: Edmunds' year of 188 days, 0.59 AU from its star
  const sys = SYS;
  const w = meanMotion(sys, body(sys, "edmunds"));
  expect(2 * Math.PI / w * U.tg / 86400).toBeCloseTo(188, 0);
  const e = bodyState(sys, "edmunds", 1234.5), s = bodyState(sys, "k2", 1234.5);
  const d = Math.hypot(e.pos[0] - s.pos[0], e.pos[1] - s.pos[1], e.pos[2] - s.pos[2]);
  expect(d * U.rgAu).toBeCloseTo(a, 6);
}, 60000);

test("the 0.05 M throat: 0.19 m/s² of tide over 10 m; r''(ℓ) of the Dneg metric peaks at 4/(π² M_w)", () => {
  const rho = 0.05;
  expect(throatTide(rho * U.rg, 0.05, 10)).toBeCloseTo(0.19, 2);
  const w = { rho, a: 0.5 * 0.01 * rho, M: (0.05 * rho) / W_OVER_M };
  const h = 1e-6 * rho;
  const l = w.a + 1e-4 * rho;
  const r2 = (radius(w, l + h)[0] - 2 * radius(w, l)[0] + radius(w, l - h)[0]) / (h * h);
  expect(rel(r2, 4 / (Math.PI ** 2 * w.M))).toBeLessThan(2e-3);
  // the mouth's orbit at 300 M: 0.058 c, 0.51 year
  const o = circularOrbit(300, 0.998);
  expect(o.vZamo).toBeCloseTo(0.058, 3);
  expect(o.period * U.tg / SI.year).toBeCloseTo(0.51, 2);
});
