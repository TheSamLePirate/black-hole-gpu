import { expect, test } from "bun:test";
import {
  eoxColour,
  LEVELS,
  ORTHO_BINDINGS,
  ORTHO_FIT,
  orthoColour,
  orthoImageryWgsl,
  orthoUrl,
  tileLayout,
  withOrthoImagery,
} from "../src/system/earth-tiles";
import { imageryWords, orthoWords } from "../src/system/tile-decode";

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
  // (PLAN-J1 J1-3: the same module for another pipeline — a raster fragment's group and bindings —, the tracer's its own)
  expect(on).toContain(orthoImageryWgsl(0, ORTHO_BINDINGS));
  const raster = orthoImageryWgsl(1, [0, 1, 2]);
  expect(raster).toContain("@group(1) @binding(0) var orthoTex: texture_2d_array<f32>;");
  expect(raster).toContain("@group(1) @binding(2) var imgTex2k: texture_2d_array<f32>;");
  expect(raster.replace(/@group\(1\) @binding\(\d\)/g, "")).toBe(
    orthoImageryWgsl(0, ORTHO_BINDINGS).replace(/@group\(0\) @binding\(\d+\)/g, ""),
  );
  expect(orthoUrl(17, 66391, 45092)).toContain(
    "LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=17&TILEROW=45092&TILECOL=66391",
  );
});

test("T8a: a tile's words as the decode worker makes them — the colours' fits per pixel, the lights in alpha, no image never 0", () => {
  const n = 256 * 256;
  const day = new Uint8ClampedArray(4 * n),
    night = new Uint8ClampedArray(4 * n);
  for (let i = 0; i < n; i++) {
    day.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], 4 * i);
    night.set([(i * 3) % 256, 0, 0, i % 2 ? 255 : 0], 4 * i);
  }
  const eox = imageryWords(day, night, null, true),
    gibs = imageryWords(day, night, null, false),
    photo = imageryWords(day, night, ORTHO_FIT, true),
    ortho = orthoWords(day, ORTHO_FIT);
  for (const i of [0, 1, 777, 4242, 65535]) {
    const [r, g, b] = [day[4 * i]!, day[4 * i + 1]!, day[4 * i + 2]!];
    const [er, eg, eb] = eoxColour(r, g, b);
    expect(eox[i]! & 0xffffff).toBe((Math.max(er, 1) | (eg << 8) | (eb << 16)) >>> 0);
    expect(gibs[i]! & 0xffffff).toBe((Math.max(r, 1) | (g << 8) | (b << 16)) >>> 0);
    const [or, og, ob] = orthoColour(r, g, b, ORTHO_FIT);
    expect(photo[i]! & 0xffffff).toBe((Math.max(or, 1) | (og << 8) | (ob << 16)) >>> 0);
    expect(ortho[i]! >>> 24).toBe(255);
    // (the lights: none where the night's alpha is 0)
    if (i % 2 === 0) expect(eox[i]! >>> 24).toBe(0);
  }
  // (the tone curve tabulated: a white kept neutral, the survey's brightness brought down as before — 233)
  const [wr, wg, wb] = orthoColour(255, 255, 255);
  expect(Math.max(wr, wg, wb) - Math.min(wr, wg, wb)).toBeLessThanOrEqual(1);
  expect(wg).toBe(233);
});
