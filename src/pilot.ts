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

import { TUNING } from "./game/tuning";
import type { M3, V3 } from "./mounts";

export type Hold = "none" | "prograde" | "retrograde" | "radialOut" | "radialIn" | "normal" | "antinormal" | "target" | "antiTarget" | "maneuver";
export type Auto = "none" | "hover" | "circularize" | "approach" | "orbit" | "node" | "transfer" | "land" | "takeoff" | "dock" | "entry" | "burns";
/** How the craft is flown in the air: as a rocket (rates, as in space), as a plane (the control
 *  surfaces, the flight path held), as a sci-fi craft (the flight computer flies a commanded velocity). */
export type FlightMode = "rocket" | "plane" | "sf";
export const FLIGHT_MODE_NAMES: Record<FlightMode, string> = { rocket: "Rocket", plane: "Plane", sf: "Flight computer" };

export const HOLD_NAMES: Record<Hold, string> = {
  none: "Manual", prograde: "Prograde", retrograde: "Retrograde", radialOut: "Radial out", radialIn: "Radial in",
  normal: "Normal", antinormal: "Anti-normal", target: "Target", antiTarget: "Anti-target", maneuver: "Manoeuvre",
};
export const AUTO_NAMES: Record<Auto, string> = { none: "Off", hover: "Hold position", circularize: "Circularize", approach: "Approach target", orbit: "Orbit target", node: "Execute node", transfer: "Low-thrust transfer", land: "Landing", takeoff: "Take-off to orbit", dock: "Docking", entry: "Entry & landing", burns: "Flight computer burns" };

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
  /** our universe: the velocity of the body the orbital directions refer to (local), if not at rest */
  refVel?: V3;
  /** direction of the target (local), or null */
  target: V3 | null;
  /** the next manoeuvre node's burn direction (local), or null */
  maneuver?: V3 | null;
  /** autopilot: required velocity (local 3-velocity) and feed-forward proper acceleration (local) */
  want?: { beta: V3; ff: V3; pos?: V3 } | null;
  /** in the air: the flight law, the flow's angles (α, β [rad]), the control surfaces' authority added
   *  to the thrusters' [rad/s², the pilot's axes], the flight path's own turn (the pilot's axes and
   *  signs [rad/s]), on the wheels, the stall angle, the dynamic pressure [Pa] */
  air?: { mode: FlightMode; alpha: number; beta: number; auth: V3; path: V3; ground: boolean; stall: number; q: number; gamma: number; bank: number; mach: number } | null;
  /** the sci-fi flight computer: the velocity it flies (local 3-velocity), the feed-forward against
   *  gravity and the air (local, proper acceleration), the attitude it holds (local), and the part of
   *  the hold given free (antigravity: no engine, no propellant) */
  sf?: { beta: V3; ff: V3; nose: V3; up: V3; free: V3 } | null;
  /** the entry autopilot: the attitude it holds (local: the nose, the ship's top) and the throttle it
   *  asks once the nose is on (the deorbit's burn) */
  att?: { nose: V3; up: V3; throttle?: number } | null;
  /** executing a manoeuvre node: the burn's direction (local) and the throttle wanted once aligned;
   *  far: the burn is still far off (an attitude hold may point the nose meanwhile) */
  burn?: { dir: V3; throttle: number; far?: boolean } | null;
  /** docking: the attitude to hold (local) — the nose and the ship's top; the thrusters alone
   *  translate (the main engine, along the nose, would push it off the port's axis) */
  dock?: { nose: V3; up: V3 } | null;
  /** at a warp where the burn turns (with the orbit) faster than the ship can: the nose is held on it
   *  kinematically (attitude on rails), not flown */
  snap?: boolean;
  /** the engine gimballed onto the burn: its thrust along the commanded direction (a node's burn
   *  in our universe — a nose lagging a mrad behind a turning prograde is 3 m/s off a TLI) */
  gimbal?: boolean;
}

export interface FlightOutput {
  /** rotation to apply to the camera this frame: rotation vector in C [rad] */
  rot: V3;
  /** proper acceleration of the ship (local components) [c²/M] */
  acc: V3;
  /** the autopilot's burn direction (local), for the displays */
  burn: V3 | null;
}

// (turning rate, angular acceleration, RCS authority: game/tuning.ts, from the settings)

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
  /** precision controls (fine rotation and throttle, as KSP's Caps Lock) */
  precision = false;
  /** the plane law's held flight path angle [rad] (set when the stick is let go), null: to be taken;
   *  the last one seen (its rate) */
  gammaHold: number | null = null;
  private gammaPrev: number | null = null;
  /** hypersonic, the plane law holds the angle of attack instead (an entry's): the one held [rad] */
  alphaHold: number | null = null;
  /** the plane law's held bank [rad] (wings level under 6°), null: to be taken */
  bankHold: number | null = null;
  /** what fired last step (the sound follows it): the main engine's throttle as applied, the RCS
   *  (fraction of its authority, the push sideways in the ship's frame: + to its right), the
   *  attitude effort (angular acceleration / the most the wheels give, 0…1) */
  fired = { throttle: 0, rcs: 0, rcsSide: 0, turn: 0, yaw: 0, at: 0, force: [0, 0, 0] as V3, torque: [0, 0, 0] as V3 };

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
    let upC: V3 | null = null; // and, if set, where the ship's top goes (C)
    this.burn = null;
    let throttle = this.throttle;
    if (c.sf && this.auto === "none") {
      // the sci-fi flight computer: the velocity flown by thrust in any direction (the main engine
      // along the nose, the vectored thrusters the rest), the feed-forward first; the attitude its own
      const U = toU(c.beta);
      const T = Math.max(1.2 * c.tauRate, 1e-3);
      const err = scale(add(toU(c.sf.beta), scale(U, -1)), 1 / T);
      let A = add(err, c.sf.ff);
      if (len(A) > c.thrust) {
        const ff = c.sf.ff;
        const fl = len(ff);
        if (fl >= c.thrust) A = scale(ff, c.thrust / fl);
        else {
          const ee = dot(err, err), fe = dot(ff, err);
          const k = ee > 0 ? (-fe + Math.sqrt(Math.max(fe * fe - ee * (fl * fl - c.thrust * c.thrust), 0))) / ee : 0;
          A = add(ff, scale(err, clamp(k, 0, 1)));
        }
      }
      const AC = toC(A);
      throttle = c.thrust > 0 ? Math.max(dot(AC, Z), 0) / c.thrust : 0;
      rcsC = add(add(AC, scale(Z, -throttle * c.thrust)), toC(c.sf.free));
      point = toC(c.sf.nose);
      upC = toC(c.sf.up);
      this.burn = len(A) > 0 ? scale(A, 1 / len(A)) : null;
    } else if ((this.auto === "entry" || this.auto === "burns") && c.att) {
      // the entry: the attitude the guidance asks (the angle of attack, the bank — or retrograde for the
      // deorbit's burn, fired once the nose is on it)
      point = toC(c.att.nose);
      upC = toC(c.att.up);
      const align = c.snap ? 1 : dot(Z, point);
      throttle = (c.att.throttle ?? 0) * clamp((align - 0.9945) / (0.9994 - 0.9945), 0, 1);
    } else if (this.auto === "node" && c.burn) {
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
    } else if (this.auto === "dock" && c.want) {
      // docking: the thrusters only, within their authority; the attitude held on the port's axis
      const T = Math.max(1.2 * c.tauRate, 1e-3);
      const A = add(scale(add(toU(c.want.beta), scale(toU(c.beta), -1)), 1 / T), c.want.ff);
      const a = len(A);
      const rcsMax = TUNING.rcs * c.thrust;
      rcsC = toC(a > rcsMax ? scale(A, rcsMax / a) : A);
      throttle = 0;
      if (c.dock) {
        point = toC(c.dock.nose);
        upC = toC(c.dock.up);
      }
    } else if (this.auto !== "none" && c.want) {
      const U = toU(c.beta);
      const T = Math.max(1.2 * c.tauRate, 1e-3);
      const err = scale(add(toU(c.want.beta), scale(U, -1)), 1 / T);
      let A = add(err, c.want.ff);
      // (beyond the engine: the feed-forward first — holding against gravity, drag — the velocity's
      // error with what is left, so a large sideways error never starves the hold against the fall)
      if (len(A) > c.thrust) {
        const ff = c.want.ff;
        const fl = len(ff);
        if (fl >= c.thrust) A = scale(ff, c.thrust / fl);
        else {
          const ee = dot(err, err), fe = dot(ff, err);
          const k = ee > 0 ? (-fe + Math.sqrt(Math.max(fe * fe - ee * (fl * fl - c.thrust * c.thrust), 0))) / ee : 0;
          A = add(ff, scale(err, clamp(k, 0, 1)));
        }
      }
      const a = len(A);
      const rcsMax = TUNING.rcs * c.thrust;
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
    const fine = this.precision ? 0.25 : 1;
    // (the sci-fi computer reads the stick as its commands: the attitude is its own)
    const manual: V3 = c.sf && this.auto === "none" ? [0, 0, 0] : [inp.pitch * fine, inp.yaw * fine, -inp.roll * fine];
    const want: V3 = [...this.omega];
    const active = manual.some((m) => m !== 0);
    // the control surfaces' authority, added to the thrusters' (the plane and the sci-fi laws)
    const A3 = c.air && (c.air.mode !== "rocket" || this.auto === "entry") ? c.air.auth : [0, 0, 0];
    const acc3: V3 = [TUNING.turnAccel + A3[0], TUNING.turnAccel + A3[1], TUNING.turnAccel + A3[2]];
    const planeLaw = !!c.air && c.air.mode === "plane" && c.air.q > 300 && !point && this.hold === "none" && this.auto === "none";
    if (!planeLaw || inp.pitch !== 0) (this.gammaHold = null), (this.alphaHold = null);
    if (!planeLaw || inp.roll !== 0) this.bankHold = null;
    if (planeLaw) {
      // the plane: the stick asks for rates (pitch 20°/s, yaw 8°/s, roll 70°/s); let go, the flight
      // path is held — the climb angle it had (more lift in a bank), no sideslip (the rudder
      // coordinates), the bank kept — the nose turning with the path; the stall kept off
      const P = c.air!;
      const rates: V3 = [0.35, 0.14, 1.2];
      const stallSafe = P.stall - 0.035;
      if (this.gammaHold === null && inp.pitch === 0) this.gammaHold = P.gamma;
      const gdot = this.gammaPrev !== null && dt > 0 ? (P.gamma - this.gammaPrev) / dt : 0;
      this.gammaPrev = P.gamma;
      if (P.ground) want[0] = manual[0] * rates[0];
      else if (manual[0] !== 0) want[0] = P.path[0] + manual[0] * rates[0];
      else if (P.mach > 4) {
        // (hypersonic: the angle of attack held — the shield kept to the flow, as an entry is flown)
        if (this.alphaHold === null) this.alphaHold = P.alpha;
        want[0] = P.path[0] - 1.5 * (P.alpha - this.alphaHold);
      } else want[0] = P.path[0] + 1.2 * ((this.gammaHold ?? P.gamma) - P.gamma) - 1.5 * gdot;
      if (P.alpha > stallSafe) want[0] = Math.min(want[0], P.path[0] - 2 * (P.alpha - stallSafe));
      want[1] = P.ground ? manual[1] * 0.3 : P.path[1] - 2 * P.beta + manual[1] * rates[1];
      if (this.bankHold === null && inp.roll === 0) this.bankHold = Math.abs(P.bank) < 0.105 ? 0 : P.bank;
      // (the bank: right is +; the pilot's roll: left is +)
      want[2] = manual[2] !== 0 ? manual[2] * rates[2] : P.ground ? 0 : 1.2 * (P.bank - (this.bankHold ?? P.bank));
    } else if (point && !active) {
      const e = cross(Z, point);
      const s = len(e);
      const ang = Math.atan2(s, dot(Z, point));
      // braking curve far away (reach the target at rest), linear near it (no chattering)
      const rate = Math.min(TUNING.turnRate, Math.sqrt(2 * 0.7 * TUNING.turnAccel * ang), 3 * ang);
      const wC = s > 1e-9 ? scale(e, rate / s) : [0, 0, 0] as V3;
      const wb = body(wC);
      want[0] = wb[0];
      want[1] = wb[1];
      // roll: the ship's top towards the orbit's normal — its wings in the orbital plane (along the
      // normal itself, towards the hole instead)
      want[2] = 0;
      let up = this.rollAlign ? this.levelUp(c, toC, Z) : null;
      if (upC) {
        const perp = add(upC, scale(Z, -dot(upC, Z)));
        const pl = len(perp);
        up = pl > 0.2 ? scale(perp, 1 / pl) : up;
      }
      if (up) {
        const ra = Math.atan2(dot(cross(Y, up), Z), dot(Y, up));
        want[2] = Math.sign(ra) * Math.min(TUNING.turnRate, Math.sqrt(2 * 0.7 * TUNING.turnAccel * Math.abs(ra)), 3 * Math.abs(ra));
      }
    } else {
      for (let i = 0; i < 3; i++) {
        if (manual[i] !== 0) want[i] = this.sas ? manual[i]! * TUNING.turnRate : this.omega[i]! + manual[i]! * TUNING.turnAccel * dt;
        else if (this.sas) want[i] = 0;
      }
    }
    let effort = 0;
    const torque: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const d = clamp(want[i]! - this.omega[i]!, -acc3[i]! * dt, acc3[i]! * dt);
      if (dt > 0) {
        torque[i] = d / (acc3[i]! * dt);
        effort = Math.max(effort, Math.abs(torque[i]!));
      }
      this.omega[i] = clamp(this.omega[i]! + d, -1.5 * TUNING.turnRate, 1.5 * TUNING.turnRate);
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
    if (this.auto === "none" && !c.sf) {
      this.throttle = clamp(this.throttle + inp.throttle * (this.precision ? 0.15 : 0.6) * dt, 0, 1);
      throttle = this.throttle;
      const rcsMax = TUNING.rcs * c.thrust;
      // (the ship's right is −x)
      const k = rcsMax * (this.precision ? 0.25 : 1);
      rcsC = add(add(scale(X, -inp.tx * k), scale(Y, inp.ty * k)), scale(Z, inp.tz * k));
    }
    const rcsAuth = TUNING.rcs * c.thrust;
    const rl = len(rcsC);
    this.fired = {
      throttle: c.thrust > 0 ? throttle : 0,
      rcs: rcsAuth > 0 ? clamp(rl / rcsAuth, 0, 1) : 0,
      rcsSide: rl > 0 ? -dot(X, rcsC) / rl : 0,
      turn: c.snap ? 0 : effort,
      yaw: clamp(this.omega[1] / Math.max(TUNING.turnRate, 1e-9), -1, 1),
      at: performance.now(),
      // (ship frame: x left, y up, z nose — the RCS push, as a fraction of its authority; the angular
      // acceleration asked, as a fraction of the most the wheels give)
      force: rcsAuth > 0 ? (body(rcsC).map((x) => x / rcsAuth) as V3) : [0, 0, 0],
      torque: c.snap ? [0, 0, 0] : torque,
    };
    const accC = add(scale(c.gimbal && point && throttle > 0 ? point : Z, throttle * c.thrust), rcsC);
    const acc = fromC(accC);
    this.accel = len(acc);
    return { rot, acc, burn: this.burn };
  }

  /** The orbit's normal (C), or radial in when the nose is on the normal (the hole overhead): where the ship's top goes. */
  private levelUp(c: FlightContext, toC: (v: V3) => V3, Z: V3): V3 | null {
    const R = c.radialOut;
    const vr = c.refVel ? add(c.beta, scale(c.refVel, -1)) : c.beta;
    const vl = len(vr);
    if (!R || vl < 1e-6) return null;
    const n = cross(R, scale(vr, 1 / vl));
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
    const v = c.refVel ? add(c.beta, scale(c.refVel, -1)) : c.beta;
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
      case "antiTarget": d = c.target && scale(c.target, -1); break;
      case "maneuver": d = c.maneuver ?? null; break;
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
