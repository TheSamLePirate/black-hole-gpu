// A texture's mips made on the GPU (src/mipgen.ts): each level the mean of the 2 × 2 texels above it, read by one
// bilinear sample at their shared corner (an sRGB texture is averaged in linear light, as it should be).

@group(0) @binding(0) var above: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

struct VOut {
  @builtin(position) p: vec4f,
  @location(0) uv: vec2f,
}

/** One triangle over the whole level. */
@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VOut(vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  return textureSampleLevel(above, samp, in.uv, 0.0);
}
