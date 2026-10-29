// The CameraController — the relativistic voyage played (docs/PLAN-CAMERA-AAA.md CAM4): the plan (camera/voyage.ts)
// from where the view is to a goal (a body's framing, a craft's), the world's time running it — so a pause holds it, a
// warp hastens it, and the world has moved on by the voyage's t when one arrives —, played back in the voyage's
// seconds (settings.voyageWall: the time warp set for it, given back at the end), the view's speed handed to the
// tracer (the aberration, the Doppler, the searchlight), the traveller's own clock τ kept apart. The look: from where
// it was onto the goal, free to turn on the way (the drag), onto the goal's framing at the end.
// (Its methods: installed on the controller's prototype — `this` the controller.)
import { roomPace, realTimeSpeed, timeRate } from "../clock";
import { setHolePose, setHomePose } from "../camera";
import { horizon } from "../physics";
import { blendCurve, lookQ, qAxes, qSlerp } from "../cine/follow";
import type { V3 } from "../cine/rig";
import type { Vec3 } from "../physics";
import type { CameraController } from "../controls";
import { OUR_TARGETS, SYSTEM_BODIES, type Settings } from "../settings";

import type { TravelGoal } from "../controller/travel";
import { M_METRES, M_SECONDS } from "../units";
import { planVoyage, playbackRate, warpAt, type VoyageBody, type VoyageChoice, type VoyagePlan, type VoyageState } from "./voyage";

declare module "../controls" {
  interface CameraController {
    startVoyage: typeof startVoyage;
    voyageStep: typeof voyageStep;
    voyageLook: typeof voyageLook;
    endVoyage: typeof endVoyage;
  }
}

/** A voyage under way: its plan, goal, the look's start and its free turn, the time warp it replaced. */
export interface Voyage {
  plan: VoyagePlan;
  goal: (t: number) => TravelGoal;
  done: () => void;
  q0: [number, number, number, number];
  u0: V3;
  /** the drag's turn off the voyage's look [deg] */
  yaw: number;
  pitch: number;
  /** the wall time since it began [s], the look's turn onto the course's [s] (≤ 45°/s) */
  wall: number;
  inT: number;
  /** the time warp and the clock's running before it */
  restore: { timeSpeed: number; animate: boolean } | null;
  /** the state last played (the HUD's) */
  state: VoyageState | null;
  /** the target's name (the HUD's) */
  name: string;
  /** on our side (the home frame) or Gargantua's (the hole's) */
  ours: boolean;
  /** the playback's rate (heights a wall second; ∞: real time) and the warp it set last */
  kPlay: number;
  warp: number;
  /** the look: on the goal (a voyage's), or a montage's — back at the world left, ahead, on the goal (cut between) */
  look?: "goal" | "montage";
  originBody?: string | null;
  onCut?: () => void;
  /** the montage's shot now (0 back, 1 ahead, 2 on the goal) */
  shot?: number;
}

/** The view placed (our side: the home frame; Gargantua's: the hole's). */
function place(s: Settings, ours: boolean, X: Vec3, fwd: Vec3, up: Vec3, V: Vec3) {
  if (ours) setHomePose(s, X, fwd, up, V);
  else setHolePose(s, X, fwd, up, V);
}

/** What the player chose, as the plan wants it. */
export function voyageChoice(s: Settings): VoyageChoice {
  switch (s.voyageBy) {
    case "beta":
      return { kind: "beta", beta: s.voyageBeta };
    case "tau":
      return { kind: "tau", seconds: s.voyageSeconds };
    case "t":
      return { kind: "t", seconds: s.voyageSeconds };
    case "accel":
      return { kind: "accel", g: s.voyageG };
    default:
      return { kind: "auto" };
  }
}

/** the ground's bound as the screen shows it: a speed of k × the height a wall second */
const K_WALL = 1.5;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** A voyage begun from where the view is to a goal, on either side of the wormhole (the goal on the same side);
 *  false: none (in the throat). */
function startVoyage(this: CameraController, goalNow: (t: number) => TravelGoal, done: () => void, name = ""): boolean {
  const w = this.rigWorld();
  if (!w) return false;
  const ours = w.ours;
  const s = this.s;
  const t0 = Number.isFinite(this.time) ? this.time : 0;
  // (the framing held where it is from the goal's centre — not running round an orbit of its own —, the look on that
  // centre: what the orbit about it then keeps, so the arrival hands it a view at rest with the goal, no turn)
  const g0 = goalNow(t0);
  // (on the side one comes from, at the framing's distance: not round the far side of it at the end)
  const d0 = len(sub(g0.X, g0.C));
  const from = sub(w.X as Vec3, g0.C);
  const lf = len(from);
  const off = (lf > 0 && lf > d0 ? from.map((x) => (x / lf) * d0) : sub(g0.X, g0.C)) as Vec3;
  const lookIn = (len(off) > 0 ? [-off[0], -off[1], -off[2]] : g0.fwd) as Vec3;
  // (its centre where it is known — a station's track ends somewhere: past it, carried on at its velocity of now)
  const Vg0 = g0.V.every(Number.isFinite) ? g0.V : ([0, 0, 0] as Vec3);
  const centre = (t: number): Vec3 => {
    const c = goalNow(t).C;
    return c.every(Number.isFinite) ? c : ([0, 1, 2].map((k) => g0.C[k]! + Vg0[k]! * (t - t0)) as Vec3);
  };
  const goal = (t: number): TravelGoal => {
    const C = centre(t);
    const h = 1e-6;
    const Ca = centre(t - h),
      Cb = centre(t + h);
    const V = [0, 1, 2].map((k) => (Cb[k]! - Ca[k]!) / (2 * h)) as Vec3;
    return { X: [C[0] + off[0], C[1] + off[1], C[2] + off[2]], fwd: lookIn, up: g0.up, V, C };
  };
  // (the start carried by what it is near — a planet's orbit, a craft's —; in the void, where it is)
  // (a body's centre at a time — where it is not known, a station's track beyond its window, a moon's ephemeris out of
  // its span: carried on from now at its velocity)
  const track = (id: string): ((t: number) => Vec3) | null => {
    const r = this.rigBody(id as never, ours, t0);
    if (!r || !r.C.every(Number.isFinite)) return null;
    // (its velocity by its own places a moment apart — never above light's —, a craft's frozen pose else at rest)
    const h = 1e-4;
    const c1 = this.rigBody(id as never, ours, t0 + h)?.C;
    // (its own velocity when it has one — a craft flown: its pose the same at any time asked, its velocity the truth —,
    // else by its places a moment apart; never above light's)
    let V: Vec3 = r.V.every(Number.isFinite) && len(r.V) < 0.5 ? r.V : [0, 0, 0];
    if (!len(V) && c1 && c1.every(Number.isFinite)) V = [0, 1, 2].map((k) => (c1[k]! - r.C[k]!) / h) as Vec3;
    if (!(len(V) < 0.5)) V = [0, 0, 0];
    // (a craft whose place does not move with the time asked: carried at its velocity)
    const frozen = !!c1 && len(sub(c1, r.C)) < 1e-3 * len(V) * h;
    const C0 = r.C;
    // (a place asked of it more than light's way from where it was is no place: carried on instead)
    return (t) => {
      const c = this.rigBody(id as never, ours, t)?.C;
      const lin = [0, 1, 2].map((k) => C0[k]! + V[k]! * (t - t0)) as Vec3;
      return !frozen && c && c.every(Number.isFinite) && len(sub(c, C0)) <= Math.abs(t - t0) + 1e-9 ? c : lin;
    };
  };
  const near = this.rigNearest(ours, w.X, t0);
  const X0 = [...w.X] as Vec3;
  const carry = near ? track(near.id) : null;
  const C0 = carry ? carry(t0) : null;
  const A =
    carry && C0
      ? (t: number) => {
          const C = carry(t);
          return [X0[0] - C0[0] + C[0], X0[1] - C0[1] + C[1], X0[2] - C0[2] + C[2]] as Vec3;
        }
      : () => X0;
  const B = (t: number) => goal(t).X;
  // (the bodies it slows by and keeps clear of: our worlds near the way — within 30 of their radii of it)
  const P0 = A(t0),
    P1 = B(t0);
  const d = sub(P1, P0);
  const D = Math.max(len(d), 1e-15);
  const bodies: VoyageBody[] = [];
  // (Gargantua's side: its worlds, the star, and the hole itself — its horizon the ground one slows by)
  if (!ours) bodies.push({ id: "hole", R: horizon(s.spin), C: () => [0, 0, 0] });
  for (const id of (ours ? [...OUR_TARGETS, "iss"] : [...SYSTEM_BODIES, "star"]) as string[]) {
    const r = this.rigBody(id as never, ours, t0);
    if (!r || !(r.R > 0)) continue;
    const u = Math.min(1, Math.max(0, ((r.C[0] - P0[0]) * d[0] + (r.C[1] - P0[1]) * d[1] + (r.C[2] - P0[2]) * d[2]) / (D * D)));
    const miss = len(sub(r.C, [P0[0] + d[0] * u, P0[1] + d[1] * u, P0[2] + d[2] * u]));
    if (miss > 30 * r.R + 0.05 * D) continue;
    const C = track(r.id);
    if (C) bodies.push({ id: r.id, R: r.R, C });
  }
  // (the departure and the arrival points themselves: eased out of and into — the speed under k × the distance to
  // them, a constant deceleration within a fiftieth of the framing's —, not a rocket's full stop in a frame at the warp)
  // (the worlds the way spirals out of and into — camera/voyage.ts —: each end's nearest in its radii, within 40)
  const nearestTo = (P: Vec3) => {
    let best: string | undefined,
      bd = 40;
    for (const b of bodies) {
      const d = (len(sub(P, b.C(t0))) - b.R) / b.R;
      if (d < bd) (bd = d), (best = b.id);
    }
    return best;
  };
  const outOf = nearestTo(X0),
    into = nearestTo(goal(t0).X);
  const eps = Math.max(0.02 * len(off), 1 / M_METRES);
  const eps0 = Math.max(0.02 * len(sub(X0, C0 ?? X0)), eps);
  bodies.push({ id: "arrival", R: 0, soft: eps, C: B }, { id: "departure", R: 0, soft: eps0, C: A });
  // (played back in the voyage's seconds — settings.voyageWall —: real time by a world, the warp rising in the void so
  // the view crosses its height at the same rate a wall second all the way; the ground's bound k a world second is that
  // rate: the plan and its playback found together. In a room: the room's pace, the bound at its warp)
  const ts = this.timeHost ?? s;
  const rt = realTimeSpeed(ts);
  const room = Number.isFinite(roomPace.cap);
  let k = room ? K_WALL / (roomPace.cap / rt) : K_WALL;
  let plan = planVoyage({ A, B, bodies, from: outOf, to: into }, voyageChoice(s), t0, { n: 1200, k });
  let kPlay = Number.POSITIVE_INFINITY;
  if (!room && s.voyageWall > 0)
    for (let i = 0; i < 3; i++) {
      kPlay = playbackRate(plan, s.voyageWall, rt);
      const want = Math.min(6, Math.max(0.4, kPlay));
      if (Math.abs(want / k - 1) < 0.1) break;
      k = want;
      plan = planVoyage({ A, B, bodies, from: outOf, to: into }, voyageChoice(s), t0, { n: 1200, k });
    }
  // (a plan that came out unknown — an ephemeris missing —: none, the kinematic travel takes over, never a voyage stuck)
  if (!Number.isFinite(plan.T) || !Number.isFinite(plan.Tau) || !Number.isFinite(kPlay === Number.POSITIVE_INFINITY ? 0 : kPlay)) {
    console.warn("voyage: plan unknown", { T: plan.T, D: plan.D, outOf, into });
    return false;
  }
  let restore: Voyage["restore"] = null;
  if (!room) {
    restore = { timeSpeed: ts.timeSpeed, animate: ts.animate };
    ts.timeSpeed = s.timeSpeed = rt;
    ts.animate = s.animate = true;
  }
  this.travel = null;
  this.setCinematic(null);
  this.voyage = {
    plan,
    goal,
    done,
    q0: lookQ(w.fwd as V3, w.up as V3),
    u0: [...w.up] as V3,
    yaw: 0,
    pitch: 0,
    wall: 0,
    inT: Math.min(
      4,
      Math.max(
        1.5,
        (Math.acos(
          Math.min(
            1,
            Math.max(
              -1,
              (w.fwd[0] * (g0.C[0] - w.X[0]) + w.fwd[1] * (g0.C[1] - w.X[1]) + w.fwd[2] * (g0.C[2] - w.X[2])) /
                Math.max(len(sub(g0.C, w.X as Vec3)), 1e-300),
            ),
          ),
        ) *
          180) /
          Math.PI /
          45,
      ),
    ),
    restore,
    state: null,
    name,
    ours,
    kPlay,
    warp: 1,
  };
  return true;
}

/** The voyage's frame (after the rest of the camera's motion: it sets the pose); false: none. */
function voyageStep(this: CameraController, dt: number): boolean {
  const v = this.voyage;
  if (!v) return false;
  const s = this.s;
  v.wall += dt;
  // (the time the frame is drawn at: another clock's when one sets it — a spectator's, the flown craft's —, else ours)
  const tEnd = Number.isFinite(this.frameEnd)
    ? this.frameEnd
    : (Number.isFinite(this.time) ? this.time : 0) + (s.animate ? timeRate(s) * dt : 0);
  const st = v.plan.at(tEnd);
  const g = v.goal(tEnd);
  // (a craft flown makes the voyage: its crew's clock runs the traveller's τ)
  if (this.piloting && !this.headless) this.properTime += st.tau - (v.state?.tau ?? 0);
  v.state = st;
  // (the next frame's warp: the playback's at this state, eased — a quarter at most a frame —, never under real time)
  if (v.restore && s.animate && Number.isFinite(v.kPlay)) {
    const ts = this.timeHost ?? s;
    const rt = realTimeSpeed(ts);
    // (the player set a warp of his own on the way: his from now on)
    if (Math.abs(ts.timeSpeed / (rt * v.warp) - 1) > 1e-6) {
      v.kPlay = Number.POSITIVE_INFINITY;
      return voyagePlace.call(this, v, st, g, dt);
    }
    // (never more than a fiftieth of the voyage's world time a frame — in the void far from anything the playback's
    // height is boundless —, never unknown)
    const cap = Math.max(1, (0.02 * v.plan.T) / (rt * Math.max(dt, 1 / 240)));
    const w0 = warpAt(st, v.kPlay, rt);
    const want = Number.isFinite(w0) ? Math.min(w0, cap) : cap;
    v.warp = Math.min(v.warp * 1.25, Math.max(v.warp / 1.25, want, 1), cap);
    ts.timeSpeed = s.timeSpeed = rt * v.warp;
  }
  return voyagePlace.call(this, v, st, g, dt);
}

/** The view placed on the voyage's state: its look, its free turn, the framing at the end; the arrival. */
function voyagePlace(this: CameraController, v: Voyage, st: VoyageState, g: TravelGoal, dt: number): boolean {
  const s = this.s;
  const tEnd = v.plan.t0 + st.t;
  // the look: from where it was onto the goal's centre (1.5–4 s, by the angle), the drag's turn off it, onto the goal's framing in
  // the voyage's last two seconds (wall: the world's time left at the warp played)
  const toC = sub(g.C, st.X);
  const upMid = [0, 1, 2].map((k) => v.u0[k]! * (1 - st.u) + g.up[k]! * st.u) as V3;
  const qGoal = lookQ((len(toC) > 0 ? toC : g.fwd) as V3, upMid);
  const kIn = blendCurve("easeInOut", Math.min(1, v.wall / v.inT));
  const rate = s.animate ? Math.max(timeRate(s), 1e-30) : Number.POSITIVE_INFINITY;
  const leftWall = (v.plan.T - (tEnd - v.plan.t0)) / rate;
  const kOut = st.phase === "done" ? 1 : blendCurve("easeInOut", 1 - Math.min(1, leftWall / 2));
  let q = qSlerp(v.q0, qGoal, kIn);
  // (a montage: its shots by the share of the way — back at the world left, ahead along the speed, on the goal —, cut)
  if (v.look === "montage") {
    const shot = st.u < 0.3 ? 0 : st.u < 0.72 ? 1 : 2;
    if (shot !== v.shot) {
      if (v.shot !== undefined) v.onCut?.();
      v.shot = shot;
    }
    const O = shot === 0 && v.originBody ? this.rigBody(v.originBody as never, v.ours, tEnd)?.C : null;
    const dir = shot === 0 && O ? sub(O, st.X) : shot === 1 && len(st.V) > 0 ? st.V : toC;
    q = lookQ(dir as V3, upMid);
  }
  // (the free turn, fading as the framing takes over)
  const free = 1 - kOut;
  if (free > 0 && (v.yaw || v.pitch)) {
    const [x, y, z] = qAxes(q);
    const a = (v.yaw * free * Math.PI) / 180,
      b = (v.pitch * free * Math.PI) / 180;
    // (turned about the up by the yaw, then about the right by the pitch)
    const f1 = [0, 1, 2].map((k) => z[k]! * Math.cos(a) + x[k]! * Math.sin(a)) as V3;
    const x1 = [0, 1, 2].map((k) => x[k]! * Math.cos(a) - z[k]! * Math.sin(a)) as V3;
    const f2 = [0, 1, 2].map((k) => f1[k]! * Math.cos(b) + y[k]! * Math.sin(b)) as V3;
    const y2 = [0, 1, 2].map((k) => y[k]! * Math.cos(b) - f1[k]! * Math.sin(b)) as V3;
    void x1;
    q = lookQ(f2, y2);
  }
  q = qSlerp(q, lookQ(g.fwd as V3, g.up as V3), kOut);
  const [, y, z] = qAxes(q);
  place(s, v.ours, st.X, z as Vec3, y as Vec3, st.V);
  s.motion = "geodesic";
  this.sync();
  if (st.phase === "done") {
    // (placed for the time the world will reach this frame — the warp given back now: the frame's end at the old pace
    // was a second ahead of the world, the goal 30 km off where the rig then found it)
    // (a craft's clock sets the frame: it stepped at the voyage's pace already — that time)
    const rate = v.restore ? (v.restore.animate ? timeRate({ timeSpeed: v.restore.timeSpeed }) : 0) : s.animate ? timeRate(s) : 0;
    this.endVoyage(true, Number.isFinite(this.frameEnd) ? this.frameEnd : (Number.isFinite(this.time) ? this.time : 0) + rate * dt);
  }
  return true;
}

/** The drag's turn during a voyage [deg]: the look off the voyage's. */
function voyageLook(this: CameraController, dyaw: number, dpitch: number) {
  const v = this.voyage;
  if (!v) return;
  v.yaw = ((((v.yaw + dyaw + 180) % 360) + 360) % 360) - 180;
  v.pitch = Math.min(85, Math.max(-85, v.pitch + dpitch));
}

/** The voyage ended (arrived: at the goal's framing at the frame's time `at`; else where it is, at rest with what it
 *  was near) — the rig taking over turning from the look the voyage left (never a snap onto its own aim). */
function endVoyage(this: CameraController, arrived: boolean, at?: number) {
  const v = this.voyage;
  if (!v) return;
  this.voyage = null;
  const s = this.s;
  if (v.restore) {
    const ts = this.timeHost ?? s;
    ts.timeSpeed = s.timeSpeed = v.restore.timeSpeed;
    ts.animate = s.animate = v.restore.animate;
  }
  // (the rig's next behaviour turns from this view: "placed" — controller/rig.ts —, not a cut)
  this.rig.placed = "voyage";
  this.rig.cut = false;
  this.rig.key = "";
  if (arrived) {
    const t = at ?? (Number.isFinite(this.time) ? this.time : 0);
    const g = v.goal(t);
    place(s, v.ours, g.X, g.fwd, g.up, g.V);
    this.sync();
    v.done();
  } else {
    // (stopped on the way: at rest with the body it is near)
    const w = this.rigWorld();
    if (w) {
      const n = this.rigNearest(w.ours, w.X, this.time);
      place(s, w.ours, w.X, w.fwd, w.up, n?.V ?? [0, 0, 0]);
      this.sync();
    }
  }
}

/** The traveller's figures (the HUD's, TARS's): the plan's and the state's, in seconds and SI. */
export function voyageFigures(v: Voyage) {
  const p = v.plan,
    st = v.state;
  return {
    name: v.name,
    T: p.T * M_SECONDS,
    Tau: p.Tau * M_SECONDS,
    betaPeak: p.betaPeak,
    a: p.a,
    t: (st?.t ?? 0) * M_SECONDS,
    tau: (st?.tau ?? 0) * M_SECONDS,
    beta: st?.beta ?? 0,
    gamma: st?.gamma ?? 1,
    u: st?.u ?? 0,
    left: st?.left ?? p.D,
    phase: st?.phase ?? "accel",
    limited: p.limited,
  };
}

export function installVoyager(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { startVoyage, voyageStep, voyageLook, endVoyage });
}
