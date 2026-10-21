// The cloud pass's buffer read back by the realtime kernels (docs/PLAN-NUAGES-AAA.md N1, trace.wgsl clouds): the clouds
// along the camera rays are marched once a texel of half the image's size, and each pixel takes them from the four texels
// round it — bilinear, weighted by how alike their opaque bounds are (a texel bounded by a near ridge does not give its
// clouds to a pixel of the sky beside it) — instead of marching up to four volumes itself.

/** sampled textures per stage with the cloud pass's two (the relief's shadow map's 23 and two) */
export const CLOUD_PASS_TEXTURE_LIMIT = 25;
export const CLOUD_PASS_BINDINGS = [38, 39] as const;
/** mouthList[1].y's bit: the cloud pass drew this frame (trace.wgsl cloudsBuffered) */
export const CLOUD_PASS_FLAG = 32;

export function withCloudPass(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_CLOUD_PASS[\s\S]*?\/\/ END_CLOUD_PASS/;
  if (!marker.test(trace)) throw new Error("cloud-pass: missing tracer stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${CLOUD_PASS_BINDINGS[0]}) var cloudInA: texture_2d<f32>;
@group(0) @binding(${CLOUD_PASS_BINDINGS[1]}) var cloudInB: texture_2d<f32>;
// The cloud pass's clouds at a pixel (px: its centre, the image's pixels; boundM: its nearest surface [m], 0 the sky): the
// four texels round it, bilinear, each weighted by its bound's likeness to the pixel's — both the sky, or within 10 % —,
// a floor under it so a pixel alone of its kind still takes its neighbours'. Alpha −1: the pass not drawn this frame.
fn cloudsBuffered(px: vec2f, boundM: f32) -> EarthClouds {
  if ((u32(P.mouthList[1].y + 0.5) & ${CLOUD_PASS_FLAG}u) == 0u) { return EarthClouds(-1.0, vec3f(0.0), -1.0); }
  let n = vec2i(textureDimensions(cloudInA));
  let h = px * 0.5 - 0.5;
  let i0 = vec2i(floor(h));
  let f = h - floor(h);
  var wa = 0.0;
  var a = 0.0;
  var c = vec3f(0.0);
  var t = 0.0;
  var wt = 0.0;
  for (var j = 0u; j < 4u; j++) {
    let o = vec2i(i32(j & 1u), i32(j >> 1u));
    let q = clamp(i0 + o, vec2i(0), n - 1);
    var w = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let A = textureLoad(cloudInA, q, 0);
    let B = textureLoad(cloudInB, q, 0);
    let r = (B.y - boundM) / (0.1 * max(boundM, 1.0));
    let like = select(select(exp(-r * r), 0.0, B.y < 0.0), select(0.0, 1.0, B.y < 0.0), boundM <= 0.0);
    w *= max(like, 0.01);
    wa += w;
    a += w * A.a;
    c += w * A.a * A.rgb;
    if (A.a > 0.0) {
      t += w * A.a * B.x;
      wt += w * A.a;
    }
  }
  return EarthClouds(a / wa, select(vec3f(0.0), c / a, a > 0.0), select(-1.0, t / wt, wt > 0.0));
}
// The cloud pass's texel at an image's pixel px: its clouds' light and cover (alpha −1: the pass not drawn), and how far
// along the camera's ray they are [m] — the sea's mirror of the far clouds (trace.wgsl seaShade).
fn cloudsAtPixel(px: vec2f) -> vec4f {
  if ((u32(P.mouthList[1].y + 0.5) & ${CLOUD_PASS_FLAG}u) == 0u) { return vec4f(-1.0); }
  let n = vec2i(textureDimensions(cloudInA));
  return textureLoad(cloudInA, clamp(vec2i(px * 0.5), vec2i(0), n - 1), 0);
}
fn cloudDepthAtPixel(px: vec2f) -> f32 {
  let n = vec2i(textureDimensions(cloudInB));
  return textureLoad(cloudInB, clamp(vec2i(px * 0.5), vec2i(0), n - 1), 0).z;
}`,
  );
}
