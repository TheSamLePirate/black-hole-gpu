import { expect, test } from "bun:test";
import { LANDING, landingProfile } from "../src/controller/util";
import { MISSED_TOP_H, procedureFor, RUNWAY_DH, unstableWhy } from "../src/game/procedures";
import { SITES } from "../src/game/sites";

// PLAN-AEROPORTS A5: the approach charts — the Ranger's own approach and its missed approach.

const edwards = SITES.find((s) => s.name.startsWith("Edwards"))!;

test("a runway's chart: its fixes down the Ranger's profile, in order, each on it", () => {
  const p = procedureFor(edwards);
  expect(p.kind).toBe("runway");
  expect(p.rwy).toBe(220);
  expect(p.fixes.map((f) => f.id)).toEqual(["IAF", "FAF", "PU", "DH", "TD"]);
  const fix = { go: LANDING.goNom, lb: 3000 };
  for (let i = 1; i < p.fixes.length; i++) {
    expect(p.fixes[i]!.along).toBeGreaterThan(p.fixes[i - 1]!.along);
    expect(p.fixes[i]!.h).toBeLessThanOrEqual(p.fixes[i - 1]!.h);
  }
  // (the final approach fix 12 km out, ~2 km up; the decision height on the shallow glide)
  const faf = p.fixes[1]!;
  expect(faf.along).toBe(-12000);
  expect(faf.h).toBeGreaterThan(1500);
  expect(faf.h).toBeLessThan(3500);
  const dh = p.fixes[3]!;
  expect(Math.abs(landingProfile(dh.along, 0, 150, fix).h - RUNWAY_DH)).toBeLessThan(0.5);
  expect(dh.along).toBeLessThan(LANDING.td);
  expect(p.minima.dh).toBe(RUNWAY_DH);
  // (the missed approach: past the runway, then back on its left, 3 km up)
  expect(p.missed.map((f) => f.id)).toEqual(["MA", "MAHF"]);
  expect(p.missed[1]!.across).toBeLessThan(0);
  expect(p.missed[1]!.h).toBe(MISSED_TOP_H);
});

test("stabilised at the minima: within 45 m of the axis and 30 m of the profile", () => {
  expect(unstableWhy(40, -25)).toBeNull();
  expect(unstableWhy(-50, 0)).toEqual({ what: "axis", by: 50 });
  expect(unstableWhy(5, 40)).toEqual({ what: "high", by: 40 });
  expect(unstableWhy(5, -31)).toEqual({ what: "low", by: 31 });
});

test("a pad's chart: its gates, its minima, climbing out to hold", () => {
  const p = procedureFor(SITES.find((s) => s.name.startsWith("Jezero"))!);
  expect(p.kind).toBe("pad");
  expect(p.fixes.map((f) => f.id)).toEqual(["HG", "LG", "DH", "TD"]);
  expect(p.minima.dh).toBe(30);
  expect(p.missed[0]!.h).toBe(500);
});
