#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { capabilities, snapshot, authenticate, type PowerMode } from "./runtime.ts";
import { VERSION, CATALOG, ToolError, errorEnvelope, outputSchemas, selectMetrics, metricIds, type Snapshot } from "./model.ts";
import { summarize, readHistory, compare, makeSession } from "./analysis.ts";
import { writeAtomic, appendRotating, latest, acquireLock } from "./files.ts";
import { service } from "./service.ts";

export const COMMANDS = ["snapshot", "record", "monitor", "service", "latest", "analyze", "compare", "doctor", "catalog", "schema", "help", "version"];
export const GUIDE = [
  "Use doctor to discover capabilities. Use snapshot --power auto for one bounded collection.",
  "For full privileged telemetry, a human runs monitor --power required --latest latest.json --log history.jsonl in a terminal. The LLM reads latest latest.json.",
  "Or the service (service/install-agent.sh, a LaunchAgent: one macmon streaming) writes latest/log for good; powermetrics then comes from the root daemon's feed (service/install-root.sh, installed once with sudo).",
  "thermal.pressure is powermetrics' level when it ran, else the OS's own (notifyd, no root): thermal.pressureSource says which.",
  "All new commands emit JSON, no ANSI dashboard. stdout contains data; stderr contains interactive authentication/progress only.",
  "Null is unavailable, never zero. Check sources, coverage and findings before reasoning.",
  "Do not equate active residency with ALU utilization, frequency-scaled activity, throughput or memory bandwidth.",
  "Do not infer thermal throttling from temperature or frequency alone. hardwareThrottling remains unknown.",
  "record is bounded and returns a statistical summary; --out saves the full session. No stress workload or system setting is changed.",
  "Compare only matching workloads and reported hardware/OS; even then the tool does not establish causality.",
  "Source windows and driver refresh windows differ. sourceReadEndSkewMs is not a synchronization guarantee.",
];
const help = {
  schemaVersion: VERSION, kind: "help", commands: {
    snapshot: "snapshot [--power auto|required|off] [--interval 1000] [--raw] [--metrics gpu.*] [--out snapshot.json]",
    record: "record [--samples 10] [--interval 2000] [--duration 600] [--label workload] [--out session.json] [--include-samples]",
    monitor: "monitor [--power required] [--latest latest.json] [--log history.jsonl] [--duration 3600] [--quiet]",
    service: "service [--interval 5000] [--latest latest.json] [--log history.jsonl] [--duration s] [--quiet]  (no sudo: powermetrics from the root feed if any)",
    latest: "latest latest.json [--max-age 15] [--metrics gpu.*]",
    analyze: "analyze session.json|history.jsonl [--metrics gpu.*]",
    compare: "compare baseline.json candidate.json [--same-workload]",
    doctor: "doctor", catalog: "catalog", schema: "schema", help: "help", version: "version",
  }, options: { pretty: "Pretty-print JSON", raw: "Explicitly include source output, larger token cost",
    authenticate: "Prompt through sudo in an interactive terminal before snapshot/record/monitor",
    "require-complete": "Return exit 5 unless every catalog metric is available; --power required only requires the powermetrics source",
  }, exitCodes: { "0": "Success, possibly partial coverage", "1": "Internal error", "2": "Invalid arguments/file/schema",
    "3": "Authentication or required privileged source unavailable", "4": "Unsupported platform/dependency", "5": "Required coverage/source unavailable", "6": "Stale snapshot or clock skew", "130": "Interrupted" },
  rules: GUIDE,
};

function integer(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ToolError("INVALID_ARGUMENT", `${name} must be an integer between ${min} and ${max}.`);
  return n;
}

export async function main(argv = Bun.argv.slice(2)) {
  let pretty = false;
  try {
    const command = argv[0] ?? "help";
    if (!COMMANDS.includes(command)) throw new ToolError("UNKNOWN_COMMAND", `Unknown command: ${command}`, 2, "Run help to discover commands.");
    let parsed;
    try { parsed = parseArgs({ args: argv.slice(1), strict: true, allowPositionals: true, tokens: true, options: {
      interval: { type: "string" }, samples: { type: "string" }, duration: { type: "string" }, power: { type: "string" },
      out: { type: "string" }, latest: { type: "string" }, log: { type: "string" }, label: { type: "string" },
      metrics: { type: "string" }, "max-age": { type: "string" },
      pretty: { type: "boolean" }, raw: { type: "boolean" }, quiet: { type: "boolean" }, authenticate: { type: "boolean" },
      "require-complete": { type: "boolean" }, "include-samples": { type: "boolean" }, "same-workload": { type: "boolean" }, help: { type: "boolean" },
    } }); } catch (error) { throw new ToolError("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error)); }
    const { values, positionals } = parsed;
    pretty = !!values.pretty;
    const emit = (data: unknown) => console.log(JSON.stringify(data, null, pretty ? 2 : undefined));
    if (values.help || command === "help") { emit(help); return; }
    const allowed: Record<string, string[]> = {
      snapshot: ["power", "interval", "duration", "raw", "metrics", "out", "authenticate", "require-complete"],
      record: ["power", "interval", "duration", "samples", "raw", "metrics", "out", "label", "authenticate", "require-complete", "include-samples"],
      monitor: ["power", "interval", "duration", "samples", "raw", "metrics", "latest", "log", "quiet", "authenticate"],
      service: ["interval", "duration", "metrics", "latest", "log", "quiet"],
      latest: ["max-age", "metrics", "raw"], analyze: ["metrics", "out"], compare: ["metrics", "out", "same-workload"],
      doctor: [], catalog: [], schema: [], version: [],
    };
    for (const token of parsed.tokens) {
      if (token.kind === "option" && !["pretty", "help", ...(allowed[command] ?? [])].includes(token.name))
        throw new ToolError("INVALID_ARGUMENT", `--${token.name} is not supported by ${command}.`);
    }
    const arity = command === "compare" ? 2 : ["latest", "analyze"].includes(command) ? 1 : 0;
    if (positionals.length !== arity) throw new ToolError("INVALID_ARGUMENT", `${command} expects ${arity} file path(s).`);
    if (command === "version") { emit({ schemaVersion: VERSION, kind: "version", version: VERSION }); return; }
    if (command === "catalog") { emit({ schemaVersion: VERSION, kind: "catalog", metrics: CATALOG, rules: GUIDE }); return; }
    if (command === "schema") { emit(outputSchemas()); return; }
    const selectors = values.metrics?.split(",").map(s => s.trim()).filter(Boolean);
    const selected = selectors?.length ? metricIds(selectors) : null;
    if (command === "doctor") { emit(await capabilities()); return; }
    if (command === "latest") {
      if (positionals.length !== 1) throw new ToolError("INVALID_ARGUMENT", "latest requires one file path.");
      const value = latest(positionals[0]!, integer(values["max-age"], 15, 1, 86400, "max-age"));
      if (!values.raw) delete value.raw;
      emit({ ...selectMetrics(value, selectors), freshness: value.freshness }); return;
    }
    if (command === "analyze" || command === "compare") {
      if (positionals.length !== (command === "compare" ? 2 : 1)) throw new ToolError("INVALID_ARGUMENT", `${command} requires ${command === "compare" ? "two" : "one"} file paths.`);
      const result = command === "compare" ? compare(readHistory(positionals[0]!), readHistory(positionals[1]!), !!values["same-workload"])
        : { schemaVersion: VERSION, kind: "analysis", report: summarize(readHistory(positionals[0]!)) };
      if (selected) {
        const report = "report" in result ? result.report : result;
        report.metrics = Object.fromEntries(Object.entries(report.metrics).filter(([id]) => selected.has(id))) as any;
        Object.assign(result, { selection: [...selected] });
      }
      if (values.out) writeAtomic(values.out, result);
      emit(result); return;
    }
    if (positionals.length) throw new ToolError("INVALID_ARGUMENT", `${command} does not accept positional arguments.`);
    if (command === "service") {
      await service({ intervalMs: integer(values.interval, 5000, 1000, 60000, "interval"),
        maxSeconds: values.duration === undefined ? null : integer(values.duration, 1, 1, 31_536_000, "duration"),
        latestPath: values.latest ?? "thermal-latest.json", logPath: values.log ?? "thermal-history.jsonl",
        onSample: values.quiet ? null : (s) => emit(selectMetrics(s, selectors)) });
      return;
    }
    const power = (values.power ?? (command === "monitor" ? "required" : "auto")) as PowerMode;
    if (!["auto", "required", "off"].includes(power)) throw new ToolError("INVALID_ARGUMENT", "power must be auto, required or off.");
    if (power === "off" && values.authenticate) throw new ToolError("INVALID_ARGUMENT", "--authenticate cannot be combined with --power off.");
    const intervalMs = integer(values.interval, command === "snapshot" ? 1000 : 2000, 1000, 10000, "interval");
    const maxSeconds = integer(values.duration, command === "monitor" ? 3600 : 600, 1, command === "monitor" ? 86400 : 600, "duration");
    const count = values.samples === undefined ? command === "record" ? 10 : command === "snapshot" ? 1 : Infinity
      : integer(values.samples, 1, 1, command === "monitor" ? 100000 : 120, "samples");
    if (values.label && values.label.length > 200) throw new ToolError("INVALID_ARGUMENT", "label must not exceed 200 characters.");
    if (command === "record" && values.raw && count > 10) throw new ToolError("INVALID_ARGUMENT", "Raw recordings are limited to 10 samples.");
    if (command === "record" && count * intervalMs > maxSeconds * 1000)
      throw new ToolError("INVALID_ARGUMENT", "Requested sampling windows exceed --duration. Reduce --samples or --interval.");
    let cap = await capabilities();
    if (values.authenticate || (command === "monitor" && power !== "off" && !cap.powermetrics.authorized && process.stdin.isTTY)) {
      await authenticate(); cap = await capabilities();
    }
    if (power === "required" && (!cap.powermetrics.available || !cap.powermetrics.authorized))
      throw new ToolError("AUTH_REQUIRED", "Required powermetrics authorization is unavailable.", 3,
        "Use --authenticate in a terminal, or run monitor --power required and read its latest file.", true);
    const controller = new AbortController();
    const stop = () => controller.abort(new ToolError("CANCELLED", "Collection interrupted.", 130));
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    const deadline = setTimeout(() => controller.abort(new ToolError("DURATION_LIMIT", "Recording time limit reached.", 5)), maxSeconds * 1000);
    const samples: Snapshot[] = [];
    let completed = 0;
    const latestPath = values.latest ?? "thermal-latest.json";
    const logPath = values.log ?? "thermal-history.jsonl";
    const releases: (() => void)[] = [];
    let terminationReason = "sample_limit";
    try {
      if (command === "monitor") {
        if (resolve(latestPath) === resolve(logPath)) throw new ToolError("INVALID_ARGUMENT", "--latest and --log must be different files.");
        for (const path of [latestPath, logPath].sort()) releases.push(acquireLock(path));
      }
      while (completed < count && !controller.signal.aborted) {
        const started = Date.now();
        let value: Snapshot;
        try { value = await snapshot({ intervalMs, power, includeRaw: !!values.raw, signal: controller.signal, capabilities: cap }); }
        catch (error) {
          if (controller.signal.aborted) break;
          throw error;
        }
        completed++;
        if (value.coverage.status === "unavailable" || (power === "required" && value.sources.powermetrics.status !== "available"))
          {
            const error = new ToolError("SOURCE_UNAVAILABLE", "Required telemetry failed during collection.", 5,
              "Use snapshot --power auto to inspect individual source errors.", true);
            error.details = { partialSnapshot: selectMetrics(value, selectors) };
            throw error;
          }
        if (command === "monitor") {
          writeAtomic(latestPath, value); appendRotating(logPath, value);
          if (!values.quiet) emit(selectMetrics(value, selectors));
        } else if (command === "record") samples.push(value);
        else {
          if (values.out) writeAtomic(values.out, value);
          emit(selectMetrics(value, selectors));
          if (values["require-complete"] && value.coverage.status !== "complete") process.exitCode = 5;
          return;
        }
        if (completed < count) {
          const wait = Math.max(0, intervalMs - (Date.now() - started));
          if (wait) await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, wait);
            controller.signal.addEventListener("abort", done, { once: true });
          });
        }
      }
      if (controller.signal.aborted) terminationReason = controller.signal.reason?.code === "DURATION_LIMIT" ? "duration_limit" : "interrupted";
      if (command === "record") {
        if (!samples.length) throw new ToolError("NO_SAMPLES", "Recording ended before the first complete snapshot.", terminationReason === "interrupted" ? 130 : 5);
        const session = makeSession(samples, values.label ?? null);
        const full = { ...session, recording: { requestedSamples: count, maxSeconds, terminationReason } };
        if (values.out) writeAtomic(values.out, full);
        const output: any = { ...full };
        if (!values["include-samples"]) delete output.samples;
        else output.samples = samples.map(s => selectMetrics(s, selectors));
        if (selected) {
          output.report.metrics = Object.fromEntries(Object.entries(output.report.metrics).filter(([id]) => selected.has(id)));
          output.selection = [...selected];
        }
        emit(output);
        if (values["require-complete"] && samples.some(s => s.coverage.status !== "complete")) process.exitCode = 5;
      } else if (command === "monitor") {
        console.error(JSON.stringify({ kind: "monitor_stopped", completedSamples: completed, terminationReason, latestPath, logPath }));
      } else if (controller.signal.aborted) throw controller.signal.reason;
      if (terminationReason === "interrupted") process.exitCode = 130;
    } finally {
      releases.reverse().forEach(release => release());
      clearTimeout(deadline); process.off("SIGINT", stop); process.off("SIGTERM", stop);
    }
  } catch (error) {
    const envelope = errorEnvelope(error);
    console.log(JSON.stringify(envelope.data, null, pretty ? 2 : undefined));
    process.exitCode = envelope.exitCode;
  }
}

if (import.meta.main) await main();
