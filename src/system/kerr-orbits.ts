// Circular equatorial orbits of Kerr and what they mean for a body on them: the port of the audit
// script of the Gargantua system study (../interstellar-system/calculations.py), in float64.
//
// Units G = c = M = 1 (M: the hole's mass); x = r/M, a = a* (dimensionless spin). The SI constants
// turn them into metres and seconds for a hole of 10⁸ M☉. Formulas: Bardeen, Press & Teukolsky 1972
// (Ω, uᵗ, E, ℓ, epicyclic frequencies), Wiggins & Lai 2000 (largest eigenvalue of the tidal tensor).

// ---- constants (IAU 2015 B3 nominal values, as in the study)
export const SI = {
  G: 6.6743e-11,
  c: 299792458,
  muSun: 1.3271244e20,
  muEarth: 3.986004e14,
  earthRadius: 6371000,
  au: 149597870700,
  year: 31557600,
  g0: 9.80665,
  sigma: 5.670374419e-8,
  lSun: 3.828e26,
  rSun: 6.957e8,
} as const;

/** A hole of `massSolar` solar masses: its length and time units. */
export function units(massSolar: number) {
  const mu = SI.muSun * massSolar;
  const rg = mu / SI.c ** 2; // metres per M
  const tg = mu / SI.c ** 3; // seconds per M
  return { mu, rg, tg, rgAu: rg / SI.au, accel: SI.c ** 2 / rg /* m/s² per c²/M */ };
}

export function horizon(a: number) {
  return 1 + Math.sqrt(1 - a * a);
}

/** Prograde ISCO (Bardeen, Press & Teukolsky). */
export function isco(a: number) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

/** Angular velocity dφ/dt of the prograde circular orbit at x. */
export const omega = (x: number, a: number) => 1 / (x ** 1.5 + a);

/**
 * The prograde circular equatorial geodesic at x: Ω, uᵗ = dt/dτ, E, ℓ, Carter-like K = (ℓ − aE)²,
 * radial and vertical epicyclic factors κ²/Ω², ν_θ²/Ω² (positive: locally stable), the speed a ZAMO
 * measures, periods (far and proper, in M), and the checks of the audit (normalisation of the
 * 4-velocity, R(r) = 0 and R'(r) = 0).
 */
export function circularOrbit(x: number, a: number) {
  const sx = Math.sqrt(x);
  const den = x ** 0.75 * Math.sqrt(x * sx - 3 * sx + 2 * a);
  const ut = (x * sx + a) / den;
  const E = (x * sx - 2 * sx + a) / den;
  const L = (x * x - 2 * a * sx + a * a) / den;
  const K = (L - a * E) ** 2;
  const Om = omega(x, a);
  const delta = x * x - 2 * x + a * a;
  const gtt = -(1 - 2 / x), gtp = -2 * a / x, gpp = x * x + a * a + 2 * a * a / x;
  const A = E * (x * x + a * a) - a * L;
  const B = x * x + (L - a * E) ** 2;
  return {
    x, Omega: Om, ut, E, L, K,
    radialFactor: 1 - 6 / x + (8 * a) / (x * sx) - (3 * a * a) / (x * x),
    verticalFactor: 1 - (4 * a) / (x * sx) + (3 * a * a) / (x * x),
    vZamo: (x * x - 2 * a * sx + a * a) / ((x * sx + a) * Math.sqrt(delta)),
    period: 2 * Math.PI * (x * sx + a),
    properPeriod: (2 * Math.PI * (x * sx + a)) / ut,
    newtonPeriod: 2 * Math.PI * x * sx,
    checks: {
      normalisation: Math.abs((gtt + 2 * gtp * Om + gpp * Om * Om) * ut * ut + 1),
      potential: Math.abs(A * A - delta * B) / x ** 4,
      derivative: Math.abs(4 * E * x * A - (2 * x - 2) * B - 2 * x * delta) / x ** 3,
    },
  };
}

/**
 * Tidal stretching on a body of radius R [m] on that orbit (centre to surface), Kerr and Newton [m/s²],
 * and against its own surface gravity mu/R² (mu: its GM [m³/s²]).
 */
export function tides(x: number, a: number, massSolar: number, R: number, mu: number) {
  const u = units(massSolar);
  const o = circularOrbit(x, a);
  const base = u.mu / (x * u.rg) ** 3;
  const kerr = (2 + (3 * o.K) / (x * x)) * base * R;
  return { newton: 2 * base * R, kerr, overSelfG: kerr / (mu / (R * R)) };
}

/** Hill radius of a body of GM mu orbiting at distance A of a primary of GM muP (same units as A). */
export const hillRadius = (A: number, mu: number, muP: number) => A * Math.cbrt(mu / (3 * muP));

/** Newtonian Roche limit of a fluid satellite of radius R and GM mu around a primary of GM muP. */
export const rocheLimit = (R: number, mu: number, muP: number) => 2.44 * R * Math.cbrt(muP / mu);

/** Ratio of the primary's tide to the host's pull on a planet at a from its host (A: host from the primary). */
export const tideRatio = (muP: number, muHost: number, a: number, A: number) => 2 * (muP / muHost) * (a / A) ** 3;

/**
 * The stretching a static observer feels crossing a Dneg throat (ρ, lensing width W = w ρ) over a
 * length ℓ [m]: c² ℓ r''/r at the throat, r''_max = 4/(π² M_w), M_w = W/1.42953. ρ in metres.
 */
export function throatTide(rhoM: number, wOverRho: number, length: number) {
  const k = Math.PI / (2 * Math.SQRT2);
  const wOverM = k * Math.tan(k) + Math.log(Math.cos(k));
  const Mw = (wOverRho * rhoM) / wOverM;
  return (SI.c ** 2 * length * 4) / (Math.PI ** 2 * Mw * rhoM);
}

/**
 * The hierarchical test of the study (§6): a planet around its star, the star on a prescribed
 * circular orbit around the hole (Newton, exact differential field), star-centred non-rotating
 * frame, velocity Verlet. Units AU, years; masses in solar masses. Returns the extremes of the
 * distance and osculating eccentricity, and the drift of the Jacobi constant over the local binding
 * scale GM★/a.
 */
export function integrateHierarchy(o: {
  mStar: number; mHole: number; A: number; a: number; step: number; years: number;
}) {
  const muSun = (SI.muSun * SI.year ** 2) / SI.au ** 3; // AU³/yr² (≈ 4π²)
  const mus = muSun * o.mStar;
  const mub = muSun * o.mHole;
  const A = o.A;
  const n = Math.sqrt(mub / A ** 3);
  let qx = o.a, qy = 0, vx = 0, vy = Math.sqrt(mus / o.a);
  // the star's place on its circle, advanced by an exact rotation each step (no cos/sin per step)
  const h = o.step;
  const cr = Math.cos(n * h), sr = Math.sin(n * h);
  let cb = 1, sb = 0; // cos, sin of n t
  const A3 = A ** 3;
  const acc = (cb: number, sb: number, x: number, y: number): [number, number] => {
    const bx = A * cb, by = A * sb;
    const ds2 = x * x + y * y, dx = bx + x, dy = by + y, db2 = dx * dx + dy * dy;
    const ks = mus / (ds2 * Math.sqrt(ds2)), kb = mub / (db2 * Math.sqrt(db2));
    return [-ks * x - mub * (dx * (kb / mub) - bx / A3), -ks * y - mub * (dy * (kb / mub) - by / A3)];
  };
  const jacobi = (cb: number, sb: number, x: number, y: number, vx: number, vy: number) => {
    const rb = Math.hypot(A * cb + x, A * sb + y);
    return 2 * (mub / rb + mus / Math.hypot(x, y)) + n * n * rb * rb - ((vx + n * y) ** 2 + (vy - n * x) ** 2);
  };
  let [ax, ay] = acc(cb, sb, qx, qy);
  const j0 = jacobi(cb, sb, qx, qy, vx, vy);
  let rMin = o.a, rMax = o.a, eMax = 0, jDrift = 0;
  const steps = Math.round(o.years / o.step);
  for (let i = 0; i < steps; i++) {
    qx += vx * h + 0.5 * ax * h * h;
    qy += vy * h + 0.5 * ay * h * h;
    const c2 = cb * cr - sb * sr;
    sb = sb * cr + cb * sr;
    cb = c2;
    if ((i & 1023) === 0) {
      // (keep the rotation exact: re-anchor on the true angle now and then)
      const t = (i + 1) * h;
      cb = Math.cos(n * t);
      sb = Math.sin(n * t);
    }
    const [nx, ny] = acc(cb, sb, qx, qy);
    vx += 0.5 * (ax + nx) * h;
    vy += 0.5 * (ay + ny) * h;
    ax = nx;
    ay = ny;
    if (i % 20 === 0) {
      const r = Math.hypot(qx, qy);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
      const rv = qx * vx + qy * vy, v2 = vx * vx + vy * vy;
      const ex = ((v2 - mus / r) * qx - rv * vx) / mus, ey = ((v2 - mus / r) * qy - rv * vy) / mus;
      eMax = Math.max(eMax, Math.hypot(ex, ey));
      jDrift = Math.max(jDrift, Math.abs(jacobi(cb, sb, qx, qy, vx, vy) - j0) / (mus / o.a));
    }
  }
  return { rMin, rMax, eMax, jDrift, steps };
}
