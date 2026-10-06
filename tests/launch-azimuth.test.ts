import { expect, test } from "bun:test";
import { launchEast } from "../src/controller/lowthrust";
import { spinAxis } from "../src/controller/util";
import { cross, dot, sub } from "../src/math/vec3";
import { ourState } from "../src/system/our-side";
import { bodyFixedOf, figureUp, fromBodyFixed } from "../src/system/our-surface";
import type { Vec3 } from "../src/physics";

// The take-off's launch azimuth (sin az = cos i / cos φ) holds for the geocentric latitude: the orbit's
// plane passes through the Earth's centre. From Kennedy (28.57° N geodetic) the heading for the ISS's
// 51.6° must give an orbit of 51.6°; the figure's geodetic up gives one about 0.08° off.

const unit = (v: Vec3) => v.map((x) => x / Math.hypot(...v)) as Vec3;
const deg = (a: Vec3, b: Vec3) => (Math.acos(dot(unit(a), unit(b))) * 180) / Math.PI;

test("the launch heading from Kennedy flies into a 51.6° orbit", () => {
  const t = 1000;
  const X = fromBodyFixed("earth", bodyFixedOf("earth", 28.5729, -80.649), t);
  const rel = sub(X, ourState("earth", t).pos);
  const pole = spinAxis("earth");
  const inclination = (from: Vec3) => deg(cross(unit(rel), launchEast("earth", from, 51.6)), pole);
  expect(inclination(rel)).toBeCloseTo(51.6, 9);
  // (the geodetic up, as the landing autopilot once passed it: the orbit comes out flatter)
  expect(Math.abs(inclination(figureUp("earth", X, t)) - 51.6)).toBeGreaterThan(0.05);
});
