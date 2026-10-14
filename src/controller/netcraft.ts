// The CameraController — the others' craft (docs/PLAN-RESEAU.md, R1): our craft as the network sends it (on the
// Earth: its place, its velocity over the ground and its axes in the Earth's own coordinates — fixed on its
// ground, the same on every machine whatever its clock), the others' samples brought onto the camera's axes
// for the renderer (their place from the flown craft, their axes, an F-35's moving parts posed as their
// flight controls move them), and a place beside one of them (the teleport of the tests).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import type { F35Pose } from "../f35/model";
import { JetPoser } from "../f35/pose";
import type { CraftState } from "../net/remote";
import { fromBodyFixed, groundVelocity, toBodyFixed } from "../system/our-surface";
import { bodyAxes, solarBody } from "../system/solar";
import { C_MPS, M_METRES } from "../units";
import { VESSEL_IDS, type VesselId } from "../vessels";
import type { CameraController } from "../controls";

type Vec3 = [number, number, number];
const D = Math.PI / 180;

declare module "../controls" {
  interface CameraController {
    netOwn: typeof netOwn;
    netShips: typeof netShips;
    netPlaceBeside: typeof netPlaceBeside;
  }
}

/** the network's kinds (src/net/proto.ts KINDS) → the craft */
const KIND_IDS: VesselId[] = ["ranger", "lander", "endurance", "f35"];
export const kindOf = (k: number): VesselId | null => (KIND_IDS[k] && VESSEL_IDS.includes(KIND_IDS[k]!) ? KIND_IDS[k]! : null);
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

/** The Earth's frame now, seen from the flown craft: its axes, our place on them, the camera's mapping. */
function earthView(c: CameraController) {
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

export interface NetShip {
  slot: number;
  id: VesselId;
  /** from the flown craft's origin on the camera's axes [m]; its axes there (left, top, nose) */
  rel: Vec3;
  axes: [Vec3, Vec3, Vec3];
  /** the same in the home frame (the contrails') */
  relHome: Vec3;
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
function netShips(this: CameraController, states: CraftState[], dt: number, range = 60_000): NetShip[] {
  const E = earthView(this);
  if (!E) return [];
  const out: NetShip[] = [];
  // (the flown craft's heading: its nose over the local east and north)
  const E3 = E.fr.east as Vec3,
    N3 = E.fr.north as Vec3,
    U3 = E.fr.up as Vec3;
  const nose = E.fr.fromLocal(this.shipAxesLocal(E.cam)[2] as Vec3) as Vec3;
  const psi = Math.atan2(dot(nose, E3), dot(nose, N3));
  const [cp, sp] = [Math.cos(psi), Math.sin(psi)];
  for (const s of states) {
    const id = kindOf(s.kind);
    if (!id || s.body !== 0 || s.frame !== 0) continue;
    const dE: Vec3 = [s.p[0] - E.p0[0], s.p[1] - E.p0[1], s.p[2] - E.p0[2]];
    const dist = Math.hypot(...dE);
    if (dist > range) continue;
    const ax = quatAxes(s.q);
    // (the renderer's axes: x the left, y the top, z the nose)
    const axesHome = [scale(ax.right, -1), ax.up, ax.fwd].map((a) => E.toHome(a)) as [Vec3, Vec3, Vec3];
    const relHome = E.toHome(dE);
    const V = s.vis;
    let jet: F35Pose | undefined;
    if (id === "f35") {
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
    const h = Math.hypot(...s.p) - 6_371_000;
    const [e, n, u] = [dot(relHome, E3), dot(relHome, N3), dot(relHome, U3)];
    const vH = E.toHome(s.v);
    const ve = dot(vH, E3),
      vn = dot(vH, N3);
    const loc = (h: Vec3): Vec3 => [dot(h, E3), dot(h, N3), dot(h, U3)];
    out.push({
      enu: { r: [e, n, u], v: loc(vH), fwd: loc(axesHome[2]), up: loc(axesHome[1]) },
      radar: { x: e * cp - n * sp, y: e * sp + n * cp, dz: u, trk: Math.hypot(ve, vn) > 5 ? Math.atan2(ve, vn) - psi : null },
      slot: s.slot,
      id,
      rel: E.toCam(relHome),
      axes: axesHome.map((a) => E.toCam(a)) as [Vec3, Vec3, Vec3],
      relHome,
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
function netPlaceBeside(this: CameraController, s: CraftState, gap: number) {
  const E = earthView(this);
  if (!E) return null;
  const ax = quatAxes(s.q);
  const pE: Vec3 = [s.p[0] + ax.right[0] * gap, s.p[1] + ax.right[1] * gap, s.p[2] + ax.right[2] * gap];
  const t = E.nav.t;
  const X = fromBodyFixed("earth", scale(pE, 1 / M_METRES), t);
  const g = groundVelocity("earth", X, t);
  const v = scale(E.toHome(s.v), 1 / C_MPS);
  return {
    X,
    vel: [g[0] + v[0], g[1] + v[1], g[2] + v[2]] as Vec3,
    fwd: unit(E.toHome(ax.fwd)),
    up: unit(E.toHome(ax.up)),
  };
}

export function installNetcraft(Ctl: { prototype: CameraController }) {
  Object.assign(Ctl.prototype, { netOwn, netShips, netPlaceBeside });
}
