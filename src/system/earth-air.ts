// The Earth's air on the CPU: the sunlight's way down through it (the tracer's sunThrough — Rayleigh,
// ozone, aerosols; Chapman's grazing incidence in Schüler's approximation; the planet's shadow), for
// the light meter: the light falling on a camera near the Earth.

import { EARTH_RM } from "../terrain";

/** The air drawn thicker than it is (the tracer's airK: scale heights × k, densities / k). */
export const AIR_K = 3;
const HR = 8000 * AIR_K, HM = 1200 * AIR_K;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];
const BO = [1.22e-6, 3.53e-6, 0.16e-6];
const BME = 2.33e-5;

const chUp = (x: number, mu: number) => {
  const c = Math.sqrt(1.5707963 * x);
  return c / ((c - 1) * mu + 1);
};
/** The air's column [m at sea level density] from a height h [m] towards the zenith cosine mu, scale height H. */
function airColumn(h: number, mu: number, H: number) {
  const X = EARTH_RM / H, x = X + h / H;
  if (mu >= 0) return chUp(x, mu) * Math.exp(-h / H) * H;
  const x0 = x * Math.sqrt(Math.max(1 - mu * mu, 0));
  return (2 * chUp(x0, 0) * Math.exp(Math.min(X - x0, 60)) - chUp(x, -mu) * Math.exp(-h / H)) * H;
}

/** The sunlight's transmission (linear rgb) down to a height h [m], the sun at mu from the zenith. */
export function sunThrough(h: number, mu: number): [number, number, number] {
  const cR = airColumn(h, mu, HR), cM = airColumn(h, mu, HM);
  return [0, 1, 2].map((i) => Math.exp(-((BR[i]! + BO[i]!) * cR + BME * cM) / AIR_K)) as [number, number, number];
}

/** …its luminance. */
export function sunThroughY(h: number, mu: number) {
  const T = sunThrough(h, mu);
  return 0.2126 * T[0] + 0.7152 * T[1] + 0.0722 * T[2];
}
