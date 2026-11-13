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

test("a touchdown told in the pilot's units: imperial ft/min down and kt along, metric m/s", async () => {
  const { overPlace } = await import("./helpers/flight");
  const said: string[] = [];
  for (const units of ["imperial", "metric"] as const) {
    const { c, msgs, fly } = overPlace("earth", 28.6, -80.6, 1);
    c.s.units = units;
    fly(2);
    c.pilot.auto = "none";
    c.pilot.setAuto("land");
    fly(240, () => !!c.ourLanded && c.pilot.auto === "none");
    const td = msgs.find((m) => /Touchdown|Hard landing/.test(m)) ?? "";
    console.log(`  ${units}: ${td}`);
    said.push(td);
    resetFlights();
  }
  expect(said[0]).toMatch(/Touchdown on Earth · \d+ ft\/min down, \d+ kt along/);
  expect(said[0]).not.toMatch(/m\/s/);
  expect(said[1]).toMatch(/Touchdown on Earth · [\d.]+ m\/s down, \d+ m\/s along/);
});

test("the lengths and sink rates written in each system", async () => {
  const { unitsOf } = await import("../src/ui/unitsys");
  expect(unitsOf("metric").fVs(1.23)).toBe("1.2 m/s");
  expect(unitsOf("imperial").fVs(1.016)).toBe("200 ft/min");
  expect(unitsOf("metric").fLen(2.5, 1)).toBe("2.5 m");
  expect(unitsOf("imperial").fLen(3.048, 0)).toBe("10 ft");
});
