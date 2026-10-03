import { expect, test } from "bun:test";
import {
  checkReport,
  frameStats,
  kerrScore,
  reportFileName,
  SCHEMA,
  tierOfScore,
  type BenchReport,
  type SceneReport,
} from "../src/bench/report";

// The Kerr Bench's report: the frame statistics, the score against the reference machine, the tier
// it measures, a report read back checked.

const scene = (name: string, mrays: number, status: SceneReport["status"] = "ok"): SceneReport => ({
  scene: name,
  status,
  compileMs: 0,
  assetsMs: 0,
  gpuPasses: [],
  cpu: [],
  worstLoopMs: 0,
  longTasks: 0,
  vramMiB: null,
  errors: [],
  fixed: { fps: 30, p50: 33, p95: 40, p99: 45, over33: 1, mraysPerS: mrays, width: 1600, height: 900 },
});

test("frame statistics: the rate from the span, the percentiles from the intervals", () => {
  const iv = Array.from({ length: 100 }, (_, i) => (i < 95 ? 16 : 50));
  const s = frameStats(iv, 1000 * (95 * 0.016 + 5 * 0.05));
  expect(s.p50).toBe(16);
  expect(s.p95).toBe(50);
  expect(s.over33).toBe(5);
  expect(s.fps).toBeCloseTo(56.5, 0);
  expect(Number.isNaN(frameStats([], 1000).p50)).toBe(true);
});

test("the Kerr Score: 1000 on the reference, the geometric mean of the ratios, none without a scene in common", () => {
  const ref = { a: 10, b: 2 };
  expect(kerrScore([scene("a", 10), scene("b", 2)], ref)).toBe(1000);
  expect(kerrScore([scene("a", 20), scene("b", 1)], ref)).toBe(1000); // (×2 and ×½)
  expect(kerrScore([scene("a", 40), scene("b", 8)], ref)).toBe(4000);
  expect(kerrScore([scene("a", 40, "error"), scene("c", 8)], ref)).toBeNull();
});

test("the tier and quality a score recommends", () => {
  expect(tierOfScore(null)).toEqual({ tier: null, quality: null });
  expect(tierOfScore(100).tier).toBe(0);
  expect(tierOfScore(1000)).toEqual({ tier: 3, quality: "high" });
  expect(tierOfScore(5000).tier).toBe(4);
});

test("a report read back: its schema checked, a file name from the machine", () => {
  expect(() => checkReport({})).toThrow(/kerr-bench/);
  expect(() => checkReport({ schema: SCHEMA })).toThrow(/incomplete/);
  const r = {
    schema: SCHEMA,
    scenes: [],
    system: { gpu: { description: "NVIDIA GeForce RTX 3060" } },
    machineLabel: "",
    app: { date: "2026-10-04T10:00:00Z" },
  } as unknown as BenchReport;
  expect(checkReport(r)).toBe(r);
  expect(reportFileName(r)).toBe("kerr-bench-NVIDIA-GeForce-RTX-3060-2026-10-04.json");
});
