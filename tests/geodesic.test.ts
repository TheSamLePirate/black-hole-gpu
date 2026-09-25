import { describe, expect, test } from "bun:test";
import { advance, fromZamo, hamiltonian, predict, thrust, toZamo } from "../src/geodesic";
import { horizon, keplerOmega, zamo } from "../src/physics";

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
});
