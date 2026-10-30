/**
 * The raster terrain patch's distance image, read by the tracer's main kernel as a start for each ground ray
 * (trace.wgsl: earthMarchHinted), and the scenery's instance the raster drew at each pixel (its second channel —
 * system/scenery-raster.ts). Only where the device takes one more sampled texture: the stub that returns no hint
 * stays otherwise, and the kernel is what it was.
 */

import { TABLE_SUN } from "../gpu-tables";

/** Sampled textures per stage with the hint's: the aerial perspective's 21 and one. */
export const RASTER_HINT_TEXTURE_LIMIT = 22;
export const RASTER_HINT_BINDING = 35;

export function withTerrainRaster(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_TERRAIN_RASTER[\s\S]*?\/\/ END_TERRAIN_RASTER/;
  if (!marker.test(trace)) throw new Error("terrain-raster-hint: missing tracer stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${RASTER_HINT_BINDING}) var terrainDist: texture_2d<f32>;
// The patch's distance [m] at this ray's pixel (rgba32float r, 0 where no triangle covers it; out of range reads 0).
fn terrainRasterHint(px: vec2f) -> f32 { return textureLoad(terrainDist, vec2i(floor(px)), 0).r; }
// The scenery's instance drawn nearest at this pixel (g: a tree's cell + 1, exact in a float below 2²⁴; 0 none).
fn terrainRasterId(px: vec2f) -> u32 { return u32(textureLoad(terrainDist, vec2i(floor(px)), 0).g); }
// The nearest surface's distance [m] at this pixel (b: the ground's, or an instance's proxy before it; 0 none).
fn terrainRasterDepth(px: vec2f) -> f32 { return textureLoad(terrainDist, vec2i(floor(px)), 0).b; }
// A building's box before the ground and the trees at this pixel (a: 2 — system/scenery-raster.ts boxFs).
fn terrainRasterBuilding(px: vec2f) -> bool { return textureLoad(terrainDist, vec2i(floor(px)), 0).a > 1.5; }
// A bridge's box before the ground at this pixel (a: 2.25 — system/scenery-raster.ts bridgeMarkFs): shadeLite's, its deck tested.
fn terrainRasterBridge(px: vec2f) -> bool { let a = textureLoad(terrainDist, vec2i(floor(px)), 0).a; return a > 2.1 && a < 2.4; }
// A building's own triangles at this pixel (a: 3 — system/scenery-raster.ts meshFs): shadeLite's material.
fn terrainRasterMesh(px: vec2f) -> bool { return textureLoad(terrainDist, vec2i(floor(px)), 0).a > 2.5; }
// How many levels coarser than the near patch the ground here was drawn from (a: 1 the patch — 2 a building's box on it —,
// ½ its first far ring, ¼ the next: system/terrain-raster.ts ringFs; 0 none).
fn terrainRasterLevelStep(px: vec2f) -> f32 {
  let a = textureLoad(terrainDist, vec2i(floor(px)), 0).a;
  return select(0.0, -log2(min(a, 1.0)), a > 0.0);
}
// A frozen cloud's slab at this pixel (a: 1.5 — system/body-raster.ts bodyCloudFs, Mann's: PLAN-PLANETES-AAA P4).
fn terrainRasterCloud(px: vec2f) -> bool { let a = textureLoad(terrainDist, vec2i(floor(px)), 0).a; return a > 1.4 && a < 1.6; }`,
  );
}

/** Sampled textures per stage with the relief's shadow map's (the hint's 22 and one). */
export const SUN_SHADOW_TEXTURE_LIMIT = 23;
export const SUN_SHADOW_BINDING = 37;

/**
 * The relief's shadow map (system/terrain-raster.ts encodeSunShadow: the patch seen from the Sun) read by the realtime
 * kernels' relief shadows (trace.wgsl earthTerrainShadow): the occluders farther than the near march's reach along the
 * Sun's ray, the march resumed where the ray leaves the patch (a low Sun's far mountains). The stub otherwise.
 */
export function withSunShadow(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_SUN_SHADOW[\s\S]*?\/\/ END_SUN_SHADOW/;
  if (!marker.test(trace)) throw new Error("terrain-raster-hint: missing sun shadow stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${SUN_SHADOW_BINDING}) var sunShadowMap: texture_depth_2d;
const SS_OFF = ${TABLE_SUN}u;
// A ground point's light past the near march (rel: from the camera, the Earth's axes [m]): x the share of a 3 × 3 of the
// map's texels with no relief more than the near reach (c.y) before it towards the Sun; y where its ray leaves the patch
// (m along it — the march resumed there); z the near reach [m]; w how far along it the nearest of those texels' relief
// stands [m] (the map orthographic along the Sun: a texel is the ray's own column), 3e38 none; x −1: no map here.
fn sunShadowFar(rel: vec3f) -> vec4f {
  let c = bodies[SS_OFF + 3u];
  if (c.x < 0.5) { return vec4f(-1.0, 0.0, 0.0, 3e38); }
  let R = bodies[SS_OFF]; let U = bodies[SS_OFF + 1u]; let L = bodies[SS_OFF + 2u]; let up = bodies[SS_OFF + 4u].xyz;
  let uv = vec2f(dot(rel, R.xyz) / R.w * 0.5 + 0.5, 0.5 - dot(rel, U.xyz) / U.w * 0.5);
  if (any(uv <= vec2f(0.0)) || any(uv >= vec2f(1.0))) { return vec4f(-1.0, 0.0, 0.0, 3e38); }
  let n = vec2i(textureDimensions(sunShadowMap));
  let at = vec2i(uv * vec2f(n));
  let dz = 0.5 - dot(rel, L.xyz) / (2.0 * L.w);
  var lit = 0.0;
  var occ = 3e38;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let d = textureLoad(sunShadowMap, clamp(at + vec2i(i, j), vec2i(0), n - 1), 0);
      let ahead = (dz - d) * 2.0 * L.w;
      lit += select(1.0, 0.0, ahead > c.y);
      if (ahead > c.y) { occ = min(occ, ahead); }
    }
  }
  // (the ray's way out of the patch — a disc of radius c.z round the camera — on its horizontal, back along it)
  let lh = L.xyz - dot(L.xyz, up) * up; let ph = rel - dot(rel, up) * up;
  let lhl = length(lh);
  var exit = 3e38;
  if (lhl > 1e-4) {
    let ln = lh / lhl; let b = dot(ph, ln); let cc = dot(ph, ph) - c.z * c.z;
    exit = (-b + sqrt(max(b * b - cc, 0.0))) / lhl;
  }
  return vec4f(lit / 9.0, exit, c.y, occ);
}`,
  );
}
