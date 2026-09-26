import { expect, test } from "bun:test";
import { accelToG, engineThrust, gToAccel, rapidityCost, tank } from "../src/engine";
import { advance, fromZamo, toZamo } from "../src/geodesic";
import { drift, epicycle, rendezvousPush, type State6 } from "../src/lowthrust";
import { coordToZamo, zamo, zamoToCoord, type Vec3 } from "../src/physics";
import { GARGANTUA_SYSTEM as SYS } from "../src/system/bodies";
import { bodyTrack } from "../src/system/ephemeris";

// Phase 4: the two engines, the propellant, and the low-thrust rendezvous near a planet.

const a = SYS.spin;

test("engines: 1 g for a hole of 10⁸ M☉, Cinema = the thrust setting", () => {
  const s = { massSolar: 1e8, engine: "crew" as const, crewG: 1, thrust: 0.02 };
  // c²/r_g = 6.08 × 10⁵ m/s² → 1 g = 1.61 × 10⁻⁵ c²/M
  expect(gToAccel(1, s)).toBeCloseTo(1.6116e-5, 8);
  expect(accelToG(gToAccel(2.5, s), s)).toBeCloseTo(2.5, 12);
  expect(engineThrust(s)).toBeCloseTo(1.6116e-5, 8);
  expect(engineThrust({ ...s, engine: "cinema" })).toBe(0.02);
  // Cinema at 0.02 c²/M is ~1 240 g
  expect(accelToG(0.02, s)).toBeGreaterThan(1200);
});

test("relativistic rocket: budget vₑ ln R₀, mass left e^(−w/vₑ), cost of a plan in rapidity", () => {
  const s = { exhaust: 0.1, massRatio: 20 };
  const full = tank(s, 0);
  expect(full.budget).toBeCloseTo(0.1 * Math.log(20), 12);
  expect(full.fraction).toBeCloseTo(1, 12);
  // half the rapidity spent: m/m₀ = e^{−ln 20 / 2} = 1/√20
  const half = tank(s, full.budget / 2);
  expect(half.fraction).toBeCloseTo((1 / Math.sqrt(20) - 1 / 20) / (1 - 1 / 20), 12);
  expect(half.empty).toBe(false);
  expect(tank(s, full.budget + 0.01).empty).toBe(true);
  expect(tank(s, full.budget + 0.01).fraction).toBeCloseTo(0, 12);
  // rapidities add: two Δv of 0.1 c cost 2 atanh 0.1 (more than 0.2 in c)
  expect(rapidityCost([0.1, -0.1])).toBeCloseTo(2 * Math.atanh(0.1), 12);
});

const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const frameAt = (X: Vec3) => {
  const r = Math.hypot(...X), th = Math.acos(X[2] / r), ph = Math.atan2(X[1], X[0]);
  return {
    r, th, ph,
    er: [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)] as Vec3,
    et: [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), -Math.sin(th)] as Vec3,
    ep: [-Math.sin(ph), Math.cos(ph), 0] as Vec3,
  };
};
const cart = (s: { r: number; th: number; ph: number }): Vec3 => [
  s.r * Math.sin(s.th) * Math.cos(s.ph), s.r * Math.sin(s.th) * Math.sin(s.ph), s.r * Math.cos(s.th),
];
const miller = bodyTrack(SYS, "miller");

/** The ship's state relative to Miller in the curvilinear frame (x = ϖ − R, y = R Δφ, z). */
function relative(st: ReturnType<typeof fromZamo>, n: number): { s: State6; f: ReturnType<typeof frameAt>; eR: Vec3; eP: Vec3 } {
  const C = miller.pos(st.t);
  const R = Math.hypot(...C);
  const X = cart(st);
  const f = frameAt(X);
  const vl = zamoToCoord(toZamo(st, a) as Vec3, f.r, f.th, zamo(f.r, f.th, a));
  const V = [0, 1, 2].map((i) => vl[0] * f.er[i]! + vl[1] * f.et[i]! + vl[2] * f.ep[i]!) as Vec3;
  const rc = Math.hypot(X[0], X[1]);
  const eR: Vec3 = [X[0] / rc, X[1] / rc, 0], eP: Vec3 = [-X[1] / rc, X[0] / rc, 0];
  const d = Math.atan2(X[1], X[0]) - Math.atan2(C[1], C[0]);
  return { s: [rc - R, R * Math.atan2(Math.sin(d), Math.cos(d)), X[2], dot(V, eR), R * (dot(V, eP) / rc - n), V[2]], f, eR, eP };
}

/** A ship near Miller: offsets along its circle (dy), in radius (dx), height (dz), co-moving. */
function nearMiller(t: number, dx: number, dy: number, dz: number) {
  const P = miller.pos(t), V = miller.vel(t);
  const R = Math.hypot(...P);
  const ph = Math.atan2(P[1], P[0]) + dy / R;
  const X: Vec3 = [(R + dx) * Math.cos(ph), (R + dx) * Math.sin(ph), dz];
  const w = dy / R;
  const W: Vec3 = [V[0] * Math.cos(w) - V[1] * Math.sin(w), V[0] * Math.sin(w) + V[1] * Math.cos(w), 0];
  const f = frameAt(X);
  return fromZamo(f.r, f.th, f.ph, coordToZamo([dot(W, f.er), dot(W, f.et), dot(W, f.ep)], f.r, f.th, zamo(f.r, f.th, a)), a, t);
}

test("Kerr epicycles: the linear model follows the integrator near Miller (κ ≠ Ω at 10 M)", () => {
  const e = epicycle(10, a);
  // Kerr's radial epicycle is much slower than the orbit there (Newton: κ = Ω)
  expect(Math.sqrt(e.kappa2) / e.n).toBeCloseTo(0.789, 2);
  const st0 = nearMiller(15000, -0.01, -0.2, 0.005);
  const s0 = relative(st0, e.n).s;
  for (const T of [50, 200]) {
    const st = advance(st0, a, T, 0.05).st;
    const got = relative(st, e.n).s;
    const want = drift(e, s0, T);
    // (0.2 M along the circle: second-order terms ~ y²/R stay below 10⁻³ M)
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!)).toBeLessThan(1e-3);
  }
});

test("minimum-energy rendezvous at 1 g: from 0.5 M behind Miller to its side, at rest", () => {
  const e = epicycle(10, a);
  const acc = 1.6116e-5;
  const dtF = 4;
  let st = nearMiller(15000, 0.05, -0.5, 0);
  // the meeting point: 15 radii behind it on its circle (a resting point of the relative motion)
  const stand = 15 * 5.6089e-5;
  let tgo = 0;
  for (let tg = 0.5 / e.n; tg < 60 / e.n; tg *= 1.15) {
    const s = relative(st, e.n).s;
    const p = rendezvousPush(e, [s[0], s[1] + stand, s[2], s[3], s[4], s[5]], tg);
    tgo = tg;
    if (p && Math.hypot(...p) <= 0.5 * acc) break;
  }
  let spent = 0;
  for (; tgo > 3 * dtF; tgo -= dtF) {
    const r = relative(st, e.n);
    const p = rendezvousPush(e, [r.s[0], r.s[1] + stand, r.s[2], r.s[3], r.s[4], r.s[5]], tgo)!;
    const Aw = [0, 1, 2].map((i) => p[0] * r.eR[i]! + p[1] * r.eP[i]! + (i === 2 ? p[2] : 0)) as Vec3;
    let loc: Vec3 = [dot(Aw, r.f.er) * e.ut ** 2, dot(Aw, r.f.et) * e.ut ** 2, dot(Aw, r.f.ep) * e.ut ** 2];
    const L = Math.hypot(...loc);
    if (L > acc) loc = loc.map((x) => (x * acc) / L) as Vec3;
    const Lm = Math.hypot(...loc);
    const res = advance(st, a, dtF, 0.05, Lm, Lm > 0 ? (loc.map((x) => x / Lm) as Vec3) : [0, 0, 0]);
    spent += Lm * res.tau;
    st = res.st;
  }
  const end = relative(st, e.n).s;
  // within a third of the stand-off distance of the meeting point, nearly at rest, for little Δv
  expect(Math.hypot(end[0], end[1] + stand, end[2])).toBeLessThan(0.34 * stand);
  expect(Math.hypot(end[3], end[4], end[5])).toBeLessThan(1e-4);
  expect(spent).toBeLessThan(0.01);
}, 60000);
