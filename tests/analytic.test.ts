import { describe, expect, test } from "bun:test";
import { carlsonRF, ellipticF, ellipticK, equatorialCrossings, radialIntegral, radialRoots } from "../src/analytic";
import { adaptiveDOPRI, rhs, rk4, type State } from "../src/physics";

describe("elliptic integrals (Carlson)", () => {
  test("R_F, K and F against known values", () => {
    expect(carlsonRF(1, 2, 0)).toBeCloseTo(1.3110287771461, 12);
    expect(ellipticK(0)).toBeCloseTo(Math.PI / 2, 14);
    expect(ellipticK(0.5)).toBeCloseTo(1.8540746773013719, 13);
    expect(ellipticF(Math.PI / 2, 0.5)).toBeCloseTo(ellipticK(0.5), 13);
    // negative parameter (polar motion): K(−m) = K(m/(1+m))/√(1+m), K(3/4) = 2.1565156474996432
    expect(ellipticK(-3)).toBeCloseTo(2.1565156474996432 / 2, 12);
  });

  test("radial Mino integral matches quadrature", () => {
    const a = 0.9;
    const lam = -4;
    const eta = 25;
    const R = (r: number) => (r * r + a * a - a * lam) ** 2 - (r * r - 2 * r + a * a) * (eta + (lam - a) ** 2);
    const roots = radialRoots(a, lam, eta);
    const r4 = roots[3]!;
    let num = 0;
    const N = 200000;
    const S = Math.sqrt(30 - r4);
    for (let i = 0; i < N; i++) {
      const s = ((i + 0.5) * S) / N;
      num += ((2 * s) / Math.sqrt(R(r4 + s * s)) * S) / N;
    }
    expect(radialIntegral(30, r4, roots)).toBeCloseTo(num, 8);
  });
});

/** Equatorial crossing radii of a ray traced back from (ro, θo), by float64 Dormand–Prince. */
function integratedCrossings(a: number, ro: number, th: number, lam: number, eta: number, toward: boolean, count: number) {
  const R = (r: number) => (r * r + a * a - a * lam) ** 2 - (r * r - 2 * r + a * a) * (eta + (lam - a) ** 2);
  const del = ro * ro - 2 * ro + a * a;
  const Th = eta + a * a * Math.cos(th) ** 2 - (lam * lam) / Math.tan(th) ** 2;
  let st: State = { x: [ro, th, 0, 0], p: [Math.sqrt(R(ro)) / del, (toward === Math.cos(th) > 0 ? -1 : 1) * Math.sqrt(Th)] };
  let k1 = rhs(st.x, st.p, lam, a);
  let h = 0.01;
  const out: number[] = [];
  for (let i = 0; i < 2e6 && out.length < count; i++) {
    const o = adaptiveDOPRI(st, k1, lam, a, h, 0.05 * Math.max(1, st.x[0] - 1), 1e-12);
    if (Math.cos(st.x[1]) * Math.cos(o.state.x[1]) < 0) {
      let lo = 0;
      let hi = o.h;
      for (let k = 0; k < 60; k++) {
        const mid = 0.5 * (lo + hi);
        if (Math.cos(rk4(st, lam, a, -mid).x[1]) * Math.cos(st.x[1]) > 0) lo = mid;
        else hi = mid;
      }
      out.push(rk4(st, lam, a, -0.5 * (lo + hi)).x[0]);
    }
    st = o.state;
    k1 = o.k7;
    h = o.hNext;
    if (st.x[0] > 1e4) break;
  }
  return out;
}

describe("closed-form equatorial crossings (Gralla & Lupsasca 2020) vs the integrator", () => {
  const a = 0.9;
  const ro = 200;
  // Bardeen's critical curve: spherical photon orbit of radius rp
  const lamC = (r: number) => -(r ** 3 - 3 * r * r + a * a * r + a * a) / (a * (r - 1));
  const etaC = (r: number) => (r ** 3 * (4 * a * a - r * (r - 3) ** 2)) / (a * a * (r - 1) ** 2);
  const cases: [number, number, number, boolean][] = [
    [3, 25, 1.2, true],
    [2, 20, 1.0, false],
    [-4, 25, 1.4, true],
    [1.5, 26, 0.3, true],
    // just outside the critical curve: n = 1, 2 images hug the photon orbits
    [lamC(2.2), etaC(2.2) * 1.001, 1.2, true],
    [lamC(3.4), etaC(3.4) * 1.001, 1.2, true],
  ];
  for (const [lam, eta, th, toward] of cases) {
    test(`λ = ${lam.toFixed(4)}, η = ${eta}, θo = ${th}: n = 0, 1, 2 images agree to 1e-6 M`, () => {
      const an = equatorialCrossings({ a, ro, thetaO: th, lambda: lam, eta, towardEquator: toward }, 3);
      expect(an).not.toBeNull();
      const num = integratedCrossings(a, ro, th, lam, eta, toward, an!.length);
      expect(num.length).toBe(an!.length);
      an!.forEach((r, i) => expect(Math.abs(r - num[i]!) / r).toBeLessThan(1e-6));
    });
  }
});
