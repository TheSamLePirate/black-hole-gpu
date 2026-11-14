import { expect, test } from "bun:test";
import { GpuProfiler } from "../src/gpuprof";

// The GPU profiler's table: a pass no longer run keeps its last value (the horizons' occasional bake reads it), but a table of the frame
// (`table(maxAge)`) leaves it out — 14 Nov 2026, "sky (waiting)" read 14 ms in a flight long after the start's compile had ended.
test("table(maxAge) leaves out the passes not measured lately; table() keeps them", () => {
  const prof = new GpuProfiler({ features: new Set<string>() } as unknown as GPUDevice);
  const stats = (prof as unknown as { stats: Map<string, { label: string; ms: number; last: number; n: number; at: number }> }).stats;
  stats.set("sky (waiting)", { label: "sky (waiting)", ms: 14, last: 14, n: 40, at: 3 });
  stats.set("trace", { label: "trace", ms: 6, last: 6, n: 900, at: 900 });
  prof.frames = 900;
  expect(prof.table().map((p) => p.label)).toEqual(["sky (waiting)", "trace"]);
  expect(prof.table(60).map((p) => p.label)).toEqual(["trace"]);
  expect(prof.table(1000).length).toBe(2);
});
