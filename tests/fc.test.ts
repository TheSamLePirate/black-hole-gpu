import { test, expect } from "bun:test";
import { afterBurns, circularize, hohmann, matchPlanes, matchVelocities, relation, setApoapsis, setInclination, transfer, type FcContext } from "../src/fc/ops";
import { elements, lambert, len, propagate, type V3 } from "../src/fc/kepler";

const mu = 3.986004418e14, R = 6371e3, D = Math.PI / 180;
// a circular orbit at a height, an inclination, a phase along it
const circ = (h: number, inc: number, ph = 0): { r: V3; v: V3 } => {
  const r = R + h, v = Math.sqrt(mu / r);
  return { r: [r * Math.cos(ph), r * Math.sin(ph) * Math.cos(inc), r * Math.sin(ph) * Math.sin(inc)], v: [-v * Math.sin(ph), v * Math.cos(ph) * Math.cos(inc), v * Math.cos(ph) * Math.sin(inc)] };
};
const ctx = (s: { r: V3; v: V3 }, target?: { r: V3; v: V3 }): FcContext => ({ mu, R, ...s, pole: [0, 0, 1], target: target && { ...target, name: "target" } });

test("Kepler: propagation keeps the energy; Lambert's arc lands where asked", () => {
  const s = circ(400e3, 51.6 * D);
  const e0 = elements(mu, s.r, s.v);
  const p = propagate(mu, s.r, [s.v[0] * 1.1, s.v[1] * 1.1, s.v[2] * 1.1], 3000);
  const e1 = elements(mu, p.r, p.v), e2 = elements(mu, s.r, [s.v[0] * 1.1, s.v[1] * 1.1, s.v[2] * 1.1]);
  expect(e1.a / e2.a).toBeCloseTo(1, 9);
  expect(e0.e).toBeLessThan(1e-9);
  const t = propagate(mu, s.r, s.v, 2000);
  const L = lambert(mu, s.r, t.r, 2000, [0, 0, 1])!;
  expect(len([L.v1[0] - s.v[0], L.v1[1] - s.v[1], L.v1[2] - s.v[2]])).toBeLessThan(0.01);
});

test("circularize, the apoapsis, Hohmann's transfer: the orbits they make", () => {
  // 200 × 400 km
  const r = R + 200e3, ra = R + 400e3;
  const vp = Math.sqrt(mu * (2 / r - 2 / (r + ra)));
  const c = ctx({ r: [r, 0, 0], v: [0, vp, 0] });
  const ci = circularize(c, "ap");
  expect(ci.after!.e).toBeLessThan(1e-6);
  expect(ci.after!.rp / ra).toBeCloseTo(1, 6);
  const ap = setApoapsis(c, R + 1000e3, "pe");
  expect(ap.after!.ra / (R + 1000e3)).toBeCloseTo(1, 6);
  // Hohmann 400 → 1000 km: Δv as the formula
  const c2 = ctx(circ(400e3, 0));
  const h = hohmann(c2, R + 1000e3);
  const r1 = R + 400e3, r2 = R + 1000e3;
  const dv1 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1), dv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2)));
  expect(Math.abs(h.dvTotal - (dv1 + dv2))).toBeLessThan(0.5);
  expect(h.after!.e).toBeLessThan(1e-5);
  expect(h.after!.rp / r2).toBeCloseTo(1, 5);
});

test("the plane: an inclination, the target's", () => {
  const c = ctx(circ(400e3, 51.6 * D, 0.3));
  const r = setInclination(c, 30 * D);
  expect(r.ok).toBe(true);
  expect(r.after!.i / D).toBeCloseTo(30, 2);
  const tg = circ(420e3, 45 * D, 1);
  const m = matchPlanes(ctx(circ(400e3, 51.6 * D, 0.2), tg));
  const eT = elements(mu, tg.r, tg.v);
  const rel = Math.acos(Math.min(1, (m.after!.h[0] * eT.h[0] + m.after!.h[1] * eT.h[1] + m.after!.h[2] * eT.h[2]) / (len(m.after!.h) * len(eT.h))));
  expect(rel / D).toBeLessThan(0.01);
});

test("a rendezvous: the porkchop's best, the craft at the target with its velocity", () => {
  const s = circ(400e3, 0, 0), tg = circ(800e3, 0, 0.6);
  const c = ctx(s, tg);
  const r = transfer(c, { rendezvous: true });
  expect(r.ok).toBe(true);
  expect(r.grid!.dv.length).toBeGreaterThan(10);
  const a = afterBurns(c, r.burns);
  const T = propagate(mu, tg.r, tg.v, a.t);
  expect(len([a.r[0] - T.r[0], a.r[1] - T.r[1], a.r[2] - T.r[2]])).toBeLessThan(2000);
  expect(len([a.v[0] - T.v[0], a.v[1] - T.v[1], a.v[2] - T.v[2]])).toBeLessThan(2);
  // (Hohmann 400 → 800 km is ~220 m/s: the best a little more, the phase not perfect)
  expect(r.dvTotal).toBeLessThan(400);
  const rel = relation(c)!;
  expect(rel.synodic).toBeGreaterThan(3600);
  // the velocities matched at the closest approach
  const mv = matchVelocities(ctx(circ(400e3, 0, 0), circ(400e3, 0.01, 0.05)));
  expect(mv.ok).toBe(true);
});
