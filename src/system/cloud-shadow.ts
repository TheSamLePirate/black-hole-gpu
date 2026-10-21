// The clouds' transmittance map seen from the Sun (docs/PLAN-NUAGES-AAA.md N3; trace.wgsl cloudShadow writes it): one source
// for every cloud shadow — the ground and the sea, the scenery, the craft's key light, the shafts of light in the air. Read
// by the tracer's kernels where the device takes one more sampled texture; the stub (no map: the old shadows) otherwise.

import { TABLE_CSM } from "../gpu-tables";

/** sampled textures per stage with the map's (the cloud pass's 25 and one) */
export const CLOUD_SHADOW_TEXTURE_LIMIT = 26;
export const CLOUD_SHADOW_BINDING = 40;
/** the map's texels a side, its half-width [m]: ~210 m a texel */
export const CSM_N = 384;
export const CSM_HALF_M = 40_000;

export function withCloudShadow(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_CLOUD_SHADOW[\s\S]*?\/\/ END_CLOUD_SHADOW/;
  if (!marker.test(trace)) throw new Error("cloud-shadow: missing tracer stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${CLOUD_SHADOW_BINDING}) var csmTex: texture_2d<f32>;
const CSM_OFF = ${TABLE_CSM}u;
// A texel's sunlight at the depth z along the light [m]: none of it past the front, then Beer's law on the mean extinction,
// no more than the whole optical depth.
fn csmTexelT(t: vec4f, z: f32) -> f32 {
  if (t.w < 0.5) { return 1.0; }
  return exp(-min(t.z, t.y * max(t.x - z, 0.0)));
}
// The sunlight's share the clouds let through to p (the squashed space): the four texels round it, each's transmittance
// first, then bilinear (not their depths: a cloud's edge); −1 off the map (the old shadows there).
fn cloudShadowAt(p: vec3f) -> f32 {
  let t3 = bodies[CSM_OFF + 3u];
  if (t3.w < 0.5) { return -1.0; }
  let c = bodies[CSM_OFF];
  let d = p - c.xyz;
  let n = vec2f(textureDimensions(csmTex));
  let uv = vec2f(dot(d, bodies[CSM_OFF + 1u].xyz), -dot(d, bodies[CSM_OFF + 2u].xyz)) / c.w * 0.5 + 0.5;
  let rim = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  if (rim <= 0.0) { return -1.0; }
  let z = dot(d, t3.xyz) * EARTH_RM;
  let x = uv * n - 0.5;
  let i0 = vec2i(floor(x));
  let f = x - floor(x);
  let m = vec2i(n) - 1;
  let a = csmTexelT(textureLoad(csmTex, clamp(i0, vec2i(0), m), 0), z);
  let b = csmTexelT(textureLoad(csmTex, clamp(i0 + vec2i(1, 0), vec2i(0), m), 0), z);
  let e = csmTexelT(textureLoad(csmTex, clamp(i0 + vec2i(0, 1), vec2i(0), m), 0), z);
  let g = csmTexelT(textureLoad(csmTex, clamp(i0 + vec2i(1, 1), vec2i(0), m), 0), z);
  return mix(mix(a, b, f.x), mix(e, g, f.x), f.y);
}`,
  );
}
