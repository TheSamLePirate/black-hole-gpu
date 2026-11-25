// Bridge & Road AAA — PR6: Structural Families and Notable Bridge Silhouettes Tests
// Verifies architectural classification, pier placement by family,
// and monumental architecture generation for Pont Alexandre III and viaducts.

import { describe, expect, test } from "bun:test";
import {
  classifyBridgeStructure,
  computeStructurePierLocations,
  ALEXANDRE_III,
  areaUnderDeck,
  buildAlexandreIIIPylonsMesh,
  buildArchRibsMesh,
  lineUnderDeck,
} from "../src/system/bridge-structures";
import { BridgePaint } from "../src/system/bridge-notable";
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

  test("Alexandre III's four pylons in their parts — granite base, pedestal, column, capital, a gilded group — to 22.6 m over the deck (campaign 2: plain boxes to 14 m)", () => {
    const pStart: [number, number, number] = [-80, 0, 32.0];
    const pEnd: [number, number, number] = [80, 0, 32.0];
    const pylons = buildAlexandreIIIPylonsMesh({ pStart, pEnd, width: 40, deckZ0: 32, deckZ1: 32 });
    expect(pylons.normals.length).toBe(pylons.positions.length);
    // (each pylon: base, pedestal, column, capital, plinth, the group's body and two wings — 8 solids; the old: one box)
    expect(pylons.pylons.length).toBe(4 * 8);
    let maxZ = -Infinity,
      minZ = Infinity;
    for (let i = 2; i < pylons.positions.length; i += 3) {
      maxZ = Math.max(maxZ, pylons.positions[i]!);
      minZ = Math.min(minZ, pylons.positions[i]!);
    }
    // (the wings' tips — their section about the tip point —, a little over it)
    expect(maxZ).toBeGreaterThanOrEqual(32 + ALEXANDRE_III.wingTop);
    expect(maxZ).toBeLessThan(32 + ALEXANDRE_III.wingTop + 0.6);
    expect(minZ).toBeLessThan(32 - 8);
    const gilded = pylons.pylons.filter((p) => p.paint === BridgePaint.Gilded);
    expect(gilded.length).toBe(4 * 3);
    for (const g of gilded) expect(g.bottom).toBeGreaterThanOrEqual(32 + ALEXANDRE_III.plinthTop - 1e-6);
    // (the column slimmer than its base: a silhouette, not a pavé)
    const widths = pylons.pylons
      .slice(0, 5)
      .map((p) => Math.hypot(p.footprint[1]![0] - p.footprint[0]![0], p.footprint[1]![1] - p.footprint[0]![1]));
    expect(widths[0]!).toBeCloseTo(ALEXANDRE_III.base, 6);
    expect(widths[2]!).toBeCloseTo(ALEXANDRE_III.columnFoot, 6);
    // (outside the deck: the base clear of the roadway's edge)
    for (const p of pylons.pylons.slice(0, 1)) for (const [, y] of p.footprint) expect(Math.abs(y)).toBeGreaterThanOrEqual(20);
    // (every face wound outward — the prisms' rule)
    for (const p of pylons.pylons) {
      const c = [0, 1, 2].map((k) => p.positions.filter((_, i) => i % 3 === k).reduce((a, v) => a + v, 0) / (p.positions.length / 3));
      for (let k = 0; k < p.triangles.length; k += 3) {
        const P = (i: number) => [p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!];
        const [A, B, C] = [P(p.triangles[k]!), P(p.triangles[k + 1]!), P(p.triangles[k + 2]!)];
        const e1 = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!],
          e2 = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
        const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        const m = [0, 1, 2].map((q) => (A[q]! + B[q]! + C[q]!) / 3 - c[q]!);
        expect(n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]!).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  test("Alexandre III's arch: five ribs over its 107.5 m span, springing 6.3 m under the crown, the crown at the intrados; in pieces, the river under it open (campaign 2: hidden in the deck)", () => {
    const pStart: [number, number, number] = [-80, 0, 32.0];
    const pEnd: [number, number, number] = [80, 0, 32.0];
    const arch = buildArchRibsMesh({ pStart, pEnd, width: 24, deckZ0: 32, deckZ1: 32, thick: 1.2, riseM: ALEXANDRE_III.rise });
    expect(arch.normals.length).toBe(arch.positions.length);
    expect(arch.parts.length).toBe(12);
    let maxZ = -Infinity,
      minZ = Infinity,
      minX = Infinity,
      maxX = -Infinity;
    for (let i = 0; i < arch.positions.length; i += 3) {
      minX = Math.min(minX, arch.positions[i]!);
      maxX = Math.max(maxX, arch.positions[i]!);
      maxZ = Math.max(maxZ, arch.positions[i + 2]!);
      minZ = Math.min(minZ, arch.positions[i + 2]!);
    }
    // (the crown under the intrados — 30.8 m —, never through the deck)
    expect(maxZ).toBeLessThanOrEqual(30.8 + 1e-6);
    // (the springings 6.3 m under the crown, and the ribs' depth under them: seen from the water)
    expect(minZ).toBeLessThan(30.8 - ALEXANDRE_III.rise - 1);
    // (its span the real one, centred — not the deck's whole length on the quays)
    expect(maxX - minX).toBeGreaterThan(105);
    expect(maxX - minX).toBeLessThan(110);
    // (the middle pieces' collision boxes start near the crown: the river's clearance kept under them)
    const mid = arch.parts[Math.floor(arch.parts.length / 2)]!;
    expect(mid.bottom).toBeGreaterThan(30.8 - 3);
    for (const p of arch.parts) expect(p.paint).toBe(BridgePaint.Silver);
  });
});

describe("a data bridge under another source's deck (campaign 2, 24 Nov 2026)", () => {
  // (a deck 1 300 m along the north axis, 27 m wide: |x| ≤ 13.7 + its margin, 0 ≤ y ≤ 1 300)
  const deck = (x: number, y: number) => Math.abs(x) <= 23.7 && y >= 0 && y <= 1300;
  test("its double kept out though its middle vertex lies on an approach: most of its length is on the deck", () => {
    // (the Golden Gate's double: the deck's two ends, then eight vertices crowded on a curving approach off its south end)
    const line: [number, number][] = [
      [0, 1290],
      [0, 10],
      ...Array.from({ length: 8 }, (_, i) => [-(i + 1) * 6, -(i + 1) * 8] as [number, number]),
    ];
    expect(deck(...line[Math.floor(line.length / 2)]!)).toBe(false);
    expect(lineUnderDeck(line, deck)).toBe(true);
  });
  test("a road crossing under it — a fraction of its length — kept; a parallel bridge 60 m aside kept; its middle on the deck left out", () => {
    expect(
      lineUnderDeck(
        [
          [-300, 600],
          [0, 600],
          [300, 600],
        ],
        deck,
      ),
    ).toBe(true); // (its middle on the deck — the rule before)
    expect(
      lineUnderDeck(
        [
          [-300, 600],
          [-100, 600],
          [300, 600],
        ],
        deck,
      ),
    ).toBe(false);
    expect(
      lineUnderDeck(
        [
          [60, 0],
          [60, 1300],
        ],
        deck,
      ),
    ).toBe(false);
    expect(lineUnderDeck([], deck)).toBe(false);
  });
});

describe("an OpenStreetMap bridge area under a deck already built (25 Nov 2026 — Cheviré's light band)", () => {
  // (two surveyed carriageways 15 m wide, their axes at x ±9 m, along y 0 … 600; an area 60 m wide over them, its outline off both)
  const onDeck = (x: number, y: number) => y >= 0 && y <= 600 && (Math.abs(x - 9) <= 7.5 || Math.abs(x + 9) <= 7.5);
  const ring = [
    [-30, -20, 0],
    [30, -20, 0],
    [30, 620, 0],
    [-30, 620, 0],
  ];
  const inside = (at: readonly number[]) => at[0]! > -30 && at[0]! < 30 && at[1]! > -20 && at[1]! < 620;
  test("its inside over a deck: under it — the old test (its centre, its outline) said not, and drew its slab over the water", () => {
    // (the old test's witness: the centre — between the carriageways, x 0 — and the outline off the decks)
    expect(onDeck(0, 300)).toBe(false);
    expect(ring.some((p) => onDeck(p[0]!, p[1]!))).toBe(false);
    expect(areaUnderDeck(ring, inside, onDeck)).toBe(true);
  });
  test("an area with no deck over it: not under one (its slab drawn)", () => {
    expect(areaUnderDeck(ring, inside, () => false)).toBe(false);
    // (a deck beside it, outside its outline: not under one)
    expect(areaUnderDeck(ring, inside, (x) => x > 40)).toBe(false);
  });
});
