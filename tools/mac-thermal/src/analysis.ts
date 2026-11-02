import { statSync, readFileSync } from "node:fs";
import { CATALOG, SnapshotSchema, ReportSchema, SessionSchema, VERSION, ToolError, validateSnapshot, type Snapshot, type Session, type Finding } from "./model.ts";

export function percentile(sorted: number[], fraction: number) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}
export function summarize(input: Snapshot[]) {
  if (!input.length) throw new ToolError("EMPTY_HISTORY", "No snapshots to analyze.");
  const samples = [...input].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const first = samples[0]!, last = samples.at(-1)!;
  const metrics: Record<string, any> = {};
  for (const [id, def] of Object.entries(CATALOG)) {
    const points = samples.flatMap(s => {
      const v = s.metrics[id]?.value;
      return v != null ? [{ value: v, time: Date.parse(s.timestamp) / 60_000 }] : [];
    });
    const values = points.map(p => p.value), sorted = [...values].sort((a, b) => a - b);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const meanTime = points.length ? points.reduce((a, p) => a + p.time, 0) / points.length : 0;
    const variance = points.reduce((a, p) => a + (p.time - meanTime) ** 2, 0);
    const slope = points.length >= 3 && variance > 0 && mean !== null
      ? points.reduce((a, p) => a + (p.time - meanTime) * (p.value - mean), 0) / variance : null;
    metrics[id] = { unit: def.unit, n: values.length, coveragePercent: 100 * values.length / samples.length,
      min: sorted[0] ?? null, max: sorted.at(-1) ?? null, sampleMean: mean,
      p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95),
      first: values[0] ?? null, last: values.at(-1) ?? null,
      delta: values.length > 1 ? values.at(-1)! - values[0]! : null, slopePerMinute: slope };
  }
  const pressureSampleCounts: Record<string, number> = {};
  const sourceAvailability: Record<string, { availableSamples: number; totalSamples: number }> = {};
  for (const sample of samples) {
    const pressure = sample.thermal.pressure ?? "unavailable";
    pressureSampleCounts[pressure] = (pressureSampleCounts[pressure] ?? 0) + 1;
    for (const [id, source] of Object.entries(sample.sources)) {
      sourceAvailability[id] ??= { availableSamples: 0, totalSamples: 0 };
      sourceAvailability[id]!.totalSamples++;
      if (source.status === "available") sourceAvailability[id]!.availableSamples++;
    }
  }
  const findings: Finding[] = [];
  const duration = Math.max(0, Date.parse(last.timestamp) - Date.parse(first.timestamp));
  for (const id of ["cpu.temperature_c", "gpu.temperature_c"]) {
    const stats = metrics[id];
    if (stats.n >= 5 && duration >= 10000 && stats.delta >= 2 && stats.slopePerMinute > 1)
      findings.push({ code: "temperature_rising", severity: "info", type: "inference",
        message: `${id} rose across the observed window; this is a sampled trend, not a thermal limit prediction.`, evidence: [`report.metrics.${id}`] });
  }
  const recoveries = metrics["gpu.recovery_count"];
  if (recoveries.n > 1 && recoveries.delta > 0) findings.push({ code: "gpu_recoveries_increased", severity: "warning", type: "observation",
    message: "The driver's recovery counter increased during this recording. The counter alone does not identify the cause.", evidence: ["report.metrics.gpu.recovery_count"] });
  if (recoveries.n > 1 && recoveries.delta < 0) findings.push({ code: "gpu_counter_reset", severity: "info", type: "limitation",
    message: "The GPU recovery counter decreased; its lifetime/reset behavior prevents treating the delta as an event count.", evidence: ["report.metrics.gpu.recovery_count"] });
  return ReportSchema.parse({ sampleCount: samples.length, startedAt: first.window.startedAt, endedAt: last.timestamp,
    elapsedMs: Math.max(0, Date.parse(last.timestamp) - Date.parse(first.window.startedAt)), metrics,
    pressureSampleCounts, sourceAvailability, findings,
    limitations: ["Statistics are sample-weighted, not time-weighted. Missing values are excluded, never filled with zero.",
      "Percentiles use linear interpolation. Slopes use least squares with actual sample completion times and require at least 3 valid points.",
      "Source windows are not synchronized. Pressure counts are sample counts, not fractions of elapsed time.",
      "Hardware thermal throttling and compute-vs-memory bottlenecks remain unconfirmed by these aggregate counters."] });
}

export function makeSession(samples: Snapshot[], workloadLabel: string | null = null): Session {
  return SessionSchema.parse({ schemaVersion: VERSION, kind: "session", id: crypto.randomUUID(),
    workloadLabel, report: summarize(samples), samples });
}

export function readHistory(path: string): Snapshot[] {
  let text: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new ToolError("INVALID_HISTORY", "History path must be a regular file.");
    if (stat.size > 16 * 1024 * 1024) throw new ToolError("HISTORY_TOO_LARGE", "History exceeds 16 MiB; use a smaller recording or a rotated log.");
    text = readFileSync(path, "utf8").trim();
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("HISTORY_READ_FAILED", `Could not read history: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!text) throw new ToolError("EMPTY_HISTORY", "The history file is empty.");
  let rows: unknown[];
  try {
    const json = JSON.parse(text);
    if (json?.kind === "session") {
      const session = SessionSchema.parse(json);
      if (!session.samples?.length) throw new ToolError("MISSING_SAMPLES", "This session contains only a summary. Record with --out to preserve all samples.");
      rows = session.samples;
    } else rows = Array.isArray(json) ? json : [json];
  } catch (error) {
    if (error instanceof ToolError) throw error;
    // Only fall back to JSONL when parsing JSON failed, not on an invalid session schema.
    if (!(error instanceof SyntaxError)) throw new ToolError("INVALID_HISTORY", "Session schema validation failed.");
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    try { rows = lines.map(line => JSON.parse(line)); }
    catch { throw new ToolError("INVALID_HISTORY", "History must be valid JSON or JSONL. A truncated final line is not silently discarded."); }
  }
  if (rows.length > 5000) throw new ToolError("TOO_MANY_SAMPLES", "At most 5000 snapshots can be analyzed at once.");
  const samples: Snapshot[] = [];
  const ids = new Map<string, string>();
  for (let i = 0; i < rows.length; i++) {
    const result = SnapshotSchema.safeParse(rows[i]);
    if (!result.success) throw new ToolError("INVALID_HISTORY", `Snapshot ${i + 1} does not match schema ${VERSION}.`, 2,
      "Use a v2 snapshot, a v2 session saved with --out, or the v2 monitor JSONL log.");
    const valid = validateSnapshot(result.data);
    const fingerprint = JSON.stringify(valid);
    if (ids.has(valid.id) && ids.get(valid.id) !== fingerprint)
      throw new ToolError("CONFLICTING_SNAPSHOT_ID", `Snapshot ID ${valid.id} refers to different data.`);
    if (!ids.has(valid.id)) { samples.push(valid); ids.set(valid.id, fingerprint); }
  }
  const hosts = new Set(samples.map(s => `${s.host.model}|${s.host.chip}|${s.host.osVersion}`));
  if (hosts.size > 1) throw new ToolError("MIXED_HOSTS", "A single history must have consistent model, chip and OS version.");
  if (!samples.length) throw new ToolError("EMPTY_HISTORY", "No valid snapshots found.");
  return samples;
}

export function compare(baseline: Snapshot[], candidate: Snapshot[], sameWorkloadDeclared = false) {
  const before = summarize(baseline), after = summarize(candidate);
  const metrics = Object.fromEntries(Object.keys(CATALOG).map(id => {
    const a = before.metrics[id]!, b = after.metrics[id]!;
    const delta = a.sampleMean !== null && b.sampleMean !== null ? b.sampleMean - a.sampleMean : null;
    return [id, { unit: a.unit, baselineMean: a.sampleMean, candidateMean: b.sampleMean, delta,
      relativeChangePercent: delta !== null && a.sampleMean !== 0 ? 100 * delta / Math.abs(a.sampleMean!) : null,
      baselineSamples: a.n, candidateSamples: b.n }];
  }));
  const identity = (s: Snapshot) => `${s.host.model}|${s.host.chip}|${s.host.osVersion}`;
  const knownHardware = [baseline[0]!, candidate[0]!].every(s => s.host.chip && s.host.model && s.host.osVersion);
  const sameReportedHardware = knownHardware && identity(baseline[0]!) === identity(candidate[0]!);
  const workloadDifferences = ["gpu.active_percent", "cpu.efficiency_scaled_percent", "cpu.performance_scaled_percent"]
    .filter(id => metrics[id]?.delta != null && Math.abs(metrics[id]!.delta!) > 10);
  return { schemaVersion: VERSION, kind: "comparison", baselineSampleCount: baseline.length, candidateSampleCount: candidate.length,
    sameWorkloadDeclared, sameReportedHardware, workloadDifferences,
    comparability: !sameReportedHardware || !sameWorkloadDeclared || workloadDifferences.length ? "limited" : "declared_only",
    metrics, baselinePressureSampleCounts: before.pressureSampleCounts, candidatePressureSampleCounts: after.pressureSampleCounts,
    conclusion: "Observed differences do not establish that thermal throttling caused them.",
    limitations: ["Matching model/chip/OS does not prove these recordings came from the same physical Mac.",
      "Workload declaration is supplied by the caller; clock-scaled utilization is also affected by frequency.",
      "Ambient temperature, cooling, battery/AC power mode, app throughput and workload equality were not controlled."] };
}
