// Two-body propagation in universal variables (any conic: ellipse, parabola, hyperbola) — the map's
// preview beyond the predicted paths (patched conics). Vallado, "Fundamentals of Astrodynamics",
// algorithm 8 (Kepler's problem with the universal variable χ and Stumpff's c₂, c₃).
//
// Units: whatever the caller uses, G = 1 (the game: M and M of time, GM in M).

export type V3 = [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function stumpff(psi: number): [number, number] {
  if (psi > 1e-6) {
    const s = Math.sqrt(psi);
    return [(1 - Math.cos(s)) / psi, (s - Math.sin(s)) / (s * psi)];
  }
  if (psi < -1e-6) {
    const s = Math.sqrt(-psi);
    return [(1 - Math.cosh(s)) / psi, (Math.sinh(s) - s) / (s * -psi)];
  }
  return [0.5 - psi / 24 + (psi * psi) / 720, 1 / 6 - psi / 120 + (psi * psi) / 5040];
}

/** The state after dt (either sign) on the conic of (r0, v0) around a body of GM mu. */
export function propagate(mu: number, r0: V3, v0: V3, dt: number): { r: V3; v: V3 } {
  const R0 = Math.hypot(...r0);
  const V0 = Math.hypot(...v0);
  const sqmu = Math.sqrt(mu);
  const rv = dot(r0, v0);
  const alpha = 2 / R0 - (V0 * V0) / mu; // 1/a
  // first guess of χ
  let chi: number;
  if (alpha > 1e-9) chi = sqmu * dt * alpha;
  else if (alpha < -1e-9) {
    const a = 1 / alpha;
    const s = Math.sign(dt) || 1;
    chi = s * Math.sqrt(-a) * Math.log((-2 * mu * alpha * dt) / (rv + s * Math.sqrt(-mu * a) * (1 - R0 * alpha)));
    if (!Number.isFinite(chi)) chi = sqmu * dt / R0;
  } else chi = (sqmu * dt) / R0;
  let c2 = 0.5, c3 = 1 / 6, psi = 0, r = R0;
  for (let k = 0; k < 60; k++) {
    psi = chi * chi * alpha;
    [c2, c3] = stumpff(psi);
    r = chi * chi * c2 + (rv / sqmu) * chi * (1 - psi * c3) + R0 * (1 - psi * c2);
    const next = chi + (sqmu * dt - chi ** 3 * c3 - (rv / sqmu) * chi * chi * c2 - R0 * chi * (1 - psi * c3)) / r;
    if (!Number.isFinite(next)) break;
    const done = Math.abs(next - chi) < 1e-12 * Math.max(1, Math.abs(chi));
    chi = next;
    if (done) break;
  }
  const f = 1 - (chi * chi * c2) / R0;
  const g = dt - (chi ** 3 * c3) / sqmu;
  const gd = 1 - (chi * chi * c2) / r;
  const fd = (sqmu / (r * R0)) * chi * (psi * c3 - 1);
  return {
    r: [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1], f * r0[2] + g * v0[2]],
    v: [fd * r0[0] + gd * v0[0], fd * r0[1] + gd * v0[1], fd * r0[2] + gd * v0[2]],
  };
}
