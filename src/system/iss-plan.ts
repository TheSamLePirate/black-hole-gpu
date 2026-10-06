// A rendezvous with the space station (Newton around the Earth, home frame): from the ship's orbit to a
// point 200 m out on the axis of IDA-2 — Harmony's forward port, the one the Ranger backs into —
// with the station's velocity there (its turning frame's: at rest beside it). Two impulses on a Lambert
// arc, the departure and the time of flight searched over the next sixteen turns of the station (its
// phasing: the ship waits on its orbit for the right moment) — the arc direct, or of up to eight turns
// (a phasing orbit: a craft far behind or ahead catches up over a few turns rather than days of
// waiting) —, the least Δv kept (a little time counted against it: an hour of waiting is worth
// 0.2 m/s); arcs whose perigee dips below 200 km set aside. Two corrections on the way, re-aimed in flight from the ship's real state (controls.ts:
// issRefine), the arrival's burn too: the game's fall — the Moon's pull, the air's drag — and the
// station's own orbit (SGP4: the Earth's flattening) are not quite the two-body arc. The flattening's
// secular drift is the plan's, though: both orbits' planes regress ~5° a day — on a two-body arc the
// target's plane drifts 2.5° from the ship's in half a day, 300 m/s to turn —, so the ship's orbit is
// carried on with it (our-plan.ts coastOrbit) and each arc solved in the frame the drift turns with it:
// its target taken back by the drift over the flight (geopotential.ts secularTurn).
//
// Units: lengths and times in M, velocities in c.

import type { Vec3 } from "../physics";
import { secularTurn } from "./geopotential";
import { lambertAll, type LambertSolution } from "./lambert";
import { coastOrbit } from "./our-plan";
import { coastHome } from "./our-coast";
import { nodeDvComponents } from "./our-predict";
import { M_METRES, M_SECONDS, solarBody, solarState } from "./solar";
import { issAxes, issTrack, station } from "./iss";
import { fleet } from "../fleet";
import { VESSELS, type VesselId } from "../vessels";
import { C_MPS } from "../units";
import { add, cross, dot, len as norm, sub } from "../math/vec3";

/** Where a rendezvous ends at t: the point and its velocity (home), or null. */
export type RendezvousPoint = (t: number) => { X: Vec3; V: Vec3 } | null;

const C = C_MPS;

/** the rendezvous point's distance out on IDA-2's axis [m] */
export const RENDEZVOUS_M = 200;
const ISS_PERIOD = (92.9 * 60) / M_SECONDS;

/** The rendezvous point at t: its place and velocity, home frame (null: the station unknown then). */
export function rendezvousPoint(t: number, distM = RENDEZVOUS_M): { X: Vec3; V: Vec3 } | null {
  return issPoint(t, distM);
}
function issPoint(t: number, distM: number): { X: Vec3; V: Vec3 } | null {
  const st = issTrack.peek(t);
  if (!st) return null;
  const A = issAxes(st.X, st.V, t);
  const p = station.ports[0]!;
  const o: Vec3 = [p.centre[0] + p.axis[0] * distM, p.centre[1] + p.axis[1] * distM, p.centre[2] + p.axis[2] * distM];
  const off: Vec3 = [0, 1, 2].map((k) => (A[0][k]! * o[0] + A[1][k]! * o[1] + A[2][k]! * o[2]) / M_METRES) as Vec3;
  const E = solarState("earth", t);
  const r = sub(st.X, E.pos),
    v = sub(st.V, E.vel);
  const om = cross(r, v).map((c) => c / dot(r, r)) as Vec3;
  return { X: add(st.X, off), V: add(st.V, cross(om, off)) };
}

export interface IssPlan {
  nodes: { t: number; dv: Vec3; role: "depart" | "mcc" | "arrive"; body?: string }[];
  /** the arrival's time [M], its Δv in all [c] */
  tArrive: number;
  dv: number;
  note: string;
}

/**
 * The rendezvous from the ship at (X, V) [home] at t: the first burn at least `lead` [M] ahead.
 * Null when no arc in the next sixteen turns is fit to fly.
 */
/**
 * A craft's free docking port (the first no other craft holds), or null: its index.
 */
export function freePort(id: VesselId): number | null {
  const used = new Set<number>();
  for (const l of fleet.links) {
    if (l.a === id) used.add(l.pa);
    if (l.b === id) used.add(l.pb);
  }
  const k = VESSELS[id].ports.findIndex((_, i) => !used.has(i));
  return k >= 0 ? k : null;
}

/**
 * The rendezvous point with a craft of the fleet: `distM` out on its free port's axis, at its velocity
 * (its attitude held still: no turn to follow), or null.
 */
export function craftPoint(id: VesselId, distM = RENDEZVOUS_M): RendezvousPoint {
  return (t) => {
    const k = freePort(id);
    const p = fleet.pose(id, t);
    if (k === null || !p) return null;
    const port = VESSELS[id].ports[k]!;
    const o: Vec3 = [0, 1, 2].map((i) => port.centre[i]! + port.axis[i]! * distM) as Vec3;
    const off: Vec3 = [0, 1, 2].map((i) => (p.ax[0][i]! * o[0] + p.ax[1][i]! * o[1] + p.ax[2][i]! * o[2]) / M_METRES) as Vec3;
    return { X: add(p.X, off), V: p.V };
  };
}

/**
 * The ship's coast from (r, v) at t over dt about the Earth, as the flight flies it — its own integrator,
 * the rails' mean orbit beyond a fraction of a turn (our-coast.ts) — not the two-body arc with the J2's
 * secular drift (coastOrbit), which ran 49 km a turn off the flight: a rendezvous planned on it arrived
 * 31 km from the station, too far for the docking autopilot to take over.
 */
export function flown(r: Vec3, v: Vec3, t: number, dt: number): { r: Vec3; v: Vec3 } {
  const E0 = solarState("earth", t);
  let S = { X: add(E0.pos, r), V: add(E0.vel, v) },
    tt = t;
  // (coastHome stops after its sub-steps' cap: carried on to the end)
  for (let k = 0; k < 1000 && tt < t + dt - 1e-12; k++) {
    const c = coastHome(S.X, S.V, tt, t + dt - tt);
    S = c;
    tt = c.t;
  }
  const E1 = solarState("earth", t + dt);
  return { r: sub(S.X, E1.pos), v: sub(S.V, E1.vel) };
}

/** The J2 secular drift of the Earth orbit (r, v) at t0 over dt, as a rotation (none: the identity). */
function drift(r: Vec3, v: Vec3, dt: number, t0: number): (x: Vec3) => Vec3 {
  return secularTurn("earth", solarBody("earth")!.mass, r, v, dt, t0) ?? ((x: Vec3) => x);
}

/**
 * The two-body arc from r1 (at t1) to the target (r2, v2t) after tof, of m turns, solved in the frame its
 * own drift turns with: aimed at the target taken back by the drift over the flight — the target's own
 * first, then the arc's —, and its arrival's velocity carried forward again. `pick` chooses among
 * Lambert's solutions. Null: none.
 */
function driftArc(
  r1: Vec3,
  t1: number,
  r2: Vec3,
  v2t: Vec3,
  tof: number,
  h: Vec3,
  m: number,
  pick: (L: LambertSolution[]) => LambertSolution | undefined,
): { v1: Vec3; v2: Vec3; branch: string } | null {
  const mu = solarBody("earth")!.mass;
  const L0 = pick(lambertAll(mu, r1, drift(r2, v2t, -tof, t1 + tof)(r2), tof, h, m));
  if (!L0) return null;
  const L = pick(lambertAll(mu, r1, drift(r1, L0.v1, -tof, t1)(r2), tof, h, m)) ?? L0;
  return { v1: L.v1, v2: drift(r1, L.v1, tof, t1)(L.v2), branch: L.branch };
}

/**
 * The velocity at r1 (at t1) that coasts to r2 in tof — the orbit carried on with its drift (coastOrbit),
 * from `v` (a guess: the course flown, an arc's) by Newton's steps on the miss —, and the velocity it
 * arrives with. A many-turn arc near its shortest flight is ill-posed for Lambert (a few km of aim are
 * 100 m/s of answer); the course itself, shot again, is not. Null: no convergence (a miss over 10 m).
 */
function shoot(r1: Vec3, v: Vec3, t1: number, tof: number, r2: Vec3, o: { exactFirst?: boolean } = {}): { v1: Vec3; v2: Vec3 } | null {
  const mu = solarBody("earth")!.mass;
  // (the miss as the flight flies it; its Jacobian on the two-body arc — a guide for Newton's steps, the
  // miss itself the flight's. A plan from afar first converges on the two-body arc alone — free —, then on
  // the flight's miss; a re-aim in flight, on course already, on the flight's miss from the start — the
  // two-body arc tens of km off it, a many-turn arc's Newton from there once diverged to nothing)
  const end = (u: Vec3) => coastOrbit("earth", mu, r1, u, tof, t1);
  const h = 0.01 / C;
  let exact = !!o.exactFirst;
  let u = v;
  let best: { u: Vec3; v2: Vec3; miss: number; step: Vec3 } | null = null;
  for (let it = 0; it < 16; it++) {
    const ea = end(u);
    const e0 = exact ? flown(r1, u, t1, tof) : ea;
    const miss = sub(e0.r, r2);
    const m = norm(miss) * M_METRES;
    // (the flight's miss within its own noise — the integrator's ~10 m a turn): aimed
    if (exact && m < 30) return { v1: u, v2: e0.v };
    if (!exact && m < 10) {
      exact = true;
      best = null;
      continue;
    }
    // (worse than the best so far: back to it, half its step)
    if (exact && best && !(m < best.miss)) {
      best.step = best.step.map((x) => x / 2) as Vec3;
      u = add(best.u, best.step);
      continue;
    }
    // (the miss's Jacobian in the velocity, by differences)
    const J = [0, 1, 2].map((k) => {
      const du: Vec3 = [0, 0, 0];
      du[k] = h;
      return sub(end(add(u, du)).r, ea.r).map((x) => x / h) as Vec3;
    });
    // (J's columns J[k]: solve J x = −miss, Cramer's rule)
    const det = dot(J[0]!, cross(J[1]!, J[2]!));
    if (!(Math.abs(det) > 0)) break;
    const x: Vec3 = [dot(miss, cross(J[1]!, J[2]!)) / -det, dot(J[0]!, cross(miss, J[2]!)) / -det, dot(J[0]!, cross(J[1]!, miss)) / -det];
    if (exact) best = { u, v2: e0.v, miss: m, step: x };
    u = add(u, x);
  }
  // (not within the noise: the best aim kept if within the docking's reach — the corrections refine it)
  return best && best.miss < 2000 ? { v1: best.u, v2: best.v2 } : null;
}

export function planIssRendezvous(
  X: Vec3,
  V: Vec3,
  t: number,
  lead: number,
  point: RendezvousPoint = rendezvousPoint,
  label = "the ISS",
  portName = "IDA-2",
): IssPlan | null {
  const earth = solarBody("earth")!;
  const mu = earth.mass;
  const E0 = solarState("earth", t);
  const r0 = sub(X, E0.pos),
    v0 = sub(V, E0.vel);
  const h = cross(r0, v0);
  const floor = earth.radius + 200e3 / M_METRES;
  type Arc = { cost: number; t1: number; tof: number; m: number; branch: string; dv1: Vec3; dv2: Vec3; r1: Vec3; v1: Vec3 };
  const MS = 1 / C;
  const t1min = t + lead;
  // (an arc: departing at t1 for tof, of m turns on a branch — its perigee above the floor; its cost, the
  // two burns and the time to the arrival)
  const arc = (t1: number, tof: number, m: number, branch?: string): Arc | null => {
    if (t1 < t1min || !(tof > 0)) return null;
    const P = point(t1 + tof);
    if (!P) return null;
    const s1 = coastOrbit("earth", mu, r0, v0, t1 - t, t);
    const Ea = solarState("earth", t1 + tof);
    const r2 = sub(P.X, Ea.pos),
      v2t = sub(P.V, Ea.vel);
    let best: Arc | null = null;
    for (const b of branch ? [branch] : m ? ["left", "right"] : ["direct"]) {
      const L = driftArc(s1.r, t1, r2, v2t, tof, h, m, (all) => all.find((x) => x.revs === m && x.branch === b));
      if (!L) continue;
      const ev = sub(cross(L.v1, cross(s1.r, L.v1)).map((c) => c / mu) as Vec3, s1.r.map((c) => c / norm(s1.r)) as Vec3);
      const a = 1 / (2 / norm(s1.r) - dot(L.v1, L.v1) / mu);
      if (a > 0 && a * (1 - norm(ev)) < floor) continue;
      const dv1 = sub(L.v1, s1.v),
        dv2 = sub(v2t, L.v2);
      const cost = norm(dv1) + norm(dv2) + 0.2 * MS * (((t1 + tof - t) * M_SECONDS) / 3600);
      if (!best || cost < best.cost) best = { cost, t1, tof, m, branch: L.branch, dv1, dv2, r1: s1.r, v1: s1.v };
    }
    return best;
  };
  // the grid: the best arc of each kind (direct; m turns, each branch)
  const kinds = new Map<string, Arc>();
  const keep = (q: Arc | null) => {
    if (!q) return;
    const k = `${q.m}${q.branch}`;
    if (!kinds.has(k) || q.cost < kinds.get(k)!.cost) kinds.set(k, q);
  };
  for (let i = 0; i <= 16 * 24; i++) {
    const t1 = t1min + (ISS_PERIOD * i) / 24;
    for (let j = 0; j <= 28; j++) keep(arc(t1, ISS_PERIOD * (0.3 + (1.15 * j) / 28), 0));
    // (a phasing arc of m turns, from every third departure)
    if (i % 3) continue;
    for (let m = 1; m <= 8; m++) for (let j = 0; j <= 17; j++) keep(arc(t1, ISS_PERIOD * (m - 0.5 + (1.7 * j) / 17), m));
  }
  // each kind's best refined (a turn of several is sharp in its time: a minute of flight is ~10 km of its
  // phasing orbit), the departure and the time of flight stepped down to seconds
  let b = null as Arc | null;
  for (let q of kinds.values()) {
    for (let st = ISS_PERIOD / 48; st > 2 / M_SECONDS; st /= 2) {
      for (let moved = true, n = 0; moved && n < 20; n++) {
        moved = false;
        for (const [d1, d2] of [
          [st, 0],
          [-st, 0],
          [0, st],
          [0, -st],
          [st, -st],
          [-st, st],
        ] as const) {
          const r = arc(q.t1 + d1, q.tof + d2, q.m, q.branch);
          if (r && r.cost < q.cost) (q = r), (moved = true);
        }
      }
    }
    if (!b || q.cost < b.cost) b = q;
  }
  if (!b) return null;
  const ta = b.t1 + b.tof;
  const E1 = solarState("earth", b.t1);
  const P = point(ta)!;
  // (the chosen arc taken up where the flight will really be at its departure — the grid's two-body coast
  // tens of km off it —, then shot through to its target as the flight flies: the departure's few km of
  // aim; the re-aims in flight start from the same physics, a burn flown as planned needs none)
  const Ea = solarState("earth", ta);
  const dep = flown(r0, v0, t, b.t1 - t);
  const guess = add(b.v1, b.dv1);
  b = { ...b, r1: dep.r, v1: dep.v, dv1: sub(guess, dep.v) };
  const sh = shoot(b.r1, guess, b.t1, b.tof, sub(P.X, Ea.pos));
  if (sh) b = { ...b, dv1: sub(sh.v1, b.v1), dv2: sub(sub(P.V, Ea.vel), sh.v2) };
  // the burns as the plan carries them: [prograde, normal, radial] at the ship's state then
  const X1 = add(E1.pos, b.r1),
    V1 = add(E1.vel, b.v1);
  const dvDep = nodeDvComponents(X1, V1, b.t1, b.dv1);
  const Va = sub(P.V, b.dv2);
  const dvArr = nodeDvComponents(P.X, Va, ta, b.dv2);
  const total = (norm(b.dv1) + norm(b.dv2)) * C;
  const wait = ((b.t1 - t) * M_SECONDS) / 60;
  return {
    nodes: [
      { t: b.t1, dv: dvDep, role: "depart" },
      { t: b.t1 + 0.55 * b.tof, dv: [0, 0, 0], role: "mcc" },
      { t: b.t1 + 0.88 * b.tof, dv: [0, 0, 0], role: "mcc" },
      { t: ta, dv: dvArr, role: "arrive", body: "iss" },
    ],
    tArrive: ta,
    dv: norm(b.dv1) + norm(b.dv2),
    note: `rendezvous with ${label}, ${RENDEZVOUS_M} m off ${portName} · departure in ${wait < 90 ? `${wait.toFixed(0)} min` : `${(wait / 60).toFixed(1)} h`}, ${((b.tof * M_SECONDS) / 60).toFixed(0)} min of flight · Δv ${total.toFixed(1)} m/s`,
  };
}

/**
 * In flight: a node of the rendezvous re-aimed from the ship's state now (X, V at t). A correction:
 * the Lambert arc from where the ship will be at its time to the rendezvous point at the arrival — of
 * the turns the planned one has left: of those the time allows, the nearest the course flown —; the
 * arrival: the station's velocity there, less the ship's on its present course. Its Δv [P, N, R], or
 * null (the arc not found).
 */
export function refineIssNode(
  X: Vec3,
  V: Vec3,
  t: number,
  node: { t: number; role?: string },
  tArrive: number,
  point: RendezvousPoint = rendezvousPoint,
): Vec3 | null {
  const E0 = solarState("earth", t);
  const r0 = sub(X, E0.pos),
    v0 = sub(V, E0.vel);
  const P = point(tArrive);
  if (!P) return null;
  const Ea = solarState("earth", tArrive);
  if (node.role === "arrive") {
    const s = flown(r0, v0, t, tArrive - t);
    const dv = sub(sub(P.V, Ea.vel), s.v);
    return nodeDvComponents(add(Ea.pos, s.r), add(Ea.vel, s.v), tArrive, dv);
  }
  const sm = flown(r0, v0, t, node.t - t);
  const near = (all: LambertSolution[]) =>
    all.length ? all.reduce((a, x) => (norm(sub(x.v1, sm.v)) < norm(sub(a.v1, sm.v)) ? x : a)) : undefined;
  const span = tArrive - node.t;
  // (the course flown shot again to the target; else the drifting frame's arc nearest it)
  const L =
    shoot(sm.r, sm.v, node.t, span, sub(P.X, Ea.pos), { exactFirst: true }) ??
    driftArc(sm.r, node.t, sub(P.X, Ea.pos), sub(P.V, Ea.vel), span, cross(sm.r, sm.v), Math.floor(span / (0.8 * ISS_PERIOD)), near);
  if (!L) return null;
  const Em = solarState("earth", node.t);
  return nodeDvComponents(add(Em.pos, sm.r), add(Em.vel, sm.v), node.t, sub(L.v1, sm.v));
}
