import { meanWind } from "../wind";
import type { WeatherState } from "../weather";
const D = Math.PI / 180;
/** Wind profile inferred from real surface weather; east/north [m/s], wind is FROM its reported bearing. */
export function trafficWind(w: WeatherState | null | undefined, height: number): [number, number] | null {
  if (!w || (w.source !== "metar" && w.source !== "model") || w.wind.from === null) return null;
  const speed = meanWind(w.wind.u10, height) + w.wind.shear * Math.min(1, Math.max(0, height) / 300);
  return [-speed * Math.sin(w.wind.from * D), -speed * Math.cos(w.wind.from * D)];
}
/** Air-relative heading minus ground track, degrees. No second drift is added to the observed path. */
export function windCrab(ve: number, vn: number, wind: readonly number[]): number {
  return (((Math.atan2(ve - wind[0]!, vn - wind[1]!) - Math.atan2(ve, vn)) / D + 540) % 360) - 180;
}
/** Airborne response is damped/rate limited. Near contact, converge within estimated time to touchdown.
 * dt is bounded after clock cuts; on ground settle rapidly without an instantaneous rotation. */
export function crabStep(angle: number, targetDeg: number, over: number, grounded: boolean, dt: number, sink = 0): number {
  const step = Math.min(0.25, Math.max(0, dt));
  const toContact = over / Math.max(0.5, sink);
  const decrab = grounded || (sink > 0.3 && over < 25 && toContact < 8);
  const target = decrab ? 0 : Math.max(-20, Math.min(20, targetDeg)) * D;
  const tau = decrab ? (grounded ? 0.35 : Math.max(0.05, toContact / 3)) : 3;
  const delta = (target - angle) * -Math.expm1(-step / tau);
  const limit = (decrab ? 6 : 2) * D * step;
  return angle + Math.max(-limit, Math.min(limit, delta));
}
