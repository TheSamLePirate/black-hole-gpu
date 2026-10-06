// Shared Dneg drift used by flight and its map prediction. Thrust is applied by the caller.
import type { Vec3 } from "../physics";
import type { Settings } from "../settings";
import { blToCartesian } from "../camera";
import { advance, type Lenses, type Massive } from "../geodesic";
import { lin } from "../math/vec3";
import { flyDneg, mouth, mouthCentre, type Dneg } from "../wormhole";
import { homeToRep, ourGravity, ourState } from "./our-side";

export interface DnegFlightState {
  l: number;
  n: Vec3;
  fwd: Vec3;
  up: Vec3;
  vel: Vec3;
}

export function driftDneg(w: Dneg, initial: DnegFlightState, t0: number, span: number, steps: number, solarGravity: boolean) {
  let pose = initial;
  let v = initial.vel;
  let tau = 0;
  const dt = span / steps;
  for (let i = 0; i < steps; i++) {
    if (solarGravity && pose.l < -w.a) {
      const g = ourGravity(w, pose.l, pose.n, t0 + i * dt);
      if (g.inside) {
        v = homeToRep(w, pose.l, pose.n, ourState(g.inside, t0 + i * dt).vel);
        break;
      }
      v = lin(v, 1, g.acc, dt / 2);
    }
    const speed = Math.hypot(...v);
    tau += dt * Math.sqrt(Math.max(1 - speed * speed, 0));
    if (speed >= 1e-12) {
      const q = flyDneg(w, pose.l, pose.n, lin(v, 1 / speed, v, 0), [pose.fwd, pose.up], speed * dt);
      pose = { ...pose, l: q.l, n: q.n, fwd: q.vectors[0]!, up: q.vectors[1]! };
      v = lin(q.dir, speed, q.dir, 0);
    }
    if (solarGravity && pose.l < -w.a) {
      const g = ourGravity(w, pose.l, pose.n, t0 + (i + 1) * dt);
      if (!g.inside) v = lin(v, 1, g.acc, dt / 2);
      const sp = Math.hypot(...v);
      if (sp > 0.999) v = lin(v, 0.999 / sp, v, 0);
    }
  }
  return { ...pose, vel: v, tau };
}

/**
 * The span of a step at which it crosses a boundary, between `lo` (short of it: f ≤ 0) and a span past
 * it (f > 0): false position with the Illinois correction — superlinear on a smooth crossing, never
 * out of its bracket — until f is within `fTol` past the boundary or the bracket within `xTol`, in at
 * most `evals` runs of the step. `run(span)` gives the span actually reached (a run may stop on the
 * boundary early), f there, and its result; the one returned is past the boundary.
 */
export function crossingSpan<T>(
  run: (span: number) => { x: number; f: number; r: T },
  lo: number,
  fLo: number,
  past: { x: number; f: number; r: T },
  fTol: number,
  xTol: number,
  evals = 16,
) {
  let hi = past;
  let fl = fLo,
    fh = hi.f,
    side = 0;
  for (let i = 0; i < evals && hi.f > fTol && hi.x - lo > xTol; i++) {
    const guess = (lo * fh - hi.x * fl) / (fh - fl);
    const q = run(guess > lo && guess < hi.x ? guess : 0.5 * (lo + hi.x));
    if (q.f > 0) {
      hi = q;
      fh = q.f;
      if (side > 0) fl /= 2;
      side = 1;
    } else {
      lo = q.x;
      fl = q.f;
      if (side < 0) fh /= 2;
      side = -1;
    }
  }
  return hi;
}

/** End the Dneg step at the outgoing gluing event, preserving the elapsed clock and transported axes. */
export function driftToGlue(
  w: Dneg,
  initial: DnegFlightState,
  t: number,
  dt: number,
  steps: number,
  solarGravity: boolean,
  lGlue: number,
  velocityAt?: (dt: number) => Vec3,
) {
  const run = (span: number) => {
    const r = driftDneg(w, velocityAt ? { ...initial, vel: velocityAt(span) } : initial, t, span, steps, solarGravity);
    return { x: span, f: r.l - lGlue, r };
  };
  let out = run(dt);
  if (initial.l <= lGlue && out.f > 0) {
    const scale = Math.max(w.rho, Math.abs(lGlue));
    out = crossingSpan(run, 0, initial.l - lGlue, out, 1e-12 * scale, 1e-12 * dt);
    // The camera uses a strict > boundary: one negligible offset selects Kerr on the next step.
    out.r.l = lGlue + 8 * Number.EPSILON * scale;
  }
  return { ...out.r, elapsed: out.x };
}

/** Live flight and prediction both stop Kerr at the moving mouth before continuing in Dneg. */
export function advanceToMouth(
  s: Settings,
  st: Massive,
  dt: number,
  accel = 0,
  dir: Vec3 = [0, 0, 0],
  lenses?: Lenses,
  spins?: number[][],
) {
  if (!s.wormhole) return advance(st, s.spin, dt, 0.05, accel, dir, lenses, undefined, spins);
  const m = mouth(s, st.t),
    X = blToCartesian(st.r, st.th, st.ph);
  const distance = Math.hypot(X[0] - m.C[0], X[1] - m.C[1], X[2] - m.C[2]);
  // (out of reach in this step: on the map nothing moves faster than light — the ship's coordinate
  // speed stays below 1 down to the horizon —, the mouth at |V|; twice that, for a margin)
  if (distance - m.rGlue > 2 * (1 + Math.hypot(...m.V)) * dt) return advance(st, s.spin, dt, 0.05, accel, dir, lenses, undefined, spins);
  const rGlue = m.rGlue * (1 - 1e-10);
  // (how far inside the gluing sphere: > 0 inside)
  const depth = (q: Massive) => {
    const c = mouthCentre(s, q.t).C,
      p = blToCartesian(q.r, q.th, q.ph);
    return rGlue - Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  };
  const initialSpins = spins?.map((v) => [...v]);
  const boundary = {
    inside: (q: Massive) => depth(q) > 0,
    maxDt: (q: Massive) => {
      const { C, V } = mouthCentre(s, q.t),
        p = blToCartesian(q.r, q.th, q.ph);
      const d = Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]);
      return (0.15 * Math.max(d, m.rGlue)) / (1 + Math.hypot(...V));
    },
  };
  const run = (span: number) => {
    const transported = initialSpins?.map((v) => [...v]);
    const result = advance(st, s.spin, span, 0.05, accel, dir, lenses, undefined, transported, boundary);
    return { x: result.st.t - st.t, f: depth(result.st), r: { result, transported } };
  };
  let out = run(dt);
  // (entered on the way — a run stops at its first step inside —: the entry itself, within 10⁻¹² of the
  // sphere's radius or of the step)
  if (distance >= m.rGlue && out.f > 0) out = crossingSpan(run, 0, rGlue - distance, out, 1e-12 * m.rGlue, 1e-12 * dt);
  if (spins && out.r.transported) for (let j = 0; j < spins.length; j++) spins[j] = out.r.transported[j]!;
  return out.r.result;
}
