import { expect, test } from "bun:test";
import { advance, fromZamo, predict, type Lens } from "../src/geodesic";
import { coordToZamo, zamo, zamoToCoord, type Vec3 } from "../src/physics";
import { GARGANTUA_SYSTEM as SYS, body } from "../src/system/bodies";
import { bodyState, bodyTrack } from "../src/system/ephemeris";

// Long-distance flight in the Gargantua system (phase 3): the velocity conversions, the bodies' fast
// tracks, and the ship's integrator near a planet (co-motion, a bound orbit, the far planets' cost).

const a = SYS.spin;
const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const basis = (X: Vec3) => {
  const r = Math.hypot(...X), th = Math.acos(X[2] / r), ph = Math.atan2(X[1], X[0]);
  return {
    r, th, ph,
    er: [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)] as Vec3,
    et: [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), -Math.sin(th)] as Vec3,
    ep: [-Math.sin(ph), Math.cos(ph), 0] as Vec3,
  };
};
/** A ship at X moving at the coordinate velocity W (flat map), as an integrator state at time t. */
const shipAt = (X: Vec3, W: Vec3, t: number) => {
  const f = basis(X);
  const beta = coordToZamo([dot(W, f.er), dot(W, f.et), dot(W, f.ep)], f.r, f.th, zamo(f.r, f.th, a));
  return fromZamo(f.r, f.th, f.ph, beta, a, t);
};
const cart = (s: { r: number; th: number; ph: number }): Vec3 => [
  s.r * Math.sin(s.th) * Math.cos(s.ph), s.r * Math.sin(s.th) * Math.sin(s.ph), s.r * Math.cos(s.th),
];
const lenses: Lens[] = SYS.bodies
  .filter((b) => b.universe === "gargantua" && b.kind !== "hole" && b.mass > 0)
  .map((b) => ({ m: b.mass, R: b.radius, centre: bodyTrack(SYS, b.id).pos, velocity: bodyTrack(SYS, b.id).vel }));

test("coordinate ↔ ZAMO velocity: round trip, and a body at rest on the map drifts at −ωϖ/α", () => {
  for (const [r, th] of [[10, Math.PI / 2], [4, 1.1], [60, 0.4]] as const) {
    const z = zamo(r, th, a);
    const v: Vec3 = [0.01, -0.02, 0.3];
    const back = zamoToCoord(coordToZamo(v, r, th, z), r, th, z);
    for (let i = 0; i < 3; i++) expect(Math.abs(back[i]! - v[i]!)).toBeLessThan(1e-14);
    const rest = coordToZamo([0, 0, 0], r, th, z);
    expect(Math.abs(rest[2] + (z.omega * z.varpi) / z.alpha)).toBeLessThan(1e-15);
  }
});

test("body tracks agree with the ephemeris", () => {
  for (const b of SYS.bodies.filter((q) => q.id !== "gargantua")) {
    const tr = bodyTrack(SYS, b.id);
    for (const t of [0, 1234.5, 3e6]) {
      const e = bodyState(SYS, b.id, t);
      expect(Math.hypot(...tr.pos(t).map((x, i) => x - e.pos[i]!))).toBeLessThan(1e-9 * (1 + Math.hypot(...e.pos)));
      expect(Math.hypot(...tr.vel(t).map((x, i) => x - e.vel[i]!))).toBeLessThan(1e-12);
    }
  }
});

test("a ship at Miller's place with Miller's velocity stays with it (exact conversion)", () => {
  const tr = bodyTrack(SYS, "miller");
  const t = 3000;
  const st = shipAt(tr.pos(t), tr.vel(t), t);
  const res = advance(st, a, 20, 0.05, 0, [0, 0, 0]);
  const C = tr.pos(res.st.t);
  expect(Math.hypot(...cart(res.st).map((x, i) => x - C[i]!))).toBeLessThan(1e-8);
});

test("an orbit around Miller stays bound for several turns, cheaply (the planet's pull in Kerr)", () => {
  const M = body(SYS, "miller");
  const tr = bodyTrack(SYS, "miller");
  const t = 3000;
  const P = tr.pos(t), V = tr.vel(t);
  const d0 = 1.6 * M.radius;
  const r = Math.hypot(...P);
  const er = P.map((x) => x / r) as Vec3;
  // polar orbit (radial ↔ z), started radially outwards at the circular speed in the scene's time:
  // √(m/d) over uᵗ and √g_rr (the radial direction's length)
  const ut = 1 / bodyState(SYS, "miller", t).dtau;
  const vc = Math.sqrt(M.mass / d0) / (ut * Math.sqrt((r * r) / (r * r - 2 * r + a * a)));
  let st = shipAt([P[0], P[1], d0], [V[0] + vc * er[0], V[1] + vc * er[1], V[2]], t);
  let dMin = Infinity, dMax = 0;
  const t0 = performance.now();
  for (let k = 0; k < 900; k++) {
    const res = advance(st, a, 4 / 30, 0.05, 0, [0, 0, 0], lenses);
    expect(res.landed).toBe(false);
    st = res.st;
    const C = tr.pos(st.t);
    const d = Math.hypot(...cart(st).map((x, i) => x - C[i]!));
    dMin = Math.min(dMin, d);
    dMax = Math.max(dMax, d);
  }
  const ms = (performance.now() - t0) / 900;
  // 120 M ≈ 6 turns; the hole's tides at 1/3 of the Hill radius stretch it, they do not unbind it
  expect(dMin / d0).toBeGreaterThan(0.7);
  expect(dMax / d0).toBeLessThan(1.6);
  expect(ms).toBeLessThan(5);
}, 30000);

test("far planets cost nothing: a prediction at 60 M is the same with and without the system's lenses", () => {
  const st = fromZamo(60, Math.PI / 2, 0.3, [0, 0, 0.1277], a, 500);
  const plain = predict(st, a, 1000, 200, undefined, 1e-7);
  const t0 = performance.now();
  const lensed = predict(st, a, 1000, 200, lenses, 1e-7);
  const ms = performance.now() - t0;
  const last = (p: typeof plain) => p.pts.at(-1)!;
  expect(Math.hypot(...last(plain).map((x, i) => x - last(lensed)[i]!))).toBeLessThan(1e-4);
  expect(ms).toBeLessThan(250);
});
