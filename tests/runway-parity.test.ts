import { expect, test } from "bun:test";
import { geodeticNormal, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { EARTH_RUNWAYS, runwayFrame, runwayGrade, runwayWeight, setWorldRunways } from "../src/game/sites";

// CPU boundary cases in physical WGS84 metres. GPU numerical parity runs in ellipsoid.e2e.test.ts.

test("runwayWeight: graded on the strip, faded off it, nothing far away", () => {
  const r = EARTH_RUNWAYS.find((x) => x.site.name.startsWith("Edwards"))!;
  const at = (a: number, c: number): [number, number, number] => {
    return geodeticNormal(WGS84_A, WGS84_F, r.origin.map((v, i) => v + a * r.along[i]! + c * r.across[i]!) as [number, number, number]);
  };
  expect(runwayWeight(at(1000, 0))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(-2500, 40))).toBeCloseTo(1, 6);
  // (the taxiway, the apron and the buildings beside it graded too — A2, A3 —, and the levelled airfield
  // with its embankment: 320 m out, eased back by 620)
  expect(runwayWeight(at(1000, 90))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(1000, 310))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(1000, 470))).toBeCloseTo(0.5, 2);
  // (graded 3 km past the far end too: the clear zone of the runway landed the other way — W4)
  expect(runwayWeight(at(4650, 0))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(7650, 0))).toBeCloseTo(0.5, 2);
  expect(runwayWeight(at(1000, 640))).toBeCloseTo(0, 6);
  expect(runwayWeight(at(20000, 0))).toBe(0);
});

test("runwayGrade: the airfield brought to its runway's level, eased back to the relief", () => {
  for (const r of EARTH_RUNWAYS) {
    const at = (a: number, c: number): [number, number, number] =>
      geodeticNormal(WGS84_A, WGS84_F, r.origin.map((v, i) => v + a * r.along[i]! + c * r.across[i]!) as [number, number, number]);
    expect(r.elev).toBe(r.site.elev!);
    // (the strip, its ends' 300 m, the apron and the buildings 280 m out: level)
    for (const [a, c] of [
      [0, 0],
      [2250, 0],
      [4500, 0],
      [-300, 0],
      [4800, 0],
      [1000, -250],
      [1000, 320],
    ] as const) {
      const g = runwayGrade(at(a, c));
      expect(g.level).toBeCloseTo(1, 6);
      expect(g.elev).toBe(r.elev);
      expect(g.flat).toBeCloseTo(1, 6);
    }
    // (eased back: half way down the embankment, then the relief)
    expect(runwayGrade(at(-600, 0)).level).toBeCloseTo(0.5, 2);
    expect(runwayGrade(at(5100, 0)).level).toBeCloseTo(0.5, 2);
    expect(runwayGrade(at(2000, 470)).level).toBeCloseTo(0.5, 2);
    expect(runwayGrade(at(-950, 0)).level).toBe(0);
    expect(runwayGrade(at(2000, 650)).level).toBe(0);
  }
});

test("a world runway (OurAirports' — PLAN-RADAR-AAA RD13): levelled as the sites' are, to its own length and width", () => {
  // (a 2 400 m × 45 m paved runway, lit: its strip and 300 m past its ends level, its width and 100 m beside, eased over 200)
  const r = runwayFrame(
    { body: "earth", name: "LFOB 13", lat: 49.46, lon: 2.1, runway: true, rwy: 130, icao: "LFOB", elev: 109, len: 2400 },
    2400,
    22.5,
    16 | 32,
  );
  r.world = { field: "LFOB", measuring: false };
  setWorldRunways([r]);
  try {
    const at = (a: number, c: number): [number, number, number] =>
      geodeticNormal(WGS84_A, WGS84_F, r.origin.map((v, i) => v + a * r.along[i]! + c * r.across[i]!) as [number, number, number]);
    for (const [a, c] of [
      [0, 0],
      [1200, 0],
      [2400, 0],
      [-300, 0],
      [2700, 0],
      [1200, 120],
    ] as const) {
      const g = runwayGrade(at(a, c));
      expect(g.level).toBeCloseTo(1, 6);
      expect(g.elev).toBe(109);
    }
    // (beside it, its own width and 100 m — not the sites' 320 m of made-up apron: the town's houses kept)
    expect(runwayGrade(at(1200, 222.5)).level).toBeCloseTo(0.5, 2);
    expect(runwayGrade(at(1200, 330)).level).toBe(0);
    // (its length's: the far end's ease at 2 400 + 300 + 300)
    expect(runwayGrade(at(3000, 0)).level).toBeCloseTo(0.5, 2);
    // (measured: left out of the grading meanwhile)
    r.world.measuring = true;
    expect(runwayGrade(at(1200, 0)).level).toBe(0);
  } finally {
    setWorldRunways([]);
  }
});
