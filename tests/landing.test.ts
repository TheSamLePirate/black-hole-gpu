import { expect, test } from "bun:test";
import { advance, fromZamo, toZamo, type Lens } from "../src/geodesic";
import { planetFrame, stepLocal, toGlobal, toLocal, weightUp, zamoBeta, betaToCoord, GEAR, groundR } from "../src/landing";
import type { Vec3 } from "../src/physics";
import { GARGANTUA_SYSTEM as SYS, body } from "../src/system/bodies";
import { bodyTrack } from "../src/system/ephemeris";
import { sphericalFrame } from "../src/wormhole";

// Phase 6: the planet's own frame (landing.ts) against the global Kerr integrator, and on the ground.

const a = SYS.spin;
const cart = (s: { r: number; th: number; ph: number }): Vec3 => [
  s.r * Math.sin(s.th) * Math.cos(s.ph), s.r * Math.sin(s.th) * Math.sin(s.ph), s.r * Math.cos(s.th),
];
const lenses: Lens[] = SYS.bodies
  .filter((b) => b.universe === "gargantua" && b.kind !== "hole" && b.mass > 0)
  .map((b) => ({ m: b.mass, R: b.radius, centre: bodyTrack(SYS, b.id).pos, velocity: bodyTrack(SYS, b.id).vel }));
const shipAt = (X: Vec3, V: Vec3, t: number) => {
  const f = sphericalFrame(X);
  return fromZamo(f.r, f.th, f.ph, zamoBeta(X, V, a), a, t);
};

test("local frame ↔ map: round trip", () => {
  const F = planetFrame("miller", 5000, a, 1e8);
  const X: Vec3 = [F.C[0] + 1e-4, F.C[1] - 2e-4, 3e-5];
  const V: Vec3 = [F.V[0] + 1e-5, F.V[1] - 3e-6, 2e-6];
  const L = toLocal(F, X, V);
  const g = toGlobal(F, L);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(g.X[i]! - X[i]!)).toBeLessThan(1e-12);
    expect(Math.abs(g.V[i]! - V[i]!)).toBeLessThan(1e-12);
  }
  const b = zamoBeta(X, V, a);
  const V2 = betaToCoord(X, b, a);
  for (let i = 0; i < 3; i++) expect(Math.abs(V2[i]! - V[i]!)).toBeLessThan(1e-14);
});

test("near Miller, the local frame's relative motion follows the global Kerr integration", () => {
  // (Miller's own pull left out of both: the global integrator adds it as a weak-field lens on the
  // map, anisotropic by the metric's scale factors near the hole; the local frame's proper-length
  // Newtonian pull is the exact one — what the two must share is the motion in Gargantua's field)
  const t0 = 5000;
  const F0 = { ...planetFrame("miller", t0, a, 1e8), m: 0 };
  const L = { xi: [2e-4, -3e-4, 1e-4] as Vec3, w: [1e-5, 2e-5, -5e-6] as Vec3, landed: false };
  const g0 = toGlobal(F0, L);
  let st = shipAt(g0.X, g0.V, t0);
  for (let k = 0; k < 30; k++) {
    const Fk = { ...planetFrame("miller", st.t, a, 1e8), m: 0 };
    stepLocal(Fk, L, 1 / Fk.ut, [0, 0, 0]);
    st = advance(st, a, 1, 0.05).st;
    const F1 = planetFrame("miller", st.t, a, 1e8);
    const G = toLocal(F1, cart(st), betaToCoord(cart(st), toZamo(st, a) as Vec3, a));
    const err = Math.hypot(G.xi[0] - L.xi[0], G.xi[1] - L.xi[1], G.xi[2] - L.xi[2]);
    expect(err / Math.hypot(...L.xi)).toBeLessThan(0.01);
  }
}, 60000);

test("an orbit at 1.6 Miller radii in the local frame stays bound for several turns", () => {
  const M = body(SYS, "miller");
  const F = planetFrame("miller", 5000, a, 1e8);
  const d0 = 1.6 * M.radius;
  // (the frame turns with the orbit, n per coordinate time: n uᵗ per proper time — a circular orbit
  // around the planet moves at v_c − Ω d in it)
  const L = { xi: [d0, 0, 0] as Vec3, w: [0, Math.sqrt(M.mass / d0) - F.n * F.ut * d0, 0] as Vec3, landed: false };
  let dMin = Infinity, dMax = 0;
  for (let k = 0; k < 400; k++) {
    stepLocal(F, L, 0.3, [0, 0, 0]);
    const d = Math.hypot(...L.xi);
    dMin = Math.min(dMin, d);
    dMax = Math.max(dMax, d);
  }
  expect(L.landed).toBe(false);
  expect(dMin / d0).toBeGreaterThan(0.8);
  expect(dMax / d0).toBeLessThan(1.3);
});

test("on the ground: a fall lands, the weight holds it, enough thrust lifts it", () => {
  const F = planetFrame("mann", 5000, a, 1e8);
  const up: Vec3 = [0, 0, 1];
  const h0 = 2000 / F.mPerM; // 2 km
  // (2 km above the ground there: Mann's ice reaches 3 km)
  const g0r = groundR(F, [0, 0, 1]);
  const L = { xi: [0, 0, g0r + h0] as Vec3, w: [0, 0, 0] as Vec3, landed: false };
  let impact: number | null = null;
  // (1e-4 M of proper time per call: 0.05 s)
  for (let k = 0; k < 4000 && !L.landed; k++) impact = stepLocal(F, L, 1e-4, [0, 0, 0]).impact ?? impact;
  expect(L.landed).toBe(true);
  // (free fall from 2 km through the air: below √(2 g h) ≈ 198 m/s)
  expect(impact!).toBeGreaterThan(20);
  expect(impact!).toBeLessThan(200);
  expect((Math.hypot(...L.xi) - groundR(F, L.xi)) * F.mPerM).toBeCloseTo(GEAR, 3);
  // stays put under its weight, lifts off with 2 g up
  const g = weightUp(F, L.xi);
  expect(g * F.aUnit / 9.80665).toBeGreaterThan(0.9);
  stepLocal(F, L, 1e-3, [0, 0, 0.5 * g]);
  expect(L.landed).toBe(true);
  stepLocal(F, L, 1e-3, [0, 0, 2 * g]);
  expect(L.landed).toBe(false);
  expect(Math.hypot(...L.xi)).toBeGreaterThan(groundR(F, L.xi) + GEAR / F.mPerM);
  void up;
});

import { relief, SURF } from "../src/terrain";

test("relief: Mann's ice and Edmunds' rock within their bounds, Miller at sea level", () => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 400; i++) {
    const th = Math.acos(1 - 2 * ((i * 0.618) % 1)), ph = i * 2.39996;
    const q: Vec3 = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const h = relief(SURF.ice, q, 6.371e6);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    const r = relief(SURF.rock, q, 6.371e6);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1800);
    expect(relief(SURF.ocean, q, 6.371e6)).toBe(0);
  }
  // (the shader bounds its march at 4 200 m, Edmunds' at 1 800 m)
  expect(lo).toBeGreaterThanOrEqual(0);
  expect(hi).toBeLessThan(4200);
  expect(hi - lo).toBeGreaterThan(1000);
});
