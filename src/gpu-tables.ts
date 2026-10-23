// The tracer's read-only tables in one storage buffer (PLAN-MONDE M9): the bodies, the light probe's
// harmonics, the blackbody's and the synchrotron's colours, the camera's path, the walking grid, the mountains' warp —
// at fixed offsets, in vec4s, the same as trace.wgsl's SH_BASE, LUT_OFF, PATH_OFF and WARP_OFF (tests/gpu-tables.test.ts
// checks them). One binding instead of three: the trace stage within WebGPU's default 8 storage buffers per stage.

import { BB_LUT_SIZE, SYNC_LUT_SIZE } from "./physics";
import { BODY_VEC4, MAX_BODIES } from "./system/scene-bodies";
import { WARP_LEVELS, WARP_N } from "./system/warp-grid";
import { TERRAIN_CACHE_VEC4S } from "./system/terrain-cache-layout";
import { GEOID_H, GEOID_W } from "./system/geoid-grid";

/** the probe's harmonics: 9 × rgb, then the dominant direction */
export const SH_VEC4S = 10;
/** Camera free-fall path drawn in the render: points, then bounding spheres of chunks of 16 segments. */
export const PATH_MAX = 256;
export const PATH_CHUNK = 16;

/** where each table starts [vec4s] */
export const TABLE_SH = MAX_BODIES * BODY_VEC4;
export const TABLE_LUT = TABLE_SH + SH_VEC4S;
export const TABLE_PATH = TABLE_LUT + BB_LUT_SIZE + SYNC_LUT_SIZE;
export const TABLE_WALK = TABLE_PATH + PATH_MAX + PATH_MAX / PATH_CHUNK;
/** the mountains' warp's grids (system/warp-grid.ts): their levels' nodes, one vec4 each */
export const TABLE_WARP = TABLE_WALK + Math.ceil((65 * 65) / 4);
export const TABLE_TERRAIN = TABLE_WARP + WARP_LEVELS * WARP_N * WARP_N;
/** the relief's shadow map's view from the Sun (system/terrain-raster-hint.ts withSunShadow): right, up, the Sun, the
 *  march's split (on, near reach, the patch's radius), the camera's vertical */
export const TABLE_SUN = TABLE_TERRAIN + TERRAIN_CACHE_VEC4S;
export const SUN_SHADOW_VEC4S = 5;
/** the clear sky's light, physical (trace.wgsl skyAmbient): its frame, four altitudes' second-order spherical harmonics */
export const TABLE_SKY = TABLE_SUN + SUN_SHADOW_VEC4S;
// (its frame, the harmonics at four heights, the sea level's radiance on an 8 × 8 grid: trace.wgsl skyAmbient, skyMirror)
export const SKY_AMBIENT_VEC4S = 4 + 4 * 9 + 64;
/** the clouds' transmittance map's frame (trace.wgsl cloudShadow → csmHead; system/cloud-shadow.ts): its centre and
 *  half-width, right, up, towards the Sun and whether it is drawn */
export const TABLE_CSM = TABLE_SKY + SKY_AMBIENT_VEC4S;
export const CSM_VEC4S = 4;
/** the trees' and buildings' shadow map's frame (system/scenery-raster.ts encodeShadow; system/tree-shadow.ts): right, up,
 *  towards the Sun (each with its half-extent), its centre in the scenery's frame and whether it is drawn */
export const TABLE_TSM = TABLE_CSM + CSM_VEC4S;
export const TSM_VEC4S = 4;
/** the geoid's map (system/geoid.ts; trace.wgsl geoidN): its N [m] node by node, four a vec4, row by row from the north */
export const TABLE_GEOID = TABLE_TSM + TSM_VEC4S;
export const GEOID_VEC4S = (GEOID_W * GEOID_H) / 4;
export const TABLE_VEC4S = TABLE_GEOID + GEOID_VEC4S;
