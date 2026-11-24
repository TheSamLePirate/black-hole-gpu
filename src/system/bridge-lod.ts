// Bridge & Road AAA — a bridge's level of detail in the scene (PLAN-PONT-ROUTES-AAA PR7; review A8, 24 Nov 2026; every bridge drawn,
// 25 Nov 2026).
//
// The scene worker builds each deck once (scenery-worker.ts deckBridge); its distance to the eye or the scene's centre picks its detail
// here: the stations' spacing (the slices' length — the same profile sampled coarser: its stations on the vertical curve, chords
// between them; the contact, the cars and the lamps read those same chords — profile.deckAt —, so a coarser deck is never a mismatch)
// and whether its parapets and piers are drawn. What PR7 also claimed — a per-slice 3D envelope culling — is not done and was removed: the bridges' triangles are drawn in
// the scene's one mesh list (scenery-raster.ts meshVs, the GPU clips them), each slice's box is the BVH's; culling slices would need
// their own indirect draws for a few thousand triangles. The far bridges past the scene are StreetFar's (street-far.ts farBridges).
//
// (25 Nov 2026) No count's cap any more: the scene's decks share BRIDGE_SHARE of its bytes, nearest first, and the share's use — the
// `pressure`, 0 … 1 — coarsens the detail of those that come after it, down to the coarsest (80 m chords, no parapet, no pier), so a
// dense city draws every bridge in its scene coarser rather than its farther ones not at all (Paris hit the old 256 × k² = 1 024 in every
// view of campaign 2, 24 Nov 2026). Past the share a deck is left out, counted (the scene's stats: bridgesDropped).

export interface BridgeLODConfig {
  readonly lodLevel: 0 | 1 | 2 | 3;
  readonly sliceLengthM: number;
  readonly drawParapets: boolean;
  readonly drawPiers: boolean;
}

/** the decks' share of the scene's bytes (scenery-worker.ts: `budget`) */
export const BRIDGE_SHARE = 0.3;

const LEVELS: readonly BridgeLODConfig[] = [
  { lodLevel: 0, sliceLengthM: 10, drawParapets: true, drawPiers: true },
  { lodLevel: 1, sliceLengthM: 20, drawParapets: true, drawPiers: true },
  { lodLevel: 2, sliceLengthM: 40, drawParapets: false, drawPiers: true },
  { lodLevel: 3, sliceLengthM: 80, drawParapets: false, drawPiers: false },
];

/**
 * A deck's detail by its distance [m] — 10 m slices with parapets near, 20 m to 2.5 km, 40 m without parapets (under a pixel) to 6 km,
 * 80 m without piers beyond — and by the decks' share already used (`pressure` 0 … 1: half used, at least 20 m; three quarters, 40 m;
 * nine tenths, 80 m): the coarser of the two.
 */
export function selectBridgeLOD(distanceM: number, pressure = 0): BridgeLODConfig {
  const byDistance = distanceM < 600 ? 0 : distanceM < 2500 ? 1 : distanceM < 6000 ? 2 : 3;
  const byShare = pressure >= 0.9 ? 3 : pressure >= 0.75 ? 2 : pressure >= 0.5 ? 1 : 0;
  return LEVELS[Math.max(byDistance, byShare)]!;
}
