import { test, expect } from "bun:test";
import { parseOmm, parseTle, sgp4, temeToEcef } from "../src/system/sgp4";

// Vallado, Crawford, Hujsak & Kelso (2006), the verification set (SGP4-VER.TLE, tcppver.out): satellite
// 00005 (Vanguard 1, near-Earth, e = 0.186, drag), TEME km and km/s
const L1 = "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753";
const L2 = "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667";

test("SGP4 reproduces Vallado's verification for 00005", () => {
  const p = sgp4(parseTle(L1, L2));
  const cases: [number, number[], number[]][] = [
    [0, [7022.46529266, -1400.08296755, 0.03995155], [1.893841015, 6.405893759, 4.53480725]],
    [360, [-7154.03120202, -3783.17682504, -3536.19412294], [4.741887409, -4.151817765, -2.093935425]],
  ];
  for (const [t, r, v] of cases) {
    const s = p.propagate(t)!;
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(s.r[k]! - r[k]!)).toBeLessThan(1e-3); // a metre
      expect(Math.abs(s.v[k]! - v[k]!)).toBeLessThan(1e-6);
    }
  }
});

test("TLE and OMM give the same elements", () => {
  const a = parseTle(
    "1 25544U 98067A   26273.85230731  .00003748  00000+0  76931-4 0  9990",
    "2 25544  51.6316 137.1559 0007005 207.6272 152.4345 15.48699564588139",
  );
  expect(a.i).toBeCloseTo(51.6316, 6);
  expect(a.e).toBeCloseTo(0.0007005, 9);
  expect(a.bstar).toBeCloseTo(0.76931e-4, 10);
  expect(new Date(a.epochMs).toISOString().slice(0, 16)).toBe("2026-09-30T20:27");
  const b = parseOmm({
    EPOCH: "2026-09-30T20:27:19.351584",
    MEAN_MOTION: 15.48699564,
    ECCENTRICITY: 0.0007005,
    INCLINATION: 51.6316,
    RA_OF_ASC_NODE: 137.1559,
    ARG_OF_PERICENTER: 207.6272,
    MEAN_ANOMALY: 152.4345,
    BSTAR: 7.6931e-5,
    OBJECT_NAME: "ISS (ZARYA)",
  });
  expect(Math.abs(a.epochMs - b.epochMs)).toBeLessThan(5);
  const ra = sgp4(a).propagate(90)!,
    rb = sgp4(b).propagate(90)!;
  expect(Math.hypot(ra.r[0] - rb.r[0], ra.r[1] - rb.r[1], ra.r[2] - rb.r[2])).toBeLessThan(0.01);
});

test("the station's orbit: 400 km up, 7.66 km/s, the ground speed less", () => {
  const el = parseTle(
    "1 25544U 98067A   26273.85230731  .00003748  00000+0  76931-4 0  9990",
    "2 25544  51.6316 137.1559 0007005 207.6272 152.4345 15.48699564588139",
  );
  const p = sgp4(el);
  for (const t of [0, 45, 300, 1440 * 3]) {
    const s = p.propagate(t)!;
    const r = Math.hypot(...s.r),
      v = Math.hypot(...s.v);
    expect(r - 6378).toBeGreaterThan(380);
    expect(r - 6378).toBeLessThan(440);
    expect(v).toBeGreaterThan(7.6);
    expect(v).toBeLessThan(7.72);
    const e = temeToEcef(s.r, s.v, el.epochMs + t * 60e3);
    expect(Math.hypot(...e.r)).toBeCloseTo(r, 6);
    // (the ground turns eastwards under a prograde orbit: slower over it)
    expect(Math.hypot(...e.v)).toBeLessThan(v);
    // (51.6°: never further from the equator)
    expect((Math.abs(Math.asin(e.r[2] / r)) * 180) / Math.PI).toBeLessThan(51.8);
  }
});
