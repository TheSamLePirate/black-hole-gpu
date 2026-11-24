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

  test("the deck's material is the raster material kernel's (shadeLite) — not the traced ground's (shade, main)", () => {
    const p = PROFILES.find((x) => x.id === "earth-raster")!;
    const src = tracerSource();
    const reach = (entry: "shadeLite" | "shade" | "main") =>
      new Set(new InlineModel(src, profileConstants(p, entry)).reach(tracerEntryPoint(entry)));
    expect(reach("shadeLite").has("liteMaterial")).toBe(true);
    expect(reach("shade").has("liteMaterial")).toBe(false);
    expect(reach("main").has("liteMaterial")).toBe(false);
  });
});
