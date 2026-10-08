// The weather (PLAN-METEO W1): one state for the place a craft flies over — the wind (its force at 10 m,
// where it blows from, its gusts, its turbulence, its shear near the ground), the visibility (mist, fog
// lying on the ground), up to three cloud layers (base, top, cover), the rain, Mars's dust. Chosen by the
// player (settings.weather): a preset, a draw (the same place and day, the same weather), or the real
// one (the airfields' METAR, W7). The flight's physics (wind.ts) and the image (trace.wgsl) read it.
//
// "fair" is the weather before: the wind of the player's own setting (settings.wind), its direction
// turning with the place and the day, the clouds of the Earth's real map — the flights flown before are
// flown the same.

import { WIND_10M, windFrom, type WindLevel } from "./wind";

export type WeatherPreset = "fair" | "cloudy" | "overcast" | "fog" | "rain" | "storm" | "windy" | "dust" | "random" | "real";

/** The presets in the order the panel shows them. */
export const WEATHER_PRESETS: WeatherPreset[] = ["fair", "cloudy", "overcast", "fog", "rain", "storm", "windy", "dust", "random", "real"];

export interface CloudLayer {
  /** its base and its top above the ground [m] */
  base: number;
  top: number;
  /** how much of the sky it covers (0…1: FEW ≈ 0.2, SCT 0.4, BKN 0.75, OVC 1) */
  cover: number;
}

export interface WindSpec {
  /** the mean wind at 10 m [m/s] */
  u10: number;
  /** where it blows from [° from north, clockwise], or null: turning slowly with the place and the day */
  from: number | null;
  /** the gusts' peak [m/s] (0: none) */
  gust: number;
  /** the turbulence aloft: none, light, moderate, severe (Dryden's intensities) */
  turb: WindLevel;
  /** the wind's growth over the lowest 300 m beyond the boundary layer's own [m/s] (the final's shear) */
  shear: number;
}

export interface WeatherState {
  /** where it comes from: a preset, a draw, an airfield's report */
  source: "preset" | "random" | "metar";
  /** the preset it is (or the one drawn) */
  kind: Exclude<WeatherPreset, "random" | "real">;
  wind: WindSpec;
  /** how far one sees near the ground [m] */
  visibility: number;
  /** the fog's top [m above the ground] (0: no fog lying) */
  fogTop: number;
  /** up to three layers, the lowest first ([]: the Earth's real map of clouds alone, as before) */
  layers: CloudLayer[];
  /** the rain (0 none … 1 heavy) */
  rain: number;
  /** a dust storm (0 … 1: Mars) */
  dust: number;
  /** the report it was read from (METAR), raw */
  report?: string;
}

/** The fair weather's wind: the player's own setting, as before. */
export function fairWind(level: WindLevel): WindSpec {
  return { u10: WIND_10M[level]!, from: null, gust: [0, 0, 5, 9][level]!, turb: level, shear: 0 };
}

type Fixed = Exclude<WeatherPreset, "random" | "real">;

/** Each preset's weather (the fair one's wind: the player's setting). */
export function presetWeather(kind: Fixed, windLevel: WindLevel): WeatherState {
  const base = { source: "preset" as const, kind, rain: 0, dust: 0, fogTop: 0 };
  switch (kind) {
    case "fair":
      return { ...base, wind: fairWind(windLevel), visibility: 40e3, layers: [] };
    case "cloudy":
      return {
        ...base,
        wind: { u10: 5, from: null, gust: 0, turb: 1, shear: 0 },
        visibility: 25e3,
        layers: [{ base: 1200, top: 2600, cover: 0.45 }],
      };
    case "overcast":
      return {
        ...base,
        wind: { u10: 7, from: null, gust: 4, turb: 1, shear: 1 },
        visibility: 12e3,
        layers: [
          { base: 600, top: 2000, cover: 0.95 },
          { base: 4000, top: 5500, cover: 0.5 },
        ],
      };
    case "fog":
      return {
        ...base,
        wind: { u10: 1, from: null, gust: 0, turb: 0, shear: 0 },
        visibility: 300,
        fogTop: 120,
        layers: [{ base: 150, top: 900, cover: 0.9 }],
      };
    case "rain":
      return {
        ...base,
        wind: { u10: 8, from: null, gust: 6, turb: 2, shear: 3 },
        visibility: 4000,
        rain: 0.6,
        layers: [{ base: 500, top: 3500, cover: 1 }],
      };
    case "storm":
      return {
        ...base,
        wind: { u10: 13, from: null, gust: 10, turb: 3, shear: 6 },
        visibility: 2500,
        rain: 1,
        layers: [
          { base: 400, top: 9000, cover: 1 },
          { base: 10000, top: 11500, cover: 0.6 },
        ],
      };
    case "windy":
      return {
        ...base,
        wind: { u10: 15, from: null, gust: 9, turb: 2, shear: 5 },
        visibility: 30e3,
        layers: [{ base: 1500, top: 2400, cover: 0.3 }],
      };
    case "dust":
      return { ...base, wind: { u10: 14, from: null, gust: 8, turb: 2, shear: 3 }, visibility: 2000, dust: 1, layers: [] };
  }
}

/** A small seeded PRNG (mulberry32). */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value noise over the sphere's latitude and longitude [°], cells of `cell` degrees (the longitude
 *  wrapping), smoothed between their corners: 0…1, the same for the same seed. */
function field(lat: number, lon: number, cell: number, seed: number): number {
  const nx = Math.round(360 / cell);
  const u = ((((lon + 180) % 360) + 360) % 360) / cell,
    v = (lat + 90) / cell;
  const i0 = Math.floor(u),
    j0 = Math.floor(v);
  const fu = u - i0,
    fv = v - j0;
  const at = (i: number, j: number) => rand(seed + (((i % nx) + nx) % nx) * 7919 + j * 104729)();
  const s = (x: number) => x * x * (3 - 2 * x);
  const a = at(i0, j0) + (at(i0 + 1, j0) - at(i0, j0)) * s(fu);
  const b = at(i0, j0 + 1) + (at(i0 + 1, j0 + 1) - at(i0, j0 + 1)) * s(fu);
  return a + (b - a) * s(fv);
}

/**
 * A plausible weather drawn for a place and a day: weather systems, not a patchwork — a moisture field
 * and a wind field over the sphere, ~1 300 km across (a 12° noise and a 6° one under it), drawn anew
 * each day: dry, fair; moister, clouds, then overcast; the moistest rain, and storms where the air is
 * also unstable (the tropics most); fog where it is moist and calm; strong wind where the wind field
 * peaks. Its direction the large-scale one (windFrom) turned a little by the field. The same place and
 * day, the same weather. Mars: fair, its dust storms where its own field peaks.
 */
/** The draw's fields at a place and day (0…1): its moisture, its wind, its instability — randomWeather's,
 *  and the weather map's (its rain as a radar draws it, continuous). */
export function weatherFields(body: string, lat: number, lon: number, days: number): { moist: number; windy: number; unstable: number } {
  const day = Math.floor(days);
  const seed = day * 2654435761 + (body === "mars" ? 99991 : 17);
  const f = (cell: number, k: number) => 0.65 * field(lat, lon, cell, seed + k) + 0.35 * field(lat, lon, cell / 2, seed + k + 1);
  return { moist: f(12, 101), windy: f(12, 202), unstable: f(15, 303) };
}

/** How hard it rains at a place of a draw, as a radar shows it (0 none … 1 heavy, up to 1.3 a storm's core). */
export function rainIntensity(f: { moist: number; unstable: number }, lat: number): number {
  const s = (a: number, b: number, x: number) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const rain = s(0.6, 0.8, f.moist);
  const storm = s(0.62, 0.72, f.moist) * s(Math.abs(lat) < 23 ? 0.48 : 0.62, Math.abs(lat) < 23 ? 0.62 : 0.76, f.unstable);
  return rain + 0.35 * storm;
}

export function randomWeather(body: string, lat: number, lon: number, days: number, windLevel: WindLevel): WeatherState {
  const { moist, windy, unstable } = weatherFields(body, lat, lon, days);
  const tropics = Math.abs(lat) < 23;
  let kind: Fixed;
  if (body === "mars") kind = moist > 0.66 ? "dust" : "fair";
  else if (moist > 0.66 && unstable > (tropics ? 0.5 : 0.66)) kind = "storm";
  else if (moist > 0.64) kind = "rain";
  else if (moist > 0.56 && windy < 0.36) kind = "fog";
  else if (moist > 0.52) kind = "overcast";
  else if (windy > 0.68) kind = "windy";
  else if (moist > 0.42) kind = "cloudy";
  else kind = "fair";
  const w = presetWeather(kind, windLevel);
  // (the figures from the fields too: two places alike are not the same weather)
  const k = 0.7 + 0.6 * windy;
  const from = ((((windFrom(lat, lon, days) * 180) / Math.PI + (unstable - 0.5) * 80) % 360) + 360) % 360;
  return {
    ...w,
    source: "random",
    wind: { ...w.wind, u10: kind === "fair" ? w.wind.u10 : Math.round(w.wind.u10 * k * 10) / 10, from: Math.round(from) },
    visibility: Math.round(w.visibility * (1.3 - 0.6 * moist)),
    layers: w.layers.map((l) => {
      const g = 0.7 + 0.6 * unstable;
      return { base: Math.round(l.base * g), top: Math.round(l.top * g), cover: Math.min(1, l.cover * (0.7 + 0.5 * moist)) };
    }),
  };
}

/**
 * The weather now at a place: the setting's preset, a draw, or the airfields' report (W7: `real`, its
 * state when it came in — else fair).
 */
export function weatherAt(
  s: { weather: WeatherPreset; wind: WindLevel },
  place: { body: string; lat: number; lon: number },
  days: number,
  real: WeatherState | null = null,
): WeatherState {
  if (s.weather === "real") return real ?? presetWeather("fair", s.wind);
  if (s.weather === "random") return randomWeather(place.body, place.lat, place.lon, days, s.wind);
  return presetWeather(s.weather, s.wind);
}

/** A layer's report word by its cover: FEW, SCT, BKN, OVC. */
export function coverWord(cover: number): "FEW" | "SCT" | "BKN" | "OVC" {
  return cover >= 0.95 ? "OVC" : cover >= 0.625 ? "BKN" : cover >= 0.3 ? "SCT" : "FEW";
}

/** The ceiling [m above the ground]: the lowest layer broken or overcast (BKN, OVC), the fog's sky when it
 *  hides it; null: none. */
export function ceilingOf(w: WeatherState): number | null {
  if (w.fogTop > 0 && w.visibility < 1000) return w.fogTop;
  const l = w.layers.find((x) => x.cover >= 0.625);
  return l ? l.base : null;
}

/** The flight category as the charts colour it (the FAA's): its ceiling and visibility against 3 000, 1 000
 *  and 500 ft, and 5, 3 and 1 statute miles. */
export function flightCategory(w: WeatherState): "VFR" | "MVFR" | "IFR" | "LIFR" {
  const c = ceilingOf(w);
  const ft = c === null ? Number.POSITIVE_INFINITY : c / 0.3048;
  const sm = w.visibility / 1609.344;
  if (ft < 500 || sm < 1) return "LIFR";
  if (ft < 1000 || sm < 3) return "IFR";
  if (ft <= 3000 || sm <= 5) return "MVFR";
  return "VFR";
}

/** Where the wind blows from at a place [° from north]: the weather's own, or the fair weather's turning one. */
export function windFromAt(w: WeatherState, place: { lat: number; lon: number }, days: number): number {
  if (w.wind.from !== null) return w.wind.from;
  return ((((windFrom(place.lat, place.lon, days) * 180) / Math.PI) % 360) + 360) % 360;
}
