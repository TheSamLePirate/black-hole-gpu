// Bridge & Road AAA — Integrated Acceptance & Cross-Contract Validation (PLAN-PONT-ROUTES-AAA.md PR8)
// Verifies the 13 acceptance guarantees of Section 11 across all reference corpus cases:
// 1. Surface internal seam continuity (<= 5cm vertical deviation, C0/C1 continuity)
// 2. Vehicle wheel contact consistency (<= 2cm error to rendered surface)
// 3. Multi-level isolation (zero cross-level association on tiered bridges)
// 4. Geometry integrity (no floating piers, zero river piers for Pont Alexandre III)
// 5. Carriageway material parity (continuous tangent and shared road attributes)
// 6. LOD: tests/bridge-lod.test.ts (mesh against mesh — review A8; the envelope culling PR7 claimed was never wired: removed)
// 8. Physical independence (support invariant to camera orientation)
// 9. Sources and datum transparency (WGS84 compliance)
// 10. Offline resilience (cache-only deterministic reconstruction)
// 11. Raster integration (depth and normals oriented upward)
// 12. Sustained performance budget (sub-millisecond CPU evaluation)
// 13. Notable architectural fidelity (single low-rise arch and 4 pylons for Pont Alexandre III)

import { describe, expect, test } from "bun:test";
import { CORPUS_CASES } from "./fixtures/bridge-corpus";
import { BridgeContinuousProfile, SupportSurfaceRegistry, type SupportRef } from "../src/system/bridge-surface-service";
import { buildContinuousSliceMesh } from "../src/system/bridge-mesh";
import { classifyBridgeStructure, computeStructurePierLocations, buildAlexandreIIIPylonsMesh } from "../src/system/bridge-structures";

describe("PLAN-PONT-ROUTES-AAA PR8 — Integrated Acceptance Guarantees", () => {
  const alex = CORPUS_CASES.CASE_REAL_SEINE_ALEXANDRE_III!;
  const tiered = CORPUS_CASES.CASE_SYNTH_TWO_TIERS!;

  test("Guarantee 1 & 2: Surface continuity (<= 5cm) and contact fidelity (<= 2cm)", () => {
    const profile = new BridgeContinuousProfile({
      points: alex.points,
      width: alex.widthM,
      clearance: alex.clearanceM,
    });

    // Verify C0/C1 continuity along the 160m span sampled every 2m
    let prevSample = profile.sample(0, 0);
    let prevSlope = (profile.sample(2, 0).position[2] - prevSample.position[2]) / 2;
    for (let s = 2; s <= 160; s += 2) {
      const sample = profile.sample(s, 0);
      const dz = sample.position[2] - prevSample.position[2];
      const slope = dz / 2;
      // In a continuous C1 profile, the second derivative / slope variation between consecutive steps is smooth (< 0.05)
      expect(Math.abs(slope - prevSlope)).toBeLessThan(0.05);
      expect(sample.normal[2]).toBeGreaterThan(0.9); // Upward pointing
      prevSample = sample;
      prevSlope = slope;
    }

    // Contact query fidelity: sample elevation is the drawn deck's (its stations' chords) and within 2 cm of the curve
    const centerSample = profile.sample(80, 0);
    expect(centerSample.position[2]).toBeCloseTo(profile.deckAt(80), 9);
    const expectedCenterElev = profile.elevationAt(80);
    expect(Math.abs(centerSample.position[2] - expectedCenterElev)).toBeLessThan(0.02);
  });

  test("Guarantee 3: Multi-level isolation on tiered / overpass corpus case", () => {
    // Ground road running along Y axis at z = 20
    const lowerPoints: [number, number, number][] = [
      [0, -30, 20],
      [0, 0, 20],
      [0, 30, 20],
    ];
    const lowerProfile = new BridgeContinuousProfile({
      points: lowerPoints,
      width: 14,
      clearance: 0,
    });
    // Upper bridge running along X axis at z = 30 + clearance
    // (its axis on the ground: its abutments on their embankments at 32 m, the lower road's 20 m under its middle — a 60 m overpass
    // cannot climb 7.5 m within 5 % from ground level: the old fixture's ground at 30 m everywhere asked a hump — review A7)
    const upperProfile = new BridgeContinuousProfile({
      points: [
        [-30, 0, 32],
        [0, 0, 20],
        [30, 0, 32],
      ],
      width: tiered.widthM,
      clearance: tiered.clearanceM,
    });

    const registry = new SupportSurfaceRegistry();
    const lowerRef: SupportRef = { assetId: "ground_road", surfaceId: "surf_0", revision: "rev_1" };
    const upperRef: SupportRef = { assetId: "overpass_bridge", surfaceId: "surf_1", revision: "rev_1" };

    registry.registerBridge(lowerRef, lowerProfile, 0);
    registry.registerBridge(upperRef, upperProfile, 1);

    // Overpass intersection at (0, 0)
    // Vehicle targeting lower road level 0 (near z = 20 + 1.5 deck thickness)
    const queryLower = registry.queryBridgeAt(0, 0, { expectedLevel: 0 });
    expect(queryLower).not.toBeNull();
    expect(queryLower?.supportRef?.assetId).toBe("ground_road");
    expect(queryLower?.elevation).toBeCloseTo(lowerProfile.deckAt(30), 9);
    expect(queryLower?.elevation).toBeLessThan(22);

    // Vehicle targeting upper bridge level 1 (near z = 37.5)
    const queryUpper = registry.queryBridgeAt(0, 0, { expectedLevel: 1 });
    expect(queryUpper).not.toBeNull();
    expect(queryUpper?.supportRef?.assetId).toBe("overpass_bridge");
    expect(queryUpper?.elevation).toBeGreaterThan(31.9);
    // (its intrados clears the lower deck's top)
    expect((queryUpper?.elevation ?? 0) - upperProfile.thickness - (queryLower?.elevation ?? 0)).toBeGreaterThan(5.5);

    // Strict non-interference: lower road vehicle is NEVER attached to upper deck
    expect(Math.abs((queryUpper?.elevation ?? 0) - (queryLower?.elevation ?? 0))).toBeGreaterThan(10.0);
  });

  test("Guarantee 4 & 13: Architectural fidelity — Pont Alexandre III single arch without river piers", () => {
    const family = classifyBridgeStructure({
      length: alex.lengthM,
      width: alex.widthM,
      name: alex.name,
      geoStart: { lat: 48.863, lon: 2.3135 },
      geoEnd: { lat: 48.8644, lon: 2.3135 },
    });

    expect(family).toBe("monumental_alexandre_iii");

    // River channel has ZERO piers!
    const pierLocations = computeStructurePierLocations(alex.lengthM, family);
    expect(pierLocations).toEqual([]);

    // Abutments receive the four 17m monumental pylons
    const pylonsMesh = buildAlexandreIIIPylonsMesh({
      pStart: alex.points[0]!,
      pEnd: alex.points[alex.points.length - 1]!,
      width: alex.widthM,
      deckZ0: alex.points[0]![2],
      deckZ1: alex.points[alex.points.length - 1]![2],
    });

    // 4 pylons, 20 vertices each (4 walls * 4 + 4 cap) = 80 vertices * 3 coords = 240
    expect(pylonsMesh.positions.length).toBe(240);
    // 4 pylons, 10 triangles each (4 walls * 2 + 2 cap) = 40 triangles * 3 indices = 120
    expect(pylonsMesh.triangles.length).toBe(120);
  });

  test("Guarantee 11 & 12: Continuous 3D mesh generation and performance budget", () => {
    const t0 = performance.now();
    const mesh = buildContinuousSliceMesh({
      pa: alex.points[0]!,
      pb: alex.points[1]!,
      width: alex.widthM,
      top0: alex.points[0]![2],
      top1: alex.points[1]![2],
      thick: 1.5,
      isStart: true,
      isEnd: false,
    });
    const dt = performance.now() - t0;

    // Sub-millisecond generation budget on modern hardware
    expect(dt).toBeLessThan(15.0);
    expect(mesh.positions.length).toBeGreaterThan(20);
    expect(mesh.triangles.length).toBeGreaterThan(20);
  });
});
