import { expect, test } from "bun:test";
import { dayCloudsFor, dayCloudsUrl } from "../src/system/day-clouds";

// PLAN-CIEL C2: the clouds of the day — which satellites' mosaic stands for the game's date, and where it is.

const NOW = Date.UTC(2026, 9, 10, 9);

test("the layer by the date: VIIRS NOAA-20, Suomi NPP, MODIS Terra; none before 2000 nor ahead of today", () => {
  expect(dayCloudsFor(Date.UTC(2026, 7, 12, 18), NOW)).toEqual({
    day: Date.UTC(2026, 7, 12),
    layer: "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
    date: "2026-08-12",
  });
  expect(dayCloudsFor(Date.UTC(2017, 7, 21, 18), NOW)!.layer).toBe("VIIRS_SNPP_CorrectedReflectance_TrueColor");
  expect(dayCloudsFor(Date.UTC(2006, 2, 29, 10), NOW)!.layer).toBe("MODIS_Terra_CorrectedReflectance_TrueColor");
  expect(dayCloudsFor(Date.UTC(1999, 7, 11, 10), NOW)).toBeNull();
  expect(dayCloudsFor(Date.UTC(2067, 0, 1), NOW)).toBeNull();
  expect(dayCloudsFor(NOW + 86400e3, NOW)).toBeNull();
  // (today not yet whole: yesterday's mosaic)
  expect(dayCloudsFor(NOW, NOW)!.date).toBe("2026-10-09");
});

test("the whole globe in one image (GIBS's WMS)", () => {
  const u = dayCloudsUrl("VIIRS_NOAA20_CorrectedReflectance_TrueColor", "2026-08-12");
  expect(u).toStartWith("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?");
  expect(u).toContain("BBOX=-90,-180,90,180");
  expect(u).toContain("WIDTH=4096&HEIGHT=2048");
  expect(u).toContain("TIME=2026-08-12");
});

test("(Q5 C5) the two days the game's time falls between, each region seen near 13:30 local solar time", async () => {
  const { dayCloudsPair, dayMixAt } = await import("../src/system/day-clouds");
  const now = Date.parse("2026-11-04T12:00:00Z");
  // (the evening of 1 November: that day's mosaic and the next's, the time 19 h after the first's 0 h)
  const p = dayCloudsPair(Date.parse("2026-11-01T19:00:00Z"), now)!;
  expect(p.a.date).toBe("2026-11-01");
  expect(p.b!.date).toBe("2026-11-02");
  expect(p.hours).toBeCloseTo(19, 9);
  // (at Greenwich the pass at 13:30 UTC: 5.5 h later, 23 % of the way to the next one; at 90° E — passed at 7:30 UTC — 48 %)
  expect(dayMixAt(19, 0)).toBeCloseTo(5.5 / 24, 9);
  expect(dayMixAt(19, 90)).toBeCloseTo(11.5 / 24, 9);
  // (before the pass, the first day's alone; a day after it, the next's)
  expect(dayMixAt(10, 0)).toBe(0);
  expect(dayMixAt(40, 0)).toBe(1);
  // (yesterday's: the next — today's — not out yet)
  expect(dayCloudsPair(Date.parse("2026-11-03T19:00:00Z"), now)!.b).toBeNull();
});
