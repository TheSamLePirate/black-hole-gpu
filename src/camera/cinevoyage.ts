// The CameraController — the cinematic voyage (docs/PLAN-CAMERA-AAA.md CAM7, ⇧G): the relativistic voyage dressed as a
// film's — down from where one is to a low pass over the world one leaves (camera/skim.ts), up again and away at
// relativistic speed (camera/voyager.ts), then down to a low pass over the world one reaches, and up to its framing.
// Two cuts of it (settings.voyageCine):
// - "sequence": one continuous shot — each leg eased in and out, the look carried from one to the next;
// - "montage": cuts — the voyage seen looking back at the world left, then ahead in the void, then at the world
//   coming (the look cut, the place continuous), each cut marked for the camera's sensor.
// The low passes run on the wall clock (the world's own pace: the voyage's warp is the voyage's alone).
// (Its methods: installed on the controller's prototype — `this` the controller.)
import { setHomePose } from "../camera";
import { blendCurve, lookQ, qAxes, qSlerp } from "../cine/follow";
import type { V3 } from "../cine/rig";
import type { TravelGoal } from "../controller/travel";
import type { CameraController } from "../controls";
import type { Vec3 } from "../physics";
import { bodyAxes, solarBody } from "../system/solar";
import { groundAboveSphere, solidBody, toBodyFixed } from "../system/our-surface";
import { M_METRES } from "../units";
import { planSkim, type SkimPose } from "./skim";
import type { Voyage } from "./voyager";

declare module "../controls" {
  interface CameraController {
    startCineVoyage: typeof startCineVoyage;
    cineVoyageStep: typeof cineVoyageStep;
    stopCineVoyage: typeof stopCineVoyage;
  }
}

type Leg = { kind: "skim"; body: string; dur: number; plan: ReturnType<typeof planSkim> | null; way: "out" | "in" } | { kind: "voyage" };

export interface CineVoyage {
  mode: "sequence" | "montage";
  legs: Leg[];
  i: number;
  /** the wall time in the leg [s] */
  t: number;
  goal: (t: number) => TravelGoal;
  done: () => void;
  name: string;
  /** the target's id (its world's low pass), the world left's */
  target: string;
  origin: string | null;
  /** the look the last leg left (the next one turns from it) */
  q: [number, number, number, number] | null;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A world one can pass low over: ours, with a sphere (the Sun not), its pass's height over the ground [m]. */
function passable(id: string | null): { hSkim: number } | null {
  if (!id || id === "sun") return null;
  const b = solarBody(id);
  if (!b || !(b.radius > 0)) return null;
  return { hSkim: solidBody(id) ? 900 : 250e3 };
}

/** The cinematic voyage begun (our side), to a goal; false: none there. */
function startCineVoyage(
  this: CameraController,
  goal: (t: number) => TravelGoal,
  done: () => void,
  name: string,
  target: string,
  mode: "sequence" | "montage",
): boolean {
  const w = this.rigWorld();
  if (!w?.ours) return false;
  const t0 = this.nowTime();
  const near = this.rigNearest(true, w.X, t0);
  const origin = near && passable(near.id) && (len(sub(w.X, near.C)) - near.R) / near.R < 30 ? near.id : null;
  const legs: Leg[] = [];
  if (origin) legs.push({ kind: "skim", body: origin, dur: 14, plan: null, way: "out" });
  legs.push({ kind: "voyage" });
  if (passable(target)) legs.push({ kind: "skim", body: target, dur: 14, plan: null, way: "in" });
  this.endVoyage(false);
  this.cineVoyage = { mode, legs, i: 0, t: 0, goal, done, name, target, origin, q: null };
  this.setCinematic(null);
  this.onCut?.();
  return true;
}

/** The low pass over a world from where the view is: its plan (body-fixed), heading `toward` (home) projected. */
function skimFrom(this: CameraController, body: string, toward: Vec3 | null, sunward: boolean): ReturnType<typeof planSkim> | null {
  const w = this.rigWorld();
  const b = solarBody(body);
  const p = passable(body);
  if (!w || !b || !p) return null;
  const t = this.nowTime();
  const q = toBodyFixed(body, w.X, t);
  const R = b.radius;
  const start = unit(q);
  const A = bodyAxes(b, t);
  const fixed = (v: Vec3): Vec3 => [0, 1, 2].map((i) => v[0] * A[i]![0] + v[1] * A[i]![1] + v[2] * A[i]![2]) as Vec3;
  // (the heading: toward the way on — the voyage's, out —, or toward the day — the Sun's, in)
  let dir: Vec3 | null = toward ? fixed(unit(toward)) : null;
  if (sunward) {
    const sun = this.rigBody("sun" as never, true, t);
    const C = this.rigBody(body as never, true, t);
    if (sun && C) dir = fixed(unit(sub(sun.C, C.C)));
  }
  let hd: Vec3 = dir ? sub(dir, start.map((x) => x * (dir![0] * start[0] + dir![1] * start[1] + dir![2] * start[2])) as Vec3) : [0, 0, 1];
  if (len(hd) < 1e-6) hd = Math.abs(start[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  hd = unit(sub(hd, start.map((x) => x * (hd[0] * start[0] + hd[1] * start[1] + hd[2] * start[2])) as Vec3));
  const hIn = Math.max(len(q) - R, p.hSkim / M_METRES);
  // (at night under the view: the way down a long glide toward the day — the terminator and 12° more —, the pass
  // in the light; the heading then the Sun's way)
  const sunB = this.rigBody("sun" as never, true, t),
    bodyC = this.rigBody(body as never, true, t);
  let night = 0;
  if (sunB && bodyC) {
    const toSun = fixed(unit(sub(sunB.C, bodyC.C)));
    const c = start[0] * toSun[0] + start[1] * toSun[1] + start[2] * toSun[2];
    if (c < 0.2) {
      night = Math.acos(Math.max(-1, Math.min(1, c))) - Math.acos(0.2);
      const hs: Vec3 = sub(toSun, start.map((x) => x * c) as Vec3);
      if (len(hs) > 1e-6) hd = unit(hs);
    }
  }
  const low = 0.012;
  const arc = low + night;
  // (two thirds of a degree of the world — some 75 km of the Earth —, the ground as drawn: its figure, its relief)
  const solid = solidBody(body);
  return planSkim({
    R,
    ground: (u) => (solid ? groundAboveSphere(body, [u[0] * R, u[1] * R, u[2] * R]) / M_METRES : 0),
    start,
    heading: hd,
    arc,
    hSkim: p.hSkim / M_METRES,
    hIn,
    hOut: hIn,
    ease: (0.3 * low) / arc,
    easeIn: night > 0 ? (night + 0.3 * low) / arc : (0.3 * low) / arc,
    shares: [2.5, 1, 1.5],
    // (the pass itself in 300 samples at least, however long the glide before it)
    n: Math.min(8000, Math.max(600, Math.ceil((arc / low) * 300))),
  });
}

/** The pose of a pass at a share of its leg, in the home frame (place, look, up, the ground's velocity). */
function skimHome(this: CameraController, body: string, P: SkimPose, t: number) {
  const b = solarBody(body)!;
  const A = bodyAxes(b, t);
  const C = this.rigBody(body as never, true, t)!;
  const home = (q: Vec3): Vec3 => [0, 1, 2].map((k) => q[0] * A[0]![k]! + q[1] * A[1]![k]! + q[2] * A[2]![k]!) as Vec3;
  const r = home(P.P);
  return { X: [C.C[0] + r[0], C.C[1] + r[1], C.C[2] + r[2]] as Vec3, fwd: home(P.fwd), up: home(P.up), V: C.V };
}

/** A frame of the cinematic voyage; false: none. */
function cineVoyageStep(this: CameraController, dt: number): boolean {
  const c = this.cineVoyage;
  if (!c) return false;
  const leg = c.legs[c.i];
  if (!leg) {
    this.cineVoyage = null;
    c.done();
    return false;
  }
  if (leg.kind === "voyage") {
    if (!this.voyage) {
      // (the voyage leg begun from where the pass left the view: to the goal's framing; done, the next leg)
      const ok = this.startVoyage(
        c.goal,
        () => {
          c.i++;
          c.t = 0;
          // (the next pass turns from the look the voyage left)
          const w = this.rigWorld();
          if (w) c.q = lookQ(w.fwd as V3, w.up as V3);
        },
        c.name,
      );
      if (!ok) {
        c.i++;
        return false;
      }
      const v = this.voyage as Voyage | null;
      if (v) {
        v.look = c.mode === "montage" ? "montage" : "goal";
        v.originBody = c.origin;
        v.onCut = () => this.onCut?.();
      }
    }
    return this.voyageStep(dt);
  }
  // a low pass: planned when it begins (from where the view is then), played on the wall clock, eased in and out
  if (!leg.plan) {
    const toward = leg.way === "out" ? sub(c.goal(this.nowTime()).C, this.rigWorld()!.X) : null;
    leg.plan = skimFrom.call(this, leg.body, toward, leg.way === "in");
    if (!leg.plan) {
      c.i++;
      return false;
    }
    if (c.mode === "montage") this.onCut?.();
  }
  c.t += dt;
  const k = blendCurve("easeInOut", Math.min(1, c.t / leg.dur));
  const t = Number.isFinite(this.frameEnd) ? this.frameEnd : this.nowTime();
  const P = leg.plan.at(k);
  const H = skimHome.call(this, leg.body, P, t);
  // (the look: turned from the last leg's over its first two seconds — a sequence's; a montage's cut at once)
  let fwd = H.fwd,
    up = H.up;
  const q1 = lookQ(H.fwd as V3, H.up as V3);
  if (c.q && c.mode === "sequence" && c.t < 2) {
    const [, y, z] = qAxes(qSlerp(c.q, q1, blendCurve("easeInOut", c.t / 2)));
    fwd = z as Vec3;
    up = y as Vec3;
  } else if (c.t >= 2 || c.mode === "montage") c.q = null;
  setHomePose(this.s, H.X, fwd, up, H.V);
  this.s.motion = "geodesic";
  this.sync();
  if (c.t >= leg.dur) {
    c.q = q1;
    c.i++;
    c.t = 0;
    if (!c.legs[c.i]) {
      this.cineVoyage = null;
      this.rig.placed = "voyage";
      this.rig.cut = false;
      this.rig.key = "";
      c.done();
    }
  }
  return true;
}

/** The cinematic voyage stopped where it is. */
function stopCineVoyage(this: CameraController) {
  if (!this.cineVoyage) return;
  this.cineVoyage = null;
  this.endVoyage(false);
}

export function installCineVoyage(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { startCineVoyage, cineVoyageStep, stopCineVoyage });
}
