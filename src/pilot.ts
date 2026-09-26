// Flight computer of the Ranger: attitude control (reaction wheels / RCS with inertia), stability
// assist, attitude holds, and autopilots that fly like a real one — they point the main engine
// along the required burn and throttle it once aligned, the RCS doing the fine corrections.
//
// Frames: "local" = the components the camera's vectors are given in (the ZAMO frame (r̂, θ̂, φ̂) near
// the hole, rep vectors in the wormhole's throat). "C" = the camera's own axes (x right, y up,
// z forward). The ship's axes in C are the columns of S (mounts.ts: shipToCamera): x to the ship's
// left, y up, z the nose. Rotations are applied to the camera, which carries the ship.
//
// Translation is physical: a proper acceleration (c²/M) on the Kerr geodesic (geodesic.ts), in the
// scene's time. Attitude runs in the pilot's (wall-clock) seconds.

import type { M3, V3 } from "./mounts";

export type Hold = "none" | "prograde" | "retrograde" | "radialOut" | "radialIn" | "normal" | "antinormal" | "target";
export type Auto = "none" | "hover" | "circularize" | "approach" | "orbit" | "node" | "transfer" | "land" | "takeoff";

export const HOLD_NAMES: Record<Hold, string> = {
  none: "Manual", prograde: "Prograde", retrograde: "Retrograde", radialOut: "Radial out", radialIn: "Radial in",
  normal: "Normal", antinormal: "Anti-normal", target: "Target",
};
export const AUTO_NAMES: Record<Auto, string> = { none: "Off", hover: "Hold position", circularize: "Circularize", approach: "Approach target", orbit: "Orbit target", node: "Execute node", transfer: "Low-thrust transfer", land: "Landing", takeoff: "Take-off to orbit" };

/** Pilot's commands, −1 … 1 (rotation: positive = nose up, nose right, roll right). */
export interface PilotInput {
  pitch: number;
  yaw: number;
  roll: number;
  /** RCS translation along the ship's right, up, forward. */
  tx: number;
  ty: number;
  tz: number;
  /** throttle change rate (−1 … 1 per second of full scale) */
  throttle: number;
}

export interface FlightContext {
  dt: number; // wall-clock seconds
  /** the camera's axes and velocity (local components); velocity = 3-velocity β */
  right: V3;
  up: V3;
  fwd: V3;
  beta: V3;
  /** ship → camera rows */
  S: M3;
  /** max main-engine proper acceleration [c²/M] */
  thrust: number;
  /** proper time per wall second at this warp (for the autopilots' response) */
  tauRate: number;
  /** unit vector away from the hole (local), or null */
  radialOut: V3 | null;
  /** direction of the target (local), or null */
  target: V3 | null;
  /** autopilot: required velocity (local 3-velocity) and feed-forward proper acceleration (local) */
  want?: { beta: V3; ff: V3; pos?: V3 } | null;
  /** executing a manoeuvre node: the burn's direction (local) and the throttle wanted once aligned;
   *  far: the burn is still far off (an attitude hold may point the nose meanwhile) */
  burn?: { dir: V3; throttle: number; far?: boolean } | null;
  /** at a warp where the burn turns (with the orbit) faster than the ship can: the nose is held on it
   *  kinematically (attitude on rails), not flown */
  snap?: boolean;
}

export interface FlightOutput {
  /** rotation to apply to the camera this frame: rotation vector in C [rad] */
  rot: V3;
  /** proper acceleration of the ship (local components) [c²/M] */
  acc: V3;
  /** the autopilot's burn direction (local), for the displays */
  burn: V3 | null;
}

const MAX_RATE = 0.75; // rad/s
const ALPHA = 1.6; // rad/s² (reaction wheels + RCS)
export const RCS = 0.08; // RCS translation acceleration, fraction of the main engine

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 4-velocity (spatial part, γβ) ↔ 3-velocity. */
export const toU = (b: V3): V3 => scale(b, 1 / Math.sqrt(Math.max(1 - dot(b, b), 1e-9)));
export const toBeta = (u: V3): V3 => scale(u, 1 / Math.sqrt(1 + dot(u, u)));

export class FlightComputer {
  /** body rates about the ship's x (left), y (up), z (nose) axes [rad/s] */
  omega: V3 = [0, 0, 0];
  throttle = 0;
  sas = true;
  /** while the nose is pointed (holds, autopilots, burns): roll the wings into the orbital plane */
  rollAlign = true;
  hold: Hold = "none";
  auto: Auto = "none";
  /** last proper acceleration [c²/M] and where the attitude controller points */
  accel = 0;
  burn: V3 | null = null;
  /** the position an autopilot holds (local frame of the moment it engaged), if any */
  anchor: V3 | null = null;

  setHold(h: Hold) {
    this.hold = this.hold === h ? "none" : h;
    if (this.hold !== "none") this.auto = "none";
  }
  setAuto(a: Auto) {
    this.auto = this.auto === a ? "none" : a;
    this.anchor = null;
    if (this.auto !== "none") this.hold = "none";
    else this.throttle = 0;
  }

  step(c: FlightContext, inp: PilotInput): FlightOutput {
    const { dt, S } = c;
    const col = (i: number): V3 => [S[0][i], S[1][i], S[2][i]];
    const X = col(0), Y = col(1), Z = col(2); // ship axes in C
    const toC = (v: V3): V3 => [dot(v, c.right), dot(v, c.up), dot(v, c.fwd)];
    const fromC = (v: V3): V3 => add(add(scale(c.right, v[0]), scale(c.up, v[1])), scale(c.fwd, v[2]));
    const body = (vC: V3): V3 => [dot(X, vC), dot(Y, vC), dot(Z, vC)];

    // ---- autopilot: required proper acceleration → a burn direction and a throttle
    let rcsC: V3 = [0, 0, 0];
    let point: V3 | null = null; // desired nose direction (C)
    this.burn = null;
    let throttle = this.throttle;
    if (this.auto === "node" && c.burn) {
      // manoeuvre node: point along the burn, fire only when on it (within ~3°); long before it, an
      // attitude hold may keep the nose elsewhere
      this.burn = c.burn.dir;
      if (c.burn.far && this.hold !== "none") {
        point = this.holdDirection(c, toC);
        throttle = 0;
      } else {
        point = toC(c.burn.dir);
        const align = c.snap ? 1 : dot(Z, point);
        throttle = c.burn.throttle * clamp((align - 0.9945) / (0.9994 - 0.9945), 0, 1);
      }
    } else if (this.auto !== "none" && c.want) {
      const U = toU(c.beta);
      const T = Math.max(1.2 * c.tauRate, 1e-3);
      let A = add(scale(add(toU(c.want.beta), scale(U, -1)), 1 / T), c.want.ff);
      const a = len(A);
      const rcsMax = RCS * c.thrust;
      if (a < 0.8 * rcsMax) {
        rcsC = toC(A); // fine corrections: RCS only, no need to turn (an attitude hold may point the nose)
        throttle = 0;
        if (this.hold !== "none") point = this.holdDirection(c, toC);
      } else {
        this.burn = scale(A, 1 / a);
        point = toC(this.burn);
        // throttle only once the nose is on the burn vector (cos 12° … cos 3°)
        const align = c.snap ? 1 : dot(Z, point);
        const k = clamp((align - 0.978) / (0.9986 - 0.978), 0, 1);
        throttle = clamp(a / c.thrust, 0, 1) * k;
        // the RCS takes the rest (sideways part), within its authority
        const main = scale(point, throttle * c.thrust);
        const rest = add(toC(A), scale(main, -1));
        const rl = len(rest);
        rcsC = rl > rcsMax ? scale(rest, rcsMax / rl) : rest;
        A = [0, 0, 0];
      }
    } else if (this.hold !== "none") {
      point = this.holdDirection(c, toC);
    }

    // ---- attitude: rate command (fly-by-wire), holds point the nose, SAS damps
    // (the camera frame is left-handed relative to the ship's: a positive rotation about its x axis
    // lifts the nose, about y turns it right, about z rolls left)
    const manual: V3 = [inp.pitch, inp.yaw, -inp.roll];
    const want: V3 = [...this.omega];
    const active = manual.some((m) => m !== 0);
    if (point && !active) {
      const e = cross(Z, point);
      const s = len(e);
      const ang = Math.atan2(s, dot(Z, point));
      // braking curve far away (reach the target at rest), linear near it (no chattering)
      const rate = Math.min(MAX_RATE, Math.sqrt(2 * 0.7 * ALPHA * ang), 3 * ang);
      const wC = s > 1e-9 ? scale(e, rate / s) : [0, 0, 0] as V3;
      const wb = body(wC);
      want[0] = wb[0];
      want[1] = wb[1];
      // roll: the ship's top towards the orbit's normal — its wings in the orbital plane (along the
      // normal itself, towards the hole instead)
      want[2] = 0;
      const up = this.rollAlign ? this.levelUp(c, toC, Z) : null;
      if (up) {
        const ra = Math.atan2(dot(cross(Y, up), Z), dot(Y, up));
        want[2] = Math.sign(ra) * Math.min(MAX_RATE, Math.sqrt(2 * 0.7 * ALPHA * Math.abs(ra)), 3 * Math.abs(ra));
      }
    } else {
      for (let i = 0; i < 3; i++) {
        if (manual[i] !== 0) want[i] = this.sas ? manual[i]! * MAX_RATE : this.omega[i]! + manual[i]! * ALPHA * dt;
        else if (this.sas) want[i] = 0;
      }
    }
    for (let i = 0; i < 3; i++) {
      const d = clamp(want[i]! - this.omega[i]!, -ALPHA * dt, ALPHA * dt);
      this.omega[i] = clamp(this.omega[i]! + d, -1.5 * MAX_RATE, 1.5 * MAX_RATE);
      if (Math.abs(this.omega[i]!) < 1e-5 && want[i] === 0) this.omega[i] = 0;
    }
    let rot = add(add(scale(X, this.omega[0] * dt), scale(Y, this.omega[1] * dt)), scale(Z, this.omega[2] * dt));
    if (c.snap && point && !active) {
      // attitude on rails: the nose straight onto the burn
      const e = cross(Z, point);
      const s = len(e);
      rot = s > 1e-12 ? scale(e, Math.atan2(s, dot(Z, point)) / s) : [0, 0, 0];
      this.omega = [0, 0, 0];
    }

    // ---- thrust: main engine along the nose, RCS translation along the ship's axes
    if (this.auto === "none") {
      this.throttle = clamp(this.throttle + inp.throttle * 0.6 * dt, 0, 1);
      throttle = this.throttle;
      const rcsMax = RCS * c.thrust;
      // (the ship's right is −x)
      rcsC = add(add(scale(X, -inp.tx * rcsMax), scale(Y, inp.ty * rcsMax)), scale(Z, inp.tz * rcsMax));
    }
    const accC = add(scale(Z, throttle * c.thrust), rcsC);
    const acc = fromC(accC);
    this.accel = len(acc);
    return { rot, acc, burn: this.burn };
  }

  /** The orbit's normal (C), or radial in when the nose is on the normal (the hole overhead): where the ship's top goes. */
  private levelUp(c: FlightContext, toC: (v: V3) => V3, Z: V3): V3 | null {
    const R = c.radialOut;
    const vl = len(c.beta);
    if (!R || vl < 1e-6) return null;
    const n = cross(R, scale(c.beta, 1 / vl));
    const nl = len(n);
    if (nl < 1e-3) return null; // moving radially: no orbital plane
    for (const cand of [toC(scale(n, 1 / nl)), toC(scale(R, -1))]) {
      const perp = add(cand, scale(Z, -dot(cand, Z))); // ⟂ the nose
      const pl = len(perp);
      if (pl > 0.2) return scale(perp, 1 / pl);
    }
    return null;
  }

  /** Where an attitude hold points the nose (C), from the orbital directions. */
  private holdDirection(c: FlightContext, toC: (v: V3) => V3): V3 | null {
    const v = c.beta;
    const vl = len(v);
    const pro = vl > 1e-6 ? scale(v, 1 / vl) : null;
    const R = c.radialOut;
    let d: V3 | null = null;
    switch (this.hold) {
      case "prograde": d = pro; break;
      case "retrograde": d = pro && scale(pro, -1); break;
      case "radialOut": d = R; break;
      case "radialIn": d = R && scale(R, -1); break;
      case "normal":
      case "antinormal": {
        if (!R || !pro) break;
        const n = cross(R, pro);
        const nl = len(n);
        if (nl < 1e-6) break;
        d = scale(n, (this.hold === "normal" ? 1 : -1) / nl);
        break;
      }
      case "target": d = c.target; break;
    }
    return d && toC(d);
  }
}

/**
 * ZAMO-relative speed of a circular equatorial orbit of radius r (prograde or retrograde) in Kerr:
 * Ω = ±1/(r^{3/2} ± a), v = ϖ(Ω − ω)/α. Null below the photon orbit (no timelike circular orbit).
 */
export function circularSpeed(r: number, a: number, prograde: boolean, z: { alpha: number; omega: number; varpi: number }) {
  const Om = prograde ? 1 / (r ** 1.5 + a) : -1 / (r ** 1.5 - a);
  const v = (z.varpi * (Om - z.omega)) / z.alpha;
  return Math.abs(v) < 1 ? v : null;
}
