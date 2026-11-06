import { afterAll, expect, test } from "bun:test";
import { kpFor, parseKp, setKpReading } from "../src/system/space-weather";

// The real Kp for the auroras (src/system/space-weather.ts — AM1): NOAA's 2026 objects and the older table both read, any other
// format refused; the live value used within 3 h of now and under 12 h old, the setting otherwise.

afterAll(() => setKpReading(null));

test("the feed: the 2026 objects and the older table, the last valid value; anything else refused", () => {
  const now2026 = [
    { time_tag: "2026-11-06T00:00:00", Kp: 2.33, a_running: 9, station_count: 8 },
    { time_tag: "2026-11-06T03:00:00", Kp: 4.67, a_running: 39, station_count: 8 },
    { time_tag: "2026-11-06T06:00:00", Kp: null, a_running: null, station_count: 0 },
  ];
  expect(parseKp(now2026)).toEqual({ kp: 4.67, at: Date.UTC(2026, 10, 6, 3) });
  const old = [
    ["time_tag", "Kp", "a_running", "station_count"],
    ["2024-05-10 18:00:00.000", "8.67", "300", "8"],
  ];
  expect(parseKp(old)?.kp).toBeCloseTo(8.67, 6);
  expect(parseKp({ kp: 3 })).toBeNull();
  expect(
    parseKp([
      ["when", "index"],
      ["x", 3],
    ]),
  ).toBeNull();
  expect(parseKp([{ time_tag: "2026-11-06T00:00:00", Kp: 12 }])).toBeNull();
});

test("the live Kp within 3 h of now and under 12 h old; the setting otherwise", () => {
  const now = Date.UTC(2026, 10, 6, 7);
  setKpReading({ kp: 6.33, at: Date.UTC(2026, 10, 6, 3) });
  expect(kpFor(now - 3_600_000, 2, true, now)).toMatchObject({ kp: 6.33, source: "live" });
  expect(kpFor(now - 5 * 3_600_000, 2, true, now)).toEqual({ kp: 2, source: "setting" });
  expect(kpFor(now, 2, false, now)).toEqual({ kp: 2, source: "setting" });
  setKpReading({ kp: 6.33, at: now - 13 * 3_600_000 });
  expect(kpFor(now, 2, true, now)).toEqual({ kp: 2, source: "setting" });
});
