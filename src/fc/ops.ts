// The flight computer's operations: each a sequence of impulsive burns — when (seconds from now) and
// how much along the orbit's prograde, normal and radial directions at that moment (m/s) — found with
// two bodies (fc/kepler.ts) about the body whose sphere the craft is in. The universes' own planners
// then refine and fly them (our side's n-body predictor and node executor; Gargantua's worlds, their
// frames).

import {
  add,
  closestApproach,
  cross,
  dot,
  elements,
  fromPNR,
  lambert,
  len,
  nodesAgainst,
  nuAtRadius,
  phaseAngle,
  propagate,
  relInclination,
  scale,
  stateAt,
  synodic,
  timeTo,
  toPNR,
  unit,
  visViva,
  type Elements,
  type V3,
} from "./kepler";

export interface Burn {
  /** seconds from now */
  t: number;
  /** prograde, normal, radial [m/s] (the orbit at that moment) */
  dv: V3;
  label: string;
  /** about Gargantua: what the burn is flown to (maneuver.ts ManeuverNode.goal) */
  goal?:
    | { apsis: number; side: "max" | "min"; dir: number }
    | { circ: number; trim?: boolean }
    | { plane: V3 }
    | { period: number; dir: number };
}

export interface Porkchop {
  /** departures [s from now] and times of flight [s]; Δv [m/s] per departure (rows) and flight (columns) */
  dep: number[];
  tof: number[];
  dv: number[][];
  best: { i: number; j: number };
}

export interface OpResult {
  ok: boolean;
  note: string;
  burns: Burn[];
  dvTotal: number;
  /** the orbit after the burns (two bodies) */
  after?: Elements;
  /** about Gargantua itself: the orbit after, on the geodesics, as text */
  afterText?: string;
  /** a mission to another body (the MISSION tab): adopted whole — its re-aims in flight with it */
  mission?: boolean;
  grid?: Porkchop;
}

/** What the operations work from: the body's GM and radius, the craft's state, the body's pole, a
 *  target (a craft or a moon about the same body), all in the same body-centred axes, SI. */
export interface FcContext {
  mu: number;
  R: number;
  r: V3;
  v: V3;
  pole?: V3;
  target?: { r: V3; v: V3; name: string };
}

const fail = (note: string): OpResult => ({ ok: false, note, burns: [], dvTotal: 0 });

/** The burns applied in turn (Kepler between them): the orbit after them. */
export function afterBurns(c: FcContext, burns: Burn[]): { r: V3; v: V3; t: number } {
  let s = { r: c.r, v: c.v },
    t = 0;
  for (const b of burns) {
    s = propagate(c.mu, s.r, s.v, b.t - t);
    t = b.t;
    s = { r: s.r, v: add(s.v, fromPNR(s.r, s.v, b.dv)) };
  }
  return { ...s, t };
}

function result(c: FcContext, burns: Burn[], note: string, grid?: Porkchop): OpResult {
  const a = afterBurns(c, burns);
  return { ok: true, note, burns, dvTotal: burns.reduce((x, b) => x + len(b.dv), 0), after: elements(c.mu, a.r, a.v, c.pole), grid };
}

/** The state at a time from now, and its elements. */
const at = (c: FcContext, t: number) => {
  const s = propagate(c.mu, c.r, c.v, t);
  return s;
};

/** Where to burn: now, at the next periapsis / apoapsis, or at a height (the next passage through it). */
export type Where = "now" | "pe" | "ap" | { r: number };
function timeAt(el: Elements, w: Where): number {
  if (w === "now") return 0;
  if (w === "pe") return timeTo(el, 0);
  if (w === "ap") return el.e < 1 ? timeTo(el, Math.PI) : Infinity;
  const nu = nuAtRadius(el, w.r);
  if (Number.isNaN(nu)) return Infinity;
  return Math.min(timeTo(el, nu), timeTo(el, -nu + 2 * Math.PI));
}

/** Circularize where asked (the speed made circular, the flight path levelled). */
export function circularize(c: FcContext, where: Where): OpResult {
  const el = elements(c.mu, c.r, c.v, c.pole);
  const t = timeAt(el, where);
  if (!Number.isFinite(t)) return fail("Not on this orbit (it never gets there)");
  const s = at(c, t);
  const r = len(s.r);
  const up = unit(s.r);
  const h = unit(cross(s.r, s.v));
  const want = scale(unit(cross(h, up)), Math.sqrt(c.mu / r));
  const dv = add(want, s.v, -1);
  return result(c, [{ t, dv: toPNR(s.r, s.v, dv), label: "circularize" }], `Circular at ${((r - c.R) / 1e3).toFixed(0)} km`);
}

/** The apoapsis to a distance: a prograde (retrograde) burn at the periapsis, or now. */
export function setApoapsis(c: FcContext, ra: number, where: Where = "pe"): OpResult {
  const el = elements(c.mu, c.r, c.v, c.pole);
  const t = timeAt(el, where);
  if (!Number.isFinite(t)) return fail("No periapsis ahead");
  const s = at(c, t);
  const r = len(s.r);
  if (ra < r) return fail("The apoapsis cannot be below where the burn is");
  // (a horizontal-speed change: the new orbit's other apsis at ra)
  const up = unit(s.r);
  const vr = dot(s.v, up);
  const vt = len(add(s.v, up, -vr));
  const h2 = (2 * c.mu * r * ra) / (r + ra);
  const vtWant = Math.sqrt(h2) / r;
  return result(
    c,
    [{ t, dv: toPNR(s.r, s.v, scale(unit(add(s.v, up, -vr)), vtWant - vt)), label: "apoapsis" }],
    `Apoapsis ${((ra - c.R) / 1e3).toFixed(0)} km`,
  );
}

/** The periapsis to a distance: a burn at the apoapsis, or now. */
export function setPeriapsis(c: FcContext, rp: number, where: Where = "ap"): OpResult {
  const el = elements(c.mu, c.r, c.v, c.pole);
  const t = timeAt(el, where);
  if (!Number.isFinite(t)) return fail("No apoapsis ahead (an escape): burn now");
  const s = at(c, t);
  const r = len(s.r);
  if (rp > r) return fail("The periapsis cannot be above where the burn is");
  const up = unit(s.r);
  const vr = dot(s.v, up);
  const vt = len(add(s.v, up, -vr));
  const h2 = (2 * c.mu * r * rp) / (r + rp);
  const vtWant = Math.sqrt(h2) / r;
  return result(
    c,
    [{ t, dv: toPNR(s.r, s.v, scale(unit(add(s.v, up, -vr)), vtWant - vt)), label: "periapsis" }],
    `Periapsis ${((rp - c.R) / 1e3).toFixed(0)} km`,
  );
}

/** Hohmann's transfer to a circular orbit of radius r2: the first burn at the apsis from which it goes
 *  (periapsis to rise, apoapsis to fall), the second at the other end. */
export function hohmann(c: FcContext, r2: number): OpResult {
  const el = elements(c.mu, c.r, c.v, c.pole);
  if (el.e >= 1) return fail("Bound orbits only");
  const up = r2 > el.ra;
  const b1 = up ? setApoapsis(c, r2, "pe") : setPeriapsis(c, r2, "ap");
  if (!b1.ok) return b1;
  const s1 = afterBurns(c, b1.burns);
  const c1: FcContext = { ...c, r: s1.r, v: s1.v };
  const b2 = circularize(c1, up ? "ap" : "pe");
  if (!b2.ok) return b2;
  const burns = [b1.burns[0]!, { ...b2.burns[0]!, t: b2.burns[0]!.t + s1.t, label: "circularize" }];
  return result(c, burns, `Hohmann to ${((r2 - c.R) / 1e3).toFixed(0)} km circular`);
}

/** The orbit's plane turned to an inclination (against the body's equator) at the cheaper node
 *  (the farther: slower). */
export function setInclination(c: FcContext, inc: number): OpResult {
  const k = c.pole ?? [0, 0, 1];
  const el = elements(c.mu, c.r, c.v, k);
  const nd = nodesAgainst(el, k);
  if (!nd) return fail("Equatorial: no node to turn the plane at");
  const choose = [nd.an, nd.dn].map((nu) => ({ nu, t: timeTo(el, nu), r: len(stateAt(el, nu).r) }));
  const pick = choose.sort((a, b) => b.r - a.r)[0]!;
  const s = at(c, pick.t);
  // the velocity turned about the radius (the node line) to the new inclination
  const W = unit(cross(s.r, s.v));
  const cur = Math.acos(Math.min(Math.max(dot(W, k), -1), 1));
  // (the velocity turned about the radius — the node line — one way or the other: the one that gives it)
  const axis = unit(s.r);
  const incOf = (vv: V3) => Math.acos(Math.min(Math.max(dot(unit(cross(s.r, vv)), k), -1), 1));
  const vA = rot(s.v, axis, inc - cur),
    vB = rot(s.v, axis, cur - inc);
  const vN = Math.abs(incOf(vA) - inc) < Math.abs(incOf(vB) - inc) ? vA : vB;
  return result(
    c,
    [{ t: pick.t, dv: toPNR(s.r, s.v, add(vN, s.v, -1)), label: "plane change" }],
    `Inclination ${((inc * 180) / Math.PI).toFixed(1)}°`,
  );
}

/** The orbit's plane onto the target's: at the nearer of their relative nodes (the farther from the
 *  body if both are close: cheaper). */
export function matchPlanes(c: FcContext): OpResult {
  if (!c.target) return fail("No target");
  const el = elements(c.mu, c.r, c.v, c.pole);
  const hT = unit(cross(c.target.r, c.target.v));
  const nd = nodesAgainst(el, hT);
  if (!nd) return fail("Already in the target's plane");
  const opts = [nd.an, nd.dn].map((nu) => ({ nu, t: timeTo(el, nu), r: len(stateAt(el, nu).r) }));
  const pick = opts.sort((a, b) => a.t - b.t)[0]!;
  const s = at(c, pick.t);
  // the velocity's part along the target's normal removed, its size kept
  const v = s.v;
  const vIn = add(v, hT, -dot(v, hT));
  const vN = scale(unit(vIn), len(v));
  const ri = relInclination(cross(c.r, c.v), hT);
  return result(
    c,
    [{ t: pick.t, dv: toPNR(s.r, s.v, add(vN, v, -1)), label: pick.nu === nd.an ? "AN" : "DN" }],
    `Planes matched (${((ri * 180) / Math.PI).toFixed(2)}° at the ${pick.nu === nd.an ? "ascending" : "descending"} node)`,
  );
}

/** A resonant orbit: the period × k (the apoapsis changed at the periapsis) — the craft back where it is
 *  every k turns, a probe dropped each. */
export function resonant(c: FcContext, k: number): OpResult {
  const el = elements(c.mu, c.r, c.v, c.pole);
  if (el.e >= 1) return fail("Bound orbits only");
  const a2 = el.a * Math.cbrt(k * k);
  const ra = 2 * a2 - el.rp;
  if (ra < el.rp) return fail("That period would need a lower periapsis");
  const r = setApoapsis(c, ra, "pe");
  return { ...r, note: `Resonant ${k.toFixed(2)}:1 (period ${((el.T * k) / 60).toFixed(0)} min)` };
}

/**
 * A transfer to the target (same body): the porkchop — departures over a synodic period (or two
 * orbits), flights from a quarter to one and a half of Hohmann's — each a Lambert arc, its cost the
 * departure's burn plus the arrival's velocity match (rendezvous) or the departure alone (intercept);
 * the best kept.
 */
export function transfer(c: FcContext, o: { rendezvous: boolean; nDep?: number; nTof?: number } = { rendezvous: true }): OpResult {
  const T = c.target;
  if (!T) return fail("No target");
  const elS = elements(c.mu, c.r, c.v, c.pole),
    elT = elements(c.mu, T.r, T.v, c.pole);
  if (elS.e >= 1 || elT.e >= 1) return fail("Bound orbits only");
  // (departures over a whole synodic period — the phase comes round once in it —, at most a month;
  // a step no more than a twelfth of the craft's orbit)
  const span = Math.min(Math.max(1.05 * synodic(elS.T, elT.T), elS.T), 30 * 86400);
  const aH = (elS.a + elT.a) / 2;
  const tH = Math.PI * Math.sqrt(aH ** 3 / c.mu);
  const nD = o.nDep ?? Math.min(Math.max(Math.ceil(span / (elS.T / 12)), 72), 480),
    nT = o.nTof ?? 40;
  const dep = Array.from({ length: nD }, (_, i) => (span * i) / nD);
  const tof = Array.from({ length: nT }, (_, j) => tH * (0.25 + (1.25 * j) / (nT - 1)));
  const N = unit(cross(c.r, c.v));
  const dv: number[][] = [];
  let best = { i: 0, j: 0 },
    bv = Infinity;
  for (let i = 0; i < nD; i++) {
    const s = propagate(c.mu, c.r, c.v, dep[i]!);
    const row: number[] = [];
    for (let j = 0; j < nT; j++) {
      const tg = propagate(c.mu, T.r, T.v, dep[i]! + tof[j]!);
      const L = lambert(c.mu, s.r, tg.r, tof[j]!, N);
      const x = L ? len(add(L.v1, s.v, -1)) + (o.rendezvous ? len(add(tg.v, L.v2, -1)) : 0) : NaN;
      row.push(x);
      if (x < bv) (bv = x), (best = { i, j });
    }
    dv.push(row);
  }
  if (!Number.isFinite(bv)) return fail("No transfer found");
  const td = dep[best.i]!,
    tf = tof[best.j]!;
  const s = propagate(c.mu, c.r, c.v, td);
  const tg = propagate(c.mu, T.r, T.v, td + tf);
  const L = lambert(c.mu, s.r, tg.r, tf, N)!;
  const burns: Burn[] = [{ t: td, dv: toPNR(s.r, s.v, add(L.v1, s.v, -1)), label: "departure" }];
  if (o.rendezvous) burns.push({ t: td + tf, dv: toPNR(tg.r, L.v2, add(tg.v, L.v2, -1)), label: "match" });
  const grid = { dep, tof, dv, best };
  return result(
    c,
    burns,
    `${o.rendezvous ? "Rendezvous" : "Intercept"} with ${T.name}: departing in ${(td / 60).toFixed(0)} min, ${(tf / 60).toFixed(0)} min of flight`,
    grid,
  );
}

/** The velocities matched with the target's at the closest approach (within two orbits). */
export function matchVelocities(c: FcContext): OpResult {
  const T = c.target;
  if (!T) return fail("No target");
  const el = elements(c.mu, c.r, c.v, c.pole);
  const ca = closestApproach(c.mu, { r: c.r, v: c.v }, T, Number.isFinite(el.T) ? 2 * el.T : 86400);
  const s = propagate(c.mu, c.r, c.v, ca.t),
    tg = propagate(c.mu, T.r, T.v, ca.t);
  return result(
    c,
    [{ t: ca.t, dv: toPNR(s.r, s.v, add(tg.v, s.v, -1)), label: "match" }],
    `Velocities matched at the closest approach: ${ca.dist < 1e4 ? `${ca.dist.toFixed(0)} m` : `${(ca.dist / 1e3).toFixed(1)} km`} off, in ${(ca.t / 60).toFixed(0)} min`,
  );
}

/** A small burn at time t that brings the closest approach to the target nearest (Newton on its three
 *  parts, the approach's distance as the cost). */
export function fineTune(c: FcContext, t: number): OpResult {
  const T = c.target;
  if (!T) return fail("No target");
  const el = elements(c.mu, c.r, c.v, c.pole);
  const span = Number.isFinite(el.T) ? 1.5 * el.T : 86400;
  const s = propagate(c.mu, c.r, c.v, t),
    tg = propagate(c.mu, T.r, T.v, t);
  const cost = (d: V3) => closestApproach(c.mu, { r: s.r, v: add(s.v, fromPNR(s.r, s.v, d)) }, tg, span, 120).dist;
  let x: V3 = [0, 0, 0];
  let f = cost(x);
  let step = 1;
  for (let it = 0; it < 60 && step > 1e-3; it++) {
    let moved = false;
    for (let k = 0; k < 3; k++)
      for (const sgn of [1, -1]) {
        const y: V3 = [...x] as V3;
        y[k]! += sgn * step;
        const fy = cost(y);
        if (fy < f) (x = y), (f = fy), (moved = true);
      }
    if (!moved) step /= 2;
  }
  return result(
    c,
    [{ t, dv: x, label: "correction" }],
    `The closest approach brought to ${f < 1e4 ? `${f.toFixed(0)} m` : `${(f / 1e3).toFixed(1)} km`}`,
  );
}

/** The figures between the craft and its target: relative inclination, phase angle, the synodic period,
 *  the closest approach (two orbits), the time to the relative nodes. */
export function relation(c: FcContext) {
  const T = c.target;
  if (!T) return null;
  const elS = elements(c.mu, c.r, c.v, c.pole),
    elT = elements(c.mu, T.r, T.v, c.pole);
  const hT = unit(cross(T.r, T.v));
  const nd = nodesAgainst(elS, hT);
  const ca = closestApproach(c.mu, { r: c.r, v: c.v }, T, Number.isFinite(elS.T) ? 2 * elS.T : 86400, 240);
  // the phase a Hohmann needs: the target ahead by π − its motion over the transfer
  const aH = (elS.a + elT.a) / 2;
  const tH = Math.PI * Math.sqrt(Math.abs(aH) ** 3 / c.mu);
  const want = Math.PI - (2 * Math.PI * tH) / elT.T;
  const ph = phaseAngle(c.r, c.v, T.r);
  // (its rate: the target's mean motion less the craft's)
  const rate = (2 * Math.PI) / elT.T - (2 * Math.PI) / elS.T;
  let wait = rate !== 0 ? wrapPi(want - ph) / rate : Infinity;
  if (wait < 0) wait += synodic(elS.T, elT.T);
  return {
    relInc: relInclination(elS.h, elT.h),
    phase: ph,
    phaseWant: wrapPi(want),
    window: wait,
    synodic: synodic(elS.T, elT.T),
    ca,
    toAN: nd ? timeTo(elS, nd.an) : Infinity,
    toDN: nd ? timeTo(elS, nd.dn) : Infinity,
    distance: len(add(T.r, c.r, -1)),
    vRel: len(add(T.v, c.v, -1)),
  };
}

const wrapPi = (x: number) => ((((x + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/** v turned about a unit axis by an angle. */
function rot(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a),
    s = Math.sin(a);
  return add(add(scale(v, c), cross(k, v), s), k, dot(k, v) * (1 - c));
}

export { visViva };
