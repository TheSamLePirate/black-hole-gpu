import { expect, test } from "bun:test";
import { AerosolFeed, aerosolCell, aerosolUrl, aodAt, AOD_DEFAULT, parseAerosols } from "../src/system/aerosols";
import { lutThrough, opticalDepthExact, transmittanceLut } from "../src/system/earth-air";
import { EARTH_RM } from "../src/terrain";

// Q5 C3 — the day's aerosols (system/aerosols.ts): CAMS's optical depth at 550 nm through Open-Meteo's air-quality API, and the
// air's tables built for it (earth-air.ts: the aerosols' extinction scaled)
const json = {
  hourly: {
    time: ["2026-07-10T00:00", "2026-07-10T01:00", "2026-07-10T02:00"],
    aerosol_optical_depth: [0.1, 0.3, null],
  },
};

test("the request: CAMS's 0.4° cell, one UTC day; none before August 2022 nor past a week ahead", () => {
  expect(aerosolCell(45.92, 6.87)).toEqual({ lat: 46, lon: 6.8 });
  const now = Date.parse("2026-07-10T12:00:00Z");
  const url = aerosolUrl(46, 6.8, Date.parse("2026-07-10T18:40:00Z"), now)!;
  expect(url).toContain("air-quality-api.open-meteo.com/v1/air-quality");
  expect(url).toContain("hourly=aerosol_optical_depth");
  expect(url).toContain("start_date=2026-07-10&end_date=2026-07-10");
  expect(aerosolUrl(46, 6.8, Date.parse("2021-01-01T00:00:00Z"), now)).toBeNull();
  expect(aerosolUrl(46, 6.8, now + 9 * 86400e3, now)).toBeNull();
});

test("the hours read, the missing left out; between two hours the optical depth interpolated", () => {
  const h = parseAerosols(json)!;
  expect(h.length).toBe(2);
  expect(aodAt(h, Date.parse("2026-07-10T00:30:00Z"))).toBeCloseTo(0.2, 6);
  expect(aodAt(h, Date.parse("2026-07-10T02:30:00Z"))).toBeCloseTo(0.3, 6);
  expect(aodAt(h, Date.parse("2026-07-10T09:00:00Z"))).toBeNull();
  expect(parseAerosols({})).toBeNull();
});

test("the feed: asked once, the day kept; a failure tried again after five minutes", async () => {
  let asked = 0,
    now = Date.parse("2026-07-10T12:00:00Z");
  const feed = new AerosolFeed(
    async () => {
      asked++;
      return json;
    },
    () => now,
  );
  const ms = Date.parse("2026-07-10T00:30:00Z");
  expect(feed.peek(46, 6.8, ms)).toBeNull();
  await new Promise((r) => setTimeout(r, 0));
  expect(feed.peek(46, 6.8, ms)).toBeCloseTo(0.2, 6);
  expect(asked).toBe(1);
  const bad = new AerosolFeed(
    async () => {
      asked++;
      throw new Error("503");
    },
    () => now,
  );
  expect(bad.peek(46, 6.8, ms)).toBeNull();
  await new Promise((r) => setTimeout(r, 0));
  expect(bad.peek(46, 6.8, ms)).toBeNull();
  expect(asked).toBe(2);
  now += 6 * 60e3;
  bad.peek(46, 6.8, ms);
  expect(asked).toBe(3);
});

test("a hazy day's air (τ 0.3, ×10.7 an ordinary day's): the tables built for it, the low Sun dimmer, within 1 % of the integral", () => {
  const k = 0.3 / AOD_DEFAULT;
  const hazy = transmittanceLut(k);
  const plain = transmittanceLut(1);
  const mu = Math.sin((5 * Math.PI) / 180);
  const e = Math.exp(-opticalDepthExact(EARTH_RM, mu, 4000, k)[1]!);
  expect(Math.abs(lutThrough(hazy, 0, mu)[1]! / e - 1)).toBeLessThan(0.01);
  expect(lutThrough(hazy, 0, mu)[1]!).toBeLessThan(lutThrough(plain, 0, mu)[1]! * 0.2);
});
