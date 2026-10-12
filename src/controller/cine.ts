// The CameraController — the director's view (mounts.ts "director", cine/brain.ts): each frame the flight's
// figures in the local frame (the craft's axes, its velocity over the ground near a world, the vertical, the
// world, the Sun, the target, the air, the engine), the brain's shot, placed as the view's attach point (ship
// frame: the craft keeps its attitude, the camera moves — stepMount's reorient), the lens taken while it is on
// and given back after.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { SHOTS, type CineContext, type Shot } from "../cine/brain";
import type { NoiseProfile } from "../cine/follow";
import { viewBlend } from "./camrig";
import type { V3 } from "../cine/rig";
import { fleet } from "../fleet";
import { t } from "../i18n";
import { dot as dot3, lin, sub as sub3 } from "../math/vec3";
import { shipToCamera } from "../mounts";
import type { Vec3 } from "../physics";
import { ourState } from "../system/our-side";
import { gearHeight, groundVelocity, solidBody } from "../system/our-surface";
import { solarBody } from "../system/solar";
import { C_MPS, M_METRES } from "../units";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";
import { clamp, unitV } from "./util";

declare module "../controls" {
  interface CameraController {
    cineStep: typeof cineStep;
    cineLeave: typeof cineLeave;
    cineContext: typeof cineContext;
    cineNextShot: typeof cineNextShot;
  }
}

/** A shot's name, for the toasts and the HUD. */
export const SHOT_NAMES: Record<Shot | "auto", () => string> = {
  auto: () => t("the director chooses"),
  chase: () => t("chase"),
  orbit: () => t("slow orbit"),
  pass: () => t("fly-by"),
  tracking: () => t("ground tracking, long lens"),
  planet: () => t("the planet's limb"),
  system: () => t("the destination behind"),
};

/** The flight's figures the brain reads, the local frame's (and the ship's axes in it). */
function cineContext(this: CameraController, warp: number): { c: CineContext; ax: [Vec3, Vec3, Vec3] } {
  const s = this.s;
  const cam = cameraFrame(s);
  const S = this.lastPose ? shipToCamera(this.lastPose, s.shipLookYaw, s.shipLookPitch).S : this.shipMatrix();
  const ax = [0, 1, 2].map((i) => lin(lin(cam.right, S[0][i]!, cam.up, S[1][i]!), 1, cam.fwd, S[2][i]!)) as [Vec3, Vec3, Vec3];
  const V = VESSELS[fleet.active];
  const centre = lin(lin(ax[0], V.centre[0], ax[1], V.centre[1]), 1, ax[2], V.centre[2]) as V3;
  const nav = this.local ? null : this.ourNav(cam);
  const ref = nav && nav.ref !== "sun" && solarBody(nav.ref) ? nav.ref : null;
  // (the velocity over the ground near a world — a still camera on it stays on it, its turn carried —, else in
  // the frame flown in)
  let vel: Vec3 = lin(sub3(cam.beta, this.refBeta(cam)), C_MPS, cam.beta, 0);
  let agl = Number.NaN;
  let body: CineContext["body"] = null;
  let sun: V3 | null = null;
  if (nav && ref) {
    const R = solarBody(ref)!.radius;
    const d = sub3(nav.refPos, nav.X);
    const dist = Math.hypot(...d);
    body = { dir: unitV(nav.toRep(lin(d, 1 / dist, d, 0))) as V3, dist: dist * M_METRES, radius: R * M_METRES };
    if (solidBody(ref)) {
      agl = gearHeight(ref, nav.X, nav.t);
      if (agl < 150e3) vel = lin(nav.toRep(sub3(nav.V, groundVelocity(ref, nav.X, nav.t))), C_MPS, cam.beta, 0);
    }
  }
  if (nav) {
    const sp = sub3(ourState("sun", nav.t).pos, nav.X);
    sun = unitV(nav.toRep(sp)) as V3;
  } else if (this.local) agl = this.surfaceInfo()?.alt ?? Number.NaN;
  const tgt = this.targetDir(cam);
  const L = this.airFlight.last;
  const inAir = this.airFlight.inAir && (L?.out.q ?? 0) > 50;
  const landed = !!this.ourLanded || !!this.rolling || !!this.local?.L.landed;
  const vUp = this.horizonAxes(cam)?.up ?? null;
  const vVert = vUp ? dot3(vel, vUp) : 0;
  const launch =
    !landed &&
    (this.pilot.auto === "takeoff" || (this.flightModeNow() === "rocket" && this.pilot.engineNow > 0.3 && vVert > 15 && agl < 60e3));
  return {
    ax,
    c: {
      ax: ax as [V3, V3, V3],
      centre,
      size: V.viewDist,
      // (the time sped up: the still cameras fall behind as fast as the craft goes)
      vel: lin(vel, warp, vel, 0) as V3,
      up: vUp as V3 | null,
      body,
      sun,
      target: tgt ? (unitV(tgt) as V3) : null,
      agl,
      q: L?.out.q ?? 0,
      mach: L?.out.mach ?? 0,
      throttle: this.pilot.engineNow,
      boost: this.jetThrust(),
      inAir,
      landed,
      launch,
      time: this.cineClock,
    },
  };
}

/** A frame of the director's view: the shot placed (this.cineOut, ship frame), the lens taken. */
function cineStep(this: CameraController, dt: number) {
  const s = this.s;
  if (!this.cineOn) {
    this.cineOn = true;
    this.cine.reset();
  }
  const Msec = 4.925490947e-6 * s.massSolar;
  const dtSim = s.animate ? s.timeSpeed * dt * Msec : 0;
  const dtCam = s.animate ? dt : 0;
  this.cineClock += dtCam;
  const { c, ax } = this.cineContext(dtCam > 0 ? dtSim / dtCam : 0);
  const out = this.cine.update(
    c,
    {
      shot: (s.cineShot as Shot | "auto") ?? "auto",
      fov: this.lensBaseNow(),
      shake: s.cineShake,
      dynamicFov: s.cineDynamicFov,
      zoom: this.cineZoom,
      blend: viewBlend(s),
      impulse: s.camImpulse ?? 1,
      noise: (s.camNoise ?? "none") as NoiseProfile,
      noiseAmp: s.camNoiseAmp ?? 1,
      noiseFreq: s.camNoiseFreq ?? 1,
      dutch: s.camDutch ?? 0,
    },
    dtCam,
  );
  const toShip = (E: V3): Vec3 => [dot3(E, ax[0]), dot3(E, ax[1]), dot3(E, ax[2])];
  this.cineOut = { eye: toShip(out.eye), aim: toShip(out.aim), up: unitV(toShip(out.up)) };
  this.cineFov = clamp(out.fov, 0.3, 150);
}

/** Out of the director's view: its shots forgotten (its lens given back by lensApply). */
function cineLeave(this: CameraController) {
  if (!this.cineOn) return;
  this.cineOn = false;
  this.cineFov = null;
  this.cineOut = null;
  this.cineZoom = 1;
  this.cine.reset();
}

/** The next shot asked (the key): auto → each shot → auto. Returns what to say. */
function cineNextShot(this: CameraController): string {
  const order: (Shot | "auto")[] = ["auto", ...SHOTS];
  const i = order.indexOf((this.s.cineShot as Shot | "auto") ?? "auto");
  const next = order[(i + 1) % order.length]!;
  this.s.cineShot = next;
  return `${t("Director")}: ${SHOT_NAMES[next]()}`;
}

export function installCine(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { cineStep, cineLeave, cineContext, cineNextShot });
}
