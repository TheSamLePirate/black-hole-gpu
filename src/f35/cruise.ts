// The F-35's cruise burn for its flight plan (docs/PLAN-F35.md, F8; game/flightplan.ts BurnModel): the thrust
// that holds level flight at an altitude and a true airspeed — the drag, its zero-lift part and the lift's —
// in the standard atmosphere, burnt at the F135's dry consumption (src/f35/engine.ts: the simulator's own).
// Pure.

import { VESSELS } from "../vessels";
import { fuelFlow, type TurbofanDef } from "./engine";

/** The standard atmosphere at an altitude [m]: the density [kg/m³] and the speed of sound [m/s]. */
export function isa(h: number): { rho: number; a: number } {
  const z = Math.max(h, -500);
  const T = z < 11000 ? 288.15 - 0.0065 * z : 216.65;
  const p = z < 11000 ? 101325 * (T / 288.15) ** 5.25588 : 22632 * Math.exp(-(z - 11000) / 6341.6);
  return { rho: p / (287.05 * T), a: Math.sqrt(1.4 * 287.05 * T) };
}

/** The level flight's drag [N] at an altitude [m], a true airspeed [m/s], a mass [kg]. */
export function cruiseDrag(h: number, v: number, mass: number): number {
  const V = VESSELS.f35;
  const w = V.aero.wing!;
  const { rho, a } = isa(h);
  const q = 0.5 * rho * v * v;
  const M = v / a;
  // (the transonic rise: the zero-lift drag's, as aero.ts — the cruise is subsonic)
  const wave = 1 + 1.4 * Math.exp(-(((M - 1.05) / 0.22) ** 2));
  const L = mass * 9.80665;
  return q * V.aero.cdA0 * wave + (L * L) / Math.max(q * Math.PI * w.AR * w.e * w.S, 1);
}

/** The fuel flow [kg/s] cruising there (a mass: the plan's mean, by default half the fuel burnt). */
export function cruiseBurn(h: number, v: number, mass = VESSELS.f35.mass - 0.5 * (VESSELS.f35.fuelKg ?? 0)): number {
  const def = VESSELS.f35.turbofan as TurbofanDef;
  const sigma = isa(h).rho / 1.225;
  const D = cruiseDrag(h, v, mass);
  return fuelFlow(def, D, Infinity, sigma);
}
