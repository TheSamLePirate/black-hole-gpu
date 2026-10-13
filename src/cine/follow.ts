// A virtual camera's body, aim, noise and blends, as Cinemachine's (Unity) — the ship's hull views softened
// (chase, dorsal…: controller/camrig.ts) and the director's shots (cine/brain.ts) built from them:
// - the binding: how the camera's offset turns with its target — locked to it (its roll too), locked without
//   the roll, with the world's up (the heading alone: the horizon level), or in the world (not turning);
// - the rotation's damping per axis (pitch, yaw, roll) as a critically damped spring with the target's own
//   turn fed forward: a steady turn (the Endurance's spin) followed without lag, its jolts smoothed;
// - the position's damping: the camera left behind by the target's accelerations (the afterburner pulls away);
// - the lookahead (the aim led along the motion), the composer's screen offset, the dutch (the roll), the lens;
// - the noise profiles (hand-held, shake, rumble, vibration) with their amplitude and frequency gains, and the
//   impulses (a touchdown, a boom, the latches) decaying;
// - the blends' curves: cut, ease in and out, ease in, ease out, hard in, hard out, linear.
// Pure: quaternions and springs (cine/rig.ts vectors).

import { add3, cross3, dot3, fbm, len3, scale3, Spring3, sub3, unit3, type V3 } from "./rig";

// ---- quaternions [x, y, z, w]
export type Q = [number, number, number, number];
export const qId = (): Q => [0, 0, 0, 1];
export function qMul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const qConj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
export function qNorm(q: Q): Q {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
export function qRot(q: Q, v: V3): V3 {
  const u: V3 = [q[0], q[1], q[2]];
  const t = scale3(cross3(u, v), 2);
  return add3(add3(v, t, q[3]), cross3(u, t));
}
/** The rotation by a rotation vector [rad]. */
export function qExp(r: V3): Q {
  const a = len3(r);
  if (a < 1e-12) return qNorm([r[0] / 2, r[1] / 2, r[2] / 2, 1]);
  const s = Math.sin(a / 2) / a;
  return [r[0] * s, r[1] * s, r[2] * s, Math.cos(a / 2)];
}
/** The rotation vector of a rotation (the short way round). */
export function qLog(q: Q): V3 {
  const p = q[3] < 0 ? ([-q[0], -q[1], -q[2], -q[3]] as Q) : q;
  const s = Math.hypot(p[0], p[1], p[2]);
  if (s < 1e-12) return [2 * p[0], 2 * p[1], 2 * p[2]];
  const a = 2 * Math.atan2(s, p[3]);
  return [(p[0] * a) / s, (p[1] * a) / s, (p[2] * a) / s];
}
/** The rotation taking the frame's axes to the columns x, y, z (orthonormal). */
export function qFromAxes(x: V3, y: V3, z: V3): Q {
  const m00 = x[0],
    m11 = y[1],
    m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(y[0] + x[1]) / s, 0.25 * s, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, 0.25 * s, (x[1] - y[0]) / s];
  }
  return qNorm(q);
}
export const qAxes = (q: Q): [V3, V3, V3] => [qRot(q, [1, 0, 0]), qRot(q, [0, 1, 0]), qRot(q, [0, 0, 1])];
export function qSlerp(a: Q, b: Q, t: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb: Q = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  d = Math.abs(d);
  if (d > 0.9995)
    return qNorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  const th = Math.acos(d),
    s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s,
    kb = Math.sin(t * th) / s;
  return [a[0] * ka + bb[0] * kb, a[1] * ka + bb[1] * kb, a[2] * ka + bb[2] * kb, a[3] * ka + bb[3] * kb];
}

// ---- the blends
export type BlendStyle = "cut" | "easeInOut" | "easeIn" | "easeOut" | "hardIn" | "hardOut" | "linear";
export const BLEND_STYLES: BlendStyle[] = ["easeInOut", "easeIn", "easeOut", "hardIn", "hardOut", "linear", "cut"];
/** A blend's weight at its time t ∈ [0, 1] (Cinemachine's curves). */
export function blendCurve(style: BlendStyle, t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  switch (style) {
    case "cut":
      return 1;
    case "linear":
      return x;
    case "easeIn":
      // (slow out of the first view)
      return x * x;
    case "easeOut":
      return 1 - (1 - x) * (1 - x);
    case "hardIn":
      // (slow start, abrupt arrival)
      return x * x * x;
    case "hardOut":
      // (abrupt start, slow arrival)
      return 1 - (1 - x) ** 3;
    default:
      return x * x * x * (x * (6 * x - 15) + 10);
  }
}

// ---- the noise
export type NoiseProfile = "none" | "handheld" | "shake" | "rumble" | "vibration";
export const NOISE_PROFILES: NoiseProfile[] = ["none", "handheld", "shake", "rumble", "vibration"];
/** A profile's channels: per axis (pitch, yaw, roll) its amplitude [°] and frequency [Hz] (two octaves each). */
const PROFILE: Record<NoiseProfile, { amp: V3; freq: number }> = {
  none: { amp: [0, 0, 0], freq: 0 },
  handheld: { amp: [0.35, 0.3, 0.2], freq: 0.45 },
  shake: { amp: [0.6, 0.6, 0.35], freq: 4 },
  rumble: { amp: [0.25, 0.15, 0.1], freq: 11 },
  vibration: { amp: [0.08, 0.08, 0.04], freq: 28 },
};
/** The noise's angles now [rad] (pitch, yaw, roll): a profile, its gains. */
export function noiseAngles(p: NoiseProfile, t: number, ampGain: number, freqGain: number): V3 {
  const P = PROFILE[p];
  if (!P.freq || ampGain <= 0) return [0, 0, 0];
  const f = P.freq * Math.max(freqGain, 0.01);
  const d = Math.PI / 180;
  return [P.amp[0] * ampGain * fbm(t, f, 11.1) * d, P.amp[1] * ampGain * fbm(t, f, 23.7) * d, P.amp[2] * ampGain * fbm(t, f, 37.3) * d];
}

/** The impulses (Cinemachine's impulse sources and listener): each a jolt decaying, their sum an angle shake. */
export class Impulses {
  private list: { k: number; t0: number; decay: number; freq: number }[] = [];
  /** a jolt of strength k (0 … 1: ~1.5°), decaying over `decay` s, shaking at `freq` Hz */
  add(k: number, now: number, decay = 0.6, freq = 9) {
    if (k > 0.01) this.list.push({ k: Math.min(k, 1.5), t0: now, decay, freq });
    if (this.list.length > 16) this.list.shift();
  }
  /** the jolts' angles now [rad] (pitch, yaw, roll) */
  angles(now: number, gain: number): V3 {
    const out: V3 = [0, 0, 0];
    this.list = this.list.filter((i) => now - i.t0 < 4 * i.decay);
    for (const i of this.list) {
      const age = now - i.t0;
      if (age < 0) continue;
      const env = i.k * Math.exp(-age / i.decay) * Math.min(1, age / 0.02);
      const a = (1.5 * Math.PI) / 180;
      out[0] += env * a * fbm(age, i.freq, i.t0 % 17);
      out[1] += env * a * 0.6 * fbm(age, i.freq, (i.t0 % 17) + 5);
      out[2] += env * a * 0.4 * fbm(age, i.freq, (i.t0 % 17) + 9);
    }
    return [out[0] * gain, out[1] * gain, out[2] * gain];
  }
}

// ---- the rotation's damping: a critically damped spring on the orientation, per axis, its target's turn fed
// forward (no lag on a steady turn)
export class RotSpring {
  q: Q | null = null;
  w: V3 = [0, 0, 0];
  private prev: Q | null = null;
  /** the target's turn rate fed forward [rad/s] (its fast and slow averages: steady, fed) */
  rate: V3 = [0, 0, 0];
  private fast: V3 = [0, 0, 0];
  private slow: V3 = [0, 0, 0];
  reset(q: Q | null = null) {
    this.q = q ? [...q] : null;
    this.prev = q ? [...q] : null;
    this.w = [0, 0, 0];
    this.rate = [0, 0, 0];
    this.fast = [0, 0, 0];
    this.slow = [0, 0, 0];
  }
  /**
   * Steps towards `target` (dt [s]); `tau` [s] per axis of the target's frame (pitch: its x, yaw: y, roll: z —
   * 0: rigid on that axis). Returns the orientation.
   */
  step(target: Q, tau: V3, dt: number): Q {
    if (!this.q || !(dt > 0)) {
      if (!this.q) this.reset(target);
      return this.q!;
    }
    // (the target's turn fed forward only while it is steady — the Endurance's spin, a held turn: no lag —; a
    // jolt's own rate not: its fast and slow averages apart, the spring alone smooths it, without overshoot)
    if (this.prev) {
      const r = scale3(qLog(qMul(target, qConj(this.prev))), 1 / dt);
      const kf = Math.min(1, dt / 0.1),
        ks = Math.min(1, dt / 0.8);
      this.fast = add3(scale3(this.fast, 1 - kf), scale3(r, kf));
      this.slow = add3(scale3(this.slow, 1 - ks), scale3(r, ks));
      const steady = Math.exp(-len3(sub3(this.fast, this.slow)) / (0.1 * len3(this.slow) + 0.01));
      this.rate = scale3(this.slow, steady);
    }
    this.prev = [...target];
    const ax = qAxes(target);
    const rigid = tau.map((x) => !(x > 0));
    if (rigid.every(Boolean)) {
      this.q = [...target];
      this.w = [...this.rate];
      return this.q;
    }
    // (sub-steps: stable whatever the frame)
    const tmin = Math.max(1e-3, Math.min(...tau.map((x) => (x > 0 ? x : Infinity))));
    const n = Math.min(40, Math.max(1, Math.ceil(dt / (tmin / 6))));
    const h = dt / n;
    let tq = qMul(qExp(scale3(this.rate, -dt)), target);
    for (let i = 0; i < n; i++) {
      // (the error and the relative turn on the target's axes: each axis its own spring)
      const e = qLog(qMul(tq, qConj(this.q)));
      const dw = sub3(this.w, this.rate);
      let acc: V3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        if (rigid[k]) continue;
        const a = ax[k]!;
        const w0 = 1 / tau[k]!;
        acc = add3(acc, a, w0 * w0 * dot3(e, a) - 2 * w0 * dot3(dw, a));
      }
      this.w = add3(this.w, acc, h);
      // (a rigid axis turns with the target)
      for (let k = 0; k < 3; k++) if (rigid[k]) this.w = add3(this.w, ax[k]!, dot3(this.rate, ax[k]!) - dot3(this.w, ax[k]!));
      this.q = qNorm(qMul(qExp(scale3(this.w, h)), this.q));
      tq = qNorm(qMul(qExp(scale3(this.rate, h)), tq));
    }
    // (the rigid axes on the target exactly)
    const e = qLog(qMul(target, qConj(this.q)));
    let snap: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) if (rigid[k]) snap = add3(snap, ax[k]!, dot3(e, ax[k]!));
    if (len3(snap) > 0) this.q = qNorm(qMul(qExp(snap), this.q));
    return this.q;
  }
}

// ---- a hull view softened (Cinemachine's transposer and composer on the craft's own attach points)
export type Binding = "lockToTarget" | "lockNoRoll" | "worldUp" | "world";
export const BINDINGS: Binding[] = ["lockToTarget", "lockNoRoll", "worldUp", "world"];

export interface FollowOptions {
  binding: Binding;
  /** the rotation's damping per axis [s] (pitch, yaw, roll), the position's [s] (0: rigid) */
  rotDamp: V3;
  posDamp: number;
  /** the aim led along the motion [s of the motion, clamped], the composer's offset of the target on the screen
   *  (−0.5 … 0.5 of the frame, x right, y up), the dutch [°] */
  lookahead: number;
  screen: [number, number];
  dutch: number;
  /** the noise, its gains; the impulses' gain */
  noise: NoiseProfile;
  noiseAmp: number;
  noiseFreq: number;
  impulse: number;
}

export interface FollowInput {
  /** the target's orientation (its axes: left, up, nose — in the local frame), its centre's place [local m about
   *  its origin], its velocity [m/s, local], the world's up (unit, local; null: none) */
  q: Q;
  centre: V3;
  vel: V3;
  up: V3 | null;
  /** the attach point (the target's frame: metres) */
  eye: V3;
  aim: V3;
  /** the field's half-height's tangent and the frame's aspect (the composer's offset) */
  tanH: number;
  aspect: number;
  /** a clock [s] (the noise, the impulses) */
  time: number;
}

/** The orientation a binding follows (the target's, without its roll, its heading alone, or a fixed one). */
export function bindingTarget(b: Binding, q: Q, up: V3 | null, held: Q | null): Q {
  if (b === "lockToTarget" || !up) return b === "world" && held ? held : q;
  if (b === "world") return held ?? q;
  const [, y, z] = qAxes(q);
  if (b === "lockNoRoll") {
    // (the nose kept, the top towards the world's up)
    let u = sub3(up, scale3(z, dot3(up, z)));
    if (len3(u) < 0.05) u = y;
    u = unit3(u);
    const x = cross3(u, z);
    return qFromAxes(unit3(x), u, z);
  }
  // (the heading alone: the nose on the horizon, the top up)
  let f = sub3(z, scale3(up, dot3(z, up)));
  if (len3(f) < 0.05) f = sub3(scale3(y, -1), scale3(up, -dot3(y, up)));
  f = unit3(f);
  const x = cross3(up, f);
  return qFromAxes(unit3(x), up, f);
}

export class Follow {
  readonly rot = new RotSpring();
  private disp = new Spring3();
  private vPrev: V3 | null = null;
  private acc: V3 = [0, 0, 0];
  private held: Q | null = null;
  readonly impulses = new Impulses();
  reset() {
    this.rot.reset();
    this.disp.reset();
    this.vPrev = null;
    this.acc = [0, 0, 0];
    this.held = null;
  }
  /** The view this frame: eye, aim and up in the target's own frame (as its attach points are). */
  step(i: FollowInput, o: FollowOptions, dt: number): { eye: V3; aim: V3; up: V3 } {
    if (o.binding === "world" && !this.held) this.held = [...i.q];
    if (o.binding !== "world") this.held = null;
    const qt = bindingTarget(o.binding, i.q, i.up, this.held);
    // (the attach point's offsets read on the binding's frame — the craft's own when locked to it: settled, the
    // rigid view —, the frame damped)
    const off = this.rot.step(qt, o.rotDamp, dt);
    const cS = qRot(qConj(i.q), i.centre);
    const place = (p: V3): V3 => add3(i.centre, qRot(off, sub3(p, cS)));
    let eye = place(i.eye),
      aim = place(i.aim);
    let up = qRot(off, [0, 1, 0]);
    // ---- the position's damping: left behind by the target's accelerations
    if (dt > 0) {
      if (this.vPrev) {
        const a = scale3(sub3(i.vel, this.vPrev), 1 / dt);
        const k = Math.min(1, dt / 0.1);
        this.acc = add3(scale3(this.acc, 1 - k), scale3(a, k));
      }
      this.vPrev = [...i.vel];
    }
    if (o.posDamp > 0 && dt > 0) {
      // (the lag a steady acceleration leaves: a τ² — the spring towards it)
      const reach = len3(sub3(eye, aim)) * 0.35;
      let want = scale3(this.acc, -o.posDamp * o.posDamp);
      if (len3(want) > reach) want = scale3(unit3(want), reach);
      eye = add3(eye, this.disp.step(want, o.posDamp, dt));
    } else if (o.posDamp > 0 && this.disp.x) {
      // (no time — the scene paused —: the lag held where it was, not dropped at once)
      eye = add3(eye, this.disp.x);
    } else this.disp.reset([0, 0, 0]);
    // ---- the lookahead: the aim led along the motion (at most a fifth of the view's distance)
    if (o.lookahead > 0) {
      const d = len3(sub3(aim, eye));
      let lead = scale3(i.vel, o.lookahead);
      if (len3(lead) > 0.2 * d) lead = scale3(unit3(lead), 0.2 * d);
      aim = add3(aim, lead);
    }
    // ---- the composer's screen offset, the dutch, the noise, the impulses: turns of the look about the eye
    // (the camera's right and up as shipToCamera builds them: right = fwd × up, up = right × fwd)
    const f0 = unit3(sub3(aim, eye));
    const r0 = unit3(cross3(f0, up), [-1, 0, 0]);
    const u0 = cross3(r0, f0);
    const dist = len3(sub3(aim, eye));
    const n = noiseAngles(o.noise, i.time, o.noiseAmp, o.noiseFreq);
    const j = this.impulses.angles(i.time, o.impulse);
    // (the target at (sx, sy) of the frame: the look turned the other way)
    const yaw = -Math.atan(2 * o.screen[0] * i.tanH * i.aspect) + n[1] + j[1];
    const pitch = -Math.atan(2 * o.screen[1] * i.tanH) + n[0] + j[0];
    const roll = (o.dutch * Math.PI) / 180 + n[2] + j[2];
    if (yaw || pitch) aim = add3(add3(aim, r0, Math.tan(yaw) * dist), u0, Math.tan(pitch) * dist);
    if (roll) up = add3(scale3(u0, Math.cos(roll)), r0, -Math.sin(roll));
    // (back to the target's own frame)
    const back = qConj(i.q);
    return { eye: qRot(back, eye), aim: qRot(back, aim), up: unit3(qRot(back, up)) };
  }
}

// ---- a blend between two views of a craft
export interface Pose3 {
  eye: V3;
  aim: V3;
  up: V3;
}
/** The rotation looking along `f` with `up` (its z the look, its y the up), as a quaternion. */
export function lookQ(f: V3, up: V3): Q {
  // (a right-handed frame: x = up × z, y = z × x — its z and y the look and its up)
  const z = unit3(f);
  let x = cross3(up, z);
  if (len3(x) < 1e-6) x = cross3(Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], z);
  x = unit3(x);
  const y = cross3(z, x);
  return qFromAxes(x, y, z);
}
/**
 * Between two views at weight k (0: from, 1: to): the eye swung round `centre` (its direction slerped, its
 * distance eased — never through the hull), the look's direction and roll slerped (never flipping when the
 * views look opposite ways), the distance to the aim eased.
 */
export function blendPose(a: Pose3, b: Pose3, k: number, centre: V3): Pose3 {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const ra = sub3(a.eye, centre),
    rb = sub3(b.eye, centre);
  const la = len3(ra),
    lb = len3(rb);
  let eye: V3;
  if (la < 1e-6 || lb < 1e-6) eye = add3(a.eye, sub3(b.eye, a.eye), k);
  else {
    // (the direction slerped as a rotation from one to the other; the radius eased)
    const da = scale3(ra, 1 / la),
      db = scale3(rb, 1 / lb);
    const ax = cross3(da, db);
    const s = len3(ax),
      c = dot3(da, db);
    const ang = Math.atan2(s, c);
    const axis: V3 = s > 1e-9 ? scale3(ax, 1 / s) : Math.abs(da[1]) < 0.9 ? unit3(cross3(da, [0, 1, 0])) : [1, 0, 0];
    const d = ang > 1e-9 ? qRot(qExp(scale3(axis, ang * k)), da) : da;
    eye = add3(centre, scale3(d, la + (lb - la) * k));
  }
  const fa = sub3(a.aim, a.eye),
    fb = sub3(b.aim, b.eye);
  const q = qSlerp(lookQ(fa, a.up), lookQ(fb, b.up), k);
  const [, y, z] = qAxes(q);
  const dist = len3(fa) + (len3(fb) - len3(fa)) * k;
  return { eye, aim: add3(eye, scale3(z, dist)), up: y };
}
