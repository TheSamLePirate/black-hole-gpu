// Sky texture preparation: decode an 8-bit encoded panorama to linear half floats, then build its
// mip chain with a 2×2 box filter (flux-conserving pre-filter for footprint-sized lookups).

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> mode: vec4u; // x: 0 = log encoding v = 2^(16c − 16), 1 = sRGB

fn srgbToLinear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

@compute @workgroup_size(8, 8)
fn decode(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let c = textureLoad(src, gid.xy, 0).rgb;
  var v: vec3f;
  if (mode.x == 0u) {
    v = select(exp2(16.0 * c - 16.0), vec3f(0.0), c <= vec3f(0.0));
  } else {
    v = srgbToLinear(c);
  }
  textureStore(dst, gid.xy, vec4f(v, 1.0));
}

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let s = vec2i(textureDimensions(src)) - 1;
  let p = vec2i(gid.xy) * 2;
  var c = vec3f(0.0);
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      c += textureLoad(src, min(p + vec2i(i, j), s), 0).rgb;
    }
  }
  textureStore(dst, gid.xy, vec4f(0.25 * c, 1.0));
}
