// The CameraController — the camera's rotation modes: orbiting, free look, pointer, wheel and keys.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { basis, blToCartesian, cameraFrame, repPose, setHolePose, setHomePose, setRepPose, switchAnchor, yawPitchRoll } from "../camera";
import { horizon, zamo, type Vec3 } from "../physics";
import type { Settings, Target } from "../settings";
import {
  aimFrame,
  angularRadius,
  availableBodies,
  bodyCentre,
  bodyDistance,
  bodyLook,
  BODY_NAMES,
  cameraPosition,
  composeOffset,
  offsetFrom,
  pick,
  pixelLook,
  QUAT_ID,
  quatAngle,
  slerp,
  starOmega,
  starPhase,
  type Body,
  baryFraction,
  barycentreVelocity,
  starOrbitRadius,
  isCraft,
  isOurs,
} from "../targeting";
import type { Lens } from "../geodesic";
import { lensesOf } from "../lenses";
import { shipToCamera } from "../mounts";
import { fleet } from "../fleet";
import type { VesselId } from "../vessels";
import { ellOfR, mouth, sphericalFrame, toMouth } from "../wormhole";
import { repToHomeVec } from "../system/our-side";
import { issAxes, issTrack, m34unapply, partTransforms, station, stationAngles } from "../system/iss";
import { stationHulls, vesselHulls } from "../system/collide";
import { C_MPS, DEG, M_METRES } from "../units";
import { dot as dot3, lin, sub as sub3 } from "../math/vec3";

import type { CameraController, Cinematic } from "../controls";
import { add3, angleDiff, clamp, normalize, rotZ, unitV, wrapDeg, wrapYaw } from "./util";

declare module "../controls" {
  interface CameraController {
    setRotation: typeof setRotation;
    setLookAt: typeof setLookAt;
    availableTargets: typeof availableTargets;
    selectTarget: typeof selectTarget;
    cycleTarget: typeof cycleTarget;
    pickAt: typeof pickAt;
    targetInfo: typeof targetInfo;
    issSeen: typeof issSeen;
    issSurfaceDistance: typeof issSurfaceDistance;
    pickIss: typeof pickIss;
    lockView: typeof lockView;
    craftSurfaceDistance: typeof craftSurfaceDistance;
    nowTime: typeof nowTime;
    shipClock: typeof shipClock;
    aim: typeof aim;
    startFocus: typeof startFocus;
    frameTarget: typeof frameTarget;
    clearDirection: typeof clearDirection;
    stepFlight: typeof stepFlight;
    ensureAnchor: typeof ensureAnchor;
    toLocal: typeof toLocalMethod;
    orbitBy: typeof orbitBy;
    track: typeof track;
    levelOnGround: typeof levelOnGround;
    followMin: typeof followMin;
    followBody: typeof followBody;
    baryRest: typeof baryRest;
    driftWithBarycentre: typeof driftWithBarycentre;
    updateMotion: typeof updateMotion;
    lens: typeof lens;
    rotateView: typeof rotateView;
    setCinematic: typeof setCinematic;
    endDive: typeof endDive;
    setFlyMode: typeof setFlyMode;
    setGravity: typeof setGravity;
    setHover: typeof setHover;
    pinchSpan: typeof pinchSpan;
    pinchCentre: typeof pinchCentre;
    dragBy: typeof dragBy;
    zoomStep: typeof zoomStep;
  }
}

/**
 * The camera's placement: around the target, following it, free, on a tripod — from where the camera
 * is (none of them moves it). Falling freely (gravity) is the free placement's: another one lands it.
 */
function setRotation(this: CameraController, mode: Settings["rotation"]) {
  this.s.rotation = mode;
  this.activity = performance.now();
  if (mode !== "orbit" && this.cinematic === "orbit") this.setCinematic(null);
  if (mode !== "free" && this.gravity && !this.piloting) this.setGravity(false);
  if (mode === "orbit") this.startFocus();
  this.onCinematicChange(this.cinematic);
}

/** The view locked on the target (or free); turning it on turns the view to the target. */
function setLookAt(this: CameraController, on: boolean) {
  this.s.lookAt = on;
  this.activity = performance.now();
  this.lookOff = [0, 0];
  if (this.piloting) {
    // (the ship's views: the camera eases to its new placement; around the ship, behind it on the
    // target's line — a little above)
    if (this.lastPose) this.mountAnim = { from: this.lastPose, t: 0 };
    if (on && this.outsideView() === "around") (this.outside.yaw = 0), (this.outside.pitch = 10);
  } else if (on) this.startFocus();
  this.onCinematicChange(this.cinematic);
}

/** Bodies that can be selected from where the camera is. */
function availableTargets(this: CameraController): Body[] {
  return availableBodies(this.s, cameraFrame(this.s));
}

/**
 * Selects the body to orbit / aim at. focus: turn the view to it; frame: also move to a distance
 * that frames it. Returns false if it is not in the camera's universe.
 */
function selectTarget(this: CameraController, body: Target, o: { focus?: boolean; frame?: boolean } = {}) {
  const s = this.s;
  if (!this.availableTargets().includes(body)) return false;
  const changed = s.target !== body;
  s.target = body;
  this.activity = performance.now();
  this.aimCache = null;
  this.followD = null;
  if (changed && this.cinematic === "orbit") this.sync();
  if (this.tracking) {
    // (around the target: its frame — looking at it from anywhere leaves the camera's)
    if (this.orbiting) this.ensureAnchor();
    if (o.frame) this.frameTarget();
    if (o.focus !== false) this.startFocus();
  }
  this.onCinematicChange(this.cinematic);
  return true;
}

/** Next / previous available body (Tab / Shift+Tab). */
function cycleTarget(this: CameraController, dir: 1 | -1 = 1) {
  const list = this.availableTargets();
  const i = list.indexOf(this.s.target);
  this.selectTarget(list[(i + dir + list.length) % list.length]!);
}

/** The body seen at a point of the canvas (CSS pixels), if any and selectable. */
function pickAt(this: CameraController, x: number, y: number): Body | null {
  const s = this.s;
  const w = this.canvas.clientWidth;
  const h = this.canvas.clientHeight;
  const cam = cameraFrame(s);
  const look = pixelLook(cam, (2 * x) / w - 1, 1 - (2 * y) / h, s.fov, w / h);
  const body = pick(s, cam, look, this.nowTime());
  return body && availableBodies(s, cam).includes(body) ? body : null;
}

/**
 * The target as seen now, for the overlay: its apparent direction (camera components), straight
 * distance and angular radius.
 */
function targetInfo(this: CameraController) {
  const s = this.s;
  const cam = cameraFrame(s);
  const aim = this.aim(cam);
  if (!aim) return null;
  const dist = bodyDistance(s, cam, s.target, this.nowTime());
  return {
    body: s.target,
    name: BODY_NAMES[s.target],
    look: aim.look,
    lensed: aim.lensed,
    dist,
    ang: angularRadius(s, s.target, dist),
    cam,
  };
}

/** The space station from the camera's eye now: its direction (rep), distance [m], place and velocity. */
function issSeen(this: CameraController) {
  const s = this.s;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  if (!nav || !s.iss) return null;
  const st = issTrack.state(nav.t, nav.X);
  if (!st) return null;
  const d = lin(sub3(st.X, nav.X), M_METRES, st.X, 0);
  // (from the eye, not the ship's centre)
  const eye = s.ship ? shipToCamera(this.shipPose(), s.shipLookYaw, s.shipLookPitch).t : ([0, 0, 0] as Vec3);
  const r = nav.toRep(d);
  const dir = lin(lin(r, 1, cam.right, eye[0]), 1, lin(cam.up, eye[1], cam.fwd, eye[2]), 1);
  const dist = Math.hypot(...dir);
  if (!(dist < 5e6)) return null;
  return { cam, nav, st, dir: lin(dir, 1 / dist, dir, 0), dist };
}

/**
 * The distance from the eye to the station's nearest point [m]: within 1.5 km, its nearest vertex
 * (the coarse mesh, its parts turned as they are); farther, its centre less 38 m.
 */
function issSurfaceDistance(this: CameraController, v: NonNullable<ReturnType<CameraController["issSeen"]>>) {
  if (v.dist > 1500 || !stationHulls.length || !station.joints.length) return Math.max(v.dist - 38, 0);
  const s = this.s;
  const w = mouth(s).w;
  const cam = v.cam;
  // the eye on the station's axes [m]
  const A = issAxes(v.st.X, v.st.V, v.nav.t);
  const dH = repToHomeVec(w, cam.ell, cam.n, lin(v.dir, v.dist, v.dir, 0));
  const q: Vec3 = [-dot3(dH, A[0]), -dot3(dH, A[1]), -dot3(dH, A[2])];
  const T = partTransforms(station.joints, stationAngles(v.nav.t, v.st.X, v.st.V));
  let best = Infinity;
  stationHulls.forEach((bvh, k) => {
    if (!bvh) return;
    const qp = m34unapply(T[k]!, q);
    // (its own vertices: the parts share one array — through its triangles)
    const P = bvh.pos,
      I = bvh.tri;
    for (let j = 0; j < I.length; j++) {
      const i = 3 * I[j]!;
      const d2 = (P[i]! - qp[0]) ** 2 + (P[i + 1]! - qp[1]) ** 2 + (P[i + 2]! - qp[2]) ** 2;
      if (d2 < best) best = d2;
    }
  });
  return Math.sqrt(best);
}

/** Whether a click at (x, y) [CSS px] falls on the space station's image (its 60 m, or 14 px). */
function pickIss(this: CameraController, x: number, y: number) {
  const v = this.issSeen();
  if (!v) return false;
  const s = this.s;
  const w = this.canvas.clientWidth,
    h = this.canvas.clientHeight;
  const look = pixelLook(v.cam, (2 * x) / w - 1, 1 - (2 * y) / h, s.fov, w / h);
  const ang = Math.acos(Math.max(-1, Math.min(1, dot3(look, v.dir))));
  const px = (2 * Math.tan((s.fov * Math.PI) / 360)) / h; // (radians a pixel, near the middle)
  return ang < Math.max(Math.atan(60 / v.dist), 14 * px);
}

/**
 * The targeting: what is locked (the space station when clicked, else the target body), as the HUD
 * draws it — its name, its direction (camera frame: x right, y up, z forward), its angular radius,
 * the distance to its surface [m], its velocity relative to the ship (camera frame) [m/s], the
 * closing rate [m/s, > 0 closing], the closest approach on straight lines (its distance from the
 * surface [m] and time [s]) and, on a collision course, the time to impact [s].
 */
function lockView(this: CameraController) {
  const s = this.s;
  const C_MS = C_MPS;
  const cam = cameraFrame(s);
  const toCam = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
  // the straight-line geometry: ship relative to the target (position p [m], velocity u [m/s])
  const course = (p: Vec3, u: Vec3, R: number) => {
    const uu = dot3(u, u);
    const pu = dot3(p, u);
    const tc = uu > 1e-12 ? -pu / uu : 0;
    const miss = tc > 0 ? Math.hypot(...lin(p, 1, u, tc)) : Math.hypot(...p);
    let impact = NaN;
    if (tc > 0 && miss < R) {
      const disc = pu * pu - uu * (dot3(p, p) - R * R);
      if (disc >= 0) impact = (-pu - Math.sqrt(disc)) / uu;
    }
    return { tca: tc > 0 ? tc : NaN, ca: Math.max(miss - R, 0), impact };
  };
  if (s.target === "iss") {
    const v = this.issSeen();
    if (v) {
      // (its velocity relative to the ship: the station's, against the ship's)
      const vr = v.nav.toRep(lin(sub3(v.st.V, v.nav.V), C_MS, v.st.V, 0));
      // (its ring: the half-span it shows from most sides — the truss 50 m, the modules 37)
      const R = 38;
      const dirC = toCam(v.dir);
      const vC = toCam(vr);
      const p = lin(v.dir, -v.dist, v.dir, 0),
        u = lin(vr, -1, vr, 0);
      const c = course(p, u, R);
      return {
        id: "iss",
        name: "ISS",
        colour: "95, 255, 208",
        dir: dirC,
        ang: Math.atan(R / v.dist),
        dist: this.issSurfaceDistance(v),
        centre: v.dist,
        vrel: vC,
        closing: -dot3(vr, v.dir),
        ...c,
      };
    }
  }
  const info = this.targetInfo();
  if (!info) return null;
  const mR = 1476.625 * (s.massSolar || 1);
  const R = Math.tan(info.ang) * info.dist * mR;
  const dirC = toCam(info.look);
  const vt = this.targetVelLocal(cam);
  const vr: Vec3 = vt ? lin(sub3(vt, cam.beta), C_MS, vt, 0) : [0, 0, 0];
  const centre = info.dist * mR;
  const p = lin(info.look, -centre, info.look, 0),
    u = lin(vr, -1, vr, 0);
  const c = course(p, u, R);
  // (a craft: the distance to its hull — its nearest vertex —, not to its sphere)
  const surf = isCraft(s.target) ? this.craftSurfaceDistance(s.target, cam) : null;
  return {
    id: String(s.target),
    name: info.name,
    colour: "",
    dir: dirC,
    ang: info.ang,
    dist: surf ?? Math.max(centre - R, 0),
    centre,
    vrel: toCam(vr),
    closing: -dot3(vr, info.look),
    ...c,
  };
}

/** The distance from the eye to a craft's hull [m] (near it: its nearest vertex), or null. */
function craftSurfaceDistance(this: CameraController, id: VesselId, cam: ReturnType<typeof cameraFrame>): number | null {
  const s = this.s;
  const nav = this.ourNav(cam);
  const p = nav ? fleet.pose(id, nav.t) : null;
  const hull = vesselHulls[id];
  if (!nav || !p || !hull.bvh) return null;
  // the eye: the camera's place less its attach point's offset
  const w = mouth(s).w;
  const e = s.ship ? shipToCamera(this.shipPose(), s.shipLookYaw, s.shipLookPitch).t : ([0, 0, 0] as Vec3);
  const ax = [cam.right, cam.up, cam.fwd].map((a) => unitV(repToHomeVec(w, cam.ell, cam.n, a)));
  let eye = nav.X;
  for (let k = 0; k < 3; k++) eye = lin(eye, 1, ax[k]!, -e[k]! / M_METRES);
  const d = lin(sub3(eye, p.X), M_METRES, eye, 0);
  const q: Vec3 = [dot3(d, p.ax[0]), dot3(d, p.ax[1]), dot3(d, p.ax[2])];
  const l = Math.hypot(...q);
  if (l > 3 * hull.radius) return l - 0.6 * hull.radius;
  let best = Infinity;
  const P = hull.bvh.pos;
  for (const i of hull.bvh.verticesNear(q, l))
    best = Math.min(best, (P[3 * i]! - q[0]) ** 2 + (P[3 * i + 1]! - q[1]) ** 2 + (P[3 * i + 2]! - q[2]) ** 2);
  return Number.isFinite(best) ? Math.sqrt(best) : l - 0.6 * hull.radius;
}

/** The scene's time now: the frame's, or, once the ship has moved this frame, the ship's clock. */
function nowTime(this: CameraController) {
  if (Number.isFinite(this.shipTime)) return this.shipTime;
  return Number.isFinite(this.time) ? this.time : 0;
}

/**
 * The coordinate time the ship reached in the last update (null: it did not move): the scene's
 * clock takes it, so the bodies are drawn where the ship's integrator had them — also when an
 * autopilot changed the warp during the frame.
 */
function shipClock(this: CameraController): number | null {
  return Number.isFinite(this.shipTime) ? this.shipTime : null;
}

/** Apparent direction of the target (cached; warm-started from the last answer). */
function aim(this: CameraController, cam: ReturnType<typeof cameraFrame>) {
  const s = this.s;
  const body = s.target;
  // (the bodies that move: the companion star, the centre of mass, our solar system's — seen now)
  const t = body === "star" || body === "barycentre" || isOurs(body) ? this.nowTime() : 0;
  const key = [
    body,
    cam.region,
    cam.r,
    cam.theta,
    cam.phi,
    cam.ell,
    ...cam.n,
    ...cam.beta,
    t,
    s.spin,
    s.sun,
    s.sunOrbit,
    s.sunRadius,
    s.sunPhase,
    s.wormhole,
    s.whDist,
    s.whIncl,
    s.whAzimuth,
    s.whRho,
    s.disk,
    s.diskOuter,
  ].join();
  if (this.aimCache?.key === key) return this.aimCache;
  const guess = this.aimCache?.body === body ? this.aimCache.look : null;
  const r = bodyLook(s, cam, body, t, guess);
  this.aimCache = { body, key, ...r };
  return this.aimCache;
}

/** Smooth turn of the view onto the target (duration grows with the angle). */
function startFocus(this: CameraController) {
  const s = this.s;
  if (!this.tracking) return;
  const cam = cameraFrame(s);
  const aim = this.aim(cam);
  if (!aim) return;
  const b = basis(s.yaw, s.pitch, s.roll);
  const from = offsetFrom(aimFrame(this.toLocal(cam, aim.look)), b.fwd, b.up);
  this.focus = { from, t: 0, dur: 0.45 + 0.55 * (quatAngle(from) / Math.PI) };
  this.offset = from;
  this.written = [s.yaw, s.pitch, s.roll].join();
}

/** Distance that frames the target (its angular radius about a sixth of the field of view). */
function frameTarget(this: CameraController) {
  const s = this.s;
  const half = (s.fov * DEG) / 2;
  const body = s.target;
  // (the centre of mass: frame the whole system, the star's orbit)
  const R =
    body === "hole"
      ? 3 * Math.sqrt(3)
      : body === "star"
        ? s.sunRadius
        : body === "barycentre"
          ? 1.15 * starOrbitRadius(s)
          : 1.6 * mouth(s).w.rho;
  const d = R / Math.sin((body === "hole" ? 0.34 : body === "barycentre" ? 0.9 : 0.28) * half);
  if (body === "hole") return void (this.targetDistance = clamp(d, horizon(s.spin) + 1, 1000));
  const cam = cameraFrame(s);
  const X = cameraPosition(s, cam);
  if (!X || (body === "wormhole" && cam.region === "throat")) {
    // our side of the wormhole (or inside its mouth): straight along ℓ
    this.targetL = (s.whL < 0 ? -1 : 1) * clamp(d, this.lMin(), 2000);
    return;
  }
  // in the body's frame (co-rotating for the star): fly on an arc to a clear viewpoint
  const t = this.nowTime();
  const ph = body === "star" ? starPhase(s, t) : 0;
  const C = rotZ(bodyCentre(s, body, t), -ph);
  const rel = sub3(rotZ(X, -ph), C);
  const d0 = Math.hypot(...rel);
  const n0 = lin(rel, 1 / d0, rel, 0);
  const d1 =
    body === "star" ? Math.max(d, 1.3 * s.sunRadius) : body === "barycentre" ? clamp(d, 10, 2000) : clamp(d, mouth(s).rGlue * 1.05, 2000);
  const n1 = this.clearDirection(C, n0, d1);
  const turn = Math.acos(clamp(dot3(n0, n1), -1, 1));
  const dur = clamp(0.8 + 0.25 * Math.abs(Math.log(d0 / d1)) + (0.8 * turn) / Math.PI, 0.8, 2.4);
  this.flight = { body, t: 0, dur, C, n0, n1, d0, d1 };
}

/**
 * A viewing direction from the body (unit, from its centre towards the camera) close to `n0`
 * whose line of sight to the body, from distance d, clears the hole and its disk; bends towards
 * "outward and a little above the disk" as needed.
 */
function clearDirection(this: CameraController, C: Vec3, n0: Vec3, d: number): Vec3 {
  const s = this.s;
  const rC = Math.hypot(...C);
  const up = n0[2] >= 0 || C[2] >= 0 ? 1 : -1;
  const out = normalize(lin(lin(C, 1 / rC, [0, 0, 1], 0), 1, [0, 0, up], 0.4));
  const clear = (n: Vec3) => {
    const X = lin(C, 1, n, d);
    // not deep in the hole's field (light bends a lot there)
    if (Math.hypot(...X) < Math.max(horizon(s.spin) + 4, 0.6 * rC)) return false;
    // the line of sight passes well clear of the hole
    const v = sub3(C, X);
    const u = clamp(-dot3(X, v) / dot3(v, v), 0, 1);
    if (Math.hypot(...lin(X, 1, v, u)) < Math.max(10, 0.5 * rC)) return false;
    // the disk (and a margin) must not lie across it
    if (s.disk && X[2] * C[2] < 0) {
      const f = X[2] / (X[2] - C[2]);
      const P = lin(X, 1, v, f);
      if (Math.hypot(P[0], P[1]) < 1.3 * s.diskOuter) return false;
    }
    return true;
  };
  for (let k = 0; k <= 8; k++) {
    const n = normalize(lin(n0, 1 - k / 8, out, k / 8));
    if (clear(n)) return n;
  }
  return out;
}

/** Advances the flight to a framing position (orbit mode). */
function stepFlight(this: CameraController, dt: number) {
  const s = this.s;
  const F = this.flight!;
  F.t += dt;
  const x = Math.min(F.t / F.dur, 1);
  const e = x * x * x * (x * (6 * x - 15) + 10);
  // direction: spherical interpolation; distance: logarithmic
  const om = Math.acos(clamp(dot3(F.n0, F.n1), -1, 1));
  const n = om < 1e-6 ? F.n1 : lin(F.n0, Math.sin((1 - e) * om) / Math.sin(om), F.n1, Math.sin(e * om) / Math.sin(om));
  const d = Math.exp(Math.log(F.d0) + (Math.log(F.d1) - Math.log(F.d0)) * e);
  const t = this.nowTime();
  const ph = F.body === "star" ? starPhase(s, t) : 0;
  // around the body's present centre (the centre of mass moves in the hole's frame)
  const Y = rotZ(lin(rotZ(bodyCentre(s, F.body, t), -ph), 1, n, d), ph);
  if (F.body !== "wormhole") {
    const f = sphericalFrame(Y);
    s.distance = f.r;
    s.inclination = clamp(f.th / DEG, 0.2, 179.8);
    s.azimuth = f.ph / DEG;
    this.targetDistance = s.distance;
  } else {
    // around the mouth, Gargantua side: ℓ and the angles of the rep position
    const m = mouth(s);
    const q = toMouth(m, sub3(Y, m.C));
    const r = Math.hypot(...q);
    const f = sphericalFrame(lin(q, 1 / r, q, 0));
    s.whL = ellOfR(m.w, r);
    s.inclination = clamp(f.th / DEG, 0.2, 179.8);
    s.azimuth = f.ph / DEG;
    this.targetL = s.whL;
  }
  if (x >= 1) {
    this.flight = null;
    this.followD = F.body === "wormhole" ? this.followD : F.d1;
  }
}

/** Orbit mode: the settings' anchor matches the target (the hole's frame for the star). */
function ensureAnchor(this: CameraController) {
  const s = this.s;
  if (!s.wormhole) return;
  // (our solar system's bodies: through our mouth — its frame; the rest, the hole's)
  const want = s.target === "wormhole" || isOurs(s.target) ? "wormhole" : "hole";
  if (s.anchor === want) return;
  if (!switchAnchor(s, want)) s.target = "wormhole";
  this.targetDistance = s.distance;
  this.targetL = s.whL;
  this.written = "";
}

/** Camera components → components in the frame where basis(yaw, pitch, roll) is defined. */
function toLocalMethod(this: CameraController, cam: ReturnType<typeof cameraFrame>, v: Vec3): Vec3 {
  const s = this.s;
  const b = basis(s.yaw, s.pitch, s.roll);
  return add3(b.right, b.up, b.fwd, [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)]);
}

/** Orbit increments (degrees of azimuth and inclination) around the target. */
function orbitBy(this: CameraController, dAz: number, dInc: number) {
  const s = this.s;
  if (!this.orbiting) return;
  this.flight = null;
  if (s.target === "star" || s.target === "barycentre") {
    this.followOrbit[0] += dAz;
    this.followOrbit[1] += dInc;
    return;
  }
  s.azimuth = wrapDeg(s.azimuth + dAz);
  s.inclination = clamp(s.inclination + dInc, 0.2, 179.8);
}

/** Keeps the target in view: orientation = aim frame ∘ offset (the offset eases to 0 in a focus). */
function track(this: CameraController, dt: number) {
  const s = this.s;
  const cam = cameraFrame(s);
  const aim = this.aim(cam);
  if (!aim) return;
  const A = aimFrame(this.toLocal(cam, aim.look));
  const now = [s.yaw, s.pitch, s.roll].join();
  if (!this.offset || now !== this.written) {
    // turned by the user (or a preset, the panel…): keep that as the new offset
    const b = basis(s.yaw, s.pitch, s.roll);
    this.offset = offsetFrom(A, b.fwd, b.up);
    if (this.written) this.focus = null;
  }
  if (this.focus) {
    this.focus.t += dt;
    const x = Math.min(this.focus.t / this.focus.dur, 1);
    this.offset = slerp(this.focus.from, QUAT_ID, x * x * x * (x * (6 * x - 15) + 10));
    if (x >= 1) this.focus = null;
  }
  const o = composeOffset(A, this.offset);
  const e = yawPitchRoll(o.fwd, o.up);
  // (round-off of the round trip must not count as a change: the image would never converge)
  const moved = Math.abs(angleDiff(e.yaw, s.yaw)) + Math.abs(e.pitch - s.pitch) + Math.abs(angleDiff(e.roll, s.roll)) > 1e-7;
  if (moved) {
    s.yaw = e.yaw;
    s.pitch = e.pitch;
    s.roll = e.roll;
  }
  // (standing on a world: the horizon level — the aim's own "up" is the mouth's frame's, tilted there;
  // kept as the offset from then on, so that the aim and the level do not undo each other each frame)
  if (this.rig.on && this.rig.fixed && this.levelOnGround()) {
    const b = basis(s.yaw, s.pitch, s.roll);
    this.offset = offsetFrom(A, b.fwd, b.up);
  }
  this.written = [s.yaw, s.pitch, s.roll].join();
}

/** The camera's up turned to the local vertical (its forward kept): true when it turned. */
function levelOnGround(this: CameraController): boolean {
  const s = this.s;
  const w = this.rigWorld();
  const ref = w && this.rig.ref ? this.rigBody(this.rig.ref, w.ours, this.nowTime()) : null;
  if (!w || !ref) return false;
  const V = unitV(sub3(w.X, ref.C));
  const up = sub3(V, lin(w.fwd, dot3(V, w.fwd), w.fwd, 0));
  if (Math.hypot(...up) < 1e-3) return false; // (looking straight up or down: no horizon)
  const u = unitV(up);
  if (dot3(u, w.up) > 1 - 1e-12) return false;
  const vel: Vec3 = [s.velR, s.velT, s.velP];
  if (w.ours) setHomePose(s, w.X, w.fwd, u);
  else setHolePose(s, w.X, w.fwd, u);
  [s.velR, s.velT, s.velP] = vel;
  // (the rig's own place, re-expressed: not a move from outside)
  this.rig.placed = [s.anchor, s.whL, s.distance, s.inclination, s.azimuth].join();
  return true;
}

/** Closest the camera may orbit the followed body. */
function followMin(this: CameraController) {
  const s = this.s;
  return s.target === "star" ? 1.3 * s.sunRadius : 2;
}

/**
 * Orbiting the star or the centre of mass: the camera keeps its position relative to the body —
 * in the star's rotating frame (it follows it along its orbit), or in the non-rotating frame of
 * the centre of mass (at rest in it: Gargantua and the star turn around it) — plus the drag
 * increments and the eased wheel distance.
 */
function followBody(this: CameraController, dt: number) {
  const s = this.s;
  if (s.anchor !== "hole") return;
  const body = s.target;
  const phase = (t: number) => (body === "star" ? starPhase(s, t) : 0);
  const t0 = Number.isFinite(this.prevTime) ? this.prevTime : this.nowTime();
  const t1 = this.nowTime();
  const X = blToCartesian(s.distance, clamp(s.inclination, 0.2, 179.8) * DEG, s.azimuth * DEG);
  const rel = rotZ(sub3(X, bodyCentre(s, body, t0)), -phase(t0));
  let d = Math.hypot(...rel);
  let inc = Math.acos(clamp(rel[2] / d, -1, 1)) / DEG;
  let az = Math.atan2(rel[1], rel[0]) / DEG;
  az += this.followOrbit[0];
  inc = clamp(inc - this.followOrbit[1], 1, 179);
  this.followOrbit = [0, 0];
  const dMin = this.followMin();
  if (this.followD === null) this.followD = d;
  this.followD = clamp(this.followD, dMin, 2000);
  const k = 1 - Math.exp(-10 * dt);
  d = Math.abs(Math.log(this.followD / d)) < 1e-4 ? this.followD : Math.exp(Math.log(d) + (Math.log(this.followD) - Math.log(d)) * k);
  const st = Math.sin(inc * DEG);
  const relN: Vec3 = [d * st * Math.cos(az * DEG), d * st * Math.sin(az * DEG), d * Math.cos(inc * DEG)];
  const Y = lin(bodyCentre(s, body, t1), 1, rotZ(relN, phase(t1)), 1);
  if (Math.hypot(...Y) < horizon(s.spin) + 0.5) return;
  if (Math.hypot(...sub3(Y, X)) < 1e-9 * (1 + d)) return; // (round-off only: keep still)
  const f = sphericalFrame(Y);
  s.distance = f.r;
  s.inclination = clamp(f.th / DEG, 0.2, 179.8);
  s.azimuth = f.ph / DEG;
  this.targetDistance = s.distance;
}

/**
 * The camera is at rest in the centre-of-mass frame (the star has a mass, so Gargantua moves):
 * free rotation, or orbiting the centre of mass — not when falling freely, nor near the mouth.
 */
function baryRest(this: CameraController) {
  const s = this.s;
  if (!baryFraction(s) || this.gravity || this.cinematic === "dive" || this.cinematic === "journey" || s.anchor !== "hole") return false;
  if (cameraFrame(s).region !== "hole") return false;
  return s.rotation === "free" || this.flyMode || (this.orbiting && s.target === "barycentre");
}

/** Free camera at rest in the centre-of-mass frame: in the hole's frame it drifts by ΔB. */
function driftWithBarycentre(this: CameraController) {
  const s = this.s;
  const t0 = Number.isFinite(this.prevTime) ? this.prevTime : this.nowTime();
  const t1 = this.nowTime();
  if (t1 === t0) return;
  const dB = sub3(bodyCentre(s, "barycentre", t1), bodyCentre(s, "barycentre", t0));
  const cam = cameraFrame(s);
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const f = sphericalFrame(X);
  const w = (v: Vec3) => add3(f.er, f.et, f.ep, v);
  const Y = lin(X, 1, dB, 1);
  if (Math.hypot(...Y) < horizon(s.spin) + 0.5) return;
  setHolePose(s, Y, w(cam.fwd), w(cam.up)); // same orientation w.r.t. the distant stars
  this.targetDistance = s.distance;
}

/**
 * The camera's velocity when the controller carries it: co-moving with the star while orbiting it
 * (rigid rotation at Ω★: v = ϖ(Ω★ − ω)/α relative to the ZAMO), at rest in the centre-of-mass
 * frame (v = the centre of mass's velocity in the hole's frame), else at rest; eased (~0.35 s).
 */
function updateMotion(this: CameraController, dt: number) {
  const s = this.s;
  const own = s.motion === "static" || s.motion === "comoving" || s.motion === "barycentric";
  const carried = s.motion === "comoving" || s.motion === "barycentric";
  if (!own || s.anchor !== "hole") {
    if (carried) (s.motion = "static"), (s.velR = s.velT = s.velP = 0);
    return;
  }
  const kind = this.orbiting && s.target === "star" ? "star" : this.baryRest() ? "bary" : null;
  const th = clamp(s.inclination, 0.2, 179.8) * DEG;
  const r = Math.max(s.distance, horizon(s.spin) + 0.05);
  const z = zamo(r, th, s.spin);
  let target: Vec3 = [0, 0, 0];
  if (kind === "star") target = [0, 0, (z.varpi * (starOmega(s) - z.omega)) / z.alpha];
  else if (kind === "bary") {
    const f = sphericalFrame(blToCartesian(r, th, s.azimuth * DEG));
    const v = barycentreVelocity(s, this.nowTime());
    target = [dot3(v, f.er) / z.alpha, dot3(v, f.et) / z.alpha, dot3(v, f.ep) / z.alpha];
  }
  const cur: Vec3 = carried ? [s.velR, s.velT, s.velP] : [0, 0, 0];
  const k = 1 - Math.exp(-dt / 0.35);
  let next = lin(cur, 1, sub3(target, cur), k);
  if (Math.hypot(...sub3(target, next)) < 2e-5) next = target; // arrived: constant (the image converges)
  if (!kind && Math.hypot(...next) < 2e-4) {
    if (carried) (s.motion = "static"), (s.velR = s.velT = s.velP = 0);
    return;
  }
  if (kind) s.motion = kind === "star" ? "comoving" : "barycentric";
  [s.velR, s.velT, s.velP] = next.map((v) => clamp(v, -0.95, 0.95)) as Vec3;
}

/**
 * The gravitating bodies for the ship's geodesic: the companion star (Gargantua then orbits the
 * centre of mass with it), or a system's planets and stars (weak fields; m ≪ M, the hole stays
 * put). Undefined when there are none.
 */
function lens(this: CameraController): Lens | Lens[] | undefined {
  return lensesOf(this.s);
}

/**
 * Turns the camera about its own axes (degrees): towards its right, towards its up, and a roll
 * (positive: counter-clockwise). No gimbal limit: looping over the top works.
 */
function rotateView(this: CameraController, dRight: number, dUp: number, dRoll: number) {
  const s = this.s;
  const b = basis(s.yaw, s.pitch, s.roll);
  const rot = (a: Vec3, c: Vec3, deg: number): [Vec3, Vec3] => {
    const k = deg * DEG;
    return [lin(a, Math.cos(k), c, Math.sin(k)), lin(c, Math.cos(k), a, -Math.sin(k))];
  };
  let [f, r] = rot(b.fwd, b.right, dRight);
  let u: Vec3;
  [f, u] = rot(f, b.up, dUp);
  [r, u] = rot(r, u, dRoll);
  const e = yawPitchRoll(f, u);
  s.yaw = e.yaw;
  s.pitch = e.pitch;
  s.roll = e.roll;
}

function setCinematic(this: CameraController, mode: Cinematic) {
  if (this.cinematic === "dive" && mode !== "dive") this.endDive();
  if (mode !== "journey") this.journey = null;
  if (mode === "dive" && this.aroundWormhole && !switchAnchor(this.s, "hole")) mode = null;
  if (mode === "journey") this.startJourney();
  if (mode === "orbit") this.s.rotation = "orbit"; // auto-orbit turns around the target
  if (mode === "dive") this.s.target = "hole";
  this.cinematic = mode;
  if (mode === "dive") {
    const s = this.s;
    this.diveSaved = { distance: s.distance, motion: s.motion, azimuth: s.azimuth, yaw: s.yaw, pitch: s.pitch, roll: s.roll };
    s.motion = "infall";
    s.yaw = s.pitch = s.roll = 0;
    this.diveHold = 0;
  }
  this.onCinematicChange(mode);
}

function endDive(this: CameraController) {
  if (this.diveSaved) Object.assign(this.s, this.diveSaved);
  this.diveSaved = null;
  this.sync();
}

/** Enters/leaves game-style flight (pointer lock; Esc also leaves). */
function setFlyMode(this: CameraController, on: boolean) {
  if (on && document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
  if (!on && document.pointerLockElement === this.canvas) document.exitPointerLock();
}

/** Gravity on: from now on the camera falls freely (starting at rest w.r.t. the local static observer). */
function setGravity(this: CameraController, on: boolean) {
  const s = this.s;
  this.gravity = on;
  this.path = null;
  if (on) {
    if (this.cinematic) this.setCinematic(null);
    // (falling is the free placement's: from around the target, the view stays on it)
    if (s.rotation !== "free" && !this.piloting) {
      if (s.rotation === "orbit") s.lookAt = true;
      s.rotation = "free";
    }
    s.motion = "geodesic";
    this.properTime = 0;
    // our universe: the pose's velocity kept (an orbit, a planet's motion); none given: moving with
    // the body of the sphere of influence
    const cam = cameraFrame(s);
    const nav = this.ourNav(cam);
    if (nav && Math.hypot(s.velR, s.velT, s.velP) === 0) {
      const p = repPose(s);
      setRepPose(s, { ...p, vel: nav.refVelRep });
    } else if (!nav) s.velR = s.velT = s.velP = 0;
  } else if (s.motion === "geodesic") {
    s.motion = "static";
    s.velR = s.velT = s.velP = 0;
  }
  this.onCinematicChange(this.cinematic);
}

function setHover(this: CameraController, h: CameraController["hover"]) {
  if (h?.body === this.hover?.body && (!h || (h.x === this.hover!.x && h.y === this.hover!.y))) return;
  this.hover = h;
  this.canvas.style.cursor = h ? "pointer" : "";
}

function pinchSpan(this: CameraController) {
  const [a, b] = [...this.pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function pinchCentre(this: CameraController) {
  const [a, b] = [...this.pointers.values()];
  return a && b ? { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y) } : null;
}

/** A drag of the view by (dx, dy) CSS pixels; look: as a right-drag (the view turns about itself). */
function dragBy(this: CameraController, dx: number, dy: number, dtEv: number, lookDrag: boolean) {
  const s = this.s;
  // fling velocity: smoothed and capped (°/s)
  const smooth = (v: number, inst: number) => clamp(0.5 * inst + 0.5 * v, -120, 120);
  const kLook = s.fov / this.canvas.clientHeight; // degrees per CSS pixel
  const look = () => {
    this.rotateView(-dx * kLook, dy * kLook, 0);
    this.vYaw = smooth(this.vYaw, (-dx * kLook) / dtEv);
    this.vPitch = smooth(this.vPitch, (dy * kLook) / dtEv);
  };
  const ov = this.piloting && !this.cinematic ? this.outsideView() : null;
  const rigTurn = !ov && this.rig.on && (s.rotation === "orbit" || (s.rotation === "tripod" && s.lookAt)) && !lookDrag;
  if (rigTurn && s.rotation === "orbit") {
    // around a planet, a moon: the drag turns the camera about it
    this.rig.az -= dx * 0.25;
    this.rig.el = clamp(this.rig.el + dy * 0.25, -89, 89);
  } else if (rigTurn) {
    // on the tripod: the drag turns the view off the target
    this.rig.yawOff = wrapYaw(this.rig.yawOff - dx * kLook);
    this.rig.pitchOff = clamp(this.rig.pitchOff + dy * kLook, -85, 85);
  } else if (ov === "around") {
    // outside, around the ship: the drag turns the camera about it
    const o = this.outside;
    o.yaw = ((((o.yaw + dx * 0.3 + 180) % 360) + 360) % 360) - 180;
    o.pitch = clamp(o.pitch + dy * 0.3, -85, 85);
  } else if (ov === "free") {
    // outside, free: the drag turns the camera where it is (locked on the target: its offset from it)
    const o = this.outside;
    if (s.lookAt) this.lookOff = [this.lookOff[0] + dx * kLook, clamp(this.lookOff[1] + dy * kLook, -80, 80)];
    else {
      o.fyaw += dx * kLook;
      o.fpitch = clamp(o.fpitch + dy * kLook, -89, 89);
    }
  } else if (ov === "flyby") {
    // (the fly-by aims at the ship by itself)
  } else if (this.piloting && !this.cinematic) {
    // piloting: the drag turns the camera on its mount (free look; locked on the target: where the target
    // sits in the view); the ship keeps its attitude
    const lim = s.fov * 0.6;
    if (s.lookAt) this.lookOff = [clamp(this.lookOff[0] + dx * kLook, -lim, lim), clamp(this.lookOff[1] - dy * kLook, -lim, lim)];
    else this.setLook(s.shipLookYaw - dx * kLook, s.shipLookPitch + dy * kLook);
  } else if (s.rotation === "free") {
    // free: drag looks around, right / shift drag rolls
    if (lookDrag) this.rotateView(0, 0, -dx * 0.4);
    else look();
  } else if (lookDrag || !this.orbiting) {
    look(); // offset of the view from the target (or, falling freely, just look)
  } else {
    const k = 0.25 * Math.min(1, s.fov / 45);
    this.orbitBy(-dx * k, -dy * k);
    this.vAz = smooth(this.vAz, (-dx * k) / dtEv);
    this.vInc = smooth(this.vInc, (-dy * k) / dtEv);
  }
}

/** The wheel's step dy (pixels: > 0 away, out), or a pinch's — what it does depends on the mode. */
function zoomStep(this: CameraController, dy: number, alt: boolean) {
  this.activity = performance.now();
  this.flight = null;
  // (the telescope: the wheel is its zoom, in every mode)
  if (this.s.telescope) return this.zoomLens(Math.exp(dy * 0.0015));
  if (this.flyMode) {
    // flight speed, like a game's throttle
    this.flySpeed = clamp(this.flySpeed * Math.exp(-dy * 0.002), 0.05, 30);
    return;
  }
  if (!alt && this.rig.on && !this.piloting) {
    // the rig: around a body the wheel sets the distance (to its surface, logarithmically); else it
    // pushes the camera forwards / back
    if (this.s.rotation === "orbit") this.rig.alt = clamp(this.rig.alt * Math.exp(dy * 0.0015), 1e-12, 1e6);
    else this.rig.dolly -= dy * 0.004;
    return;
  }
  if (!alt && this.piloting && !this.cinematic && this.outsideView() === "around") {
    // outside, around the ship: the wheel sets the camera's distance (12 m … 20 km)
    this.outside.dist = clamp(this.outside.dist * Math.exp(dy * 0.0015), 12, 20000);
  } else if (alt || this.gravity || this.piloting) {
    this.zoomLens(Math.exp(dy * 0.001));
  } else if (this.s.rotation === "free" && !this.cinematic) {
    // dolly along the view, gliding (the flight's inertia)
    this.flyVel[0] = clamp(this.flyVel[0] - dy * 0.006 * this.flySpeed, -8 * this.flySpeed, 8 * this.flySpeed);
  } else {
    this.zoomBy(Math.exp(dy * 0.0015));
  }
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installRotation(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    setRotation,
    setLookAt,
    availableTargets,
    selectTarget,
    cycleTarget,
    pickAt,
    targetInfo,
    issSeen,
    issSurfaceDistance,
    pickIss,
    lockView,
    craftSurfaceDistance,
    nowTime,
    shipClock,
    aim,
    startFocus,
    frameTarget,
    clearDirection,
    stepFlight,
    ensureAnchor,
    toLocal: toLocalMethod,
    orbitBy,
    track,
    levelOnGround,
    followMin,
    followBody,
    baryRest,
    driftWithBarycentre,
    updateMotion,
    lens,
    rotateView,
    setCinematic,
    endDive,
    setFlyMode,
    setGravity,
    setHover,
    pinchSpan,
    pinchCentre,
    dragBy,
    zoomStep,
  });
}
