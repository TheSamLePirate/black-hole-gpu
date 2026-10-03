import {
  basis, blToCartesian, cameraFrame, homePosition, repPose, repToHolePose, setHolePose, setHomePose, setRepPose, switchAnchor, yawPitchRoll,
} from "./camera";
import { TUNING } from "./game/tuning";
import { horizon, isco, photonOrbits, zamo, coordToZamo, zamoToCoord, type Vec3 } from "./physics";
import { SYSTEM_BODIES, type Settings, type SystemBody, type Target } from "./settings";
import {
  aimFrame, angularRadius, availableBodies, bodyCentre, bodyDistance, bodyLook, BODY_NAMES, cameraPosition, composeOffset, offsetFrom, pick,
  pixelLook, QUAT_ID, quatAngle, slerp, starCentre, starOmega, starPhase, starVelocity, type Body, type Quat,
  baryFraction, barycentreVelocity, holeAcceleration, starOrbitRadius, bodyVelocity, bodyMass, bodyRadius, bodyHill,
  cameraHome, isCraft, isOurBody, isOurs, onOurSide, ourLook, ourTarget, craftRadius,
} from "./targeting";
import { advance, fromZamo, step as geoStep, toZamo, type Lens } from "./geodesic";
import { GARGANTUA_SYSTEM } from "./system/bodies";
import { lensesOf } from "./lenses";
import { bodyState, bodyTrack } from "./system/ephemeris";
import { accelToG, engineThrust, tank } from "./engine";
import { epicycle, rendezvousPush, type State6 } from "./lowthrust";
import { AirFlight, AIR_WARP } from "./flightair";
import { attitudeFor, EntryGuidance, type EntryCraft, type EntryResult, type EntryState } from "./entry";
import { envOf, type EnvDesc } from "./entry-env";
import { siteDir, sitesOf, type Site, SITES } from "./game/sites";
import type { SiteTrack } from "./fc/land-ops";
import { elements as kepElements, followDv, fromPNR, propagate as kepProp, type V3 as KV3 } from "./fc/kepler";
import { circularize as fcCircularize, type Burn, type FcContext, type OpResult } from "./fc/ops";
import { timeTo as kepTimeTo } from "./fc/kepler";
import { airTopKm } from "./game/place";
import { Contrails, engineTrail, MAX_SEGMENTS, SEG_FLOATS, tipTrail, type ContrailSource } from "./contrails";
import { apsisLeft, circLeft, periodLeft, planeLeft, kApoapsis, kCircularize, kerrOrbit, kHohmann, kInclination, kMatchPlane, kPeriapsis, kResonant, type KerrOp, type KerrOrbit } from "./fc/kerr-ops";
import { issOrbit } from "./system/iss";
import { aeroForces, airAt, airTop, entryInterface } from "./aero";
import { airDensity, betaToCoord, GEAR, groundR, localAccel, localToZamo, planetFrame, stepLocal, toGlobal, toLocal, weightUp, zamoBeta, zamoToLocal, type LocalState, type PlanetFrame } from "./landing";
import { AUTO_NAMES, circularSpeed, FlightComputer, toU, type Auto, type FlightMode, type PilotInput } from "./pilot";
import { dvLocal, nodeComponents, type KerrGoal, orbitNormal, planAlign, planCircular, planeOffset, planIntercept, planPath, planRendezvous, type ManeuverNode, type PlanPath } from "./maneuver";
import { MOUNT_KEYS, MOUNTS, mountPose, setMountVessel, shipToCamera, type M3, type Mount, type MountPose, type OutsideView } from "./mounts";
import { fleet, type Pose } from "./fleet";
import { dockedFrame, VESSEL_IDS, VESSELS, type VesselId } from "./vessels";
import { GamepadInput, type PadAction } from "./gamepad";
import { ellOfR, flyDneg, holeToRep, mouth, radius, repToHole, sphericalFrame, toMouth, type Dneg } from "./wormhole";
import { gravityHome, homeOf, homeToRep, OUR_BODIES, ourGravity, ourState, referenceBody, repToHomeVec, soiOf } from "./system/our-side";
import { nodeDvHome, predictOurs, YOSHIDA, type OurPath } from "./system/our-predict";
import { keplerProp } from "./system/our-plan";
import type { Arrival, OurMission, OurPlanResult, PlanNode } from "./system/our-plan";
import { plan as runPlanner } from "./system/plan-client";
import { airDensity as ourAir, bodyFixedOf, dragAccel, fromBodyFixed, gearHeight, groundRelief, groundSpeeds, groundVelocity, solidBody, toBodyFixed } from "./system/our-surface";
import { M_METRES, M_SECONDS, SOLAR_BODIES, bodyAxes, solarBody, solarState, spinVector } from "./system/solar";
import { issAxes, issTrack, m34apply, m34unapply, partTransforms, station, stationAngles, type M34 } from "./system/iss";
import { craftPoint, freePort, planIssRendezvous, refineIssNode, rendezvousPoint, type RendezvousPoint } from "./system/iss-plan";
import { cockpitHull, stationHulls, vesselHulls, type TriBVH } from "./system/collide";

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
 * Also: momentum, smooth logarithmic zoom, keyboard, and cinematic modes. Touch: a finger drags, two
 * pinch (what the wheel does in the mode) and turn the view together (a right-drag), a double tap is a
 * double click. Cinematic modes:
 *  - orbit: the observer circles the hole (azimuth drift)
 *  - dive: exact free fall from rest at infinity (E = 1, L = Q = 0) integrated in proper time,
 *          seen from the infalling ("rain") frame; ends just outside the horizon.
 *  - journey: through Interstellar's wormhole, from our side to the black hole (or back).
 * Free flight with six degrees of freedom (FLIGHT_KEYS: translations along the camera's axes and roll;
 * right-drag turns the camera about its own axes, without limit) follows straight lines: spatial
 * geodesics of the wormhole metric near it (so it can cross the throat), flat lines near the hole.
 */
/** The Ranger's docking ring: its rear hatch's centre (ship frame: x left, y up, z nose) [m]. */
const onAxesV = (A: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [A[0][0] * v[0] + A[1][0] * v[1] + A[2][0] * v[2], A[0][1] * v[0] + A[1][1] * v[1] + A[2][1] * v[2], A[0][2] * v[0] + A[1][2] * v[1] + A[2][2] * v[2]];

/** The docking aid: the nearest free port in reach (the station's, a craft's) and the flown assembly's
 *  nearest free port against it. */
export interface DockInfo {
  /** what it docks to, its name, its port (index, name) */
  target: VesselId | "iss";
  title: string;
  port: number;
  name: string;
  /** the flown assembly's craft whose port it is, and which */
  own: VesselId;
  ownPort: number;
  /** the rings' distance, its part along the target port's axis (> 0: outside) and across it [m] */
  range: number;
  along: number;
  lateral: number;
  /** the closing rate along the axis and the drift across it [m/s] */
  closing: number;
  lateralRate: number;
  /** the two ports' axes apart (docked: facing) [deg] */
  angle: number;
  docked: boolean;
  /** the own ring's centre and axis, the target port's (home) */
  ring: Vec3;
  ownAxis: Vec3;
  c: Vec3;
  a: Vec3;
  /** the flown craft's place and axes (home) */
  X: Vec3;
  sh: [Vec3, Vec3, Vec3];
  /** the target's centre and velocity, its axes, its turn (the station's: once an orbit) */
  tgt: { X: Vec3; V: Vec3 };
  A: [Vec3, Vec3, Vec3];
  om: Vec3;
  /** the velocity against the target's point at the ring [m/s] */
  vrel: Vec3;
}

/** The runway in reach as the eye sees it (CameraController.runwayView): directions in camera
 *  coordinates, distances [m]; along (< 0 before the threshold) and across (> 0 right of the axis) [m]. */
export interface RunwayView {
  name: string;
  rwy: number;
  along: number;
  across: number;
  agl: number;
  corners: { d: Vec3; r: number }[];
  line: { d: Vec3; r: number }[];
  aim: { d: Vec3; r: number };
  gRef: number | null;
  gam: number | null;
  final: boolean;
}

/** The hub's card (CameraController.hubInfo): the autopilot, what it does now, its figures, its prediction. */
export interface HubInfo {
  /** the hub's own autopilot (CIRC's node: "circularize") */
  mode: string;
  title: string;
  phase: string;
  rows: [string, string][];
  /** what it predicts ("→ …"), or null */
  next: string | null;
  /** the phase's progress 0…1, or null */
  bar: number | null;
}

/** The future as the eye sees it (CameraController.futureView): directions in camera coordinates. */
export interface FutureView {
  pts: { d: Vec3; r: number; t: number; hid: boolean }[];
  marks: { t: number; d: Vec3; r: number; hid: boolean }[];
  impact: ({ kind: "ground" | "air" | "horizon" | "star"; t: number; d: Vec3; r: number; hid: boolean; ground?: { kind: "ground"; t: number; d: Vec3; r: number; hid: boolean } }) | null;
}

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
  /** two fingers: their midpoint at the last move (null: not two) */
  private pinchMid: { x: number; y: number } | null = null;
  /** a finger's last tap (a second within 320 ms nearby: a double tap), and when one was taken */
  private lastTap: { x: number; y: number; t: number } | null = null;
  private tapDblAt = -Infinity;
  private keys = new Set<string>();
  private codes = new Set<string>();
  /** A video steps the scene (sim.ts): the user's keys and controller are left out. */
  scripted = false;
  /** A video in a frozen instant: the camera's cinematics go on, the scene's time does not. */
  bulletTime = false;
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
  path: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole" | "star" | "local"; at: number; dt: number; hit?: Body } | null = null;
  /** Piloting the Ranger (on whenever the ship is): the flight computer and its last outputs. */
  readonly pilot = new FlightComputer();
  piloting = false;
  /** Near the station (5 km): the nearest port and the ship's docking ring against it — for the HUD. */
  dockInfo: DockInfo | null = null;
  /** let go of the station, not yet clear of the port */
  private undocking = false;
  /** the touch screen's flight controls (ui/touchflight.ts), −1…1: read with the keys */
  readonly touchInput = { pitch: 0, yaw: 0, roll: 0 };
  /** Pilot messages (autopilot engaged, impossible manoeuvre…) for the app to show. */
  onPilotMessage?: (text: string) => void;
  /** the flown craft entering the air (the last moment before an entry: a point to resume from) */
  onAirEntry?: () => void;
  /** the craft lost to the air (heat, load): why */
  onCraftLost?: (why: string) => void;
  /** the flown craft in the air: its forces, skin, load (flightair.ts) */
  readonly airFlight = new AirFlight();
  /** the time warp held down in the air: said once per descent */
  private airWarpSaid = false;
  /** The camera's place on the ship: moves smoothly (0.6 s) from one attach point to the next. */
  /** the outside views (mounts.ts: around, free): about the ship — yaw, pitch [deg] (0: behind it),
   *  distance [m]; free — the eye [m] and the look's yaw, pitch [deg] in the ship's frame (0: its nose) */
  outside = { yaw: 0, pitch: 12, dist: 42, eye: [18, 6, -36] as Vec3, fyaw: -25, fpitch: -5, fvel: [0, 0, 0] as Vec3 };
  /** the fly-by: where the camera stands (the local frame's axes, metres from the ship; null: to place) and
   *  its eye on the ship's axes this frame */
  private flyby: { E: Vec3 | null; eye: Vec3 } = { E: null, eye: [22, 6, 40] };
  /** the ship's views locked on the target: its direction on the ship's axes (x left, y up, z nose) */
  private shipAim: Vec3 | null = null;
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
  /** our universe: the executing node's Δv [P, N, R] as its burn along the orbital frame delivers it */
  private burnFollow: Vec3 | null = null;
  /** the prograde hold a mission's cruise set (given back before a burn) */
  private missionHold = false;
  /** the wormhole's side the ship was on (a crossing is said once) */
  private shipSide: "ours" | "gargantua" | null = null;
  /** crossing the throat at the mission's warp (real time given back beyond it) */
  private traversing = false;
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
  /** the free-fall path asked of the planner's worker, not back yet */
  private kerrPending = false;
  /** the flight's sub-steps allowed this frame (400 per 1/60 s) */
  private subCap = 400;
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
    fleet.activePose = () => this.activePoseNow();
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
  /**
   * The view is kept on the target: around it always, else when locked on it (lookAt) — not during the
   * dive, the journey or game-style flight, nor on the ship (its views aim by their own means) nor on
   * the tripod (it aims itself, turning with its ground).
   */
  private get tracking() {
    const s = this.s;
    const aimed = s.rotation === "orbit" || (s.lookAt && s.rotation !== "tripod");
    // (not when the rig turns about a planet, a moon — the classic aim resumes where it cannot: a body
    // beyond the wormhole, aimed at through its mouth)
    return aimed && !this.piloting && !this.flyMode && this.cinematic !== "dive" && this.cinematic !== "journey" && !(this.rig.on && this.rigOrbits());
  }
  /** Drags move the camera around the target (around it, not while it falls freely). */
  private get orbiting() {
    return this.tracking && this.s.rotation === "orbit" && !this.gravity;
  }

  /**
   * The camera's placement: around the target, following it, free, on a tripod — from where the camera
   * is (none of them moves it). Falling freely (gravity) is the free placement's: another one lands it.
   */
  setRotation(mode: Settings["rotation"]) {
    this.s.rotation = mode;
    this.activity = performance.now();
    if (mode !== "orbit" && this.cinematic === "orbit") this.setCinematic(null);
    if (mode !== "free" && this.gravity && !this.piloting) this.setGravity(false);
    if (mode === "orbit") this.startFocus();
    this.onCinematicChange(this.cinematic);
  }

  /** The view locked on the target (or free); turning it on turns the view to the target. */
  setLookAt(on: boolean) {
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
  /** The ship's views locked on the target: where the target sits in the view [°, right / up of centre]. */
  private lookOff: [number, number] = [0, 0];

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
      // (around the target: its frame — looking at it from anywhere leaves the camera's)
      if (this.orbiting) this.ensureAnchor();
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

  /** The space station from the camera's eye now: its direction (rep), distance [m], place and velocity. */
  private issSeen() {
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
  private issSurfaceDistance(v: NonNullable<ReturnType<CameraController["issSeen"]>>) {
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
      const P = bvh.pos, I = bvh.tri;
      for (let j = 0; j < I.length; j++) {
        const i = 3 * I[j]!;
        const d2 = (P[i]! - qp[0]) ** 2 + (P[i + 1]! - qp[1]) ** 2 + (P[i + 2]! - qp[2]) ** 2;
        if (d2 < best) best = d2;
      }
    });
    return Math.sqrt(best);
  }

  /** Whether a click at (x, y) [CSS px] falls on the space station's image (its 60 m, or 14 px). */
  private pickIss(x: number, y: number) {
    const v = this.issSeen();
    if (!v) return false;
    const s = this.s;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
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
  lockView() {
    const s = this.s;
    const C_MS = 299792458;
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
        const p = lin(v.dir, -v.dist, v.dir, 0), u = lin(vr, -1, vr, 0);
        const c = course(p, u, R);
        return { id: "iss", name: "ISS", colour: "95, 255, 208", dir: dirC, ang: Math.atan(R / v.dist), dist: this.issSurfaceDistance(v), centre: v.dist, vrel: vC, closing: -dot3(vr, v.dir), ...c };
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
    const p = lin(info.look, -centre, info.look, 0), u = lin(vr, -1, vr, 0);
    const c = course(p, u, R);
    // (a craft: the distance to its hull — its nearest vertex —, not to its sphere)
    const surf = isCraft(s.target) ? this.craftSurfaceDistance(s.target, cam) : null;
    return { id: String(s.target), name: info.name, colour: "", dir: dirC, ang: info.ang, dist: surf ?? Math.max(centre - R, 0), centre, vrel: toCam(vr), closing: -dot3(vr, info.look), ...c };
  }

  /** The distance from the eye to a craft's hull [m] (near it: its nearest vertex), or null. */
  private craftSurfaceDistance(id: VesselId, cam: ReturnType<typeof cameraFrame>): number | null {
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
    for (const i of hull.bvh.verticesNear(q, l)) best = Math.min(best, (P[3 * i]! - q[0]) ** 2 + (P[3 * i + 1]! - q[1]) ** 2 + (P[3 * i + 2]! - q[2]) ** 2);
    return Number.isFinite(best) ? Math.sqrt(best) : l - 0.6 * hull.radius;
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
    // (the bodies that move: the companion star, the centre of mass, our solar system's — seen now)
    const t = body === "star" || body === "barycentre" || isOurs(body) ? this.nowTime() : 0;
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
    // (our solar system's bodies: through our mouth — its frame; the rest, the hole's)
    const want = s.target === "wormhole" || isOurs(s.target) ? "wormhole" : "hole";
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
    // (standing on a world: the horizon level — the aim's own "up" is the mouth's frame's, tilted there;
    // kept as the offset from then on, so that the aim and the level do not undo each other each frame)
    if (this.rig.on && this.rig.fixed && this.levelOnGround()) {
      const b = basis(s.yaw, s.pitch, s.roll);
      this.offset = offsetFrom(A, b.fwd, b.up);
    }
    this.written = [s.yaw, s.pitch, s.roll].join();
  }

  /** The camera's up turned to the local vertical (its forward kept): true when it turned. */
  private levelOnGround(): boolean {
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
    return lensesOf(this.s);
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

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || this.flyMode) return;
    // (a middle click: game-style mouse look, the free camera's)
    if (e.button === 1 && !this.piloting) {
      e.preventDefault();
      this.setFlyMode(true);
      return;
    }
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
    if (this.pointers.size === 2) {
      this.pinchDist = this.pinchSpan();
      this.pinchMid = this.pinchCentre();
    }
    if (this.cinematic === "orbit") this.setCinematic(null);
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinchMid = null;
    // released after a pause: no fling
    if (performance.now() - this.lastMove > 80) this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
    // a click (no drag): select the body under the pointer
    const d = this.down;
    this.down = null;
    if (d && this.pointers.size === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5 && performance.now() - d.t < 400) {
      const r = this.canvas.getBoundingClientRect();
      // (the space station first: a click on it locks the targeting on it)
      if (this.pickIss(e.clientX - r.left, e.clientY - r.top)) {
        if (this.s.target !== "iss" && this.selectTarget("iss")) this.onPilotMessage?.("Target: the ISS");
      } else {
        const body = this.pickAt(e.clientX - r.left, e.clientY - r.top);
        if (body && body !== this.s.target) this.selectTarget(body);
      }
      // (a finger: two taps in a row are a double click — the browsers' own dblclick is unreliable
      // there)
      if (e.pointerType === "touch") {
        const now = performance.now();
        const l = this.lastTap;
        if (l && now - l.t < 320 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 30) {
          this.lastTap = null;
          this.tapDblAt = now;
          this.onDblClick(e, true);
        } else this.lastTap = { x: e.clientX, y: e.clientY, t: now };
      }
    }
  };

  /** Double-click: on a body, orbit it and fly the view to it (framed); on the sky, recentre / level. */
  private onDblClick = (e: MouseEvent, tap = false) => {
    if (!this.enabled || this.flyMode) return;
    // (the double tap taken already: not again from the browser's dblclick)
    if (!tap && performance.now() - this.tapDblAt < 600) return;
    if (this.piloting && !this.cinematic) return this.setLook(0, 0);
    const r = this.canvas.getBoundingClientRect();
    const body = this.pickAt(e.clientX - r.left, e.clientY - r.top);
    if (!body) return this.resetView();
    if (this.cinematic === "orbit") this.setCinematic(null);
    // (falling freely: the view locks on it; else the camera goes around it)
    if (this.gravity) this.s.lookAt = true;
    else this.s.rotation = "orbit";
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

  private pinchCentre() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y) } : null;
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
      // two fingers: spread or pinched, what the wheel does in this mode (zoom, the distance around a
      // body or the ship, the lens); moved together, the view turns as with a right-drag
      const span = this.pinchSpan();
      const mid = this.pinchCentre();
      if (this.pinchDist > 0 && span > 0) this.zoomStep(Math.log(this.pinchDist / span) / 0.0015, false);
      if (mid && this.pinchMid) this.dragBy(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y, dtEv, true);
      // (no fling after two fingers: their midpoint jitters as they move one event at a time)
      this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
      this.pinchDist = span;
      this.pinchMid = mid;
      return;
    }
    this.dragBy(dx, dy, dtEv, this.dragLook);
  };

  /** A drag of the view by (dx, dy) CSS pixels; look: as a right-drag (the view turns about itself). */
  private dragBy(dx: number, dy: number, dtEv: number, lookDrag: boolean) {
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
      o.yaw = (((o.yaw + dx * 0.3 + 180) % 360) + 360) % 360 - 180;
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

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.enabled) return;
    this.zoomStep(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, e.altKey);
  };

  /** The wheel's step dy (pixels: > 0 away, out), or a pinch's — what it does depends on the mode. */
  private zoomStep(dy: number, alt: boolean) {
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

  // ------------------------------------------------------------------------------ the lens
  /** The field of view the lens eases to (log), or none. */
  private fovTarget: number | null = null;
  /** the view before the telescope: its field, whether it was locked on the target */
  private teleSaved: { fov: number; lookAt: boolean } | null = null;

  /** Zooms the lens by a factor of its field (eased): 1°…150°, the telescope down to 0.02°. */
  zoomLens(f: number) {
    const s = this.s;
    const [lo, hi] = s.telescope ? [TELE_MIN, 20] : [Math.min(1, s.fov), 150];
    this.fovTarget = clamp((this.fovTarget ?? s.fov) * f, lo, hi);
    this.activity = performance.now();
  }
  /** Sets the field of view, eased (the panel's own changes land at once: stopZoom). */
  setFov(fov: number) {
    this.fovTarget = clamp(fov, TELE_MIN, 150);
  }
  stopZoom() {
    this.fovTarget = null;
  }
  private easeLens(dt: number) {
    const s = this.s;
    if (this.fovTarget === null) return;
    const cur = Math.log(s.fov), tgt = Math.log(this.fovTarget);
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
  setTelescope(on: boolean) {
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
    this.syncLook();
    try {
      return this.step(dt, time);
    } finally {
      this.markLook();
    }
  }

  private step(dt: number, time?: number): boolean {
    if (!this.scripted) return this.advance(dt, time);
    // (a video steps the scene: the keys held, the controller's sticks do not reach it)
    const keys = this.keys, codes = this.codes;
    this.keys = new Set();
    this.codes = new Set();
    try {
      return this.advance(dt, time);
    } finally {
      this.keys = keys;
      this.codes = codes;
    }
  }

  private advance(dt: number, time?: number): boolean {
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
    if ((kx || ky) && pilotNow && s.shipMount === "cabin" && !s.lookAt) this.setLook(s.shipLookYaw + kx * 90 * dt, s.shipLookPitch + ky * 70 * dt);
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
    if (this.flight && !(this.orbiting && s.target === this.flight.body && s.anchor === (this.flight.body === "wormhole" ? "wormhole" : "hole"))) {
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
    // (near a planet, a moon, a star: its surface's distance too — a metre at least — not the hole's
    // or the mouth's alone, tens of M away: the keys would throw the camera at millions of km/s)
    const near = Math.max(this.surfaceDistance(), 1 / (1476.625 * s.massSolar));
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
      const Y = axpy(h.X, h.d, k * Math.min(h.r - rH, 100, near));
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
    const ds = k * Math.min(Math.max(Math.min(rw - 0.5 * m.w.rho, toHole - rH), 0.2 * m.w.rho), 100, near);
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
        // (the flown craft: its own aerodynamics, its axes on the planet's local ones)
        const axL = this.shipAxesLocal(cam).map((v) => zamoToLocal(unitV(v))) as [Vec3, Vec3, Vec3];
        const aero = acc && F.atm ? this.airFlight.forceFn(F.atm, F.id, fleet.massProps().mass, axL, this.spinPhysical()) : undefined;
        const nUp = unitV(L.xi);
        const wheels = acc ? { side: axL[0], level: dot3(axL[1], nUp) > Math.cos((25 * Math.PI) / 180), brake: this.pilot.throttle <= 0 && this.pilot.auto === "none", lands: VESSELS[fleet.active].lands } : undefined;
        const r = stepLocal(F, L, dtau, zamoToLocal(lin(dirZ, accel, dirZ, 0)), aero, wheels);
        const bodyName = BODY_NAMES[F.id as Body];
        if (r.touchdown) this.onPilotMessage?.(`Touchdown on ${bodyName} · ${r.touchdown.vn.toFixed(1)} m/s down, ${r.touchdown.vh.toFixed(0)} m/s along`);
        if (r.airborne) this.onPilotMessage?.(`Airborne · ${(Math.hypot(...L.w) * 299792458).toFixed(0)} m/s`);
        this.properTime += dtau;
        this.landed = L.landed || !!L.rolling;
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
          this.onPilotMessage?.(v > TUNING.crashSpeed ? `Crashed on ${name} at ${v.toFixed(0)} m/s` : `Landed on ${name} · ${v.toFixed(1)} m/s`);
          if (v > TUNING.crashSpeed) this.crashed(`${VESSELS[fleet.active].name}: crashed on ${name} at ${v.toFixed(0)} m/s`);
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
    // our universe: the Newtonian pull of the solar system, in sub-steps short against the time it
    // takes to fall towards its nearest body (a warp beyond them: the ship's clock lags the request)
    const t0 = this.nowTime();
    const ours = p.l < -m.w.a && s.system === "gargantua";
    // (our side: the home frame's Cartesian flight — the planner's — down to 12 throat radii, where
    // the Dneg space is flat to 0.4 %; closer, along the metric's geodesics, through the throat)
    if (ours && homeOfPose(m.w, p).r > 12 * m.w.rho) return this.flyHome(p, v, simDt, t0, m.w, !!acc);
    let steps = 1;
    let span = simDt;
    if (ours) {
      const tDyn = ourGravity(m.w, p.l, p.n, t0).tDyn;
      span = Math.min(simDt, this.subCap * 0.01 * tDyn);
      steps = Math.min(Math.max(Math.ceil(span / (0.01 * tDyn)), 1), this.subCap);
    }
    let pose = { l: p.l, n: p.n, fwd: p.fwd, up: p.up };
    const dt = span / steps;
    for (let i = 0; i < steps; i++) {
      // (kick, drift along the geodesic, kick: second order — the half kicks carried by the geodesic's
      // parallel transport of the velocity)
      if (ours) {
        const g = ourGravity(m.w, pose.l, pose.n, t0 + i * dt);
        if (g.inside) {
          v = homeToRep(m.w, pose.l, pose.n, ourState(g.inside, t0 + i * dt).vel);
          break;
        }
        v = lin(v, 1, g.acc, dt / 2);
      }
      const speed = Math.hypot(...v);
      this.properTime += dt * Math.sqrt(Math.max(1 - speed * speed, 0));
      if (speed >= 1e-12) {
        const q = flyDneg(m.w, pose.l, pose.n, lin(v, 1 / speed, v, 0), [pose.fwd, pose.up], speed * dt);
        pose = { l: q.l, n: q.n, fwd: q.vectors[0]!, up: q.vectors[1]! };
        v = lin(q.dir, speed, q.dir, 0);
      }
      if (ours) {
        const g = ourGravity(m.w, pose.l, pose.n, t0 + (i + 1) * dt);
        if (!g.inside) v = lin(v, 1, g.acc, dt / 2);
        const sp = Math.hypot(...v);
        if (sp > 0.999) v = lin(v, 0.999 / sp, v, 0);
      }
    }
    setRepPose(s, { ...pose, vel: v });
    s.motion = "geodesic";
    this.sync();
    return t0 + span;
  }

  /**
   * Our universe far from the mouth (flat): velocity Verlet in the home frame's Cartesian
   * coordinates, the attitude fixed against the stars; a body met: the ship rests on it.
   */
  private flyHome(p: ReturnType<typeof repPose>, vRep: Vec3, simDt: number, t0: number, w: Dneg, flown = false) {
    const s = this.s;
    let X = homeOf(w, p.l, p.n);
    let V = repToHomeVec(w, p.l, p.n, vRep);
    let fwd = repToHomeVec(w, p.l, p.n, p.fwd);
    let up = repToHomeVec(w, p.l, p.n, p.up);
    // (this frame's thrust: the velocity change the engines made before the fall)
    const dvT = sub3(V, repToHomeVec(w, p.l, p.n, p.vel));
    // on the ground: carried by the turning body, until the engine lifts the ship
    if (this.ourLanded) {
      const L = this.ourLanded;
      const b = OUR_BODIES.find((q) => q.id === L.body)!;
      // (on the ground as it is known now: a scene placed before the Earth's relief was read back
      // stood at its sphere, inside the mountain — raised onto it once the heights are in)
      const qr = Math.hypot(...L.q);
      const rWant = b.radius + (GEAR + groundRelief(L.body, L.q)) / M_METRES;
      if (Math.abs(qr - rWant) * M_METRES > 1) L.q = [L.q[0] * (rWant / qr), L.q[1] * (rWant / qr), L.q[2] * (rWant / qr)];
      const Xg = fromBodyFixed(L.body, L.q, t0);
      const upL = unitV(sub3(Xg, ourState(L.body, t0).pos));
      const gSurf = b.mass / Math.hypot(...sub3(Xg, ourState(L.body, t0).pos)) ** 2;
      // (pushed along the ground past the wheels' resistance: rolling)
      const along = Math.hypot(...lin(dvT, 1, upL, -dot3(dvT, upL)));
      const rolls = flown && VESSELS[fleet.active].lands && along > 0.02 * gSurf * simDt;
      if (dot3(dvT, upL) > gSurf * simDt * 1.001 || rolls) {
        this.ourLanded = null;
        this.landed = false;
        X = Xg;
        V = lin(groundVelocity(L.body, Xg, t0), 1, dvT, 1);
        if (rolls && dot3(dvT, upL) <= gSurf * simDt * 1.001) this.rolling = { body: L.body };
        else this.onPilotMessage?.(`Lift-off from ${BODY_NAMES[L.body as Body]}`);
      } else {
        const t1 = t0 + simDt;
        const X1 = fromBodyFixed(L.body, L.q, t1);
        // (the attitude turns with the ground)
        const ang = spinRate(L.body) * simDt;
        const ax = unitV(spinAxis(L.body));
        this.properTime += simDt;
        setHomePose(s, X1, unitV(rotateAbout(fwd, ax, ang)), unitV(rotateAbout(up, ax, ang)), groundVelocity(L.body, X1, t1));
        s.motion = "geodesic";
        this.landed = true;
        this.sync();
        return t1;
      }
    }
    // the ground under the ship: the body of the sphere of influence, if solid (its air: drag)
    const ref = referenceBody(X, t0);
    const ground = solidBody(ref) ? ref : null;
    const atm = ref !== "sun" ? solarBody(ref)?.atmosphere : undefined;
    const airy = !!atm && flown;
    let g = gravityHome(X, t0);
    // (the flown craft's own aerodynamics — its attitude, its configuration — in the home frame)
    const right = cross(fwd, up);
    const S = this.shipMatrix();
    const axes = [0, 1, 2].map((i) => unitV(lin(lin(right, S[0]![i]!, up, S[1]![i]!), 1, fwd, S[2]![i]!))) as [Vec3, Vec3, Vec3];
    const aero = airy ? this.airFlight.forceFn(atm, ref, fleet.massProps().mass, axes, this.spinPhysical()) : null;
    const rb = airy ? solarBody(ref)!.radius : 0;
    const kA = M_METRES / 299792458 ** 2;
    let aAir = 0;
    const accAt = (Xq: Vec3, Vq: Vec3, tq: number, gq: typeof g) => {
      if (!aero) return gq.acc;
      const st = ourState(ref, tq);
      const h = (Math.hypot(...sub3(Xq, st.pos)) - rb) * M_METRES;
      const va = sub3(Vq, groundVelocity(ref, Xq, tq));
      const f = aero(h, [va[0] * 299792458, va[1] * 299792458, va[2] * 299792458]);
      const a: Vec3 = [f[0] * kA, f[1] * kA, f[2] * kA];
      aAir = Math.hypot(...a) / (Math.hypot(...va) + 1e-30);
      return lin(gq.acc, 1, a, 1);
    };
    // steps: a small part of the fall time; near the ground, of the time to reach it
    const stepOf = () => {
      // (fourth order in the vacuum: longer steps — the map's prediction's own)
      let dt = (airy ? 0.01 : 0.025) * g.tDyn;
      if (ground || airy) {
        const h = Math.max(gearHeight(ref, X, t), 0) / M_METRES;
        const vr = Math.hypot(...sub3(V, groundVelocity(ref, X, t))) + 1e-12;
        dt = Math.min(dt, Math.max((0.1 * h) / vr, 2e-4));
        // (a small part of the time the air takes to change the speed)
        if (aAir > 0) dt = Math.min(dt, Math.max(0.05 / aAir, 1e-6));
      }
      return dt;
    };
    let t = t0;
    const tEnd = t0 + simDt;
    // on rails: a stable orbit, the engine off, a frame a good part of a turn — Kepler's orbit
    // around the body, carried along with it (as KSP's time warp)
    const rails = Math.hypot(...dvT) < 1e-15 ? this.stableOrbit(X, V, t0) : null;
    if (rails && simDt > 0.02 * rails.period) {
      const k = keplerProp(rails.mass, sub3(X, ourState(rails.ref, t0).pos), sub3(V, ourState(rails.ref, t0).vel), simDt);
      const B = ourState(rails.ref, tEnd);
      X = lin(B.pos, 1, k.r, 1);
      V = lin(B.vel, 1, k.v, 1);
      this.properTime += simDt * Math.sqrt(Math.max(1 - dot3(V, V), 0));
      setHomePose(s, X, unitV(fwd), unitV(up), V);
      s.motion = "geodesic";
      this.sync();
      return tEnd;
    }
    let a = accAt(X, V, t, g);
    let touched: { speed: number; vh?: number; wheels?: boolean } | null = null;
    for (let i = 0; i < this.subCap && t < tEnd - 1e-12; i++) {
      const dt = Math.min(stepOf(), tEnd - t);
      // (in the vacuum, clear of the ground: Yoshida's fourth-order composition — the planner's
      // integrator; the flight follows its plans over months)
      let last = dt;
      const tn = t + dt;
      if (!airy && !(ground && gearHeight(ground, X, t) < 1e5)) {
        for (const w of YOSHIDA.slice(0, 2)) {
          const h = w * dt;
          V = lin(V, 1, a, h / 2);
          X = lin(X, 1, V, h);
          t += h;
          g = gravityHome(X, t);
          a = g.acc;
          V = lin(V, 1, a, h / 2);
        }
        const h = YOSHIDA[2]! * dt;
        V = lin(V, 1, a, h / 2);
        X = lin(X, 1, V, h);
        t = tn;
        last = h;
      } else {
        V = lin(V, 1, a, dt / 2);
        X = lin(X, 1, V, dt);
        t = tn;
      }
      g = gravityHome(X, t);
      // rolling on the ground: held on it, the wheels' friction along it, the tyres' grip across
      if (this.rolling && ground === this.rolling.body) {
        const P = ourState(ground, t).pos;
        const n = unitV(sub3(X, P));
        const gv = groundVelocity(ground, X, t);
        let vr = sub3(V, gv);
        const vn = dot3(vr, n);
        // (pressed on it: the weight less the lift and the turn of the ground's curve)
        const aNow = accAt(X, V, t, g);
        const vt = lin(vr, 1, n, -vn);
        const press = -dot3(aNow, n) - dot3(vt, vt) / Math.hypot(...sub3(X, P)) + dot3(dvT, n) * (-1 / simDt);
        if (press <= 0 && vn >= 0) {
          this.rolling = null;
          this.rollSite = null;
          this.onPilotMessage?.(`Airborne · ${(Math.hypot(...vt) * 299792458).toFixed(0)} m/s`);
        } else {
          X = lin(X, 1, n, -gearHeight(ground, X, t) / M_METRES);
          vr = vt;
          const sp = Math.hypot(...vr);
          if (sp > 0) {
            // (rolling 0.015, braking 0.3 with the engine at idle; across: the tyres, 0.6)
            const side = unitV(lin(axes[0], 1, n, -dot3(axes[0], n)));
            const vs = dot3(vr, side);
            const fl = Math.max(press, 0) * dt;
            const mu = 0.015 + (this.pilot.throttle <= 0 && this.pilot.auto === "none" ? 0.3 : 0);
            const vsN = Math.sign(vs) * Math.max(Math.abs(vs) - 0.6 * fl, 0);
            let va = lin(vr, 1, side, vsN - vs);
            const sa = Math.hypot(...va);
            if (sa > 0) va = lin(va, Math.max(sa - mu * fl, 0) / sa, va, 0);
            vr = va;
          }
          V = lin(gv, 1, vr, 1);
          // (at rest, the engine idle: standing)
          if (Math.hypot(...vr) * 299792458 < 0.05 && this.pilot.throttle <= 0) {
            this.rolling = null;
            this.rollSite = null;
            this.ourLanded = { body: ground, q: toBodyFixed(ground, X, t) };
            V = gv;
            break;
          }
        }
      }
      // touchdown on a solid ground — coming down onto it (just lifted off, the gear a few mm up and
      // the home ↔ rep round trip as fine as that: climbing, it is no landing)
      else if (ground && gearHeight(ground, X, t) < 0 && dot3(sub3(V, groundVelocity(ground, X, t)), sub3(X, ourState(ground, t).pos)) < 0) {
        const gv = groundVelocity(ground, X, t);
        const P = ourState(ground, t).pos;
        const n = unitV(sub3(X, P));
        const vr = sub3(V, gv);
        const vn = dot3(vr, n) * 299792458;
        const vh = Math.hypot(...lin(vr, 1, n, -dot3(vr, n))) * 299792458;
        // (on its wheels: belly down, wings level enough, not too fast — the vertical speed is the crash)
        const level = dot3(axes[1], n) > Math.cos((25 * Math.PI) / 180);
        const wheels = flown && VESSELS[fleet.active].lands && level && vh > 0.5 && vh < 220;
        touched = { speed: wheels ? -vn : Math.hypot(vn, vh), vh, wheels };
        if (wheels && -vn <= TUNING.crashSpeed) {
          X = lin(X, 1, n, -gearHeight(ground, X, t) / M_METRES);
          V = lin(gv, 1, vr, 1);
          V = lin(V, 1, n, -dot3(vr, n));
          this.rolling = { body: ground };
          continue;
        }
        // (resting on the relief, the gear on it)
        X = lin(X, 1, n, -gearHeight(ground, X, t) / M_METRES);
        V = gv;
        this.ourLanded = { body: ground, q: toBodyFixed(ground, X, t) };
        break;
      }
      if (g.inside) {
        // (into a body with no ground to stand on: resting on its surface, moving with it)
        const b = ourState(g.inside, t);
        const r = OUR_BODIES.find((q) => q.id === g.inside)!.radius;
        const d = lin(X, 1, b.pos, -1);
        X = lin(b.pos, 1, d, (r * 1.0000001) / Math.hypot(...d));
        V = b.vel;
        break;
      }
      a = accAt(X, V, t, g);
      V = lin(V, 1, a, last / 2);
      const sp = Math.hypot(...V);
      if (sp > 0.999) V = lin(V, 0.999 / sp, V, 0);
    }
    const speed = Math.hypot(...V);
    this.properTime += (t - t0) * Math.sqrt(Math.max(1 - speed * speed, 0));
    setHomePose(s, X, unitV(fwd), unitV(up), V);
    s.motion = "geodesic";
    this.sync();
    if (touched) {
      this.landed = true;
      const name = BODY_NAMES[ground as Body];
      const v = touched.speed;
      if (touched.wheels && this.rolling) this.onPilotMessage?.(`Touchdown on ${name} · ${v.toFixed(1)} m/s down, ${touched.vh!.toFixed(0)} m/s along`);
      else {
        const nav = this.ourNav(cameraFrame(s));
        if (nav) this.levelShip(nav.radial);
        this.onPilotMessage?.(v > TUNING.crashSpeed ? `Crashed on ${name} at ${v.toFixed(0)} m/s` : `Landed on ${name} · ${v.toFixed(1)} m/s`);
        if (v > TUNING.crashSpeed) this.crashed(`${VESSELS[fleet.active].name}: crashed on ${name} at ${v.toFixed(0)} m/s`);
      }
      // (the entry's glide down on its runway: the rollout steered along it)
      this.rollSite = touched.wheels && this.rolling && this.pilot.auto === "entry" && this.entryRun?.site?.runway ? this.entryRun.site : null;
      if (this.pilot.auto !== "none" && this.pilot.auto !== "takeoff") this.pilot.setAuto(this.pilot.auto);
    }
    if (flown) this.landed = !!this.rolling || !!this.ourLanded;
    return t;
  }

  /**
   * The ship's orbit round the body of its sphere of influence, when it is one to put on rails: bound,
   * its periapsis clear of the ground and of 30 scale heights of air, its apoapsis well inside the
   * sphere (the other bodies' pulls a small part of it). Null otherwise.
   */
  private stableOrbit(X: Vec3, V: Vec3, t: number) {
    const ref = referenceBody(X, t);
    if (ref === "sun") return null;
    const b = solarBody(ref)!;
    const st = ourState(ref, t);
    const r = sub3(X, st.pos), v = sub3(V, st.vel);
    const R = Math.hypot(...r);
    const eps = dot3(v, v) / 2 - b.mass / R;
    if (!(eps < 0)) return null;
    const a = -b.mass / (2 * eps);
    const h = cross(r, v);
    const e = Math.sqrt(Math.max(1 - dot3(h, h) / (b.mass * a), 0));
    const clear = b.radius * 1.01 + airTop(b.atmosphere) / M_METRES;
    if (a * (1 - e) < clear || a * (1 + e) > 0.25 * soiOf(ref, t)) return null;
    return { ref, mass: b.mass, period: 2 * Math.PI * Math.sqrt(a ** 3 / b.mass) };
  }

  /**
   * Our universe, near a solid body or in its air: the landing figures (ground-relative), as near the
   * hole — height of the gear, vertical and horizontal speeds, local gravity, thrust / weight, the
   * air's density, the re-entry glow's heat flux ρ v³.
   */
  private ourSurfaceInfo() {
    const nav = this.ourNav(cameraFrame(this.s));
    if (!nav || nav.ref === "sun") return null;
    const id = nav.ref;
    const sb = solarBody(id)!;
    const alt = gearHeight(id, nav.X, nav.t);
    if (!(solidBody(id) || ourAir(id, 0) > 0) || alt > Math.max(30 * (sb.atmosphere?.H ?? 0), 0.5 * sb.radius * M_METRES)) return null;
    const sp = groundSpeeds(id, nav.X, nav.V, nav.t);
    const r = Math.hypot(...sub3(nav.X, nav.refPos));
    const g = sb.mass / (r * r);
    const aUnit = 299792458 ** 2 / M_METRES;
    const air = ourAir(id, alt);
    const vAir = Math.hypot(sp.vv, sp.vh);
    // (the stagnation heat flux, Sutton–Graves for air with a 1 m nose: 1.74·10⁻⁴ √ρ v³ [W/m²] —
    // nothing climbing at a few hundred m/s, ~1 MW/m² for a return from orbit at 70 km)
    const q = 1.7415e-4 * Math.sqrt(air) * vAir ** 3;
    const cam = cameraFrame(this.s);
    const fl = nav.toRep(sp.va);
    const fll = Math.hypot(...fl) || 1;
    const flow: Vec3 = [-dot3(fl, cam.right) / fll, -dot3(fl, cam.up) / fll, -dot3(fl, cam.fwd) / fll];
    return {
      plasma: { q, flow, level: Math.min(Math.max((Math.log10(Math.max(q, 1)) - 5) / 1.5, 0), 1) },
      body: id as Body, alt: Math.max(alt, 0), vVert: sp.vv, vHor: sp.vh,
      gLocal: (g * aUnit) / 9.80665, twr: this.thrustMax() / Math.max(g, 1e-30), landed: !!this.ourLanded, rolling: !!this.rolling, air,
    };
  }

  /** our universe: resting on a body's ground (its own coordinates) */
  private ourLanded: { body: string; q: Vec3 } | null = null;
  /** Puts the ship down on a body's ground (a scene's start). */
  setOurLanded(l: { body: string; q: Vec3 } | null) {
    this.ourLanded = l;
    this.rolling = null;
    this.landed = !!l;
  }
  /** where the ship rests in our universe (a saved game keeps it) */
  get ourLandedOn() {
    return this.ourLanded;
  }

  // ------------------------------------------------------------------------------ piloting
  /**
   * The Ranger carries the camera and flies: gravity on (Kerr geodesic in the scene's time), free
   * rotation; the clock as it was (paused, the ship waits). Starting near the hole, it is put on a
   * circular orbit (prograde).
   */
  setPilot(on: boolean) {
    const s = this.s;
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
    this.spent = 0;
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
   * Leaving the ship: the camera where its eye was. The pose is the ship's centre, the eye its attach
   * point's — metres on the hull, tens to kilometres outside: off the ship, the view would jump there
   * (into the hull, under the ground it stood on).
   */
  private stepOffMount() {
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
  standOn(b?: Body): string | null {
    const s = this.s;
    if (this.piloting) return "The Ranger lands itself (the autopilot: 7) — leave it to set the camera down (⇧K)";
    const w = this.rigWorld();
    if (!w) return "No world to stand on here";
    const t = this.nowTime();
    const solid = (id: Body) => (w.ours ? solidBody(id) : ["miller", "mann", "edmunds"].includes(id));
    const pick = (id: Body | null | undefined) => (id && solid(id) ? this.rigBody(id, w.ours, t) : null);
    const ref = b ? pick(b) : (pick(s.target) ?? this.rigNearest(w.ours, w.X, t));
    if (!ref || !solid(ref.id)) return "Nothing solid to stand on — a planet or a moon on this side of the wormhole (Go to takes the camera through)";
    const up = unitV(sub3(w.X, ref.C));
    const mR = 1476.625 * s.massSolar;
    let X = lin(ref.C, 1, up, ref.R);
    let V = ref.V;
    if (w.ours) {
      X = lin(ref.C, 1, up, ref.R + (groundRelief(ref.id, toBodyFixed(ref.id, X, t)) + 1.7) / mR);
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

  /**
   * Outside, free: the keys move the camera along its own axes (Z Q S D, A E on AZERTY; Shift faster),
   * its speed eased (~0.15 s), a fifth of its distance from the ship per second (5 m/s at least).
   */
  private moveOutside(dt: number, move: number[], fast: boolean) {
    const o = this.outside;
    const S = shipToCamera(this.mountTarget(), 0, 0).S;
    const v = Math.max(5, 0.2 * Math.hypot(...o.eye)) * (fast ? 5 : 1);
    const want = lin(lin(S[2], move[0]! * v, S[0], move[1]! * v), 1, S[1], move[2]! * v);
    o.fvel = lin(o.fvel, 1, sub3(want, o.fvel), 1 - Math.exp(-dt / 0.15));
    if (Math.hypot(...o.fvel) < 1e-3) return (o.fvel = [0, 0, 0]);
    const e = lin(o.eye, 1, o.fvel, dt);
    // (no farther than 50 km from the ship)
    const l = Math.hypot(...e);
    o.eye = l > 5e4 ? lin(e, 5e4 / l, e, 0) : e;
    this.activity = performance.now();
  }

  /** The look's angles set without turning the camera (the pose's change does, through stepMount). */
  private setLookRaw(yaw: number, pitch: number) {
    this.s.shipLookYaw = yaw;
    this.s.shipLookPitch = pitch;
    this.markLook();
  }

  /** The look and the camera's turn as the controller left them (null: not yet). */
  private lookSeen: { yaw: number; pitch: number; cam: string } | null = null;
  private markLook() {
    const s = this.s;
    this.lookSeen = { yaw: s.shipLookYaw, pitch: s.shipLookPitch, cam: `${s.yaw}|${s.pitch}|${s.roll}|${s.anchor}` };
  }

  /**
   * The look changed from outside since the last frame — the settings panel's free-look fields,
   * __bh.game.set —: the camera turned on its mount as setLook does, the ship left where it points.
   * (The ship's attitude is the camera's less the look: the angles written alone would swing the ship
   * round — in the air, a broken craft.) A new pose with it — a scene loaded, a placement —: as given.
   */
  private syncLook() {
    const s = this.s;
    const L = this.lookSeen;
    if (!L || (L.yaw === s.shipLookYaw && L.pitch === s.shipLookPitch)) return;
    const moved = L.cam !== `${s.yaw}|${s.pitch}|${s.roll}|${s.anchor}`;
    if (!s.ship || moved) return;
    const yaw = wrapYaw(s.shipLookYaw), pitch = clamp(s.shipLookPitch, -85, 85);
    const pose = this.shipPose();
    const S0 = shipToCamera(pose, L.yaw, L.pitch).S;
    s.shipLookYaw = yaw;
    s.shipLookPitch = pitch;
    this.reorient(S0, shipToCamera(pose, yaw, pitch).S);
  }

  /** Turns the camera on its mount (degrees; the yaw all the way round, as many turns as wanted); the
   *  ship stays where it points. */
  setLook(yaw: number, pitch: number) {
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

  /** the last attach point on the hull (not an outside view): where a reset brings the camera back */
  private hullMount: Mount = "chase";

  /**
   * The camera back to the craft's attach points as they are: the look straight along the mount's axis,
   * no lock on the target, the outside views' own places again (around: behind and above at the craft's
   * distance; free: off its quarter; the fly-by afresh) — and from an outside view, back on the hull, at
   * the last attach point used there. What it did.
   */
  resetShipView(): string {
    const s = this.s;
    const V = VESSELS[fleet.active];
    const k = V.viewDist / 42;
    s.lookAt = false;
    this.lookOff = [0, 0];
    this.shipAim = null;
    Object.assign(this.outside, { yaw: 0, pitch: 12, dist: V.viewDist, eye: [18 * k, 6 * k, -36 * k] as Vec3, fyaw: -25, fpitch: -5, fvel: [0, 0, 0] as Vec3 });
    this.flyby.E = null;
    this.cabinCam = { eye: null, vel: [0, 0, 0] };
    const wasOut = !!this.outsideView();
    if (wasOut) s.shipMount = this.hullMount;
    // (the look recentred: the ship keeps its attitude — the camera turns back with the mount)
    this.setLook(0, 0);
    return `Camera reset · ${MOUNTS[s.shipMount as Mount]?.label ?? s.shipMount}`;
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
    return this.mountTarget();
  }

  /** The outside view in use (mounts.ts), or none. */
  outsideView(): OutsideView | null {
    const m = MOUNTS[this.s.shipMount as Mount] as { outside?: OutsideView } | undefined;
    return this.s.ship ? (m?.outside ?? null) : null;
  }

  /**
   * The ship's views locked on the target (lookAt): on its mounts the look turns to it (eased; the drag
   * sets where it sits in the view), outside the views read its direction (mountTarget).
   */
  private aimShipViews(dt: number) {
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
  private flybyStep(dt: number) {
    const s = this.s, F = this.flyby;
    const cam = cameraFrame(s);
    const S = this.lastPose ? shipToCamera(this.lastPose, s.shipLookYaw, s.shipLookPitch).S : this.shipMatrix();
    const ax = [0, 1, 2].map((i) => lin(lin(cam.right, S[0][i]!, cam.up, S[1][i]!), 1, cam.fwd, S[2][i]!)) as [Vec3, Vec3, Vec3];
    const toShip = (E: Vec3): Vec3 => [dot3(E, ax[0]), dot3(E, ax[1]), dot3(E, ax[2])];
    const toLocal = (e: Vec3) => lin(lin(ax[0], e[0], ax[1], e[1]), 1, ax[2], e[2]);
    if (!F.E) F.E = toLocal(this.lastPose?.eye ?? F.eye);
    const c = 299792458;
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
  private refBeta(cam: ReturnType<typeof cameraFrame>): Vec3 {
    const nav = this.ourNav(cam);
    if (nav) return nav.refVelRep;
    if (cam.region === "hole" && this.local) return zamoBeta(blToCartesian(cam.r, cam.theta, cam.phi), this.local.F.V, this.s.spin);
    return [0, 0, 0];
  }

  /** Where the chosen attach point puts the camera (the outside views: where they are now). */
  private mountTarget(): MountPose {
    const o = this.outside;
    const v = this.outsideView();
    const d = Math.PI / 180;
    const A = this.shipAim;
    const V = VESSELS[fleet.active];
    if (v === "around") {
      const c: Vec3 = V.centre;
      // (locked on the target: behind the ship on the target's line, the drag an offset from it)
      const y0 = A ? Math.atan2(-A[0], A[2]) / d : 0, p0 = A ? Math.asin(clamp(-A[1], -1, 1)) / d : 0;
      const yaw = (y0 + o.yaw) * d, pitch = clamp(p0 + o.pitch, -88, 88) * d;
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
  settleMount() {
    this.airFlight.reset(fleet.active);
    // (the Lander flies as a rocket unless told otherwise; the Ranger as a plane)
    if (fleet.active !== "ranger" && this.s.flightMode === "plane") this.s.flightMode = "rocket";
    this.rolling = null;
    this.lastMount = this.s.shipMount;
    // (a scene's attach point: the one a reset comes back to; the outside views at the craft's own distances)
    if (MOUNTS[this.s.shipMount as Mount] && !(MOUNTS[this.s.shipMount as Mount] as { outside?: string }).outside) this.hullMount = this.s.shipMount as Mount;
    const k = VESSELS[fleet.active].viewDist / 42;
    Object.assign(this.outside, { yaw: 0, pitch: 12, dist: VESSELS[fleet.active].viewDist, eye: [18 * k, 6 * k, -36 * k] as Vec3, fyaw: -25, fpitch: -5, fvel: [0, 0, 0] as Vec3 });
    this.mountAnim = null;
    this.mountEff = null;
    this.lastPose = this.mountTarget();
  }

  /** Eases the camera towards the chosen attach point; keeps the ship's attitude while it moves. */
  private stepMount(dt: number) {
    const s = this.s;
    // (the outside views' poses change between frames — dragged, moved —: from where the camera was)
    const S0 = this.lastPose && !this.mountAnim ? shipToCamera(this.lastPose, s.shipLookYaw, s.shipLookPitch).S : this.shipMatrix();
    if (s.shipMount !== this.lastMount) {
      if (this.lastMount && s.ship) this.mountAnim = { from: this.lastPose ?? this.shipPose(), t: 0 };
      if (MOUNTS[s.shipMount as Mount] && !(MOUNTS[s.shipMount as Mount] as { outside?: string }).outside) this.hullMount = s.shipMount as Mount;
      // (about the cabin: from where the camera was in it — the pilot's seat, else its own)
      if (s.shipMount === "cabin") this.cabinCam = { eye: this.lastMount === "cockpit" && this.lastPose ? ([...this.lastPose.eye] as Vec3) : this.cabinCam.eye, vel: [0, 0, 0] };
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
        const y0 = A ? Math.atan2(-A[0], A[2]) * deg : 0, p0 = A ? Math.asin(clamp(-A[1], -1, 1)) * deg : 0;
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
    // KSP's layout, by physical key (Z Q S D / A E on AZERTY): W S pitch (W: nose down), A D yaw, Q E
    // roll; I K translate down / up, J L left / right, H N forward / back; Shift throttles up, Alt
    // down (not Ctrl: Ctrl+W closes the tab), arrows too
    const k = (c: string) => (this.codes.has(c) ? 1 : 0);
    const i: PilotInput = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 };
    // (outside, free — or about the cabin: the keys move the camera; the ship flies on as it was)
    if (this.outsideView() === "free" || this.s.shipMount === "cabin") return i;
    i.pitch = k("KeyS") - k("KeyW");
    i.yaw = k("KeyD") - k("KeyA");
    i.roll = k("KeyE") - k("KeyQ");
    i.tx = k("KeyL") - k("KeyJ");
    i.ty = k("KeyK") - k("KeyI");
    i.tz = k("KeyH") - k("KeyN");
    const up = k("ShiftLeft") || k("ShiftRight") || (this.keys.has("ArrowUp") ? 1 : 0);
    const down = k("AltLeft") || k("AltRight") || (this.keys.has("ArrowDown") ? 1 : 0);
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
  private flyShip(dt: number, pad: ReturnType<GamepadInput["poll"]>) {
    const s = this.s;
    // (paused: the ship holds — its attitude too, its turn resumes with the time)
    if (!s.animate) return;
    const cam = cameraFrame(s);
    // (through the wormhole, one way or the other: said once)
    if (s.wormhole) {
      const side = cam.region === "throat" ? (cam.ell < 0 ? "ours" : "gargantua") : "gargantua";
      if (this.shipSide && side !== this.shipSide) this.onPilotMessage?.(side === "gargantua" ? "Through the wormhole — Gargantua's system" : "Through the wormhole — back in the solar system");
      this.shipSide = side;
      // (out of the throat after a crossing at warp: real time again — the pilot's to choose)
      if (this.traversing && cam.region === "hole") {
        this.traversing = false;
        s.timeSpeed = this.warpSet = 1 / (4.925490947e-6 * s.massSolar);
        this.warpWant = null;
        this.onPilotMessage?.(`Out of the throat, ${Math.round(cam.r)} M from Gargantua — real time`);
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
    if (this.pilot.auto !== "node") this.rails(cam);
    const burn = this.pilot.auto === "node" ? this.nodeBurn(cam, dt, dtau) : null;
    const tauRate = s.animate ? s.timeSpeed * dtau : 0;
    // the craft's own turning, slower in an assembly (its wheels and thrusters against the assembly's
    // moment of inertia)
    const V0 = VESSELS[fleet.active];
    const mp = fleet.massProps();
    const ag = (V0.agility * mp.own) / mp.inertia;
    const tune = { rate: TUNING.turnRate, acc: TUNING.turnAccel };
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
      if (!this.airWarpSaid) this.onPilotMessage?.(`In the air: the time warp held at ×${AIR_WARP}`);
      this.airWarpSaid = true;
    }
    if (!thick) this.airWarpSaid = false;
    const dtPilot = thick ? dt * Math.min(s.timeSpeed * Msec, AIR_WARP) : dt;
    // the flight law in the air (the plane's surfaces; the sci-fi computer's commanded velocity)
    const mode = this.flightModeNow();
    const LA0 = this.airFlight.last;
    const AV = VESSELS[fleet.active].aero;
    const onWheels0 = !!this.rolling || !!this.local?.L.rolling;
    const airCtx = LA0 && LA0.out.q > 20 ? {
      mode, alpha: LA0.out.alpha, beta: LA0.out.beta, auth: AV.ctrl.map((k) => Math.min((k * LA0.out.q) / 1000, 4)) as Vec3,
      path: this.airFlight.pathRate.map((x) => -x) as Vec3, ground: onWheels0, stall: AV.wing?.stall ?? 0.35, q: LA0.out.q, gamma: this.pathAngle(cam), bank: (this.attitudeNow() as { bank?: number }).bank ?? 0, mach: LA0.out.mach,
    } : null;
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
    const out = this.pilot.step({
      air: airCtx, sf: sfCtx,
      dt: dtPilot, right: cam.right, up: cam.up, fwd: cam.fwd, beta: cam.beta, S: this.shipMatrix(), thrust: this.thrustMax(), tauRate,
      radialOut: this.radialOut(cam), refVel: this.speedMode === "target" ? this.targetVelLocal(cam) ?? undefined : this.ourNav(cam)?.refVelRep,
      target: this.targetDir(cam), maneuver: this.maneuverDir(cam), want: (this.lastWant = this.pilot.auto !== "none" && this.pilot.auto !== "node" && this.pilot.auto !== "entry" && this.pilot.auto !== "burns" ? this.autopilotWant(cam) : null),
      att: entryAtt,
      dock: this.pilot.auto === "dock" ? this.dockAuto?.att ?? null : null,
      burn,
      // (the Crew engine's autopilots, when a frame lasts more than ~20 s of the ship's time: a real
      // ship turns within it — the wall-clock turn rates are for the eye, not for days-long burns)
      snap: (this.pilot.auto !== "none" && ((s.engine === "crew" && cam.region === "hole") || onOurSide(s, cam))
        && s.timeSpeed * dt * 4.925490947e-6 * s.massSolar > 20) || (this.nodeBurning && onOurSide(s, cam)),
      gimbal: this.nodeBurning && onOurSide(s, cam),
    }, inp);
    TUNING.turnAccel = tune.acc;
    TUNING.turnRate = tune.rate;
    this.rotateC(out.rot);
    // (on its wheels: level on the ground, the nose within the runway's limits)
    if (this.rolling) {
      const nav = this.ourNav(cameraFrame(s));
      if (nav) this.groundAttitude(nav.radial);
      if (nav && this.rollSite) this.rolloutSteer(nav.radial, dt, inp.yaw);
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
    this.airFlight.cfg.brake = onWheels && this.pilot.throttle <= 0 && this.pilot.auto === "none" ? 1 : this.airBrake;
    this.airFlight.cfg.gear = onWheels || this.landed || (!!LA && LA.h < 600 && LA.speed < 160);
    this.airFlight.vacuum();
    if (simDt > 0) this.fall(simDt, [0, 0, 0], false, out.acc);
    if (pre) this.stationContact(pre);
    this.airAfter(simDt * Msec, out.acc, dtPilot);
    if (!thick && this.airFlight.inAir && this.airFlight.last!.speed > 1000) this.onAirEntry?.();
    // rapidity spent (the propellant gauge), and the Δv delivered to the executing node (proper
    // acceleration × proper time)
    // (the antigravity's hold is free)
    const w = Math.hypot(...(sfCtx ? sub3(out.acc, sfCtx.free) : out.acc)) * (this.properTime - tau0);
    if (this.entryRun?.phase === "burn") this.entryRun.done += w * 299792458;
    if (this.pilot.auto === "burns" && this.fcBurns[0]?.firing) this.fcBurns[0].done += w * 299792458;
    this.spent += w;
    if (burn && this.nodeBurning) this.nodeDone += w;
    this.dockCheck();
    this.measureSpin();
  }

  /**
   * After a frame's flight: the skin's temperatures, the load, the limits (flightair.ts); the air's
   * moment turns the craft (the pilot's rates the other way round from the right-hand rule).
   */
  private airAfter(dtSec: number, acc: Vec3, dtPilot: number) {
    const s = this.s;
    const cam = cameraFrame(s);
    const ax = this.shipAxesLocal(cam);
    const aU = 299792458 ** 2 / (1476.625 * s.massSolar);
    const thrust = ax.map((a) => (dot3(acc, a) / Math.max(Math.hypot(...a), 1e-12)) * aU) as Vec3;
    const mp = fleet.massProps();
    const was = this.airFlight.failure;
    const alpha = this.airFlight.after(dtSec, thrust, mp.mass, mp.inertia, s.damage);
    if (this.airFlight.inAir) for (let i = 0; i < 3; i++) this.pilot.omega[i] = this.pilot.omega[i]! - alpha[i]! * dtPilot;
    if (this.airFlight.failure && !was) this.onCraftLost?.(this.airFlight.failure);
  }

  /**
   * The flown craft's drag per unit mass, C_D A / m [m²/kg], as it flies now — its attitude to its
   * motion through the air (out of the air: as if it entered so, at Mach 25) — for the map's paths.
   */
  private dragPerMass(): number {
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
  flightModeNow(): FlightMode {
    return VESSELS[fleet.active].flies ? this.s.flightMode : "rocket";
  }

  /** The sci-fi flight computer's commands: speed [m/s], flight path angle and heading [rad]. */
  private sfCmd: { speed: number; gamma: number; heading: number } | null = null;

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
  private horizonAxes(cam: ReturnType<typeof cameraFrame>): { up: Vec3; north: Vec3 } | null {
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

  private sfFrame(cam: ReturnType<typeof cameraFrame>) {
    const c = 299792458;
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
      const aU = c * c / M_METRES;
      const grav = lin(gravityHome(nav.X, nav.t).acc, aU, up, 0);
      const air = LA ? this.airFlight.accFrame : ([0, 0, 0] as Vec3);
      const w = mouth(this.s).w;
      return {
        up, north, east, vRel, h, grav, air, g: Math.hypot(...grav),
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
    const grav = lin(localAccel(F, L.xi, L.w, [0, 0, 0], () => [0, 0, 0]), F.aUnit, up, 0);
    const air = LA ? this.airFlight.accFrame : ([0, 0, 0] as Vec3);
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    return {
      up, north, east, vRel: lin(L.w, c, up, 0), h, grav, air, g: Math.hypot(...grav),
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
  private sfWant(cam: ReturnType<typeof cameraFrame>, inp: PilotInput, dt: number) {
    const fr = this.sfFrame(cam);
    if (!fr) return null;
    const { up, north, east, vRel } = fr;
    const sp = Math.hypot(...vRel);
    const vUp = dot3(vRel, up);
    const vh = lin(vRel, 1, up, -vUp);
    if (!this.sfCmd) {
      const nose = fr.fromLocal(this.shipAxesLocal(cameraFrame(this.s))[2]);
      const hd = Math.hypot(...vh) > 1 ? vh : nose;
      this.sfCmd = { speed: sp, gamma: sp > 1 ? Math.asin(clamp(vUp / sp, -1, 1)) : 0, heading: Math.atan2(dot3(hd, east), dot3(hd, north)) };
    }
    const C = this.sfCmd;
    C.speed = Math.max(0, C.speed + inp.throttle * Math.max(15, 0.8 * C.speed) * dt);
    C.gamma = clamp(C.gamma + inp.pitch * 0.45 * dt, -1.45, 1.45);
    const turn = inp.yaw * 0.6;
    C.heading += turn * dt;
    const hdir = lin(north, Math.cos(C.heading), east, Math.sin(C.heading));
    const right = cross(hdir, up);
    const side = inp.roll * Math.max(15, 0.2 * C.speed);
    let v = lin(lin(hdir, C.speed * Math.cos(C.gamma) + inp.tz * 15, up, C.speed * Math.sin(C.gamma) + inp.ty * 15), 1, right, side + inp.tx * 15);
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

  /** Where the entry autopilot comes down (null: the nearest site under the track). */
  entrySite: Site | null = null;
  /** The entry autopilot's run: its phase, the deorbit's burn (its time [s of the scene], Δv, done
   *  [m/s]), the guidance and its bank, the angle of attack, the next guidance's update [s]. */
  entryRun: {
    phase: "plan" | "wait" | "burn" | "entry" | "glide"; site: Site | null; tBurn: number; dv: number; done: number;
    guid: EntryGuidance | null; bank: number; next: number; alpha: number; gPrev: number | null; short: number; handover: number;
    /** the flare's time constant [s], set as it starts */
    flareTau?: number;
    /** the final's steep slope, its angle [rad] frozen as the pull-up nears; the profile's phase, its
     *  aim point and touchdown (along the runway from the threshold [m]), the height it asks */
    gOuter?: LandingFix;
    prof?: { phase: "outer" | "preflare" | "inner" | "flare" | "rollout"; aim: number; td: number; h: number };
    /** the circuit's side of the runway's axis (+1 its right), kept once chosen; its turn begun */
    side?: number;
    turning?: boolean;
    /** the approach's leg: joining the axis from far back, to the final's start, downwind, the turn, the final */
    leg?: "join" | "toStart" | "downwind" | "turn" | "final";
    /** a guidance update in the planner's worker */
    pending?: boolean;
    /** the approach's figures (the runway's): along the axis from the threshold, across it [m], on the final */
    app?: { along: number; across: number; final: boolean; agl: number; speed: number; gRef?: number; gam?: number };
    plan?: { heat: number; shield: number; g: number };
  } | null = null;

  /**
   * The frame an entry is flown in, both universes (entry.ts EntryEnv): body-centred, SI — our side
   * the home axes (the ground turning in them), Gargantua's worlds their own turning frames (the ground
   * at rest) — the state, where a site is now, the conversions to the pilot's local components.
   */
  private entryFrame(cam: ReturnType<typeof cameraFrame>) {
    const c = 299792458;
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
        env, desc, s: st, body: id, now: nav.t * Msec,
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
      env, desc, s: { x: lin(L.xi, F.mPerM, L.xi, 0), v: lin(L.w, c, L.w, 0) } as EntryState, body: F.id as string, now: this.nowTime() * Msec,
      place: (site: Site) => lin(siteDir(site), F.R * F.mPerM, L.xi, 0),
      toLocal: (v: Vec3) => unitV(localToZamo(v)),
      fromLocal: (v: Vec3) => unitV(zamoToLocal(v)),
    };
  }

  /** The craft as the entry flies it: its aerodynamics, the assembly's mass, its angle of attack (the
   *  Ranger 40°, a lifting body's; the Lander 65°, its shield to the flow). */
  private entryCraft(): EntryCraft {
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
  private entryStep(cam: ReturnType<typeof cameraFrame>, dt: number): { nose: Vec3; up: Vec3; throttle?: number } | null {
    const s = this.s;
    const P = this.pilot;
    const say = (t: string) => {
      P.setAuto("none");
      this.entryRun = null;
      this.onPilotMessage?.(t);
      return null;
    };
    const V = VESSELS[fleet.active];
    if (!V.flies) return say(`Entry: the ${V.name} has no heat shield — it was built in orbit and never comes down`);
    const fr = this.entryFrame(cam);
    if (!fr || !fr.env.atm && !solidBody(fr.body)) return say("Entry: get near a world with air or ground first");
    const craft = this.entryCraft();
    const Msec = 4.925490947e-6 * s.massSolar;
    const D = Math.PI / 180;
    const up = unitV(fr.s.x);
    const va = sub3(fr.s.v, fr.env.ground(fr.s.x));
    const h = Math.hypot(...fr.s.x) - fr.env.R;
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
      this.entryRun = { phase: "entry", site, tBurn: 0, dv: 0, done: 0, guid: site ? new EntryGuidance({ handoverMach: handover, short: shortM }) : null, bank: 0, next: -Infinity, alpha: craft.alpha, gPrev: null, short: shortM, handover };
      if (!fr.env.atm) return say(`Entry: ${name} has no air — land with the engines (G)`);
      if (h > top) {
        // in orbit: the deorbit planned (to the site's downrange; without a site, a nominal burn now)
        if (!site) return say(`Entry: no landing site on ${name} — fly the entry by hand (F: the plane law holds α hypersonic)`);
        // (planned in the planner's worker: a second of predicted falls, off the frame loop)
        const R = this.entryRun;
        R.phase = "plan";
        const at = fr.now;
        this.onPilotMessage?.(`Entry to ${site.name}: planning the deorbit…`);
        void runPlanner<{ t: number; dv: number; heat: number; shield: number; g: number } | null>({
          kind: "deorbit", env: fr.desc, craft, s: fr.s, place: fr.place(site),
          o: { peH: ranger ? 45e3 : 30e3, handoverMach: handover, short: shortM, orbits: 16, reach: ranger ? 600e3 : 150e3 },
        }).then((plan) => {
          if (this.entryRun !== R || R.phase !== "plan") return;
          if (!plan || (plan as { error?: string }).error) {
            if (P.auto === "entry") P.setAuto("none");
            this.entryRun = null;
            this.onPilotMessage?.(`Entry: no deorbit to ${site.name} within a day of orbits — the orbit never passes near it`);
            return;
          }
          R.phase = "wait";
          R.tBurn = at + plan.t;
          R.dv = plan.dv;
          R.plan = { heat: plan.heat, shield: plan.shield, g: plan.g };
          const wait = R.tBurn - this.nowTime() * Msec;
          const mm = Math.floor(wait / 60), ss = Math.round(wait % 60);
          this.onPilotMessage?.(`Entry to ${site.name}: the deorbit burn in ${mm} min ${ss} s, ${plan.dv.toFixed(0)} m/s — then ${(plan.heat / 1e4).toFixed(0)} W/cm², ${plan.g.toFixed(1)} g, the shield ${Math.round(plan.shield)} K at most`);
        });
      } else this.onPilotMessage?.(site ? `Entry: guided to ${site.name}` : `Entry: no site on ${name} — lift up, the controls yours when slow`);
    }
    const R = this.entryRun!;
    const retro = () => ({ nose: fr.toLocal(lin(va, -1, va, 0)), up: fr.toLocal(up) });
    if (R.phase === "plan") return retro();
    if (R.phase === "wait" || R.phase === "burn") {
      const thrSI = this.thrustMax() * (299792458 ** 2 / (1476.625 * s.massSolar));
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
          this.onPilotMessage?.(`Deorbit burn: ${R.dv.toFixed(0)} m/s retrograde`);
        }
        return retro();
      }
      // (burning: real time, every frame — a sped-up frame would fire seconds of thrust at once)
      this.warpWant = null;
      s.timeSpeed = this.warpSet = 1 / Msec;
      if (R.done >= R.dv) {
        R.phase = "entry";
        this.onPilotMessage?.(`Deorbit burn done (${R.done.toFixed(0)} m/s) — falling to the entry`);
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
      const wall = performance.now() / 1000;
      if (R.guid && R.site && wall >= R.next && !R.pending) {
        // (in the planner's worker: the next bank arrives a few frames on)
        const G = R.guid;
        R.pending = true;
        R.next = wall + 1;
        void runPlanner<{ out: number; bank: number; sign: number; prev: { b: number; e: number } | null; miss: EntryGuidance["lastMiss"]; path: Vec3[] | null } | null>({
          kind: "guide", env: fr.desc, craft, s: fr.s, place: fr.place(R.site), g: { bank: G.bank, sign: G.sign, prev: G.prev, o: G.o },
        }).then((r) => {
          R.pending = false;
          if (this.entryRun !== R || !r || (r as { error?: string }).error) return;
          Object.assign(G, { bank: r.bank, sign: r.sign, prev: r.prev, lastMiss: r.miss });
          G.last = { path: r.path ?? [] } as unknown as EntryResult;
          R.bank = r.out;
        });
      }
      if (LA && LA.out.mach < R.handover && LA.h < top * 0.5) {
        if (!R.site) return say(`Entry done over ${name}: Mach ${LA.out.mach.toFixed(1)}, the controls are yours`);
        if (!ranger) {
          // (the Lander: its engines bring it down, the speed killed)
          P.auto = "none";
          P.setAuto("land");
          this.entryRun = null;
          this.onPilotMessage?.(`Entry done: Mach ${LA.out.mach.toFixed(1)} — the engines land the Lander`);
          return null;
        }
        R.phase = "glide";
        R.alpha = LA.out.alpha;
        this.onPilotMessage?.(`Mach ${LA.out.mach.toFixed(1)}: gliding to ${R.site.name}`);
      }
      const ax = attitudeFor(fr.s.x, va, craft.alpha, R.bank);
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
    const ax = attitudeFor(fr.s.x, va, R.alpha, bank);
    return { nose: fr.toLocal(ax[2]), up: fr.toLocal(ax[1]) };
  }

  // ------------------------------------------------------------------------- the flight computer
  /**
   * The flight computer's context (fc/ops.ts): the craft about the body of its sphere, SI — our side in
   * the home axes (centred on the body), Gargantua's worlds in their frames made inertial (their turn
   * about their pole added) —, the body's pole, and the target if it goes about the same body (a moon,
   * a craft, the station). Null far from any body.
   */
  fcContext(): { ctx: FcContext; body: string; bodyName: string; targetName: string | null; universe: "ours" | "gargantua" } | null {
    const s = this.s;
    const cam = cameraFrame(s);
    const c = 299792458;
    const nav = this.ourNav(cam);
    if (nav) {
      const id = nav.ref;
      const b = solarBody(id);
      if (!b || b.kind === "star") return null;
      const rel = (X: Vec3, V: Vec3) => ({ r: lin(sub3(X, nav.refPos), M_METRES, X, 0) as KV3, v: lin(sub3(V, nav.refVel), c, V, 0) as KV3 });
      const ctx: FcContext = { mu: b.mass * M_METRES * c * c, R: b.radius * M_METRES, ...rel(nav.X, nav.V), pole: unitV(spinAxis(id)) as KV3 };
      const T = s.target as string;
      let st: { X: Vec3; V: Vec3 } | null = null;
      let targetName: string | null = null;
      if (T === "iss") {
        targetName = "ISS";
        const o = id === "earth" ? issOrbit(nav.t) : null;
        if (o) st = o;
      } else if (isCraft(T as Target)) {
        targetName = VESSELS[T as VesselId].name;
        const p = fleet.pose(T as VesselId, nav.t);
        if (p && !fleet.flownAssembly().includes(T as VesselId)) st = { X: p.X, V: p.V };
      } else {
        const tb = solarBody(T);
        targetName = tb?.name ?? null;
        if (tb && tb.parent === id) {
          const o = ourState(T, nav.t);
          st = { X: o.pos, V: o.vel };
        }
      }
      if (st && targetName) ctx.target = { ...rel(st.X, st.V), name: targetName };
      return { ctx, body: id, bodyName: b.name, targetName, universe: "ours" };
    }
    const lf = this.local;
    if (!lf || cam.region !== "hole") return null;
    const { F, L } = lf;
    const Msec = 4.925490947e-6 * s.massSolar;
    const x = lin(L.xi, F.mPerM, L.xi, 0) as KV3;
    const n = F.n / Msec;
    const v = [L.w[0] * c - n * x[1], L.w[1] * c + n * x[0], L.w[2] * c] as KV3;
    return { ctx: { mu: F.m * F.mPerM * c * c, R: F.R * F.mPerM, r: x, v, pole: [0, 0, 1] }, body: F.id, bodyName: BODY_NAMES[F.id as Body] ?? F.id, targetName: null, universe: "gargantua" };
  }

  /**
   * A landing site as the flight computer's LAND tab follows it (fc/land-ops.ts): where it will be in
   * the context's axes (fcContext's: body-centred, not turning — the body turning the site under the
   * orbit: ours on their own axes, Gargantua's worlds with their frame) at dt seconds from now, and the
   * craft's reach across its track (the entry's crossrange: the Ranger's lift ~600 km, the Lander's
   * ~150 km). Null away from its body.
   */
  fcSiteTrack(site: Site): SiteTrack | null {
    const c = this.fcContext();
    if (!c || c.body !== site.body) return null;
    const reach = fleet.active === "ranger" ? 600e3 : 150e3;
    const name = site.name.split(",")[0]!;
    const cam = cameraFrame(this.s);
    const nav = this.ourNav(cam);
    if (nav) {
      const id = nav.ref, bf = bodyFixedOf(id, site.lat, site.lon, 0), t0 = nav.t;
      return {
        name, reach,
        at: (dt) => {
          const t = t0 + dt / M_SECONDS;
          const X = sub3(fromBodyFixed(id, bf, t), solarState(id, t).pos);
          return lin(X, M_METRES, X, 0);
        },
      };
    }
    const lf = this.local;
    if (!lf) return null;
    const F = lf.F;
    const n = F.n / (4.925490947e-6 * this.s.massSolar);
    const d0 = siteDir(site), Rm = F.R * F.mPerM;
    return {
      name, reach,
      at: (dt) => {
        const a = n * dt;
        return [(d0[0] * Math.cos(a) - d0[1] * Math.sin(a)) * Rm, (d0[0] * Math.sin(a) + d0[1] * Math.cos(a)) * Rm, d0[2] * Rm];
      },
    };
  }

  /** The flight computer's burns about one of Gargantua's worlds (its frame): their time [s of the
   *  scene], prograde-normal-radial parts [m/s], what is done of the one firing. */
  fcBurns: { tAbs: number; dv: KV3; label: string; firing: boolean; done: number }[] = [];
  private fcNote = "";

  /**
   * The flight computer's candidate: an operation previewed — not in the plan — and the path it would
   * fly, drawn on the maps before it is executed: our side by the n-body predictor (the planner's
   * worker), about the hole on its geodesics, about Gargantua's worlds their two bodies in the world's
   * frame (carried back onto the hole's map). Null: none.
   */
  /** about a world: the free orbit's ground track ahead (unit, on the world's turning axes) */
  private localGround: Vec3[] | null = null;

  fcCand: {
    key: string; note: string; kind: "ours" | "hole" | "local"; t0: number;
    /** the burns' times [scene time: ours and the hole, M; the worlds, s] */
    nodes: { t: number }[];
    ours?: OurPath | null; kerr?: PlanPath | null;
    /** about a world: the path relative to the world's centre (the map puts it where the world is) */
    local?: { pts: Vec3[]; times: number[]; nodeAt: number[]; world: string; rot: Vec3[] } | null;
    arrive?: { body: string; t: number } | null;
    busy: boolean;
  } | null = null;
  private candGen = 0;

  /**
   * Previews burns (seconds from now; their parts, m/s), or a mission's planned path; null clears the
   * candidate. The path computed now (the hole's, the worlds') or in the worker (ours).
   */
  fcPreview(burns: Burn[] | null, note = "", o: { ours?: OurPath | null; arrive?: { body: string; t: number } | null } = {}) {
    const gen = ++this.candGen;
    if (!burns || !burns.length) {
      this.fcCand = null;
      return;
    }
    const s = this.s;
    const cam = cameraFrame(s);
    const c = 299792458;
    const Msec = 4.925490947e-6 * s.massSolar;
    const key = `${gen}`;
    const nav = this.ourNav(cam);
    if (nav) {
      const nodes = burns.map((b) => ({ t: nav.t + b.t / Msec, dv: [b.dv[0] / c, b.dv[1] / c, b.dv[2] / c] as Vec3 }));
      this.fcCand = { key, note, kind: "ours", t0: nav.t, nodes, ours: o.ours ?? null, arrive: o.arrive ?? null, busy: !o.ours };
      if (o.ours) return;
      const mouthR = mouth(s).w.rho, accel = this.thrustMax();
      void runPlanner<OurPath>({ kind: "predictPlan", X: nav.X, V: nav.V, t: nav.t, nodes, mouthR, accel, drag: this.dragPerMass() })
        .then((path) => {
          if (gen !== this.candGen || !this.fcCand || !path || (path as unknown as { error?: string }).error) return;
          this.fcCand.ours = path;
          this.fcCand.busy = false;
        })
        .catch(() => this.fcCand && gen === this.candGen && (this.fcCand.busy = false));
      return;
    }
    if (this.fcAboutHole()) {
      const st = this.stateNow();
      if (!st) return;
      const nodes: ManeuverNode[] = burns.map((b) => ({ t: st.t + b.t / Msec, dv: [b.dv[0] / c, b.dv[1] / c, b.dv[2] / c] as Vec3, goal: b.goal }));
      const last = nodes[nodes.length - 1]!.t;
      const tail = Math.max(2 * 2 * Math.PI * st.r ** 1.5, 1.5 * (last - st.t), 600);
      const res = planPath(st, nodes, this.world(), Math.min(tail, 60000));
      this.fcCand = { key, note, kind: "hole", t0: st.t, nodes, kerr: res?.path ?? null, busy: false };
      return;
    }
    // about one of Gargantua's worlds: the burns on its two bodies (the frame made inertial), the path
    // carried onto the hole's map
    const tr = this.localTrack(burns, 1.2);
    if (!tr) return;
    const now = this.nowTime() * Msec;
    const C = this.local!.F.C;
    const rel = { pts: tr.pts.map((q) => sub3(q, C)), times: tr.times, nodeAt: tr.nodeAt, world: this.local!.F.id, rot: tr.rot };
    this.fcCand = { key, note, kind: "local", t0: now / Msec, nodes: burns.map((b) => ({ t: (now + b.t) / Msec })), local: rel, busy: false };
  }

  /**
   * About one of Gargantua's worlds: the path through burns (seconds from now; their parts, m/s) on
   * its two bodies — the world's frame made inertial —, `turns` orbits on after the last, as points on
   * the hole's map: the orbit about the world as it is now (the map does not turn, the world's frame
   * does), at even times [M]. Null away from a world.
   */
  private localTrack(burns: Burn[], turns: number, N = 360): { pts: Vec3[]; times: number[]; nodeAt: number[]; dt: number; rot: Vec3[] } | null {
    const fc = this.fcContext();
    const lf = this.local;
    if (!fc || !lf || fc.universe !== "gargantua") return null;
    const Msec = 4.925490947e-6 * this.s.massSolar;
    const now = this.nowTime() * Msec;
    const F0 = lf.F;
    const total = burns.length ? burns[burns.length - 1]!.t : 0;
    const el = kepElements(fc.ctx.mu, fc.ctx.r, fc.ctx.v);
    const T = Number.isFinite(el.T) && el.T > 0 ? el.T : 3600;
    const span = total + turns * T;
    const pts: Vec3[] = [], times: number[] = [], nodeAt: number[] = [], rot: Vec3[] = [];
    let r = fc.ctx.r, v = fc.ctx.v, tPrev = 0, k = 0;
    const n = F0.n / Msec;
    for (let j = 0; j <= N; j++) {
      const t = (span * j) / N;
      // (a burn on the way: the state at it, the burn, then on)
      while (k < burns.length && burns[k]!.t <= t) {
        const st = kepProp(fc.ctx.mu, r, v, burns[k]!.t - tPrev);
        r = st.r;
        v = lin(st.v as Vec3, 1, fromPNR(st.r, st.v, burns[k]!.dv) as Vec3, 1) as KV3;
        tPrev = burns[k]!.t;
        nodeAt.push(pts.length);
        k++;
      }
      const q = kepProp(fc.ctx.mu, r, v, t - tPrev);
      // (impact: the path ends on the ground)
      if (Math.hypot(...q.r) < fc.ctx.R) break;
      const xi: Vec3 = [q.r[0] / F0.mPerM, q.r[1] / F0.mPerM, q.r[2] / F0.mPerM];
      pts.push(toGlobal(F0, { xi, w: [0, 0, 0], landed: false }).X);
      times.push((now + t) / Msec);
      // (over the ground: the world's frame turned on by then — its sites and its ground fixed in it)
      const ca = Math.cos(-n * t), sa = Math.sin(-n * t);
      rot.push(unitV([q.r[0] * ca - q.r[1] * sa, q.r[0] * sa + q.r[1] * ca, q.r[2]]));
    }
    return pts.length > 1 ? { pts, times, nodeAt, dt: span / N / Msec, rot } : null;
  }

  /** The flight computer's plan set: our side, as manoeuvre nodes (the map's path, the node autopilot);
   *  about Gargantua's worlds, its own burns. Why not, or null. */
  fcSetPlan(burns: Burn[], note: string): string | null {
    // (the candidate adopted: the plan's own path from now on)
    this.fcPreview(null);
    const s = this.s;
    const cam = cameraFrame(s);
    const c = 299792458;
    const Msec = 4.925490947e-6 * s.massSolar;
    const nav = this.ourNav(cam);
    if (nav) {
      const was = this.pilot.auto === "node";
      this.clearPlan();
      this.plan = { nodes: burns.map((b) => ({ t: nav.t + b.t / Msec, dv: [b.dv[0] / c, b.dv[1] / c, b.dv[2] / c] as Vec3 })), path: null, at: 0, note };
      this.refreshPlan(true);
      if (was) this.pilot.setAuto("node");
      return null;
    }
    if (this.fcAboutHole()) {
      const st = this.stateNow()!;
      this.clearPlan();
      this.plan = { nodes: burns.map((b, i) => ({ t: st.t + b.t / Msec, dv: [b.dv[0] / c, b.dv[1] / c, b.dv[2] / c] as Vec3, then: null, goal: b.goal, label: b.label })), path: null, at: 0, note };
      this.refreshPlan(true);
      return null;
    }
    if (!this.local || cam.region !== "hole") return "The flight computer: near a body";
    const now = this.nowTime() * Msec;
    this.fcBurns = burns.map((b) => ({ tAbs: now + b.t, dv: b.dv, label: b.label, firing: false, done: 0 }));
    this.fcNote = note;
    this.fcLocalPlan = null;
    return null;
  }

  /** about a world: the planned burns' path (relative to the world; on its turning axes), redone a few
   *  times a second while there are burns */
  private fcLocalPlan: { at: number; key: string; v: { pts: Vec3[]; times: number[]; nodeAt: number[]; world: string; rot: Vec3[] } | null } | null = null;
  private localPlanNow() {
    if (!this.fcBurns.length || !this.local) return null;
    const P = this.fcPlan();
    if (!P) return null;
    const key = P.burns.map((b) => `${b.dv.join()}@${Math.round(b.t)}`).join(";");
    const now = performance.now();
    const c = this.fcLocalPlan;
    if (c && c.key === key && now - c.at < 1000) return c.v;
    const tr = this.localTrack(P.burns, 1.2);
    const C = this.local.F.C;
    const v = tr ? { pts: tr.pts.map((q) => sub3(q, C)), times: tr.times, nodeAt: tr.nodeAt, world: this.local.F.id, rot: tr.rot } : null;
    this.fcLocalPlan = { at: now, key, v };
    return v;
  }

  /** Flies the plan: the node autopilot (our side), the flight computer's burns (Gargantua's worlds). */
  fcExecute(): string | null {
    const nav = this.ourNav(cameraFrame(this.s));
    if (nav) {
      if (!this.plan.nodes.length) return "No burns planned";
      if (this.pilot.auto !== "node") this.pilot.setAuto("node");
      return null;
    }
    if (this.fcAboutHole()) {
      if (!this.plan.nodes.length) return "No burns planned";
      if (this.pilot.auto !== "node") this.pilot.setAuto("node");
      return null;
    }
    if (!this.fcBurns.length) return "No burns planned";
    if (this.pilot.auto !== "burns") this.pilot.setAuto("burns");
    return null;
  }

  fcClear() {
    this.clearPlan();
    this.fcBurns = [];
    if (this.pilot.auto === "burns") this.pilot.setAuto("burns");
  }

  /** The plan as burns (seconds from now). */
  fcPlan(): { burns: Burn[]; note: string; executing: boolean } | null {
    const s = this.s;
    const c = 299792458;
    const Msec = 4.925490947e-6 * s.massSolar;
    const nav = this.ourNav(cameraFrame(s));
    if (nav) {
      if (!this.plan.nodes.length) return null;
      return { burns: this.plan.nodes.map((n, i) => ({ t: (n.t - nav.t) * Msec, dv: [n.dv[0] * c, n.dv[1] * c, n.dv[2] * c] as KV3, label: (n as { role?: string }).role ?? `node ${i + 1}` })), note: this.plan.note, executing: this.pilot.auto === "node" };
    }
    if (this.fcAboutHole()) {
      const st = this.stateNow();
      const nodes = st ? this.plan.nodes.filter((n) => n.t > st.t - 1e-9) : [];
      if (!st || !nodes.length) return null;
      return { burns: nodes.map((n, i) => ({ t: (n.t - st.t) * Msec, dv: [n.dv[0] * c, n.dv[1] * c, n.dv[2] * c] as KV3, label: n.label ?? `burn ${i + 1}`, goal: n.goal })), note: this.plan.note, executing: this.pilot.auto === "node" };
    }
    if (!this.fcBurns.length) return null;
    const now = this.nowTime() * Msec;
    return { burns: this.fcBurns.map((b) => ({ t: b.tAbs - now, dv: b.dv, label: b.label })), note: this.fcNote, executing: this.pilot.auto === "burns" };
  }

  /** About Gargantua itself (no world's frame, not our side): the hole's operations, on its geodesics. */
  fcAboutHole(): boolean {
    const cam = cameraFrame(this.s);
    return cam.region === "hole" && !this.ourNav(cam) && !this.fcContext();
  }

  private kerrInfoCache: { at: number; key: string; o: KerrOrbit; t: number } | null = null;
  /** The orbit about the hole as its path shows it (once a second, or when a burn changed it), with
   *  the scene's units: seconds and metres per M. */
  fcKerrInfo(): { o: KerrOrbit; t: number; Msec: number; Mm: number; a: number } | null {
    if (!this.fcAboutHole()) return null;
    const st = this.stateNow();
    if (!st) return null;
    const now = performance.now();
    const key = `${st.E.toFixed(9)}|${st.L.toFixed(7)}|${this.s.spin}`;
    const C = this.kerrInfoCache;
    if (!C || C.key !== key || now - C.at > 1000) this.kerrInfoCache = { at: now, key, o: kerrOrbit(st, this.world()), t: st.t };
    const K = this.kerrInfoCache!;
    return { o: K.o, t: st.t, Msec: 4.925490947e-6 * this.s.massSolar, Mm: 1476.625 * this.s.massSolar, a: this.s.spin };
  }

  /** One of the hole's orbital operations (fc/kerr-ops.ts), as the flight computer shows it: burns in
   *  seconds and m/s, the orbit after on the geodesics. A string: why not. */
  fcKerrOp(kind: "circ" | "ap" | "pe" | "hohmann" | "inc" | "res" | "plane", x?: number | "now" | "pe" | "ap"): OpResult | string {
    if (!this.fcAboutHole()) return "About Gargantua itself (away from its worlds)";
    const st = this.stateNow();
    if (!st) return "About Gargantua itself";
    const s = this.s;
    const w = this.world();
    const D = Math.PI / 180;
    let r: KerrOp;
    if (kind === "circ") r = kCircularize(st, w, (x as "now" | "pe" | "ap") ?? "ap");
    else if (kind === "ap") r = kApoapsis(st, w, x as number);
    else if (kind === "pe") r = kPeriapsis(st, w, x as number);
    else if (kind === "hohmann") r = kHohmann(st, w, x as number);
    else if (kind === "inc") r = kInclination(st, w, (x as number) * D);
    else if (kind === "res") r = kResonant(st, w, x as number);
    else {
      // the target's plane: a world's (or the companion's) orbit about the hole
      const body = s.target as Body;
      if (s.system === "none" && body !== "star") return "No target in this scene";
      if (s.target === "hole" || s.target === "wormhole" || s.target === "barycentre") return "Target a world or the star (a click on the map)";
      if (body === "star" && !s.sun) return "No companion star in this scene";
      const n = cross(bodyCentre(s, body, st.t), bodyVelocity(s, body, st.t));
      if (Math.hypot(...n) < 1e-12) return "The target has no orbit's plane";
      r = kMatchPlane(st, w, n, `${BODY_NAMES[body]}'s plane`);
    }
    const c = 299792458;
    const Msec = 4.925490947e-6 * s.massSolar;
    if (!r.ok) return { ok: false, note: r.note, burns: [], dvTotal: 0 };
    const burns: Burn[] = r.nodes.map((n, i) => ({ t: (n.t - st.t) * Msec, dv: [n.dv[0] * c, n.dv[1] * c, n.dv[2] * c] as KV3, label: kind === "circ" || (kind === "hohmann" && i === 1) ? "circularize" : kind === "hohmann" ? "transfer" : kind === "inc" || kind === "plane" ? "plane change" : kind === "ap" ? "apoapsis" : kind === "pe" ? "periapsis" : kind === "res" ? "resonance" : `burn ${i + 1}`, goal: n.goal }));
    const a = r.after;
    const afterText = a ? (a.fate === "horizon" ? "After: into the horizon" : a.fate === "escape" ? `After: an escape (periapsis ${a.rp.toFixed(2)} M)` : `After: Pe ${a.rp.toFixed(2)} M · Ap ${a.ra.toFixed(2)} M · i ${(a.inc / D).toFixed(2)}° · period ${fmtDur(a.T * Msec)}${a.advance ? ` · the periapsis ${(a.advance / D).toFixed(1)}° on a turn` : ""}${a.prograde ? "" : " · retrograde"}`) : undefined;
    // (a burn a good part of an orbit long — the hole's are, at its scale —: flown to its goal, but the
    // orbit's other side moves with it)
    const acc = this.fcBudget().accel;
    const T = r.after?.T ?? kerrOrbit(st, w).T;
    const long = acc > 0 && Number.isFinite(T) ? Math.max(...burns.map((b) => Math.hypot(...b.dv) / acc)) / (T * Msec) : 0;
    const warn = long > 0.2 ? ` · ⚠ a burn ${(long * 100).toFixed(0)} % of an orbit long: flown to its goal, the other side moves` : "";
    return { ok: true, note: r.note, burns, dvTotal: burns.reduce((q, b) => q + Math.hypot(...b.dv), 0), afterText: afterText && afterText + warn };
  }

  /** The propellant's Δv left [m/s] (no gauge: a full tank's), the acceleration at full thrust [m/s²]. */
  fcBudget(): { dv: number; accel: number } {
    const s = this.s;
    const c = 299792458;
    // (no gauge: the propellant is not counted)
    const left = s.fuel ? tank(s, this.spent).left * c : Infinity;
    return { dv: left, accel: (this.thrustMax() * c * c) / (1476.625 * s.massSolar) };
  }

  /**
   * The flight computer's burns flown about one of Gargantua's worlds: each pointed at its time — its
   * prograde, normal and radial parts at the orbit then (two bodies about the world: its frame made
   * inertial) — and fired until its Δv is given (the proper acceleration's), the time sped up between.
   */
  private burnsStep(cam: ReturnType<typeof cameraFrame>): { nose: Vec3; up: Vec3; throttle?: number } | null {
    const s = this.s;
    const P = this.pilot;
    const say = (t: string) => {
      P.setAuto("none");
      this.onPilotMessage?.(t);
      return null;
    };
    const B = this.fcBurns[0];
    if (!B) return say(`Flight computer: ${this.fcNote || "the plan"} — done`);
    const fr = this.entryFrame(cam);
    const fc = this.fcContext();
    if (!fr || !fc) return say("Flight computer: away from the world — the burns dropped");
    const Msec = 4.925490947e-6 * s.massSolar;
    const now = fr.now;
    const thr = (this.thrustMax() * 299792458 ** 2) / (1476.625 * s.massSolar);
    const size = Math.hypot(...B.dv);
    const burnT = thr > 0 ? size / thr : 0;
    // the burn's direction where the craft is then (the inertial frame's: its parts as the orbit then)
    const wait = Math.max(B.tAbs - burnT / 2 - now, 0);
    const at = kepProp(fc.ctx.mu, fc.ctx.r, fc.ctx.v, Math.max(B.tAbs - now, 0));
    const dir = unitV(fromPNR(at.r, at.v, B.dv) as Vec3);
    const att = { nose: fr.toLocal(dir), up: fr.toLocal(unitV(fc.ctx.r as Vec3)) };
    if (!B.firing) {
      this.warpWant = null;
      s.timeSpeed = this.warpSet = (wait > 40 ? Math.min(1000, Math.max((wait - 25) / 3, 1)) : 1) / Msec;
      if (wait <= 0) {
        B.firing = true;
        B.done = 0;
        this.warpWant = null;
        s.timeSpeed = this.warpSet = 1 / Msec;
        this.onPilotMessage?.(`Burn ${B.label}: ${size.toFixed(1)} m/s`);
      }
      return att;
    }
    this.warpWant = null;
    s.timeSpeed = this.warpSet = 1 / Msec;
    if (B.done >= size) {
      this.fcBurns.shift();
      this.onPilotMessage?.(`Burn ${B.label} done (${B.done.toFixed(1)} m/s)`);
      return att;
    }
    return { ...att, throttle: Math.min(1, Math.max((size - B.done) / Math.max(thr * 0.5, 1e-9), 0.05)) };
  }

  /**
   * The angle of attack a glide asks: the lift that turns the path onto the climb angle wanted —
   * m (g cos γ + V k (γ_ref − γ) − V γ̇ d) / cos bank — from the lift the wing gives now at the angle it has
   * (its slope), eased over a few tenths of a second; slower than ~1.25 × the stall's, the nose
   * lowered. Low (1.5 km), the time back to real.
   */
  private glideAlpha(R: NonNullable<CameraController["entryRun"]>, gRef: number, gam: number, gdot: number, sp: number, bank: number, agl: number, dt: number, stall: number, prot: number, gdotRef = 0): number {
    const LA = this.airFlight.last;
    const m = fleet.massProps().mass;
    const g = 9.81;
    const k = agl < 80 ? 1.6 : 0.8;
    // (the reference's own turn fed forward — gdotRef —, the damping on what departs from it)
    const need = (m * (g * Math.cos(gam) + sp * (gdotRef + k * (gRef - gam) - 0.6 * (gdot - gdotRef)))) / Math.max(Math.cos(bank), 0.5);
    // (the angle whose lift — signed, the craft's own aerodynamics in the air it is in — is that:
    // Newton's steps from the angle it has)
    let want = R.alpha;
    let vStall = 0;
    if (LA && LA.air.rho > 0 && sp > 1) {
      const A = VESSELS[fleet.active].aero;
      const lift = (al: number) => {
        const o = aeroForces(A, [0, -sp * Math.sin(al), sp * Math.cos(al)], LA.air, [0, 0, 0], this.airFlight.cfg);
        return o.F[1] * Math.cos(al) + o.F[2] * Math.sin(al);
      };
      for (let i = 0; i < 3; i++) {
        const l0 = lift(want), l1 = lift(want + 0.01);
        const slope = (l1 - l0) / 0.01;
        if (!(slope > 1e-6)) break;
        want = clamp(want + (need - l0) / slope, -0.05, stall);
      }
      // (the stall's speed here: the lift at the stall's angle grows as the speed squared)
      const ls = lift(stall);
      if (ls > 0) vStall = sp * Math.sqrt((m * g) / ls);
    }
    // (the speed kept — `prot` × the stall's: the energy the flare needs, ×1.1 in it; slower, the nose down, the path
    // given up rather than the wing)
    want -= 0.01 * Math.max(prot * vStall - sp, 0);
    const a = R.alpha + (clamp(want, 0, stall) - R.alpha) * Math.min(1, dt / 0.35);
    if (agl < 1500) {
      const Msec = 4.925490947e-6 * this.s.massSolar;
      if (Math.abs(this.s.timeSpeed * Msec - 1) > 1e-6) {
        this.warpWant = null;
        this.s.timeSpeed = this.warpSet = 1 / Msec;
      }
    }
    return clamp(a, 0, stall);
  }

  /** The gear's height over the ground below — its relief: our worlds', Gargantua's (h: over the sphere,
   *  the fallback) [m]. */
  private aglNow(cam: ReturnType<typeof cameraFrame>, h: number): number {
    const nav = this.ourNav(cam);
    if (nav) return Math.max(gearHeight(nav.ref, nav.X, nav.t), 0);
    const lf = this.local;
    if (lf) return Math.max((Math.hypot(...lf.L.xi) - groundR(lf.F, lf.L.xi)) * lf.F.mPerM - GEAR, 0);
    return Math.max(h - GEAR, 0);
  }

  /**
   * The Ranger's approach to a runway: the axis intercepted well before the final's start (12 km before
   * the threshold, ~3.5 km up) — or, from too close, flown to it and turned there; then the final — the bank against the cross-track error and
   * its rate, a steep glide path (as the Shuttle's, 18°) to an aim point 2 km short, the flare to a
   * shallow one, the touchdown on the centreline, the wheels and the brakes after.
   */
  private approach(fr: NonNullable<ReturnType<CameraController["entryFrame"]>>, R: NonNullable<CameraController["entryRun"]>, site: Site, va: Vec3, up: Vec3, h: number, dt: number, cam: ReturnType<typeof cameraFrame>) {
    const D = Math.PI / 180;
    const T = fr.place(site);
    const tu = unitV(T);
    // (the site's north: the body's pole on it — ours: the spin axis; Gargantua's worlds: their z)
    const nav = this.ourNav(cam);
    const pole: Vec3 = nav ? unitV(spinAxis(fr.body)) : [0, 0, 1];
    const north = unitV(lin(pole, 1, tu, -dot3(pole, tu)));
    const east = cross(north, tu);
    const hd = (site.rwy ?? 0) * D;
    const along = lin(north, Math.cos(hd), east, Math.sin(hd));
    const rgt = cross(along, tu);
    const x = fr.s.x;
    const rel = sub3(x, T);
    const sAl = dot3(rel, along); // (negative before the threshold)
    const xt = dot3(rel, rgt);
    const sp = Math.hypot(...va);
    const agl = this.aglNow(cam, h);
    const vh = unitV(lin(va, 1, up, -dot3(va, up)));
    const gam = Math.asin(clamp(dot3(va, up) / Math.max(sp, 1e-9), -1, 1));
    const gdot = R.gPrev !== null && dt > 0 ? (gam - R.gPrev) / dt : 0;
    R.gPrev = gam;
    // (the final: within 6 km of the axis, heading down it — the turn onto it at the final's start
    // leaves the craft a turn's diameter off, ~4 km at 120 m/s: joined from there, not sent back to the
    // start behind it to turn again, and again)
    const onFinal = sAl > -16e3 && Math.abs(xt) < 6e3 && dot3(vh, along) > 0.5;
    let bank: number, gRef: number, gdotRef = 0;
    if (!onFinal) {
      // (far enough back: the axis joined — the course turned onto it as the offset closes, atan(xt/L)
      // off it, L about a turn's radius: no overshoot. Down the runway but wide: to the final's start.
      // Against it, closer: a circuit — downwind, a turn's diameter off the axis on the craft's side,
      // then abeam the final's start the turn towards the axis, rolled out on it. A glide path to
      // 3.5 km over the final's start along the way still to fly.)
      const L0 = Math.max(6e3, (0.8 * Math.min(sp, 350) ** 2) / (9.81 * Math.tan(0.6)));
      const far = sAl < -(12e3 + 0.5 * Math.abs(xt) + L0);
      const dn = dot3(vh, along);
      let tdir: Vec3 | null = null, dGo: number;
      bank = 0;
      if (far) {
        const off = Math.min(Math.atan2(Math.abs(xt), L0), 1.4);
        tdir = lin(along, Math.cos(off), rgt, -Math.sign(xt) * Math.sin(off));
        dGo = -12e3 - sAl + 0.5 * Math.abs(xt);
        R.side = undefined;
        R.turning = false;
        R.leg = "join";
      } else if (dn >= 0.5) {
        const toA = sub3(lin(T, 1, along, -12e3), x);
        tdir = unitV(lin(toA, 1, up, -dot3(toA, up)));
        // (and the turn onto the axis there: an arc of ~8 km radius)
        dGo = Math.hypot(...lin(toA, 1, up, -dot3(toA, up))) + 8e3 * Math.acos(clamp(dot3(tdir, along), -1, 1));
        R.side = undefined;
        R.turning = false;
        R.leg = "toStart";
      } else {
        // (the side kept once chosen: the turn crosses nothing, rolled out on the axis)
        const side = (R.side ??= Math.sign(xt) || 1);
        const Dd = clamp((2 * sp * sp) / (9.81 * Math.tan(0.6)), 4e3, 8e3);
        // (turned early when the height left would no longer bring the craft round the turn and down
        // the final to the runway — a glide ratio of 5.5, the turn's height counted: from a short final)
        const hNeed = (Math.max(-sAl, 0) + 500 + (Math.PI * Dd) / 2) / 5.5;
        if (!R.turning && sAl < -3e3 && agl < hNeed) R.turning = true;
        R.leg = sAl > -12e3 && !R.turning ? "downwind" : "turn";
        if (sAl > -12e3 && !R.turning) {
          // downwind: the line a turn's diameter off the axis joined (atan(e / 3 km), 40° at most)
          const e = xt - side * Dd;
          const off = Math.min(Math.atan2(Math.abs(e), 3000), 0.7);
          tdir = lin(along, -Math.cos(off), rgt, -Math.sign(e) * Math.sin(off));
          dGo = sAl + 12e3 + 0.5 * Math.abs(e) + (Math.PI * Dd) / 2;
        } else {
          // abeam the final's start (or sooner, low): the turn towards the axis, all the way round
          R.turning = true;
          bank = 0.6 * side;
          dGo = (Math.acos(clamp(dn, -1, 1)) * Dd) / 2;
        }
      }
      if (tdir) {
        const dpsi = Math.atan2(-dot3(cross(vh, tdir), up), dot3(vh, tdir));
        bank = clamp(1.4 * dpsi, -0.6, 0.6);
      }
      gRef = clamp(-Math.atan2(Math.max(agl - 3500, 0), Math.max(dGo, 1500)), -0.35, -0.035);
    } else {
      R.side = undefined;
      R.turning = false;
      R.leg = "final";
      // (the final: the axis joined — the course to it atan(xt / 3 km) off the runway's, 40° at most:
      // the offset closed in ~20 s once near, a turn's width away from it in ~40 —, held; steep to
      // 300 m, then the flare)
      const dpsi = Math.atan2(dot3(vh, rgt), dot3(vh, along));
      const want = -Math.min(Math.max(Math.atan2(xt, 3000), -0.7), 0.7);
      bank = clamp(-1.2 * (dpsi - want), -0.5, 0.5) * (agl < 60 ? agl / 60 : 1);
      // (the height down a profile to the touchdown aimed, 450 m past the threshold — landing.ts-free:
      // landingProfile below —, its slope followed and the height's error closed over ~4 s)
      const L = landingProfile(sAl, agl, sp, R.gOuter);
      if (L.freeze && R.gOuter === undefined) R.gOuter = L.fix;
      gRef = clamp(Math.atan(L.slope) + clamp((L.h - agl) / (Math.max(sp, 50) * 4), -0.12, 0.12), -0.35, 0.05);
      // (the slope's turn ahead — the pull-up, the flare —: its rate fed forward, half a second on)
      gdotRef = (Math.atan(landingProfile(sAl + sp * 0.5, agl, sp, L.fix).slope) - Math.atan(L.slope)) / 0.5;
      R.flareTau = L.phase === "flare" ? 1 : undefined;
      R.prof = { phase: L.phase, aim: L.aim, td: LANDING.td, h: L.h };
    }
    if (!onFinal) {
      R.gOuter = undefined;
      R.prof = undefined;
    }
    R.app = { along: sAl, across: xt, final: onFinal, agl, speed: sp, gRef, gam };
    const stall = (VESSELS[fleet.active].aero.wing?.stall ?? 0.35) - 0.05;
    R.alpha = this.glideAlpha(R, gRef, gam, gdot, sp, bank, agl, dt, stall, onFinal && R.flareTau !== undefined ? 1.1 : agl > 600 ? 1.6 : 1.35, gdotRef);
    // (the air brake: the speed held down the steep slope, then bled on the shallow one)
    const vT = !onFinal ? 230 : R.prof && R.prof.phase !== "outer" ? 130 : 160;
    this.airBrake = clamp((sp - vT) / 50, 0, 1);
    const ax = attitudeFor(fr.s.x, va, R.alpha, bank);
    return { nose: fr.toLocal(ax[2]), up: fr.toLocal(ax[1]) };
  }

  /** The air brake asked for (0 … 1). */
  airBrake = 0;

  /** On the ground and rolling (our side): the body under the wheels. */
  private rolling: { body: string } | null = null;

  /** A crash (the damage on): the craft lost. */
  private crashed(why: string) {
    if (!this.s.damage || this.airFlight.failure) return;
    this.airFlight.failure = why;
    this.onCraftLost?.(why);
  }

  /**
   * On its wheels: the wings level on the ground, the nose between 3° down and 15° up (the tail on the
   * runway) — the pilot's turns in roll, and in pitch past those, stopped. `up`: the ground's normal,
   * camera-local components.
   */
  /** The runway an autopilot's landing rolls out on (its nose wheel steered along it), until stopped. */
  private rollSite: Site | null = null;

  /**
   * The rollout after an autopilot's landing: the nose wheel steered along the runway — the course back
   * to its axis atan(xt / 150 m), 8° at most —, 4° a second at most; the pilot's yaw takes it over.
   */
  private rolloutSteer(upL: Vec3, dt: number, yawIn: number) {
    const site = this.rollSite;
    const cam = cameraFrame(this.s);
    const fr = site ? this.entryFrame(cam) : null;
    if (!site || !fr || Math.abs(yawIn) > 0.05) {
      this.rollSite = null;
      return;
    }
    const D = Math.PI / 180;
    const T = fr.place(site);
    const tu = unitV(T);
    const pole = unitV(spinAxis(fr.body));
    const north = unitV(lin(pole, 1, tu, -dot3(pole, tu)));
    const east = cross(north, tu);
    const hd = (site.rwy ?? 0) * D;
    const along = lin(north, Math.cos(hd), east, Math.sin(hd));
    const rgt = cross(along, tu);
    const xt = dot3(sub3(fr.s.x, T), rgt);
    const w = clamp(Math.atan2(xt, 150), -8 * D, 8 * D);
    const want = lin(along, Math.cos(w), rgt, -Math.sin(w));
    const toC = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
    const U = unitV(toC(upL)), W0 = toC(fr.toLocal(want));
    const W = unitV(lin(W0, 1, U, -dot3(W0, U)));
    const S = this.shipMatrix();
    const Z: Vec3 = [S[0][2]!, S[1][2]!, S[2][2]!];
    const Zh = unitV(lin(Z, 1, U, -dot3(Z, U)));
    const a = Math.atan2(dot3(cross(Zh, W), U), dot3(Zh, W));
    // (rolling backwards or across: not a rollout)
    if (Math.abs(a) > 60 * D) {
      this.rollSite = null;
      return;
    }
    const simS = this.s.timeSpeed * dt * 4.925490947e-6 * this.s.massSolar;
    const step = clamp(a, -4 * D * simS, 4 * D * simS);
    if (Math.abs(step) > 1e-7) this.rotateC(lin(U, step, U, 0));
    this.pilot.omega[1] = 0;
  }

  private groundAttitude(up: Vec3) {
    const cam = cameraFrame(this.s);
    const toC = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
    const S = this.shipMatrix();
    const col = (i: number): Vec3 => [S[0][i]!, S[1][i]!, S[2][i]!];
    const X = col(0), Z = col(2);
    const u = unitV(toC(up));
    const pitch = Math.asin(clamp(dot3(Z, u), -1, 1));
    const D = Math.PI / 180;
    const want = clamp(pitch, -3 * D, 15 * D);
    // (about the ship's x — its left: a positive turn lowers the nose)
    if (Math.abs(want - pitch) > 1e-6) {
      this.rotateC(lin(X, pitch - want, X, 0));
      this.pilot.omega[0] = 0;
    }
    const S2 = this.shipMatrix();
    const Y2: Vec3 = [S2[0][1]!, S2[1][1]!, S2[2][1]!], Z2: Vec3 = [S2[0][2]!, S2[1][2]!, S2[2][2]!];
    const u2 = unitV(lin(u, 1, Z2, -dot3(u, Z2)));
    const ra = Math.atan2(dot3(cross(Y2, u2), Z2), dot3(Y2, u2));
    if (Math.abs(ra) > 1e-6) this.rotateC(lin(Z2, ra, Z2, 0));
    this.pilot.omega[2] = 0;
  }

  /** The entry autopilot, for the map: its phase, the site (its place, body-centred home axes [M]), the
   *  guidance's predicted fall (likewise), its bank and miss. Null when off. */
  private entryInfo() {
    const R = this.entryRun;
    if (!R) return null;
    const cam = cameraFrame(this.s);
    const nav = this.ourNav(cam);
    const fr = this.entryFrame(cam);
    if (!fr) return null;
    const k = nav ? 1 / M_METRES : 1;
    const toMap = (x: Vec3): Vec3 => lin(x, k, x, 0);
    const path = R.guid?.last?.path.map((x) => toMap(x as Vec3)) ?? null;
    return {
      phase: R.phase, body: fr.body, site: R.site ? { name: R.site.name, X: toMap(fr.place(R.site)) } : null, path, bank: R.bank,
      miss: R.guid?.lastMiss ?? null, tBurn: R.phase === "wait" ? R.tBurn - fr.now : null, dv: R.dv, plan: R.plan ?? null, ours: !!nav, app: R.app ?? null,
    };
  }

  /** The flown craft in the air, for the displays: the flow (q, Mach, α, β), the heat, the skin, the load. */
  private airInfo() {
    const A = this.airFlight;
    const L = A.last;
    const V = VESSELS[fleet.active].aero;
    return {
      inAir: A.inAir, q: L?.out.q ?? 0, mach: L?.out.mach ?? 0, alpha: L?.out.alpha ?? 0, beta: L?.out.beta ?? 0, heat: L?.out.heat ?? 0,
      u: L?.u ?? null, rho: L?.air.rho ?? 0, glow: L?.air.gas.glow ?? null, lift: L?.out.L ?? 0, drag: L?.out.D ?? 0, stalled: L?.out.stalled ?? false, h: L?.h ?? NaN, speed: L?.speed ?? 0, airT: L?.air.T ?? NaN,
      shield: A.skin.shield, hull: A.skin.hull, shieldMax: V.shield?.tMax ?? 0, hullMax: V.hull.tMax, g: A.g, gMax: V.gMax, gPeak: A.gPeak,
      margins: A.margins(), failure: A.failure, damage: this.s.damage, body: A.body, rolling: !!this.rolling || !!this.local?.L.rolling,
      mode: this.flightModeNow(), antigrav: this.s.antigrav, flaps: A.cfg.flaps ?? 0, brake: A.cfg.brake ?? 0, gear: !!A.cfg.gear,
      sf: this.sfCmd ? { ...this.sfCmd } : null, ...this.attitudeNow(),
      // (the wing's incidences, for the HUD's angle-of-attack cues: the stall; the best lift-to-drag —
      // where the induced drag equals the zero-lift one, C_L = √(C_D0 π AR e))
      stallA: V.wing?.stall ?? null,
      bestA: V.wing ? Math.sqrt((V.cdA0 / V.wing.S) * Math.PI * V.wing.AR * V.wing.e) / V.wing.cla : null,
    };
  }

  /** the engines' and the wingtips' condensation trails (contrails.ts), kept in the air */
  readonly contrails = new Contrails();
  private contrailBuf = new Float32Array(MAX_SEGMENTS * SEG_FLOATS);

  /**
   * The condensation trails this frame: drawn on from the main engines (their exhaust, when the air is
   * cold enough for it to freeze — contrails.ts) and the Ranger's wingtips (pulling hard in moist air),
   * carried with the air, aged; handed over in the ship's frame for the renderer. Null: none.
   */
  contrailsFrame(): { data: Float32Array<ArrayBuffer>; n: number } | null {
    const cam = cameraFrame(this.s);
    const fr = this.s.ship ? this.entryFrame(cam) : null;
    if (!fr || !fr.env.atm) {
      if (this.contrails.trails.length) this.contrails.clear();
      return null;
    }
    const x = fr.s.x;
    const ax = this.shipAxesLocal(cam).map((a) => fr.fromLocal(a)) as [Vec3, Vec3, Vec3];
    // (a ship-frame point in the body's frame)
    const at = (q: Vec3): Vec3 => [0, 1, 2].map((k) => x[k]! + ax[0][k]! * q[0] + ax[1][k]! * q[1] + ax[2][k]! * q[2]) as Vec3;
    const src: ContrailSource[] = [];
    const LA = this.airFlight.last;
    const V = VESSELS[fleet.active];
    if (LA && LA.air.rho > 0) {
      const f = this.pilot.fired;
      const thr = performance.now() - f.at < 300 ? f.throttle : 0;
      const e = engineTrail(thr, LA.air.rho, LA.air.T, LA.air.gas.R);
      // (from a little behind each exit: the exhaust condenses as it mixes)
      if (e > 0) V.jets.forEach((J, i) => J.main && src.push({ key: `e${i}`, p: at(lin(J.p, 1, J.d, 2)), kind: 0, str: e }));
      const wing = V.aero.wing;
      if (fleet.active === "ranger" && wing && LA.out.q > 0) {
        const t = tipTrail(Math.abs(LA.out.L) / (LA.out.q * wing.S), LA.air.rho, LA.air.T, LA.speed);
        if (t > 0) for (const sx of [1, -1]) src.push({ key: `t${sx}`, p: at([4.1 * sx, 0.44, -0.3]), kind: 1, str: t });
      }
    }
    this.contrails.step(fr.now, fr.body, fr.env.carry, src);
    const n = this.contrails.view(fr.now, x, ax, this.contrailBuf);
    return n ? { data: this.contrailBuf, n } : null;
  }

  /** The flight path's angle over the local horizon [rad] (0 away from a body). */
  private pathAngle(cam: ReturnType<typeof cameraFrame>): number {
    const fr = this.sfFrame(cam);
    const v = fr ? Math.hypot(...fr.vRel) : 0;
    return fr && v > 0 ? Math.asin(clamp(dot3(fr.vRel, fr.up) / v, -1, 1)) : 0;
  }

  /** The flown craft's attitude over the ground below: pitch, bank (right: +), heading [rad]. */
  private attitudeNow(): { pitch: number; bank: number; heading: number } | Record<string, never> {
    const cam = cameraFrame(this.s);
    const fr = this.sfFrame(cam);
    if (!fr) return {};
    const ax = this.shipAxesLocal(cam).map((a) => fr.fromLocal(a));
    const [X, Y, Z] = ax as [Vec3, Vec3, Vec3];
    return {
      pitch: Math.asin(clamp(dot3(Z, fr.up), -1, 1)),
      bank: Math.atan2(dot3(X, fr.up), dot3(Y, fr.up)),
      heading: Math.atan2(dot3(Z, fr.east), dot3(Z, fr.north)),
    };
  }

  /** The flown craft's angular velocity, ship frame, right-handed [rad/s of its time] (the pilot's
   *  rates are the other way round; in the air they run on the craft's clock). */
  private spinPhysical(): Vec3 {
    return [-this.pilot.omega[0], -this.pilot.omega[1], -this.pilot.omega[2]];
  }

  /** The flown craft's turn as flown — its axes now against last step's: its angular velocity (home)
   *  per M of the scene's time, eased (what it keeps turning at when left to coast). */
  private spin: { ax: [Vec3, Vec3, Vec3]; t: number; w: Vec3 } | null = null;
  private measureSpin() {
    const P = this.activePoseNow();
    if (!P) return (this.spin = null);
    const S = this.spin;
    if (S && P.t > S.t) {
      // (the rotation from the last axes to these: Σ eᵢ × R eᵢ = 2 sin θ k, Σ eᵢ·R eᵢ = 1 + 2 cos θ)
      let v: Vec3 = [0, 0, 0];
      let tr = 0;
      for (let i = 0; i < 3; i++) {
        v = lin(v, 1, cross(S.ax[i]!, P.ax[i]!), 0.5);
        tr += dot3(S.ax[i]!, P.ax[i]!);
      }
      const sn = Math.hypot(...v);
      const th = Math.atan2(sn, (tr - 1) / 2);
      const w = sn > 1e-12 ? lin(v, th / sn / (P.t - S.t), v, 0) : ([0, 0, 0] as Vec3);
      const k = 0.3;
      this.spin = { ax: P.ax, t: P.t, w: lin(S.w, 1 - k, w, k) };
    } else if (!S || P.t < S.t) this.spin = { ax: P.ax, t: P.t, w: [0, 0, 0] };
  }

  /** The flown assembly's centre of mass for coasting: its own (an assembly), else the craft's origin —
   *  a lone craft turns about it as flown. */
  private coastCom(): Vec3 {
    return fleet.flownAssembly().length > 1 ? fleet.massProps().com : [0, 0, 0];
  }

  // ------------------------------------------------------------------------------ the fleet
  /** The flown craft's place now (home): its centre, velocity and axes (fleet.ts reads it). */
  private activePoseNow(evenOff = false): (Pose & { t: number }) | null {
    const s = this.s;
    if (!s.ship && !evenOff) return null;
    const cam = cameraFrame(s);
    const nav = this.ourNav(cam);
    if (!nav) return null;
    const w = mouth(s).w;
    const ax = this.shipAxesLocal({ right: cam.right, up: cam.up, fwd: cam.fwd }).map((a) => unitV(repToHomeVec(w, cam.ell, cam.n, a))) as [Vec3, Vec3, Vec3];
    return { X: nav.X, V: nav.V, ax, t: nav.t, w: this.spin?.w };
  }

  /** The camera's axes (right, up, forward) in the home frame (our side), or null. */
  private camAxesHome(): [Vec3, Vec3, Vec3] | null {
    const s = this.s;
    const cam = cameraFrame(s);
    if (!onOurSide(s, cam)) return null;
    const w = mouth(s).w;
    return [cam.right, cam.up, cam.fwd].map((a) => unitV(repToHomeVec(w, cam.ell, cam.n, a))) as [Vec3, Vec3, Vec3];
  }

  /**
   * After a turn of the flown craft (the camera's axes `before` it, home): its centre moved as the
   * assembly's turns about their common centre of mass (`com`, its own frame [m]) — the centre of mass
   * stays put, its velocity too.
   */
  private turnAboutCom(before: [Vec3, Vec3, Vec3] | null, com: Vec3) {
    const after = this.camAxesHome();
    if (!before || !after) return;
    const S = this.shipMatrix();
    const rc: Vec3 = [dot3(S[0], com), dot3(S[1], com), dot3(S[2], com)];
    let d: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) d = lin(d, 1, sub3(before[k]!, after[k]!), rc[k]!);
    if (Math.hypot(...d) < 1e-7) return;
    const nav = this.ourNav(cameraFrame(this.s));
    if (!nav) return;
    setHomePose(this.s, lin(nav.X, 1, d, 1 / M_METRES), after[2], after[1], nav.V);
    this.sync();
  }

  /** A scene's start: the camera on the flown craft at a pose (home), at its attach point. */
  flyFrom(p: Pose) {
    setMountVessel(fleet.active);
    this.settleMount();
    this.placeOnPose(p);
  }

  /** About the cabin: the camera's place (ship frame [m]; null: the pilot's seat), its velocity. */
  private cabinCam: { eye: Vec3 | null; vel: Vec3 } = { eye: null, vel: [0, 0, 0] };

  /**
   * The keys move the camera about the cabin (Z Q S D, A E on AZERTY; Shift faster): along the look,
   * eased (~0.12 s), 1.1 m/s; it glides along what it meets (a 15 cm sphere against the cabin's
   * triangles), within the cabin's box.
   */
  private moveCabin(dt: number, move: number[], fast: boolean) {
    const s = this.s;
    const C = this.cabinCam;
    const e0 = C.eye ?? mountPose("cockpit").eye;
    const S = shipToCamera({ eye: e0, aim: [e0[0], e0[1], e0[2] + 10] }, s.shipLookYaw, s.shipLookPitch).S;
    const v = fast ? 3 : 1.1;
    const want = lin(lin(S[2], move[0]! * v, S[0], move[1]! * v), 1, S[1], move[2]! * v);
    C.vel = lin(C.vel, 1, sub3(want, C.vel), 1 - Math.exp(-dt / 0.12));
    if (Math.hypot(...C.vel) < 1e-3) return (C.vel = [0, 0, 0]);
    this.activity = performance.now();
    let e: Vec3 = [...e0] as Vec3;
    let d = lin(C.vel, dt, C.vel, 0);
    const R = 0.15;
    const H = cockpitHull;
    for (let k = 0; k < 3 && H.bvh; k++) {
      const len = Math.hypot(...d);
      if (len < 1e-6) break;
      const dir = lin(d, 1 / len, d, 0);
      const hit = H.bvh.segment(e, lin(e, 1, dir, len + R));
      if (!hit) {
        e = lin(e, 1, d, 1);
        d = [0, 0, 0];
        break;
      }
      // (up to the wall, a sphere's radius off it; then along it)
      const go = Math.max(0, hit.t * (len + R) - R);
      e = lin(e, 1, dir, go);
      let n = hit.n;
      if (dot3(n, dir) > 0) n = lin(n, -1, n, 0);
      const rest = lin(d, 1, dir, -go);
      d = lin(rest, 1, n, -dot3(rest, n));
      C.vel = lin(C.vel, 1, n, -dot3(C.vel, n));
    }
    if (!H.bvh) e = lin(e, 1, d, 1);
    // (within the cabin's box)
    if (H.bvh) e = [0, 1, 2].map((i) => clamp(e[i]!, H.lo[i]! + R, H.hi[i]! - R)) as Vec3;
    C.eye = e;
  }

  /** Puts the camera on the flown craft at a pose (home): the camera's axes from the craft's, through the
   *  attach point. */
  private placeOnPose(p: Pose) {
    const S = this.shipMatrix();
    const cam = (k: number) => lin(lin(p.ax[0], S[k]![0], p.ax[1], S[k]![1]), 1, p.ax[2], S[k]![2]);
    setHomePose(this.s, p.X, unitV(cam(2)), unitV(cam(1)), p.V);
    this.s.motion = "geodesic";
    this.pilot.omega = [0, 0, 0];
    this.sync();
  }

  /**
   * Flies another craft: the one left coasts on its orbit (or stays docked: the assembly then coasts as
   * it, or is held by the station); the camera onto the new one, at the same kind of attach point. Why
   * not, or null.
   */
  switchVessel(id: VesselId): string | null {
    const s = this.s;
    if (id === fleet.active) return null;
    const cam = cameraFrame(s);
    const nav = this.ourNav(cam);
    if (!nav) return "The other craft are near the Earth — in our solar system";
    const t = nav.t;
    const to = fleet.pose(id, t);
    if (!to) return `${VESSELS[id].name}: not found`;
    const old = fleet.active;
    const me = this.activePoseNow();
    const group = fleet.assembly(old);
    // (the craft left: its assembly coasts as it — unless the new one or the station holds it)
    if (me && !group.includes(id) && !group.includes("iss")) fleet.setFree(old, me, t, this.coastCom());
    for (const v of fleet.assembly(id)) if (v !== "iss") delete fleet.free[v];
    fleet.active = id;
    s.vessel = id;
    setMountVessel(id);
    this.pilot.auto = "none";
    this.pilot.hold = "none";
    this.pilot.throttle = 0;
    this.pilot.omega = [0, 0, 0];
    // (its own way of flying the air: the Ranger as a plane, the Lander as a rocket)
    s.flightMode = id === "ranger" ? "plane" : "rocket";
    this.sfCmd = null;
    this.plan = { nodes: [], path: null, at: 0, note: "" };
    this.issGoal = null;
    this.ourMission = null;
    this.spent = 0;
    this.outside.dist = VESSELS[id].viewDist;
    this.settleMount();
    // (an assembly flown: the camera's velocity its centre of mass's; turning, it keeps turning — the
    // pilot's rates: per second of the pilot's clock, the other way round from the right-hand rule)
    this.placeOnPose(fleet.flownAssembly().length > 1 && to.Vc ? { ...to, V: to.Vc } : to);
    this.spin = null;
    if (to.w && Math.hypot(...to.w) > 0) this.pilot.omega = to.ax.map((a) => -dot3(to.w!, a) * s.timeSpeed) as Vec3;
    this.dockInfo = null;
    // (the target now flown, or docked to it: the body it orbits instead)
    if (fleet.flownAssembly().includes(s.target as VesselId)) this.selectTarget(nav.ref as Body);
    this.onPilotMessage?.(`Flying the ${VESSELS[id].name}${fleet.flownAssembly().length > 1 ? ` — docked: ${fleet.flownAssembly().filter((v) => v !== id).map((v) => VESSELS[v].name).join(", ")} with it` : ""}`);
    return null;
  }

  /**
   * The flown craft `distM` out on the axis of a free port of another craft (its own port facing it, at
   * rest against it) — a docking's start. Why not, or null.
   */
  placeNearPort(target: VesselId, distM: number, offset: Vec3 = [0, 0, 0]): string | null {
    const s = this.s;
    const nav = this.ourNav(cameraFrame(s));
    if (!nav) return "In our solar system only";
    const t = nav.t;
    const P = fleet.pose(target, t);
    const used = fleet.usedPorts(target);
    const k = VESSELS[target].ports.findIndex((_, i) => !used.has(i));
    if (!P || k < 0 || fleet.flownAssembly().includes(target)) return `The ${VESSELS[target].name}: no free port`;
    const host = VESSELS[target].ports[k]!;
    const guest = VESSELS[fleet.active].ports[0]!;
    // (docked there, then backed out along the port's axis)
    const { c, ax } = dockedFrame(guest, host, [0, 1, 0]);
    const cc = lin(lin(c, 1, host.axis, distM), 1, offset, 1);
    this.placeOnPose({ X: lin(P.X, 1, onAxesV(P.ax, cc), 1 / M_METRES), V: P.V, ax: ax.map((v) => onAxesV(P.ax, v)) as [Vec3, Vec3, Vec3] });
    return null;
  }

  /** The next (or previous) craft of the fleet. */
  cycleVessel(dir: 1 | -1) {
    const ids: VesselId[] = ["ranger", "lander", "endurance"];
    const i = ids.indexOf(fleet.active);
    this.s.vessel = ids[(i + dir + ids.length) % ids.length]!;
    return this.s.vessel;
  }

  // ------------------------------------------------------------------------------ docking
  /**
   * The free docking ports of the flown assembly (the flown craft's and those docked to it) and of
   * what it can dock to — the space station near it, the other craft within 5 km — now: the nearest
   * pair (or the one asked for: a target, a port of it). For it: the rings' offset along the target
   * port's axis and across it, the closing rate, the drift across, the angle between the two ports'
   * axes (docked, they face each other). Null: nothing within 5 km, or not on our side.
   */
  private dockGeometry(only?: { target: VesselId | "iss"; port?: number }): DockInfo | null {
    const s = this.s;
    const cam = cameraFrame(s);
    const nav = this.ourNav(cam);
    const me = nav ? this.activePoseNow() : null;
    if (!nav || !me) return null;
    const t = nav.t;
    const m = 1 / M_METRES;
    const C = 299792458;
    // the flown assembly's free ports
    const frames = fleet.posesFrom(fleet.active, me, t);
    if (frames.has("iss")) return null;
    const own: { v: VesselId; k: number; c: Vec3; a: Vec3 }[] = [];
    for (const [v, P] of frames) {
      if (v === "iss") continue;
      const used = fleet.usedPorts(v);
      VESSELS[v].ports.forEach((p, k) => {
        if (!used.has(k)) own.push({ v, k, c: lin(P.X, 1, onAxesV(P.ax, p.centre), m), a: onAxesV(P.ax, p.axis) });
      });
    }
    if (!own.length) return null;
    // what it can dock to: its pose, its turn (the station's: once an orbit), its free ports
    const targets: { id: VesselId | "iss"; title: string; P: Pose; om: Vec3; ports: { k: number; name: string; c: Vec3; a: Vec3 }[] }[] = [];
    if (s.iss && station.ports.length && (!only || only.target === "iss")) {
      const st = issTrack.state(t, nav.X);
      if (st && issTrack.near) {
        const A = issAxes(st.X, st.V, t);
        const E = ourState("earth", t);
        const r = sub3(st.X, E.pos), v = sub3(st.V, E.vel);
        const used = fleet.usedPorts("iss");
        targets.push({
          id: "iss", title: "ISS", P: { X: st.X, V: st.V, ax: A }, om: lin(cross(r, v), 1 / dot3(r, r), r, 0),
          ports: station.ports.flatMap((p, k) => (used.has(k) ? [] : [{ k, name: p.name, c: lin(st.X, 1, onAxesV(A, p.centre), m), a: onAxesV(A, p.axis) }])),
        });
      }
    }
    for (const id of VESSEL_IDS) {
      if (frames.has(id) || (only && only.target !== id)) continue;
      const P = fleet.pose(id, t);
      if (!P || Math.hypot(...sub3(P.X, nav.X)) * M_METRES > 5200) continue;
      const used = fleet.usedPorts(id);
      targets.push({
        id, title: VESSELS[id].name, P, om: [0, 0, 0],
        ports: VESSELS[id].ports.flatMap((p, k) => (used.has(k) ? [] : [{ k, name: p.name, c: lin(P.X, 1, onAxesV(P.ax, p.centre), m), a: onAxesV(P.ax, p.axis) }])),
      });
    }
    let best: DockInfo | null = null;
    for (const T of targets) {
      for (const tp of T.ports) {
        if (only?.port !== undefined && only.port !== tp.k) continue;
        for (const op of own) {
          const d = lin(sub3(op.c, tp.c), M_METRES, op.c, 0);
          const along = dot3(d, tp.a);
          const lateral = Math.hypot(...lin(d, 1, tp.a, -along));
          const range = Math.hypot(...d);
          if (best && range >= best.range) continue;
          // (relative to the target's point where the ring is: its turn, if it turns — co-orbiting is at rest)
          const vp = lin(T.P.V, 1, cross(T.om, sub3(op.c, T.P.X)), 1);
          const vrel = lin(sub3(nav.V, vp), C, nav.V, 0);
          const closing = -dot3(vrel, tp.a);
          const angle = (Math.acos(Math.max(-1, Math.min(1, -dot3(op.a, tp.a)))) * 180) / Math.PI;
          best = {
            target: T.id, title: T.title, port: tp.k, name: tp.name, own: op.v, ownPort: op.k, range, along, lateral, closing,
            lateralRate: Math.hypot(...lin(vrel, 1, tp.a, -dot3(vrel, tp.a))), angle, docked: false, ring: op.c, ownAxis: op.a, c: tp.c, a: tp.a,
            X: me.X, sh: me.ax, tgt: { X: T.P.X, V: T.P.V }, A: T.P.ax, om: T.om, vrel,
          };
        }
      }
    }
    return best;
  }

  /** Where the flown craft is docked (its first link): the port it holds and the flown craft's place — the
   *  station's camera's view while docked. */
  private dockedView: { c: Vec3; a: Vec3; X: Vec3; sh: [Vec3, Vec3, Vec3] } | null = null;

  /**
   * The target's docking camera, in the ship's frame: on the nearest port's axis (docked: the one held),
   * 40 cm out from its ring, looking out along it (the ship coming in, centred when on the axis); null
   * away from any (or before the first step's geometry).
   */
  private stationCam(): MountPose | null {
    // (the last step's geometry: the ship's axes come from the camera through this very mount)
    const g = this.dockInfo ?? this.dockedView;
    if (!g) return null;
    const m = 1 / M_METRES;
    const toShip = (P: Vec3): Vec3 => {
      const d = lin(sub3(P, g.X), M_METRES, P, 0);
      return [dot3(d, g.sh[0]), dot3(d, g.sh[1]), dot3(d, g.sh[2])];
    };
    const eye = lin(g.c, 1, g.a, 0.4 * m);
    return { eye: toShip(eye), aim: toShip(lin(eye, 1, g.a, 20 * m)) };
  }

  /** The ship for contacts near the station or another craft: its centre, velocity and axes (home), its time. */
  private contactPose() {
    if (this.docked || this.undocking || !vesselHulls[fleet.active].bvh) return null;
    // (a ring on a port's axis, facing it, within a metre and a half: the docking systems meet — the hull's
    // own collar touches the adapter's 40 cm out, before the capture's 30; the capture or the port's
    // bounce (dockCheck) answers)
    const g = this.dockInfo;
    if (g && g.along < 1.5 && g.along > -0.6 && g.lateral < 0.3 && g.angle < 10) return null;
    const s = this.s;
    const cam = cameraFrame(s);
    const nav = this.ourNav(cam);
    if (!nav) return null;
    const w = mouth(s).w;
    const ax = this.shipAxesLocal({ right: cam.right, up: cam.up, fwd: cam.fwd }).map((a) => unitV(repToHomeVec(w, cam.ell, cam.n, a))) as [Vec3, Vec3, Vec3];
    return { t: nav.t, X: nav.X, V: nav.V, ax };
  }

  private lastContactMsg = 0;

  /**
   * Contact over the step just flown, with the space station and with the craft not docked to the flown
   * one: every hull point's path (in each obstacle part's own frame — the station's arrays turn) against
   * the part, and every vertex of the obstacle near the ship along its path relative to the hull, against
   * the hull. At the first crossing the ship is set back to it (2 cm clear), its velocity against the
   * surface turned back (a third of it) and its slide damped; its spin stopped. A craft hit takes its
   * share of the blow (their masses).
   */
  private stationContact(p0: NonNullable<ReturnType<CameraController["contactPose"]>>) {
    const p1 = this.contactPose();
    if (!p1) return;
    const hull = vesselHulls[fleet.active];
    const R = hull.radius;
    // the obstacles: each with its parts (a hierarchy in its rest frame, the part's frame → the
    // obstacle's at t0 and t1), its frame (home axes, centre) at t0 and t1, its velocity field at t1
    interface Obstacle { id: VesselId | "iss"; parts: { bvh: TriBVH; M0: M34; M1: M34 }[]; A0: [Vec3, Vec3, Vec3]; A1: [Vec3, Vec3, Vec3]; X0: Vec3; X1: Vec3; V1: Vec3; om: Vec3 }
    const obstacles: Obstacle[] = [];
    if (issTrack.near && stationHulls.length && station.joints.length) {
      const i0 = issTrack.state(p0.t, p0.X), i1 = issTrack.state(p1.t, p1.X);
      if (i0 && i1 && Math.hypot(...sub3(p1.X, i1.X)) * M_METRES < 75 + R) {
        const T0 = partTransforms(station.joints, stationAngles(p0.t, i0.X, i0.V)), T1 = partTransforms(station.joints, stationAngles(p1.t, i1.X, i1.V));
        const E = ourState("earth", p1.t);
        const r = sub3(i1.X, E.pos), v = sub3(i1.V, E.vel);
        obstacles.push({
          id: "iss", parts: stationHulls.flatMap((bvh, k) => (bvh ? [{ bvh, M0: T0[k]!, M1: T1[k]! }] : [])),
          A0: issAxes(i0.X, i0.V, p0.t), A1: issAxes(i1.X, i1.V, p1.t), X0: i0.X, X1: i1.X, V1: i1.V, om: lin(cross(r, v), 1 / dot3(r, r), r, 0),
        });
      }
    }
    const I34: M34 = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]] as unknown as M34;
    for (const id of VESSEL_IDS) {
      if (fleet.flownAssembly().includes(id)) continue;
      const h = vesselHulls[id];
      if (!h.bvh) continue;
      const q0 = fleet.pose(id, p0.t), q1 = fleet.pose(id, p1.t);
      if (!q0 || !q1 || Math.hypot(...sub3(p1.X, q1.X)) * M_METRES > h.radius + R + 50) continue;
      obstacles.push({ id, parts: [{ bvh: h.bvh, M0: I34, M1: I34 }], A0: q0.ax, A1: q1.ax, X0: q0.X, X1: q1.X, V1: q1.V, om: [0, 0, 0] });
    }
    if (!obstacles.length) return;
    let best: { t: number; n: Vec3; o: Obstacle } | null = null;
    for (const o of obstacles) {
      const toO = (A: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [dot3(v, A[0]), dot3(v, A[1]), dot3(v, A[2])];
      // the ship in the obstacle's frame [m]: its centre, its axes (columns)
      const c0 = toO(o.A0, lin(sub3(p0.X, o.X0), M_METRES, p0.X, 0)), c1 = toO(o.A1, lin(sub3(p1.X, o.X1), M_METRES, p1.X, 0));
      const R0 = p0.ax.map((a) => toO(o.A0, a)) as [Vec3, Vec3, Vec3], R1 = p1.ax.map((a) => toO(o.A1, a)) as [Vec3, Vec3, Vec3];
      const place = (c: Vec3, Rm: [Vec3, Vec3, Vec3], q: Vec3): Vec3 => lin(lin(c, 1, Rm[0], q[0]), 1, lin(Rm[1], q[1], Rm[2], q[2]), 1);
      const local = (c: Vec3, Rm: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => {
        const d = sub3(v, c);
        return [dot3(d, Rm[0]), dot3(d, Rm[1]), dot3(d, Rm[2])];
      };
      const sweep = Math.hypot(...sub3(c1, c0));
      for (const { bvh, M0, M1 } of o.parts) {
        // (the part's box against the ship's swept sphere, in its rest frame)
        const [lo, hi] = bvh.bounds();
        const cm = m34unapply(M1, lin(c0, 0.5, c1, 0.5));
        const rr = R + sweep;
        let away = false;
        for (let a = 0; a < 3; a++) if (cm[a]! + rr < lo[a]! || cm[a]! - rr > hi[a]!) away = true;
        if (away) continue;
        // the hull's points along their paths, against the part
        for (const q of hull.points) {
          const a = m34unapply(M0, place(c0, R0, q)), b = m34unapply(M1, place(c1, R1, q));
          const h = bvh.segment(a, b);
          if (h && (!best || h.t < best.t)) {
            const n = m34apply(M1, h.n, 0);
            const mv = sub3(b, a);
            best = { t: h.t, n: dot3(m34apply(M1, mv, 0), n) > 0 ? lin(n, -1, n, 0) : n, o };
          }
        }
        // the part's vertices near the ship, along their paths relative to the hull, against it
        for (const vi of bvh.verticesNear(cm, rr)) {
          const pv: Vec3 = [bvh.pos[3 * vi]!, bvh.pos[3 * vi + 1]!, bvh.pos[3 * vi + 2]!];
          const a = local(c0, R0, m34apply(M0, pv)), b = local(c1, R1, m34apply(M1, pv));
          // (outside the hull's box all along: nothing to meet)
          const L = hull.lo, H = hull.hi;
          let out = false;
          for (let q = 0; q < 3; q++) if (Math.max(a[q]!, b[q]!) < L[q]! - 0.05 || Math.min(a[q]!, b[q]!) > H[q]! + 0.05) out = true;
          if (out) continue;
          const h = hull.bvh!.segment(a, b);
          if (h && (!best || h.t < best.t)) {
            // (the ship pushed along the vertex's motion relative to it)
            const mv = lin(lin(R1[0], b[0] - a[0], R1[1], b[1] - a[1]), 1, R1[2], b[2] - a[2]);
            let n = lin(lin(R1[0], h.n[0], R1[1], h.n[1]), 1, R1[2], h.n[2]);
            if (dot3(n, mv) < 0) n = lin(n, -1, n, 0);
            best = { t: h.t, n, o };
          }
        }
      }
      // (back to the ship's frame of reference: c0, c1 for the set-back)
      if (best && best.o === o) (best as { c0?: Vec3; c1?: Vec3 }).c0 = c0, ((best as { c1?: Vec3 }).c1 = c1);
    }
    if (!best) return;
    const hit = best as { t: number; n: Vec3; o: Obstacle; c0: Vec3; c1: Vec3 };
    const o = hit.o;
    const s = this.s;
    const cam = cameraFrame(s);
    const w = mouth(s).w;
    const toHome = (v: Vec3): Vec3 => lin(lin(o.A1[0], v[0], o.A1[1], v[1]), 1, o.A1[2], v[2]);
    // set back along the step to the contact, 2 cm clear of the surface
    const back = lin(lin(sub3(hit.c1, hit.c0), -(1 - hit.t), hit.c0, 0), 1, hit.n, 0.02);
    const X = lin(p1.X, 1, toHome(back), 1 / M_METRES);
    // the velocity against the obstacle's surface where it is (the station turning: ω × r)
    const Vo = lin(o.V1, 1, cross(o.om, sub3(X, o.X1)), 1);
    const N = toHome(hit.n);
    const vrel = sub3(p1.V, Vo);
    const vn = dot3(vrel, N);
    let V = p1.V;
    if (vn < 0) {
      // (a craft coasting takes its share: the blow split by the masses; the station, docked craft: none)
      const mMe = fleet.massProps().mass;
      const free = o.id !== "iss" && !fleet.assembly(o.id).includes("iss");
      const mO = free ? fleet.assembly(o.id).reduce((a, v) => a + (v === "iss" ? 0 : VESSELS[v as VesselId].mass), 0) : Infinity;
      const kMe = Number.isFinite(mO) ? mO / (mMe + mO) : 1;
      const vt = lin(vrel, 1, N, -vn);
      // (the closing speed turned back by a third, the slide damped — relative to the obstacle)
      const dvRel = lin(lin(N, -1.3 * vn, vt, -0.3), 1, [0, 0, 0], 0);
      V = lin(p1.V, 1, dvRel, kMe);
      if (free) {
        const Q = fleet.pose(o.id as VesselId, p1.t);
        const anchor = fleet.assembly(o.id).find((v) => v !== "iss" && fleet.free[v as VesselId]) as VesselId | undefined;
        if (Q && anchor) {
          const QA = fleet.pose(anchor, p1.t)!;
          fleet.setFree(anchor, { X: QA.X, V: lin(QA.Vc ?? QA.V, 1, dvRel, -(1 - kMe)), ax: QA.ax, w: QA.w }, p1.t, fleet.free[anchor]?.com);
        }
      }
    }
    setHomePose(s, X, unitV(repToHomeVec(w, cam.ell, cam.n, cam.fwd)), unitV(repToHomeVec(w, cam.ell, cam.n, cam.up)), V);
    this.pilot.omega = [0, 0, 0];
    this.sync();
    const now = performance.now();
    if (now - this.lastContactMsg > 1500) {
      this.lastContactMsg = now;
      this.onPilotMessage?.(`Contact with the ${o.id === "iss" ? "ISS" : VESSELS[o.id].name} · ${(Math.abs(vn) * 299792458).toFixed(2)} m/s`);
    }
  }

  /** Docked to the station (directly, or through craft docked to it): the station carries the flown
   *  craft; a push of the engine or the thrusters undocks. */
  get docked() {
    return this.s.ship && fleet.heldByStation();
  }

  /**
   * After each step: the docking aid's figures, and the capture — the rings within 30 cm, slower than
   * 0.5 m/s, the ports' axes facing within 10°: a link (fleet.ts) — the flown assembly and what it docks
   * to one rigid assembly, their momenta shared; on a port too fast or off its axis, a bounce.
   */
  private dockCheck() {
    const D = this.dockAuto;
    const g = this.dockGeometry(this.pilot.auto === "dock" && D ? { target: D.target, port: D.port } : undefined);
    this.dockInfo = g && g.range < 5000 ? g : null;
    this.dockedView = this.linkView();
    if (!g || this.docked) return;
    // (just undocked: no capture until the rings are a metre clear)
    if (this.undocking) {
      if (g.range < 1) return;
      this.undocking = false;
    }
    const speed = Math.hypot(...g.vrel);
    // (closing in, or at rest against it: not on the rebound)
    const capture = g.along < 0.3 && g.along > -0.6 && g.lateral < 0.3 && g.angle < 10 && speed < 0.5 && g.closing > -0.02;
    const s = this.s;
    const cam = cameraFrame(s);
    const nav = this.ourNav(cam);
    if (!nav) return;
    const w = mouth(s).w;
    if (!capture && g.along < 0.05 && g.along > -2 && g.lateral < 1.5) {
      // against the port too fast, or off its axis: it bounces (a third of its closing speed back), the
      // ring set back on the port's face — no passing through
      const va = dot3(g.vrel, g.a); // [m/s], < 0: towards the target
      if (va < 0) {
        const V = lin(nav.V, 1, g.a, (-1.3 * va) / 299792458);
        const X = lin(nav.X, 1, g.a, (0.05 - g.along) / M_METRES);
        setHomePose(s, X, unitV(repToHomeVec(w, cam.ell, cam.n, cam.fwd)), unitV(repToHomeVec(w, cam.ell, cam.n, cam.up)), V);
        this.sync();
        const why = speed >= 0.5 ? `${speed.toFixed(2)} m/s — 0.5 at most` : g.lateral >= 0.3 ? `${g.lateral.toFixed(2)} m off its axis — 0.3 at most` : `the ports ${g.angle.toFixed(0)}° apart — 10 at most`;
        this.onPilotMessage?.(`Bounced off the ${g.title}'s port · ${why}`);
      }
      return;
    }
    if (!capture) return;
    // captured: the rings together, the axes facing, the roll kept — the craft whose port it is held on
    // the target's (its frame in the target's)
    const t = nav.t;
    const host = g.target === "iss" ? station.ports[g.port]! : VESSELS[g.target].ports[g.port]!;
    const guest = VESSELS[g.own].ports[g.ownPort]!;
    const ownPose = fleet.posesFrom(fleet.active, this.activePoseNow()!, t).get(g.own)!;
    const toT = (v: Vec3): Vec3 => [dot3(v, g.A[0]), dot3(v, g.A[1]), dot3(v, g.A[2])];
    const { c, ax } = dockedFrame(guest, host, toT(ownPose.ax[1]));
    // (the momenta shared: the assembly's velocity, the target coasting — the station holds what docks to it)
    const mMe = fleet.massProps().mass;
    const tgtGroup = g.target === "iss" ? [] : fleet.assembly(g.target);
    const held = g.target === "iss" || tgtGroup.includes("iss");
    const mT = tgtGroup.reduce((a, v) => a + (v === "iss" ? 0 : VESSELS[v as VesselId].mass), 0);
    const tgtPose = g.target === "iss" ? null : fleet.pose(g.target, t);
    fleet.links.push({ a: g.target, b: g.own, pa: g.port, pb: g.ownPort, c, ax });
    for (const v of fleet.assembly(fleet.active)) if (v !== "iss") delete fleet.free[v as VesselId];
    if (!held && tgtPose) {
      // the flown craft where the link puts it, from the target (it does not jump)
      const V = lin(nav.V, mMe / (mMe + mT), tgtPose.V, mT / (mMe + mT));
      const P = fleet.posesFrom(g.target, { X: tgtPose.X, V, ax: tgtPose.ax }, t).get(fleet.active)!;
      this.placeOnPose({ X: P.X, V, ax: P.ax });
    }
    this.pilot.auto = "none";
    this.pilot.throttle = 0;
    this.pilot.omega = [0, 0, 0];
    this.dockInfo = null;
    // (the target now part of the assembly: the body it orbits instead)
    if (fleet.flownAssembly().includes(s.target as VesselId)) this.selectTarget(nav.ref as Body);
    this.onPilotMessage?.(`Docked to the ${g.title} · ${g.name}${g.own !== fleet.active ? ` (the ${VESSELS[g.own].name}'s ${guest.name})` : ""} · ${speed.toFixed(2)} m/s`);
  }

  /** The port the flown craft holds (its first link), and its place: the station's camera's view. */
  private linkView(): { c: Vec3; a: Vec3; X: Vec3; sh: [Vec3, Vec3, Vec3] } | null {
    const me = fleet.active;
    const l = fleet.links.find((q) => q.a === me || q.b === me);
    if (!l) return null;
    const P = this.activePoseNow();
    if (!P) return null;
    const t = P.t;
    const other = l.a === me ? l.b : l.a;
    const k = l.a === me ? l.pb : l.pa;
    let Q: { X: Vec3; ax: [Vec3, Vec3, Vec3] } | null = null;
    if (other === "iss") {
      const st = issTrack.peek(t);
      if (st) Q = { X: st.X, ax: issAxes(st.X, st.V, t) };
    } else Q = (this.docked ? fleet.pose(other, t, true) : fleet.posesFrom(me, P, t).get(other)) ?? null;
    if (!Q) return null;
    const port = other === "iss" ? station.ports[k] : VESSELS[other as VesselId].ports[k];
    if (!port) return null;
    return { c: lin(Q.X, 1, onAxesV(Q.ax as [Vec3, Vec3, Vec3], port.centre), 1 / M_METRES), a: onAxesV(Q.ax as [Vec3, Vec3, Vec3], port.axis), X: P.X, sh: P.ax };
  }

  /** Held by the station: the flown craft where the station carries it (its centre, axes, velocity), for this frame. */
  private flyDocked(dt: number) {
    const s = this.s;
    const t0 = this.nowTime();
    const simDt = s.animate ? s.timeSpeed * dt : 0;
    const t1 = t0 + simDt;
    const cam = cameraFrame(s);
    const w = mouth(s).w;
    const iss = issTrack.state(t1, homeOf(w, cam.ell, cam.n));
    const P = iss ? fleet.pose(fleet.active, t1, true) : null;
    if (!P) return this.undock();
    const S = this.shipMatrix();
    const camAx = (k: number) => lin(lin(P.ax[0], S[k]![0], P.ax[1], S[k]![1]), 1, P.ax[2], S[k]![2]);
    setHomePose(s, P.X, unitV(camAx(2)), unitV(camAx(1)), P.V);
    s.motion = "geodesic";
    this.pilot.omega = [0, 0, 0];
    this.properTime += simDt;
    this.shipTime = t1;
    this.sync();
    this.dockCheck();
  }

  /**
   * Lets the flown craft go of what it is docked to (its own links; the springs push it 5 cm/s away
   * from the first port): what is left coasts (or stays on the station), as its own assembly.
   */
  undock() {
    const me = fleet.active;
    const mine = fleet.links.filter((l) => l.a === me || l.b === me);
    if (!mine.length) return;
    const s = this.s;
    const cam = cameraFrame(s);
    const nav = this.ourNav(cam);
    const P = this.activePoseNow();
    if (!nav || !P) {
      fleet.links = fleet.links.filter((l) => !mine.includes(l));
      return;
    }
    const t = nav.t;
    const held = this.docked;
    // every craft's place before (the station carrying them, or the flown one)
    const before = new Map<VesselId, Pose>();
    for (const v of VESSEL_IDS) {
      const q = held ? fleet.pose(v, t, true) : fleet.pose(v, t);
      if (q) before.set(v, q);
    }
    // the push: away from the first port held (the flown craft's own port's axis, reversed)
    const l0 = mine[0]!;
    const myPort = VESSELS[me].ports[l0.a === me ? l0.pa : l0.pb]!;
    const out = onAxesV(P.ax, myPort.axis);
    fleet.links = fleet.links.filter((l) => !mine.includes(l));
    this.undocking = true;
    // (the pieces left: each assembly without the flown craft nor the station coasts as one of them)
    for (const v of VESSEL_IDS) {
      if (v === me) continue;
      const group = fleet.assembly(v);
      if (group.includes(me) || group.includes("iss") || group.some((q) => q !== "iss" && fleet.free[q as VesselId])) continue;
      const q = before.get(v);
      if (!q) continue;
      // (turning with the assembly: about the pieces' own centre of mass, its velocity the rigid one there)
      const com = fleet.assembly(v).length > 1 ? fleet.massProps(v).com : ([0, 0, 0] as Vec3);
      const C = lin(q.X, 1, onAxesV(q.ax, com), 1 / M_METRES);
      const Vc = q.w ? lin(q.V, 1, cross(q.w, sub3(C, q.X)), 1) : q.V;
      fleet.setFree(v, { X: q.X, V: Vc, ax: q.ax, w: q.w }, t, com);
    }
    const V = lin(P.V, 1, out, -0.05 / 299792458);
    setHomePose(s, P.X, unitV(repToHomeVec(mouth(s).w, cam.ell, cam.n, cam.fwd)), unitV(repToHomeVec(mouth(s).w, cam.ell, cam.n, cam.up)), V);
    this.sync();
    if (this.pilot.auto === "dock") this.pilot.auto = "none";
    const names = mine.map((l) => (l.a === me ? l.b : l.a)).map((v) => (v === "iss" ? "the ISS" : `the ${VESSELS[v as VesselId].name}`));
    this.onPilotMessage?.(`Undocked from ${names.join(" and ")}`);
  }

  /**
   * The docking autopilot (B, or the end of a rendezvous): what it docks to and its port, what it is
   * doing (for the HUD), the attitude it holds (local), the pilot's warp and the one it set, whether the
   * way to the port's axis is clear (and when that was last looked at).
   */
  dockAuto: { target: VesselId | "iss"; port: number; phase: string; att: { nose: Vec3; up: Vec3 } | null; warp: number | null; set: number; corridor: boolean; final: boolean; blocked: boolean; checked: number } | null = null;

  /**
   * The last of a rendezvous, flown on the thrusters alone (the flown assembly's free port facing the
   * target's — the main engine would push it off the axis):
   *  - off the axis: to a point on it (30 – 200 m out); if the target stands in the way (lines a hull's
   *    width apart cast against it), round it first — on a sphere about its centre, stepping towards the
   *    axis;
   *  - in the approach corridor (a cone about the axis): closing at 0.08 m/s + 1.2 % of the distance
   *    (3 m/s at most — 0.1 m/s at the contact), the offset across the axis taken out as it closes;
   *  - 10 m out: a hold until the ring is within 10 cm of the axis, the ports within 2° and the drift
   *    still; then the final approach, to the capture (dockCheck) — docked, it lets go.
   * The relative motion is the target's frame's (the station's turns: its point where the ring is), the
   * tide between them (and the station's turn's pull) fed forward. The warp: ×10 beyond 150 m, ×5
   * beyond 40, ×2 beyond 4, real time for the last 4 m (with auto warp; otherwise the pilot's, no higher).
   */
  private dockWant(nav: NonNullable<ReturnType<CameraController["ourNav"]>>, say: (t: string) => null, out: (v: Vec3, ff?: Vec3) => { beta: Vec3; ff: Vec3 }): { beta: Vec3; ff: Vec3 } | null {
    const s = this.s;
    if (!this.dockAuto) {
      // (the target's port if it is in reach, else the nearest)
      const want = s.target === "iss" || isCraft(s.target) ? (s.target as VesselId | "iss") : null;
      const g0 = (want ? this.dockGeometry({ target: want }) : null) ?? this.dockGeometry();
      if (!g0 || g0.range > 3000) return say("Docking: within 3 km of a free port — the ISS's, a craft's (a PLAN with it as the target brings the ship 200 m off it)");
      this.dockAuto = { target: g0.target, port: g0.port, phase: "", att: null, warp: s.timeSpeed, set: NaN, corridor: false, final: false, blocked: false, checked: -1e9 };
      this.onPilotMessage?.(`Docking autopilot · the ${g0.title}'s ${g0.name} · ${g0.range < 1000 ? `${g0.range.toFixed(0)} m` : `${(g0.range / 1000).toFixed(2)} km`}`);
    }
    const D = this.dockAuto;
    const g = this.dockGeometry({ target: D.target, port: D.port });
    if (!g) return say(`Docking: the ${D.target === "iss" ? "ISS" : VESSELS[D.target].name} is out of reach`);
    const C = 299792458;
    const a = g.a, A = g.A;
    // the attitude: the own port's axis against the target's, the top to the target's up (the station's
    // zenith; a craft's own top) — a rotation from two pairs of directions
    const sh = g.sh;
    const toMe = (v: Vec3): Vec3 => [dot3(v, sh[0]), dot3(v, sh[1]), dot3(v, sh[2])];
    const pa = unitV(toMe(g.ownAxis));
    let ua: Vec3 = Math.abs(pa[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    ua = unitV(lin(ua, 1, pa, -dot3(ua, pa)));
    let ub0 = D.target === "iss" ? lin(A[2], -1, A[2], 0) : A[1];
    if (Math.abs(dot3(ub0, a)) > 0.7) ub0 = D.target === "iss" ? A[0] : A[2];
    const pb = lin(a, -1, a, 0);
    const ub = unitV(lin(ub0, 1, pb, -dot3(ub0, pb)));
    const wa = cross(pa, ua), wb = cross(pb, ub);
    const R = (v: Vec3): Vec3 => {
      const x = dot3(v, pa), y = dot3(v, ua), z = dot3(v, wa);
      return lin(lin(pb, x, ub, y), 1, wb, z);
    };
    const loc = (v: Vec3) => unitV(nav.toRep(v));
    D.att = { nose: loc(R([0, 0, 1])), up: loc(R([0, 1, 0])) };
    // the ring against the port [m]; the target's point there, its motion and pull
    const along = g.along, lat = g.lateral;
    const d = lin(sub3(g.ring, g.c), M_METRES, a, 0);
    const latv = lin(d, 1, a, -along);
    const om = g.om;
    const rho = sub3(g.ring, g.tgt.X);
    const Vp = lin(g.tgt.V, 1, cross(om, rho), 1);
    const ff = lin(sub3(gravityHome(g.tgt.X, nav.t).acc, gravityHome(nav.X, nav.t).acc), 1, cross(om, cross(om, rho)), 1);
    // the warp: by the range (the pilot's own, if lower, without auto warp)
    const real = 1 / 492.5490947;
    const cap = (g.range > 150 ? 10 : g.range > 40 ? 5 : g.range > 4 ? 2 : 1) * real;
    if (s.timeSpeed !== D.set && Number.isFinite(D.set)) D.warp = s.timeSpeed;
    s.timeSpeed = D.set = s.autoWarp ? cap : Math.min(D.warp ?? cap, cap);
    // (the lateral gain within what the velocity loop follows at this warp: damped)
    const Ts = 1.2 * s.timeSpeed * 492.5490947;
    const kLat = Math.min(0.08, 0.3 / Math.max(Ts, 1e-3));
    const cone = 1 + 0.15 * Math.max(along, 0);
    D.corridor = along > -0.5 && lat < (D.corridor ? 1.5 : 1) * cone;
    let want: Vec3; // relative to the target's point [m/s]
    if (D.corridor) {
      let vc = Math.min(3, 0.08 + 0.012 * Math.max(along, 0));
      // 10 m out: held until on the axis, the ports facing, the drift still (and kept so)
      const aligned = D.final ? lat < 0.2 && g.angle < 5 : lat < 0.1 && g.angle < 2 && g.lateralRate < 0.04;
      D.final = along < 12 && aligned;
      if (along < 12 && !aligned) vc = Math.max(Math.min(vc, 0.05 * (along - 10)), -0.1);
      D.phase = along >= 12 ? "APPROACH" : D.final ? "FINAL" : "HOLD 10 m";
      let vl = lin(latv, -kLat, latv, 0);
      const vll = Math.hypot(...vl);
      if (vll > 0.4) vl = lin(vl, 0.4 / vll, vl, 0);
      want = lin(a, -vc, vl, 1);
    } else {
      D.final = false;
      // to the axis: a point on it, round the target if it stands in the way
      const S = Math.min(Math.max(along, 30), 200);
      const G = lin(g.c, 1, a, S / M_METRES);
      const now = performance.now();
      if (now - D.checked > 250) {
        D.checked = now;
        D.blocked = this.targetBlocks(D.target, g.ring, G, nav.t, g);
      }
      let P = G;
      if (D.blocked) {
        const Rm = D.target === "iss" ? 130 : vesselHulls[D.target].radius + 60;
        const Rs = Rm / M_METRES;
        const u = unitV(sub3(g.ring, g.tgt.X)), gd = unitV(sub3(lin(g.c, 1, a, Rm / M_METRES), g.tgt.X));
        const th = Math.acos(Math.max(-1, Math.min(1, dot3(u, gd))));
        const step = Math.min(th, (30 * Math.PI) / 180);
        // (u turned towards gd by the step, in their plane)
        const w0 = lin(gd, 1, u, -dot3(gd, u));
        const wl = Math.hypot(...w0);
        const w = wl > 1e-9 ? lin(u, Math.cos(step), w0, Math.sin(step) / wl) : u;
        P = lin(g.tgt.X, 1, w, Rs);
      }
      const to = lin(sub3(P, g.ring), M_METRES, P, 0);
      const dist = Math.hypot(...to);
      const sp = Math.min(3, Math.sqrt(2 * 0.03 * dist), 0.1 * dist);
      want = dist > 1e-6 ? lin(to, sp / dist, to, 0) : [0, 0, 0];
      D.phase = D.blocked ? (D.target === "iss" ? "AROUND THE STATION" : `AROUND THE ${VESSELS[D.target].name.toUpperCase()}`) : "TO THE AXIS";
    }
    return out(lin(Vp, 1, want, 1 / C), ff);
  }

  /**
   * Whether the ship going straight from p to q (its ring; home frame) would meet what it docks to:
   * five lines — its own and four a hull's radius about it — cast against the station's parts as they
   * are now, or the craft's hull.
   */
  private targetBlocks(target: VesselId | "iss", p: Vec3, q: Vec3, t: number, g: DockInfo): boolean {
    const A = g.A;
    const toT = (P: Vec3): Vec3 => {
      const d = lin(sub3(P, g.tgt.X), M_METRES, P, 0);
      return [dot3(d, A[0]), dot3(d, A[1]), dot3(d, A[2])];
    };
    const a = toT(p), b = toT(q);
    const dir = unitV(sub3(b, a));
    const e1 = unitV(cross(dir, Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const e2 = cross(dir, e1);
    const R = Math.max(vesselHulls[fleet.active].radius, 5) + 3;
    const offs: Vec3[] = [[0, 0, 0], lin(e1, R, e1, 0), lin(e1, -R, e1, 0), lin(e2, R, e2, 0), lin(e2, -R, e2, 0)];
    if (target !== "iss") {
      const bvh = vesselHulls[target].bvh;
      return !!bvh && offs.some((o) => bvh.segment(lin(a, 1, o, 1), lin(b, 1, o, 1)) !== null);
    }
    if (!stationHulls.length || !station.joints.length) return false;
    const st = issTrack.peek(t);
    if (!st) return false;
    const T = partTransforms(station.joints, stationAngles(t, st.X, st.V));
    return stationHulls.some((bvh, k) => bvh && offs.some((o) => bvh.segment(m34unapply(T[k]!, lin(a, 1, o, 1)), m34unapply(T[k]!, lin(b, 1, o, 1))) !== null));
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
    // our universe: a turn of the tightest orbit here in no less than ~2 s
    const nav = this.ourNav(cam);
    if (nav) {
      const g = gravityHome(nav.X, nav.t);
      // (a stable orbit rides Kepler's rails at any warp; else a turn of the tightest orbit in ~2 s)
      if (!(this.pilot.throttle === 0 && this.pilot.accel === 0 && this.stableOrbit(nav.X, nav.V, nav.t))) cap(Math.max(0.6 * 2 * Math.PI * g.tDyn, 1e-3), BODY_NAMES[nav.ref as Body] ?? nav.ref);
      // near the ground (not on it): a frame covers no more than a fifth of the height left, the last
      // metres at the pace of the last 20
      if (!this.ourLanded && (solidBody(nav.ref) || ourAir(nav.ref, 0) > 0) && nav.ref !== "sun") {
        const hM = Math.max(gearHeight(nav.ref, nav.X, nav.t), 20);
        const sp = groundSpeeds(nav.ref, nav.X, nav.V, nav.t);
        const vv = Math.abs(sp.vv) / 299792458 + 1e-12;
        cap(Math.max((6 * hM) / M_METRES / vv, 1e-6), "ground");
        // (the landing autopilot coming down: its ~1.2 s response a small part of the time to the
        // ground — not below real time)
        if (this.pilot.auto === "land" && sp.vv < 0) cap(Math.max((0.04 * hM) / M_METRES / vv, 1 / (4.925490947e-6 * s.massSolar)), "ground");
      }
    }
    // (the space station near: it falls by the game's own steps beside the ship — no Kepler rails, a
    // frame's step short against its orbit: ×100)
    if (issTrack.near) cap(100 / 492.5490947, "the station");
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
   * Our universe: plans a circular orbit around the reference body ("orbit", at altKm), a transfer
   * to the target ("target": then orbit, fly by, or a free return home) or to the wormhole's mouth.
   * The planner works in its worker (seconds of n-body paths); the plan is shown when it answers.
   */
  async planOurs(kind: "orbit" | "target" | "wormhole", arrival: Arrival, altKm: number, retKm: number): Promise<string> {
    const s = this.s;
    const nav = this.ourNav(cameraFrame(s));
    if (!nav) return "Planning: in our universe (or around the black hole with PLAN TRANSFER)";
    if (this.planBusy) return "Planning… (still working on the last one)";
    const target = kind === "wormhole" ? "wormhole" : kind === "orbit" ? nav.ref : String(s.target);
    // (the space station: a rendezvous beside its forward port — iss-plan.ts)
    if (kind === "target" && (s.target === "iss" || isCraft(s.target))) return this.planIss(nav);
    if (kind === "target" && !isOurBody(s.target as Body)) return "Transfer: select a body of ours as the target (Tab, or a click on the map)";
    // (the first burn at least a minute away, and ~10 s of the pilot's time at this warp)
    const o = { lead: Math.max(60 / 492.5490947, 10 * (s.animate ? s.timeSpeed : 0)), mouthR: mouth(s).w.rho, accel: this.thrustMax() };
    this.planBusy = true;
    const gen = ++this.planGen;
    try {
      const res = await runPlanner<OurPlanResult>(kind === "orbit"
        ? { kind: "orbit", X: nav.X, V: nav.V, t: nav.t, altM: altKm * 1e3, o }
        : { kind: "transfer", X: nav.X, V: nav.V, t: nav.t, goal: { kind: "transfer", target, arrival, altM: altKm * 1e3, returnAltM: retKm * 1e3 }, o });
      if (gen !== this.planGen) return "";
      if ("error" in res) return res.error;
      this.plan = { nodes: res.nodes.map((n: PlanNode) => ({ t: n.t, dv: n.dv, then: n.then ?? null, role: n.role, body: n.body })), path: null, at: 0, note: res.note };
      this.ourMission = res.mission;
      this.ourPlanned = res.path;
      if (kind === "wormhole") s.target = "wormhole";
      this.refreshPlan(true);
      const dv = res.nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0) * 299792458;
      return `Plan: ${res.note} · Δv ${dv >= 1000 ? `${(dv / 1000).toFixed(2)} km/s` : `${dv.toFixed(0)} m/s`}`;
    } finally {
      if (gen === this.planGen) this.planBusy = false;
    }
  }
  private planGen = 0;

  /**
   * The flight computer's MISSION tab: a mission to another body planned — not yet in the plan —,
   * previewed (its path on the maps, its burns, its arrival), then adopted by `missionCommit`.
   * Our side: a transfer to a body (orbit, flyby, free return), the wormhole, a rendezvous with the
   * station or a craft. Gargantua's: a rendezvous with one of its worlds or the companion star (in orbit
   * about it, or beside it), the wormhole. The burns (s from now, m/s) or why not.
   */
  async missionPlan(spec: { target: string; arrival?: Arrival; altKm?: number; retKm?: number; orbit?: boolean }): Promise<
    { ok: true; note: string; burns: Burn[]; dvTotal: number; arrive: { body: string; t: number } | null; afterText: string } | { ok: false; note: string }
  > {
    const s = this.s;
    const cam = cameraFrame(s);
    const c = 299792458;
    const Msec = 4.925490947e-6 * s.massSolar;
    const fail = (note: string) => ({ ok: false as const, note });
    const gen = ++this.planGen;
    this.pendingMission = null;
    const roleName: Record<string, string> = { depart: "departure", circ: "circularize", mcc: "correction", capture: "capture", mccReturn: "return correction", captureHome: "capture home", arrive: "arrival" };
    const burnsOf = (nodes: { t: number; dv: Vec3; role?: string }[], t0: number): Burn[] =>
      nodes.map((n, k) => ({ t: (n.t - t0) * Msec, dv: [n.dv[0] * c, n.dv[1] * c, n.dv[2] * c] as KV3, label: roleName[n.role ?? ""] ?? `burn ${k + 1}` }));
    const sum = (b: Burn[]) => b.reduce((q, x) => q + Math.hypot(...x.dv), 0);
    const name = (id: string) => (id === "wormhole" ? "the wormhole" : BODY_NAMES[id as Body] ?? (isCraft(id as Target) ? `the ${VESSELS[id as VesselId].name}` : id === "iss" ? "the ISS" : id));
    const nav = this.ourNav(cam);
    if (nav) {
      const target = spec.target;
      const lead = Math.max(60 / 492.5490947, 10 * (s.animate ? s.timeSpeed : 0));
      // the station, a craft of the fleet: the rendezvous beside a free docking port
      if (target === "iss" || isCraft(target as Target)) {
        if (nav.ref !== "earth") return fail("A rendezvous: from an orbit around the Earth");
        const craft = isCraft(target as Target) ? (target as VesselId) : null;
        if (craft && freePort(craft) === null) return fail(`The ${VESSELS[craft].name}: no free docking port`);
        const point = craft ? craftPoint(craft) : rendezvousPoint;
        const p = planIssRendezvous(nav.X, nav.V, nav.t, lead, point, name(target), craft ? `its ${VESSELS[craft].ports[freePort(craft)!]!.name}` : "IDA-2");
        if (!p) return fail(`No rendezvous with ${name(target)} found in the next day`);
        if (gen !== this.planGen) return fail("");
        const burns = burnsOf(p.nodes.map((n) => ({ t: n.t, dv: n.dv as Vec3, role: n.role })), nav.t);
        this.pendingMission = {
          gen, note: p.note,
          commit: () => {
            s.target = target as Target;
            this.ourMission = null;
            this.ourPlanned = null;
            this.plan = { nodes: p.nodes.map((n) => ({ t: n.t, dv: n.dv, then: n.role === "arrive" ? "dock" as const : null, role: n.role as ManeuverNode["role"], body: craft && n.role === "arrive" ? craft : n.body })), path: null, at: 0, note: p.note };
            this.issGoal = { tArrive: p.tArrive, refined: new Map(), body: craft ?? "iss", point };
            this.refreshPlan(true);
          },
        };
        const arrive = { body: craft ?? "iss", t: p.tArrive };
        this.fcPreview(burns, p.note, { arrive });
        return { ok: true, note: p.note, burns, dvTotal: sum(burns), arrive, afterText: `Arrival 200 m off ${name(target)}'s port in ${fmtDur((p.tArrive - nav.t) * Msec)}, then the docking autopilot` };
      }
      if (target !== "wormhole" && !isOurBody(target as Body)) return fail("Pick a destination (a body, the station, a craft, the wormhole)");
      if (target === nav.ref) return fail(`Already about ${name(target)}: the ORBIT tab's operations`);
      const arrival = target === "wormhole" ? "flyby" : spec.arrival ?? "orbit";
      const o = { lead, mouthR: mouth(s).w.rho, accel: this.thrustMax() };
      this.planBusy = true;
      try {
        const res = await runPlanner<OurPlanResult>({ kind: "transfer", X: nav.X, V: nav.V, t: nav.t, goal: { kind: "transfer", target, arrival, altM: (spec.altKm ?? 200) * 1e3, returnAltM: (spec.retKm ?? 200) * 1e3 }, o });
        if (gen !== this.planGen) return fail("");
        if ("error" in res) return fail(res.error);
        const burns = burnsOf(res.nodes.map((n) => ({ t: n.t, dv: n.dv as Vec3, role: n.role })), nav.t);
        this.pendingMission = {
          gen, note: res.note,
          commit: () => {
            this.issGoal = null;
            this.plan = { nodes: res.nodes.map((n: PlanNode) => ({ t: n.t, dv: n.dv, then: n.then ?? null, role: n.role, body: n.body })), path: null, at: 0, note: res.note };
            this.ourMission = res.mission;
            this.ourPlanned = res.path;
            s.target = target as Target;
            this.refreshPlan(true);
          },
        };
        const arrive = { body: target, t: res.mission.tArrive };
        this.fcPreview(burns, res.note, { ours: res.path, arrive });
        const what = arrival === "orbit" ? `into a ${spec.altKm ?? 200} km orbit` : arrival === "flyby" ? `a flyby at ${spec.altKm ?? 200} km` : `round it at ${spec.altKm ?? 200} km and back home to ${spec.retKm ?? 200} km`;
        return { ok: true, note: res.note, burns, dvTotal: sum(burns), arrive, afterText: `${target === "wormhole" ? "Into the wormhole's mouth" : `Arrival at ${name(target)}`} in ${fmtDur((res.mission.tArrive - nav.t) * Msec)} — ${target === "wormhole" ? "the throat crossed" : what}` };
      } finally {
        if (gen === this.planGen) this.planBusy = false;
      }
    }
    // Gargantua's side: about the hole (or from a world's frame): its own planners on the geodesics
    const st = this.stateNow();
    if (!st) return fail("Missions: about the hole or one of its worlds");
    const w = this.world();
    if (spec.target === "wormhole") {
      if (!s.wormhole) return fail("No wormhole in this scene");
      const m = mouth(s);
      const res = planIntercept(st, s.whOrbit ? (t: number) => mouth(s, t).C as Vec3 : (m.C as Vec3), w, 0.25 * m.w.rho);
      if (!res) return fail("No path into the mouth found from this orbit");
      const burns = burnsOf(res.nodes, st.t);
      this.pendingMission = { gen, note: res.note, commit: () => this.adoptKerr(res.nodes, res.note, "wormhole") };
      this.fcPreview(burns, res.note);
      return { ok: true, note: res.note, burns, dvTotal: sum(burns), arrive: null, afterText: "Into the mouth — the throat crossed to our side" };
    }
    const body = spec.target as Body;
    if (body === "star" && !s.sun) return fail("No companion star in this scene");
    if (body !== "star" && (s.system === "none" || !bodyRadius(s, body))) return fail("Pick a destination: one of Gargantua's worlds, the star, the wormhole");
    const R = bodyRadius(s, body);
    const mB = bodyMass(s, body);
    const orbitIt = spec.orbit !== false && mB > 0;
    const res = planRendezvous(st, w, {
      centre: (t) => bodyCentre(s, body, t), velocity: (t) => bodyVelocity(s, body, t), radius: R,
      standoff: (orbitIt ? 3.2 : 4) * R,
      orbit: orbitIt ? { mass: mB, n: [0, 0, 1] } : undefined,
    });
    if (!res) return fail(`No rendezvous with ${name(body)} found`);
    const burns = burnsOf(res.nodes, st.t);
    const tArr = res.nodes[res.nodes.length - 1]!.t;
    this.pendingMission = { gen, note: res.note, commit: () => this.adoptKerr(res.nodes, res.note, body) };
    const arrive = { body, t: tArr };
    this.fcPreview(burns, res.note, { arrive });
    return { ok: true, note: res.note, burns, dvTotal: sum(burns), arrive, afterText: `Arrival at ${name(body)} in ${fmtDur((tArr - st.t) * Msec)} — ${orbitIt ? "then in orbit about it" : "then beside it, station-keeping"}` };
  }

  /**
   * The MISSION tab's destinations from where the ship is: our side, the planets and moons (grouped by
   * what they orbit), the station and the fleet's craft about the Earth, the wormhole; Gargantua's, its
   * worlds, the companion star, the wormhole — each with how far it is now.
   */
  missionTargets(): { universe: "ours" | "gargantua" | null; here: string | null; list: { id: string; name: string; group: string; far: string }[] } {
    const s = this.s;
    const cam = cameraFrame(s);
    const nav = this.ourNav(cam);
    const fmt = (m: number) => (m >= 1.495978707e10 ? `${(m / 1.495978707e11).toFixed(2)} AU` : m >= 1e7 ? `${Math.round(m / 1e3).toLocaleString("en")} km` : `${(m / 1e3).toFixed(0)} km`);
    if (nav) {
      const list: { id: string; name: string; group: string; far: string }[] = [];
      const dist = (X: Vec3) => Math.hypot(...sub3(X, nav.X)) * M_METRES;
      for (const b of SOLAR_BODIES) {
        if (b.kind === "star") continue;
        const group = b.parent === "sun" ? "Planets" : `${solarBody(b.parent!)?.name ?? b.parent}'s moons`;
        list.push({ id: b.id, name: b.name, group, far: fmt(dist(solarState(b.id, nav.t).pos)) });
      }
      if (nav.ref === "earth") {
        if (s.iss) list.push({ id: "iss", name: "ISS", group: "Craft about the Earth", far: "" });
        for (const id of ["ranger", "lander", "endurance"] as VesselId[]) {
          if (fleet.flownAssembly().includes(id)) continue;
          const p = fleet.pose(id, nav.t);
          if (p) list.push({ id, name: VESSELS[id].name, group: "Craft about the Earth", far: fmt(dist(p.X as Vec3)) });
        }
      }
      if (s.wormhole) list.push({ id: "wormhole", name: "The wormhole", group: "Beyond", far: fmt(Math.hypot(...nav.X) * M_METRES) });
      return { universe: "ours", here: nav.ref, list };
    }
    if (cam.region !== "hole") return { universe: null, here: null, list: [] };
    const list: { id: string; name: string; group: string; far: string }[] = [];
    const X = this.stateNow();
    const at = X ? (() => {
      const q = X;
      const sn = Math.sin(q.th);
      return [q.r * sn * Math.cos(q.ph), q.r * sn * Math.sin(q.ph), q.r * Math.cos(q.th)] as Vec3;
    })() : null;
    const t = this.nowTime();
    const far = (b: Body) => (at ? `${Math.hypot(...sub3(bodyCentre(s, b, t), at)).toFixed(1)} M` : "");
    if (s.system !== "none") for (const b of SYSTEM_BODIES) if (bodyRadius(s, b as Body) > 0) list.push({ id: b, name: BODY_NAMES[b as Body] ?? b, group: "Gargantua's worlds", far: far(b as Body) });
    if (s.sun) list.push({ id: "star", name: BODY_NAMES.star ?? "The star", group: "The companion", far: far("star") });
    if (s.wormhole) list.push({ id: "wormhole", name: "The wormhole", group: "Beyond", far: "" });
    return { universe: "gargantua", here: this.local?.F.id ?? null, list };
  }

  /** A mission's plan about the hole adopted: its nodes, the target. */
  private adoptKerr(nodes: ManeuverNode[], note: string, target: Target) {
    this.transfer = null;
    this.plan = { nodes, path: null, at: 0, note };
    this.s.target = target;
    this.refreshPlan(true);
  }

  /** The mission previewed, adopted: into the plan (its in-flight re-aims with it). Why not, or null. */
  private pendingMission: { gen: number; note: string; commit: () => void } | null = null;
  missionCommit(): string | null {
    const m = this.pendingMission;
    if (!m) return "No mission previewed";
    this.fcPreview(null);
    this.clearPlan();
    m.commit();
    this.pendingMission = null;
    return null;
  }

  /** A rendezvous with the space station under way: its arrival's time; the re-aims each node had. */
  private issGoal: { tArrive: number; refined: Map<ManeuverNode, number>; body: Body; point: RendezvousPoint } | null = null;

  /**
   * Plans the rendezvous with the station, or with a craft of the fleet (iss-plan.ts): four nodes —
   * departure, two corrections, arrival 200 m off its (free) docking port.
   */
  private planIss(nav: NonNullable<ReturnType<CameraController["ourNav"]>>): string {
    const s = this.s;
    if (nav.ref !== "earth") return "Rendezvous: from an orbit around the Earth";
    const lead = Math.max(60 / 492.5490947, 10 * (s.animate ? s.timeSpeed : 0));
    const craft = isCraft(s.target) ? s.target : null;
    if (craft && freePort(craft) === null) return `The ${VESSELS[craft].name}: no free docking port`;
    const point = craft ? craftPoint(craft) : rendezvousPoint;
    const name = craft ? `the ${VESSELS[craft].name}` : "the ISS";
    const p = planIssRendezvous(nav.X, nav.V, nav.t, lead, point, name, craft ? `its ${VESSELS[craft].ports[freePort(craft)!]!.name}` : "IDA-2");
    if (!p) return `No rendezvous with ${name} found in the next day`;
    this.ourMission = null;
    this.ourPlanned = null;
    // (arrived 200 m out: the docking autopilot takes the last of it)
    this.plan = { nodes: p.nodes.map((n) => ({ t: n.t, dv: n.dv, then: n.role === "arrive" ? "dock" as const : null, role: n.role as ManeuverNode["role"], body: n.body })), path: null, at: 0, note: p.note };
    this.issGoal = { tArrive: p.tArrive, refined: new Map(), body: craft ?? "iss", point };
    if (craft) for (const n of this.plan.nodes) if (n.role === "arrive") n.body = craft;
    this.refreshPlan(true);
    return `Plan: ${p.note}`;
  }

  /**
   * Executing the rendezvous: the next node re-aimed from the ship's real state — a correction twice
   * (when it becomes the next, and at a third of the way to it), the arrival as it nears. Never holds
   * the burn back (the arcs are solved here, at once).
   */
  private issRefineTick(nav: NonNullable<ReturnType<CameraController["ourNav"]>>, node: ManeuverNode, burnT: number): boolean {
    const g = this.issGoal!;
    if (this.nodeBurning || node.role === "depart") return false;
    const n = g.refined.get(node) ?? 0;
    const toNode = node.t - nav.t;
    const due = n === 0 || (n === 1 && toNode < 0.35 * (node.t - (this.plan.at || nav.t))) || (n < 4 && toNode < 4 * burnT + 30 / 492.5490947);
    if (!due || toNode < burnT) return false;
    const dv = refineIssNode(nav.X, nav.V, nav.t, node, g.tArrive, g.point);
    g.refined.set(node, n + 1);
    if (!dv) return false;
    // (a correction too small to fly — under 2 cm/s: dropped)
    if (node.role === "mcc" && Math.hypot(...dv) * 299792458 < 0.02 && n > 0) {
      const i = this.plan.nodes.indexOf(node);
      if (i >= 0) {
        this.plan.nodes.splice(i, 1);
        this.onPilotMessage?.("Mid-course correction not needed");
      }
    } else node.dv = dv;
    this.refreshPlan(true);
    return false;
  }
  lastRefine: { role: string; at: number; result: unknown } | null = null;

  /**
   * Executing a mission in our universe: the next node re-aimed from the ship's real state — when it
   * becomes the next one, and closer to it (a correction twice, a capture's periapsis a few times as
   * it nears) — in the planner's worker; a correction no longer needed is dropped.
   * True while a re-aim is under way and the burn is close (the burn waits for it).
   */
  private ourRefineTick(nav: NonNullable<ReturnType<CameraController["ourNav"]>>, node: ManeuverNode, burnT: number): boolean {
    const m = this.ourMission;
    if (!m || !node.role) return false;
    let st = this.refineState.get(node);
    if (!st) {
      st = { at: -Infinity, n: 0, pending: false };
      this.refineState.set(node, st);
    }
    const toNode = node.t - nav.t;
    const start = toNode - burnT / 2;
    if (st.pending) return start < 3 * Math.max(this.s.timeSpeed, 1e-6);
    if (this.nodeBurning || start < 2 * burnT + 0.02) return false;
    const cheap = node.role === "capture" || node.role === "captureHome" || node.role === "circ" || node.role === "arrive";
    const maxN = cheap ? 8 : 3;
    const due = st.n === 0 || (st.n < maxN && toNode < (cheap ? 0.4 : 0.15) * (node.t - st.at));
    // (a departure: once within a turn of the orbit, the plan's two-body wait now flown)
    if (!due || (node.role === "depart" && st.n === 0 && toNode > 1.2 * this.ourPeriod(nav) && toNode > 0.3 * 86400 / 492.55)) return false;
    st.pending = true;
    st.at = nav.t;
    st.n++;
    const o = { lead: Math.min(Math.max(60 / 492.5490947, burnT), 0.8 * start), mouthR: mouth(this.s).w.rho, accel: this.thrustMax() };
    const pn: PlanNode = { t: node.t, dv: node.dv, role: node.role, body: node.body, then: node.then === "circularize" ? "circularize" : undefined };
    void runPlanner<{ node: PlanNode | null } | { error: string }>({ kind: "refine", X: nav.X, V: nav.V, t: nav.t, mission: m, node: pn, o }).then((r) => {
      st!.pending = false;
      this.lastRefine = { role: node.role!, at: nav.t, result: r };
      const i = this.plan.nodes.indexOf(node);
      if (i < 0 || "error" in r) return;
      if (!r.node) {
        // (no correction needed — now: kept at zero while far, re-aimed nearer its time; dropped at
        // its last look)
        const nav2 = this.ourNav(cameraFrame(this.s));
        const far = nav2 && node.t - nav2.t > 0.5 * 86400 / 492.5490947 && st!.n < 3;
        if (far) node.dv = [0, 0, 0];
        else {
          this.plan.nodes.splice(i, 1);
          this.onPilotMessage?.(`${node.role === "mccReturn" ? "Return" : "Mid-course"} correction not needed`);
        }
      } else {
        node.t = r.node.t;
        node.dv = r.node.dv;
      }
      this.refreshPlan(true);
    });
    return start < 3 * Math.max(this.s.timeSpeed, 1e-6);
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
    // our universe: a tenth of a turn around the reference body ahead (or `after`)
    const nav = this.ourNav(cameraFrame(this.s));
    if (nav) {
      const period = this.ourPeriod(nav);
      const t = nav.t + (after ?? Math.max(0.1 * period, 8 * this.s.timeSpeed, 0.2));
      this.plan.nodes.push({ t, dv: [0, 0, 0] });
      this.plan.nodes.sort((a, b) => a.t - b.t);
      this.plan.note = "manual node";
      this.plan.kind = undefined;
      this.refreshPlan(true);
      return;
    }
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
    this.issGoal = null;
    this.plan = { nodes: [], path: null, at: 0, note: "" };
    this.ourMission = null;
    this.ourPlanned = null;
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
    if (!P.nodes.length) {
      this.ourPlan = null;
      return (P.path = null);
    }
    // (at most 3 times a second — less when a prediction costs more than a few ms)
    if (!force && now - P.at < Math.max(330, 8 * this.planCost)) return P.path;
    P.at = now;
    // our universe: the path through the nodes by the Newtonian predictor (the hole's map: none)
    const nav = this.ourNav(cameraFrame(this.s));
    if (nav) {
      let nodes = P.nodes.filter((n) => n.t > nav.t - 1e-6);
      if (this.nodeBurning && this.pilot.auto === "node" && nodes[0]) {
        const n0 = nodes[0];
        const total = Math.hypot(...(this.burnFollow ?? n0.dv));
        const left = Math.max(0, total - this.nodeDone);
        nodes = [{ ...n0, t: nav.t, dv: lin(n0.dv, left / Math.max(total, 1e-15), n0.dv, 0) }, ...nodes.slice(1)];
      }
      const m = this.ourMission;
      // (a mission: its whole span; the first burn days away in a low orbit — beyond what the map's
      // prediction reaches — the planner's own path)
      // (before the departure: the planner's own path — from a low orbit, months of it are more than
      // a frame can predict)
      if (m && this.ourPlanned && nodes[0]?.role === "depart") {
        this.ourPlan = this.ourPlanned;
        return (P.path = null);
      }
      const mouthR = mouth(this.s).w.rho, accel = this.thrustMax();
      const list = nodes.map((n) => ({ t: n.t, dv: n.dv }));
      // (every node behind the ship — passed, not flown: the plan's path is the free one)
      if (!list.length) {
        this.ourPlan = null;
        return (P.path = null);
      }
      if (m) {
        // (a mission: the flight's own step — the display's path is the one flown)
        const span = { tMax: Math.max(m.tEnd - nav.t, 0) * 1.1 + 0.3 * 86400 / 492.55, maxSteps: 6000, step: 0.025 };
        const t0 = performance.now();
        this.ourPlan = predictOurs(nav.X, nav.V, nav.t, list, { mouthR, accel, ...span, drag: this.dragPerMass() });
        this.planCost = performance.now() - t0;
        return (P.path = null);
      }
      // hand-made nodes: the far path (a turn of the orbit after the last burn — days to the Moon)
      // in the planner's worker, kept while the nodes stay as they are; meanwhile — a node just made
      // or pulled — a short one here, to the last node and half an hour on (the map continues it
      // with conics until the far one comes)
      const key = JSON.stringify(list);
      const far = this.farPlan;
      if (far && far.key === key) this.ourPlan = far.path;
      else {
        const t0 = performance.now();
        const last = list[list.length - 1]!.t;
        this.ourPlan = predictOurs(nav.X, nav.V, nav.t, list, { mouthR, accel, tMax: Math.max(last - nav.t, 0) + 1800 / 492.5490947, maxSteps: 3000, drag: this.dragPerMass() });
        this.planCost = performance.now() - t0;
      }
      if (!this.farBusy && (!far || far.key !== key || now - far.at > 2000)) {
        this.farBusy = true;
        runPlanner<OurPath>({ kind: "predictPlan", X: nav.X, V: nav.V, t: nav.t, nodes: list, mouthR, accel, drag: this.dragPerMass() })
          .then((path) => {
            if (!path || (path as unknown as { error?: string }).error) return;
            this.farPlan = { key, path, at: performance.now() };
            // (still these nodes: shown at once)
            if (this.plan.nodes.length && JSON.stringify(this.plan.nodes.filter((n) => n.t > path.times[0]! - 1e-6).map((n) => ({ t: n.t, dv: n.dv }))) === key) this.ourPlan = path;
          })
          .finally(() => (this.farBusy = false));
      }
      return (P.path = null);
    }
    this.ourPlan = null;
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
    this.nodeWarpWant = null;
    this.nodeWarpSet = NaN;
    this.nodeWarp = "";
    this.nodeBurning = false;
    this.nodeDone = 0;
    this.burnDir = null;
    this.burnFollow = null;
  }

  /** A goal burn's direction (local): along the velocity still to gain to a circle, or its sense. */
  private goalDir(node: ManeuverNode, cam: ReturnType<typeof cameraFrame>, total: number): Vec3 {
    const g = node.goal!;
    if ("plane" in g) {
      const st = this.stateNow();
      return st ? planeLeft(st, this.world(), g.plane).dir : dvLocal(cam.beta, node.dv);
    }
    if ("circ" in g) {
      const st = this.stateNow();
      const d = st && circLeft(st, this.world());
      if (d && Math.hypot(...d) > 1e-12) return dvLocal(cam.beta, d);
      return dvLocal(cam.beta, node.dv);
    }
    return dvLocal(cam.beta, [g.dir * total, 0, 0]);
  }

  /** A goal burn's estimate: the Δv the path still needs [c], when, at what was given then. */
  private goalRem: { node: ManeuverNode; rem: number; at: number; done: number } | null = null;

  /** The pilot's own warp during a manoeuvre, auto warp off (null: not chosen yet). */
  private nodeWarpWant: number | null = null;
  private nodeWarpSet = NaN;
  /** A manoeuvre's warp, for the HUD: "" none executing; "auto"; "manual" (the pilot's); "held" (the
   *  pilot's held down to what the manoeuvre allows). */
  nodeWarp: "" | "auto" | "manual" | "held" = "";

  /**
   * The warp while a manoeuvre executes: the autopilot's (auto warp), or the pilot's — chosen live
   * with the warp keys — never above the autopilot's: a coast faster than that would pass the burn's
   * start, a burn faster would overshoot its Δv.
   */
  private setNodeWarp(auto: number) {
    const s = this.s;
    if (s.autoWarp) this.nodeWarpWant = null;
    else {
      // (the pilot changed the warp since the last frame: that is the new choice; auto warp just
      // turned off: the warp as it stands)
      if (this.nodeWarpWant === null || s.timeSpeed !== this.nodeWarpSet) this.nodeWarpWant = Number.isFinite(this.nodeWarpSet) ? s.timeSpeed : auto;
    }
    const want = this.nodeWarpWant;
    const w = want === null ? auto : Math.min(want, auto);
    s.timeSpeed = this.nodeWarpSet = w;
    this.nodeWarp = want === null ? "auto" : want > auto * (1 + 1e-9) ? "held" : "manual";
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
    const nav = this.ourNav(cam);
    if (!node || (cam.region !== "hole" && !nav)) {
      // (a mission into the wormhole, its throat now under way: arrived — the warp that crosses it
      // kept, the plan done)
      if (node?.role === "arrive" && node.body === "wormhole") {
        const v = Math.hypot(...cam.beta);
        this.userWarp = Math.max(this.userWarp ?? 0, Math.min((24 * mouth(s).w.rho) / Math.max(v, 1e-9) / 20, 1e4));
        P.nodes = [];
        this.ourMission = null;
        this.ourPlanned = null;
        this.missionHold = false;
        this.traversing = true;
      }
      this.pilot.setAuto("node");
      this.restoreWarp();
      return null;
    }
    if (this.userWarp === null) this.userWarp = s.timeSpeed;
    // (our universe: the burn follows the orbital frame — the node's impulse as that burn delivers it,
    // a turn of the velocity flown as its arc (fc/kepler.ts followDv); fixed as the burn starts)
    const ndv: Vec3 = nav ? (this.nodeBurning && this.burnFollow ? this.burnFollow : followDv(node.dv as KV3, Math.hypot(...sub3(nav.V, nav.refVel)))) : node.dv;
    const total = Math.hypot(...ndv);
    const left = Math.max(0, total - this.nodeDone);
    // (the burn keeps the direction it had when it started: fixed in the local frame, not turning
    // with the velocity it changes)
    // (a Crew burn lasts a good part of an orbit: it follows the orbital frame — prograde, normal,
    // radial turn with the ship — and is centred on the node, a finite burn)
    // (our universe: the burn follows the orbital frame of the reference body, as a Crew burn)
    // (a goal burn about the hole follows the prograde — or the retrograde —, as its estimate has it)
    const follow = s.engine === "crew" || !!nav || (!!node.goal && !nav);
    const dir = this.nodeBurning && this.burnDir && !follow ? this.burnDir
      : nav ? nav.toRep(nodeDvHome(nav.X, nav.V, nav.t, ndv)) : node.goal ? this.goalDir(node, cam, total) : dvLocal(cam.beta, node.dv);
    const dl = Math.hypot(...dir) || 1;
    const aMax = Math.max(this.thrustMax(), 1e-9);
    const burnT = total / aMax / Math.max(dtau, 1e-3); // coordinate duration of the whole burn
    // (our universe, a mission's node: re-aimed as it nears — the burn waits for an answer due)
    const hold = nav ? (this.issGoal ? this.issRefineTick(nav, node, burnT) : this.ourRefineTick(nav, node, burnT)) : false;
    const toNode = node.t - this.nowTime();
    const start = toNode - burnT / 2;
    if (!this.nodeBurning && start <= 0 && !hold) {
      if (this.missionHold && this.pilot.hold === "prograde") this.pilot.hold = "none";
      this.missionHold = false;
      this.nodeBurning = true;
      this.burnDir = lin(dir, 1 / dl, dir, 0);
      this.burnFollow = nav ? ndv : null;
    }
    // (a goal burn about the hole: what is left is what the path still needs — re-estimated a few
    // times a second)
    let goalLeft: number | null = null;
    // (a goal burn's throttle where its thrust does little: a plane change away from the nodes)
    let goalGate = 1;
    if (this.nodeBurning && !nav && node.goal && "plane" in node.goal) {
      const st = this.stateNow();
      const pl = st ? planeLeft(st, this.world(), node.goal.plane) : null;
      goalLeft = pl ? pl.left : 0;
      goalGate = pl ? clamp((pl.eff - 0.55) / 0.3, 0, 1) : 1;
      // (a long turn costs more than the node's impulse, spread over the orbit)
      if (this.nodeDone > 2.5 * total) goalLeft = 0;
    } else if (this.nodeBurning && !nav && node.goal && "circ" in node.goal) {
      const st = this.stateNow();
      const d = st && circLeft(st, this.world());
      goalLeft = d ? Math.hypot(...d) : 0;
      if (this.nodeDone > 1.5 * total) goalLeft = 0;
    } else if (this.nodeBurning && !nav && node.goal) {
      const goal = node.goal as Extract<KerrGoal, { apsis: number } | { period: number }>;
      {
        const G = this.goalRem;
        const tw = performance.now();
        if (!G || G.node !== node || tw - G.at > 250) {
          const st = this.stateNow();
          const guess = G && G.node === node ? Math.max(G.rem - (this.nodeDone - G.done), 0) : left;
          if (st) this.goalRem = { node, rem: "period" in goal ? periodLeft(st, this.world(), goal, Math.max(guess, 0.02 * total)) : apsisLeft(st, this.world(), goal, Math.max(guess, 0.02 * total)), at: tw, done: this.nodeDone };
        }
        const H = this.goalRem;
        goalLeft = H && H.node === node ? Math.max(H.rem - (this.nodeDone - H.done), 0) : left;
        // (runaway: no more than thrice the plan's — a burn longer than the orbit spirals, and costs more)
        if (this.nodeDone > 3 * total) goalLeft = 0;
      }
    }
    if (this.nodeBurning) {
      // burn: about 2 s of the pilot's time for the whole burn (warp adapted); a Crew burn, ~10 s
      let w = follow ? Math.min(Math.max(burnT / 10, 0.05), 5000) : Math.min(Math.max(burnT / 2, 0.05), 200);
      // (a goal burn's end slowed: its last part over ~3 s, the path re-estimated meanwhile)
      if (goalLeft !== null) w = Math.min(w, Math.max(goalLeft / aMax / Math.max(dtau, 1e-3) / 3, 0.05));
      // (our universe: the end of a burn slowed down — a frame gives at most half of what is left —
      // to cut it within a cm/s: 1 m/s at the Earth's departure is ~1 000 km at the Moon)
      if (nav) w = Math.min(w, Math.max(left / (2 * aMax * Math.max(dt * dtau, 1e-6)), 0.0005));
      this.setNodeWarp(w);
      const perFrame = aMax * s.timeSpeed * dt * dtau;
      // (done: within a thousandth of the node's Δv — our universe's burns are km/s, 10⁻⁵ c: there,
      // within a cm/s)
      const lft = goalLeft ?? left;
      if ((nav ? left <= Math.max(3e-11, 1e-6 * total) : lft <= Math.max(Math.min(1e-5, 1e-3 * total), 0.02 * perFrame)) || lft < 1e-12) {
        this.goalRem = null;
        P.nodes.shift();
        this.nodeDone = 0;
        this.nodeBurning = false;
        this.burnDir = null;
        this.burnFollow = null;
        // (a circularization a long burn left off its radius: a Hohmann's correction, its burns short)
        const g = node.goal;
        if (g && "circ" in g && g.trim && !P.nodes.length && !nav) {
          const st = this.stateNow();
          if (st && Math.abs(st.r - g.circ) > 0.005 * g.circ) {
            const fix = kHohmann(st, this.world(), g.circ);
            if (fix.ok) {
              P.nodes = fix.nodes.map((n, i) => ({ ...n, label: i ? "circularize (correction)" : "correction", goal: n.goal && "circ" in n.goal ? { circ: n.goal.circ } : n.goal }));
              P.note = `${P.note} — correction to ${g.circ.toFixed(2)} M`;
              this.onPilotMessage?.(`Circular at ${st.r.toFixed(2)} M: a correction to ${g.circ.toFixed(2)} M (${(fix.nodes.reduce((q, n) => q + Math.hypot(...n.dv), 0) * 299792.458).toFixed(0)} km/s)`);
              this.refreshPlan(true);
              return null;
            }
          }
        }
        // (the pilot's warp before the plan between its nodes — not a choice of the pilot's)
        s.timeSpeed = this.nodeWarpSet = this.userWarp;
        if (!P.nodes.length) {
          const then = node.then ?? null;
          // (into the wormhole: the throat is months wide at this speed — a warp that crosses it in
          // ~20 s is kept, not the pilot's real time)
          if (node.role === "arrive" && node.body === "wormhole" && nav) {
            const v = Math.hypot(...nav.V);
            this.userWarp = Math.max(this.userWarp ?? 0, Math.min((24 * mouth(this.s).w.rho) / Math.max(v, 1e-9) / 20, 1e4));
          }
          this.ourMission = null;
          this.ourPlanned = null;
          this.issGoal = null;
          this.missionHold = false;
          this.userWarp = null;
          P.path = null;
          this.pilot.auto = "none";
          // (a circularization after the node: the trim where it is — the pilot's run kept, else a new one)
          if (then === "circularize") this.ourCirc = this.ourCirc ? { ...this.ourCirc, mode: "trim" } : { mode: "trim", spent0: this.spent };
          if (then) this.pilot.setAuto(then);
          if (then === "dock") this.onPilotMessage?.("At the ISS — the docking autopilot takes over");
          else if (node.role === "arrive") this.onPilotMessage?.(node.body === "wormhole" ? "Into the wormhole's throat — Gargantua's side at its end" : `${BODY_NAMES[node.body as Body] ?? node.body} passed`);
          else this.onPilotMessage?.(then ? `Manoeuvre done — ${then === "circularize" ? "circularizing" : then === "orbit" ? `in orbit around ${this.s.target === "star" ? "the star" : BODY_NAMES[this.s.target]}` : "station-keeping"}` : "Manoeuvre done");
        } else this.refreshPlan(true);
        return null;
      }
      return { dir: lin(dir, 1 / dl, dir, 0), throttle: goalGate * Math.min(1, lft / Math.max(perFrame, 1e-12)) };
    }
    // coast: warp so that the burn's start comes in ~2.5 s, slower once close (the nose is already
    // on the burn: it turns while coasting)
    const coast = start - 20;
    let w = coast > 0 ? Math.min(Math.max(coast / 2.5, 4), 1e5) : Math.min(Math.max(start / 1.5, 3), 12);
    // (our universe: seconds matter — a burn of minutes in a low orbit; the warp down to real time)
    // (a short burn — a correction of a few m/s — is approached at ×5 at least, not in real time)
    if (nav) w = coast > 0 ? Math.min(Math.max(start / 3, 0.002), 1e5) : Math.max(Math.min(start / 2, w), burnT * 492.5490947 > 30 ? 0.002 : 0.01);
    if (hold) w = Math.min(w, Math.max(start / 4, 0.002));
    // (a long coast rides the rails, held back near bodies like any flight)
    if (s.system !== "none" || w > 500) w = Math.min(w, Math.max(this.railsLimit(cam).lim, 3));
    this.setNodeWarp(w);
    // (our universe, a mission's cruise: the SAS on prograde until the next manoeuvre nears — ten
    // minutes, or a few burn lengths — then onto the burn; a hold the pilot chose is kept)
    const far = nav ? start > Math.max(600 / 492.5490947, 3 * burnT) : start > 60;
    if (nav) {
      if (far && this.pilot.hold === "none") {
        this.pilot.hold = "prograde";
        this.missionHold = true;
      } else if (!far && this.missionHold && this.pilot.hold === "prograde") {
        this.pilot.hold = "none";
        this.missionHold = false;
      }
    }
    return { dir: lin(dir, 1 / dl, dir, 0), throttle: 0, far };
  }

  /**
   * Our universe: the ship in the home frame, and the body its orbital directions refer to (the
   * smallest sphere of influence it is in): place, velocity, and those as local (rep) vectors.
   */
  private ourNav(cam: ReturnType<typeof cameraFrame>) {
    const s = this.s;
    if (!onOurSide(s, cam) || s.system !== "gargantua") return null;
    const t = this.nowTime();
    const w = mouth(s).w;
    const X = homeOf(w, cam.ell, cam.n);
    const V = repToHomeVec(w, cam.ell, cam.n, cam.beta);
    const ref = referenceBody(X, t);
    const st = ourState(ref, t);
    const R = sub3(X, st.pos);
    const toRep = (v: Vec3) => homeToRep(w, cam.ell, cam.n, v);
    const Rr = toRep(R);
    return { X, V, ref, refPos: st.pos, refVel: st.vel, refVelRep: toRep(st.vel), radial: lin(Rr, 1 / Math.hypot(...Rr), Rr, 0), toRep, t };
  }

  private radialOut(cam: ReturnType<typeof cameraFrame>): Vec3 | null {
    if (cam.region === "hole") return [1, 0, 0];
    const nav = this.ourNav(cam);
    if (nav) return nav.radial;
    // in the throat region: away from the throat (increasing |ℓ|)
    return lin(cam.n, Math.sign(cam.ell) || 1, cam.n, 0);
  }

  /** Direction of the selected target, local components (the flat map's straight line). */
  private targetDir(cam: ReturnType<typeof cameraFrame>): Vec3 | null {
    const s = this.s;
    if (onOurSide(s, cam)) return ourLook(s, cam, sub3(ourTarget(s, s.target, this.nowTime()).pos, cameraHome(s, cam)));
    if (cam.region !== "hole") return null;
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
    // (the craft flown: its own engines — a share of the crew setting's —, over its assembly's mass: the
    // craft docked to it are pushed along)
    const V = VESSELS[fleet.active];
    return (engineThrust(s) * V.accel * V.mass) / fleet.massProps().mass;
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
    if (!lf) return this.ourSurfaceInfo();
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
      gLocal: (g * F.aUnit) / 9.80665, twr: this.thrustMax() / Math.max(g, 1e-30), landed: L.landed, rolling: !!L.rolling,
      air: airDensity(F, d - F.R),
      /** where on the world (its frame's ξ: the HUD's globe) */
      xi: L.xi,
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

  // ------------------------------------------------------------------------------ the camera rig
  /**
   * The camera without the ship, near the worlds (settings.rotation): around a planet or a moon (drag:
   * about it, wheel: its distance), following one (its motion carried, the view free, the keys move
   * the camera), free (carried by the nearest body — within 40 of its radii — the keys fly), on a
   * tripod (fixed on the nearest body, turning with it, aiming at the target; drag: off it, keys: move
   * the tripod). The camera takes the body's velocity: its view is a co-moving observer's (Miller
   * runs at half the speed of light). Around the hole, the star, the mouth: the classic orbit.
   */
  rig = {
    on: false,
    key: "",
    ref: null as Body | null,
    /** camera − the body's centre [M] (follow, free) */
    off: [0, 0, 0] as Vec3,
    /** tripod: the place on the body's own axes (ours [M]; Gargantua's worlds: their frame's ξ) */
    fixed: null as Vec3 | null,
    /** the tripod's free view: its forward and up on the body's own axes (as offsets from its foot) */
    look: null as { f: Vec3; u: Vec3 } | null,
    lookKey: "",
    /** around: azimuth, elevation [°], the height above its surface [M] */
    az: 0,
    el: 20,
    alt: 1,
    yawOff: 0,
    pitchOff: 0,
    vel: [0, 0, 0] as Vec3,
    dolly: 0,
    /** what the last placement was made from and wrote (the same again: nothing to redo) */
    stamp: "",
    /** where the last placement put the camera (moved since by something else: the rig starts afresh) */
    placed: "",
  };

  /** Around a planet, a moon (the rig), not the classic orbit's hole, star, mouth. */
  private rigOrbits() {
    const s = this.s;
    return s.rotation === "orbit" && !this.piloting && !s.ship && !["hole", "wormhole", "star", "barycentre"].includes(s.target);
  }

  /** The camera's place and axes as world vectors (our side: the home frame; else the hole's map). */
  private rigWorld(): { ours: boolean; X: Vec3; fwd: Vec3; up: Vec3; right: Vec3 } | null {
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
  private rigBody(b: Body | null, ours: boolean, t: number): { id: Body; C: Vec3; V: Vec3; R: number } | null {
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
  private rigNearest(ours: boolean, X: Vec3, t: number) {
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
  private rigPlace(ours: boolean, X: Vec3, fwd: Vec3, up: Vec3, V: Vec3) {
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
  private rigStep(dt: number, move: number[], fast: boolean): boolean {
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
    const h = Math.max(Math.hypot(...(R.fixed ?? (mode === "follow" || mode === "free" ? R.off : rel))) - ref.R - this.reliefUnder(this.rigBody(ref.id, w.ours, tNow)!, w, tNow) / mR, 1 / mR);
    const v = 0.8 * h * this.flySpeed * (fast ? 3 : 1);
    const want = lin(lin(w.fwd, move[0]! * v, w.right, move[1]! * v), 1, w.up, move[2]! * v);
    R.vel = lin(R.vel, 1, sub3(want, R.vel), 1 - Math.exp(-dt / 0.12));
    if (!move.some((x) => x !== 0) && Math.hypot(...R.vel) < 1e-3 * h) R.vel = [0, 0, 0]; // (glided to a stop: a thousandth of the height per second)
    let step = lin(R.vel, dt, w.fwd, R.dolly * h);
    R.dolly = 0;
    const floor = (X: Vec3) => {
      // (not below the surface: a metre above its relief — where known —, its mean sphere else)
      const r = sub3(X, ref!.C);
      const l = Math.hypot(...r);
      const g = w.ours && solidBody(ref!.id) && l < ref!.R * 1.01 ? groundRelief(ref!.id, toBodyFixed(ref!.id, X, t)) : 0;
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
    const stamp = () => [t, key, R.az, R.el, R.alt, R.yawOff, R.pitchOff, ...R.off, ...(R.fixed ?? []), s.lookAt, this.poseKey(), s.velR, s.velT].join();
    if (step.every((x) => x === 0) && !move.some((x) => x !== 0) && R.stamp === stamp()) return true;
    if (mode === "orbit") {
      // around: the keys too — forwards / back the distance, sideways and up / down about it
      R.alt = clamp(R.alt * Math.exp(-move[0]! * dt * (fast ? 3 : 1)), 1 / mR, 1e6);
      R.az -= move[1]! * 40 * dt;
      R.el = clamp(R.el + move[2]! * 40 * dt, -89, 89);
      const d = ref.R + R.alt;
      const a = (R.az * Math.PI) / 180, e = (R.el * Math.PI) / 180;
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
          const o = this.rigFix(ref.id, w.ours, X, t), f = dir(w.fwd), u = dir(w.up);
          R.look = o && f && u ? { f: sub3(f, o), u: sub3(u, o) } : null;
        }
        const o = R.look && this.rigUnfix(ref.id, w.ours, R.fixed, t);
        const back = (q: Vec3) => this.rigUnfix(ref.id, w.ours, lin(R.fixed!, 1, q, 1), t)?.X;
        const fX = R.look && back(R.look.f), uX = R.look && back(R.look.u);
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
      const up0 = unitV(sub3(X, ref.C));
      let fwd = unitV(sub3(T, X));
      if (Math.abs(dot3(fwd, up0)) > 0.999) fwd = unitV(cross(up0, [0, 0, 1]));
      const east = unitV(cross(fwd, up0));
      const yo = (R.yawOff * Math.PI) / 180, po = (R.pitchOff * Math.PI) / 180;
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

  /** The ground's height above a world's mean sphere under the camera [m] (known: our solid worlds'). */
  private reliefUnder(ref: { id: Body; C: Vec3; R: number }, w: { ours: boolean; X: Vec3 }, t: number) {
    if (!w.ours || !solidBody(ref.id) || Math.hypot(...sub3(w.X, ref.C)) > 1.01 * ref.R) return 0;
    return groundRelief(ref.id, toBodyFixed(ref.id, w.X, t));
  }

  /** A place on a body's own (turning) axes: ours — its body-fixed axes [M]; Gargantua's planets — their frame's ξ. */
  private rigFix(id: Body, ours: boolean, X: Vec3, t: number): Vec3 | null {
    const s = this.s;
    if (ours) return isOurBody(id) ? toBodyFixed(id, X, t) : null;
    if (!["miller", "mann", "edmunds"].includes(id)) return null;
    const F = planetFrame(id, t, s.spin, s.massSolar);
    return toLocal(F, X, F.V).xi;
  }
  private rigUnfix(id: Body, ours: boolean, q: Vec3, t: number): { X: Vec3; V: Vec3 } | null {
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
  rigStatus(): { body: Body; h: number } | null {
    const R = this.rig;
    if (!R.on || !R.ref) return null;
    const w = this.rigWorld();
    const b = w && this.rigBody(R.ref, w.ours, this.nowTime());
    return w && b ? { body: b.id, h: Math.hypot(...sub3(w.X, b.C)) - b.R } : null;
  }

  /** The camera's distance [M] to the nearest surface of a body of its universe (planets, moons, stars). */
  private surfaceDistance(): number {
    const s = this.s, cam = cameraFrame(s), t = this.nowTime();
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
  /** our universe: the free-fall path and the path through the nodes (Newtonian prediction) */
  ourFree: OurPath | null = null;
  private ourFreeAt = 0;
  private ourFreeKey = "";
  private predicting = false;
  /** our universe: the mission the plan flies (its nodes re-aimed in flight), the planner at work */
  ourMission: OurMission | null = null;
  planBusy = false;
  /** what the last live prediction of the plan cost [ms] (it is refreshed less often when dear) */
  private planCost = 0;
  /** hand-made nodes' far path (from the planner's worker): for which nodes, when; a request in flight */
  private farPlan: { key: string; path: OurPath; at: number } | null = null;
  private farBusy = false;
  /** the planner's own path, shown while the first burn is further than the map's prediction reaches */
  private ourPlanned: OurPath | null = null;
  /** per node: the last re-aim (scene time), how many, one under way */
  private refineState = new WeakMap<ManeuverNode, { at: number; n: number; pending: boolean }>();
  ourPlan: OurPath | null = null;

  /** A turn of the ship's orbit around its reference body (the Kepler period; unbound: a day). */
  private ourPeriod(nav: NonNullable<ReturnType<CameraController["ourNav"]>>) {
    const mb = OUR_BODIES.find((b) => b.id === nav.ref)?.mass ?? 1e-8;
    const r = Math.hypot(...sub3(nav.X, nav.refPos));
    const v = sub3(nav.V, nav.refVel);
    const eps = dot3(v, v) / 2 - mb / r;
    return eps < 0 ? 2 * Math.PI * Math.sqrt((-mb / (2 * eps)) ** 3 / mb) : 86400 / 492.55;
  }

  /** the navball's speed: in orbit (around the reference body) or relative to the target */
  speedMode: "orbit" | "target" = "orbit";

  /** The target's velocity as a local 3-velocity (ZAMO near the hole, rep on our side). */
  private targetVelLocal(cam: ReturnType<typeof cameraFrame>): Vec3 | null {
    const s = this.s;
    if (s.target === "hole") return [0, 0, 0];
    const nav = this.ourNav(cam);
    if (nav) return nav.toRep(ourTarget(s, s.target, nav.t).vel);
    if (cam.region !== "hole") return null;
    const V = bodyVelocity(s, s.target, this.nowTime());
    const f = sphericalFrame(blToCartesian(cam.r, cam.theta, cam.phi));
    return coordToZamo([dot3(V, f.er), dot3(V, f.et), dot3(V, f.ep)], cam.r, cam.theta, cam.zamo);
  }

  /** The next manoeuvre node's burn direction (local), for the NODE hold and the navball. */
  private maneuverDir(cam: ReturnType<typeof cameraFrame>): Vec3 | null {
    if (this.nodeBurning && this.burnDir) return this.burnDir;
    const n = this.plan.nodes[0];
    if (!n) return null;
    const v = this.nodeDirLocal ? this.nodeDirLocal(cam, n) : null;
    return v;
  }
  /** (set by the planner of the side the ship is on: a node's burn as a local direction now) */
  private nodeDirLocal: ((cam: ReturnType<typeof cameraFrame>, n: ManeuverNode) => Vec3 | null) | null = (cam, n) => {
    const nav = this.ourNav(cam);
    if (nav) {
      const d = nav.toRep(nodeDvHome(nav.X, nav.V, nav.t, n.dv));
      const l = Math.hypot(...d);
      return l > 0 ? lin(d, 1 / l, d, 0) : null;
    }
    if (cam.region !== "hole") return null;
    const d = dvLocal(cam.beta, n.dv);
    const l = Math.hypot(...d);
    return l > 0 ? lin(d, 1 / l, d, 0) : null;
  };

  /** where our universe's hover holds (home frame, relative to the reference body) */
  private ourAnchor: { ref: string; d: Vec3 } | null = null;

  /**
   * Our universe's autopilots (Newton, home frame; wanted velocities returned as local rep vectors):
   *  - approach: towards the target at the speed that still stops at the stand-off with 60 % of the
   *    engine (accelerate, then brake: a brachistochrone), the side drift cancelled; the warp set for
   *    an arrival in ~8 s, the pilot's given back there; a body with a mass: then its orbit;
   *  - orbit: a circle around the target, at the height it is engaged at (from far: low orbit, above
   *    its air), in the plane of the ship's motion;
   *  - hover: at rest against the reference body where engaged, the pull cancelled.
   */
  private ourWant(cam: ReturnType<typeof cameraFrame>, say: (t: string) => null, T: number): { beta: Vec3; ff: Vec3 } | null {
    const s = this.s;
    const P = this.pilot;
    const nav = this.ourNav(cam)!;
    const t = nav.t;
    const g = gravityHome(nav.X, t);
    const thr = this.thrustMax();
    const out = (v: Vec3, ff: Vec3 = [0, 0, 0]) => ({ beta: nav.toRep(v), ff: nav.toRep(ff) });
    if (P.auto === "hover") {
      // (by the mouth — targeted, within a few of its stand-offs: at rest against it)
      const byMouth = !isOurs(s.target) && Math.hypot(...nav.X) < 0.5;
      const refId = byMouth ? "mouth" : nav.ref;
      const ref = byMouth ? { pos: [0, 0, 0] as Vec3, vel: [0, 0, 0] as Vec3 } : ourState(nav.ref, t);
      if (!this.ourAnchor || this.ourAnchor.ref !== refId) this.ourAnchor = { ref: refId, d: sub3(nav.X, ref.pos) };
      const back = sub3(lin(ref.pos, 1, this.ourAnchor.d, 1), nav.X);
      this.hubNote = { off: Math.hypot(...back) * M_METRES, drift: Math.hypot(...sub3(nav.V, ref.vel)) * 299792458 };
      const k = Math.min(1 / (4 * T), 0.3 * Math.sqrt(thr / Math.max(Math.hypot(...back), 1e-15)));
      return out(lin(ref.vel, 1, back, k), lin(g.acc, -1, g.acc, 0));
    }
    this.ourAnchor = null;
    if (P.auto === "land" || P.auto === "takeoff") return this.ourSurfaceWant(nav, g, say, out, T);
    if (P.auto === "dock") return this.dockWant(nav, say, out);
    if (P.auto !== "approach" && P.auto !== "orbit" && P.auto !== "circularize") return say(`${AUTO_NAMES[P.auto]}: not in our universe (yet)`);
    // (circularize: around the body of the sphere of influence, at the height it is engaged at)
    const circ = P.auto === "circularize";
    const tgt = (circ ? nav.ref : s.target) as Body;
    const Tg = ourTarget(s, tgt, t);
    const d = sub3(Tg.pos, nav.X);
    const D = Math.hypot(...d);
    const dh = lin(d, 1 / Math.max(D, 1e-30), d, 0);
    const rel = sub3(nav.V, Tg.vel);
    const sb = OUR_BODIES.find((b) => b.id === tgt);
    const soi = sb && sb.id !== "sun" ? soiOf(tgt, t) : Infinity;
    const air = GARGANTUA_SYSTEM.bodies.find((b) => b.id === tgt)?.surface?.atmosphere;
    // (a low orbit: 10 % of the radius, above 12 scale heights of air)
    const low = Tg.radius * 1.1 + (air ? (12 * air.H) / 1.476625e11 : 0);
    if (P.auto === "orbit" && !(Tg.mass > 0)) return say("Orbit: select a body with a mass");
    if (circ) return this.ourCircWant(nav, Tg, say, out);
    const orbiting = P.auto === "orbit" && D < Math.min(soi, 50 * Tg.radius) && D > Tg.radius;
    if (orbiting) {
      if (!this.ourOrbitR || this.ourOrbitR.body !== tgt) this.ourOrbitR = { body: tgt, r: circ ? Math.max(D, Tg.radius * 1.01) : Math.max(D, low) };
      const r = this.ourOrbitR.r;
      const Rh = lin(dh, -1, dh, 0);
      let n = cross(Rh, rel);
      if (Math.hypot(...n) < 1e-12 * Math.hypot(...rel) || Math.hypot(...rel) < 1e-15) n = cross(Rh, [0, 0, 1]);
      if (Math.hypot(...n) < 1e-12) n = cross(Rh, [1, 0, 0]);
      n = lin(n, 1 / Math.hypot(...n), n, 0);
      const th = cross(n, Rh);
      const vc = Math.sqrt(Tg.mass / D);
      // (the height held: a gentle radial pull back, a small part of the circular speed)
      const vr = Math.max(-0.2, Math.min(0.2, (r - D) / (0.1 * r))) * vc * 0.5;
      return out(lin(lin(Tg.vel, 1, th, vc), 1, Rh, vr));
    }
    this.ourOrbitR = null;
    // approach: the stand-off, and the speed that still stops there
    const stand = Tg.mass > 0 ? (P.auto === "orbit" ? low : Math.max(3 * Tg.radius, low)) : Math.max(3 * Tg.radius, 1e-5);
    const left = D - stand;
    const a = 0.6 * thr;
    const vmax = s.engine === "crew" ? 0.2 : 0.5;
    const vClose = Math.min(vmax, Math.sqrt(2 * a * Math.max(left, 0)));
    const closing = -dot3(rel, dh);
    // (arrived: within a tenth of the stand-off, slower than a fifth of the orbital speed there — or,
    // no mass, than what the engine stops over a tenth of it)
    const vArrive = Math.max(Math.sqrt(Tg.mass / Math.max(D, 1e-30)), Math.sqrt(2 * 0.6 * thr * 0.1 * stand)) * 0.2;
    if (Math.abs(left) < 0.1 * stand && D > Tg.radius && Math.hypot(...rel) < vArrive) {
      if (this.ourWarp !== null) s.timeSpeed = this.ourWarp;
      this.ourWarp = null;
      // (the rails forget the approach's warps: not a wish of the pilot's)
      this.warpWant = null;
      this.warpSet = s.timeSpeed;
      if (Tg.mass > 0) {
        P.setAuto("orbit");
        this.onPilotMessage?.(`In orbit around ${BODY_NAMES[tgt]}`);
      } else {
        P.setAuto("hover");
        this.onPilotMessage?.(`Arrived: ${BODY_NAMES[tgt]}`);
      }
      return out(Tg.vel);
    }
    // the warp: an arrival in ~8 s (the rails still hold it near bodies); the pilot's wish kept
    // (no Zeno ending: the last twentieth of the stand-off at the pace of a braking over it)
    const ttg = (Math.abs(left) + 0.05 * stand) / Math.max(Math.abs(closing), vClose * 0.5, Math.sqrt(2 * 0.6 * thr * 0.05 * stand), 1e-12);
    this.hubNote = { left: left * M_METRES, closing: -closing * 299792458, ttg: ttg * 4.925490947e-6 * s.massSolar, stand: stand * M_METRES, name: BODY_NAMES[tgt] ?? tgt };
    if (this.ourWarp === null) this.ourWarp = s.timeSpeed;
    s.timeSpeed = Math.min(Math.max(ttg / 8, 1e-4), Math.max(this.railsLimit(cam).lim, 1e-4), 1e5);
    let want = lin(Tg.vel, 1, dh, left >= 0 ? vClose : -Math.min(vmax, Math.sqrt(2 * a * -left)));
    // (never through a planet: near the body of the sphere of influence — not the target — the part
    // of the wanted motion that dives towards it is taken off: the ship climbs, spiralling out)
    if (nav.ref !== tgt && nav.ref !== "sun") {
      const rb = OUR_BODIES.find((b) => b.id === nav.ref)?.radius ?? 0;
      const Rv = sub3(nav.X, nav.refPos);
      const Rd = Math.hypot(...Rv);
      if (Rd < 10 * rb) {
        const Rh = lin(Rv, 1 / Rd, Rv, 0);
        const u = sub3(want, nav.refVel);
        const ur = dot3(u, Rh);
        if (ur < 0) want = lin(want, 1, Rh, -ur);
      }
    }
    return out(want);
  }

  /**
   * Our universe's landing and take-off (the body of the sphere of influence, if it has a ground):
   *  - land: the horizontal motion over the ground killed, the descent spread over the time that takes
   *    and no faster than half the engine's margin over the weight can stop (v² = 2 a h), a flare of
   *    5 s at the end, 1.5 m/s at touchdown;
   *  - take-off: up, turning towards the east (the way the ground turns) as it climbs, to the circular
   *    speed at a low orbit (~200 km on the Earth: above 12 scale heights of air), the speed through
   *    the air held to a drag of 30 % of the thrust (a gravity turn); then circularize.
   * The feed-forward holds the ship against its weight and the drag.
   */
  /**
   * The take-off's goal — the flight computer's LAUNCH and the hub's TAKE OFF fly the same: the orbit's
   * height [km] (null: the lowest safe, above the air), its inclination [°] (null: due east, the ground's
   * turn given for free).
   */
  launchGoal: { altKm: number | null; incDeg: number | null } = { altKm: null, incDeg: null };

  private ourSurfaceWant(nav: NonNullable<ReturnType<CameraController["ourNav"]>>, g: ReturnType<typeof gravityHome>, say: (t: string) => null,
    out: (v: Vec3, ff?: Vec3) => { beta: Vec3; ff: Vec3 }, T: number) {
    const P = this.pilot;
    const id = nav.ref;
    const what = P.auto === "land" ? "Landing" : "Take-off";
    const name = BODY_NAMES[id as Body] ?? id;
    if (id === "sun" || !solidBody(id)) return say(`${what}: get near a body with a ground first (${name} has none)`);
    if (!VESSELS[fleet.active].lands) return say(`${what}: the ${VESSELS[fleet.active].name} never lands — it was built in orbit (the Ranger and the Lander land)`);
    const sb = solarBody(id)!;
    const c = 299792458;
    const Pb = nav.refPos;
    const r = Math.hypot(...sub3(nav.X, Pb));
    const up = lin(sub3(nav.X, Pb), 1 / r, nav.X, 0);
    const h = Math.max(gearHeight(id, nav.X, nav.t), 0) / M_METRES;
    const gw = sb.mass / (r * r);
    const thr = this.thrustMax();
    if (thr < 1.05 * gw) {
      const gU = 299792458 ** 2 / M_METRES / 9.80665;
      return say(`${what}: the engine (${(thr * gU).toFixed(1)} g) cannot hold the weight on ${name} (${(gw * gU).toFixed(2)} g)`);
    }
    // (held against gravity and, in the air, its drag)
    const ff = lin(lin(g.acc, 1, dragAccel(id, nav.X, nav.V, nav.t), 1), -1, g.acc, 0);
    const minute = 60 / 492.5490947; // [M]
    const gv = groundVelocity(id, nav.X, nav.t);
    if (P.auto === "land") {
      if (this.ourLanded) {
        P.setAuto("land");
        this.onPilotMessage?.(`Landed on ${name}`);
        return null;
      }
      const va = sub3(nav.V, gv);
      const vv = dot3(va, up);
      const vh = Math.hypot(va[0] - vv * up[0], va[1] - vv * up[1], va[2] - vv * up[2]);
      const tH = vh / (0.5 * thr);
      const vd = -Math.max(Math.min(Math.sqrt(2 * 0.5 * (thr - gw) * h), h / (minute / 12 + tH), 0.02), 1.5 / c);
      // (the descent rate first: its correction rides with the hold against gravity, the horizontal
      // speed is killed with the thrust left — a fall is never traded for a sideways error)
      return out(lin(gv, 1, up, vv), lin(ff, 1, up, (vd - vv) / T));
    }
    // take-off
    const air = sb.atmosphere;
    const LG = this.launchGoal;
    const d0 = sb.radius + Math.max(air ? (1.5 * 12 * air.H) / M_METRES : 0, 0.03 * sb.radius, LG.altKm !== null ? (LG.altKm * 1e3) / M_METRES : 0);
    // (the climb aimed a little above the height asked — it slows as it nears its aim — and the orbit
    // made circular once the height is reached)
    const dAim = d0 + 0.04 * (d0 - sb.radius);
    const f = Math.min(Math.max((r - sb.radius) / (dAim - sb.radius), 0), 1);
    const pole = unitV(spinAxis(id));
    let east = cross(pole, up);
    if (Math.hypot(...east) < 1e-12) east = cross([0, 0, 1], up);
    east = unitV(east);
    // (an inclination asked: the launch azimuth for it — sin az = cos i / cos latitude, prograde —, the
    // nearest reachable when the site's latitude is above it)
    if (LG.incDeg !== null) {
      const north = cross(up, east);
      const cl = Math.sqrt(Math.max(1 - dot3(up, pole) ** 2, 1e-9));
      const sinAz = clamp(Math.cos((LG.incDeg * Math.PI) / 180) / cl, -1, 1);
      const az = Math.asin(sinAz);
      east = unitV(lin(north, Math.cos(az), east, sinAz));
    }
    const vc = Math.sqrt(sb.mass / r);
    let vUp = Math.min(Math.sqrt((thr - gw) * (d0 - sb.radius)) * 0.5, (d0 - sb.radius) / (3 * minute), 0.02) * (1 - f) + 0.2 / c;
    const vE = vc * Math.sqrt(f);
    const vi = sub3(nav.V, nav.refVel);
    if (r >= d0 && Math.abs(dot3(vi, east) / vc - 1) < 0.08) {
      P.auto = "none";
      P.setAuto("circularize");
      this.onPilotMessage?.(`In orbit around ${name}`);
      return null;
    }
    // (inertial east speed: the ground already gives its turning at lift-off)
    const vGroundE = dot3(sub3(gv, nav.refVel), east);
    let vEastAir = Math.max(vE, vGroundE * (1 - f)) - vGroundE;
    // in the air: the speed through it no more than keeps the craft's own drag (½ ρ v² C_D A / m) under
    // 30 % of the thrust, and the dynamic pressure under 35 kPa (max-Q) — straight up through the thick
    // air first, turning east as it thins (a gravity turn)
    const rho = ourAir(id, h * M_METRES);
    if (rho > 0) {
      const k = Math.max(this.dragPerMass(), 1e-6);
      const vMax = Math.min(Math.sqrt((0.6 * thr * (c * c / M_METRES)) / (rho * k)), Math.sqrt((2 * 35e3) / rho)) / c;
      vUp = Math.min(vUp, vMax);
      const hMax = Math.sqrt(Math.max(vMax * vMax - vUp * vUp, 0));
      vEastAir = Math.max(Math.min(vEastAir, hMax), -hMax);
    }
    // (an inclination asked: the ground's own turn across the launch's heading taken off as the craft
    // climbs — else it is left in the orbit, which then comes out flatter)
    let want = lin(lin(gv, 1, up, vUp), 1, east, vEastAir);
    if (LG.incDeg !== null) {
      const gi = sub3(gv, nav.refVel);
      const across = lin(lin(gi, 1, east, -dot3(gi, east)), 1, up, -dot3(gi, up));
      want = lin(want, 1, across, -f);
    }
    return out(want, ff);
  }

  private ourOrbitR: { body: string; r: number } | null = null;

  /** what the autopilots measured as they flew (our universe): the approach's, the hold's */
  private hubNote: { left?: number; closing?: number; ttg?: number; stand?: number; name?: string; off?: number; drift?: number } = {};
  private hubCache: { at: number; v: HubInfo | null } | null = null;

  /**
   * The hub's card: the autopilot flying, what it does now, its figures, and what it predicts — the
   * orbit after its burn, the deorbit's heat and load, the touchdown, the arrival. Redone 4 times a
   * second at most. Null: no autopilot.
   */
  hubInfo(): HubInfo | null {
    const now = performance.now();
    if (this.hubCache && now - this.hubCache.at < 250) return this.hubCache.v;
    let v: HubInfo | null = null;
    try {
      v = this.hubCompute();
    } catch {
      v = null;
    }
    this.hubCache = { at: now, v };
    return v;
  }

  private hubCompute(): HubInfo | null {
    const P = this.pilot, a = P.auto, s = this.s;
    if (a === "none") return null;
    const C = 299792458;
    const Msec = 4.925490947e-6 * s.massSolar;
    const km = (m: number) => (!Number.isFinite(m) ? "∞" : Math.abs(m) >= 1e5 ? `${Math.round(m / 1e3).toLocaleString("en-US")} km` : Math.abs(m) >= 1e3 ? `${(m / 1e3).toFixed(1)} km` : `${Math.round(m)} m`);
    const ms = (x: number) => (!Number.isFinite(x) ? "—" : Math.abs(x) >= 1e4 ? `${(x / 1e3).toFixed(2)} km/s` : `${x.toFixed(Math.abs(x) < 10 ? 1 : 0)} m/s`);
    const dur = (x: number) => (!Number.isFinite(x) ? "—" : x < 0 ? "now" : fmtDur(x));
    const fc = this.fcContext();
    const orbitOf = (r: KV3, v: KV3) => {
      if (!fc) return "";
      const e = kepElements(fc.ctx.mu, r, v, fc.ctx.pole ?? [0, 0, 1]);
      const R = fc.ctx.R;
      return e.e < 1 ? `${km(e.rp - R)} × ${km(e.ra - R)}` : `escape · Pe ${km(e.rp - R)}`;
    };
    const base = (title: string, phase: string, rows: [string, string][] = [], next: string | null = null, bar: number | null = null): HubInfo => ({ mode: a, title, phase, rows, next, bar });
    // a burn planned and flown (the node autopilot; CIRC's own burn)
    if (a === "node" || a === "burns") {
      const pl = this.fcPlan();
      const b = pl?.burns[0];
      if (!pl || !b) return base("NODE", "no burn left");
      const circ = !!this.ourCirc;
      const dv = Math.hypot(...b.dv);
      const thrSI = this.thrustMax() * (C ** 2 / (1476.625 * s.massSolar));
      const burnT = thrSI > 0 ? dv / thrSI : NaN;
      const doneM = a === "node" ? this.nodeDone * C : this.fcBurns[0]?.done ?? 0;
      const burning = a === "node" ? this.nodeBurning : !!this.fcBurns[0]?.firing;
      const start = b.t - burnT / 2;
      let next: string | null = null;
      if (fc) {
        // (after the burn, impulsive: the orbit it leaves)
        const at = kepProp(fc.ctx.mu, fc.ctx.r, fc.ctx.v, Math.max(b.t, 0));
        const d = fromPNR(at.r, at.v, b.dv as KV3);
        const v2 = burning ? fc.ctx.v : ([at.v[0] + d[0], at.v[1] + d[1], at.v[2] + d[2]] as KV3);
        next = circ && this.ourCirc?.altKm !== undefined ? `→ circular at ${this.ourCirc.altKm.toFixed(0)} km` : burning ? null : `→ ${orbitOf(at.r, v2)}`;
      }
      const where = circ ? (this.ourCirc?.where === "pe" ? "the periapsis" : "the apoapsis") : pl.burns.length > 1 ? `burn 1 of ${pl.burns.length}` : "the burn";
      const phase = burning ? "burning" : start > 120 ? `coasting to ${where}, the time sped up` : `turning to ${where}`;
      const rows: [string, string][] = burning
        ? [["Δv left", ms(Math.max(dv - doneM, 0))], ["Burn", `${dur(Math.max(dv - doneM, 0) / Math.max(thrSI, 1e-9))} left`]]
        : [["Burn in", dur(start)], ["Δv", ms(dv)], ["Length", dur(burnT)]];
      return { mode: circ ? "circularize" : a, title: circ ? "CIRC" : "NODE", phase, rows, next, bar: burning ? Math.min(doneM / Math.max(dv, 1e-9), 1) : null };
    }
    if (a === "circularize") {
      if (fc && this.ourCirc) {
        const r = fc.ctx.r, v = fc.ctx.v;
        const rl = Math.hypot(...r);
        const up = r.map((x) => x / rl) as KV3;
        const vr = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
        const vh = v.map((x, i) => x - vr * up[i]!) as KV3;
        const vc = Math.sqrt(fc.ctx.mu / rl);
        const err = Math.hypot(...vh.map((x, i) => x - (vc * x) / Math.hypot(...vh)), vr) || 0;
        return base("CIRC", "trimming to the circle", [["Error", ms(err)], ["Orbit", orbitOf(r, v)]], `→ circular at ${km(rl - fc.ctx.R)}`);
      }
      return base("CIRC", fc?.universe === "ours" ? "planning the burn" : "closing on the circular velocity");
    }
    if (a === "entry") {
      const R = this.entryRun;
      const site = R?.site ? R.site.name.split(",")[0]! : "the nearest site";
      if (!R) return base("ENTRY", "starting");
      if (R.phase === "plan") return base("ENTRY", `planning the deorbit to ${site}`);
      const nowS = this.nowTime() * Msec;
      const heat = R.plan ? `→ then ${(R.plan.heat / 1e4).toFixed(0)} W/cm² · ${R.plan.g.toFixed(1)} g · shield ${Math.round(R.plan.shield)} K, down at ${site}` : `→ down at ${site}`;
      if (R.phase === "wait") return base("ENTRY", "coasting to the deorbit burn, the time sped up", [["Burn in", dur(R.tBurn - nowS)], ["Δv", ms(R.dv)], ["Site", site]], heat);
      if (R.phase === "burn") return base("ENTRY", "the deorbit burn, retrograde", [["Δv", `${R.done.toFixed(0)} / ${R.dv.toFixed(0)} m/s`], ["Site", site]], heat, Math.min(R.done / Math.max(R.dv, 1e-9), 1));
      const LA = this.airFlight.last;
      if (R.phase === "entry") {
        const miss = R.guid?.lastMiss;
        const rows: [string, string][] = [["Site", site]];
        if (LA) rows.push(["Mach", LA.out.mach.toFixed(1)], ["Height", km(LA.h)]);
        rows.push(["Bank", `${Math.round((R.bank * 180) / Math.PI)}°`]);
        return base("ENTRY", LA && LA.out.q > 50 ? "the guided entry — the bank flown to the site" : "falling to the air", rows, miss ? `→ hand-over ${km(miss.dist)} from its aim (Mach ${R.handover})` : heat);
      }
      // the glide
      const app = R.app;
      const legs: Record<string, string> = { join: "joining the runway's axis", toStart: "to the final's start", downwind: "downwind", turn: "turning onto the final", final: "on the final" };
      const profs: Record<string, string> = { outer: "the steep slope", preflare: "the pull-up", inner: "the shallow slope", flare: "the flare", rollout: "the touchdown" };
      const phase = R.leg === "final" && R.prof ? `${legs.final} — ${profs[R.prof.phase]}` : legs[R.leg ?? "join"] ?? "gliding";
      const rows: [string, string][] = [["Site", site]];
      if (app) {
        rows.push(["To the threshold", km(Math.hypot(app.along, app.across))], ["Height", km(app.agl)], ["Speed", ms(app.speed)]);
        if (R.prof && R.leg === "final") rows.push(["Profile", `${app.agl - R.prof.h >= 0 ? "+" : "−"}${Math.abs(Math.round(app.agl - R.prof.h))} m`]);
      }
      const td = R.prof?.td ?? LANDING.td;
      const tGo = app ? (td - app.along) / Math.max(app.speed * 0.85, 1) : NaN;
      return base("ENTRY", phase, rows, app ? `→ touchdown ${td} m past the threshold${R.leg === "final" && Number.isFinite(tGo) && tGo > 0 ? ` in ~${dur(tGo)}` : ""}` : null);
    }
    const sf = this.surfaceInfo() as { alt?: number; vVert?: number; vHor?: number; landed?: boolean } | null;
    if (a === "land") {
      if (!sf || sf.alt === undefined) return base("LAND", "descending");
      const vs = sf.vVert ?? 0;
      const t = sf.alt / Math.max(-vs, 0.5);
      return base("LAND", sf.landed ? "down" : (sf.vHor ?? 0) > 2 ? "killing the sideways speed, descending" : sf.alt < 30 ? "the touchdown" : "descending", [["Height", km(sf.alt)], ["V/S", ms(vs)], ["Sideways", ms(sf.vHor ?? 0)]], sf.landed ? null : `→ touchdown in ~${dur(t)}, at ~1.5 m/s`);
    }
    if (a === "takeoff") {
      const LG = this.launchGoal;
      const rows: [string, string][] = [];
      // (the height it climbs to: the one asked, else clear of the air — 1.5 × its top — or 3 % of the radius)
      const Rkm = fc ? fc.ctx.R / 1e3 : 0;
      const goal = LG.altKm ?? Math.round(Math.max(1.5 * airTopKm(fc?.body ?? ""), 0.03 * Rkm));
      let next: string | null = `→ up to ~${goal} km, then CIRC at the apoapsis`;
      if (fc) {
        const e = kepElements(fc.ctx.mu, fc.ctx.r, fc.ctx.v, fc.ctx.pole ?? [0, 0, 1]);
        const rl = Math.hypot(...fc.ctx.r);
        rows.push(["Height", km(rl - fc.ctx.R)], ["Apoapsis", e.e < 1 ? km(e.ra - fc.ctx.R) : "escape"], ["Speed", `${Math.round((100 * Math.hypot(...fc.ctx.v)) / Math.sqrt(fc.ctx.mu / rl))} % of circular`]);
        if (e.rp > fc.ctx.R) next = `→ in orbit: ${km(e.rp - fc.ctx.R)} × ${km(e.ra - fc.ctx.R)}`;
      }
      const thick = !!sf && (sf.alt ?? 0) < airTopKm(fc?.body ?? "") * 1e3 * 0.4;
      return base("TAKE OFF", thick ? "climbing through the thick air" : "the gravity turn, to orbit", rows, next);
    }
    const N = this.hubNote;
    if (a === "approach" && N.left !== undefined) {
      return base("APPROACH", N.left > 0 ? `closing on ${N.name}` : `backing off to the stand-off`, [["To the stand-off", km(N.left)], ["Closing", ms(N.closing ?? 0)]], `→ beside ${N.name} (${km(N.stand ?? 0)} off) in ~${dur(N.ttg ?? NaN)}`);
    }
    if (a === "hover" && N.off !== undefined) return base("HOLD POS", "holding the place", [["Off it", km(N.off)], ["Drift", ms(N.drift ?? 0)]]);
    if (a === "dock") return base("DOCK", this.dockAuto?.phase ?? "docking");
    return base(AUTO_NAMES[a].toUpperCase(), "flying");
  }

  /**
   * Our universe's circularization, its run: engaged by the pilot, a burn at the next apsis above the
   * air (the node autopilot flies it: its warp, its finite burn centred), then the trim; after a node
   * (`then: "circularize"`: a capture at its periapsis), the trim where it is. Null: not running.
   */
  ourCirc: { mode: "node" | "trim"; where?: "ap" | "pe"; altKm?: number; dv?: number; tNode?: number; spent0?: number; since?: number } | null = null;

  /**
   * The circle the pilot asks for: the cheaper of a burn at the next apoapsis and one at the next
   * periapsis — the sooner, both above the air (a hyperbola: its periapsis) —, as the flight computer's
   * circularization (fc/ops.ts). Null: circular already (the trim alone). A string: why not.
   */
  private circPlan(): { burns: Burn[]; note: string; where: "ap" | "pe"; altKm: number; dv: number; t: number } | string | null {
    const fc = this.fcContext();
    if (!fc) return "Circularize: near a body";
    const c = fc.ctx;
    const el = kepElements(c.mu, c.r, c.v, c.pole ?? [0, 0, 1]);
    const safe = c.R + (airTopKm(fc.body) + 10) * 1e3;
    if (el.e < 1 && el.ra - el.rp < 2e3) return null;
    const cands: { where: "ap" | "pe"; t: number; r: number }[] = [];
    if (el.e < 1 && el.ra > safe) cands.push({ where: "ap", t: kepTimeTo(el, Math.PI), r: el.ra });
    if (el.rp > safe) cands.push({ where: "pe", t: kepTimeTo(el, 0), r: el.rp });
    if (!cands.length) return el.e < 1 ? `Circularize: the orbit is in the air (apoapsis ${((el.ra - c.R) / 1e3).toFixed(0)} km) — raise it first` : `Circularize: the periapsis is in the air or below — no circle on this path`;
    // (an apsis half a burn away or passed: the other one, if there is one)
    const ok = cands.filter((q) => Number.isFinite(q.t) && q.t > 20);
    const pick = (ok.length ? ok : cands).sort((a, b) => a.t - b.t)[0]!;
    const r = fcCircularize(c, pick.where);
    if (!r.ok || !r.burns.length) return `Circularize: ${r.note}`;
    return { burns: r.burns, note: r.note, where: pick.where, altKm: (pick.r - c.R) / 1e3, dv: r.dvTotal, t: r.burns[0]!.t };
  }

  /** The circularization's frame: the plan made (pilot's), or the trim — the circular velocity where it is. */
  private ourCircWant(nav: NonNullable<ReturnType<CameraController["ourNav"]>>, Tg: { pos: Vec3; vel: Vec3; mass: number; radius: number }, say: (t: string) => null, out: (v: Vec3, ff?: Vec3) => { beta: Vec3; ff: Vec3 }) {
    const P = this.pilot;
    const C = 299792458;
    const rel = sub3(nav.V, Tg.vel);
    const Rv = sub3(nav.X, Tg.pos);
    const D = Math.hypot(...Rv);
    const Rh = lin(Rv, 1 / D, Rv, 0);
    const fmtT = (x: number) => (x < 90 ? `${Math.round(x)} s` : x < 5400 ? `${Math.round(x / 60)} min` : `${(x / 3600).toFixed(1)} h`);
    if (!this.ourCirc) {
      const plan = this.circPlan();
      if (typeof plan === "string") return say(plan);
      if (plan) {
        this.fcSetPlan(plan.burns, plan.note);
        const n0 = this.plan.nodes[0] as { then?: string; t: number } | undefined;
        if (n0) n0.then = "circularize";
        this.ourCirc = { mode: "node", where: plan.where, altKm: plan.altKm, dv: plan.dv, tNode: n0?.t, spent0: this.spent };
        P.auto = "none";
        P.setAuto("node");
        this.onPilotMessage?.(`Circularize at the ${plan.where === "ap" ? "apoapsis" : "periapsis"} (${plan.altKm.toFixed(0)} km) in ${fmtT(plan.t)}: ${plan.dv.toFixed(0)} m/s`);
        return out(nav.V);
      }
      this.ourCirc = { mode: "trim", spent0: this.spent };
    }
    if (this.ourCirc.mode !== "trim") this.ourCirc = { ...this.ourCirc, mode: "trim" };
    const R = this.ourCirc;
    R.since ??= performance.now();
    // the trim: the circular velocity where the craft is — horizontal, in its plane —, no height held
    let n = cross(Rh, rel);
    if (Math.hypot(...n) < 1e-12 * Math.hypot(...rel) || Math.hypot(...rel) < 1e-15) n = cross(Rh, [0, 0, 1]);
    n = lin(n, 1 / Math.hypot(...n), n, 0);
    const th = cross(n, Rh);
    const vc = Math.sqrt(Tg.mass / D);
    const err = Math.hypot(...sub3(rel, lin(th, vc, th, 0))) * C;
    // (done: within 0.2 m/s — or, the trim's minute out, within 2)
    const age = (performance.now() - R.since) / 1000;
    if (err < 0.2 || (age > 60 && err < 2)) {
      const fc = this.fcContext();
      const el = fc ? kepElements(fc.ctx.mu, fc.ctx.r, fc.ctx.v, fc.ctx.pole ?? [0, 0, 1]) : null;
      const used = (this.spent - (R.spent0 ?? this.spent)) * C;
      this.ourCirc = null;
      P.setAuto("none");
      this.onPilotMessage?.(el && fc ? `Circular: ${((el.rp - fc.ctx.R) / 1e3).toFixed(0)} × ${((el.ra - fc.ctx.R) / 1e3).toFixed(0)} km — ${used.toFixed(0)} m/s spent` : "Circular");
      return null;
    }
    return out(lin(Tg.vel, 1, th, vc));
  }
  /** the pilot's warp while our approach sets it (given back on arrival) */
  private ourWarp: number | null = null;

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
    // our universe: Newtonian autopilots in the home frame
    if (this.ourNav(cam)) return this.ourWant(cam, say, T);
    if (P.auto === "dock") return say("Docking: with the ISS, in our solar system");
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
    const hz = this.horizonAxes(cam);
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
        maneuver: C(this.maneuverDir(cam)),
        // velocity relative to the target (approach, docking)
        tgtPrograde: null as Vec3 | null,
        tgtRetrograde: null as Vec3 | null,
        /** the station's nearest docking port, seen from the eye */
        dock: null as Vec3 | null,
        /** near a world (ours, or one of Gargantua's): the local vertical and its north (the horizon,
         *  the pitch ladder, the heading) — at any height in its sphere */
        up: C(hz?.up ?? null),
        north: C(hz?.north ?? null),
        /** near the ground: the velocity over it, its horizontal part's direction (the drift) */
        drift: this.driftDir(cam, C),
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
      air: this.airInfo(),
      entry: this.entryInfo(),
      /** the engine and the tank */
      engine: { kind: s.engine, max: this.thrustMax(), fuel: s.fuel ? tank(s, this.spent) : null },
      /** the selected target: distance (centre to centre, flat map) and range rate (> 0: receding) */
      target: s.target,
      targetDist: NaN,
      targetRate: NaN,
      /** our universe: the body of the sphere of influence, the altitude above it [M] and the radial speed */
      ref: null as string | null,
      ourAlt: NaN,
      ourVr: NaN,
      ourCa: null as { d: number; t: number } | null,
      /** the docking aid (the station near), or null */
      dock: null as DockInfo | null,
      /** the docking's guide for the HUD: lateral offset and drift [m, m/s], the port's axis, gates
       *  along it (camera coordinates) */
      dockGuide: null as { lat: Vec3; latRate: Vec3; axis: Vec3; gates: { d: Vec3; r: number; k: number }[] } | null,
      /** what the flown craft is docked to (its own links) */
      links: [] as { title: string; port: string }[],
      /** the craft flown, and those docked to it; the assembly's mass [kg] */
      vessel: fleet.active,
      assembly: fleet.flownAssembly(),
      mass: fleet.massProps().mass,
      /** the docking autopilot's phase ("": off) */
      dockPhase: this.pilot.auto === "dock" ? this.dockAuto?.phase ?? "" : "",
      speedMode: this.speedMode,
      precision: this.pilot.precision,
      /** our universe: the free-fall path and the path through the nodes */
      ourFree: this.ourFree,
      ourPlan: this.plan.nodes.length ? this.ourPlan : null,
      /** the planner at work (our universe) */
      planBusy: this.planBusy,
      /** a mission's target at its periapsis time (the map marks where it will be) */
      ourArrive: this.ourMission && this.plan.nodes.length ? { body: this.ourMission.goal.target, t: this.ourMission.tArrive }
        : this.issGoal && this.plan.nodes.length ? { body: this.issGoal.body, t: this.issGoal.tArrive } : null,
      // (the flight computer's previewed operation and its path, before it is executed)
      cand: this.fcCand,
      // (about one of Gargantua's worlds: the ground tracks, free and previewed, on its turning axes)
      localGround: this.local ? { ahead: this.localGround, cand: this.fcCand?.local?.rot ?? null, plan: this.localPlanNow()?.rot ?? null } : null,
      localPlan: this.localPlanNow(),
      /** the hub's card: the autopilot flying, its phase, figures, prediction */
      hub: this.hubInfo(),
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
    // our universe: orbital directions and speed relative to the body of the sphere of influence we
    // are in; the target in the home frame
    const nav = this.ourNav(cam);
    if (nav) {
      const rel = sub3(nav.V, nav.refVel);
      const rl = Math.hypot(...rel);
      info.speed = rl;
      info.ref = nav.ref;
      const pr = rl > 1e-12 ? nav.toRep(rel) : null;
      const p = pr && lin(pr, 1 / Math.hypot(...pr), pr, 0);
      const R = nav.radial;
      let nrm: Vec3 | null = null;
      if (p) {
        const n = cross(R, p);
        const l = Math.hypot(...n);
        if (l > 1e-6) nrm = lin(n, 1 / l, n, 0);
      }
      Object.assign(info.dirs, {
        prograde: C(p), retrograde: C(p && lin(p, -1, p, 0)), radialOut: C(R), radialIn: C(lin(R, -1, R, 0)),
        normal: C(nrm), antinormal: C(nrm && lin(nrm, -1, nrm, 0)),
      });
      info.X = nav.X;
      info.V = nav.V;
      const T = ourTarget(s, s.target, nav.t);
      const d = sub3(nav.X, T.pos);
      info.targetDist = Math.hypot(...d);
      const vr = sub3(nav.V, T.vel);
      info.targetRate = dot3(vr, d) / Math.max(info.targetDist, 1e-12);
      const vl = Math.hypot(...vr);
      // closest approach on straight lines (relative motion)
      const tc = vl > 1e-15 ? -dot3(d, vr) / (vl * vl) : 0;
      info.ourCa = tc > 0 ? { d: Math.hypot(...lin(d, 1, vr, tc)) - T.radius, t: tc } : { d: info.targetDist - T.radius, t: 0 };
      if (vl > 1e-12) {
        const loc = nav.toRep(vr);
        const u = lin(loc, 1 / Math.hypot(...loc), loc, 0);
        info.dirs.tgtPrograde = C(u);
        info.dirs.tgtRetrograde = C(lin(u, -1, u, 0));
      }
      // above the reference body's surface
      const rb = OUR_BODIES.find((b) => b.id === nav.ref)?.radius ?? 0;
      info.ourAlt = Math.hypot(...sub3(nav.X, nav.refPos)) - rb;
      info.ourVr = dot3(rel, sub3(nav.X, nav.refPos)) / Math.max(Math.hypot(...sub3(nav.X, nav.refPos)), 1e-12);
    }
    // the station near: its port where it is seen from the eye, the velocity relative to it (the
    // docking's prograde and retrograde)
    // (the flown craft's dockings: to what, by which port — the docking panel's UNDOCK)
    info.links = fleet.links.filter((l) => l.a === fleet.active || l.b === fleet.active).map((l) => {
      const other = l.a === fleet.active ? l.b : l.a;
      const k = l.a === fleet.active ? l.pb : l.pa;
      return { title: other === "iss" ? "ISS" : VESSELS[other].name, port: other === "iss" ? (station.ports[k]?.name ?? "") : (VESSELS[other].ports[k]?.name ?? "") };
    });
    const di = this.dockInfo;
    if (di && nav) {
      info.dock = di;
      const vl = Math.hypot(...di.vrel);
      if (vl > 1e-4) {
        const u = nav.toRep(lin(di.vrel, 1 / vl, di.vrel, 0));
        const ul = Math.hypot(...u);
        info.dirs.tgtPrograde = C(lin(u, 1 / ul, u, 0));
        info.dirs.tgtRetrograde = C(lin(u, -1 / ul, u, 0));
      }
      const eye = shipToCamera(this.shipPose(), s.shipLookYaw, s.shipLookPitch).t;
      const pc = C(nav.toRep(lin(sub3(di.c, nav.X), M_METRES, di.c, 0)))!;
      const q: Vec3 = [pc[0] + eye[0], pc[1] + eye[1], pc[2] + eye[2]];
      const ql = Math.hypot(...q);
      if (ql > 1e-6) info.dirs.dock = [q[0] / ql, q[1] / ql, q[2] / ql];
      // the docking's guide (the HUD's H5): the offset across the port's axis and its drift (camera
      // coordinates, m and m/s), the axis, and gates along it — 5 to 100 m out — as the eye sees them
      const toCam = (v: Vec3) => {
        const l = Math.hypot(...v);
        if (l < 1e-12) return [0, 0, 0] as Vec3;
        const u = C(nav.toRep(lin(v, 1 / l, v, 0)))!;
        return lin(u, l, u, 0);
      };
      const rel = sub3(di.ring, di.c);
      const lat = lin(rel, M_METRES, di.a, -dot3(rel, di.a) * M_METRES);
      const latRate = lin(di.vrel, 1, di.a, -dot3(di.vrel, di.a));
      const axis = toCam(di.a);
      info.dockGuide = {
        lat: toCam(lat), latRate: toCam(latRate), axis,
        gates: [5, 10, 20, 50, 100].map((k) => {
          const g: Vec3 = [pc[0] + eye[0] + axis[0] * k, pc[1] + eye[1] + axis[1] * k, pc[2] + eye[2] + axis[2] * k];
          const gl = Math.hypot(...g);
          return { d: [g[0] / gl, g[1] / gl, g[2] / gl] as Vec3, r: gl, k };
        }),
      };
    }
    // the navball relative to the target: its speed, its prograde
    if (this.speedMode === "target") {
      const vt = this.targetVelLocal(cam);
      if (vt) {
        const rel = sub3(cam.beta, vt);
        info.speed = Math.hypot(...rel);
        info.dirs.prograde = info.dirs.tgtPrograde;
        info.dirs.retrograde = info.dirs.tgtRetrograde;
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
    // our universe: the Newtonian prediction (the map draws it), no path in the hole's frame
    const nav = this.ourNav(cam);
    if (nav) {
      // (the same throttle: there is no path object on this side to carry its time; computed in the
      // planner's worker — up to ~17 ms a time on the main thread — the first one here)
      if (this.predicting || (this.ourFree && (key === this.ourFreeKey || now - this.ourFreeAt < 250))) return (this.path = null);
      this.ourFreeKey = key;
      this.ourFreeAt = now;
      const mouthR = mouth(s).w.rho;
      // (the first one here, whole: without it the telemetry and the map fall back to costlier work —
      // measured: a 150–220 ms task when it came from the worker a few frames later)
      if (!this.ourFree) {
        this.ourFree = predictOurs(nav.X, nav.V, nav.t, [], { mouthR, drag: this.dragPerMass() });
        return (this.path = null);
      }
      this.predicting = true;
      runPlanner<OurPath>({ kind: "predict", X: nav.X, V: nav.V, t: nav.t, mouthR, drag: this.dragPerMass() }).then(
        (p) => {
          this.predicting = false;
          if (p && Array.isArray(p.pts) && this.ourFreeKey === key) this.ourFree = p;
        },
        () => (this.predicting = false),
      );
      return (this.path = null);
    }
    this.ourFree = null;
    if (cam.region !== "hole") return (this.path = null);
    // in one of Gargantua's worlds' frames: the orbit about the world (its two bodies), not the hole's
    // geodesic (a world's orbit about the hole, drawn from the ship — meaningless at its scale)
    if (this.local && !this.local.L.landed) {
      const tr = this.localTrack([], 1.05, 240);
      if (tr) {
        this.localGround = tr.rot;
        const p = { pts: tr.pts.slice(1), fate: "local" as const, at: now, dt: tr.dt };
        return (this.path = p);
      }
    }
    const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, s.spin, this.nowTime());
    // up to 0.95 of a turn around the hole: a bound orbit shows almost a full revolution without
    // coming back past the camera (a segment that close would sweep across the whole view)
    const tMax = clamp(2 * 2 * Math.PI * cam.r ** 1.5, 300, 60000);
    // (in the planner's worker — 6–12 ms a time here before —: the last path drawn meanwhile)
    if (this.kerrPending) return this.path;
    this.kerrPending = true;
    // (the answer kept — a few hundred ms old at most — unless the ship has left the hole's region: the
    // key holds the clock and the ship's motion, so in flight it is never the same twice — and a path
    // left from elsewhere, old, let every call renew it: every answer was dropped, none drawn)
    runPlanner<{ pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "star" } | { error: string }>({ kind: "kerrPath", s: { ...s }, st, tMax }).then(
      (r) => {
        this.kerrPending = false;
        if (!r || "error" in r || cameraFrame(this.s).region !== "hole" || this.ourNav(cameraFrame(this.s))) return;
        this.path = this.kerrPathFrom(r, st, tMax, now);
      },
      () => (this.kerrPending = false),
    );
    return this.path;
  }

  /** The drift over the ground near a world (the horizontal part of the velocity over it), camera
   *  coordinates; null when still or away from the ground. */
  private driftDir(cam: ReturnType<typeof cameraFrame>, C: (v: Vec3) => Vec3 | null): Vec3 | null {
    const fr = this.sfFrame(cam);
    if (!fr) return null;
    const vh = lin(fr.vRel, 1, fr.up, -dot3(fr.vRel, fr.up));
    if (Math.hypot(...vh) < 0.05) return null;
    return C(fr.toLocal(vh));
  }

  /**
   * The runway in reach (the HUD's H4): the entry's own when it flies to one, else the nearest on this
   * world within 80 km, the craft below 20 km — its outline, its centreline drawn 15 km back, the aim
   * point 2 km short of the threshold (the glide path's), as the eye sees them; the craft's place along
   * it and across it [m], the glide path asked and flown (the approach's, when it flies).
   */
  runwayView(): RunwayView | null {
    const now = performance.now();
    if (this.runwayCache && now - this.runwayCache.at < 100) return this.runwayCache.v;
    const v = this.runwayCompute();
    this.runwayCache = { at: now, v };
    return v;
  }
  private runwayCache: { at: number; v: RunwayView | null } | null = null;
  private runwayCompute(): RunwayView | null {
    const cam = cameraFrame(this.s);
    const fr = this.entryFrame(cam);
    if (!fr) return null;
    const x = fr.s.x;
    const R = this.entryRun;
    let site: Site | null = R?.site?.runway ? R.site : null;
    const agl = this.aglNow(cam, Math.hypot(...x) - fr.env.R);
    if (!site) {
      if (agl > 20e3) return null;
      let best = 80e3;
      for (const st of SITES) {
        if (st.body !== fr.body || !st.runway) continue;
        const T = fr.place(st);
        const ang = Math.acos(clamp(dot3(unitV(T), unitV(x)), -1, 1));
        const d = ang * Math.hypot(...T);
        if (d < best) (best = d), (site = st);
      }
    }
    if (!site) return null;
    const C = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
    const D = Math.PI / 180;
    const T = fr.place(site);
    const tu = unitV(T);
    const nav = this.ourNav(cam);
    const pole: Vec3 = nav ? unitV(spinAxis(fr.body)) : [0, 0, 1];
    const north = unitV(lin(pole, 1, tu, -dot3(pole, tu)));
    const east = cross(north, tu);
    const hd = (site.rwy ?? 0) * D;
    const along = lin(north, Math.cos(hd), east, Math.sin(hd));
    const rgt = cross(along, tu);
    const see = (P: Vec3) => {
      const d = sub3(P, x);
      return { d: C(fr.toLocal(d)), r: Math.hypot(...d) };
    };
    const L = 4500, Wd = 90;
    const at = (a: number, b: number) => lin(lin(T, 1, along, a), 1, rgt, b);
    const rel = sub3(x, T);
    const sAl = dot3(rel, along), xt = dot3(rel, rgt);
    const app = R?.app ?? null;
    return {
      name: site.name.split(",")[0]!, rwy: site.rwy ?? 0, along: sAl, across: xt, agl,
      corners: [at(0, -Wd / 2), at(L, -Wd / 2), at(L, Wd / 2), at(0, Wd / 2)].map(see),
      line: Array.from({ length: 16 }, (_, k) => see(at(-k * 1000, 0))),
      aim: see(at(R?.prof?.aim ?? -2000, 0)),
      gRef: app?.final ? app.gRef ?? null : null, gam: app?.gam ?? null, final: !!app?.final,
    };
  }

  /**
   * The future in the view (the HUD's H3), from the predicted free fall (ours: the n-body path; Gargantua's
   * side: the geodesic, or a world's orbit): what the eye sees of it — each sample's direction (camera
   * coordinates), distance [m], time ahead [s], and whether the body hides it —, the ship's places at
   * the times asked ([s] ahead), and where it meets the ground (on the ground as it turns now — the spot
   * to look at) or the air's top. The path is kept relative to its body (the body's own motion out of it:
   * where the ship goes about the world the eye sees). Recomputed ten times a second at most.
   */
  futureView(at: number[] = []): FutureView | null {
    const now = performance.now();
    const key = at.join();
    if (this.futureCache && now - this.futureCache.at < 100 && this.futureCache.key === key) return this.futureCache.v;
    const v = this.futureCompute(at);
    this.futureCache = { at: now, key, v };
    return v;
  }
  private futureCache: { at: number; key: string; v: FutureView | null } | null = null;

  private futureCompute(at: number[]): FutureView | null {
    const s = this.s;
    // (the prediction refreshed here too — throttled —: the HUD needs it with the tube and the map off)
    this.predictPath();
    const cam = cameraFrame(s);
    const C = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
    const nav = this.ourNav(cam);
    // the samples: positions (relative to the body, at the body's place now), their times ahead [s]
    let P: Vec3[] = [], T: number[] = [], eye: Vec3, look: (d: Vec3) => Vec3, mPer: number;
    let body: { c: Vec3; R: number } | null = null;
    let impact: FutureView["impact"] = null;
    if (nav) {
      const free = this.ourFree;
      if (!free || free.pts.length < 2) return null;
      const ref = free.refs[0] ?? nav.ref;
      const b = solarBody(ref);
      const t0 = nav.t;
      const B0 = solarState(ref, t0).pos;
      // (from where the ship is now: the path's first sample may be seconds ahead)
      P.push(nav.X);
      T.push(0);
      // near the ground, in the air: the path over the ground as it turns (the frame the craft flies
      // in — at Kennedy the Earth's turn is 400 m/s); higher, the orbit as it is (not turning)
      const turn = !!b && b.kind !== "star" && Math.hypot(...sub3(nav.X, B0)) - b.radius < Math.max(airTop(b.atmosphere), 60e3) / M_METRES;
      const A0 = turn ? bodyAxes(b!, t0) : null;
      for (let j = 0; j < free.pts.length; j++) {
        const t = free.times[j]!;
        if (t <= t0) continue;
        let v = sub3(free.pts[j]!, solarState(ref, t).pos);
        if (A0) {
          const A1 = bodyAxes(b!, t);
          const vb: Vec3 = [dot3(v, A1[0]), dot3(v, A1[1]), dot3(v, A1[2])];
          v = lin(lin(A0[0], vb[0], A0[1], vb[1]), 1, A0[2], vb[2]);
        }
        P.push(lin(v, 1, B0, 1));
        T.push((t - t0) * M_SECONDS);
      }
      eye = cameraHome(s, cam);
      look = (d) => ourLook(s, cam, d);
      mPer = M_METRES;
      if (b && b.kind !== "star") {
        body = { c: B0, R: b.radius };
        const top = airTop(b.atmosphere) / M_METRES;
        const alt = (X: Vec3) => Math.hypot(...sub3(X, B0)) - b.radius;
        // the air's top crossed on the way down (from above it)
        if (top > 0 && P.length && alt(P[0]!) > top) {
          for (let j = 1; j < P.length; j++) if (alt(P[j]!) <= top) {
            impact = { kind: "air", t: T[j]!, ...this.futureSee(C, look, eye, P[j]!, mPer, body) };
            break;
          }
        }
        if (free.fate === "impact" && free.hit === ref) {
          // (the ground there, turned back to where it is now: the spot to look at)
          const tI = free.times[free.times.length - 1]!;
          const v = sub3(free.pts[free.pts.length - 1]!, solarState(ref, tI).pos);
          const A1 = bodyAxes(b, tI), A0 = bodyAxes(b, t0);
          const vb: Vec3 = [dot3(v, A1[0]), dot3(v, A1[1]), dot3(v, A1[2])];
          const X = lin(lin(lin(A0[0], vb[0], A0[1], vb[1]), 1, A0[2], vb[2]), 1, B0, 1);
          const ground = { kind: "ground" as const, t: (tI - t0) * M_SECONDS, ...this.futureSee(C, look, eye, X, mPer, null) };
          impact = impact && impact.kind === "air" ? { ...impact, ground } : ground;
        }
      }
    } else {
      const path = this.path;
      // (a path left from another place — a world's orbit after leaving it —: none)
      if (!path || cam.region !== "hole" || path.pts.length < 2 || (path.fate === "local") !== !!(this.local && !this.local.L.landed)) return null;
      const Msec = 4.925490947e-6 * s.massSolar;
      eye = blToCartesian(cam.r, cam.theta, cam.phi);
      const t0 = this.nowTime();
      // (about one of Gargantua's worlds: its orbit relative to it; about the hole: the geodesic as it is)
      const w = this.local && path.fate === "local" ? this.local.F.id as Body : null;
      const W0 = w ? bodyCentre(s, w, t0) : null;
      P.push(w ? lin(sub3(eye, bodyCentre(s, w, t0)), 1, W0!, 1) : eye);
      T.push(0);
      path.pts.forEach((X, j) => {
        const t = t0 + (j + 1) * path.dt;
        P.push(w ? lin(sub3(X, bodyCentre(s, w, t)), 1, W0!, 1) : X);
        T.push((j + 1) * path.dt * Msec);
      });
      look = (d) => this.holeLook(cam, d);
      mPer = 1476.625 * s.massSolar;
      body = w ? { c: W0!, R: bodyRadius(s, w) } : { c: [0, 0, 0], R: horizon(s.spin) };
      if (path.fate === "horizon" || path.fate === "star") impact = { kind: path.fate, t: T[T.length - 1]!, ...this.futureSee(C, look, eye, P[P.length - 1]!, mPer, null) };
      // (about the hole the seconds are nothing — a sample is minutes to hours —: the path's eighth,
      // quarter and half instead, unless times were asked that it reaches)
      const span = T[T.length - 1]!;
      if (!at.some((t) => t > span * 0.02 && t <= span)) at = [span / 8, span / 4, span / 2];
    }
    const pts = P.map((X, j) => ({ ...this.futureSee(C, look, eye, X, mPer, body), t: T[j]! }));
    // the ship's places at the times asked (interpolated along the path)
    const marks = at.filter((t) => t > 0 && t <= T[T.length - 1]!).map((t) => {
      let j = 1;
      while (j < T.length - 1 && T[j]! < t) j++;
      const f = Math.min(Math.max((t - T[j - 1]!) / Math.max(T[j]! - T[j - 1]!, 1e-9), 0), 1);
      return { t, ...this.futureSee(C, look, eye, lin(P[j - 1]!, 1 - f, P[j]!, f), mPer, body) };
    });
    return { pts, marks, impact };
  }

  /** A point of the future as the eye sees it: its direction (camera coordinates), distance [m], hidden
   *  by the body (its sphere between the eye and the point, or the point inside it). */
  private futureSee(C: (v: Vec3) => Vec3, look: (d: Vec3) => Vec3, eye: Vec3, X: Vec3, mPer: number, body: { c: Vec3; R: number } | null) {
    const d = sub3(X, eye);
    const l = Math.hypot(...d);
    let hid = false;
    if (body && l > 0) {
      const oc = sub3(body.c, eye);
      const tc = dot3(oc, d) / l;
      const miss2 = dot3(oc, oc) - tc * tc;
      hid = Math.hypot(...sub3(X, body.c)) < body.R * 0.999 || (tc > 0 && tc < l && miss2 < body.R * body.R);
    }
    return { d: l > 0 ? C(look(d)) : ([0, 0, 1] as Vec3), r: l * mPer, hid };
  }

  /** A direction from the eye in the hole's frame (Cartesian), as the moving ship sees it (local
   *  components, aberration included) — the target's way (targetDir). */
  private holeLook(cam: ReturnType<typeof cameraFrame>, d: Vec3): Vec3 {
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const f = sphericalFrame(X);
    const l = Math.hypot(...d) || 1;
    const n: Vec3 = [dot3(d, f.er) / l, dot3(d, f.et) / l, dot3(d, f.ep) / l];
    const b = cam.beta;
    const b2 = dot3(b, b);
    if (b2 < 1e-12) return n;
    const g = 1 / Math.sqrt(1 - b2);
    const bn = dot3(n, b) / Math.sqrt(b2);
    const w = axpy(axpy(n, b, g), b, ((g - 1) * bn) / Math.sqrt(b2));
    return lin(w, 1 / Math.hypot(...w), w, 0);
  }

  /** The free-fall path's points (from the worker) cut to what the overlay draws. */
  private kerrPathFrom(r: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "star" }, st: ReturnType<typeof fromZamo>, tMax: number, now: number) {
    const s = this.s;
    const p: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole" | "star" } = { pts: r.pts, fate: r.fate };
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
    this.pathCost = 0;
    return { ...p, at: now, dt: tMax / 480, hit: p.fate === "star" ? this.nearestBody(p.pts.at(-1)!, st.t + p.pts.length * (tMax / 480)) : undefined };
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
/** The telescope's narrowest field [°] (the tracer's rays in float32: ~10 ulps per pixel at 1080 p) */
export const TELE_MIN = 0.02;
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


/** A rep pose's distance from the mouth in the home frame */
function homeOfPose(w: Dneg, p: { l: number; n: Vec3 }) {
  return { r: radius(w, p.l)[0] };
}

const unitV = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/**
 * A glider's climb angle down to the runway [rad]: the steep path (the Shuttle's ~18°) to the flare,
 * then the flare — the sink rate eased exponentially to a touchdown's ~1 m/s, its time constant set as it
 * starts from the sink it comes down with (≈ 0.4 g of pull: a steep fast final flares from ~500 m, a
 * slow one from ~50 m). `R.flareTau` keeps it; above twice its height again (a go-around), cleared.
 */
function flareRef(R: { flareTau?: number }, agl: number, steep: number, sp: number, gam: number): number {
  const sink = -sp * Math.sin(gam);
  // (begun at tau × the sink: from a steep final's ~35 m/s some 230 m up — the pull-up within reach)
  const tau = R.flareTau ?? clamp(sink / 5, 4, 7);
  if (R.flareTau === undefined && agl <= Math.max(tau * sink, 40)) R.flareTau = tau;
  else if (R.flareTau !== undefined && agl > 2 * Math.max(tau * sink, 40) + 100) R.flareTau = undefined;
  if (R.flareTau === undefined) return steep;
  return Math.max(steep, -Math.asin(Math.min((0.8 + agl / R.flareTau) / Math.max(sp, 1), 0.5)));
}

/**
 * The final's profile to the touchdown aimed (the Shuttle's, scaled to the Ranger): the steep slope from
 * the craft down to a corner 90 m up, a pull-up at ~0.3 g onto a shallow slope of 1.5° (the speed bled
 * there), and from 12 m a flare — a parabola tangent to the ground at the touchdown, 450 m past the
 * threshold. Along the runway's axis x [m from the threshold], the height h [m] over the ground, the
 * speed v [m/s]: the profile's height and slope there. The steep slope's angle follows the craft (the
 * line from it to the corner, 15° at most) until the pull-up nears; then it and the pull-up's length (its
 * radius v² / 0.3 g) are frozen (`fix`): the touchdown no longer drifts with the speed or the float.
 */
export const LANDING = { td: 450, gi: (1.5 * Math.PI) / 180, hF: 12, hC: 90, goMax: 0.26 };
export type LandingFix = { go: number; lb: number };
export function landingProfile(x: number, h: number, v = 150, fixed?: LandingFix): { h: number; slope: number; phase: "outer" | "preflare" | "inner" | "flare" | "rollout"; fix: LandingFix; freeze: boolean; aim: number } {
  const { td, gi, hF, hC, goMax } = LANDING;
  const tgi = Math.tan(gi);
  const LF = (2 * hF) / tgi;
  const xF = td - LF;
  const xC = xF - (hC - hF) / tgi;
  const go = fixed?.go ?? clamp(Math.atan2(h - hC, Math.max(xC - x, 1)), gi + 0.02, goMax);
  const lb = fixed?.lb ?? clamp(((v * v) / (0.3 * 9.81)) * (go - gi), 300, 3000);
  const fix = { go, lb };
  const tgo = Math.tan(go);
  const x0 = xC - lb / 2, x2 = xC + lb / 2;
  const aim = xC + hC / tgo;
  const freeze = x > x0 - 600;
  if (x >= td) return { h: 0, slope: 0, phase: "rollout", fix, freeze, aim };
  if (x >= xF) {
    const u = td - x;
    return { h: hF * (u / LF) ** 2, slope: (-2 * hF * u) / (LF * LF), phase: "flare", fix, freeze, aim };
  }
  if (x >= x2) return { h: hF + (xF - x) * tgi, slope: -tgi, phase: "inner", fix, freeze, aim };
  if (x >= x0) {
    // (a quadratic Bézier from the steep slope to the shallow one, through the corner's control point)
    const h0 = hC + (lb / 2) * tgo, h2 = hC - (lb / 2) * tgi;
    const u = (x - x0) / lb;
    return { h: (1 - u) ** 2 * h0 + 2 * u * (1 - u) * hC + u * u * h2, slope: (2 * (1 - u) * (hC - h0) + 2 * u * (h2 - hC)) / lb, phase: "preflare", fix, freeze, aim };
  }
  return { h: hC + (xC - x) * tgo, slope: -tgo, phase: "outer", fix, freeze, aim };
}

/** A duration [s], briefly. */
function fmtDur(s: number): string {
  if (!Number.isFinite(s)) return "—";
  if (s < 60) return `${s.toFixed(0)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${(s / 86400).toFixed(1)} d`;
}

/** v turned by ang about the unit axis k (Rodrigues) */
function rotateAbout(v: Vec3, k: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [v[0] * c + x[0] * s + k[0] * kv * (1 - c), v[1] * c + x[1] * s + k[1] * kv * (1 - c), v[2] * c + x[2] * s + k[2] * kv * (1 - c)];
}
const spinAxis = (id: string) => spinVector(solarBody(id)!);
const spinRate = (id: string) => Math.hypot(...spinVector(solarBody(id)!));

/** A look's yaw kept in (−180°, 180°]: turning past behind goes on round, no stop. */
export function wrapYaw(y: number): number {
  const w = ((((y + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}
