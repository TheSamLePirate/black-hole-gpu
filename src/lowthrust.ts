// Relative motion near a body on a circular equatorial orbit of Kerr, and the minimum-energy
// rendezvous with a weak engine (the Crew engine's last stretch).
//
// Coordinates about the body (coordinate time t): x = r − R (cylindrical radius), y = R Δφ (along its
// motion), z (height). Linearized, the free motion is an epicycle — with Kerr's coefficients, not
// Hill's: the radial frequency κ² = Ω²(1 − 6/R + 8a/R^{3/2} − 3a²/R²) (Bardeen, Press & Teukolsky), the
// vertical ν² = Ω²(1 − 4a/R^{3/2} + 3a²/R²), the along-track coupling γ = −R ∂φ̇/∂r at fixed E, L, and
// the drift of a displaced circle R dΩ/dr:
//   ẍ = −κ² x + κ² (ẏ + γ x)/Γ + a_x,  Γ = γ + R dΩ/dr     ÿ = −γ ẋ + a_y     z̈ = −ν² z + a_z
// (Newton: κ = ν = Ω, γ = 2Ω, Γ = Ω/2 — Clohessy–Wiltshire). The control that brings the state to rest
// at the body in a time T with the least ∫a² is a = −Bᵀ Φ(T)ᵀ W(T)⁻¹ Φ(T) s (Φ: the state transition,
// W: the controllability Gramian); applied again every frame with the time left, it is a feedback.

import { circularOrbit } from "./system/kerr-orbits";

export type State6 = [number, number, number, number, number, number]; // x y z ẋ ẏ ż
type M6 = number[][];

/** The epicycle's coefficients at radius R (spin a). */
export function epicycle(R: number, a: number) {
  const o = circularOrbit(R, a);
  const n = o.Omega;
  const phidot = (r: number) => {
    const D = r * r - 2 * r + a * a, A = (r * r + a * a) ** 2 - a * a * D;
    const gtt = -A / (r * r * D), gtp = (-2 * a) / (r * D), gpp = (D - a * a) / (r * r * D);
    return (-gtp * o.E + gpp * o.L) / (-gtt * o.E + gtp * o.L);
  };
  const h = 1e-5 * R;
  const gamma = (-R * (phidot(R + h) - phidot(R - h))) / (2 * h);
  const dOm = (-1.5 * Math.sqrt(R)) / (R ** 1.5 + a) ** 2;
  return { n, kappa2: n * n * o.radialFactor, nu2: n * n * o.verticalFactor, gamma, Gamma: gamma + R * dOm, ut: o.ut };
}

/** The system matrix (6×6) of the relative motion. */
function system(e: ReturnType<typeof epicycle>): M6 {
  const Z = () => [0, 0, 0, 0, 0, 0];
  const A: M6 = [Z(), Z(), Z(), Z(), Z(), Z()];
  A[0]![3] = A[1]![4] = A[2]![5] = 1;
  A[3]![0] = -e.kappa2 + (e.kappa2 * e.gamma) / e.Gamma;
  A[3]![4] = e.kappa2 / e.Gamma;
  A[4]![3] = -e.gamma;
  A[5]![2] = -e.nu2;
  return A;
}

const mul = (A: M6, B: M6): M6 => A.map((row) => B[0]!.map((_, j) => row.reduce((s, v, k) => s + v * B[k]![j]!, 0)));
const add = (A: M6, B: M6, k = 1): M6 => A.map((row, i) => row.map((v, j) => v + k * B[i]![j]!));
const eye = (): M6 => [0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2, 3, 4, 5].map((j) => (i === j ? 1 : 0)));
const mv = (A: M6, v: number[]) => A.map((row) => row.reduce((s, x, k) => s + x * v[k]!, 0));
const tr = (A: M6): M6 => A[0]!.map((_, j) => A.map((row) => row[j]!));

/** e^{A t}: scaling and squaring of a Taylor series. */
function expm(A: M6, t: number): M6 {
  const norm = Math.max(...A.map((r) => r.reduce((s, v) => s + Math.abs(v), 0))) * Math.abs(t);
  const sq = Math.max(0, Math.ceil(Math.log2(norm + 1e-300)) + 2);
  const At = A.map((r) => r.map((v) => (v * t) / 2 ** sq));
  let E = eye(), term = eye();
  for (let k = 1; k <= 12; k++) {
    term = mul(term, At).map((r) => r.map((v) => v / k));
    E = add(E, term);
  }
  for (let k = 0; k < sq; k++) E = mul(E, E);
  return E;
}

/** Solves M x = b (Gaussian elimination, partial pivoting); null if singular. */
function solve(M: M6, b: number[]): number[] | null {
  const n = b.length;
  const A = M.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    if (Math.abs(A[p]![c]!) < 1e-300) return null;
    [A[c], A[p]] = [A[p]!, A[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k <= n; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return A.map((r, i) => r[n]! / r[i]!);
}

/**
 * The minimum-energy push now [coordinate acceleration, (x, y, z)] that brings the relative state s to
 * rest at the body in the time T (in M). Null when T is too short to be solved accurately.
 */
export function rendezvousPush(e: ReturnType<typeof epicycle>, s: State6, T: number): [number, number, number] | null {
  if (!(T > 0)) return null;
  const A = system(e);
  // W(T) = ∫₀ᵀ Φ(τ) B Bᵀ Φ(τ)ᵀ dτ (B selects the velocities): Simpson on 48 steps
  const N = 48;
  const step = expm(A, T / N);
  let Phi = eye();
  let W: M6 = eye().map((r) => r.map(() => 0));
  for (let k = 0; k <= N; k++) {
    const w = k === 0 || k === N ? 1 : k % 2 ? 4 : 2;
    // Φ B Bᵀ Φᵀ = (columns 3..5 of Φ) (…)ᵀ
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        let v = 0;
        for (let c = 3; c < 6; c++) v += Phi[i]![c]! * Phi[j]![c]!;
        W[i]![j]! += ((w * T) / (3 * N)) * v;
      }
    if (k < N) Phi = mul(step, Phi);
  }
  // Φ now is Φ(T); a(0) = −Bᵀ Φ(T)ᵀ W⁻¹ Φ(T) s
  const lam = solve(W, mv(Phi, s));
  if (!lam) return null;
  const g = mv(tr(Phi), lam);
  const out: [number, number, number] = [-g[3]!, -g[4]!, -g[5]!];
  return out.every(Number.isFinite) ? out : null;
}

/** Free relative motion over t (the model's prediction). */
export function drift(e: ReturnType<typeof epicycle>, s: State6, t: number): State6 {
  return mv(expm(system(e), t), s) as State6;
}
