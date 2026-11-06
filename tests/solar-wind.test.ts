import { expect, test } from "bun:test";
import { dynamicPressure, parseSolarWind, setSolarWindRows, shue98, solarWindFor, TYPICAL_WIND } from "../src/system/solar-wind";

// The real solar wind at the Earth (src/system/solar-wind.ts — RECHERCHE-DONNEES § 4.2, AM7): NOAA's propagated 1-hour product
// read (its legacy table, a real copy of 6 Nov 2026; the 2026 object rows), Shue et al. 1998, the three states.

test("NOAA's propagated 1-hour wind (6 Nov 2026 copy): every row read, propagated times ascending, values physical", async () => {
  const j = await Bun.file("tests/fixtures/noaa-propagated-solar-wind-1-hour-2026-11-06.json").json();
  const r = parseSolarWind(j);
  expect(r.length).toBeGreaterThan(30);
  for (let i = 1; i < r.length; i++) expect(r[i]!.t).toBeGreaterThanOrEqual(r[i - 1]!.t);
  for (const x of r) {
    expect(x.n).toBeGreaterThan(0);
    expect(x.v).toBeGreaterThan(200);
  }
});

test("the 2026 object rows (SCN 26-21): proton_density, proton_speed, bz_gsm; inactive sources and nulls left out", () => {
  const r = parseSolarWind([
    { time_tag: "2026-11-06T05:35:00", active: true, proton_density: 5.07, proton_speed: 344.09, bz_gsm: -2 },
    { time_tag: "2026-11-06T05:36:00", active: false, proton_density: 9, proton_speed: 500, bz_gsm: 1 },
    { time_tag: "2026-11-06T05:37:00", active: true, proton_density: null, proton_speed: 344, bz_gsm: 0 },
  ]);
  expect(r.length).toBe(1);
  expect(r[0]!.bz).toBe(-2);
  expect(r[0]!.t).toBe(Date.parse("2026-11-06T05:35:00Z"));
});

test("Shue 1998: Pd 2 nPa, Bz 0 → r0 10.25 R_E, α 0.590; a southward Bz brings the nose in; a strong pressure too", () => {
  const s = shue98(2, 0);
  expect(s.r0).toBeCloseTo(10.25, 1);
  expect(s.alpha).toBeCloseTo(0.5897, 3);
  expect(shue98(2, -10).r0).toBeLessThan(s.r0 - 1);
  expect(shue98(20, 0).r0).toBeLessThan(7.5);
  expect(dynamicPressure(5, 400)).toBeCloseTo(1.338, 2);
});

test("the three states: typical without data; live near now; stale for a scene far from now", () => {
  setSolarWindRows([]);
  // (a scene far from now: no fetch asked)
  expect(solarWindFor(0, Date.now())).toBe(TYPICAL_WIND);
  const now = Date.parse("2026-11-06T06:00:00Z");
  setSolarWindRows([
    { t: now - 30 * 60_000, n: 3.2, v: 324, bz: 0.5 },
    { t: now + 20 * 60_000, n: 10, v: 600, bz: -8 },
  ]);
  const live = solarWindFor(now + 25 * 60_000, now);
  expect(live.source).toBe("live");
  expect(live.bz).toBe(-8);
  expect(solarWindFor(now - 10 * 24 * 3600_000, now).source).toBe("stale");
  setSolarWindRows([]);
});
