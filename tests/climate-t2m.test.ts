import { expect, test } from "bun:test";
import { climateT2m } from "../src/weather";

// Q8 C8: the climatology's air at 2 m that picks snow or rain when no report nor model gives one — plausible figures: Paris
// ~4 °C in January and ~20 °C in July, the equator ~28 °C all year, the seasons swapped in the south.

const day = (iso: string) => (Date.parse(iso) - Date.parse("2000-01-01T12:00:00Z")) / 86400000;
test("plausible: mid-latitudes' winter and summer, the equator flat, the south swapped", () => {
  const jan = climateT2m(48.85, day("2026-01-20T12:00:00Z"));
  const jul = climateT2m(48.85, day("2026-07-20T12:00:00Z"));
  expect(jan).toBeGreaterThan(-6);
  expect(jan).toBeLessThan(8);
  expect(jul).toBeGreaterThan(15);
  expect(jul).toBeLessThan(28);
  expect(Math.abs(climateT2m(0, day("2026-01-20T12:00:00Z")) - climateT2m(0, day("2026-07-20T12:00:00Z")))).toBeLessThan(0.5);
  expect(climateT2m(-45, day("2026-07-20T12:00:00Z"))).toBeLessThan(climateT2m(-45, day("2026-01-20T12:00:00Z")));
  // (Helsinki-like 60° N in January: under freezing)
  expect(climateT2m(60, day("2026-01-20T12:00:00Z"))).toBeLessThan(0);
});
