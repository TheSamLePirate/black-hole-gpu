// The F-35B's flight envelope measured (docs/PLAN-AVIATION-AAA.md, V1): its trimmed states — level flight, the
// sustained turn, the excess power, the cruise — from its aerodynamics (aero.ts) and its engine (f35/engine.ts),
// and its flights flown frame by frame by the controller itself (the flight control system, the holds): the
// transonic acceleration, the roll, the pull, the push, the incidence reached.
import { aeroForces, airAt } from "../../src/aero";
import { cruiseBurn } from "../../src/f35/cruise";
import { dryThrust, F135, fuelFlow, wetThrust } from "../../src/f35/engine";
import { fleet } from "../../src/fleet";
import { ourGroundPose } from "../../src/game/place";
import { add, scale } from "../../src/math/vec3";
import { solarBody } from "../../src/system/solar";
import { C_MPS, M_METRES } from "../../src/units";
import { VESSELS } from "../../src/vessels";
import { flight } from "./flight";

export const F35 = VESSELS.f35;
const A = F35.aero;
const atm = solarBody("earth")!.atmosphere!;
export const G = 9.80665;
export const FT = 0.3048;
export const KT = 0.514444;
const D = Math.PI / 180;

/** the masses flown: at take-off (full internal fuel), at mid-mission (half of it burnt) */
export const M_TO = F35.mass;
export const M_MID = F35.mass - 0.5 * (F35.fuelKg ?? 0);

export const sigma = (h: number) => airAt(atm, h).rho / 1.225;
export const soundAt = (h: number) => airAt(atm, h).a;

/** Level flight at height h [m] and speed v [m/s], mass m, load n: the angle of attack holding n·W, the drag. */
export function trim(h: number, v: number, m: number, n = 1, flaps = 0) {
  const air = airAt(atm, h);
  let lo = -0.1,
    hi = 0.8;
  const lift = (a: number) => {
    const o = aeroForces(A, [0, -v * Math.sin(a), v * Math.cos(a)], air, [0, 0, 0], { flaps });
    // (the force across the motion, up the craft's plane: the lift; along it: the drag)
    return { L: o.F[1] * Math.cos(a) + o.F[2] * Math.sin(a), D: -(o.F[2] * Math.cos(a) - o.F[1] * Math.sin(a)), o };
  };
  for (let i = 0; i < 60; i++) {
    const a = (lo + hi) / 2;
    if (lift(a).L < n * m * G) lo = a;
    else hi = a;
  }
  const a = (lo + hi) / 2;
  const r = lift(a);
  return { alpha: a, D: r.D, ok: Math.abs(r.L - n * m * G) < 0.01 * m * G, air, mach: v / air.a, stalled: r.o.stalled };
}

/** the fastest level Mach at height h where the thrust (dry or wet) meets the drag */
export function vMax(h: number, m: number, wet: boolean) {
  const a = soundAt(h);
  let best = 0;
  for (let M = 0.3; M < 2.4; M += 0.01) {
    const t = trim(h, M * a, m);
    const T = (wet ? wetThrust : dryThrust)(F135, M, sigma(h));
    if (t.ok && T >= t.D) best = M;
  }
  return best;
}

/** the highest sustained load at height h and Mach M, full afterburner */
export function sustainedG(h: number, M: number, m: number) {
  const v = M * soundAt(h);
  const T = wetThrust(F135, M, sigma(h));
  let n = 1;
  while (n < 12) {
    const t = trim(h, v, m, n + 0.01);
    if (!t.ok || t.D > T) break;
    n += 0.01;
  }
  return n;
}

/** the best climb rate at height h [m/s], full afterburner, over the Mach numbers flown level there */
export function climbRate(h: number, m: number) {
  const a = soundAt(h);
  let best = -Infinity;
  for (let M = 0.4; M < 2.2; M += 0.02) {
    const t = trim(h, M * a, m);
    if (!t.ok) continue;
    best = Math.max(best, ((wetThrust(F135, M, sigma(h)) - t.D) * M * a) / (m * G));
  }
  return best;
}

/** the service ceiling [m]: the highest height where the best climb is still 100 ft/min, full afterburner */
export function ceiling(m: number) {
  let h = 10000;
  while (h < 25000 && climbRate(h + 100, m) >= (100 * FT) / 60) h += 100;
  return h;
}

/** the stall speed [m/s], level, clean, at mass m at sea level */
export function stallSpeed(m: number) {
  let v = 40;
  while (v < 150 && !trim(0, v, m).ok) v += 0.25;
  return v;
}

/**
 * The combat radius [km] on internal fuel, high–high–high: a take-off and climb allowance, the cruise out and back
 * at the best of Mach 0.8–0.9 and 9–13 km (its mean mass), two minutes on the afterburner at the target, ten
 * percent kept in reserve.
 */
export function combatRadius() {
  const fuel = F35.fuelKg ?? 0;
  const climb = 450;
  const combat = 120 * fuelFlow(F135, wetThrust(F135, 0.9, sigma(9000)), dryThrust(F135, 0.9, sigma(9000)), sigma(9000), 0.9);
  const reserve = 0.1 * fuel;
  const cruiseFuel = fuel - climb - combat - reserve;
  const mMean = F35.mass - climb - 0.5 * cruiseFuel;
  let best = 0;
  for (let h = 9000; h <= 13000; h += 250)
    for (let M = 0.8; M <= 0.9; M += 0.01) {
      const v = M * soundAt(h);
      best = Math.max(best, v / cruiseBurn(h, v, mMean));
    }
  return { km: (cruiseFuel * best) / 2 / 1000, mPerKg: best };
}

// ------------------------------------------------------------------------------------------------- flown

/** The F-35 in the air over the Atlantic: `h` up, `v` m/s eastwards, the throttle at `thr`, mass by its fuel. */
export function cruise(h: number, v: number, thr = 0.75) {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, h / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, v / C_MPS)), landed: undefined }, false, "f35");
  run.c.s.flightMode = "plane";
  run.c.pilot.throttle = thr;
  run.c.pilot.engineNow = thr;
  run.fly(1);
  return run;
}

/** The pilot's stick held (pitch, roll: −1…1) while `f` runs. */
export function withStick(c: ReturnType<typeof flight>["c"], s: { pitch?: number; roll?: number; yaw?: number }, f: () => void) {
  const input = c.pilotInput.bind(c);
  c.pilotInput = (pad) => ({ ...input(pad), ...s });
  f();
  c.pilotInput = input;
}

/** The time [s] from Mach 0.8 to 1.2 at height h, level on the altitude hold, full afterburner (null: not reached in 4 min). */
export function transonic(h: number) {
  const a = soundAt(h);
  const { c, fly } = cruise(h, 0.8 * a, 1);
  c.jetToggle("ap");
  c.jetModes.alt = h;
  c.jetToggle("ab");
  fly(1);
  // (from Mach 0.8 crossed — the engine lit, the holds settled)
  let t0 = Number.NaN;
  for (let i = 0; i < 30 * 240; i++) {
    fly(1 / 30);
    const M = (c.airFlight.last?.speed ?? 0) / a;
    if (!Number.isFinite(t0) && M >= 0.8) t0 = i / 30;
    if (M >= 1.2) return i / 30 - t0;
  }
  return null;
}

/** The peak roll rate [°/s] at full stick, at height h and speed v. */
export function rollRate(h: number, v: number) {
  const { c, fly } = cruise(h, v);
  let peak = 0;
  withStick(c, { roll: 1 }, () => {
    for (let i = 0; i < 60; i++) {
      fly(1 / 30);
      peak = Math.max(peak, Math.abs(c.pilot.omega[2]));
    }
  });
  return peak / D;
}

/** A full-stick pull (or push, `sign` −1) held 3 s at height h and speed v: the peak and lowest normal load [g] (the
 *  air's force up the craft's top over its weight), the time to 90 % of its peak [s], the flight path's peak turn
 *  rate [°/s], the peak incidence [°]. */
export function pull(h: number, v: number, sign = 1) {
  const { c, fly } = cruise(h, v, 1);
  let gPeak = -Infinity,
    gLow = Infinity,
    rate = 0,
    alpha = 0;
  const nz: number[] = [];
  let u0 = c.netOwn()?.v;
  withStick(c, { pitch: sign }, () => {
    for (let i = 0; i < 90; i++) {
      fly(1 / 30);
      const L = c.airFlight.last;
      const n = (L?.out.F[1] ?? 0) / (fleet.massProps().mass * G);
      nz.push(n);
      gPeak = Math.max(gPeak, n);
      gLow = Math.min(gLow, n);
      alpha = Math.max(alpha, Math.abs(L?.out.alpha ?? 0));
      const u = c.netOwn()?.v;
      if (u && u0) {
        const cos = (u[0] * u0[0] + u[1] * u0[1] + u[2] * u0[2]) / (Math.hypot(...u) * Math.hypot(...u0));
        rate = Math.max(rate, Math.acos(Math.min(1, cos)) * 30);
      }
      u0 = u;
    }
  });
  const peak = sign > 0 ? gPeak : gLow;
  const onset = nz.findIndex((n) => (sign > 0 ? n >= 1 + 0.9 * (peak - 1) : n <= 1 + 0.9 * (peak - 1))) / 30;
  return { gPeak, gLow, onset, rate: rate / D, alpha: alpha / D, broke: !!c.airFlight.failure };
}
