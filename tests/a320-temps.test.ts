import { expect, test } from "bun:test";
import { airTemps } from "../src/a320/du/data";

// The A320's SAT and TAT (the ECAM's bottom strip): the static air's temperature, and the probe's total one warmed by the
// stagnation — in kelvins. Before 11 Nov 2026 the static one was shown as the TAT, and the SAT was it divided in °C.
test("SAT = the static air; TAT = T (1 + 0.2 M²), in kelvins", () => {
  // (on the ground at rest: the same)
  expect(airTemps(288.15, 0)).toEqual({ sat: 0 + 15, tat: 15 });
  // (cruise, FL370 ISA: −56.5 °C static, M 0.78 → about −30 °C total, as an A320's ECAM shows)
  const c = airTemps(216.65, 0.78);
  expect(c.sat).toBeCloseTo(-56.5, 6);
  expect(c.tat).toBeCloseTo(216.65 * (1 + 0.2 * 0.78 ** 2) - 273.15, 6);
  expect(c.tat).toBeGreaterThan(-31);
  expect(c.tat).toBeLessThan(-29);
  // (the total always the warmer)
  expect(c.tat).toBeGreaterThan(c.sat);
});
