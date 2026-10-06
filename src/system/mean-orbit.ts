// An orbit on rails as the flight's own gravity flies it (our-coast.ts railsCoast): a craft coasting a
// stable orbit at high warp is moved a large part of a turn per frame — too far for the integrator's steps
// at a frame's cost — and a Kepler orbit from its osculating state, turned by the oblateness's secular
// drift, ran off the flight's physics by ~50 km a turn in a low Earth orbit (its osculating period is not
// its mean one: the J2's short-period terms), and no rendezvous could be exact.
//
// Here the orbit is flown once by the integrator itself (coastHome, a turn in 128 steps) from the state the
// rails take over: its equinoctial elements (no singularity for the circular, equatorial orbits most craft
// fly) give their mean values and secular trends — the mean motion fitted, every pull the flight feels in
// it (J2–J4, the Moon, the Sun, the thin air) — and a table of the short-period terms against the mean
// argument of latitude. Then any time on: the mean elements carried by their trends (the node and the
// periapsis turned at the J2's secular rates), the table's terms added back, the state the flight's own.
// A model is built at the state it is asked from, kept while each call starts from the state it gave
// (none in between: no burn, no other force), rebuilt after a few turns as its fit ages.
import type { Vec3 } from "../physics";
import { secularRates, ZONAL } from "./geopotential";
import { ourState } from "./our-side";
import { poleOfDate } from "./geopotential";

/** Equinoctial elements: a, ef = e cos(ω+Ω), eg = e sin(ω+Ω), p = tan(i/2) sin Ω, q = tan(i/2) cos Ω, λ the mean longitude. */
export interface Equinoctial {
  a: number;
  ef: number;
  eg: number;
  p: number;
  q: number;
  lam: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const TAU = 2 * Math.PI;

/** The equinoctial frame's axes (f̂, ĝ) for p, q (Broucke & Cefola). */
function axes(p: number, q: number): [Vec3, Vec3] {
  const s = 1 + p * p + q * q;
  return [
    [(1 - p * p + q * q) / s, (2 * p * q) / s, (-2 * p) / s],
    [(2 * p * q) / s, (1 + p * p - q * q) / s, (2 * q) / s],
  ];
}

/** Elements of the state (r, v) about a body of μ, in a frame whose z is its pole (prograde orbits). */
export function toEquinoctial(mu: number, r: Vec3, v: Vec3): Equinoctial {
  const R = norm(r);
  const a = 1 / (2 / R - dot(v, v) / mu);
  const h = cross(r, v);
  const hn = norm(h);
  const w: Vec3 = [h[0] / hn, h[1] / hn, h[2] / hn];
  const p = w[0] / (1 + w[2]),
    q = -w[1] / (1 + w[2]);
  const [f, g] = axes(p, q);
  // (the eccentricity vector)
  const vh = cross(v, h);
  const e: Vec3 = [vh[0] / mu - r[0] / R, vh[1] / mu - r[1] / R, vh[2] / mu - r[2] / R];
  const ef = dot(e, f),
    eg = dot(e, g);
  const X1 = dot(r, f),
    Y1 = dot(r, g);
  const beta = Math.sqrt(Math.max(1 - ef * ef - eg * eg, 0));
  const b = 1 / (1 + beta);
  const sinF = eg + ((1 - eg * eg * b) * Y1 - ef * eg * b * X1) / (a * beta);
  const cosF = ef + ((1 - ef * ef * b) * X1 - ef * eg * b * Y1) / (a * beta);
  const F = Math.atan2(sinF, cosF);
  return { a, ef, eg, p, q, lam: F + eg * Math.cos(F) - ef * Math.sin(F) };
}

/** The state (r, v) of the elements, about a body of μ (the frame of toEquinoctial). */
export function fromEquinoctial(mu: number, E: Equinoctial): { r: Vec3; v: Vec3 } {
  const { a, ef, eg, p, q } = E;
  // (Kepler's equation in the eccentric longitude F: λ = F + eg cos F − ef sin F)
  const lam = E.lam;
  let F = lam;
  for (let k = 0; k < 30; k++) {
    const c = Math.cos(F),
      s = Math.sin(F);
    const dF = (F + eg * c - ef * s - lam) / (1 - eg * s - ef * c);
    F -= dF;
    if (Math.abs(dF) < 1e-15) break;
  }
  const c = Math.cos(F),
    s = Math.sin(F);
  const beta = Math.sqrt(Math.max(1 - ef * ef - eg * eg, 0));
  const b = 1 / (1 + beta);
  const X1 = a * ((1 - eg * eg * b) * c + ef * eg * b * s - ef);
  const Y1 = a * ((1 - ef * ef * b) * s + ef * eg * b * c - eg);
  const n = Math.sqrt(mu / (a * a * a));
  const R = a * (1 - ef * c - eg * s);
  const k = (a * a * n) / R;
  const Xd = k * (ef * eg * b * c - (1 - eg * eg * b) * s);
  const Yd = k * ((1 - ef * ef * b) * c - ef * eg * b * s);
  const [f, g] = axes(p, q);
  return {
    r: [X1 * f[0] + Y1 * g[0], X1 * f[1] + Y1 * g[1], X1 * f[2] + Y1 * g[2]],
    v: [Xd * f[0] + Yd * g[0], Xd * f[1] + Yd * g[1], Xd * f[2] + Yd * g[2]],
  };
}

/** A frame (x, y, z) whose z is the given pole — the elements' — and its maps from and to it. */
function poleFrame(z: Vec3) {
  const zz = (() => {
    const l = norm(z);
    return [z[0] / l, z[1] / l, z[2] / l] as Vec3;
  })();
  const ref: Vec3 = Math.abs(zz[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x0 = cross(ref, zz);
  const xl = norm(x0);
  const x: Vec3 = [x0[0] / xl, x0[1] / xl, x0[2] / xl];
  const y = cross(zz, x);
  return {
    into: (v: Vec3): Vec3 => [dot(v, x), dot(v, y), dot(v, zz)],
    out: (v: Vec3): Vec3 => [
      v[0] * x[0] + v[1] * y[0] + v[2] * zz[0],
      v[0] * x[1] + v[1] * y[1] + v[2] * zz[1],
      v[0] * x[2] + v[1] * y[2] + v[2] * zz[2],
    ],
  };
}

/** The short-period table's samples over a turn. */
const N = 128;

export interface MeanOrbit {
  ref: string;
  mu: number;
  t0: number;
  /** the turn's own period: the osculating argument of latitude round once [M] — the short-period terms' */
  period: number;
  /** the mean motion [rad per M]: λ's advance over that turn; its change as the air lowers the orbit
   *  (Kepler's third law on a's trend: ṅ = −3/2 n ȧ/a) */
  n: number;
  ndot: number;
  /** the mean elements at t0, a's trend (the air's decay) */
  mean: Equinoctial;
  adot: number;
  /** the secular turns: the node (measured over the turn), the periapsis (the J2's) [rad per M], and what
   *  the eccentricity vector drifts besides (measured) [per M] */
  node: number;
  peri: number;
  edot: [number, number];
  /** the short-period terms of a, ef, eg, p, q, λ at N even times of the turn from t0 */
  table: Float64Array[];
  frame: ReturnType<typeof poleFrame>;
}

/** The integrator's fall over dt (coastHome, never on rails). */
type Coast = (X: Vec3, V: Vec3, t: number, dt: number) => { X: Vec3; V: Vec3 };

/** Cubic (Catmull–Rom) through samples at even steps, at a fractional index (clamped at the ends). */
function cubicAt(y: ArrayLike<number>, x: number): number {
  const n = y.length;
  const i = Math.min(Math.max(Math.floor(x), 0), n - 2),
    w = x - i;
  const at = (k: number) => y[Math.min(Math.max(k, 0), n - 1)]!;
  const p0 = at(i - 1),
    p1 = at(i),
    p2 = at(i + 1),
    p3 = at(i + 2);
  return p1 + 0.5 * w * (p2 - p0 + w * (2 * p0 - 5 * p1 + 4 * p2 - p3 + w * (3 * (p1 - p2) + p3 - p0)));
}

/**
 * The mean orbit of a craft at (X, V, t0) about `ref` (μ), from a turn flown by `coast` (the integrator):
 * the turn's own period — the osculating argument of latitude round once, over which the short-period
 * terms repeat —, the mean motion as λ's advance over it (those terms cancelling exactly), the mean
 * elements as their averages over it, and the terms themselves tabulated at N even times of it.
 */
export function buildMeanOrbit(ref: string, mu: number, X: Vec3, V: Vec3, t0: number, coast: Coast): MeanOrbit {
  const frame = poleFrame(ZONAL[ref] ? poleOfDate(ref, t0) : [0, 0, 1]);
  const rel = (Xh: Vec3, Vh: Vec3, t: number) => {
    const B = ourState(ref, t);
    return {
      r: frame.into([Xh[0] - B.pos[0], Xh[1] - B.pos[1], Xh[2] - B.pos[2]]),
      v: frame.into([Vh[0] - B.vel[0], Vh[1] - B.vel[1], Vh[2] - B.vel[2]]),
    };
  };
  const s0 = rel(X, V, t0);
  const P0 = TAU * Math.sqrt(toEquinoctial(mu, s0.r, s0.v).a ** 3 / mu);
  // (a turn and a little more, in steps of P0/N: the samples' elements and osculating arguments of latitude)
  const h = P0 / N;
  const M = N + 12;
  const cols = Array.from({ length: 6 }, () => new Float64Array(M + 1));
  const u = new Float64Array(M + 1);
  let S = { X, V };
  for (let k = 0; k <= M; k++) {
    if (k > 0) S = coast(S.X, S.V, t0 + (k - 1) * h, h);
    const st = rel(S.X, S.V, t0 + k * h);
    const E = toEquinoctial(mu, st.r, st.v);
    // (the argument of latitude: from the ascending node, in the orbit's plane)
    const w = cross(st.r, st.v);
    const nd = cross([0, 0, 1], w);
    const ndl = norm(nd) || 1;
    const nn: Vec3 = [nd[0] / ndl, nd[1] / ndl, nd[2] / ndl];
    const wl = norm(w);
    const yy = cross([w[0] / wl, w[1] / wl, w[2] / wl], nn);
    let uk = Math.atan2(dot(st.r, yy), dot(st.r, nn));
    if (k > 0) {
      uk += TAU * Math.round((u[k - 1]! - uk) / TAU);
      E.lam += TAU * Math.round((cols[5]![k - 1]! - E.lam) / TAU);
    }
    u[k] = uk;
    const vals = [E.a, E.ef, E.eg, E.p, E.q, E.lam];
    for (let c = 0; c < 6; c++) cols[c]![k] = vals[c]!;
  }
  // (the turn's end: u back to its start plus a turn — a root between two samples, refined on the cubic)
  const goal = u[0]! + TAU;
  let j = 1;
  while (j < M && u[j]! < goal) j++;
  let x = j - 1 + (goal - u[j - 1]!) / (u[j]! - u[j - 1]!);
  for (let it = 0; it < 4; it++) {
    const f = cubicAt(u, x) - goal;
    const d = (cubicAt(u, x + 1e-4) - cubicAt(u, x - 1e-4)) / 2e-4;
    x -= f / d;
  }
  const period = x * h;
  // (the mean motion: λ's advance over the turn; a's trend: its change over it — the air's decay)
  const n = (cubicAt(cols[5]!, x) - cols[5]![0]!) / period;
  const adot = (cubicAt(cols[0]!, x) - cols[0]![0]!) / period;
  // (the mean elements: averages over the turn — Simpson's rule on N even times of it)
  const even = (c: number) => Array.from({ length: N + 1 }, (_, k) => cubicAt(cols[c]!, (k * x) / N));
  const avg = (y: number[]) => {
    let sum = y[0]! + y[N]!;
    for (let k = 1; k < N; k++) sum += (k % 2 ? 4 : 2) * y[k]!;
    return sum / (3 * N);
  };
  const ys = [0, 1, 2, 3, 4].map(even);
  const mean: Equinoctial = {
    // (a's average is at mid-turn: taken back to t0 by its trend)
    a: avg(ys[0]!) - (adot * period) / 2,
    ef: avg(ys[1]!),
    eg: avg(ys[2]!),
    p: avg(ys[3]!),
    q: avg(ys[4]!),
    lam: cols[5]![0]!,
  };
  // (the node and the periapsis turn at the J2's secular rates, on the mean elements)
  const z0 = ZONAL[ref];
  const e = Math.hypot(mean.ef, mean.eg);
  const t2 = mean.p * mean.p + mean.q * mean.q;
  const cosI = (1 - t2) / (1 + t2);
  const rates = z0 ? secularRates(mu, z0, mean.a, e, cosI) : { node: 0, peri: 0, mean: 0 };
  // (the node's turn measured over the turn — p, q's short-period terms back where they started: a first-
  // order J2 rate 1 % off drifts hundreds of metres a turn across the orbit)
  const end = (c: number) => cubicAt(cols[c]!, x);
  let dOm = Math.atan2(end(3), end(4)) - Math.atan2(cols[3]![0]!, cols[4]![0]!);
  dOm -= TAU * Math.round(dOm / TAU);
  const node = Math.hypot(mean.p, mean.q) > 1e-9 ? dOm / period : rates.node;
  const m: MeanOrbit = {
    ref,
    mu,
    t0,
    period,
    n,
    ndot: (-1.5 * n * adot) / mean.a,
    mean,
    adot,
    node,
    peri: rates.peri,
    edot: [0, 0],
    table: [],
    frame,
  };
  // (the eccentricity vector: turned at the periapsis's and the node's rates, and what it drifts besides
  // over the turn — the Moon's, the Sun's pulls — measured)
  const turned = meanAt(m, period);
  // (the start's terms as they come back a turn on: turned with the node, as the table reads them)
  const [d0f, d0g] = turn(cols[1]![0]! - mean.ef, cols[2]![0]! - mean.eg, node * period);
  m.edot = [(end(1) - d0f - turned.ef) / period, (end(2) - d0g - turned.eg) / period];
  // (the short-period terms: the turn's elements at N even times less the mean model there; λ's mean at t0
  // is set so that its term averages to zero over the turn)
  const ylam = even(5);
  const lamTerms = ylam.map((v, k) => v - (cols[5]![0]! + (n * k * period) / N));
  m.mean.lam += avg(lamTerms);
  // (the vector terms — e's (ef, eg), the plane's (p, q) — kept in a frame turning with the node: their
  // pattern is the orbit's, turned with it; read back turned by the node since t0 — else, a turn on, the
  // terms of an orbit 0.005 rad of node behind: a 30 m step across it)
  m.table = Array.from({ length: 6 }, () => new Float64Array(N));
  for (let k = 0; k < N; k++) {
    const tk = (k * period) / N;
    const Mk = meanAt(m, tk);
    const E = [ys[0]![k]!, ys[1]![k]!, ys[2]![k]!, ys[3]![k]!, ys[4]![k]!, ylam[k]!];
    const Mv = [Mk.a, Mk.ef, Mk.eg, Mk.p, Mk.q, Mk.lam];
    const d = E.map((v, c) => v - Mv[c]!);
    const [ef, eg] = turn(d[1]!, d[2]!, -node * tk);
    const [pp, qq] = turnPQ(d[3]!, d[4]!, -node * tk);
    const row = [d[0]!, ef, eg, pp, qq, d[5]!];
    for (let c = 0; c < 6; c++) m.table[c]![k] = row[c]!;
  }
  return m;
}

/** The short-period terms at t: the table at the time's place in the turn, a periodic cubic between its samples. */
function shortPeriod(m: MeanOrbit, t: number): number[] {
  const f = (t - m.t0) / m.period;
  const x = (f - Math.floor(f)) * N;
  const i = Math.floor(x),
    w = x - i;
  return m.table.map((col) => {
    const at = (k: number) => col[((k % N) + N) % N]!;
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    return p1 + 0.5 * w * (p2 - p0 + w * (2 * p0 - 5 * p1 + 4 * p2 - p3 + w * (3 * (p1 - p2) + p3 - p0)));
  });
}

/** The mean elements at t0 + dt: a and λ by their trends, the node and the periapsis by the J2's rates. */
function meanAt(m: MeanOrbit, dt: number): Equinoctial {
  const M = m.mean;
  const dNode = m.node * dt,
    dPeri = (m.peri + m.node) * dt;
  const cN = Math.cos(dNode),
    sN = Math.sin(dNode),
    cP = Math.cos(dPeri),
    sP = Math.sin(dPeri);
  // (the eccentricity vector's measured drift is a turn's slope of terms that swing over weeks — the
  // Moon's, J3's: right for a few turns, wrong extrapolated over hundreds, where it once grew a 394 × 397 km
  // orbit to 290 × 507 in a minute at ×16 million — held at its 15 turns' worth)
  const de = Math.max(-15 * m.period, Math.min(dt, 15 * m.period));
  return {
    a: M.a + m.adot * dt,
    ef: M.ef * cP - M.eg * sP + m.edot[0] * de,
    eg: M.ef * sP + M.eg * cP + m.edot[1] * de,
    p: M.p * cN + M.q * sN,
    q: M.q * cN - M.p * sN,
    lam: M.lam + m.n * dt + 0.5 * m.ndot * dt * dt,
  };
}

/** (ef, eg) turned by an angle (the e vector's components: ef along, eg across). */
function turn(f: number, g: number, ang: number): [number, number] {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  return [f * c - g * s, f * s + g * c];
}

/** (p, q) turned by a node's angle: p = tan(i/2) sin Ω, q = tan(i/2) cos Ω. */
function turnPQ(p: number, q: number, ang: number): [number, number] {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  return [p * c + q * s, q * c - p * s];
}

/** The osculating elements at t on the mean orbit (the mean ones, the short-period terms added — turned with the node). */
export function meanOrbitElements(m: MeanOrbit, t: number): Equinoctial {
  const dt = t - m.t0;
  const M = meanAt(m, dt);
  const d = shortPeriod(m, t);
  const [ef, eg] = turn(d[1]!, d[2]!, m.node * dt);
  const [pp, qq] = turnPQ(d[3]!, d[4]!, m.node * dt);
  return { a: M.a + d[0]!, ef: M.ef + ef, eg: M.eg + eg, p: M.p + pp, q: M.q + qq, lam: M.lam + d[5]! };
}

/** The craft's state at t (home frame) on the mean orbit. */
export function meanOrbitState(m: MeanOrbit, t: number): { X: Vec3; V: Vec3 } {
  const s = fromEquinoctial(m.mu, meanOrbitElements(m, t));
  const B = ourState(m.ref, t);
  const r = m.frame.out(s.r),
    v = m.frame.out(s.v);
  return { X: [B.pos[0] + r[0], B.pos[1] + r[1], B.pos[2] + r[2]], V: [B.vel[0] + v[0], B.vel[1] + v[1], B.vel[2] + v[2]] };
}
