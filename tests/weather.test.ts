import { expect, test } from "bun:test";
import { fairWind, presetWeather, randomWeather, WEATHER_PRESETS, weatherAt, type WeatherPreset } from "../src/weather";
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
  expect(randomWeather("earth", 48.96, 2.44, 9800.4, 1)).toEqual(a);
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
