import { test, expect } from "bun:test";
import { orbitOver, ourOrbitPose } from "../src/game/place";
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
    ["earth", 48.86, 2.35, 51.6, false, 0], ["earth", -33.4, -70.6, 0, false, 0], ["earth", 10, 100, 98, false, 0],
    ["earth", 5, -40, 30, true, 0], ["moon", 0.67, 23.47, 0, false, 45], ["mars", 18.4, 77.6, 25, false, 0],
  ] as const) {
    const q = bodyFixedOf(body, lat, lon, 0);
    const o = orbitOver(body, q as [number, number, number], t, { inc, argPe, retrograde: retro });
    expect(o.inc).toBeGreaterThanOrEqual(Math.min(Math.abs(lat), 90) - 1e-9);
    const p = ourOrbitPose({ body, altKm: 400, inc: o.inc, raan: o.raan, argPe, nu: o.nu, retrograde: retro }, t);
    const [la, lo] = latLon(toBodyFixed(body, p.X, t));
    expect(la).toBeCloseTo(lat, 4);
    expect(((lo! - lon + 540) % 360) - 180).toBeCloseTo(0, 4);
  }
});
