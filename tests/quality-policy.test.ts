import { expect, test } from "bun:test";
import { automaticQuality, earthMapQuality, effectiveQuality, promotionEligible } from "../src/quality-policy";
import { defaultSettings } from "../src/settings";
import { cappedRatio, tierAt } from "../src/tier";

const game = () => ({
  ...defaultSettings(),
  quality: "game" as const,
  dynamicResolution: true,
  realtimeSubsampling: "auto" as const,
  realtimeSteps: 1000,
  realtimeEps: 0.05,
  targetSpp: 256,
  noiseThreshold: 0.01,
});

test("weak GPU: Game automatic caps cost and exposes the effective sample target", () => {
  expect(effectiveQuality(game(), tierAt(1, "test"))).toEqual({
    realtimeSteps: 250,
    realtimeEps: 0.14,
    targetSpp: 16,
    noiseThreshold: 0.03,
    capped: true,
  });
});

test("manual precision and disabled noise convergence survive every hardware tier", () => {
  for (const level of [0, 1, 2, 3, 4] as const) {
    for (const patch of [{ dynamicResolution: false }, { realtimeSubsampling: 1 as const }, { quality: "ultra" as const }]) {
      const s = { ...game(), ...patch };
      expect(automaticQuality(s)).toBe(false);
      expect(effectiveQuality(s, tierAt(level, "test"))).toEqual({
        realtimeSteps: 1000,
        realtimeEps: 0.05,
        targetSpp: 256,
        noiseThreshold: 0.01,
        capped: false,
      });
    }
    expect(effectiveQuality({ ...game(), noiseThreshold: 0 }, tierAt(level, "test")).noiseThreshold).toBe(0);
  }
});

test("1080p tier 2 can lift its precision cap even without a pixel cap", () => {
  const tier = tierAt(2, "test");
  const s = game();
  const state = {
    automatic: true,
    stable: true,
    pixelCapped: cappedRatio(1, 1920, 1080, tier.capMpx) < 1,
    precisionCapped: effectiveQuality(s, tier).capped,
    tier,
    scale: 1,
    block: 2,
    sinceDemotionMs: 61000,
    measuredMs: 5,
    budgetMs: 16,
  };
  expect(state.pixelCapped).toBe(false);
  expect(promotionEligible(state)).toBe(true);
  for (const patch of [
    { automatic: false },
    { stable: false },
    { scale: 0.5 },
    { block: 8 },
    { sinceDemotionMs: 60000 },
    { measuredMs: 0 },
    { measuredMs: 9 },
  ]) {
    expect(promotionEligible({ ...state, ...patch })).toBe(false);
  }
});

test("Earth camera/vessel requests share the live cap; exports and manual mode retain high maps", () => {
  const weak = tierAt(1, "test");
  expect(earthMapQuality("high", true, false, weak, "high")).toBe("med");
  expect(earthMapQuality("high", true, true, weak, "high")).toBe("high");
  expect(earthMapQuality("high", false, false, weak, "high")).toBe("high");
  expect(earthMapQuality("high", true, true, weak, "med")).toBe("med");
  expect(earthMapQuality("high", true, true, weak, "none")).toBeNull();
  expect(earthMapQuality(null, false, true, weak, "high")).toBeNull();
});
