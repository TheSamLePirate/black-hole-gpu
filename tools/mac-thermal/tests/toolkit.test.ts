import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sample, fixture, CAP } from "./fixtures.ts";
import { SnapshotSchema, SessionSchema, validateSnapshot, selectMetrics, metricIds, errorEnvelope, ToolError, ComparisonSchema, outputSchemas } from "../src/model.ts";
import { normalizeSnapshot, createRunner } from "../src/runtime.ts";
import { summarize, percentile, makeSession, readHistory, compare } from "../src/analysis.ts";
import { writeAtomic, latest, appendRotating, acquireLock } from "../src/files.ts";
const directory = mkdtempSync(join(tmpdir(), "mac-thermal-test-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const path = (name: string) => join(directory, name);

test("real supplied power capture preserves activity, clocks, distribution and correct section power", () => {
  const s = sample();
  expect(SnapshotSchema.safeParse(s).success).toBe(true);
  expect(s.metrics["gpu.active_percent"]!.value).toBe(100);
  expect(s.metrics["gpu.power_w"]!.value).toBe(15.608);
  expect(s.gpuFrequencyDistribution.find(f => f.frequencyMHz === 1296)?.percent).toBe(65);
  expect(s.thermal.hardwareThrottling).toBe("unknown");
  expect(s.raw).toBeUndefined();
});

test("zero remains a value; absent fields remain null with source and reason", () => {
  const s = sample();
  expect(s.metrics["ane.power_w"]!.value).toBe(0);
  expect(s.metrics["gpu.recovery_count"]!.value).toBe(0);
  expect(s.metrics["cpu.speed_limit_percent"]!.value).toBeNull();
  expect(s.metrics["cpu.speed_limit_percent"]!.unavailableReason).toBe("NOT_EXPOSED");
  expect(validateSnapshot(s)).toEqual(s);
});

test("missing authorization is distinguished from disabled and failing sources", () => {
  const raw = fixture(); raw.powermetrics = null; raw.powermetricsEnabled = false;
  const cap = structuredClone(CAP); cap.powermetrics.authorized = false;
  expect(normalizeSnapshot(raw, cap, "auto").sources.powermetrics.status).toBe("authorization_required");
  expect(normalizeSnapshot(raw, cap, "off").sources.powermetrics.status).toBe("disabled");
});

test("out of range activity is rejected instead of becoming an affirmative GPU diagnosis", () => {
  const raw = fixture(); raw.powermetrics!.gpu.activePercent = 123;
  const s = normalizeSnapshot(raw, CAP, "auto");
  expect(s.metrics["gpu.active_percent"]!.value).toBeNull();
  expect(s.findings.some(f => f.code === "invalid_metric")).toBe(true);
  expect(s.findings.some(f => f.code === "gpu_continuously_active")).toBe(false);
});

test("metric contract rejects unit, missing-state and impossible-value corruption", () => {
  const s = sample(); s.metrics["gpu.temperature_c"]!.unit = "fahrenheit";
  expect(() => validateSnapshot(s)).toThrow("wrong unit");
  const q = sample(); q.metrics["gpu.temperature_c"]!.quality = "unavailable";
  expect(() => validateSnapshot(q)).toThrow("inconsistent");
  const r = sample(); r.metrics["gpu.active_percent"]!.value = 101;
  expect(() => validateSnapshot(r)).toThrow("range");
});

test("selection is exact or explicit prefix, retains complete coverage metadata", () => {
  const s = selectMetrics(sample(), ["gpu.*"]);
  expect(Object.keys(s.metrics).every(id => id.startsWith("gpu."))).toBe(true);
  expect(s.coverage.totalMetricCount).toBeGreaterThan(Object.keys(s.metrics).length);
  expect(s.selection?.length).toBe(Object.keys(s.metrics).length);
  expect(() => metricIds(["gpu.password"])).toThrow("Unknown metric");
});

test("statistics exclude missing values and slopes use elapsed time", () => {
  const base = Date.parse("2026-10-29T20:00:00Z");
  const samples = [0, 1, 3].map(minutes => {
    const s = sample(base + minutes * 60000);
    s.metrics["gpu.temperature_c"]!.value = 70 + minutes * 2;
    return s;
  });
  const report = summarize(samples);
  expect(report.metrics["gpu.temperature_c"]!.sampleMean).toBeCloseTo(72.666666, 4);
  expect(report.metrics["gpu.temperature_c"]!.slopePerMinute).toBeCloseTo(2, 4);
  expect(report.metrics["cpu.speed_limit_percent"]!.n).toBe(0);
  expect(report.metrics["cpu.speed_limit_percent"]!.sampleMean).toBeNull();
  expect(report.metrics["cpu.speed_limit_percent"]!.coveragePercent).toBe(0);
  expect(percentile([0, 10], 0.95)).toBe(9.5);
  expect(percentile([], 0.5)).toBeNull();
});

test("comparison never converts unlike workloads into a causal thermal conclusion", () => {
  const a = sample(), b = sample(); b.metrics["gpu.active_percent"]!.value = 20;
  const result = compare([a], [b], true);
  expect(ComparisonSchema.safeParse(result).success).toBe(true);
  expect(result.comparability).toBe("limited");
  expect(result.workloadDifferences).toContain("gpu.active_percent");
  expect(result.conclusion).toContain("do not establish");
  expect(result.metrics["ane.power_w"]!.relativeChangePercent).toBeNull();
});

test("atomic latest permissions, freshness checks and future-clock rejection", () => {
  const value = sample(Date.now()); writeAtomic(path("latest.json"), value);
  expect(statSync(path("latest.json")).mode & 0o777).toBe(0o600);
  expect(latest(path("latest.json"), 15).freshness.stale).toBe(false);
  expect(() => latest(path("latest.json"), 15, Date.now() + 20000)).toThrow("old");
  expect(() => latest(path("latest.json"), 15, Date.now() - 20000)).toThrow("future");
});

test("session and JSONL import validate and deduplicate exact sample IDs", () => {
  const s = sample(); writeAtomic(path("session.json"), makeSession([s]));
  expect(readHistory(path("session.json"))).toHaveLength(1);
  writeFileSync(path("log.jsonl"), `${JSON.stringify(s)}\n${JSON.stringify(s)}\n`);
  expect(readHistory(path("log.jsonl"))).toHaveLength(1);
  writeFileSync(path("broken.jsonl"), `${JSON.stringify(s)}\n{"truncated":`);
  expect(() => readHistory(path("broken.jsonl"))).toThrow("truncated");
  const mixed = sample(); mixed.host.model = "different";
  writeFileSync(path("mixed.json"), JSON.stringify([s, mixed]));
  expect(() => readHistory(path("mixed.json"))).toThrow("consistent");
});

test("bounded log rotates whole records, never truncates a JSONL record", () => {
  const p = path("rotate.jsonl");
  appendRotating(p, { n: 1 }, 10); appendRotating(p, { n: 2 }, 10); appendRotating(p, { n: 3 }, 10);
  expect(JSON.parse(readFileSync(p, "utf8")).n).toBe(3);
  expect(JSON.parse(readFileSync(`${p}.1`, "utf8")).n).toBe(2);
  expect(JSON.parse(readFileSync(`${p}.2`, "utf8")).n).toBe(1);
});

test("collector lock prevents a second writer and is released cleanly", () => {
  const release = acquireLock(path("locked.json"));
  expect(() => acquireLock(path("locked.json"))).toThrow("collector");
  release(); expect(existsSync(path("locked.json.lock"))).toBe(false);
  const second = acquireLock(path("locked.json")); second();
});

test("errors have stable machine codes, and every declared schema can be generated", () => {
  const e = errorEnvelope(new ToolError("AUTH_REQUIRED", "No auth", 3, "Run monitor", true));
  expect(e.exitCode).toBe(3); expect(e.data.error.code).toBe("AUTH_REQUIRED");
  expect(outputSchemas().snapshot.$schema).toContain("2020-12");
  expect(SessionSchema.safeParse(makeSession([sample()])).success).toBe(true);
});

test("runner bounds subprocess duration and cancels owned processes", async () => {
  const runner = createRunner();
  const start = Date.now();
  const result = await runner([process.execPath, "-e", "setInterval(()=>{}, 1000)"], 50);
  expect(result.code).toBe(124); expect(Date.now() - start).toBeLessThan(3000);
  const control = new AbortController();
  const pending = createRunner(control.signal)([process.execPath, "-e", "setInterval(()=>{},1000)"], 5000);
  setTimeout(() => control.abort(), 30);
  expect((await pending).code).toBe(130);
});

test("runner bounds source output", async () => {
  const result = await createRunner()([process.execPath, "-e", 'process.stdout.write("x".repeat(3*1024*1024)); setInterval(()=>{},1000)'], 3000);
  expect(result.code).toBe(125);
  expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(2 * 1024 * 1024);
});
