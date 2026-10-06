import { expect, test } from "bun:test";
import { elements, type V3 } from "../src/game/orbit";
import { equatorAxes, ourOrbitPose } from "../src/game/place";
import { meanCircle } from "../src/game/status";
import { circularVelocity } from "../src/system/geopotential";
import { M_METRES, solarBody, solarState } from "../src/system/solar";

// What the HUD shows of a near-circular orbit: the circle it flies in the mean (the one CIRC aims at, the
// Earth's J2 in) and its swing — not the osculating apsides, which stand ~17 km apart on that very circle.

const earth = solarBody("earth")!;
const kmM = M_METRES / 1e3;
const t = 109.6;

/** The craft at `km` on the mean circle (51.6°), its velocity off it by `dv` [m/s] along the track. */
function onCircle(km: number, dv = 0) {
  const p = ourOrbitPose({ body: "earth", altKm: km, inc: 51.6, nu: 30 }, t);
  const B = solarState("earth", t);
  const r = p.X.map((x, k) => x - B.pos[k]!) as V3;
  const v0 = p.vel.map((x, k) => x - B.vel[k]!) as V3;
  const c = circularVelocity("earth", earth.mass, r, v0, t).v;
  const cl = Math.hypot(...c);
  const v = c.map((x) => x * (1 + dv / 299792458 / cl)) as V3;
  return { r, v };
}

test("a circle as CIRC leaves it: circular in the mean at its height, the J2's swing — its osculating apsides far apart", () => {
  const { r, v } = onCircle(420);
  const m = meanCircle("earth", earth.mass, r, v, t, earth.radius, kmM)!;
  expect(m).not.toBeNull();
  expect(Math.abs(m.km - 420)).toBeLessThan(2);
  expect(m.swingKm).toBeGreaterThan(0.5);
  expect(m.swingKm).toBeLessThan(2);
  const el = elements(earth.mass, r, v, equatorAxes("earth"));
  expect((el.ra - el.rp) * kmM).toBeGreaterThan(5);
});

test("a little off the circle: its mean raised by 2δv/n, its swing grown; an ellipse is no circle", () => {
  const { r, v } = onCircle(420, 5);
  const m = meanCircle("earth", earth.mass, r, v, t, earth.radius, kmM)!;
  // (5 m/s along the track: the mean 2δv/n ≈ 9 km higher, the swing as much more)
  expect(m.km - 420).toBeGreaterThan(7);
  expect(m.km - 420).toBeLessThan(11);
  expect(m.swingKm).toBeGreaterThan(8);
  const e = ourOrbitPose({ body: "earth", peKm: 200, apKm: 600, inc: 51.6 }, t);
  const B = solarState("earth", t);
  const re = e.X.map((x, k) => x - B.pos[k]!) as V3,
    ve = e.vel.map((x, k) => x - B.vel[k]!) as V3;
  expect(meanCircle("earth", earth.mass, re, ve, t, earth.radius, kmM)).toBeNull();
});
