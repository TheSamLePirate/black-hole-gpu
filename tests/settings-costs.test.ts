import { expect, test } from "bun:test";
import { SCHEMA_BY_KEY, type ChoiceDef, type NumberDef } from "../src/ui/schema";
import { COSTS_MEASURED, SETTING_COSTS } from "../src/ui/settings/costs";
import { playerKeys } from "../src/ui/settings/menu";
import { costDots, costShare } from "../src/ui/settings/values";

// The graphics settings' GPU costs (PLAN-TITRE-AAA E9b): the dots' scale; each cost measured is a setting of the
// player's screen, its two values valid for it, its frame times real, the measure dated and its machine named.

test("the dots: none within the noise, then a tenth, a quarter, a half, the whole frame", () => {
  expect(costShare({ lightMs: 10, heavyMs: 12 })).toBeCloseTo(0.2, 6);
  expect(costShare({ lightMs: 0, heavyMs: 5 })).toBe(0);
  expect([0.01, 0.05, 0.2, 0.4, 0.8, 1.5].map(costDots)).toEqual([0, 1, 2, 3, 4, 5]);
  // (cheaper heavy: within the noise — no dot)
  expect(costDots(-0.2)).toBe(0);
});

test("each cost measured: a player's setting, its values valid, its times real, the measure dated", () => {
  const keys = playerKeys();
  const entries = Object.entries(SETTING_COSTS);
  if (entries.length) {
    expect(COSTS_MEASURED.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(COSTS_MEASURED.machine.length).toBeGreaterThan(2);
  }
  for (const [k, c] of entries) {
    expect(keys).toContain(k as never);
    const d = SCHEMA_BY_KEY.get(k as never)!;
    for (const v of [c!.light, c!.heavy]) {
      if (d.type === "toggle") expect(typeof v).toBe("boolean");
      else if (d.type === "choice") expect((d as ChoiceDef).options.map((o) => o.value)).toContain(v as never);
      else if (d.type === "number") {
        expect(v as number).toBeGreaterThanOrEqual((d as NumberDef).min);
        expect(v as number).toBeLessThanOrEqual((d as NumberDef).max);
      }
    }
    expect(c!.lightMs).toBeGreaterThan(0);
    expect(c!.heavyMs).toBeGreaterThan(0);
    expect(c!.view.length).toBeGreaterThan(2);
  }
});
