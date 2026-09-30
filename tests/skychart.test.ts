import { test, expect } from "bun:test";
import type { Vec3 } from "../src/physics";
import { CONSTELLATIONS, NAMED_STARS, altAzOf, horizonOf, icrsOf, raDecOf } from "../src/skychart";
import { equatorOfDate, eclOf } from "../src/system/orientation";
import { EPOCH_DATE, M_SECONDS, utcOf } from "../src/system/solar";
import { tdbOf } from "../src/system/timescale";
import { bodyFixedOf, fromBodyFixed } from "../src/system/our-surface";
import sky from "../assets/sky/constellations.json";

const star = (n: string) => NAMED_STARS.find((s) => s.name === n)!;
const ang = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) / Math.PI;

test("the constellations: 88, their 676 figure lines, 102 named stars", () => {
  expect(CONSTELLATIONS.length).toBe(88);
  expect(sky.segments.length).toBe(676);
  expect(NAMED_STARS.length).toBe(102);
  // every constellation has a figure; Orion's joins Betelgeuse and Bellatrix, Rigel belongs to it
  const ori = CONSTELLATIONS.findIndex((c) => c.abbr === "Ori");
  expect(new Set(sky.segments.map((s) => s[6])).size).toBe(88);
  expect(star("Betelgeuse").constellation).toBe(ori);
  expect(star("Rigel").constellation).toBe(ori);
  expect(CONSTELLATIONS[star("Vega").constellation]!.name).toBe("Lyra");
  expect(CONSTELLATIONS[star("Polaris").constellation]!.name).toBe("Ursa Minor");
  expect(CONSTELLATIONS[star("Acrux").constellation]!.name).toBe("Crux");
});

test("the frames: the home frame's stars back in right ascension and declination", () => {
  const [ra, dec] = raDecOf(star("Sirius").v);
  expect(ra).toBeCloseTo(101.29, 1);
  expect(dec).toBeCloseTo(-16.72, 1);
  // ICRS → home (eclOf) → ICRS
  const v: Vec3 = [0.3, -0.5, Math.sqrt(1 - 0.34)];
  const w = icrsOf(eclOf(v));
  for (let i = 0; i < 3; i++) expect(w[i]!).toBeCloseTo(v[i]!, 12);
});

test("the equator of the date: J2000's at J2000, the pole 0.37° away in 2067", () => {
  const E0 = equatorOfDate(0);
  expect(ang(icrsOf(E0[2]), [0, 0, 1])).toBeLessThan(0.004); // (the nutation: 8″ at J2000)
  const t = (Date.UTC(2067, 0, 1) - EPOCH_DATE) / 1000 / M_SECONDS;
  const E = equatorOfDate(tdbOf(utcOf(t)));
  const p = ang(icrsOf(E[2]), [0, 0, 1]);
  expect(p).toBeGreaterThan(0.33);
  expect(p).toBeLessThan(0.4);
});

test("the horizon at Burgos: Polaris at the latitude's height, due north", () => {
  const t = (Date.UTC(2026, 7, 12, 22, 0) - EPOCH_DATE) / 1000 / M_SECONDS;
  const X = fromBodyFixed("earth", bodyFixedOf("earth", 42.34, -3.7, 900), t);
  const h = horizonOf(X, t)!;
  expect(h.body).toBe("earth");
  const [alt, az] = altAzOf(h, star("Polaris").v);
  expect(Math.abs(alt - 42.34)).toBeLessThan(1.2); // (Polaris 0.7° from the pole)
  expect(Math.min(az, 360 - az)).toBeLessThan(1.5);
});
