import { describe, expect, test } from "bun:test";
import { InlineModel, prune } from "../scripts/lib/wgsl-inline";
import { FEATURE_TERRAIN_CACHE, FEATURE_TERRAIN_RASTER, tracerConstants, tracerEntryPoint } from "../src/system/tracer-kernels";

describe("tracer kernels: the constants of a features key", () => {
  test("feature bits map to their HAS_* constants", () => {
    const c = tracerConstants(4 | 512, "main");
    expect(c.HAS_JET).toBe(1);
    expect(c.HAS_KERR).toBe(1);
    expect(c.HAS_BODIES).toBe(0);
    expect(c.DISC_ONLY).toBe(0);
    expect(c.QUALITY_PIPELINE).toBe(0);
  });
  test("the discs' kernel is main with DISC_ONLY, without the raster or the cache", () => {
    const key = 128 | FEATURE_TERRAIN_CACHE | FEATURE_TERRAIN_RASTER;
    const c = tracerConstants(key, "discs", { rasterHint: true });
    expect(tracerEntryPoint("discs")).toBe("main");
    expect(c.DISC_ONLY).toBe(1);
    expect(c.HAS_TERRAIN_RASTER).toBe(0);
    expect(c.HAS_TERRAIN_CACHE).toBe(0);
  });
  test("the raster's material kernels carry the runways' code; main does not without the bit", () => {
    const key = 128 | FEATURE_TERRAIN_RASTER;
    expect(tracerConstants(key, "shadeLite", { rasterHint: true }).HAS_RWY).toBe(1);
    expect(tracerConstants(key, "main", { rasterHint: true }).HAS_RWY).toBe(0);
    expect(tracerConstants(key, "shadeLite", { rasterHint: true, quality: true }).HAS_RWY).toBe(0);
  });
  test("the raster's distances only where the device takes them, never in the quality kernel", () => {
    const key = 128 | FEATURE_TERRAIN_RASTER;
    expect(tracerConstants(key, "main", { rasterHint: false }).HAS_TERRAIN_RASTER).toBe(0);
    expect(tracerConstants(key, "main", { rasterHint: true }).HAS_TERRAIN_RASTER).toBe(1);
    expect(tracerConstants(key, "main", { rasterHint: true, quality: true }).HAS_TERRAIN_RASTER).toBe(0);
    expect(tracerConstants(key, "env", { rasterHint: true }).HAS_TERRAIN_RASTER).toBe(0);
  });
  test("cost view and tune from the key's high bits", () => {
    const c = tracerConstants(3 << 16, "main", { tune: { TUNE_AIR_N: 8 } });
    expect(c.COST_VIEW).toBe(3);
    expect(c.TUNE_AIR_N).toBe(8);
  });
});

describe("the inline-size analyzer", () => {
  const src = `
override HAS_X: bool = true;
fn big() -> f32 { let a = 1.0;
  let b = 2.0;
  return a + b; }
fn helper() -> bool { return HAS_X && true; }
fn user() -> f32 {
  var seg = 0u;
  let on = HAS_X && seg == 0u;
  if (on) { seg = 1u; }
  if (seg == 1u) { return big() + big(); }
  if (helper()) { return big(); }
  return 0.0;
}
@compute @workgroup_size(1)
fn main() { let x = user() + big(); }
`;
  test("calls are inlined copies", () => {
    const m = new InlineModel(src, { HAS_X: 1 });
    // (big: 3 lines; user calls it 3 times; main once more)
    expect(m.size("main").inlined).toBeGreaterThan(m.size("main").unique);
    expect(m.multipliers("main").find((x) => x.name === "big")?.copies).toBe(4);
  });
  test("branches dead under the constants are pruned, through locals, helpers and constant vars", () => {
    const m = new InlineModel(src, { HAS_X: 0 });
    // (on false → seg never 1 → its block gone; helper() false → its block gone: big only from main)
    expect(m.multipliers("main").find((x) => x.name === "big")?.copies).toBe(1);
  });
  test("prune keeps live blocks", () => {
    expect(prune("if (HAS_X && y) { a(); }", { HAS_X: 1 }, new Set())).toContain("a()");
    expect(prune("if (HAS_X && y) { a(); }", { HAS_X: 0 }, new Set())).not.toContain("a()");
    expect(prune("if (HAS_X || y) { a(); }", { HAS_X: 0 }, new Set())).toContain("a()");
  });
});

describe("the source specialisation (P1b)", () => {
  const src = `
override HAS_A: bool = true;
@group(0) @binding(1) var<storage, read> table: array<vec4f>;
fn onlyA() -> f32 { return table[0].x; }
@group(0) @binding(2) var<storage, read> other: array<vec4f>;
fn always() -> f32 { return other[0].y; }
// a comment
fn helper(k: u32) -> bool { return HAS_A && k > 0u; }
fn user(k: u32) -> f32 {
  var r = 0.0;
  if (HAS_A) { r += onlyA(); }
  if (helper(k)) { r += 1.0; } else { r -= 1.0; }
  if (HAS_A || k > 2u) { r += 2.0; }
  return r + always();
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) { let x = user(gid.x); }
@compute @workgroup_size(64)
fn other2() { let y = always(); }
`;
  test("dead branches and the functions only they reached go; the module's declarations stay", async () => {
    const { WgslSpecialiser } = await import("../src/system/wgsl-specialise");
    const out = new WgslSpecialiser(src).specialise({ HAS_A: 0 }, "main");
    expect(out).not.toContain("fn onlyA");
    expect(out).not.toContain("fn other2");
    expect(out).toContain("var<storage, read> table");
    expect(out).toContain("var<storage, read> other");
    expect(out).toContain("fn always");
    expect(out).toContain("override HAS_A");
    // (the else of a dead if kept; an || condition left alone)
    expect(out).toContain("r -= 1.0");
    expect(out).toContain("HAS_A || k > 2u");
    expect(out).not.toContain("a comment");
  });
  test("live branches untouched", async () => {
    const { WgslSpecialiser } = await import("../src/system/wgsl-specialise");
    const out = new WgslSpecialiser(src).specialise({ HAS_A: 1 }, "main");
    expect(out).toContain("fn onlyA");
    expect(out).toContain("r += onlyA()");
    expect(out).toContain("r += 1.0");
  });
  test("a local of a module name, or declared twice, is not taken for a constant", async () => {
    const { WgslSpecialiser } = await import("../src/system/wgsl-specialise");
    const s2 = `
override HAS_A: bool = false;
fn f(on: bool) -> f32 {
  if (on) { return 1.0; }
  { let on2 = HAS_A && true; if (on2) { return 2.0; } }
  { let on3 = HAS_A; }
  { let on3 = true; if (on3) { return 3.0; } }
  return 0.0;
}
@compute @workgroup_size(1)
fn main() { let x = f(true); }
`;
    const out = new WgslSpecialiser(s2).specialise({}, "main");
    expect(out).toContain("return 1.0");
    expect(out).not.toContain("return 2.0");
    expect(out).toContain("return 3.0");
  });
});
