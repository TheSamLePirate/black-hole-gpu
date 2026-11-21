// Bridge & Road AAA — PR5: Traffic, Furniture and Multi-Level Contact Integration Tests
// Verifies traffic and furniture support on continuous deck, multi-level isolation,
// and elimination of cross-level contamination between ground and bridges.

import { describe, expect, test } from "bun:test";
import { BridgeContinuousProfile, SupportSurfaceRegistry, type SupportRef } from "../src/system/bridge-surface-service";

describe("PR5 — Traffic, Furniture and Contact Integration on Canonical Support", () => {
  test("Rule 3 witness: positive witness detects cross-level contamination, negative witness confirms A/A = 0", () => {
    // Ground elevation is 28.0 m. Elevated viaduct is at 36.0 m.
    const groundZ = 28.0;
    const bridgeZ = 36.0;

    const registry = new SupportSurfaceRegistry();
    const bridgeRef: SupportRef = { assetId: "viaduc_1", surfaceId: "deck_main", revision: "1" };
    const profile = new BridgeContinuousProfile({
      points: [
        [-50, 0, bridgeZ],
        [0, 0, bridgeZ],
        [50, 0, bridgeZ],
      ],
      width: 12.0,
      thickness: 1.5,
      clearance: 6.0,
    });
    registry.registerBridge(bridgeRef, profile, 1);

    // Naive legacy behavior: pure 2D lookup without vertical check
    const legacyDeckHeightAt = (x: number, y: number): number | null => {
      const proj = profile.project(x, y);
      if (proj.distance <= profile.width / 2 + 1.5) {
        return profile.elevationAt(proj.s);
      }
      return null;
    };

    // Modern behavior: level & elevation-aware query
    const modernDeckHeightAt = (x: number, y: number, expectedZ?: number, expectedLayer?: number): number | null => {
      const sample = registry.queryBridgeAt(x, y, {
        expectedZ,
        expectedLevel: expectedLayer,
        maxDeltaZ: expectedZ !== undefined ? 2.5 : undefined,
      });
      return sample ? sample.elevation : null;
    };

    // Query for a ground car passing under the bridge at (0, 0, groundZ)
    const legacyResult = legacyDeckHeightAt(0, 0);
    // Legacy mistakenly returns 36.0 m for a ground car!
    const legacyDeltaFromGround = Math.abs((legacyResult ?? groundZ) - groundZ);

    // Modern query for ground car: expectedZ = 28.0 m, bridge is 8m above -> returns null (stays on ground)
    const modernGroundQueryA = modernDeckHeightAt(0, 0, groundZ);
    const modernGroundQueryB = modernDeckHeightAt(0, 0, groundZ);

    // Negative witness: A/A = 0
    expect(modernGroundQueryA).toBe(modernGroundQueryB);
    expect(modernGroundQueryA).toBeNull(); // Correctly stays at ground level!

    // Positive witness: legacy behavior defect detected (> 7m jump)
    expect(legacyDeltaFromGround).toBeGreaterThan(7.0);
  });

  test("ground traffic remains strictly on ground under elevated bridges", () => {
    const registry = new SupportSurfaceRegistry();
    const bridgeRef: SupportRef = { assetId: "viaduct_paris", surfaceId: "deck", revision: "1" };
    const profile = new BridgeContinuousProfile({
      points: [
        [-100, 0, 42.0],
        [0, 0, 44.0],
        [100, 0, 42.0],
      ],
      width: 14.0,
      thickness: 1.8,
      clearance: 8.0,
    });
    registry.registerBridge(bridgeRef, profile, 1);

    const groundZ = 30.0;

    // Ground vehicle at various points along the road passing underneath (y from -30 to +30 across bridge)
    for (let y = -20; y <= 20; y += 5) {
      // Ground query with expectedZ = groundZ
      const deckMatch = registry.queryBridgeAt(0, y, { expectedZ: groundZ, maxDeltaZ: 2.0 });
      // Ground vehicle must not snap to the bridge overhead (which is at 44.0m)
      expect(deckMatch).toBeNull();

      // General query also confirms ground role
      const support = registry.query([0, y, groundZ], groundZ, 2.0);
      expect(support.surfaceRole).toBe("ground");
      expect(support.elevation).toBe(groundZ);
    }
  });

  test("bridge traffic follows continuous deck elevation and slope", () => {
    const registry = new SupportSurfaceRegistry();
    const bridgeRef: SupportRef = { assetId: "bridge_seine", surfaceId: "deck", revision: "1" };
    const profile = new BridgeContinuousProfile({
      points: [
        [-50, 0, 32.0],
        [0, 0, 35.0],
        [50, 0, 33.0],
      ],
      width: 12.0,
      thickness: 1.2,
      clearance: 5.5,
    });
    registry.registerBridge(bridgeRef, profile, 1);

    // Bridge car traversing the bridge from s=0 to s=100
    for (let s = 0; s <= 100; s += 10) {
      const sample = profile.sample(s, 0);
      const [x, y, expectedDeckZ] = sample.position;

      // Query bridge deck with expectedLayer = 1
      const queryResult = registry.queryBridgeAt(x, y, { expectedLevel: 1 });
      expect(queryResult).not.toBeNull();
      expect(queryResult!.elevation).toBeCloseTo(expectedDeckZ, 4);
      expect(queryResult!.surfaceRole).toBe("carriageway");
    }
  });

  test("multi-level bridge crossing: layer 1 and layer 2 maintain complete isolation", () => {
    const registry = new SupportSurfaceRegistry();

    // Layer 1: Lower bridge running East-West at z = 35.0 m
    const lowerRef: SupportRef = { assetId: "bridge_lower", surfaceId: "deck_lower", revision: "1" };
    const lowerProfile = new BridgeContinuousProfile({
      points: [
        [-50, 0, 35.0],
        [0, 0, 35.0],
        [50, 0, 35.0],
      ],
      width: 10.0,
      thickness: 1.2,
      clearance: 5.0,
    });
    registry.registerBridge(lowerRef, lowerProfile, 1);

    // Layer 2: Upper flyover running North-South at z = 44.0 m
    const upperRef: SupportRef = { assetId: "bridge_upper", surfaceId: "deck_upper", revision: "1" };
    const upperProfile = new BridgeContinuousProfile({
      points: [
        [0, -50, 44.0],
        [0, 0, 44.0],
        [0, 50, 44.0],
      ],
      width: 10.0,
      thickness: 1.5,
      clearance: 7.0,
    });
    registry.registerBridge(upperRef, upperProfile, 2);

    const expectedLowerZ = lowerProfile.elevationAt(50);
    const expectedUpperZ = upperProfile.elevationAt(50);

    // At crossing point (0, 0):
    // 1. Query for Layer 1 car
    const layer1Result = registry.queryBridgeAt(0, 0, { expectedLevel: 1 });
    expect(layer1Result).not.toBeNull();
    expect(layer1Result!.elevation).toBeCloseTo(expectedLowerZ, 3);
    expect(layer1Result!.supportRef?.surfaceId).toBe("deck_lower");

    // 2. Query for Layer 2 car
    const layer2Result = registry.queryBridgeAt(0, 0, { expectedLevel: 2 });
    expect(layer2Result).not.toBeNull();
    expect(layer2Result!.elevation).toBeCloseTo(expectedUpperZ, 3);
    expect(layer2Result!.supportRef?.surfaceId).toBe("deck_upper");

    // 3. Query with expected elevation z = expectedLowerZ
    const matchLowerByZ = registry.queryBridgeAt(0, 0, { expectedZ: expectedLowerZ, maxDeltaZ: 2.0 });
    expect(matchLowerByZ).not.toBeNull();
    expect(matchLowerByZ!.elevation).toBeCloseTo(expectedLowerZ, 3);

    // 4. Query with expected elevation z = expectedUpperZ
    const matchUpperByZ = registry.queryBridgeAt(0, 0, { expectedZ: expectedUpperZ, maxDeltaZ: 2.0 });
    expect(matchUpperByZ).not.toBeNull();
    expect(matchUpperByZ!.elevation).toBeCloseTo(expectedUpperZ, 3);

    // Vertical difference between levels is preserved with zero cross-level bleeding
    expect(layer2Result!.elevation - layer1Result!.elevation).toBeCloseTo(expectedUpperZ - expectedLowerZ, 3);
  });

  test("ground furniture (guardrails, street lamps) under a bridge do not jump to the bridge deck", () => {
    const registry = new SupportSurfaceRegistry();
    const bridgeRef: SupportRef = { assetId: "pont_national", surfaceId: "deck", revision: "1" };
    const profile = new BridgeContinuousProfile({
      points: [
        [-60, 0, 38.0],
        [0, 0, 39.5],
        [60, 0, 38.0],
      ],
      width: 16.0,
      thickness: 1.5,
      clearance: 6.5,
    });
    registry.registerBridge(bridgeRef, profile, 1);

    const groundZ = 29.0;
    // Ground guardrail at (0, 0, 29.0)
    const guardrailPos: [number, number, number] = [0, 0, groundZ];

    // With level-aware deck check: expectedZ = guardrailPos[2]
    const deckMatch = registry.queryBridgeAt(guardrailPos[0], guardrailPos[1], {
      expectedZ: guardrailPos[2],
      maxDeltaZ: 1.5,
    });

    // Deck is at 39.5m, guardrail is at 29.0m (delta = 10.5m > 1.5m)
    // deckMatch must be null so guardrail base remains at groundZ
    expect(deckMatch).toBeNull();
    const effectiveBase = deckMatch ? deckMatch.elevation : guardrailPos[2];
    expect(effectiveBase).toBe(groundZ);
  });
});
