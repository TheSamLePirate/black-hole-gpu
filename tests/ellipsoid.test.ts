import { expect, test } from "bun:test";
import { cartToGeodetic, figureDiskShare, geodeticDir, geodeticToCart, squashedHeight, WGS84_A, WGS84_F } from "../src/system/ellipsoid";

// The WGS84 ellipsoid (phase 2): geodetic ↔ Cartesian both ways, the poles 21 km in, the tracer's
// squashed-space height equal to the geodetic one near the ground (the ground drawn and the ground felt).

const A = WGS84_A,
  F = WGS84_F;
const D = Math.PI / 180;

test("the figure: a at the equator, b = a(1 − f) at the poles", () => {
  expect(geodeticToCart(A, F, 0, 0, 0)[0]).toBeCloseTo(6378137, 6);
  expect(geodeticToCart(A, F, 90 * D, 0, 0)[2]).toBeCloseTo(6356752.314245, 5);
});

test("the very centre: under the poles, b below them, and no source seen — not NaN", () => {
  expect(cartToGeodetic(A, F, [0, 0, 0])).toEqual({ lat: 90 * D, lon: 0, h: -A * (1 - F) });
  expect(cartToGeodetic(A, 0, [0, 0, 0]).h).toBe(-A);
  expect(figureDiskShare([0, 0, 0], [0, 0, 1], 0.0047, A, F)).toBe(0);
});

test("geodetic → Cartesian → geodetic: back to the millimetre, from the ground to the Moon's distance", () => {
  for (const lat of [-89.9, -60, -35, 0, 12.5, 34.905, 45, 80, 90])
    for (const h of [-400, 0, 700, 8848, 120e3, 400e3, 36e6, 384e6]) {
      const g = cartToGeodetic(A, F, geodeticToCart(A, F, lat * D, -117.9 * D, h));
      expect(Math.abs(g.lat - lat * D) * A).toBeLessThan(1e-3);
      expect(Math.abs(g.h - h)).toBeLessThan(1e-3);
    }
});

test("over the poles too: centimetres off the axis, the height the pole's to the micrometre", () => {
  // (a point at r, d radians from the axis: its height the pole's, less ~2·10⁴ d² m — the figure's curvature)
  for (const r of [A * (1 - F), A * (1 - F) + 106.4e3, A + 400e3])
    for (const d of [1e-9, 1e-8, 3e-8, 1e-7]) {
      const pole = cartToGeodetic(A, F, [0, 0, r]).h;
      expect(Math.abs(cartToGeodetic(A, F, [r * Math.sin(d), 0, r * Math.cos(d)]).h - pole)).toBeLessThan(1e-6);
    }
});

test("the squashed height: the geodetic height to 6 cm within 10 km of the ground; the geodetic direction on the ground its latitude", () => {
  for (const lat of [0, 20, 34.905, 45, 70, 89])
    for (const h of [0, 50, 2000, 9000]) {
      const p = geodeticToCart(A, F, lat * D, 1, h);
      const s = squashedHeight(p, A, F);
      expect(Math.abs(s.h - h)).toBeLessThan(0.06);
      // (on the ground, the geodetic direction its latitude; above it, the foot of the squashed radial — as drawn)
      if (h === 0) expect(Math.abs(Math.atan2(s.g[2], Math.hypot(s.g[0], s.g[1])) - lat * D)).toBeLessThan(1e-12);
    }
  // (a sphere: all of it the sphere's)
  expect(geodeticDir([0.6, 0, 0.8], 0)).toEqual([0.6, 0, 0.8]);
});
