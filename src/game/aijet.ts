// An AI's F-35 (docs/PLAN-AVIATION-AAA.md, F3; C4 refines it): the real aircraft's forces on a craft flown by
// commands — the air's from the F-35's own tables (aero.ts: its lift and drag at its incidence, its Mach), the
// F135's thrust at its height and speed (f35/engine.ts: dry, the afterburner), its weight and fuel — and the
// control law's way of flying them: the bank reached at the roll rate the law allows, the load factor asked for
// the flight path (the incidence driven to give it, within the law's limits), the autothrottle's speed. A point
// of mass with its attitude made of its velocity, its incidence and its bank; fixed to the Earth [m, m/s]. Pure.

import { aeroForces, airAt, type Atmosphere, type V3 } from "../aero";
import { dryThrust, F135, fuelFlow, wetThrust } from "../f35/engine";
import { VESSELS } from "../vessels";
import { Autothrottle, JET } from "./jet";

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
const scale = (a: readonly number[], k: number) => [a[0]! * k, a[1]! * k, a[2]! * k];
const unit = (a: readonly number[]) => scale(a, 1 / (len(a) || 1));
const cross = (a: readonly number[], b: readonly number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const D = Math.PI / 180;
const G = 9.80665;
/** the Earth's mean radius [m] and its gravity's parameter [m³/s²] */
const RE = 6_371_008.8;
const GM = 3.986004418e14;

export const AIJET = {
  /** the law's limits: the load [g], the incidence [rad], the roll rate [rad/s] at a dynamic pressure of 20 kPa */
  nMax: 7,
  nMin: -2,
  alphaMax: 25 * D,
  alphaMin: -6 * D,
  pMax: 150 * D,
  /** the load loop's integral gain [rad per g·s], the flight path's [1/s] */
  kN: 0.35,
  kGamma: 1.2,
  /** the bank loop's gain [1/s] */
  kPhi: 3,
  /** on the ground: the wheels under the craft's origin [m]; the rolling and the braking friction; the nose wheel's
   *  turn [rad/s]; the rotation's incidence [rad] and rate [rad/s]; a touchdown's sink at most [m/s] */
  gear: 1.17,
  muRoll: 0.025,
  muBrake: 0.4,
  steer: 6 * D,
  alphaRot: 10 * D,
  rotRate: 3 * D,
  sinkMax: 4,
} as const;

/** The commands: the bank [rad], the flight path angle [rad], the speed [m/s] (the autothrottle's), the
 *  afterburner wanted. */
export interface AiCmd {
  bank: number;
  gamma: number;
  spd: number;
  ab?: boolean;
  /** on the ground: the heading to steer [rad], the brakes, the rotation (the nose up for the lift-off) */
  gHdg?: number;
  brake?: boolean;
  rotate?: boolean;
}

export class AiJet {
  /** fixed to the Earth: place [m], velocity [m/s] */
  p: number[];
  v: number[];
  /** the bank [rad] (right wing down +), the incidence [rad], the throttle 0…1, the afterburner lit 0…1 */
  phi = 0;
  alpha = 3 * D;
  throttle = 0.6;
  ab = 0;
  fuel: number;
  /** the load now [g], the Mach number, the dynamic pressure [Pa] */
  n = 1;
  mach = 0;
  q = 0;
  /** on the ground (its heading [rad]; null: flying); touched the ground too hard or off a runway: crashed */
  gnd: { hdg: number } | null = null;
  crashed = false;
  private athr = new Autothrottle();

  constructor(p: readonly number[], v: readonly number[], fuel = VESSELS.f35.fuelKg ?? 6000) {
    this.p = [...p];
    this.v = [...v];
    this.fuel = fuel;
  }

  get mass() {
    const V = VESSELS.f35;
    return V.mass - (V.fuelKg ?? 0) + Math.max(this.fuel, 0);
  }

  /** its height over the mean radius [m] */
  get h() {
    return len(this.p) - RE;
  }

  /** its speed [m/s] */
  get V() {
    return len(this.v);
  }

  /** its axes (fixed to the Earth): its nose, its top, its right — the velocity turned up by the incidence, rolled
   *  by the bank about it */
  axes(): { fwd: number[]; up: number[]; right: number[] } {
    const up0 = unit(this.p);
    const L = enu(this.p);
    const u = this.gnd
      ? [0, 1, 2].map((k) => L.E[k]! * Math.sin(this.gnd!.hdg) + L.N[k]! * Math.cos(this.gnd!.hdg))
      : this.V > 1
        ? unit(this.v)
        : unit(cross(up0, [0, 0, 1]));
    const r0 = unit(cross(u, up0));
    const l0 = cross(r0, u);
    const c = Math.cos(this.phi),
      s = Math.sin(this.phi);
    const lift = [0, 1, 2].map((k) => l0[k]! * c - r0[k]! * s * -1);
    const right = [0, 1, 2].map((k) => r0[k]! * c - l0[k]! * s);
    const ca = Math.cos(this.alpha),
      sa = Math.sin(this.alpha);
    const fwd = [0, 1, 2].map((k) => u[k]! * ca + lift[k]! * sa);
    const top = [0, 1, 2].map((k) => lift[k]! * ca - u[k]! * sa);
    return { fwd, up: top, right };
  }

  /** Its flight path angle [rad] and heading [rad, clockwise from north — `north` the local north]. */
  gamma(): number {
    return Math.asin(clamp(dot(unit(this.v), unit(this.p)), -1, 1));
  }

  /**
   * A step of `dt` [s] flying the commands in the Earth's air `atm`: sub-stepped at 60 Hz at most.
   */
  step(dt: number, cmd: AiCmd, atm: Atmosphere | null | undefined, ground?: (p: readonly number[]) => number) {
    const n = Math.max(1, Math.ceil(dt * 60));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      if (this.crashed) return;
      if (this.gnd) this.roll(h, cmd, atm, ground);
      else this.sub(h, cmd, atm, ground);
    }
  }

  /** On its wheels: steered to its heading, its thrust against the drag and the wheels' friction (the brakes'),
   *  rotated past its speed; airborne once its lift carries it. */
  private roll(dt: number, cmd: AiCmd, atm: Atmosphere | null | undefined, ground?: (p: readonly number[]) => number) {
    const G0 = this.gnd!;
    const L = enu(this.p);
    const air = airAt(atm, this.h);
    const V = this.V;
    this.mach = V / air.a;
    this.q = 0.5 * air.rho * V * V;
    const m = this.mass;
    G0.hdg += clamp(wrap((cmd.gHdg ?? G0.hdg) - G0.hdg), -AIJET.steer * dt, AIJET.steer * dt);
    this.phi = 0;
    this.alpha = cmd.rotate ? Math.min(this.alpha + AIJET.rotRate * dt, AIJET.alphaRot) : Math.max(this.alpha - AIJET.rotRate * dt, 0);
    const d = [0, 1, 2].map((k) => L.E[k]! * Math.sin(G0.hdg) + L.N[k]! * Math.cos(G0.hdg));
    this.v = scale(d, V);
    const A = this.axes();
    const left = scale(A.right, -1);
    const out = aeroForces(VESSELS.f35.aero, [dot(this.v, left), dot(this.v, A.up), dot(this.v, A.fwd)] as V3, air);
    const Fw = [0, 1, 2].map((k) => left[k]! * out.F[0] + A.up[k]! * out.F[1] + A.fwd[k]! * out.F[2]);
    const lift = dot(Fw, L.U);
    const drag = -dot(Fw, d);
    const sigma = air.rho / 1.225;
    const dry = dryThrust(F135, this.mach, sigma);
    const wet = wetThrust(F135, this.mach, sigma);
    // (the take-off's run: full power at once — the autothrottle's eased acceleration is a cruise's)
    this.throttle = cmd.brake
      ? 0
      : cmd.spd > V + 60
        ? Math.min(1, this.throttle + dt / F135.spool)
        : this.athr.step(this.throttle, V, cmd.spd, dry / m, dt);
    const wantAb = !cmd.brake && (cmd.ab ?? false);
    this.ab = clamp(this.ab + (wantAb ? 1 : -1) * (dt / F135.light), 0, 1);
    const T = this.fuel > 0 ? this.throttle * dry + this.ab * (wet - dry) : 0;
    this.fuel -= fuelFlow(F135, T, dry, sigma, this.mach) * dt;
    const W = m * G;
    const fric = (cmd.brake ? AIJET.muBrake : AIJET.muRoll) * Math.max(W - lift, 0);
    const Vn = Math.max(0, V + ((T * Math.cos(this.alpha) - drag - (V > 0.1 ? fric : 0)) / m) * dt);
    this.v = scale(d, Vn);
    for (let k = 0; k < 3; k++) this.p[k] = this.p[k]! + this.v[k]! * dt;
    // (kept on its wheels over the ground)
    if (ground) {
      const r = RE + ground(this.p) + AIJET.gear;
      this.p = scale(unit(this.p), r);
    }
    // (its lift past its weight, rotated: airborne)
    if (lift > W * 1.02 && this.alpha > AIJET.alphaRot * 0.6) {
      this.gnd = null;
      this.v = [0, 1, 2].map((k) => this.v[k]! + L.U[k]! * 1);
    }
  }

  private sub(dt: number, cmd: AiCmd, atm: Atmosphere | null | undefined, ground?: (p: readonly number[]) => number) {
    const air = airAt(atm, this.h);
    const V = this.V;
    this.mach = V / air.a;
    this.q = 0.5 * air.rho * V * V;
    const m = this.mass;
    // the bank: towards its command at the roll rate the law allows (less in thin, slow air)
    const pMax = AIJET.pMax * clamp(this.q / 20_000, 0.15, 1);
    this.phi += clamp(AIJET.kPhi * wrap(cmd.bank - this.phi), -pMax, pMax) * dt;
    // the load asked: the flight path's (its turn in the vertical, the weight's share) over the bank's cosine
    const g = this.gamma();
    const nCmd = clamp(
      (Math.cos(g) + (V / G) * AIJET.kGamma * (cmd.gamma - g)) / Math.max(Math.cos(this.phi), 0.15),
      AIJET.nMin,
      AIJET.nMax,
    );
    // the air's forces at the incidence now (the ship's frame: x its left, y its top, z its nose)
    const A = this.axes();
    const left = scale(A.right, -1);
    const vs = [dot(this.v, left), dot(this.v, A.up), dot(this.v, A.fwd)] as V3;
    const out = aeroForces(VESSELS.f35.aero, vs, air);
    const Fw = [0, 1, 2].map((k) => left[k]! * out.F[0] + A.up[k]! * out.F[1] + A.fwd[k]! * out.F[2]);
    // (the load: the force across the flight path, upwards in the wings' frame)
    const u = unit(this.v);
    const lift = unit(cross(cross(u, A.up), u));
    this.n = dot(Fw, lift) / (m * G);
    // the incidence driven to give the load asked
    this.alpha = clamp(this.alpha + AIJET.kN * (nCmd - this.n) * dt, AIJET.alphaMin, AIJET.alphaMax);
    // the engine: the autothrottle's throttle, the afterburner past the dry engine's full
    const sigma = air.rho / 1.225;
    const dry = dryThrust(F135, this.mach, sigma);
    const wet = wetThrust(F135, this.mach, sigma);
    const aFull = dry / m;
    this.throttle = this.athr.step(this.throttle, V, cmd.spd, aFull, dt);
    const wantAb = cmd.ab ?? (this.throttle >= 0.98 && cmd.spd - V > 8);
    this.ab = clamp(this.ab + (wantAb ? 1 : -1) * (dt / F135.light), 0, 1);
    const T = this.fuel > 0 ? this.throttle * dry + this.ab * (wet - dry) : 0;
    this.fuel -= fuelFlow(F135, T, dry, sigma, this.mach) * dt;
    // gravity (toward the centre, by the distance)
    const r = len(this.p);
    const gv = scale(unit(this.p), -GM / (r * r));
    const a = [0, 1, 2].map((k) => Fw[k]! / m + (A.fwd[k]! * T) / m + gv[k]!);
    for (let k = 0; k < 3; k++) {
      this.v[k] = this.v[k]! + a[k]! * dt;
      this.p[k] = this.p[k]! + this.v[k]! * dt;
    }
    // (the ground reached: on its wheels if gently — a landing —, else crashed)
    if (ground) {
      const above = len(this.p) - RE - ground(this.p) - AIJET.gear;
      if (above < 0) {
        const U = unit(this.p);
        const sink = -dot(this.v, U);
        if (sink < AIJET.sinkMax && Math.abs(this.phi) < 15 * D) {
          this.gnd = { hdg: headingOf(this.p, this.v) };
          this.p = scale(U, RE + ground(this.p) + AIJET.gear);
          this.v = [0, 1, 2].map((k) => this.v[k]! + U[k]! * sink);
        } else this.crashed = true;
      }
    }
  }
}

/** The local east, north, up at a place (fixed to the Earth). */
function enu(p: readonly number[]) {
  const U = unit(p);
  const E = unit([-U[1]!, U[0]!, 0]);
  const N = cross(U, E);
  return { E, N, U };
}

const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/** A heading [rad] at a place, of a velocity (fixed to the Earth): clockwise from the local north. */
export function headingOf(p: readonly number[], v: readonly number[]): number {
  const up = unit(p);
  const east = unit(cross([0, 0, 1], up));
  const north = cross(up, east);
  return (Math.atan2(dot(v, east), dot(v, north)) + 2 * Math.PI) % (2 * Math.PI);
}

export { JET };
