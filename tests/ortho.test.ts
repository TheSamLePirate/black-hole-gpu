import { expect, test } from "bun:test";
import { LEVELS, ORTHO_BINDINGS, orthoColour, orthoUrl, tileLayout, withOrthoImagery } from "../src/system/earth-tiles";

test("the orthophotos' colours: the survey's brightness brought to the Earth's, a white kept white, a dark field greened", () => {
  const [r, g, b] = orthoColour(255, 255, 255);
  expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
  expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
  // (a mid grey darkened — the survey 2.7 times the ground's light on average —, its hue barely moved)
  const grey = orthoColour(128, 128, 128);
  expect(grey[1]).toBeLessThan(110);
  expect(Math.abs(grey[0] - grey[1])).toBeLessThan(12);
  // (a dark green field: darker, its blue taken down as the Blue Marble's ground has it)
  const field = orthoColour(70, 90, 60);
  expect(field[1]).toBeLessThan(90);
  expect(field[2]).toBeLessThan(field[0]);
  expect(orthoColour(0, 0, 0)).toEqual([0, 0, 0]);
});

test("the orthophotos out of the relief's texture (T9a: their own filtered texture), its stub and reader", () => {
  // (the relief's layers alone: one a level at the normal reach, the 2048² layers whole)
  expect(tileLayout(1024, Array(LEVELS).fill(1024)).layers).toBe(LEVELS);
  expect(tileLayout(2048, Array(LEVELS).fill(2048)).layers).toBe(LEVELS);
  const stub =
    "a\n// BEGIN_ORTHO_IMAGERY x\nfn orthoAt(k: u32, uv: vec2f, lod: f32) -> vec4f { return vec4f(0.0); }\n// END_ORTHO_IMAGERY\nb";
  expect(withOrthoImagery(stub, false)).toBe(stub);
  const on = withOrthoImagery(stub, true);
  expect(on).toContain(`@binding(${ORTHO_BINDINGS[0]}) var orthoTex: texture_2d_array<f32>;`);
  expect(on).toContain(`@binding(${ORTHO_BINDINGS[1]}) var orthoSamp: sampler;`);
  expect(on).toContain("textureSampleGrad(orthoTex, orthoSamp, uv, k, gx, gy)");
  // (T9b: the relief levels' imagery — the 2048² texture's binding, both readers)
  expect(on).toContain(`@binding(${ORTHO_BINDINGS[2]}) var imgTex2k: texture_2d_array<f32>;`);
  expect(on).toContain("fn tileImgAt(l: u32, p: vec2f, lod: f32) -> vec4f {");
  expect(on).toContain("fn tileImgGrad(l: u32, p: vec2f, gx: vec2f, gy: vec2f) -> vec4f {");
  expect(() => withOrthoImagery("nothing", true)).toThrow();
  expect(orthoUrl(17, 66391, 45092)).toContain(
    "LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=17&TILEROW=45092&TILECOL=66391",
  );
});
