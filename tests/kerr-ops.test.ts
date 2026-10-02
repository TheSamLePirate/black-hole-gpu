import { test, expect } from "bun:test";
import { fromZamo, thrust, type Massive } from "../src/geodesic";
import { advanceTo, applyDv, circularBeta, type World } from "../src/maneuver";
import { kApoapsis, kCircularize, kerrOrbit, kHohmann, kInclination, kPeriapsis, kResonant, planeLeft, type KerrOp } from "../src/fc/kerr-ops";

const w: World = { a: 0.6 };
/** A circular prograde orbit in the equator at r (its velocity: the free fall with no radial pull). */
function circular(r: number, tiltDeg = 0): Massive {
  const st = fromZamo(r, Math.PI / 2, 0, [0, 0, 0.2], w.a, 0);
  const b = circularBeta(st, w)!;
  const t = (tiltDeg * Math.PI) / 180;
  return fromZamo(r, Math.PI / 2, 0, [0, -b[2] * Math.sin(t), b[2] * Math.cos(t)], w.a, 0);
}
/** The orbit after the op's burns. */
function after(st: Massive, op: KerrOp) {
  let s: Massive | null = st;
  for (const n of op.nodes) s = applyDv(advanceTo(s!, n.t, w)!, n.dv, w.a);
  return kerrOrbit(s!, w);
}

test("a circular orbit stays circular (the probe's own)", () => {
  const o = kerrOrbit(circular(20), w);
  expect(o.fate).toBe("bound");
  expect(Math.abs(o.ra - o.rp) / 20).toBeLessThan(2e-3);
});

test("apoapsis and periapsis put where asked, on the geodesics", () => {
  const st = circular(20);
  const A = kApoapsis(st, w, 45);
  expect(A.ok).toBe(true);
  const oa = after(st, A);
  expect(Math.abs(oa.ra - 45)).toBeLessThan(0.1);
  const P = kPeriapsis(st, w, 9);
  expect(P.ok).toBe(true);
  expect(Math.abs(after(st, P).rp - 9)).toBeLessThan(0.05);
});

test("Hohmann up and down end circular at the radius; not inside the ISCO", () => {
  for (const r2 of [40, 10]) {
    const st = circular(20);
    const H = kHohmann(st, w, r2);
    expect(H.ok).toBe(true);
    expect(H.nodes.length).toBe(2);
    const o = after(st, H);
    expect(Math.abs(o.rp - r2) / r2).toBeLessThan(5e-3);
    expect(Math.abs(o.ra - r2) / r2).toBeLessThan(5e-3);
  }
  expect(kHohmann(circular(20), w, 3).ok).toBe(false);
});

test("circularize at the apoapsis of an eccentric orbit", () => {
  const st = circular(20);
  const s2 = applyDv(st, [0.02, 0, 0], w.a);
  const C = kCircularize(s2, w, "ap");
  expect(C.ok).toBe(true);
  const o = after(s2, C);
  expect(Math.abs(o.ra - o.rp) / o.ra).toBeLessThan(5e-3);
});

test("inclination: 25° → 5°, and into the disk", () => {
  const st = circular(25, 25);
  expect((kerrOrbit(st, w).inc * 180) / Math.PI).toBeCloseTo(25, 0);
  for (const i of [5, 0]) {
    const I = kInclination(st, w, (i * Math.PI) / 180);
    expect(I.ok).toBe(true);
    expect((after(st, I).inc * 180) / Math.PI).toBeLessThan(i + 0.3);
    expect((after(st, I).inc * 180) / Math.PI).toBeGreaterThan(i - 0.3);
  }
});

test("a resonant orbit: the period doubled — from a circle and from an ellipse", () => {
  for (const st of [circular(20), applyDv(circular(20), [0.005, 0, 0], w.a)]) {
    const T0 = kerrOrbit(st, w).T;
    const R = kResonant(st, w, 2);
    expect(R.ok).toBe(true);
    expect(after(st, R).T / T0).toBeCloseTo(2, 2);
  }
});

test("the orbital period and the periapsis's advance (Schwarzschild-like: 6πM/p a turn, roughly)", () => {
  const c = kerrOrbit(circular(30), w);
  expect(Number.isNaN(c.Tr)).toBe(true);
  // (Kepler's 2π r^1.5 near enough far out, a little more for the frame's drag)
  expect(c.T / (2 * Math.PI * 30 ** 1.5)).toBeGreaterThan(0.97);
  expect(c.T / (2 * Math.PI * 30 ** 1.5)).toBeLessThan(1.05);
  const e = kerrOrbit(applyDv(circular(30), [0.01, 0, 0], w.a), w);
  const p = (2 * e.rp * e.ra) / (e.rp + e.ra);
  expect(e.advance / ((6 * Math.PI) / p)).toBeGreaterThan(0.6);
  expect(e.advance / ((6 * Math.PI) / p)).toBeLessThan(1.3);
});

test("a long plane change flown by the torque law: the plane reached, the orbit kept", () => {
  let st = circular(30);
  const i = (10 * Math.PI) / 180;
  const n: [number, number, number] = [0, -Math.sin(i), Math.cos(i)];
  // (2 g about a hole of 10⁸ suns: the burn lasts a good part of the orbit)
  const acc = (2 * 9.81 * 1476.625e8) / 299792458 ** 2;
  let given = 0;
  for (let k = 0; k < 20000; k++) {
    const p = planeLeft(st, w, n);
    if (p.left < 1e-5) break;
    const dv = Math.min(acc * 2, p.left) * Math.min(Math.max((p.eff - 0.55) / 0.3, 0), 1);
    if (dv > 0) st = thrust(st, p.dir, dv, 1, w.a);
    given += dv;
    st = advanceTo(st, st.t + 2, w)!;
  }
  const o = kerrOrbit(st, w);
  expect((o.inc * 180) / Math.PI).toBeCloseTo(10, 1);
  expect(Math.abs(o.rp - 30)).toBeLessThan(0.3);
  expect(Math.abs(o.ra - 30)).toBeLessThan(0.3);
  expect(given).toBeLessThan(1.3 * 0.0329);
});

test("Hohmann to a radius between the apsides: the periapsis raised at the apoapsis, then the circle", () => {
  const st = applyDv(circular(30), [0.012, 0, 0], w.a);
  const o0 = kerrOrbit(st, w);
  const r2 = (o0.rp + o0.ra) / 2 - 2;
  const H = kHohmann(st, w, r2);
  expect(H.ok).toBe(true);
  expect(H.nodes[0]!.dv[0]).toBeGreaterThan(0);
  const o = after(st, H);
  expect(Math.abs(o.rp - r2) / r2).toBeLessThan(5e-3);
  expect(Math.abs(o.ra - r2) / r2).toBeLessThan(5e-3);
});
