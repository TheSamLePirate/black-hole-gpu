// The CameraController — the camera on any craft (docs/PLAN-CAMERA-AAA.md CAM8): the target a craft — the fleet's,
// the station, another player's, an airliner of the traffic, a ship at sea, a wingman —, the view about it as the
// panel's tiles choose (settings.subjectView):
// - "around": the rig's orbit about it (controller/rig.ts — nothing here);
// - "chase":  behind it and a little above, on its own axes, lagging its turns as a chase car's camera does;
// - "aboard": at its eye — the cockpit, the bridge —, looking along its nose (the drag turns the head);
// - "tower":  set down ahead of it — on the ground under its way, or fixed in the space it flies through —, turning to
//             follow it, set down again ahead once it is far.
// The craft's place, velocity and axes asked of the targeting (craftSubjects, the fleet, the station's tracker).
// (Its methods: installed on the controller's prototype — `this` the controller.)
import { setHomePose } from "../camera";
import { lookQ, qAxes, qSlerp } from "../cine/follow";
import type { V3 } from "../cine/rig";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import type { Vec3 } from "../physics";
import type { Settings } from "../settings";
import { issAxes } from "../system/iss";
import { solarBody } from "../system/solar";
import { fromBodyFixed, groundAboveSphere, toBodyFixed } from "../system/our-surface";
import { craftRadius, craftSubjects, isCraft, isCraftLike, isSubject, ourTarget, type Body } from "../targeting";
import { M_METRES } from "../units";

declare module "../controls" {
  interface CameraController {
    subjectStep: typeof subjectStep;
    subjectLook: typeof subjectLook;
    subjectActive: typeof subjectActive;
  }
}

/** A craft as the camera follows it: place [M], velocity [c], axes (left, up, nose — home), its length [m]. */
export interface SubjectPose {
  X: Vec3;
  V: Vec3;
  ax: [Vec3, Vec3, Vec3];
  length: number;
  kind: "air" | "sea" | "space";
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const comb = (X: Vec3, ax: [Vec3, Vec3, Vec3], o: [number, number, number]): Vec3 =>
  [0, 1, 2].map((k) => X[k]! + (ax[0][k]! * o[0] + ax[1][k]! * o[1] + ax[2][k]! * o[2]) / M_METRES) as Vec3;

/** The craft's pose at t, whatever kind it is; null: none known (or not a craft). */
export function subjectPose(s: Settings, b: Body, t: number): SubjectPose | null {
  if (isSubject(b)) {
    const st = craftSubjects.state(b, t);
    if (!st) return null;
    return { X: st.pos, V: st.vel, ax: st.ax, length: st.length, kind: String(b).startsWith("ais:") ? "sea" : "air" };
  }
  if (isCraft(b)) {
    const p = fleet.pose(b, t);
    if (!p) return null;
    return { X: p.X, V: p.V, ax: p.ax, length: 2 * craftRadius(b), kind: b === "f35" || b === "a320" ? "air" : "space" };
  }
  if (!isCraftLike(b)) return null;
  // (the station, another player's craft: its place and velocity; its axes along its motion about the Earth)
  const T = ourTarget(s, b, t);
  if (b === "iss") {
    const [x, y, z] = issAxes(T.pos, T.vel, t);
    // (the station's x ahead, z to the nadir: as a craft's left, up, nose)
    return { X: T.pos, V: T.vel, ax: [[-y[0], -y[1], -y[2]], [-z[0], -z[1], -z[2]], x], length: 109, kind: "space" };
  }
  const E = ourTarget(s, "earth" as Body, t);
  const up = unit(sub(T.pos, E.pos));
  let nose = sub(T.vel, E.vel);
  nose = unit(sub(nose, up.map((x) => x * (nose[0] * up[0] + nose[1] * up[1] + nose[2] * up[2])) as Vec3));
  return { X: T.pos, V: T.vel, ax: [cross(up, nose), up, nose], length: 2 * T.radius * M_METRES, kind: "space" };
}

/** A view about a craft is under way (chase, aboard, tower: this module's; around: the rig's). */
function subjectActive(this: CameraController): boolean {
  const s = this.s;
  return (s.subjectView === "chase" || s.subjectView === "aboard" || s.subjectView === "tower") && isCraftLike(s.target);
}

/** The drag's turn of the head (aboard) or of the chase about the craft [deg]. */
function subjectLook(this: CameraController, dyaw: number, dpitch: number) {
  const L = this.subject;
  L.yaw = ((((L.yaw + dyaw + 180) % 360) + 360) % 360) - 180;
  L.pitch = Math.min(80, Math.max(-80, L.pitch + dpitch));
}

/** A frame of the view about a craft; false: none (the rig, the flight… place the view). */
function subjectStep(this: CameraController, dt: number): boolean {
  if (!this.subjectActive()) {
    this.subject.q = null;
    this.subject.tower = null;
    return false;
  }
  const s = this.s;
  const t = Number.isFinite(this.frameEnd) ? this.frameEnd : this.nowTime();
  const P = subjectPose(s, s.target, t);
  if (!P) return false;
  const L = this.subject;
  const [left, up, nose] = P.ax;
  const lenM = Math.max(P.length, 5);
  const turn = (f: Vec3, u: Vec3, yaw: number, pitch: number): { f: Vec3; u: Vec3 } => {
    // (the head turned: about the craft's up by the yaw, then about its right by the pitch)
    const a = (yaw * Math.PI) / 180,
      b = (pitch * Math.PI) / 180;
    const r = cross(f, u);
    const f1 = [0, 1, 2].map((k) => f[k]! * Math.cos(a) - r[k]! * Math.sin(a)) as Vec3;
    const f2 = [0, 1, 2].map((k) => f1[k]! * Math.cos(b) + u[k]! * Math.sin(b)) as Vec3;
    const u2 = unit(cross(cross(f2, u), f2));
    return { f: unit(f2), u: u2 };
  };
  let X: Vec3, fwd: Vec3, upV: Vec3;
  if (s.subjectView === "aboard") {
    // the eye: an aircraft's cockpit (ahead, a little up), a ship's bridge (aft of the middle, high), a spacecraft's nose
    const eye: [number, number, number] =
      P.kind === "sea"
        ? [0, 0.09 * lenM + 6, -0.18 * lenM]
        : P.kind === "air"
          ? [0, 0.04 * lenM + 0.6, 0.42 * lenM]
          : [0, 0.12 * lenM, 0.55 * lenM];
    X = comb(P.X, P.ax, eye);
    const h = turn(nose, up, L.yaw, L.pitch);
    fwd = h.f;
    upV = h.u;
    L.q = null;
  } else if (s.subjectView === "chase") {
    // behind and above on the craft's axes — its turns followed with a lag (a quarter second), the drag swinging round
    const k = 1 - Math.exp(-dt / 0.28);
    const qc = lookQ(nose as V3, up as V3);
    L.q = L.q ? qSlerp(L.q, qc, k) : qc;
    const [lx, ly, lz] = qAxes(L.q) as [Vec3, Vec3, Vec3];
    const back = 2.4 * lenM * L.zoom,
      high = 0.5 * lenM * L.zoom;
    const h = turn(lz, ly, L.yaw, L.pitch);
    X = [0, 1, 2].map((i) => P.X[i]! + (-h.f[i]! * back + ly[i]! * high) / M_METRES) as Vec3;
    // (looking a little ahead of it: its way, not its tail)
    const aim = comb(P.X, P.ax, [0, 0, 0.6 * lenM]);
    fwd = unit(sub(aim, X));
    upV = unit(cross(cross(fwd, ly), fwd));
    void lx;
    void left;
  } else {
    // the tower: set down ahead of its way — on the ground under it (air, sea), fixed beside its way in space —, again
    // when it is past and far
    const T0 = L.tower;
    const far = T0 ? len(sub(this.towerPlace(T0, t), P.X)) * M_METRES : Infinity;
    if (!T0 || (far > Math.max(40 * lenM, 2500) && dotV(sub(P.X, this.towerPlace(T0, t)), nose) > 0)) L.tower = this.towerSet(P, t);
    X = this.towerPlace(L.tower!, t);
    fwd = unit(sub(P.X, X));
    const zen = L.tower!.body ? unit(sub(X, ourTarget(s, L.tower!.body as Body, t).pos)) : up;
    upV = unit(cross(cross(fwd, zen), fwd));
    L.q = null;
  }
  setHomePose(s, X, fwd, upV, P.V);
  s.motion = "geodesic";
  this.sync();
  return true;
}

const dotV = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function installSubjectCam(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { subjectStep, subjectLook, subjectActive, towerSet, towerPlace });
}

/** A tower: a point on a body's ground (body-fixed [M]) or in space (relative to the craft's world centre then). */
export interface Tower {
  body: string | null;
  q: Vec3;
}

declare module "../controls" {
  interface CameraController {
    towerSet: typeof towerSet;
    towerPlace: typeof towerPlace;
  }
}

/** Where the tower goes: ahead of the craft's way and to its side — on the Earth's ground under it (2 m up) for one
 *  flying or sailing low, else a fixed point in the space it crosses (carried with its world's centre). */
function towerSet(this: CameraController, P: SubjectPose, t: number): Tower {
  const lenM = Math.max(P.length, 5);
  const ahead = Math.min(4000, Math.max(250, 30 * lenM)),
    side = 0.25 * ahead;
  const at = comb(P.X, P.ax, [side, 0, ahead]);
  if (P.kind !== "space") {
    const q = toBodyFixed("earth", at, t);
    const u = unit(q);
    const R = len(q);
    // (on the ground there — its figure and relief, the WGS84 ellipsoid's, over the body's sphere — and a man's height up)
    const R0 = solarBody("earth")!.radius;
    const g = groundAboveSphere("earth", [u[0] * R0, u[1] * R0, u[2] * R0]);
    const r = Math.min(R, R0 + (g + 2) / M_METRES);
    return { body: "earth", q: [u[0] * r, u[1] * r, u[2] * r] };
  }
  const E = ourTarget(this.s, "earth" as Body, t).pos;
  return { body: null, q: sub(at, E) };
}

/** The tower's place at t (home frame). */
function towerPlace(this: CameraController, T: Tower, t: number): Vec3 {
  if (T.body) return fromBodyFixed(T.body, T.q, t);
  const E = ourTarget(this.s, "earth" as Body, t).pos;
  return [E[0] + T.q[0], E[1] + T.q[1], E[2] + T.q[2]];
}
