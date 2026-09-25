import { describe, expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { defaultSettings } from "../src/settings";
import {
  W_OVER_M, dneg, ellOfR, flyDneg, holeToRep, mouth, radius, repToHole, repToSide, sideToRep, traceDneg,
} from "../src/wormhole";

const film = dneg({ whRho: 1, whLength: 0.01, whLensing: 0.05 }); // Interstellar: 2a = 0.01ρ, W = 0.05ρ
const long = dneg({ whRho: 1, whLength: 1, whLensing: 0.43 });
const det = (a: Vec3, b: Vec3, c: Vec3) =>
  a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));

/** A ray from our side at ℓ0 < 0 with impact parameter b w.r.t. the centre, aimed at the mouth. */
function rayFromHome(w: typeof film, l0: number, b: number) {
  const r0 = radius(w, l0)[0];
  const s = b / r0;
  // rep: towards the mouth is +ê_ℓ on our side
  return { n: [0, 0, 1] as Vec3, d: [s, 0, Math.sqrt(1 - s * s)] as Vec3 };
}

describe("Dneg wormhole metric (James et al. 2015)", () => {
  test("lensing width W = 1.42953 M (Eq. 7)", () => {
    expect(W_OVER_M).toBeCloseTo(1.42953, 5);
  });

  test("r(ℓ): throat radius ρ inside, smooth join at the mouth, asymptotically flat", () => {
    for (const w of [film, long]) {
      expect(radius(w, 0)[0]).toBe(w.rho);
      expect(radius(w, w.a + 1e-9)[0]).toBeCloseTo(w.rho, 8);
      expect(radius(w, w.a + 1e-9)[1]).toBeCloseTo(0, 6);
      expect(radius(w, 1e5)[1]).toBeCloseTo(1, 4);
      expect(radius(w, -1e5)[1]).toBeCloseTo(-1, 4);
      for (const r of [1.001, 1.5, 4, 30, 1000]) expect(radius(w, ellOfR(w, r))[0]).toBeCloseTo(r, 8);
    }
  });

  test("r(ℓ) matches the integral form (Eq. 5a)", () => {
    const w = long;
    const l = w.a + 2.3;
    let integral = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const xi = ((i + 0.5) / n) * (l - w.a);
      integral += Math.atan((2 * xi) / (Math.PI * w.M)) * ((l - w.a) / n);
    }
    expect(radius(w, l)[0]).toBeCloseTo(w.rho + (2 / Math.PI) * integral, 6);
  });
});

describe("Dneg rays", () => {
  test("null constraint p_ℓ² + b²/r² = 1 is conserved", () => {
    for (const w of [film, long]) {
      for (const b of [0, 0.3, 0.9, 0.999, 1.001, 2, 7]) {
        const { n, d } = rayFromHome(w, -20, b);
        const end = traceDneg(w, -20, n, d, 40, 40);
        expect(Math.abs(end.constraint)).toBeLessThan(1e-5);
      }
    }
  });

  test("b < ρ goes through the throat, b > ρ is turned back", () => {
    for (const w of [film, long]) {
      for (const b of [0, 0.5, 0.99]) expect(traceDneg(w, -20, rayFromHome(w, -20, b).n, rayFromHome(w, -20, b).d, 40, 40).side).toBe(1);
      for (const b of [1.01, 1.5, 3]) expect(traceDneg(w, -20, rayFromHome(w, -20, b).n, rayFromHome(w, -20, b).d, 40, 40).side).toBe(-1);
    }
  });

  test("rays are reversible (time symmetry)", () => {
    const w = long;
    for (const b of [0.2, 0.8, 0.97, 1.2]) {
      const { n, d } = rayFromHome(w, -15, b);
      const end = traceDneg(w, -15, n, d, 15, 15);
      const back = traceDneg(w, end.l, end.n, [-end.d[0], -end.d[1], -end.d[2]], 15, 15);
      expect(back.side).toBe(-1);
      // (the last step overshoots ℓ = −15 a little: compare directions in our side's flat frame)
      expect(angle(repToSide(-1, back.n, back.d), repToSide(-1, n, [-d[0], -d[1], -d[2]]))).toBeLessThan(1e-4);
    }
  });

  test("the step size is converged (final direction to 1e-5 rad, 1/70 of a 1080p pixel at 45°)", () => {
    for (const w of [film, long]) {
      // near-critical rays wind around the throat and amplify any error: looser bound for b = 0.999
      for (const [b, tol] of [[0.3, 1e-5], [0.95, 1e-5], [0.999, 1e-3], [1.05, 1e-5], [3, 1e-5], [10, 1e-5]]) {
        const { n, d } = rayFromHome(w, -30, b!);
        const a = traceDneg(w, -30, n, d, 1000, 1000);
        const c = traceDneg(w, -30, n, d, 1000, 1000, { stepScale: 0.02, maxSteps: 1e8 });
        // directions compared in the flat frame of the exit side (rep directions rotate with n̂)
        expect(angle(repToSide(a.side, a.n, a.d), repToSide(c.side, c.n, c.d))).toBeLessThan(tol!);
      }
    }
  });

  test("lensing: deflection of passing rays grows with the lensing width and falls with b", () => {
    const deflection = (w: typeof film, b: number) => {
      const { n, d } = rayFromHome(w, -2000, b);
      const end = traceDneg(w, -2000, n, d, 4000, 4000);
      // incoming direction in the side's Cartesian frame vs outgoing
      return angle(repToSide(-1, n, d), repToSide(-1, end.n, end.d));
    };
    const strong = dneg({ whRho: 1, whLength: 1, whLensing: 0.43 });
    expect(deflection(strong, 1.5)).toBeGreaterThan(deflection(film, 1.5));
    expect(deflection(strong, 1.5)).toBeGreaterThan(deflection(strong, 4));
    expect(deflection(film, 10)).toBeLessThan(0.01);
  });

  test("flight: moving along a straight line far from the mouth is Euclidean", () => {
    const w = film;
    // start at ℓ = −500 (flat), fly 10 units sideways
    const n0: Vec3 = [0, 0, 1];
    const f: Vec3 = [0, 1, 0];
    const u: Vec3 = [1, 0, 0];
    const p = flyDneg(w, -500, n0, f, u, 10);
    const r0 = radius(w, -500)[0];
    const r1 = radius(w, p.l)[0];
    expect(r1).toBeCloseTo(Math.hypot(r0, 10), 2);
    expect(angle(p.up, u)).toBeLessThan(1e-6); // normal to the plane of motion: unchanged
  });
});

describe("gluing frames", () => {
  test("our side's embedding is orientation-preserving and invertible", () => {
    const n: Vec3 = [0.3, -0.5, 0.812];
    const nn = Math.hypot(...n);
    const nu = n.map((x) => x / nn) as Vec3;
    const e: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const m = e.map((v) => repToSide(-1, nu, v));
    expect(det(m[0]!, m[1]!, m[2]!)).toBeCloseTo(1, 10);
    for (const v of [[0.2, 0.7, -0.1], [1, 0, 0]] as Vec3[]) {
      const back = sideToRep(-1, nu, repToSide(-1, nu, v));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(v[i]!, 12);
    }
  });

  test("the mouth frame points at the hole; rep ↔ black-hole frame round trip", () => {
    const s = { ...defaultSettings(), whDist: 80, whIncl: 84, whAzimuth: -160, whRho: 2 };
    const m = mouth(s);
    expect(Math.hypot(...m.C)).toBeCloseTo(80, 10);
    const toHole = m.C.map((x) => -x / 80) as Vec3;
    expect(angle(m.ex, toHole)).toBeLessThan(1e-9);
    expect(det(m.ex, m.ey, m.ez)).toBeCloseTo(1, 10);
    const X = repToHole(m, 7.5, [0.6, 0.0, 0.8]);
    const back = holeToRep(m, X);
    expect(back.l).toBeCloseTo(7.5, 8);
    expect(back.n[0]).toBeCloseTo(0.6, 8);
    expect(m.rGlue).toBeGreaterThan(8 * 2 - 1e-9);
    expect(radius(m.w, m.lGlue)[0]).toBeCloseTo(m.rGlue, 6);
  });
});
