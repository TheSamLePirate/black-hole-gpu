// The sky's events' geometry (photo/skyevents.ts, PLAN-MODES-AAA M7).
import { expect, test } from "bun:test";
import { angSep, closestApproach, lensMm, poleView, selenelionAt, shotTimes, trailsAim } from "../src/photo/skyevents";

test("angles on the sky; the pole by the latitude; the trails' aim", () => {
  expect(angSep({ az: 0, alt: 0 }, { az: 90, alt: 0 })).toBeCloseTo(90, 9);
  expect(angSep({ az: 10, alt: 90 }, { az: 200, alt: 90 })).toBeCloseTo(0, 6);
  expect(angSep({ az: 0, alt: 30 }, { az: 0, alt: 40 })).toBeCloseTo(10, 9);
  expect(poleView(48.85)).toEqual({ az: 0, alt: 48.85 });
  expect(poleView(-33.9)).toEqual({ az: 180, alt: 33.9 });
  expect(trailsAim(48, { az: 120, alt: 5 }).toward).toBe("pole");
  const eq = trailsAim(2, { az: 95, alt: 3 });
  expect(eq.toward).toBe("east");
  expect(eq.aim).toEqual({ az: 95, alt: 25 });
});

test("the exposures' times and the lenses", () => {
  expect(shotTimes(0, 100, 5)).toEqual([0, 25, 50, 75, 100]);
  expect(shotTimes(7, 9, 1)).toEqual([7]);
  expect(lensMm(46.8)).toBeCloseTo(27.7, 0);
  expect(lensMm(2)).toBeCloseTo(687.5, 0);
});

test("a selenelion: the first moment both stand on the horizon during the umbral phase", () => {
  const contacts = [
    { name: "P1", t: 0 },
    { name: "U1", t: 3_600e3 },
    { name: "U4", t: 3 * 3_600e3 },
    { name: "P4", t: 4 * 3_600e3 },
  ];
  // (the Moon setting through the phase, the Sun rising opposite: both within the band near 2 h)
  const azAlt = (id: "sun" | "moon", ms: number) => {
    const h = ms / 3_600e3;
    return id === "moon" ? { az: 280, alt: 10 - 5 * h } : { az: 100, alt: -6 + 3 * h };
  };
  const r = selenelionAt(contacts, azAlt)!;
  expect(r.t).toBeGreaterThanOrEqual(1.66 * 3_600e3);
  expect(r.t).toBeLessThanOrEqual(2.4 * 3_600e3);
  expect(r.moon.alt).toBeLessThanOrEqual(2);
  expect(r.sun.alt).toBeGreaterThanOrEqual(-1);
  // (the Moon high the whole time: none)
  expect(selenelionAt(contacts, (id) => (id === "moon" ? { az: 0, alt: 40 } : { az: 180, alt: -40 }))).toBeNull();
  expect(selenelionAt([{ name: "U1", t: 5 }], () => ({ az: 0, alt: 0 }))).toBeNull();
});

test("the ISS's closest approach: both above 5°, the least angle", () => {
  const times = shotTimes(0, 100e3, 101);
  const iss = (ms: number) => ({ az: 100 + ms / 1e3, alt: 40 });
  const moon = () => ({ az: 150, alt: 40.2 });
  const r = closestApproach(times, iss, moon)!;
  expect(r.t).toBe(50e3);
  expect(r.sep).toBeCloseTo(0.2, 1);
  expect(closestApproach(times, iss, () => ({ az: 150, alt: 2 }))).toBeNull();
});
