// Bridge & Road AAA — PR6: Structural Families and Notable Bridge Silhouettes Tests
// Verifies architectural classification, pier placement by family,
// and monumental architecture generation for Pont Alexandre III and viaducts.

import { describe, expect, test } from "bun:test";
import {
  classifyBridgeStructure,
  computeStructurePierLocations,
  buildAlexandreIIIPylonsMesh,
  buildArchRibsMesh,
} from "../src/system/bridge-structures";
import { CORPUS_CASES } from "./fixtures/bridge-corpus";

describe("PR6 — Structural Families and Notable Bridge Silhouettes", () => {
  test("Rule 3 witness: positive witness detects generic piers in river channel, negative witness confirms A/A = 0", () => {
    const caseAlexandreIII = CORPUS_CASES.CASE_REAL_SEINE_ALEXANDRE_III!;
    const totalLength = caseAlexandreIII.lengthM; // 160m

    // Generic algorithm places piers every 34m: round(160 / 34) - 1 = 4 piers!
    const genericPiers = Array.from({ length: 4 }, (_, i) => (totalLength * (i + 1)) / 5);

    // Modern architectural family resolution:
    const familyA = classifyBridgeStructure({
      length: totalLength,
      width: caseAlexandreIII.widthM,
      geoStart: { lat: 48.8633, lon: 2.3135 },
      geoEnd: { lat: 48.8641, lon: 2.3135 },
      clearance: caseAlexandreIII.clearanceM,
    });
    const familyB = classifyBridgeStructure({
      length: totalLength,
      width: caseAlexandreIII.widthM,
      geoStart: { lat: 48.8633, lon: 2.3135 },
      geoEnd: { lat: 48.8641, lon: 2.3135 },
      clearance: caseAlexandreIII.clearanceM,
    });

    // Negative witness: A/A = 0
    expect(familyA).toBe(familyB);
    expect(familyA).toBe("monumental_alexandre_iii");

    const architecturalPiers = computeStructurePierLocations(totalLength, familyA);
    expect(architecturalPiers).toEqual([]); // Zero piers in river channel

    // Positive witness: generic algorithm defect detected (piers placed in river)
    const pierCountDelta = genericPiers.length - architecturalPiers.length;
    expect(pierCountDelta).toBe(4); // 4 generic piers erroneously obstructing river channel
  });

  test("structural family classification identifies notable structures accurately", () => {
    // 1. Alexandre III in Paris
    const alexandre = classifyBridgeStructure({
      length: 160,
      width: 40,
      geoStart: { lat: 48.8633, lon: 2.3135 },
      geoEnd: { lat: 48.8641, lon: 2.3135 },
      clearance: 5.5,
    });
    expect(alexandre).toBe("monumental_alexandre_iii");

    // 2. Viaduct (> 400m)
    const viaductCase = CORPUS_CASES.CASE_SYNTH_LONG_VIADUCT!;
    const viaduct = classifyBridgeStructure({
      length: viaductCase.lengthM,
      width: viaductCase.widthM,
      clearance: viaductCase.clearanceM,
    });
    expect(viaduct).toBe("viaduct");

    // 3. Arch bridge (medium span, high clearance)
    const arch = classifyBridgeStructure({
      length: 120,
      width: 12,
      clearance: 25.0,
    });
    expect(arch).toBe("arch");

    // 4. Standard road bridge
    const standard = classifyBridgeStructure({
      length: 80,
      width: 10,
      clearance: 5.5,
    });
    expect(standard).toBe("girder");
  });

  test("pier placement adheres strictly to structural engineering rules", () => {
    // 1. Alexandre III: single arch span across river -> NO intermediate piers
    const alexandrePiers = computeStructurePierLocations(160, "monumental_alexandre_iii");
    expect(alexandrePiers.length).toBe(0);

    // 2. Viaduct (1200m): piers spaced ~130m
    const viaductPiers = computeStructurePierLocations(1200, "viaduct");
    expect(viaductPiers.length).toBe(8); // round(1200/130) - 1 = 9 - 1 = 8 piers
    for (let i = 1; i < viaductPiers.length; i++) {
      const spanSpacing = viaductPiers[i]! - viaductPiers[i - 1]!;
      expect(spanSpacing).toBeCloseTo(1200 / 9, 1); // ~133.3m
    }

    // 3. Standard girder bridge (100m): piers spaced ~34m
    const girderPiers = computeStructurePierLocations(100, "girder");
    expect(girderPiers.length).toBe(2); // round(100/34) - 1 = 3 - 1 = 2 piers
    expect(girderPiers[0]).toBeCloseTo(100 / 3, 1);
    expect(girderPiers[1]).toBeCloseTo((100 * 2) / 3, 1);
  });

  test("Alexandre III generates 4 monumental corner pylons rising 14m above deck", () => {
    const pStart: [number, number, number] = [-80, 0, 32.0];
    const pEnd: [number, number, number] = [80, 0, 32.0];
    const width = 40.0;
    const deckZ0 = 32.0;
    const deckZ1 = 32.0;

    const pylons = buildAlexandreIIIPylonsMesh({
      pStart,
      pEnd,
      width,
      deckZ0,
      deckZ1,
    });

    expect(pylons.positions.length).toBeGreaterThan(0);
    expect(pylons.triangles.length).toBeGreaterThan(0);
    expect(pylons.normals.length).toBe(pylons.positions.length);

    // 4 pylons, each having 4 vertical wall quads (16 verts) + 1 top cap quad (4 verts) = 20 verts * 4 = 80 verts
    expect(pylons.positions.length).toBe(80 * 3);

    // Check maximum height of pylon vertices
    let maxZ = -Infinity;
    let minZ = Infinity;
    for (let i = 2; i < pylons.positions.length; i += 3) {
      maxZ = Math.max(maxZ, pylons.positions[i]!);
      minZ = Math.min(minZ, pylons.positions[i]!);
    }

    // Pylon top is deckZ + 14m = 46.0m
    expect(maxZ).toBeCloseTo(46.0, 3);
    // Pylon bottom reaches down towards river bank
    expect(minZ).toBeLessThan(deckZ0);
  });

  test("Alexandre III generates 3 continuous low-rise steel arch ribs beneath deck", () => {
    const pStart: [number, number, number] = [-80, 0, 32.0];
    const pEnd: [number, number, number] = [80, 0, 32.0];
    const width = 40.0;
    const deckZ0 = 32.0;
    const deckZ1 = 32.0;
    const riseM = 5.5;

    const arch = buildArchRibsMesh({
      pStart,
      pEnd,
      width,
      deckZ0,
      deckZ1,
      riseM,
    });

    expect(arch.positions.length).toBeGreaterThan(0);
    expect(arch.triangles.length).toBeGreaterThan(0);
    expect(arch.normals.length).toBe(arch.positions.length);

    // Check parabolic arch crown elevation at midpoint (x=0)
    // Springing at abutments is deckZ - riseM = 32 - 5.5 = 26.5m
    // Crown at midpoint rises up by riseM = 26.5 + 5.5 = 32.0m (tight to deck intrados)
    let maxZ = -Infinity;
    for (let i = 2; i < arch.positions.length; i += 3) {
      maxZ = Math.max(maxZ, arch.positions[i]!);
    }
    expect(maxZ).toBeCloseTo(deckZ0, 1);
  });
});
