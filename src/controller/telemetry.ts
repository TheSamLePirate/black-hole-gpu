// The CameraController — telemetry: the one view of the flight every display reads (FlightInfo).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { blToCartesian, cameraFrame } from "../camera";
import { horizon, isco, photonOrbits, type Vec3 } from "../physics";
import { bodyCentre, bodyVelocity, ourTarget } from "../targeting";
import { fromZamo } from "../geodesic";
import { fuelOn, tank } from "../engine";
import { toU, type Auto, type Director } from "../pilot";
import type { ManeuverNode } from "../maneuver";
import { shipToCamera } from "../mounts";
import { fleet } from "../fleet";
import { VESSELS } from "../vessels";
import { sphericalFrame } from "../wormhole";
import { OUR_BODIES } from "../system/our-side";
import type { OurPath } from "../system/our-predict";
import { station } from "../system/iss";
import { M_METRES } from "../units";
import { cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";

import type { CameraController, DockInfo, HubInfo } from "../controls";
import type { Hold } from "../pilot";
import type { M3, V3 } from "../mounts";
import type { Settings, Target } from "../settings";
import type { PlanPath } from "../maneuver";
import type { VesselId } from "../vessels";
import { add3 } from "./util";
import { tunnelEntrySide, wormholeMapPose, type WormholeMapPose } from "../system/wormhole-map";
import { mouth, tunnelState } from "../wormhole";
import type { WormholePath } from "../system/wormhole-predict";

/** A direction in camera coordinates (x right, y up, z forward), unit; null when undefined. */
type Dir = Vec3 | null;

/**
 * Everything the flight displays read, for one frame (the HUD, the flight computer, the map, the
 * sound, the renderer's re-entry glow, the game's status and tools). Directions are in camera
 * coordinates; distances in M (the hole's mass) unless said otherwise.
 */
export interface FlightInfo {
  // ---- where, and the spacetime there
  region: "hole" | "throat";
  /** Boyer–Lindquist r, θ, φ (the hole's side) */
  r: number;
  theta: number;
  phi: number;
  /** the wormhole's proper distance ℓ, and its normal */
  ell: number;
  n: Vec3;
  /** speed (relative to the ZAMO, or to the body of the sphere of influence on our side; to the
   *  target when the navball is set so) [c], its Lorentz factor, dτ/dt */
  speed: number;
  gamma: number;
  dtau: number;
  /** the geodesic's constants: energy, angular momentum, Carter's Q (NaN off the hole's side) */
  E: number;
  L: number;
  Q: number;
  spin: number;
  /** the radial 3-velocity (> 0 outwards) */
  vr: number;
  /** the hole's radii: the horizon, the ISCO, the prograde photon orbit; inside the ergosphere */
  rH: number;
  isco: number;
  photon: number;
  ergo: boolean;
  // ---- the engine and the pilot
  /** the autopilot's target speed (relative to the ZAMO), if any; its remaining |ΔU| */
  wantSpeed: number;
  dv: number;
  accel: number;
  throttle: number;
  sas: boolean;
  /** what holds the rails' warp back ("": nothing) */
  railsNote: string;
  rollAlign: boolean;
  hold: Hold;
  auto: Auto;
  /** the autopilots assisted (the pilot flies, their commands the HUD's cue), and the cue this frame */
  assist: boolean;
  director: Director | null;
  /** the body rates */
  omega: V3;
  properTime: number;
  landed: boolean;
  /** the body landed on */
  landedOn: Target | null;
  /** the ship's axes (camera coordinates) */
  S: M3;
  dirs: {
    prograde: Dir;
    retrograde: Dir;
    radialOut: Dir;
    radialIn: Dir;
    normal: Dir;
    antinormal: Dir;
    target: Dir;
    burn: Dir;
    maneuver: Dir;
    /** velocity relative to the target (approach, docking) */
    tgtPrograde: Dir;
    tgtRetrograde: Dir;
    /** the station's nearest docking port, seen from the eye */
    dock: Dir;
    /** near a world (ours, or one of Gargantua's): the local vertical and its north (the horizon,
     *  the pitch ladder, the heading) — at any height in its sphere */
    up: Dir;
    north: Dir;
    /** near the ground: the velocity over it, its horizontal part's direction (the drift) */
    drift: Dir;
  };
  /** the engine and the tank */
  engine: { kind: Settings["engine"]; max: number; fuel: ReturnType<typeof tank> | null };
  speedMode: CameraController["speedMode"];
  precision: boolean;
  // ---- the map: position, velocity, nose and view (flat map: the hole's frame, or our home frame)
  /** Dedicated display pose; never fed back into orbital/docking physics. */
  map: WormholeMapPose | null;
  wormholePath: WormholePath | null;
  wormholePredictionError: string | null;
  X: Vec3 | null;
  V: Vec3 | null;
  nose: Vec3 | null;
  look: Vec3 | null;
  /** the free-fall path ahead (the hole's side) */
  path: CameraController["path"];
  /** the camera's mount on the craft, moving between two */
  mount: string;
  moving: boolean;
  // ---- the plan
  /** the orbit's angle to each goal's plane [°] */
  planes: ReturnType<CameraController["planeOffsets"]>;
  /** the flight plan: nodes, the path through them, the executing burn (or a low-thrust transfer) */
  plan: {
    nodes: ManeuverNode[];
    path: PlanPath | null;
    note: string;
    burning: boolean;
    done: number;
    now: number;
    lowThrust: string | null;
  } | null;
  /** our universe: the free-fall path and the path through the nodes */
  ourFree: OurPath | null;
  ourPlan: OurPath | null;
  /** the planner at work (our universe) */
  planBusy: boolean;
  /** a mission's target at its periapsis time (the map marks where it will be) */
  ourArrive: { body: string; t: number } | null;
  /** the flight computer's previewed operation and its path, before it is executed */
  cand: CameraController["fcCand"];
  /** about one of Gargantua's worlds: the ground tracks, free and previewed, on its turning axes */
  localGround: { ahead: Vec3[] | null; cand: Vec3[] | null; plan: Vec3[] | null } | null;
  localPlan: ReturnType<CameraController["localPlanNow"]>;
  /** the hub's card: the autopilot flying, its phase, figures, prediction */
  hub: HubInfo | null;
  // ---- near a world
  /** its frame's figures (landing.ts) */
  surface: ReturnType<CameraController["surfaceInfo"]>;
  air: ReturnType<CameraController["airInfo"]>;
  entry: ReturnType<CameraController["entryInfo"]>;
  // ---- the target
  /** the selected target: distance (centre to centre, flat map) and range rate (> 0: receding) */
  target: Target;
  targetDist: number;
  targetRate: number;
  /** our universe: the body of the sphere of influence, the altitude above it [M], the radial speed,
   *  the closest approach to the target on straight lines (distance over its surface, in) */
  ref: string | null;
  ourAlt: number;
  ourVr: number;
  ourCa: { d: number; t: number } | null;
  // ---- docking and the fleet
  /** the docking aid (the station near), or null */
  dock: DockInfo | null;
  /** the docking's guide for the HUD: lateral offset and drift [m, m/s], the port's axis, gates
   *  along it (camera coordinates) */
  dockGuide: { lat: Vec3; latRate: Vec3; axis: Vec3; gates: { d: Vec3; r: number; k: number }[] } | null;
  /** the docking autopilot's phase ("": off) */
  dockPhase: string;
  /** what the flown craft is docked to (its own links) */
  links: { title: string; port: string }[];
  /** the craft flown, and those docked to it; the assembly's mass [kg] */
  vessel: VesselId;
  assembly: VesselId[];
  mass: number;
}

declare module "../controls" {
  interface CameraController {
    flightInfo: typeof flightInfo;
  }
}

/** Everything the flight displays show, for this frame. */
function flightInfo(this: CameraController): FlightInfo {
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
  const info: FlightInfo = {
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
    assist: this.pilot.assist,
    director: this.pilot.director,
    omega: this.pilot.omega,
    properTime: this.properTime,
    landed: this.landed,
    /** the body landed on */
    landedOn: this.landed ? (this.nearestBody(blToCartesian(cam.r, cam.theta, cam.phi), this.nowTime()) ?? null) : null,
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
      tgtPrograde: null,
      tgtRetrograde: null,
      /** the station's nearest docking port, seen from the eye */
      dock: null,
      /** near a world (ours, or one of Gargantua's): the local vertical and its north (the horizon,
       *  the pitch ladder, the heading) — at any height in its sphere */
      up: C(hz?.up ?? null),
      north: C(hz?.north ?? null),
      /** near the ground: the velocity over it, its horizontal part's direction (the drift) */
      drift: this.driftDir(cam, C),
    },
    // flat-map position, velocity and nose (black hole's frame), for the map
    map: null,
    wormholePath: this.wormholePath,
    wormholePredictionError: this.wormholePredictionError,
    X: null,
    V: null,
    nose: null,
    path: this.path,
    /** the camera's view direction (flat map), the autopilot's remaining velocity change |ΔU| */
    look: null,
    dv: this.lastWant && this.pilot.auto !== "none" ? Math.hypot(...sub3(toU(this.lastWant.beta), toU(cam.beta))) : NaN,
    mount: s.shipMount,
    moving: this.mountAnim !== null,
    /** the flight plan: nodes, the path through them, the executing burn */
    /** the orbit's angle to each goal's plane [°] */
    planes: this.planeOffsets(),
    plan: this.plan.nodes.length
      ? {
          nodes: this.plan.nodes,
          path: this.refreshPlan(),
          note: this.plan.note,
          burning: this.nodeBurning,
          done: this.nodeDone,
          now: this.nowTime(),
          lowThrust: null,
        }
      : this.transfer
        ? {
            nodes: [],
            path: null,
            note: this.transfer.note ?? "",
            burning: this.pilot.auto === "transfer" && this.pilot.accel > 0,
            done: 0,
            now: this.nowTime(),
            lowThrust: this.transfer.stage,
          }
        : null,
    /** near a planet: its frame's figures (landing.ts) */
    surface: this.surfaceInfo(),
    air: this.airInfo(),
    entry: this.entryInfo(),
    /** the engine and the tank */
    engine: { kind: s.engine, max: this.thrustMax(), fuel: fuelOn(s) ? tank(s, this.spent) : null },
    /** the selected target: distance (centre to centre, flat map) and range rate (> 0: receding) */
    target: s.target,
    targetDist: NaN,
    targetRate: NaN,
    /** our universe: the body of the sphere of influence, the altitude above it [M] and the radial speed */
    ref: null,
    ourAlt: NaN,
    ourVr: NaN,
    ourCa: null,
    /** the docking aid (the station near), or null */
    dock: null,
    /** the docking's guide for the HUD: lateral offset and drift [m, m/s], the port's axis, gates
     *  along it (camera coordinates) */
    dockGuide: null,
    /** what the flown craft is docked to (its own links) */
    links: [],
    /** the craft flown, and those docked to it; the assembly's mass [kg] */
    vessel: fleet.active,
    assembly: fleet.flownAssembly(),
    mass: fleet.massProps().mass,
    /** the docking autopilot's phase ("": off) */
    dockPhase: this.pilot.auto === "dock" ? (this.dockAuto?.phase ?? "") : "",
    speedMode: this.speedMode,
    precision: this.pilot.precision,
    /** our universe: the free-fall path and the path through the nodes */
    ourFree: this.ourFree,
    ourPlan: this.plan.nodes.length ? this.ourPlan : null,
    /** the planner at work (our universe) */
    planBusy: this.planBusy,
    /** a mission's target at its periapsis time (the map marks where it will be) */
    ourArrive:
      this.ourMission && this.plan.nodes.length
        ? { body: this.ourMission.goal.target, t: this.ourMission.tArrive }
        : this.issGoal && this.plan.nodes.length
          ? { body: this.issGoal.body, t: this.issGoal.tArrive }
          : null,
    // (the flight computer's previewed operation and its path, before it is executed)
    cand: this.fcCand,
    // (about one of Gargantua's worlds: the ground tracks, free and previewed, on its turning axes)
    localGround: this.local
      ? { ahead: this.localGround, cand: this.fcCand?.local?.rot ?? null, plan: this.localPlanNow()?.rot ?? null }
      : null,
    localPlan: this.localPlanNow(),
    /** the hub's card: the autopilot flying, its phase, figures, prediction */
    hub: this.hubInfo(),
  };
  if (cam.region === "hole") {
    const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, a, this.nowTime());
    info.E = st.E;
    info.L = st.L;
    const ct = Math.cos(st.th),
      s2 = Math.max(Math.sin(st.th) ** 2, 1e-12);
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
      prograde: C(p),
      retrograde: C(p && lin(p, -1, p, 0)),
      radialOut: C(R),
      radialIn: C(lin(R, -1, R, 0)),
      normal: C(nrm),
      antinormal: C(nrm && lin(nrm, -1, nrm, 0)),
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
  info.links = fleet.links
    .filter((l) => l.a === fleet.active || l.b === fleet.active)
    .map((l) => {
      const other = l.a === fleet.active ? l.b : l.a;
      const k = l.a === fleet.active ? l.pb : l.pa;
      return {
        title: other === "iss" ? "ISS" : VESSELS[other].name,
        port: other === "iss" ? (station.ports[k]?.name ?? "") : (VESSELS[other].ports[k]?.name ?? ""),
      };
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
      lat: toCam(lat),
      latRate: toCam(latRate),
      axis,
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
  if (s.wormhole) {
    const ts = tunnelState(mouth(s, this.nowTime()).w, cam.ell);
    if (cam.region === "hole") this.tunnelEntry = "gargantua";
    else if (ts.universe) this.tunnelEntry = ts.universe;
    else this.tunnelEntry ??= tunnelEntrySide(cam.ell, dot3(cam.beta, cam.n));
    info.map = wormholeMapPose(s, cam, this.nowTime(), this.shipAxesLocal(cam)[2], this.tunnelEntry!);
  } else this.tunnelEntry = null;
  return info;
}

export function installTelemetry(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { flightInfo });
}
