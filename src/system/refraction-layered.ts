// R1 — the Earth's air in layers, its refraction on the CPU (docs/PLAN-REFRACTION-HORIZONS.md R1). The model the tables (R1's
// worker, R2's GPU) will be made from; here its core:
//   - the air's profile built hydrostatically (dP/dh = −ρ g(h), g falling as (R/(R+h))²) from a pressure at the sea's level, the
//     temperature the US Standard Atmosphere 1976's by geopotential height (us76's layers to 86 km), the ground's departure from
//     it decaying over ~1 km (the boundary layer), the relative humidity decaying over 2 km;
//   - the refractive index by Ciddor (1996, Applied Optics 35, 1566 — NIST's), humidity and CO₂ in, at a wavelength;
//   - a ray's bending by Bouguer's invariant n r sin z = c, integrated in r = r₀ + s² (the tangent's 1/√ cancelled: a grazing ray
//     integrated as any other), Simpson's rule: the bending up to space from a height and an apparent elevation, a tangent ray's
//     from orbit (twice its half), a ray dipping under the horizon (down to its tangent, then up).
// Pure functions, no GPU: tests/refraction-layered.test.ts checks them against Bennett, the setting Sun's flattening, the limb's
// figures.

const R_E = 6371e3;
const G0 = 9.80665;
/** the dry air's molar mass [kg/mol] and the gas constant [J/(mol K)] */
const M_AIR = 0.0289644;
const R_GAS = 8.314462;
/** the profile's step [m] and top [m] */
export const LAYER_STEP = 10;
export const LAYER_TOP = 120_000;

/**
 * Ciddor's refractivity n − 1 of moist air: pressure p [Pa], temperature t [°C], relative humidity rh (0…1), wavelength λ [µm],
 * CO₂ [ppm].
 */
export function ciddorRefractivity(p: number, t: number, rh = 0, lambdaUm = 0.55, co2 = 450): number {
  const s2 = 1 / (lambdaUm * lambdaUm);
  const T = t + 273.15;
  // (standard dry air, 15 °C, 101 325 Pa, 450 ppm CO₂; standard water vapour, 20 °C, 1 333 Pa)
  const nas = (5792105 / (238.0185 - s2) + 167917 / (57.362 - s2)) * 1e-8;
  const naxs = nas * (1 + 0.534e-6 * (co2 - 450));
  const nws = 1.022 * (295.235 + 2.6422 * s2 - 0.03238 * s2 * s2 + 0.004028 * s2 * s2 * s2) * 1e-8;
  const svp = Math.exp(1.2378847e-5 * T * T - 1.9121316e-2 * T + 33.93711047 - 6.3431645e3 / T);
  const f = 1.00062 + 3.14e-8 * p + 5.6e-7 * t * t;
  const xw = (f * rh * svp) / p;
  const Ma = 1e-3 * (28.9635 + 12.011e-6 * (co2 - 400));
  const Mw = 0.018015;
  const Z = (pp: number, TT: number, x: number) => {
    const tt = TT - 273.15;
    return (
      1 -
      (pp / TT) *
        (1.58123e-6 - 2.9331e-8 * tt + 1.1043e-10 * tt * tt + (5.707e-6 - 2.051e-8 * tt) * x + (1.9898e-4 - 2.376e-6 * tt) * x * x) +
      (pp / TT) ** 2 * (1.83e-11 - 0.765e-8 * x * x)
    );
  };
  const rhoAxs = (101325 * Ma) / (Z(101325, 288.15, 0) * R_GAS * 288.15);
  const rhoWs = (1333 * Mw) / (Z(1333, 293.15, 1) * R_GAS * 293.15);
  const Zm = Z(p, T, xw);
  const rhoA = (p * Ma * (1 - xw)) / (Zm * R_GAS * T);
  const rhoW = (p * Mw * xw) / (Zm * R_GAS * T);
  return (rhoA / rhoAxs) * naxs + (rhoW / rhoWs) * nws;
}

/** the US Standard Atmosphere 1976's temperature [K] at a geopotential height H [m] (its layers to 84.85 km, then the last's) */
export function us76Temperature(H: number): number {
  const layers: [number, number, number][] = [
    [0, 288.15, -0.0065],
    [11000, 216.65, 0],
    [20000, 216.65, 0.001],
    [32000, 228.65, 0.0028],
    [47000, 270.65, 0],
    [51000, 270.65, -0.0028],
    [71000, 214.65, -0.002],
  ];
  let k = 0;
  while (k + 1 < layers.length && H >= layers[k + 1]![0]) k++;
  const [h0, t0, lapse] = layers[k]!;
  return Math.max(t0 + lapse * (Math.min(H, 84852) - h0), 186.87);
}

export interface AirState {
  /** the pressure at the sea's level [Pa] */
  pMsl: number;
  /** the temperature at the ground [°C] (its departure from the standard air's decaying over ~1 km) */
  tGround: number;
  /** the relative humidity at the ground (0…1, decaying over 2 km) */
  rh: number;
  /** the wavelength [µm] */
  lambdaUm?: number;
}
/** the standard air: Bennett's table's (10 °C, 1 010 hPa), dry */
export const BENNETT_AIR: AirState = { pMsl: 101000, tGround: 10, rh: 0 };

export interface AirProfile {
  /** n − 1 every LAYER_STEP from the sea's level [m] to LAYER_TOP */
  N: Float64Array;
  state: AirState;
}

/** The air's profile: its refractivity layer by layer, the pressure integrated hydrostatically from the sea's level. */
export function airProfile(state: AirState): AirProfile {
  const n = Math.round(LAYER_TOP / LAYER_STEP) + 1;
  const N = new Float64Array(n);
  const dT = state.tGround + 273.15 - us76Temperature(0);
  const tAt = (h: number) => us76Temperature((R_E * h) / (R_E + h)) + dT * Math.exp(-h / 1000);
  let p = state.pMsl;
  for (let i = 0; i < n; i++) {
    const h = i * LAYER_STEP;
    const T = tAt(h);
    N[i] = ciddorRefractivity(p, T - 273.15, state.rh * Math.exp(-h / 2000), state.lambdaUm ?? 0.55);
    // (the next layer's pressure: dP/dh = −P M g / (R T), the step's midpoint)
    const hm = h + LAYER_STEP / 2;
    const g = G0 * (R_E / (R_E + hm)) ** 2;
    p *= Math.exp((-M_AIR * g * LAYER_STEP) / (R_GAS * tAt(hm)));
  }
  return { N, state };
}

/** n − 1 and its derivative [1/m] at a height h [m] (linear between the layers; 0 above the top) */
function refrAt(P: AirProfile, h: number): [number, number] {
  if (h >= LAYER_TOP) return [0, 0];
  const x = Math.max(h, 0) / LAYER_STEP;
  const i = Math.min(Math.floor(x), P.N.length - 2);
  const f = x - i;
  const a = P.N[i]!,
    b = P.N[i + 1]!;
  return [a + (b - a) * f, (b - a) / LAYER_STEP];
}

/**
 * A ray's bending [rad] from a height h0 [m] at an apparent elevation e [rad] (≥ 0) up to the air's top: Bouguer's invariant
 * c = n₀ r₀ cos e, δ = ∫ (−n′/n) c / √(n²r² − c²) dr, in r = r₀ + s² (dr = 2s ds: the tangent's 1/√s cancelled), Simpson.
 */
export function bendingUp(P: AirProfile, h0: number, e: number, steps = 4000): number {
  const r0 = R_E + h0;
  const [N0] = refrAt(P, h0);
  const c = (1 + N0) * r0 * Math.cos(e);
  const sTop = Math.sqrt(Math.max(LAYER_TOP - h0, 0));
  if (sTop <= 0) return 0;
  const ds = sTop / steps;
  const f = (s: number) => {
    const r = r0 + s * s;
    const [Nr, dN] = refrAt(P, r - R_E);
    const n = 1 + Nr;
    const q = n * n * r * r - c * c;
    if (q <= 0) {
      // (at the tangent itself: the limit of 2s/√q, q ≈ (q′) s² — q′ = d(n²r²)/dr = 2 n r (n + r n′))
      if (s > 0) return 0;
      const qp = 2 * n * r * (n + r * dN);
      return qp > 0 ? (((-dN / n) * c) / Math.sqrt(qp)) * 2 : 0;
    }
    return ((-dN / n) * c * 2 * s) / Math.sqrt(q);
  };
  let sum = f(0) + f(sTop);
  for (let k = 1; k < steps; k++) sum += (k % 2 ? 4 : 2) * f(k * ds);
  return (sum * ds) / 3;
}

/** A tangent ray's bending [rad] through the whole air (a star seen at the limb from orbit): twice its half from the tangent */
export function limbBending(P: AirProfile, tangentH: number): number {
  return 2 * bendingUp(P, tangentH, 0);
}

/**
 * The refraction [rad] of a body seen at an apparent elevation e [rad] from a height h0 [m]: its true elevation is e less it. A
 * ray under the horizon (e < 0, from a height) goes down to its tangent — where n r = c —, then up: twice the tangent's half less
 * the stretch from it up to the observer. null: the ray meets the ground (no tangent above the sea).
 */
export function refraction(P: AirProfile, apparentAlt: number, h0 = 0): number | null {
  if (apparentAlt >= 0) return bendingUp(P, h0, apparentAlt);
  const r0 = R_E + h0;
  const c = (1 + refrAt(P, h0)[0]) * r0 * Math.cos(apparentAlt);
  // (the tangent: n(r) r = c, bisected — n r rises with r where the air does not duct)
  let lo = R_E,
    hi = r0;
  if ((1 + refrAt(P, 0)[0]) * R_E > c) return null;
  for (let k = 0; k < 60; k++) {
    const m = 0.5 * (lo + hi);
    if ((1 + refrAt(P, m - R_E)[0]) * m < c) lo = m;
    else hi = m;
  }
  const ht = 0.5 * (lo + hi) - R_E;
  return 2 * bendingUp(P, ht, 0) - bendingUp(P, h0, -apparentAlt);
}

/**
 * The apparent elevation [rad] of a body at a true elevation [rad] from h0 [m]: e − R(e) = true, bisected (e − R(e) rises with
 * e; a ray that meets the ground counts as below) — null: not seen (under the lowest ray that clears the ground).
 */
export function apparentElevation(P: AirProfile, trueAlt: number, h0 = 0): number | null {
  const f = (e: number) => {
    const r = refraction(P, e, h0);
    return r === null ? Number.NEGATIVE_INFINITY : e - r - trueAlt;
  };
  let lo = -Math.PI / 6,
    hi = Math.PI / 2;
  if (f(hi) < 0) return null;
  for (let k = 0; k < 60; k++) {
    const m = 0.5 * (lo + hi);
    if (f(m) < 0) lo = m;
    else hi = m;
  }
  return Number.isFinite(f(hi)) ? hi : null;
}

// ---- the model's report (TARS's « sky »: system/sky-now.ts) — on demand, the profile cached by its air

const profiles = new Map<string, AirProfile>();
/** an air's profile, kept for the last few airs (a profile: ~5 ms) */
export function profileFor(state: AirState): AirProfile {
  const key = `${state.pMsl.toFixed(0)}|${state.tGround.toFixed(1)}|${state.rh.toFixed(2)}|${state.lambdaUm ?? 0.55}`;
  let p = profiles.get(key);
  if (!p) {
    p = airProfile(state);
    profiles.set(key, p);
    if (profiles.size > 8) profiles.delete(profiles.keys().next().value!);
  }
  return p;
}
/** the ground's temperature [°C] the drawn sea-level refractivity stands for (refraction.ts seaRefractivity's inverse) */
export const tempOfRefractivity = (n0: number) => (2.93e-4 * 288.15) / n0 - 273.15;

/**
 * The layered model's figures for a place: its air — the ground's temperature from the drawn refractivity, the standard pressure
 * unless given —, the refraction at the horizon [′] from the height h [m] (the dip's ray when above the sea: its tangent), and a
 * body's apparent altitude [°] from its true one. Seconds of work at most: on demand, not a frame's.
 */
export function layeredReport(n0: number, h: number, trueAltDeg: number, pMsl = 101325) {
  const state: AirState = { pMsl, tGround: tempOfRefractivity(n0), rh: 0.5 };
  const P = profileFor(state);
  const D = Math.PI / 180;
  const app = apparentElevation(P, trueAltDeg * D, h);
  return {
    model: "layered (Ciddor, hydrostatic, Bouguer)",
    pressureHpa: Math.round(pMsl / 10) / 10,
    groundTempC: Math.round(state.tGround * 10) / 10,
    humidityPct: 50,
    horizonArcmin: Math.round(((refraction(P, 0, h) ?? 0) / D) * 600) / 10,
    apparentAltDeg: app === null ? null : Math.round((app / D) * 1000) / 1000,
  };
}
