// The CameraController — the camera's travel to a body or a craft (goTo, our universe): from where the view is to
// the destination's framing, never a cut — the distance to the destination eased on a log scale (across the
// void fast, slowing near it as near the start), the direction from it slerped, the look turned to it on the
// way and then onto the framing, the curve and time the blend's (settings.camBlend). The destination's pose
// asked at each frame's time: a moving planet, a craft on its orbit, met where they are.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { timeRate } from "../clock";
import { setHomePose } from "../camera";
import { blendCurve, lookQ, qAxes, qSlerp } from "../cine/follow";
import { add3, cross3, dot3, len3, scale3, sub3, unit3, type V3 } from "../cine/rig";
import type { Vec3 } from "../physics";
import type { CameraController } from "../controls";
import { viewBlend } from "./camrig";

declare module "../controls" {
  interface CameraController {
    startTravel: typeof startTravel;
    travelStep: typeof travelStep;
  }
}

/** The destination's framing at a time: the camera's place, look, up and velocity (home frame), its centre. */
export interface TravelGoal {
  X: Vec3;
  fwd: Vec3;
  up: Vec3;
  V: Vec3;
  C: Vec3;
}

/** The travel's length [s]: longer the more orders of magnitude it crosses (1.2 … 6 s, the blend's at least). */
export function travelTime(d0: number, d1: number, blend: number): number {
  const decades = Math.abs(Math.log10(Math.max(d0, 1e-30) / Math.max(d1, 1e-30)));
  return Math.min(6, Math.max(1.2, blend, 1.2 + 0.45 * decades));
}

/**
 * The camera's place and look at weight k ∈ [0, 1] of a travel from (X0, q0) to the goal: the distance to its
 * centre eased geometrically, the direction slerped, the look turned to the centre midway.
 */
export function travelPose(X0: V3, f0: V3, u0: V3, g: { X: V3; fwd: V3; up: V3; C: V3 }, k: number): { X: V3; fwd: V3; up: V3 } {
  const r0 = sub3(X0, g.C),
    r1 = sub3(g.X, g.C);
  const d0 = Math.max(len3(r0), 1e-30),
    d1 = Math.max(len3(r1), 1e-30);
  const a = unit3(r0),
    b = unit3(r1);
  const ang = Math.acos(Math.min(1, Math.max(-1, dot3(a, b))));
  let dir: V3;
  if (ang < 1e-6) dir = b;
  else {
    let axis = cross3(a, b);
    if (len3(axis) < 1e-9) axis = Math.abs(a[1]) < 0.9 ? cross3(a, [0, 1, 0]) : cross3(a, [1, 0, 0]);
    axis = unit3(axis);
    const th = ang * k;
    // (Rodrigues: a turned about the axis)
    dir = add3(add3(scale3(a, Math.cos(th)), cross3(axis, a), Math.sin(th)), axis, dot3(axis, a) * (1 - Math.cos(th)));
  }
  const d = Math.exp(Math.log(d0) * (1 - k) + Math.log(d1) * k);
  const X = add3(g.C, scale3(dir, d));
  // the look: to the destination's centre by midway, then onto its framing
  const upMid = unit3(add3(scale3(u0, 1 - k), scale3(g.up, k)), g.up);
  const qc = lookQ(sub3(g.C, X), upMid);
  const q =
    k < 0.5
      ? qSlerp(lookQ(f0, u0), qc, blendCurve("easeInOut", k * 2))
      : qSlerp(qc, lookQ(g.fwd, g.up), blendCurve("easeInOut", k * 2 - 1));
  const [, y, z] = qAxes(q);
  return { X, fwd: z, up: y };
}

/** A travel begun from where the view is (our universe); `done` once there (the framing's own settings). */
function startTravel(this: CameraController, goal: (t: number) => TravelGoal, done: () => void): boolean {
  const w = this.rigWorld();
  if (!w || !w.ours) return false;
  const t0 = Number.isFinite(this.time) ? this.time : 0;
  const g0 = goal(t0);
  const T = travelTime(len3(sub3(w.X as V3, g0.C as V3)), len3(sub3(g0.X as V3, g0.C as V3)), viewBlend(this.s).time);
  this.travel = { X0: [...w.X] as V3, f0: [...w.fwd] as V3, u0: [...w.up] as V3, goal, done, t: 0, T };
  this.setCinematic(null);
  return true;
}

/** A frame of the travel (after the rest of the camera's motion: it sets the pose); false: none. */
function travelStep(this: CameraController, dt: number): boolean {
  const tr = this.travel;
  if (!tr) return false;
  const s = this.s;
  tr.t = Math.min(1, tr.t + dt / tr.T);
  const tEnd = (Number.isFinite(this.time) ? this.time : 0) + (s.animate ? timeRate(s) * dt : 0);
  const g = tr.goal(tEnd);
  const B = viewBlend(s);
  const k = blendCurve(B.style === "cut" ? "easeInOut" : B.style, tr.t);
  const p = travelPose(tr.X0, tr.f0, tr.u0, { X: g.X as V3, fwd: g.fwd as V3, up: g.up as V3, C: g.C as V3 }, k);
  setHomePose(s, p.X as Vec3, p.fwd as Vec3, p.up as Vec3, g.V);
  s.motion = "geodesic";
  this.sync();
  if (tr.t >= 1) {
    this.travel = null;
    setHomePose(s, g.X, g.fwd, g.up, g.V);
    this.sync();
    tr.done();
  }
  return true;
}

export function installTravel(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { startTravel, travelStep });
}
