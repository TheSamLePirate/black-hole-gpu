// A rendezvous with the space station (Newton around the Earth, home frame): from the ship's orbit to a
// point 200 m out on the axis of IDA-2 — Harmony's forward port, the one the Ranger backs into —
// with the station's velocity there (its turning frame's: at rest beside it). Two impulses on a Lambert
// arc, the departure and the time of flight searched over the next sixteen turns of the station (its
// phasing: the ship waits on its orbit for the right moment), the least Δv kept (a little time
// counted against it: an hour of waiting is worth 0.2 m/s); arcs whose perigee dips below 200 km set
// aside. Two corrections on the way, re-aimed in flight from the ship's real state (controls.ts:
// issRefine), the arrival's burn too: the game's fall — the Moon's pull, the air's drag — and the
// station's own orbit (SGP4: the Earth's flattening) are not quite the two-body arc.
//
// Units: lengths and times in M, velocities in c.

import type { Vec3 } from "../physics";
import { keplerProp, lambert } from "./our-plan";
import { nodeDvComponents } from "./our-predict";
import { M_METRES, M_SECONDS, solarBody, solarState } from "./solar";
import { issAxes, issTrack, station } from "./iss";
import { fleet } from "../fleet";
import { VESSELS, type VesselId } from "../vessels";

/** Where a rendezvous ends at t: the point and its velocity (home), or null. */
export type RendezvousPoint = (t: number) => { X: Vec3; V: Vec3 } | null;

const C = 299792458;
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

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
  const r = sub(st.X, E.pos), v = sub(st.V, E.vel);
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

export function planIssRendezvous(X: Vec3, V: Vec3, t: number, lead: number, point: RendezvousPoint = rendezvousPoint, label = "the ISS", portName = "IDA-2"): IssPlan | null {
  const earth = solarBody("earth")!;
  const mu = earth.mass;
  const E0 = solarState("earth", t);
  const r0 = sub(X, E0.pos), v0 = sub(V, E0.vel);
  const h = cross(r0, v0);
  const floor = earth.radius + 200e3 / M_METRES;
  let best: { cost: number; t1: number; tof: number; dv1: Vec3; dv2: Vec3; r1: Vec3; v1: Vec3; v2arr: Vec3 } | null = null;
  const MS = 1 / C;
  for (let i = 0; i <= 16 * 24; i++) {
    const t1 = t + lead + (ISS_PERIOD * i) / 24;
    const s1 = keplerProp(mu, r0, v0, t1 - t);
    for (let j = 0; j <= 28; j++) {
      const tof = ISS_PERIOD * (0.3 + (1.15 * j) / 28);
      const ta = t1 + tof;
      const P = point(ta);
      if (!P) continue;
      const Ea = solarState("earth", ta);
      // (the Earth carries both: its own motion over the arc taken out)
      const r2 = sub(P.X, Ea.pos), v2t = sub(P.V, Ea.vel);
      const L = lambert(mu, s1.r, r2, tof, h);
      if (!L) continue;
      // (its perigee, if the arc reaches it: above 200 km)
      const ev = sub(cross(L.v1, cross(s1.r, L.v1)).map((c) => c / mu) as Vec3, s1.r.map((c) => c / norm(s1.r)) as Vec3);
      const e = norm(ev);
      const a = 1 / (2 / norm(s1.r) - dot(L.v1, L.v1) / mu);
      if (a > 0 && a * (1 - e) < floor) continue;
      const dv1 = sub(L.v1, s1.v), dv2 = sub(v2t, L.v2);
      const cost = norm(dv1) + norm(dv2) + 0.2 * MS * ((ta - t) * M_SECONDS / 3600);
      if (!best || cost < best.cost) best = { cost, t1, tof, dv1, dv2, r1: s1.r, v1: s1.v, v2arr: L.v2 };
    }
  }
  if (!best) return null;
  const b = best;
  const ta = b.t1 + b.tof;
  const E1 = solarState("earth", b.t1), Ea = solarState("earth", ta);
  const P = point(ta)!;
  // the burns as the plan carries them: [prograde, normal, radial] at the ship's state then
  const X1 = add(E1.pos, b.r1), V1 = add(E1.vel, b.v1);
  const dvDep = nodeDvComponents(X1, V1, b.t1, b.dv1);
  const Va = add(Ea.vel, b.v2arr);
  const dvArr = nodeDvComponents(P.X, Va, ta, b.dv2);
  const total = (norm(b.dv1) + norm(b.dv2)) * C;
  const wait = (b.t1 - t) * M_SECONDS / 60;
  return {
    nodes: [
      { t: b.t1, dv: dvDep, role: "depart" },
      { t: b.t1 + 0.55 * b.tof, dv: [0, 0, 0], role: "mcc" },
      { t: b.t1 + 0.88 * b.tof, dv: [0, 0, 0], role: "mcc" },
      { t: ta, dv: dvArr, role: "arrive", body: "iss" },
    ],
    tArrive: ta,
    dv: norm(b.dv1) + norm(b.dv2),
    note: `rendezvous with ${label}, ${RENDEZVOUS_M} m off ${portName} · departure in ${wait < 90 ? `${wait.toFixed(0)} min` : `${(wait / 60).toFixed(1)} h`}, ${(b.tof * M_SECONDS / 60).toFixed(0)} min of flight · Δv ${total.toFixed(1)} m/s`,
  };
}

/**
 * In flight: a node of the rendezvous re-aimed from the ship's state now (X, V at t). A correction:
 * the Lambert arc from where the ship will be at its time to the rendezvous point at the arrival; the
 * arrival: the station's velocity there, less the ship's on its present course. Its Δv [P, N, R], or
 * null (the arc not found).
 */
export function refineIssNode(X: Vec3, V: Vec3, t: number, node: { t: number; role?: string }, tArrive: number, point: RendezvousPoint = rendezvousPoint): Vec3 | null {
  const mu = solarBody("earth")!.mass;
  const E0 = solarState("earth", t);
  const r0 = sub(X, E0.pos), v0 = sub(V, E0.vel);
  const P = point(tArrive);
  if (!P) return null;
  const Ea = solarState("earth", tArrive);
  if (node.role === "arrive") {
    const s = keplerProp(mu, r0, v0, tArrive - t);
    const dv = sub(sub(P.V, Ea.vel), s.v);
    return nodeDvComponents(add(Ea.pos, s.r), add(Ea.vel, s.v), tArrive, dv);
  }
  const sm = keplerProp(mu, r0, v0, node.t - t);
  const L = lambert(mu, sm.r, sub(P.X, Ea.pos), tArrive - node.t, cross(r0, v0));
  if (!L) return null;
  const Em = solarState("earth", node.t);
  return nodeDvComponents(add(Em.pos, sm.r), add(Em.vel, sm.v), node.t, sub(L.v1, sm.v));
}
