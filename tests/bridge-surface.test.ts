import { describe, expect, test } from "bun:test";
import { BridgeContinuousProfile, type SupportRef, SupportSurfaceRegistry } from "../src/system/bridge-surface-service";

describe("PR2 — Common Profile & Multi-Level Surface Service", () => {
  test("continuous profile resolution guarantees zero vertical step at abutments (s=0 and s=total)", () => {
    const points: [number, number, number][] = [
      [0, 0, 10.0],
      [25, 0, 12.0],
      [50, 0, 14.0],
      [75, 0, 12.0],
      [100, 0, 10.0],
    ];

    const profile = new BridgeContinuousProfile({
      points,
      width: 10.0,
      thickness: 1.2,
      clearance: 5.5,
    });

    // Zero vertical step at start abutment
    expect(profile.elevationAt(0)).toBeCloseTo(10.0, 6);
    // Zero vertical step at end abutment
    expect(profile.elevationAt(profile.totalLength)).toBeCloseTo(10.0, 6);

    // Sample along the whole profile at 1 cm intervals: no step > 0.05 m anywhere
    let maxDelta1cm = 0;
    let prevZ = profile.elevationAt(0);
    const step = 0.01; // 1 cm intervals
    for (let s = step; s <= profile.totalLength; s += step) {
      const z = profile.elevationAt(s);
      const dz = Math.abs(z - prevZ);
      maxDelta1cm = Math.max(maxDelta1cm, dz);
      prevZ = z;
    }
    // Continuous slope: 1 cm step delta is under 5 mm (well below the 5 cm acceptance threshold)
    expect(maxDelta1cm).toBeLessThan(0.01);
  });

  test("intrados clearance guarantee: deck minus thickness clears obstacles by at least clearanceM", () => {
    // Ground at 0m, clearance required 5.5m, thickness 1.2m
    const points: [number, number, number][] = [
      [0, 0, 2.0], // abutment A at 2m
      [50, 0, 0.0], // obstacle (river) at 0m
      [100, 0, 2.0], // abutment B at 2m
    ];

    const clearance = 5.5;
    const thickness = 1.2;
    const profile = new BridgeContinuousProfile({
      points,
      width: 12.0,
      thickness,
      clearance,
    });

    const midS = profile.totalLength / 2;
    const intradosMid = profile.intradosAt(midS);
    const riverGroundZ = 0.0;

    // Intrados must clear river ground by at least 5.5m
    expect(intradosMid - riverGroundZ).toBeGreaterThanOrEqual(clearance - 1e-4);
  });

  test("cross-section roles: evaluates carriageway, sidewalk and parapet correctly", () => {
    const points: [number, number, number][] = [
      [0, 0, 20.0],
      [100, 0, 20.0],
    ];
    const profile = new BridgeContinuousProfile({
      points,
      width: 12.0,
      thickness: 1.0,
      clearance: 5.0,
    });

    // Center of deck (u=0)
    const center = profile.sample(50, 0);
    expect(center.role).toBe("carriageway");
    expect(center.position[2]).toBeCloseTo(profile.elevationAt(50), 4);

    // Sidewalk (u=4.5m on 12m wide deck -> halfWidth=6m)
    const sidewalk = profile.sample(50, 4.5);
    expect(sidewalk.role).toBe("sidewalk");
    expect(sidewalk.position[2]).toBeCloseTo(profile.elevationAt(50) + 0.15, 4);

    // Parapet (u=5.85m near outer edge)
    const parapet = profile.sample(50, 5.85);
    expect(parapet.role).toBe("parapet");
    expect(parapet.position[2]).toBeCloseTo(profile.elevationAt(50) + 1.0, 4);

    // Orthogonality of tangent and normal
    const dot = center.normal[0] * center.tangent[0] + center.normal[1] * center.tangent[1] + center.normal[2] * center.tangent[2];
    expect(Math.abs(dot)).toBeLessThan(1e-4);
  });

  test("multi-level support registry with hysteresis: separates upper deck from ground beneath", () => {
    const registry = new SupportSurfaceRegistry();

    const bridgeRef: SupportRef = { assetId: "bridge_seine_1", surfaceId: "deck_main", revision: "1" };
    const points: [number, number, number][] = [
      [-50, 0, 35.0],
      [0, 0, 36.5],
      [50, 0, 35.0],
    ];
    const profile = new BridgeContinuousProfile({
      points,
      width: 14.0,
      thickness: 1.5,
      clearance: 6.0,
    });

    registry.registerBridge(bridgeRef, profile, 1);

    const deckHeightAt0 = profile.elevationAt(50); // at x=0 (s=50)
    // Case 1: Car driving on bridge at the deck elevation (ground is at 28.0m below)
    const carOnBridge = registry.query([0, 0, deckHeightAt0], 28.0, 2.0);
    expect(carOnBridge.found).toBe(true);
    expect(carOnBridge.surfaceRole).toBe("carriageway");
    expect(carOnBridge.elevation).toBeCloseTo(deckHeightAt0, 2);
    expect(carOnBridge.supportRef?.surfaceId).toBe("deck_main");

    // Case 2: Pedestrian or boat under bridge at ground level z=28.0m
    const boatUnderBridge = registry.query([0, 0, 28.0], 28.0, 2.0);
    expect(boatUnderBridge.found).toBe(true);
    expect(boatUnderBridge.surfaceRole).toBe("ground");
    expect(boatUnderBridge.elevation).toBeCloseTo(28.0, 2);
    expect(boatUnderBridge.supportRef).toBeUndefined();

    // Case 3: Hysteresis stability — vehicle on bridge keeps bridge support
    const vehicleFollowingBridge = registry.query([10, 0, profile.elevationAt(60)], 28.0, 2.0, bridgeRef);
    expect(vehicleFollowingBridge.supportRef?.surfaceId).toBe("deck_main");

    // Case 4: Hysteresis stability — entity under bridge never pops up to deck
    const groundRef: SupportRef = { assetId: "ground", surfaceId: "terrain", revision: "1" };
    const actorUnderBridge = registry.query([10, 0, 28.1], 28.0, 2.0, groundRef);
    expect(actorUnderBridge.surfaceRole).toBe("ground");
    expect(actorUnderBridge.elevation).toBeCloseTo(28.0, 2);
  });
});
