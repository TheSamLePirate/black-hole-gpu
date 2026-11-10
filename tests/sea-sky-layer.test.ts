import { expect, test } from "bun:test";
import { SKY_LAYER } from "../src/sea/fft-gpu";

// PLAN-MER-WEBGPU S5: the sky the sea mirrors lives in the sea's texture array, one layer after the cascades' and the world
// foam's (sea/fft-gpu.ts SKY_LAYER) — the tracer reads it by its own constant (trace.wgsl SEA_SKY_LAYER): the two must agree.
test("the sea's sky layer: the same index in TypeScript and WGSL", async () => {
  const wgsl = await Bun.file(`${import.meta.dir}/../src/shaders/trace.wgsl`).text();
  const m = wgsl.match(/const SEA_SKY_LAYER = (\d+)u;/);
  expect(m).not.toBeNull();
  expect(Number(m![1])).toBe(SKY_LAYER);
});
