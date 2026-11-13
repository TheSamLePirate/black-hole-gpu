import { afterEach, expect, test } from "bun:test";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The pilot's messages in his units (audit 2026-11-10, FX-17): with the imperial option the HUD shows kt and ft — the
// messages had m and m/s written in. The jet's autopilot said here in each system.

afterEach(() => resetFlights());

test("the jet's autopilot told in the pilot's units: metric m and m/s, imperial ft and kt", () => {
  const { c } = cruise(3000, 200);
  c.s.units = "imperial";
  const said = c.apSet({ ap: true, athr: true, alt: 3048, spd: 128.6 });
  console.log(`  imperial: ${said}`);
  // (the selection's own step — 10 m — kept: 3050 m are 10007 ft)
  expect(said).toMatch(/1000\d ft/);
  expect(said).toMatch(/25\d kt/);
  expect(said).not.toMatch(/\d m\b|m\/s/);
  c.s.units = "metric";
  const metric = c.apSet({ alt: 3000, spd: 200 });
  console.log(`  metric: ${metric}`);
  expect(metric).toContain("3000 m");
  expect(metric).toContain("200 m/s");
});
