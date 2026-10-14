// The Earth's air bends the light (PLAN-CIEL C3) — the tracer's model (trace.wgsl airBend), on the CPU for
// what is placed by hand (the sky's labels, the rising and setting times, TARS's figures): through an
// exponential air of refractivity N = N₀ e^(−h/H) (H the density's scale height, 8.4 km), a ray's bending is
// ∫ (N/H) sin ψ ds ≈ (N₀/H) sin ψ × its air column (Chapman's grazing function): 35′ at the horizon from the
// sea, 1′ at 45°, none at the zenith — Bennett's table within a fraction of a minute above 2°.

const R_EARTH = 6371e3;
/** the density's scale height [m] */
export const REFR_H = 8400;

/** The air's refractivity at sea level (n − 1) at a temperature [°C], the pressure standard: denser cold air bends more. */
export function seaRefractivity(tempC = 15): number {
  return (2.93e-4 * 288.15) / (273.15 + tempC);
}

/** Chapman's grazing incidence function (Schüler's approximation), the tracer's chUp. */
function chUp(x: number, mu: number): number {
  const c = Math.sqrt(1.5707963 * x);
  return c / ((c - 1) * mu + 1);
}

/** The air's column [m of sea-level air] from a height h [m] towards mu (the zenith angle's cosine), the tracer's airColumn. */
export function airColumn(h: number, mu: number, H = REFR_H): number {
  const X = R_EARTH / H;
  const x = X + h / H;
  if (mu >= 0) return chUp(x, mu) * Math.exp(-h / H) * H;
  const x0 = x * Math.sqrt(Math.max(1 - mu * mu, 0));
  return (2 * chUp(x0, 0) * Math.exp(Math.min(X - x0, 60)) - chUp(x, -mu) * Math.exp(-h / H)) * H;
}

/** The bending [rad] of a ray seen at an apparent altitude [rad] from a height h [m] above the sea (N₀: sea-level refractivity). */
export function bending(apparentAlt: number, h = 0, N0 = seaRefractivity()): number {
  const mu = Math.sin(apparentAlt);
  const sinPsi = mu < 0 ? 1 : Math.cos(apparentAlt);
  return Math.min((N0 / REFR_H) * sinPsi * airColumn(Math.max(h, 0), mu, REFR_H), 0.03);
}

/** Where a body at a true altitude [rad] is seen (its apparent altitude): above the true by the bending of the ray seen. */
export function apparentAltitude(trueAlt: number, h = 0, N0 = seaRefractivity()): number {
  // (the bending is the apparent ray's: a fixed point, a few steps — it changes slowly with the altitude)
  let a = trueAlt;
  for (let i = 0; i < 6; i++) a = trueAlt + bending(a, h, N0);
  return a;
}

/** The tracer's constants (trace.wgsl airBend, P.sky) for the camera h [m] above an Earth of radius R [m]:
 *  the sea-level refractivity, the camera's, R and R + h in scale heights. */
export function refractionParams(N0: number, h: number, R = R_EARTH): [number, number, number, number] {
  return [N0, N0 * Math.exp(-Math.max(h, 0) / REFR_H), R / REFR_H, (R + Math.max(h, 0)) / REFR_H];
}

/** Bennett's formula (1982): the refraction [rad] at an apparent altitude [rad] at 10 °C and 1010 hPa — the reference. */
export function bennett(apparentAlt: number): number {
  const deg = (apparentAlt * 180) / Math.PI;
  return ((1 / Math.tan(((deg + 7.31 / (deg + 4.4)) * Math.PI) / 180)) * Math.PI) / (180 * 60);
}

/** The air's refractivity the frame is drawn with now (main.ts sets it: the renderer's, from the weather's temperature;
 *  0: no refraction drawn) — for what aims where the frame shows things (a tripod's telescope). */
let drawnN0: () => number = () => seaRefractivity();
export function setDrawnRefractivity(f: () => number) {
  drawnN0 = f;
}
export const drawnRefractivity = () => drawnN0();

/**
 * A direction [unit] as the air shows it from a place whose zenith is `zen`: raised in the vertical plane by the
 * refraction of an air of refractivity N0 — 16″ at 46°, half a degree at the horizon —; under the horizon, or N0 0:
 * unchanged.
 */
export function refractDirection(d: [number, number, number], zen: [number, number, number], N0: number): [number, number, number] {
  if (!(N0 > 0)) return d;
  const s = Math.max(-1, Math.min(1, d[0] * zen[0] + d[1] * zen[1] + d[2] * zen[2]));
  const alt = Math.asin(s);
  if (alt < -0.05) return d;
  const h = [d[0] - s * zen[0], d[1] - s * zen[1], d[2] - s * zen[2]];
  const hl = Math.hypot(h[0]!, h[1]!, h[2]!);
  if (hl < 1e-9) return d;
  const a = apparentAltitude(alt, 0, N0);
  const v: [number, number, number] = [0, 1, 2].map((i) => (h[i]! / hl) * Math.cos(a) + zen[i]! * Math.sin(a)) as [number, number, number];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}
