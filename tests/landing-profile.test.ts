import { test, expect } from "bun:test";
import { LANDING, finalGate, landingProfile } from "../src/controls";

test("the final's profile: continuous in height and slope, tangent to the ground at the touchdown", () => {
  for (const go of [0.08, 0.2, 0.26]) {
    const fix = { go, lb: ((180 * 180) / (0.3 * 9.81)) * (go - LANDING.gi) };
    let prev: ReturnType<typeof landingProfile> | null = null;
    for (let x = -8000; x <= LANDING.td + 200; x += 5) {
      const p = landingProfile(x, 0, 180, fix);
      if (prev) {
        // (no jump between the phases: the height within the slope's step, the slope within a few mrad)
        expect(Math.abs(p.h - (prev.h + prev.slope * 5))).toBeLessThan(0.5);
        expect(Math.abs(p.slope - prev.slope)).toBeLessThan(0.01);
      }
      prev = p;
    }
    const td = landingProfile(LANDING.td - 0.01, 0, 180, fix);
    expect(td.h).toBeLessThan(1e-3);
    expect(Math.abs(td.slope)).toBeLessThan(1e-3);
    // (the steep slope's aim before the threshold, the corner 90 m up)
    expect(landingProfile(-20000, 0, 180, fix).aim).toBeLessThan(0);
  }
});

test("the steep slope followed from where the craft is, until the pull-up nears", () => {
  const far = landingProfile(-12000, 2000);
  expect(far.phase).toBe("outer");
  expect(far.freeze).toBe(false);
  // (the line from the craft: no height error)
  expect(Math.abs(far.h - 2000)).toBeLessThan(1);
  // (too high for the steepest slope, 19°: the profile under the craft — dived to)
  expect(landingProfile(-12000, 4500).h).toBeLessThan(4400);
  expect(landingProfile(-4000, 250, 160).freeze).toBe(true);
});

test("the approach's gate over the final's start lies on the steep slope: the final starts on its profile", () => {
  // (the gate the approach glides to, 12 km out: the line from it to the corner within the steepest slope —
  // the profile follows the craft there, no dive onto it — and well above the shallow slope)
  for (const start of [12e3, 16e3]) {
    const h = finalGate(start);
    const p = landingProfile(-start, h);
    expect(p.phase).toBe("outer");
    expect(Math.abs(p.h - h)).toBeLessThan(1);
    expect(p.fix.go).toBeLessThan(LANDING.goMax - 0.02);
    expect(p.fix.go).toBeGreaterThan(LANDING.gi + 0.1);
  }
});
