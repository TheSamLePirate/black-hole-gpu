import { expect, test } from "bun:test";
import { fromRunway, glideClearance, type IlsRunway, onRunway } from "../src/game/ils";

// The ILS's slope over the relief (game/ils.ts glideClearance — the approaches of Toulon-Hyères, 5 Nov 2026): over a flat
// sea, the slope's own height; a hill on the final under the slope, refused (negative); a low coast near the threshold
// clear of half the slope's height, not thin; a ridge 150 m under the slope 8 km out, thin.

const R: IlsRunway = { name: "T", icao: "TEST", lat: 43, lon: 6, hdg: 50, elev: 2, len: 2000 };
const out = (lat: number, lon: number) => -onRunway(R, { lat, lon, alt: 0 }).along;

test("flat sea: the slope's height over it, at 1 km its least", () => {
  const c = glideClearance(R, () => 0);
  expect(c.atM).toBe(1000);
  expect(c.minM).toBeCloseTo(2 + 1300 * Math.tan((3 * Math.PI) / 180), 0);
  expect(c.thin).toBeFalse();
});

test("a 600 m hill 8 km out on the axis: the slope runs into it", () => {
  const hill = fromRunway(R, -8000, 0);
  const c = glideClearance(R, (lat, lon) => (Math.hypot((lat - hill.lat) * 111_000, (lon - hill.lon) * 81_000) < 800 ? 600 : 0));
  expect(c.minM).toBeLessThan(0);
  expect(c.atM).toBeGreaterThan(7000);
  expect(c.atM).toBeLessThan(9000);
});

test("a 25 m coast 1–2 km out: clear of half the slope's height — not thin", () => {
  const c = glideClearance(R, (lat, lon) => (out(lat, lon) < 2000 ? 25 : 0));
  expect(c.minM).toBeGreaterThan(0);
  expect(c.thin).toBeFalse();
});

test("a ridge 60 m under the slope 8 km out: thin", () => {
  const h = 2 + 8300 * Math.tan((3 * Math.PI) / 180) - 60;
  const c = glideClearance(R, (lat, lon) => (Math.abs(out(lat, lon) - 8000) < 300 ? h : 0));
  expect(c.thin).toBeTrue();
  expect(c.minM).toBeGreaterThan(0);
});
