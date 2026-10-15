// A real aircraft's path between its reports (docs/PLAN-AVIATION-AAA.md, T2; controller/traffic.ts draws it), flown
// as an aircraft flies: not its places joined, but its flight — its ground speed, its track, its climb, each the
// smoothest curve near its reports (a smoothing spline: least change against the reports' misfit — a steady turn a
// straight line of its track, its roll in and out eased, the 25 ft steps of its altitude and its places' metres of
// noise left out), its place their integral, drawn back to its reported places by a slow correction (its own
// smoothing spline, all but straight). Its turn's rate is its track's: a coordinated turn's bank (V·ω = g·tan φ),
// continuous. And the flight's laws to fly it: the lift its weight and its turn ask (the incidence, the nose above
// the path), its flaps out when slow. Pure.

/** A report as the path reads it: its time [s], place [m, a local east, north, up — or a scale of them], ground
 *  speed [m/s], track [rad], climb [m/s] (null: its velocity unknown), the scale of east and north there (the frame's
 *  metres per true metre). */
export interface FlightKnot {
  t: number;
  x: readonly number[];
  gs: number | null;
  trk: number;
  vs: number;
  ke?: number;
  kn?: number;
}

/** The reports' spreads (ground speed [m/s], track [rad], climb [m/s], place [m], height [m]) and each curve's
 *  smoothing weight (its second derivative's). */
export const FLIGHT = {
  sV: 0.5,
  sPsi: 0.006,
  sVs: 0.4,
  sX: 15,
  sU: 5,
  lV: 200,
  lPsi: 3e4,
  lVs: 30,
  lX: 100,
  lU: 300,
} as const;

/** A smoothed curve: at each knot its value and slope (between two knots their cubic Hermite). */
export interface Curve {
  t: number[];
  y: number[];
  d: number[];
}

/** Cholesky solve of a banded (half-width 3) symmetric positive definite system: M z = b. */
function solveBand(M: Float64Array, b: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      let s = M[i * n + j]!;
      for (let k = Math.max(0, i - 3); k < j; k++) s -= L[i * n + k]! * L[j * n + k]!;
      if (i === j) L[i * n + i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i * n + j] = s / L[j * n + j]!;
    }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = Math.max(0, i - 3); k < i; k++) s -= L[i * n + k]! * y[k]!;
    y[i] = s / L[i * n + i]!;
  }
  const z = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < Math.min(n, i + 4); k++) s -= L[k * n + i]! * z[k]!;
    z[i] = s / L[i * n + i]!;
  }
  return z;
}

/**
 * The smoothing spline of a series (times in order, two at least; a value null: none there): its values and slopes
 * at the knots minimising Σ(y − Y)²/σ² + λ∫ÿ² dt — between two knots their cubic Hermite, so the integral a
 * quadratic form of them (12Δ²/h³ − 12Δ(d₀ + d₁)/h² + 4(d₀² + d₀d₁ + d₁²)/h); the band system solved at once. Its
 * second derivative continuous: the optimum's.
 */
export function smoothCurve(t: readonly number[], Y: readonly (number | null)[], sigma: number, lambda: number): Curve {
  const n = t.length;
  const N = 2 * n;
  const M = new Float64Array(N * N);
  const b = new Float64Array(N);
  const add = (i: number, j: number, c: number) => {
    M[i * N + j]! += c;
    if (i !== j) M[j * N + i]! += c;
  };
  const w = 1 / (sigma * sigma);
  for (let i = 0; i < n; i++) {
    const y = Y[i];
    if (y === null || y === undefined) continue;
    add(2 * i, 2 * i, w);
    b[2 * i]! += y * w;
  }
  for (let i = 0; i + 1 < n; i++) {
    const h = Math.max(t[i + 1]! - t[i]!, 0.05);
    const ya = 2 * i,
      da = 2 * i + 1,
      yb = 2 * i + 2,
      db = 2 * i + 3;
    const c1 = (lambda * 12) / h ** 3,
      c2 = (-lambda * 12) / h ** 2,
      c3 = (lambda * 4) / h;
    add(ya, ya, c1);
    add(yb, yb, c1);
    add(ya, yb, -c1);
    add(yb, da, c2 / 2);
    add(yb, db, c2 / 2);
    add(ya, da, -c2 / 2);
    add(ya, db, -c2 / 2);
    add(da, da, c3);
    add(db, db, c3);
    add(da, db, c3 / 2);
  }
  // (a knot without a value and no neighbour's pull: held by a whisper, never singular)
  for (let i = 0; i < N; i++) M[i * N + i]! += 1e-9;
  const z = solveBand(M, b, N);
  return { t: [...t], y: t.map((_, i) => z[2 * i]!), d: t.map((_, i) => z[2 * i + 1]!) };
}

/** A curve at `t` (held to its ends outside them): its value, slope, second derivative; `i` a hint of its knot. */
export function curveAt(C: Curve, t: number, i0 = 0): { y: number; d: number; dd: number; i: number } {
  const n = C.t.length;
  let i = Math.max(0, Math.min(i0, n - 2));
  while (i > 0 && C.t[i]! > t) i--;
  while (i < n - 2 && C.t[i + 1]! < t) i++;
  const h = C.t[i + 1]! - C.t[i]!;
  const s = h > 0 ? Math.max(0, Math.min(1, (t - C.t[i]!) / h)) : 0;
  const s2 = s * s,
    s3 = s2 * s;
  const a = C.y[i]!,
    da = C.d[i]!,
    b = C.y[i + 1]!,
    db = C.d[i + 1]!;
  return {
    y: (2 * s3 - 3 * s2 + 1) * a + (s3 - 2 * s2 + s) * h * da + (-2 * s3 + 3 * s2) * b + (s3 - s2) * h * db,
    d: ((6 * s2 - 6 * s) * a + (3 * s2 - 4 * s + 1) * h * da + (-6 * s2 + 6 * s) * b + (3 * s2 - 2 * s) * h * db) / h,
    dd: ((12 * s - 6) * a + (6 * s - 4) * h * da + (-12 * s + 6) * b + (6 * s - 2) * h * db) / (h * h),
    i,
  };
}

/** The flight fitted: its speed, track, climb curves; their integral's table (every STEP s) and the correction's. */
export interface FlightPath {
  t0: number;
  t1: number;
  V: Curve;
  psi: Curve;
  vs: Curve;
  /** the integral of the flight from the first report [m, the knots' frame], every STEP s */
  I: number[][];
  /** the correction to the reported places, each axis */
  r: Curve[];
  /** the frame's scale of east and north by its north [m] (the knots' own, between them) */
  scale: (n: number) => [number, number];
}
const STEP = 0.25;

/**
 * Fits a flight to its reports (in time's order, two at least): its ground speed, its track (unwrapped), its climb
 * smoothed; their integral from the first report; the misfit to the reported places smoothed into its correction.
 * A report without its velocity: its speed and track from its neighbours' places.
 */
export function fitFlight(knots: readonly FlightKnot[], o: Partial<typeof FLIGHT> = {}): FlightPath {
  const P = { ...FLIGHT, ...o };
  const n = knots.length;
  const t = knots.map((k) => k.t);
  // (the chord's velocity where one is unknown)
  const chord = (i: number) => {
    const a = knots[Math.max(0, i - 1)]!,
      b = knots[Math.min(n - 1, i + 1)]!;
    const h = Math.max(b.t - a.t, 0.1);
    const ke = knots[i]!.ke ?? 1,
      kn = knots[i]!.kn ?? 1;
    const ve = (b.x[0]! - a.x[0]!) / h / ke,
      vn = (b.x[1]! - a.x[1]!) / h / kn;
    return { gs: Math.hypot(ve, vn), trk: Math.atan2(ve, vn), vs: (b.x[2]! - a.x[2]!) / h };
  };
  const st = knots.map((k, i) => (k.gs !== null ? { gs: k.gs, trk: k.trk, vs: k.vs } : chord(i)));
  // (the track unwrapped: a turn through north a straight line still)
  const trk: number[] = [];
  for (let i = 0; i < n; i++) {
    let a = st[i]!.trk;
    if (i > 0) a = trk[i - 1]! + ((((a - trk[i - 1]! + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    trk.push(a);
  }
  // (standing still: its track no use)
  const V = smoothCurve(
    t,
    st.map((s) => s.gs),
    P.sV,
    P.lV,
  );
  const psi = smoothCurve(
    t,
    trk.map((a, i) => (st[i]!.gs > 3 ? a : null)),
    P.sPsi,
    P.lPsi,
  );
  const vs = smoothCurve(
    t,
    st.map((s) => s.vs),
    P.sVs,
    P.lVs,
  );
  // (the frame's scale between the knots, by north)
  const ns = knots.map((k) => k.x[1]!);
  const lo = Math.min(...ns),
    hi = Math.max(...ns);
  const kAt = (i: number) => [knots[i]!.ke ?? 1, knots[i]!.kn ?? 1] as const;
  const iLo = ns.indexOf(lo),
    iHi = ns.indexOf(hi);
  const scale = (nn: number): [number, number] => {
    const f = hi > lo ? Math.max(0, Math.min(1, (nn - lo) / (hi - lo))) : 0;
    const a = kAt(iLo),
      b = kAt(iHi);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  // (its integral: the midpoint rule every quarter second)
  const t0 = t[0]!,
    t1 = t[n - 1]!;
  const I: number[][] = [[0, 0, 0]];
  const hint = { V: 0, psi: 0, vs: 0 };
  const vel = (tt: number, nn: number) => {
    const v = curveAt(V, tt, hint.V),
      p = curveAt(psi, tt, hint.psi),
      c = curveAt(vs, tt, hint.vs);
    hint.V = v.i;
    hint.psi = p.i;
    hint.vs = c.i;
    const [ke, kn] = scale(nn);
    return [Math.max(0, v.y) * Math.sin(p.y) * ke, Math.max(0, v.y) * Math.cos(p.y) * kn, c.y];
  };
  const steps = Math.ceil((t1 - t0) / STEP);
  for (let k = 0; k < steps; k++) {
    const x = I[k]!;
    const tm = t0 + (k + 0.5) * STEP;
    const v0 = vel(tm - 0.25 * STEP, x[1]!);
    const mid = x.map((q, j) => q + v0[j]! * 0.5 * STEP);
    const vm = vel(tm, mid[1]!);
    I.push(x.map((q, j) => q + vm[j]! * STEP));
  }
  const Iat = (tt: number) => {
    const f = (tt - t0) / STEP;
    const k = Math.max(0, Math.min(I.length - 2, Math.floor(f)));
    const u = Math.max(0, Math.min(1, f - k));
    return I[k]!.map((q, j) => q + (I[k + 1]![j]! - q) * u);
  };
  const r = [0, 1, 2].map((ax) =>
    smoothCurve(
      t,
      knots.map((kk) => kk.x[ax]! - Iat(kk.t)[ax]!),
      ax === 2 ? P.sU : P.sX,
      ax === 2 ? P.lU : P.lX,
    ),
  );
  return { t0, t1, V, psi, vs, I, r, scale };
}

/**
 * The flight at `t` [s] (null: outside its reports): its place, velocity, acceleration [the knots' frame] and its
 * ground speed, track, turn rate [rad/s] and climb (true metres).
 */
export function flightAt(F: FlightPath, t: number) {
  if (t < F.t0 || t > F.t1) return null;
  const v = curveAt(F.V, t),
    p = curveAt(F.psi, t),
    c = curveAt(F.vs, t);
  const f = (t - F.t0) / STEP;
  const k = Math.max(0, Math.min(F.I.length - 2, Math.floor(f)));
  const u = f - k;
  const r = F.r.map((C) => curveAt(C, t));
  const x0 = F.I[k]!,
    x1 = F.I[k + 1]!;
  const V = Math.max(0, v.y);
  const [ke, kn] = F.scale(x0[1]! + r[1]!.y);
  const vf = [V * Math.sin(p.y) * ke, V * Math.cos(p.y) * kn, c.y];
  // (between its table's entries a quarter second apart: their chord — a few centimetres off the arc)
  const x = x0.map((q, j) => q + (x1[j]! - q) * u + r[j]!.y);
  // (its acceleration: along its track its speed's change, across it its turn)
  const w = p.d;
  const a = [
    (v.d * Math.sin(p.y) + V * w * Math.cos(p.y)) * ke + r[0]!.dd,
    (v.d * Math.cos(p.y) - V * w * Math.sin(p.y)) * kn + r[1]!.dd,
    c.d + r[2]!.dd,
  ];
  return {
    x,
    v: vf.map((q, j) => q + r[j]!.d),
    a,
    gs: V,
    trk: p.y,
    omega: w,
    vs: c.y + r[2]!.d,
  };
}

const G = 9.80665;

/** The ISA air's density [kg/m³] at an altitude [m] (the troposphere, then the stratosphere's isotherm). */
export function isaDensity(h: number): number {
  if (h < 11_000) return 1.225 * (1 - 2.25577e-5 * h) ** 4.25588;
  return 0.36392 * Math.exp(-(h - 11_000) / 6341.6);
}

/**
 * The flight's laws for an aircraft flying a path: its velocity `v` and acceleration `a` [m/s, m/s², east, north,
 * up], its wing loading [N/m²] → its coordinated turn's bank [rad, right wing down +] (V·ω = g·tan φ: the turn's rate
 * from the path's horizontal curvature, or `omega` given), its flight path's angle, its incidence [rad] (the lift
 * its weight and its turn ask: n·W/S = ½ρV²·C_L, C_L over its slope — its flaps' share when slow —, its wing set on
 * its fuselage), its load factor.
 */
export function flightLaws(v: readonly number[], a: readonly number[], alt: number, wingLoad: number, omega?: number) {
  const gs = Math.hypot(v[0]!, v[1]!);
  const V = Math.hypot(gs, v[2]!);
  const w = omega ?? (gs > 30 ? (a[0]! * v[1]! - a[1]! * v[0]!) / (gs * gs) : 0);
  const bank = Math.atan2(gs * w, G);
  const gamma = gs > 1 ? Math.atan2(v[2]!, gs) : 0;
  // (its load factor: its weight across the path and its turn's — a pull-up's share too)
  const aUp = a[2]! - (v[2]! * (a[0]! * v[0]! + a[1]! * v[1]! + a[2]! * v[2]!)) / Math.max(V * V, 1);
  const n = Math.hypot(Math.cos(gamma) + aUp / G, (gs * w) / G);
  const q = 0.5 * isaDensity(Math.max(0, alt)) * Math.max(V, 40) ** 2;
  const flaps = Math.max(0, Math.min(1, (115 - V) / 45)) * 1.1;
  const alpha = Math.max(-2, Math.min(12, (((n * wingLoad) / q - flaps) / 6) * (180 / Math.PI) - 1.5)) * (Math.PI / 180);
  return { bank, gamma, alpha, omega: w, n };
}
