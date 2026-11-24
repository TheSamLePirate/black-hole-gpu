// Bridge & Road AAA — a bridge's level of detail in the scene (PLAN-PONT-ROUTES-AAA PR7; review A8, 24 Nov 2026).
//
// The scene worker builds each deck once (scenery-worker.ts deckBridge); its distance to the eye or the scene's centre picks its detail
// here: the stations' spacing (the slices' length — the same profile sampled coarser: its stations on the vertical curve, chords
// between them; the contact, the cars and the lamps read those same chords — profile.deckAt —, so a coarser deck is never a mismatch)
// and whether its parapets and piers are drawn. What PR7 also claimed — a per-slice 3D envelope culling — is not done and was removed: the bridges' triangles are drawn in
// the scene's one mesh list (scenery-raster.ts meshVs, the GPU clips them), each slice's box is the BVH's; culling slices would need
// their own indirect draws for a few thousand triangles. The far bridges past the scene are StreetFar's (street-far.ts farBridges).

export interface BridgeLODConfig {
  readonly lodLevel: 0 | 1 | 2;
  readonly sliceLengthM: number;
  readonly drawParapets: boolean;
  readonly drawPiers: boolean;
}

/** a deck's detail by its distance [m]: 10 m slices with parapets near, 20 m to 2.5 km, 40 m beyond without parapets (under a pixel) */
export function selectBridgeLOD(distanceM: number): BridgeLODConfig {
  if (distanceM < 600) return { lodLevel: 0, sliceLengthM: 10, drawParapets: true, drawPiers: true };
  if (distanceM < 2500) return { lodLevel: 1, sliceLengthM: 20, drawParapets: true, drawPiers: true };
  return { lodLevel: 2, sliceLengthM: 40, drawParapets: false, drawPiers: true };
}
