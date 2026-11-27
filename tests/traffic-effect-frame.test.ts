import { expect, test } from "bun:test";
import { pointInFrame } from "../src/traffic/effect-frame";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import type { Vec3 } from "../src/physics";

test("emissions retain WGS84 positions and offsets under an arbitrary rigid view rotation", () => {
  const lat = (49 * Math.PI) / 180;
  const origin = geodeticToCart(WGS84_A, WGS84_F, lat, 0, 100);
  const up: Vec3 = [Math.cos(lat), 0, Math.sin(lat)];
  const north: Vec3 = [-Math.sin(lat), 0, Math.cos(lat)];
  const basis: Vec3[] = [
    [0, north[0], up[0]],
    [1, 0, 0],
    [0, north[2], up[2]],
  ];
  const p = origin.map((v, k) => v + north[k]! * 8000 + up[k]! * 17);
  const q = pointInFrame(p, origin, [0, 0, 0], basis);
  expect(q[0]).toBeCloseTo(0, 6);
  expect(q[1]).toBeCloseTo(8000, 6);
  expect(q[2]).toBeCloseTo(17, 6);
  // Historical radial ENU disagreed with the ellipsoid normal by ~26 m here.
  const r = Math.hypot(...origin);
  const radialHeight = p.reduce((a, v, k) => a + ((v - origin[k]!) * origin[k]!) / r, 0);
  expect(Math.abs(radialHeight - q[2])).toBeGreaterThan(20);
});
