// PLAN-PONT-ROUTES-AAA PR4, review A6/A10 (24 Nov 2026): the deck's and the roads' material read from the tracer's own source — no
// simulator of the shader (the old test re-implemented the WGSL in TypeScript and drifted from it). What these check, on the real
// trace.wgsl: the deck takes its own road's surface alone (kinds 1 and 5: no water, no land use), walked only where its paint shows;
// the ground's walk leaves the deck's roads out (road-markings.ts ROAD_ON_BRIDGE) and the deck's leaves the ground's; which kernels
// carry that code (the inline model of scripts/wgsl-inline-size.ts). The numbers — a surface's colour from given inputs — are the
// shader slices' (tests/e2e/road-pavement-slice.e2e.test.ts: compiled in Chrome, run on the GPU).
import { describe, expect, test } from "bun:test";
import { PROFILES, profileConstants, tracerSource } from "../scripts/lib/kernel-profiles";
import { InlineModel } from "../scripts/lib/wgsl-inline";
import trace from "../src/shaders/trace.wgsl" with { type: "text" };
import { ROAD_ON_BRIDGE } from "../src/system/road-markings";
import { tracerEntryPoint } from "../src/system/tracer-kernels";
import { wgslFunction } from "../src/system/warp-grid";

const flat = (s: string) => s.replace(/\s+/g, " ");

describe("PR4 / review A6 — the deck's surface on the real shader", () => {
  const lite = flat(wgslFunction(trace, "liteMaterial"));
  const surface = flat(wgslFunction(trace, "scenerySurface"));

  test("the deck takes a road's or its paint's surface alone (kinds 1, 5) — never the river's or a land use's", () => {
    expect(lite).toContain("let deckRoad = isDeckCarriageway && sv.cover > 0.0 && (sv.kind == 1.0 || sv.kind == 5.0);");
    expect(lite).toContain("A = select(baseBridge, mix(baseBridge, sv.color, sv.cover), deckRoad);");
    // (positive witness: the defect's line — any surface's colour on the deck — is gone)
    expect(lite).not.toContain("isDeckCarriageway && sv.cover > 0.0);");
  });

  test("the deck's walk is gated as the ground's paint is: a pixel under 2 m within 2.5 km (it was every deck pixel at any distance)", () => {
    expect(lite).toContain("let deckWalk = onBridgeDeck && fpM < 2.0 && tM < 2500.0;");
    expect(lite).toMatch(/if \(deckWalk \|\| mu0g < 0\.06 \|\|/);
    expect(lite).not.toMatch(/if \(onBridgeDeck \|\| mu0g/);
  });

  test("the ground's walk and the deck's keep apart by the segment's bridge bit (ROAD_ON_BRIDGE)", () => {
    expect(ROAD_ON_BRIDGE).toBe(32768);
    expect(surface).toContain("let segBridge=(mkAll&32768u)!=0u;");
    expect(surface).toContain("if(kind!=3.0 && segBridge!=SC_ON_BRIDGE){i++;continue;}");
  });

  test("the deck's and the roads' material is the raster material kernel's (shadeLite) — not the traced ground's (shade, main)", () => {
    const p = PROFILES.find((x) => x.id === "earth-raster")!;
    const src = tracerSource();
    const reach = (entry: "shadeLite" | "shade" | "main") =>
      new Set(new InlineModel(src, profileConstants(p, entry)).reach(tracerEntryPoint(entry)));
    expect(reach("shadeLite").has("liteMaterial")).toBe(true);
    expect(reach("shadeLite").has("roadPavement")).toBe(true);
    for (const e of ["shade", "main"] as const) {
      expect(reach(e).has("liteMaterial")).toBe(false);
      expect(reach(e).has("roadPavement")).toBe(false);
    }
  });
});

describe("B1 — the pavement on the real shader", () => {
  const lite = flat(wgslFunction(trace, "liteMaterial"));
  const surface = flat(wgslFunction(trace, "scenerySurface"));
  const pave = flat(wgslFunction(trace, "roadPavement"));

  test("the shared walk no longer draws the wheel paths and cracks (they are the material's): it hands the road's coordinates", () => {
    expect(surface).not.toContain("let track=");
    expect(surface).not.toContain("let crack=");
    expect(surface).toContain("SC_ROAD=road;SC_ROAD_DIR=rdir;");
  });

  test("the material read from the road's word (bits 16–18), applied near and on Earth's scenery alone", () => {
    expect(lite).toContain("let roadMat = (u32(SC_ROAD.w + 0.5) >> 16u) & 7u;");
    expect(lite).toContain("if (HAS_SCENERY && roadPaved > 0.0 && sv.kind == 1.0 && fpM < 3.0) {");
    expect(lite).toContain("pv = roadPavement(roadMat, SC_ROAD, SC_ROAD_DIR, SC_AT + P.scenery[6].xy, fpM);");
  });

  test("each detail fades with the pixel's footprint (the aggregate, the setts, the wheel paths): no shimmer", () => {
    expect(pave).toContain("let fine = 1.0 - smoothstep(0.025, 0.07, fpM);");
    expect(pave).toContain("let sett = 1.0 - smoothstep(0.08, 0.25, fpM);");
    expect(pave).toContain("let mid = 1.0 - smoothstep(0.8, 2.0, fpM);");
    // (the joints box-filtered over the footprint, not thresholded)
    expect(pave).toContain("paveCover(");
  });

  test("its rain: water held where the material holds it, a road darker by its pores, a loose surface's sheen lower", () => {
    expect(lite).toContain("let pq = select(pn, 0.55 * pn + 0.6 * pv.puddle, roadPaved > 0.0);");
    expect(lite).toContain("mix(mix(0.58, 0.7, paved), pv.wetDark, roadPaved)");
    expect(lite).toContain("select(1.0, 0.4, roadPaved > 0.0 && roadMat >= 3u)");
  });
});
