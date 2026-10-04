// The CameraController — piloting: the controls, the holds, the autopilots, the entry and the landing.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { GEARS } from "../gear";
import { basis, blToCartesian, cameraFrame, setHolePose, setHomePose, setRepPose, yawPitchRoll } from "../camera";
import { TUNING } from "../game/tuning";
import { isco, type Vec3 } from "../physics";
import { BODY_NAMES, type Body, onOurSide } from "../targeting";
import { AIR_WARP } from "../flightair";
import { attitudeFor, EntryGuidance, heightOf, type EntryCraft, type EntryResult, type EntryState } from "../entry";
import { envOf, type EnvDesc } from "../entry-env";
import { siteDir, sitesOf, type Site } from "../game/sites";
import { aeroForces, airAt, airTop, entryInterface } from "../aero";
import { GEAR, groundR, localAccel, localToZamo, planetFrame, toGlobal, toLocal, zamoBeta, zamoToLocal } from "../landing";
import { circularSpeed, type FlightMode, type PilotInput } from "../pilot";
import { MOUNT_KEYS, MOUNTS, mountPose, shipToCamera, type M3, type Mount, type MountPose, type OutsideView } from "../mounts";
import { fleet } from "../fleet";
import { fuelOn } from "../engine";
import { VESSELS } from "../vessels";
import type { GamepadInput } from "../gamepad";
import { mouth } from "../wormhole";
import { gravityHome, ourState, repToHomeVec } from "../system/our-side";
import { plan as runPlanner } from "../system/plan-client";
import { bodyFixedOf, fromBodyFixed, gearHeight, groundAboveSphere, groundVelocity, solidBody, toBodyFixed } from "../system/our-surface";
import { daysOf, solarBody, spinVector } from "../system/solar";
import { C_MPS, M_METRES } from "../units";
import { cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";
import { frameNow } from "../frameclock";
import { t, tf } from "../i18n";

import type { CameraController } from "../controls";
import { clamp, flareRef, normalize, smoothstep, spinAxis, unitV, wrapDeg, wrapYaw } from "./util";
import { heldCode, type HeldAxis } from "../input/bindings";

declare module "../controls" {
  interface CameraController {
    setPilot: typeof setPilot;
    newFlight: typeof newFlight;
    stepOffMount: typeof stepOffMount;
    standOn: typeof standOn;
    placeShipRep: typeof placeShipRep;
    moveOutside: typeof moveOutside;
    setLookRaw: typeof setLookRaw;
    markLook: typeof markLook;
    syncLook: typeof syncLook;
    setLook: typeof setLook;
    resetShipView: typeof resetShipView;
    cycleMount: typeof cycleMount;
    shipPose: typeof shipPose;
    outsideView: typeof outsideView;
    aimShipViews: typeof aimShipViews;
    flybyStep: typeof flybyStep;
    refBeta: typeof refBeta;
    mountTarget: typeof mountTarget;
    settleMount: typeof settleMount;
    stepMount: typeof stepMount;
    reorient: typeof reorient;
    shipMatrix: typeof shipMatrix;
    levelShip: typeof levelShip;
    shipAxesLocal: typeof shipAxesLocal;
    rotateC: typeof rotateC;
    pilotInput: typeof pilotInput;
    flyShip: typeof flyShip;
    airAfter: typeof airAfter;
    dragPerMass: typeof dragPerMass;
    flightModeNow: typeof flightModeNow;
    horizonAxes: typeof horizonAxes;
    sfFrame: typeof sfFrame;
    sfWant: typeof sfWant;
    entryFrame: typeof entryFrame;
    entryCraft: typeof entryCraft;
    entryStep: typeof entryStep;
  }
}

/**
 * The Ranger carries the camera and flies: gravity on (Kerr geodesic in the scene's time), free
 * rotation; the clock as it was (paused, the ship waits). Starting near the hole, it is put on a
 * circular orbit (prograde).
 */
function setPilot(this: CameraController, on: boolean) {
  const s = this.s;
  // (no ship: no spectator away from it)
  if (!on) this.stopSpectator();
  // (leaving the craft: it coasts where it is, docked or not — the camera steps off; boarding it again,
  // it is where the camera is)
  if (!on && this.piloting) {
    const p = this.activePoseNow(true);
    if (p && !fleet.assembly(fleet.active).includes("iss")) fleet.setFree(fleet.active, p, p.t, this.coastCom());
  }
  if (on) delete fleet.free[fleet.active];
  this.piloting = on;
  this.shipSide = null; // (a new flight: no crossing to announce)
  this.pilot.omega = [0, 0, 0];
  this.pilot.throttle = 0;
  this.pilot.hold = "none";
  this.pilot.auto = "none";
  this.plan = { nodes: [], path: null, at: 0, note: "" };
  this.transfer = null;
  this.local = null;
  this.warpAfter = null;
  this.restoreWarp();
  if (!on) {
    this.stepOffMount();
    s.shipLookYaw = s.shipLookPitch = 0;
    if (this.gravity) this.setGravity(false);
    return;
  }
  if (this.cinematic === "orbit") this.setCinematic(null);
  this.flyMode = false;
  s.rotation = "free";
  if (!this.gravity) this.setGravity(true);
  s.motion = "geodesic";
  s.showGeodesic = true; // the future path, drawn in the view and on the map
  const cam = cameraFrame(s);
  if (cam.region === "hole" && Math.hypot(...cam.beta) < 1e-6) {
    const v = circularSpeed(cam.r, s.spin, true, cam.zamo);
    if (v !== null && cam.r > isco(s.spin)) [s.velR, s.velT, s.velP] = [0, 0, v];
  }
}

/**
 * A new flight — a scene, a placement, a saved game: nothing of the last one carried into it (an
 * entry's run and its glide, the docking's, the air's heat and gear, the air brake, the displays'
 * caches). Before, a second glide began as the first had ended — mid-approach, gear up, braking.
 */
function newFlight(this: CameraController) {
  this.entryRun = null;
  this.dockAuto = null;
  this.ourCirc = null;
  this.airBrake = 0;
  this.airFlight.reset(fleet.active);
  this.airFlight.cfg = {};
  // (the tanks full again: every craft's; the weather drawn anew at the flight's first moment — the same
  // flight, the same gusts; nothing of the last flight's gear — its spoilers, its steering, its springs)
  fleet.spent = {};
  this.groundSpoilers = false;
  this.noseSteer = 0;
  this.turnOnGear = false;
  this.gearLast = null;
  this.gearDw = null;
  this.rollSince = 0;
  this.windHome = null;
  this.windNow = null;
  this.weather.reset();
  this.pilot.newFlight();
  this.hubCache = this.runwayCache = this.futureCache = this.kerrInfoCache = this.aimCache = null;
  this.contrails.clear();
}

/**
 * Leaving the ship: the camera where its eye was. The pose is the ship's centre, the eye its attach
 * point's — metres on the hull, tens to kilometres outside: off the ship, the view would jump there
 * (into the hull, under the ground it stood on).
 */
function stepOffMount(this: CameraController) {
  const s = this.s;
  const t = shipToCamera(this.shipPose(), s.shipLookYaw, s.shipLookPitch).t;
  const w = t.some((x) => x !== 0) ? this.rigWorld() : null;
  if (!w) return;
  // (t: the ship's centre from the eye, on the camera's axes [m] — the eye is the other way)
  const k = -1 / (1476.625 * s.massSolar);
  const X = lin(lin(w.X, 1, w.right, t[0] * k), 1, lin(w.up, t[1] * k, w.fwd, t[2] * k), 1);
  const motion = s.motion;
  if (w.ours) setHomePose(s, X, w.fwd, w.up);
  else setHolePose(s, X, w.fwd, w.up);
  s.motion = motion;
  this.targetDistance = s.distance;
  this.targetL = s.whL;
  this.written = "";
}

/**
 * The camera on the ground: a tripod standing on a world (the one given, else the target when it is
 * one, else the nearest), 1.7 m above its relief under the camera — or where the camera faces it from
 * afar —, level, looking at the horizon the way the camera faced. Why it cannot, or null.
 */
function standOn(this: CameraController, b?: Body): string | null {
  const s = this.s;
  // (tf: `t` is the time here)
  if (this.piloting) return tf("The Ranger lands itself (the autopilot: 7) — leave it to set the camera down (⇧K)");
  const w = this.rigWorld();
  if (!w) return tf("No world to stand on here");
  const t = this.nowTime();
  const solid = (id: Body) => (w.ours ? solidBody(id) : ["miller", "mann", "edmunds"].includes(id));
  const pick = (id: Body | null | undefined) => (id && solid(id) ? this.rigBody(id, w.ours, t) : null);
  const ref = b ? pick(b) : (pick(s.target) ?? this.rigNearest(w.ours, w.X, t));
  if (!ref || !solid(ref.id))
    return tf("Nothing solid to stand on — a planet or a moon on this side of the wormhole (Go to takes the camera through)");
  const up = unitV(sub3(w.X, ref.C));
  const mR = 1476.625 * s.massSolar;
  let X = lin(ref.C, 1, up, ref.R);
  let V = ref.V;
  if (w.ours) {
    X = lin(ref.C, 1, up, ref.R + (groundAboveSphere(ref.id, toBodyFixed(ref.id, X, t)) + 1.7) / mR);
    V = groundVelocity(ref.id, X, t);
  } else {
    const F = planetFrame(ref.id as "miller" | "mann" | "edmunds", t, s.spin, s.massSolar);
    const xi = toLocal(F, X, F.V).xi;
    const g = groundR(F, xi);
    const P = toGlobal(F, { xi: lin(xi, (g + 1.7 / F.mPerM) / Math.hypot(...xi), xi, 0), w: [0, 0, 0], landed: true });
    [X, V] = [P.X, P.V];
  }
  // (the heading: the camera's forward on the horizon — looking straight down, its up)
  let f = sub3(w.fwd, lin(up, dot3(w.fwd, up), up, 0));
  if (Math.hypot(...f) < 1e-3) f = sub3(w.up, lin(up, dot3(w.up, up), up, 0));
  f = unitV(f);
  this.setCinematic(null);
  if (this.gravity) this.setGravity(false);
  this.setOurLanded(null);
  this.flyMode = false;
  s.lookAt = false;
  s.telescope = false;
  s.rotation = "tripod";
  this.rigPlace(w.ours, X, f, up, V);
  this.rig.key = ""; // (the tripod fixed where it now stands)
  this.leveling = false;
  this.activity = performance.now();
  this.onCinematicChange(this.cinematic);
  return null;
}

/**
 * Puts the Ranger in the wormhole's world (rep coordinates: ℓ, direction n) with a 3-velocity, its
 * nose along `nose` and its top towards `top` (rep vectors); the camera goes where its mount is.
 */
function placeShipRep(this: CameraController, l: number, n: Vec3, vel: Vec3, nose: Vec3, top: Vec3) {
  const S = this.shipMatrix(); // rows: the camera's axes in the ship's frame (x left, y up, z nose)
  const z = normalize(nose);
  const x = normalize(cross(top, z));
  const y = cross(z, x);
  const cam = (k: number) => lin(lin(x, S[k]![0], y, S[k]![1]), 1, z, S[k]![2]);
  setRepPose(this.s, { l, n, fwd: cam(2), up: cam(1), vel });
  this.s.motion = "geodesic";
  this.pilot.omega = [0, 0, 0];
  this.sync();
}

/**
 * Outside, free: the keys move the camera along its own axes (Z Q S D, A E on AZERTY; Shift faster),
 * its speed eased (~0.15 s), a fifth of its distance from the ship per second (5 m/s at least).
 */
function moveOutside(this: CameraController, dt: number, move: number[], fast: boolean) {
  const o = this.outside;
  const S = shipToCamera(this.mountTarget(), 0, 0).S;
  const v = Math.max(5, 0.2 * Math.hypot(...o.eye)) * (fast ? 5 : 1);
  const want = lin(lin(S[2], move[0]! * v, S[0], move[1]! * v), 1, S[1], move[2]! * v);
  o.fvel = lin(o.fvel, 1, sub3(want, o.fvel), 1 - Math.exp(-dt / 0.15));
  if (Math.hypot(...o.fvel) < 1e-3) {
    o.fvel = [0, 0, 0];
    return;
  }
  const e = lin(o.eye, 1, o.fvel, dt);
  // (no farther than 50 km from the ship)
  const l = Math.hypot(...e);
  o.eye = l > 5e4 ? lin(e, 5e4 / l, e, 0) : e;
  this.activity = performance.now();
}

/** The look's angles set without turning the camera (the pose's change does, through stepMount). */
function setLookRaw(this: CameraController, yaw: number, pitch: number) {
  this.s.shipLookYaw = yaw;
  this.s.shipLookPitch = pitch;
  this.markLook();
}

function markLook(this: CameraController) {
  const s = this.s;
  this.lookSeen = { yaw: s.shipLookYaw, pitch: s.shipLookPitch, cam: `${s.yaw}|${s.pitch}|${s.roll}|${s.anchor}` };
}

/**
 * The look changed from outside since the last frame — the settings panel's free-look fields,
 * __bh.game.set —: the camera turned on its mount as setLook does, the ship left where it points.
 * (The ship's attitude is the camera's less the look: the angles written alone would swing the ship
 * round — in the air, a broken craft.) A new pose with it — a scene loaded, a placement —: as given.
 */
function syncLook(this: CameraController) {
  const s = this.s;
  const L = this.lookSeen;
  if (!L || (L.yaw === s.shipLookYaw && L.pitch === s.shipLookPitch)) return;
  const moved = L.cam !== `${s.yaw}|${s.pitch}|${s.roll}|${s.anchor}`;
  if (!s.ship || moved) return;
  const yaw = wrapYaw(s.shipLookYaw),
    pitch = clamp(s.shipLookPitch, -85, 85);
  const pose = this.shipPose();
  const S0 = shipToCamera(pose, L.yaw, L.pitch).S;
  s.shipLookYaw = yaw;
  s.shipLookPitch = pitch;
  this.reorient(S0, shipToCamera(pose, yaw, pitch).S);
}

/** Turns the camera on its mount (degrees; the yaw all the way round, as many turns as wanted); the
 *  ship stays where it points. */
function setLook(this: CameraController, yaw: number, pitch: number) {
  const s = this.s;
  yaw = wrapYaw(yaw);
  pitch = clamp(pitch, -85, 85);
  if (yaw === s.shipLookYaw && pitch === s.shipLookPitch) return;
  const S0 = this.shipMatrix();
  s.shipLookYaw = yaw;
  s.shipLookPitch = pitch;
  this.reorient(S0, this.shipMatrix());
  this.markLook();
}

/**
 * The camera back to the craft's attach points as they are: the look straight along the mount's axis,
 * no lock on the target, the outside views' own places again (around: behind and above at the craft's
 * distance; free: off its quarter; the fly-by afresh) — and from an outside view, back on the hull, at
 * the last attach point used there. What it did.
 */
function resetShipView(this: CameraController): string {
  const s = this.s;
  const V = VESSELS[fleet.active];
  const k = V.viewDist / 42;
  s.lookAt = false;
  this.lookOff = [0, 0];
  this.shipAim = null;
  Object.assign(this.outside, {
    yaw: 0,
    pitch: 12,
    dist: V.viewDist,
    eye: [18 * k, 6 * k, -36 * k] as Vec3,
    fyaw: -25,
    fpitch: -5,
    fvel: [0, 0, 0] as Vec3,
  });
  this.flyby.E = null;
  this.cabinCam = { eye: null, vel: [0, 0, 0] };
  const wasOut = !!this.outsideView();
  if (wasOut) s.shipMount = this.hullMount;
  // (the look recentred: the ship keeps its attitude — the camera turns back with the mount)
  this.setLook(0, 0);
  return tf("Camera reset · {0}", MOUNTS[s.shipMount as Mount]?.label ?? s.shipMount);
}

/** Next / previous attach point (the view travels there; the ship keeps its attitude). */
function cycleMount(this: CameraController, dir: 1 | -1) {
  const s = this.s;
  const i = MOUNT_KEYS.indexOf(s.shipMount as Mount);
  s.shipMount = MOUNT_KEYS[(i + dir + MOUNT_KEYS.length) % MOUNT_KEYS.length]!;
  return s.shipMount as Mount;
}

/** Where the camera is on the ship now (between two attach points while the view moves). */
function shipPose(this: CameraController): MountPose {
  if (this.mountEff) return this.mountEff;
  // (the setting just changed, before this frame's step: still where the camera was)
  if (this.s.shipMount !== this.lastMount && this.lastPose) return this.lastPose;
  return this.mountTarget();
}

/** The outside view in use (mounts.ts), or none. */
function outsideView(this: CameraController): OutsideView | null {
  const m = MOUNTS[this.s.shipMount as Mount] as { outside?: OutsideView } | undefined;
  return this.s.ship ? (m?.outside ?? null) : null;
}

/**
 * The ship's views locked on the target (lookAt): on its mounts the look turns to it (eased; the drag
 * sets where it sits in the view), outside the views read its direction (mountTarget).
 */
function aimShipViews(this: CameraController, dt: number) {
  const s = this.s;
  // (the ship's axes as the camera had them last frame: the pose drawn — the outside views' placement
  // depends on the aim itself)
  const S = this.lastPose ? shipToCamera(this.lastPose, s.shipLookYaw, s.shipLookPitch).S : this.shipMatrix();
  this.shipAim = null;
  if (!s.lookAt || !this.piloting || this.cinematic) return;
  const cam = cameraFrame(s);
  const a = this.aim(cam);
  if (!a) return;
  const c: Vec3 = [dot3(a.look, cam.right), dot3(a.look, cam.up), dot3(a.look, cam.fwd)];
  this.shipAim = normalize(lin(lin(S[0], c[0], S[1], c[1]), 1, S[2], c[2]));
  if (this.outsideView()) return;
  const deg = 180 / Math.PI;
  const b = Math.atan2(c[0], c[2]) * deg - this.lookOff[0];
  const e = Math.asin(clamp(c[1], -1, 1)) * deg - this.lookOff[1];
  if (Math.abs(b) + Math.abs(e) < 1e-4) return; // (on it: still — the image converges)
  const k = 1 - Math.exp(-dt / 0.12);
  this.setLook(s.shipLookYaw + b * k, s.shipLookPitch + e * k);
}

/**
 * The fly-by: the camera stands still in the frame the ship flies in (the body of its sphere of
 * influence, the planet it is near, the hole's static frame) and the ship passes it; once the ship is
 * well past, the camera waits for it further on, a little aside and above its path. Too fast for one
 * (a warp): it rides behind the ship.
 */
function flybyStep(this: CameraController, dt: number) {
  const s = this.s,
    F = this.flyby;
  const cam = cameraFrame(s);
  const S = this.lastPose ? shipToCamera(this.lastPose, s.shipLookYaw, s.shipLookPitch).S : this.shipMatrix();
  const ax = [0, 1, 2].map((i) => lin(lin(cam.right, S[0][i]!, cam.up, S[1][i]!), 1, cam.fwd, S[2][i]!)) as [Vec3, Vec3, Vec3];
  const toShip = (E: Vec3): Vec3 => [dot3(E, ax[0]), dot3(E, ax[1]), dot3(E, ax[2])];
  const toLocal = (e: Vec3) => lin(lin(ax[0], e[0], ax[1], e[1]), 1, ax[2], e[2]);
  if (!F.E) F.E = toLocal(this.lastPose?.eye ?? F.eye);
  const c = C_MPS;
  const vRel = sub3(cam.beta, this.refBeta(cam));
  const v = Math.hypot(...vRel) * c;
  const dtSec = s.animate ? s.timeSpeed * dt * 4.925490947e-6 * s.massSolar : 0;
  F.E = lin(F.E, 1, vRel, -c * dtSec);
  const D = clamp(v * 3.5, 60, 2500);
  if (v * dtSec > 0.3 * D) F.E = toLocal([0, 7, -45]);
  else if (v > 1) {
    const vh = lin(vRel, c / v, vRel, 0);
    if (Math.hypot(...F.E) > 1.6 * D || dot3(F.E, vh) < -0.9 * D) {
      let side = cross(vh, ax[1]);
      if (Math.hypot(...side) < 0.2) side = cross(vh, ax[0]);
      side = normalize(side);
      F.E = lin(lin(vh, D, side, 0.15 * D + 15), 1, ax[1], 0.05 * D + 5);
    }
  }
  F.eye = toShip(F.E);
}

/** The velocity of the frame the ship flies in, on the local axes [c]: the body of its sphere of
 *  influence (ours), the planet it is near (Gargantua's), else the hole's static frame. */
function refBeta(this: CameraController, cam: ReturnType<typeof cameraFrame>): Vec3 {
  const nav = this.ourNav(cam);
  if (nav) return nav.refVelRep;
  if (cam.region === "hole" && this.local) return zamoBeta(blToCartesian(cam.r, cam.theta, cam.phi), this.local.F.V, this.s.spin);
  return [0, 0, 0];
}

/** Where the chosen attach point puts the camera (the outside views: where they are now). */
function mountTarget(this: CameraController): MountPose {
  const o = this.outside;
  const v = this.outsideView();
  const d = Math.PI / 180;
  const A = this.shipAim;
  const V = VESSELS[fleet.active];
  if (v === "around") {
    const c: Vec3 = V.centre;
    // (locked on the target: behind the ship on the target's line, the drag an offset from it)
    const y0 = A ? Math.atan2(-A[0], A[2]) / d : 0,
      p0 = A ? Math.asin(clamp(-A[1], -1, 1)) / d : 0;
    const yaw = (y0 + o.yaw) * d,
      pitch = clamp(p0 + o.pitch, -88, 88) * d;
    const dir: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    return { eye: lin(c, 1, dir, o.dist), aim: c };
  }
  if (v === "free") {
    // (locked on the target: aimed at it, the drag an offset)
    const fy = A ? Math.atan2(A[0], A[2]) / d + this.lookOff[0] : o.fyaw;
    const fp = A ? clamp(Math.asin(clamp(A[1], -1, 1)) / d + this.lookOff[1], -89, 89) : o.fpitch;
    const f: Vec3 = [Math.sin(fy * d) * Math.cos(fp * d), Math.sin(fp * d), Math.cos(fy * d) * Math.cos(fp * d)];
    return { eye: o.eye, aim: lin(o.eye, 1, f, 10) };
  }
  if (v === "flyby") return { eye: this.flyby.eye, aim: V.centre };
  // (about the cabin: where the camera has moved to, looking along the nose — the look turns it)
  if (this.s.shipMount === "cabin") {
    const e = this.cabinCam.eye ?? mountPose("cockpit").eye;
    return { eye: e, aim: [e[0], e[1], e[2] + 10] };
  }
  if (v === "station") {
    const sc = this.stationCam();
    if (sc) return sc;
    return { eye: lin(V.centre, 1, [0, 0.2, -1], V.viewDist), aim: V.centre };
  }
  return mountPose((MOUNTS[this.s.shipMount as Mount] ? this.s.shipMount : "quarter") as Mount);
}

/** A scene applied: the camera straight at its attach point — not travelling there from the last scene's
 *  (the ship kept still meanwhile, the view the scene turned onto its body turned away: 21° on the Moon's
 *  Earthrise, the Earth out of the frame) */
function settleMount(this: CameraController) {
  this.airFlight.reset(fleet.active);
  // (the Lander flies as a rocket unless told otherwise; the Ranger as a plane)
  if (fleet.active !== "ranger" && this.s.flightMode === "plane") this.s.flightMode = "rocket";
  this.rolling = null;
  this.lastMount = this.s.shipMount;
  // (a scene's attach point: the one a reset comes back to; the outside views at the craft's own distances)
  if (MOUNTS[this.s.shipMount as Mount] && !(MOUNTS[this.s.shipMount as Mount] as { outside?: string }).outside)
    this.hullMount = this.s.shipMount as Mount;
  const k = VESSELS[fleet.active].viewDist / 42;
  Object.assign(this.outside, {
    yaw: 0,
    pitch: 12,
    dist: VESSELS[fleet.active].viewDist,
    eye: [18 * k, 6 * k, -36 * k] as Vec3,
    fyaw: -25,
    fpitch: -5,
    fvel: [0, 0, 0] as Vec3,
  });
  this.mountAnim = null;
  this.mountEff = null;
  this.lastPose = this.mountTarget();
}

/** Eases the camera towards the chosen attach point; keeps the ship's attitude while it moves. */
function stepMount(this: CameraController, dt: number) {
  const s = this.s;
  // (the outside views' poses change between frames — dragged, moved —: from where the camera was)
  const S0 = this.lastPose && !this.mountAnim ? shipToCamera(this.lastPose, s.shipLookYaw, s.shipLookPitch).S : this.shipMatrix();
  if (s.shipMount !== this.lastMount) {
    if (this.lastMount && s.ship) this.mountAnim = { from: this.lastPose ?? this.shipPose(), t: 0 };
    if (MOUNTS[s.shipMount as Mount] && !(MOUNTS[s.shipMount as Mount] as { outside?: string }).outside)
      this.hullMount = s.shipMount as Mount;
    // (about the cabin: from where the camera was in it — the pilot's seat, else its own)
    if (s.shipMount === "cabin")
      this.cabinCam = {
        eye: this.lastMount === "cockpit" && this.lastPose ? ([...this.lastPose.eye] as Vec3) : this.cabinCam.eye,
        vel: [0, 0, 0],
      };
    const prevMount = this.lastMount;
    this.lastMount = s.shipMount;
    const v = this.outsideView();
    if (v === "free" && this.lastPose) {
      // (the free camera starts where the view was, looking the same way)
      const P = this.lastPose;
      const f = sub3(P.aim, P.eye);
      const l = Math.hypot(...f) || 1;
      this.outside.eye = [...P.eye] as Vec3;
      this.outside.fyaw = (Math.atan2(f[0], f[2]) * 180) / Math.PI;
      this.outside.fpitch = (Math.asin(clamp(f[1] / l, -1, 1)) * 180) / Math.PI;
      this.outside.fvel = [0, 0, 0];
    }
    if (v === "around" && this.lastPose) {
      // (around the ship from where the view was: no jump)
      const c: Vec3 = VESSELS[fleet.active].centre;
      const e = sub3(this.lastPose.eye, c);
      const l = Math.hypot(...e) || 1;
      const deg = 180 / Math.PI;
      const A = this.shipAim;
      const y0 = A ? Math.atan2(-A[0], A[2]) * deg : 0,
        p0 = A ? Math.asin(clamp(-A[1], -1, 1)) * deg : 0;
      // (from a mount on the hull: out to a view of the whole ship, the same side of it)
      const fromOutside = !!(MOUNTS[prevMount as Mount] as { outside?: string } | undefined)?.outside;
      this.outside.dist = clamp(fromOutside ? l : Math.max(l, VESSELS[fleet.active].viewDist), 12, 20000);
      this.outside.yaw = wrapDeg(Math.atan2(e[0], -e[2]) * deg - y0);
      this.outside.pitch = clamp(Math.asin(clamp(e[1] / l, -1, 1)) * deg - p0, -85, 85);
    }
    if (v) this.setLookRaw(0, 0);
  }
  const to = this.mountTarget();
  if (this.mountAnim) {
    const A = this.mountAnim;
    A.t = Math.min(1, A.t + dt / 0.6);
    const k = smoothstep(A.t);
    const mix = (p: Vec3, q: Vec3) => lin(p, 1 - k, q, k);
    this.mountEff = { eye: mix(A.from.eye, to.eye), aim: mix(A.from.aim, to.aim) };
    if (A.t >= 1) (this.mountAnim = null), (this.mountEff = null);
  } else this.mountEff = null;
  if (s.ship && !this.cinematic) this.reorient(S0, this.shipMatrix());
  this.lastPose = this.shipPose();
}

/** The ship's placement relative to the camera changed from S0 to S1: turn the camera so that the ship does not. */
function reorient(this: CameraController, S0: M3, S1: M3) {
  if (S0.every((row, k) => row.every((x, i) => x === S1[k]![i]))) return;
  const s = this.s;
  const b = basis(s.yaw, s.pitch, s.roll);
  const ax = (i: number) => lin(lin(b.right, S0[0]![i]!, b.up, S0[1]![i]!), 1, b.fwd, S0[2]![i]!);
  const A = [ax(0), ax(1), ax(2)];
  // row k of S1: camera axis k in the ship's frame
  const cam = (k: number) => lin(lin(A[0]!, S1[k]![0], A[1]!, S1[k]![1]), 1, A[2]!, S1[k]![2]);
  const e = yawPitchRoll(cam(2), cam(1));
  s.yaw = e.yaw;
  s.pitch = e.pitch;
  s.roll = e.roll;
}

function shipMatrix(this: CameraController): M3 {
  return shipToCamera(this.shipPose(), this.s.shipLookYaw, this.s.shipLookPitch).S;
}

/**
 * Levels the ship on the ground: its top towards the local up (ZAMO components), its nose on the
 * horizon along its heading (tilted forwards if it stood on its tail). The cameras follow it.
 */
function levelShip(this: CameraController, upZ: Vec3) {
  const col = (S: M3, i: number): Vec3 => [S[0][i]!, S[1][i]!, S[2][i]!];
  const toC = (v: Vec3) => {
    const cam = cameraFrame(this.s);
    return [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)] as Vec3;
  };
  const S = this.shipMatrix();
  const Y = col(S, 1),
    Z = col(S, 2);
  let u = toC(upZ);
  u = lin(u, 1 / Math.hypot(...u), u, 0);
  let h = sub3(Z, lin(u, dot3(Z, u), u, 0));
  if (Math.hypot(...h) < 0.2) h = lin(sub3(Y, lin(u, dot3(Y, u), u, 0)), -1, u, 0);
  h = lin(h, 1 / Math.hypot(...h), h, 0);
  const k = cross(Z, h);
  const kl = Math.hypot(...k);
  if (kl > 1e-9) this.rotateC(lin(k, Math.atan2(kl, dot3(Z, h)) / kl, k, 0));
  // then the roll: the top up
  let u2 = toC(upZ);
  u2 = lin(u2, 1 / Math.hypot(...u2), u2, 0);
  const ra = Math.atan2(dot3(cross(Y, u2), Z), dot3(Y, u2));
  this.rotateC(lin(Z, ra, Z, 0));
}

/** The ship's axes (x left, y up, z nose) in the camera basis's local components. */
function shipAxesLocal(this: CameraController, b: { right: Vec3; up: Vec3; fwd: Vec3 }): [Vec3, Vec3, Vec3] {
  const S = this.shipMatrix();
  const ax = (i: number) => lin(lin(b.right, S[0]![i]!, b.up, S[1]![i]!), 1, b.fwd, S[2]![i]!);
  return [ax(0), ax(1), ax(2)];
}

/** Rotates the camera (and the ship on it) by a rotation vector given in camera coordinates [rad]. */
function rotateC(this: CameraController, rot: Vec3) {
  const ang = Math.hypot(...rot);
  if (ang < 1e-9) return;
  const k = lin(rot, 1 / ang, rot, 0);
  const c = Math.cos(ang),
    sn = Math.sin(ang);
  const rod = (v: Vec3) => lin(lin(v, c, cross(k, v), sn), 1, k, dot3(k, v) * (1 - c));
  const f = rod([0, 0, 1]);
  const u = rod([0, 1, 0]);
  const s = this.s;
  const b = basis(s.yaw, s.pitch, s.roll);
  const L = (v: Vec3) => lin(lin(b.right, v[0], b.up, v[1]), 1, b.fwd, v[2]);
  const e = yawPitchRoll(L(f), L(u));
  s.yaw = e.yaw;
  s.pitch = e.pitch;
  s.roll = e.roll;
}

/** Pilot's keys (held): W/S pitch, A/D yaw, Q/E roll (by physical position); with Shift: RCS translation. */
function pilotInput(this: CameraController, pad: ReturnType<GamepadInput["poll"]>): PilotInput {
  // KSP's layout, by physical key (Z Q S D / A E on AZERTY): W S pitch (W: nose down), A D yaw, Q E
  // roll; I K translate down / up, J L left / right, H N forward / back; Shift throttles up, Alt
  // down (not Ctrl: Ctrl+W closes the tab), arrows too
  const k = (c: string) => (this.codes.has(c) ? 1 : 0);
  const i: PilotInput = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 };
  // (outside, free — or about the cabin: the keys move the camera; the ship flies on as it was)
  // (the spectator away: the keys move it; the ship flies on as it was — its autopilots, its holds)
  if (this.outsideView() === "free" || this.s.shipMount === "cabin" || this.spectator) return i;
  // (the keys as the player set them — input/bindings.ts; the defaults are KSP's)
  const h = (a: HeldAxis) => k(heldCode(a));
  i.pitch = h("pitchUp") - h("pitchDown");
  i.yaw = h("yawRight") - h("yawLeft");
  i.roll = h("rollRight") - h("rollLeft");
  i.tx = h("rcsRight") - h("rcsLeft");
  i.ty = h("rcsUp") - h("rcsDown");
  i.tz = h("rcsForward") - h("rcsBack");
  // (Shift and Alt on either side while they are the defaults)
  const up = h("throttleUp") || (heldCode("throttleUp") === "ShiftLeft" && k("ShiftRight")) || (this.keys.has("ArrowUp") ? 1 : 0);
  const down = h("throttleDown") || (heldCode("throttleDown") === "AltLeft" && k("AltRight")) || (this.keys.has("ArrowDown") ? 1 : 0);
  i.throttle = up - down;
  const t = this.touchInput;
  i.pitch = clamp(i.pitch + t.pitch, -1, 1);
  i.yaw = clamp(i.yaw + t.yaw, -1, 1);
  i.roll = clamp(i.roll + t.roll, -1, 1);
  if (pad) {
    // left stick: pitch (pull back = nose up) and yaw; LB/RB: roll; RT/LT: throttle
    i.pitch = clamp(i.pitch - pad.move[0], -1, 1);
    i.yaw = clamp(i.yaw + pad.move[1], -1, 1);
    i.roll = clamp(i.roll - pad.move[3], -1, 1);
    i.throttle = clamp(i.throttle + pad.move[2], -1, 1);
  }
  return i;
}

/** One frame of piloting: the flight computer turns the ship and fires the engines. */
function flyShip(this: CameraController, dt: number, pad: ReturnType<GamepadInput["poll"]>) {
  const s = this.s;
  // (paused: the ship holds — its attitude too, its turn resumes with the time)
  if (!s.animate) return;
  const cam = cameraFrame(s);
  // (through the wormhole, one way or the other: said once)
  if (s.wormhole) {
    const side = cam.region === "throat" ? (cam.ell < 0 ? "ours" : "gargantua") : "gargantua";
    if (this.shipSide && side !== this.shipSide)
      this.onPilotMessage?.(
        side === "gargantua" ? t("Through the wormhole — Gargantua's system") : t("Through the wormhole — back in the solar system"),
      );
    this.shipSide = side;
    // (out of the throat after a crossing at warp: real time again — the pilot's to choose)
    if (this.traversing && cam.region === "hole") {
      this.traversing = false;
      s.timeSpeed = this.warpSet = 1 / (4.925490947e-6 * s.massSolar);
      this.warpWant = null;
      this.onPilotMessage?.(tf("Out of the throat, {0} M from Gargantua — real time", Math.round(cam.r)));
    }
  }
  // (another craft chosen: the camera onto it)
  if (s.vessel !== fleet.active) {
    const why = this.switchVessel(s.vessel);
    if (why) {
      s.vessel = fleet.active;
      this.onPilotMessage?.(why);
    }
  }
  const inp = this.pilotInput(pad);
  // (the docking autopilot ended — docked, stopped: the pilot's warp back)
  if (this.pilot.auto !== "dock" && this.dockAuto) {
    if (this.dockAuto.warp !== null && s.timeSpeed === this.dockAuto.set) s.timeSpeed = this.warpSet = this.dockAuto.warp;
    this.warpWant = null;
    this.dockAuto = null;
  }
  // docked: carried by the station; a push of the engine or the thrusters undocks
  if (this.docked) {
    if (inp.throttle > 0 || inp.tx !== 0 || inp.ty !== 0 || inp.tz !== 0 || this.pilot.throttle > 0) this.undock();
    else return this.flyDocked(dt);
  }
  if (Object.values(inp).some((v) => v !== 0)) this.activity = performance.now();
  const dtau = cam.region === "hole" ? cam.zamo.alpha / cam.gamma : 1 / cam.gamma;
  if (this.pilot.auto !== "node") {
    if (this.userWarp !== null) this.restoreWarp(); // execution stopped
    this.nodeWarpWant = null;
    this.nodeWarpSet = NaN;
    this.nodeWarp = "";
  }
  if (this.pilot.auto !== "approach" && this.ourWarp !== null) {
    // (our approach stopped: the pilot's warp back)
    s.timeSpeed = this.warpSet = this.ourWarp;
    this.ourWarp = null;
    this.warpWant = null;
  }
  // the wind (wind.ts): our worlds' air, flown through — the frame's mean wind, turbulence and gusts at
  // the craft's place, in the home frame for the flight
  this.windHome = null;
  this.windNow = null;
  {
    const nav = this.ourNav(cameraFrame(s));
    const b = nav && nav.ref !== "sun" ? solarBody(nav.ref) : undefined;
    if (nav && b?.atmosphere && s.wind > 0) {
      const P = ourState(nav.ref, nav.t).pos;
      const d = sub3(nav.X, P);
      const r = Math.hypot(...d);
      const h = solidBody(nav.ref) ? gearHeight(nav.ref, nav.X, nav.t) + GEAR : (r - b.radius) * M_METRES;
      if (h < 30e3) {
        const q = toBodyFixed(nav.ref, nav.X, nav.t);
        const ql = Math.hypot(...q);
        const lat = (Math.asin(q[2] / ql) * 180) / Math.PI,
          lon = (Math.atan2(q[1], q[0]) * 180) / Math.PI;
        const Msec0 = 4.925490947e-6 * s.massSolar;
        const dtSec = s.animate ? s.timeSpeed * dt * Msec0 : 0;
        const V = this.airFlight.last?.speed ?? 0;
        const w = this.weather.step(s.wind, h, lat, lon, daysOf(nav.t), V, dtSec);
        const up = unitV(d);
        const east = unitV(cross(unitV(spinVector(b, nav.t)), up));
        const north = cross(up, east);
        this.windHome = lin(lin(east, w[0] / C_MPS, north, w[1] / C_MPS), 1, up, w[2] / C_MPS);
        const sp = Math.hypot(w[0], w[1]);
        this.windNow = { speed: sp, from: ((Math.atan2(-w[0], -w[1]) * 180) / Math.PI + 360) % 360 };
      }
    }
  }
  // (the tanks as the scene has them: the fleet's masses follow their propellant)
  fleet.tanks = fuelOn(s) ? { exhaust: s.exhaust, massRatio: s.massRatio } : null;
  if (this.pilot.auto !== "node") this.rails(cam);
  const burn = this.pilot.auto === "node" ? this.nodeBurn(cam, dt, dtau) : null;
  const tauRate = s.animate ? s.timeSpeed * dtau : 0;
  // the craft's own turning, slower in an assembly (its wheels and thrusters against the assembly's
  // moment of inertia)
  const V0 = VESSELS[fleet.active];
  const mp = fleet.massProps();
  const tune = { rate: TUNING.turnRate, acc: TUNING.turnAccel };
  // (the rigid body: its wheels' and thrusters' torque about each axis — what turns it at the tuning's
  // rate alone, full of propellant —, over its inertia now: lighter, it turns faster; docked, slower;
  // about its long axis faster than end over end)
  const torque = V0.rg.map((k) => V0.agility * V0.mass * k * k * tune.acc) as Vec3;
  const ag = Math.min(...[0, 1, 2].map((i) => torque[i]! / mp.I[i]![i]!)) / tune.acc;
  TUNING.turnAccel = tune.acc * ag;
  TUNING.turnRate = tune.rate * Math.min(1, 1.4 * Math.sqrt(ag));
  const assembled = fleet.flownAssembly().length > 1;
  const before = assembled ? this.camAxesHome() : null;
  // in the air: the time sped up no more than ×4, and the craft's turns on its own clock (the air's
  // moments and the pilot's commands in step with the flight)
  const Msec = 4.925490947e-6 * s.massSolar;
  const thick = this.airFlight.inAir;
  if (thick && s.timeSpeed * Msec > AIR_WARP) {
    s.timeSpeed = this.warpSet = AIR_WARP / Msec;
    if (!this.airWarpSaid) this.onPilotMessage?.(tf("In the air: the time warp held at ×{0}", AIR_WARP));
    this.airWarpSaid = true;
  }
  if (!thick) this.airWarpSaid = false;
  const dtPilot = thick ? dt * Math.min(s.timeSpeed * Msec, AIR_WARP) : dt;
  // the flight law in the air (the plane's surfaces; the sci-fi computer's commanded velocity)
  const mode = this.flightModeNow();
  const LA0 = this.airFlight.last;
  const AV = VESSELS[fleet.active].aero;
  const onWheels0 = !!this.rolling || !!this.local?.L.rolling;
  const airCtx =
    LA0 && LA0.out.q > 20
      ? {
          mode,
          alpha: LA0.out.alpha,
          beta: LA0.out.beta,
          auth: AV.ctrl.map((k) => Math.min((k * LA0.out.q) / 1000, 4)) as Vec3,
          path: this.airFlight.pathRate.map((x) => -x) as Vec3,
          ground: onWheels0,
          stall: AV.wing?.stall ?? 0.35,
          q: LA0.out.q,
          gamma: this.pathAngle(cam),
          bank: (this.attitudeNow() as { bank?: number }).bank ?? 0,
          mach: LA0.out.mach,
        }
      : null;
  const sfCtx = mode === "sf" && this.pilot.auto === "none" && this.pilot.hold === "none" ? this.sfWant(cam, inp, dtPilot) : null;
  // (the circularization's run ended with its autopilots: off by the pilot, or another engaged)
  if (this.ourCirc && this.pilot.auto !== "node" && this.pilot.auto !== "circularize") this.ourCirc = null;
  // the entry autopilot: the deorbit, the guided entry, the glide (its attitude, its burn)
  if (this.pilot.auto !== "entry" && this.entryRun) {
    // (off: the time back to real if it was sped up waiting for the burn; the air brake in)
    if (this.entryRun.phase === "wait") s.timeSpeed = this.warpSet = 1 / (4.925490947e-6 * s.massSolar);
    this.airBrake = 0;
    this.entryRun = null;
  }
  const entryAtt = this.pilot.auto === "entry" ? this.entryStep(cam, dtPilot) : this.pilot.auto === "burns" ? this.burnsStep(cam) : null;
  if (mode !== "sf" || !sfCtx) this.sfCmd = null;
  const out = this.pilot.step(
    {
      air: airCtx,
      sf: sfCtx,
      dt: dtPilot,
      right: cam.right,
      up: cam.up,
      fwd: cam.fwd,
      beta: cam.beta,
      S: this.shipMatrix(),
      thrust: this.thrustMax(),
      tauRate,
      radialOut: this.radialOut(cam),
      refVel: this.speedMode === "target" ? (this.targetVelLocal(cam) ?? undefined) : this.ourNav(cam)?.refVelRep,
      target: this.targetDir(cam),
      maneuver: this.maneuverDir(cam),
      want: (this.lastWant =
        this.pilot.auto !== "none" && this.pilot.auto !== "node" && this.pilot.auto !== "entry" && this.pilot.auto !== "burns"
          ? this.autopilotWant(cam)
          : null),
      att: entryAtt,
      dock: this.pilot.auto === "dock" ? (this.dockAuto?.att ?? null) : null,
      burn,
      // (the Crew engine's autopilots, when a frame lasts more than ~20 s of the ship's time: a real
      // ship turns within it — the wall-clock turn rates are for the eye, not for days-long burns)
      snap:
        (this.pilot.auto !== "none" &&
          ((s.engine === "crew" && cam.region === "hole") || onOurSide(s, cam)) &&
          s.timeSpeed * dt * 4.925490947e-6 * s.massSolar > 20) ||
        (this.nodeBurning && onOurSide(s, cam)),
      gimbal: this.nodeBurning && onOurSide(s, cam),
      // (the Crew engine's lag, over the frame's flight time; the Cinema engine's, none)
      inertia: mp.I,
      torque,
      onGear: !!this.rolling && !!GEARS[fleet.active],
      spoolK: s.engine === "crew" ? 1 - Math.exp(-((s.animate ? s.timeSpeed * dt : 0) * Msec) / VESSELS[fleet.active].spool) : 1,
    },
    inp,
  );
  TUNING.turnAccel = tune.acc;
  TUNING.turnRate = tune.rate;
  // (on its own gear, its turn is integrated within the flight's sub-steps — motion.ts —, with the
  // springs; elsewhere at once)
  this.turnOnGear = !!this.rolling && !!GEARS[fleet.active] && !!this.gearLast && this.gearLast.contact > 0;
  if (!this.turnOnGear) this.rotateC(out.rot);
  // (on its wheels: a craft with a gear of its own sits on its springs and steers by its nose wheel —
  // the pilot's yaw, full lock at a crawl, a few degrees fast; the rollout along the runway —; without,
  // held level on the ground, the nose within the runway's limits)
  this.noseSteer = 0;
  if (this.rolling) {
    const nav = this.ourNav(cameraFrame(s));
    if (GEARS[fleet.active]) {
      const sp = nav ? Math.hypot(...sub3(nav.V, groundVelocity(nav.ref, nav.X, nav.t))) * C_MPS : 0;
      const lock = Math.min((60 * Math.PI) / 180, 5.2 / Math.max(sp, 1));
      // (a positive yaw turns right: the wheel, + to the left, the other way)
      this.noseSteer = -inp.yaw * lock;
      if (nav && this.rollSite) this.rolloutSteer(nav.radial, dt, inp.yaw, lock);
    } else {
      if (nav) this.groundAttitude(nav.radial);
      if (nav && this.rollSite) this.rolloutSteer(nav.radial, dt, inp.yaw);
    }
  } else if (this.local?.L.rolling) this.groundAttitude(localToZamo(unitV(this.local.L.xi)));
  // (an assembly turns about its centre of mass: the flown craft's centre swings round it)
  if (before) this.turnAboutCom(before, mp.com);
  const simDt = s.animate ? s.timeSpeed * dt : 0;
  const tau0 = this.properTime;
  const pre = simDt > 0 ? this.contactPose() : null;
  // the configuration: on the wheels, the engine idle, the spoilers out (the lift dumped, braking);
  // the gear down on the ground and low and slow
  const onWheels = !!this.rolling || !!this.local?.L.rolling;
  const LA = this.airFlight.last;
  // (on the wheels, the engine idle: the ground spoilers out — the lift dumped at once, no bounce —,
  // the autopilot's landing as the pilot's)
  // (armed once down: a bounce keeps them out — the throttle opened takes them in)
  if (onWheels) this.groundSpoilers = true;
  if (this.groundSpoilers && !onWheels && !this.landed) {
    // (off the wheels: the height over the ground — not the sphere's —; past 30 m, a go-around)
    const nav = this.ourNav(cameraFrame(s));
    const agl = nav && solidBody(nav.ref) ? gearHeight(nav.ref, nav.X, nav.t) : Infinity;
    if (agl > 30) this.groundSpoilers = false;
  }
  if (this.pilot.throttle > 0.05) this.groundSpoilers = false;
  this.airFlight.cfg.brake = (onWheels || this.groundSpoilers) && this.pilot.throttle <= 0 ? 1 : this.airBrake;
  this.airFlight.cfg.gear = onWheels || this.landed || (!!LA && LA.h < 600 && LA.speed < 160);
  // (the control surfaces as deflected: the attitude's effort where the air answers — their drag)
  this.airFlight.cfg.deflect = airCtx ? this.pilot.fired.torque : undefined;
  this.airFlight.vacuum();
  if (simDt > 0) this.fall(simDt, [0, 0, 0], false, out.acc);
  // (the gear's torque over the frame turns the craft: its pitch settling on the nose wheel, a bounce)
  if (this.gearDw) {
    for (let i = 0; i < 3; i++) this.pilot.omega[i] = this.pilot.omega[i]! + this.gearDw[i]!;
    this.gearDw = null;
  }
  if (pre) this.stationContact(pre);
  this.airAfter(simDt * Msec, out.acc, dtPilot);
  if (!thick && this.airFlight.inAir && this.airFlight.last!.speed > 1000) this.onAirEntry?.();
  // rapidity spent (the propellant gauge), and the Δv delivered to the executing node (proper
  // acceleration × proper time)
  // (the antigravity's hold is free)
  const w = Math.hypot(...(sfCtx ? sub3(out.acc, sfCtx.free) : out.acc)) * (this.properTime - tau0);
  if (this.entryRun?.phase === "burn") this.entryRun.done += w * C_MPS;
  if (this.pilot.auto === "burns" && this.fcBurns[0]?.firing) this.fcBurns[0].done += w * C_MPS;
  // (the propellant: in the air the same thrust costs more of it — the Isp lowered by the pressure)
  if (fuelOn(s)) this.spent += w / Math.max(this.pressureThrust(), 0.05);
  if (burn && this.nodeBurning) this.nodeDone += w;
  this.dockCheck();
  this.measureSpin();
}

/**
 * After a frame's flight: the skin's temperatures, the load, the limits (flightair.ts); the air's
 * moment turns the craft (the pilot's rates the other way round from the right-hand rule).
 */
function airAfter(this: CameraController, dtSec: number, acc: Vec3, dtPilot: number) {
  const s = this.s;
  const cam = cameraFrame(s);
  const ax = this.shipAxesLocal(cam);
  const aU = C_MPS ** 2 / (1476.625 * s.massSolar);
  const thrust = ax.map((a) => (dot3(acc, a) / Math.max(Math.hypot(...a), 1e-12)) * aU) as Vec3;
  const mp = fleet.massProps();
  const was = this.airFlight.failure;
  const alpha = this.airFlight.after(dtSec, thrust, mp.mass, mp.I, s.damage);
  if (this.airFlight.inAir) for (let i = 0; i < 3; i++) this.pilot.omega[i] = this.pilot.omega[i]! - alpha[i]! * dtPilot;
  if (this.airFlight.failure && !was) this.onCraftLost?.(this.airFlight.failure);
}

/**
 * The flown craft's drag per unit mass, C_D A / m [m²/kg], as it flies now — its attitude to its
 * motion through the air (out of the air: as if it entered so, at Mach 25) — for the map's paths.
 */
function dragPerMass(this: CameraController): number {
  if (!this.piloting) return 0;
  const m = fleet.massProps().mass;
  const L = this.airFlight.last;
  if (L && L.out.q > 0) return L.out.D / L.out.q / m;
  const s = this.s;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  if (!nav || nav.ref === "sun" || !solarBody(nav.ref)?.atmosphere) return 0;
  const w = mouth(s).w;
  const ax = this.shipAxesLocal(cam).map((a) => unitV(repToHomeVec(w, cam.ell, cam.n, a)));
  const va = sub3(nav.V, groundVelocity(nav.ref, nav.X, nav.t));
  const vl = Math.hypot(...va) || 1;
  const air = airAt(solarBody(nav.ref)!.atmosphere, 70e3);
  const v = 25 * air.a;
  const o = aeroForces(VESSELS[fleet.active].aero, ax.map((a) => (dot3(va, a) / vl) * v) as Vec3, air);
  return o.q > 0 ? o.D / o.q / m : 0;
}

/** The flight law in the air: the settings' for the craft built for the air, a rocket's else. */
function flightModeNow(this: CameraController): FlightMode {
  return VESSELS[fleet.active].flies ? this.s.flightMode : "rocket";
}

/**
 * The local frame the sci-fi computer flies in, both universes: up, north, east (the frame's own
 * components — home, or the planet's turning axes), the velocity over the ground [m/s], the height
 * over it [m], what holds the craft (gravity and the frame, the air) [m/s²], and the conversions to
 * the pilot's local components. Null away from any ground or air.
 */
/**
 * The local vertical and north (home frame, unit) near a world — ours (in its sphere of influence, not
 * the Sun) or one of Gargantua's —, at any height: the HUD's horizon, pitch ladder and heading. Null
 * elsewhere (the hole itself, interplanetary space).
 */
function horizonAxes(this: CameraController, cam: ReturnType<typeof cameraFrame>): { up: Vec3; north: Vec3 } | null {
  const nav = this.ourNav(cam);
  if (nav) {
    const id = nav.ref;
    if (id === "sun" || !solarBody(id)) return null;
    const up = unitV(sub3(nav.X, nav.refPos));
    const ax = spinAxis(id);
    let north = lin(ax, 1, up, -dot3(ax, up));
    if (Math.hypot(...north) < 1e-9) north = lin([0, 0, 1], 1, up, -up[2]);
    return { up: unitV(nav.toRep(up)), north: unitV(nav.toRep(unitV(north))) };
  }
  const lf = this.local;
  if (!lf || cam.region !== "hole") return null;
  const xi = lf.L.xi;
  const d = Math.hypot(...xi);
  const up: Vec3 = [xi[0] / d, xi[1] / d, xi[2] / d];
  let north: Vec3 = lin([0, 0, 1], 1, up, -up[2]);
  if (Math.hypot(...north) < 1e-9) north = [1, 0, 0];
  return { up: unitV(localToZamo(up)), north: unitV(localToZamo(unitV(north))) };
}

function sfFrame(this: CameraController, cam: ReturnType<typeof cameraFrame>) {
  const c = C_MPS;
  const nav = this.ourNav(cam);
  const LA = this.airFlight.last;
  if (nav) {
    const id = nav.ref;
    const b = solarBody(id);
    if (id === "sun" || !b) return null;
    const P = nav.refPos;
    const up = unitV(sub3(nav.X, P));
    const ax = spinAxis(id);
    let north = lin(ax, 1, up, -dot3(ax, up));
    if (Math.hypot(...north) < 1e-9) north = lin([0, 0, 1], 1, up, -up[2]);
    north = unitV(north);
    const east = cross(north, up);
    const gv = groundVelocity(id, nav.X, nav.t);
    const vRel = lin(sub3(nav.V, gv), c, nav.V, 0);
    const h = solidBody(id) ? gearHeight(id, nav.X, nav.t) : (Math.hypot(...sub3(nav.X, P)) - b.radius) * M_METRES;
    const top = Math.max(airTop(b.atmosphere), 100e3, 0.1 * b.radius * M_METRES);
    if (h > top) return null;
    const aU = (c * c) / M_METRES;
    const grav = lin(gravityHome(nav.X, nav.t).acc, aU, up, 0);
    const air = LA ? this.airFlight.accFrame : ([0, 0, 0] as Vec3);
    const w = mouth(this.s).w;
    return {
      up,
      north,
      east,
      vRel,
      h,
      grav,
      air,
      g: Math.hypot(...grav),
      out: (vWant: Vec3, ff: Vec3) => ({ beta: nav.toRep(lin(gv, 1, vWant, 1 / c)), ff: nav.toRep(lin(ff, 1 / aU, ff, 0)) }),
      toLocal: (v: Vec3) => unitV(nav.toRep(v)),
      fromLocal: (v: Vec3) => unitV(repToHomeVec(w, cam.ell, cam.n, v)),
    };
  }
  const lf = this.local;
  if (!lf || cam.region !== "hole") return null;
  const { F, L } = lf;
  const d = Math.hypot(...L.xi);
  const up: Vec3 = [L.xi[0] / d, L.xi[1] / d, L.xi[2] / d];
  let north: Vec3 = lin([0, 0, 1], 1, up, -up[2]);
  if (Math.hypot(...north) < 1e-9) north = [1, 0, 0];
  north = unitV(north);
  const east = cross(north, up);
  const h = (d - groundR(F, L.xi)) * F.mPerM - GEAR;
  const grav = lin(
    localAccel(F, L.xi, L.w, [0, 0, 0], () => [0, 0, 0]),
    F.aUnit,
    up,
    0,
  );
  const air = LA ? this.airFlight.accFrame : ([0, 0, 0] as Vec3);
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  return {
    up,
    north,
    east,
    vRel: lin(L.w, c, up, 0),
    h,
    grav,
    air,
    g: Math.hypot(...grav),
    out: (vWant: Vec3, ff: Vec3) => {
      const gW = toGlobal(F, { xi: L.xi, w: lin(vWant, 1 / c, vWant, 0), landed: false });
      return { beta: zamoBeta(X, gW.V, this.s.spin), ff: localToZamo(lin(ff, 1 / F.aUnit, ff, 0)) };
    },
    toLocal: (v: Vec3) => unitV(localToZamo(v)),
    fromLocal: (v: Vec3) => unitV(zamoToLocal(v)),
  };
}

/**
 * The sci-fi flight computer: the stick and the throttle are its commands — the speed (the throttle:
 * faster, slower; 0: a hover), the flight path's angle (pitch), the heading (yaw), a sideways slide
 * (roll), the translation keys on top — and it flies the velocity they make with the thrust it has
 * (or, the antigravity on, holds against gravity and the air for free). It keeps off the ground (a
 * descent near it slowed to a touchdown's), turns its nose along the way, banks into the turns.
 */
function sfWant(this: CameraController, cam: ReturnType<typeof cameraFrame>, inp: PilotInput, dt: number) {
  const fr = this.sfFrame(cam);
  if (!fr) return null;
  const { up, north, east, vRel } = fr;
  const sp = Math.hypot(...vRel);
  const vUp = dot3(vRel, up);
  const vh = lin(vRel, 1, up, -vUp);
  if (!this.sfCmd) {
    const nose = fr.fromLocal(this.shipAxesLocal(cameraFrame(this.s))[2]);
    const hd = Math.hypot(...vh) > 1 ? vh : nose;
    this.sfCmd = {
      speed: sp,
      gamma: sp > 1 ? Math.asin(clamp(vUp / sp, -1, 1)) : 0,
      heading: Math.atan2(dot3(hd, east), dot3(hd, north)),
    };
  }
  const C = this.sfCmd;
  C.speed = Math.max(0, C.speed + inp.throttle * Math.max(15, 0.8 * C.speed) * dt);
  C.gamma = clamp(C.gamma + inp.pitch * 0.45 * dt, -1.45, 1.45);
  const turn = inp.yaw * 0.6;
  C.heading += turn * dt;
  const hdir = lin(north, Math.cos(C.heading), east, Math.sin(C.heading));
  const right = cross(hdir, up);
  const side = inp.roll * Math.max(15, 0.2 * C.speed);
  let v = lin(
    lin(hdir, C.speed * Math.cos(C.gamma) + inp.tz * 15, up, C.speed * Math.sin(C.gamma) + inp.ty * 15),
    1,
    right,
    side + inp.tx * 15,
  );
  // (near the ground a descent slows to a touchdown's: never into it)
  if (fr.h < 80) {
    const vmin = -Math.max(0.8, 0.25 * Math.max(fr.h, 0));
    const vu = dot3(v, up);
    if (vu < vmin) v = lin(v, 1, up, vmin - vu);
  }
  let ff = lin(fr.grav, -1, fr.air, -1);
  let free: Vec3 = [0, 0, 0];
  if (this.s.antigrav) [free, ff] = [ff, [0, 0, 0]];
  const o = fr.out(v, ff);
  // the attitude: the nose along the way (level when slow), banked into the turn
  const vl = Math.hypot(...v);
  const wv = smoothstep(clamp((vl - 3) / 9, 0, 1));
  let nose = vl > 1e-3 ? unitV(lin(hdir, 1 - wv, v, wv / vl)) : hdir;
  if (Math.hypot(...nose) < 1e-6) nose = hdir;
  const bank = clamp(Math.atan((C.speed * turn) / Math.max(fr.g, 0.1)), -1, 1) * wv;
  const u0 = unitV(lin(up, 1, nose, -dot3(up, nose)));
  const rN = cross(nose, u0);
  const upB = lin(u0, Math.cos(bank), rN, Math.sin(bank));
  return { beta: o.beta, ff: o.ff, free: fr.out([0, 0, 0], free).ff, nose: fr.toLocal(nose), up: fr.toLocal(upB) };
}

/**
 * The frame an entry is flown in, both universes (entry.ts EntryEnv): body-centred, SI — our side
 * the home axes (the ground turning in them), Gargantua's worlds their own turning frames (the ground
 * at rest) — the state, where a site is now, the conversions to the pilot's local components.
 */
function entryFrame(this: CameraController, cam: ReturnType<typeof cameraFrame>) {
  const c = C_MPS;
  const Msec = 4.925490947e-6 * this.s.massSolar;
  const nav = this.ourNav(cam);
  if (nav) {
    const id = nav.ref;
    const b = solarBody(id);
    if (!b || id === "sun" || b.kind === "star") return null;
    const desc: EnvDesc = { universe: "ours", body: id, t: nav.t, massSolar: this.s.massSolar };
    const env = envOf(desc)!;
    const st: EntryState = { x: lin(sub3(nav.X, nav.refPos), M_METRES, nav.X, 0), v: lin(sub3(nav.V, nav.refVel), c, nav.V, 0) };
    const w0 = mouth(this.s).w;
    return {
      env,
      desc,
      s: st,
      body: id,
      now: nav.t * Msec,
      place: (site: Site) => lin(sub3(fromBodyFixed(id, bodyFixedOf(id, site.lat, site.lon, 0), nav.t), nav.refPos), M_METRES, nav.X, 0),
      toLocal: (v: Vec3) => unitV(nav.toRep(v)),
      fromLocal: (v: Vec3) => unitV(repToHomeVec(w0, cam.ell, cam.n, v)),
    };
  }
  const lf = this.local;
  if (!lf || cam.region !== "hole") return null;
  const { F, L } = lf;
  const desc: EnvDesc = { universe: "gargantua", body: F.id, t: this.nowTime(), spin: this.s.spin, massSolar: this.s.massSolar };
  const env = envOf(desc)!;
  return {
    env,
    desc,
    s: { x: lin(L.xi, F.mPerM, L.xi, 0), v: lin(L.w, c, L.w, 0) } as EntryState,
    body: F.id as string,
    now: this.nowTime() * Msec,
    place: (site: Site) => lin(siteDir(site), F.R * F.mPerM, L.xi, 0),
    toLocal: (v: Vec3) => unitV(localToZamo(v)),
    fromLocal: (v: Vec3) => unitV(zamoToLocal(v)),
  };
}

/** The craft as the entry flies it: its aerodynamics, the assembly's mass, its angle of attack (the
 *  Ranger 40°, a lifting body's; the Lander 65°, its shield to the flow). */
function entryCraft(this: CameraController): EntryCraft {
  const D = Math.PI / 180;
  return { aero: VESSELS[fleet.active].aero, mass: fleet.massProps().mass, alpha: (fleet.active === "ranger" ? 40 : 65) * D };
}

/**
 * The entry autopilot, a frame: from orbit the deorbit (planned when engaged: the burn's time and
 * size for the site; waiting retrograde, the time sped up; the burn), then the guided entry (the
 * angle of attack held, the bank from the guidance), then — slow — the Ranger's glide to the site
 * (the bank onto it, the climb angle down a glide path, the flare) or the Lander's powered landing.
 * The attitude it asks (local), and the throttle for the burn. Null: off (said why).
 */
function entryStep(
  this: CameraController,
  cam: ReturnType<typeof cameraFrame>,
  dt: number,
): { nose: Vec3; up: Vec3; throttle?: number } | null {
  const s = this.s;
  const P = this.pilot;
  const say = (t: string) => {
    P.setAuto("none");
    this.entryRun = null;
    this.onPilotMessage?.(t);
    return null;
  };
  const V = VESSELS[fleet.active];
  if (!V.flies) return say(tf("Entry: the {0} has no heat shield — it was built in orbit and never comes down", V.name));
  const fr = this.entryFrame(cam);
  if (!fr || (!fr.env.atm && !solidBody(fr.body))) return say(t("Entry: get near a world with air or ground first"));
  const craft = this.entryCraft();
  const Msec = 4.925490947e-6 * s.massSolar;
  const up = unitV(fr.s.x);
  const va = sub3(fr.s.v, fr.env.ground(fr.s.x));
  const h = heightOf(fr.env, fr.s.x);
  const top = airTop(fr.env.atm);
  const ranger = fleet.active === "ranger";
  const name = BODY_NAMES[fr.body as Body] ?? fr.body;
  if (!this.entryRun) {
    // the site: the one chosen on this body, else the nearest to the orbit's plane (the ground track
    // sweeps over it soonest)
    const sites = sitesOf(fr.body);
    let site = this.entrySite && this.entrySite.body === fr.body ? this.entrySite : null;
    if (!site && sites.length) {
      const n = unitV(cross(fr.s.x, fr.s.v));
      site = sites.reduce((a, b) => (Math.abs(dot3(unitV(fr.place(b)), n)) < Math.abs(dot3(unitV(fr.place(a)), n)) ? b : a));
    }
    const handover = ranger ? 2.5 : 1.4;
    const shortM = ranger ? 90e3 : 8e3;
    this.entryRun = {
      phase: "entry",
      site,
      tBurn: 0,
      dv: 0,
      done: 0,
      guid: site ? new EntryGuidance({ handoverMach: handover, short: shortM }) : null,
      bank: 0,
      next: -Infinity,
      alpha: craft.alpha,
      gPrev: null,
      short: shortM,
      handover,
    };
    if (!fr.env.atm) return say(tf("Entry: {0} has no air — land with the engines (G)", name));
    if (h > top) {
      // in orbit: the deorbit planned (to the site's downrange; without a site, a nominal burn now)
      if (!site) return say(tf("Entry: no landing site on {0} — fly the entry by hand (F: the plane law holds α hypersonic)", name));
      // (planned in the planner's worker: a second of predicted falls, off the frame loop)
      const R = this.entryRun;
      R.phase = "plan";
      const at = fr.now;
      this.onPilotMessage?.(tf("Entry to {0}: planning the deorbit…", site.name));
      void runPlanner<{ t: number; dv: number; heat: number; shield: number; g: number } | null>({
        kind: "deorbit",
        env: fr.desc,
        craft,
        s: fr.s,
        place: fr.place(site),
        o: { peH: ranger ? 45e3 : 30e3, handoverMach: handover, short: shortM, orbits: 16, reach: ranger ? 600e3 : 150e3 },
      }).then((plan) => {
        if (this.entryRun !== R || R.phase !== "plan") return;
        if (!plan || (plan as { error?: string }).error) {
          if (P.auto === "entry") P.setAuto("none");
          this.entryRun = null;
          this.onPilotMessage?.(tf("Entry: no deorbit to {0} within a day of orbits — the orbit never passes near it", site.name));
          return;
        }
        R.phase = "wait";
        R.tBurn = at + plan.t;
        R.dv = plan.dv;
        R.plan = { heat: plan.heat, shield: plan.shield, g: plan.g };
        const wait = R.tBurn - this.nowTime() * Msec;
        const mm = Math.floor(wait / 60),
          ss = Math.round(wait % 60);
        this.onPilotMessage?.(
          tf(
            "Entry to {0}: the deorbit burn in {1} min {2} s, {3} m/s — then {4} W/cm², {5} g, the shield {6} K at most",
            site.name,
            mm,
            ss,
            plan.dv.toFixed(0),
            (plan.heat / 1e4).toFixed(0),
            plan.g.toFixed(1),
            Math.round(plan.shield),
          ),
        );
      });
    } else
      this.onPilotMessage?.(
        site ? tf("Entry: guided to {0}", site.name) : tf("Entry: no site on {0} — lift up, the controls yours when slow", name),
      );
  }
  const R = this.entryRun!;
  const retro = () => ({ nose: fr.toLocal(lin(va, -1, va, 0)), up: fr.toLocal(up) });
  if (R.phase === "plan") return retro();
  if (R.phase === "wait" || R.phase === "burn") {
    const thrSI = this.thrustMax() * (C_MPS ** 2 / (1476.625 * s.massSolar));
    const burnT = thrSI > 0 ? R.dv / thrSI : 0;
    const left = R.tBurn - burnT / 2 - fr.now;
    if (R.phase === "wait") {
      // (the time sped up to a minute before the burn, then real time)
      const want = left > 40 ? Math.min(1000, Math.max((left - 25) / 3, 1)) : 1;
      this.warpWant = null;
      s.timeSpeed = this.warpSet = want / Msec;
      if (left <= 0) {
        R.phase = "burn";
        R.done = 0;
        this.warpWant = null;
        s.timeSpeed = this.warpSet = 1 / Msec;
        this.onPilotMessage?.(tf("Deorbit burn: {0} m/s retrograde", R.dv.toFixed(0)));
      }
      return retro();
    }
    // (burning: real time, every frame — a sped-up frame would fire seconds of thrust at once)
    this.warpWant = null;
    s.timeSpeed = this.warpSet = 1 / Msec;
    if (R.done >= R.dv) {
      R.phase = "entry";
      this.onPilotMessage?.(tf("Deorbit burn done ({0} m/s) — falling to the entry", R.done.toFixed(0)));
    } else return { ...retro(), throttle: Math.min(1, Math.max((R.dv - R.done) / Math.max(thrSI * 0.25, 1e-9), 0.02)) };
  }
  const LA = this.airFlight.last;
  if (R.phase === "entry") {
    // (falling to the air: the time sped up to some twenty seconds before its entry interface — the
    // air holds it at ×4 below)
    const ei = entryInterface(fr.env.atm);
    if (h > ei) {
      const vr = dot3(fr.s.v, up);
      const tEI = vr < 0 ? (h - ei) / -vr : Infinity;
      this.warpWant = null;
      s.timeSpeed = this.warpSet = (Number.isFinite(tEI) ? Math.min(500, Math.max(1, (tEI - 20) / 4)) : 100) / Msec;
    } else if (Math.abs(s.timeSpeed * Msec - AIR_WARP) > 1e-6) {
      // (the entry flown at ×4)
      this.warpWant = null;
      s.timeSpeed = this.warpSet = AIR_WARP / Msec;
    }
    // the guidance: the bank, every second of the fall (the site carried by the ground)
    // (each update predicts the rest of the fall — tens of ms: about once a second of the wall's)
    const wall = frameNow() / 1000;
    if (R.guid && R.site && wall >= R.next && !R.pending) {
      // (in the planner's worker: the next bank arrives a few frames on)
      const G = R.guid;
      R.pending = true;
      R.next = wall + 1;
      void runPlanner<{
        out: number;
        bank: number;
        sign: number;
        prev: { b: number; e: number } | null;
        miss: EntryGuidance["lastMiss"];
        path: Vec3[] | null;
      } | null>({
        kind: "guide",
        env: fr.desc,
        craft,
        s: fr.s,
        place: fr.place(R.site),
        g: { bank: G.bank, sign: G.sign, prev: G.prev, o: G.o },
      }).then((r) => {
        R.pending = false;
        if (this.entryRun !== R || !r || (r as { error?: string }).error) return;
        Object.assign(G, { bank: r.bank, sign: r.sign, prev: r.prev, lastMiss: r.miss });
        G.last = { path: r.path ?? [] } as unknown as EntryResult;
        R.bank = r.out;
      });
    }
    if (LA && LA.out.mach < R.handover && LA.h < top * 0.5) {
      if (!R.site) return say(tf("Entry done over {0}: Mach {1}, the controls are yours", name, LA.out.mach.toFixed(1)));
      if (!ranger) {
        // (the Lander: its engines bring it down, the speed killed)
        P.auto = "none";
        P.setAuto("land");
        this.entryRun = null;
        this.onPilotMessage?.(tf("Entry done: Mach {0} — the engines land the Lander", LA.out.mach.toFixed(1)));
        return null;
      }
      R.phase = "glide";
      R.alpha = LA.out.alpha;
      this.onPilotMessage?.(tf("Mach {0}: gliding to {1}", LA.out.mach.toFixed(1), R.site.name));
    }
    const ax = attitudeFor(fr.s.x, this.airVelocity(va), craft.alpha, R.bank);
    return { nose: fr.toLocal(ax[2]), up: fr.toLocal(ax[1]) };
  }
  // the glide (the Ranger): onto the runway's axis — a point 12 km before its threshold, then the
  // final along it (the cross-track error banked out) — down a glide path, the flare
  const site = R.site!;
  if (site.rwy !== undefined) return this.approach(fr, R, site, va, up, h, dt, cam);
  const pl = fr.place(R.site!);
  const pu = unitV(pl);
  const ang = Math.acos(clamp(dot3(up, pu), -1, 1));
  const dist = ang * fr.env.R;
  const vh = unitV(lin(va, 1, up, -dot3(va, up)));
  const tdir = unitV(lin(pu, 1, up, -dot3(pu, up)));
  const dpsi = Math.atan2(-dot3(cross(vh, tdir), up), dot3(vh, tdir));
  const sp = Math.hypot(...va);
  const agl = this.aglNow(cam, h);
  const bank = clamp(1.4 * dpsi, -0.6, 0.6) * (agl < 150 ? agl / 150 : 1);
  const gam = Math.asin(clamp(dot3(va, up) / Math.max(sp, 1e-9), -1, 1));
  const gRef = flareRef(R, agl, clamp(-Math.atan2(agl, Math.max(dist - 2000, 1500)), -0.35, -0.035), sp, gam);
  const gdot = R.gPrev !== null && dt > 0 ? (gam - R.gPrev) / dt : 0;
  R.gPrev = gam;
  const stall = (V.aero.wing?.stall ?? 0.35) - 0.05;
  R.alpha = this.glideAlpha(R, gRef, gam, gdot, sp, bank, agl, dt, stall, R.flareTau !== undefined ? 1.1 : agl > 600 ? 1.6 : 1.35);
  // (too fast down the path: the air brake)
  const vT = Math.min(110 + 0.004 * dist, 320);
  this.airBrake = clamp((sp - vT) / 60, 0, 1);
  const ax = attitudeFor(fr.s.x, this.airVelocity(va), R.alpha, bank);
  return { nose: fr.toLocal(ax[2]), up: fr.toLocal(ax[1]) };
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installPiloting(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    setPilot,
    newFlight,
    stepOffMount,
    standOn,
    placeShipRep,
    moveOutside,
    setLookRaw,
    markLook,
    syncLook,
    setLook,
    resetShipView,
    cycleMount,
    shipPose,
    outsideView,
    aimShipViews,
    flybyStep,
    refBeta,
    mountTarget,
    settleMount,
    stepMount,
    reorient,
    shipMatrix,
    levelShip,
    shipAxesLocal,
    rotateC,
    pilotInput,
    flyShip,
    airAfter,
    dragPerMass,
    flightModeNow,
    horizonAxes,
    sfFrame,
    sfWant,
    entryFrame,
    entryCraft,
    entryStep,
  });
}
