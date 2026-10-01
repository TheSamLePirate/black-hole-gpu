// The International Space Station on its real orbit: its latest elements (CelesTrak's, fetched when the
// game runs; those of 1 October 2026 bundled), propagated by SGP4 (sgp4.ts) and turned into the Earth's
// own axes by the sidereal time — on the very axes the game turns the Earth by (orientation.ts), so that
// it passes over the right places at the right times. It flies as it does (+XVV, LVLH): its x along the
// velocity, z to the nadir, y to starboard; its solar arrays track the Sun (the alpha joints turn the
// masts square to it, the beta gimbals the blankets onto it), its radiators edge-on to it.
//
// Near the Ranger (30 km) it is flown instead with the game's own gravity and drag from where SGP4 put
// it — the same fall as the ship's: the analytic orbit's J2 and the game's point masses would part the
// two by metres a minute, and docking takes centimetres.

import type { Vec3 } from "../physics";
import { EPOCH_DATE, M_METRES, M_SECONDS, solarBody, solarState, bodyAxes, utcOf } from "./solar";
import { gravityHome } from "./our-side";
import { dragAccel } from "./our-surface";
import { gmst, parseOmm, sgp4, type Elements, type Sgp4 } from "./sgp4";

const C_KMS = 299792.458;
/** seconds per M (the game's time unit) */
const M_S = M_METRES / 299792458;

// the elements of 1 October 2026 (CelesTrak, GP data): the fallback, and the start before the fetch
const BUNDLED = {
  OBJECT_NAME: "ISS (ZARYA)", EPOCH: "2026-10-01T02:39:00.159264", MEAN_MOTION: 15.48700165, ECCENTRICITY: 0.00069663,
  INCLINATION: 51.6315, RA_OF_ASC_NODE: 135.8796, ARG_OF_PERICENTER: 208.5453, MEAN_ANOMALY: 151.5154, BSTAR: 6.8953808e-5,
};
const URL_GP = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON";
const CACHE_KEY = "kerr.iss-gp";

let el: Elements = parseOmm(BUNDLED);
let prop: Sgp4 = sgp4(el);
/** the same orbit without its drag: far from the elements' epoch the station keeps its height, as its
 *  reboosts keep it — not decayed by months of SGP4's drag */
let propKept: Sgp4 = sgp4({ ...el, bstar: 0 });
let fetching: Promise<void> | null = null;

/** The elements in use (their epoch, their source). */
export function issElements() {
  return el;
}

function use(e: Elements) {
  if (!(e.epochMs > el.epochMs) || !Number.isFinite(e.n)) return;
  el = e;
  prop = sgp4(e);
  propKept = sgp4({ ...e, bstar: 0 });
}

/** Fetches the latest elements once (cached 6 h in this browser): the station where it really is now. */
export function refreshIssElements(): Promise<void> {
  if (fetching) return fetching;
  fetching = (async () => {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
      if (c?.omm) use(parseOmm(c.omm));
      if (c && Date.now() - c.at < 6 * 3600e3) return;
    } catch {
      /* (private mode) */
    }
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(URL_GP, { signal: ctl.signal });
      clearTimeout(timer);
      const j = await r.json();
      const omm = Array.isArray(j) ? j[0] : j;
      if (omm?.EPOCH) {
        use(parseOmm(omm));
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), omm }));
        } catch {
          /* */
        }
      }
    } catch {
      /* (offline: the bundled elements) */
    }
  })();
  return fetching;
}

const lin = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The station by SGP4 at the game's time t [M]: its place and velocity in the home frame [M, c] — the
 * Earth's own axes (bodyAxes: the same sidereal time) at the Earth's centre — or null when its orbit
 * has decayed in the propagation.
 */
export function issOrbit(t: number): { X: Vec3; V: Vec3 } | null {
  const utc = utcOf(t);
  const min = (utc - el.epochMs) / 60e3;
  const s = (Math.abs(min) > 14 * 1440 ? propKept : prop).propagate(min);
  if (!s) return null;
  // TEME → the Earth's axes (pseudo Earth-fixed): turned by the mean sidereal time; the inertial
  // velocity turned alike (no ω × r: the home frame does not turn)
  const g = gmst(utc), c = Math.cos(g), sn = Math.sin(g);
  const turn = (v: readonly number[]): Vec3 => [c * v[0]! + sn * v[1]!, -sn * v[0]! + c * v[1]!, v[2]!];
  const r = turn(s.r), v = turn(s.v);
  const A = bodyAxes(solarBody("earth")!, t);
  const E = solarState("earth", t);
  const km = 1e3 / M_METRES;
  const X: Vec3 = [0, 1, 2].map((k) => E.pos[k]! + (r[0] * A[0][k]! + r[1] * A[1][k]! + r[2] * A[2][k]!) * km) as Vec3;
  const V: Vec3 = [0, 1, 2].map((k) => E.vel[k]! + (v[0] * A[0][k]! + v[1] * A[1][k]! + v[2] * A[2][k]!) / C_KMS) as Vec3;
  return { X, V };
}

/**
 * The station's attitude, LVLH flying +XVV: x along the velocity (in the orbit's plane, square to the
 * radius), z to the nadir, y to starboard (− the orbit's normal) — home vectors.
 */
export function issAxes(X: Vec3, V: Vec3, t: number): [Vec3, Vec3, Vec3] {
  const E = solarState("earth", t);
  const r = sub(X, E.pos), v = sub(V, E.vel);
  const z = unit(lin(r, -1, r, 0));
  const y = unit(cross(v, r)); // −h: r × v points along the normal; v × r against it
  const x = cross(y, z);
  return [x, y, z];
}

/** The station's joints and docking ports (station frame, metres: x forward, y starboard, z nadir). */
export interface StationJoint { pivot: Vec3; axis: Vec3; normal: Vec3; parent: number; kind: number }
export interface StationPort { centre: Vec3; axis: Vec3; name: string }
export const PORT_NAMES = ["IDA-2 · Harmony forward", "IDA-3 · Harmony zenith"];

/** The station's joints and ports, once its model is in (station.ts). */
export const station: { joints: StationJoint[]; ports: StationPort[] } = {
  joints: [],
  // (as the model has them — scripts/build-iss.py — before it is loaded)
  ports: [
    { centre: [15.655, -0.017, 5.56], axis: [1, 0, 0], name: PORT_NAMES[0]! },
    { centre: [11.668, -0.017, 0.263], axis: [0, 0, -1], name: PORT_NAMES[1]! },
  ],
};
export function setStationGeometry(joints: StationJoint[], ports: StationPort[]) {
  station.joints = joints;
  station.ports = ports;
}

/** Rotation by angle a about a unit axis k (Rodrigues), applied to v. */
export function rotAbout(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  const kx = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kx[0] * s + k[0] * kd, v[1] * c + kx[1] * s + k[1] * kd, v[2] * c + kx[2] * s + k[2] * kd];
}

/** A rigid transform: the images of x, y, z, then the translation (columns). */
export type M34 = [Vec3, Vec3, Vec3, Vec3];
export const m34mul = (A: M34, B: M34): M34 => {
  const ap = (v: Vec3, w: number): Vec3 => [0, 1, 2].map((k) => A[0][k]! * v[0] + A[1][k]! * v[1] + A[2][k]! * v[2] + w * A[3][k]!) as Vec3;
  return [ap(B[0], 0), ap(B[1], 0), ap(B[2], 0), ap(B[3], 1)];
};
/** x ↦ M x (w = 1: a point; 0: a direction), and its inverse (M rigid). */
export const m34apply = (M: M34, v: Vec3, w = 1): Vec3 => [0, 1, 2].map((k) => M[0][k]! * v[0] + M[1][k]! * v[1] + M[2][k]! * v[2] + w * M[3][k]!) as Vec3;
export const m34unapply = (M: M34, v: Vec3, w = 1): Vec3 => {
  const d: Vec3 = [v[0] - w * M[3][0], v[1] - w * M[3][1], v[2] - w * M[3][2]];
  return [dot(M[0], d), dot(M[1], d), dot(M[2], d)];
};
/** A rotation by a about the line through p along k. */
const rotM = (p: Vec3, k: Vec3, a: number): M34 => {
  const c0 = rotAbout([1, 0, 0], k, a), c1 = rotAbout([0, 1, 0], k, a), c2 = rotAbout([0, 0, 1], k, a);
  const rp = rotAbout(p, k, a);
  return [c0, c1, c2, [p[0] - rp[0], p[1] - rp[1], p[2] - rp[2]]];
};

/** The parts' transforms (the station, then each joint's): at rest → turned, a gimbal after its alpha joint. */
export function partTransforms(joints: StationJoint[], angles: number[]): M34[] {
  const I: M34 = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];
  const out: M34[] = [I];
  const own = joints.map((j, k) => rotM(j.pivot, j.axis, angles[k] ?? 0));
  joints.forEach((j, k) => out.push(j.parent >= 0 ? m34mul(own[j.parent]!, own[k]!) : own[k]!));
  while (out.length < 13) out.push(I);
  return out;
}

/** The joints' angles at time t for the station at (X, V) [home]: the Sun's direction in its frame. */
export function stationAngles(t: number, X: Vec3, V: Vec3): number[] {
  const A = issAxes(X, V, t);
  const S = solarState("sun", t).pos;
  const s = unit(sub(S, X));
  return jointAngles(station.joints, [dot(s, A[0]), dot(s, A[1]), dot(s, A[2])]);
}

/**
 * The joints' angles for the Sun at `sun` (a unit vector, station frame): each alpha joint turns its
 * masts square to the Sun, each beta gimbal turns its blanket onto it (either face: the cells on one, the
 * other a fair light), each radiator joint turns its panels edge-on to it. In the Earth's shadow the
 * arrays hold where they were (the station's night-glider mode aside).
 */
export function jointAngles(joints: StationJoint[], sun: Vec3): number[] {
  const ang = joints.map(() => 0);
  joints.forEach((j, i) => {
    if (j.kind === 1) {
      // (alpha: about the truss's axis a, the first beta's mast m0 turned to m ⊥ sun)
      const beta = joints.find((q) => q.parent === i && q.kind === 2);
      if (!beta) return;
      const a = j.axis, m0 = beta.axis;
      const am = cross(a, m0);
      ang[i] = Math.atan2(-dot(m0, sun), dot(am, sun));
    }
  });
  joints.forEach((j, i) => {
    if (j.kind === 2) {
      const al = j.parent >= 0 ? ang[j.parent]! : 0;
      const pa = j.parent >= 0 ? joints[j.parent]!.axis : ([0, 1, 0] as Vec3);
      // (its mast and rest normal after the alpha joint)
      const m = rotAbout(j.axis, pa, al);
      const n0 = rotAbout(j.normal, pa, al);
      const w = cross(m, n0);
      ang[i] = Math.atan2(dot(w, sun), dot(n0, sun));
    } else if (j.kind === 3) {
      // (radiators: their normal square to the Sun — edge-on; the model's normal leans 0.4° along the
      // joint's axis: taken square to it)
      const n0 = unit(lin(j.normal, 1, j.axis, -dot(j.normal, j.axis))), w = cross(j.axis, n0);
      ang[i] = Math.atan2(dot(n0, sun), -dot(w, sun)) + 0;
    }
  });
  return ang;
}

/**
 * The station's place: by SGP4 (its real orbit); within 30 km of the ship, flown from there with the
 * game's own gravity and drag — the ship's — in steps of 2 s at most. A jump of the clock, or a long
 * gap, re-anchors it on SGP4.
 */
export class IssTracker {
  private st: { t: number; X: Vec3; V: Vec3 } | null = null;
  /** within the ship's reach (its own fall) */
  near = false;
  /** times it was put back on SGP4 (a jump of the clock, the ship gone and back) */
  anchors = 0;

  state(t: number, ship: Vec3 | null): { X: Vec3; V: Vec3 } | null {
    const sg = issOrbit(t);
    if (!sg) return null;
    // (at the same instant: its last state may be seconds behind at warp — 7.7 km a second)
    const d = ship ? Math.hypot(...sub(ship, sg.X)) * M_METRES : Infinity;
    if (d > (this.near ? 40e3 : 30e3)) {
      this.near = false;
      this.st = null;
      return sg;
    }
    this.near = true;
    const st = this.st;
    // (a little before its last state — the renderer asks for the frame drawn, the flight for the next:
    // flown back from there, not re-anchored; a jump of the clock re-anchors it)
    if (st && t < st.t && (st.t - t) * M_S < 120) return this.flown(st, t);
    if (!st || t < st.t || (t - st.t) * M_S > 600) {
      this.anchors++;
      this.st = { t, X: sg.X, V: sg.V };
      return this.st;
    }
    this.st = this.flown(st, t);
    return this.st;
  }

  /** The place now without moving it on (the last state), or null. */
  last() {
    return this.st;
  }

  /** The state flown from `st` to t1 (either way: velocity Verlet is reversible). */
  private flown(st: { t: number; X: Vec3; V: Vec3 }, t1: number) {
    const span = t1 - st.t;
    if (span === 0) return st;
    const n = Math.max(1, Math.ceil((Math.abs(span) * M_S) / 2));
    const h = span / n;
    let { X, V, t } = st;
    const acc = (Xq: Vec3, Vq: Vec3, tq: number) => lin(gravityHome(Xq, tq).acc, 1, dragAccel("earth", Xq, Vq, tq), 1);
    let a = acc(X, V, t);
    for (let i = 0; i < n; i++) {
      // (velocity Verlet: the ship's own scheme in the air)
      V = lin(V, 1, a, h / 2);
      X = lin(X, 1, V, h);
      t += h;
      a = acc(X, V, t);
      V = lin(V, 1, a, h / 2);
    }
    return { t: t1, X, V };
  }
}

/** The one tracker: the renderer draws where the game flies it. */
export const issTrack = new IssTracker();

/** The game's clock [M] at a UTC instant [ms] (utcOf's inverse). */
export const gameTimeOf = (utcMs: number) => (utcMs - EPOCH_DATE) / (M_SECONDS * 1e3);

/** The Ranger's docking ring in its own frame (x left, y up, z nose) [m]: its rear hatch. */
export const RANGER_RING: Vec3 = [0.04, 1.11, -5.34];

/**
 * A start beside the station: the Ranger `dist` metres out along the axis of IDA-2 (Harmony's forward
 * port; `offset` [m, station frame] off it
 * port: ahead of the station on its orbit), its nose along that axis and its top to the zenith — its
 * rear hatch facing the port, to back in. Home frame: its centre, nose, top, velocity (the station's,
 * with the turn of the orbit at that offset).
 */
export function issStart(t: number, dist = 150, offset: Vec3 = [0, 0, 0]) {
  const iss = issOrbit(t);
  if (!iss) return null;
  const A = issAxes(iss.X, iss.V, t);
  const st = (v: Vec3): Vec3 => lin(lin(A[0], v[0], A[1], v[1]), 1, A[2], v[2]);
  const p = station.ports[0]!;
  const z = st(p.axis);
  const y = lin(A[2], -1, A[2], 0);
  const x = cross(y, z);
  const m = 1 / M_METRES;
  const ringH = lin(lin(x, RANGER_RING[0], y, RANGER_RING[1]), 1, z, RANGER_RING[2]);
  const X = lin(lin(iss.X, 1, st(lin(p.centre, 1, offset, 1)), m), 1, lin(z, dist, ringH, -1), m);
  const E = solarState("earth", t);
  const r = sub(iss.X, E.pos), v = sub(iss.V, E.vel);
  const om = lin(cross(r, v), 1 / dot(r, r), r, 0);
  const V = lin(iss.V, 1, cross(om, sub(X, iss.X)), 1);
  return { X, fwd: z, up: y, vel: V };
}
