import { expect, test } from "bun:test";
import { PATH_CHUNK, PATH_MAX, TABLE_LUT, TABLE_PATH, TABLE_SH, TABLE_VEC4S } from "../src/gpu-tables";

// The tracer's read-only tables in one buffer (PLAN-MONDE M9): the offsets the renderer writes at are the
// ones trace.wgsl reads at — and the stage binds 8 storage buffers, WebGPU's default (Android, Safari).

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

test("the trace stage: 8 storage buffers at most, in every entry point's bindings", () => {
  const storage = [...wgsl.matchAll(/@group\(0\) @binding\((\d+)\) var<storage/g)].map((m) => Number(m[1]));
  // (the probe's own entry point binds its buffer at 12 — not in the main layout)
  const main = storage.filter((b) => b !== 12);
  expect(main.length).toBeLessThanOrEqual(8);
});
