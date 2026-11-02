import { statSync } from "node:fs";
import { collect, normalizeMacmon } from "./legacy.ts";
import { CATALOG, SnapshotSchema, ToolError, VERSION, type Metric, type Snapshot, type SourceId, type Finding } from "./model.ts";

export type PowerMode = "auto" | "required" | "off";
type Result = { code: number; stdout: string; stderr: string };
export type ReadTiming = { readStartedAt: string; readEndedAt: string; durationMs: number };
export type Runner = (args: string[], timeout?: number) => Promise<Result>;
export type LegacySample = Awaited<ReturnType<typeof collect>>;
export type Capabilities = {
  schemaVersion: string; kind: "capabilities"; supported: boolean;
  platform: string; architecture: string; osVersion: string | null;
  macmonPath: string | null; macmonVersion: string | null;
  powermetrics: { available: boolean; samplers: string[]; flags: string[]; authorized: boolean; feed?: PowerFeed | null };
  notes: string[];
};

/** powermetrics' samples written by a root daemon (service/powermetrics-feed.sh), read by everyone: no sudo here. */
export const DEFAULT_POWER_FEED = "/var/run/kerr-thermal/powermetrics.txt";
export type PowerFeed = { path: string; ageMs: number; fresh: boolean };
/** The feed's state: MAC_THERMAL_POWER_FEED or the default path ("none": never); fresh within maxAgeMs. */
export function powerFeed(path = process.env.MAC_THERMAL_POWER_FEED ?? DEFAULT_POWER_FEED, maxAgeMs = 15_000, now = Date.now()): PowerFeed | null {
  if (!path || path === "none") return null;
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    const ageMs = Math.max(0, now - st.mtimeMs);
    return { path, ageMs: Math.round(ageMs), fresh: ageMs <= maxAgeMs && st.mtimeMs <= now + 5000 };
  } catch { return null; }
}

export function createRunner(signal?: AbortSignal, timing?: (args: string[], t: ReadTiming) => void): Runner {
  return async (args, timeout = 15_000) => {
    signal?.throwIfAborted();
    const start = Date.now();
    const readStartedAt = new Date(start).toISOString();
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let timedOut = false;
    let exceeded = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      try { child?.kill("SIGTERM"); } catch {}
      escalation ??= setTimeout(() => { try { child?.kill("SIGKILL"); } catch {} }, 1000);
    };
    const bounded = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let output = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 2 * 1024 * 1024) { exceeded = true; terminate(); await reader.cancel(); break; }
          output += decoder.decode(chunk.value, { stream: true });
        }
        return output + decoder.decode();
      } finally { reader.releaseLock(); }
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeout);
    signal?.addEventListener("abort", terminate, { once: true });
    try {
      child = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe",
        env: { ...process.env, LC_ALL: "C", LANG: "C" } });
      if (signal?.aborted) terminate();
      const [stdout, stderr, code] = await Promise.all([
        bounded(child.stdout as ReadableStream<Uint8Array>), bounded(child.stderr as ReadableStream<Uint8Array>), child.exited,
      ]);
      return { code: signal?.aborted ? 130 : timedOut ? 124 : exceeded ? 125 : code,
        stdout, stderr: signal?.aborted ? "CANCELLED" : timedOut ? "SOURCE_TIMEOUT" : exceeded ? "SOURCE_OUTPUT_LIMIT" : stderr };
    } catch (error) {
      return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer); if (escalation) clearTimeout(escalation);
      signal?.removeEventListener("abort", terminate);
      timing?.(args, { readStartedAt, readEndedAt: new Date().toISOString(), durationMs: Date.now() - start });
    }
  };
}

export async function capabilities(runner: Runner = createRunner()): Promise<Capabilities> {
  const macmonPath = Bun.which("macmon");
  const commands = [
    ["/usr/bin/sw_vers", "-productVersion"],
    ["/usr/bin/powermetrics", "--help"],
    ["/usr/bin/sudo", "-n", "-v"],
    ...(macmonPath ? [[macmonPath, "--version"]] : []),
  ];
  const results = await Promise.all(commands.map(c => runner(c, 5000)));
  const feed = powerFeed();
  const help = results[1]?.code === 0 ? results[1].stdout : "";
  const samplers = ["thermal", "cpu_power", "gpu_power", "ane_power", "sfi", "battery", "smc"]
    .filter(name => new RegExp(`^\\s+${name}\\s+`, "m").test(help));
  return {
    schemaVersion: VERSION, kind: "capabilities", supported: process.platform === "darwin" && process.arch === "arm64",
    platform: process.platform, architecture: process.arch,
    osVersion: results[0]?.code === 0 ? results[0].stdout.trim() : null,
    macmonPath, macmonVersion: results[3]?.code === 0 ? results[3].stdout.trim() : null,
    powermetrics: { available: samplers.includes("thermal"), samplers,
      flags: ["--show-plimits", "--show-extra-power-info"].filter(f => help.includes(f)),
      authorized: !!feed?.fresh || results[2]?.code === 0, feed },
    notes: [
      "Capabilities are probed at invocation time. sudo authorization is local to the process/terminal context and may expire.",
      "No network service is started. No password is accepted as an argument or stored.",
      "SMC sensors, fan RPM and private counters vary by OS/tool version. Absence is represented as unavailable.",
    ],
  };
}

export function powerArguments(cap: Capabilities, intervalMs: number): string[] {
  if (cap.powermetrics.feed?.fresh) return ["/bin/cat", cap.powermetrics.feed.path];
  return ["/usr/bin/sudo", "-n", "/usr/bin/powermetrics", "--samplers", cap.powermetrics.samplers.join(","),
    "-i", String(intervalMs), "-n", "1", ...cap.powermetrics.flags];
}

export async function authenticate() {
  if (!process.stdin.isTTY) throw new ToolError("AUTH_REQUIRED", "Interactive terminal authentication is required.", 3,
    "Run monitor --power required in a terminal; let the agent read its --latest file.");
  console.error("Authentification administrateur pour powermetrics ; saisie gérée par sudo.");
  const proc = Bun.spawn(["/usr/bin/sudo", "-v"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (await proc.exited !== 0) throw new ToolError("AUTH_FAILED", "sudo authentication failed or was cancelled.", 3);
}

const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const pct = (v: unknown) => finite(v) === null ? null : (v as number) * 100;
export function normalizeSnapshot(raw: LegacySample, cap: Capabilities, mode: PowerMode,
  timings: Partial<Record<SourceId, ReadTiming>> = {}, includeRaw = false): Snapshot {
  const n = raw.macmon ? normalizeMacmon(raw.macmon) : null;
  const p = raw.powermetrics?.gpu;
  const r = raw.gpuRegistry;
  const soc = raw.macmon?.soc;
  const frequencies = Array.isArray(soc?.gpu_freqs) ? soc.gpu_freqs.filter((v: unknown) => finite(v) !== null) as number[] : [];
  const maximum = Math.max(0, ...frequencies) || null;
  const pm = (name: string) => {
    const m = raw.pmset?.match(new RegExp(`${name}\\s*=\\s*(\\d+)`)); return m ? Number(m[1]) : null;
  };
  const values: Record<string, unknown> = {
    "cpu.temperature_c": n?.cpuCelsius, "gpu.temperature_c": n?.gpuCelsius,
    "cpu.efficiency_frequency_mhz": n?.efficiency.frequencyMHz,
    "cpu.performance_frequency_mhz": n?.performance.frequencyMHz,
    "cpu.efficiency_scaled_percent": pct(n?.efficiency.scaledRatio),
    "cpu.performance_scaled_percent": pct(n?.performance.scaledRatio),
    "gpu.frequency_mhz": p?.frequencyMHz, "gpu.macmon_frequency_mhz": n?.gpu.frequencyMHz,
    "gpu.maximum_frequency_mhz": maximum, "gpu.active_percent": p?.activePercent,
    "gpu.idle_percent": p?.idlePercent, "gpu.scaled_percent": pct(n?.gpu.scaledRatio),
    "gpu.frequency_of_max_percent": p?.frequencyMHz != null && maximum ? 100 * p.frequencyMHz / maximum : null,
    "gpu.driver_device_percent": r?.deviceUtilizationPercent, "gpu.driver_renderer_percent": r?.rendererUtilizationPercent,
    "gpu.driver_tiler_percent": r?.tilerUtilizationPercent, "gpu.memory_in_use_bytes": r?.memoryInUseBytes,
    "gpu.memory_allocated_bytes": r?.memoryAllocatedBytes, "gpu.recovery_count": r?.recoveryCount,
    "gpu.power_w": p?.powerWatts, "gpu.macmon_power_w": n?.watts.gpu, "cpu.power_w": n?.watts.cpu,
    "ane.power_w": n?.watts.ane, "memory.power_w": n?.watts.ram, "system.power_w": n?.watts.sys,
    "memory.used_bytes": raw.macmon?.memory?.ram_usage, "memory.total_bytes": raw.macmon?.memory?.ram_total,
    "memory.swap_used_bytes": raw.macmon?.memory?.swap_usage,
    "cpu.speed_limit_percent": pm("CPU_Speed_Limit"), "cpu.scheduler_limit_percent": pm("CPU_Scheduler_Limit"),
  };
  const sources = {} as Snapshot["sources"];
  for (const id of ["macmon", "powermetrics", "thermalState", "pmset", "gpuRegistry"] as const) {
    const error = raw.errors[id] ?? raw.warnings[id] ?? null;
    const present = id === "thermalState" ? raw.thermalState.value !== null : id === "macmon" ? !!raw.macmon
      : id === "powermetrics" ? !!raw.powermetrics : id === "pmset" ? raw.pmset !== null : !!r;
    const status = present && !error ? "available" : id === "powermetrics" && !raw.powermetricsEnabled
      ? mode === "off" ? "disabled" : cap.powermetrics.available && !cap.powermetrics.authorized ? "authorization_required" : "error" : "error";
    sources[id] = { status, readStartedAt: timings[id]?.readStartedAt ?? null,
      readEndedAt: timings[id]?.readEndedAt ?? raw.sourceTimestamps[id] ?? null,
      durationMs: timings[id]?.durationMs ?? null,
      error: error?.slice(0, 2048) ?? (present ? null : status === "authorization_required" ? (cap.powermetrics.feed ? `powermetrics feed stale (${Math.round(cap.powermetrics.feed.ageMs / 1000)} s old): is the root daemon running?` : "no powermetrics feed (service/install-root.sh) and no sudo") : status === "disabled" ? null : "Source returned no usable data") };
  }
  const findings: Finding[] = [];
  const metrics: Record<string, Metric> = {};
  for (const [id, def] of Object.entries(CATALOG)) {
    let value = finite(values[id]);
    const invalid = value !== null && ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max));
    if (invalid) {
      findings.push({ code: "invalid_metric", severity: "warning", type: "limitation",
        message: `Out-of-range ${id} was rejected: ${value}`, evidence: [`metrics.${id}`, `sources.${def.source}`] });
      value = null;
    }
    if (sources[def.source].status !== "available") value = null;
    metrics[id] = { value, unit: def.unit, source: def.source, quality: value === null ? "unavailable" : def.quality,
      unavailableReason: value !== null ? null : invalid ? "OUT_OF_RANGE" : sources[def.source].status === "available" ? "NOT_EXPOSED" : sources[def.source].status.toUpperCase() };
  }
  // (powermetrics' when it ran, else the OS's own level — the same OSThermalPressureLevel, read without root)
  const pressure = raw.powermetrics?.pressure ?? raw.osPressure?.label ?? null;
  const pressureSource = raw.powermetrics?.pressure ? "powermetrics" : raw.osPressure ? "os" : null;
  const pressureRank = pressure === null ? -1 : ["nominal", "moderate", "heavy", "trapping", "sleeping"].indexOf(pressure.toLowerCase());
  if (pressureRank > 0 || (raw.thermalState.value ?? 0) > 0) findings.push({ code: "thermal_pressure_elevated",
    severity: pressureRank >= 3 || (raw.thermalState.value ?? 0) >= 2 ? "critical" : "warning", type: "observation",
    message: "The OS reports elevated thermal pressure. This does not expose a hardware throttling flag.",
    evidence: ["thermal.pressure", "thermal.state"] });
  if ((metrics["gpu.active_percent"]?.value ?? 0) >= 95) findings.push({ code: "gpu_continuously_active", severity: "info", type: "observation",
    message: "GPU active residency is at least 95%. This does not identify compute, bandwidth or synchronization bottlenecks.", evidence: ["metrics.gpu.active_percent"] });
  if ((metrics["gpu.active_percent"]?.value ?? 0) >= 95 && (metrics["gpu.frequency_of_max_percent"]?.value ?? 100) < 90)
    findings.push({ code: "busy_gpu_below_reported_maximum", severity: "warning", type: "inference",
      message: "Busy GPU is below 90% of reported maximum frequency. DVFS, power limits and thermal effects are not distinguished by this observation.",
      evidence: ["metrics.gpu.active_percent", "metrics.gpu.frequency_of_max_percent"] });
  if (raw.assessment.cpuLimits.length) findings.push({ code: "cpu_limit_reported", severity: "warning", type: "observation",
    message: "pmset reports a CPU limit below 100%; its cause is unknown.", evidence: ["metrics.cpu.speed_limit_percent", "metrics.cpu.scheduler_limit_percent"] });
  const unavailableMetricIds = Object.keys(metrics).filter(id => metrics[id]!.value === null);
  const availableMetricCount = Object.keys(metrics).length - unavailableMetricIds.length;
  if (unavailableMetricIds.length) findings.push({ code: "incomplete_telemetry", severity: "info", type: "limitation",
    message: "Some metrics are unavailable. Null values do not mean zero, idle, healthy or absent hardware.", evidence: ["coverage.unavailableMetricIds", "sources"] });
  const ends = Object.values(sources).filter(s => s.readEndedAt !== null && s.status === "available").map(s => Date.parse(s.readEndedAt!)).filter(Number.isFinite);
  return SnapshotSchema.parse({
    schemaVersion: VERSION, kind: "snapshot", id: crypto.randomUUID(), timestamp: raw.timestamp,
    host: { chip: soc?.chip_name ?? r?.model ?? null, model: soc?.mac_model ?? null,
      osVersion: cap.osVersion, architecture: cap.architecture, gpuCores: r?.cores ?? soc?.gpu_cores ?? null },
    window: { startedAt: raw.startedAt, endedAt: raw.timestamp,
      elapsedMs: Math.max(0, Date.parse(raw.timestamp) - Date.parse(raw.startedAt)), requestedIntervalMs: raw.sampleIntervalMs,
      sourceReadEndSkewMs: ends.length > 1 ? Math.max(...ends) - Math.min(...ends) : null, synchronized: false },
    sources, metrics, thermal: { state: raw.thermalState.label, pressure, pressureSource, hardwareThrottling: "unknown" },
    gpuFrequencyDistribution: p?.frequencyDistribution ?? [], gpuRequestedState: p?.requestedState ?? null,
    fans: Array.isArray(n?.fans) ? n.fans.map((f: any) => ({ name: typeof f.name === "string" ? f.name : "fan", rpm: finite(f.rpm), maxRpm: finite(f.max_rpm) })) : [],
    findings, coverage: { status: availableMetricCount === 0 ? "unavailable" : unavailableMetricIds.length ? "partial" : "complete",
      availableMetricCount, totalMetricCount: Object.keys(metrics).length, unavailableMetricIds },
    ...(includeRaw ? { raw } : {}),
  });
}

export async function snapshot(options: { intervalMs: number; power: PowerMode; includeRaw?: boolean; signal?: AbortSignal; capabilities?: Capabilities }): Promise<Snapshot> {
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 1000 || options.intervalMs > 10000)
    throw new ToolError("INVALID_INTERVAL", "interval must be an integer between 1000 and 10000 ms.");
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new ToolError("UNSUPPORTED_PLATFORM", "macOS on Apple Silicon is required.", 4);
  if (process.getuid?.() === 0) throw new ToolError("ROOT_PROCESS_REFUSED", "Run Bun as your regular user; only powermetrics needs sudo.", 4);
  const timings: Partial<Record<SourceId, ReadTiming>> = {};
  const runner = createRunner(options.signal);
  const cap = options.capabilities ? structuredClone(options.capabilities) : await capabilities(runner);
  if (options.power !== "off") {
    cap.powermetrics.feed = powerFeed();
    cap.powermetrics.authorized = !!cap.powermetrics.feed?.fresh || (await runner(["/usr/bin/sudo", "-n", "-v"], 5000)).code === 0;
  }
  if (options.power === "required" && (!cap.powermetrics.available || !cap.powermetrics.authorized))
    throw new ToolError(cap.powermetrics.available ? "AUTH_REQUIRED" : "POWERMETRICS_UNAVAILABLE", "Required powermetrics access is unavailable.", 3,
      "In a terminal, run monitor --power required --latest latest.json; the LLM can read it with latest latest.json.", true);
  const power = options.power !== "off" && cap.powermetrics.available && cap.powermetrics.authorized ? powerArguments(cap, options.intervalMs) : null;
  const measuredRunner = createRunner(options.signal, (args, t) => {
    const first = args[0] ?? "";
    if (first.endsWith("notifyutil")) return;
    const id: SourceId = first === "/usr/bin/sudo" || first === "/bin/cat" ? "powermetrics" : first.endsWith("osascript") ? "thermalState"
      : first.endsWith("pmset") ? "pmset" : first.endsWith("ioreg") ? "gpuRegistry" : "macmon";
    timings[id] = t;
  });
  const sample = await collect(cap.macmonPath ?? "/nonexistent/macmon", options.intervalMs, power, measuredRunner);
  options.signal?.throwIfAborted();
  if (options.includeRaw && Buffer.byteLength(JSON.stringify(sample)) > 4 * 1024 * 1024)
    throw new ToolError("RAW_OUTPUT_TOO_LARGE", "Raw snapshot exceeds 4 MiB. Retry without --raw.", 5);
  return normalizeSnapshot(sample, cap, options.power, timings, options.includeRaw);
}
