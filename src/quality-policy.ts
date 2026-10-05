import type { Settings } from "./settings";
import type { Tier } from "./tier";

const STEPS = [150, 250, 350, Infinity, Infinity] as const;
const EPS = [0.18, 0.14, 0.1, 0, 0] as const;
const SPP = [16, 16, Infinity, Infinity, Infinity] as const;
const NOISE = [0.03, 0.03, 0, 0, 0] as const;

/** Only Game's automatic mode delegates quality to the GPU governor. */
export function automaticQuality(s: Pick<Settings, "quality" | "dynamicResolution" | "realtimeSubsampling">): boolean {
  return s.quality === "game" && s.dynamicResolution && s.realtimeSubsampling === "auto";
}

/** Effective live values; manual choices and a disabled noise threshold are preserved. */
export function effectiveQuality(s: Settings, tier: Tier) {
  const auto = automaticQuality(s);
  const level = tier.level;
  const result = {
    realtimeSteps: auto ? Math.min(s.realtimeSteps, STEPS[level]) : s.realtimeSteps,
    realtimeEps: auto ? Math.max(s.realtimeEps, EPS[level]) : s.realtimeEps,
    targetSpp: auto ? Math.min(s.targetSpp, SPP[level]) : s.targetSpp,
    noiseThreshold: auto && s.noiseThreshold > 0 ? Math.max(s.noiseThreshold, NOISE[level]) : s.noiseThreshold,
  };
  return {
    ...result,
    capped:
      result.realtimeSteps !== s.realtimeSteps ||
      result.realtimeEps !== s.realtimeEps ||
      result.targetSpp !== s.targetSpp ||
      result.noiseThreshold !== s.noiseThreshold,
  };
}

/** Apply the texture policy after all camera/vessel requests; memory failures still cap exports. */
export function earthMapQuality(
  wanted: "med" | "high" | null,
  automatic: boolean,
  offline: boolean,
  tier: Tier,
  memoryCap: "none" | "med" | "high",
): "med" | "high" | null {
  if (wanted === null || memoryCap === "none") return null;
  return wanted === "high" && (memoryCap === "med" || (automatic && !offline && tier.level <= 1)) ? "med" : wanted;
}

/** Promotion requires stable live work and unused budget, whether pixels or precision are capped. */
export function promotionEligible(o: {
  automatic: boolean;
  stable: boolean;
  pixelCapped: boolean;
  precisionCapped: boolean;
  tier: Tier;
  scale: number;
  block: number;
  sinceDemotionMs: number;
  measuredMs: number;
  budgetMs: number;
}): boolean {
  return (
    o.automatic &&
    o.stable &&
    (o.pixelCapped || o.precisionCapped || o.tier.level <= 1) &&
    o.scale === 1 &&
    o.block <= 4 &&
    o.sinceDemotionMs > 60_000 &&
    o.measuredMs > 0 &&
    o.measuredMs < 0.5 * o.budgetMs
  );
}
