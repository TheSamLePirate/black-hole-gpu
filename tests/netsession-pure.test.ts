import { expect, test } from "bun:test";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { formatAge, keplerOf, parkedAt, pertOf, steady } from "../src/ui/netsession-pure";

// The network session's pure decisions (audit 2026-11-10, QA-10: ui/netsession.ts was imported by no test) — taken out to
// ui/netsession-pure.ts and tested here.

const D = Math.PI / 180;
type V3 = [number, number, number];

test("a parked craft's place and heading over WGS84: its nose east 90°, north 0°", () => {
  const lat = 43.1,
    lon = 6.15;
  const p = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, 0) as V3;
  const east: V3 = [-Math.sin(lon * D), Math.cos(lon * D), 0];
  // (the geodetic north: the meridian's tangent at the geodetic latitude)
  const north: V3 = [-Math.sin(lat * D) * Math.cos(lon * D), -Math.sin(lat * D) * Math.sin(lon * D), Math.cos(lat * D)];
  const e = parkedAt(p, east);
  expect(e.lat).toBeCloseTo(lat, 6);
  expect(e.lon).toBeCloseTo(lon, 6);
  expect(e.heading).toBeCloseTo(90, 6);
  expect(parkedAt(p, north).heading % 360).toBeCloseTo(0, 6);
  expect(parkedAt(p, [-east[0], -east[1], -east[2]]).heading).toBeCloseTo(270, 6);
});

test("another's last three samples: following one another — steady; a jump, a gap, too few — not", () => {
  const S = (jump = 0, gap = 0.1) =>
    [0, 1, 2].map((i) => ({ t: i * gap, p: [100 * i * gap + (i === 2 ? jump : 0), 0, 0], v: [100, 0, 0] }));
  expect(steady(S())).toBe(true);
  expect(steady(S(80))).toBe(false);
  expect(steady(S(0, 2))).toBe(false);
  expect(steady(S().slice(0, 2))).toBe(false);
  expect(steady(undefined)).toBe(false);
});

test("an age said short: minutes, hours and minutes, days", () => {
  expect(formatAge(20)).toBe("1 min");
  expect(formatAge(600)).toBe("10 min");
  expect(formatAge(7380)).toBe("2 h 03");
  expect(formatAge(3 * 86400)).toBe("3 d");
});

test("a coasting craft about the Earth: a circular orbit back where it began after one period; J2's pull, inward at the equator", () => {
  const mu = 3.986004418e14;
  const r = 7_000_000;
  const v = Math.sqrt(mu / r);
  const T = 2 * Math.PI * Math.sqrt(r ** 3 / mu);
  const k = keplerOf(0, [r, 0, 0], [0, v, 0], T)!;
  expect(Math.hypot(k.p[0] - r, k.p[1], k.p[2])).toBeLessThan(r * 2e-3);
  const half = keplerOf(0, [r, 0, 0], [0, v, 0], T / 2)!;
  expect(half.p[0]).toBeCloseTo(-r, -4);
  // (J2 at the equator, 7 000 km: some 0.011 m/s², towards the centre)
  const g = pertOf(0, [r, 0, 0], 0);
  const m = Math.hypot(...g);
  expect(m).toBeGreaterThan(0.005);
  expect(m).toBeLessThan(0.02);
  expect(g[0]).toBeLessThan(0);
  // (no such body: none)
  expect(keplerOf(99, [r, 0, 0], [0, v, 0], 1)).toBeNull();
});
