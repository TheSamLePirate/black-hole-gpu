// The sea's spectrum (docs/PLAN-AVIATION-AAA.md, M1; Tessendorf, "Simulating Ocean Water"): the wind's sea and the
// swell (sea/marine.ts) each a JONSWAP spectrum — S(ω) = α g² ω⁻⁵ exp(−5/4 (ωp/ω)⁴) γ^exp(−(ω − ωp)²/(2σ²ωp²)),
// α set so that 4√m₀ is its significant height — spread about its way (cos²ˢ(θ/2): broad for the wind's sea,
// narrow for the swell), on deep water (ω² = g k); its random amplitudes on three cascades of 256 × 256 modes
// (periods 1024, 128 and 16 m — whole fractions of the sea's kilometre anchor), each holding its band of
// wavenumbers (no wave counted twice). Seeded: the same sea on every page of a room. Pure.

export const SEA_N = 256;
/** the cascades' periods [m] and the wavenumbers [rad/m] each holds: [lower, upper) */
export const CASCADES = [1024, 128, 16] as const;
export const BANDS: [number, number][] = [
  [0, (2 * Math.PI * 6) / 128],
  [(2 * Math.PI * 6) / 128, (2 * Math.PI * 6) / 16],
  [(2 * Math.PI * 6) / 16, (Math.PI * SEA_N) / 16],
];
const G = 9.81;

/** One of the sea's systems: significant height [m], peak period [s], its way in the cascades' frame [rad: 0
 *  along their x — the wind's way —, π/2 along their z], γ its peak's sharpness, s its spread's. */
export interface SeaSystem {
  hs: number;
  tp: number;
  dir: number;
  gamma: number;
  spread: number;
}

/** JONSWAP's shape at ω (α = 1): its value [m² s]. */
function jonswap(w: number, wp: number, gamma: number) {
  if (w <= 0) return 0;
  const s = w <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - wp) ** 2) / (2 * s * s * wp * wp));
  return G * G * w ** -5 * Math.exp(-1.25 * (wp / w) ** 4) * gamma ** r;
}

/** Its scale α: the shape's m₀ integrated (ω from 0.2 ωp to 8 ωp), so that 4√m₀ = Hs. */
function alphaOf(sys: SeaSystem): number {
  const wp = (2 * Math.PI) / sys.tp;
  let m0 = 0;
  const n = 2000,
    a = 0.2 * wp,
    b = 8 * wp,
    dw = (b - a) / n;
  for (let i = 0; i < n; i++) m0 += jonswap(a + (i + 0.5) * dw, wp, sys.gamma) * dw;
  return m0 > 0 ? (sys.hs / 4) ** 2 / m0 : 0;
}

/** Γ(x) (Lanczos). */
function gammaFn(x: number): number {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  const y = x - 1;
  let a = 0.99999999999980993;
  const t = y + 7.5;
  for (let i = 0; i < 8; i++) a += p[i]! / (y + i + 1);
  return Math.sqrt(2 * Math.PI) * t ** (y + 0.5) * Math.exp(-t) * a;
}

/** The directional spreading cos²ˢ(θ/2), normalised over the circle. */
function spreading(theta: number, s: number): number {
  const n = gammaFn(s + 1) / (2 * Math.sqrt(Math.PI) * gammaFn(s + 0.5));
  return n * Math.abs(Math.cos(theta / 2)) ** (2 * s);
}

/** The sea's directional wavenumber spectrum at (kx, kz) [m⁴]: the systems' sum (deep water: S(k,θ) = S(ω) dω/dk / k). */
export function seaSpectrum(kx: number, kz: number, systems: readonly SeaSystem[], alphas: readonly number[]): number {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const w = Math.sqrt(G * k);
  const dwdk = G / (2 * w);
  const th = Math.atan2(kz, kx);
  let S = 0;
  systems.forEach((sys, i) => {
    if (!(sys.hs > 0)) return;
    const wp = (2 * Math.PI) / sys.tp;
    S += (alphas[i]! * jonswap(w, wp, sys.gamma) * spreading(th - sys.dir, sys.spread) * dwdk) / k;
  });
  return S;
}

/** A seeded uniform generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sea's cascades: for each, its N × N modes' amplitudes h̃₀(k) and conj(h̃₀(−k)) (4 floats a mode, k's
 *  indices unshifted: m < N/2 ↦ m, else m − N), and what they hold: the height's variance [m²], the slopes'
 *  along x and z. */
export interface SeaCascades {
  h0: Float32Array<ArrayBuffer>[];
  height: number[];
  slopeX: number[];
  slopeZ: number[];
}

export function seaCascades(systems: readonly SeaSystem[], seed = 1): SeaCascades {
  const N = SEA_N;
  const alphas = systems.map(alphaOf);
  const out: SeaCascades = { h0: [], height: [], slopeX: [], slopeZ: [] };
  CASCADES.forEach((L, ci) => {
    const [lo, hi] = BANDS[ci]!;
    const dk = (2 * Math.PI) / L;
    const r = rng(seed * 7919 + ci * 104729);
    // (Box–Muller: two normals a mode, drawn for every mode whatever its band — the same sea for the same seed)
    const amp = new Float32Array(N * N * 2);
    let vh = 0,
      vx = 0,
      vz = 0;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const u1 = Math.max(r(), 1e-12),
          u2 = r();
        const rad = Math.sqrt(-2 * Math.log(u1));
        const kx = (i < N / 2 ? i : i - N) * dk,
          kz = (j < N / 2 ? j : j - N) * dk;
        const k = Math.hypot(kx, kz);
        const S = k >= lo && k < hi ? seaSpectrum(kx, kz, systems, alphas) : 0;
        // (each mode's mean square S Δk²/2 — its real and imaginary parts a quarter each —: the conjugate pair
        // together carry S Δk²)
        const a = Math.sqrt((S * dk * dk) / 4);
        amp[2 * (j * N + i)] = a * rad * Math.cos(2 * Math.PI * u2);
        amp[2 * (j * N + i) + 1] = a * rad * Math.sin(2 * Math.PI * u2);
        vh += S * dk * dk;
        vx += kx * kx * S * dk * dk;
        vz += kz * kz * S * dk * dk;
      }
    const h0 = new Float32Array(N * N * 4);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const o = j * N + i,
          m = ((N - j) % N) * N + ((N - i) % N);
        h0[4 * o] = amp[2 * o]!;
        h0[4 * o + 1] = amp[2 * o + 1]!;
        h0[4 * o + 2] = amp[2 * m]!;
        h0[4 * o + 3] = -amp[2 * m + 1]!;
      }
    out.h0.push(h0);
    out.height.push(vh);
    out.slopeX.push(vx);
    out.slopeZ.push(vz);
  });
  return out;
}

/** The systems for a sea state (sea/marine.ts) in the cascades' frame (x along `frame`, the wind's way [rad,
 *  compass]): the wind's sea broad (γ 3.3, s 6), the swell narrow (γ 6, s 30). */
export function seaSystems(
  state: { wind: { hs: number; tp: number; to: number }; swell: { hs: number; tp: number; to: number } },
  frame: number,
): SeaSystem[] {
  // (compass ways — from the north, eastwards, clockwise — into the frame: x its way, z to its left: counter-clockwise)
  const rel = (to: number) => -(to - frame);
  return [
    { hs: state.wind.hs, tp: state.wind.tp, dir: rel(state.wind.to), gamma: 3.3, spread: 6 },
    { hs: state.swell.hs, tp: state.swell.tp, dir: rel(state.swell.to), gamma: 6, spread: 30 },
  ];
}

/** The standard normal's quantile (Acklam's rational approximation, |error| < 1.2e-9): the z under which lies `p`. */
export function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q0 = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  if (q0 < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(q0));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (q0 > 1 - 0.02425) return -normalQuantile(1 - q0);
  const q = q0 - 0.5,
    r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}
