import {
  basis, blToCartesian, cameraFrame, repPose, repToHolePose, setHolePose, setRepPose, switchAnchor, yawPitchRoll,
} from "./camera";
import { horizon, isco, photonOrbits, zamo, type Vec3 } from "./physics";
import type { Settings, Target } from "./settings";
import {
  aimFrame, angularRadius, availableBodies, bodyCentre, bodyDistance, bodyLook, BODY_NAMES, cameraPosition, composeOffset, offsetFrom, pick,
  pixelLook, QUAT_ID, quatAngle, slerp, starCentre, starOmega, starPhase, starVelocity, type Body, type Quat,
  baryFraction, barycentreVelocity, holeAcceleration, starOrbitRadius,
} from "./targeting";
import { advance, fromZamo, predict, step as geoStep, toZamo, type Lens } from "./geodesic";
import { circularSpeed, FlightComputer, toU, type PilotInput } from "./pilot";
import { MOUNT_KEYS, MOUNTS, shipToCamera, type M3, type Mount, type MountPose } from "./mounts";
import { GamepadInput, type PadAction } from "./gamepad";
import { ellOfR, flyDneg, holeToRep, mouth, radius, repToHole, sphericalFrame, toMouth } from "./wormhole";

type Cinematic = "orbit" | "dive" | "journey" | null;
type PoseKeys = "anchor" | "whL" | "distance" | "inclination" | "azimuth" | "yaw" | "pitch" | "roll";
const POSE_KEYS: PoseKeys[] = ["anchor", "whL", "distance", "inclination", "azimuth", "yaw", "pitch", "roll"];

/**
 * Free-flight keys, by physical position (KeyboardEvent.code) so that they are Z Q S D / A E / W X on
 * a French AZERTY keyboard and W A S D / Q E / Z X on QWERTY. They are reserved for flight: no other
 * shortcut uses them.
 */
export const FLIGHT_KEYS: Record<string, [number, number, number, number]> = {
  // [forward, right, up, roll]
  KeyW: [1, 0, 0, 0], // Z (AZERTY): forward
  KeyS: [-1, 0, 0, 0], // S: backward
  KeyA: [0, -1, 0, 0], // Q (AZERTY): left
  KeyD: [0, 1, 0, 0], // D: right
  KeyE: [0, 0, 1, 0], // E: up
  KeyQ: [0, 0, -1, 0], // A (AZERTY): down
  KeyZ: [0, 0, 0, 1], // W (AZERTY): roll left
  KeyX: [0, 0, 0, -1], // X: roll right
};

/**
 * Camera interaction. Two rotation modes (settings.rotation):
 *  - orbit: drag turns around the target body (the hole, the star, the wormhole), the wheel sets
 *    the distance to it, and the camera keeps aiming at its apparent image (lensed, light-delayed,
 *    aberrated; see targeting.ts) with a user offset (right-drag). Orbiting the star follows it
 *    along its orbit, co-moving. Selecting a body turns the view to it smoothly (quaternion slerp).
 *  - free: drag turns the camera about itself, right-drag rolls, the wheel dollies.
 * Clicking a body's image selects it; double-clicking flies the view to it and frames it.
 * Also: momentum, smooth logarithmic zoom, pinch zoom, keyboard, and cinematic modes:
 *  - orbit: the observer circles the hole (azimuth drift)
 *  - dive: exact free fall from rest at infinity (E = 1, L = Q = 0) integrated in proper time,
 *          seen from the infalling ("rain") frame; ends just outside the horizon.
 *  - journey: through Interstellar's wormhole, from our side to the black hole (or back).
 * Free flight with six degrees of freedom (FLIGHT_KEYS: translations along the camera's axes and roll;
 * right-drag turns the camera about its own axes, without limit) follows straight lines: spatial
 * geodesics of the wormhole metric near it (so it can cross the throat), flat lines near the hole.
 */
export class CameraController {
  cinematic: Cinematic = null;
  /** Input is ignored while disabled (e.g. during an offline render). */
  enabled = true;
  private vAz = 0; // °/s
  private vInc = 0;
  private vYaw = 0;
  private vPitch = 0;
  private targetDistance: number;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragLook = false;
  private lastMove = 0;
  private pinchDist = 0;
  private keys = new Set<string>();
  private codes = new Set<string>();
  private diveSaved: Partial<Settings> | null = null;
  private diveHold = 0;
  private targetL: number;
  /** Game-style flight: pointer locked, the mouse turns the camera, the wheel sets the speed. */
  flyMode = false;
  /** Speed multiplier of free flight (wheel in fly mode). */
  flySpeed = 1;
  /** Gravity: the camera is a massive body following Kerr geodesics; the flight keys thrust. */
  gravity = false;
  /** Current flight velocity in the camera's axes (forward, right, up), in units of the distance scale per second. */
  private flyVel: Vec3 = [0, 0, 0];
  /** Last free-fall prediction for the overlay (dt: coordinate time between points [M]). */
  path: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole" | "star"; at: number; dt: number } | null = null;
  /** Piloting the Ranger (on whenever the ship is): the flight computer and its last outputs. */
  readonly pilot = new FlightComputer();
  piloting = false;
  /** Pilot messages (autopilot engaged, impossible manoeuvre…) for the app to show. */
  onPilotMessage?: (text: string) => void;
  /** The camera's place on the ship: moves smoothly (0.6 s) from one attach point to the next. */
  private mountEff: MountPose | null = null;
  private mountAnim: { from: MountPose; t: number } | null = null;
  private lastMount = "";
  /** The pose used for the previous frame (a new attach point starts from it). */
  private lastPose: MountPose | null = null;
  /** Last autopilot goal and its velocity change still to make (|ΔU|), for the displays. */
  private lastWant: { beta: Vec3; ff: Vec3 } | null = null;
  private pathKey = "";
  /** With gravity on: the camera stands on the star's surface. */
  landed = false;
  /** Proper time elapsed on the camera's clock while gravity is on [M]. */
  properTime = 0;
  private journey: { t: number; dir: "out" | "back"; start: Pick<Settings, PoseKeys> } | null = null;
  /** Body under the mouse pointer (canvas CSS pixels), for the hover label. */
  hover: { body: Body; x: number; y: number } | null = null;
  /** Last user interaction with the camera (performance.now()), to show / fade the target marker. */
  activity = -1e9;
  /** Game controller: the sticks and triggers fly and turn like the keys; buttons go to the app. */
  readonly pad = new GamepadInput();
  onPadAction?: (a: PadAction) => void;
  private lastSide = 0;
  private hoverAt = 0;
  private down: { x: number; y: number; t: number } | null = null;
  /** Scene time of this update and of the previous one [M] (the star moves). */
  private time = NaN;
  private prevTime = NaN;
  /** Orbit mode: the camera's orientation relative to the aim at the target. */
  private offset: Quat | null = null;
  /** yaw/pitch/roll as last written by the tracking (any other change updates the offset). */
  private written = "";
  /** Smooth turn of the view to the target (offset → identity). */
  private focus: { from: Quat; t: number; dur: number } | null = null;
  private aimCache: { body: Body; key: string; look: Vec3; lensed: boolean } | null = null;
  /** Orbiting the star: wheel target distance, pending drag increments (°), co-moving fraction. */
  private followD: number | null = null;
  private followOrbit: [number, number] = [0, 0];
  private leveling = false;
  /**
   * Flight to a framing position around the star or the mouth: along an arc around the body (its
   * frame: co-rotating for the star), direction n0 → n1 and distance d0 → d1 (log), eased.
   */
  private flight: { body: Body; t: number; dur: number; C: Vec3; n0: Vec3; n1: Vec3; d0: number; d1: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private s: Settings,
    private onCinematicChange: (mode: Cinematic) => void,
  ) {
    this.targetDistance = s.distance;
    this.targetL = s.whL;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("dblclick", this.onDblClick);
    canvas.addEventListener("pointerleave", () => this.setHover(null));
    document.addEventListener("pointerlockchange", () => {
      this.flyMode = document.pointerLockElement === canvas;
      this.onCinematicChange(this.cinematic);
    });
    // fly mode: the mouse turns the camera like in a game (right = turn right, up = look up)
    document.addEventListener("mousemove", (e) => {
      if (!this.flyMode || !this.enabled) return;
      const k = 0.12 * Math.min(1, this.s.fov / 60);
      this.rotateView(e.movementX * k, -e.movementY * k, 0);
    });
    addEventListener("keydown", (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.metaKey || e.ctrlKey) return;
      this.keys.add(e.key);
      this.codes.add(e.code);
    });
    addEventListener("keyup", (e: KeyboardEvent) => {
      this.keys.delete(e.key);
      this.codes.delete(e.code);
    });
    addEventListener("blur", () => {
      this.keys.clear();
      this.codes.clear();
    });
  }

  /** Call after the distance was changed from elsewhere (GUI, preset). */
  sync() {
    this.targetDistance = this.s.distance;
    this.targetL = this.s.whL;
    this.followD = null;
    this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
  }

  /** The camera orbits the wormhole (its distance is ℓ) rather than the hole. */
  private get aroundWormhole() {
    return this.s.wormhole && this.s.anchor === "wormhole";
  }

  /** Orbit: turns the view back onto the target. Free: levels the horizon (roll → 0). */
  resetView() {
    this.vYaw = this.vPitch = 0;
    if (this.tracking) this.startFocus();
    else this.leveling = true;
  }

  // ------------------------------------------------------------------------------ rotation modes
  /** Orbit mode drives the view (not during the dive, the journey or game-style flight). */
  private get tracking() {
    return this.s.rotation === "orbit" && !this.flyMode && this.cinematic !== "dive" && this.cinematic !== "journey";
  }
  /** Drags move the camera around the target (not while it falls freely). */
  private get orbiting() {
    return this.tracking && !this.gravity;
  }

  setRotation(mode: Settings["rotation"]) {
    this.s.rotation = mode;
    this.activity = performance.now();
    if (mode === "free" && this.cinematic === "orbit") this.setCinematic(null);
    if (mode === "orbit") this.startFocus();
    this.onCinematicChange(this.cinematic);
  }

  /** Bodies that can be selected from where the camera is. */
  availableTargets(): Body[] {
    return availableBodies(this.s, cameraFrame(this.s));
  }

  /**
   * Selects the body to orbit / aim at. focus: turn the view to it; frame: also move to a distance
   * that frames it. Returns false if it is not in the camera's universe.
   */
  selectTarget(body: Target, o: { focus?: boolean; frame?: boolean } = {}) {
    const s = this.s;
    if (!this.availableTargets().includes(body)) return false;
    const changed = s.target !== body;
    s.target = body;
    this.activity = performance.now();
    this.aimCache = null;
    this.followD = null;
    if (changed && this.cinematic === "orbit") this.sync();
    if (this.tracking) {
      this.ensureAnchor();
      if (o.frame) this.frameTarget();
      if (o.focus !== false) this.startFocus();
    }
    this.onCinematicChange(this.cinematic);
    return true;
  }

  /** Next / previous available body (Tab / Shift+Tab). */
  cycleTarget(dir: 1 | -1 = 1) {
    const list = this.availableTargets();
    const i = list.indexOf(this.s.target);
    this.selectTarget(list[(i + dir + list.length) % list.length]!);
  }

  /** The body seen at a point of the canvas (CSS pixels), if any and selectable. */
  pickAt(x: number, y: number): Body | null {
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
  targetInfo() {
    const s = this.s;
    const cam = cameraFrame(s);
    const aim = this.aim(cam);
    if (!aim) return null;
    const dist = bodyDistance(s, cam, s.target, this.nowTime());
    return { body: s.target, name: BODY_NAMES[s.target], look: aim.look, lensed: aim.lensed, dist, ang: angularRadius(s, s.target, dist), cam };
  }

  private nowTime() {
    return Number.isFinite(this.time) ? this.time : 0;
  }

  /** Apparent direction of the target (cached; warm-started from the last answer). */
  private aim(cam: ReturnType<typeof cameraFrame>) {
    const s = this.s;
    const body = s.target;
    const t = body === "star" || body === "barycentre" ? this.nowTime() : 0;
    const key = [
      body, cam.region, cam.r, cam.theta, cam.phi, cam.ell, ...cam.n, ...cam.beta, t, s.spin, s.sun, s.sunOrbit, s.sunRadius,
      s.sunPhase, s.wormhole, s.whDist, s.whIncl, s.whAzimuth, s.whRho, s.disk, s.diskOuter,
    ].join();
    if (this.aimCache?.key === key) return this.aimCache;
    const guess = this.aimCache?.body === body ? this.aimCache.look : null;
    const r = bodyLook(s, cam, body, t, guess);
    this.aimCache = { body, key, ...r };
    return this.aimCache;
  }

  /** Smooth turn of the view onto the target (duration grows with the angle). */
  private startFocus() {
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
  private frameTarget() {
    const s = this.s;
    const half = (s.fov * DEG) / 2;
    const body = s.target;
    // (the centre of mass: frame the whole system, the star's orbit)
    const R = body === "hole" ? 3 * Math.sqrt(3) : body === "star" ? s.sunRadius : body === "barycentre" ? 1.15 * starOrbitRadius(s) : 1.6 * mouth(s).w.rho;
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
    const d1 = body === "star" ? Math.max(d, 1.3 * s.sunRadius) : body === "barycentre" ? clamp(d, 10, 2000) : clamp(d, mouth(s).rGlue * 1.05, 2000);
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
  private clearDirection(C: Vec3, n0: Vec3, d: number): Vec3 {
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
  private stepFlight(dt: number) {
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
  private ensureAnchor() {
    const s = this.s;
    if (!s.wormhole) return;
    const want = s.target === "wormhole" ? "wormhole" : "hole";
    if (s.anchor === want) return;
    if (!switchAnchor(s, want)) s.target = "wormhole";
    this.targetDistance = s.distance;
    this.targetL = s.whL;
    this.written = "";
  }

  /** Camera components → components in the frame where basis(yaw, pitch, roll) is defined. */
  private toLocal(cam: ReturnType<typeof cameraFrame>, v: Vec3): Vec3 {
    const s = this.s;
    const b = basis(s.yaw, s.pitch, s.roll);
    return add3(b.right, b.up, b.fwd, [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)]);
  }

  /** Orbit increments (degrees of azimuth and inclination) around the target. */
  private orbitBy(dAz: number, dInc: number) {
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
  private track(dt: number) {
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
    this.written = [s.yaw, s.pitch, s.roll].join();
  }

  /** Closest the camera may orbit the followed body. */
  private followMin() {
    const s = this.s;
    return s.target === "star" ? 1.3 * s.sunRadius : 2;
  }

  /**
   * Orbiting the star or the centre of mass: the camera keeps its position relative to the body —
   * in the star's rotating frame (it follows it along its orbit), or in the non-rotating frame of
   * the centre of mass (at rest in it: Gargantua and the star turn around it) — plus the drag
   * increments and the eased wheel distance.
   */
  private followBody(dt: number) {
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
  private baryRest() {
    const s = this.s;
    if (!baryFraction(s) || this.gravity || this.cinematic === "dive" || this.cinematic === "journey" || s.anchor !== "hole") return false;
    if (cameraFrame(s).region !== "hole") return false;
    return s.rotation === "free" || this.flyMode || (this.orbiting && s.target === "barycentre");
  }

  /** Free camera at rest in the centre-of-mass frame: in the hole's frame it drifts by ΔB. */
  private driftWithBarycentre() {
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
  private updateMotion(dt: number) {
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

  /** The star as a gravitating body for the camera's geodesic (none when massless or off). */
  private lens(): Lens | undefined {
    const s = this.s;
    if (!s.sun || !(s.sunMass > 0)) return undefined;
    const D3 = starOrbitRadius(s) ** 3;
    return {
      m: s.sunMass, R: s.sunRadius, centre: (t) => starCentre(s, t), velocity: (t) => starVelocity(s, t),
      // Gargantua orbits the centre of mass: its frame falls towards the star
      accel: (t) => holeAcceleration(s, t),
      accelRate: (t) => lin(starVelocity(s, t), s.sunMass / D3, [0, 0, 0], 0),
    };
  }

  /** Co-moving with the star (for the HUD). */
  get riding() {
    return this.s.motion === "comoving" ? 1 : 0;
  }


  /**
   * Turns the camera about its own axes (degrees): towards its right, towards its up, and a roll
   * (positive: counter-clockwise). No gimbal limit: looping over the top works.
   */
  rotateView(dRight: number, dUp: number, dRoll: number) {
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

  setCinematic(mode: Cinematic) {
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

  private endDive() {
    if (this.diveSaved) Object.assign(this.s, this.diveSaved);
    this.diveSaved = null;
    this.sync();
  }

  /** Enters/leaves game-style flight (pointer lock; Esc also leaves). */
  setFlyMode(on: boolean) {
    if (on && document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
    if (!on && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Gravity on: from now on the camera falls freely (starting at rest w.r.t. the local static observer). */
  setGravity(on: boolean) {
    const s = this.s;
    this.gravity = on;
    this.path = null;
    if (on) {
      if (this.cinematic) this.setCinematic(null);
      s.animate = true;
      s.motion = "geodesic";
      s.velR = s.velT = s.velP = 0;
      this.properTime = 0;
    } else if (s.motion === "geodesic") {
      s.motion = "static";
      s.velR = s.velT = s.velP = 0;
    }
    this.onCinematicChange(this.cinematic);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || this.flyMode) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragLook = e.button === 2 || e.shiftKey;
    this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
    this.down = this.pointers.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    this.focus = null;
    this.flight = null;
    this.leveling = false;
    this.activity = performance.now();
    this.setHover(null);
    if (this.pointers.size === 2) this.pinchDist = this.pinchSpan();
    if (this.cinematic === "orbit") this.setCinematic(null);
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    // released after a pause: no fling
    if (performance.now() - this.lastMove > 80) this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
    // a click (no drag): select the body under the pointer
    const d = this.down;
    this.down = null;
    if (d && this.pointers.size === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5 && performance.now() - d.t < 400) {
      const r = this.canvas.getBoundingClientRect();
      const body = this.pickAt(e.clientX - r.left, e.clientY - r.top);
      if (body && body !== this.s.target) this.selectTarget(body);
    }
  };

  /** Double-click: on a body, orbit it and fly the view to it (framed); on the sky, recentre / level. */
  private onDblClick = (e: MouseEvent) => {
    if (!this.enabled || this.flyMode) return;
    if (this.piloting && !this.cinematic) return this.setLook(0, 0);
    const r = this.canvas.getBoundingClientRect();
    const body = this.pickAt(e.clientX - r.left, e.clientY - r.top);
    if (!body) return this.resetView();
    if (this.cinematic === "orbit") this.setCinematic(null);
    this.s.rotation = "orbit";
    this.selectTarget(body, { frame: !this.gravity });
  };

  private setHover(h: CameraController["hover"]) {
    if (h?.body === this.hover?.body && (!h || (h.x === this.hover!.x && h.y === this.hover!.y))) return;
    this.hover = h;
    this.canvas.style.cursor = h ? "pointer" : "";
  }

  private pinchSpan() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // hover: what is under the pointer (throttled; one traced ray)
      if (!this.enabled || this.flyMode || e.pointerType === "touch") return;
      const now = performance.now();
      if (now - this.hoverAt < 70) return;
      this.hoverAt = now;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const body = this.pickAt(x, y);
      this.setHover(body ? { body, x, y } : null);
      return;
    }
    const now = performance.now();
    const dtEv = Math.max(16, now - this.lastMove) / 1000;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.lastMove = now;
    this.activity = now;

    if (this.pointers.size === 2) {
      const span = this.pinchSpan();
      if (this.pinchDist > 0 && span > 0) this.zoomBy(this.pinchDist / span);
      this.pinchDist = span;
      return;
    }
    const s = this.s;
    // fling velocity: smoothed and capped (°/s)
    const smooth = (v: number, inst: number) => clamp(0.5 * inst + 0.5 * v, -120, 120);
    const kLook = s.fov / this.canvas.clientHeight; // degrees per CSS pixel
    const look = () => {
      this.rotateView(-dx * kLook, dy * kLook, 0);
      this.vYaw = smooth(this.vYaw, (-dx * kLook) / dtEv);
      this.vPitch = smooth(this.vPitch, (dy * kLook) / dtEv);
    };
    if (this.piloting && !this.cinematic) {
      // piloting: the drag turns the camera on its mount (free look); the ship keeps its attitude
      this.setLook(s.shipLookYaw - dx * kLook, s.shipLookPitch + dy * kLook);
    } else if (s.rotation === "free") {
      // free: drag looks around, right / shift drag rolls
      if (this.dragLook) this.rotateView(0, 0, -dx * 0.4);
      else look();
    } else if (this.dragLook || !this.orbiting) {
      look(); // offset of the view from the target (or, falling freely, just look)
    } else {
      const k = 0.25 * Math.min(1, s.fov / 45);
      this.orbitBy(-dx * k, -dy * k);
      this.vAz = smooth(this.vAz, (-dx * k) / dtEv);
      this.vInc = smooth(this.vInc, (-dy * k) / dtEv);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.enabled) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.activity = performance.now();
    this.flight = null;
    if (this.flyMode) {
      // flight speed, like a game's throttle
      this.flySpeed = clamp(this.flySpeed * Math.exp(-dy * 0.002), 0.05, 30);
      return;
    }
    if (e.altKey || this.gravity || this.piloting) {
      this.s.fov = clamp(this.s.fov * Math.exp(dy * 0.001), 1, 150);
    } else if (this.s.rotation === "free" && !this.cinematic) {
      // dolly along the view, gliding (the flight's inertia)
      this.flyVel[0] = clamp(this.flyVel[0] - dy * 0.006 * this.flySpeed, -8 * this.flySpeed, 8 * this.flySpeed);
    } else {
      this.zoomBy(Math.exp(dy * 0.0015));
    }
  };

  private zoomBy(f: number) {
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
  update(dt: number, time?: number): boolean {
    if (!this.enabled) return false;
    const s = this.s;
    this.prevTime = Number.isFinite(this.time) ? this.time : (time ?? 0);
    if (time !== undefined) this.time = time;
    const before = this.poseKey();
    const dragging = this.pointers.size > 0;
    const pad = this.pad.poll();
    if (pad?.active) this.activity = performance.now();
    if (pad) for (const a of pad.actions) this.onPadAction?.(a);

    if (s.ship !== this.piloting) this.setPilot(s.ship);
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
    if (pad && (pad.look[0] || pad.look[1])) {
      // right stick: orbit the target, or turn the camera (free rotation, flight); piloting: look
      if (pilotNow) this.setLook(s.shipLookYaw + pad.look[0] * 90 * dt, s.shipLookPitch + pad.look[1] * 70 * dt);
      else if (this.orbiting) this.orbitBy(-pad.look[0] * 75 * dt, -pad.look[1] * 75 * dt);
      else {
        const k = 110 * dt * Math.min(1, this.s.fov / 60);
        this.rotateView(pad.look[0] * k, pad.look[1] * k, 0);
      }
    }
    if (pad?.zoom) this.zoomBy(Math.exp(-1.4 * pad.zoom * dt));
    if (this.keys.has("+") || this.keys.has("=")) this.zoomBy(Math.exp(-1.2 * dt));
    if (this.keys.has("-") || this.keys.has("_")) this.zoomBy(Math.exp(1.2 * dt));
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
    if (pilotNow) {
      this.flyShip(dt, pad);
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

    if (this.cinematic === "orbit") {
      this.orbitBy(s.cinematicSpeed * dt, 0);
    } else if (this.cinematic === "dive") {
      this.stepDive(dt);
    } else if (this.cinematic === "journey") {
      this.stepJourney(dt);
    }
    if (this.flight && !(this.orbiting && s.target === this.flight.body && s.anchor === (this.flight.body === "wormhole" ? "wormhole" : "hole"))) {
      this.flight = null;
    }
    if (this.cinematic !== "dive" && this.cinematic !== "journey") {
      if (this.flight) this.stepFlight(dt);
      else if (this.orbiting && (s.target === "star" || s.target === "barycentre")) this.followBody(dt);
      else this.easeZoom(dt);
    }
    if (this.baryRest() && s.rotation === "free") this.driftWithBarycentre();
    this.updateMotion(dt);
    if (this.tracking && !flying && !this.inThroat()) this.track(dt);
    // (tracking resumes from the orientation the flight left: offset recomputed, no jump)
    else this.offset = null;
    return this.changedSince(before);
  }

  /** Inside the wormhole's throat (|ℓ| < a + 1.5 ρ): "aiming at the wormhole" means nothing there. */
  private inThroat() {
    const s = this.s;
    if (!s.wormhole) return false;
    const cam = cameraFrame(s);
    const w = mouth(s).w;
    return cam.region === "throat" && Math.abs(cam.ell) < w.a + 1.5 * w.rho;
  }

  /** Smooth wheel zoom towards the target distance (in log space): to the hole, or |ℓ| to the throat. */
  private easeZoom(dt: number) {
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

  private poseKey() {
    const s = this.s;
    return [s.azimuth, s.inclination, s.yaw, s.pitch, s.roll, s.distance, s.fov, s.whL, s.anchor, s.motion, s.velP].join();
  }

  private changedSince(before: string) {
    return before !== this.poseKey();
  }

  /** Closest approach of the wheel zoom to the throat. */
  private lMin() {
    const w = mouth(this.s).w;
    return w.a + 0.3 * w.rho;
  }

  /** A pose is allowed unless it puts the camera inside the hole's horizon region. */
  private poseAllowed(s: Settings) {
    const cam = cameraFrame(s);
    return cam.region === "throat" || cam.r > horizon(s.spin) + 0.3;
  }

  // ------------------------------------------------------------------------------ free flight
  /**
   * Moves the camera along a direction given in its own axes (forward, right, up) at a speed
   * proportional to the distance to the nearest object, keeping its orientation (parallel transport).
   * Near the wormhole: a spatial geodesic of the Dneg metric (it can cross the throat); near the hole:
   * a straight line. The camera re-anchors to the nearest object.
   */
  private fly(local: Vec3, dt: number) {
    const s = this.s;
    const rH = horizon(s.spin);
    const n = Math.hypot(...local);
    const k = n * dt;
    const c: Vec3 = [local[0] / n, local[1] / n, local[2] / n];
    /** Camera axes in the flat frame of the hole (hole region). */
    const holeAxes = () => {
      const cam = cameraFrame(s);
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const f = sphericalFrame(X);
      const w = (v: Vec3) => add3(f.er, f.et, f.ep, v);
      const fw = w(cam.fwd), rt = w(cam.right), up = w(cam.up);
      return { X, r: cam.r, fw, up, d: lin(lin(fw, c[0], rt, c[1]), 1, up, c[2]) };
    };
    if (!s.wormhole) {
      const h = holeAxes();
      const Y = axpy(h.X, h.d, k * Math.min(h.r - rH, 100));
      if (Math.hypot(...Y) < rH + 0.3 || Math.hypot(...Y) > MAX_RANGE) return;
      setHolePose(s, Y, h.fw, h.up);
      s.anchor = "hole";
      this.sync();
      return;
    }
    const m = mouth(s);
    const p = repPose(s);
    const rw = radius(m.w, p.l)[0];
    const toHole = p.l > 0 ? Math.hypot(...repToHole(m, p.l, p.n)) : Infinity;
    const ds = k * Math.min(Math.max(Math.min(rw - 0.5 * m.w.rho, toHole - rH), 0.2 * m.w.rho), 100);
    const nearMouth = p.l <= 0 || rw < toHole;
    if (nearMouth) {
      const right = cross(p.fwd, p.up);
      const d = normalize(lin(lin(p.fwd, c[0], right, c[1]), 1, p.up, c[2]));
      const q = flyDneg(m.w, p.l, p.n, d, [p.fwd, p.up], ds);
      const pose = { l: q.l, n: q.n, fwd: q.vectors[0]!, up: q.vectors[1]! };
      if (radius(m.w, pose.l)[0] > MAX_RANGE) return;
      if (pose.l > 0) {
        const h = repToHolePose(s, pose);
        const dHole = Math.hypot(...h.X);
        if (dHole < rH + 0.3) return;
        if (dHole < radius(m.w, pose.l)[0]) setHolePose(s, h.X, h.fwd, h.up);
        else setRepPose(s, pose);
      } else setRepPose(s, pose);
    } else {
      const h = holeAxes();
      const Y = axpy(h.X, h.d, ds);
      if (Math.hypot(...Y) < rH + 0.3 || Math.hypot(...Y) > MAX_RANGE) return;
      const rep = holeToRep(m, Y);
      if (rep.r < Math.hypot(...Y)) setRepPose(s, { l: rep.l, n: rep.n, fwd: toMouth(m, h.fw), up: toMouth(m, h.up) });
      else setHolePose(s, Y, h.fw, h.up);
    }
    this.sync();
  }

  // ------------------------------------------------------------------------------ gravity
  /**
   * Advances the camera as a massive body by simDt of coordinate time (the scene's time): a Kerr
   * geodesic near the hole (thrust = proper acceleration along the camera's axes), inertial motion
   * along the spatial geodesics of the wormhole metric near the mouth (it has no gravity, g_tt = −1).
   * The orientation is kept fixed with respect to the distant stars (a gyroscope, flat far field).
   */
  private fall(simDt: number, keys: Vec3, fast: boolean, acc?: Vec3) {
    const s = this.s;
    const a = s.spin;
    const kn = Math.hypot(...keys);
    // (acc: a proper acceleration given directly, local components — the Ranger's engines)
    const accel = acc ? Math.hypot(...acc) : kn > 0 ? s.thrust * (fast ? 5 : 1) : 0;
    const cam = cameraFrame(s);
    if (cam.region === "hole") {
      const X0 = blToCartesian(cam.r, cam.theta, cam.phi);
      const f0 = sphericalFrame(X0);
      const w0 = (v: Vec3) => add3(f0.er, f0.et, f0.ep, v);
      const dirZ: Vec3 = acc ? (accel > 0 ? lin(acc, 1 / accel, acc, 0) : [0, 0, 0]) : kn > 0 ? normalize(lin(lin(cam.fwd, keys[0], cam.right, keys[1]), 1, cam.up, keys[2])) : [0, 0, 0];
      const res = advance(fromZamo(cam.r, cam.theta, cam.phi, cam.beta, a, this.nowTime()), a, simDt, 0.05, accel, dirZ, this.lens());
      this.landed = res.landed;
      this.properTime += res.tau;
      const st = res.st;
      const X1 = blToCartesian(st.r, st.th, st.ph);
      const f1 = sphericalFrame(X1);
      const vel = add3(f1.er, f1.et, f1.ep, toZamo(st, a));
      setHolePose(s, X1, w0(cam.fwd), w0(cam.up), vel);
      s.motion = "geodesic";
      this.targetDistance = s.distance;
      return;
    }
    // near the wormhole: straight (geodesic) motion at constant speed, thrust changes γβ
    const m = mouth(s);
    const p = repPose(s);
    const right = cross(p.fwd, p.up);
    let v = p.vel;
    if (accel > 0) {
      // (acc is in the camera frame's rep components here, like p.fwd)
      const d = acc ? lin(acc, 1 / accel, acc, 0) : normalize(lin(lin(p.fwd, keys[0], right, keys[1]), 1, p.up, keys[2]));
      const g = 1 / Math.sqrt(Math.max(1 - (v[0] ** 2 + v[1] ** 2 + v[2] ** 2), 1e-9));
      const U = lin(v, g, d, accel * simDt);
      v = lin(U, 1 / Math.sqrt(1 + U[0] ** 2 + U[1] ** 2 + U[2] ** 2), U, 0);
    }
    const speed = Math.hypot(...v);
    this.properTime += simDt * Math.sqrt(Math.max(1 - speed * speed, 0));
    if (speed < 1e-9) {
      setRepPose(s, { ...p, vel: [0, 0, 0] });
      return;
    }
    const q = flyDneg(m.w, p.l, p.n, lin(v, 1 / speed, v, 0), [p.fwd, p.up], speed * simDt);
    setRepPose(s, { l: q.l, n: q.n, fwd: q.vectors[0]!, up: q.vectors[1]!, vel: lin(q.dir, speed, q.dir, 0) });
    s.motion = "geodesic";
    this.sync();
  }

  // ------------------------------------------------------------------------------ piloting
  /**
   * The Ranger carries the camera and flies: gravity on (Kerr geodesic in the scene's time), free
   * rotation, time running. Starting near the hole, it is put on a circular orbit (prograde).
   */
  setPilot(on: boolean) {
    const s = this.s;
    this.piloting = on;
    this.pilot.omega = [0, 0, 0];
    this.pilot.throttle = 0;
    this.pilot.hold = "none";
    this.pilot.auto = "none";
    if (!on) {
      s.shipLookYaw = s.shipLookPitch = 0;
      if (this.gravity) this.setGravity(false);
      return;
    }
    if (this.cinematic === "orbit") this.setCinematic(null);
    this.flyMode = false;
    s.rotation = "free";
    if (!this.gravity) this.setGravity(true);
    s.motion = "geodesic";
    s.animate = true;
    s.showGeodesic = true; // the future path, drawn in the view and on the map
    const cam = cameraFrame(s);
    if (cam.region === "hole" && Math.hypot(...cam.beta) < 1e-6) {
      const v = circularSpeed(cam.r, s.spin, true, cam.zamo);
      if (v !== null && cam.r > isco(s.spin)) [s.velR, s.velT, s.velP] = [0, 0, v];
    }
  }

  /** Turns the camera on its mount (degrees); the ship stays where it points. */
  setLook(yaw: number, pitch: number) {
    const s = this.s;
    yaw = clamp(yaw, -170, 170);
    pitch = clamp(pitch, -85, 85);
    if (yaw === s.shipLookYaw && pitch === s.shipLookPitch) return;
    const S0 = this.shipMatrix();
    s.shipLookYaw = yaw;
    s.shipLookPitch = pitch;
    this.reorient(S0, this.shipMatrix());
  }

  /** Next / previous attach point (the view travels there; the ship keeps its attitude). */
  cycleMount(dir: 1 | -1) {
    const s = this.s;
    const i = MOUNT_KEYS.indexOf(s.shipMount as Mount);
    s.shipMount = MOUNT_KEYS[(i + dir + MOUNT_KEYS.length) % MOUNT_KEYS.length]!;
    return s.shipMount as Mount;
  }

  /** Where the camera is on the ship now (between two attach points while the view moves). */
  shipPose(): MountPose {
    if (this.mountEff) return this.mountEff;
    // (the setting just changed, before this frame's step: still where the camera was)
    if (this.s.shipMount !== this.lastMount && this.lastPose) return this.lastPose;
    return (MOUNTS[this.s.shipMount as Mount] ?? MOUNTS.quarter) as MountPose;
  }

  /** Eases the camera towards the chosen attach point; keeps the ship's attitude while it moves. */
  private stepMount(dt: number) {
    const s = this.s;
    const to = (MOUNTS[s.shipMount as Mount] ?? MOUNTS.quarter) as MountPose;
    const S0 = this.shipMatrix();
    if (s.shipMount !== this.lastMount) {
      if (this.lastMount && s.ship) this.mountAnim = { from: this.shipPose(), t: 0 };
      this.lastMount = s.shipMount;
    }
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
  private reorient(S0: M3, S1: M3) {
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

  private shipMatrix(): M3 {
    return shipToCamera(this.shipPose(), this.s.shipLookYaw, this.s.shipLookPitch).S;
  }

  /** The ship's axes (x left, y up, z nose) in the camera basis's local components. */
  private shipAxesLocal(b: { right: Vec3; up: Vec3; fwd: Vec3 }): [Vec3, Vec3, Vec3] {
    const S = this.shipMatrix();
    const ax = (i: number) => lin(lin(b.right, S[0]![i]!, b.up, S[1]![i]!), 1, b.fwd, S[2]![i]!);
    return [ax(0), ax(1), ax(2)];
  }

  /** Rotates the camera (and the ship on it) by a rotation vector given in camera coordinates [rad]. */
  private rotateC(rot: Vec3) {
    const ang = Math.hypot(...rot);
    if (ang < 1e-9) return;
    const k = lin(rot, 1 / ang, rot, 0);
    const c = Math.cos(ang), sn = Math.sin(ang);
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
  private pilotInput(pad: ReturnType<GamepadInput["poll"]>): PilotInput {
    const k = (c: string) => (this.codes.has(c) ? 1 : 0);
    const shift = this.codes.has("ShiftLeft") || this.codes.has("ShiftRight");
    const i: PilotInput = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 };
    const ws = k("KeyS") - k("KeyW"); // W: nose down (like an aircraft), S: nose up
    const ad = k("KeyD") - k("KeyA");
    const qe = k("KeyE") - k("KeyQ");
    if (shift) {
      i.tz = -ws;
      i.tx = ad;
      i.ty = qe;
    } else {
      i.pitch = ws;
      i.yaw = ad;
      i.roll = qe;
    }
    i.throttle = (this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("ArrowDown") ? 1 : 0);
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
  private flyShip(dt: number, pad: ReturnType<GamepadInput["poll"]>) {
    const s = this.s;
    const cam = cameraFrame(s);
    const inp = this.pilotInput(pad);
    if (Object.values(inp).some((v) => v !== 0)) this.activity = performance.now();
    const dtau = cam.region === "hole" ? cam.zamo.alpha / cam.gamma : 1 / cam.gamma;
    const tauRate = s.animate ? s.timeSpeed * dtau : 0;
    const out = this.pilot.step({
      dt, right: cam.right, up: cam.up, fwd: cam.fwd, beta: cam.beta, S: this.shipMatrix(), thrust: s.thrust, tauRate,
      radialOut: this.radialOut(cam), target: this.targetDir(cam), want: (this.lastWant = this.pilot.auto !== "none" ? this.autopilotWant(cam) : null),
    }, inp);
    this.rotateC(out.rot);
    const simDt = s.animate ? s.timeSpeed * dt : 0;
    if (simDt > 0) this.fall(simDt, [0, 0, 0], false, out.acc);
  }

  private radialOut(cam: ReturnType<typeof cameraFrame>): Vec3 | null {
    if (cam.region === "hole") return [1, 0, 0];
    // in the throat region: away from the throat (increasing |ℓ|)
    return lin(cam.n, Math.sign(cam.ell) || 1, cam.n, 0);
  }

  /** Direction of the selected target, local components (the flat map's straight line). */
  private targetDir(cam: ReturnType<typeof cameraFrame>): Vec3 | null {
    if (cam.region !== "hole") return null;
    const s = this.s;
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const f = sphericalFrame(X);
    // where the body is seen: its position when the light left it (retarded time, flat estimate)
    const t0 = this.nowTime();
    let C = s.target === "hole" ? [0, 0, 0] as Vec3 : bodyCentre(s, s.target, t0);
    if (s.target === "star" || s.target === "barycentre") {
      for (let k = 0; k < 3; k++) C = bodyCentre(s, s.target, t0 - Math.hypot(...sub3(C, X)));
    }
    const d = sub3(C, X);
    const l = Math.hypot(...d);
    if (l < 1e-9) return null;
    // seen from the moving ship: relativistic aberration (towards the motion), as the tracer draws it
    const n: Vec3 = [dot3(d, f.er) / l, dot3(d, f.et) / l, dot3(d, f.ep) / l];
    const b = cam.beta;
    const b2 = dot3(b, b);
    if (b2 < 1e-12) return n;
    const g = 1 / Math.sqrt(1 - b2);
    const bn = dot3(n, b) / Math.sqrt(b2);
    const w = axpy(axpy(n, b, g), b, ((g - 1) * bn) / Math.sqrt(b2));
    return lin(w, 1 / Math.hypot(...w), w, 0);
  }

  /** Coordinate acceleration of the 4-velocity in free fall (local components): what gravity does to us. */
  private freeFallAccel(cam: ReturnType<typeof cameraFrame>, beta: Vec3 = cam.beta): Vec3 {
    if (cam.region !== "hole") return [0, 0, 0];
    const a = this.s.spin;
    const st = fromZamo(cam.r, cam.theta, cam.phi, beta, a, this.nowTime());
    const h = Math.max(1e-4, 2e-4 * (cam.r - horizon(a)));
    const U0 = toU(beta);
    const U1 = toU(toZamo(geoStep(st, a, h, this.lens()), a));
    return lin(sub3(U1, U0), 1 / h, U0, 0);
  }

  /** The autopilot's goal: the velocity to reach (local 3-velocity) and a feed-forward acceleration. */
  private autopilotWant(cam: ReturnType<typeof cameraFrame>): { beta: Vec3; ff: Vec3 } | null {
    const s = this.s;
    const P = this.pilot;
    const say = (t: string) => {
      P.setAuto("none");
      this.onPilotMessage?.(t);
      return null;
    };
    const dtau = cam.region === "hole" ? cam.zamo.alpha / cam.gamma : 1 / cam.gamma;
    const T = Math.max(1.2 * s.timeSpeed * dtau, 1e-3);
    if (P.auto === "hover") {
      if (cam.region !== "hole") return { beta: [0, 0, 0], ff: [0, 0, 0] };
      const z = cam.zamo;
      // a static observer moves at −ωϖ/α relative to the ZAMO; none inside the ergosphere (hold the ZAMO)
      const vs = (-z.omega * z.varpi) / z.alpha;
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      if (!P.anchor) P.anchor = X;
      const f = sphericalFrame(X);
      const d = sub3(P.anchor, X);
      let back: Vec3 = [dot3(d, f.er), dot3(d, f.et), dot3(d, f.ep)];
      const bl = Math.hypot(...back);
      const k = Math.min(1 / (4 * T), 0.08 / Math.max(bl, 1e-9));
      back = lin(back, k, back, 0);
      return { beta: [back[0], back[1], (Math.abs(vs) < 0.99 ? vs : 0) + back[2]], ff: lin(this.freeFallAccel(cam), -1, cam.beta, 0) };
    }
    if (P.auto === "circularize") {
      if (cam.region !== "hole") return say("Circularize: only around the black hole");
      const b = cam.beta;
      let t: Vec3 = [0, b[1], b[2]];
      let tl = Math.hypot(...t);
      if (tl < 1e-4) (t = [0, 0, s.spin >= 0 ? 1 : -1]), (tl = 1);
      t = lin(t, 1 / tl, t, 0);
      const pro = t[2] * (s.spin >= 0 ? 1 : -1) >= 0;
      const v = circularSpeed(cam.r, Math.abs(s.spin), pro, cam.zamo);
      if (v === null) return say("No circular orbit here: inside the photon orbit");
      // the equatorial formula is only a first guess off the equator: the circular speed is the one
      // whose free fall has no radial acceleration (a_r linear in v² — two probes)
      const v1 = Math.abs(v), v2 = Math.min(1.05 * v1, 0.999);
      const a1 = this.freeFallAccel(cam, lin(t, v1, t, 0))[0];
      const a2 = this.freeFallAccel(cam, lin(t, v2, t, 0))[0];
      const vc = a2 !== a1 ? Math.sqrt(clamp(v1 * v1 - (a1 * (v2 * v2 - v1 * v1)) / (a2 - a1), 0, 0.998)) : v1;
      return { beta: lin(t, vc, t, 0), ff: [0, 0, 0] };
    }
    if (P.auto === "approach") {
      if (cam.region !== "hole") return say("Approach: only in the black hole's universe");
      if (s.target === "hole" || s.target === "barycentre") return say("Approach: select the star or the wormhole (Tab)");
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const f = sphericalFrame(X);
      const t = this.nowTime();
      const C = bodyCentre(s, s.target, t);
      const star = s.target === "star";
      const stand = star ? 4 * s.sunRadius : 1.3 * mouth(s).rGlue;
      const away = sub3(X, C);
      const dist = Math.hypot(...away);
      const goal = axpy(C, away, stand / Math.max(dist, 1e-9));
      const d = sub3(goal, X);
      const dl = Math.hypot(...d);
      const close = Math.min(0.25, dl / (5 * T));
      const V: Vec3 = star ? starVelocity(s, t) : [0, 0, 0];
      const W = axpy(V, d, close / Math.max(dl, 1e-9));
      const loc: Vec3 = [dot3(W, f.er), dot3(W, f.et), dot3(W, f.ep)];
      if (star) {
        // the hole's pull is shared with the star (both fall); its own pull is not: cancel it
        if (this.landed) return say("Landed on the star");
        const g = lin(away, s.sunMass / Math.max(dist, s.sunRadius) ** 3, away, 0);
        return { beta: loc, ff: [dot3(g, f.er), dot3(g, f.et), dot3(g, f.ep)] };
      }
      // the mouth is held static against gravity
      return { beta: loc, ff: lin(this.freeFallAccel(cam), -1, cam.beta, 0) };
    }
    return null;
  }

  /** Everything the flight displays show, for this frame. */
  flightInfo() {
    const s = this.s;
    const cam = cameraFrame(s);
    const a = s.spin;
    const S = this.shipMatrix();
    const C = (v: Vec3 | null): Vec3 | null => v && [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
    const speed = Math.hypot(...cam.beta);
    const pro = speed > 1e-6 ? lin(cam.beta, 1 / speed, cam.beta, 0) : null;
    const R = this.radialOut(cam);
    let normal: Vec3 | null = null;
    if (R && pro) {
      const n = cross(R, pro);
      const l = Math.hypot(...n);
      if (l > 1e-6) normal = lin(n, 1 / l, n, 0);
    }
    const info = {
      region: cam.region,
      r: cam.r,
      theta: cam.theta,
      phi: cam.phi,
      ell: cam.ell,
      n: cam.n,
      speed,
      gamma: cam.gamma,
      dtau: cam.region === "hole" ? cam.zamo.alpha / cam.gamma : 1 / cam.gamma,
      E: NaN,
      L: NaN,
      rH: horizon(a),
      isco: isco(a),
      photon: photonOrbits(a).pro,
      ergo: cam.region === "hole" && cam.r < 1 + Math.sqrt(Math.max(0, 1 - a * a * Math.cos(cam.theta) ** 2)),
      accel: this.pilot.accel,
      throttle: this.pilot.auto !== "none" && this.pilot.burn ? this.pilot.accel / Math.max(s.thrust, 1e-12) : this.pilot.throttle,
      sas: this.pilot.sas,
      hold: this.pilot.hold,
      auto: this.pilot.auto,
      omega: this.pilot.omega,
      properTime: this.properTime,
      landed: this.landed,
      // directions in camera coordinates, and the ship's axes
      S,
      dirs: {
        prograde: C(pro),
        retrograde: C(pro && lin(pro, -1, pro, 0)),
        radialOut: C(R),
        radialIn: C(R && lin(R, -1, R, 0)),
        normal: C(normal),
        antinormal: C(normal && lin(normal, -1, normal, 0)),
        target: C(this.targetDir(cam)),
        burn: C(this.pilot.burn),
        // velocity relative to the target (approach, docking)
        tgtPrograde: null as Vec3 | null,
        tgtRetrograde: null as Vec3 | null,
      },
      // flat-map position, velocity and nose (black hole's frame), for the map
      X: null as Vec3 | null,
      V: null as Vec3 | null,
      nose: null as Vec3 | null,
      path: this.path,
      /** the camera's view direction (flat map), the autopilot's remaining velocity change |ΔU| */
      look: null as Vec3 | null,
      dv: this.lastWant && this.pilot.auto !== "none" ? Math.hypot(...sub3(toU(this.lastWant.beta), toU(cam.beta))) : NaN,
      mount: s.shipMount,
      moving: this.mountAnim !== null,
      /** the selected target: distance (centre to centre, flat map) and range rate (> 0: receding) */
      target: s.target,
      targetDist: NaN,
      targetRate: NaN,
    };
    if (cam.region === "hole") {
      const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, a, this.nowTime());
      info.E = st.E;
      info.L = st.L;
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const f = sphericalFrame(X);
      const W = (v: Vec3) => add3(f.er, f.et, f.ep, v);
      info.X = X;
      info.V = W(cam.beta);
      const b = { right: cam.right, up: cam.up, fwd: cam.fwd };
      info.nose = W(this.shipAxesLocal(b)[2]);
      info.look = W(cam.fwd);
      const t = this.nowTime();
      const Ct: Vec3 = s.target === "hole" ? [0, 0, 0] : bodyCentre(s, s.target, t);
      const Vt: Vec3 = s.target === "star" ? starVelocity(s, t) : [0, 0, 0];
      const d = sub3(X, Ct);
      info.targetDist = Math.hypot(...d);
      info.targetRate = dot3(sub3(info.V, Vt), d) / Math.max(info.targetDist, 1e-9);
      const rel = sub3(info.V, Vt);
      const rl = Math.hypot(...rel);
      if (s.target !== "hole" && rl > 1e-5) {
        const loc: Vec3 = [dot3(rel, f.er) / rl, dot3(rel, f.et) / rl, dot3(rel, f.ep) / rl];
        info.dirs.tgtPrograde = C(loc);
        info.dirs.tgtRetrograde = C(lin(loc, -1, loc, 0));
      }
    }
    return info;
  }

  /**
   * The camera's future free-fall path (no thrust) in the black hole's frame, for the overlay:
   * recomputed at most 4 times a second. Near the mouth the path is not predicted.
   */
  predictPath() {
    const now = performance.now();
    if (!this.gravity) return (this.path = null);
    const s = this.s;
    // same state (e.g. time paused): same path object, so the renderer keeps converging
    const key = [s.spin, s.anchor, s.distance, s.inclination, s.azimuth, s.whL, s.velR, s.velT, s.velP, s.wormhole, s.whDist, s.whIncl, s.whAzimuth, s.sun, s.sunMass, s.sunOrbit, this.nowTime()].join();
    if (this.path && (key === this.pathKey || now - this.path.at < 250)) return this.path;
    this.pathKey = key;
    const cam = cameraFrame(s);
    if (cam.region !== "hole") return (this.path = null);
    const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, s.spin, this.nowTime());
    // up to 0.95 of a turn around the hole: a bound orbit shows almost a full revolution without
    // coming back past the camera (a segment that close would sweep across the whole view)
    const tMax = clamp(2 * 2 * Math.PI * cam.r ** 1.5, 300, 60000);
    const p: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole" | "star" } = predict(st, s.spin, tMax, 480, this.lens());
    // keep at most 0.95 of a turn around the hole (accumulated angle of the position vector)
    let turned = 0;
    for (let i = 1; i < p.pts.length; i++) {
      const u = p.pts[i - 1]!, v = p.pts[i]!;
      const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
      turned += Math.acos(Math.min(1, Math.max(-1, c)));
      if (turned > 0.95 * 2 * Math.PI) {
        p.pts = p.pts.slice(0, i);
        p.fate = "continues";
        break;
      }
    }
    if (s.wormhole) {
      // the Kerr prediction stops where the path enters the far mouth (beyond: the other universe)
      const m = mouth(s);
      const i = p.pts.findIndex((q) => Math.hypot(q[0] - m.C[0], q[1] - m.C[1], q[2] - m.C[2]) < m.rGlue);
      if (i >= 0) p.pts = p.pts.slice(0, Math.max(i + 1, 2)), p.fate = "wormhole";
    }
    this.path = { ...p, at: now, dt: tMax / 480 };
    return this.path;
  }

  // ------------------------------------------------------------------------------ journey
  private startJourney() {
    const s = this.s;
    if (!s.wormhole) {
      s.wormhole = true;
      s.anchor = "wormhole";
      s.whL = -8 * mouth(s).w.rho;
    }
    s.motion = "static";
    s.animate = true; // the disk turns and the star moves during the trip
    const dir = repPose(s).l < 0 ? "out" : "back";
    if (dir === "back") switchAnchor(s, "hole");
    const start = Object.fromEntries(POSE_KEYS.map((k) => [k, s[k]])) as Pick<Settings, PoseKeys>;
    this.journey = { t: 0, dir, start };
  }

  /**
   * Out: line up with the mouth on our side, fly radially through the throat (the line that leads
   * to the hole), emerge in the black hole's universe facing it, approach and settle into an orbit.
   * Back: fly to the far mouth, through it, and turn round on our side to look back at the mouth.
   */
  private stepJourney(dt: number) {
    const J = this.journey;
    if (!J) return this.setCinematic(null);
    const s = this.s;
    const m = mouth(s);
    const { rho, a } = m.w;
    J.t += dt;
    const x = Math.min(J.t / Math.max(s.journeyDuration, 1), 1);
    const f1 = 0.22;
    const f2 = 0.58;
    const phase = (lo: number, hi: number) => smoothstep((x - lo) / (hi - lo));
    const asinhL = (l: number) => Math.asinh(l / rho);
    const lOut = m.lGlue * 1.15;
    const st = J.start;
    if (J.dir === "out") {
      const lA = -(a + 6 * rho);
      if (x < f1) {
        const k = phase(0, f1);
        s.anchor = "wormhole";
        s.whL = rho * Math.sinh(lerp(asinhL(st.whL), asinhL(lA), k));
        s.inclination = lerp(st.inclination, 90, k);
        s.azimuth = lerpAngle(st.azimuth, 0, k);
        s.yaw = lerpAngle(st.yaw, 0, k);
        s.pitch = lerp(st.pitch, 0, k);
        s.roll = lerpAngle(st.roll, 0, k);
      } else if (x < f2) {
        const l = rho * Math.sinh(lerp(asinhL(lA), asinhL(lOut), phase(f1, f2)));
        setRepPose(s, { l, n: [1, 0, 0], fwd: [1, 0, 0] });
      } else {
        const k = phase(f2, 1);
        const X0 = repToHole(m, lOut, [1, 0, 0]);
        const f = sphericalFrame(X0);
        s.anchor = "hole";
        // pull back a little to reveal the whole disk, then orbit
        s.distance = Math.exp(lerp(Math.log(f.r), Math.log(Math.max(1.25 * f.r, horizon(s.spin) + 10)), k));
        s.inclination = lerp(f.th / DEG, 81, k);
        s.azimuth = f.ph / DEG + 40 * k;
        s.yaw = 0;
        s.pitch = 0;
      }
      if (x >= 1) {
        this.journey = null;
        this.sync();
        s.target = "hole";
        this.setCinematic("orbit");
      }
    } else {
      const lIn = m.lGlue * 1.3;
      const lB = -(a + 10 * rho);
      if (x < f1) {
        const k = phase(0, f1);
        const target = repToHole(m, lIn, [1, 0, 0]);
        const f = sphericalFrame(target);
        s.anchor = "hole";
        s.distance = Math.exp(lerp(Math.log(st.distance), Math.log(f.r), k));
        s.inclination = lerp(st.inclination, f.th / DEG, k);
        s.azimuth = lerpAngle(st.azimuth, f.ph / DEG, k);
        s.yaw = lerpAngle(st.yaw, 180, k);
        s.pitch = lerp(st.pitch, 0, k);
        s.roll = lerpAngle(st.roll, 0, k);
      } else if (x < f2) {
        const l = rho * Math.sinh(lerp(asinhL(lIn), asinhL(lB), phase(f1, f2)));
        setRepPose(s, { l, n: [1, 0, 0], fwd: [-1, 0, 0] });
      } else {
        const k = phase(f2, 1);
        setRepPose(s, { l: rho * Math.sinh(lerp(asinhL(lB), asinhL(lB * 1.4), k)), n: [1, 0, 0], fwd: [-1, 0, 0] });
        s.yaw = lerpAngle(180, 0, k);
      }
      if (x >= 1) {
        this.journey = null;
        this.sync();
        s.target = "wormhole";
        this.setCinematic(null);
      }
    }
  }

  private stepDive(dt: number) {
    const s = this.s;
    const a = s.spin;
    const rH = horizon(a);
    const rEnd = rH + 0.04;
    if (s.distance <= rEnd) {
      this.diveHold += dt;
      if (this.diveHold > 2.5) this.setCinematic(null);
      return;
    }
    // proper-time budget this frame, sub-stepped (RK2) so the plunge stays accurate near r+
    let tau = s.cinematicSpeed * dt;
    const th = (s.inclination * Math.PI) / 180;
    const c2 = Math.cos(th) ** 2;
    const deriv = (r: number) => {
      const sig = r * r + a * a * c2;
      const del = r * r - 2 * r + a * a;
      return {
        dr: -Math.sqrt(2 * r * (r * r + a * a)) / sig, // Σ dr/dτ = −√(2r(r²+a²))
        dphi: (2 * a * r) / (sig * del), // Σ dφ/dτ = 2ar/Δ (frame dragging)
      };
    };
    let r = s.distance;
    let phi = (s.azimuth * Math.PI) / 180;
    while (tau > 0 && r > rEnd) {
      const h = Math.min(tau, 0.02 * (r - rH) + 1e-4);
      const k1 = deriv(r);
      const k2 = deriv(Math.max(r + 0.5 * h * k1.dr, rH + 1e-4));
      r += h * k2.dr;
      phi += h * k2.dphi;
      tau -= h;
    }
    s.distance = Math.max(r, rEnd);
    s.azimuth = wrapDeg((phi * 180) / Math.PI);
    this.targetDistance = s.distance;
  }
}

const DEG = Math.PI / 180;
const MAX_RANGE = 1000; // M: how far free flight may take the camera
const lin = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const axpy = (x: Vec3, v: Vec3, k: number): Vec3 => [x[0] + k * v[0], x[1] + k * v[1], x[2] + k * v[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** Rotation by `ang` [rad] about the z axis. */
const rotZ = (v: Vec3, ang: number): Vec3 => [
  v[0] * Math.cos(ang) - v[1] * Math.sin(ang), v[0] * Math.sin(ang) + v[1] * Math.cos(ang), v[2],
];
/** Components c along the frame (e0, e1, e2) → Cartesian vector. */
const add3 = (e0: Vec3, e1: Vec3, e2: Vec3, c: Vec3): Vec3 => [
  e0[0] * c[0] + e1[0] * c[1] + e2[0] * c[2],
  e0[1] * c[0] + e1[1] * c[1] + e2[1] * c[2],
  e0[2] * c[0] + e1[2] * c[1] + e2[2] * c[2],
];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpAngle = (a: number, b: number, k: number) => a + ((((b - a + 540) % 360) + 360) % 360 - 180) * k;
const smoothstep = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

/** b − a wrapped to (−180°, 180°]. */
function angleDiff(a: number, b: number) {
  return ((((b - a + 180) % 360) + 360) % 360) - 180;
}

function wrapDeg(d: number) {
  return ((((d + 360) % 720) + 720) % 720) - 360;
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
