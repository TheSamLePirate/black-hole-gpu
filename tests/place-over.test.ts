import { test, expect } from "bun:test";
import { orbitOver, ourOrbitPose, overPlace } from "../src/game/place";
import { cartToGeodetic, flatteningOf } from "../src/system/ellipsoid";
import { solarBody } from "../src/system/solar";
import { bodyFixedOf, toBodyFixed } from "../src/system/our-surface";

const D = Math.PI / 180;
const latLon = (q: number[]) => {
  const l = Math.hypot(q[0]!, q[1]!, q[2]!);
  return [Math.asin(q[2]! / l) / D, Math.atan2(q[1]!, q[0]!) / D];
};

// an orbit placed over a place passes over it now: the point under the ship is the place
test("orbitOver puts the ship over the place picked", () => {
  const t = 109.6;
  for (const [body, lat, lon, inc, retro, argPe] of [
    ["earth", 48.86, 2.35, 51.6, false, 0],
    ["earth", -33.4, -70.6, 0, false, 0],
    ["earth", 10, 100, 98, false, 0],
    ["earth", 5, -40, 30, true, 0],
    ["moon", 0.67, 23.47, 0, false, 45],
    ["mars", 18.4, 77.6, 25, false, 0],
  ] as const) {
    const q = bodyFixedOf(body, lat, lon, 0);
    const o = orbitOver(body, q as [number, number, number], t, { inc, argPe, retrograde: retro });
    // (the place's geocentric latitude, on the equator of the orbits' frame — a few hundredths of a degree off the ground's axes of date)
    expect(o.inc).toBeGreaterThanOrEqual(Math.min(Math.abs(latLon(q)[0]!), 90) - 0.05);
    const p = ourOrbitPose({ body, altKm: 400, inc: o.inc, raan: o.raan, argPe, nu: o.nu, retrograde: retro }, t);
    const [la, lo] = latLon(toBodyFixed(body, p.X, t));
    // (on the place's direction from the centre — the Earth's geocentric latitude, 0.19° at most off its geodetic one)
    expect(la).toBeCloseTo(latLon(q)[0]!, 4);
    expect(((lo! - lon + 540) % 360) - 180).toBeCloseTo(0, 4);
  }
});

// a place given by its WGS84 latitude (an address, a map, a GPS): the ship's nadir is that place to the
// millionth of a degree — not the point 0.19° off it the place's latitude read on the sphere would give
test("orbitOver over a geodetic place: the ship's geodetic nadir is the place", () => {
  const t = 109.6;
  for (const [body, lat, lon, inc, h] of [
    ["earth", 48.8584, 2.2945, 51.6, 400],
    ["earth", 45, -73.6, 98, 800],
    ["earth", -33.8568, 151.2153, 0, 35_786],
    ["moon", -43.3, -11.4, 0, 100],
  ] as const) {
    const q = overPlace(body, lat, lon, h);
    const o = orbitOver(body, q as [number, number, number], t, { inc, argPe: 0, retrograde: false });
    const p = ourOrbitPose({ body, altKm: h, inc: o.inc, raan: o.raan, nu: o.nu }, t);
    const R = solarBody(body)!.radius;
    const g = cartToGeodetic(R, flatteningOf(body), toBodyFixed(body, p.X, t));
    expect(g.lat / D).toBeCloseTo(lat, 6);
    expect(((g.lon / D - lon + 540) % 360) - 180).toBeCloseTo(0, 6);
  }
});
