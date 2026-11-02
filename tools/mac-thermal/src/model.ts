import * as z from "zod";

export const VERSION = "2.0.0";
export const SourceId = z.enum(["macmon", "powermetrics", "thermalState", "pmset", "gpuRegistry"]);
export type SourceId = z.infer<typeof SourceId>;
export const SourceSchema = z.object({
  status: z.enum(["available", "disabled", "authorization_required", "error"]),
  readStartedAt: z.iso.datetime({ offset: true }).nullable(), readEndedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
});
export const MetricSchema = z.object({
  value: z.number().finite().nullable(), unit: z.string(), source: SourceId,
  quality: z.enum(["reported", "estimated", "derived", "unavailable"]),
  unavailableReason: z.string().nullable(),
});
export const FindingSchema = z.object({
  code: z.string(), severity: z.enum(["info", "warning", "critical"]),
  type: z.enum(["observation", "inference", "limitation"]),
  message: z.string(), evidence: z.array(z.string()),
});
export type Finding = z.infer<typeof FindingSchema>;
export const SnapshotSchema = z.object({
  schemaVersion: z.literal(VERSION), kind: z.literal("snapshot"), id: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  host: z.object({ chip: z.string().nullable(), model: z.string().nullable(),
    osVersion: z.string().nullable(), architecture: z.string(), gpuCores: z.number().nullable() }),
  window: z.object({ startedAt: z.iso.datetime({ offset: true }), endedAt: z.iso.datetime({ offset: true }), elapsedMs: z.number().nonnegative(),
    requestedIntervalMs: z.number(), sourceReadEndSkewMs: z.number().nonnegative().nullable(),
    synchronized: z.literal(false) }),
  sources: z.record(SourceId, SourceSchema),
  metrics: z.record(z.string(), MetricSchema),
  thermal: z.object({ state: z.string().nullable(), pressure: z.string().nullable(),
    pressureSource: z.enum(["powermetrics", "os"]).nullable().optional(),
    hardwareThrottling: z.literal("unknown") }),
  gpuFrequencyDistribution: z.array(z.object({ frequencyMHz: z.number(), percent: z.number() })),
  gpuRequestedState: z.string().nullable(),
  fans: z.array(z.object({ name: z.string(), rpm: z.number().nullable(), maxRpm: z.number().nullable() })),
  findings: z.array(FindingSchema),
  coverage: z.object({ status: z.enum(["complete", "partial", "unavailable"]),
    availableMetricCount: z.number(), totalMetricCount: z.number(), unavailableMetricIds: z.array(z.string()) }),
  raw: z.unknown().optional(),
  selection: z.array(z.string()).optional(),
  freshness: z.object({ ageMs: z.number().nonnegative(), maxAgeSeconds: z.number().positive(), stale: z.literal(false), readFromFile: z.literal(true) }).optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Metric = z.infer<typeof MetricSchema>;

type Def = { unit: string; source: SourceId; quality: "reported" | "estimated" | "derived"; description: string; min?: number; max?: number };
const d = (unit: string, source: SourceId, description: string, quality: Def["quality"] = "reported", min?: number, max?: number): Def =>
  ({ unit, source, description, quality, min, max });
export const CATALOG: Record<string, Def> = {
  "cpu.temperature_c": d("degC", "macmon", "Mean CPU sensor temperature; not the hottest core.", "reported", -40, 150),
  "gpu.temperature_c": d("degC", "macmon", "Mean GPU sensor temperature; not the hottest core.", "reported", -40, 150),
  "cpu.efficiency_frequency_mhz": d("MHz", "macmon", "Frequency reported for efficiency tier.", "reported", 0),
  "cpu.performance_frequency_mhz": d("MHz", "macmon", "Frequency reported for performance tier.", "reported", 0),
  "cpu.efficiency_scaled_percent": d("percent", "macmon", "Frequency-scaled efficiency tier utilization, not active-time occupancy.", "reported", 0, 100),
  "cpu.performance_scaled_percent": d("percent", "macmon", "Frequency-scaled performance tier utilization, not active-time occupancy.", "reported", 0, 100),
  "gpu.frequency_mhz": d("MHz", "powermetrics", "Mean GPU frequency while hardware was active.", "reported", 0),
  "gpu.macmon_frequency_mhz": d("MHz", "macmon", "GPU frequency reported by macmon, with a distinct measurement window.", "reported", 0),
  "gpu.maximum_frequency_mhz": d("MHz", "macmon", "Maximum in the SoC's reported frequency table; not a promise of sustained frequency.", "reported", 0),
  "gpu.active_percent": d("percent", "powermetrics", "GPU hardware active residency; not ALU utilization or proof of compute saturation.", "reported", 0, 100),
  "gpu.idle_percent": d("percent", "powermetrics", "GPU hardware idle residency.", "reported", 0, 100),
  "gpu.scaled_percent": d("percent", "macmon", "Frequency-scaled activity; distinct from active residency.", "reported", 0, 100),
  "gpu.frequency_of_max_percent": d("percent", "powermetrics", "Active frequency / maximum frequency. A low ratio alone is not evidence of thermal throttling.", "derived", 0),
  "gpu.driver_device_percent": d("percent", "gpuRegistry", "Undocumented driver Device Utilization counter; update window unknown.", "reported", 0, 100),
  "gpu.driver_renderer_percent": d("percent", "gpuRegistry", "Undocumented driver Renderer counter. Do not add to Tiler or Device.", "reported", 0, 100),
  "gpu.driver_tiler_percent": d("percent", "gpuRegistry", "Undocumented driver Tiler counter. Not a compute/graphics workload classifier.", "reported", 0, 100),
  "gpu.memory_in_use_bytes": d("byte", "gpuRegistry", "Driver-reported system memory in use by GPU. Unified memory, not dedicated VRAM capacity.", "reported", 0),
  "gpu.memory_allocated_bytes": d("byte", "gpuRegistry", "Driver-reported allocated memory; not necessarily physically resident.", "reported", 0),
  "gpu.recovery_count": d("count", "gpuRegistry", "Driver recoveryCount counter; counter lifetime is unspecified.", "reported", 0),
  "gpu.power_w": d("W", "powermetrics", "Estimated GPU power in GPU usage section.", "estimated", 0),
  "gpu.macmon_power_w": d("W", "macmon", "GPU power estimate from macmon.", "estimated", 0),
  "cpu.power_w": d("W", "macmon", "CPU power estimate from macmon.", "estimated", 0),
  "ane.power_w": d("W", "macmon", "ANE power estimate. Zero may also reflect unavailable private counters on unsupported configurations.", "estimated", 0),
  "memory.power_w": d("W", "macmon", "RAM power estimate from macmon.", "estimated", 0),
  "system.power_w": d("W", "macmon", "Whole-system power reported by macmon, with its own measurement boundary.", "estimated", 0),
  "memory.used_bytes": d("byte", "macmon", "System RAM usage reported by macmon.", "reported", 0),
  "memory.total_bytes": d("byte", "macmon", "Installed system RAM size.", "reported", 0),
  "memory.swap_used_bytes": d("byte", "macmon", "Reported swap usage; nonzero does not prove current swapping.", "reported", 0),
  "cpu.speed_limit_percent": d("percent", "pmset", "CPU speed limit if published by pmset; cause is not inferred.", "reported", 0, 100),
  "cpu.scheduler_limit_percent": d("percent", "pmset", "CPU scheduler limit if published by pmset; cause is not inferred.", "reported", 0, 100),
};

export const StatsSchema = z.object({
  unit: z.string(), n: z.number(), coveragePercent: z.number(), min: z.number().nullable(),
  max: z.number().nullable(), sampleMean: z.number().nullable(), p50: z.number().nullable(), p95: z.number().nullable(),
  first: z.number().nullable(), last: z.number().nullable(), delta: z.number().nullable(),
  slopePerMinute: z.number().nullable(),
});
export const ReportSchema = z.object({
  sampleCount: z.number(), startedAt: z.string(), endedAt: z.string(),
  elapsedMs: z.number(), metrics: z.record(z.string(), StatsSchema),
  pressureSampleCounts: z.record(z.string(), z.number()),
  sourceAvailability: z.record(z.string(), z.object({ availableSamples: z.number(), totalSamples: z.number() })),
  findings: z.array(FindingSchema), limitations: z.array(z.string()),
});
export const SessionSchema = z.object({
  schemaVersion: z.literal(VERSION), kind: z.literal("session"), id: z.string(),
  workloadLabel: z.string().nullable(), report: ReportSchema,
  samples: z.array(SnapshotSchema).optional(),
  recording: z.object({ requestedSamples: z.number(), maxSeconds: z.number(), terminationReason: z.enum(["sample_limit", "duration_limit", "interrupted"]) }).optional(),
  selection: z.array(z.string()).optional(),
});
export type Session = z.infer<typeof SessionSchema>;
export const ErrorSchema = z.object({
  schemaVersion: z.literal(VERSION), kind: z.literal("error"),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean(), remedy: z.string().nullable(), details: z.unknown().optional() }),
});
export class ToolError extends Error {
  details?: unknown;
  constructor(public code: string, message: string, public exitCode = 2, public remedy: string | null = null, public retryable = false) { super(message); }
}
export function errorEnvelope(error: unknown) {
  const e = error instanceof ToolError ? error : new ToolError("INTERNAL_ERROR", error instanceof Error ? error.message : String(error), 1);
  return { exitCode: e.exitCode, data: ErrorSchema.parse({ schemaVersion: VERSION, kind: "error", error: {
    code: e.code, message: e.message, retryable: e.retryable, remedy: e.remedy, ...(e.details === undefined ? {} : { details: e.details }),
  } }) };
}
export function selectMetrics(snapshot: Snapshot, selectors?: string[]): Snapshot {
  if (!selectors?.length) return snapshot;
  const ids = metricIds(selectors);
  // Coverage always describes the complete collection, even when output is filtered.
  return { ...snapshot, selection: [...ids], metrics: Object.fromEntries(Object.entries(snapshot.metrics).filter(([id]) => ids.has(id))) };
}
export function metricIds(selectors: string[]) {
  const ids = new Set<string>();
  for (const selector of selectors) {
    const matches = Object.keys(CATALOG).filter(id => selector.endsWith(".*") ? id.startsWith(selector.slice(0, -1)) : id === selector);
    if (!matches.length) throw new ToolError("UNKNOWN_METRIC", `Unknown metric selector: ${selector}`, 2, "Run catalog to list available metric IDs.");
    matches.forEach(id => ids.add(id));
  }
  return ids;
}
export function outputSchemas() {
  return { schemaVersion: VERSION, kind: "schemas", snapshot: z.toJSONSchema(SnapshotSchema),
    session: z.toJSONSchema(SessionSchema), analysis: z.toJSONSchema(AnalysisSchema), comparison: z.toJSONSchema(ComparisonSchema),
    capabilities: z.toJSONSchema(CapabilitiesSchema), error: z.toJSONSchema(ErrorSchema) };
}

export const AnalysisSchema = z.object({ schemaVersion: z.literal(VERSION), kind: z.literal("analysis"), report: ReportSchema, selection: z.array(z.string()).optional() });
export const ComparisonSchema = z.object({
  schemaVersion: z.literal(VERSION), kind: z.literal("comparison"), baselineSampleCount: z.number(), candidateSampleCount: z.number(),
  sameWorkloadDeclared: z.boolean(), sameReportedHardware: z.boolean(), workloadDifferences: z.array(z.string()),
  comparability: z.enum(["limited", "declared_only"]),
  metrics: z.record(z.string(), z.object({ unit: z.string(), baselineMean: z.number().nullable(), candidateMean: z.number().nullable(),
    delta: z.number().nullable(), relativeChangePercent: z.number().nullable(), baselineSamples: z.number(), candidateSamples: z.number() })),
  baselinePressureSampleCounts: z.record(z.string(), z.number()), candidatePressureSampleCounts: z.record(z.string(), z.number()),
  conclusion: z.string(), limitations: z.array(z.string()), selection: z.array(z.string()).optional(),
});
export const CapabilitiesSchema = z.object({
  schemaVersion: z.literal(VERSION), kind: z.literal("capabilities"), supported: z.boolean(), platform: z.string(), architecture: z.string(),
  osVersion: z.string().nullable(), macmonPath: z.string().nullable(), macmonVersion: z.string().nullable(),
  powermetrics: z.object({ available: z.boolean(), samplers: z.array(z.string()), flags: z.array(z.string()), authorized: z.boolean(),
    feed: z.object({ path: z.string(), ageMs: z.number(), fresh: z.boolean() }).nullable().optional() }), notes: z.array(z.string()),
});

export function validateSnapshot(input: unknown): Snapshot {
  const sample = SnapshotSchema.parse(input);
  for (const [id, metric] of Object.entries(sample.metrics)) {
    const def = CATALOG[id];
    if (!def || metric.unit !== def.unit || metric.source !== def.source)
      throw new ToolError("INVALID_METRIC_CONTRACT", `Metric ${id} has an unknown ID, wrong unit or wrong source.`);
    if ((metric.value === null) !== (metric.quality === "unavailable") || (metric.value === null && !metric.unavailableReason))
      throw new ToolError("INVALID_METRIC_CONTRACT", `Metric ${id} has inconsistent value/quality/missing reason.`);
    if (metric.value !== null && ((def.min !== undefined && metric.value < def.min) || (def.max !== undefined && metric.value > def.max)))
      throw new ToolError("INVALID_METRIC_CONTRACT", `Metric ${id} is outside its documented range.`);
  }
  return sample;
}
