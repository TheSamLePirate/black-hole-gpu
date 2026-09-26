// Kerr black hole physics, geometrized units G = c = M = 1.
// Everything here mirrors the WGSL tracer so it can be unit-tested on the CPU.

export type Vec3 = [number, number, number];

/** Outer event horizon r+ = 1 + sqrt(1 - a²). */
export function horizon(a: number): number {
  return 1 + Math.sqrt(Math.max(0, 1 - a * a));
}

/** Innermost stable circular orbit (Bardeen, Press & Teukolsky 1972). a < 0 = retrograde disk. */
export function isco(a: number): number {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sign(a) * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

/** Circular equatorial photon orbit radii (prograde, retrograde). */
export function photonOrbits(a: number): { pro: number; retro: number } {
  const aa = Math.abs(a);
  return {
    pro: 2 * (1 + Math.cos((2 / 3) * Math.acos(-aa))),
    retro: 2 * (1 + Math.cos((2 / 3) * Math.acos(aa))),
  };
}

/** Critical impact parameters of equatorial photon orbits: b = ∓a + 6 cos(acos(∓a)/3). */
export function criticalImpact(a: number): { pro: number; retro: number } {
  return {
    pro: -a + 6 * Math.cos(Math.acos(-a) / 3),
    retro: a + 6 * Math.cos(Math.acos(a) / 3),
  };
}

/** Keplerian angular velocity of prograde circular equatorial orbits. */
export function keplerOmega(r: number, a: number): number {
  return 1 / (Math.pow(r, 1.5) + a);
}

/**
 * Novikov–Thorne / Page–Thorne radiative flux of a thin disk, up to a constant
 * (3Ṁ/8πM²). Zero-torque inner boundary at the ISCO.
 */
export function ntFlux(r: number, a: number, rIn: number): number {
  if (r <= rIn) return 0;
  const x = Math.sqrt(r);
  const x0 = Math.sqrt(rIn);
  const ac = Math.acos(a);
  const x1 = 2 * Math.cos((ac - Math.PI) / 3);
  const x2 = 2 * Math.cos((ac + Math.PI) / 3);
  const x3 = -2 * Math.cos(ac / 3);
  const term = (xi: number, xj: number, xk: number) => {
    if (Math.abs(xi) < 1e-6) return 0; // a → 0 limit of the vanishing root
    return ((3 * (xi - a) * (xi - a)) / (xi * (xi - xj) * (xi - xk))) * Math.log((x - xi) / (x0 - xi));
  };
  const bracket =
    x - x0 - 1.5 * a * Math.log(x / x0) - term(x1, x2, x3) - term(x2, x1, x3) - term(x3, x1, x2);
  return bracket / (x * x * x * x * (x * x * x - 3 * x + 2 * a));
}

export function ntFluxMax(a: number, rIn: number): { fmax: number; rPeak: number } {
  let fmax = 0;
  let rPeak = rIn;
  for (let i = 1; i <= 4000; i++) {
    const r = rIn * (1 + (i / 4000) * 9);
    const f = ntFlux(r, a, rIn);
    if (f > fmax) {
      fmax = f;
      rPeak = r;
    }
  }
  return { fmax, rPeak };
}

/** Local frame of the zero-angular-momentum observer (ZAMO) in Boyer–Lindquist coordinates. */
export function zamo(r: number, th: number, a: number) {
  const s = Math.sin(th);
  const c = Math.cos(th);
  const sig = r * r + a * a * c * c;
  const del = r * r - 2 * r + a * a;
  const A = (r * r + a * a) ** 2 - a * a * del * s * s;
  return {
    alpha: Math.sqrt((sig * del) / A), // lapse
    omega: (2 * a * r) / A, // frame-dragging angular velocity
    varpi: Math.sqrt(A / sig) * s, // cylindrical radius
    sqrtSig: Math.sqrt(sig),
    sqrtSigOverDel: Math.sqrt(sig / del),
  };
}

/**
 * A coordinate velocity dx/dt of the flat map (Cartesian components on the spherical basis at (r, θ):
 * [ṙ, r θ̇, r sinθ φ̇]) as the ZAMO there measures it (its orthonormal frame r, θ, φ), and back:
 * the lapse, the metric's lengths and the frame dragging (a body at rest on the map moves at −ωϖ/α).
 */
export function coordToZamo(v: Vec3, r: number, th: number, z: ReturnType<typeof zamo>): Vec3 {
  const rs = r * Math.max(Math.sin(th), 1e-12);
  return [(z.sqrtSigOverDel * v[0]) / z.alpha, (z.sqrtSig * v[1]) / (r * z.alpha), (z.varpi * (v[2] / rs - z.omega)) / z.alpha];
}

export function zamoToCoord(b: Vec3, r: number, th: number, z: ReturnType<typeof zamo>): Vec3 {
  const rs = r * Math.max(Math.sin(th), 1e-12);
  return [(z.alpha * b[0]) / z.sqrtSigOverDel, (r * z.alpha * b[1]) / z.sqrtSig, rs * ((z.alpha * b[2]) / Math.max(z.varpi, 1e-12) + z.omega)];
}

// ---------------------------------------------------------------------------
// Null geodesics: Hamiltonian H = N / (2Σ) with E = 1,
// N = Δ p_r² + p_θ² − W²/Δ + (L − a sin²θ)²/sin²θ,  W = r² + a² − aL.
// State: x = (r, θ, φ, t), p = (p_r, p_θ); constants L, a.
// ---------------------------------------------------------------------------

export type State = { x: [number, number, number, number]; p: [number, number] };

export function rhs(x: State["x"], p: State["p"], L: number, a: number): State {
  const [r, th] = x;
  const [pr, pth] = p;
  const s = Math.max(Math.sin(th), 1e-6);
  const c = Math.cos(th);
  const s2 = s * s;
  const r2 = r * r;
  const a2 = a * a;
  const sig = r2 + a2 * c * c;
  const del = r2 - 2 * r + a2;
  const W = r2 + a2 - a * L;
  const ldel = L - a * s2;
  const isig = 1 / sig;
  const N = del * pr * pr + pth * pth - (W * W) / del + (ldel * ldel) / s2;
  const dNdr = (2 * r - 2) * pr * pr - (4 * r * W) / del + (W * W * (2 * r - 2)) / (del * del);
  const dNdth = (-2 * L * L * c) / (s2 * s) + 2 * a2 * s * c;
  const dSigdth = -2 * a2 * s * c;
  return {
    x: [
      del * pr * isig,
      pth * isig,
      ((a * W) / del + L / s2 - a) * isig,
      (((r2 + a2) * W) / del + a * ldel) * isig,
    ],
    p: [-0.5 * dNdr * isig + N * r * isig * isig, -0.5 * dNdth * isig + 0.5 * N * dSigdth * isig * isig],
  };
}

export function hamiltonian(st: State, L: number, a: number): number {
  const [r, th] = st.x;
  const [pr, pth] = st.p;
  const s2 = Math.sin(th) ** 2;
  const sig = r * r + a * a * Math.cos(th) ** 2;
  const del = r * r - 2 * r + a * a;
  const W = r * r + a * a - a * L;
  return (del * pr * pr + pth * pth - (W * W) / del + (L - a * s2) ** 2 / s2) / (2 * sig);
}

export function rk4(st: State, L: number, a: number, h: number): State {
  const add = (s: State, k: State, f: number): State => ({
    x: [s.x[0] + f * k.x[0], s.x[1] + f * k.x[1], s.x[2] + f * k.x[2], s.x[3] + f * k.x[3]],
    p: [s.p[0] + f * k.p[0], s.p[1] + f * k.p[1]],
  });
  const k1 = rhs(st.x, st.p, L, a);
  const k2 = rhs(add(st, k1, h / 2).x, add(st, k1, h / 2).p, L, a);
  const k3 = rhs(add(st, k2, h / 2).x, add(st, k2, h / 2).p, L, a);
  const s3 = add(st, k3, h);
  const k4 = rhs(s3.x, s3.p, L, a);
  const f = h / 6;
  return {
    x: [
      st.x[0] + f * (k1.x[0] + 2 * k2.x[0] + 2 * k3.x[0] + k4.x[0]),
      st.x[1] + f * (k1.x[1] + 2 * k2.x[1] + 2 * k3.x[1] + k4.x[1]),
      st.x[2] + f * (k1.x[2] + 2 * k2.x[2] + 2 * k3.x[2] + k4.x[2]),
      st.x[3] + f * (k1.x[3] + 2 * k2.x[3] + 2 * k3.x[3] + k4.x[3]),
    ],
    p: [
      st.p[0] + f * (k1.p[0] + 2 * k2.p[0] + 2 * k3.p[0] + k4.p[0]),
      st.p[1] + f * (k1.p[1] + 2 * k2.p[1] + 2 * k3.p[1] + k4.p[1]),
    ],
  };
}

/** Same adaptive step-size rule as the shader (affine parameter, positive). */
export function stepSize(st: State, L: number, a: number, eps: number, rH: number): number {
  const [r, th] = st.x;
  const s = Math.max(Math.sin(th), 1e-6);
  const sig = r * r + a * a * Math.cos(th) ** 2;
  let h = eps * (r - rH) * (1 + 0.01 * r);
  h = Math.min(h, (eps * sig * s * s) / (Math.abs(L) + 1e-3));
  h = Math.min(h, (eps * sig * Math.max(s, 0.02)) / (Math.abs(st.p[1]) + 1e-3));
  return Math.max(h, 1e-5);
}

export type TraceResult = { fate: "horizon" | "escape" | "maxsteps"; steps: number; state: State; maxDH: number };

/** Backward-traces a photon (negative affine step) like the GPU does. */
export function traceBackward(
  st0: State,
  L: number,
  a: number,
  opts: { eps: number; maxSteps: number; rEscape: number; captureTol: number },
): TraceResult {
  const rH = horizon(a);
  let st = st0;
  let maxDH = 0;
  for (let i = 0; i < opts.maxSteps; i++) {
    const h = stepSize(st, L, a, opts.eps, rH);
    const prevR = st.x[0];
    st = rk4(st, L, a, -h);
    if (st.x[1] < 0) st = { x: [st.x[0], -st.x[1], st.x[2] + Math.PI, st.x[3]], p: [st.p[0], -st.p[1]] };
    if (st.x[1] > Math.PI) st = { x: [st.x[0], 2 * Math.PI - st.x[1], st.x[2] + Math.PI, st.x[3]], p: [st.p[0], -st.p[1]] };
    maxDH = Math.max(maxDH, Math.abs(hamiltonian(st, L, a)));
    const r = st.x[0];
    if (r < rH + opts.captureTol || !Number.isFinite(r)) return { fate: "horizon", steps: i + 1, state: st, maxDH };
    if (r > opts.rEscape && r > prevR) return { fate: "escape", steps: i + 1, state: st, maxDH };
  }
  return { fate: "maxsteps", steps: opts.maxSteps, state: st, maxDH };
}

/** Horizon capture tolerance: safely below the innermost spherical photon orbit. */
export function captureTolerance(a: number): number {
  const rH = horizon(a);
  return Math.min(0.05, Math.max(2e-4, 0.4 * (photonOrbits(a).pro - rH)));
}

// ---------------------------------------------------------------------------
// Colorimetry: Planck spectrum → CIE 1931 XYZ → linear sRGB.
// ---------------------------------------------------------------------------

function lobe(l: number, mu: number, s1: number, s2: number): number {
  const t = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

/** Wyman, Sloan & Shirley (2013) multi-lobe fit of the CIE 1931 2° observer. λ in nm. */
export function cie1931(l: number): Vec3 {
  return [
    1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
  ];
}

const H_PLANCK = 6.62607015e-34;
const C_LIGHT = 2.99792458e8;
const K_BOLTZ = 1.380649e-23;

/** Spectral radiance B_λ(T) in W·sr⁻¹·m⁻³ (λ in nm). */
export function planck(lnm: number, T: number): number {
  const l = lnm * 1e-9;
  const x = (H_PLANCK * C_LIGHT) / (l * K_BOLTZ * T);
  if (x > 700) return 0;
  return (2 * H_PLANCK * C_LIGHT * C_LIGHT) / (l ** 5 * Math.expm1(x));
}

export function blackbodyXYZ(T: number): Vec3 {
  let X = 0, Y = 0, Z = 0;
  for (let l = 360; l <= 830; l += 1) {
    const b = planck(l, T);
    const [x, y, z] = cie1931(l);
    X += b * x;
    Y += b * y;
    Z += b * z;
  }
  return [X, Y, Z];
}

export function xyzToLinearSRGB([X, Y, Z]: Vec3): Vec3 {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
}

export const BB_LUT_SIZE = 1024;
export const BB_LOG_T_MIN = 2.0; // 100 K
export const BB_LOG_T_MAX = 9.0; // 1e9 K

/**
 * Blackbody lookup table indexed by log10(T): rgb = linear sRGB chromaticity with
 * luminance normalised to 1, a = log10(luminance Y) in absolute units.
 */
export function buildBlackbodyLUT(): Float32Array<ArrayBuffer> {
  const out = new Float32Array(BB_LUT_SIZE * 4);
  for (let i = 0; i < BB_LUT_SIZE; i++) {
    const lt = BB_LOG_T_MIN + ((BB_LOG_T_MAX - BB_LOG_T_MIN) * i) / (BB_LUT_SIZE - 1);
    const xyz = blackbodyXYZ(10 ** lt);
    const Y = Math.max(xyz[1], 1e-300);
    let rgb = xyzToLinearSRGB([xyz[0] / Y, 1, xyz[2] / Y]);
    // Out-of-gamut (very cool) blackbodies: clip negative lobes, keep luminance.
    rgb = rgb.map((v) => Math.max(v, 0)) as Vec3;
    const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    out.set([rgb[0] / lum, rgb[1] / lum, rgb[2] / lum, Math.log10(Y)], i * 4);
  }
  return out;
}

export function blackbodyLogY(T: number): number {
  return Math.log10(blackbodyXYZ(T)[1]);
}

// ---------------------------------------------------------------------------------------------
// Non-thermal spectra → colour. Spectra are given per unit frequency as functions of
// x = ν/ν₀ (ν₀ = c / 545 nm); CIE integration is over wavelength, I_λ ∝ I_ν ν², hence the x².
// Normalised so that a flat spectrum I_ν = 1 has luminance Y = 1.
// ---------------------------------------------------------------------------------------------
const LAMBDA0 = 545;
let flatY = 0;

export function spectrumRGB(f: (x: number) => number): Vec3 {
  if (!flatY) for (let l = 360; l <= 830; l++) flatY += (LAMBDA0 / l) ** 2 * cie1931(l)[1];
  let X = 0, Y = 0, Z = 0;
  for (let l = 360; l <= 830; l++) {
    const x = LAMBDA0 / l;
    const w = f(x) * x * x;
    const [cx, cy, cz] = cie1931(l);
    X += w * cx;
    Y += w * cy;
    Z += w * cz;
  }
  return xyzToLinearSRGB([X / flatY, Y / flatY, Z / flatY]).map((v) => Math.max(v, 0)) as Vec3;
}

/** Optically thin power law I_ν ∝ ν^−α. */
export function powerLawRGB(alpha: number): Vec3 {
  return spectrumRGB((x) => Math.pow(x, -alpha));
}

export const SYNC_LUT_SIZE = 512;
export const SYNC_LOG_MIN = -2;
export const SYNC_LOG_MAX = 3;

/** Synchrotron-like spectrum x^{1/3} e^{−x/s} (low-frequency slope + exponential cutoff), s = g ν_c. */
export function buildSynchrotronLUT(): Float32Array<ArrayBuffer> {
  const out = new Float32Array(SYNC_LUT_SIZE * 4);
  for (let i = 0; i < SYNC_LUT_SIZE; i++) {
    const s = 10 ** (SYNC_LOG_MIN + ((SYNC_LOG_MAX - SYNC_LOG_MIN) * i) / (SYNC_LUT_SIZE - 1));
    const rgb = spectrumRGB((x) => Math.cbrt(x) * Math.exp(-x / s));
    out.set([...rgb, 0], i * 4);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Error-controlled RK4 (CPU mirror of the shader's quality integrator): step doubling gives the
// local error (y_{h/2} − y_h)/15, Richardson extrapolation y_{h/2} + (y_{h/2} − y_h)/15 is O(h⁵).
// ---------------------------------------------------------------------------------------------
export function stepError(p: State, q: State): number {
  const ePos = Math.max(
    Math.abs(p.x[0] - q.x[0]) / Math.max(p.x[0], 1e-3),
    Math.abs(p.x[1] - q.x[1]),
    Math.abs(p.x[2] - q.x[2]) * Math.sin(p.x[1]),
  );
  const eMom = Math.max(
    Math.abs(p.p[0] - q.p[0]) / (Math.abs(p.p[0]) + 1),
    Math.abs(p.p[1] - q.p[1]) / (Math.abs(p.p[1]) + 1),
  );
  return Math.max(ePos, eMom);
}

export function adaptiveRK4(st: State, L: number, a: number, hTry: number, hMax: number, tol: number) {
  let h = Math.min(hTry, hMax);
  for (let k = 0; k < 8; k++) {
    const full = rk4(st, L, a, -h);
    const half = rk4(rk4(st, L, a, -h / 2), L, a, -h / 2);
    const err = stepError(half, full) / 15;
    if (err <= tol || k === 7 || h <= 1e-9) {
      const ex = (i: number) => half.x[i]! + (half.x[i]! - full.x[i]!) / 15;
      const state: State = {
        x: [ex(0), ex(1), ex(2), ex(3)],
        p: [half.p[0] + (half.p[0] - full.p[0]) / 15, half.p[1] + (half.p[1] - full.p[1]) / 15],
      };
      const grow = err > 0 ? Math.min(2, Math.max(0.3, 0.9 * (tol / err) ** 0.2)) : 2;
      return { state, h, hNext: h * grow };
    }
    h *= Math.min(0.9, Math.max(0.1, 0.9 * (tol / err) ** 0.25));
  }
  throw new Error("unreachable");
}

// Dormand–Prince 5(4) tableau (FSAL: the 7th stage is the derivative at the new point).
const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const DP_A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
// b (5th order) − b* (4th order embedded)
const DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];

/** One Dormand–Prince step of size h from st, given k1 = f(st). Returns y5, f(y5) and the error vector. */
export function dopriStep(st: State, k1: State, L: number, a: number, h: number) {
  const k: State[] = [k1];
  const comb = (row: number[]): State => {
    const x = [...st.x] as State["x"];
    const p = [...st.p] as State["p"];
    row.forEach((c, j) => {
      if (!c) return;
      for (let i = 0; i < 4; i++) x[i] += h * c * k[j]!.x[i]!;
      for (let i = 0; i < 2; i++) p[i] += h * c * k[j]!.p[i]!;
    });
    return { x, p };
  };
  for (let i = 1; i < 6; i++) {
    const y = comb(DP_A[i]!);
    k.push(rhs(y.x, y.p, L, a));
  }
  const y5 = comb(DP_A[6]!);
  k.push(rhs(y5.x, y5.p, L, a));
  const err: State = { x: [0, 0, 0, 0], p: [0, 0] };
  DP_E.forEach((e, j) => {
    for (let i = 0; i < 4; i++) err.x[i] += h * e * k[j]!.x[i]!;
    for (let i = 0; i < 2; i++) err.p[i] += h * e * k[j]!.p[i]!;
  });
  return { y: y5, k7: k[6]!, err };
}

/** Mixed relative norm of a local error vector (same scaling as stepError). */
export function errorNorm(st: State, e: State): number {
  return Math.max(
    Math.abs(e.x[0]) / Math.max(st.x[0], 1e-3),
    Math.abs(e.x[1]),
    Math.abs(e.x[2]) * Math.sin(st.x[1]),
    Math.abs(e.p[0]) / (Math.abs(st.p[0]) + 1),
    Math.abs(e.p[1]) / (Math.abs(st.p[1]) + 1),
  );
}

/** Error-controlled Dormand–Prince 5(4) step (backwards in affine parameter). */
export function adaptiveDOPRI(st: State, k1: State, L: number, a: number, hTry: number, hMax: number, tol: number) {
  let h = Math.min(hTry, hMax);
  let evals = 0;
  for (let k = 0; ; k++) {
    const o = dopriStep(st, k1, L, a, -h);
    evals += 6;
    const err = errorNorm(o.y, o.err);
    if (err <= tol || k === 11 || h <= 1e-9) {
      const grow = err > 0 ? Math.min(5, Math.max(0.2, 0.9 * (tol / err) ** 0.2)) : 5;
      return { state: o.y, k7: o.k7, h, hNext: h * grow, evals };
    }
    h *= Math.min(0.9, Math.max(0.1, 0.9 * (tol / err) ** 0.2));
  }
}

export function traceBackwardAdaptive(
  st0: State,
  L: number,
  a: number,
  opts: { tol: number; epsMax: number; maxSteps: number; rEscape: number; captureTol: number; method?: "dopri" | "rk4" },
): TraceResult & { evals: number } {
  const rH = horizon(a);
  let st = st0;
  let maxDH = 0;
  let hNext = Infinity;
  let evals = 0;
  let k1: State | null = null;
  for (let i = 0; i < opts.maxSteps; i++) {
    const hMax = stepSize(st, L, a, opts.epsMax, rH);
    const prevR = st.x[0];
    if (opts.method === "rk4") {
      const out = adaptiveRK4(st, L, a, Math.min(hNext, hMax), hMax, opts.tol);
      evals += 11;
      hNext = out.hNext;
      st = out.state;
    } else {
      if (!k1) {
        k1 = rhs(st.x, st.p, L, a);
        evals++;
      }
      const out = adaptiveDOPRI(st, k1, L, a, Math.min(hNext, hMax), hMax, opts.tol);
      evals += out.evals;
      hNext = out.hNext;
      st = out.state;
      k1 = out.k7;
    }
    const wrap = st.x[1] < 0 || st.x[1] > Math.PI;
    if (st.x[1] < 0) st = { x: [st.x[0], -st.x[1], st.x[2] + Math.PI, st.x[3]], p: [st.p[0], -st.p[1]] };
    if (st.x[1] > Math.PI) st = { x: [st.x[0], 2 * Math.PI - st.x[1], st.x[2] + Math.PI, st.x[3]], p: [st.p[0], -st.p[1]] };
    if (wrap) k1 = null;
    maxDH = Math.max(maxDH, Math.abs(hamiltonian(st, L, a)));
    const r = st.x[0];
    if (r < rH + opts.captureTol || !Number.isFinite(r)) return { fate: "horizon", steps: i + 1, state: st, maxDH, evals };
    if (r > opts.rEscape && r > prevR) return { fate: "escape", steps: i + 1, state: st, maxDH, evals };
  }
  return { fate: "maxsteps", steps: opts.maxSteps, state: st, maxDH, evals };
}
