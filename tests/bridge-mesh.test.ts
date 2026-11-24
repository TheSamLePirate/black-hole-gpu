import { describe, expect, test } from "bun:test";
import { buildContinuousPierMesh, buildContinuousRailMesh, buildContinuousSliceMesh, computeSlicePlane } from "../src/system/bridge-mesh";
import { BridgeContinuousProfile } from "../src/system/bridge-surface-service";
import { BridgeFlag } from "../src/system/street-cells";
import { CORPUS_CASES } from "./fixtures/bridge-corpus";

describe("PR3 — Continuous 3D Bridge Deck Mesh, Abutments and Piers", () => {
  test("Rule 3 witness: positive witness detects injected step defect, negative witness confirms A/A = 0", () => {
    const pa: [number, number, number] = [0, 0, 0];
    const pb: [number, number, number] = [10, 0, 0];
    const width = 10;
    const thick = 1.2;

    // Slice 0: [0, 10] m, top rises from 30.0 to 31.0 m
    const slice0 = buildContinuousSliceMesh({
      pa,
      pb,
      width,
      top0: 30.0,
      top1: 31.0,
      thick,
    });

    // Negative witness A/A: rebuilt identically, max delta is strictly 0
    const slice0Same = buildContinuousSliceMesh({
      pa,
      pb,
      width,
      top0: 30.0,
      top1: 31.0,
      thick,
    });
    let maxDeltaAA = 0;
    for (let i = 0; i < slice0.positions.length; i++) {
      maxDeltaAA = Math.max(maxDeltaAA, Math.abs(slice0.positions[i]! - slice0Same.positions[i]!));
    }
    expect(maxDeltaAA).toBe(0);

    // Slice 1 continuous: [10, 20] m, top rises from 31.0 to 32.0 m
    const pa1: [number, number, number] = [10, 0, 0];
    const pb1: [number, number, number] = [20, 0, 0];
    const slice1 = buildContinuousSliceMesh({
      pa: pa1,
      pb: pb1,
      width,
      top0: 31.0,
      top1: 32.0,
      thick,
    });

    // Check shared boundary vertices:
    // In slice 0, vertices 2 (Top-Right End) and 3 (Top-Left End) at x=10
    // In slice 1, vertices 1 (Top-Right Start) and 0 (Top-Left Start) at x=10
    const slice0TopRightEnd = [slice0.positions[2 * 3]!, slice0.positions[2 * 3 + 1]!, slice0.positions[2 * 3 + 2]!];
    const slice1TopRightStart = [slice1.positions[1 * 3]!, slice1.positions[1 * 3 + 1]!, slice1.positions[1 * 3 + 2]!];

    const deltaX = Math.abs(slice0TopRightEnd[0]! - slice1TopRightStart[0]!);
    const deltaY = Math.abs(slice0TopRightEnd[1]! - slice1TopRightStart[1]!);
    const deltaZ = Math.abs(slice0TopRightEnd[2]! - slice1TopRightStart[2]!);

    expect(deltaX).toBeLessThan(1e-6);
    expect(deltaY).toBeLessThan(1e-6);
    expect(deltaZ).toBeLessThan(1e-6); // EXACT ZERO STEP!

    // Positive witness: inject a 40 cm legacy step defect at slice 1 start
    const slice1Defective = buildContinuousSliceMesh({
      pa: pa1,
      pb: pb1,
      width,
      top0: 31.4, // +0.4m injected defect
      top1: 32.4,
      thick,
    });
    const defectiveDeltaZ = Math.abs(slice0TopRightEnd[2]! - slice1Defective.positions[1 * 3 + 2]!);
    expect(defectiveDeltaZ).toBeCloseTo(0.4, 5); // Defect successfully detected by witness
  });

  test("zero vertical step across a complete multi-slice 100 m bridge (replaces legacy 2.75 m cliffs)", () => {
    // Reference Case 1: 100 m synthetic bridge on flat ground (z=30m), clearance 5.5m
    const c1 = CORPUS_CASES.CASE_SYNTH_FLAT_100M!;
    const points: [number, number, number][] = [
      [0, 0, 30],
      [100, 0, 30],
    ];
    const thick = 1.2;
    const profile = new BridgeContinuousProfile({
      points,
      width: c1.widthM,
      thickness: thick,
      clearance: c1.clearanceM,
    });

    const slices: ReturnType<typeof buildContinuousSliceMesh>[] = [];
    const n = 10; // 10 slices of 10 m each
    for (let k = 0; k < n; k++) {
      const s0 = k * 10;
      const s1 = (k + 1) * 10;
      const pa: [number, number, number] = [s0, 0, 0];
      const pb: [number, number, number] = [s1, 0, 0];
      const top0 = profile.elevationAt(s0);
      const top1 = profile.elevationAt(s1);
      slices.push(
        buildContinuousSliceMesh({
          pa,
          pb,
          width: c1.widthM,
          top0,
          top1,
          thick,
          isStart: k === 0,
          isEnd: k === n - 1,
        }),
      );
    }

    // Verify every internal boundary between slice k and slice k+1
    let maxBoundaryStep = 0;
    for (let k = 0; k < n - 1; k++) {
      const sA = slices[k]!;
      const sB = slices[k + 1]!;

      // Top-Left End of slice k vs Top-Left Start of slice k+1
      const sAZ_TL = sA.positions[3 * 3 + 2]!;
      const sBZ_TL = sB.positions[0 * 3 + 2]!;
      const stepTL = Math.abs(sAZ_TL - sBZ_TL);

      // Top-Right End of slice k vs Top-Right Start of slice k+1
      const sAZ_TR = sA.positions[2 * 3 + 2]!;
      const sBZ_TR = sB.positions[1 * 3 + 2]!;
      const stepTR = Math.abs(sAZ_TR - sBZ_TR);

      // Bottom-Left End of slice k vs Bottom-Left Start of slice k+1
      const sAZ_BL = sA.positions[7 * 3 + 2]!;
      const sBZ_BL = sB.positions[4 * 3 + 2]!;
      const stepBL = Math.abs(sAZ_BL - sBZ_BL);

      // Bottom-Right End of slice k vs Bottom-Right Start of slice k+1
      const sAZ_BR = sA.positions[6 * 3 + 2]!;
      const sBZ_BR = sB.positions[5 * 3 + 2]!;
      const stepBR = Math.abs(sAZ_BR - sBZ_BR);

      maxBoundaryStep = Math.max(maxBoundaryStep, stepTL, stepTR, stepBL, stepBR);
    }

    // Contract: step must be strictly 0 (no cliff)
    expect(maxBoundaryStep).toBeLessThan(1e-6);

    // Verify abutment continuity at s=0 and s=100
    expect(Math.abs(slices[0]!.positions[0 * 3 + 2]! - 30.0)).toBeLessThan(1e-6);
    expect(Math.abs(slices[n - 1]!.positions[2 * 3 + 2]! - 30.0)).toBeLessThan(1e-6);
  });

  test("abutments: closed wall generated for closed ends, open port for OpenA/OpenB", () => {
    const pa: [number, number, number] = [0, 0, 0];
    const pb: [number, number, number] = [10, 0, 0];

    // Closed bridge (normal ground abutments)
    const closedSliceStart = buildContinuousSliceMesh({
      pa,
      pb,
      width: 10,
      top0: 30,
      top1: 31,
      thick: 1.2,
      isStart: true,
      flags: 0,
    });
    // Standard faces = 8 triangles (2 top + 2 bot + 2 left + 2 right) + 2 start abutment = 10 triangles (30 indices)
    expect(closedSliceStart.triangles.length).toBe(30);

    // Open port (continuation into adjacent tile)
    const openSliceStart = buildContinuousSliceMesh({
      pa,
      pb,
      width: 10,
      top0: 30,
      top1: 31,
      thick: 1.2,
      isStart: true,
      flags: BridgeFlag.OpenA,
    });
    // Standard faces = 8 triangles (24 indices), no start abutment face
    expect(openSliceStart.triangles.length).toBe(24);
  });

  test("guardrail / parapet continuity: follows deck slope without vertical step", () => {
    const pa: [number, number, number] = [0, 0, 0];
    const pb: [number, number, number] = [10, 0, 0];
    const pa1: [number, number, number] = [10, 0, 0];
    const pb1: [number, number, number] = [20, 0, 0];

    const rail0 = buildContinuousRailMesh({
      pa,
      pb,
      width: 10,
      railW: 0.3,
      railH: 1.0,
      side: 1,
      top0: 30.0,
      top1: 31.0,
    });

    const rail1 = buildContinuousRailMesh({
      pa: pa1,
      pb: pb1,
      width: 10,
      railW: 0.3,
      railH: 1.0,
      side: 1,
      top0: 31.0,
      top1: 32.0,
    });

    // Top-Right End of rail0 vs Top-Right Start of rail1
    const rail0Z = rail0.positions[2 * 3 + 2]!; // Top-Right End
    const rail1Z = rail1.positions[1 * 3 + 2]!; // Top-Right Start

    expect(rail0Z).toBe(32.0); // 31.0 deck + 1.0 railH
    expect(rail1Z).toBe(32.0); // 31.0 deck + 1.0 railH
    expect(Math.abs(rail0Z - rail1Z)).toBe(0);
  });

  test("pier column anchoring: firmly anchored into ground and tight to deck intrados", () => {
    const p: [number, number, number] = [50, 0, 0];
    const pier = buildContinuousPierMesh({
      p,
      width: 10,
      pierWidth: 2.0,
      groundFooting: 28.0, // ground 30 - 2m footing
      intradosTop: 35.5, // deck bottom at 35.5m
    });

    expect(pier.positions.length).toBe(24); // 8 vertices * 3 coords
    expect(pier.triangles.length).toBe(36); // 12 triangles * 3 indices

    // Vertices 0..3 have z = 35.5 (intradosTop)
    for (let i = 0; i < 4; i++) {
      expect(pier.positions[i * 3 + 2]).toBe(35.5);
    }

    // Vertices 4..7 have z = 28.0 (groundFooting)
    for (let i = 4; i < 8; i++) {
      expect(pier.positions[i * 3 + 2]).toBe(28.0);
    }
  });

  test("analytic slice plane computation matches linear slope exactly", () => {
    const pa: [number, number, number] = [0, 0, 0];
    const pb: [number, number, number] = [10, 0, 0];
    const [a, b, c] = computeSlicePlane(pa, pb, 30.0, 32.0);

    expect(a).toBeCloseTo(0.2, 6); // dz/dx = (32 - 30) / 10 = 0.2
    expect(b).toBe(0);
    expect(c).toBe(30.0);

    // At midpoint x=5: z should be 31.0
    expect(a * 5 + b * 0 + c).toBeCloseTo(31.0, 6);
  });
});
