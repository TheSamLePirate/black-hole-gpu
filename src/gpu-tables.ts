// The tracer's read-only tables in one storage buffer (PLAN-MONDE M9): the bodies, the light probe's
// harmonics, the blackbody's and the synchrotron's colours, the camera's path — at fixed offsets, in vec4s,
// the same as trace.wgsl's SH_BASE, LUT_OFF and PATH_OFF (tests/gpu-tables.test.ts checks them). One
// binding instead of three: the trace stage within WebGPU's default 8 storage buffers per stage.

import { BB_LUT_SIZE, SYNC_LUT_SIZE } from "./physics";
import { BODY_VEC4, MAX_BODIES } from "./system/scene-bodies";

/** the probe's harmonics: 9 × rgb, then the dominant direction */
export const SH_VEC4S = 10;
/** Camera free-fall path drawn in the render: points, then bounding spheres of chunks of 16 segments. */
export const PATH_MAX = 256;
export const PATH_CHUNK = 16;

/** where each table starts [vec4s] */
export const TABLE_SH = MAX_BODIES * BODY_VEC4;
export const TABLE_LUT = TABLE_SH + SH_VEC4S;
export const TABLE_PATH = TABLE_LUT + BB_LUT_SIZE + SYNC_LUT_SIZE;
export const TABLE_VEC4S = TABLE_PATH + PATH_MAX + PATH_MAX / PATH_CHUNK;
