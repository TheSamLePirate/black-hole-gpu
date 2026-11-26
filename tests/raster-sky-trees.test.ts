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

test("shadeLite seeks the crown past its proxy against the sky, and marks a miss for the sky (no ground shaded at 0 m)", () => {
  expect(lite).toContain("let tMax = select(tM, terrainRasterDepth(centre) + 60.0, tM <= 0.0);");
  expect(lite).toContain("sceneryTreeLite(normalize(toBody(ray.look)), treeId, tMax,");
  expect(lite).toContain("if (tM <= 0.0) {\n    moments[idx] = vec2f(RASTER_SKY,");
});

// (26 Nov 2026 — the orange dotted fringe along the crowns over the slope at Battery Spencer: a crown missed before the ground was
// shaded as that ground, though another tree's crown stood behind the proxy's margin, hidden from the raster's depth by it. The
// finishing pass lends it that crown's surface; marching it again in shadeLite cost the forests' material +1.5 to +4.3 ms, kerr-mini)
test("a tree's proxy shaded as its ground borrows another tree's crown shaded within 2 px, nearer than that ground — in the finishing pass", () => {
  // (shadeLite marches its own tree's crown alone, once)
  expect(lite.split("sceneryTreeLite(").length - 1).toBe(1);
  expect(lite).not.toContain("crownAbout(");
  const split = finish.slice(finish.indexOf("if (mk != RASTER_SPLIT && !wat) { return; }"));
  expect(split).toContain("let cb = crownAbout(vec2i(gid.xy), tid, g.a, true);");
  expect(split).toContain("if (cb.x >= 0) { g = textureLoad(lutDirIn, cb, 0); }");
  expect(split.indexOf("crownAbout(")).toBeLessThan(split.indexOf("liteFinishAt("));
  const about = wgsl.slice(wgsl.indexOf("fn crownAbout("), wgsl.indexOf("// shadeLite's finishing pass (withLiteSplit)"));
  // (the pixel shaded as its ground — its surface at the hint's distance, behind its proxy —, else nothing borrowed)
  expect(about).toContain("if (tP > CROWN_ABOUT_M || tG <= tP) { return vec2i(-1); }");
  expect(about).toContain("if (ground && abs(tG - tH) > 0.03 * tH) { return vec2i(-1); }");
  // (eight neighbours on its row and column, the first found, one texel read each; another tree's, before that ground, its crown met,
  // shaded this frame)
  expect(about).toContain("for (var i = 0u; i < 8u; i++) {");
  expect(about.split("terrainRasterTexel(").length - 1).toBe(1);
  expect(about).toContain("if (t.a >= RASTER_TREE_CODE_MAX || id == 0u || id == own || t.b <= 0.0 || t.b >= tG) { continue; }");
  expect(about).toContain("if (m.x != RASTER_SPLIT && !(m.x >= 0.5 * RASTER_MARK && stamps[n] == P.frame.x)) { continue; }");
  expect(about).toContain("ta < tG && ta < 0.97 * t.r");
});

// (a tree's proxy writes the texel's g and b alone — its id, its distance —: r and a keep the ground's distance and code under it. The
// first try took a tree's texel for alpha under 2¹⁸ — code 0 — and refused every proxy, 26 Nov 2026: the bound is the structures' code)
test("a tree's texel is told by a code under the structures': the proxy keeps the ground's alpha", async () => {
  const { RASTER_CODE } = await import("../src/system/terrain-raster-hint");
  const structures = Math.min(...Object.values(RASTER_CODE));
  expect(structures).toBe(RASTER_CODE.turbine);
  const hint = readFileSync(new URL("../src/system/terrain-raster-hint.ts", import.meta.url), "utf8");
  expect(hint).toContain("const RASTER_TREE_CODE_MAX = ${RASTER_CODE.turbine * RASTER_CODE_SCALE}.0;");
  const raster = readFileSync(new URL("../src/system/scenery-raster.ts", import.meta.url), "utf8");
  expect(raster).toContain("writeMask: GPUColorWrite.GREEN | GPUColorWrite.BLUE");
});

// (25 Nov 2026, later: the miss left stale — RASTER_STALE — was a pixel never shaded, its history dark: dark specks at the crowns'
// edges; traced by main — beb2615e, reverted — its own pale crowns. The finishing pass now draws the sky there itself)
const finish = wgsl.slice(wgsl.indexOf("fn shadeLiteFinish(@builtin"), wgsl.indexOf("fn shadeWaterFinish("));
const liteFinish = wgsl.slice(wgsl.indexOf("fn liteFinish(idx: u32,"), wgsl.indexOf("const RASTER_WATER_FLAG"));
const mark = (name: string) => Number(wgsl.match(new RegExp(`const ${name} = (-?[0-9.e]+);`))?.[1]);

test("the sky's mark is its own: no other pixel's mark, the water's ranges nor the cockpit's mask", () => {
  const sky = mark("RASTER_SKY");
  expect(Number.isFinite(sky)).toBe(true);
  for (const m of ["RASTER_SPLIT", "RASTER_MAT", "RASTER_STALE"]) expect(Math.abs(sky - mark(m))).toBeGreaterThan(0.5);
  // (the water's: RASTER_WATER − 3 … RASTER_WATER; the split water's: RASTER_SPLIT_WATER − 0.6 … + 0.1; the cockpit's −1.5 … −0.5)
  const w = mark("RASTER_WATER"),
    sw = mark("RASTER_SPLIT_WATER");
  expect(sky <= w - 3 || sky > w).toBe(true);
  expect(sky <= sw - 0.6 || sky >= sw + 0.1).toBe(true);
  expect(sky < -1.5 || sky > -0.5).toBe(true);
  // (past the air's end: the sky's depth)
  expect(mark("LITE_SKY_M")).toBeGreaterThanOrEqual(1e8);
});

test("the finishing pass fills a missed crown from what is about it: a structure lends its colour, the sky is drawn, else the crowns shaded about it", () => {
  const at = finish.indexOf("if (mk == RASTER_SKY) {");
  expect(at).toBeGreaterThan(0);
  // (before the split's own test returns it)
  expect(at).toBeLessThan(finish.indexOf("if (mk != RASTER_SPLIT && !wat) { return; }"));
  const branch = finish.slice(at, finish.indexOf("if (mk != RASTER_SPLIT && !wat)"));
  // (the pixels about it, two at most: a structure the raster drew — the tower behind the crown, Battery Spencer: the sky drawn there
  // was a sky-blue rim —, the sky — nothing drawn —; the nearest wins, a structure on a tie)
  expect(branch).toContain("for (var dy = -2; dy <= 2; dy++) {");
  expect(branch).toContain("if (terrainRasterBuilding(c) || terrainRasterMesh(c)) {");
  expect(branch).toContain("} else if (terrainRasterDepth(c) <= 0.0 && terrainRasterHint(c) <= 0.0) { sd = min(sd, d); }");
  expect(branch).toContain("if (nd < 99 && nd <= sd) {");
  // (no sky about it — a gap between leaves, a crown behind it: the sky drawn there was a blue line between crowns; left stale, the
  // dark points where one crown passes before another —: the crowns shaded about it this frame lend their surface, finished along this
  // pixel's ray — another tree's first, the farther crown the miss reveals —; a pixel this pass already filled — its moments' distance
  // no longer its liteOut's — never lends; nothing shaded about it either: stale)
  expect(branch).toContain("let tid = terrainRasterId(centre);");
  expect(branch).toContain("if (m.x == RASTER_SPLIT || (m.x >= 0.5 * RASTER_MARK && stamps[n] == P.frame.x)) {");
  expect(branch).toContain("let own = abs(ta / EARTH_RM * bodyRadius(k) - m.y) <= 1e-4 * m.y;");
  expect(branch).toContain("let other = terrainRasterId(c) != tid;");
  const crowns = branch.indexOf("if (sd == 99 && cd < 99) {\n      g = textureLoad(lutDirIn, cb, 0);");
  expect(crowns).toBeGreaterThan(branch.indexOf("if (nd < 99 && nd <= sd) {"));
  const stale = branch.indexOf("if (sd == 99) {\n        moments[idx] = vec2f(RASTER_STALE,");
  expect(stale).toBeGreaterThan(crowns);
  expect(branch).toContain("let dq = b * b - dot(ro, ro) + 1.0;");
  // (else the sky: no surface, LITE_SKY_M away, through the pass's one call — liteFinish inlined once: a second call for the sky doubled
  // the kernel, 1 716 inlined lines, 25 Nov 2026 — kernel-budget.test.ts holds it)
  expect(finish).toContain("var g = vec4f(0.0, 0.0, 0.0, LITE_SKY_M);");
  expect(finish.split("liteFinishAt(").length - 1).toBe(1);
  expect(finish.indexOf("liteFinishAt(gid.xy, g.rgb, g.a, !wat,")).toBeGreaterThan(at + branch.length);
  // (the clouds read as a sky pixel's — bound 0 — there, not as the proxy's, ~100 m away)
  expect(liteFinish).toContain("cloudsBuffered(centre, select(terrainRasterDepth(centre), 0.0, tM >= LITE_SKY_M))");
});

test("a thin part's edge keeps its rebuilt normal: the neighbour off the surface on one side, the other side's taken (the cables' fringe)", () => {
  const rn = wgsl.slice(
    wgsl.indexOf("fn rasterNormal(px: vec2f, tM: f32, k: u32) -> vec3f {"),
    wgsl.indexOf("// The sunlight on a raster pixel's surface"),
  );
  expect(rn).toContain("if ((tx <= 0.0 || abs(tx - tM) > 0.08 * tM) && px.x - 1.0 >= 0.0) {\n    sx = -sx;");
  expect(rn).toContain("if ((ty <= 0.0 || abs(ty - tM) > 0.08 * tM) && px.y - 1.0 >= 0.0) {\n    sy = -sy;");
});
test("the water's own mirror marches past a crossing still in the water — the river bed's bumps are no banks (the floating pieces)", () => {
  const wm = wgsl.slice(wgsl.indexOf("fn waterMirror("), wgsl.indexOf("struct SurfaceImage"));
  expect(wm).toContain("if (!sceneryMirrorWet(rp, tc * EARTH_RM, footM)) {");
  expect(wgsl).toContain("fn sceneryMirrorWet(rp:vec3f,tM:f32,footM:f32)->bool {");
  const stubs = readFileSync(new URL("../src/system/scenery.ts", import.meta.url), "utf8");
  expect(stubs).toContain("fn sceneryMirrorWet(r:vec3f,t:f32,f:f32)->bool{return false;}");
});

test("a river's steep relief well inside its polygon is water, not a bank (the Loire's floating land, the light band under Cheviré)", () => {
  const lw = wgsl.slice(wgsl.indexOf("fn liteWater("), wgsl.indexOf("// (PLAN-J1 J1-4: what of the visibility"));
  expect(lw).toContain("if (flat < 0.999 && osm.y > 0.3 && !tileW) {");
  expect(lw).toContain("let inner = sceneryWaterAt(P.scenery[3].xyz + (dirW * tM) * toW2, WATER_INNER_M, tM);");
  expect(lw).toContain("flat = max(flat, smoothstep(0.97, 0.995, inner.x));");
});
