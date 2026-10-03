// The ship's axes carried as gyroscopes near the hole (phase 2, audit §7 item 11: "pas de transport de
// Fermi–Walker"): along its worldline in the Kerr metric, a direction the ship does not turn about is
// Fermi–Walker transported — in free fall parallel transported, dS^μ/dτ = −Γ^μ_αβ u^α S^β; under
// thrust, turned with the 4-velocity by the pure boost (no rotation of its own) — not held fixed on the
// flat map's axes. The ship's attitude then precesses against the distant stars as a gyroscope does:
// the geodetic (de Sitter) precession, 2π(1 − √(1 − 3M/r)) a turn on a circular orbit (59° at 10 M),
// the hole's frame dragging (Lense–Thirring) on top.
//
// The axes go in and out as directions in the ship's rest frame on the ZAMO's axes (r̂, θ̂, φ̂) — the
// camera's convention (its look is boosted by its β relative to the ZAMO: the pure boost) — and are
// carried as Boyer–Lindquist 4-vectors (t, r, θ, φ). The Christoffel symbols from the metric's
// derivatives (central differences, float64; the metric depends on r and θ only).

import { inverseMetric, type Massive } from "./geodesic";
import { zamo, type Vec3 } from "./physics";

type M4 = number[][];

/** The Kerr metric g_μν at (r, θ) (Boyer–Lindquist; t, r, θ, φ). */
export function kerrMetricBL(r: number, th: number, a: number): M4 {
  const s2 = Math.sin(th) ** 2,
    c2 = Math.cos(th) ** 2;
  const sig = r * r + a * a * c2;
  const del = r * r - 2 * r + a * a;
  const tt = -(1 - (2 * r) / sig),
    tph = (-2 * a * r * s2) / sig,
    phph = (r * r + a * a + (2 * a * a * r * s2) / sig) * s2;
  return [
    [tt, 0, 0, tph],
    [0, sig / del, 0, 0],
    [0, 0, sig, 0],
    [tph, 0, 0, phph],
  ];
}

function inverseBL(r: number, th: number, a: number): M4 {
  const g = inverseMetric(r, th, a);
  return [
    [g.tt, 0, 0, g.tph],
    [0, g.rr, 0, 0],
    [0, 0, g.thth, 0],
    [g.tph, 0, 0, g.phph],
  ];
}

/** Γ^μ_αβ at (r, θ): ½ g^μν (∂_α g_νβ + ∂_β g_να − ∂_ν g_αβ), the derivatives in r and θ only. */
export function christoffelBL(r: number, th: number, a: number): number[][][] {
  const hr = 1e-6 * Math.max(r, 1),
    ht = 1e-6;
  const gr1 = kerrMetricBL(r + hr, th, a),
    gr0 = kerrMetricBL(r - hr, th, a);
  const gt1 = kerrMetricBL(r, th + ht, a),
    gt0 = kerrMetricBL(r, th - ht, a);
  // dg[k][i][j] = ∂_k g_ij (k: 0 t, 1 r, 2 θ, 3 φ)
  const zero = [0, 0, 0, 0].map(() => [0, 0, 0, 0]);
  const dg: M4[] = [zero, zero, zero, zero].map((z) => z.map((row) => [...row]));
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      dg[1]![i]![j] = (gr1[i]![j]! - gr0[i]![j]!) / (2 * hr);
      dg[2]![i]![j] = (gt1[i]![j]! - gt0[i]![j]!) / (2 * ht);
    }
  const gi = inverseBL(r, th, a);
  const G: number[][][] = [0, 1, 2, 3].map(() => [0, 1, 2, 3].map(() => [0, 0, 0, 0]));
  for (let m = 0; m < 4; m++)
    for (let al = 0; al < 4; al++)
      for (let be = al; be < 4; be++) {
        let s = 0;
        for (let n = 0; n < 4; n++) {
          const gmn = gi[m]![n]!;
          if (gmn === 0) continue;
          s += gmn * (dg[al]![n]![be]! + dg[be]![n]![al]! - dg[n]![al]![be]!);
        }
        G[m]![al]![be] = G[m]![be]![al] = 0.5 * s;
      }
  return G;
}

/** The 4-velocity u^μ of a state (contravariant, BL). */
export function fourVelocity(st: Massive, a: number): number[] {
  const g = inverseMetric(st.r, st.th, a);
  return [-g.tt * st.E + g.tph * st.L, g.rr * st.ur, g.thth * st.uth, -g.tph * st.E + g.phph * st.L];
}

const dot4 = (g: M4, x: number[], y: number[]) => {
  let s = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += g[i]![j]! * x[i]! * y[j]!;
  return s;
};

/** dS/dτ = −Γ^μ_αβ u^α S^β at a state. */
function dS(st: Massive, u: number[], S: number[], a: number): number[] {
  const G = christoffelBL(st.r, st.th, a);
  return [0, 1, 2, 3].map((m) => {
    let s = 0;
    for (let al = 0; al < 4; al++) for (let be = 0; be < 4; be++) s += G[m]![al]![be]! * u[al]! * S[be]!;
    return -s;
  });
}

/**
 * Parallel transport of the vectors S over an accepted step from s0 to s1 (proper time h): Heun's
 * scheme on the two ends' Christoffels and velocities, each vector then kept square to u (the step's
 * error taken off along u) — and across the polar axis (θ reflected, φ + π) its θ part turned.
 */
export function transportStep(spins: number[][], s0: Massive, s1: Massive, h: number, a: number) {
  const u0 = fourVelocity(s0, a),
    u1 = fourVelocity(s1, a);
  const flip = Math.abs(s1.ph - s0.ph) > 1 && Math.sin(s1.th) < 0.2;
  const g1 = kerrMetricBL(s1.r, s1.th, a);
  for (const S of spins) {
    const k1 = dS(s0, u0, S, a);
    const Sp = S.map((x, i) => x + h * k1[i]!);
    if (flip) Sp[2] = -Sp[2]!;
    const k2 = dS(s1, u1, Sp, a);
    let n = S.map((x, i) => x + 0.5 * h * (k1[i]! + k2[i]!));
    if (flip) n[2] = -n[2]!;
    // (square to u: S + (u·S) u, u·u = −1)
    const us = dot4(g1, u1, n);
    n = n.map((x, i) => x + us * u1[i]!);
    for (let i = 0; i < 4; i++) S[i] = n[i]!;
  }
  // (a triad stays orthonormal — the transport keeps lengths and angles; the scheme's second order
  // does to 1e-5 a step: Gram–Schmidt in the metric takes its error off)
  for (let k = 0; k < spins.length; k++) {
    const S = spins[k]!;
    for (let j = 0; j < k; j++) {
      const P = spins[j]!;
      const c = dot4(g1, P, S);
      for (let i = 0; i < 4; i++) S[i] = S[i]! - c * P[i]!;
    }
    const l = Math.sqrt(Math.max(dot4(g1, S, S), 1e-30));
    for (let i = 0; i < 4; i++) S[i] = S[i]! / l;
  }
}

/** The pure boost from the 4-velocity of s0 to that of s1 (an impulse of thrust: Fermi–Walker), on S ⊥ u0. */
export function boostSpins(spins: number[][], s0: Massive, s1: Massive, a: number) {
  const u = fourVelocity(s0, a),
    v = fourVelocity(s1, a);
  const g = kerrMetricBL(s1.r, s1.th, a);
  const gam = -dot4(g, u, v);
  for (const S of spins) {
    const k = dot4(g, v, S) / (1 + gam);
    for (let i = 0; i < 4; i++) S[i] = S[i]! + k * (u[i]! + v[i]!);
  }
}

/** A direction in the ship's rest frame (components on the ZAMO's r̂, θ̂, φ̂) → its 4-vector (BL), the
 *  ship moving at β relative to the ZAMO (the pure boost). */
export function spinFromZamo(st: Massive, a: number, beta: Vec3, s: Vec3): number[] {
  const z = zamo(st.r, st.th, a);
  const b2 = beta[0] ** 2 + beta[1] ** 2 + beta[2] ** 2;
  const gam = 1 / Math.sqrt(Math.max(1 - b2, 1e-12));
  const bs = beta[0] * s[0] + beta[1] * s[1] + beta[2] * s[2];
  // (ZAMO components: S^(0) = γ β·s, S^(i) = s + γ²/(γ+1) (β·s) β)
  const k = b2 > 0 ? (gam * gam) / (gam + 1) : 0;
  const T = gam * bs;
  const Sr = s[0] + k * bs * beta[0],
    St = s[1] + k * bs * beta[1],
    Sp = s[2] + k * bs * beta[2];
  // (the ZAMO's tetrad on BL: e_t = (∂_t + ω ∂_φ)/α, e_r = ∂_r √(Δ/Σ), e_θ = ∂_θ / √Σ, e_φ = ∂_φ / ϖ)
  return [T / z.alpha, Sr / z.sqrtSigOverDel, St / z.sqrtSig, (z.omega * T) / z.alpha + Sp / Math.max(z.varpi, 1e-12)];
}

/** A 4-vector square to the ship's 4-velocity (BL) → its direction in the ship's rest frame, on the ZAMO's axes. */
export function spinToZamo(st: Massive, a: number, beta: Vec3, S: number[]): Vec3 {
  const z = zamo(st.r, st.th, a);
  const T = z.alpha * S[0]!;
  const Z: Vec3 = [S[1]! * z.sqrtSigOverDel, S[2]! * z.sqrtSig, z.varpi * (S[3]! - z.omega * S[0]!)];
  // (the inverse boost: s = S − γ/(γ+1) S^(0) β)
  const b2 = beta[0] ** 2 + beta[1] ** 2 + beta[2] ** 2;
  const gam = 1 / Math.sqrt(Math.max(1 - b2, 1e-12));
  const k = (gam / (gam + 1)) * T;
  return [Z[0] - k * beta[0], Z[1] - k * beta[1], Z[2] - k * beta[2]];
}
