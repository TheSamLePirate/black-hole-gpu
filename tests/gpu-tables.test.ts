import { expect, test } from "bun:test";
import { PATH_CHUNK, PATH_MAX, TABLE_LUT, TABLE_PATH, TABLE_SH, TABLE_VEC4S } from "../src/gpu-tables";
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
  expect(TABLE_VEC4S).toBe(TABLE_PATH + PATH_MAX + PATH_MAX / PATH_CHUNK);
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
