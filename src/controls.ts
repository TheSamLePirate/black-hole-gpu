import {
  basis, blToCartesian, cameraFrame, repPose, repToHolePose, setHolePose, setRepPose, switchAnchor, yawPitchRoll,
} from "./camera";
import { horizon, isco, photonOrbits, zamo, coordToZamo, zamoToCoord, type Vec3 } from "./physics";
import { SYSTEM_BODIES, type Settings, type SystemBody, type Target } from "./settings";
import {
  aimFrame, angularRadius, availableBodies, bodyCentre, bodyDistance, bodyLook, BODY_NAMES, cameraPosition, composeOffset, offsetFrom, pick,
  pixelLook, QUAT_ID, quatAngle, slerp, starCentre, starOmega, starPhase, starVelocity, type Body, type Quat,
  baryFraction, barycentreVelocity, holeAcceleration, starOrbitRadius, bodyVelocity, bodyMass, bodyRadius, bodyHill,
} from "./targeting";
import { advance, fromZamo, predict, step as geoStep, toZamo, type Lens } from "./geodesic";
import { GARGANTUA_SYSTEM } from "./system/bodies";
import { bodyState, bodyTrack } from "./system/ephemeris";
import { accelToG, engineThrust, tank } from "./engine";
import { epicycle, rendezvousPush, type State6 } from "./lowthrust";
import { airDensity, betaToCoord, CRASH_SPEED, GEAR, groundR, localAccel, localToZamo, planetFrame, stepLocal, toGlobal, toLocal, weightUp, zamoBeta, zamoToLocal, type LocalState, type PlanetFrame } from "./landing";
import { circularSpeed, FlightComputer, toU, type Auto, type PilotInput } from "./pilot";
import { dvLocal, nodeComponents, orbitNormal, planAlign, planCircular, planeOffset, planIntercept, planPath, planRendezvous, type ManeuverNode, type PlanPath } from "./maneuver";
import { MOUNT_KEYS, MOUNTS, shipToCamera, type M3, type Mount, type MountPose } from "./mounts";
import { GamepadInput, type PadAction } from "./gamepad";
import { ellOfR, flyDneg, holeToRep, mouth, radius, repToHole, sphericalFrame, toMouth } from "./wormhole";

type Cinematic = "orbit" | "dive" | "journey" | null;
/** A low-thrust transfer in flight (see CameraController.transfer). */
type LowThrust = {
  stage: "spiral" | "coast" | "circ" | "drift" | "rdv" | "wait" | "final";
  /** rendezvous: when it is due (coordinate time); which side of the body it meets it on */
  tEnd?: number;
  side?: number;
  /** the radius the current spiral goes to */
  rs: number;
  /** the current spiral climbs; how close to its radius it must stop */
  up?: boolean;
  tol?: number;
  gap?: number;
  note?: string;
  /** the warp before the transfer (given back at its end) */
  warp?: number;
} & ({ goal: "orbit"; r2: number } | { goal: "body"; body: Body; orbit: boolean; mode: "coorbital" | "cruise" });
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
  /** (hit: the body the path runs into, when its fate is "star") */
  path: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole" | "star"; at: number; dt: number; hit?: Body } | null = null;
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
  /**
   * The flight plan: manoeuvre nodes (absolute coordinate times), the predicted path through them
   * (refreshed from the current state), the executing node's delivered Δv and the warp to restore.
   */
  plan: { nodes: ManeuverNode[]; path: PlanPath | null; at: number; note: string; kind?: "align" } = { nodes: [], path: null, at: 0, note: "" };
  /** the executing burn's direction (local), fixed when it starts */
  private burnDir: Vec3 | null = null;
  private nodeDone = 0;
  private nodeBurning = false;
  private userWarp: number | null = null;
  /** Last autopilot goal and its velocity change still to make (|ΔU|), for the displays. */
  private lastWant: { beta: Vec3; ff: Vec3 } | null = null;
  /** the orbit autopilot's last wanted 4-velocity (ZAMO components) and the proper time it was for */
  private prevWant: { U: Vec3; tau: number; body: string } | null = null;
  /** the warp to give back once a low-thrust cruise has reached its orbit */
  private warpAfter: number | null = null;
  /** rapidity spent by the engines since the tank was filled (the propellant gauge) */
  spent = 0;
  private pathKey = "";
  private pathCost = 0;
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
  private shipTime = NaN;
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

  /** The scene's time now: the frame's, or, once the ship has moved this frame, the ship's clock. */
  private nowTime() {
    if (Number.isFinite(this.shipTime)) return this.shipTime;
    return Number.isFinite(this.time) ? this.time : 0;
  }

  /**
   * The coordinate time the ship reached in the last update (null: it did not move): the scene's
   * clock takes it, so the bodies are drawn where the ship's integrator had them — also when an
   * autopilot changed the warp during the frame.
   */
  shipClock(): number | null {
    return Number.isFinite(this.shipTime) ? this.shipTime : null;
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

  /**
   * The gravitating bodies for the ship's geodesic: the companion star (Gargantua then orbits the
   * centre of mass with it), or a system's planets and stars (weak fields; m ≪ M, the hole stays
   * put). Undefined when there are none.
   */
  private lens(): Lens | Lens[] | undefined {
    const s = this.s;
    const list: Lens[] = [];
    if (s.sun && s.sunMass > 0) {
      const D3 = starOrbitRadius(s) ** 3;
      list.push({
        m: s.sunMass, R: s.sunRadius, centre: (t) => starCentre(s, t), velocity: (t) => starVelocity(s, t),
        // Gargantua orbits the centre of mass: its frame falls towards the star
        accel: (t) => holeAcceleration(s, t),
        accelRate: (t) => lin(starVelocity(s, t), s.sunMass / D3, [0, 0, 0], 0),
      });
    }
    if (s.system === "gargantua") {
      for (const b of GARGANTUA_SYSTEM.bodies) {
        if (b.universe !== "gargantua" || !(b.mass > 0) || b.kind === "hole") continue;
        const tr = bodyTrack(GARGANTUA_SYSTEM, b.id);
        list.push({ m: b.mass, R: b.radius, centre: tr.pos, velocity: tr.vel });
      }
    }
    if (!list.length) return undefined;
    return list.length === 1 ? list[0] : list;
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
    this.shipTime = NaN;
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
    // (the ship's clock after the step: the scene's time follows it — see shipClock)
    const t1 = this.nowTime() + simDt;
    this.shipTime = this.fallStep(simDt, keys, fast, acc) ?? t1;
  }

  private fallStep(simDt: number, keys: Vec3, fast: boolean, acc?: Vec3): number | undefined {
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
      // near a planet: its own frame (landing.ts)
      const lf = this.localFlight(cam, X0);
      if (lf) {
        const t0 = this.nowTime();
        const { F, L } = lf;
        const dtau = simDt / F.ut;
        const was = L.landed;
        const r = stepLocal(F, L, dtau, zamoToLocal(lin(dirZ, accel, dirZ, 0)));
        this.properTime += dtau;
        this.landed = L.landed;
        const F1 = planetFrame(F.id, t0 + simDt, a, s.massSolar);
        this.local!.F = F1;
        const g = toGlobal(F1, L);
        const b = zamoBeta(g.X, g.V, a);
        const f1 = sphericalFrame(g.X);
        const w1 = (v: Vec3) => add3(f1.er, f1.et, f1.ep, v);
        // (the ship's attitude keeps its components on the ZAMO axes: it turns with the planet)
        setHolePose(s, g.X, w1(cam.fwd), w1(cam.up), w1(b));
        s.motion = "geodesic";
        this.targetDistance = s.distance;
        this.local!.key = this.poseKeyNow();
        if (r.impact !== null && !was) {
          // (the Ranger rests on its belly: levelled on the ground, nose on the horizon)
          this.levelShip(localToZamo([L.xi[0], L.xi[1], L.xi[2]]));
          const name = BODY_NAMES[F.id as Body];
          const v = r.impact;
          this.onPilotMessage?.(v > CRASH_SPEED ? `Crashed on ${name} at ${v.toFixed(0)} m/s` : `Landed on ${name} · ${v.toFixed(1)} m/s`);
          if (this.pilot.auto !== "none" && this.pilot.auto !== "takeoff") this.pilot.setAuto(this.pilot.auto);
        }
        return t0 + simDt;
      }
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
      return st.t;
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
    this.plan = { nodes: [], path: null, at: 0, note: "" };
    this.transfer = null;
    this.spent = 0;
    this.local = null;
    this.warpAfter = null;
    this.restoreWarp();
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

  /**
   * Puts the Ranger in the wormhole's world (rep coordinates: ℓ, direction n) with a 3-velocity, its
   * nose along `nose` and its top towards `top` (rep vectors); the camera goes where its mount is.
   */
  placeShipRep(l: number, n: Vec3, vel: Vec3, nose: Vec3, top: Vec3) {
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

  /**
   * Levels the ship on the ground: its top towards the local up (ZAMO components), its nose on the
   * horizon along its heading (tilted forwards if it stood on its tail). The cameras follow it.
   */
  private levelShip(upZ: Vec3) {
    const col = (S: M3, i: number): Vec3 => [S[0][i]!, S[1][i]!, S[2][i]!];
    const toC = (v: Vec3) => {
      const cam = cameraFrame(this.s);
      return [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)] as Vec3;
    };
    const S = this.shipMatrix();
    const Y = col(S, 1), Z = col(S, 2);
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
    if (this.pilot.auto !== "node" && this.userWarp !== null) this.restoreWarp(); // execution stopped
    if (this.pilot.auto !== "node") this.rails(cam);
    const burn = this.pilot.auto === "node" ? this.nodeBurn(cam, dt, dtau) : null;
    const tauRate = s.animate ? s.timeSpeed * dtau : 0;
    const out = this.pilot.step({
      dt, right: cam.right, up: cam.up, fwd: cam.fwd, beta: cam.beta, S: this.shipMatrix(), thrust: this.thrustMax(), tauRate,
      radialOut: this.radialOut(cam), target: this.targetDir(cam), want: (this.lastWant = this.pilot.auto !== "none" && this.pilot.auto !== "node" ? this.autopilotWant(cam) : null),
      burn,
      // (the Crew engine's autopilots, when a frame lasts more than ~20 s of the ship's time: a real
      // ship turns within it — the wall-clock turn rates are for the eye, not for days-long burns)
      snap: s.engine === "crew" && this.pilot.auto !== "none" && cam.region === "hole"
        && s.timeSpeed * dt * 4.925490947e-6 * s.massSolar > 20,
    }, inp);
    this.rotateC(out.rot);
    const simDt = s.animate ? s.timeSpeed * dt : 0;
    const tau0 = this.properTime;
    if (simDt > 0) this.fall(simDt, [0, 0, 0], false, out.acc);
    // rapidity spent (the propellant gauge), and the Δv delivered to the executing node (proper
    // acceleration × proper time)
    const w = Math.hypot(...out.acc) * (this.properTime - tau0);
    this.spent += w;
    if (burn && this.nodeBurning) this.nodeDone += w;
  }

  // ------------------------------------------------------------------------------ rails
  /** Warp the pilot asked for, while the rails hold it lower (null: none held back). */
  private warpWant: number | null = null;
  private warpSet = NaN;
  /** Why the rails hold the warp back (for the HUD), or "". */
  railsNote = "";

  /**
   * Time warp "on rails": beyond 500 M/s (up to 10⁵ — years of flight in seconds) with the engine
   * off. The warp comes down by itself where the flight needs to be followed — about 1/100 of an
   * orbit per frame around the hole, a few seconds before entering a body's Hill sphere (then 1/100
   * of the local orbit inside it), near the wormhole's mouth, and to 500 while the engine burns —
   * and goes back up to what was asked when it can.
   */
  private rails(cam: ReturnType<typeof cameraFrame>) {
    const s = this.s;
    // the pilot changed the warp: that is the new wish
    if (s.timeSpeed !== this.warpSet) this.warpWant = null;
    const want = this.warpWant ?? s.timeSpeed;
    // (the classic scenes keep their warps: the rails only engage beyond 500 M/s, or in a system)
    if (want <= 500 && s.system === "none") {
      this.warpWant = null;
      this.railsNote = "";
      this.warpSet = s.timeSpeed;
      return;
    }
    const { lim, why } = this.railsLimit(cam);
    // (never below 0.25 M/s — except near the ground, where seconds count)
    const w = Math.max(Math.min(want, lim), Math.min(want, why === "ground" ? 1e-5 : 0.25));
    if (w < want) this.warpWant = want;
    else this.warpWant = null;
    this.railsNote = w < want ? why : "";
    s.timeSpeed = w;
    this.warpSet = w;
  }

  /** How fast time may run here (M/s), and what holds it. */
  private railsLimit(cam: ReturnType<typeof cameraFrame>) {
    const s = this.s;
    let lim = 1e5;
    let why = "";
    const cap = (v: number, w: string) => {
      if (v < lim) (lim = v), (why = w);
    };
    // (long Crew burns: a higher ceiling — the integrator follows the slow thrust at any warp)
    if (this.pilot.accel > 0 || this.pilot.throttle > 0) cap(s.engine === "crew" ? 5000 : 500, "engine");
    if (cam.region === "hole") {
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      cap(Math.max(6, (60 * 2 * Math.PI * cam.r ** 1.5) / 100), "Gargantua");
      // (a low-thrust transfer holding a circle: the pilot's ~1 s response, a small part of a turn)
      const st = this.pilot.auto === "transfer" ? this.transfer?.stage : undefined;
      if (st === "spiral" && this.transfer && this.transfer.tol !== undefined) {
        const T = this.transfer;
        const rate = 2 * this.thrustMax() * cam.r ** 1.5; // dr/dt of the spiral
        cap(Math.max(0.5, (30 * Math.max(Math.abs(cam.r - T.rs) / 3, (T.tol ?? 0) / 4)) / Math.max(rate, 1e-12)), "end of spiral");
        // (and a frame's push no more than 0.3 % of the orbital speed: where the engine rivals the
        // hole's pull, the orbit's apsis would otherwise jump past the goal in one frame)
        cap(Math.max(0.5, (30 * 0.003 * Math.max(Math.hypot(...cam.beta), 1e-3)) / Math.max(this.thrustMax(), 1e-12)), "spiral");
      }
      if (this.local) {
        // (near the ground: a frame covers no more than a fifth of the height left)
        const { F, L } = this.local;
        const d = Math.hypot(...L.xi);
        const h = Math.max(d - groundR(F, L.xi) - GEAR / F.mPerM, 0);
        const vv = Math.abs((L.w[0] * L.xi[0] + L.w[1] * L.xi[1] + L.w[2] * L.xi[2]) / d) + 1e-12;
        // (the last metres at the pace of the last 20: no Zeno descent)
        const hc = Math.max(h, 20 / F.mPerM);
        if (!L.landed) cap(Math.max((30 * hc) / (5 * vv), 1e-4), "ground");
        // (landing, taking off: the pilot's response, ~1.2 s of warp, a tenth of the time to the ground)
        const pa = this.pilot.auto;
        if ((pa === "land" && !L.landed) || pa === "takeoff") cap(Math.max(hc / (12 * Math.max(vv, pa === "takeoff" ? 5 / 299792458 : 0)), 1e-5), "ground");
      }
      if (st === "circ" || st === "wait") cap(Math.max(6, (2 * Math.PI * cam.r ** 1.5) / 24), "circular orbit");
      const V = this.fromZamo(cam, sphericalFrame(X), cam.beta);
      const t = this.nowTime();
      // Approaching a sphere of radius edge around a body (rel: ship − body, dv: relative velocity):
      // a frame never skips more than a third of the gap; and when the straight line ahead enters
      // the sphere, a few seconds of flight before it (a third of the gap per frame under the
      // low-thrust autopilot). A body merely nearby, not approached, holds nothing back.
      const approach = (rel: Vec3, dv: Vec3, edge: number, floor: number, why: string) => {
        const d = Math.hypot(...rel);
        const v = Math.hypot(...dv) + 1e-12;
        if (d <= edge) return;
        cap(Math.max(floor, (10 * (d - edge)) / v), why);
        const closing = -dot3(rel, dv) / d;
        if (!(closing > 0)) return;
        const along = (closing * d) / v; // distance to the closest point of the straight line
        const miss = Math.sqrt(Math.max(0, d * d - along * along));
        if (miss > 2 * edge) return;
        cap(Math.max(floor, (d - edge) / closing / (this.pilot.auto === "transfer" ? 3 / 30 : 4)), why);
      };
      for (const b of availableBodies(s, cam)) {
        if (b === "hole" || b === "barycentre") continue;
        const C = bodyCentre(s, b, t);
        const rel = sub3(X, C);
        const dv = sub3(V, bodyVelocity(s, b, t));
        const d = Math.hypot(...rel);
        if (b === "wormhole") {
          approach(rel, dv, 3 * mouth(s).rGlue, 2, "the wormhole");
          continue;
        }
        const m = bodyMass(s, b);
        if (!(m > 0)) continue;
        const D = Math.hypot(...C);
        const hill = b === "star" ? D * Math.cbrt(m / 3) : bodyHill(s, b, t);
        // (outside: see approach — at worst 1/100 of an orbit at its sphere's edge per frame)
        if (d > hill) approach(rel, dv, hill, (60 * 2 * Math.PI * Math.sqrt(hill ** 3 / m)) / 100, BODY_NAMES[b]);
        // (inside: an orbit around a system body in no less than ~12 s, which the orbit autopilot can
        // follow; the classic scenes' star, 1.7 s)
        else cap((2 * Math.PI * Math.sqrt(Math.max(d, bodyRadius(s, b)) ** 3 / m)) / (b === "star" ? 1.67 : 12), BODY_NAMES[b]);
      }
    }
    return { lim, why };
  }

  // ------------------------------------------------------------------------------ flight plan
  /** The ship's state now (Kerr geodesic), or null away from the hole. */
  private stateNow() {
    const cam = cameraFrame(this.s);
    if (cam.region !== "hole") return null;
    return fromZamo(cam.r, cam.theta, cam.phi, cam.beta, this.s.spin, this.nowTime());
  }

  private world() {
    // the first burn at least ~8 s away at the current warp: time to turn the ship
    return { a: this.s.spin, lens: this.lens(), lead: 8 * (this.s.animate ? this.s.timeSpeed : 0) };
  }

  /**
   * Plans a transfer: "orbit" a circular orbit of radius r2 around the hole, "star" a rendezvous with
   * the companion (then station-keeping), "wormhole" a path through the mouth. Returns a message.
   */
  planTransfer(goal: "orbit" | "star" | "wormhole", r2 = 30, o: { orbitStar?: boolean } = {}): string {
    const s = this.s;
    // (the Crew engine's burns last days: its own guidance, not impulsive nodes)
    if (s.engine === "crew") return this.planLowThrust(goal, r2, !!o.orbitStar);
    this.transfer = null;
    const now = this.stateNow();
    if (!now) return "Planning works around the black hole";
    let w = this.world();
    // after a planned plane change: the transfer starts from the aligned orbit
    let st = now;
    let pre: ManeuverNode[] = [];
    if (this.plan.kind === "align" && this.plan.nodes.length === 1 && this.plan.nodes[0]!.t > now.t) {
      const after = planPath(now, this.plan.nodes, w, 1)?.states[0];
      if (after) (st = after), (pre = this.plan.nodes), (w = { ...w, lead: 0 });
    }
    let res: { nodes: ManeuverNode[]; note: string } | null = null;
    if (goal === "orbit") {
      const rMin = Math.max(isco(s.spin) * 1.02, horizon(s.spin) + 2);
      res = planCircular(st, Math.max(r2, rMin), w);
      if (!res) return "No transfer found (inside the photon orbit, or out of reach)";
    } else if (goal === "star") {
      // the companion star, or in a system the targeted body (a planet, Edmunds' star)
      const body: Body = s.system !== "none" && s.target !== "hole" && s.target !== "wormhole" && s.target !== "barycentre" ? s.target : "star";
      if (body === "star" && !s.sun) return "No companion star in this scene: select a body (Tab)";
      const R = bodyRadius(s, body);
      const mB = bodyMass(s, body);
      res = planRendezvous(st, w, {
        centre: (t) => bodyCentre(s, body, t), velocity: (t) => bodyVelocity(s, body, t), radius: R,
        // an orbit: close in (3.2 radii — well inside the Hill radius, ≈ 0.32 D; the orbit autopilot
        // then holds it against Gargantua's tides), in the sense the ship arrives with
        standoff: (o.orbitStar ? 3.2 : 4) * R,
        orbit: o.orbitStar && mB > 0 ? { mass: mB, n: [0, 0, 1] } : undefined,
      });
      if (!res) return `No rendezvous with ${BODY_NAMES[body]} found`;
      s.target = body;
    } else {
      if (!s.wormhole) return "No wormhole in this scene";
      const m = mouth(s);
      res = planIntercept(st, s.whOrbit ? (t: number) => mouth(s, t).C as Vec3 : (m.C as Vec3), w, 0.25 * m.w.rho);
      if (!res) return "No path into the mouth found from this orbit";
      s.target = "wormhole";
    }
    const nodes = [...pre, ...res.nodes];
    this.plan = { nodes, path: null, at: 0, note: pre.length ? `plane aligned, then ${res.note}` : res.note };
    this.refreshPlan(true);
    const dv = nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0);
    return `Plan: ${this.plan.note} · ${nodes.length} burn${nodes.length > 1 ? "s" : ""} · Δv ${dv.toFixed(3)} c`;
  }

  /**
   * The plane a goal lives in (normal, flat map): Gargantua's equator — the disk's, and the star's
   * orbit's — or, for the wormhole, the plane through the hole and the mouth nearest the ship's.
   */
  private goalPlane(goal: "orbit" | "star" | "wormhole", st: NonNullable<ReturnType<CameraController["stateNow"]>>): { n: Vec3; name: string } | null {
    if (goal !== "wormhole") return { n: [0, 0, 1], name: goal === "star" ? "the star's orbital plane" : "Gargantua's equatorial plane" };
    if (!this.s.wormhole) return null;
    const C = mouth(this.s).C as Vec3;
    const c = lin(C, 1 / (Math.hypot(...C) || 1), C, 0);
    const h = orbitNormal(st, this.s.spin);
    let n = sub3(h, lin(c, h[0] * c[0] + h[1] * c[1] + h[2] * c[2], c, 0));
    if (Math.hypot(...n) < 1e-6) n = [-c[1], c[0], 0];
    return { n, name: "the plane of the mouth" };
  }

  /** Plans a plane change into the goal's plane (a later PLAN TRANSFER starts from there). */
  planAlign(goal: "orbit" | "star" | "wormhole"): string {
    const st = this.stateNow();
    if (!st) return "Planning works around the black hole";
    const g = this.goalPlane(goal, st);
    if (!g) return "No wormhole in this scene";
    const res = planAlign(st, this.world(), g.n, g.name);
    if (!res) return `Already in ${g.name}`;
    this.plan = { nodes: res.nodes, path: null, at: 0, note: res.note, kind: "align" };
    this.refreshPlan(true);
    return `Plan: ${res.note} · Δv ${Math.hypot(...res.nodes[0]!.dv).toFixed(3)} c — PLAN TRANSFER now starts from the new plane`;
  }

  /** Angle between the ship's orbit and each goal's plane [°], null away from the hole. */
  private planeOffsets() {
    const st = this.stateNow();
    if (!st) return null;
    const deg = (g: "orbit" | "wormhole") => {
      const p = this.goalPlane(g, st);
      return p ? (planeOffset(st, this.s.spin, p.n) * 180) / Math.PI : null;
    };
    return { orbit: deg("orbit")!, wormhole: deg("wormhole") };
  }

  /** A manual node, `after` M from now (default: a tenth of an orbit), or its Δv / time nudged. */
  addNode(after?: number) {
    const st = this.stateNow();
    if (!st) return;
    const t = st.t + (after ?? Math.max(30, 0.1 * 2 * Math.PI * st.r ** 1.5, 8 * this.s.timeSpeed));
    this.plan.nodes.push({ t, dv: [0, 0, 0] });
    this.plan.nodes.sort((a, b) => a.t - b.t);
    this.plan.note = "manual node";
    this.plan.kind = undefined;
    this.refreshPlan(true);
  }
  nudgeNode(i: number, dv: Vec3, dt = 0) {
    const n = this.plan.nodes[i];
    if (!n) return;
    this.plan.kind = undefined;
    n.dv = [n.dv[0] + dv[0], n.dv[1] + dv[1], n.dv[2] + dv[2]];
    n.t = Math.max(this.nowTime() + 1, n.t + dt);
    this.refreshPlan(true);
  }
  deleteNode(i: number) {
    this.plan.nodes.splice(i, 1);
    if (!this.plan.nodes.length) this.clearPlan();
    else this.refreshPlan(true);
  }
  clearPlan() {
    this.plan = { nodes: [], path: null, at: 0, note: "" };
    this.transfer = null;
    this.warpAfter = null;
    if (this.pilot.auto === "transfer") this.pilot.setAuto("transfer");
    if (this.pilot.auto === "node") this.pilot.setAuto("node");
    this.restoreWarp();
  }

  /** The path through the nodes, from the current state (at most 3 times a second). */
  refreshPlan(force = false) {
    const P = this.plan;
    const now = performance.now();
    if (!P.nodes.length) return (P.path = null);
    if (!force && now - P.at < 330) return P.path;
    P.at = now;
    const st = this.stateNow();
    if (!st) return (P.path = null);
    // drop nodes left behind (missed or done)
    const last = P.nodes[P.nodes.length - 1]!;
    // (a rendezvous ends at the body: the station-keeping autopilot takes over there)
    const tail = last.then === "approach" ? last.t - st.t + 40
      : last.then === "orbit" ? last.t - st.t + 2 * Math.PI * Math.sqrt((4 * this.s.sunRadius) ** 3 / Math.max(this.s.sunMass, 1e-3))
      : Math.max(2 * 2 * Math.PI * st.r ** 1.5, 1.5 * (last.t - st.t), 600);
    // mid-burn: what is left of the first node's Δv, now
    let nodes = P.nodes;
    if (this.nodeBurning && this.pilot.auto === "node" && this.burnDir) {
      const n0 = nodes[0]!;
      const total = Math.hypot(...n0.dv);
      const left = Math.max(0, total - this.nodeDone);
      const dv = this.s.engine === "crew" ? lin(n0.dv, left / Math.max(total, 1e-12), n0.dv, 0) : nodeComponents(st, this.s.spin, lin(this.burnDir, left, this.burnDir, 0));
      nodes = [{ ...n0, t: st.t, dv }, ...nodes.slice(1)];
    }
    const res = planPath(st, nodes.filter((n) => n.t > st.t - 1), this.world(), Math.min(tail, 60000));
    P.path = res?.path ?? null;
    // through the wormhole's mouth: the path ends in the throat (the flat map knows nothing beyond)
    if (P.path && this.s.wormhole) {
      const m = mouth(this.s);
      const d = P.path.pts.map((q) => Math.hypot(...sub3(q, m.C as Vec3)));
      const j0 = d.findIndex((x) => x < m.rGlue);
      if (j0 >= 0) {
        let j = j0;
        while (j + 1 < d.length && d[j + 1]! < d[j]!) j++;
        if (d[j]! < m.w.rho) P.path = { pts: P.path.pts.slice(0, j + 1), times: P.path.times.slice(0, j + 1), fate: "wormhole" };
      }
    }
    return P.path;
  }

  private restoreWarp() {
    if (this.userWarp !== null) this.s.timeSpeed = this.userWarp;
    this.userWarp = null;
    this.nodeBurning = false;
    this.nodeDone = 0;
    this.burnDir = null;
  }

  /**
   * Executing the next node: warp towards it, point along its burn, fire so that the burn is centred
   * on its time, stop when its Δv is delivered; then the next one, or the plan's last manoeuvre
   * (circularize, station-keeping).
   */
  private nodeBurn(cam: ReturnType<typeof cameraFrame>, dt: number, dtau: number): { dir: Vec3; throttle: number; far?: boolean } | null {
    const s = this.s;
    const P = this.plan;
    const node = P.nodes[0];
    if (!node || cam.region !== "hole") {
      this.pilot.setAuto("node");
      this.restoreWarp();
      return null;
    }
    if (this.userWarp === null) this.userWarp = s.timeSpeed;
    const total = Math.hypot(...node.dv);
    const left = Math.max(0, total - this.nodeDone);
    // (the burn keeps the direction it had when it started: fixed in the local frame, not turning
    // with the velocity it changes)
    // (a Crew burn lasts a good part of an orbit: it follows the orbital frame — prograde, normal,
    // radial turn with the ship — and is centred on the node, a finite burn)
    const follow = s.engine === "crew";
    const dir = this.nodeBurning && this.burnDir && !follow ? this.burnDir : dvLocal(cam.beta, node.dv);
    const dl = Math.hypot(...dir) || 1;
    const aMax = Math.max(this.thrustMax(), 1e-9);
    const burnT = total / aMax / Math.max(dtau, 1e-3); // coordinate duration of the whole burn
    const toNode = node.t - this.nowTime();
    const start = toNode - burnT / 2;
    if (!this.nodeBurning && start <= 0) {
      this.nodeBurning = true;
      this.burnDir = lin(dir, 1 / dl, dir, 0);
    }
    if (this.nodeBurning) {
      // burn: about 2 s of the pilot's time for the whole burn (warp adapted); a Crew burn, ~10 s
      s.timeSpeed = follow ? Math.min(Math.max(burnT / 10, 0.05), 5000) : Math.min(Math.max(burnT / 2, 0.05), 200);
      const perFrame = aMax * s.timeSpeed * dt * dtau;
      if (left <= Math.max(1e-5, 0.02 * perFrame) || left < 1e-6) {
        P.nodes.shift();
        this.nodeDone = 0;
        this.nodeBurning = false;
        this.burnDir = null;
        s.timeSpeed = this.userWarp;
        if (!P.nodes.length) {
          const then = node.then ?? null;
          this.userWarp = null;
          P.path = null;
          this.pilot.auto = "none";
          if (then) this.pilot.setAuto(then);
          this.onPilotMessage?.(then ? `Manoeuvre done — ${then === "circularize" ? "circularizing" : then === "orbit" ? `in orbit around ${this.s.target === "star" ? "the star" : BODY_NAMES[this.s.target]}` : "station-keeping"}` : "Manoeuvre done");
        } else this.refreshPlan(true);
        return null;
      }
      return { dir: lin(dir, 1 / dl, dir, 0), throttle: Math.min(1, left / Math.max(perFrame, 1e-12)) };
    }
    // coast: warp so that the burn's start comes in ~2.5 s, slower once close (the nose is already
    // on the burn: it turns while coasting)
    const coast = start - 20;
    s.timeSpeed = coast > 0 ? Math.min(Math.max(coast / 2.5, 4), 1e5) : Math.min(Math.max(start / 1.5, 3), 12);
    // (a long coast rides the rails, held back near bodies like any flight)
    if (s.system !== "none" || s.timeSpeed > 500) s.timeSpeed = Math.min(s.timeSpeed, Math.max(this.railsLimit(cam).lim, 3));
    return { dir: lin(dir, 1 / dl, dir, 0), throttle: 0, far: start > 60 };
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
    if (s.target !== "hole") {
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

  /** A coordinate velocity (flat map, Cartesian) as the ZAMO at the camera measures it, and back. */
  private toZamo(cam: ReturnType<typeof cameraFrame>, f: ReturnType<typeof sphericalFrame>, W: Vec3): Vec3 {
    return coordToZamo([dot3(W, f.er), dot3(W, f.et), dot3(W, f.ep)], cam.r, cam.theta, cam.zamo);
  }

  private fromZamo(cam: ReturnType<typeof cameraFrame>, f: ReturnType<typeof sphericalFrame>, b: Vec3): Vec3 {
    return add3(f.er, f.et, f.ep, zamoToCoord(b, cam.r, cam.theta, cam.zamo));
  }

  /** The engine's maximum proper acceleration now [c²/M]: none once the tank is empty. */
  thrustMax() {
    const s = this.s;
    if (s.fuel && tank(s, this.spent).empty) return 0;
    return engineThrust(s);
  }

  /** Fills the tank again. */
  refuel() {
    this.spent = 0;
  }

  /** Angular rate of a circular orbit around the hole through C (the frame a body there turns with). */
  private holeOmega(C: Vec3) {
    return 1 / (Math.hypot(...C) ** 1.5 + Math.abs(this.s.spin));
  }

  // ------------------------------------------------------------------------------ planet frame
  /** the planet the ship flies in the frame of (landing.ts), and its state there */
  local: { F: PlanetFrame; L: LocalState; key?: string } | null = null;
  private poseKeyNow() {
    const s = this.s;
    return [s.distance, s.inclination, s.azimuth, s.velR, s.velT, s.velP].join();
  }

  /**
   * The planet frame to fly in now, entering it within half a planet's Hill radius (its sphere of
   * influence) and leaving it beyond 0.6 of it (a margin: no flicker at the edge). Planets of the
   * system only (the classic scenes' star keeps the global integration).
   */
  private localFlight(cam: ReturnType<typeof cameraFrame>, X: Vec3): { F: PlanetFrame; L: LocalState } | null {
    const s = this.s;
    const t = this.nowTime();
    // (the pose changed from elsewhere — a preset, a jump: start again from it)
    if (this.local && this.local.key !== undefined && this.local.key !== this.poseKeyNow()) this.local = null;
    if (this.local) {
      const { F, L } = this.local;
      const hill = bodyHill(s, F.id as Body, t);
      if (Math.hypot(...L.xi) < 0.6 * hill || L.landed) return this.local;
      this.local = null;
      return null;
    }
    if (s.system === "none") return null;
    for (const b of availableBodies(s, cam)) {
      const sb = SYSTEM_BODIES.includes(b as SystemBody) ? GARGANTUA_SYSTEM.bodies.find((q) => q.id === b) : null;
      if (!sb || sb.kind !== "planet" || sb.universe !== "gargantua") continue;
      const C = bodyCentre(s, b, t);
      const d = Math.hypot(X[0] - C[0], X[1] - C[1], X[2] - C[2]);
      if (d > 0.5 * bodyHill(s, b, t)) continue;
      const F = planetFrame(b, t, s.spin, s.massSolar);
      const L = toLocal(F, X, betaToCoord(X, cam.beta, s.spin));
      this.local = { F, L };
      return this.local;
    }
    return null;
  }

  /** Radar altitude, speeds relative to the ground, thrust-to-weight: the landing HUD. */
  private surfaceInfo() {
    const lf = this.local;
    if (!lf) return null;
    const { F, L } = lf;
    const c = 299792458;
    const d = Math.hypot(...L.xi);
    const up: Vec3 = [L.xi[0] / d, L.xi[1] / d, L.xi[2] / d];
    const vv = dot3(L.w, up);
    const vh = Math.hypot(L.w[0] - vv * up[0], L.w[1] - vv * up[1], L.w[2] - vv * up[2]);
    const g = weightUp(F, L.xi);
    // re-entry glow (visual): the heat flux scale ρ v³ [W/m²], the air's flow in the camera frame
    const rho = airDensity(F, d - F.R);
    const sp = Math.hypot(...L.w);
    const q = rho * (sp * c) ** 3;
    const cam = cameraFrame(this.s);
    const flowZ = sp > 0 ? localToZamo([-L.w[0] / sp, -L.w[1] / sp, -L.w[2] / sp]) : ([0, 0, 0] as Vec3);
    const flow: Vec3 = [dot3(flowZ, cam.right), dot3(flowZ, cam.up), dot3(flowZ, cam.fwd)];
    return {
      plasma: { q, flow, level: Math.min(Math.max((Math.log10(Math.max(q, 1)) - 5.5) / 2.5, 0), 1) },
      body: F.id as Body, alt: (d - groundR(F, L.xi)) * F.mPerM - GEAR, vVert: vv * c, vHor: vh * c,
      gLocal: (g * F.aUnit) / 9.80665, twr: this.thrustMax() / Math.max(g, 1e-30), landed: L.landed,
      air: airDensity(F, d - F.R),
    };
  }

  /**
   * Landing and take-off, in the planet's frame (landing.ts). Landing: the horizontal speed killed,
   * the descent no faster than half the engine's margin over the local weight can stop, down to
   * 1.5 m/s at touchdown. Take-off: up, turning prograde as it climbs, to the orbit's radius with the
   * circular speed of the turning frame; then the orbit autopilot. The goal velocity (local) is carried
   * to the ZAMO's terms; the feed-forward holds the ship against what gravity and the frame do.
   */
  private surfaceWant(cam: ReturnType<typeof cameraFrame>, say: (t: string) => null): { beta: Vec3; ff: Vec3 } | null {
    const P = this.pilot;
    const lf = this.local;
    const what = P.auto === "land" ? "Landing" : "Take-off";
    if (!lf || cam.region !== "hole") return say(`${what}: get into the planet's sphere of influence first (orbit it)`);
    const { F, L } = lf;
    const name = BODY_NAMES[F.id as Body];
    const c = 299792458;
    const d = Math.hypot(...L.xi);
    const up: Vec3 = [L.xi[0] / d, L.xi[1] / d, L.xi[2] / d];
    const h = d - groundR(F, L.xi) - GEAR / F.mPerM;
    const g = weightUp(F, L.xi);
    const thr = this.thrustMax();
    if (thr < 1.05 * g) {
      const gU = F.aUnit / 9.80665;
      return say(`${what}: the engine (${(thr * gU).toFixed(1)} g) cannot hold the weight on ${name} (${(g * gU).toFixed(2)} g)`);
    }
    let want: Vec3;
    if (P.auto === "land") {
      if (L.landed) {
        P.setAuto("land");
        this.onPilotMessage?.(`Landed on ${name}`);
        return null;
      }
      // vertical speed: what half the margin can stop (v² = 2 a h), no less than a minute from the
      // ground (a Cinema engine could stop far more), 1.5 m/s at the end
      const minute = 60 / (4.925490947e-6 * this.s.massSolar); // [M]
      const vd = -Math.max(Math.min(Math.sqrt(2 * 0.5 * (thr - g) * Math.max(h, 0)), Math.max(h, 0) / minute, 0.02), 1.5 / c);
      want = [up[0] * vd, up[1] * vd, up[2] * vd];
    } else {
      // up to the orbit the orbit autopilot would keep (0.3 of the Hill radius), turning prograde
      const hill = bodyHill(this.s, F.id as Body, this.nowTime());
      const d0 = Math.max(0.3 * hill, 1.2 * F.R);
      const f = Math.min(Math.max((d - F.R) / (d0 - F.R), 0), 1);
      let east: Vec3 = [-up[1], up[0], 0];
      const el = Math.hypot(...east);
      east = el > 1e-6 ? [east[0] / el, east[1] / el, 0] : [0, 1, 0];
      const vc = Math.sqrt(F.m / d) - F.n * F.ut * d; // circular, in the turning frame
      // (a climb of about three minutes to the orbit's height at most — a Cinema engine could go far
      // faster)
      const minute = 60 / (4.925490947e-6 * this.s.massSolar); // [M]
      const vUp = Math.min(Math.sqrt((thr - g) * (d0 - F.R)) * 0.5, (d0 - F.R) / (3 * minute), 0.02) * (1 - f) + 0.2 / c;
      const vE = vc * Math.sqrt(f);
      if (f > 0.95 && Math.abs((L.w[0] * east[0] + L.w[1] * east[1] + L.w[2] * east[2]) / vc - 1) < 0.1) {
        P.auto = "none";
        P.setAuto("orbit");
        this.onPilotMessage?.(`In orbit around ${name}`);
        return null;
      }
      want = [up[0] * vUp + east[0] * vE, up[1] * vUp + east[1] * vE, up[2] * vUp + east[2] * vE];
    }
    // to the ZAMO's terms at the ship
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const gW = toGlobal(F, { xi: L.xi, w: want, landed: false });
    const beta = zamoBeta(X, gW.V, this.s.spin);
    // feed-forward: what holds the ship on that velocity against gravity and the frame
    const free = localAccel(F, L.xi, want, [0, 0, 0]);
    return { beta, ff: localToZamo([-free[0], -free[1], -free[2]]) };
  }

  /** The massive body nearest a point at time t (what a predicted path ran into). */
  private nearestBody(X: Vec3, t: number): Body | undefined {
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
  private followFF(cam: ReturnType<typeof cameraFrame>, beta: Vec3): Vec3 {
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

  // ------------------------------------------------------------------------------ low thrust
  /**
   * A low-thrust transfer (Crew engine): a simple guidance law that converges, not an optimum.
   * Around Gargantua, where its pull beats the engine: tangential spirals (prograde to climb,
   * retrograde to sink), circularizing between them; to meet a body on its circle (a planet, the
   * mouth), a parking circle 10 % off its radius, a drift until the phase is right, a last spiral onto
   * its circle, and the orbit / station-keeping autopilot for the final approach. Far out, where the
   * engine beats the hole (a > 3 M/r²): a spiral out to there, a wait until the body is on the same
   * side, and the straight flight of the orbit / approach autopilot (accelerate, then brake).
   */
  transfer: LowThrust | null = null;

  /** Plans a low-thrust transfer (the Crew engine's PLAN TRANSFER); EXECUTE flies it. */
  planLowThrust(goal: "orbit" | "star" | "wormhole", r2: number, orbitBody: boolean): string {
    const s = this.s;
    const cam = cameraFrame(s);
    if (cam.region !== "hole") return "Planning works around the black hole";
    const a = this.thrustMax();
    if (!(a > 0)) return "No thrust: the tank is empty";
    const r0 = cam.r;
    const vc = (r: number) => 1 / Math.sqrt(r);
    const days = (tM: number) => (tM * 4.925490947e-6 * s.massSolar) / 86400;
    let tr: LowThrust;
    let dv = 0;
    let what = "";
    if (goal === "orbit") {
      const rMin = Math.max(isco(s.spin) * 1.02, horizon(s.spin) + 2);
      const r = Math.max(r2, rMin);
      tr = { goal: "orbit", r2: r, stage: "spiral", rs: r };
      dv = Math.abs(vc(r0) - vc(r));
      what = `spiral ${r0.toFixed(0)} → ${r.toFixed(0)} M, circularize`;
    } else {
      const body: Body = goal === "wormhole" ? "wormhole"
        : s.system !== "none" && s.target !== "hole" && s.target !== "wormhole" && s.target !== "barycentre" ? s.target : "star";
      if (body === "star" && !s.sun) return "No companion star in this scene: select a body (Tab)";
      if (body === "wormhole" && !s.wormhole) return "No wormhole in this scene";
      const t = this.nowTime();
      const R = Math.hypot(...bodyCentre(s, body, t));
      const co = 3 / (R * R) >= a; // the hole's pull beats the engine there
      const orbit = orbitBody && bodyMass(s, body) > 0;
      s.target = body;
      if (co) {
        const side = r0 >= R ? 1 : -1;
        tr = { goal: "body", body, orbit, mode: "coorbital", stage: "spiral", rs: R * (1 + 0.1 * side) };
        dv = Math.abs(vc(r0) - vc(R));
        what = `spiral ${r0.toFixed(0)} → ${(R * (1 + 0.1 * side)).toFixed(1)} M, phase with ${BODY_NAMES[body]} (a few more % of Δv), spiral onto its circle`;
      } else {
        const rFree = Math.min(Math.max(Math.sqrt(3 / a), r0), 0.5 * R);
        const D = R - rFree;
        tr = { goal: "body", body, orbit, mode: "cruise", stage: "spiral", rs: rFree };
        // (and the hole's pull fought along the straight flight: ∫ M/r² dt ≈ (1/r_free − 1/R)/v)
        const vCruise = Math.min(0.05, Math.sqrt(a * D));
        dv = Math.abs(vc(r0) - vc(rFree)) + 2 * vCruise + (1 / rFree - 1 / R) / vCruise;
        what = `spiral out to ${rFree.toFixed(0)} M, then fly ${D.toFixed(0)} M to ${BODY_NAMES[body]}`;
      }
      what += orbit ? ", orbit it" : ", keep station";
    }
    this.plan = { nodes: [], path: null, at: 0, note: "" };
    this.transfer = tr;
    const w = Math.atanh(Math.min(dv, 0.999));
    const budget = s.fuel ? tank(s, this.spent) : null;
    const over = !budget ? "" : w > budget.left ? ` — ⚠ over the propellant left (${budget.left.toFixed(3)})` : ` — ≈ ${Math.round((100 * w) / Math.max(budget.budget, 1e-12))}% of the tank`;
    tr.note = `Low thrust at ${accelToG(a, s).toFixed(1)} g: ${what} · Δv ≈ ${dv.toFixed(3)} c, ≥ ${days(dv / a).toFixed(0)} d of burning${over}`;
    return `Plan: ${tr.note}`;
  }

  /**
   * Meeting a body on its circle around the hole: its radius, the phase it is ahead of the ship, and
   * the angular rate of circles.
   */
  private coorbit(body: Body, cam: ReturnType<typeof cameraFrame>, a: number) {
    const s = this.s;
    const C = bodyCentre(s, body, this.nowTime());
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const R = Math.hypot(...C);
    const om = (x: number) => 1 / (x ** 1.5 + Math.abs(s.spin));
    const dphi = Math.atan2(Math.sin(Math.atan2(C[1], C[0]) - Math.atan2(X[1], X[0])), Math.cos(Math.atan2(C[1], C[0]) - Math.atan2(X[1], X[0])));
    return {
      R, dphi, om,
    };
  }

  /**
   * The last stretch to a body on its circle: the minimum-energy push of the linear relative motion
   * (Kerr's epicycles about the body — the hole's tide and the frame's turning in closed form, see
   * lowthrust.ts), re-solved every frame with the time left; that time is set at the start as the
   * shortest for which the push stays within half the engine. Null once there (the orbit / approach
   * autopilot takes over).
   */
  private rendezvousGuidance(T: LowThrust, cam: ReturnType<typeof cameraFrame>, a: number): Vec3 | null {
    if (T.goal !== "body") return null;
    const s = this.s;
    const t = this.nowTime();
    const C = bodyCentre(s, T.body, t);
    const R = Math.hypot(...C);
    const ep = epicycle(R, Math.abs(s.spin));
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const f = sphericalFrame(X);
    const Vs = this.fromZamo(cam, f, cam.beta);
    // curvilinear coordinates about the body: x = ϖ − R, y = R Δφ, z
    const rc = Math.hypot(X[0], X[1]);
    const eR: Vec3 = [X[0] / rc, X[1] / rc, 0], eP: Vec3 = [-X[1] / rc, X[0] / rc, 0];
    const dph = Math.atan2(X[1], X[0]) - Math.atan2(C[1], C[0]);
    const st: State6 = [rc - R, R * Math.atan2(Math.sin(dph), Math.cos(dph)), X[2], dot3(Vs, eR), R * (dot3(Vs, eP) / rc - ep.n), Vs[2]];
    // the meeting point: on the body's circle, a few Hill radii behind or ahead of it (on the ship's
    // side) — at rest there relative to it, where the orbit / approach autopilot takes over
    const Rb = bodyRadius(s, T.body);
    const hill = bodyHill(s, T.body, t) || 3 * Rb;
    const stand = Math.max(1.5 * hill, 15 * Rb);
    if (T.side === undefined) T.side = st[1] >= 0 ? 1 : -1;
    const rs: State6 = [st[0], st[1] - T.side * stand, st[2], st[3], st[4], st[5]];
    const dist = Math.hypot(rs[0], rs[1], rs[2]);
    const rel = Math.hypot(st[3], st[4], st[5]);
    if (dist < 0.5 * stand && rel < Math.max(Math.sqrt(a * stand), 1e-6)) return null;
    const push = (tg: number) => rendezvousPush(ep, rs, tg);
    if (T.tEnd === undefined) {
      let best = Infinity, tg0 = 2 / ep.n;
      for (let tg = 0.5 / ep.n; tg < 60 / ep.n; tg *= 1.15) {
        const p = push(tg);
        const m = p ? Math.hypot(...p) : Infinity;
        if (m <= 0.5 * a) {
          tg0 = tg;
          break;
        }
        if (m < best) (best = m), (tg0 = tg);
      }
      T.tEnd = t + tg0;
    }
    const tgo = T.tEnd - t;
    // (the time is up: hand over wherever it is)
    if (tgo < (3 * s.timeSpeed) / 30) return null;
    const A = push(tgo);
    if (!A) return null;
    // local components; coordinate acceleration → proper (× (dt/dτ)² of the body's orbit)
    const Aw = lin(lin(eR, A[0], eP, A[1]), 1, [0, 0, 1], A[2]);
    const k = ep.ut ** 2;
    const loc: Vec3 = [dot3(Aw, f.er) * k, dot3(Aw, f.et) * k, dot3(Aw, f.ep) * k];
    const L = Math.hypot(...loc);
    return L > a ? lin(loc, a / L, loc, 0) : loc;
  }

  /** The straight segment X → C passes the hole no closer than dMin. */
  private lineClears(X: Vec3, C: Vec3, dMin: number) {
    const d = sub3(C, X);
    const u = clamp(-dot3(X, d) / Math.max(dot3(d, d), 1e-30), 0, 1);
    return Math.hypot(...lin(X, 1, d, u)) >= dMin;
  }

  /** The transfer's goal for the pilot at this stage (stages advance by themselves). */
  private transferWant(cam: ReturnType<typeof cameraFrame>, say: (t: string) => null): { beta: Vec3; ff: Vec3 } | null {
    const s = this.s;
    const T = this.transfer;
    if (!T) return say("No low-thrust transfer planned (PLAN with the Crew engine)");
    if (cam.region !== "hole") return say("Low-thrust transfer: only around the black hole");
    const a = this.thrustMax();
    if (!(a > 0)) return say("Transfer stopped: the tank is empty");
    // (it flies itself at the highest warp the rails allow)
    if (T.warp === undefined) {
      T.warp = s.timeSpeed;
      // (the wish is the rails' ceiling; this frame already runs at what they allow now)
      this.warpWant = 1e5;
      s.timeSpeed = this.warpSet = Math.min(1e5, this.railsLimit(cam).lim);
    }
    const r = cam.r;
    const b = cam.beta;
    // tangential direction (local), in the sense of the motion
    let tv: Vec3 = [0, b[1], b[2]];
    const tl = Math.hypot(...tv);
    tv = tl > 1e-6 ? lin(tv, 1 / tl, tv, 0) : [0, 0, 1];
    const coast = { beta: b, ff: [0, 0, 0] as Vec3 };
    const next = (st: LowThrust["stage"]) => {
      T.stage = st;
      T.gap = undefined;
      T.up = undefined;
      T.tol = undefined;
      T.tEnd = undefined;
    };
    // (a body on Gargantua's equator: the orbit's tilt is damped all along — a push against the
    // vertical velocity, which swings with the tilt twice a turn — so the ship arrives in its plane)
    const tilt = (ff: Vec3): Vec3 => (T.goal !== "body" ? ff : [ff[0], ff[1] - 0.5 * a * clamp(b[1] / 0.005, -1, 1), ff[2]]);
    // a circle's velocity as the goal (its vertical part left to the damping)
    const round = (c: { beta: Vec3; ff: Vec3 }) => (T.goal !== "body" ? c : { beta: [c.beta[0], b[1], c.beta[2]] as Vec3, ff: tilt(c.ff) });
    const finish = (auto: Auto, msg: string) => {
      this.transfer = null;
      // (a cruise still has the long straight flight ahead: the rails keep the warp until the orbit)
      if (T.goal === "body" && T.mode === "cruise") this.warpAfter = Math.min(T.warp ?? 4, 50);
      else {
        s.timeSpeed = this.warpSet = Math.min(T.warp ?? 4, 50);
        this.warpWant = null;
      }
      this.pilot.auto = "none";
      this.pilot.setAuto(auto);
      this.onPilotMessage?.(msg);
      return null;
    };
    // Newtonian osculating orbit (the spiral's stop: apoapsis or periapsis at the goal when the
    // engine is strong for the place; the radius itself when it is weak and the orbit stays round)
    const osc = () => {
      const vr = b[0], vt = tl;
      const e = 0.5 * (vr * vr + vt * vt) - 1 / r;
      if (e >= 0) return { pe: r, ap: Infinity };
      const sma = -1 / (2 * e), ecc = Math.sqrt(Math.max(0, 1 + 2 * e * (r * vt) ** 2));
      return { pe: sma * (1 - ecc), ap: sma * (1 + ecc) };
    };
    if (T.stage === "spiral") {
      if (T.up === undefined) T.up = T.rs > r;
      // (the rails slow the last part of a spiral down: it stops within tol of its radius)
      if (T.tol === undefined) T.tol = 0.002 * T.rs;
      const up = T.up;
      const o = osc();
      // (a cruise leaves from where the engine beats the hole: the radius itself must be reached)
      const strong = a > 0.3 / (r * r) && !(T.goal === "body" && T.mode === "cruise");
      const reached = up ? r >= T.rs : r <= T.rs;
      let done = reached || (strong && (up ? o.ap >= T.rs : o.pe <= T.rs));
      if (done && T.goal === "body" && T.mode === "cruise") {
        // (a cruise also waits, still climbing, for a straight line to the body that clears the hole
        // — at half the way there it stops climbing and waits on its circle)
        const C = bodyCentre(s, T.body, this.nowTime());
        const X = blToCartesian(cam.r, cam.theta, cam.phi);
        const clear = this.lineClears(X, C, 0.5 * r);
        if (clear) {
          next("final");
          return { beta: b, ff: [0, 0, 0] };
        }
        done = r >= 0.5 * Math.hypot(...C);
      }
      // (the circle's speed here as the goal — the pilot keeps the orbit round — and the tangential
      // push on top: a spiral of near-circular turns)
      if (!done) {
        const c = this.circularWant(cam);
        // (with the drift a tangential push gives a circular orbit: dr/dt = ±2 a r^{3/2})
        const want: Vec3 = typeof c === "string" ? b : [clamp((up ? 2 : -2) * a * r ** 1.5, -0.1, 0.1), c.beta[1], c.beta[2]];
        return { beta: [want[0], b[1], want[2]], ff: tilt(lin(tv, up ? a : -a, tv, 0)) };
      }
      // (stopped on the orbit's apsis, not on the radius: coast there, then round the orbit)
      if (!reached) {
        const u = !!up;
        next("coast");
        T.up = u;
      } else next("circ");
    }
    if (T.stage === "coast") {
      if (T.up ? b[0] > 0 : b[0] < 0) return { beta: b, ff: tilt([0, 0, 0]) };
      next("circ");
    }
    if (T.stage === "circ") {
      const c0 = this.circularWant(cam);
      if (typeof c0 === "string") return say(c0);
      const c = round(c0);
      const err = Math.hypot(...sub3(c.beta, b));
      if (err > 2e-3 * Math.hypot(...c.beta)) return c;
      if (T.goal === "orbit") return finish("circularize", `Transfer done — circular orbit at ${r.toFixed(1)} M`);
      if (T.mode === "cruise") next("wait");
      else {
        // co-orbital: on the body's circle and close enough behind or ahead of it — the final
        // approach; on the circle but far — a parking circle a little off it (lower to catch up,
        // higher to let it come), sized so the drift takes a few turns; off the circle — drift
        // until the spiral back meets the body. Each round shrinks the offset tenfold or so.
        const g = this.coorbit(T.body, cam, a);
        // (the relative guidance re-solves every frame: it can start a little off the circle)
        const near = Math.abs(r - g.R) < 0.05 * g.R;
        if (near && Math.abs(g.dphi) < 0.15) next("rdv");
        else if (!near) next("drift");
        else {
          const d = -Math.sign(g.dphi) * clamp(Math.abs(g.dphi) / (9 * Math.PI), 0.004, 0.1);
          T.rs = g.R * (1 + d);
          next("spiral");
          return c;
        }
      }
    }
    if (T.goal !== "body") return coast;
    if (T.stage === "wait") {
      // (cruise: leave from the body's side of the hole — the straight flight must not pass it)
      const C = bodyCentre(s, T.body, this.nowTime());
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      if (!this.lineClears(X, C, 0.5 * cam.r)) {
        const c = this.circularWant(cam);
        return typeof c === "string" ? coast : round(c);
      }
      next("final");
    }
    if (T.stage === "drift") {
      // the gap left once the spiral back onto the circle has gained its share: start that spiral
      // when it crosses zero (coasting on the parking circle meanwhile)
      const g = this.coorbit(T.body, cam, a);
      const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
      const tBack = Math.abs(1 / Math.sqrt(r) - 1 / Math.sqrt(g.R)) / a;
      const gap = wrap(g.dphi - 0.5 * (g.om(r) - g.om(g.R)) * tBack);
      const prev = T.gap;
      T.gap = gap;
      if (!(prev !== undefined && Math.abs(gap) < 0.5 && Math.sign(gap) !== Math.sign(prev))) return { beta: b, ff: tilt([0, 0, 0]) };
      T.rs = g.R;
      next("spiral");
      return { beta: b, ff: [0, 0, 0] };
    }
    if (T.stage === "rdv") {
      const g = this.rendezvousGuidance(T, cam, a);
      if (g) return { beta: b, ff: g };
      next("final");
    }
    if (T.stage === "final") {
      const name = BODY_NAMES[T.body];
      if (T.orbit) return finish("orbit", `Transfer done — closing in on ${name}, then in orbit`);
      return finish("approach", `Transfer done — closing in on ${name}, then station-keeping`);
    }
    return coast;
  }

  /** The circular orbit's velocity here, in the plane the ship moves in (or why there is none). */
  private circularWant(cam: ReturnType<typeof cameraFrame>): { beta: Vec3; ff: Vec3 } | string {
    const s = this.s;
    const b = cam.beta;
    let t: Vec3 = [0, b[1], b[2]];
    let tl = Math.hypot(...t);
    if (tl < 1e-4) (t = [0, 0, s.spin >= 0 ? 1 : -1]), (tl = 1);
    t = lin(t, 1 / tl, t, 0);
    const pro = t[2] * (s.spin >= 0 ? 1 : -1) >= 0;
    const v = circularSpeed(cam.r, Math.abs(s.spin), pro, cam.zamo);
    if (v === null) return "No circular orbit here: inside the photon orbit";
    // the equatorial formula is only a first guess off the equator: the circular speed is the one
    // whose free fall has no radial acceleration (a_r linear in v² — two probes)
    const v1 = Math.abs(v), v2 = Math.min(1.05 * v1, 0.999);
    const a1 = this.freeFallAccel(cam, lin(t, v1, t, 0))[0];
    const a2 = this.freeFallAccel(cam, lin(t, v2, t, 0))[0];
    const vc = a2 !== a1 ? Math.sqrt(clamp(v1 * v1 - (a1 * (v2 * v2 - v1 * v1)) / (a2 - a1), 0, 0.998)) : v1;
    return { beta: lin(t, vc, t, 0), ff: [0, 0, 0] };
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
      const c = this.circularWant(cam);
      return typeof c === "string" ? say(c) : c;
    }
    if (P.auto === "transfer") return this.transferWant(cam, say);
    if (P.auto === "land" || P.auto === "takeoff") return this.surfaceWant(cam, say);
    if (P.auto === "orbit") {
      // a circular orbit around the star (in its orbital plane), at the distance it was engaged at
      if (cam.region !== "hole") return say("Orbit: only in the black hole's universe");
      const mB = bodyMass(s, s.target);
      if (s.target === "hole" || s.target === "barycentre" || !(mB > 0)) return say("Orbit: select a body with a mass (Tab)");
      if (this.landed) return say(`Landed on ${BODY_NAMES[s.target]}`);
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const f = sphericalFrame(X);
      const t = this.nowTime();
      const C = bodyCentre(s, s.target, t);
      const V = bodyVelocity(s, s.target, t);
      const R = bodyRadius(s, s.target);
      const rel = sub3(X, C);
      const d = Math.hypot(...rel);
      const Vs = this.fromZamo(cam, f, cam.beta);
      // the orbit's plane: the star's (its orbital plane around the hole), or the one the ship is in
      const h0 = cross(rel, sub3(Vs, V));
      const hl = Math.hypot(...h0);
      const n: Vec3 = s.target === "star" || hl < 1e-18 ? [0, 0, 1] : lin(h0, 1 / hl, h0, 0);
      if (!P.anchor) {
        // (the sense it goes round now; the distance now, kept above the surface and well inside the
        // body's Hill sphere, where the hole's tides no longer tear the orbit apart)
        const hill = bodyHill(s, s.target, t);
        const lo = s.target === "star" ? 2.4 * R : 1.03 * R;
        const hi = s.target === "star" ? 0.17 * starOrbitRadius(s) : Math.max(0.3 * hill, 1.1 * lo);
        // (around a planet the plane is the ship's own, n = ĥ: always the positive sense)
        P.anchor = [clamp(d, lo, hi), s.target === "star" ? Math.sign(h0[2]) || 1 : 1, 0];
      }
      const [d0, sense] = P.anchor as [number, number, number];
      const planet = s.target !== "star";
      if (planet && d > 2 * d0) {
        // far from it still (a planet's Hill sphere is a few radii): fly in first — towards a point
        // beside the body at the orbit's radius (the fall then ends in a pericentre there, not on the
        // ground: a weak engine could not stop a fall straight at it — Miller pulls 1.3 g at its
        // surface), at the speed that a braking at half thrust can still kill, its velocity matched
        const rhat0 = lin(rel, 1 / d, rel, 0);
        let across = cross([0, 0, 1], rhat0);
        if (Math.hypot(...across) < 1e-6) across = cross([1, 0, 0], rhat0);
        across = lin(across, 1 / Math.hypot(...across), across, 0);
        const aim = sub3(axpy(C, across, d0), X);
        const to = lin(aim, 1 / Math.hypot(...aim), aim, 0);
        const span = d - d0;
        // (and slow enough that the Coriolis push of the hole's frame, 2Ω v, stays within the engine)
        const thr = this.thrustMax();
        // (the braking left: half the engine less the body's own pull here)
        const brake = Math.max(0.5 * thr - mB / (d * d), 0.1 * thr);
        const vIn = Math.min(0.05, Math.sqrt(2 * brake * span), span / (4 * T), thr / (4 * this.holeOmega(C)));
        const Wa = axpy(V, to, vIn);
        const ba = this.toZamo(cam, f, Wa);
        return { beta: ba, ff: this.followFF(cam, ba) };
      }
      // (the circular speed around it, in its proper time: in the scene's time, × its clock rate dτ/dt)
      // (settled in orbit: the warp a low-thrust cruise ran at is given back)
      if (this.warpAfter !== null && Math.abs(d - d0) < 0.2 * d0) {
        s.timeSpeed = this.warpSet = this.warpAfter;
        this.warpWant = null;
        this.warpAfter = null;
      }
      const clock = s.target === "star" ? 1 : bodyState(GARGANTUA_SYSTEM, s.target, t).dtau;
      // (around a planet: circular at the distance it is at, spiralling down to d0 over a few turns —
      // the circle of d0 from farther out would fling it back out)
      const dc = planet ? clamp(d, d0, 2 * d0) : d0;
      const vc = Math.sqrt(mB / dc) * clock;
      const w0 = vc / dc;
      const relP = sub3(rel, lin(n, dot3(rel, n), n, 0));
      const tl = Math.hypot(...relP) || 1;
      const tdir = lin(cross(lin(n, sense, n, 0), relP), 1 / tl, n, 0);
      const rhat = lin(rel, 1 / Math.max(d, 1e-30), rel, 0);
      // distance and plane errors closed over a fraction of an orbit
      const vr = planet ? clamp(-(d - d0) * w0 * 0.3, -0.15 * vc, 0.15 * vc) : clamp(-(d - d0) * w0 * 0.6, -0.3 * vc, 0.3 * vc);
      const vz = clamp(-dot3(rel, n) * w0 * 0.6, -0.3 * vc, 0.3 * vc);
      const W = axpy(axpy(axpy(V, tdir, vc), rhat, vr), n, vz);
      const bw = this.toZamo(cam, f, W);
      return { beta: bw, ff: planet ? this.followFF(cam, bw) : [0, 0, 0] };
    }
    if (P.auto === "approach") {
      if (cam.region !== "hole") return say("Approach: only in the black hole's universe");
      if (s.target === "hole" || s.target === "barycentre") return say("Approach: select a body (Tab)");
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const f = sphericalFrame(X);
      const t = this.nowTime();
      const C = bodyCentre(s, s.target, t);
      const mB = bodyMass(s, s.target);
      const star = mB > 0; // a body with its own pull: the star, a planet
      const stand = s.target === "star" ? 4 * s.sunRadius : s.target === "wormhole" ? 1.3 * mouth(s).rGlue : 3 * bodyRadius(s, s.target);
      const away = sub3(X, C);
      const dist = Math.hypot(...away);
      if (this.warpAfter !== null && dist < 3 * stand) {
        s.timeSpeed = this.warpSet = this.warpAfter;
        this.warpWant = null;
        this.warpAfter = null;
      }
      const goal = axpy(C, away, stand / Math.max(dist, 1e-9));
      const d = sub3(goal, X);
      const dl = Math.hypot(...d);
      // (no faster than a braking at half thrust can kill, nor than the hole's frame lets the engine
      // follow: its Coriolis push 2Ω v)
      const thr = this.thrustMax();
      const close = Math.min(0.25, dl / (5 * T), Math.sqrt(thr * dl), thr / (4 * this.holeOmega(C)));
      const V: Vec3 = bodyVelocity(s, s.target, t);
      const W = axpy(V, d, close / Math.max(dl, 1e-30));
      const loc = this.toZamo(cam, f, W);
      if (star) {
        // the hole's pull is shared with the star (both fall); its own pull is not: cancel it
        if (this.landed) return say(`Landed on ${BODY_NAMES[s.target]}`);
        const g = lin(away, mB / Math.max(dist, bodyRadius(s, s.target)) ** 3, away, 0);
        return { beta: loc, ff: [dot3(g, f.er), dot3(g, f.et), dot3(g, f.ep)] };
      }
      // a static mouth is held against gravity; an orbiting one falls freely, and so does the ship
      if (s.whOrbit) return { beta: loc, ff: [0, 0, 0] };
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
      /** Carter constant, the spin (for the effective potential), radial 3-velocity (> 0 outwards) */
      Q: NaN,
      spin: a,
      vr: cam.region === "hole" ? cam.beta[0] : NaN,
      /** the autopilot's target speed (relative to the ZAMO), if any */
      wantSpeed: this.lastWant && this.pilot.auto !== "none" ? Math.hypot(...this.lastWant.beta) : NaN,
      rH: horizon(a),
      isco: isco(a),
      photon: photonOrbits(a).pro,
      ergo: cam.region === "hole" && cam.r < 1 + Math.sqrt(Math.max(0, 1 - a * a * Math.cos(cam.theta) ** 2)),
      accel: this.pilot.accel,
      throttle: this.pilot.auto !== "none" && this.pilot.burn ? this.pilot.accel / Math.max(this.thrustMax(), 1e-12) : this.pilot.throttle,
      sas: this.pilot.sas,
      /** what holds the rails' warp back ("" : nothing) */
      railsNote: this.railsNote,
      rollAlign: this.pilot.rollAlign,
      hold: this.pilot.hold,
      auto: this.pilot.auto,
      omega: this.pilot.omega,
      properTime: this.properTime,
      landed: this.landed,
      /** the body landed on */
      landedOn: this.landed ? this.nearestBody(blToCartesian(cam.r, cam.theta, cam.phi), this.nowTime()) ?? null : null,
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
      /** the flight plan: nodes, the path through them, the executing burn */
      /** the orbit's angle to each goal's plane [°] */
      planes: this.planeOffsets(),
      plan: this.plan.nodes.length ? { nodes: this.plan.nodes, path: this.refreshPlan(), note: this.plan.note, burning: this.nodeBurning, done: this.nodeDone, now: this.nowTime(), lowThrust: null as string | null }
        : this.transfer ? { nodes: [] as ManeuverNode[], path: null, note: this.transfer.note ?? "", burning: this.pilot.auto === "transfer" && this.pilot.accel > 0, done: 0, now: this.nowTime(), lowThrust: this.transfer.stage as string | null }
        : null,
      /** near a planet: its frame's figures (landing.ts) */
      surface: this.surfaceInfo(),
      /** the engine and the tank */
      engine: { kind: s.engine, max: this.thrustMax(), fuel: s.fuel ? tank(s, this.spent) : null },
      /** the selected target: distance (centre to centre, flat map) and range rate (> 0: receding) */
      target: s.target,
      targetDist: NaN,
      targetRate: NaN,
    };
    if (cam.region === "hole") {
      const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, a, this.nowTime());
      info.E = st.E;
      info.L = st.L;
      const ct = Math.cos(st.th), s2 = Math.max(Math.sin(st.th) ** 2, 1e-12);
      info.Q = st.uth * st.uth + ct * ct * (a * a * (1 - st.E * st.E) + (st.L * st.L) / s2);
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
      const Vt: Vec3 = s.target === "hole" ? [0, 0, 0] : bodyVelocity(s, s.target, t);
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
    // (at most 4 times a second, and never more than a fifth of the frame time)
    if (this.path && (key === this.pathKey || now - this.path.at < Math.max(250, 5 * this.pathCost))) return this.path;
    this.pathKey = key;
    const cam = cameraFrame(s);
    if (cam.region !== "hole") return (this.path = null);
    const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, s.spin, this.nowTime());
    // up to 0.95 of a turn around the hole: a bound orbit shows almost a full revolution without
    // coming back past the camera (a segment that close would sweep across the whole view)
    const tMax = clamp(2 * 2 * Math.PI * cam.r ** 1.5, 300, 60000);
    const p: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole" | "star" } = predict(st, s.spin, tMax, 480, this.lens(), 1e-7);
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
    this.pathCost = performance.now() - now;
    this.path = { ...p, at: now, dt: tMax / 480, hit: p.fate === "star" ? this.nearestBody(p.pts.at(-1)!, st.t + p.pts.length * (tMax / 480)) : undefined };
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
