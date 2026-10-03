// The flight computer's orbital operations about Gargantua itself — the same as about a planet
// (circularize, apoapsis, periapsis, Hohmann, inclination, resonance, the target's plane), but the
// two bodies here are a black hole and a test particle: the orbit is a Kerr geodesic, not a conic.
// Near the hole the conic is wrong (the periapsis precesses by tens of degrees a turn, the circular
// speed differs, nothing is stable inside the ISCO), so each burn is found on the real predictor:
// the apsides where the path has them, the Δv by bisection on what the path does after it (its
// opposite apsis, its radial period), the circular velocity where the free fall has no radial
// acceleration. Times in M (coordinate), Δv in c along prograde, normal, radial (maneuver.ts).

import { horizon, isco, type Vec3 } from "../physics";
import { toZamo, type Massive } from "../geodesic";
import {
  advanceTo,
  apsides,
  applyDv,
  circularBeta,
  matchDv,
  orbitNormal,
  pathFrom,
  planAlign,
  planeOffset,
  position,
  type KerrGoal,
  type ManeuverNode,
  type World,
} from "../maneuver";
import { len } from "../math/vec3";
import { t, tf } from "../i18n";

export interface KerrOp {
  ok: boolean;
  note: string;
  nodes: ManeuverNode[];
  /** the orbit after the burns, on the geodesics */
  after?: KerrOrbit;
}

/** An orbit as the path shows it: its apsides [M], their next times [M, absolute], its radial period
 *  (periapsis to periapsis) [M], its inclination to the equator [rad], its sense about the spin. */
export interface KerrOrbit {
  rNow: number;
  rp: number;
  ra: number;
  tPe: number;
  tAp: number;
  Tr: number;
  /** the orbital period: once round its plane [M] (a precessing orbit's periapsis comes later) */
  T: number;
  /** the periapsis's advance a radial period [rad] (0 for a circle) */
  advance: number;
  inc: number;
  prograde: boolean;
  /** the next equator crossings [M, absolute] */
  tNodes: number[];
  fate: "bound" | "escape" | "horizon";
}

const fail = (note: string): KerrOp => ({ ok: false, note, nodes: [] });

/** Kepler's semi-major axis from the state (G = M = 1): a guess at the orbit's size. */
function kepA(st: Massive, a: number): number {
  const b = toZamo(st, a);
  const v2 = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
  const inv = 2 / st.r - v2;
  return inv > 1e-9 ? 1 / inv : Infinity;
}

/** How far ahead to look for a turn's features [M]. */
function span(st: Massive, a: number, turns = 1.6): number {
  const A = kepA(st, a);
  return Number.isFinite(A) && A < 1e5 ? turns * 2 * Math.PI * Math.max(A, st.r) ** 1.5 + 30 : 40 * st.r ** 1.5;
}

/** The radial velocity's sign (the ZAMO's). */
const vr = (st: Massive, a: number) => toZamo(st, a)[0];

/**
 * The next periapsis or apoapsis after the state (strictly ahead), on the real path: the samples'
 * radius turning, then the radial velocity's zero by bisection. Null if there is none in a turn and a
 * half (an escape, a plunge).
 */
export function nextApsis(st0: Massive, w: World, kind: "pe" | "ap", turns = 1.6): Massive | null {
  const T = span(st0, w.a, turns);
  const n = 600;
  const p = pathFrom(st0, w, T, n);
  const r = [st0.r, ...p.pts.map(len)],
    t = [st0.t, ...p.times];
  for (let j = 1; j < r.length - 1; j++) {
    const turn = kind === "ap" ? r[j]! >= r[j - 1]! && r[j]! > r[j + 1]! : r[j]! <= r[j - 1]! && r[j]! < r[j + 1]!;
    if (!turn) continue;
    let sA = advanceTo(st0, t[j - 1]!, w);
    if (!sA) return null;
    // (outwards before an apoapsis, inwards before a periapsis)
    const before = kind === "ap" ? 1 : -1;
    let lo = t[j - 1]!,
      hi = t[j + 1]!;
    for (let it = 0; it < 40 && hi - lo > 1e-6 * Math.max(1, lo); it++) {
      const mid = (lo + hi) / 2;
      const sm = advanceTo(sA, mid, w);
      if (!sm) return null;
      if (Math.sign(vr(sm, w.a)) === before) (lo = mid), (sA = sm);
      else hi = mid;
    }
    return advanceTo(sA, (lo + hi) / 2, w);
  }
  return null;
}

/** The orbit a state is on, as its path shows it. */
export function kerrOrbit(st: Massive, w: World): KerrOrbit {
  const p = pathFrom(st, w, span(st, w.a, 2.2), 700);
  const r = [st.r, ...p.pts.map(len)],
    t = [st.t, ...p.times];
  const pos = [position(st), ...p.pts];
  const h = orbitNormal(st, w.a);
  const inc = Math.acos(Math.min(Math.max(h[2], -1), 1));
  const pe: number[] = [],
    ap: number[] = [],
    nodes: number[] = [];
  for (let j = 1; j < r.length - 1; j++) {
    if (r[j]! <= r[j - 1]! && r[j]! < r[j + 1]!) pe.push(j);
    if (r[j]! >= r[j - 1]! && r[j]! > r[j + 1]!) ap.push(j);
  }
  for (let j = 1; j < pos.length && nodes.length < 2; j++) {
    const z0 = pos[j - 1]![2],
      z1 = pos[j]![2];
    if (Math.sign(z0) !== Math.sign(z1)) nodes.push(t[j - 1]! + ((t[j]! - t[j - 1]!) * Math.abs(z0)) / (Math.abs(z0) + Math.abs(z1) || 1));
  }
  const fate = p.fate === "horizon" || p.fate === "star" ? "horizon" : ap.length ? "bound" : "escape";
  const lo = Math.min(...r),
    hi = Math.max(...r);
  const Tphi = turnTime(pos, t, h);
  // (a circle's apsides are the integrator's noise: no radial period, no advance)
  const round = hi - lo < 2e-3 * hi;
  const Tr = round ? NaN : pe.length > 1 ? t[pe[1]!]! - t[pe[0]!]! : ap.length > 1 ? t[ap[1]!]! - t[ap[0]!]! : NaN;
  return {
    rNow: st.r,
    rp: pe.length ? r[pe[0]!]! : lo,
    ra: ap.length ? r[ap[0]!]! : fate === "escape" ? Infinity : hi,
    tPe: pe.length ? t[pe[0]!]! : NaN,
    tAp: ap.length ? t[ap[0]!]! : NaN,
    Tr,
    T: Tphi,
    advance: Number.isFinite(Tr) && Number.isFinite(Tphi) ? 2 * Math.PI * (Tr / Tphi - 1) : 0,
    inc,
    prograde: h[2] * (w.a >= 0 ? 1 : -1) >= 0,
    tNodes: nodes,
    fate,
  };
}

/** The time to go once round the plane of normal h [M]: the angle about it unwrapped along the path,
 *  2π reached (interpolated). NaN if not within the path. */
function turnTime(pos: Vec3[], t: number[], h: Vec3): number {
  const e1 = pos[0]!,
    l1 = len(e1);
  const x: Vec3 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const y: Vec3 = [h[1] * x[2] - h[2] * x[1], h[2] * x[0] - h[0] * x[2], h[0] * x[1] - h[1] * x[0]];
  let prev = 0,
    acc = 0;
  for (let j = 1; j < pos.length; j++) {
    const q = pos[j]!;
    const ang = Math.atan2(q[0] * y[0] + q[1] * y[1] + q[2] * y[2], q[0] * x[0] + q[1] * x[1] + q[2] * x[2]);
    let d = ang - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    prev = ang;
    const next = acc + Math.abs(d);
    if (next >= 2 * Math.PI) return t[j - 1]! + ((t[j]! - t[j - 1]!) * (2 * Math.PI - acc)) / (next - acc || 1) - t[0]!;
    acc = next;
  }
  return NaN;
}

/** The path's far ("max") or near ("min") point [M] after a prograde Δv [c] (a retrograde one < 0);
 *  an escape: ∞ / its periapsis; into the hole: 0. */
function farNear(s: Massive, w: World, dv: number, side: "max" | "min", r2: number): number {
  const tT = Math.PI * ((s.r + r2) / 2) ** 1.5 * 1.35 + 50;
  const p = pathFrom(applyDv(s, [dv, 0, 0], w.a), w, tT, 240);
  if (p.fate === "escape" && side === "max") return Infinity;
  if (p.fate === "horizon" || p.fate === "star") return side === "max" ? Math.max(...p.pts.map(len)) : 0;
  const a = apsides(p);
  return side === "max" ? Math.max(a.rMax, s.r) : Math.min(a.rMin, s.r);
}

/**
 * The prograde Δv [c] (retrograde < 0) at a state that puts the path's far or near point at r2 —
 * either way: from an apoapsis the periapsis raised or lowered, from a periapsis the apoapsis.
 * Bisection on the real path (the point moves monotonically with the Δv: more prograde, both apsides
 * up), bracketed outwards from 0 in the sense that is needed. Null out of reach.
 */
export function apsisBurn(s: Massive, r2: number, w: World, side: "max" | "min"): number | null {
  if (side === "max" ? r2 < s.r : r2 > s.r) return null;
  const f = (dv: number) => farNear(s, w, dv, side, r2) - r2;
  const f0 = f(0);
  if (Math.abs(f0) < 1e-4 * r2) return 0;
  const sg = f0 < 0 ? 1 : -1;
  let lo = 0,
    hi = 0.003 * sg;
  while (Math.sign(f(hi)) !== sg) {
    lo = hi;
    hi *= 1.7;
    if (Math.abs(hi) > 0.6) return null;
  }
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(f(mid)) === sg) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** The orbital period of the geodesic through a state [M] (once round its plane; NaN unbound) — a
 *  shorter path than kerrOrbit's. */
export function orbitPeriod(st: Massive, w: World): number {
  const p = pathFrom(st, w, span(st, w.a, 1.3), 320);
  if (p.fate === "horizon" || p.fate === "star") return 0;
  return turnTime([position(st), ...p.pts], [st.t, ...p.times], orbitNormal(st, w.a));
}

/** The state a little after now: time to turn the ship before a burn "now". */
function soon(st0: Massive, w: World): Massive | null {
  const lead = Math.max(20, 0.03 * 2 * Math.PI * st0.r ** 1.5, w.lead ?? 0);
  return advanceTo(st0, st0.t + lead, w);
}

/** The innermost circular orbit the craft's sense allows (a margin over the ISCO). */
function rMinCircular(st: Massive, w: World): number {
  const pro = orbitNormal(st, w.a)[2] * (w.a >= 0 ? 1 : -1) >= 0;
  return Math.max(isco(pro ? Math.abs(w.a) : -Math.abs(w.a)) * 1.02, horizon(w.a) + 2);
}

/** Where a burn goes: now, the next periapsis or apoapsis. */
function burnAt(st0: Massive, w: World, where: "now" | "pe" | "ap"): Massive | null {
  const s = soon(st0, w);
  if (!s || where === "now") return s;
  return nextApsis(s, w, where);
}

function done(st0: Massive, w: World, nodes: ManeuverNode[], note: string): KerrOp {
  // (the orbit after: from the last burn, on the geodesics)
  let st: Massive | null = st0;
  for (const n of nodes) {
    st = advanceTo(st!, n.t, w);
    if (!st) return { ok: true, note, nodes };
    st = applyDv(st, n.dv, w.a);
  }
  return { ok: true, note, nodes, after: kerrOrbit(st!, w) };
}

/** An apsis burn's goal: the far side (the one the burn does not sit on) at r2. */
const apsisGoal = (s: Massive, r2: number, dv: number): KerrGoal => ({
  apsis: r2,
  side: r2 > s.r ? "max" : "min",
  dir: Math.sign(dv) || 1,
});

/** A circularizing burn's goal: the circular orbit where the craft is, steered to all along; then a
 *  correction if it ends off the radius. */
const circGoal = (s: Massive): KerrGoal => ({ circ: s.r, trim: true });

/** Circular where asked: the velocity made the circular orbit's there (tangential, the speed whose
 *  free fall has no radial acceleration). */
export function kCircularize(st0: Massive, w: World, where: "now" | "pe" | "ap"): KerrOp {
  const s = burnAt(st0, w, where);
  if (!s) return fail(where === "ap" ? t("No apoapsis ahead (an escape): burn now") : t("Not on this path (the hole first)"));
  if (s.r < rMinCircular(s, w)) return fail(tf("No stable circular orbit there: {0} M is inside the ISCO", s.r.toFixed(2)));
  const bc = circularBeta(s, w);
  if (!bc) return fail(t("Inside the photon orbit: no circular orbit"));
  return done(st0, w, [{ t: s.t, dv: matchDv(s, bc, w.a), goal: circGoal(s) }], tf("Circular at {0} M", s.r.toFixed(2)));
}

/** The apoapsis to r2: a prograde (retrograde) burn at the periapsis — the opposite apsis found on the
 *  real path by bisection. */
export function kApoapsis(st0: Massive, w: World, r2: number, where: "pe" | "now" = "pe"): KerrOp {
  const s = burnAt(st0, w, where) ?? burnAt(st0, w, "now");
  if (!s) return fail(t("Not on this path"));
  if (r2 <= s.r) return fail(tf("The apoapsis cannot be below the burn ({0} M)", s.r.toFixed(2)));
  const dv = apsisBurn(s, r2, w, r2 > s.r ? "max" : "min");
  if (dv === null) return fail(t("Out of reach (an escape before that)"));
  return done(st0, w, [{ t: s.t, dv: [dv, 0, 0], goal: apsisGoal(s, r2, dv) }], tf("Apoapsis {0} M", r2.toFixed(2)));
}

/** The periapsis to r2: a burn at the apoapsis — below the horizon, a plunge. */
export function kPeriapsis(st0: Massive, w: World, r2: number, where: "ap" | "now" = "ap"): KerrOp {
  const s = burnAt(st0, w, where) ?? burnAt(st0, w, "now");
  if (!s) return fail(t("Not on this path"));
  if (r2 >= s.r) return fail(tf("The periapsis cannot be above the burn ({0} M)", s.r.toFixed(2)));
  const dv = apsisBurn(s, r2, w, r2 > s.r ? "max" : "min");
  if (dv === null) return fail(t("Out of reach"));
  return done(
    st0,
    w,
    [{ t: s.t, dv: [dv, 0, 0], goal: r2 > horizon(w.a) ? apsisGoal(s, r2, dv) : undefined }],
    r2 <= horizon(w.a) ? t("Periapsis inside the horizon: a plunge") : tf("Periapsis {0} M", r2.toFixed(2)),
  );
}

/** Hohmann's transfer on the geodesics: from the periapsis to rise (the apoapsis to fall), the
 *  opposite apsis put at r2, circularized there. */
export function kHohmann(st0: Massive, w: World, r2: number): KerrOp {
  const s = soon(st0, w);
  if (!s) return fail(t("Not on this path"));
  const rMin = rMinCircular(s, w);
  if (r2 < rMin) return fail(tf("Inside the ISCO: the innermost stable circular orbit is {0} M", rMin.toFixed(2)));
  const o = kerrOrbit(s, w);
  if (o.fate !== "bound") return fail(t("Bound orbits only (circularize first)"));
  const up = r2 >= (o.rp + o.ra) / 2;
  const s1 = nextApsis(s, w, up ? "pe" : "ap") ?? s;
  if (Math.abs(r2 - s1.r) < 1e-3) return kCircularize(st0, w, up ? "pe" : "ap");
  const dv1 = apsisBurn(s1, r2, w, r2 > s1.r ? "max" : "min");
  if (dv1 === null) return fail(t("Out of reach"));
  const after = applyDv(s1, [dv1, 0, 0], w.a);
  const s2 = nextApsis(after, w, r2 > s1.r ? "ap" : "pe");
  if (!s2) return fail(t("The transfer never reaches its far apsis"));
  const bc = circularBeta(s2, w);
  if (!bc) return fail(t("No circular orbit there"));
  return done(
    st0,
    w,
    [
      { t: s1.t, dv: [dv1, 0, 0], goal: apsisGoal(s1, r2, dv1) },
      { t: s2.t, dv: matchDv(s2, bc, w.a), goal: circGoal(s2) },
    ],
    tf("Hohmann to {0} M circular", r2.toFixed(2)),
  );
}

/** The plane of inclination `inc` to the equator through the orbit's own line of nodes — the
 *  velocity turned into it (its speed and sense kept) at the cheaper crossing. */
export function kInclination(st0: Massive, w: World, inc: number): KerrOp {
  const s = soon(st0, w);
  if (!s) return fail(t("Not on this path"));
  const h = orbitNormal(s, w.a);
  const i0 = Math.acos(Math.min(Math.max(h[2], -1), 1));
  if (i0 < Math.PI / 2 !== inc < Math.PI / 2) return fail(t("That reverses the sense of motion about the spin: lower it to 90° first"));
  // (the node line k × h; equatorial: any — the x axis's)
  let l: Vec3 = [-h[1], h[0], 0];
  const ll = Math.hypot(l[0], l[1]);
  l = ll > 1e-6 ? [l[0] / ll, l[1] / ll, 0] : [1, 0, 0];
  // (h = k cos i₀ + m sin i₀, m = l × k: the new normal turned in the same plane)
  const m: Vec3 = [l[1], -l[0], 0];
  const n: Vec3 = [m[0] * Math.sin(inc), m[1] * Math.sin(inc), Math.cos(inc)];
  const res = planAlign(s, w, n, tf("the {0}° plane", ((inc * 180) / Math.PI).toFixed(1)));
  if (!res) return fail(tf("Already at {0}°", ((i0 * 180) / Math.PI).toFixed(2)));
  return done(
    st0,
    w,
    res.nodes.map((q) => ({ ...q, goal: { plane: n } })),
    tf("Inclination {0}° → {1}°", ((i0 * 180) / Math.PI).toFixed(1), ((inc * 180) / Math.PI).toFixed(1)),
  );
}

/** Into a plane of normal n (a target's orbit). */
export function kMatchPlane(st0: Massive, w: World, n: Vec3, name: string): KerrOp {
  const s = soon(st0, w);
  if (!s) return fail(t("Not on this path"));
  const off = planeOffset(s, w.a, n);
  const res = planAlign(s, w, n, name);
  if (!res) return fail(tf("Already in {0}", name));
  const nn = len(n);
  return done(
    st0,
    w,
    res.nodes.map((q) => ({ ...q, goal: { plane: [n[0] / nn, n[1] / nn, n[2] / nn] as Vec3 } })),
    tf("Planes matched ({0}° into {1})", ((off * 180) / Math.PI).toFixed(2), name),
  );
}

/** A resonant orbit: the period × k — the craft back where it is every k turns (a probe dropped each) —
 *  by a burn at the periapsis (now, for a circle), bisected on the period its geodesic has; flown to
 *  that period. */
export function kResonant(st0: Massive, w: World, k: number): KerrOp {
  const s0 = soon(st0, w);
  if (!s0) return fail(t("Not on this path"));
  const o0 = kerrOrbit(s0, w);
  if (o0.fate !== "bound" || !Number.isFinite(o0.T)) return fail(t("Bound orbits only"));
  const s = Number.isFinite(o0.Tr) ? (nextApsis(s0, w, "pe") ?? s0) : s0;
  const want = k * o0.T;
  const f = (dv: number) => {
    const T = orbitPeriod(applyDv(s, [dv, 0, 0], w.a), w);
    return (Number.isFinite(T) ? T : 1e12) - want;
  };
  const up = k > 1;
  let lo = 0,
    hi = up ? 0.002 : -0.002;
  while (up ? f(hi) < 0 : f(hi) > 0) {
    lo = hi;
    hi *= 1.7;
    if (Math.abs(hi) > 0.5) return fail(t("Out of reach"));
  }
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (up ? f(mid) >= 0 : f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const dv = (lo + hi) / 2;
  const o = kerrOrbit(applyDv(s, [dv, 0, 0], w.a), w);
  if (o.fate === "horizon" || o.rp < rMinCircular(s, w) * 0.9) return fail(t("That period dives too near the hole"));
  return done(
    st0,
    w,
    [{ t: s.t, dv: [dv, 0, 0], goal: { period: want, dir: Math.sign(dv) || 1 } }],
    tf("Resonant {0}:1 (period {1} M)", k.toFixed(2), want.toFixed(0)),
  );
}

/** In flight, a period goal's Δv still to give [c] along its sense: a Newton step on the period. */
export function periodLeft(st: Massive, w: World, g: { period: number; dir: number }, guess: number): number {
  const f = (dv: number) => {
    const T = orbitPeriod(applyDv(st, [g.dir * dv, 0, 0], w.a), w);
    return g.dir * ((Number.isFinite(T) ? T : 1e12) - g.period);
  };
  const x = Math.max(guess, 1e-7);
  const f1 = f(x);
  const x2 = x * 1.05;
  const slope = (f(x2) - f1) / (x2 - x);
  return slope > 0 ? Math.max(x - f1 / slope, 0) : x;
}

/**
 * In flight, a goal burn's Δv still to give [c] (along its sense, from the state now — part of it
 * already given): a Newton step on the path's far or near point from the last estimate (two paths,
 * ~25 ms). 0 when it is already there.
 */
export function apsisLeft(st: Massive, w: World, g: Extract<KerrGoal, { apsis: number }>, guess: number): number {
  const tT = Math.PI * ((st.r + g.apsis) / 2) ** 1.5 * 1.35 + 50;
  // (increasing with the Δv given along the goal's sense)
  const f = (dv: number) => {
    const p = pathFrom(applyDv(st, [g.dir * dv, 0, 0], w.a), w, tT, 240);
    if (p.fate === "escape") return g.dir > 0 ? Infinity : -Infinity;
    const a = apsides(p);
    return g.dir * ((g.side === "max" ? a.rMax : a.rMin) - g.apsis);
  };
  const x = Math.max(guess, 1e-7);
  const f1 = f(x);
  if (!Number.isFinite(f1)) return f1 > 0 ? x / 2 : x * 1.5;
  const x2 = x * 1.05;
  const slope = (f(x2) - f1) / (x2 - x);
  return slope > 0 ? Math.max(x - f1 / slope, 0) : x;
}

/** In flight, a circularizing burn's Δv still to give [c, prograde-normal-radial]: to the circular
 *  orbit's velocity where the craft is (null inside the photon orbit). */
export function circLeft(st: Massive, w: World): Vec3 | null {
  const bc = circularBeta(st, w);
  return bc ? matchDv(st, bc, w.a) : null;
}

/**
 * In flight, a plane change's thrust: the angular momentum h = r × v turned onto the plane's normal
 * (its size and sense kept) by an acceleration along Δh × r — the torque that makes it. Only the
 * turn: Δh's part along h dropped (else, a quarter turn from the nodes, where no torque turns the
 * plane, all that is left is a brake). Its direction (local ZAMO), the Δv still to give [c] (the
 * angle off the plane × the speed), and how much of a thrust here turns the plane (0 … 1: 1 at the
 * nodes) — the burn coasts where little does.
 */
export function planeLeft(st: Massive, w: World, n: Vec3): { dir: Vec3; left: number; eff: number } {
  const r = position(st);
  const s = Math.sin(st.th),
    c = Math.cos(st.th),
    sp = Math.sin(st.ph),
    cp = Math.cos(st.ph);
  const er: Vec3 = [s * cp, s * sp, c],
    et: Vec3 = [c * cp, c * sp, -s],
    ep: Vec3 = [-sp, cp, 0];
  const b = toZamo(st, w.a);
  const V: Vec3 = [
    er[0] * b[0] + et[0] * b[1] + ep[0] * b[2],
    er[1] * b[0] + et[1] * b[1] + ep[1] * b[2],
    er[2] * b[0] + et[2] * b[1] + ep[2] * b[2],
  ];
  const cr = (a: Vec3, q: Vec3): Vec3 => [a[1] * q[2] - a[2] * q[1], a[2] * q[0] - a[0] * q[2], a[0] * q[1] - a[1] * q[0]];
  const dt = (a: Vec3, q: Vec3) => a[0] * q[0] + a[1] * q[1] + a[2] * q[2];
  const h = cr(r, V);
  const hl = len(h) || 1;
  const hh: Vec3 = [h[0] / hl, h[1] / hl, h[2] / hl];
  const sg = Math.sign(dt(h, n)) || 1;
  // (the turn: ĥ → n̂, as a vector across ĥ)
  const t: Vec3 = [n[0] * sg, n[1] * sg, n[2] * sg];
  const k0 = dt(t, hh);
  const turn: Vec3 = [t[0] - hh[0] * k0, t[1] - hh[1] * k0, t[2] - hh[2] * k0];
  const tl = len(turn);
  const ang = Math.atan2(tl, k0);
  if (tl < 1e-12) return { dir: [0, 0, 1], left: 0, eff: 0 };
  // (its part across r: what a thrust here turns)
  const rr = dt(r, r);
  const k = dt(r, turn) / rr;
  const tp: Vec3 = [turn[0] - r[0] * k, turn[1] - r[1] * k, turn[2] - r[2] * k];
  const a = cr(tp, r);
  const al = len(a) || 1;
  const d: Vec3 = [a[0] / al, a[1] / al, a[2] / al];
  return { dir: [dt(d, er), dt(d, et), dt(d, ep)], left: ang * len(V), eff: len(tp) / tl };
}
