import { describe, expect, test } from "bun:test";
import { advance, fromZamo, hamiltonian, predict, thrust, toZamo, type Lens } from "../src/geodesic";
import { horizon, keplerOmega, zamo } from "../src/physics";
import { defaultSettings } from "../src/settings";
import { barycentre, barycentreVelocity, holeAcceleration, starCentre, starOmega, starVelocity } from "../src/targeting";

/** Prograde circular equatorial orbit: β relative to the ZAMO. */
function circular(r: number, a: number) {
  const z = zamo(r, Math.PI / 2, a);
  const v = (z.varpi * (keplerOmega(r, a) - z.omega)) / z.alpha;
  return fromZamo(r, Math.PI / 2, 0, [0, 0, v], a);
}

describe("camera geodesics (timelike Kerr)", () => {
  test("ZAMO velocity round trip and normalisation u·u = −1", () => {
    for (const a of [0, 0.9]) {
      const st = fromZamo(12, 1.1, 0.3, [0.2, -0.3, 0.4], a);
      expect(hamiltonian(st, a)).toBeCloseTo(-0.5, 10);
      const b = toZamo(st, a);
      expect(b[0]).toBeCloseTo(0.2, 10);
      expect(b[1]).toBeCloseTo(-0.3, 10);
      expect(b[2]).toBeCloseTo(0.4, 10);
    }
  });

  test("circular orbits stay circular with the Keplerian period (Schwarzschild and Kerr)", () => {
    for (const [a, r] of [[0, 10], [0.9, 8], [0.9, 30]] as const) {
      const st = circular(r, a);
      const period = (2 * Math.PI) / keplerOmega(r, a);
      const end = advance(st, a, period).st;
      expect(Math.abs(end.r - r)).toBeLessThan(1e-4 * r);
      // back to the start after one period of coordinate time
      const dph = ((end.ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      expect(Math.min(dph, 2 * Math.PI - dph)).toBeLessThan(1e-3);
      expect(hamiltonian(end, a)).toBeCloseTo(-0.5, 6);
    }
  });

  test("released at rest, the body falls and freezes just above the horizon", () => {
    const a = 0.9;
    const st = fromZamo(15, Math.PI / 2, 0, [0, 0, 0], a);
    const r = advance(st, a, 5000, 0.05);
    expect(r.stopped).toBe(true);
    expect(r.st.r).toBeLessThan(horizon(a) + 0.2);
    // falling from rest relative to the ZAMO: conserved E = α(15) < 1, L = 0
    expect(r.st.L).toBeCloseTo(0, 12);
    expect(r.st.E).toBeCloseTo(zamo(15, Math.PI / 2, a).alpha, 12);
  });

  test("radial free fall from rest at r0 (Schwarzschild): proper time τ = π/2 · √(r0³/2M) to r = 0", () => {
    // to the horizon: τ(r0 → 2M) from the cycloid, r = r0/2 (1 + cos η), τ = √(r0³/8M) (η + sin η)
    const r0 = 20;
    const eta = Math.acos(2 * 2 / r0 - 1);
    const tauExpected = Math.sqrt((r0 ** 3) / 8) * (eta + Math.sin(eta));
    const r = advance(fromZamo(r0, Math.PI / 2, 0, [0, 0, 0], 0), 0, 1e6, 0.001);
    expect(Math.abs(r.tau - tauExpected) / tauExpected).toBeLessThan(2e-3);
  });

  test("a hard enough thrust outwards escapes; the prediction reports the fate", () => {
    const a = 0.5;
    const st = fromZamo(10, Math.PI / 2, 0, [0, 0, 0], a);
    const up = advance(st, a, 200, 0.05, 0.2, [1, 0, 0]).st;
    expect(up.r).toBeGreaterThan(10);
    expect(predict(fromZamo(10, Math.PI / 2, 0, [0, 0, 0], a), a, 2000).fate).toBe("horizon");
    expect(predict(fromZamo(40, Math.PI / 2, 0, [0.9, 0, 0], a), a, 5000).fate).toBe("escape");
    expect(thrust(st, [1, 0, 0], 0, 1, a)).toBe(st);
  });

  // a star of mass 0.1 M, radius 2.5 M, on a circular orbit of radius 70 M
  const om = 1 / (70 ** 1.5 + 0.5);
  const lens: Lens = {
    m: 0.1, R: 2.5,
    centre: (t) => [70 * Math.cos(om * t), 70 * Math.sin(om * t), 0],
    velocity: (t) => [-70 * om * Math.sin(om * t), 70 * om * Math.cos(om * t), 0],
  };
  const cart = (st: { r: number; th: number; ph: number }): [number, number, number] =>
    [st.r * Math.sin(st.th) * Math.cos(st.ph), st.r * Math.sin(st.th) * Math.sin(st.ph), st.r * Math.cos(st.th)];

  test("a massive star pulls the camera with Newton's m/d² (weak field)", () => {
    const a = 0.5;
    // 10 M from the star, beside it (+y), released at rest w.r.t. the ZAMO
    const r = Math.hypot(70, 10);
    const st = fromZamo(r, Math.PI / 2, Math.atan2(10, 70), [0, 0, 0], a, 0);
    const T = 3;
    const free = advance(st, a, T, 0.05).st;
    const pulled = advance(st, a, T, 0.05, 0, [0, 0, 0], lens).st;
    const d = cart(pulled).map((v, i) => v - cart(free)[i]!);
    // ½ (m/d²) T² towards the star (−y), to ~5 % (the star moves 0.36 M meanwhile)
    expect(-d[1] / (0.5 * (0.1 / 100) * T * T)).toBeGreaterThan(0.93);
    expect(-d[1] / (0.5 * (0.1 / 100) * T * T)).toBeLessThan(1.07);
  });

  test("falling onto the star, the camera lands and then rides on its surface", () => {
    const a = 0.5;
    const r = Math.hypot(70, 5);
    const st = fromZamo(r, Math.PI / 2, Math.atan2(5, 70), [0, 0, 0], a, 0);
    const p = predict(st, a, 400, 200, lens);
    expect(p.fate).toBe("star");
    const res = advance(st, a, 400, 0.05, 0, [0, 0, 0], lens);
    expect(res.landed).toBe(true);
    // after 400 M the star has moved ~48 M along its orbit: the camera is still on its surface
    const c = lens.centre(res.st.t);
    const dist = Math.hypot(...cart(res.st).map((v, i) => v - c[i]!));
    expect(dist).toBeGreaterThan(2.49);
    expect(dist).toBeLessThan(2.6);
  });

  test("Gargantua and a massive star orbit their centre of mass (Newton: Ω² = (M + m)/D³)", () => {
    const s = { ...defaultSettings(), spin: 0, sun: true, sunOrbit: 70, sunRadius: 2.5, sunMass: 0.1, sunPhase: 30 };
    expect(starOmega(s)).toBeCloseTo(Math.sqrt(1.1 / 70 ** 3), 12);
    expect(starOmega({ ...s, sunMass: 0 })).toBeCloseTo(70 ** -1.5, 12);
    // hole at −B in the centre-of-mass frame: M(−B) + m(x★ − B) = 0
    const t = 1234;
    const B = barycentre(s, t);
    const x = starCentre(s, t);
    for (let i = 0; i < 3; i++) expect(-(1 + 0.1) * B[i]! + 0.1 * x[i]!).toBeCloseTo(0, 12);
    // the hole's acceleration −B̈ (finite differences) is the star's pull m x★/D³ (the frame's fall)
    const h = 1;
    const Bdd = [0, 1, 2].map((i) => (barycentre(s, t + h)[i]! - 2 * B[i]! + barycentre(s, t - h)[i]!) / (h * h));
    const aH = holeAcceleration(s, t);
    for (let i = 0; i < 3; i++) expect(-Bdd[i]!).toBeCloseTo(aH[i]!, 9);
    expect(barycentreVelocity(s, t)[1]).toBeCloseTo((0.1 / 1.1) * starVelocity(s, t)[1]!, 12);
  });

  test("with the indirect field, a far body at rest in the centre-of-mass frame stays at rest in it", () => {
    const s = { ...defaultSettings(), spin: 0, sun: true, sunOrbit: 70, sunRadius: 2.5, sunMass: 0.1, sunPhase: 0 };
    const D3 = 70 ** 3;
    const lensB: Lens = {
      m: 0.1, R: 2.5, centre: (t) => starCentre(s, t), velocity: (t) => starVelocity(s, t),
      accel: (t) => holeAcceleration(s, t),
      accelRate: (t) => starVelocity(s, t).map((v) => (0.1 / D3) * v) as [number, number, number],
    };
    // 3000 M away along −x (both bodies' own pulls are ~1e-7 there; the frame's fall is 3e-5)
    const X0: [number, number, number] = [-3000, 0, 0];
    const vB = barycentreVelocity(s, 0);
    // ZAMO components (r̂, θ̂, φ̂) at φ = π, θ = π/2: r̂ = −x̂, θ̂ = −ẑ, φ̂ = −ŷ
    const st = fromZamo(3000, Math.PI / 2, Math.PI, [-vB[0], -vB[2], -vB[1]], 0, 0);
    const T = 800;
    const end = advance(st, 0, T, 0.05, 0, [0, 0, 0], lensB).st;
    const expected = [0, 1, 2].map((i) => X0[i]! + barycentre(s, T)[i]! - barycentre(s, 0)[i]!);
    const got = cart(end);
    const drift = Math.hypot(...expected.map((v, i) => v - X0[i]!));
    expect(drift).toBeGreaterThan(5); // the hole moved by several M meanwhile
    expect(Math.hypot(...got.map((v, i) => v - expected[i]!))).toBeLessThan(0.03 * drift);
    // without the indirect field it would lag behind by ½ a T²
    const noInd = cart(advance(st, 0, T, 0.05, 0, [0, 0, 0], { ...lensB, accel: undefined, accelRate: undefined }).st);
    expect(Math.hypot(...noInd.map((v, i) => v - expected[i]!))).toBeGreaterThan(0.2 * drift);
  });
});
