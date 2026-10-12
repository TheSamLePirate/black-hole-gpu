import { expect, test } from "bun:test";
import { azimuthDeg, compassPoint, fmtLatLon, greatCircle, localAxes } from "../src/game/geo";

test("the local north and east: on the equator at lon 0, north is +z and east +y", () => {
  const { east, north } = localAxes([1, 0, 0]);
  expect(east.map((v) => Math.round(v))).toEqual([0, 1, 0]);
  expect(north.map((v) => Math.round(v))).toEqual([0, 0, 1]);
});

test("azimuths: north 0, east 90, south 180, west 270; at a pole still defined", () => {
  expect(azimuthDeg([1, 0, 0], [0, 0, 1])).toBeCloseTo(0, 9);
  expect(azimuthDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 9);
  expect(azimuthDeg([1, 0, 0], [0, 0, -1])).toBeCloseTo(180, 9);
  expect(azimuthDeg([1, 0, 0], [0, -1, 0])).toBeCloseTo(270, 9);
  expect(Number.isFinite(azimuthDeg([0, 0, 1], [1, 0, 0]))).toBe(true);
});

test("great circles: Paris → New York about 5 837 km, bearing about 292°; a quarter meridian", () => {
  const p = greatCircle(48.8566, 2.3522, 40.7128, -74.006, 6_371_000);
  expect(p.dist / 1000).toBeGreaterThan(5800);
  expect(p.dist / 1000).toBeLessThan(5870);
  expect(p.bearingDeg).toBeGreaterThan(285);
  expect(p.bearingDeg).toBeLessThan(300);
  const q = greatCircle(0, 0, 90, 0, 1);
  expect(q.dist).toBeCloseTo(Math.PI / 2, 9);
  expect(q.bearingDeg).toBeCloseTo(0, 9);
  expect(greatCircle(0, 0, 0, 10, 1).bearingDeg).toBeCloseTo(90, 9);
});

test("a place written, the longitude wrapped; the compass points", () => {
  expect(fmtLatLon(48.8566, 2.3522)).toBe("48.8566° N 2.3522° E");
  expect(fmtLatLon(-33.86, 190, 2)).toBe("33.86° S 170.00° W");
  expect(compassPoint(0)).toBe("N");
  expect(compassPoint(44)).toBe("NE");
  expect(compassPoint(359)).toBe("N");
  expect(compassPoint(225)).toBe("SW");
});
