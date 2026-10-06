// Shared Dneg drift used by flight and its map prediction. Thrust is applied by the caller.
import type { Vec3 } from "../physics";
import type { Settings } from "../settings";
import { blToCartesian } from "../camera";
import { advance, type Lenses, type Massive } from "../geodesic";
import { lin } from "../math/vec3";
import { flyDneg, mouth, type Dneg } from "../wormhole";
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
  const run = (span: number) => driftDneg(w, velocityAt ? { ...initial, vel: velocityAt(span) } : initial, t, span, steps, solarGravity);
  let elapsed = dt;
  let result = run(elapsed);
  if (initial.l <= lGlue && result.l > lGlue) {
    let lo = 0,
      hi = dt;
    for (let j = 0; j < 40; j++) {
      const mid = (lo + hi) / 2;
      if (run(mid).l <= lGlue) lo = mid;
      else hi = mid;
    }
    elapsed = hi;
    result = run(elapsed);
    // The camera uses a strict > boundary: one negligible offset selects Kerr on the next step.
    result.l = lGlue + 8 * Number.EPSILON * Math.max(w.rho, Math.abs(lGlue));
  }
  return { ...result, elapsed };
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
  const initialSpins = spins?.map((v) => [...v]);
  const inside = (q: Massive) => {
    const m = mouth(s, q.t),
      p = blToCartesian(q.r, q.th, q.ph);
    return Math.hypot(p[0] - m.C[0], p[1] - m.C[1], p[2] - m.C[2]) < m.rGlue * (1 - 1e-10);
  };
  const boundary = {
    inside,
    maxDt: (q: Massive) => {
      const m = mouth(s, q.t),
        p = blToCartesian(q.r, q.th, q.ph);
      const d = Math.hypot(p[0] - m.C[0], p[1] - m.C[1], p[2] - m.C[2]);
      return (0.15 * Math.max(d, m.rGlue)) / (1 + Math.hypot(...m.V));
    },
  };
  const run = (span: number) => {
    const transported = initialSpins?.map((v) => [...v]);
    return { result: advance(st, s.spin, span, 0.05, accel, dir, lenses, undefined, transported, boundary), transported };
  };
  let out = run(dt);
  if (distance >= m.rGlue && inside(out.result.st)) {
    let lo = 0,
      hi = out.result.st.t - st.t;
    for (let j = 0; j < 36; j++) {
      const mid = (lo + hi) / 2;
      if (inside(run(mid).result.st)) hi = mid;
      else lo = mid;
    }
    out = run(hi);
  }
  if (spins && out.transported) for (let j = 0; j < spins.length; j++) spins[j] = out.transported[j]!;
  return out.result;
}
