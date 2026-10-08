import { expect, test } from "bun:test";
import { EARTH_RUNWAYS, intoWind, landingEnd, RUNWAY_LENGTH, reciprocal, runwayWind, SITES } from "../src/game/sites";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { presetWeather, windFromAt } from "../src/weather";

// PLAN-METEO W4: a runway landed both ways — into the wind.

const edwards = SITES.find((s) => s.name.startsWith("Edwards"))!;
const D = Math.PI / 180;

test("the other end: the far threshold of the strip drawn, landed back down it", () => {
  const r = EARTH_RUNWAYS.find((x) => x.site === edwards)!;
  const b = reciprocal(edwards);
  expect(b.reverse).toBe(true);
  expect(b.name).toBe(edwards.name);
  const B = geodeticToCart(WGS84_A, WGS84_F, b.lat * D, b.lon * D, 0);
  // (the strip's far end, the tangent's 1.6 m rise brought down: within a few centimetres along it)
  const d = B.map((v, i) => v - r.origin[i]!);
  const along = d[0]! * r.along[0] + d[1]! * r.along[1] + d[2]! * r.along[2];
  const across = d[0]! * r.across[0] + d[1]! * r.across[1] + d[2]! * r.across[2];
  expect(Math.abs(along - RUNWAY_LENGTH)).toBeLessThan(0.05);
  expect(Math.abs(across)).toBeLessThan(0.05);
  // (its heading the opposite, turned by the meridians' convergence over 4.5 km: a few hundredths of a degree)
  const turn = ((((b.rwy! - edwards.rwy! - 180) % 360) + 540) % 360) - 180;
  expect(Math.abs(turn)).toBeLessThan(0.05);
  // (and back: the published end again)
  const a = reciprocal(b);
  expect(a.reverse).toBe(false);
  expect(Math.abs(a.lat - edwards.lat) * 111e3).toBeLessThan(0.05);
});

test("into the wind: the published end in a head wind or calm, the other past half a metre a second behind", () => {
  const rwy = edwards.rwy!;
  expect(intoWind(edwards, rwy, 8).reverse).toBeUndefined();
  expect(intoWind(edwards, rwy + 80, 8).reverse).toBeUndefined();
  expect(intoWind(edwards, rwy + 180, 8).reverse).toBe(true);
  expect(intoWind(edwards, rwy + 180, 0.4).reverse).toBeUndefined();
  // (no wind chosen — fair weather: the published end)
  expect(intoWind(edwards, null, 8).reverse).toBeUndefined();
  // (a pad, another world's runway: as they are)
  const edmunds = SITES.find((s) => s.body === "edmunds")!;
  expect(intoWind(edmunds, edmunds.rwy! + 180, 8).reverse).toBeUndefined();
});

test("the wind on a runway: head and cross components", () => {
  const w = runwayWind(270, 300, 10);
  expect(w.head).toBeCloseTo(10 * Math.cos(30 * D), 6);
  // (from the right of a westward landing: the north-west)
  expect(w.cross).toBeCloseTo(5, 6);
  expect(runwayWind(90, 270, 6).head).toBeCloseTo(-6, 6);
});

test("the end landed now: fair weather the published one; a windy day into its wind, both ways over the days", () => {
  const fair = { weather: "fair" as const, wind: 1 as const };
  for (let d = 0; d < 20; d++) expect(landingEnd(edwards, fair, d).reverse).toBeUndefined();
  const windy = { weather: "windy" as const, wind: 1 as const };
  const seen = new Set<boolean>();
  for (let d = 0; d < 60; d++) {
    const e = landingEnd(edwards, windy, d);
    const from = windFromAt(presetWeather("windy", 1), edwards, d);
    // (whichever end: never more than half a metre a second of tail wind)
    expect(runwayWind(e.rwy!, from, 15).head).toBeGreaterThan(-0.5);
    seen.add(!!e.reverse);
    // (from either end, the same answer)
    expect(landingEnd(reciprocal(edwards), windy, d).reverse).toBe(e.reverse);
  }
  expect(seen.size).toBe(2);
});
