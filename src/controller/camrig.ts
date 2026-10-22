// The CameraController — the camera rig (Cinemachine's, cine/follow.ts) on the craft's hull views: the chase and
// the dorsal views (or every outside attach point on the hull: settings.camSoft) follow the craft through a
// damped frame — its jolts smoothed, its steady turns (the Endurance's spin) followed without lag —, left behind
// a little by its accelerations, the aim led along the motion, the composer's offset, the dutch, the noise and
// the impulses (a touchdown, a boom, the latches), the lens widened with the speed. The craft keeps its attitude:
// the view's pose changes in the craft's frame and stepMount's reorient turns the camera, not the craft.
// The lens: taken by a view that sets its own field (the director's shots, the speed's widening) — the player's
// field kept aside and given back, eased, when no view sets it.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { basis, cameraFrame } from "../camera";
import {
  type Binding,
  type BlendStyle,
  blendCurve,
  type FollowOptions,
  type NoiseProfile,
  type Q,
  qConj,
  qExp,
  qFromAxes,
  qLog,
  qMul,
  qRot,
} from "../cine/follow";
import { cross3, damp, len3, scale3, sub3 as vsub, type V3 } from "../cine/rig";
import { fleet } from "../fleet";
import { lin, sub as sub3 } from "../math/vec3";
import { shipToCamera, type MountPose } from "../mounts";
import type { Vec3 } from "../physics";
import { gearHeight, groundVelocity, solidBody } from "../system/our-surface";
import { solarBody } from "../system/solar";
import { C_MPS, M_METRES } from "../units";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";
import { clamp } from "./util";

declare module "../controls" {
  interface CameraController {
    softMount: typeof softMount;
    camRigStep: typeof camRigStep;
    shakePose: typeof shakePose;
    followOptions: typeof followOptions;
    lensBaseNow: typeof lensBaseNow;
    lensApply: typeof lensApply;
    camImpulse: typeof camImpulse;
    flowVelocity: typeof flowVelocity;
    viewWorld: typeof viewWorld;
    carryCommit: typeof carryCommit;
    applyCarry: typeof applyCarry;
    shipQ: typeof shipQ;
  }
}

/** The camera where it is in the world: its orientation (local axes), its place [m, local] (null: not known). */
export interface ViewWorld {
  q: Q;
  p: V3 | null;
}

/** The craft's orientation on the local axes (its left, up, nose), the camera's pose on it now. */
function shipQ(this: CameraController): Q {
  const s = this.s;
  const ax = this.shipAxesLocal(basis(s.yaw, s.pitch, s.roll)) as [V3, V3, V3];
  return qFromAxes(ax[0], ax[1], ax[2]);
}

/** The camera in the world now (a teleport about to happen: where the view was). */
function viewWorld(this: CameraController): ViewWorld {
  const s = this.s;
  const b = basis(s.yaw, s.pitch, s.roll);
  const q = qFromAxes(cross3(b.up as V3, b.fwd as V3), b.up as V3, b.fwd as V3);
  const cam = cameraFrame(s);
  const nav = this.local ? null : this.ourNav(cam);
  const me = nav ? this.activePoseNow() : null;
  if (!nav || !me) return { q, p: null };
  // (the craft's place [m] on the local axes, the eye on its hull added)
  const X = scale3(nav.toRep(me.X as Vec3) as V3, M_METRES);
  const eye = this.shipPose().eye;
  return { q, p: [...qRot(this.shipQ(), eye as V3)].map((x, i) => x + X[i]!) as V3 };
}

/**
 * After a teleport (a vessel switched, the docking's latches): the view carried from where it was — the camera
 * kept where it was and blended to its new place over the blend's time, at once this frame (no frame drawn
 * with the jump).
 */
function carryCommit(this: CameraController, before: ViewWorld, time?: number) {
  const s = this.s;
  const after = this.viewWorld();
  const dq = qMul(before.q, qConj(after.q));
  const dp = before.p && after.p ? vsub(before.p, after.p) : ([0, 0, 0] as V3);
  if (len3(qLog(dq)) < 0.003 && len3(dp) < 0.05) return;
  // (a jump of more than 50 km: not carried — another world)
  if (len3(dp) > 5e4) return;
  const B = viewBlend(s);
  this.viewCarry = { dq, dp, t: 0, T: time ?? Math.max(0.4, B.time), style: B.style === "cut" ? "easeInOut" : B.style };
  const S1 = this.shipMatrix();
  const P = this.applyCarry(this.shipPose(), 0);
  this.mountEff = P;
  this.reorient(S1, shipToCamera(P, s.shipLookYaw, s.shipLookPitch).S);
  this.lastPose = P;
}

/** The carry's share now applied to a view's pose (ship frame), its time advanced by dt. */
function applyCarry(this: CameraController, pose: MountPose, dt: number): MountPose {
  const C = this.viewCarry;
  if (!C) return pose;
  C.t += dt / C.T;
  if (C.t >= 1) {
    this.viewCarry = null;
    return pose;
  }
  const w = 1 - blendCurve(C.style as BlendStyle, C.t);
  const qs = this.shipQ();
  // (the world's turn back to the old view, its share now, on the craft's axes; about the eye)
  const dqs = qMul(qMul(qConj(qs), qExp(scale3(qLog(C.dq), w))), qs);
  const eye = [...pose.eye] as V3;
  const up = (pose.up ?? upOf(pose)) as V3;
  const aim = vsub(pose.aim as V3, eye);
  const shift = qRot(qConj(qs), scale3(C.dp, w));
  const e2 = [eye[0] + shift[0], eye[1] + shift[1], eye[2] + shift[2]] as Vec3;
  const a2 = qRot(dqs, aim);
  return { eye: e2, aim: [e2[0] + a2[0], e2[1] + a2[1], e2[2] + a2[2]], up: qRot(dqs, up) as Vec3 };
}

/** A pose's up as shipToCamera takes it (its own, else the craft's — along the craft's up: its z). */
export function upOf(p: MountPose): Vec3 {
  if (p.up) return p.up;
  const f = vsub(p.aim as V3, p.eye as V3);
  const l = len3(f) || 1;
  const fw = scale3(f, 1 / l);
  const ref: V3 = Math.abs(fw[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
  const r = cross3(fw, ref);
  const rl = len3(r) || 1;
  return cross3(scale3(r, 1 / rl), fw) as Vec3;
}

/** The hull views softened by each setting. */
export const SOFT_MOUNTS: Record<string, string[]> = {
  off: [],
  chase: ["chase", "dorsal"],
  hull: ["chase", "dorsal", "quarter", "wing", "belly", "rear"],
};

/** Whether the view now is a softened hull view. */
function softMount(this: CameraController): boolean {
  const s = this.s;
  return !!s.ship && !this.cinematic && (SOFT_MOUNTS[s.camSoft ?? "chase"] ?? []).includes(s.shipMount);
}

/** The rig's options, the settings'. */
function followOptions(this: CameraController): FollowOptions {
  const s = this.s;
  return {
    binding: (s.camBinding ?? "lockToTarget") as Binding,
    rotDamp: [s.camDampPitch ?? 0.25, s.camDampYaw ?? 0.25, s.camDampRoll ?? 0.35],
    posDamp: s.camDampPos ?? 0.3,
    lookahead: s.camLookahead ?? 0.1,
    screen: [s.camScreenX ?? 0, s.camScreenY ?? 0],
    dutch: s.camDutch ?? 0,
    noise: (s.camNoise ?? "none") as NoiseProfile,
    noiseAmp: s.camNoiseAmp ?? 1,
    noiseFreq: s.camNoiseFreq ?? 1,
    impulse: s.camImpulse ?? 1,
  };
}

/** The craft's velocity [m/s, local]: over the ground near a world (its turn carried), else in the frame flown in. */
function flowVelocity(this: CameraController): Vec3 {
  const cam = cameraFrame(this.s);
  const nav = this.local ? null : this.ourNav(cam);
  if (nav && nav.ref !== "sun" && solarBody(nav.ref) && solidBody(nav.ref) && gearHeight(nav.ref, nav.X, nav.t) < 150e3)
    return lin(nav.toRep(sub3(nav.V, groundVelocity(nav.ref, nav.X, nav.t))), C_MPS, cam.beta, 0);
  return lin(sub3(cam.beta, this.refBeta(cam)), C_MPS, cam.beta, 0);
}

/** A jolt of the camera (the haptics' impulses: a wheel, a boom, the latches…), strength 0 … 1. */
function camImpulse(this: CameraController, k: number, decay = 0.5, freq = 9) {
  this.camFollow.impulses.add(k, this.camClock, decay, freq);
  this.cine.impulse(k, decay, freq);
}

/**
 * A frame of the hull view's rig: its attach point (ship frame) softened; the speed's widening asked of the lens.
 * The view not softened: as it is (its state reset — the next softened view starts on its attach point).
 */
function camRigStep(this: CameraController, to: MountPose, dt: number): MountPose {
  const s = this.s;
  const live = s.animate ? dt : 0;
  this.camClock += live;
  if (!this.softMount()) {
    this.camFollow.reset();
    this.camKick = 1;
    return to;
  }
  const cam = cameraFrame(s);
  const b = basis(s.yaw, s.pitch, s.roll);
  // (the craft's axes as the camera has them now — the pose drawn last —, on the local axes)
  const ax = this.shipAxesLocal(b, this.drawnMatrix()) as [V3, V3, V3];
  const q = qFromAxes(ax[0], ax[1], ax[2]);
  const V = VESSELS[fleet.active];
  const centre = lin(lin(ax[0], V.centre[0], ax[1], V.centre[1]), 1, ax[2], V.centre[2]) as V3;
  const vel = this.flowVelocity() as V3;
  const up = (this.horizonAxes(cam)?.up ?? null) as V3 | null;
  const tanH = Math.tan((s.fov * Math.PI) / 360);
  const out = this.camFollow.step(
    { q, centre, vel, up, eye: to.eye as V3, aim: to.aim as V3, tanH, aspect: 16 / 9, time: this.camClock },
    this.followOptions(),
    live,
  );
  // (the lens widened with the speed through the air and the afterburner — the setting's gain)
  const L = this.airFlight.last;
  const mach = this.airFlight.inAir ? (L?.out.mach ?? 0) : 0;
  const sm = (a: number, c: number, x: number) => {
    const t = clamp((x - a) / (c - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const want = 1 + (s.camSpeedFov ?? 1) * (0.12 * sm(0.3, 1.3, mach) + (this.jetModes.ab ? 0.06 : 0));
  this.camKick = damp(this.camKick, want, 0.5, live);
  return { eye: out.eye as Vec3, aim: out.aim as Vec3, up: out.up as Vec3 };
}

/** The player's field of view, kept aside while a view sets the lens. */
function lensBaseNow(this: CameraController): number {
  return this.lensBase ?? this.fovTarget ?? this.s.fov;
}

/**
 * The lens this frame: `want` [°] a view's field (null: none — the player's given back, eased). The player's
 * zoom while it is taken moves the kept field (lens.ts zoomLens).
 */
function lensApply(this: CameraController, want: number | null) {
  const s = this.s;
  if (want !== null && Number.isFinite(want)) {
    if (this.lensBase === null) this.lensBase = this.fovTarget ?? s.fov;
    this.fovTarget = null;
    s.fov = clamp(want, 0.3, 150);
  } else if (this.lensBase !== null) {
    this.fovTarget = this.lensBase;
    this.lensBase = null;
  }
}

/**
 * A plane's view shaken by its flight (camshake.ts): the runway under its wheels, the buffet near its angle of
 * attack's limit, the transonic band, the afterburner, a touchdown's jolt — the aim turned about the eye, the up
 * rolled; from the seat fully, from outside less.
 */
function shakePose(this: CameraController, pose: MountPose, dt: number): MountPose {
  const L = this.airFlight.last;
  const V = VESSELS[fleet.active];
  const aMax = V.fbw?.alphaMax ?? V.aero.wing?.stall ?? 0.4;
  const alpha = L?.out.alpha ?? 0;
  const mach = L ? L.speed / Math.max(L.air.a, 1) : 0;
  const dense = L ? clamp(L.air.rho / 0.4, 0, 1) : 0;
  const contact = this.gearLast?.contact ?? 0;
  // (an airliner's touchdown: its sink's thump — a greaser's a nudge, a firm one a jolt —, a fighter's a fixed one)
  const airliner = fleet.active === "a320";
  const touch = contact > 0 && this.shakeContact === 0 && !!L && L.speed > 20;
  let jolt = touch ? (airliner ? Math.max(-(this.geoNow()?.vs ?? 0), 0) * 1.6 : 1.4) : 0;
  this.shakeContact = contact;
  // (a spacecraft's touchdown — the Lander's on the Moon —: its sink's jolt, once — X7)
  const T = this.lastTouch;
  if (T && T.n !== this.shakeTouchN) {
    if (this.shakeTouchN !== null) jolt = Math.max(jolt, Math.min(T.sink, 4));
    this.shakeTouchN = T.n;
  }
  const sh = this.camShake.step(
    {
      dt,
      roll: this.rolling ? (L?.speed ?? 0) : 0,
      // (a fighter's own buffet from its high incidence's model — aero.highAlpha: from 18°, full at 32° —, else near
      // its angle of attack's limit)
      buffet:
        L && !this.rolling ? Math.max(L.out.buffet, clamp((alpha - 0.72 * aMax) / (0.28 * aMax), 0, 1)) * clamp(L.out.q / 3000, 0, 1) : 0,
      transonic: dense * clamp(1 - Math.abs(mach - 1.0) / 0.1, 0, 1),
      ab: this.abLevel,
      engine: this.pilot.engineNow,
      jolt,
      // (a spacecraft: its rocket — the heavier the craft, the harder —, the plasma, the ring changing its turn)
      ...(fleet.active === "f35"
        ? {}
        : airliner
          ? {
              // (the A320 — PLAN-A320 A13: the runway's 5 m slabs, its speed brakes by the air's pressure, the
              // turbulence; its roll softer, no rocket)
              joints: 5,
              soft: 0.6,
              brakes: clamp(this.airBrake, 0, 1) * clamp((L?.out.q ?? 0) / 6000, 0, 1),
              turb: L && !this.rolling ? clamp((this.weatherNow?.wind.turb ?? 0) / 3, 0, 1) : 0,
            }
          : {
              rocket: clamp(this.pilot.engineNow / (V.sound?.sub ?? 1) ** 0.5, 0, 1.4),
              plasma: L?.air ? clamp((Math.log10(Math.max(this.airInfo().heat, 1)) - 4.6) / 1.7, 0, 1) : 0,
              ring: V.ring
                ? clamp(Math.abs((this.ringInfo()?.asked ?? this.ringInfo()?.rpm ?? 0) - (this.ringInfo()?.rpm ?? 0)) / 2, 0, 1)
                : 0,
            }),
    },
    this.s.flightShake * (this.s.shipMount === "cockpit" || this.s.shipMount === "cabin" ? 1 : 0.55),
  );
  const e = pose.eye as V3,
    d = vsub(pose.aim as V3, e);
  const up0 = (pose.up ?? [0, 1, 0]) as V3;
  const r = cross3(up0, d);
  const rl = len3(r) || 1;
  const right = scale3(r, 1 / rl);
  const dl = len3(d) || 1;
  // (small turns: the aim moved across, about the up and the right; the up rolled about the line of sight)
  const d2 = lin(lin(d as Vec3, 1, cross3(up0, d) as Vec3, sh.yaw), 1, cross3(right, d) as Vec3, sh.pitch) as V3;
  const up2 = lin(up0 as Vec3, 1, cross3(scale3(d, 1 / dl), up0) as Vec3, sh.roll) as V3;
  return { eye: e, aim: [e[0] + d2[0], e[1] + d2[1], e[2] + d2[2]], up: up2 };
}

export function installCamRig(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    shakePose,
    softMount,
    camRigStep,
    followOptions,
    lensBaseNow,
    lensApply,
    camImpulse,
    flowVelocity,
    viewWorld,
    carryCommit,
    applyCarry,
    shipQ,
  });
}

/** The blend's style and time between two views (the settings'), for stepMount. */
export function viewBlend(s: { camBlend?: string; camBlendTime?: number }): { style: BlendStyle; time: number } {
  return { style: (s.camBlend ?? "easeInOut") as BlendStyle, time: Math.max(0.05, s.camBlendTime ?? 1.2) };
}
