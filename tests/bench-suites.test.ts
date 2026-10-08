import { expect, test } from "bun:test";
import { checkReport, suiteSummary, SUITES, type SceneReport } from "../src/bench/report";
import { BENCH_ITEMS, DEPTH_RANK, itemsFor } from "../src/bench/suites";
import { presets } from "../src/settings";
import { estimateSeconds } from "../src/bench/runner";
import { BENCH_MODES } from "../src/bench/report";

// The Kerr Bench's suites (kerr-bench/2): every item on a scene that exists, the depths nested, the
// estimate growing with the depth, a suite's summary, a /1 report still read back.

test("every item starts from a scene that exists, its id unique, its suite known", () => {
  const ids = new Set<string>();
  for (const i of BENCH_ITEMS) {
    expect(presets[i.scene], i.id).toBeDefined();
    expect(SUITES).toContain(i.suite);
    expect(ids.has(i.id)).toBe(false);
    ids.add(i.id);
  }
});

test("the depths nest: a deeper run takes every item of a lesser one; each suite has a quick item", () => {
  for (let k = 1; k < BENCH_MODES.length; k++) {
    const lo = itemsFor(BENCH_MODES[k - 1]!, SUITES).map((i) => i.id);
    const hi = itemsFor(BENCH_MODES[k]!, SUITES).map((i) => i.id);
    for (const id of lo) expect(hi).toContain(id);
    expect(hi.length).toBeGreaterThan(lo.length);
  }
  for (const s of SUITES.filter((s) => s !== "core")) expect(itemsFor("quick", [s]).length).toBeGreaterThan(0);
  expect(itemsFor("full", SUITES).length).toBe(BENCH_ITEMS.length);
  expect(DEPTH_RANK.quick).toBeLessThan(DEPTH_RANK.full);
});

test("the estimate grows with the depth and the suites; a quick run stays a few minutes", () => {
  const all = BENCH_MODES.map((m) => estimateSeconds(m, SUITES));
  for (let k = 1; k < all.length; k++) expect(all[k]!).toBeGreaterThan(all[k - 1]!);
  expect(all[0]!).toBeLessThan(5 * 60);
  expect(estimateSeconds("standard", ["core"])).toBeLessThan(estimateSeconds("standard", ["core", "flights"]));
  expect(estimateSeconds("quick", [])).toBe(0);
});

const item = (fps: number, p95: number, over33 = 0, status: SceneReport["status"] = "ok"): SceneReport => ({
  scene: "x",
  status,
  compileMs: 0,
  assetsMs: 0,
  gpuPasses: [],
  cpu: [],
  worstLoopMs: 0,
  longTasks: 0,
  vramMiB: null,
  errors: [],
  auto: { fps, p50: 1000 / fps, p95, p99: p95, over33, raysPerPx: 1, mraysPerS: 1, blocks: {}, scales: {} },
});

test("a suite's summary: the geometric mean, the worst p95, the playable items, the hitches", () => {
  const s = suiteSummary([item(60, 20), item(15, 80, 7), item(0, 0, 0, "error")]);
  expect(s.n).toBe(3);
  expect(s.fpsGeo).toBeCloseTo(30, 5);
  expect(s.worstP95).toBe(80);
  expect(s.playable).toBe(1);
  expect(s.hitches).toBe(7);
  expect(suiteSummary([]).fpsGeo).toBeNull();
});

test("a kerr-bench/1 report is still read back to compare", () => {
  const r = { schema: "kerr-bench/1", scenes: [], system: { gpu: {} } };
  expect(checkReport(r)).toBe(r as never);
  expect(() => checkReport({ schema: "kerr-bench/9", scenes: [], system: { gpu: {} } })).toThrow(/not a Kerr Bench/);
});
