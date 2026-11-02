// The collector as a long-lived service (a LaunchAgent — ../service/install-agent.sh). Same snapshots, same latest/log
// files as `monitor`, at a fraction of its cost: monitor starts a macmon per sample (~2 s of CPU each, its IOReport set-up),
// this keeps one streaming for good (~20 ms a sample after its start). Per sample, only the light sources: pmset, ioreg,
// notifyd's thermal pressure level, NSProcessInfo.thermalState read in-process (osascript's answer without its 0.15 s);
// powermetrics only from the root daemon's feed (../service/powermetrics-feed.sh) — never sudo, never a password.
import { dlopen, FFIType } from "bun:ffi";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendRotating, acquireLock, writeAtomic } from "./files.ts";
import { assemble, PRESSURE_KEY } from "./legacy.ts";
import { ToolError, type Snapshot, type SourceId } from "./model.ts";
import { capabilities, createRunner, normalizeSnapshot, powerFeed, type ReadTiming } from "./runtime.ts";

let nativeState: (() => number) | null | undefined;
/** NSProcessInfo.thermalState in-process (0 nominal, 1 fair, 2 serious, 3 critical); null where FFI fails. */
export function thermalStateNative(): number | null {
  if (nativeState === undefined) {
    try {
      const objc = dlopen("/usr/lib/libobjc.A.dylib", {
        objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
        sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
        objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i64 },
      });
      // (NSProcessInfo lives in Foundation: loaded, one symbol named because dlopen wants one)
      dlopen("/System/Library/Frameworks/Foundation.framework/Foundation", { NSLog: { args: [FFIType.ptr], returns: FFIType.void } });
      const c = (s: string) => Buffer.from(`${s}\0`);
      const { objc_getClass, sel_registerName, objc_msgSend } = objc.symbols;
      const cls = objc_getClass(c("NSProcessInfo"));
      if (!cls) throw new Error("NSProcessInfo");
      const info = Number(objc_msgSend(cls, sel_registerName(c("processInfo"))));
      const sel = sel_registerName(c("thermalState"));
      nativeState = () => Number(objc_msgSend(info as never, sel));
    } catch { nativeState = null; }
  }
  if (!nativeState) return null;
  const v = nativeState();
  return Number.isInteger(v) && v >= 0 && v <= 3 ? v : null;
}

const stateScript = 'ObjC.import("Foundation"); Number($.NSProcessInfo.processInfo.thermalState);';

export async function service(o: {
  intervalMs: number; maxSeconds: number | null; latestPath: string; logPath: string;
  onSample?: ((s: Snapshot) => void) | null;
}) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new ToolError("UNSUPPORTED_PLATFORM", "macOS on Apple Silicon is required.", 4);
  if (process.getuid?.() === 0) throw new ToolError("ROOT_PROCESS_REFUSED", "Run the service as your regular user; powermetrics comes from the root feed.", 4);
  if (resolve(o.latestPath) === resolve(o.logPath)) throw new ToolError("INVALID_ARGUMENT", "--latest and --log must be different files.");
  const controller = new AbortController();
  const stop = () => controller.abort(new ToolError("CANCELLED", "Service stopped.", 130));
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const deadline = o.maxSeconds ? setTimeout(() => controller.abort(new ToolError("DURATION_LIMIT", "Service time limit reached.", 0)), o.maxSeconds * 1000) : null;
  const releases = [o.latestPath, o.logPath].sort().map(acquireLock);
  const runner = createRunner(controller.signal);
  let completed = 0;
  let macmon: ReturnType<typeof Bun.spawn> | null = null;
  try {
    const cap = await capabilities(runner);
    if (!cap.macmonPath) throw new ToolError("MACMON_UNAVAILABLE", "macmon is not on the PATH (brew install macmon).", 4);
    macmon = Bun.spawn([cap.macmonPath, "pipe", "-i", String(o.intervalMs), "--soc-info"], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, LC_ALL: "C", LANG: "C" } });
    const proc = macmon;
    controller.signal.addEventListener("abort", () => { try { proc.kill("SIGTERM"); } catch {} }, { once: true });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!controller.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 1024 * 1024) buffer = buffer.slice(-64 * 1024);
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        const snapshot = await sample(line, cap, runner, o.intervalMs);
        if (controller.signal.aborted) break;
        writeAtomic(o.latestPath, snapshot);
        appendRotating(o.logPath, snapshot);
        completed++;
        o.onSample?.(snapshot);
      }
    }
    if (!controller.signal.aborted) {
      const err = await new Response(proc.stderr as ReadableStream<Uint8Array>).text().catch(() => "");
      throw new ToolError("SOURCE_UNAVAILABLE", `macmon stopped (code ${await proc.exited}): ${err.trim().slice(0, 500) || "no output"}`, 5,
        "launchd restarts the service; check macmon by hand: macmon pipe -s 1", true);
    }
    const reason = controller.signal.reason as ToolError | undefined;
    console.error(JSON.stringify({ kind: "service_stopped", completedSamples: completed, reason: reason?.code ?? "stopped", latestPath: o.latestPath, logPath: o.logPath }));
    if (reason?.code === "CANCELLED") process.exitCode = 130;
  } finally {
    try { macmon?.kill("SIGTERM"); } catch {}
    releases.reverse().forEach(release => release());
    if (deadline) clearTimeout(deadline);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
  }
}

/** One macmon line (its last interval) and the light sources read now → a snapshot. */
async function sample(line: string, cap: Awaited<ReturnType<typeof capabilities>>, runner: ReturnType<typeof createRunner>, intervalMs: number) {
  const ended = Date.now();
  const startedAt = new Date(ended - intervalMs).toISOString();
  const data: Record<string, string> = { macmon: line };
  const errors: Record<string, string> = {};
  const stamps: Record<string, string> = { macmon: new Date(ended).toISOString() };
  const timings: Partial<Record<SourceId, ReadTiming>> = { macmon: { readStartedAt: startedAt, readEndedAt: stamps.macmon!, durationMs: intervalMs } };
  const read = async (name: string, id: SourceId | null, args: string[]) => {
    const t0 = Date.now();
    const r = await runner(args, 5000);
    const t = { readStartedAt: new Date(t0).toISOString(), readEndedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    if (id) timings[id] = t;
    if (r.code === 0) { data[name] = r.stdout; stamps[name] = t.readEndedAt; }
    else errors[name] = r.stderr.trim() || r.stdout.trim() || `code ${r.code}`;
  };
  const state = thermalStateNative();
  await Promise.all([
    read("pmset", "pmset", ["/usr/bin/pmset", "-g", "therm"]),
    read("gpuRegistry", "gpuRegistry", ["/usr/sbin/ioreg", "-r", "-d", "1", "-l", "-c", "AGXAccelerator"]),
    read("osPressure", null, ["/usr/bin/notifyutil", "-g", PRESSURE_KEY]),
    state === null ? read("thermalState", "thermalState", ["/usr/bin/osascript", "-l", "JavaScript", "-e", stateScript]) : null,
  ]);
  if (state !== null) {
    data.thermalState = String(state);
    stamps.thermalState = new Date().toISOString();
  }
  const feed = powerFeed();
  cap.powermetrics.feed = feed;
  cap.powermetrics.authorized = !!feed?.fresh;
  if (feed?.fresh) {
    try {
      data.powermetrics = readFileSync(feed.path, "utf8").slice(0, 2 * 1024 * 1024);
      stamps.powermetrics = new Date(Date.now() - feed.ageMs).toISOString();
    } catch (e) { errors.powermetrics = e instanceof Error ? e.message : String(e); }
  }
  const raw = assemble(startedAt, intervalMs, data, errors, stamps, !!feed?.fresh);
  return normalizeSnapshot(raw, cap, "auto", timings);
}
