import { expect, test } from "bun:test";
import { mlsReading } from "../src/game/mls";

// PLAN-AEROPORTS A4: the Shuttle's microwave landing system — the azimuth and the elevation against the
// Ranger's own profile.

test("on the axis and on the profile: centred; the distance to the touchdown point", () => {
  const r = mlsReading({ along: -10000, across: 0, agl: 2000, profileH: 2000 });
  expect(r.az).toBe(0);
  expect(r.el).toBeCloseTo(0, 9);
  expect(r.azIn && r.elIn).toBe(true);
  expect(r.dmeKm).toBeCloseTo(Math.hypot(10450, 2000) / 1000, 6);
});

test("right of the axis, high: the azimuth positive, from the far end; the elevation positive", () => {
  const r = mlsReading({ along: -5000, across: 300, agl: 900, profileH: 700 });
  expect(r.az).toBeCloseTo((Math.atan2(300, 4500 + 300 + 5000) * 180) / Math.PI, 6);
  expect(r.el).toBeGreaterThan(0);
  expect(r.el).toBeCloseTo(((Math.atan2(900, 5450) - Math.atan2(700, 5450)) * 180) / Math.PI, 6);
});

test("coverage: off 40°, beyond 37 km, past the touchdown point, no profile — out", () => {
  expect(mlsReading({ along: -2000, across: 6000, agl: 500, profileH: 300 }).azIn).toBe(false);
  expect(mlsReading({ along: -45000, across: 0, agl: 5000, profileH: 5000 }).azIn).toBe(false);
  const past = mlsReading({ along: 800, across: 0, agl: 2, profileH: 0 });
  expect(past.azIn).toBe(true);
  expect(past.elIn).toBe(false);
  const off = mlsReading({ along: -8000, across: 0, agl: 1500, profileH: null });
  expect(off.el).toBeNull();
  expect(off.elIn).toBe(false);
});
