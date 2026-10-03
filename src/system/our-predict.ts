// The ship's future path in our universe (Newton, home frame): velocity Verlet with steps a small
// part of the local fall time, through the pull of the Sun, the planets and — near a planet — its
// moons, less the frame's own acceleration (the mouth falls around the Sun with Saturn). Manoeuvre
// nodes are impulses: Δv in the frame of the body of the sphere of influence at the node (P along
// the velocity relative to it, N normal to the orbit, R = N × P, radial-ish).
//
// A few thousand steps a call: the map's path is recomputed a few times a second.

import { zonalAccel } from "./geopotential";
import type { Vec3 } from "../physics";
import { referenceBody, soiOf } from "./our-side";
import { M_METRES, mouthAccel, SOLAR_BODIES, solarBody, solarState, spinVector } from "./solar";
import { airAt, airTop } from "../aero";
import { add, cross, dot, sub } from "../math/vec3";

export interface OurNode {
  /** scene time [M] and Δv [P, N, R] (c) */
  t: number;
  dv: Vec3;
}

export interface OurPath {
  pts: Vec3[];
  vels: Vec3[];
  times: number[];
  /** the body of the sphere of influence at each point */
  refs: string[];
  fate: "continues" | "impact" | "wormhole";
  /** the body hit (impact) */
  hit?: string;
  /** index of each node's point (the path after it follows the burn) */
  nodeAt: number[];
}

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// (the Sun and the planets — and the Moon: massive, near where flights start, its pull on a ship
// leaving the Earth is still ~2 m/s of velocity past the sphere of influence)
const PLANETS = SOLAR_BODIES.filter((b) => b.parent === "sun" || b.kind === "star" || b.id === "moon");
const moonsOf = (id: string) => SOLAR_BODIES.filter((b) => b.parent === id);

/** The body set felt near a place: the Sun, the planets, and the moons of the planet it is near. */
function bodiesNear(ref: string) {
  const b = SOLAR_BODIES.find((q) => q.id === ref)!;
  const planet = b.parent && b.parent !== "sun" ? b.parent : b.kind === "planet" ? b.id : null;
  return planet ? [...PLANETS, ...moonsOf(planet).filter((b) => b.id !== "moon")] : PLANETS;
}

/** Yoshida's fourth-order weights for a composition of velocity-Verlet steps (sum 1). */
const Y1 = 1 / (2 - Math.cbrt(2));
export const YOSHIDA = [Y1, 1 - 2 * Y1, Y1];

/**
 * A step a fraction s of the fall time tDyn, symmetrised in time (audit P6: a step chosen at its start
 * alone breaks the composition's symplecticity — an eccentric orbit's energy drifted 2e-5 over 200 turns):
 * the mean of the fall times at the step's two ends, the end's from the rate it changes at (tDot) — the
 * drift 1e-9, for no more pulls.
 */
export const symmetricStep = (s: number, tDyn: number, tDot: number) => (s * tDyn) / Math.max(1 - 0.5 * s * tDot, 0.5);

/** The pull at X, time t, from a body set (the frame's own acceleration taken off); with V, the rate the fall time changes at. */
function pull(X: Vec3, t: number, set: typeof SOLAR_BODIES, V?: Vec3) {
  const f = mouthAccel(t);
  let a: Vec3 = [-f[0], -f[1], -f[2]];
  let tDyn = Infinity,
    tDot = 0;
  let hit: string | null = null;
  for (const b of set) {
    const S = solarState(b.id, t);
    const P = S.pos;
    const d = sub(P, X);
    const r = Math.hypot(...d);
    if (r < b.radius) hit = b.id;
    const re = Math.max(r, b.radius);
    a = add(a, d, b.mass / re ** 3);
    // (its oblateness, as the flight feels it)
    const z = r > b.radius ? zonalAccel(b.id, b.mass, [-d[0], -d[1], -d[2]], t) : null;
    if (z) a = add(a, z, 1);
    const td = Math.sqrt(re ** 3 / b.mass);
    if (td < tDyn) {
      tDyn = td;
      // (dτ/dt = 3/2 τ ṙ/r, ṙ the speed away from the body)
      tDot = V && r > b.radius ? (-1.5 * td * dot(d, sub(V, S.vel))) / (r * r) : 0;
    }
  }
  return { a, tDyn, tDot, hit };
}

/** A node's Δv [P, N, R] as a home-frame vector, at X, V, time t (the frame of the reference body there). */
export function nodeDvHome(X: Vec3, V: Vec3, t: number, dv: Vec3): Vec3 {
  const ref = referenceBody(X, t);
  const st = solarState(ref, t);
  const v = sub(V, st.vel);
  const r = sub(X, st.pos);
  const P = unit(v);
  let N = cross(r, P);
  if (Math.hypot(...N) < 1e-30) N = cross([0, 0, 1], P);
  N = unit(N);
  const R = cross(N, P);
  return add(add([P[0] * dv[0], P[1] * dv[0], P[2] * dv[0]], N, dv[1]), R, dv[2]);
}

/** Its inverse: a home-frame Δv as [P, N, R] at X, V, t. */
export function nodeDvComponents(X: Vec3, V: Vec3, t: number, d: Vec3): Vec3 {
  const ref = referenceBody(X, t);
  const st = solarState(ref, t);
  const P = unit(sub(V, st.vel));
  let N = cross(sub(X, st.pos), P);
  if (Math.hypot(...N) < 1e-30) N = cross([0, 0, 1], P);
  N = unit(N);
  const R = cross(N, P);
  return [dot(d, P), dot(d, N), dot(d, R)];
}

/**
 * The path from (X, V) at t0 for about a turn of the orbit around its reference body (or, leaving it,
 * on until tMax), the nodes' impulses applied on the way. maxSteps bounds the work.
 */
export function predictOurs(
  X0: Vec3,
  V0: Vec3,
  t0: number,
  nodes: OurNode[] = [],
  o: { tMax?: number; maxSteps?: number; mouthR?: number; step?: number; accel?: number; drag?: number } = {},
): OurPath {
  const maxSteps = o.maxSteps ?? 2500;
  const out: OurPath = { pts: [X0], vels: [V0], times: [t0], refs: [], fate: "continues", nodeAt: [] };
  let X = X0,
    V = V0,
    t = t0;
  let ref = referenceBody(X, t);
  out.refs.push(ref);
  let set = bodiesNear(ref);
  const pending = [...nodes].sort((a, b) => a.t - b.t);
  // (the horizon: a turn and a tenth of the orbit around the reference body — or, unbound, on until
  // the sphere of influence is left and a while after; at most two years)
  const horizon = () => {
    const st = solarState(ref, t);
    const mb = SOLAR_BODIES.find((b) => b.id === ref)!.mass;
    const r = Math.hypot(...sub(X, st.pos));
    const v2 = dot(sub(V, st.vel), sub(V, st.vel));
    const eps = v2 / 2 - mb / r;
    if (eps < 0) {
      const a = -mb / (2 * eps);
      return Math.min(1.1 * 2 * Math.PI * Math.sqrt(a ** 3 / mb), 1.3e5);
    }
    return 1.3e5;
  };
  // (a span asked for is kept — up to ~40 years; else the horizon, extended after each node)
  const fixed = o.tMax !== undefined;
  let tEnd = fixed ? t0 + Math.min(o.tMax!, 2.6e6) : Math.min(t0 + horizon(), t0 + 1.3e5);
  if (pending.length && !fixed) tEnd = Math.max(tEnd, pending[pending.length - 1]!.t + 1);
  let g = pull(X, t, set, V);
  let lastRefCheck = t;
  // (finite burns, as the ship flies them: the engine's acceleration along the node's P/N/R
  // direction — turning with the orbit — centred on the node's time, until its Δv is given)
  const acc = o.accel ?? 0;
  const startOf = (n: OurNode) => (acc > 0 ? Math.max(n.t - Math.hypot(...n.dv) / acc / 2, t0) : n.t);
  let burn: { dv: Vec3; left: number; T: number } | null = null;
  const thrust = (Xq: Vec3, Vq: Vec3, tq: number): Vec3 => {
    if (!burn) return [0, 0, 0];
    const d = nodeDvHome(Xq, Vq, tq, burn.dv);
    const l = Math.hypot(...d) || 1;
    return [(d[0] / l) * acc, (d[1] / l) * acc, (d[2] / l) * acc];
  };
  // (the air: the craft's drag, C_D A / m [m²/kg] — through the air turning with its body)
  const air = (Xq: Vec3, Vq: Vec3, tq: number): { a: Vec3; rate: number } | null => {
    const b = o.drag ? solarBody(ref) : undefined;
    if (!b?.atmosphere || b.kind === "star") return null;
    const st = solarState(ref, tq);
    const d = sub(Xq, st.pos);
    const h = (Math.hypot(...d) - b.radius) * M_METRES;
    if (h > airTop(b.atmosphere)) return null;
    const w = spinVector(b, tq);
    const va = sub(Vq, add(st.vel, cross(w, d)));
    const v = Math.hypot(...va);
    const k = 0.5 * airAt(b.atmosphere, h).rho * v * o.drag! * M_METRES;
    return { a: [-k * va[0], -k * va[1], -k * va[2]], rate: k };
  };
  for (let i = 0; i < maxSteps && t < tEnd; i++) {
    let dt = symmetricStep(o.step ?? 0.02, g.tDyn, g.tDot);
    const inAir = air(X, V, t);
    if (inAir) dt = Math.min(dt, 0.004 * g.tDyn, inAir.rate > 0 ? 0.05 / inAir.rate : Infinity);
    // (land on the next node — or its burn's start — exactly)
    const next: OurNode | undefined = burn ? undefined : pending[0];
    if (next && t + dt >= startOf(next)) dt = Math.max(startOf(next) - t, 0);
    if (burn) dt = Math.min(dt, burn.T / 40, burn.left / acc);
    dt = Math.min(dt, tEnd - t);
    if (burn || inAir) {
      const drag = (Xq: Vec3, Vq: Vec3, tq: number): Vec3 => air(Xq, Vq, tq)?.a ?? [0, 0, 0];
      const a0 = add(add(g.a, thrust(X, V, t)), drag(X, V, t));
      V = add(V, a0, dt / 2);
      X = add(X, V, dt);
      t += dt;
      g = pull(X, t, set, V);
      V = add(V, add(add(g.a, thrust(X, V, t)), drag(X, V, t)), dt / 2);
    } else {
      // (coasting: Yoshida's composition of three velocity-Verlet steps — fourth order, still
      // symplectic: months between the planets stay within a few km)
      const tn = t + dt;
      for (let k = 0; k < 3; k++) {
        const h = YOSHIDA[k]! * dt;
        V = add(V, g.a, h / 2);
        X = add(X, V, h);
        // (the last substep lands on the step's end exactly: the weights' sum is 1 only to rounding)
        t = k === 2 ? tn : t + h;
        g = pull(X, t, set, V);
        V = add(V, g.a, h / 2);
      }
    }
    if (burn) {
      burn.left -= acc * dt;
      if (burn.left <= 1e-15) {
        burn = null;
        // (the burn done: a turn of the orbit it gave — at its start, the old orbit's was taken)
        if (!fixed) tEnd = Math.max(tEnd, Math.min(t + horizon(), t0 + 1.3e5));
      }
    }
    if (next && t >= startOf(next) - 1e-9) {
      const size = Math.hypot(...next.dv);
      if (acc > 0 && size > 0) burn = { dv: next.dv, left: size, T: size / acc };
      else V = add(V, nodeDvHome(X, V, t, next.dv));
      pending.shift();
      out.nodeAt.push(out.pts.length);
      // (after a burn: a turn of the new orbit)
      if (!fixed) {
        tEnd = Math.max(tEnd, Math.min(t + horizon(), t0 + 1.3e5));
        if (pending.length) tEnd = Math.max(tEnd, pending[pending.length - 1]!.t + 1);
      }
    }
    // the reference body (a few times per local fall time)
    if (t - lastRefCheck > 0.2 * g.tDyn) {
      lastRefCheck = t;
      const r2 = referenceBody(X, t);
      if (r2 !== ref) {
        ref = r2;
        set = bodiesNear(ref);
        g = pull(X, t, set, V);
      }
    }
    out.pts.push(X);
    out.vels.push(V);
    out.times.push(t);
    out.refs.push(ref);
    if (g.hit) {
      out.fate = "impact";
      out.hit = g.hit;
      break;
    }
    if (o.mouthR && Math.hypot(...X) < o.mouthR) {
      out.fate = "wormhole";
      break;
    }
  }
  return out;
}

/** Periapsis and apoapsis of a path around a body (its first stretch in that body's sphere). */
export function ourApsides(p: OurPath, body: string) {
  let pe = { d: Infinity, i: -1 },
    ap = { d: -Infinity, i: -1 };
  let started = false;
  for (let i = 0; i < p.pts.length; i++) {
    if (p.refs[i] !== body) {
      if (started) break;
      continue;
    }
    started = true;
    const d = Math.hypot(...sub(p.pts[i]!, solarState(body, p.times[i]!).pos));
    if (d < pe.d) pe = { d, i };
    if (d > ap.d) ap = { d, i };
  }
  const R = SOLAR_BODIES.find((b) => b.id === body)?.radius ?? 0;
  const soi = soiOf(body, p.times[0] ?? 0);
  // (an apoapsis only on a closed orbit: not at the path's end nor beyond the sphere)
  const closed = ap.i > 0 && ap.i < p.pts.length - 2 && ap.d < soi;
  return { pe: pe.i >= 0 ? { alt: pe.d - R, i: pe.i } : null, ap: closed ? { alt: ap.d - R, i: ap.i } : null };
}

/** The closest approach of a path to a body (its place at the same times). */
export function ourClosest(p: OurPath, body: string, from = 0) {
  let best = { d: Infinity, i: -1 };
  for (let i = from; i < p.pts.length; i++) {
    const d = Math.hypot(...sub(p.pts[i]!, solarState(body, p.times[i]!).pos));
    if (d < best.d) best = { d, i };
  }
  return best.i >= 0 ? best : null;
}
