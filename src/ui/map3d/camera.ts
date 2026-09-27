// The 3D map's camera: it orbits a focus point, its angles measured in a reference plane (the
// system's plane, a planet's equator, an orbit's plane) — yaw about the plane's normal, elevation
// above it (90°: looking straight down on the plane). Every change is eased, the plane itself too
// (its basis turned by a quaternion slerp), so a jump from a planet's equator to the ship's orbit
// reads as a camera move, not a cut. Distances in the map's units (M), float64 throughout: the
// scale runs from a low orbit to the edge of the solar system.

export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** A right-handed basis (e1, e2 in the plane, n its normal) → the quaternion turning x, y, z onto it. */
export function basisQuat(e1: V3, e2: V3, n: V3): Quat {
  const m00 = e1[0], m10 = e1[1], m20 = e1[2];
  const m01 = e2[0], m11 = e2[1], m21 = e2[2];
  const m02 = n[0], m12 = n[1], m22 = n[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(...q);
  return q.map((x) => x / l) as Quat;
}

export function rotate(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const t = scale(cross([x, y, z], v), 2);
  return add(add(v, scale(t, w)), cross([x, y, z], t));
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? (b.map((x) => -x) as Quat) : b;
  d = Math.abs(d);
  if (d > 0.9995) {
    const q = a.map((x, i) => x + (bb[i]! - x) * t) as Quat;
    const l = Math.hypot(...q);
    return q.map((x) => x / l) as Quat;
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return a.map((x, i) => ka * x + kb * bb[i]!) as Quat;
}

/** A plane's basis from its normal (and a preferred in-plane x). */
export function planeBasis(n: V3, x?: V3): [V3, V3, V3] {
  const nn = norm(n);
  let e1 = x ? sub(x, scale(nn, dot(x, nn))) : cross(Math.abs(nn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], nn);
  if (len(e1) < 1e-9) e1 = cross(Math.abs(nn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], nn);
  e1 = norm(e1);
  return [e1, cross(nn, e1), nn];
}

export interface View {
  /** the focus (map units), the plane's basis, yaw [rad], elevation [rad], distance, vertical field of view [rad] */
  focus: V3;
  plane: Quat;
  yaw: number;
  pitch: number;
  dist: number;
}

export interface Projected {
  x: number;
  y: number;
  /** depth along the view [map units] (≤ 0: behind the camera) */
  z: number;
  /** pixels per map unit at that depth */
  k: number;
}

export class MapCamera {
  cur: View = { focus: [0, 0, 0], plane: [0, 0, 0, 1], yaw: -0.6, pitch: 0.55, dist: 10 };
  goal: View = { focus: [0, 0, 0], plane: [0, 0, 0, 1], yaw: -0.6, pitch: 0.55, dist: 10 };
  fov = (40 * Math.PI) / 180;
  minDist = 1e-9;
  maxDist = 1e6;
  /** the frame's derived axes (world) */
  eye: V3 = [0, 0, 10];
  fwd: V3 = [0, 0, -1];
  right: V3 = [1, 0, 0];
  up: V3 = [0, 1, 0];
  private w = 1;
  private h = 1;
  private f = 1;

  /** Eases the view towards the goal; true while it still moves. */
  update(dt: number): boolean {
    const c = this.cur, g = this.goal;
    const k = 1 - Math.exp(-dt * 7);
    const kd = 1 - Math.exp(-dt * 6);
    let moving = false;
    const step = (a: number, b: number, kk: number, eps: number) => {
      const d = b - a;
      if (Math.abs(d) > eps) moving = true;
      return Math.abs(d) <= eps ? b : a + d * kk;
    };
    // (the yaw the short way round)
    let dy = g.yaw - c.yaw;
    dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
    c.yaw = step(c.yaw, c.yaw + dy, k, 1e-5);
    c.pitch = step(c.pitch, g.pitch, k, 1e-5);
    // distance on a log scale (zooms feel even)
    const ld = step(Math.log(c.dist), Math.log(g.dist), kd, 1e-5);
    c.dist = Math.exp(ld);
    // focus: relative to the distance (a move across the system and a nudge near a moon both ease)
    const df = sub(g.focus, c.focus);
    if (len(df) > c.dist * 1e-5) {
      moving = true;
      c.focus = add(c.focus, scale(df, k));
    } else c.focus = [...g.focus];
    const qd = Math.abs(c.plane[0] * g.plane[0] + c.plane[1] * g.plane[1] + c.plane[2] * g.plane[2] + c.plane[3] * g.plane[3]);
    if (qd < 1 - 1e-10) {
      moving = true;
      c.plane = slerp(c.plane, g.plane, k);
    } else c.plane = [...g.plane];
    this.derive();
    return moving;
  }

  /** Jumps to the goal (no easing). */
  snap() {
    this.cur = structuredClone(this.goal);
    this.derive();
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.f = h / 2 / Math.tan(this.fov / 2);
  }

  get focal() {
    return this.f;
  }

  private derive() {
    const c = this.cur;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    // (in the plane's frame: the eye's offset, and "north" — the view's up, defined at every elevation)
    const o: V3 = [cp * sy, -cp * cy, sp];
    const north: V3 = [-sp * sy, sp * cy, cp];
    const off = rotate(c.plane, o);
    this.eye = add(c.focus, scale(off, c.dist));
    this.fwd = scale(off, -1);
    this.up = rotate(c.plane, north);
    this.right = cross(this.fwd, this.up);
  }

  /** A point on the screen (pixels, CSS) and its depth. */
  project(p: V3): Projected {
    const d = sub(p, this.eye);
    const z = dot(d, this.fwd);
    const k = this.f / Math.max(z, 1e-30);
    return { x: this.w / 2 + dot(d, this.right) * k, y: this.h / 2 - dot(d, this.up) * k, z, k };
  }

  /** The view ray through a screen point (world direction). */
  ray(x: number, y: number): V3 {
    const u = (x - this.w / 2) / this.f, v = -(y - this.h / 2) / this.f;
    return norm(add(this.fwd, add(scale(this.right, u), scale(this.up, v))));
  }

  // ---------------------------------------------------------------------------- the user's gestures
  orbit(dx: number, dy: number) {
    const g = this.goal;
    g.yaw -= dx * 0.006;
    g.pitch = clamp(g.pitch + dy * 0.006, -Math.PI / 2 + 1e-4, Math.PI / 2 - 1e-4);
    // (dragging answers at once: no lag on the hand)
    this.cur.yaw = g.yaw;
    this.cur.pitch = g.pitch;
    this.derive();
  }

  /** Moves the focus with the pointer (pixels), in the view's plane at the focus's depth. */
  pan(dx: number, dy: number) {
    const k = this.goal.dist / this.f;
    const d = add(scale(this.right, -dx * k), scale(this.up, dy * k));
    this.goal.focus = add(this.goal.focus, d);
    this.cur.focus = add(this.cur.focus, d);
    this.derive();
  }

  /** Zooms by a factor, towards a screen point (the point under the pointer stays put). */
  zoom(factor: number, x?: number, y?: number) {
    const g = this.goal;
    const nd = clamp(g.dist * factor, this.minDist, this.maxDist);
    if (x !== undefined && y !== undefined) {
      // (the point at the focus's depth under the pointer, kept under it)
      const u = (x - this.w / 2) / this.f, v = -(y - this.h / 2) / this.f;
      const shift = (g.dist - nd) * 1;
      g.focus = add(g.focus, add(scale(this.right, u * shift), scale(this.up, v * shift)));
    }
    g.dist = nd;
  }

  /** Sets the reference plane (eased), keeping the angles relative to it. */
  setPlane(e1: V3, e2: V3, n: V3) {
    this.goal.plane = basisQuat(e1, e2, n);
  }
}
