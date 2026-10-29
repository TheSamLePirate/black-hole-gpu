// The free camera's speed (docs/PLAN-CAMERA-AAA.md CAM3): a height a second — the height over the nearest thing, so
// one crawls by a ridge and crosses the void between the planets in a few seconds —, the nearest taken softly among
// all of them (no body "taking over": the speed never jumps when another world becomes the nearest), × the player's
// multiplier, in one range for the wheel and the panel's slider. Pure.

/** the multiplier's range (the wheel's and the camera panel's) */
export const FLY_SPEED_MIN = 1 / 16;
export const FLY_SPEED_MAX = 32;

/** The heights' soft minimum: (Σ hᵢ⁻⁴)^(−1/4) — the least of them when one is far below the others, smooth as two
 *  come near each other (two bodies at the same height: 16 % under it). Non-positive or missing: ignored. */
export function softHeight(hs: number[]): number {
  let m = Number.POSITIVE_INFINITY;
  for (const h of hs) if (h > 0 && h < m) m = h;
  if (!Number.isFinite(m)) return m;
  let sum = 0;
  for (const h of hs) if (h > 0 && Number.isFinite(h)) sum += (m / h) ** 4;
  return m / sum ** 0.25;
}
