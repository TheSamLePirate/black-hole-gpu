// PROBLEMES « Ponts et routes, campagne e2e 2 » — the grey stair-stepped blocks before the Golden Gate's north tower from Battery
// Spencer (25 Nov 2026, kerr-mini: `surfaceAt` there read « tree », ground 0, nearest 80–107 m, alpha 0 — a crown proxy against the
// sky). A static check on the real trace.wgsl: such a pixel is the raster material's (rasterLiteTakes takes a tree's id before it
// refuses a pixel without ground), shadeLite seeks its crown past the proxy with no ground behind, and leaves it stale where it misses.
// Each check fails on the code before (the pixel went to the rays' kernel, whose trees J9 retired on 24 Nov 2026). The image is the
// e2e's (bridges: golden-gate-1km).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const wgsl = readFileSync(new URL("../src/shaders/trace.wgsl", import.meta.url), "utf8");
const takes = wgsl.slice(wgsl.indexOf("fn rasterLiteTakes(px: vec2f, k: u32) -> bool {"), wgsl.indexOf("// the mesh's normal at a pixel"));
const lite = wgsl.slice(
  wgsl.indexOf("fn shadeLite(@builtin(global_invocation_id)"),
  wgsl.indexOf("let ab = squashOf(k);", wgsl.indexOf("fn shadeLite(")),
);

test("a tree's pixel with no ground behind it is the material's, not the rays'", () => {
  const id = takes.indexOf("if (terrainRasterId(px) != 0u) { return true; }");
  const noGround = takes.indexOf("if (tM <= 0.0) { return false; }");
  expect(id).toBeGreaterThan(0);
  expect(noGround).toBeGreaterThan(id);
  // (after the buildings' boxes: a box's pixel still the rays')
  expect(takes.indexOf("if (terrainRasterBuilding(px)) { return false; }")).toBeLessThan(id);
});

test("shadeLite seeks the crown past its proxy against the sky, and leaves a miss stale (no ground shaded at 0 m)", () => {
  expect(lite).toContain("let tMax = select(tM, terrainRasterDepth(centre) + 60.0, tM <= 0.0);");
  expect(lite).toContain("sceneryTreeLite(normalize(toBody(ray.look)), treeId, tMax,");
  expect(lite).toContain("if (tM <= 0.0) {\n    moments[idx] = vec2f(RASTER_STALE,");
});
