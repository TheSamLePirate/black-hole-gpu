// Manoeuvre planning for the Ranger: nodes (an impulsive velocity change at a given time), the
// trajectory they lead to, and planners that find the nodes for a goal — all on the real Kerr
// geodesics (the star's weak field included), by shooting.
//
// A node's Δv is a change of the 4-velocity's spatial part (γβ, in c) in the local ZAMO frame, split
// along the orbital frame at the node: prograde P = β̂, normal N = (r̂ × P)/|r̂ × P| and radial
// R = N × P (outwards, perpendicular to the velocity). The ship executes it as a finite burn centred
// on the node's time (pilot.ts / controls.ts); planning treats it as an impulse.
//
//   circular orbit at r₂ (black hole)  Hohmann-like: a prograde burn soon, found by bisection so that
//                                      the opposite apsis is r₂; a circularizing burn there
//   rendezvous (companion star)        the same apsis burn at r = the star's orbit, its time scanned
//                                      (then refined) so that the star is there too; a velocity
//                                      match at the closest approach; then station-keeping
//   the wormhole's mouth               a 3-D Δv found by Newton's method on the miss vector (the
//                                      path's closest point to the mouth's centre), departure time
//                                      scanned for the smallest Δv
//   plane alignment                    at the cheaper of the next two crossings of the target plane
//                                      (ascending / descending node), the velocity turned into it

import { advance, fromZamo, predict, step, thrust, toZamo, type Lens, type Lenses, type Massive } from "./geodesic";
import { horizon, zamo, type Vec3 } from "./physics";

export interface ManeuverNode {
  /** coordinate time of the burn's centre [M] */
  t: number;
  /** Δ(γβ) along prograde, normal, radial [c] */
  dv: Vec3;
  /** what the autopilot does after the last node */
  then?: "circularize" | "approach" | "orbit" | null;
}

/** Integration tolerance of the planners (thousands of trial paths; the burns are refined anyway). */
const PLAN_TOL = 1e-7;

export interface World {
  a: number;
  lens?: Lenses;
  /** the least time before the first burn [M] (time to turn at the current warp) */
  lead?: number;
}

export interface PlanPath {
  /** flat-map points (black hole's frame) and their coordinate times */
  pts: Vec3[];
  times: number[];
  /** "wormhole": into the mouth (the controller cuts the path there) */
  fate: "horizon" | "escape" | "continues" | "star" | "wormhole";
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));

/** Flat-map position of a state. */
export function position(st: Massive): Vec3 {
  const s = Math.sin(st.th);
  return [st.r * s * Math.cos(st.ph), st.r * s * Math.sin(st.ph), st.r * Math.cos(st.th)];
}

/** Local ZAMO basis (r̂, θ̂, φ̂) of a state in the flat map, to convert vectors. */
export function localFrame(st: Massive) {
  const s = Math.sin(st.th), c = Math.cos(st.th), sp = Math.sin(st.ph), cp = Math.cos(st.ph);
  return { er: [s * cp, s * sp, c] as Vec3, et: [c * cp, c * sp, -s] as Vec3, ep: [-sp, cp, 0] as Vec3 };
}

/** The orbital frame (prograde, normal, radial-out ⟂ velocity) in local ZAMO components. */
export function orbitalFrame(beta: Vec3): { P: Vec3; N: Vec3; R: Vec3 } {
  const P: Vec3 = len(beta) > 1e-9 ? norm(beta) : [0, 0, 1];
  let N = cross([1, 0, 0], P);
  if (len(N) < 1e-6) N = cross([0, 1, 0], P);
  N = norm(N);
  return { P, N, R: cross(N, P) };
}

/** Node Δv (P, N, R components) → local ZAMO vector, for a velocity β. */
export function dvLocal(beta: Vec3, dv: Vec3): Vec3 {
  const f = orbitalFrame(beta);
  return add(add(scale(f.P, dv[0]), scale(f.N, dv[1])), scale(f.R, dv[2]));
}

/** Local ZAMO vector → node components (P, N, R). */
export function dvComponents(beta: Vec3, v: Vec3): Vec3 {
  const f = orbitalFrame(beta);
  return [dot(v, f.P), dot(v, f.N), dot(v, f.R)];
}

/** Free fall until coordinate time t (no thrust); null if the ship is lost (horizon, star) first. */
export function advanceTo(st: Massive, t: number, w: World): Massive | null {
  if (t <= st.t) return st;
  const r = advance(st, w.a, t - st.t, 0.05, 0, [0, 0, 0], w.lens, PLAN_TOL);
  return r.stopped || r.landed ? null : r.st;
}

/** The impulse of a node applied to a state at the node. */
export function applyDv(st: Massive, dv: Vec3, a: number): Massive {
  const d = dvLocal(toZamo(st, a), dv);
  const m = len(d);
  return m > 0 ? thrust(st, scale(d, 1 / m), m, 1, a) : st;
}

/** Predicted path from a state, with times. */
export function pathFrom(st: Massive, w: World, tMax: number, n = 300, stop?: (p: Vec3, t: number) => boolean): PlanPath {
  const p = predict(st, w.a, tMax, n, w.lens, PLAN_TOL, stop);
  const dt = tMax / n;
  return { pts: p.pts, times: p.pts.map((_, j) => st.t + (j + 1) * dt), fate: p.fate === "continues" || p.fate === "escape" || p.fate === "horizon" || p.fate === "star" ? p.fate : "continues" };
}

/** The whole plan from the current state: coast, burn, coast… then the final path. */
export function planPath(st0: Massive, nodes: ManeuverNode[], w: World, tail: number): { path: PlanPath; states: Massive[] } | null {
  let st: Massive | null = st0;
  const pts: Vec3[] = [];
  const times: number[] = [];
  const states: Massive[] = [];
  for (const n of [...nodes].sort((x, y) => x.t - y.t)) {
    if (n.t > st.t) {
      const seg = pathFrom(st, w, n.t - st.t, Math.max(20, Math.min(200, Math.round((n.t - st.t) / 4))));
      pts.push(...seg.pts);
      times.push(...seg.times);
      st = advanceTo(st, n.t, w);
      if (!st) return { path: { pts, times, fate: "horizon" }, states };
    }
    st = applyDv(st, n.dv, w.a);
    states.push(st);
  }
  const rest = pathFrom(st, w, tail, 360);
  return { path: { pts: [...pts, ...rest.pts], times: [...times, ...rest.times], fate: rest.fate }, states };
}

/** Apsides of a path (min, max of r) and when they happen. */
export function apsides(p: PlanPath) {
  let iMin = -1, iMax = -1, rMin = Infinity, rMax = -Infinity;
  p.pts.forEach((q, j) => {
    const r = len(q);
    if (r < rMin) (rMin = r), (iMin = j);
    if (r > rMax) (rMax = r), (iMax = j);
  });
  return { rMin, rMax, tMin: p.times[iMin] ?? NaN, tMax: p.times[iMax] ?? NaN };
}

/** Radial free-fall acceleration of γβ_r (local) for a state with a given 3-velocity. */
function radialAccel(st: Massive, beta: Vec3, w: World) {
  const s0 = fromZamo(st.r, st.th, st.ph, beta, w.a, st.t);
  const h = Math.max(1e-4, 2e-4 * (st.r - horizon(w.a)));
  const U0 = beta[0] / Math.sqrt(1 - dot(beta, beta));
  const b1 = toZamo(step(s0, w.a, h, w.lens), w.a);
  return (b1[0] / Math.sqrt(1 - dot(b1, b1)) - U0) / h;
}

/**
 * The velocity (local ZAMO) of a circular orbit through the state's position, in its current plane
 * of motion: tangential, of the speed whose free fall has no radial acceleration (two probes, a_r
 * linear in v²). Null inside the photon orbit.
 */
export function circularBeta(st: Massive, w: World): Vec3 | null {
  const b = toZamo(st, w.a);
  let t: Vec3 = [0, b[1], b[2]];
  if (len(t) < 1e-6) t = [0, 0, w.a >= 0 ? 1 : -1];
  t = norm(t);
  const z = zamo(st.r, st.th, w.a);
  const pro = t[2] * (w.a >= 0 ? 1 : -1) >= 0;
  const a = Math.abs(w.a);
  const Om = pro ? 1 / (st.r ** 1.5 + a) : -1 / (st.r ** 1.5 - a);
  const v0 = Math.abs((z.varpi * (Om - z.omega)) / z.alpha);
  if (!(v0 < 0.999)) return null;
  const v1 = v0, v2 = Math.min(1.05 * v0, 0.999);
  const a1 = radialAccel(st, scale(t, v1), w);
  const a2 = radialAccel(st, scale(t, v2), w);
  const vc = a2 !== a1 ? Math.sqrt(Math.min(Math.max(v1 * v1 - (a1 * (v2 * v2 - v1 * v1)) / (a2 - a1), 0), 0.998)) : v1;
  return scale(t, vc);
}

/** Node Δv that turns the state's velocity into β_target (both local). */
function matchDv(st: Massive, betaT: Vec3, a: number): Vec3 {
  const b = toZamo(st, a);
  const U = scale(b, 1 / Math.sqrt(1 - dot(b, b)));
  const UT = scale(betaT, 1 / Math.sqrt(1 - dot(betaT, betaT)));
  return dvComponents(b, sub(UT, U));
}

/** Orbital period estimate at radius r (Kepler). */
const period = (r: number) => 2 * Math.PI * r ** 1.5;

/** Prograde Δv at state s1 that puts the opposite apsis at r2 (bisection on the real path). */
function apsisBurn(s1: Massive, r2: number, w: World): number | null {
  const up = r2 > s1.r;
  const tTransfer = Math.PI * ((s1.r + r2) / 2) ** 1.5 * 1.35 + 50;
  const apsis = (dv: number) => {
    const p = pathFrom(applyDv(s1, [dv, 0, 0], w.a), w, tTransfer, 240);
    if (p.fate === "escape") return Infinity;
    if (p.fate === "horizon" || p.fate === "star") return up ? Math.max(...p.pts.map(len)) : 0;
    const ap = apsides(p);
    return up ? ap.rMax : ap.rMin;
  };
  // bracket, growing the burn (the apsis is monotonic in the prograde Δv as long as the burn doesn't
  // reverse the orbit: a huge retrograde burn flips it and the far apsis runs away)
  const f = (dv: number) => (up ? apsis(dv) - r2 : r2 - apsis(dv));
  let lo = 0, hi = up ? 0.004 : -0.004;
  while (f(hi) < 0) {
    lo = hi;
    hi *= 1.7;
    if (Math.abs(hi) > 0.6) return null;
  }
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Circular orbit of radius r2 around the hole: apsis burn now (after `lead`), circularize there. */
export function planCircular(st0: Massive, r2: number, w: World): { nodes: ManeuverNode[]; note: string } | null {
  const lead = Math.max(20, 0.03 * period(st0.r), w.lead ?? 0);
  const s1 = advanceTo(st0, st0.t + lead, w);
  if (!s1) return null;
  const dv1 = apsisBurn(s1, r2, w);
  if (dv1 === null) return null;
  const after = applyDv(s1, [dv1, 0, 0], w.a);
  const tTransfer = Math.PI * ((s1.r + r2) / 2) ** 1.5 * 1.35 + 50;
  const p = pathFrom(after, w, tTransfer, 400);
  const ap = apsides(p);
  const t2 = r2 > s1.r ? ap.tMax : ap.tMin;
  const s2 = advanceTo(after, t2, w);
  if (!s2) return null;
  const bc = circularBeta(s2, w);
  if (!bc) return null;
  return {
    nodes: [{ t: s1.t, dv: [dv1, 0, 0] }, { t: t2, dv: matchDv(s2, bc, w.a), then: "circularize" }],
    note: `transfer to a circular orbit at ${r2.toFixed(1)} M`,
  };
}

/**
 * Rendezvous with a body moving on a known path (the star): the apsis burn towards its orbit radius,
 * its departure time scanned over up to `window` so that the body is there too, then a velocity match
 * at the closest approach.
 */
export function planRendezvous(
  st0: Massive, w: World,
  body: {
    centre: (t: number) => Vec3; velocity: (t: number) => Vec3; radius: number; standoff: number;
    /**
     * end on a circular orbit around the body instead of at rest: its mass, the orbit plane's normal,
     * the sense of motion around n (±1; default: the sense the ship arrives with)
     */
    orbit?: { mass: number; n: Vec3; sense?: number };
  },
): { nodes: ManeuverNode[]; note: string; miss: number } | null {
  // (the scan ignores the planets' tiny masses — they only matter within their Hill spheres, which
  // the refinement below goes into with the full field)
  const wFull = w;
  w = { ...w, lens: coarseLenses(w.lens) };
  const D = len(body.centre(st0.t));
  const lead = Math.max(20, 0.03 * period(st0.r), w.lead ?? 0);
  const sA = advanceTo(st0, st0.t + lead, w);
  if (!sA) return null;
  // apsis at the body's orbit, a little short of it
  const rGoal = D - Math.sign(D - sA.r) * body.standoff * 0.5;
  const dv = apsisBurn(sA, rGoal, w);
  if (dv === null) return null;
  const synodic = Math.abs(1 / Math.abs(1 / period(sA.r) - 1 / period(D)));
  const window = Math.min(Math.max(period(sA.r), Math.min(synodic, 3 * period(D))), 6000);
  const tTransfer = Math.PI * ((sA.r + D) / 2) ** 1.5 * 1.35 + 50;
  // the closest approach, and how far it is from the one wanted (at the standoff for an orbit, as close
  // as possible otherwise; hitting the body is out)
  const dWant = body.orbit ? body.standoff : 0;
  const miss = (s1: Massive, dvp: number) => {
    const p = pathFrom(applyDv(s1, [dvp, 0, 0], w.a), w, tTransfer, 240);
    let best = { d: Infinity, t: NaN, cost: Infinity };
    p.pts.forEach((q, j) => {
      const d = len(sub(q, body.centre(p.times[j]!)));
      if (d < best.d) best = { d, t: p.times[j]!, cost: 0 };
    });
    best.cost = Math.abs(best.d - dWant) + (p.fate === "star" || best.d < 1.2 * body.radius ? 1e4 : 0);
    return best;
  };
  // scan the departure time (advancing incrementally), then refine around the best
  const n = 48;
  let s: Massive | null = sA;
  let best = { t1: sA.t, d: Infinity };
  for (let k = 0; k < n && s; k++) {
    const t1 = sA.t + (window * k) / n;
    s = advanceTo(s, t1, w);
    if (!s) break;
    const m = miss(s, dv);
    if (m.cost < best.d) best = { t1, d: m.cost };
  }
  let step = window / n;
  for (let it = 0; it < 12; it++) {
    step /= 2;
    for (const t1 of [best.t1 - step, best.t1 + step]) {
      if (t1 < sA.t) continue;
      const s1 = advanceTo(sA, t1, w);
      if (!s1) continue;
      const m = miss(s1, dv);
      if (m.cost < best.d) best = { t1, d: m.cost };
    }
  }
  const s1 = advanceTo(sA, best.t1, w);
  if (!s1) return null;
  // (the burn the scan was made with: recomputing it at the new time would move the encounter)
  const dv1: Vec3 = [dv, 0, 0];
  const m = miss(s1, dv);
  if (m.cost >= 1e3) return null;
  const s2 = advanceTo(applyDv(s1, dv1, w.a), m.t, wFull);
  if (!s2) return null;
  // match the body's velocity (flat map → local ZAMO components, the small α factors neglected)
  const f = localFrame(s2);
  let V = body.velocity(m.t);
  let then: ManeuverNode["then"] = "approach";
  // A small body (a planet: its Hill sphere is a few radii) is not met within it at the scan's
  // resolution, nor would a flight's finite burns keep to it: the ship stops next to it (its velocity
  // matched) and the orbit autopilot brings it in, with continuous guidance — the last correction
  const hill = body.orbit ? len(body.centre(m.t)) * Math.cbrt(body.orbit.mass / 3) : Infinity;
  if (body.orbit && m.d > 0.5 * hill) {
    then = "orbit";
  } else if (body.orbit) {
    // orbit insertion: the body's velocity plus the circular speed around it, in the given plane, in
    // the sense the ship already goes round it
    const n = norm(body.orbit.n);
    const rel = sub(position(s2), body.centre(m.t));
    const relP = sub(rel, scale(n, dot(rel, n)));
    const b2 = toZamo(s2, w.a);
    const Vs = add(add(scale(f.er, b2[0]), scale(f.et, b2[1])), scale(f.ep, b2[2]));
    const sense = body.orbit.sense ?? (Math.sign(dot(cross(rel, sub(Vs, V)), n)) || 1);
    const t = norm(cross(scale(n, sense), relP));
    V = add(V, scale(t, Math.sqrt(body.orbit.mass / Math.max(len(rel), body.radius))));
    then = "orbit";
  }
  // (coordinate velocity → the ZAMO's: over the lapse)
  const al = zamo(s2.r, s2.th, w.a).alpha;
  const betaT: Vec3 = [dot(V, f.er) / al, dot(V, f.et) / al, dot(V, f.ep) / al];
  return {
    nodes: [{ t: best.t1, dv: dv1 }, { t: m.t, dv: matchDv(s2, betaT, w.a), then }],
    note: `${body.orbit ? "orbit insertion" : "rendezvous"}: closest approach ${m.d < 0.01 ? `${(m.d * 1e4).toFixed(2)}·10⁻⁴` : m.d.toFixed(1)} M`,
    miss: m.d,
  };
}

/** The lenses massive enough to matter for a scan (the stars; not the planets). */
function coarseLenses(l: World["lens"]): World["lens"] {
  if (!l || !Array.isArray(l)) return l;
  const kept = (l as readonly Lens[]).filter((q) => q.m > 1e-10);
  return kept.length ? kept : undefined;
}

/** Normal of the orbit's plane (flat map): r̂ × v̂. */
export function orbitNormal(st: Massive, a: number): Vec3 {
  const f = localFrame(st);
  const b = toZamo(st, a);
  const V = add(add(scale(f.er, b[0]), scale(f.et, b[1])), scale(f.ep, b[2]));
  return norm(cross(position(st), V));
}

/** Angle between the orbit's plane and a plane of normal n [rad], 0 … π/2 (either sense of motion). */
export function planeOffset(st: Massive, a: number, n: Vec3) {
  return Math.acos(Math.min(1, Math.abs(dot(orbitNormal(st, a), norm(n)))));
}

/** A local vector (ZAMO components) → node components (P, N, R) for the state's velocity. */
export function nodeComponents(st: Massive, a: number, v: Vec3): Vec3 {
  return dvComponents(toZamo(st, a), v);
}

/**
 * Plane change: into the plane of normal n (through the hole). The orbit crosses that plane twice
 * an orbit (the line of nodes); there the velocity is turned into the plane (same speed, same sense
 * of motion) — the cheaper of the next two crossings wins.
 */
export function planAlign(st0: Massive, w: World, n: Vec3, name: string): { nodes: ManeuverNode[]; note: string; offset: number } | null {
  n = norm(n);
  const offset = planeOffset(st0, w.a, n);
  if (offset < 1e-4) return null;
  const lead = Math.max(20, 0.03 * period(st0.r), w.lead ?? 0);
  const s0 = advanceTo(st0, st0.t + lead, w);
  if (!s0) return null;
  const p = pathFrom(s0, w, 1.6 * period(Math.max(s0.r, 3)), 720);
  const side = (q: Vec3) => dot(q, n);
  const pts = [position(s0), ...p.pts], times = [s0.t, ...p.times];
  const out: { t: number; dv: Vec3 }[] = [];
  for (let j = 1; j < pts.length && out.length < 2; j++) {
    if (Math.sign(side(pts[j - 1]!)) === Math.sign(side(pts[j]!))) continue;
    // the crossing, by bisection between the two samples
    let sA = advanceTo(s0, times[j - 1]!, w);
    if (!sA) break;
    let lo = times[j - 1]!, hi = times[j]!;
    const sgn = Math.sign(side(position(sA)));
    for (let it = 0; it < 30 && hi - lo > 1e-4; it++) {
      const mid = (lo + hi) / 2;
      const sm = advanceTo(sA, mid, w);
      if (!sm) break;
      if (Math.sign(side(position(sm))) === sgn) (lo = mid), (sA = sm);
      else hi = mid;
    }
    const s = advanceTo(sA, (lo + hi) / 2, w);
    if (!s) break;
    // the velocity turned into the plane, speed kept
    const f = localFrame(s);
    const b = toZamo(s, w.a);
    const V = add(add(scale(f.er, b[0]), scale(f.et, b[1])), scale(f.ep, b[2]));
    const Vp = sub(V, scale(n, dot(V, n)));
    const V2 = scale(Vp, len(V) / (len(Vp) || 1));
    const betaT: Vec3 = [dot(V2, f.er), dot(V2, f.et), dot(V2, f.ep)];
    out.push({ t: s.t, dv: matchDv(s, betaT, w.a) });
  }
  if (!out.length) return null;
  const best = out.reduce((x, y) => (len(y.dv) < len(x.dv) ? y : x));
  return { nodes: [{ t: best.t, dv: best.dv }], note: `plane change ${((offset * 180) / Math.PI).toFixed(1)}° into ${name}`, offset };
}

/**
 * A path through a fixed point (the wormhole's mouth): for departure times over one orbit, Newton's
 * method on the 3-D Δv drives the path's closest point to the target onto it; the cheapest wins.
 */
export function planIntercept(
  st0: Massive, target: Vec3 | ((t: number) => Vec3), w0: World, tol: number,
): { nodes: ManeuverNode[]; note: string; miss: number } | null {
  // (the search's many trial paths feel the hole and the stars only: the planets' pull, far from
  // them, is below the aim's tolerance — the plan's path is then drawn with all of them)
  const w: World = { ...w0, lens: coarseLenses(w0.lens) };
  // (a moving target — an orbiting mouth — is met where it is when the ship gets there)
  const at = typeof target === "function" ? target : () => target;
  const lead = Math.max(20, 0.03 * period(st0.r), w.lead ?? 0);
  const T = period(st0.r);
  // time to get there at the ship's speed, with room for a curved path
  const reach = (s1: Massive) => (3 * len(sub(position(s1), at(s1.t)))) / Math.max(len(toZamo(s1, w.a)), 0.1) + 100;
  const missVec = (s1: Massive, dv: Vec3): Vec3 | null => {
    // (the path ends once it is well past the target: going away, twice as far as its closest yet)
    let dMin = Infinity;
    let away = 0;
    const past = (q: Vec3, t: number) => {
      const d = len(sub(q, at(t)));
      if (d < dMin) (dMin = d), (away = 0);
      else away++;
      return away > 8 && d > 2 * dMin + 1;
    };
    const p = pathFrom(applyDv(s1, dv, w.a), w, reach(s1), 260, past);
    let best: Vec3 | null = null;
    let bd = Infinity;
    // closest point, refined on the segment
    for (let j = 0; j < p.pts.length; j++) {
      const a = j ? p.pts[j - 1]! : position(s1), b = p.pts[j]!;
      const tgt = at(p.times[j]!);
      const e = sub(b, a);
      const u = Math.min(1, Math.max(0, dot(sub(tgt, a), e) / Math.max(dot(e, e), 1e-12)));
      const q = add(a, scale(e, u));
      const d = len(sub(q, tgt));
      if (d < bd) (bd = d), (best = sub(q, tgt));
    }
    return best;
  };
  let sol: { t1: number; dv: Vec3; miss: number } | null = null;
  let s: Massive | null = advanceTo(st0, st0.t + lead, w);
  const n = 12;
  for (let k = 0; k < n && s; k++) {
    const t1 = st0.t + lead + (T * k) / n;
    s = advanceTo(s, t1, w);
    if (!s) break;
    // first guess: head straight for the target at about the current speed
    const X = position(s);
    const f = localFrame(s);
    const d = norm(sub(at(s.t + len(sub(at(s.t), X)) / Math.max(len(toZamo(s, w.a)), 0.1)), X));
    const b = toZamo(s, w.a);
    const sp = Math.max(len(b), 0.15);
    const bT: Vec3 = scale([dot(d, f.er), dot(d, f.et), dot(d, f.ep)], sp);
    let dv = matchDv(s, bT, w.a);
    let m = missVec(s, dv);
    for (let it = 0; it < 10 && m; it++) {
      if (len(m) < tol) break;
      // Jacobian by finite differences, damped Gauss–Newton step
      const h = 1e-3;
      const J: Vec3[] = [];
      for (let c = 0; c < 3; c++) {
        const d2: Vec3 = [...dv];
        d2[c] += h;
        const mc = missVec(s, d2);
        if (!mc) break;
        J.push(scale(sub(mc, m), 1 / h));
      }
      if (J.length < 3) break;
      const step2 = solve3(J, scale(m, -1));
      if (!step2) break;
      let lam = 1;
      let next: Vec3 | null = null;
      for (let ls = 0; ls < 6; ls++) {
        const cand = add(dv, scale(step2, lam));
        if (len(cand) > 0.9) {
          lam /= 2;
          continue;
        }
        const mc = missVec(s, cand);
        if (mc && len(mc) < len(m)) {
          next = cand;
          m = mc;
          break;
        }
        lam /= 2;
      }
      if (!next) break;
      dv = next;
    }
    if (m && len(m) < tol * 4 && (!sol || len(dv) < len(sol.dv))) sol = { t1, dv, miss: len(m) };
  }
  if (!sol) return null;
  return { nodes: [{ t: sol.t1, dv: sol.dv }], note: `intercept: passes ${sol.miss.toFixed(2)} M from the centre`, miss: sol.miss };
}

/** Solves J x = b for 3 column vectors J (J[c] = ∂miss/∂dv_c). */
function solve3(J: Vec3[], b: Vec3): Vec3 | null {
  const [c0, c1, c2] = J as [Vec3, Vec3, Vec3];
  const det = dot(c0, cross(c1, c2));
  if (Math.abs(det) < 1e-14) return null;
  return [dot(b, cross(c1, c2)) / det, dot(c0, cross(b, c2)) / det, dot(c0, cross(c1, b)) / det];
}
