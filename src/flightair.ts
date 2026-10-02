// The flown craft in a planet's air (aero.ts on a real flight): the forces for the integrators' sub-steps
// (controls.ts: flyHome on our side, landing.ts's planet frame near Gargantua), then, once a frame,
// the skin's temperatures, the load, the moment that turns the craft, and the limits watched — past
// them, the craft is lost (unless the damage is off).
//
// Frames: the integrators give the air-relative velocity in their own axes (home, or the planet's local
// x/y/z) with the ship's axes in the same — its x (left), y (up), z (the nose). SI here (m, s, N).

import { aeroForces, airAt, coldSkin, heatStep, type AeroConfig, type AeroOut, type Air, type Atmosphere, type Thermal, type V3 } from "./aero";
import { VESSELS, type VesselId } from "./vessels";

const G0 = 9.80665;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Below this dynamic pressure [Pa] the air is a trace: the time warp is free, the turns the pilot's. */
export const Q_FREE = 1;
/** In denser air, the most the time is sped up (KSP's physics warp). */
export const AIR_WARP = 4;

export interface AirSample {
  air: Air;
  out: AeroOut;
  /** the motion's direction through the air (ship frame) and its speed [m/s] */
  u: V3;
  speed: number;
  /** height above the surface [m] */
  h: number;
}

export class AirFlight {
  /** the craft flown, the body whose air it is in ("" in vacuum) */
  vessel: VesselId = "ranger";
  body = "";
  skin: Thermal = coldSkin();
  /** the last sample (the frame's end) */
  last: AirSample | null = null;
  /** the load factor: the aerodynamic and engine accelerations [g]; its peak over the flight */
  g = 0;
  gPeak = 0;
  heatPeak = 0;
  /** the configuration (flaps, brake, gear) */
  cfg: AeroConfig = {};
  /** a limit passed: why (the craft is lost) */
  failure: string | null = null;
  private overG = 0;
  /** the air's acceleration [m/s²] in the integrator's frame, and that frame's motion direction; the
   *  flight path's turn (ship frame, right-handed) [rad/s] */
  accFrame: V3 = [0, 0, 0];
  private uFrame: V3 | null = null;
  private uPrev: V3 | null = null;
  private axes: [V3, V3, V3] | null = null;
  pathRate: V3 = [0, 0, 0];

  /** Starts afresh (a scene, another craft). */
  reset(vessel: VesselId, T?: number) {
    this.vessel = vessel;
    this.skin = coldSkin(T);
    this.last = null;
    this.g = this.gPeak = this.heatPeak = 0;
    this.failure = null;
    this.overG = 0;
    this.uPrev = this.uFrame = null;
    this.pathRate = [0, 0, 0];
  }

  /** In the air (above a trace of it). */
  get inAir() {
    return !!this.last && this.last.out.q > Q_FREE;
  }

  /**
   * The air's acceleration on the craft, for the integrators: given its height [m] and its velocity
   * through the air [m/s] (in the frame of `axes` — the ship's x, y, z there), the acceleration [m/s²]
   * in that frame. `w`: the craft's angular velocity (ship frame, right-handed) [rad/s] — the damping.
   */
  forceFn(atm: Atmosphere | null | undefined, body: string, mass: number, axes: [V3, V3, V3], w: V3 = [0, 0, 0]) {
    const A = VESSELS[this.vessel].aero;
    this.body = atm ? body : "";
    return (h: number, va: V3): V3 => {
      const air = airAt(atm, h);
      const v: V3 = [dot(va, axes[0]), dot(va, axes[1]), dot(va, axes[2])];
      const out = aeroForces(A, v, air, w, this.cfg);
      const speed = Math.hypot(...v);
      this.last = { air, out, u: speed > 0 ? [v[0] / speed, v[1] / speed, v[2] / speed] : [0, 0, 1], speed, h };
      const vf = Math.hypot(...va);
      this.uFrame = vf > 0 ? [va[0] / vf, va[1] / vf, va[2] / vf] : null;
      this.axes = axes;
      const k = 1 / mass;
      return (this.accFrame = [
        (out.F[0] * axes[0][0] + out.F[1] * axes[1][0] + out.F[2] * axes[2][0]) * k,
        (out.F[0] * axes[0][1] + out.F[1] * axes[1][1] + out.F[2] * axes[2][1]) * k,
        (out.F[0] * axes[0][2] + out.F[1] * axes[1][2] + out.F[2] * axes[2][2]) * k,
      ]);
    };
  }

  /** Out of any air: the last sample dropped (the skin keeps cooling in `after`). */
  vacuum() {
    this.last = null;
    this.body = "";
    this.accFrame = [0, 0, 0];
  }

  /**
   * After a frame of `dt` seconds of the craft's time: the skin's temperatures, the load (with the
   * engines' acceleration `thrust` [m/s², ship frame]), the limits. Returns the air's angular
   * acceleration on the craft (ship frame, right-handed) [rad/s²], for the attitude, given its moment
   * of inertia [kg m²].
   */
  after(dt: number, thrust: V3, mass: number, inertia: number, damage: boolean): V3 {
    const A = VESSELS[this.vessel].aero;
    const L = this.last;
    const air = L?.air ?? airAt(null, 0);
    const out = L?.out ?? null;
    // (the flight path's turn: the motion's direction now against last frame's, on the ship's axes)
    if (L && this.uFrame && this.uPrev && this.axes && dt > 0) {
      const a = this.uPrev, b = this.uFrame;
      const w: V3 = [(a[1] * b[2] - a[2] * b[1]) / dt, (a[2] * b[0] - a[0] * b[2]) / dt, (a[0] * b[1] - a[1] * b[0]) / dt];
      const ws: V3 = [dot(w, this.axes[0]), dot(w, this.axes[1]), dot(w, this.axes[2])];
      for (let i = 0; i < 3; i++) this.pathRate[i] = this.pathRate[i]! + (ws[i]! - this.pathRate[i]!) * Math.min(1, dt / 0.3);
    } else if (!L) this.pathRate = [0, 0, 0];
    if (dt > 0) this.uPrev = L ? this.uFrame : null;
    if (dt > 0) this.skin = heatStep(A, this.skin, air, out ?? ({ heat: 0, Tr: 0, mach: 0 } as AeroOut), L?.u ?? [0, 0, 1], dt);
    const aF: V3 = out ? [out.F[0] / mass + thrust[0], out.F[1] / mass + thrust[1], out.F[2] / mass + thrust[2]] : thrust;
    this.g = Math.hypot(...aF) / G0;
    this.gPeak = Math.max(this.gPeak, this.g);
    this.heatPeak = Math.max(this.heatPeak, out?.heat ?? 0);
    if (damage && !this.failure && dt > 0) {
      // (the load sustained a quarter of a second: a blow on landing is the gear's business)
      this.overG = this.g > A.gMax ? this.overG + dt : 0;
      const name = VESSELS[this.vessel].name;
      if (A.shield && this.skin.shield > A.shield.tMax) this.failure = `${name}: the heat shield failed at ${Math.round(this.skin.shield)} K (its limit ${A.shield.tMax} K)`;
      else if (this.skin.hull > A.hull.tMax) this.failure = `${name}: the hull burnt through at ${Math.round(this.skin.hull)} K (its limit ${A.hull.tMax} K)`;
      else if (this.overG > 0.25) this.failure = `${name}: broke up under ${this.g.toFixed(1)} g (its limit ${A.gMax} g)`;
    }
    if (!out || inertia <= 0) return [0, 0, 0];
    return [out.M[0] / inertia, out.M[1] / inertia, out.M[2] / inertia];
  }

  /** How close to its limits the craft is (0 … 1): the shield, the hull, the load. */
  margins() {
    const A = VESSELS[this.vessel].aero;
    return {
      shield: A.shield ? this.skin.shield / A.shield.tMax : 0,
      hull: this.skin.hull / A.hull.tMax,
      g: this.g / A.gMax,
    };
  }
}
