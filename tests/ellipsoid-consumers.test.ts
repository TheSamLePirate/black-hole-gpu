import { expect, test } from "bun:test";
import {
  cartToGeodetic,
  figureDiskShare,
  geodeticNormal,
  geodeticToCart,
  radiusAtHeight,
  rayFigure,
  WGS84_A as A,
  WGS84_F as F,
} from "../src/system/ellipsoid";
import { bodyFixedOf, bodyMapDirection, figureUp, fromBodyFixed, toBodyFixed } from "../src/system/our-surface";
import { bodyGround } from "../src/system/our-side";
import { patchGeodetic } from "../src/system/local-patch";
import { bodyAxes, M_METRES, solarBody } from "../src/system/solar";
import { envOf } from "../src/entry-env";
import { attitudeFor } from "../src/entry";
import { classify, elements, minimumOrbitHeight, orbitClearsHeight, orbitExtreme, stateFrom } from "../src/game/orbit";
import { EARTH_RUNWAYS, runwayWeight } from "../src/game/sites";
import { cross, dot, len, scale, type Vec3 } from "../src/math/vec3";

const D = Math.PI / 180;

test("the map keeps latitude and longitude in M, at ground level and ISS altitude, on every solid world", () => {
  for (const id of ["earth", "moon", "mars"])
    for (const lat of [-90, -80, -45, 0, 28.615, 42.34, 45, 80, 90])
      for (const lon of [-179.9, -3.7, 120])
        for (const h of [0, 900, 400e3]) {
          const map = bodyMapDirection(id, bodyFixedOf(id, lat, lon, h));
          const expected = geodeticNormal(1, 0, geodeticToCart(1, 0, lat * D, lon * D, 0));
          expect(len(map.map((v, i) => v - expected[i]!) as Vec3)).toBeLessThan(1e-10);
        }
});

test("patch altitude and solar zenith use physical coordinates, regardless of camera frame", () => {
  const axes: [Vec3, Vec3, Vec3] = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ];
  for (const lat of [-90, -45, 0, 42.34, 45, 90])
    for (const h of [0, 15e3, 30e3, 40e3, 60e3, 400e3]) {
      const q = geodeticToCart(1, F, lat * D, 0.3, h / A);
      const centre = [0, 1, 2].map((i) => -(q[0] * axes[0][i]! + q[1] * axes[1][i]! + q[2] * axes[2][i]!)) as Vec3;
      const place = patchGeodetic({ centre, axes }, F);
      expect(Math.abs(place.h * A - h)).toBeLessThan(1e-4);
      expect(Math.abs(place.lat - lat * D)).toBeLessThan(1e-10);
      expect(dot(place.up, place.up)).toBeCloseTo(1, 12);
      // A Sun along the geodetic zenith has the same incidence at every latitude.
      const zenith = geodeticToCart(1, 0, lat * D, 0.3, 0);
      expect(dot(place.normal, zenith)).toBeCloseTo(1, 12);
    }
});

test("ground presets return a level attitude at middle latitudes and preserve spherical worlds", () => {
  for (const id of ["earth", "moon", "mars"])
    for (const lat of [-80, -45, 0, 42.34, 45, 80]) {
      const ground = bodyGround(id, 0, lat, -3.7);
      expect(dot(ground.up, figureUp(id, ground.X, 0))).toBeCloseTo(1, 12);
      expect(dot(ground.up, ground.fwd)).toBeCloseTo(0, 12);
      const q = toBodyFixed(id, ground.X, 0);
      expect(bodyMapDirection(id, q)[2]).toBeCloseTo(Math.sin(lat * D), 6);
    }
});

test("entry height, vertical and target periapsis agree on the ellipsoid, including both poles", () => {
  const env = envOf({ universe: "ours", body: "earth", t: 0, massSolar: 1e8 })!;
  const axes = bodyAxes(solarBody("earth")!, 0);
  for (const lat of [-90, -45, 0, 45, 90]) {
    const fixed = geodeticToCart(A, F, lat * D, 0.7, 40e3);
    const x = [0, 1, 2].map((i) => fixed[0] * axes[0][i]! + fixed[1] * axes[1][i]! + fixed[2] * axes[2][i]!) as Vec3;
    expect(env.alt!(x)).toBeCloseTo(40e3, 4);
    const normal = env.normal!(x);
    const r = env.radiusAtHeight!(x, 20e3);
    expect(env.alt!(scale(x, r / len(x)))).toBeCloseTo(20e3, 4);
    const velocity = scale(cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]), 7800);
    const attitude = attitudeFor(x, velocity, 0, 0, normal);
    expect(dot(attitude[1], normal)).toBeCloseTo(1, 12);
    expect(dot(attitude[1], attitude[2])).toBeCloseTo(0, 12);
  }
  // The vertical-flight fallback also produces an orthonormal attitude.
  const attitude = attitudeFor([0, 0, A], [0, 0, -100], 0.2, 0);
  for (const axis of attitude) expect(len(axis)).toBeCloseTo(1, 12);
});

test("radial target height is geodetic, not an offset above the equatorial sphere", () => {
  for (const lat of [-90, -45, 0, 45, 90])
    for (const h of [0, 20e3, 400e3]) {
      const direction = geodeticToCart(1, 0, lat * D, 0, 0);
      const r = radiusAtHeight(A, F, direction, h);
      expect(cartToGeodetic(A, F, scale(direction, r)).h).toBeCloseTo(h, 4);
    }
});

test("polar limb lets the source through when the former equatorial sphere would fully occult it", () => {
  const b = A * (1 - F),
    d = b + 400e3;
  const limb = Math.atan(A / Math.sqrt(d * d - b * b));
  const light: Vec3 = [Math.sin(limb), 0, -Math.cos(limb)];
  expect(figureDiskShare([0, 0, d], light, 0.0047, A, F)).toBeCloseTo(0.5, 10);
  expect(figureDiskShare([0, 0, d], light, 0.0047, A, 0)).toBe(0);
  expect(figureDiskShare([0, 0, d], [0, 0, 1], 0.0047, A, F)).toBe(1);
  expect(figureDiskShare([0, 0, d], [0, 0, -1], 0.0047, A, F)).toBe(0);
  expect(rayFigure([0, 0, d], [0, 0, -1], A, F)).toBeCloseTo(400e3, 6);
  expect(rayFigure([0, 0, d], [1, 0, 0], A, F)).toBeNull();
});

test("a spherical world's finite-source limb retains the original coverage curve", () => {
  for (const d of [1.001, 1.1, 2, 20])
    for (const offset of [-2, -0.5, 0, 0.5, 2]) {
      const rs = 0.0047,
        angle = Math.asin(1 / d) + offset * rs;
      const x = Math.max(-1, Math.min(1, offset));
      const expected = 0.5 + (x * Math.sqrt(1 - x * x) + Math.asin(x)) / Math.PI;
      expect(figureDiskShare([0, 0, d], [Math.sin(angle), 0, -Math.cos(angle)], rs, 1, 0)).toBeCloseTo(expected, 9);
    }
});

test("orbit figures: the lowest and highest geodetic heights over the whole orbit, where they are; the status judged by the same", () => {
  const mu = 3.986004418e14,
    b = A * (1 - F),
    top = 100e3;
  // (the reference: the heights along the orbit densely sampled from a state at each anomaly)
  const along = (el: ReturnType<typeof elements>, nu: number) => {
    const s = stateFrom(mu, { a: el.a, e: el.e, i: el.i / D, raan: el.raan / D, argPe: el.argPe / D, nu: nu / D });
    return cartToGeodetic(A, F, s.r).h;
  };
  const sampled = (el: ReturnType<typeof elements>) => {
    const span = el.e < 1 ? Math.PI : 0.99 * Math.acos(-1 / el.e);
    let lo = Infinity,
      hi = -Infinity;
    for (let k = 0; k <= 200000; k++) {
      const h = along(el, -span + (2 * span * k) / 200000);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return { lo, hi: el.e < 1 ? hi : Infinity };
  };
  const orbits = [
    // polar, its periapsis over the pole 106 km up: the true lowest point under the air's top
    { rp: b + 106.4e3, ra: b + 121.4e3, i: 90, argPe: 90 },
    { rp: b + 106.4e3, ra: b + 600e3, i: 90, argPe: 90 },
    // circular and polar: 21 km lower over the equator than over the poles
    { rp: b + 160e3, ra: b + 160e3, i: 90, argPe: 0 },
    { rp: b + 160e3, ra: b + 260e3, i: 90, argPe: 90 },
    // inclined, grazing, and nearly equatorial
    { rp: A + 120e3, ra: A + 2000e3, i: 63.4, argPe: 40, raan: 75 },
    { rp: A + 90e3, ra: A + 400e3, i: 28.5, argPe: 120, raan: 200 },
    { rp: A + 300e3, ra: A + 350e3, i: 1, argPe: 10 },
  ].map((o) => elements(mu, stateFrom(mu, { ...o, nu: 33 }).r, stateFrom(mu, { ...o, nu: 33 }).v));
  // unbound, its periapsis at high latitudes: the lowest point found on its branch too
  for (const e of [1.2, 3]) {
    const s = stateFrom(mu, { a: (b + 150e3) / (1 - e), e, i: 75, argPe: 70, nu: -20 });
    orbits.push(elements(mu, s.r, s.v));
  }
  for (const el of orbits) {
    const lowest = orbitExtreme(el, A, F),
      highest = orbitExtreme(el, A, F, true),
      ref = sampled(el);
    expect(lowest.h).toBeLessThanOrEqual(ref.lo + 1e-4);
    expect(lowest.h).toBeGreaterThan(ref.lo - 0.01);
    expect(along(el, lowest.nu)).toBeCloseTo(lowest.h, 2);
    if (el.e < 1) {
      expect(highest.h).toBeGreaterThanOrEqual(ref.hi - 1e-4);
      expect(highest.h).toBeLessThan(ref.hi + 0.01);
      expect(along(el, highest.nu)).toBeCloseTo(highest.h, 2);
    } else expect(highest.h).toBe(Infinity);
    expect(minimumOrbitHeight(el, A, F)).toBe(lowest.h);
    // the clearance and the label: the lowest point's, never contradicting the Pe shown
    const clear = orbitClearsHeight(el, A, F, top);
    expect(clear).toBe(lowest.h >= top);
    if (el.e < 1) expect(classify(el, { R: A, airTop: A + top, clearOfAir: clear })).toBe(clear ? "orbit" : "suborbital");
  }
  // the polar one: over the pole 106 km up, yet down to 99 km nearer the equator — suborbital
  expect(cartToGeodetic(A, F, [0, 0, b + 106.4e3]).h).toBeGreaterThan(top);
  expect(orbitExtreme(orbits[0]!, A, F).h).toBeLessThan(top);
  // the circular polar one: lowest over the equator, highest over a pole
  expect(orbitExtreme(orbits[2]!, A, F).h).toBeCloseTo(b + 160e3 - A, 3);
  expect(orbitExtreme(orbits[2]!, A, F, true).h).toBeCloseTo(160e3, 3);
});

test("runway grading measures physical metres along and across each WGS84 threshold", () => {
  for (const r of EARTH_RUNWAYS) {
    const at = (along: number, across: number) =>
      geodeticNormal(A, F, r.origin.map((v, i) => v + along * r.along[i]! + across * r.across[i]!) as Vec3);
    expect(runwayWeight(at(0, 0))).toBe(1);
    expect(runwayWeight(at(4500, 30))).toBeCloseTo(1, 7);
    expect(runwayWeight(at(2000, 470))).toBeCloseTo(0.5, 4);
    expect(runwayWeight(at(2000, 650))).toBe(0);
    expect(runwayWeight(at(7900, 0))).toBe(0);
  }
});

test("a placed Earth camera keeps its physical location while its geodetic up is restored", () => {
  const fixed = bodyFixedOf("earth", 42.34, -3.7, 900);
  const position = fromBodyFixed("earth", fixed, 0);
  const axes = bodyAxes(solarBody("earth")!, 0);
  const up = figureUp("earth", position, 0);
  const fixedUp = axes.map((a) => dot(up, a)) as Vec3;
  expect(dot(fixedUp, bodyMapDirection("earth", fixed))).toBeCloseTo(1, 10);
  expect(cartToGeodetic(solarBody("earth")!.radius, F, toBodyFixed("earth", position, 0)).h * M_METRES).toBeCloseTo(900, 3);
});
