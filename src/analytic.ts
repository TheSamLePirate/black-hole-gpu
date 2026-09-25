/**
 * Semi-analytic Kerr null geodesics (float64), used to validate the ray tracer.
 *
 * In Mino time τ (dτ = dλ/Σ) the radial and polar motions decouple (Carter 1968):
 *   (dr/dτ)² = R(r) = (r² + a² − aλ)² − Δ(r)(η + (λ − a)²)
 *   (dx/dτ)² = a² (u₊ − x²)(x² − u₋),   x = cos θ,   u± = Δθ ± √(Δθ² + η/a²),  Δθ = ½(1 − (η + λ²)/a²)
 * (λ = L/E, η = Q/E²). The polar motion is an elliptic oscillation, so the Mino time of the n-th
 * crossing of the equator is closed-form (Gralla & Lupsasca 2020):
 *   G_θ = [2nK(m) + F_o] / (a√−u₋)  (moving towards the equator), m = u₊/u₋, F_o = F(arcsin(x_o/√u₊) | m)
 * and the radius reached at that Mino time follows from the radial integral, an elliptic integral of
 * the first kind written in Carlson's symmetric form (Carlson 1988) and inverted by bisection.
 * Valid for rays with four real radial roots whose largest root r₄ lies outside the horizon (rays
 * that turn around and escape: the lensed images outside the critical curve).
 */

/** Carlson's symmetric elliptic integral R_F(x, y, z) (duplication theorem, ~1e-15). */
export function carlsonRF(x: number, y: number, z: number): number {
  for (let i = 0; i < 100; i++) {
    const sx = Math.sqrt(x);
    const sy = Math.sqrt(y);
    const sz = Math.sqrt(z);
    const l = sx * (sy + sz) + sy * sz;
    x = 0.25 * (x + l);
    y = 0.25 * (y + l);
    z = 0.25 * (z + l);
    const mu = (x + y + z) / 3;
    const dx = 1 - x / mu;
    const dy = 1 - y / mu;
    const dz = 1 - z / mu;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < 1e-4) {
      const e2 = dx * dy - dz * dz;
      const e3 = dx * dy * dz;
      return (1 - e2 / 10 + e3 / 14 + (e2 * e2) / 24 - (3 * e2 * e3) / 44) / Math.sqrt(mu);
    }
  }
  throw new Error("carlsonRF did not converge");
}

/** Incomplete elliptic integral of the first kind F(φ | m), |φ| ≤ π/2, any m < 1/sin²φ. */
export function ellipticF(phi: number, m: number): number {
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  return s * carlsonRF(c * c, 1 - m * s * s, 1);
}

export function ellipticK(m: number): number {
  return carlsonRF(0, 1 - m, 1);
}

/** Real roots of the radial potential, ascending (NaN-free only when all four are real). */
export function radialRoots(a: number, lambda: number, eta: number): number[] {
  const A = a * a - a * lambda;
  const C = eta + (lambda - a) ** 2;
  // R(r) = r⁴ + (2A − C) r² + 2C r + (A² − a²C): depressed quartic, Durand–Kerner in complex numbers
  const coef = [1, 0, 2 * A - C, 2 * C, A * A - a * a * C];
  const n = 4;
  let zr = [0.4, -0.9, 0.7, 1.3].map((v, i) => v * (i + 1));
  let zi = [0.9, 0.3, -0.5, -0.8];
  const evalP = (xr: number, xi: number) => {
    let pr = 0;
    let pi = 0;
    for (const c of coef) {
      const nr = pr * xr - pi * xi + c;
      pi = pr * xi + pi * xr;
      pr = nr;
    }
    return [pr, pi] as const;
  };
  for (let it = 0; it < 500; it++) {
    const nr = zr.slice();
    const ni = zi.slice();
    let delta = 0;
    for (let i = 0; i < n; i++) {
      const [pr, pi] = evalP(zr[i]!, zi[i]!);
      let dr = 1;
      let di = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const ar = zr[i]! - zr[j]!;
        const ai = zi[i]! - zi[j]!;
        const tr = dr * ar - di * ai;
        di = dr * ai + di * ar;
        dr = tr;
      }
      const den = dr * dr + di * di;
      const qr = (pr * dr + pi * di) / den;
      const qi = (pi * dr - pr * di) / den;
      nr[i] = zr[i]! - qr;
      ni[i] = zi[i]! - qi;
      delta = Math.max(delta, Math.hypot(qr, qi));
    }
    zr = nr;
    zi = ni;
    if (delta < 1e-15) break;
  }
  const scale = Math.max(1, ...zr.map(Math.abs));
  return zr.map((r, i) => (Math.abs(zi[i]!) < 1e-7 * scale ? r : NaN)).sort((p, q) => p - q);
}

/** ∫_y^x dt/√(Π(t − rᵢ)) for x > y ≥ max rᵢ, four real roots (Carlson 1988: 2 R_F(U₁₂², U₁₃², U₁₄²)). */
export function radialIntegral(x: number, y: number, roots: number[]): number {
  const X = roots.map((r) => Math.sqrt(Math.max(x - r, 0)));
  const Y = roots.map((r) => Math.sqrt(Math.max(y - r, 0)));
  const U = (i: number, j: number, k: number, l: number) => (X[i]! * X[j]! * Y[k]! * Y[l]! + Y[i]! * Y[j]! * X[k]! * X[l]!) / (x - y);
  const u12 = U(0, 1, 2, 3);
  const u13 = U(0, 2, 1, 3);
  const u14 = U(0, 3, 1, 2);
  return 2 * carlsonRF(u12 * u12, u13 * u13, u14 * u14);
}

export interface CrossingRay {
  a: number;
  ro: number; // observer radius
  thetaO: number; // observer polar angle
  lambda: number;
  eta: number;
  towardEquator: boolean; // initial polar motion (traced backwards from the observer)
}

/**
 * Radii of the first `count` equatorial crossings of a ray traced back from the observer, or null
 * if the ray is not of the escaping four-real-root type (or crosses fewer times before escaping).
 */
export function equatorialCrossings(ray: CrossingRay, count: number): number[] | null {
  const { a, ro, thetaO, lambda, eta } = ray;
  if (eta <= 0) return null;
  const dTh = 0.5 * (1 - (eta + lambda * lambda) / (a * a));
  const up = dTh + Math.sqrt(dTh * dTh + eta / (a * a));
  const um = dTh - Math.sqrt(dTh * dTh + eta / (a * a));
  const m = up / um;
  const K = ellipticK(m);
  const xo = Math.cos(thetaO);
  const Fo = ellipticF(Math.asin(Math.max(-1, Math.min(1, Math.abs(xo) / Math.sqrt(up)))), m);
  const unit = 1 / (a * Math.sqrt(-um));
  const roots = radialRoots(a, lambda, eta);
  if (roots.some(Number.isNaN)) return null;
  const r4 = roots[3]!;
  const rH = 1 + Math.sqrt(1 - a * a);
  if (r4 <= rH || r4 >= ro) return null;
  const inward = radialIntegral(ro, r4, roots); // Mino time from the observer to the turning point
  const outToInf = radialIntegral(1e12, r4, roots); // Mino time from the turning point to infinity
  const out: number[] = [];
  for (let n = 0; n < count; n++) {
    const G = (ray.towardEquator ? Fo + 2 * n * K : 2 * K - Fo + 2 * n * K) * unit;
    // radius r ≥ r₄ with ∫_{r₄}^{r} dr/√R = target, on the ingoing (G ≤ inward) or outgoing leg
    const target = Math.abs(inward - G);
    if (G > inward && target >= outToInf) return out.length ? out : null;
    let lo = r4;
    let hi = r4 + 1;
    while (radialIntegral(hi, r4, roots) < target) hi = r4 + 2 * (hi - r4);
    for (let k = 0; k < 200; k++) {
      const mid = 0.5 * (lo + hi);
      if (mid === lo || mid === hi) break;
      if (radialIntegral(mid, r4, roots) < target) lo = mid;
      else hi = mid;
    }
    out.push(0.5 * (lo + hi));
  }
  return out;
}
