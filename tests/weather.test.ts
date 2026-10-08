import { describe, expect, test } from "bun:test";
import {
  ceilingOf,
  coverWord,
  fairWind,
  flightCategory,
  layerTau,
  presetWeather,
  randomWeather,
  WEATHER_PRESETS,
  weatherAt,
  weatherGpu,
  windFromAt,
  type WeatherPreset,
} from "../src/weather";
import { Weather, WIND_10M } from "../src/wind";

// The weather (PLAN-METEO W1): its presets, its draws, the wind it gives the flight.

const fixed = WEATHER_PRESETS.filter((p) => p !== "random" && p !== "real") as Exclude<WeatherPreset, "random" | "real">[];

test("every preset sound: layers low to high, base under top, cover 0…1, a visibility; fair is the weather before", () => {
  for (const k of fixed) {
    const w = presetWeather(k, 1);
    expect(w.visibility).toBeGreaterThan(0);
    expect(w.layers.length).toBeLessThanOrEqual(3);
    w.layers.forEach((l, i) => {
      expect(l.base).toBeLessThan(l.top);
      expect(l.cover).toBeGreaterThan(0);
      expect(l.cover).toBeLessThanOrEqual(1);
      if (i) expect(l.base).toBeGreaterThanOrEqual(w.layers[i - 1]!.top);
    });
  }
  for (const lv of [0, 1, 2, 3] as const) {
    const f = presetWeather("fair", lv);
    expect(f.wind).toEqual(fairWind(lv));
    expect(f.wind.u10).toBe(WIND_10M[lv]!);
    expect(f.layers).toEqual([]);
  }
  expect(presetWeather("fog", 1).visibility).toBeLessThan(1000);
  expect(presetWeather("storm", 1).rain).toBe(1);
});

test("a draw: the same place and day, the same weather; another day, another; Mars fair or dusty", () => {
  const a = randomWeather("earth", 48.96, 2.44, 9800, 1);
  // (the same day: the same weather — its direction turning slowly with the hour, as the fair wind's)
  const b = randomWeather("earth", 48.96, 2.44, 9800.4, 1);
  expect({ ...b, wind: { ...b.wind, from: 0 } }).toEqual({ ...a, wind: { ...a.wind, from: 0 } });
  expect(Math.abs(((b.wind.from! - a.wind.from! + 540) % 360) - 180)).toBeLessThan(30);
  // (weather systems, not a patchwork: a place's neighbour 1° away mostly the same)
  let same = 0;
  for (let la = -60; la <= 60; la += 6)
    for (let lo = -180; lo < 180; lo += 12)
      same += randomWeather("earth", la, lo, 9800, 1).kind === randomWeather("earth", la + 1, lo + 1, 9800, 1).kind ? 1 : 0;
  expect(same / (21 * 30)).toBeGreaterThan(0.75);
  const kinds = new Set<string>();
  for (let d = 0; d < 200; d++) kinds.add(randomWeather("earth", 48.96, 2.44, 9800 + d, 1).kind);
  expect(kinds.size).toBeGreaterThanOrEqual(5);
  for (let d = 0; d < 100; d++) expect(["fair", "dust"]).toContain(randomWeather("mars", 18.4, 77.5, d, 1).kind);
  expect(weatherAt({ weather: "random", wind: 1 }, { body: "earth", lat: 48.96, lon: 2.44 }, 9800)).toEqual(a);
  // (the real weather not come in: fair)
  expect(weatherAt({ weather: "real", wind: 2 }, { body: "earth", lat: 0, lon: 0 }, 0).kind).toBe("fair");
});

test("the wind flown: a storm's stronger than fair's, a fixed direction kept, the shear growing to 300 m", () => {
  const mean = (spec: ReturnType<typeof fairWind>, h: number) => {
    const w = new Weather(3);
    let e = 0,
      n = 0;
    for (let i = 0; i < 4000; i++) {
      const v = w.step(spec, h, 35, -118, 1000, 80, 0.05);
      e += v[0];
      n += v[1];
    }
    return [e / 4000, n / 4000];
  };
  const fair = mean(fairWind(1), 100);
  const storm = mean(presetWeather("storm", 1).wind, 100);
  expect(Math.hypot(...storm)).toBeGreaterThan(2 * Math.hypot(...fair));
  // (from the north, 270°… — blowing from 0°: towards the south, its north component negative)
  const north = mean({ ...presetWeather("windy", 1).wind, from: 0 }, 100);
  expect(north[1]!).toBeLessThan(-10);
  expect(Math.abs(north[0]!)).toBeLessThan(2);
  const lo = mean({ u10: 5, from: 90, gust: 0, turb: 0, shear: 6 }, 20);
  const hi = mean({ u10: 5, from: 90, gust: 0, turb: 0, shear: 6 }, 300);
  expect(Math.hypot(...hi) - Math.hypot(...lo)).toBeGreaterThan(5);
});

test("the ceiling and the flight category as the charts have them; the wind's direction in effect", () => {
  expect(coverWord(0.2)).toBe("FEW");
  expect(coverWord(0.45)).toBe("SCT");
  expect(coverWord(0.75)).toBe("BKN");
  expect(coverWord(1)).toBe("OVC");
  expect(ceilingOf(presetWeather("fair", 1))).toBeNull();
  expect(ceilingOf(presetWeather("cloudy", 1))).toBeNull();
  expect(ceilingOf(presetWeather("overcast", 1))).toBe(600);
  expect(flightCategory(presetWeather("fair", 1))).toBe("VFR");
  expect(flightCategory(presetWeather("overcast", 1))).toBe("MVFR");
  expect(flightCategory(presetWeather("rain", 1))).toBe("IFR");
  expect(flightCategory(presetWeather("fog", 1))).toBe("LIFR");
  const w = { ...presetWeather("windy", 1), wind: { ...presetWeather("windy", 1).wind, from: 300 } };
  expect(windFromAt(w, { lat: 0, lon: 0 }, 0)).toBe(300);
  const f = windFromAt(presetWeather("fair", 1), { lat: 48, lon: 2 }, 9800);
  expect(f).toBeGreaterThanOrEqual(0);
  expect(f).toBeLessThan(360);
});

describe("the weather as the tracer reads it (W3)", () => {
  test("fair weather, or the camera above 30 km: nothing — the image as before", () => {
    expect(weatherGpu(presetWeather("fair", 1), 0, 0.01)).toEqual({ params: new Array(16).fill(0), light: 1 });
    expect(weatherGpu(presetWeather("overcast", 1), 0, 31).params.every((x) => x === 0)).toBe(true);
  });
  test("overcast at an airfield 100 m high: its layers above the sea, lowest first; the haze its visibility's", () => {
    const g = weatherGpu(presetWeather("overcast", 1), 100, 0.11);
    expect(g.params[0]).toBe(1);
    // (Koschmieder: 12 km's extinction less the air's own)
    expect(g.params[1]).toBeCloseTo(3.912 / 12e3 - 3.5e-5, 8);
    expect(g.params.slice(4, 8)).toEqual([700, 2100, 0.95, layerTau({ base: 600, top: 2000, cover: 0.95 })]);
    expect(g.params.slice(8, 11)).toEqual([4100, 5600, 0.5]);
    expect(g.params.slice(12)).toEqual([0, 0, 0, 0]);
    // (under two decks: a fifth of the daylight, the meter opening ~2.3 stops)
    expect(g.light).toBeGreaterThan(0.15);
    expect(g.light).toBeLessThan(0.3);
  });
  test("fog: its extinction and top; above every deck, the full daylight; a storm, no darker than 1/20", () => {
    const f = weatherGpu(presetWeather("fog", 1), 0, 0.01);
    expect(f.params[2]).toBeCloseTo(3.912 / 300, 6);
    expect(f.params[3]).toBe(120);
    expect(f.light).toBeLessThan(0.5);
    expect(weatherGpu(presetWeather("cloudy", 1), 0, 8).light).toBe(1);
    expect(weatherGpu(presetWeather("storm", 1), 0, 0).light).toBeGreaterThanOrEqual(0.05);
    // (the weight fades from 15 to 30 km)
    expect(weatherGpu(presetWeather("cloudy", 1), 0, 22.5).params[0]).toBeCloseTo(0.5, 6);
  });
  test("optical thickness: ~25 per 1.5 km, held between 8 and 150", () => {
    expect(layerTau({ base: 0, top: 1500, cover: 1 })).toBe(25);
    expect(layerTau({ base: 0, top: 100, cover: 1 })).toBe(8);
    expect(layerTau({ base: 400, top: 9000, cover: 1 })).toBeCloseTo(143.3, 1);
  });
});

test("Mars: no rain (its air too thin and cold), its dust storms", () => {
  const m = { body: "mars", lat: 18.4, lon: 77.5 };
  expect(weatherAt({ weather: "rain", wind: 1 }, m, 3).rain).toBe(0);
  expect(weatherAt({ weather: "storm", wind: 1 }, m, 3).rain).toBe(0);
  expect(weatherAt({ weather: "dust", wind: 1 }, m, 3).dust).toBe(1);
  expect(weatherAt({ weather: "rain", wind: 1 }, { ...m, body: "earth" }, 3).rain).toBeCloseTo(0.6, 6);
});
