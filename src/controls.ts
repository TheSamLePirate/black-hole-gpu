import type { MlsReading } from "./game/mls";
import type { CockpitInput } from "./cockpit/input";
import type { cameraFrame } from "./camera";
import type { RealInfo } from "./realweather";
import type { WeatherState } from "./weather";
import type { FlightReport } from "./game/report";
import { Weather } from "./wind";
import type { Vec3 } from "./physics";
import type { Settings } from "./settings";
import type { Body, Quat } from "./targeting";
import { AirFlight } from "./flightair";
import type { EntryGuidance } from "./entry";
import type { Site } from "./game/sites";
import type { V3 as KV3 } from "./fc/kepler";
import { Contrails, MAX_SEGMENTS, SEG_FLOATS } from "./contrails";
import type { KerrOrbit } from "./fc/kerr-ops";
import type { LocalState, PlanetFrame } from "./landing";
import { FlightComputer, type Want } from "./pilot";
import type { DescentCmd } from "./descent";
import { dvLocal, type ManeuverNode, type PlanPath } from "./maneuver";
import type { Mount, MountPose } from "./mounts";
import type { AssistGraph } from "./ui/hud/graph";
import { fleet } from "./fleet";
import type { VesselId } from "./vessels";
import { type GamepadInput, sharedPad, type PadAction } from "./gamepad";
import { PadControls } from "./input/devices";
import type { KeyAction } from "./input/keymap";
import { nodeDvHome, type OurPath } from "./system/our-predict";
import type { OurMission } from "./system/our-plan";
import type { RendezvousPoint } from "./system/iss-plan";
import { lin } from "./math/vec3";

import { installRotation } from "./controller/rotation";
import { installLens } from "./controller/lens";
import { installMotion } from "./controller/motion";
import { installPiloting } from "./controller/piloting";
import { installComputer } from "./controller/computer";
import { installFleet } from "./controller/fleet";
import { installDocking } from "./controller/docking";
import { installPlan } from "./controller/plan";
import { installPlanet } from "./controller/planet";
import { installRig } from "./controller/rig";
import { installLowthrust } from "./controller/lowthrust";
import { installJourney } from "./controller/journey";
import { installTelemetry } from "./controller/telemetry";
import { installSpectator } from "./controller/spectator";
import { isTyping } from "./controller/util";
export { FLIGHT_KEYS, LANDING, TELE_MIN, finalGate, isTyping, landingProfile, wrapYaw } from "./controller/util";
export type { LandingFix } from "./controller/util";
import type { LandingFix } from "./controller/util";

export type Cinematic = "orbit" | "dive" | "journey" | null;
/** A low-thrust transfer in flight (see CameraController.transfer). */
export type LowThrust = {
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
export type PoseKeys = "anchor" | "whL" | "distance" | "inclination" | "azimuth" | "yaw" | "pitch" | "roll";

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
  /** the flown craft's turn against the target's [deg/s] (a capture: within 3) */
  spin: number;
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
  /** the PAPI on the final: how many of its four lights are white (4 high … 2 on the path … 0 low), null off it */
  papi: number | null;
  /** the path in the sky on the final: gates every 1.5 km down the landing profile, their corners as seen */
  gates: { d: Vec3; r: number }[][];
  /** the landing profile flown on the final (the autopilot's, or the pilot's own — hand-flown —: its
   *  steep slope and pull-up frozen as it nears), the speed over the ground [m/s], the flare in [s] */
  fix: LandingFix | null;
  manual: boolean;
  speed: number;
  flareIn: number | null;
  /** the surface wind there (PLAN-METEO W4: the weather's, at 10 m): where from [°], its speed and gusts
   *  [m/s], along the runway (> 0: head wind) and across it (> 0: from the right) — null: no air */
  wind: { from: number; u10: number; gust: number; head: number; cross: number } | null;
  /** the runway's guidance as the Shuttle's (game/mls.ts, PLAN-AEROPORTS A4): azimuth, elevation, coverage, distance */
  mls: MlsReading;
  /** the site, as landed (its end in service) */
  site: Site;
  /** its approach chart's fixes still ahead (game/procedures.ts, A5): where the eye sees them, their heights [m] */
  fixes: { id: string; h: number; d: Vec3; r: number }[];
}

/** A row of the hub's card: its name, its value — and, past its mark, how bad: "warn" (amber), "bad" (red). */
export type HubRow = [string, string] | [string, string, "warn" | "bad"];

/** The hub's card (CameraController.hubInfo): the autopilot, what it does now, its figures, its prediction. */
export interface HubInfo {
  /** the hub's own autopilot (CIRC's node: "circularize") */
  mode: string;
  title: string;
  phase: string;
  rows: HubRow[];
  /** what it predicts ("→ …"), or null */
  next: string | null;
  /** the phase's progress 0…1, or null */
  bar: number | null;
  /** the assistant's graph (ui/hud/graph.ts), or none */
  graph?: AssistGraph | null;
  /** a burn's cue for the director: its ignition [s from now, ≤ 0 lit], the Δv left and planned [m/s],
   *  lit, and done — the engine to cut */
  cue?: { tIgn: number; left: number; dv: number; burning: boolean; cut: boolean } | null;
  /** the director's lines (assisted): the countdowns and figures the phase calls for */
  say?: string[];
}

/** The future as the eye sees it (CameraController.futureView): directions in camera coordinates. */
export interface FutureView {
  pts: { d: Vec3; r: number; t: number; hid: boolean }[];
  marks: { t: number; d: Vec3; r: number; hid: boolean }[];
  impact: {
    kind: "ground" | "air" | "horizon" | "star";
    t: number;
    d: Vec3;
    r: number;
    hid: boolean;
    ground?: { kind: "ground"; t: number; d: Vec3; r: number; hid: boolean };
  } | null;
}

export class CameraController {
  cinematic: Cinematic = null;
  /** Input is ignored while disabled (e.g. during an offline render). */
  enabled = true;
  vAz = 0; // °/s
  vInc = 0;
  vYaw = 0;
  vPitch = 0;
  targetDistance: number;
  pointers = new Map<number, { x: number; y: number }>();
  dragLook = false;
  lastMove = 0;
  pinchDist = 0;
  /** two fingers: their midpoint at the last move (null: not two) */
  pinchMid: { x: number; y: number } | null = null;
  /** a finger's last tap (a second within 320 ms nearby: a double tap), and when one was taken */
  lastTap: { x: number; y: number; t: number } | null = null;
  tapDblAt = -Infinity;
  keys = new Set<string>();
  codes = new Set<string>();
  /** A video steps the scene (sim.ts): the user's keys and controller are left out. */
  scripted = false;
  /** A video in a frozen instant: the camera's cinematics go on, the scene's time does not. */
  bulletTime = false;
  diveSaved: Partial<Settings> | null = null;
  diveHold = 0;
  targetL: number;
  /** Game-style flight: pointer locked, the mouse turns the camera, the wheel sets the speed. */
  flyMode = false;
  /** Speed multiplier of free flight (wheel in fly mode). */
  flySpeed = 1;
  /** Gravity: the camera is a massive body following Kerr geodesics; the flight keys thrust. */
  gravity = false;
  /** Current flight velocity in the camera's axes (forward, right, up), in units of the distance scale per second. */
  flyVel: Vec3 = [0, 0, 0];
  /** Last free-fall prediction for the overlay (dt: coordinate time between points [M]). */
  /** (hit: the body the path runs into, when its fate is "star") */
  path: {
    pts: Vec3[];
    fate: "horizon" | "escape" | "continues" | "wormhole" | "star" | "local";
    at: number;
    dt: number;
    hit?: Body;
  } | null = null;
  /** Piloting the Ranger (on whenever the ship is): the flight computer and its last outputs. */
  readonly pilot = new FlightComputer();
  piloting = false;
  /** Near the station (5 km): the nearest port and the ship's docking ring against it — for the HUD. */
  dockInfo: DockInfo | null = null;
  /** let go of the station, not yet clear of the port */
  undocking = false;
  /** the touch screen's flight controls (ui/touchflight.ts), −1…1: read with the keys */
  readonly touchInput = { pitch: 0, yaw: 0, roll: 0 };
  /** Pilot messages (autopilot engaged, impossible manoeuvre…) for the app to show. */
  onPilotMessage?: (text: string) => void;
  /** the flown craft entering the air (the last moment before an entry: a point to resume from) */
  onAirEntry?: () => void;
  /** the craft lost to the air (heat, load): why */
  onCraftLost?: (why: string) => void;
  /** the flight's end — a landing's, a docking's —: its figures graded (game/report.ts), for the HUD's card */
  /** the flight graded (null: the last report let go — a new flight) */
  onFlightReport?: (r: FlightReport | null) => void;
  /** the last report's moment (performance.now): a bounce's second contact reports nothing */
  reportedAt: number | null = null;
  /** a touchdown to report, from its step (motion.ts reportLanding: graded at the next frame's start) */
  reportDue: { body: string; verdict: "landed" | "hard"; sink: number; along: number } | null = null;
  /** the flown craft in the air: its forces, skin, load (flightair.ts) */
  readonly airFlight = new AirFlight();
  /** the time warp held down in the air: said once per descent */
  airWarpSaid = false;
  /** The camera's place on the ship: moves smoothly (0.6 s) from one attach point to the next. */
  /** the outside views (mounts.ts: around, free): about the ship — yaw, pitch [deg] (0: behind it),
   *  distance [m]; free — the eye [m] and the look's yaw, pitch [deg] in the ship's frame (0: its nose) */
  outside = { yaw: 0, pitch: 12, dist: 42, eye: [18, 6, -36] as Vec3, fyaw: -25, fpitch: -5, fvel: [0, 0, 0] as Vec3 };
  /** the fly-by: where the camera stands (the local frame's axes, metres from the ship; null: to place) and
   *  its eye on the ship's axes this frame */
  flyby: { E: Vec3 | null; eye: Vec3 } = { E: null, eye: [22, 6, 40] };
  /** the ship's views locked on the target: its direction on the ship's axes (x left, y up, z nose) */
  shipAim: Vec3 | null = null;
  mountEff: MountPose | null = null;
  mountAnim: { from: MountPose; t: number } | null = null;
  lastMount = "";
  /** The pose used for the previous frame (a new attach point starts from it). */
  lastPose: MountPose | null = null;
  /**
   * The flight plan: manoeuvre nodes (absolute coordinate times), the predicted path through them
   * (refreshed from the current state), the executing node's delivered Δv and the warp to restore.
   */
  plan: { nodes: ManeuverNode[]; path: PlanPath | null; at: number; note: string; kind?: "align"; universe?: "ours" | "gargantua" } = {
    nodes: [],
    path: null,
    at: 0,
    note: "",
  };
  /** the executing burn's direction (local), fixed when it starts */
  burnDir: Vec3 | null = null;
  nodeDone = 0;
  nodeBurning = false;
  /** our universe: the executing node's Δv [P, N, R] as its burn along the orbital frame delivers it */
  burnFollow: Vec3 | null = null;
  /** the prograde hold a mission's cruise set (given back before a burn) */
  missionHold = false;
  /** the wormhole's side the ship was on (a crossing is said once) */
  shipSide: "ours" | "gargantua" | null = null;
  /** crossing the throat at the mission's warp (real time given back beyond it) */
  traversing = false;
  /** the crossing's warp still the mission's: none asked for by the pilot since (requestWarp) */
  crossingWarp = false;
  userWarp: number | null = null;
  /** Last autopilot goal and its velocity change still to make (|ΔU|), for the displays. */
  lastWant: Want | null = null;
  /** the orbit autopilot's last wanted 4-velocity (ZAMO components) and the proper time it was for */
  prevWant: { U: Vec3; tau: number; body: string } | null = null;
  /** the warp to give back once a low-thrust cruise has reached its orbit */
  warpAfter: number | null = null;
  /** rapidity spent by the flown craft's engines since its tank was filled (the propellant gauge) —
   *  each craft keeps its own (fleet.spent) */
  get spent() {
    return fleet.spent[fleet.active] ?? 0;
  }
  set spent(w: number) {
    fleet.spent[fleet.active] = w;
  }
  /** Entry universe retained while the physical cylinder projects to a mouth sphere. */
  tunnelEntry: "ours" | "gargantua" | null = null;
  wormholePath: import("./system/wormhole-predict").WormholePath | null = null;
  wormholePredictionError: string | null = null;
  wormholePathKey = "";
  wormholePathAt = 0;
  wormholePending = 0;
  predictionContext = "";
  predictionGeneration = 0;
  pathKey = "";
  pathCost = 0;
  /** the free-fall path asked of the planner's worker, not back yet */
  kerrPending = false;
  /** the flight's sub-steps allowed this frame (400 per 1/60 s) */
  subCap = 400;
  /** With gravity on: the camera stands on the star's surface. */
  landed = false;
  /** Proper time elapsed on the camera's clock while gravity is on [M]. */
  properTime = 0;
  journey: { t: number; dir: "out" | "back"; start: Pick<Settings, PoseKeys> } | null = null;
  /** Body under the mouse pointer (canvas CSS pixels), for the hover label. */
  hover: { body: Body; x: number; y: number } | null = null;
  /** Last user interaction with the camera (performance.now()), to show / fade the target marker. */
  activity = -1e9;
  /** Game controller: the sticks and triggers fly and turn like the keys; buttons go to the app. */
  readonly pad: GamepadInput = sharedPad();
  /**
   * The spectator (src/controller/spectator.ts): a second, headless controller over its own settings —
   * the camera away from the ship, anywhere —, the ship flying on as it was; null: the view is the ship's.
   */
  spectator: CameraController | null = null;
  /** the spectator follows the ship (carried with it; its offset from it [m, world axes] and that offset's rate), or is free */
  spectatorFollow = true;
  specOff: [number, number, number] = [0, 0, 0];
  specVel: [number, number, number] = [0, 0, 0];
  /** a spectator's distance to the flown ship [M] (its keys' speed scales with it too: slow by the ship) */
  nearShip = Infinity;
  /** a headless controller's pad this frame, polled by the main one (undefined: poll its own) */
  padFrame: ReturnType<GamepadInput["poll"]> | undefined = undefined;
  /** the controllers read through their profiles (PLAN-HOTAS: a HOTAS, a pad set by the player), once a
   *  frame (lens.ts); a button's keymap action handed to the app */
  readonly padControls = new PadControls();
  onPadKeyAction?: (action: KeyAction, arg?: string) => void;
  /** the absolute throttle lever's last reading, and the throttle it last set (picked up: it holds the
   *  throttle while that is still its own, takes it back passing through it) */
  leverWas: number | null = null;
  leverSet: number | null = null;
  /** the toe brakes asked (the pedals' — 0…1) */
  toeBrake = 0;
  onPadAction?: (a: PadAction) => void;
  lastSide = 0;
  hoverAt = 0;
  down: { x: number; y: number; t: number } | null = null;
  /** Scene time of this update and of the previous one [M] (the star moves). */
  time = NaN;
  prevTime = NaN;
  shipTime = NaN;
  /** Orbit mode: the camera's orientation relative to the aim at the target. */
  offset: Quat | null = null;
  /** yaw/pitch/roll as last written by the tracking (any other change updates the offset). */
  written = "";
  /** Smooth turn of the view to the target (offset → identity). */
  focus: { from: Quat; t: number; dur: number } | null = null;
  aimCache: { body: Body; key: string; look: Vec3; lensed: boolean } | null = null;
  /** Orbiting the star: wheel target distance, pending drag increments (°), co-moving fraction. */
  followD: number | null = null;
  followOrbit: [number, number] = [0, 0];
  leveling = false;
  /**
   * Flight to a framing position around the star or the mouth: along an arc around the body (its
   * frame: co-rotating for the star), direction n0 → n1 and distance d0 → d1 (log), eased.
   */
  flight: { body: Body; t: number; dur: number; C: Vec3; n0: Vec3; n1: Vec3; d0: number; d1: number } | null = null;

  constructor(
    public canvas: HTMLCanvasElement,
    public s: Settings,
    public onCinematicChange: (mode: Cinematic) => void,
    /** headless: a spectator's — no listeners of its own (the main controller hands it the input), not the fleet's flown craft */
    readonly headless = false,
  ) {
    this.targetDistance = s.distance;
    this.targetL = s.whL;
    if (headless) return;
    fleet.activePose = () => this.activePoseNow();
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("dblclick", this.onDblClick);
    canvas.addEventListener("pointerleave", () => {
      this.setHover(null);
      if (this.cockpit && !this.ckHeld) {
        this.cockpit.input.move(NaN, NaN);
        this.cockpit.tip(null, 0, 0);
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.flyMode = document.pointerLockElement === canvas;
      this.onCinematicChange(this.cinematic);
    });
    // fly mode: the mouse turns the camera like in a game (right = turn right, up = look up)
    document.addEventListener("mousemove", (e) => {
      if (!this.flyMode || !this.enabled) return;
      // (a spectator out: the mouse turns its view)
      const v = this.spectator ?? this;
      const k = 0.12 * Math.min(1, v.s.fov / 60);
      v.rotateView(e.movementX * k, -e.movementY * k, 0);
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
  get aroundWormhole() {
    return this.s.wormhole && this.s.anchor === "wormhole";
  }

  /** Orbit: turns the view back onto the target. Free: levels the horizon (roll → 0). */
  resetView() {
    this.vYaw = this.vPitch = 0;
    if (this.tracking) this.startFocus();
    else this.leveling = true;
  }

  /**
   * The view is kept on the target: around it always, else when locked on it (lookAt) — not during the
   * dive, the journey or game-style flight, nor on the ship (its views aim by their own means) nor on
   * the tripod (it aims itself, turning with its ground).
   */
  get tracking() {
    const s = this.s;
    const aimed = s.rotation === "orbit" || (s.lookAt && s.rotation !== "tripod");
    // (not when the rig turns about a planet, a moon — the classic aim resumes where it cannot: a body
    // beyond the wormhole, aimed at through its mouth)
    return (
      aimed &&
      !this.piloting &&
      !this.flyMode &&
      this.cinematic !== "dive" &&
      this.cinematic !== "journey" &&
      !(this.rig.on && this.rigOrbits())
    );
  }
  /** Drags move the camera around the target (around it, not while it falls freely). */
  get orbiting() {
    return this.tracking && this.s.rotation === "orbit" && !this.gravity;
  }

  /** The ship's views locked on the target: where the target sits in the view [°, right / up of centre]. */
  lookOff: [number, number] = [0, 0];

  /** Co-moving with the star (for the HUD). */
  get riding() {
    return this.s.motion === "comoving" ? 1 : 0;
  }

  /** The cockpit's controls under the pointer (PLAN-COCKPIT — main.ts sets it): their input, whether the
   *  cabin is what the view shows, the tip shown (a control's id, or none) */
  cockpit: { input: CockpitInput; active(): boolean; tip(id: string | null, x: number, y: number): void } | null = null;
  /** a control held by the pointer: which pointer, where it was pressed and when, where it is */
  private ckHeld: { id: number; x0: number; y0: number; t: number; x: number; y: number } | null = null;
  private ckWheel = 0;

  /** A pointer's place in the view's ndc (−1…1, y up). */
  private ndcOf(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
  }

  onDown = (e: PointerEvent) => {
    // (a spectator out: the pointer is its)
    if (this.spectator) {
      this.spectator.onDown(e);
      return;
    }
    if (!this.enabled || this.flyMode) return;
    // (in the cabin: pressed on a control, the control is held — the look's drags stay the right button's
    // and Shift's)
    const ck = this.cockpit;
    if (ck && e.button === 0 && !e.shiftKey && this.pointers.size === 0 && ck.active()) {
      const [nx, ny] = this.ndcOf(e);
      if (ck.input.down(nx, ny)) {
        this.canvas.setPointerCapture(e.pointerId);
        this.ckHeld = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t: performance.now(), x: e.clientX, y: e.clientY };
        this.setHover(null);
        this.canvas.style.cursor = "grabbing";
        ck.tip(ck.input.focus, e.clientX, e.clientY);
        return;
      }
    }
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

  onUp = (e: PointerEvent) => {
    // (a spectator out: the pointer is its)
    if (this.spectator) {
      this.spectator.onUp(e);
      return;
    }
    // (a control let go: a click, or the end of its drag)
    const h = this.ckHeld;
    if (h && e.pointerId === h.id) {
      this.ckHeld = null;
      this.cockpit?.input.up(Math.hypot(e.clientX - h.x0, e.clientY - h.y0) < 5 && performance.now() - h.t < 600);
      this.canvas.style.cursor = this.cockpit?.input.hover ? "pointer" : "";
      return;
    }
    this.pointers.delete(e.pointerId);
    this.pinchMid = null;
    // released after a pause: no fling
    if (performance.now() - this.lastMove > 80) this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
    // a click (no drag): select the body under the pointer
    const d = this.down;
    this.down = null;
    if (d && this.pointers.size === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5 && performance.now() - d.t < 400) {
      const r = this.canvas.getBoundingClientRect();
      // (in the cabin, a click on its walls or its screens: no body beyond them)
      const [nx, ny] = this.ndcOf(e);
      const inside = this.cockpit?.active() ? this.cockpit.input.move(nx, ny) : null;
      if (inside) {
        // (nothing: the cabin hides the sky there)
      } else if (this.pickIss(e.clientX - r.left, e.clientY - r.top)) {
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
  onDblClick = (e: MouseEvent, tap = false) => {
    if (this.spectator) {
      this.spectator.onDblClick(e, tap);
      return;
    }
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

  onMove = (e: PointerEvent) => {
    // (a spectator out: the pointer is its)
    if (this.spectator) {
      this.spectator.onMove(e);
      return;
    }
    // (a control held: it follows the pointer)
    const h = this.ckHeld;
    if (h && e.pointerId === h.id) {
      this.cockpit?.input.drag(e.clientX - h.x, e.clientY - h.y);
      h.x = e.clientX;
      h.y = e.clientY;
      this.cockpit?.tip(this.cockpit.input.focus, e.clientX, e.clientY);
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // hover: what is under the pointer (throttled; one traced ray)
      if (!this.enabled || this.flyMode || e.pointerType === "touch") return;
      // (in the cabin: a control lit and named; the walls and the screens hide the sky — the glass not)
      const ck = this.cockpit;
      if (ck?.active()) {
        const [nx, ny] = this.ndcOf(e);
        const t = ck.input.move(nx, ny);
        ck.tip(ck.input.focus, e.clientX, e.clientY);
        if (t) {
          this.setHover(null);
          this.canvas.style.cursor = t.kind === "control" || ck.input.overTab ? "pointer" : "";
          return;
        }
      } else if (ck?.input.hover || ck?.input.over) {
        ck.input.hover = null;
        ck.input.over = null;
        ck.tip(null, 0, 0);
      }
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

  onWheel = (e: WheelEvent) => {
    // (a spectator out: the pointer is its — following the ship, the wheel sets its distance to it)
    if (this.spectator) {
      e.preventDefault();
      if (this.spectatorFollow) {
        const k = Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.002)));
        for (let i = 0; i < 3; i++) this.specOff[i]! *= k;
      } else this.spectator.onWheel(e);
      return;
    }
    e.preventDefault();
    if (!this.enabled) return;
    // (over a control in the cabin: the wheel turns the knob, moves the lever)
    // (a notch every 50 px of scrolling: a trackpad's stream of small steps would spin it)
    if (e.deltaY && this.cockpit?.active() && this.cockpit.input.hover) {
      this.ckWheel += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      while (Math.abs(this.ckWheel) >= 50) {
        this.cockpit.input.wheel(Math.sign(this.ckWheel));
        this.ckWheel -= 50 * Math.sign(this.ckWheel);
      }
      if (this.cockpit.input.hover) {
        this.cockpit.tip(this.cockpit.input.focus, e.clientX, e.clientY);
        return;
      }
    }
    this.zoomStep(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, e.altKey);
  };

  /** The field of view the lens eases to (log), or none. */
  fovTarget: number | null = null;
  /** the view before the telescope: its field, whether it was locked on the target */
  teleSaved: { fov: number; lookAt: boolean } | null = null;

  /** our universe: resting on a body's ground (its own coordinates) */
  ourLanded: { body: string; q: Vec3 } | null = null;

  /** where the ship rests in our universe (a saved game keeps it) */
  get ourLandedOn() {
    return this.ourLanded;
  }

  /** The look and the camera's turn as the controller left them (null: not yet). */
  lookSeen: { yaw: number; pitch: number; cam: string } | null = null;

  /** the last attach point on the hull (not an outside view): where a reset brings the camera back */
  hullMount: Mount = "chase";

  /** The sci-fi flight computer's commands: speed [m/s], flight path angle and heading [rad]. */
  sfCmd: { speed: number; gamma: number; heading: number } | null = null;

  /** Where the entry autopilot comes down (null: the nearest site under the track). */
  entrySite: Site | null = null;
  /** The entry autopilot's run: its phase, the deorbit's burn (its time [s of the scene], Δv, done
   *  [m/s]), the guidance and its bank, the angle of attack, the next guidance's update [s]. */
  entryRun: {
    phase: "plan" | "wait" | "burn" | "entry" | "glide";
    site: Site | null;
    tBurn: number;
    dv: number;
    done: number;
    guid: EntryGuidance | null;
    bank: number;
    /** the bank flown in the entry phase: the guidance's, its phugoid damped (EntryGuidance.flown) */
    bankFlown?: number;
    next: number;
    alpha: number;
    gPrev: number | null;
    short: number;
    handover: number;
    /** the flare's time constant [s], set as it starts */
    flareTau?: number;
    /** the final's steep slope, its angle [rad] frozen as the pull-up nears; the profile's phase, its
     *  aim point and touchdown (along the runway from the threshold [m]), the height it asks */
    gOuter?: LandingFix;
    prof?: { phase: "outer" | "preflare" | "inner" | "flare" | "rollout"; aim: number; td: number; h: number };
    /** the circuit's side of the runway's axis (+1 its right), kept once chosen; its turn begun */
    side?: number;
    turning?: boolean;
    /** the approach's leg: joining the axis from far back, to the final's start, downwind, the turn, the
     *  spiral down (too high), the final */
    leg?: "join" | "toStart" | "downwind" | "turn" | "spiral" | "final" | "missed";
    /** the missed approach flown (computer.ts missedStep): climbing ahead, turning back, out along the
     *  reciprocal, turning in at the hold; how
     *  many so far; the minima passed on this final (the decision made) */
    ga?: { phase: "climb" | "turn" | "up" | "back" };
    gaN?: number;
    dhSeen?: boolean;
    /** the last decision at the minima: off the axis and the profile there [m], gone around */
    dhCheck?: { across: number; dh: number; ga: boolean };
    /** the heading alignment cylinder (too high): its side of the axis (the bank's sign), its radius [m]; absent: none */
    spiral?: { side: number; r: number };
    /** the final's course error integrated [rad s] (approach: the wind's shear taken out) */
    trkInt?: number;
    /** the ground's rise under the craft [m/s], 1 s smoothed, and the height over it last step [m]: the
     *  flare's sink measured from the runway's own slope (approach) */
    gRise?: number;
    aglPrev?: number;
    /** a guidance update in the planner's worker */
    pending?: boolean;
    /** the approach's figures (the runway's): along the axis from the threshold, across it [m], on the final;
     *  `agl` over the ground under the craft, `hp` the height its profile and minima read — over the
     *  threshold, the ground's in the last 500 m */
    app?: { along: number; across: number; final: boolean; agl: number; hp?: number; speed: number; gRef?: number; gam?: number };
    plan?: { heat: number; shield: number; g: number };
    /** the wait for the deorbit burn as first planned [s]; re-aimed since (a long wait's last hour and a half) */
    waited?: number;
    reaimed?: boolean;
    /** a trim out of the orbit's plane before the deorbit (a pass past the lift's reach): its time [s], size
     *  along the orbit's normal [m/s], what is done of it */
    trim?: { t: number; dv: number; done: number; firing: boolean; over?: boolean };
    /** the assistant's (lowthrust.ts entryAssist): the corridor in the height–speed plane (entry.ts
     *  entryCorridor), the path flown [km/s, km], the crossrange against its deadband as it was last seen */
    corr?: { v: number; lo: number; hi: number }[];
    trace?: [number, number][];
    rev?: { t: number; a: number; rate: number };
    inCorr?: boolean;
  } | null = null;

  /** The flight computer's burns about one of Gargantua's worlds (its frame): their time [s of the
   *  scene], prograde-normal-radial parts [m/s], what is done of the one firing. */
  fcBurns: { tAbs: number; dv: KV3; label: string; firing: boolean; done: number }[] = [];
  fcNote = "";

  /**
   * The flight computer's candidate: an operation previewed — not in the plan — and the path it would
   * fly, drawn on the maps before it is executed: our side by the n-body predictor (the planner's
   * worker), about the hole on its geodesics, about Gargantua's worlds their two bodies in the world's
   * frame (carried back onto the hole's map). Null: none.
   */
  /** about a world: the free orbit's ground track ahead (unit, on the world's turning axes) */
  localGround: Vec3[] | null = null;

  fcCand: {
    key: string;
    note: string;
    kind: "ours" | "hole" | "local";
    t0: number;
    /** the burns' times [scene time: ours and the hole, M; the worlds, s] */
    nodes: { t: number }[];
    ours?: OurPath | null;
    kerr?: PlanPath | null;
    /** about a world: the path relative to the world's centre (the map puts it where the world is) */
    local?: { pts: Vec3[]; times: number[]; nodeAt: number[]; world: string; rot: Vec3[] } | null;
    arrive?: { body: string; t: number } | null;
    busy: boolean;
  } | null = null;
  candGen = 0;

  /** about a world: the planned burns' path (relative to the world; on its turning axes), redone a few
   *  times a second while there are burns */
  fcLocalPlan: {
    at: number;
    key: string;
    v: { pts: Vec3[]; times: number[]; nodeAt: number[]; world: string; rot: Vec3[] } | null;
  } | null = null;

  kerrInfoCache: { at: number; key: string; o: KerrOrbit; t: number } | null = null;

  /** The air brake asked for (0 … 1). */
  airBrake = 0;

  /** On the ground and rolling (our side): the body under the wheels. */
  rolling: { body: string } | null = null;
  /** the nose wheel's steering [rad] (+: left) — the pilot's yaw on the ground, the rollout's */
  noseSteer = 0;
  /** the weather flown through (wind.ts), and its wind now in the home frame [c] — none: still air */
  readonly weather = new Weather();
  /** the weather over the place flown now (weather.ts), or null (no air under the craft) */
  weatherNow: WeatherState | null = null;
  /** the real weather, when it came in (W7: METAR; PLAN-CIEL C1: Open-Meteo, a draw) — the "real" setting's */
  weatherReal: WeatherState | null = null;
  /** where it comes from (realweather.ts) */
  weatherRealInfo: RealInfo | null = null;
  windHome: [number, number, number] | null = null;
  /** the wind now: its speed [m/s] and where it blows from [° from north] — for the displays */
  windNow: { speed: number; from: number } | null = null;
  /** the ground spoilers deployed at the touchdown, kept out through a bounce (piloting.ts) */
  groundSpoilers = false;
  /** when the wheels last touched [M of time] */
  rollSince = 0;
  /** when the wheels last left the ground [M of time] — back on them soon after: the same touchdown */
  offGround = Number.NEGATIVE_INFINITY;
  /** the gear's last forces (gear.ts): its legs' loads and compressions — none off the ground */
  gearLast: import("./gear").GearOut | null = null;
  /** the landing gear (PLAN-COCKPIT K4b): commanded down; its extension 0…1 (8 s each way — locked at 1);
   *  set from the flight's state at its first frame (down on the ground, up in the air); on the belly */
  gearDown = true;
  gearExt = 1;
  gearInit = false;
  onBelly = false;
  /** the take-off's run on the wheels and its first climb away (lowthrust.ts — the Ranger in the air) */
  takeoffRoll = false;
  /** the gear's turn of the craft over the last frame, for the pilot's rates (motion.ts) */
  gearDw: [number, number, number] | null = null;
  /** on its own gear at the frame's start: the craft's whole turn integrated within the flight's
   *  sub-steps (motion.ts), not in one go before them — a frame's rotation at once sinks the stiff legs */
  turnOnGear = false;

  /**
   * On its wheels: the wings level on the ground, the nose between 3° down and 15° up (the tail on the
   * runway) — the pilot's turns in roll, and in pitch past those, stopped. `up`: the ground's normal,
   * camera-local components.
   */
  /** The runway an autopilot's landing rolls out on (its nose wheel steered along it), until stopped. */
  rollSite: Site | null = null;

  /** the engines' and the wingtips' condensation trails (contrails.ts), kept in the air */
  readonly contrails = new Contrails();
  contrailBuf = new Float32Array(MAX_SEGMENTS * SEG_FLOATS);

  /** The flown craft's turn as flown — its axes now against last step's: its angular velocity (home)
   *  per M of the scene's time, eased (what it keeps turning at when left to coast). */
  spin: { ax: [Vec3, Vec3, Vec3]; t: number; w: Vec3 } | null = null;

  /** About the cabin: the camera's place (ship frame [m]; null: the pilot's seat), its velocity. */
  cabinCam: { eye: Vec3 | null; vel: Vec3 } = { eye: null, vel: [0, 0, 0] };

  /** Where the flown craft is docked (its first link): the port it holds and the flown craft's place — the
   *  station's camera's view while docked. */
  dockedView: { c: Vec3; a: Vec3; X: Vec3; sh: [Vec3, Vec3, Vec3] } | null = null;

  lastContactMsg = 0;

  /** Docked to the station (directly, or through craft docked to it): the station carries the flown
   *  craft; a push of the engine or the thrusters undocks. */
  get docked() {
    return this.s.ship && fleet.heldByStation();
  }

  /**
   * The docking autopilot (B, or the end of a rendezvous): what it docks to and its port, what it is
   * doing (for the HUD), the attitude it holds (local), the pilot's warp and the one it set, whether the
   * way to the port's axis is clear (and when that was last looked at).
   */
  dockAuto: {
    target: VesselId | "iss";
    port: number;
    phase: string;
    att: { nose: Vec3; up: Vec3; rate?: Vec3 } | null;
    warp: number;
    set: number;
    corridor: boolean;
    final: boolean;
    blocked: boolean;
    checked: number;
  } | null = null;

  /** Warp the pilot asked for, while the rails (or a glide) hold it lower (null: none held back). */
  warpWant: number | null = null;
  /** the warp the flight last wrote: the scene's warp changed by anything else (the settings, a
   *  script) is a new wish for the rails */
  warpSet = NaN;
  /** Under the pilot's warp authority (WARP: YOU), their warp while an autopilot's ceiling holds it
   *  lower: kept across the ceilings, given back once none holds it (null: none held). */
  hubWarpWant: number | null = null;
  /** the autopilots' ceilings on the warp, this frame — the lowest (null: none) */
  hubWarpLimit: number | null = null;
  /** the rails' ceiling on the warp, this frame (Infinity: none) */
  railsCap = Infinity;
  /** Why the rails hold the warp back (for the HUD), or "". */
  railsNote = "";

  planGen = 0;

  /** The mission previewed, adopted: into the plan (its in-flight re-aims with it). Why not, or null. */
  pendingMission: { gen: number; note: string; commit: () => void } | null = null;

  /** A rendezvous with the space station under way: its arrival's time; the re-aims each node had. */
  issGoal: { tArrive: number; refined: Map<ManeuverNode, number>; body: Body; point: RendezvousPoint } | null = null;

  lastRefine: { role: string; at: number; result: unknown } | null = null;

  /** A goal burn's estimate: the Δv the path still needs [c], when, at what was given then. */
  goalRem: { node: ManeuverNode; rem: number; at: number; done: number } | null = null;

  /** The pilot's own warp during a manoeuvre, auto warp off (null: not chosen yet). */
  nodeWarpWant: number | null = null;
  nodeWarpSet = NaN;
  /** A manoeuvre's warp, for the HUD: "" none executing; "auto"; "manual" (the pilot's); "held" (the
   *  pilot's held down to what the manoeuvre allows). */
  nodeWarp: "" | "auto" | "manual" | "held" = "";

  /** the planet the ship flies in the frame of (landing.ts), and its state there */
  local: { F: PlanetFrame; L: LocalState; key?: string } | null = null;

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

  /** The autopilot's goal: the velocity to reach (local 3-velocity) and a feed-forward acceleration. */
  /** our universe: the free-fall path and the path through the nodes (Newtonian prediction) */
  ourFree: OurPath | null = null;
  ourFreeAt = 0;
  ourFreeKey = "";
  predicting = false;
  /** our universe: the mission the plan flies (its nodes re-aimed in flight), the planner at work */
  ourMission: OurMission | null = null;
  planBusy = false;
  /** what the last live prediction of the plan cost [ms] (it is refreshed less often when dear) */
  planCost = 0;
  /** hand-made nodes' far path (from the planner's worker): for which nodes, when; a request in flight */
  farPlan: { key: string; path: OurPath; at: number } | null = null;
  farBusy = false;
  /** the planner's own path, shown while the first burn is further than the map's prediction reaches */
  ourPlanned: OurPath | null = null;
  /** per node: the last re-aim (scene time), how many, one under way */
  refineState = new WeakMap<ManeuverNode, { at: number; n: number; pending: boolean }>();
  /** Gargantua's side: the corrections on the way to the mouth already aimed (plan.ts nodeBurn) */
  kerrAimed = new WeakSet<ManeuverNode>();
  ourPlan: OurPath | null = null;

  /** the navball's speed: in orbit (around the reference body) or relative to the target */
  speedMode: "orbit" | "target" = "orbit";

  /** (set by the planner of the side the ship is on: a node's burn as a local direction now) */
  nodeDirLocal: ((cam: ReturnType<typeof cameraFrame>, n: ManeuverNode) => Vec3 | null) | null = (cam, n) => {
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

  /** where our universe's hover holds (home frame, relative to the reference body; low over a ground —
   *  ref "ground:<body>" —: body-fixed, and the heading it holds level) */
  ourAnchor: { ref: string; d: Vec3; heading?: Vec3 } | null = null;

  /**
   * Our universe's powered landing (lowthrust.ts landWant, descent.ts), its run: the body, its pad — a
   * site (the entry's handed over, a descent to one on an airless world), else the place under the craft
   * once it is slow (body-fixed [M]) —, the heading it holds level, the guidance's last command.
   */
  landRun: {
    body: string;
    site: Site | null;
    q: Vec3 | null;
    heading: Vec3 | null;
    cmd: DescentCmd | null;
    /** the braking begun low (descent.ts: no coasting again) */
    braking?: boolean;
  } | null = null;

  /**
   * Our universe's landing and take-off (the body of the sphere of influence, if it has a ground):
   *  - land: the powered descent's guidance (descent.ts) — to a pad, or here —, 0.8 m/s at touchdown;
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

  ourOrbitR: { body: string; r: number } | null = null;

  /** what the autopilots measured as they flew (our universe): the approach's, the hold's */
  hubNote: {
    left?: number;
    closing?: number;
    ttg?: number;
    stand?: number;
    name?: string;
    off?: number;
    drift?: number;
    /** the target's orbit, settled: the height it holds [m] */
    orbitAlt?: number;
  } = {};
  hubCache: { at: number; v: HubInfo | null; key?: string } | null = null;
  /** the take-off's record for its assistant (lowthrust.ts climbAssist): its pad (body-fixed unit), the
   *  path flown [downrange, height km], the peak dynamic pressure [Pa], the optimum path */
  climbRec: {
    id: string;
    pad: Vec3;
    trace: [number, number][];
    /** the trace's spacing [km], doubled as it is thinned */
    step?: number;
    qMax: number;
    profile: { pts: [number, number][]; ts: number[]; turn: number };
    /** begun on a runway (the Ranger's run and first climb): its optimum to be taken from where the climb
     *  proper begins */
    fromRun?: boolean;
  } | null = null;
  /** the burn's trace for its graph: the node it flies (its time), the Δv left against the time from it */
  burnTrace: { key: string; pts: [number, number][] } | null = null;

  /**
   * Our universe's circularization, its run: engaged by the pilot, a burn at the next apsis above the
   * air (the node autopilot flies it: its warp, its finite burn centred), then the trim; after a node
   * (`then: "circularize"`: a capture at its periapsis), the trim where it is. Null: not running.
   */
  ourCirc: {
    /** "await": circular, a Hohmann to the height asked being planned (heightGoal) */
    mode: "node" | "trim" | "await";
    where?: "ap" | "pe";
    altKm?: number;
    dv?: number;
    tNode?: number;
    spent0?: number;
    since?: number;
  } | null = null;

  /** the pilot's warp while our approach sets it (given back on arrival) */
  ourWarp: number | null = null;

  /** a saved game's deorbit, reloaded (game/tools.ts load): taken up as planned by the entry autopilot's
   *  next start, if its burn is still ahead — replanned from the burn's own moment, its pass was gone */
  entryResume: {
    tBurn: number;
    dv: number;
    trim: { t: number; dv: number } | null;
    plan: { heat: number; shield: number; g: number } | null;
  } | null = null;

  /** a mission into orbit, its capture done: the height it asked, for the circularization's last look —
   *  arrived more than a little off it (the aim's miss, a correction flown short), a Hohmann to it */
  heightGoal: { body: string; altKm: number } | null = null;

  runwayCache: { at: number; v: RunwayView | null; key?: string } | null = null;
  /** a hand-flown final's profile, frozen as its pull-up nears (the runway it is for) */
  manualFix: { site: string; fix: LandingFix } | null = null;
  /** the final's trace for its graph: the runway, the path flown [along km, height m] */
  glideTrace: { key: string; pts: [number, number][] } | null = null;

  futureCache: { at: number; key: string; v: FutureView | null } | null = null;
}

// The controller's methods by domain, in src/controller/ (put on its prototype here, once): rotation
// (orbiting, free look, pointer, keys), lens (and the telescope), motion (free flight, gravity: the
// integrators), piloting (the holds, the autopilots, entry and landing), computer (the flight
// computer's operations), fleet, docking, plan (rails, nodes, burns), planet (Gargantua's worlds' frame),
// rig (the mounts, the ship's views), lowthrust (and the views the HUD reads), journey (the wormhole).
installRotation(CameraController);
installLens(CameraController);
installMotion(CameraController);
installPiloting(CameraController);
installComputer(CameraController);
installFleet(CameraController);
installDocking(CameraController);
installPlan(CameraController);
installPlanet(CameraController);
installRig(CameraController);
installLowthrust(CameraController);
installJourney(CameraController);
installTelemetry(CameraController);
installSpectator(CameraController);
