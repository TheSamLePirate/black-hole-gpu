import { expect, test } from "bun:test";
import { geodeticNormal, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { EARTH_RUNWAYS, runwayWeight } from "../src/game/sites";

// CPU boundary cases in physical WGS84 metres. GPU numerical parity runs in ellipsoid.e2e.test.ts.

test("runwayWeight: graded on the strip, faded off it, nothing far away", () => {
  const r = EARTH_RUNWAYS.find((x) => x.site.name.startsWith("Edwards"))!;
  const at = (a: number, c: number): [number, number, number] => {
    return geodeticNormal(WGS84_A, WGS84_F, r.origin.map((v, i) => v + a * r.along[i]! + c * r.across[i]!) as [number, number, number]);
  };
  expect(runwayWeight(at(1000, 0))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(-2500, 40))).toBeCloseTo(1, 6);
  // (the taxiway, the apron and the buildings beside it graded too — A2, A3 —: 280 m out, faded by 340)
  expect(runwayWeight(at(1000, 90))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(1000, 310))).toBeCloseTo(0.5, 2);
  // (graded 3 km past the far end too: the clear zone of the runway landed the other way — W4)
  expect(runwayWeight(at(4650, 0))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(7650, 0))).toBeCloseTo(0.5, 2);
  expect(runwayWeight(at(1000, 340))).toBeCloseTo(0, 6);
  expect(runwayWeight(at(20000, 0))).toBe(0);
});
