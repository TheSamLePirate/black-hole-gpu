/**
 * The raster terrain patch's distance image, read by the tracer's main kernel as a start for each ground ray
 * (trace.wgsl: earthMarchHinted), and the scenery's instance the raster drew at each pixel (its second channel —
 * system/scenery-raster.ts). Only where the device takes one more sampled texture: the stub that returns no hint
 * stays otherwise, and the kernel is what it was.
 */

import { TABLE_SUN } from "../gpu-tables";

/** (T5) What drew a raster pixel, in its target's a: its code × RASTER_CODE_SCALE, plus the ground's smooth normal (an octahedron
 *  2 × 9 bits) — the whole an integer below 2²⁴, exact in the float. The ground's codes 1…RASTER_GROUND_LAST (rasterGroundCode),
 *  then the others. */
export const RASTER_CODE_SCALE = 262144;
export const RASTER_GROUND_LAST = 56;
export const RASTER_CODE = { turbine: 57, pylon: 58, cloud: 59, box: 60, bridgeMark: 61, mesh: 62, bridgeMesh: 63 } as const;
/** a level's code: 1 + its rank from the patch (0 the patch) + 8 × its step (levels coarser than the reference patch) */
export function rasterGroundCode(rank: number, step: number): number {
  return 1 + Math.min(Math.max(rank, 0), 7) + 8 * Math.min(Math.max(step, 0), 6);
}

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
// The scenery's instance drawn nearest at this pixel (g: a tree's cell + 1, exact in a float below 2²⁴; 0 none — a building's
// pixel's g its leaf: terrainRasterLeaf).
fn terrainRasterId(px: vec2f) -> u32 {
  let t = textureLoad(terrainDist, vec2i(floor(px)), 0);
  return select(u32(t.g), 0u, t.a >= ${RASTER_CODE.mesh * RASTER_CODE_SCALE}.0);
}
// A building's leaf at this pixel — its own triangles' or its solid box's (g: the record's offset from the scenery's geomOffset
// + 1, Q3) —; 0 none (a bridge's part, the ground, a tree).
fn terrainRasterLeaf(px: vec2f) -> u32 {
  let t = textureLoad(terrainDist, vec2i(floor(px)), 0);
  return select(0u, u32(t.g), floor(t.a / ${RASTER_CODE_SCALE}.0) == ${RASTER_CODE.mesh}.0);
}
// The nearest surface's distance [m] at this pixel (b: the ground's, or an instance's proxy before it; 0 none).
fn terrainRasterDepth(px: vec2f) -> f32 { return textureLoad(terrainDist, vec2i(floor(px)), 0).b; }
// (a: an integer below 2²⁴, exact in its float — what drew the pixel, its code × 2¹⁸ (RASTER_CODE: the ground's 1 + its rank from
// the patch + 8 × its step; the scenery's, a cloud's), and the ground's smooth normal, its octahedron 2 × 9 bits, each 1…511, 0 none
// — system/terrain-raster.ts rasterCode, T5)
fn terrainRasterCode(px: vec2f) -> f32 { return floor(textureLoad(terrainDist, vec2i(floor(px)), 0).a / ${RASTER_CODE_SCALE}.0); }
// A building's box before the ground and the trees at this pixel (system/scenery-raster.ts boxFs), a bridge's, their triangles.
fn terrainRasterBuilding(px: vec2f) -> bool { return terrainRasterCode(px) >= ${RASTER_CODE.box}.0; }
// A bridge's box before the ground at this pixel (system/scenery-raster.ts bridgeMarkFs): shadeLite's, its deck tested.
fn terrainRasterBridge(px: vec2f) -> bool { return terrainRasterCode(px) == ${RASTER_CODE.bridgeMark}.0; }
// A building's own triangles at this pixel (system/scenery-raster.ts meshFs): shadeLite's material — a wind turbine's too (Q8 D1).
fn terrainRasterMesh(px: vec2f) -> bool { let c = terrainRasterCode(px); return c >= ${RASTER_CODE.mesh}.0 || c == ${RASTER_CODE.turbine}.0 || c == ${RASTER_CODE.pylon}.0; }
// A pylon's triangles at this pixel (Q8 D1 — system/pylons.ts): galvanised steel.
fn terrainRasterPylon(px: vec2f) -> bool { return terrainRasterCode(px) == ${RASTER_CODE.pylon}.0; }
// A wind turbine's triangles at this pixel (Q8 D1 — system/turbines.ts): white, matte, no windows.
fn terrainRasterTurbine(px: vec2f) -> bool { return terrainRasterCode(px) == ${RASTER_CODE.turbine}.0; }
// A wind turbine's obstruction light at this pixel (Q8 D1 — its g 3, scenery-raster.ts meshVs): red at night, flashing.
fn terrainRasterLamp(px: vec2f) -> bool { let t = textureLoad(terrainDist, vec2i(floor(px)), 0); return floor(t.a / ${RASTER_CODE_SCALE}.0) == ${RASTER_CODE.turbine}.0 && t.g > 2.5; }
// A bridge's part's own triangles at this pixel (system/scenery-raster.ts meshFs): the material's, no windows.
fn terrainRasterBridgeMesh(px: vec2f) -> bool { return terrainRasterCode(px) == ${RASTER_CODE.bridgeMesh}.0; }
// How many levels coarser than the reference patch the ground here was drawn from (0 the patch — and what stands on it —, 1 its
// first coarser ring, …: system/terrain-raster.ts ringFs; 0 none).
fn terrainRasterLevelStep(px: vec2f) -> f32 {
  let c = terrainRasterCode(px);
  return select(0.0, floor((c - 1.0) / 8.0), c >= 1.0 && c <= ${RASTER_GROUND_LAST}.0);
}
// The mesh the ground here was drawn from (the patch and what stands on it 1, each ring its own code — T2: rasterNormal stops at
// every seam; 0 none).
fn terrainRasterSeam(px: vec2f) -> f32 { let c = terrainRasterCode(px); return select(c, 1.0, c > ${RASTER_GROUND_LAST}.0); }
// A frozen cloud's slab at this pixel (system/body-raster.ts bodyCloudFs, Mann's: PLAN-PLANETES-AAA P4).
fn terrainRasterCloud(px: vec2f) -> bool { return terrainRasterCode(px) == ${RASTER_CODE.cloud}.0; }
// The ground's smooth normal here, on the body's axes (T5: its level's slopes at its nodes, interpolated — system/terrain-raster.ts
// terrainNormal); 0: none (a runway's graded ground, the scenery's pixels, another world's) — the mesh's then (rasterNormal)
fn terrainRasterNormal(px: vec2f) -> vec3f {
  let a = textureLoad(terrainDist, vec2i(floor(px)), 0).a;
  let r = a - floor(a / ${RASTER_CODE_SCALE}.0) * ${RASTER_CODE_SCALE}.0;
  if (r < 1.0 || a / ${RASTER_CODE_SCALE}.0 >= ${RASTER_GROUND_LAST + 1}.0) { return vec3f(0.0); }
  let qx = floor(r / 512.0);
  let o = (vec2f(qx, r - qx * 512.0) - 1.0) / 510.0 * 2.0 - 1.0;
  var n = vec3f(o, 1.0 - abs(o.x) - abs(o.y));
  if (n.z < 0.0) { n = vec3f((1.0 - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0)), n.z); }
  return normalize(n);
}`,
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
// SUN_N (the ground's normal there, set: the bodies' — trace.wgsl nearShadow): the reach no less than what the 3 × 3's
// texels span along the Sun on that ground, two texels over the tangent of the Sun's height over it (a grazing Sun's texel
// is long on the ground: its sunward end ahead of the point by more than the reach, a shadow everywhere)
// (T6: the cascades — rows 6, 7: each its centre along R and U from the camera [m], its half-width, drawn — side by side in the
// atlas, each N × N: the finest covering the point read, faded into the next over its last sixth; their texel the reach's floor)
fn sunCascadeRead(k: u32, x: f32, y: f32, dz: f32, base: f32, H: f32, L: vec4f) -> vec3f {
  let n = vec2i(textureDimensions(sunShadowMap));
  let N = n.y;
  var reach = max(base, 3.0 * H / f32(N));
  if (dot(SUN_N, SUN_N) > 0.5) {
    let cl = clamp(dot(SUN_N, L.xyz), 0.05, 1.0);
    reach = max(reach, 4.0 * H / f32(N) * sqrt(1.0 - cl * cl) / cl);
  }
  let at = vec2i(vec2f((x * 0.5 + 0.5) * f32(N), (0.5 - y * 0.5) * f32(N))) + vec2i(i32(k) * N, 0);
  let lo = vec2i(i32(k) * N, 0);
  let hi = vec2i(i32(k + 1u) * N - 1, N - 1);
  var lit = 0.0;
  var occ = 3e38;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let d = textureLoad(sunShadowMap, clamp(at + vec2i(i, j), lo, hi), 0);
      let ahead = (dz - d) * 2.0 * L.w;
      lit += select(1.0, 0.0, ahead > reach);
      if (ahead > reach) { occ = min(occ, ahead); }
    }
  }
  return vec3f(lit / 9.0, reach, occ);
}
// base: the reach below which the map's relief is left to a nearer march (the traced kernels' ≤ 300 m — sunShadowFar —; the
// raster's ground none — liteSun: 0, the cascade's texels its floor)
fn sunShadowFarAt(rel: vec3f, base: f32) -> vec4f {
  let c = bodies[SS_OFF + 3u];
  if (c.x < 0.5) { return vec4f(-1.0, 0.0, 0.0, 3e38); }
  let R = bodies[SS_OFF]; let U = bodies[SS_OFF + 1u]; let L = bodies[SS_OFF + 2u]; let up = bodies[SS_OFF + 4u].xyz;
  let a = dot(rel, R.xyz);
  let b = dot(rel, U.xyz);
  var r = vec3f(-1.0, base, 3e38);
  for (var k = 0u; k < 2u; k++) {
    // (C: the cascade's centre along R and U from the camera now [m], its half-width — 0: not drawn —, the camera's step towards
    // the Sun since it was drawn [m]: its depths are from the camera then)
    let C = bodies[SS_OFF + 6u + k];
    if (C.z <= 0.0) { continue; }
    let dz = 0.5 - (dot(rel, L.xyz) + C.w) / (2.0 * L.w);
    let x = (a - C.x) / C.z;
    let y = (b - C.y) / C.z;
    let m = max(abs(x), abs(y));
    if (m >= 0.98) { continue; }
    r = sunCascadeRead(k, x, y, dz, base, C.z, L);
    // (near its edge: faded into the next, coarser one where it covers)
    let w = smoothstep(0.82, 0.98, m);
    let C1 = bodies[SS_OFF + 7u];
    if (k == 0u && w > 0.0 && C1.z > 0.0) {
      let x1 = (a - C1.x) / C1.z;
      let y1 = (b - C1.y) / C1.z;
      if (max(abs(x1), abs(y1)) < 0.98) {
        let r1 = sunCascadeRead(1u, x1, y1, 0.5 - (dot(rel, L.xyz) + C1.w) / (2.0 * L.w), base, C1.z, L);
        r = vec3f(mix(r.x, r1.x, w), max(r.y, r1.y), min(r.z, r1.z));
      }
    }
    break;
  }
  if (r.x < 0.0) { return vec4f(-1.0, 0.0, 0.0, 3e38); }
  // (the ray's way out of the cascades — a disc of radius c.z round the camera — on its horizontal, back along it)
  let lh = L.xyz - dot(L.xyz, up) * up; let ph = rel - dot(rel, up) * up;
  let lhl = length(lh);
  var exit = 3e38;
  if (lhl > 1e-4) {
    let ln = lh / lhl; let bb = dot(ph, ln); let cc = dot(ph, ph) - c.z * c.z;
    exit = (-bb + sqrt(max(bb * bb - cc, 0.0))) / lhl;
  }
  return vec4f(r.x, exit, r.y, r.z);
}
fn sunShadowFar(rel: vec3f) -> vec4f { return sunShadowFarAt(rel, bodies[SS_OFF + 3u].y); }`,
  );
}
