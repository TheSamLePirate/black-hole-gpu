// Time scales: the scene's clock is UTC (the date the HUD shows); the ephemerides run on TDB, the
// Earth turns on UT1 (≈ UTC: within 0.9 s). TDB − UTC = (TAI − UTC: the leap seconds, naif0012.tls) +
// 32.184 s + the periodic term (≤ 1.7 ms). Future leap seconds are unknown: the last one holds.

import { LEAP_SECONDS } from "./iau-data";

/** J2000.0 (2000-01-01 12:00 TT) in UTC ms — within a minute: the epoch the angles count from */
export const J2000_MS = Date.UTC(2000, 0, 1, 12);

/** TAI − UTC [s] at a UTC instant [ms] */
export function taiMinusUtc(utcMs: number): number {
  let v = LEAP_SECONDS[0]?.[1] ?? 10;
  for (const [at, s] of LEAP_SECONDS) {
    if (utcMs < at) break;
    v = s;
  }
  return v;
}

/** TDB [s past J2000] at a UTC instant [ms] */
export function tdbOf(utcMs: number): number {
  const tt = (utcMs - J2000_MS) / 1000 + taiMinusUtc(utcMs) + 32.184;
  // (TDB − TT: the Earth's orbit's eccentricity, 1.657 ms at most)
  const g = ((357.53 + 0.98560028 * (tt / 86400)) * Math.PI) / 180;
  return tt + 0.001657 * Math.sin(g + 0.01671 * Math.sin(g));
}
