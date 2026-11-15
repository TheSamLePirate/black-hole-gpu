import { defaultSettings, QUALITY, type Settings } from "./settings";
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

/**
 * The Earth's maps after all camera/vessel requests: a weak tier's live view in Game automatic keeps
 * the medium ones (the high cube is ~60 MB of network and ~96 MB of VRAM — plan §3.5), an export (the
 * frame drawn into another target than the live one) keeps its choice; memory failures cap both.
 * The ground a craft stands on is the relief drawn (renderer.ts: requestEarthMaps), so with no terrain
 * tile under it the collision ground follows this choice — the hardware tier's, deliberately: what is
 * hit is what is seen, and the high heights for the physics alone would be 64 MB more of CPU memory on
 * the weakest devices.
 */
export function earthMapQuality(
  wanted: "med" | "high" | null,
  automatic: boolean,
  exporting: boolean,
  tier: Tier,
  memoryCap: "none" | "med" | "high",
): "med" | "high" | null {
  if (wanted === null || memoryCap === "none") return null;
  return wanted === "high" && (memoryCap === "med" || (automatic && !exporting && tier.level <= 1)) ? "med" : wanted;
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

const DEFAULTS = defaultSettings();
/**
 * The Earth's detail as this device draws it: the defaults — the scenery high, its detail very far — kept on a capable
 * machine; on a modest one (tier ≤ 1: a phone, a tablet, an integrated GPU, 4 GB of memory, the software adapter), with the
 * realtime subsampling on automatic — the game adapting —, the lighter ones (balanced, normal: a quarter of the tiles, half
 * the scenery's box). A value the player chose other than the default is theirs, kept as set (as effectiveQuality's).
 */
export function earthDetailFor(
  s: Pick<Settings, "earthScenery" | "detailReach" | "realtimeSubsampling">,
  tier: Pick<Tier, "level">,
): { scenery: Settings["earthScenery"]; reach: Settings["detailReach"] } {
  const modest = tier.level <= 1 && s.realtimeSubsampling === "auto";
  return {
    scenery: modest && s.earthScenery === DEFAULTS.earthScenery && s.earthScenery === "high" ? "balanced" : s.earthScenery,
    reach: modest && s.detailReach === DEFAULTS.detailReach && s.detailReach !== "normal" ? "normal" : s.detailReach,
  };
}

/** The playable floor (Sam's decision, 15 Nov 2026 — the raster's fallback to the traced pipeline retired, decision (b)): under
 *  LOW_RATE_FLOOR images a second held LOW_RATE_HOLD_S seconds in flight on the raster, lighter settings are proposed to the player,
 *  applied only if accepted — « proposer, pas imposer »: no image changed without the player's yes. */
export const LOW_RATE_FLOOR = 15;
export const LOW_RATE_HOLD_S = 12;
/** the device's refusal remembered (not proposed again on it); the e2e set it at boot — no proposal over a measure */
export const LOW_RATE_REFUSED_KEY = "kerr.lowrate-refused";

export type LighterSettings = Partial<Pick<Settings, "earthRasterScale" | "earthScenery" | "detailReach">>;
/** the raster's motion scales the settings offer (ui/schema.ts earthRasterScale's options — tests/low-rate-offer.test.ts holds them
 *  equal), finest first */
export const RASTER_SCALES = [1, 0.833, 0.75, 0.667] as const;
/** One step lighter than these, on what costs most and shows least: the raster's motion scale the next one down in the settings'
 *  list (the held view refines at the full one anyway), the scenery balanced, the detail's reach one step nearer. Only what is not
 *  already at its lightest; empty: nothing left to propose. */
export function lighterSettings(s: Pick<Settings, "earthRasterScale" | "earthScenery" | "detailReach">): LighterSettings {
  const o: LighterSettings = {};
  const down = RASTER_SCALES.find((v) => v < s.earthRasterScale - 1e-3);
  if (down !== undefined) o.earthRasterScale = down;
  if (s.earthScenery === "high") o.earthScenery = "balanced";
  if (s.detailReach === "veryFar") o.detailReach = "far";
  else if (s.detailReach === "far") o.detailReach = "normal";
  return o;
}
