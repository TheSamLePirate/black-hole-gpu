import { expect, test } from "bun:test";
import { blendWeather, presetWeather, WEATHER_FADE_S, weatherFadeCut, weatherHere, type WeatherState } from "../src/weather";

// PLAN-J6 J6-2: the real weather's source arriving in flight faded in over WEATHER_FADE_S (weather.ts weatherHere) — not a setting
// chosen nor a placement, which take effect at once.
const place = { body: "earth", lat: 43.1, lon: 6.1 };
const metar: WeatherState = {
  ...presetWeather("rain", 1),
  source: "metar",
  wind: { u10: 9.3, from: 250, gust: 14.4, turb: 1, shear: 0 },
  visibility: 2500,
  report: "LFTH",
};
const real = { weather: "real" as const, wind: 1 as const };

test("a source arriving with the real weather chosen: faded in over its length, the wind and the visibility between", () => {
  weatherFadeCut();
  weatherHere({ weather: "fair", wind: 1 }, place, 0, null, 0);
  // (real chosen, the source not yet in: the fair weather it stands in for, at once)
  const before = weatherHere(real, place, 0, null, 1);
  expect(before.visibility).toBe(presetWeather("fair", 1).visibility);
  // (the source arrives at 2 s)
  const at = weatherHere(real, place, 0, metar, 2);
  expect(at.wind.u10).toBeCloseTo(before.wind.u10, 6);
  const mid = weatherHere(real, place, 0, metar, 2 + WEATHER_FADE_S / 2);
  expect(mid.wind.u10).toBeCloseTo((before.wind.u10 + 9.3) / 2, 6);
  expect(mid.visibility).toBeLessThan(before.visibility);
  expect(mid.visibility).toBeGreaterThan(2500);
  expect(mid.rain).toBeGreaterThan(0);
  expect(mid.rain).toBeLessThan(metar.rain);
  const end = weatherHere(real, place, 0, metar, 2 + WEATHER_FADE_S);
  expect(end).toEqual(metar);
});

test("a setting chosen or a placement: at once", () => {
  weatherFadeCut();
  weatherHere(real, place, 0, metar, 0);
  // (a preset chosen: no fade)
  expect(weatherHere({ weather: "storm", wind: 1 }, place, 0, metar, 1).kind).toBe("storm");
  // (back to real, a new report arrives, then a placement cuts the fade)
  weatherHere(real, place, 0, metar, 2);
  const next = { ...metar, visibility: 800 };
  expect(weatherHere(real, place, 0, next, 3).visibility).toBeCloseTo(2500, 3);
  weatherFadeCut();
  expect(weatherHere(real, place, 0, next, 3.1).visibility).toBe(800);
});

test("blendWeather: the wind's direction the short way round, a missing layer at no cover", () => {
  const a = { ...metar, wind: { ...metar.wind, from: 350 }, layers: [] };
  const b = { ...metar, wind: { ...metar.wind, from: 10 }, layers: [{ base: 200, top: 600, cover: 1 }] };
  const h = blendWeather(a, b, 0.5);
  expect(h.wind.from).toBeCloseTo(0, 6);
  expect(h.layers[0]!.cover).toBeCloseTo(0.5, 6);
  expect(h.layers[0]!.base).toBe(200);
});
