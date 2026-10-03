// The CameraController — the lens and the telescope.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { horizon } from "../physics";
import type { Settings } from "../settings";
import { bodyDistance } from "../targeting";
import { mouth } from "../wormhole";

import type { CameraController } from "../controls";
import { FLIGHT_KEYS, TELE_MIN, clamp } from "./util";

declare module "../controls" {
  interface CameraController {
    zoomLens: typeof zoomLens;
    setFov: typeof setFov;
    stopZoom: typeof stopZoom;
    easeLens: typeof easeLens;
    setTelescope: typeof setTelescope;
    zoomBy: typeof zoomBy;
    update: typeof update;
    step: typeof step;
    advance: typeof advanceMethod;
    inThroat: typeof inThroat;
    easeZoom: typeof easeZoom;
    poseKey: typeof poseKey;
    changedSince: typeof changedSince;
    lMin: typeof lMin;
    poseAllowed: typeof poseAllowed;
  }
}

/** Zooms the lens by a factor of its field (eased): 1°…150°, the telescope down to 0.02°. */
function zoomLens(this: CameraController, f: number) {
  const s = this.s;
  const [lo, hi] = s.telescope ? [TELE_MIN, 20] : [Math.min(1, s.fov), 150];
  this.fovTarget = clamp((this.fovTarget ?? s.fov) * f, lo, hi);
  this.activity = performance.now();
}

/** Sets the field of view, eased (the panel's own changes land at once: stopZoom). */
function setFov(this: CameraController, fov: number) {
  this.fovTarget = clamp(fov, TELE_MIN, 150);
}

function stopZoom(this: CameraController) {
  this.fovTarget = null;
}

function easeLens(this: CameraController, dt: number) {
  const s = this.s;
  if (this.fovTarget === null) return;
  const cur = Math.log(s.fov),
    tgt = Math.log(this.fovTarget);
  if (Math.abs(tgt - cur) < 2e-4) {
    s.fov = this.fovTarget;
    this.fovTarget = null;
  } else s.fov = Math.exp(cur + (tgt - cur) * (1 - Math.exp(-12 * dt)));
}

/**
 * The telescope: a long lens (fields down to 0.02° — a 70 m focal length on a 35 mm frame), the view
 * held on the target (the tracking a telescope's mount does: it stays centred while everything
 * moves), a reticle with the angular scale. On: the target framed at a third of the view; off: the
 * field and the lock as they were.
 */
function setTelescope(this: CameraController, on: boolean) {
  const s = this.s;
  if (s.telescope === on) return;
  s.telescope = on;
  if (on) {
    this.teleSaved = { fov: this.fovTarget ?? s.fov, lookAt: s.lookAt };
    if (!s.lookAt) this.setLookAt(true);
    const info = this.targetInfo();
    const want = info && info.ang > 0 ? ((info.ang * 360) / Math.PI) * 3 : s.fov / 8;
    this.fovTarget = clamp(want, TELE_MIN, Math.min(20, s.fov));
  } else {
    const sv = this.teleSaved;
    this.fovTarget = clamp(sv ? sv.fov : Math.max(s.fov, 40), 1, 150);
    if (sv && !sv.lookAt) this.setLookAt(false);
    this.teleSaved = null;
  }
  this.activity = performance.now();
  this.onCinematicChange(this.cinematic);
}

function zoomBy(this: CameraController, f: number) {
  if (this.cinematic === "dive" || this.cinematic === "journey") return;
  if (this.orbiting && (this.s.target === "star" || this.s.target === "barycentre")) {
    const s = this.s;
    const dMin = this.followMin();
    const d = this.followD ?? bodyDistance(s, cameraFrame(s), s.target, this.nowTime());
    this.followD = clamp(dMin + (d - dMin) * f, dMin, 2000);
    return;
  }
  if (this.aroundWormhole) {
    // distance to the throat |ℓ| (never through it: fly to cross)
    const lMin = this.lMin();
    const sign = this.targetL < 0 ? -1 : 1;
    this.targetL = sign * clamp(lMin + (Math.abs(this.targetL) - lMin) * f, lMin, 2000);
    return;
  }
  const rMin = horizon(this.s.spin) + 0.05;
  this.targetDistance = clamp(rMin + (this.targetDistance - rMin) * f, rMin, 1000);
}

/**
 * Advances momentum, keyboard, cinematics and the rotation mode; `time` is the scene's time (the
 * star moves). Returns true when the camera changed.
 */
function update(this: CameraController, dt: number, time?: number): boolean {
  if (!this.enabled) return false;
  this.syncLook();
  try {
    return this.step(dt, time);
  } finally {
    this.markLook();
  }
}

function step(this: CameraController, dt: number, time?: number): boolean {
  if (!this.scripted) return this.advance(dt, time);
  // (a video steps the scene: the keys held, the controller's sticks do not reach it)
  const keys = this.keys,
    codes = this.codes;
  this.keys = new Set();
  this.codes = new Set();
  try {
    return this.advance(dt, time);
  } finally {
    this.keys = keys;
    this.codes = codes;
  }
}

function advanceMethod(this: CameraController, dt: number, time?: number): boolean {
  const s = this.s;
  // (the flight's sub-steps budgeted per second of the frame, not per frame: at 30 fps twice a 60 fps
  // frame's — the time warp the same whatever the frame rate; 0.1 s at most, a hitch not caught up)
  this.subCap = Math.round(400 * Math.min(Math.max(dt * 60, 1), 6));
  this.prevTime = Number.isFinite(this.time) ? this.time : (time ?? 0);
  if (time !== undefined) this.time = time;
  this.shipTime = NaN;
  const before = this.poseKey();
  const dragging = this.pointers.size > 0;
  const pad = this.scripted ? null : this.pad.poll();
  if (pad?.active) this.activity = performance.now();
  if (pad) for (const a of pad.actions) this.onPadAction?.(a);

  if (s.ship !== this.piloting) this.setPilot(s.ship);
  if (s.shipMount !== this.lastMount) this.lookOff = [0, 0];
  this.aimShipViews(dt);
  if (this.piloting && !this.cinematic && this.outsideView() === "flyby") {
    if (s.shipMount !== this.lastMount) this.flyby.E = null; // (a new fly-by: from where the view is)
    this.flybyStep(dt);
  }
  this.stepMount(dt);
  const pilotNow = this.piloting && this.cinematic !== "dive" && this.cinematic !== "journey";

  // the target must be in the camera's universe; orbiting uses the target's anchor
  const avail = this.availableTargets();
  if (!avail.includes(s.target)) {
    s.target = avail.includes("hole") ? "hole" : "wormhole";
    this.aimCache = null;
    this.followD = null;
  }
  // flying with the keys (or still gliding): the flight carries the view — no re-anchoring, no
  // aiming — so the camera can go anywhere, e.g. straight through the wormhole
  const flightKeys = [...this.codes].some((c) => (FLIGHT_KEYS[c]?.slice(0, 3) ?? []).some((v) => v !== 0));
  const padFlight = !!pad && (pad.move[0] !== 0 || pad.move[1] !== 0 || pad.move[2] !== 0);
  const flying = !this.gravity && (flightKeys || padFlight || Math.hypot(...this.flyVel) > 1e-3 * this.flySpeed);
  if (this.orbiting && !dragging && !flying) this.ensureAnchor();

  // keyboard (held keys): arrows orbit, or turn the camera (free rotation, flight)
  const kRate = 60 * dt;
  const kx = (this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("ArrowLeft") ? 1 : 0);
  const ky = (this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("ArrowDown") ? 1 : 0);
  if (kx || ky || this.codes.size) this.activity = performance.now();
  if ((kx || ky) && !pilotNow) {
    if (this.orbiting) this.orbitBy(-kx * kRate, -ky * kRate);
    else this.rotateView(kx * kRate, ky * kRate, 0);
  }
  // (about the cabin the keys walk, the throttle is off: the arrows turn the look — 90°/s, 70°/s)
  if ((kx || ky) && pilotNow && s.shipMount === "cabin" && !s.lookAt)
    this.setLook(s.shipLookYaw + kx * 90 * dt, s.shipLookPitch + ky * 70 * dt);
  if (pad && (pad.look[0] || pad.look[1])) {
    // right stick: orbit the target, or turn the camera (free rotation, flight); piloting: look
    if (pilotNow) this.setLook(s.shipLookYaw + pad.look[0] * 90 * dt, s.shipLookPitch + pad.look[1] * 70 * dt);
    else if (this.orbiting) this.orbitBy(-pad.look[0] * 75 * dt, -pad.look[1] * 75 * dt);
    else {
      const k = 110 * dt * Math.min(1, this.s.fov / 60);
      this.rotateView(pad.look[0] * k, pad.look[1] * k, 0);
    }
  }
  // (+ − and the pad's zoom: the distance — the lens with the telescope)
  const zoom = (f: number) => (s.telescope ? this.zoomLens(f) : this.zoomBy(f));
  if (pad?.zoom) zoom(Math.exp(-1.4 * pad.zoom * dt));
  if (this.keys.has("+") || this.keys.has("=")) zoom(Math.exp(-1.2 * dt));
  if (this.keys.has("-") || this.keys.has("_")) zoom(Math.exp(1.2 * dt));
  this.easeLens(dt);
  const move: [number, number, number, number] = [0, 0, 0, 0];
  for (const c of this.codes) {
    const m = FLIGHT_KEYS[c];
    if (m) for (let i = 0; i < 4; i++) move[i]! += m[i]!;
  }
  if (pad) for (let i = 0; i < 4; i++) move[i] = clamp(move[i]! + pad.move[i]!, -1, 1);
  const fast = this.codes.has("ShiftLeft") || this.codes.has("ShiftRight") || !!pad?.fast;
  const free = this.cinematic !== "dive" && this.cinematic !== "journey";
  if (move.some((x) => x !== 0) && this.cinematic === "orbit") this.setCinematic(null);
  if (move[3] && free && !pilotNow) this.rotateView(0, 0, move[3] * 70 * dt);
  // moving the camera (flight, free fall) re-expresses its orientation: not a turn by the user,
  // so the tracking keeps its offset from the target
  const tracked = [s.yaw, s.pitch, s.roll].join() === this.written;
  this.rig.on = false; // (set again below while the rig moves the camera)
  if (pilotNow) {
    if (this.outsideView() === "free") this.moveOutside(dt, move, fast);
    else if (s.shipMount === "cabin") this.moveCabin(dt, move, fast);
    this.flyShip(dt, pad);
    this.flyVel = [0, 0, 0];
  } else if (!this.gravity && free && this.rigStep(dt, move, fast)) {
    // the rig moves the camera (around a body, following it, carried by it, on a tripod)
    this.flyVel = [0, 0, 0];
  } else if (this.gravity && free) {
    // free fall along the Kerr geodesic in step with the scene's time; the keys thrust
    const simDt = s.animate ? s.timeSpeed * dt : 0;
    if (simDt > 0) this.fall(simDt, [move[0], move[1], move[2]], fast);
    this.flyVel = [0, 0, 0];
  } else if (free) {
    // kinematic flight with inertia: the velocity eases towards the keys' target (~0.12 s)
    const target = (fast ? 3 : 0.8) * this.flySpeed;
    const ease = 1 - Math.exp(-dt / 0.12);
    for (let i = 0; i < 3; i++) this.flyVel[i]! += (move[i]! * target - this.flyVel[i]!) * ease;
    if (Math.hypot(...this.flyVel) > 1e-3 * this.flySpeed) this.fly(this.flyVel, dt);
    else this.flyVel = [0, 0, 0];
  }
  if (tracked) this.written = [s.yaw, s.pitch, s.roll].join();
  // (the rig idle this frame: it starts afresh from where the camera is when it takes over again)
  if (!this.rig.on) this.rig.key = "";
  // a rumble when the camera goes through the wormhole's throat
  const side = s.wormhole && s.anchor === "wormhole" ? Math.sign(s.whL) : 0;
  if (side && this.lastSide && side !== this.lastSide) this.pad.rumble(0.6, 0.9, 220);
  this.lastSide = side;

  // momentum (exponential damping)
  if (!dragging) {
    const damp = Math.exp(-4 * dt);
    if (this.vAz || this.vInc) this.orbitBy(this.vAz * dt, this.vInc * dt);
    if (this.vYaw || this.vPitch) this.rotateView(this.vYaw * dt, this.vPitch * dt, 0);
    this.vAz *= damp;
    this.vInc *= damp;
    this.vYaw *= damp;
    this.vPitch *= damp;
    for (const k of ["vAz", "vInc", "vYaw", "vPitch"] as const) if (Math.abs(this[k]) < 0.05) this[k] = 0;
  }

  if (this.leveling) {
    s.roll *= Math.exp(-12 * dt);
    if (Math.abs(s.roll) < 0.02) (s.roll = 0), (this.leveling = false);
  }

  // (the cinematics run with the scene's time: paused, they hold — the image converges)
  const play = s.animate || this.bulletTime ? dt : 0;
  if (this.cinematic === "orbit") {
    // (around a planet, a moon: the rig's azimuth — the classic orbit is the hole's, the star's, the mouth's)
    if (play && this.rig.on && this.rigOrbits()) this.rig.az += s.cinematicSpeed * play;
    else if (play) this.orbitBy(s.cinematicSpeed * play, 0);
  } else if (this.cinematic === "dive") {
    if (play) this.stepDive(play);
  } else if (this.cinematic === "journey") {
    if (play) this.stepJourney(play);
  }
  if (
    this.flight &&
    !(this.orbiting && s.target === this.flight.body && s.anchor === (this.flight.body === "wormhole" ? "wormhole" : "hole"))
  ) {
    this.flight = null;
  }
  if (this.cinematic !== "dive" && this.cinematic !== "journey") {
    if (this.flight) this.stepFlight(dt);
    else if (this.orbiting && (s.target === "star" || s.target === "barycentre")) this.followBody(dt);
    else this.easeZoom(dt);
  }
  if (this.baryRest() && s.rotation === "free" && !this.rig.on) this.driftWithBarycentre();
  this.updateMotion(dt);
  if (this.tracking && !flying && !this.inThroat()) this.track(dt);
  // (tracking resumes from the orientation the flight left: offset recomputed, no jump)
  else this.offset = null;
  return this.changedSince(before);
}

/** Inside the wormhole's throat (|ℓ| < a + 1.5 ρ): "aiming at the wormhole" means nothing there. */
function inThroat(this: CameraController) {
  const s = this.s;
  if (!s.wormhole) return false;
  const cam = cameraFrame(s);
  const w = mouth(s).w;
  return cam.region === "throat" && Math.abs(cam.ell) < w.a + 1.5 * w.rho;
}

/** Smooth wheel zoom towards the target distance (in log space): to the hole, or |ℓ| to the throat. */
function easeZoom(this: CameraController, dt: number) {
  const s = this.s;
  if (this.gravity) return;
  if (this.aroundWormhole) {
    // on the camera's side of the throat
    if (Math.sign(this.targetL) !== Math.sign(s.whL)) this.targetL = s.whL;
    if (Math.abs(this.targetL - s.whL) < 1e-9) return; // (also inside the throat)
    const lMin = this.lMin();
    const sign = s.whL < 0 ? -1 : 1;
    const cur = Math.log(Math.max(Math.abs(s.whL) - lMin, 0) + 1e-3);
    const tgt = Math.log(Math.max(Math.abs(this.targetL) - lMin, 0) + 1e-3);
    const next = cur + (tgt - cur) * (1 - Math.exp(-10 * dt));
    const l = Math.abs(tgt - cur) < 1e-4 ? this.targetL : sign * (lMin + Math.exp(next) - 1e-3);
    if (this.poseAllowed({ ...s, whL: l })) s.whL = l;
    else this.targetL = s.whL;
    return;
  }
  const rMin = horizon(s.spin) + 0.05;
  if (s.distance < rMin) s.distance = rMin;
  const cur = Math.log(s.distance - rMin + 1e-3);
  const tgt = Math.log(Math.max(this.targetDistance, rMin) - rMin + 1e-3);
  const next = cur + (tgt - cur) * (1 - Math.exp(-10 * dt));
  s.distance = Math.abs(tgt - cur) < 1e-4 ? this.targetDistance : rMin + Math.exp(next) - 1e-3;
}

function poseKey(this: CameraController) {
  const s = this.s;
  return [s.azimuth, s.inclination, s.yaw, s.pitch, s.roll, s.distance, s.fov, s.whL, s.anchor, s.motion, s.velP].join();
}

function changedSince(this: CameraController, before: string) {
  return before !== this.poseKey();
}

/** Closest approach of the wheel zoom to the throat. */
function lMin(this: CameraController) {
  const w = mouth(this.s).w;
  return w.a + 0.3 * w.rho;
}

/** A pose is allowed unless it puts the camera inside the hole's horizon region. */
function poseAllowed(this: CameraController, s: Settings) {
  const cam = cameraFrame(s);
  return cam.region === "throat" || cam.r > horizon(s.spin) + 0.3;
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installLens(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    zoomLens,
    setFov,
    stopZoom,
    easeLens,
    setTelescope,
    zoomBy,
    update,
    step,
    advance: advanceMethod,
    inThroat,
    easeZoom,
    poseKey,
    changedSince,
    lMin,
    poseAllowed,
  });
}
