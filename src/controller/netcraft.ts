// The CameraController — the others' craft (docs/PLAN-RESEAU.md, R1): our craft as the network sends it (on the
// Earth: its place, its velocity over the ground and its axes in the Earth's own coordinates — fixed on its
// ground, the same on every machine whatever its clock), the others' samples brought onto the camera's axes
// for the renderer (their place from the flown craft, their axes, an F-35's moving parts posed as their
// flight controls move them), and a place beside one of them (the teleport of the tests).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { blToCartesian, cameraFrame } from "../camera";
import type { F35Pose } from "../f35/model";
import { JetPoser } from "../f35/pose";
import type { CraftState } from "../net/remote";
import { fromBodyFixed, groundVelocity, solidBody, toBodyFixed } from "../system/our-surface";
import { bodyAxes, solarBody } from "../system/solar";
import { ourState, repToHomeVec } from "../system/our-side";
import { betaToCoord, zamoBeta } from "../landing";
import { mapToRest } from "../system/local-patch";
import { mouth, sphericalFrame } from "../wormhole";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { VESSEL_IDS, type VesselId } from "../vessels";
import type { CameraController } from "../controls";

type Vec3 = [number, number, number];
const D = Math.PI / 180;

declare module "../controls" {
  interface CameraController {
    netOwn: typeof netOwn;
    netOwnState: typeof netOwnState;
    netMouthCam: typeof netMouthCam;
    netClockRate: typeof netClockRate;
    netShips: typeof netShips;
    netPlaceBeside: typeof netPlaceBeside;
    netPlaceEarth: typeof netPlaceEarth;
    netWalkerHome: typeof netWalkerHome;
    netOwnWalker: typeof netOwnWalker;
  }
}

/** what places a sample's craft: its frame, its body, its place, velocity and attitude */
type CraftPlace = Pick<CraftState, "frame" | "body" | "p" | "v" | "q">;

/** a sample's flag: coasting in space — its orbit carries it (src/net/remote.ts FLAG_COAST, R6) */
export const NET_COAST = 16;

/** the bodies a sample names (src/net/proto.ts BODIES — kept apart: the solo bundle holds no protocol) */
export const NET_BODIES = ["earth", "moon", "sun", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];

export interface NetWalkerHome {
  slot: number;
  /** his place (home frame, M), his axes there (right, up, forward), his speed [m/s], in the air or not */
  X: Vec3;
  axes: [Vec3, Vec3, Vec3];
  speed: number;
  airborne: boolean;
}

/** Another on foot in the home frame (the renderer brings him onto its camera's axes); null: not on our worlds. */
function netWalkerHome(this: CameraController, s: CraftState): NetWalkerHome | null {
  const body = NET_BODIES[s.body];
  if (!body || !solidBody(body) || !this.s.wormhole) return null;
  const t = this.nowTime();
  if (!Number.isFinite(t)) return null;
  const A = bodyAxes(solarBody(body)!, t);
  const toHome = (b: Vec3): Vec3 => [0, 1, 2].map((i) => b[0] * A[0][i]! + b[1] * A[1][i]! + b[2] * A[2][i]!) as Vec3;
  const ax = quatAxes(s.q);
  return {
    slot: s.slot,
    X: fromBodyFixed(body, scale(s.p as Vec3, 1 / M_METRES), t),
    axes: [unit(toHome(ax.right)), unit(toHome(ax.up)), unit(toHome(ax.fwd))],
    speed: Math.hypot(...s.v),
    airborne: !(s.flags & 1),
  };
}

/** Our walker as the network sends it: his body, his place on it [m, its own axes], his heading; null: not walking. */
function netOwnWalker(
  this: CameraController,
): { body: number; p: Vec3; fwd: Vec3; up: Vec3; right: Vec3; grounded: boolean; speed: number } | null {
  const ch = this.character;
  if (!ch.active || !ch.ours) return null;
  const body = NET_BODIES.indexOf(ch.body);
  if (body < 0) return null;
  const up = ch.up() as Vec3;
  const fwd = unit(ch.forward as Vec3);
  const right = unit([fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]]);
  return { body, p: [...ch.q] as Vec3, fwd, up, right, grounded: ch.grounded, speed: ch.speed };
}

/** the network's kinds (src/net/proto.ts KINDS) → the craft */
const KIND_IDS: (VesselId | "walker")[] = ["ranger", "lander", "endurance", "f35", "walker", "a320"];
export const kindOf = (k: number): VesselId | null => {
  const id = KIND_IDS[k];
  return id && id !== "walker" && VESSEL_IDS.includes(id) ? id : null;
};
export const kindIndex = (id: VesselId) => Math.max(0, KIND_IDS.indexOf(id));

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));

/** a quaternion (x, y, z, w) → its matrix's columns: the craft's forward, up and right (proto.ts) */
export function quatAxes(q: [number, number, number, number]): { fwd: Vec3; up: Vec3; right: Vec3 } {
  const [x, y, z, w] = q;
  return {
    fwd: [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    up: [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    right: [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  };
}

/** the quaternion whose matrix's columns are forward, up and right */
export function axesQuat(f: Vec3, u: Vec3, r: Vec3): [number, number, number, number] {
  const [m00, m10, m20] = f,
    [m01, m11, m21] = u,
    [m02, m12, m22] = r;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}

/** The home frame seen from the flown craft, anywhere on our side: our place, the camera's mapping both ways. */
function homeView(c: CameraController) {
  const cam = cameraFrame(c.s);
  const nav = c.ourNav(cam);
  if (!nav) return null;
  const w = mouth(c.s).w;
  return {
    cam,
    nav,
    /** a home vector → the camera's axes (right, up, forward), its length kept */
    toCam: (h: Vec3): Vec3 => {
      const l = Math.hypot(...h);
      if (l < 1e-9) return [0, 0, 0];
      const v = unit(nav.toRep(scale(h, 1 / l)) as Vec3);
      return [dot(v, cam.right as Vec3) * l, dot(v, cam.up as Vec3) * l, dot(v, cam.fwd as Vec3) * l];
    },
    /** a camera-local direction → the home frame's */
    fromLocal: (v: Vec3): Vec3 => unit(repToHomeVec(w, cam.ell, cam.n, v) as Vec3),
  };
}

/** a sample's frame on Gargantua's side (R8): the hole's map — Boyer–Lindquist's flat Cartesian map [m], the
 *  coordinate velocity [m/s], the axes on the map */
export const NET_FRAME_HOLE = 2;

/**
 * The hole's map seen from the flown craft on Gargantua's side (R8): our place on it [M], a map displacement onto
 * the camera's axes (its rest frame: proper lengths — flat over the few kilometres a craft is seen at), a ZAMO
 * direction (the camera's own vectors') onto the map; metres per M.
 */
function holeView(c: CameraController) {
  const cam = cameraFrame(c.s);
  if (cam.region !== "hole") return null;
  const X = blToCartesian(cam.r, cam.theta, cam.phi) as Vec3;
  const f = sphericalFrame(X);
  return {
    cam,
    X,
    mR: 1476.625 * (c.s.massSolar || 1),
    toCam: (d: Vec3): Vec3 => {
      const r = mapToRest(d, cam) as Vec3;
      return [dot(r, cam.right as Vec3), dot(r, cam.up as Vec3), dot(r, cam.fwd as Vec3)];
    },
    toMap: (z: Vec3): Vec3 => unit([0, 1, 2].map((i) => z[0] * f.er[i]! + z[1] * f.et[i]! + z[2] * f.ep[i]!) as Vec3),
  };
}

/**
 * Where the wormhole's mouth on our side of it is, from the camera (its axes [m]) — the way to those on the other
 * side (R8): ours by the Sun, from our worlds; the far one, from Gargantua's.
 */
function netMouthCam(this: CameraController): { at: Vec3; dist: number } | null {
  const H = homeView(this);
  if (H) {
    const at = H.toCam(scale(H.nav.X, -M_METRES));
    return { at, dist: Math.hypot(...at) };
  }
  const V = holeView(this);
  if (!V) return null;
  const C = mouth(this.s).C as Vec3;
  const at = scale(V.toCam([0, 1, 2].map((k) => C[k]! - V.X[k]!) as Vec3), V.mR);
  return { at, dist: Math.hypot(...at) };
}

/** Our proper time's rate against the room's clock (the coordinate time): dτ/dt — Gargantua's pull, the speed. */
function netClockRate(this: CameraController): number {
  const cam = cameraFrame(this.s);
  return cam.region === "hole" ? cam.zamo.alpha / cam.gamma : 1 / cam.gamma;
}

/** The others' craft on Gargantua's side, near ours (R8): on the camera's axes from the hole's map. */
function netShipsHole(c: CameraController, states: CraftState[]): NetShip[] {
  const V = holeView(c);
  netFrame.ships = [];
  if (!V) return [];
  const out: NetShip[] = [];
  for (const s of states) {
    const id = kindOf(s.kind);
    if (!id || s.frame !== NET_FRAME_HOLE) continue;
    const d = [0, 1, 2].map((k) => s.p[k]! / V.mR - V.X[k]!) as Vec3;
    const rel = scale(V.toCam(d), V.mR);
    const ax = quatAxes(s.q);
    const axes = [scale(ax.right, -1), ax.up, ax.fwd].map((a) => unit(V.toCam(a))) as [Vec3, Vec3, Vec3];
    const Vv = s.vis;
    out.push({
      side: "hole",
      enu: { r: [0, 0, 0], v: [0, 0, 0], fwd: [0, 1, 0], up: [0, 0, 1] },
      radar: { x: 0, y: 0, dz: 0, trk: null },
      slot: s.slot,
      id,
      rel,
      axes,
      relHome: [0, 0, 0],
      X: [Number.NaN, Number.NaN, Number.NaN],
      axesHome: axes,
      dist: Math.hypot(...rel),
      ghost: s.ghost,
      thrust: { throttle: Vv.throttle, boost: Math.max(1, Vv.boost), air: 0 },
      state: s,
    });
  }
  return out;
}

/** Our craft on Gargantua's side as the network sends it (R8): the hole's map. */
function netOwnHole(c: CameraController): NetOwnState | null {
  const V = holeView(c);
  if (!V || !c.s.ship) return null;
  const ax = c.shipAxesLocal(V.cam).map((a) => V.toMap(a as Vec3)) as [Vec3, Vec3, Vec3];
  return {
    frame: 2,
    body: 0,
    p: scale(V.X, V.mR),
    v: scale(betaToCoord(V.X, V.cam.beta as Vec3, c.s.spin) as Vec3, C_MPS),
    fwd: ax[2],
    up: ax[1],
    right: scale(ax[0], -1),
    h: (Math.hypot(...V.X) - 1) * V.mR,
  };
}

/** The Earth's frame now, seen from the flown craft: its axes, our place on them, the camera's mapping. */
/** Where the view is in the Earth's coordinates [m] — a spectator's when one is out (it may be far from the craft
 *  flown: the traffic and the ships it looks at are drawn about it, PLAN-CAMERA-AAA CAM8) —, else our place. */
export function viewEcef(c: CameraController, E: { p0: Vec3; nav: { t: number } }): Vec3 {
  const w = c.spectator?.rigWorld();
  if (!w?.ours) return E.p0;
  return scale(toBodyFixed("earth", w.X, E.nav.t), M_METRES);
}

export function earthView(c: CameraController) {
  const cam = cameraFrame(c.s);
  const nav = c.ourNav(cam);
  const fr = c.sfFrame(cam);
  if (!nav || nav.ref !== "earth" || !fr) return null;
  const A = bodyAxes(solarBody("earth")!, nav.t);
  const q0 = toBodyFixed("earth", nav.X, nav.t);
  return {
    cam,
    nav,
    fr,
    A,
    /** our place in the Earth's coordinates [m] */
    p0: scale(q0, M_METRES),
    /** an Earth vector → the home frame's */
    toHome: (b: Vec3): Vec3 => [0, 1, 2].map((i) => b[0] * A[0][i]! + b[1] * A[1][i]! + b[2] * A[2][i]!) as Vec3,
    /** a home vector → the Earth's */
    toEarth: (h: Vec3): Vec3 => [dot(h, A[0]), dot(h, A[1]), dot(h, A[2])],
    /** a home vector → the camera's axes (right, up, forward), its length kept */
    toCam: (h: Vec3): Vec3 => {
      const l = Math.hypot(...h);
      if (l < 1e-9) return [0, 0, 0];
      const v = fr.toLocal(scale(h, 1 / l));
      return [dot(v, cam.right as Vec3) * l, dot(v, cam.up as Vec3) * l, dot(v, cam.fwd as Vec3) * l];
    },
  };
}

export interface NetOwn {
  /** the Earth's coordinates [m], the velocity over its ground [m/s], the craft's forward, up and right */
  p: Vec3;
  v: Vec3;
  fwd: Vec3;
  up: Vec3;
  right: Vec3;
  /** height over the ellipsoid's mean radius [m] (the air's thinning) */
  h: number;
}

/** Our craft as the network sends it — near the Earth, in its air or on its ground; null elsewhere (R1). */
function netOwn(this: CameraController): NetOwn | null {
  if (!this.s.ship) return null;
  const E = earthView(this);
  if (!E) return null;
  const ax = this.shipAxesLocal(E.cam).map((a) => E.fr.fromLocal(a)) as [Vec3, Vec3, Vec3];
  // (the ship's axes: x its left, y its top, z its nose)
  const fwd = unit(E.toEarth(ax[2])),
    up = unit(E.toEarth(ax[1])),
    right = unit(scale(E.toEarth(ax[0]), -1));
  return { p: E.p0, v: E.toEarth(E.fr.vRel as Vec3), fwd, up, right, h: E.fr.h };
}

/** A sample's craft in the home frame at scene time t [M]: its place [M] and velocity [c]; null: not on our worlds. */
export function netStateHome(s: CraftPlace, t: number): { pos: Vec3; vel: Vec3 } | null {
  if (s.frame === NET_FRAME_HOLE) return null;
  const body = NET_BODIES[s.body];
  const b = body ? solarBody(body) : null;
  if (!body || !b) return null;
  if (s.frame === 0) {
    if (!solidBody(body)) return null;
    const A = bodyAxes(b, t);
    const pos = fromBodyFixed(body, scale(s.p as Vec3, 1 / M_METRES), t);
    const g = groundVelocity(body, pos, t);
    const v = [0, 1, 2].map((i) => (s.v[0] * A[0][i]! + s.v[1] * A[1][i]! + s.v[2] * A[2][i]!) / C_MPS) as Vec3;
    return { pos, vel: [g[0] + v[0], g[1] + v[1], g[2] + v[2]] };
  }
  const B = ourState(body, t);
  return {
    pos: [0, 1, 2].map((k) => B.pos[k]! + s.p[k]! / M_METRES) as Vec3,
    vel: [0, 1, 2].map((k) => B.vel[k]! + s.v[k]! / C_MPS) as Vec3,
  };
}

/** A sample's craft as the docking reads a pose at scene time t [M] (R7): place [M], velocity [c], axes (left, up,
 *  nose: home), its turn [rad per M]. */
export function netDockPose(s: CraftState, t: number): { X: Vec3; V: Vec3; ax: [Vec3, Vec3, Vec3]; w: Vec3 } | null {
  const H = netStateHome(s, t);
  const body = NET_BODIES[s.body];
  if (!H || !body) return null;
  const A = s.frame === 0 ? bodyAxes(solarBody(body)!, t) : null;
  const toHome = (b: Vec3): Vec3 => (A ? ([0, 1, 2].map((i) => b[0] * A[0][i]! + b[1] * A[1][i]! + b[2] * A[2][i]!) as Vec3) : b);
  const ax = quatAxes(s.q);
  return {
    X: H.pos,
    V: H.vel,
    ax: [unit(toHome(scale(ax.right, -1))), unit(toHome(ax.up)), unit(toHome(ax.fwd))],
    w: scale(toHome(s.w as Vec3), M_SECONDS),
  };
}

/** Our craft as the network sends it, anywhere on our side (R6): fixed to the Earth in its air or on its ground (R1);
 *  elsewhere in the inertial frame of the body whose sphere it is in — the home frame's axes about its centre. */
export interface NetOwnState extends NetOwn {
  /** 0: fixed to the body, 1: its inertial frame, 2: Gargantua's side — the hole's map (R8) */
  frame: 0 | 1 | 2;
  /** NET_BODIES' index */
  body: number;
}

function netOwnState(this: CameraController): NetOwnState | null {
  // (in the Earth's air — below 100 km — or on its ground: fixed to it; above, its inertial frame)
  const own = this.netOwn();
  if (own && own.h < 100_000) return { ...own, frame: 0, body: 0 };
  if (!this.s.ship) return null;
  const H = homeView(this);
  if (!H) return netOwnHole(this);
  const body = H ? NET_BODIES.indexOf(H.nav.ref) : -1;
  if (!H || body < 0) return null;
  const nav = H.nav;
  const ax = this.shipAxesLocal(H.cam).map((a) => H.fromLocal(a as Vec3)) as [Vec3, Vec3, Vec3];
  // (landed on another body — the Moon, Mars —: fixed to its ground, as on the Earth's — sent on an orbit, the
  // others' Kepler carried it off)
  if ((this.landed || this.ourLanded) && solidBody(nav.ref)) {
    const A = bodyAxes(solarBody(nav.ref)!, nav.t);
    const toB = (h: Vec3): Vec3 => unit([dot(h, A[0]), dot(h, A[1]), dot(h, A[2])]);
    return {
      frame: 0,
      body,
      p: scale(toBodyFixed(nav.ref, nav.X, nav.t) as Vec3, M_METRES),
      v: [0, 0, 0],
      fwd: toB(ax[2]),
      up: toB(ax[1]),
      right: toB(scale(ax[0], -1)),
      h: 0,
    };
  }
  const p = [0, 1, 2].map((k) => (nav.X[k]! - nav.refPos[k]!) * M_METRES) as Vec3;
  return {
    frame: 1,
    body,
    p,
    v: [0, 1, 2].map((k) => (nav.V[k]! - nav.refVel[k]!) * C_MPS) as Vec3,
    fwd: ax[2],
    up: ax[1],
    right: scale(ax[0], -1),
    h: Math.hypot(...p) - (solarBody(nav.ref)?.radius ?? 0) * M_METRES,
  };
}

export interface NetShip {
  slot: number;
  /** Gargantua's side (R8: the hole's map — rel/axes on the camera's axes, no home frame) or ours */
  side?: "hole";
  id: VesselId;
  /** from the flown craft's origin on the camera's axes [m]; its axes there (left, top, nose) */
  rel: Vec3;
  axes: [Vec3, Vec3, Vec3];
  /** the same in the home frame (the contrails'); its place there [M] (the renderer's, from its own camera: a
   *  walker's far from the craft) */
  relHome: Vec3;
  X: Vec3;
  axesHome: [Vec3, Vec3, Vec3];
  dist: number;
  ghost: boolean;
  jet?: F35Pose;
  /** its engines: throttle 0–1, afterburner (1: dry), the air about it 0–1 */
  thrust: { throttle: number; boost: number; air: number };
  /** heading up from the flown craft's nose: right, ahead, up [m]; its track over the ground [rad, from the nose] */
  radar: { x: number; y: number; dz: number; trk: number | null };
  /** from the flown craft in the local east, north, up [m], its velocity, nose and top there (a fight's frame) */
  enu: { r: Vec3; v: Vec3; fwd: Vec3; up: Vec3 };
  state: CraftState;
}

/** the others' craft placed last (netShips): their contrails' sources (controller/computer.ts) */
export const netFrame: { ships: NetShip[] } = { ships: [] };

/** each other's F-35 posed from frame to frame (its surfaces move at their actuators' rates) */
const posers = new Map<number, { poser: JetPoser; fan: number }>();

/**
 * The others' craft on the Earth for the renderer: each from the flown craft, on the camera's axes, its axes
 * there; an F-35's moving parts as its flight controls move them. Those beyond `range` [m] left out.
 */
function netShips(
  this: CameraController,
  states: CraftState[],
  dt: number,
  range = Infinity,
  attached?: Map<number, { c: Vec3; ax: [Vec3, Vec3, Vec3] }>,
): NetShip[] {
  const H = homeView(this);
  if (!H) return netShipsHole(this, states);
  // (those docked to our craft — R7 —: held on it, rigid, from our own pose — not from their samples, a
  // latency behind)
  const mine = attached?.size ? (this.shipAxesLocal(H.cam).map((a) => H.fromLocal(a as Vec3)) as [Vec3, Vec3, Vec3]) : null;
  const on = (A: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [0, 1, 2].map((k) => A[0][k]! * v[0] + A[1][k]! * v[1] + A[2][k]! * v[2]) as Vec3;
  const E = earthView(this);
  const t = H.nav.t;
  const out: NetShip[] = [];
  // (near the Earth: the flown craft's heading — its nose over the local east and north —, the radar's frame)
  const E3 = (E?.fr.east ?? [1, 0, 0]) as Vec3,
    N3 = (E?.fr.north ?? [0, 1, 0]) as Vec3,
    U3 = (E?.fr.up ?? [0, 0, 1]) as Vec3;
  const nose = E ? (E.fr.fromLocal(this.shipAxesLocal(E.cam)[2] as Vec3) as Vec3) : N3;
  const psi = Math.atan2(dot(nose, E3), dot(nose, N3));
  const [cp, sp] = [Math.cos(psi), Math.sin(psi)];
  for (const s of states) {
    const id = kindOf(s.kind);
    const body = NET_BODIES[s.body];
    // (one on Gargantua's side — the hole's map —: not on our worlds; its tag on the wormhole's mouth)
    if (!id || !body || !solarBody(body) || s.frame === NET_FRAME_HOLE) continue;
    // its place and axes in the home frame: on a body's ground or in its air (fixed to it), or in space (the
    // body's inertial frame: the home frame's axes about its centre)
    const ax = quatAxes(s.q);
    let X: Vec3, axesHome: [Vec3, Vec3, Vec3], vH: Vec3, h: number;
    if (s.frame === 0) {
      if (!solidBody(body)) continue;
      const A = bodyAxes(solarBody(body)!, t);
      const toHome = (b: Vec3): Vec3 => [0, 1, 2].map((i) => b[0] * A[0][i]! + b[1] * A[1][i]! + b[2] * A[2][i]!) as Vec3;
      X = fromBodyFixed(body, scale(s.p as Vec3, 1 / M_METRES), t);
      axesHome = [scale(ax.right, -1), ax.up, ax.fwd].map(toHome) as [Vec3, Vec3, Vec3];
      vH = toHome(s.v as Vec3);
      h = Math.hypot(...s.p) - solarBody(body)!.radius * M_METRES;
    } else {
      const B = ourState(body, t);
      X = [0, 1, 2].map((k) => B.pos[k]! + s.p[k]! / M_METRES) as Vec3;
      axesHome = [scale(ax.right, -1), ax.up, ax.fwd];
      vH = s.v as Vec3;
      h = Math.hypot(...s.p) - solarBody(body)!.radius * M_METRES;
    }
    const link = mine ? attached!.get(s.slot) : undefined;
    if (link && mine) {
      X = [0, 1, 2].map((k) => H.nav.X[k]! + on(mine, link.c)[k]! / M_METRES) as Vec3;
      axesHome = link.ax.map((col) => unit(on(mine, col))) as [Vec3, Vec3, Vec3];
    }
    const relHome = [0, 1, 2].map((k) => (X[k]! - H.nav.X[k]!) * M_METRES) as Vec3;
    const dist = Math.hypot(...relHome);
    if (dist > range) continue;
    const V = s.vis;
    let jet: F35Pose | undefined;
    if (id === "f35" && dist < 60_000) {
      let P = posers.get(s.slot);
      if (!P) posers.set(s.slot, (P = { poser: new JetPoser(), fan: 0 }));
      const ground = (s.flags & 1) !== 0;
      const speed = Math.hypot(...s.v);
      P.fan = (P.fan + V.fan * 60 * dt) % (2 * Math.PI);
      jet = {
        ...P.poser.step({
          dt,
          // (the commands as the poser reads them: its torque share null, the rates the commands)
          torque: [0, 0, 0],
          rates: [V.pitch / 0.75, V.yaw / 0.75, V.roll / 0.75],
          throttle: V.throttle,
          afterburner: V.boost > 1.01,
          alpha: V.alpha * D,
          flaps: V.flaps,
          brake: V.brake,
          gear: V.gear,
          comp: [V.comp, V.comp, V.comp],
          onGround: ground,
          groundSpeed: speed,
          steer: V.steer,
          parked: (s.flags & 2) !== 0,
          stovl: V.stovl,
          nozzle: V.nozzle,
          fan: P.fan,
        }),
      };
    }
    const [e, n, u] = [dot(relHome, E3), dot(relHome, N3), dot(relHome, U3)];
    const ve = dot(vH, E3),
      vn = dot(vH, N3);
    const loc = (h: Vec3): Vec3 => [dot(h, E3), dot(h, N3), dot(h, U3)];
    out.push({
      enu: { r: [e, n, u], v: loc(vH), fwd: loc(axesHome[2]), up: loc(axesHome[1]) },
      radar: { x: e * cp - n * sp, y: e * sp + n * cp, dz: u, trk: Math.hypot(ve, vn) > 5 ? Math.atan2(ve, vn) - psi : null },
      slot: s.slot,
      id,
      rel: H.toCam(relHome),
      axes: axesHome.map((a) => H.toCam(a)) as [Vec3, Vec3, Vec3],
      relHome,
      X,
      axesHome,
      dist,
      ghost: s.ghost,
      jet,
      thrust: { throttle: V.throttle, boost: Math.max(1, V.boost), air: Math.min(1, Math.max(0, Math.exp(-Math.max(h, 0) / 8500))) },
      state: s,
    });
  }
  for (const k of posers.keys()) if (!states.some((s) => s.slot === k)) posers.delete(k);
  netFrame.ships = out;
  return out;
}

/**
 * A place beside another craft (the teleport of the tests): `gap` metres off its right (negative: its left),
 * its velocity, its attitude — in the home frame, for tools.placeAt. Null: not on the Earth.
 */
function netPlaceBeside(
  this: CameraController,
  s: CraftPlace,
  gap: number,
): { frame?: "hole"; X: Vec3; vel: Vec3; fwd: Vec3; up: Vec3 } | null {
  // (Gargantua's side — R8 —: on the hole's map, his velocity as the ZAMO's β there)
  if (s.frame === NET_FRAME_HOLE) {
    const mR = 1476.625 * (this.s.massSolar || 1);
    const ax = quatAxes(s.q);
    const X = [0, 1, 2].map((k) => (s.p[k]! + ax.right[k]! * gap) / mR) as Vec3;
    const b = zamoBeta(X, scale(s.v as Vec3, 1 / C_MPS), this.s.spin) as Vec3;
    const f = sphericalFrame(X);
    return {
      frame: "hole",
      X,
      vel: [0, 1, 2].map((i) => b[0] * f.er[i]! + b[1] * f.et[i]! + b[2] * f.ep[i]!) as Vec3,
      fwd: unit(ax.fwd),
      up: unit(ax.up),
    };
  }
  // (the body's axes now alone — wherever our craft is: a spectator in orbit takes another's place on the ground)
  const t = this.nowTime();
  if (!Number.isFinite(t) || !this.s.wormhole) return null;
  const H = netStateHome(s, t);
  const body = NET_BODIES[s.body];
  if (!H || !body) return null;
  // (his axes in the home frame: a body's turning ones on its ground and in its air, the home frame's in space)
  const A = s.frame === 0 ? bodyAxes(solarBody(body)!, t) : null;
  const toHome = (b: Vec3): Vec3 => (A ? ([0, 1, 2].map((i) => b[0] * A[0][i]! + b[1] * A[1][i]! + b[2] * A[2][i]!) as Vec3) : b);
  const ax = quatAxes(s.q);
  const right = unit(toHome(ax.right));
  return {
    X: [0, 1, 2].map((k) => H.pos[k]! + (right[k]! * gap) / M_METRES) as Vec3,
    vel: H.vel,
    fwd: unit(toHome(ax.fwd)),
    up: unit(toHome(ax.up)),
  };
}

/** A place on the Earth as the network sends one (its own coordinates [m], the velocity over its ground [m/s], the
 *  nose and top) for tools.placeAt and the puppet (a wreck's fall — ui/netmatch.ts); null: not on our worlds. */
function netPlaceEarth(this: CameraController, p: Vec3, v: Vec3, fwd: Vec3, up: Vec3) {
  const right: Vec3 = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
  return this.netPlaceBeside({ frame: 0, body: 0, p, v, q: axesQuat(unit(fwd), unit(up), unit(right)) }, 0);
}

export function installNetcraft(Ctl: { prototype: CameraController }) {
  Object.assign(Ctl.prototype, {
    netOwn,
    netOwnState,
    netMouthCam,
    netClockRate,
    netShips,
    netPlaceBeside,
    netPlaceEarth,
    netWalkerHome,
    netOwnWalker,
  });
}
