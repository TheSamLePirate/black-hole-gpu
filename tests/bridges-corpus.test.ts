import { describe, expect, test } from "bun:test";
import { CORPUS_CASES, evaluateStepWitness, measureLegacyBridgeSteps, probeBridgeKeys } from "../src/system/bridge-corpus";

describe("PR0 — Bridge and Road AAA Corpus & Acceptance Contract", () => {
  test("the 12 reference corpus cases are defined and conform to contract specifications", () => {
    const keys = Object.keys(CORPUS_CASES);
    expect(keys.length).toBe(12);

    for (const [_key, c] of Object.entries(CORPUS_CASES)) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(["road", "rail", "foot", "mixed"]).toContain(c.kind);
      expect(["WGS84", "MSL", "synthetic"]).toContain(c.geographic.datum);
      expect(c.lengthM).toBeGreaterThan(0);
      expect(c.widthM).toBeGreaterThan(0);
      expect(c.clearanceM).toBeGreaterThan(0);
      expect(c.points.length).toBeGreaterThanOrEqual(2);
      expect(c.targetInvariants.maxInternalDiscontinuityM).toBe(0.05);
      expect(c.targetInvariants.maxWheelToSurfaceErrorM).toBe(0.02);
      expect(c.targetInvariants.modeSeparation).toBe(true);
      expect(c.targetInvariants.stableGlobalId).toBe(true);
    }
  });

  test("probe of legacy bridge builder quantifies flat slab steps and continuous vs slab discrepancies", () => {
    // Exact synthetic 100m flat bridge with 5.5m clearance
    const flat100 = CORPUS_CASES.CASE_SYNTH_FLAT_100M!;
    const legacy = measureLegacyBridgeSteps(flat100.points, flat100.widthM, flat100.clearanceM);

    expect(legacy.slabs).toBe(10);
    expect(legacy.firstSlabTopM).toBe(2.0328);
    expect(legacy.profileEndpointM).toBe(0.4);
    expect(legacy.maxAdjacentStepM).toBe(2.75);
    expect(legacy.maxContinuousCarVsSlabM).toBe(1.6294);
    expect(legacy.topM).toEqual([2.0328, 4.7828, 6.8453, 8.2203, 8.9078, 8.9078, 8.2203, 6.8453, 4.7828, 2.0328]);

    // This confirms that legacy steps (2.75m) violate the target acceptance threshold (<= 0.05m)
    expect(legacy.maxAdjacentStepM).toBeGreaterThan(0.05);
    // And contact vs rendered slab discrepancy (1.63m) violates target acceptance threshold (<= 0.02m)
    expect(legacy.maxContinuousCarVsSlabM).toBeGreaterThan(0.02);
  });

  test("probe of legacy deduplication keys reveals duplicate registrations across cell boundaries", () => {
    // Two cell origins: cell 1 at (0, 0), cell 2 at (1000, 0)
    const bridgeId = 7;
    const globalPt: [number, number] = [100, 0];
    const cellOrigins = [
      { lat: 48.0, lon: 2.0, toCellMeters: (pt: [number, number]): [number, number] => [pt[0], pt[1]] },
      { lat: 48.0, lon: 2.01, toCellMeters: (pt: [number, number]): [number, number] => [pt[0] - 1000, pt[1]] },
    ];

    const probe = probeBridgeKeys(bridgeId, globalPt, cellOrigins);
    expect(probe.legacyKeys).toEqual(["7:100", "7:-900"]);
    // Legacy keys produce 2 distinct keys for the exact same physical bridge
    expect(new Set(probe.legacyKeys).size).toBe(2);
    // Canonical key produces exactly 1 key
    expect(probe.canonicalKey).toBe("bridge:7");
  });

  test("Rule 3 witness probe: positive witness detects injected step, negative witness confirms A/A = 0", () => {
    const baseline = [10.0, 10.02, 10.04, 10.06, 10.08, 10.1];

    // Negative witness: A/A identical -> step = 0
    const neg = evaluateStepWitness(baseline, 0.0);
    expect(neg.maxDetectedStepM).toBeCloseTo(0.02, 4);
    expect(neg.passedAcceptance).toBe(true);

    // Positive witness 1: 0.10 m (10 cm) step injected
    const pos10cm = evaluateStepWitness(baseline, 0.1);
    expect(pos10cm.detected).toBe(true);
    expect(pos10cm.maxDetectedStepM).toBeCloseTo(0.12, 4);
    expect(pos10cm.passedAcceptance).toBe(false);

    // Positive witness 2: 2.75 m legacy step injected
    const posLegacy = evaluateStepWitness(baseline, 2.75);
    expect(posLegacy.detected).toBe(true);
    expect(posLegacy.maxDetectedStepM).toBeCloseTo(2.77, 4);
    expect(posLegacy.passedAcceptance).toBe(false);
  });
});
