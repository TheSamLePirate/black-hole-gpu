import { planetFrame, toLocal } from "../landing";
import { properBodyAxes } from "../system/local-patch";
// The spectator: a free camera away from the ship — anywhere, to the planets, through the wormhole —
// while the ship flies on exactly as it was (its physics, its autopilots, its plan, the warp: the
// settings stay the ship's). A second, headless controller over its own settings (`view`): the main
// controller hands it the keys, the pointer and the pad, and keeps the view's other settings in step
// with the ship's (the time, the warp, the scene). The renderer draws `view`, the ship drawn in it where
// it is (shipFromView). Two ways: following the ship (by default: the camera carried with it, its keys
// moving it about the ship — slow near it, faster away), or free (the free camera's flight, carried by
// the nearest world: away to the planets).

import { CameraController } from "../controls";
import type { Settings } from "../settings";
import { cameraFrame, setHolePose, setHomePose } from "../camera";
import { M_METRES } from "../system/solar";
import type { Vec3 } from "../physics";
import type { M3 } from "../mounts";
import { shipToCamera } from "../mounts";
import { freeCameraKeys } from "../input/bindings";
import { sphericalFrame } from "../wormhole";
import { blendCurve, qFromAxes } from "../cine/follow";
import { cross3, type V3 } from "../cine/rig";
import { viewBlend } from "./camrig";
import { unitV } from "./util";

declare module "../controls" {
  interface CameraController {
    /** a spectator is out (the view is not the ship's) */
    readonly spectating: boolean;
    startSpectator: typeof startSpectator;
    stopSpectator: typeof stopSpectator;
    viewSettings: typeof viewSettings;
    viewController: typeof viewController;
    advanceSpectator: typeof advanceSpectator;
    shipFromView: typeof shipFromView;
    setSpectatorFollow: typeof setSpectatorFollow;
    followShip: typeof followShip;
  }
}

/** The settings that are the view's own (its place, its look, its lens, its target): the rest follows the ship's. */
const VIEW_KEYS = new Set<keyof Settings>([
  "anchor",
  "whL",
  "distance",
  "inclination",
  "azimuth",
  "yaw",
  "pitch",
  "roll",
  "velR",
  "velT",
  "velP",
  "motion",
  "rotation",
  "target",
  "lookAt",
  "telescope",
  "fov",
  "ship",
  "shipMount",
  "shipLookYaw",
  "shipLookPitch",
]);

/** Where the spectator starts: behind the ship and a little above it [m] (the view no jump: the ship ahead). */
const BACK_M = 38,
  UP_M = 9;

/** The camera leaves the ship (it flies on); false when it cannot (not flying it). */
function startSpectator(this: CameraController): boolean {
  if (this.spectator || !this.piloting || this.headless) return !!this.spectator;
  const view = structuredClone(this.s);
  Object.assign(view, { ship: false, rotation: "free", lookAt: false, telescope: false, motion: "static" } satisfies Partial<Settings>);
  const sp = new CameraController(this.canvas, view, () => {}, true);
  // (the scene's clock from the start: left NaN, its nowTime read 0 — the worlds where they were when the scene
  // began, a tripod set at once stood on the Earth of then, a million kilometres from the Earth drawn)
  sp.time = this.nowTime();
  // (where the view is — the eye on its attach point, looking as it looks: no cut —, then glided back behind the
  // ship and a little up)
  const w = sp.rigWorld();
  const eyeOff: Vec3 = [0, 0, 0];
  if (w) {
    const P = this.shipPose();
    const S = shipToCamera(P, this.s.shipLookYaw, this.s.shipLookPitch).S;
    const e = S.map((row) => row[0]! * P.eye[0] + row[1]! * P.eye[1] + row[2]! * P.eye[2]);
    for (let i = 0; i < 3; i++) eyeOff[i] = w.right[i]! * e[0]! + w.up[i]! * e[1]! + w.fwd[i]! * e[2]!;
    const k = 1 / M_METRES;
    const X = [0, 1, 2].map((i) => w.X[i]! + eyeOff[i]! * k) as Vec3;
    if (w.ours) setHomePose(view, X, w.fwd, w.up, [0, 0, 0]);
    else setHolePose(view, X, w.fwd, w.up, [0, 0, 0]);
  }
  sp.sync();
  this.spectator = sp;
  this.spectatorFollow = true;
  const back: Vec3 = [-BACK_M * (w?.fwd[0] ?? 0), -BACK_M * (w?.fwd[1] ?? 0), -BACK_M * (w?.fwd[2] ?? 0)];
  if (w) for (let i = 0; i < 3; i++) back[i]! += UP_M * w.up[i]!;
  this.specOff = [...eyeOff];
  this.specGlide = { from: [...eyeOff], to: back, t: 0, T: Math.max(0.6, viewBlend(this.s).time) };
  this.specVel = [0, 0, 0];
  return true;
}

/** Following the ship (carried with it) or free (away, carried by the nearest world). */
function setSpectatorFollow(this: CameraController, on: boolean) {
  const sp = this.spectator;
  if (!sp) return;
  this.spectatorFollow = on;
  this.specVel = [0, 0, 0];
  // (following again: from where the view is, its offset from the ship kept)
  if (on) {
    const a = this.rigWorld(),
      b = sp.rigWorld();
    if (a && b && a.ours === b.ours) this.specOff = [0, 1, 2].map((i) => (b.X[i]! - a.X[i]!) * M_METRES) as Vec3;
    else this.spectatorFollow = false;
  } else sp.sync();
}

/** Back to the ship (its view as it was) — carried from where the spectator was, blended onto it. */
function stopSpectator(this: CameraController) {
  const sp = this.spectator;
  if (!sp) return;
  const cam = cameraFrame(this.s);
  const nav = this.ourNav(cam);
  const w = sp.rigWorld();
  this.spectator = null;
  this.specGlide = null;
  if (!nav || !w || !w.ours) return;
  const up = unitV(nav.toRep(w.up)) as V3,
    fwd = unitV(nav.toRep(w.fwd)) as V3;
  const p = nav.toRep(w.X).map((x) => x * M_METRES) as V3;
  this.carryCommit({ q: qFromAxes(cross3(up, fwd), up, fwd), p }, Math.max(0.8, viewBlend(this.s).time));
}

/** The settings the renderer draws: the spectator's, or the ship's. */
function viewSettings(this: CameraController): Settings {
  // On foot, a paused/frozen scene still applies material and quality edits without advancing physics.
  if (this.character.active && this.spectator) {
    const v = this.spectator.s as unknown as Record<string, unknown>;
    const s = this.s as unknown as Record<string, unknown>;
    for (const k of Object.keys(s)) if (!VIEW_KEYS.has(k as keyof Settings) && v[k] !== s[k]) v[k] = s[k];
  }
  return this.spectator?.s ?? this.s;
}
/** The controller of the view: the spectator's, or this one. */
function viewController(this: CameraController): CameraController {
  return this.spectator ?? this;
}

/**
 * The spectator's frame (after the ship's): the view's other settings kept to the ship's (the time, the
 * warp, the scene's), the input handed over; true when the view moved.
 */
function advanceSpectator(this: CameraController, dt: number, time: number | undefined, pad: CameraController["padFrame"]): boolean {
  const sp = this.spectator;
  if (!sp) return false;
  const v = sp.s as unknown as Record<string, unknown>,
    s = this.s as unknown as Record<string, unknown>;
  for (const k of Object.keys(s)) if (!VIEW_KEYS.has(k as keyof Settings) && v[k] !== s[k]) v[k] = s[k];
  sp.keys = this.keys;
  sp.codes = this.codes;
  // (the flight speed's setting — the camera panel's, the wheel's in mouse-look — and the mouse-look itself:
  // the page's controller's, the spectator's too)
  sp.flySpeed = this.flySpeed;
  sp.flyMode = this.flyMode;
  sp.enabled = this.enabled;
  sp.padFrame = pad ?? null;
  // (the scene's time, also while it follows the ship and its own update is not run: its clock left NaN, nowTime
  // read 0 — the bodies where they were at the scene's start: no ground under a tripod, no sky's events)
  if (time !== undefined) sp.time = time;
  // (its frame drawn at the ship's clock — the scene's follows it, behind the warp asked when the ship's steps run
  // short —: the tripod placed for that instant, not for now + dt × the warp)
  sp.frameEnd = this.shipClock() ?? Number.NaN;
  const at = this.shipFromView();
  sp.nearShip = at ? at.dist / M_METRES : Infinity;
  if (this.spectatorFollow && this.followShip(sp, dt, pad)) return true;
  return sp.update(dt, time);
}

/**
 * Following: the view carried with the ship — its offset from it [m, world axes] moved by the keys at
 * 0.8 of the distance a second (2 m/s at least; Shift × 3), turned by the drag, the arrows, the pad —, its
 * velocity the ship's. False when it cannot (across the throat): free then.
 */
function followShip(this: CameraController, sp: CameraController, dt: number, pad: CameraController["padFrame"]): boolean {
  const a = this.rigWorld(),
    b = sp.rigWorld();
  if (!a || !b || a.ours !== b.ours) {
    this.spectatorFollow = false;
    sp.sync();
    return false;
  }
  // (a walk just left: the offset from where its view stood, at the ship's own time now)
  if (this.specRebase) {
    const X = this.specRebase(this.nowTime());
    this.specRebase = null;
    this.specOff = [0, 1, 2].map((i) => (X[i]! - a.X[i]!) * M_METRES) as Vec3;
  }
  const move = [0, 0, 0, 0];
  const keys = freeCameraKeys();
  for (const c of this.codes) {
    const m = keys[c];
    if (m) for (let i = 0; i < 4; i++) move[i]! += m[i]!;
  }
  if (pad) for (let i = 0; i < 4; i++) move[i] = Math.max(-1, Math.min(1, move[i]! + pad.move[i]!));
  const fast = this.codes.has("ShiftLeft") || this.codes.has("ShiftRight") || !!pad?.fast;
  // (out of the ship: from its eye back behind it, eased — the keys wait for it)
  const G = this.specGlide;
  if (G) {
    G.t = Math.min(1, G.t + dt / G.T);
    const k = blendCurve(viewBlend(this.s).style === "cut" ? "easeInOut" : viewBlend(this.s).style, G.t);
    // (arched over the hull: lifted along the view's up on the way — not through the cabin's roof first)
    const b0 = sp.rigWorld();
    const lift = Math.sin(Math.PI * k) * UP_M * 0.8;
    this.specOff = [0, 1, 2].map((i) => G.from[i]! + (G.to[i]! - G.from[i]!) * k + (b0?.up[i] ?? 0) * lift) as Vec3;
    for (let i = 0; i < 4; i++) move[i] = 0;
    if (G.t >= 1) this.specGlide = null;
  }
  const d = Math.hypot(...this.specOff);
  // (a share of its distance from the ship already: the boost no more than × 4)
  const v = Math.max(0.8 * d, 2) * sp.flySpeed * (fast ? 3 : 1) * Math.min(this.boostNow(), 4);
  const want = [0, 1, 2].map((i) => (b.fwd[i]! * move[0]! + b.right[i]! * move[1]! + b.up[i]! * move[2]!) * v);
  const ease = 1 - Math.exp(-dt / 0.12);
  for (let i = 0; i < 3; i++) {
    this.specVel[i]! += (want[i]! - this.specVel[i]!) * ease;
    this.specOff[i]! += this.specVel[i]! * dt;
  }
  // (not into the hull: four metres from the ship's centre at least)
  const dn = Math.hypot(...this.specOff);
  if (dn < 4) for (let i = 0; i < 3; i++) this.specOff[i]! *= 4 / Math.max(dn, 1e-6);
  // turning: the arrows, the right stick, the roll keys (the drag turns it directly)
  const kx = (this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("ArrowLeft") ? 1 : 0);
  const ky = (this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("ArrowDown") ? 1 : 0);
  const turn = 60 * dt * Math.min(1, sp.s.fov / 60);
  if (kx || ky || move[3]) sp.rotateView(kx * turn, ky * turn, move[3]! * 70 * dt);
  if (pad && (pad.look[0] || pad.look[1])) sp.rotateView(pad.look[0] * 110 * dt, pad.look[1] * 110 * dt, 0);
  // the view's place: the ship's and the offset, on the view's axes as turned, moving with the ship
  const c = sp.rigWorld() ?? b;
  const X = [0, 1, 2].map((i) => a.X[i]! + this.specOff[i]! / M_METRES) as Vec3;
  if (a.ours) setHomePose(sp.s, X, c.fwd, c.up, this.activePoseNow()?.V ?? [0, 0, 0]);
  else {
    // (the ship's velocity on the ZAMO's axes, as a Cartesian vector at its place — near enough the view's)
    const f = sphericalFrame(a.X);
    const s = this.s;
    const beta = [0, 1, 2].map((i) => f.er[i]! * s.velR + f.et[i]! * s.velT + f.ep[i]! * s.velP) as Vec3;
    setHolePose(sp.s, X, c.fwd, c.up, beta);
  }
  sp.sync();
  return true;
}

/**
 * The ship seen from the spectator: its axes in the view camera's (rows: the camera's axes in the ship's
 * frame, as shipToCamera) and its origin there [m], its distance [m]; null in another region (across
 * the throat) or universe.
 */
function shipFromView(this: CameraController): { S: M3; t: Vec3; dist: number } | null {
  const sp = this.spectator;
  if (!sp) return null;
  const a = this.rigWorld(),
    b = sp.rigWorld();
  if (!a || !b || a.ours !== b.ours) return null;
  // (the ship's axes in the world: the main camera's axes through the mount — shipToCamera's S has the
  // camera's axes in the ship's frame as rows)
  const C = shipToCamera(this.shipPose(), this.s.shipLookYaw, this.s.shipLookPitch).S;
  const camW = [a.right, a.up, a.fwd];
  const shipAxis = (i: number) => [0, 1, 2].map((j) => C[0][i]! * camW[0]![j]! + C[1][i]! * camW[1]![j]! + C[2][i]! * camW[2]![j]!) as Vec3;
  const ax = [shipAxis(0), shipAxis(1), shipAxis(2)];
  const viewW = [b.right, b.up, b.fwd];
  const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const S = viewW.map((c) => [dot(c, ax[0]!), dot(c, ax[1]!), dot(c, ax[2]!)]) as M3;
  if (!a.ours && this.character.active && !this.character.ours) {
    const F = planetFrame(this.character.body, this.nowTime(), this.s.spin, this.s.massSolar);
    const ship = toLocal(F, a.X, [0, 0, 0]).xi,
      eye = toLocal(F, b.X, [0, 0, 0]).xi;
    const delta = ship.map((x, i) => (x - eye[i]!) * F.mPerM) as Vec3;
    const cam = cameraFrame(sp.s),
      axes = properBodyAxes(F, cam);
    const z = [0, 1, 2].map((i) => axes.reduce((sum, axis, j) => sum + axis[i]! * delta[j]!, 0)) as Vec3;
    return { S, t: [dot(z, cam.right), dot(z, cam.up), dot(z, cam.fwd)], dist: Math.hypot(...delta) };
  }
  const d = [0, 1, 2].map((i) => (a.X[i]! - b.X[i]!) * M_METRES) as Vec3;
  const t = viewW.map((c) => dot(c, d)) as Vec3;
  return { S, t, dist: Math.hypot(...d) };
}

export function installSpectator(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    startSpectator,
    stopSpectator,
    viewSettings,
    viewController,
    advanceSpectator,
    shipFromView,
    setSpectatorFollow,
    followShip,
  });
  Object.defineProperty(C.prototype, "spectating", {
    get(this: CameraController) {
      return !!this.spectator;
    },
  });
}
