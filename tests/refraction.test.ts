import { expect, test } from "bun:test";
import { apparentAltitude, bending, bennett, seaRefractivity } from "../src/system/refraction";

// PLAN-CIEL C3: the Earth's air bending the light — the tracer's model (airBend) against Bennett's table.

const D = Math.PI / 180;
const AM = D / 60;

test("the bending from the sea: 35′ at the horizon, Bennett's within 2′ above it, 1′ at 45°, none at the zenith", () => {
  const N = seaRefractivity(10);
  expect(bending(0, 0, N) / AM).toBeCloseTo(35.4, 0);
  for (const a of [0.5, 1, 2, 5, 10, 20, 45, 80]) expect(Math.abs(bending(a * D, 0, N) - bennett(a * D)) / AM).toBeLessThan(2.1);
  expect(bending(45 * D, 0, N) / AM).toBeCloseTo(1, 1);
  expect(bending(90 * D, 0, N)).toBeLessThan(1e-9);
});

test("the setting Sun flattened (~0.8), raised half a degree: seen whole when its centre is already below", () => {
  const N = seaRefractivity(15);
  const top = apparentAltitude(0.27 * D, 0, N),
    bottom = apparentAltitude(-0.27 * D, 0, N);
  expect((top - bottom) / (0.54 * D)).toBeGreaterThan(0.76);
  expect((top - bottom) / (0.54 * D)).toBeLessThan(0.86);
  expect(bottom).toBeGreaterThan(0);
});

test("cold dense air bends more; high up, less; grazing the air from orbit, about twice the horizon's", () => {
  expect(bending(0, 0, seaRefractivity(-30))).toBeGreaterThan(bending(0, 0, seaRefractivity(30)) * 1.15);
  expect(bending(0, 4000)).toBeLessThan(bending(0, 0) * 0.65);
  // (from 400 km, the ray grazing the sea: the dip is acos(R/(R+h)))
  const dip = Math.acos(6371 / 6771);
  expect(bending(-dip + 1e-4, 400e3) / bending(0, 0)).toBeGreaterThan(1.7);
});
