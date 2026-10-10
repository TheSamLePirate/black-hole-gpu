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
