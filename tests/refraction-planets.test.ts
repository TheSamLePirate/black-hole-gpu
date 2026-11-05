import { expect, test } from "bun:test";
import { planetLimbBending, planetProfile, stpRefractivity } from "../src/system/refraction-planets";

// R5, first lot: Venus's and Titan's airs and their limb's bending — the profiles against the reference atmospheres' figures,
// Venus's critical refraction height (a ray there circles the planet: r dN/dr = −1, ~32–35 km in the literature), the bending
// against the exponential air's estimate N √(2π r/H), and the dispersion's sense.

test("Venus: the VIRA profile's pressures within 30 % (70 km: 37 mbar), its critical refraction near 33 km", () => {
  const P = planetProfile("venus");
  const pAt = (h: number) => P.p[Math.round(h / P.step)]!;
  expect(Math.abs(pAt(50e3) / 1.07e5 - 1)).toBeLessThan(0.3);
  expect(Math.abs(pAt(70e3) / 3.69e3 - 1)).toBeLessThan(0.3);
  // (r dN/dr against −1: the height where it crosses)
  let crit = -1;
  for (let i = 1; i < P.N.length - 1; i++) {
    const r = P.R + i * P.step;
    const g = (r * (P.N[i + 1]! - P.N[i - 1]!)) / (2 * P.step);
    if (g > -1) {
      crit = i * P.step;
      break;
    }
  }
  expect(crit).toBeGreaterThan(28e3);
  expect(crit).toBeLessThan(40e3);
});

test("Titan: the Huygens profile's pressure at the tropopause (~44 km) within 40 % of ~115 hPa", () => {
  const P = planetProfile("titan");
  expect(Math.abs(P.p[Math.round(44e3 / P.step)]! / 1.15e4 - 1)).toBeLessThan(0.4);
});

test("the limb's bending follows the exponential air's N √(2π r/H) within 25 % where the air is thin", () => {
  for (const [body, ht] of [
    ["venus", 70e3],
    ["venus", 90e3],
    ["titan", 150e3],
    ["titan", 300e3],
  ] as const) {
    const P = planetProfile(body);
    const i = Math.round(ht / P.step);
    const N = P.N[i]!;
    const H = (2 * P.step) / Math.log(P.N[i - 1]! / P.N[i + 1]!);
    const est = N * Math.sqrt((2 * Math.PI * (P.R + ht)) / H);
    expect(Math.abs(planetLimbBending(P, ht) / est - 1)).toBeLessThan(0.25);
  }
});

test("the gases disperse: blue bent more than red", () => {
  for (const body of ["venus", "titan"] as const) expect(stpRefractivity(body, 0.45)).toBeGreaterThan(stpRefractivity(body, 0.65));
  const red = planetLimbBending(planetProfile("venus", 0.65), 80e3);
  const blue = planetLimbBending(planetProfile("venus", 0.45), 80e3);
  expect(blue).toBeGreaterThan(red);
});
