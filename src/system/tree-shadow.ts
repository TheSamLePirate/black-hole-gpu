// The trees' and buildings' shadow map read by the tracer (system/scenery-raster.ts encodeShadow draws it: their proxies from
// the Sun, ~0.9 m a texel over ±900 m round the camera): the scenery's shadows on the ground, the trees, the buildings —
// instead of a ray towards the Sun through the forest's grid and the buildings' BVH at every shaded pixel. Where the device
// takes one more sampled texture; the stub (the rays, as before) otherwise.

import { TABLE_TSM } from "../gpu-tables";

/** sampled textures per stage with the map's (the clouds' shadow map's 26 and one) */
export const TREE_SHADOW_TEXTURE_LIMIT = 27;
export const TREE_SHADOW_BINDING = 41;

export function withTreeShadow(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_TREE_SHADOW[\s\S]*?\/\/ END_TREE_SHADOW/;
  if (!marker.test(trace)) throw new Error("tree-shadow: missing tracer stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${TREE_SHADOW_BINDING}) var tsmTex: texture_depth_2d_array;
const TSM_OFF = ${TABLE_TSM}u;
// The share of the Sun a scenery-frame point p sees past the trees (layer 0) or the buildings (layer 1) (0…1), −1 off the
// map: its texels round it, each lit where nothing stands nearer the Sun than the point less a bias — the proxies are wider
// than the shapes they stand for (a crown's lit side not shadowed by its own proxy): 1.5 m, and a texel's width along the
// slope.
fn treeShadowAt(p: vec3f) -> f32 { return shadowLayerAt(p, 0); }
fn buildingShadowAt(p: vec3f) -> f32 { return shadowLayerAt(p, 1); }
fn shadowLayerAt(p: vec3f, layer: i32) -> f32 {
  let c = bodies[TSM_OFF + 3u];
  if (c.w < 0.5) { return -1.0; }
  let R = bodies[TSM_OFF];
  let U = bodies[TSM_OFF + 1u];
  let L = bodies[TSM_OFF + 2u];
  let q = p - c.xyz;
  let uv = vec2f(dot(q, R.xyz) / R.w * 0.5 + 0.5, 0.5 - dot(q, U.xyz) / U.w * 0.5);
  if (any(uv <= vec2f(0.01)) || any(uv >= vec2f(0.99))) { return -1.0; }
  let n = vec2i(textureDimensions(tsmTex));
  let z = 0.5 - dot(q, L.xyz) / (2.0 * L.w) - (1.5 + 2.0 * R.w / f32(n.x)) / (2.0 * L.w);
  // (past either end of the map's depth range — a valley below a mesa's rim, the Sun low —: nothing known there, not a
  // shadow — beyond the far end the cleared map compared as an occluder, a whole plain shaded to a straight line; the rays)
  if (z <= 0.0 || z >= 1.0) { return -1.0; }
  // (a box three texels wide at the point's own continuous place — its 4 × 4 texels each weighed by its overlap —: an
  // edge's shadow ramps across the texels, not in a texel's steps — a building's edge near the camera spans a dozen pixels)
  let g = uv * vec2f(n) - 1.5;
  let at = vec2i(floor(g));
  let f = g - floor(g);
  var wx = vec4f(1.0 - f.x, 1.0, 1.0, f.x);
  var wy = vec4f(1.0 - f.y, 1.0, 1.0, f.y);
  var lit = 0.0;
  for (var j = 0; j < 4; j++) {
    for (var i = 0; i < 4; i++) {
      lit += wx[i] * wy[j] * select(0.0, 1.0, z <= textureLoad(tsmTex, clamp(at + vec2i(i, j), vec2i(0), n - 1), layer, 0));
    }
  }
  return lit / 9.0;
}`,
  );
}
