// The CameraController — the camera rig: the mounts, the views of the ship.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { blToCartesian, cameraFrame, homePosition, setHolePose, setHomePose } from "../camera";
import type { Vec3 } from "../physics";
import {
  availableBodies,
  bodyCentre,
  bodyDistance,
  type Body,
  bodyVelocity,
  bodyMass,
  bodyRadius,
  isCraft,
  isOurBody,
  isOurs,
  onOurSide,
  ourTarget,
} from "../targeting";
import { planetFrame, toGlobal, toLocal, zamoBeta } from "../landing";
import { toU } from "../pilot";
import { mouth, sphericalFrame } from "../wormhole";
import { ourState, repToHomeVec } from "../system/our-side";
import { altitudeOver, figureUp, fromBodyFixed, groundAboveSphere, groundVelocity, solidBody, toBodyFixed } from "../system/our-surface";
import { M_METRES, solarBody } from "../system/solar";
import { cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";

import type { CameraController } from "../controls";
import { add3, clamp, unitV } from "./util";

declare module "../controls" {
  interface CameraController {
    rigOrbits: typeof rigOrbits;
    rigWorld: typeof rigWorld;
    rigBody: typeof rigBody;
    rigNearest: typeof rigNearest;
    rigPlace: typeof rigPlace;
    rigStep: typeof rigStep;
    reliefUnder: typeof reliefUnder;
    rigFix: typeof rigFix;
    rigUnfix: typeof rigUnfix;
    rigStatus: typeof rigStatus;
    surfaceDistance: typeof surfaceDistance;
    nearestBody: typeof nearestBody;
    followFF: typeof followFF;
  }
}

/** Around a planet, a moon (the rig), not the classic orbit's hole, star, mouth. */
function rigOrbits(this: CameraController) {
  const s = this.s;
  return s.rotation === "orbit" && !this.piloting && !s.ship && !["hole", "wormhole", "star", "barycentre"].includes(s.target);
}

/** The camera's place and axes as world vectors (our side: the home frame; else the hole's map). */
function rigWorld(this: CameraController): { ours: boolean; X: Vec3; fwd: Vec3; up: Vec3; right: Vec3 } | null {
  const s = this.s;
  const cam = cameraFrame(s);
  if (onOurSide(s, cam)) {
    const X = homePosition(s);
    if (!X) return null;
    const w = mouth(s).w;
    const v = (c: Vec3) => repToHomeVec(w, cam.ell, cam.n, c);
    return { ours: true, X, fwd: unitV(v(cam.fwd)), up: unitV(v(cam.up)), right: unitV(v(cam.right)) };
  }
  if (cam.region !== "hole") return null;
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const f = sphericalFrame(X);
  const v = (c: Vec3) => add3(f.er, f.et, f.ep, c);
  return { ours: false, X, fwd: v(cam.fwd), up: v(cam.up), right: v(cam.right) };
}

/** A body the camera can move with: its centre, velocity, radius [M] (none: the hole, the mouth…). */
function rigBody(this: CameraController, b: Body | null, ours: boolean, t: number): { id: Body; C: Vec3; V: Vec3; R: number } | null {
  const s = this.s;
  if (!b || b === "hole" || b === "barycentre" || b === "wormhole") return null;
  if (ours) {
    if (b === "iss" || isCraft(b)) {
      // (the space station, a craft: around it, moving with it)
      const T = ourTarget(s, b, t);
      return { id: b, C: T.pos, V: T.vel, R: T.radius };
    }
    if (!isOurBody(b)) return null;
    const st = ourState(b, t);
    return { id: b, C: st.pos, V: st.vel, R: solarBody(b)!.radius };
  }
  if (isOurs(b) || (b === "star" && !s.sun)) return null;
  return { id: b, C: bodyCentre(s, b, t), V: bodyVelocity(s, b, t), R: bodyRadius(s, b) };
}

/** The body nearest the camera (in its radii from its surface), within 40 of them. */
function rigNearest(this: CameraController, ours: boolean, X: Vec3, t: number) {
  let best: ReturnType<CameraController["rigBody"]> = null;
  let bd = 40;
  for (const b of availableBodies(this.s, cameraFrame(this.s))) {
    const r = this.rigBody(b, ours, t);
    if (!r) continue;
    const d = (Math.hypot(...sub3(X, r.C)) - r.R) / r.R;
    if (d < bd) (bd = d), (best = r);
  }
  return best;
}

/** Places the camera (world vectors) moving at V (coordinate velocity: the body's). */
function rigPlace(this: CameraController, ours: boolean, X: Vec3, fwd: Vec3, up: Vec3, V: Vec3) {
  const s = this.s;
  if (ours) setHomePose(s, X, fwd, up, V);
  else {
    const f = sphericalFrame(X);
    const b = zamoBeta(X, V, s.spin);
    const bl = Math.hypot(...b);
    setHolePose(s, X, fwd, up, add3(f.er, f.et, f.ep, bl > 0.99 ? lin(b, 0.99 / bl, b, 0) : b));
  }
  s.motion = "geodesic";
  this.targetDistance = s.distance;
  this.targetL = s.whL;
  this.written = "";
  this.rig.placed = [s.anchor, s.whL, s.distance, s.inclination, s.azimuth].join();
}

/** One frame of the rig; false: not its to move (the classic camera then does). */
function rigStep(this: CameraController, dt: number, move: number[], fast: boolean): boolean {
  const s = this.s;
  const R = this.rig;
  const mode = s.rotation;
  R.on = false;
  if (this.piloting || s.ship || this.flyMode || (mode === "orbit" && !this.rigOrbits())) return false;
  const w = this.rigWorld();
  if (!w) return false;
  // (moved by something else since the rig placed it — a scene, a jump: from where it is now)
  const where = [s.anchor, s.whL, s.distance, s.inclination, s.azimuth].join();
  if (R.key && R.placed && where !== R.placed) R.key = "";
  // two times: now — where the camera is was placed for it (read it then) — and the time the frame shows
  // (the simulation moves its clock on after this step): the camera placed for that. Placed for now, it
  // lagged the world it stands on by a frame's motion — 30 km/s × a frame: the ground shook
  const tNow = this.nowTime();
  const t = tNow + (s.animate && s.timeSpeed > 0 ? dt * s.timeSpeed : 0);
  // the body it moves with: the target (around, following), else the nearest (free: the nearest now,
  // taking over when much nearer; the tripod: the one it stands on)
  let ref = mode === "orbit" || mode === "follow" ? this.rigBody(s.target, w.ours, t) : this.rigBody(R.ref, w.ours, t);
  if (mode === "free" || mode === "tripod") {
    const n = this.rigNearest(w.ours, w.X, tNow);
    const dist = (b: NonNullable<typeof ref>) => (Math.hypot(...sub3(w.X, this.rigBody(b.id, w.ours, tNow)?.C ?? b.C)) - b.R) / b.R;
    if (!ref || (mode === "free" && n && n.id !== ref.id && dist(n) < 0.7 * dist(ref)) || (mode === "free" && dist(ref) > 60)) ref = n;
  }
  // (the body as the frame shows it)
  if (ref) ref = this.rigBody(ref.id, w.ours, t);
  if (!ref) {
    R.key = "";
    R.ref = null;
    return false;
  }
  R.on = true;
  const key = `${mode}|${s.target}|${ref.id}|${w.ours}`;
  // (the camera from the body, both now)
  const rel = sub3(w.X, this.rigBody(ref.id, w.ours, tNow)!.C);
  const mR = 1476.625 * s.massSolar; // metres per M
  if (key !== R.key) {
    // (a new behaviour, target or body: from where the camera is)
    R.key = key;
    R.ref = ref.id;
    R.off = rel;
    R.vel = [0, 0, 0];
    R.dolly = 0;
    R.yawOff = R.pitchOff = 0;
    const d = Math.hypot(...rel);
    R.alt = Math.max(d - ref.R, 50 / mR);
    R.az = (Math.atan2(rel[1], rel[0]) * 180) / Math.PI;
    R.el = (Math.asin(clamp(rel[2] / d, -1, 1)) * 180) / Math.PI;
    R.fixed = mode === "tripod" ? this.rigFix(ref.id, w.ours, w.X, tNow) : null;
    R.look = null;
  }
  // the keys' speed: 0.8 × the height above the surface per second (a metre at least), Shift × 3
  // (fixed on the world: from where it is fixed — the camera's last place is a frame behind the world)
  // (a spectator: no faster than its distance to the ship either — two metres a second at least by it)
  const h = Math.max(
    Math.min(
      Math.hypot(...(R.fixed ?? (mode === "follow" || mode === "free" ? R.off : rel))) -
        ref.R -
        this.reliefUnder(this.rigBody(ref.id, w.ours, tNow)!, w, tNow) / mR,
      this.nearShip,
    ),
    (Number.isFinite(this.nearShip) ? 2 : 1) / mR,
  );
  const v = 0.8 * h * this.flySpeed * (fast ? 3 : 1);
  const want = lin(lin(w.fwd, move[0]! * v, w.right, move[1]! * v), 1, w.up, move[2]! * v);
  R.vel = lin(R.vel, 1, sub3(want, R.vel), 1 - Math.exp(-dt / 0.12));
  if (!move.some((x) => x !== 0) && Math.hypot(...R.vel) < 1e-3 * h) R.vel = [0, 0, 0]; // (glided to a stop: a thousandth of the height per second)
  const step = lin(R.vel, dt, w.fwd, R.dolly * h);
  R.dolly = 0;
  const floor = (X: Vec3) => {
    // (not below the surface: a metre above its ground — the figure, its relief where known —, its sphere else)
    const r = sub3(X, ref!.C);
    const l = Math.hypot(...r);
    const g = w.ours && solidBody(ref!.id) && l < ref!.R * 1.01 ? groundAboveSphere(ref!.id, toBodyFixed(ref!.id, X, t)) : 0;
    const m = ref!.R + (g + 1) / mR;
    return l < m ? lin(ref!.C, 1, r, m / l) : X;
  };
  if (mode === "free") {
    // near the ground (under a fiftieth of the radius: the Earth's 130 km, the Moon's 35), carried by
    // it — turning with the world, the view with it —, as one standing there; higher, by its centre
    // (fixed: its height from where it is fixed — the camera's last place is a frame behind the world)
    const hr = (Math.hypot(...(R.fixed ?? rel)) - ref.R) / ref.R;
    const low = hr < (R.fixed ? 0.03 : 0.02);
    if (low && !R.fixed) (R.fixed = this.rigFix(ref.id, w.ours, w.X, tNow)), (R.look = null);
    else if (!low && R.fixed) (R.fixed = null), (R.off = rel), (R.look = null);
  }
  if (R.fixed && (mode === "tripod" || mode === "free")) {
    // (above the ground once its relief is known — the Earth's comes with its maps: set down before,
    // the tripod stood on the sea-level sphere, inside the mountains)
    const P = this.rigUnfix(ref.id, w.ours, R.fixed, t);
    const F = P && floor(P.X);
    if (P && F !== P.X) R.fixed = this.rigFix(ref.id, w.ours, F!, t) ?? R.fixed;
  }
  // (the same time, no key, nothing changed since the last placement: the camera is where it would be
  // put again — not rewritten, the round trip's last bits would move it each frame, and a paused image
  // would never refine)
  const stamp = () =>
    [t, key, R.az, R.el, R.alt, R.yawOff, R.pitchOff, ...R.off, ...(R.fixed ?? []), s.lookAt, this.poseKey(), s.velR, s.velT].join();
  if (step.every((x) => x === 0) && !move.some((x) => x !== 0) && R.stamp === stamp()) return true;
  if (mode === "orbit") {
    // around: the keys too — forwards / back the distance, sideways and up / down about it
    R.alt = clamp(R.alt * Math.exp(-move[0]! * dt * (fast ? 3 : 1)), 1 / mR, 1e6);
    R.az -= move[1]! * 40 * dt;
    R.el = clamp(R.el + move[2]! * 40 * dt, -89, 89);
    const d = ref.R + R.alt;
    const a = (R.az * Math.PI) / 180,
      e = (R.el * Math.PI) / 180;
    const X = lin(ref.C, 1, [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)], d);
    const fwd = unitV(sub3(ref.C, X));
    const upRef: Vec3 = Math.abs(fwd[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1];
    this.rigPlace(w.ours, X, fwd, unitV(sub3(upRef, lin(fwd, dot3(upRef, fwd), fwd, 0))), ref.V);
  } else if (mode === "tripod" || (mode === "free" && R.fixed)) {
    if (Math.hypot(...step) > 0 && R.fixed) {
      // (moved: from where the tripod stands now on the body)
      const P0 = this.rigUnfix(ref.id, w.ours, R.fixed, t);
      R.fixed = this.rigFix(ref.id, w.ours, floor(lin(P0?.X ?? w.X, 1, step, 1)), t);
    }
    const P = R.fixed ? this.rigUnfix(ref.id, w.ours, R.fixed, t) : null;
    const X = P?.X ?? floor(lin(ref.C, 1, R.off, 1));
    const V = P?.V ?? ref.V;
    if (!s.lookAt && R.fixed) {
      // the view free: fixed on the ground, turning with it (the sky wheels overhead — a time-lapse's
      // camera); turned by the user, fixed again as it is then
      const now = [s.yaw, s.pitch, s.roll].join();
      const dir = (v: Vec3) => this.rigFix(ref.id, w.ours, lin(X, 1, v, ref.R), t);
      if (!R.look || R.lookKey !== now) {
        const o = this.rigFix(ref.id, w.ours, X, t),
          f = dir(w.fwd),
          u = dir(w.up);
        R.look = o && f && u ? { f: sub3(f, o), u: sub3(u, o) } : null;
      }
      const o = R.look && this.rigUnfix(ref.id, w.ours, R.fixed, t);
      const back = (q: Vec3) => this.rigUnfix(ref.id, w.ours, lin(R.fixed!, 1, q, 1), t)?.X;
      const fX = R.look && back(R.look.f),
        uX = R.look && back(R.look.u);
      if (o && fX && uX) this.rigPlace(w.ours, X, unitV(sub3(fX, o.X)), unitV(sub3(uX, o.X)), V);
      else this.rigPlace(w.ours, X, w.fwd, w.up, V);
      R.lookKey = [s.yaw, s.pitch, s.roll].join();
      R.stamp = stamp();
      if (move.some((x) => x !== 0)) this.activity = performance.now();
      return true;
    }
    if (mode === "free") {
      // (locked on the target: the tracking aims it)
      this.rigPlace(w.ours, X, w.fwd, w.up, V);
      R.stamp = stamp();
      if (move.some((x) => x !== 0)) this.activity = performance.now();
      return true;
    }
    // aiming at the target (its centre; the hole: its place), the local vertical up, then the offsets
    const T = w.ours ? ourTarget(s, s.target, t).pos : bodyCentre(s, s.target, t);
    const up0 = w.ours && isOurBody(ref.id) ? figureUp(ref.id, X, t) : unitV(sub3(X, ref.C));
    let fwd = unitV(sub3(T, X));
    if (Math.abs(dot3(fwd, up0)) > 0.999) fwd = unitV(cross(up0, [0, 0, 1]));
    const east = unitV(cross(fwd, up0));
    const yo = (R.yawOff * Math.PI) / 180,
      po = (R.pitchOff * Math.PI) / 180;
    let f2 = lin(fwd, Math.cos(yo), east, -Math.sin(yo));
    const u2 = unitV(sub3(up0, lin(f2, dot3(up0, f2), f2, 0)));
    f2 = unitV(lin(f2, Math.cos(po), u2, Math.sin(po)));
    this.rigPlace(w.ours, X, f2, unitV(sub3(up0, lin(f2, dot3(up0, f2), f2, 0))), V);
  } else {
    // following the target, or free (carried by the nearest body): the keys move the camera (its offset
    // kept from frame to frame — not re-read from the camera, placed where the body was a frame ago)
    R.off = sub3(floor(lin(ref.C, 1, lin(R.off, 1, step, 1), 1)), ref.C);
    this.rigPlace(w.ours, lin(ref.C, 1, R.off, 1), w.fwd, w.up, ref.V);
  }
  R.stamp = stamp();
  if (move.some((x) => x !== 0)) this.activity = performance.now();
  return true;
}

/** The ground's height above a world's sphere under the camera [m] (known: our solid worlds' — the Earth's ellipsoid below it, its relief). */
function reliefUnder(this: CameraController, ref: { id: Body; C: Vec3; R: number }, w: { ours: boolean; X: Vec3 }, t: number) {
  if (!w.ours || !solidBody(ref.id) || Math.hypot(...sub3(w.X, ref.C)) > 1.01 * ref.R) return 0;
  return groundAboveSphere(ref.id, toBodyFixed(ref.id, w.X, t));
}

/** A place on a body's own (turning) axes: ours — its body-fixed axes [M]; Gargantua's planets — their frame's ξ. */
function rigFix(this: CameraController, id: Body, ours: boolean, X: Vec3, t: number): Vec3 | null {
  const s = this.s;
  if (ours) return isOurBody(id) ? toBodyFixed(id, X, t) : null;
  if (!["miller", "mann", "edmunds"].includes(id)) return null;
  const F = planetFrame(id, t, s.spin, s.massSolar);
  return toLocal(F, X, F.V).xi;
}

function rigUnfix(this: CameraController, id: Body, ours: boolean, q: Vec3, t: number): { X: Vec3; V: Vec3 } | null {
  const s = this.s;
  if (ours) {
    const X = fromBodyFixed(id, q, t);
    return { X, V: groundVelocity(id, X, t) };
  }
  if (!["miller", "mann", "edmunds"].includes(id)) return null;
  const F = planetFrame(id, t, s.spin, s.massSolar);
  return toGlobal(F, { xi: q, w: [0, 0, 0], landed: true });
}

/** What carries the camera (the rig's body) and its height above it [M], for the panel. */
function rigStatus(this: CameraController): { body: Body; h: number } | null {
  const R = this.rig;
  if (!R.on || !R.ref) return null;
  const w = this.rigWorld();
  const b = w && this.rigBody(R.ref, w.ours, this.nowTime());
  return w && b
    ? {
        body: b.id,
        h: w.ours && isOurBody(b.id) ? altitudeOver(b.id, w.X, this.nowTime()) / M_METRES : Math.hypot(...sub3(w.X, b.C)) - b.R,
      }
    : null;
}

/** The camera's distance [M] to the nearest surface of a body of its universe (planets, moons, stars). */
function surfaceDistance(this: CameraController): number {
  const s = this.s,
    cam = cameraFrame(s),
    t = this.nowTime();
  const ours = onOurSide(s, cam);
  let d = Infinity;
  for (const b of availableBodies(s, cam)) {
    if (b === "hole" || b === "barycentre" || b === "wormhole" || isOurs(b) !== ours) continue;
    const r = bodyDistance(s, cam, b, t) - bodyRadius(s, b);
    if (r < d) d = r;
  }
  return d;
}

/** The massive body nearest a point at time t (what a predicted path ran into). */
function nearestBody(this: CameraController, X: Vec3, t: number): Body | undefined {
  const cam = cameraFrame(this.s);
  let best: Body | undefined;
  let bd = Infinity;
  for (const b of availableBodies(this.s, cam)) {
    if (b === "hole" || b === "barycentre" || !(bodyMass(this.s, b) > 0)) continue;
    const d = Math.hypot(...sub3(X, bodyCentre(this.s, b, t))) / bodyRadius(this.s, b);
    if (d < bd) (bd = d), (best = b);
  }
  return best;
}

/**
 * Feed-forward for following a moving goal velocity (the orbit around a planet): its rate of change
 * minus what gravity alone does to the ship, so the pilot keeps on it without lagging behind (its
 * proportional correction, over ~1 s, would leave the ship sinking by a few % of the orbital speed —
 * the goal is a free orbit only to ~10 %: the metric's lengths, the relativistic velocity sum).
 */
function followFF(this: CameraController, cam: ReturnType<typeof cameraFrame>, beta: Vec3): Vec3 {
  const U = toU(beta);
  const tau = this.properTime;
  const p = this.prevWant;
  this.prevWant = { U, tau, body: this.s.target };
  if (!p || p.body !== this.s.target || !(tau > p.tau) || tau - p.tau > 2) return [0, 0, 0];
  const ff = sub3(lin(sub3(U, p.U), 1 / (tau - p.tau), U, 0), this.freeFallAccel(cam));
  // (a jump of the goal — a phase change — is left to the proportional part; what the engine can
  // give otherwise, up to its full thrust — near a planet, holding against its pull)
  const thr = this.thrustMax();
  const l = Math.hypot(...ff);
  if (l > 3 * thr) return [0, 0, 0];
  return l > thr ? lin(ff, thr / l, ff, 0) : ff;
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installRig(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    rigOrbits,
    rigWorld,
    rigBody,
    rigNearest,
    rigPlace,
    rigStep,
    reliefUnder,
    rigFix,
    rigUnfix,
    rigStatus,
    surfaceDistance,
    nearestBody,
    followFF,
  });
}
