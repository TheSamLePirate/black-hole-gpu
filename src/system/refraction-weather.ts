// PLAN-REFRACTION-HORIZONS R6b — the mirages the weather makes plausible (docs/progress/refraction-horizons/R6.md, the research
// and its go/no-go): never an observation — the models resolve neither the surface layer (its tens of metres where an inferior
// mirage's gradient lies) nor the thin inversions of a superior one (ERA5 underestimates the ducts' strength and height
// against radiosondes: AMT 17, 6851, 2024; JTECH 37, 2020) —, a forced profile (system/mirage.ts) chosen and scaled by what the
// model does give:
//   - an inferior mirage (a warm sea's, the Sun's Etruscan vase) when the surface is warmer than the air at 2 m: the sea's
//     temperature over the air's by ΔT ≥ 1 K, calm enough that the layer is not mixed away (wind ≤ 8 m/s);
//   - a superior one (a duct, a Fata Morgana) when the air aloft is warmer than at the surface — an inversion over a cold sea
//     or ground: T(950 hPa) − T(2 m) > 0 and over water T(2 m) > the sea —, calm (wind ≤ 6 m/s);
//   - else the layered model's air alone.
// Its strength (0…1) scales the forced layer's ΔT; its confidence ("low" always for a superior mirage, "medium" at best for an
// inferior one over the sea) is what TARS says with it.
import type { MirageKind } from "./mirage";

export interface MirageWeather {
  /** the air at 2 m [°C] */
  t2m: number;
  /** the sea's surface [°C] (the marine model's), when over the sea */
  sst?: number | null;
  /** the air at the 950 hPa level [°C] (the model's), when given */
  t950?: number | null;
  /** the wind at 10 m [m/s] */
  wind: number;
}

export interface MirageGuess {
  kind: MirageKind;
  /** 0…1: the forced layer's ΔT scaled by it */
  strength: number;
  confidence: "none" | "low" | "medium";
  /** why, in a sentence (English; the UI's i18n translates its key) */
  why: string;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** The mirage the weather makes plausible at a place over the sea or the ground */
export function mirageFromWeather(w: MirageWeather): MirageGuess {
  const calm = (lim: number) => clamp01((lim - w.wind) / (0.5 * lim));
  if (w.sst !== null && w.sst !== undefined) {
    const dT = w.sst - w.t2m;
    if (dT >= 1 && w.wind <= 8) {
      const s = clamp01((dT - 1) / 5) * calm(8);
      if (s > 0.05)
        return {
          kind: "warmSea",
          strength: s,
          confidence: "medium",
          why: `sea ${dT.toFixed(1)} K warmer than the air, wind ${w.wind.toFixed(0)} m/s`,
        };
    }
    if (dT <= -1 && w.wind <= 6 && w.t950 !== null && w.t950 !== undefined && w.t950 > w.t2m) {
      const s = clamp01((-dT - 1) / 4) * clamp01((w.t950 - w.t2m) / 4) * calm(6);
      if (s > 0.05)
        return {
          kind: "inversion",
          strength: s,
          confidence: "low",
          why: `air ${(-dT).toFixed(1)} K warmer than the sea, an inversion aloft, wind ${w.wind.toFixed(0)} m/s`,
        };
    }
    return { kind: "standard", strength: 0, confidence: "none", why: "no layer the model shows" };
  }
  if (w.t950 !== null && w.t950 !== undefined && w.t950 - w.t2m > 2 && w.wind <= 6) {
    const s = clamp01((w.t950 - w.t2m - 2) / 6) * calm(6);
    if (s > 0.05)
      return { kind: "inversion", strength: s, confidence: "low", why: `an inversion over the ground, wind ${w.wind.toFixed(0)} m/s` };
  }
  return { kind: "standard", strength: 0, confidence: "none", why: "no layer the model shows" };
}
