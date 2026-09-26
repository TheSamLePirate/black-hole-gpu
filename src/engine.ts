// The Ranger's two engines and its propellant.
//
// Cinema: the simulator's thrust setting (c²/M) — thousands of g for a hole of 10⁸ M☉, quasi-impulsive
// burns (a hypothetical engine; no crew survives it). Crew: 0.1–3 g, converted with the hole's mass
// (1 g = 9.80665 m/s² over c²/r_g), so burns last days and transfers are spirals.
//
// Propellant (optional): a relativistic rocket of effective exhaust speed vₑ (in c) and initial mass
// ratio R₀ = m₀/m_dry. Its rapidity budget is vₑ ln R₀; each burn spends w = ∫ a dτ (proper
// acceleration over proper time — the rapidity it gives, whatever the path), and the mass left is
// m/m₀ = e^{−w/vₑ}. A plan's Δv costs Σ atanh|Δv| of rapidity.

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
