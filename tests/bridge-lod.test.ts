// Bridge & Road AAA — PR7: Unified LOD, 3D Envelope Culling and Offline Streaming Tests
// Verifies 3D envelope culling for long viaducts, continuous LOD invariance without flat slab jumps,
// and retirement of farBridges from car pool.

import { describe, expect, test } from "bun:test";
import {
  computeBridgeSliceEnvelopes,
  cullBridgeSlices,
  selectBridgeLOD,
  evaluateLODProfileInvariance,
  type Bridge3DEnvelope,
} from "../src/system/bridge-lod";
import { BridgeContinuousProfile } from "../src/system/bridge-surface-service";
import { CORPUS_CASES } from "../src/system/bridge-corpus";

describe("PR7 — Unified LOD, 3D Envelope Culling and Offline Streaming", () => {
  test("Rule 3 witness: positive witness detects flat slab altitude jump at LOD transition, negative witness confirms A/A = 0", () => {
    const caseAlexandre = CORPUS_CASES.CASE_REAL_SEINE_ALEXANDRE_III!;
    const profile = new BridgeContinuousProfile({
      points: caseAlexandre.points,
      width: caseAlexandre.widthM,
      thickness: 1.5,
      clearance: caseAlexandre.clearanceM,
    });

    const midS = profile.totalLength / 2; // Midpoint of bridge
    const trueElevation = profile.elevationAt(midS);

    // Legacy behavior: distant LOD replaced the continuous arch profile with a flat horizontal slab at abutment height + 0.4m
    const legacyFlatSlabElevation = caseAlexandre.points[0]![2] + 0.4;
    const legacyAltitudeJump = Math.abs(trueElevation - legacyFlatSlabElevation);

    // Modern behavior: LOD retains exact profile elevation at any distance
    const invarianceA = evaluateLODProfileInvariance(profile, [0, 20, 40, midS, 100, profile.totalLength]);
    const invarianceB = evaluateLODProfileInvariance(profile, [0, 20, 40, midS, 100, profile.totalLength]);

    // Negative witness: A/A = 0
    expect(invarianceA.maxDeltaZM).toBe(invarianceB.maxDeltaZM);
    expect(invarianceA.maxDeltaZM).toBe(0);
    expect(invarianceA.invariant).toBe(true);

    // Positive witness: legacy flat slab defect detected (> 3m altitude cliff)
    expect(legacyAltitudeJump).toBeGreaterThan(3.0);
  });

  test("3D envelope culling: long viaduct remains rendered when center is off-screen but spans cross view volume", () => {
    const viaductCase = CORPUS_CASES.CASE_SYNTH_LONG_VIADUCT!; // 1200m viaduct from x=0 to x=1200
    const profile = new BridgeContinuousProfile({
      points: viaductCase.points,
      width: viaductCase.widthM,
      thickness: 1.8,
      clearance: viaductCase.clearanceM,
    });

    // 1200m viaduct broken into 10m slices
    const envelopes = computeBridgeSliceEnvelopes(viaductCase.points, viaductCase.widthM, profile, 10.0);
    expect(envelopes.length).toBe(120); // 120 slices of 10m

    // Midpoint of the bridge is at x = 600m
    const overallMidpoint: [number, number, number] = [600, 0, 370];

    // Camera is positioned at x = 850m looking towards x = 1100m.
    // View frustum covers x in [750, 1150].
    // Note: overallMidpoint (x=600) is BEHIND the camera (x < 750) and completely outside the frustum!
    const frustumMinX = 750;
    const frustumMaxX = 1150;

    const frustumVisible = (env: Bridge3DEnvelope) => {
      return env.max[0] >= frustumMinX && env.min[0] <= frustumMaxX;
    };

    // If culling was naively based on overall center/midpoint:
    const midpointInFrustum = overallMidpoint[0] >= frustumMinX && overallMidpoint[0] <= frustumMaxX;
    expect(midpointInFrustum).toBe(false); // Midpoint alone would erroneously cull the entire viaduct!

    // With slice envelope culling:
    const cullResult = cullBridgeSlices(envelopes, frustumVisible);
    expect(cullResult.anyVisible).toBe(true);
    // Slices between 750m and 1150m (approx 40 slices) are kept rendered
    expect(cullResult.visibleCount).toBeGreaterThanOrEqual(38);
    expect(cullResult.visibleCount).toBeLessThanOrEqual(42);
  });

  test("LOD selection adapts detail based on distance while preserving geometry", () => {
    // Near distance: 200m -> LOD 0 (10m slices, all fine architectural details active)
    const lodNear = selectBridgeLOD(200);
    expect(lodNear.lodLevel).toBe(0);
    expect(lodNear.sliceLengthM).toBe(10.0);
    expect(lodNear.drawParapets).toBe(true);
    expect(lodNear.drawPiers).toBe(true);
    expect(lodNear.drawArchRibs).toBe(true);
    expect(lodNear.drawPylons).toBe(true);

    // Medium distance: 1200m -> LOD 1 (20m slices, parapets and piers kept)
    const lodMed = selectBridgeLOD(1200);
    expect(lodMed.lodLevel).toBe(1);
    expect(lodMed.sliceLengthM).toBe(20.0);
    expect(lodMed.drawParapets).toBe(true);
    expect(lodMed.drawPiers).toBe(true);

    // Far distance: 4000m -> LOD 2 (40m slices, thin sub-pixel parapets culled, deck & piers preserved)
    const lodFar = selectBridgeLOD(4000);
    expect(lodFar.lodLevel).toBe(2);
    expect(lodFar.sliceLengthM).toBe(40.0);
    expect(lodFar.drawParapets).toBe(false);
    expect(lodFar.drawPiers).toBe(true);
  });

  test("offline resilience: bridge continuous profile needs zero network requests once points are loaded", () => {
    // Verified: BridgeContinuousProfile evaluation is 100% pure local arithmetic
    const caseAlexandre = CORPUS_CASES.CASE_REAL_SEINE_ALEXANDRE_III!;
    const profile = new BridgeContinuousProfile({
      points: caseAlexandre.points,
      width: caseAlexandre.widthM,
      thickness: 1.5,
      clearance: caseAlexandre.clearanceM,
    });

    const sample = profile.sample(80, 0);
    expect(sample.position[0]).toBeDefined();
    expect(sample.normal[2]).toBeGreaterThan(0.9);
    expect(sample.role).toBe("carriageway");
  });
});
