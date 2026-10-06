import { QUALITY, type Settings } from "./settings";
import type { Tier } from "./tier";

const STEPS = [150, 250, 350, Infinity, Infinity] as const;
const EPS = [0.18, 0.14, 0.1, 0, 0] as const;
const SPP = [16, 16, Infinity, Infinity, Infinity] as const;
const NOISE = [0.03, 0.03, 0, 0, 0] as const;

/** The dynamic resolution at work: the render scale governed, within the tier's pixel budget — at any
 * quality where it is turned on (the Game quality turns it on). */
export function dynamicResolutionOn(s: Pick<Settings, "dynamicResolution" | "realtimeSubsampling">): boolean {
  return s.dynamicResolution && s.realtimeSubsampling === "auto";
}

/** Only Game's automatic mode delegates quality to the GPU governor. */
export function automaticQuality(s: Pick<Settings, "quality" | "dynamicResolution" | "realtimeSubsampling">): boolean {
  return s.quality === "game" && dynamicResolutionOn(s);
}

/**
 * Effective live values. Game's automatic mode caps them by the tier — only the values the Game
 * quality set: one raised or lowered by hand (the panel's "Custom") is the player's, kept as set
 * (audit M8). A disabled noise threshold stays disabled.
 */
export function effectiveQuality(s: Settings, tier: Tier) {
  const auto = automaticQuality(s);
  const level = tier.level;
  const governed = (k: "realtimeSteps" | "realtimeEps" | "targetSpp" | "noiseThreshold") => auto && s[k] === QUALITY.game[k];
  const result = {
    realtimeSteps: governed("realtimeSteps") ? Math.min(s.realtimeSteps, STEPS[level]) : s.realtimeSteps,
    realtimeEps: governed("realtimeEps") ? Math.max(s.realtimeEps, EPS[level]) : s.realtimeEps,
    targetSpp: governed("targetSpp") ? Math.min(s.targetSpp, SPP[level]) : s.targetSpp,
    noiseThreshold: governed("noiseThreshold") && s.noiseThreshold > 0 ? Math.max(s.noiseThreshold, NOISE[level]) : s.noiseThreshold,
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

/** Promotion requires stable live work and unused budget, whether pixels or precision are capped —
 * and no Kerr Bench running: a tier changed mid-run (and remembered) would change the steps it measures. */
export function promotionEligible(o: {
  automatic: boolean;
  benching: boolean;
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
    !o.benching &&
    o.stable &&
    (o.pixelCapped || o.precisionCapped || o.tier.level <= 1) &&
    o.scale === 1 &&
    o.block <= 4 &&
    o.sinceDemotionMs > 60_000 &&
    o.measuredMs > 0 &&
    o.measuredMs < 0.5 * o.budgetMs
  );
}

/** Demotion — the promotion's missing half (plan §3.4): over the budget and a half at the coarsest
 * block and the smallest scale, the live work stable; never while a Kerr Bench runs. */
export function demotionEligible(o: {
  automatic: boolean;
  benching: boolean;
  stable: boolean;
  scale: number;
  block: number;
  measuredMs: number;
  budgetMs: number;
}): boolean {
  return o.automatic && !o.benching && o.stable && o.scale === 0.5 && o.block >= 8 && o.measuredMs > 1.5 * o.budgetMs;
}
