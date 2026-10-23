import { expect, test } from "bun:test";
import {
  PATH_CHUNK,
  PATH_MAX,
  TABLE_LUT,
  TABLE_PATH,
  TABLE_SH,
  TABLE_TERRAIN,
  TABLE_SKY,
  SUN_SHADOW_VEC4S,
  SKY_AMBIENT_VEC4S,
  CSM_VEC4S,
  TSM_VEC4S,
  TABLE_VEC4S,
  TABLE_WALK,
  TABLE_WARP,
  TABLE_GEOID,
  GEOID_VEC4S,
  TABLE_ORTHO,
  ORTHO_VEC4S,
} from "../src/gpu-tables";
import { GEOID_H, GEOID_W } from "../src/system/geoid-grid";
import { TERRAIN_CACHE_VEC4S } from "../src/system/terrain-cache-layout";
import { WARP_LEVELS, WARP_N } from "../src/system/warp-grid";
import { sceneryShader } from "../src/system/scenery";
import { SCENERY_STORAGE_LIMIT } from "../src/system/scenery-data";

// The tracer's read-only tables in one buffer (PLAN-MONDE M9): the offsets the renderer writes at are the
// ones trace.wgsl reads at — 8 storage buffers at WebGPU's default, one optional worldwide scenery buffer.

const wgsl = await Bun.file(`${import.meta.dir}/../src/shaders/trace.wgsl`).text();
const constU = (name: string) => Number(new RegExp(`const ${name} = (\\d+)u;`).exec(wgsl)![1]);

test("the tables' offsets: the renderer's and the shader's the same", () => {
  expect(constU("SH_BASE")).toBe(TABLE_SH);
  expect(constU("LUT_OFF")).toBe(TABLE_LUT);
  expect(constU("PATH_OFF")).toBe(TABLE_PATH);
  expect(constU("PATH_MAX")).toBe(PATH_MAX);
  expect(constU("PATH_CHUNK")).toBe(PATH_CHUNK);
  expect(TABLE_WALK).toBe(TABLE_PATH + PATH_MAX + PATH_MAX / PATH_CHUNK);
  expect(TABLE_WARP).toBe(TABLE_WALK + Math.ceil((65 * 65) / 4));
  expect(constU("WARP_OFF")).toBe(TABLE_WARP);
  expect(constU("SKY_OFF")).toBe(TABLE_SKY);
  expect(constU("WARP_LEVELS")).toBe(WARP_LEVELS);
  expect(constU("WARP_N")).toBe(WARP_N);
  expect(TABLE_TERRAIN).toBe(TABLE_WARP + WARP_LEVELS * WARP_N * WARP_N);
  expect(TABLE_VEC4S).toBe(
    TABLE_TERRAIN + TERRAIN_CACHE_VEC4S + SUN_SHADOW_VEC4S + SKY_AMBIENT_VEC4S + CSM_VEC4S + TSM_VEC4S + GEOID_VEC4S + ORTHO_VEC4S,
  );
  expect(constU("GEOID_OFF")).toBe(TABLE_GEOID);
  expect(constU("ORTHO_OFF")).toBe(TABLE_ORTHO);
  expect(TABLE_ORTHO).toBe(TABLE_GEOID + GEOID_VEC4S);
  expect(TABLE_VEC4S).toBe(TABLE_ORTHO + ORTHO_VEC4S);
  expect([constU("GEOID_W"), constU("GEOID_H")]).toEqual([GEOID_W, GEOID_H]);
});

test("the trace stage retains eight-buffer compatibility and requires only one optional scenery buffer", () => {
  const storage = (code: string) => [...code.matchAll(/@group\(0\) @binding\((\d+)\) var<storage/g)].map((m) => Number(m[1]));
  // (the probe's own entry point binds its buffer at 12 — not in the main layout)
  const main = storage(wgsl).filter((b) => b !== 12);
  expect(main.length).toBeLessThanOrEqual(SCENERY_STORAGE_LIMIT);
  const baseline = storage(sceneryShader(wgsl, false)).filter((b) => b !== 12);
  expect(baseline.length).toBeLessThanOrEqual(8);
  expect(main.filter((b) => !baseline.includes(b))).toEqual([32]);
});
