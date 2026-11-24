// CPU models of two pieces of trace.wgsl (25 Nov 2026), for the unit tests (tests/scenery-strip-wake.test.ts) and their GPU slice
// (tests/e2e/strip-wake-slice.e2e.test.ts, which runs the shader's own functions against these): sceneryStrip — a surface line's strip,
// round-capped for a road's piece, square-ended for a junction's paint (kind 5) — and kelvinSlope — a ship's Kelvin waves. The old
// shapes beside them: the positive witnesses.

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** trace.wgsl sceneryStrip: [distance from the axis, abscissa along it, cover] */
export function sceneryStrip(
  pt: [number, number],
  a: [number, number],
  b: [number, number],
  half: number,
  aa: number,
  square: boolean,
): [number, number, number] {
  const lx = b[0] - a[0],
    ly = b[1] - a[1];
  const len = Math.max(Math.hypot(lx, ly), 0.001);
  const dx = lx / len,
    dy = ly / len;
  const s = (pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy;
  const along = Math.min(len, Math.max(0, s));
  if (square) {
    const across = Math.abs((pt[0] - a[0]) * -dy + (pt[1] - a[1]) * dx);
    const ends = 1 - ss(-aa, aa, Math.max(-s, s - len));
    return [across, along, (1 - ss(Math.max(0, half - aa), half + aa, across)) * ends];
  }
  const distance = Math.hypot(pt[0] - a[0] - dx * along, pt[1] - a[1] - dy * along);
  return [distance, along, 1 - ss(Math.max(0, half - aa), half + aa, distance)];
}

/** the zebra's bands over a strip (scenerySurface, kind 5 pattern 1): 0.5 m painted in each metre along it */
export function zebra(sa: number, aa: number): number {
  const f = sa - Math.floor(sa);
  return 1 - ss(0.5 - aa * 0.5, 0.5 + aa * 0.5, f);
}

/** trace.wgsl kelvinSlope: (∂h/∂x, ∂h/∂|y|) */
export function kelvinSlope(
  x: number,
  ay: number,
  U: number,
  L: number,
  reach: number,
  footM: number,
  jit: number,
  axis: number,
): [number, number, number] {
  const r = ay / Math.max(x, 1e-3);
  if (r > 0.4) return [0, 0, 0];
  const k0 = 9.81 / (U * U);
  const steep = ss(0.08, 0.35, U / Math.sqrt(9.81 * Math.max(L, 1)));
  const q = Math.sqrt(L / (x + L)) * Math.exp((-2 * x) / reach);
  const cusp = ss(0.29, 0.354, r);
  const edge = ss(0.4, 0.354, r) * (1 + 2.0 * cusp);
  const disc = Math.sqrt(Math.max(1 - 8 * r * r, 0));
  const rr = Math.max(r, 1e-4);
  const broken = 0.6 + 0.6 * Math.abs(jit);
  const g: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < 2; j++) {
    const tr = j === 0;
    const tt = tr ? (1 - disc) / (4 * rr) : (1 + disc) / (4 * rr);
    const ct = 1 / Math.sqrt(1 + tt * tt),
      st = tt * ct;
    const kk = k0 / (ct * ct);
    const seen = ss(2 * footM, 6 * footM, (2 * Math.PI) / kk);
    const lit = tr ? 1 : ss(0.05, 0.25, r);
    const s = tr ? (0.02 + 0.035 * steep) * q * (1 - 0.75 * axis) : (0.12 + 0.04 * steep) * (q + (Math.sqrt(q) - q) * cusp);
    const ph = kk * (x * ct + ay * st) + jit * (tr ? 0.9 : -0.7);
    const a = s * edge * broken;
    g[0] -= a * seen * lit * Math.sin(ph) * ct;
    g[1] -= a * seen * lit * Math.sin(ph) * st;
    g[2] += a * a * (1 - seen) * lit;
  }
  const m = Math.hypot(g[0], g[1]);
  return m > 0.4 ? [(g[0] * 0.4) / m, (g[1] * 0.4) / m, g[2]] : g;
}

/** the Kelvin waves before 25 Nov 2026 (seaWake's inline loop): their heights ∝ the hull's length, the same pattern everywhere */
export function kelvinSlopeOld(x: number, ay: number, U: number, L: number, reach: number, footM: number): [number, number] {
  const r = ay / x;
  const k0 = 9.81 / (U * U);
  const fr = ss(0.8, 3, U);
  const a0 = Math.min(0.006 * L + 0.1, 1.6) * fr * Math.sqrt(L / (x + L)) * Math.exp((-x / reach) * 2);
  const edge = ss(0.4, 0.354, r) * (1 + 1.5 * ss(0.29, 0.354, r));
  const disc = Math.sqrt(Math.max(1 - 8 * r * r, 0));
  const rr = Math.max(r, 1e-4);
  const g: [number, number] = [0, 0];
  for (let j = 0; j < 2; j++) {
    const tt = j === 0 ? (1 - disc) / (4 * rr) : (1 + disc) / (4 * rr);
    const th = Math.atan(tt);
    const ct = Math.cos(th),
      st = Math.sin(th);
    const kk = k0 / (ct * ct);
    const res = ss(2 * footM, 6 * footM, (2 * Math.PI) / kk) * (j === 0 ? 1 : ss(0.05, 0.25, r));
    const a = a0 * edge * res * (j === 0 ? 1 : 0.7);
    const dh = -a * Math.sin(kk * (x * ct + ay * st)) * kk;
    g[0] += dh * ct;
    g[1] += dh * st;
  }
  return g;
}
