// PLAN-REFRACTION-HORIZONS R6a-ciel, first lot — the mirages' rays from the eye, on the CPU: the air near the ground forced into
// a profile that makes them (illustrative, chosen in the settings or by TARS — never presented as observed), each ray from the
// eye traced by RK4 in the plane of its path — r, θ and its local elevation ψ: dr/ds = sin ψ, dθ/ds = cos ψ / r,
// dψ/ds = cos ψ (1/r + n′/n) — through its turning points, up out of the low air (2 km) or down onto the sea. The eye's table:
// for each apparent elevation in the horizon's band, where the ray goes — its true elevation (the exit's, the air above added
// by the layered model's bending, refraction-layered.ts) or the sea. Several apparent elevations for one true one: the images
// a mirage makes (the Sun's "Etruscan vase" over a warm sea; a duct's Fata Morgana). The GPU's reading — each sky pixel its
// true direction — is the next lot.
import { MIRAGE_BAND, MIRAGE_N, MIRAGE_VEC4S } from "./mirage-layout";
import { type AirProfile, type AirState, airProfile, bendingUp, ciddorRefractivity, us76Temperature } from "./refraction-layered";

const R_E = 6371e3;
/** the low air the rays are traced through [m]; the profile's step there [m] */
export const MIRAGE_TOP = 2000;
export const MIRAGE_STEP = 0.25;

/** the forced profiles: the standard air; a sea warmer than the air (the air hotter at the surface: an inferior mirage, the
 *  Sun's vase); an inversion aloft (a warm layer over cool air: a superior mirage, a duct) */
export type MirageKind = "standard" | "warmSea" | "inversion";

export interface MirageProfile {
  /** n − 1 every MIRAGE_STEP from the sea's level to MIRAGE_TOP */
  N: Float64Array;
  /** the layered air above (the bending from MIRAGE_TOP up) */
  above: AirProfile;
}

/** the air's temperature [°C] at h [m] under a forced profile, over a ground temperature t0 [°C]: the layered model's own air
 *  (US76, its ground offset fading over a kilometre — refraction-layered.ts airProfile) with the forced layer added */
export function forcedTemperature(kind: MirageKind, t0: number, h: number): number {
  const base = us76Temperature((R_E * h) / (R_E + h)) - 273.15 + (t0 + 273.15 - us76Temperature(0)) * Math.exp(-h / 1000);
  if (kind === "warmSea") return base + 6 * Math.exp(-h / 4);
  if (kind === "inversion") {
    // (cool air under 20 m, then 8 K warmer over the next 30 m)
    const x = Math.min(Math.max((h - 20) / 30, 0), 1);
    return base - 4 + 8 * x * x * (3 - 2 * x);
  }
  return base;
}

/** The low air's refractivity under a forced profile, the pressure hydrostatic from the sea's level */
export function mirageProfile(kind: MirageKind, state: AirState): MirageProfile {
  const n = Math.round(MIRAGE_TOP / MIRAGE_STEP) + 1;
  const N = new Float64Array(n);
  let p = state.pMsl;
  for (let i = 0; i < n; i++) {
    const h = i * MIRAGE_STEP;
    const t = forcedTemperature(kind, state.tGround, h);
    N[i] = ciddorRefractivity(p, t, state.rh * Math.exp(-h / 2000), state.lambdaUm ?? 0.55);
    p *= Math.exp(
      (-0.0289644 * 9.80665 * MIRAGE_STEP) / (8.314462 * (forcedTemperature(kind, state.tGround, h + MIRAGE_STEP / 2) + 273.15)),
    );
  }
  return { N, above: airProfile(state) };
}

function refr(P: MirageProfile, h: number): [number, number] {
  const x = Math.min(Math.max(h, 0), MIRAGE_TOP) / MIRAGE_STEP;
  const i = Math.min(Math.floor(x), P.N.length - 2);
  const f = x - i;
  const a = P.N[i]!,
    b = P.N[i + 1]!;
  return [a + (b - a) * f, (b - a) / MIRAGE_STEP];
}

/** One ray from the eye at h0 [m], apparent elevation e [rad]: null if it meets the sea; else its true elevation [rad] — where a
 *  distant body must be for its light to come along it */
export function mirageRay(P: MirageProfile, h0: number, e: number, ds = 2): number | null {
  // (state: r, θ, ψ; RK4 on the arc length, the step shortened near the sea and where the ray runs level)
  let r = R_E + h0,
    th = 0,
    psi = e;
  const d = (rr: number, ps: number): [number, number, number] => {
    const [Nr, dN] = refr(P, rr - R_E);
    const c = Math.cos(ps);
    return [Math.sin(ps), c / rr, c * (1 / rr + dN / (1 + Nr))];
  };
  for (let k = 0; k < 400000; k++) {
    const h = r - R_E;
    if (h <= 0) return null;
    if (h >= MIRAGE_TOP) break;
    // (fine near the sea and where the ray runs level — its turning points —, coarser up in the even air)
    const s = ds * Math.min(Math.max(h / 20 + Math.abs(Math.sin(psi)) * 50, 0.25), 25);
    const k1 = d(r, psi);
    const k2 = d(r + 0.5 * s * k1[0], psi + 0.5 * s * k1[2]);
    const k3 = d(r + 0.5 * s * k2[0], psi + 0.5 * s * k2[2]);
    const k4 = d(r + s * k3[0], psi + s * k3[2]);
    r += (s / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    th += (s / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    psi += (s / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  }
  if (r - R_E < MIRAGE_TOP) return null;
  // (the exit's elevation in the eye's frame — the local frame turned by θ —, less the air above's bending)
  return psi - th - bendingUp(P.above, MIRAGE_TOP, Math.max(psi, 0));
}

export interface MirageTable {
  /** apparent elevations [rad], from lo to hi */
  lo: number;
  hi: number;
  /** each one's true elevation [rad], NaN where the ray meets the sea */
  trueAlt: Float64Array;
}

/** The eye's table: n apparent elevations across the band [lo, hi] [rad] and where each ray goes */
export function mirageTable(P: MirageProfile, h0: number, lo: number, hi: number, n: number): MirageTable {
  const trueAlt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = mirageRay(P, h0, lo + ((hi - lo) * i) / (n - 1));
    trueAlt[i] = t === null ? Number.NaN : t;
  }
  return { lo, hi, trueAlt };
}

/** The apparent elevations [rad] at which a body at a true elevation [rad] is seen — one, or several (a mirage's images) */
export function imagesOf(T: MirageTable, trueAlt: number): number[] {
  const out: number[] = [];
  const n = T.trueAlt.length;
  for (let i = 0; i + 1 < n; i++) {
    const a = T.trueAlt[i]!,
      b = T.trueAlt[i + 1]!;
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    if ((a - trueAlt) * (b - trueAlt) <= 0 && a !== b) {
      const f = (trueAlt - a) / (b - a);
      out.push(T.lo + ((T.hi - T.lo) * (i + f)) / (n - 1));
    }
  }
  return out;
}

// ---- the eye's tables for the GPU (gpu-tables.ts TABLE_MIR; trace.wgsl reads them — the next lot)

export { MIRAGE_BAND, MIRAGE_N, MIRAGE_VEC4S };

/** the three colours' wavelengths [µm]: red, green, blue */
export const MIRAGE_LAMBDAS = [0.65, 0.55, 0.45] as const;
const SEA = -10;

/** The three colours' tables for an eye at h0 [m] under a forced profile, packed as the GPU reads them */
export function mirageTables(kind: MirageKind, state: AirState, h0: number): Float32Array {
  const out = new Float32Array(MIRAGE_VEC4S * 4);
  out.set([1, h0, -MIRAGE_BAND, MIRAGE_BAND], 0);
  MIRAGE_LAMBDAS.forEach((lambdaUm, c) => {
    const T = mirageTable(mirageProfile(kind, { ...state, lambdaUm }), h0, -MIRAGE_BAND, MIRAGE_BAND, MIRAGE_N);
    for (let i = 0; i < MIRAGE_N; i++) {
      const v = T.trueAlt[i]!;
      out[4 + c * MIRAGE_N + i] = Number.isNaN(v) ? SEA : v;
    }
  });
  return out;
}
