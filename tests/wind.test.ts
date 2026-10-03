import { expect, test } from "bun:test";
import { dryden, meanWindSpeed, Weather, WIND_10M, windFrom } from "../src/wind";

// The wind (phase 2): its mean profile with the height, the Dryden turbulence's intensities and
// scales, a field the same each time a flight is flown, its statistics as asked.

test("the mean wind: the level's at 10 m, stronger aloft to a jet at 11 km, nothing past 30 km; calm is calm", () => {
  expect(meanWindSpeed(1, 10)).toBeCloseTo(WIND_10M[1]!, 9);
  expect(meanWindSpeed(2, 100)).toBeGreaterThan(meanWindSpeed(2, 10));
  expect(meanWindSpeed(2, 11e3)).toBeCloseTo(3 * WIND_10M[2]!, 6);
  expect(meanWindSpeed(3, 31e3)).toBe(0);
  expect(meanWindSpeed(0, 500)).toBe(0);
});

test("Dryden, low: the vertical intensity a tenth of the wind at 6 m, its scale the height", () => {
  const d = dryden(100, 5, 1);
  expect(d.sw).toBeCloseTo(0.5, 9);
  expect(d.Lw).toBeCloseTo(100, 6);
  expect(d.su).toBeGreaterThan(d.sw);
});

test("the same seed, the same weather", () => {
  const a = new Weather(42),
    b = new Weather(42);
  for (let i = 0; i < 500; i++) expect(a.step(2, 300, 35, -118, 1000, 120, 0.02)).toEqual(b.step(2, 300, 35, -118, 1000, 120, 0.02));
});

test("flown through: the mean is the mean wind, the spread the Dryden intensity", () => {
  const w = new Weather(7);
  const h = 300;
  let sx = 0,
    sxx = 0,
    sz = 0,
    szz = 0,
    n = 0;
  const from = windFrom(35, -118, 1000);
  const to = from + Math.PI;
  for (let i = 0; i < 200000; i++) {
    const v = w.step(1, h, 35, -118, 1000, 100, 0.02);
    // (along the wind: its east and north parts projected)
    const along = v[0] * Math.sin(to) + v[1] * Math.cos(to);
    sx += along;
    sxx += along * along;
    sz += v[2];
    szz += v[2] * v[2];
    n++;
  }
  const mean = sx / n,
    sdz = Math.sqrt(szz / n - (sz / n) ** 2);
  expect(Math.abs(mean - meanWindSpeed(1, h))).toBeLessThan(0.4);
  const D = dryden(h, meanWindSpeed(1, 6), 1);
  expect(sdz / D.sw).toBeGreaterThan(0.8);
  expect(sdz / D.sw).toBeLessThan(1.2);
  expect(Math.sqrt(sxx / n - mean * mean)).toBeGreaterThan(0.5 * D.su);
});
