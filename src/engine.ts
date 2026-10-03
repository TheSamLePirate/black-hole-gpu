// The Ranger's two engines and its propellant.
//
// Cinema: the simulator's thrust setting (c²/M) — thousands of g for a hole of 10⁸ M☉, quasi-impulsive
// burns (a hypothetical engine; no crew survives it). Crew: 0.1–3 g, converted with the hole's mass
// (1 g = 9.80665 m/s² over c²/r_g), so burns last days and transfers are spirals.
//
// Propellant (on unless the Cinema engine — audit phase 2): a relativistic rocket of effective exhaust
// speed vₑ (in c) and initial mass ratio R₀ = m₀/m_dry. Its rapidity budget is vₑ ln R₀; each burn
// spends w = ∫ a dτ (proper acceleration over proper time — the rapidity it gives, whatever the path),
// and the mass left is m/m₀ = e^{−w/vₑ}: the engine's force is fixed, so the craft lightens and its
// acceleration grows (a = F/m). A plan's Δv costs Σ atanh|Δv| of rapidity.
//
// In the air the nozzle's exit pushes against the ambient pressure: F(p) = F_vac − p Aₑ with the same
// mass flow — less thrust and an effective exhaust speed, the Isp, lower by the same factor (the
// vessel's thrust at sea level, slThrust, sets Aₑ). The engine answers its throttle with a lag (spool).

import type { Settings } from "./settings";
import { units, SI } from "./system/kerr-orbits";

/** c²/M in m/s² for the scene's hole. */
export const accelUnit = (s: Pick<Settings, "massSolar">) => units(s.massSolar).accel;

export const gToAccel = (g: number, s: Pick<Settings, "massSolar">) => (g * SI.g0) / accelUnit(s);
export const accelToG = (a: number, s: Pick<Settings, "massSolar">) => (a * accelUnit(s)) / SI.g0;

/** Maximum proper acceleration of the selected engine [c²/M]. */
export function engineThrust(s: Pick<Settings, "engine" | "crewG" | "thrust" | "massSolar">) {
  return s.engine === "crew" ? gToAccel(s.crewG, s) : s.thrust;
}

/** The tank after spending the rapidity w: fraction of propellant left, rapidity (≈ Δv) left. */
export function tank(s: Pick<Settings, "exhaust" | "massRatio">, spent: number) {
  const budget = s.exhaust * Math.log(Math.max(s.massRatio, 1));
  const left = Math.max(0, budget - spent);
  const m = Math.exp(-Math.min(spent, budget) / s.exhaust); // m/m₀
  const dry = 1 / Math.max(s.massRatio, 1);
  return { budget, left, dvLeft: Math.tanh(left), fraction: dry < 1 ? Math.max(0, (m - dry) / (1 - dry)) : 0, empty: left <= 0 };
}

/** Rapidity a set of impulsive Δv (magnitudes, in c) costs. */
export const rapidityCost = (dvs: number[]) => dvs.reduce((w, v) => w + Math.atanh(Math.min(Math.abs(v), 0.999999)), 0);

/** The propellant counted: on, unless the Cinema engine (quasi-impulsive, hypothetical: no tank). */
export const fuelOn = (s: Pick<Settings, "fuel" | "engine">) => s.fuel && s.engine === "crew";

/** The mass left over the full mass after spending the rapidity w (the tank's empty: the dry mass). */
export function massLeft(s: Pick<Settings, "exhaust" | "massRatio">, spent: number) {
  const budget = s.exhaust * Math.log(Math.max(s.massRatio, 1));
  return Math.exp(-Math.min(Math.max(spent, 0), budget) / s.exhaust);
}

/** The sea-level pressure the thrust at sea level is quoted at [Pa]. */
export const P0 = 101325;

/**
 * The thrust at an ambient pressure over the vacuum one: 1 − (1 − slThrust) p / p₀ (the exit's area
 * times the pressure taken off), never below 0 — the Isp falls by the same factor (the same mass flow).
 */
export const pressureFactor = (slThrust: number, p: number) => Math.max(0, 1 - ((1 - slThrust) * Math.max(p, 0)) / P0);

/** The engine's thrust following its throttle with a first-order lag of time constant tau over dt [s]. */
export function spool(now: number, want: number, dt: number, tau: number) {
  if (!(tau > 0) || !(dt > 0)) return want;
  return want + (now - want) * Math.exp(-dt / tau);
}
