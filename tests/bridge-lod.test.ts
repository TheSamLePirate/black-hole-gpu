// Bridge & Road AAA — a bridge's level of detail (PLAN-PONT-ROUTES-AAA PR7; review A8, 24 Nov 2026): the scene worker picks the
// stations' spacing and the parapets by distance (bridge-lod.ts selectBridgeLOD, wired in scenery-worker.ts deckBridge). The deck
// drawn at each LOD is compared here mesh to mesh — the slices the worker builds (bridge-mesh.ts) on the stations the profile gives —:
// at their common stations the very same heights; between them the coarser chord within its bound; the support every reader queries
// (profile.deckAt) the drawn mesh's at both.

import { describe, expect, test } from "bun:test";
import { selectBridgeLOD } from "../src/system/bridge-lod";
import { buildContinuousSliceMesh } from "../src/system/bridge-mesh";
import { BridgeContinuousProfile } from "../src/system/bridge-surface-service";

/** a valley 600 m wide crossed by a road: its ground every 20 m */
const valley = (): [number, number, number][] =>
  Array.from({ length: 31 }, (_, i) => {
    const x = i * 20;
    const t = x / 600;
    return [x, 0.2 * x, 30 - 25 * Math.sin(Math.PI * t)] as [number, number, number];
  });

/** the deck's top meshes of a profile: each slice's top-corner heights at its two stations */
const meshTops = (p: BridgeContinuousProfile) => {
  const out = new Map<number, number>();
  const st = p.stations;
  for (let k = 0; k + 1 < st.length; k++) {
    const a = p.axisAt(st[k]!),
      b = p.axisAt(st[k + 1]!);
    const m = buildContinuousSliceMesh({
      pa: [a.x, a.y, 0],
      pb: [b.x, b.y, 0],
      width: 12,
      top0: p.deckAt(st[k]!),
      top1: p.deckAt(st[k + 1]!),
      thick: 1.2,
    });
    out.set(Math.round(st[k]! * 1000), m.positions[2]!);
    out.set(Math.round(st[k + 1]! * 1000), m.positions[8]!);
  }
  return out;
};

describe("PR7 / review A8 — the LOD the scene picks, mesh against mesh", () => {
  test("the selection by distance: 10 m slices and parapets near, 20 m to 2.5 km, 40 m without parapets beyond", () => {
    expect(selectBridgeLOD(200)).toEqual({ lodLevel: 0, sliceLengthM: 10, drawParapets: true, drawPiers: true });
    expect(selectBridgeLOD(1200)).toEqual({ lodLevel: 1, sliceLengthM: 20, drawParapets: true, drawPiers: true });
    expect(selectBridgeLOD(4000)).toEqual({ lodLevel: 2, sliceLengthM: 40, drawParapets: false, drawPiers: true });
  });

  test("LOD 0 and LOD 2 meshes: the same heights at their common stations, the coarse chord within its bound between them", () => {
    const pts = valley();
    const near = new BridgeContinuousProfile({ points: pts, width: 12, thickness: 1.2, clearance: 5.5, sliceM: 10 });
    const far = new BridgeContinuousProfile({ points: pts, width: 12, thickness: 1.2, clearance: 5.5, sliceM: 40 });
    const a = meshTops(near),
      b = meshTops(far);
    let common = 0;
    for (const [s, z] of b) {
      const zn = a.get(s);
      if (zn === undefined) continue;
      common++;
      // (negative witness: the same curve, the same station — the same height to the float)
      expect(Math.abs(z - zn)).toBeLessThan(1e-9);
    }
    expect(common).toBeGreaterThanOrEqual(15);
    // (between stations the coarse deck's chord: within κ h² / 8 of the curve, κ ≤ 6 H / Lr² — measured, not assumed)
    const kappa = (6 * far.lift) / Math.max(far.rampM, 1) ** 2;
    let worst = 0;
    for (let s = 0; s <= far.totalLength; s += 1) worst = Math.max(worst, Math.abs(far.deckAt(s) - far.elevationAt(s)));
    expect(worst).toBeLessThanOrEqual((kappa * 40 * 40) / 8 + 1e-6);
    // (positive witness: a coarse deck read against the fine curve between stations is not the same surface)
    let differs = 0;
    for (let s = 5; s < far.totalLength; s += 10) differs = Math.max(differs, Math.abs(far.deckAt(s) - near.deckAt(s)));
    expect(differs).toBeGreaterThan(0);
  });

  test("the support each reader queries is the drawn mesh's top at either LOD (the registry's deckAt = the slice's corners)", () => {
    for (const sliceM of [10, 40]) {
      const p = new BridgeContinuousProfile({ points: valley(), width: 12, thickness: 1.2, clearance: 5.5, sliceM });
      const tops = meshTops(p);
      for (const s of p.stations) expect(Math.abs(p.deckAt(s) - tops.get(Math.round(s * 1000))!)).toBeLessThan(1e-9);
    }
  });
});
