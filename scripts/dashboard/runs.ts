// The dashboard's runs: started from it (here or on kerr-mini, through scripts/e2e.ts), streamed live, kept
// on disk in remote-results/dash/<id>/ (run.json, log) — and the history beside them: the remote runner's
// jobs (remote-results/<job>/), the --each summaries, the flight lab's campaigns (flight-results/).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type LogEvent, LogParser, type LogSummary, parseLog } from "./parse-log";

export const RESULTS = "remote-results";
export const DASH = join(RESULTS, "dash");
export const FLIGHTS = "flight-results";

export interface RunRequest {
  /** e2e names, paths or parts of names (scripts/e2e.ts); empty: all */
  files: string[];
  where: "here" | "mini";
  /** one bun test per file, a summary at the end */
  each?: boolean;
  /** the mini without its full-screen window */
  headless?: boolean;
  /** Chrome kept open s seconds at each close (mini) */
  hold?: number;
  /** bun test -t: tests whose name matches */
  testName?: string;
  /** extra environment, e.g. { UPDATE: "1" } (only the known safe names) */
  env?: Record<string, string>;
}

export interface Run {
  id: string;
  source: "dash" | "remote" | "summary" | "flightlab";
  title: string;
  where: string;
  cmd: string;
  state: "running" | "done" | "cancelled" | "queued";
  started: number;
  ended?: number;
  exit?: number | null;
  remoteJob?: string;
  counts: { pass: number; fail: number; skip: number; files: number };
  /** whether a log is there to read */
  hasLog: boolean;
  /** a flight lab campaign's report page */
  report?: string;
  request?: RunRequest;
}

const ENV_ALLOWED = new Set(["UPDATE", "RATCHET", "SHOT", "HUD_BOXES", "TARS_LIVE", "TARS_LONG", "TARS_MODEL", "E2E_CDP_TIMEOUT"]);

type Emit = (msg: Record<string, unknown>) => void;

interface Live {
  run: Run;
  proc: ReturnType<typeof Bun.spawn>;
  parser: LogParser;
  lines: string[];
}

const live = new Map<string, Live>();

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const countsOf = (s: LogSummary) => ({ pass: s.pass, fail: s.fail, skip: s.skip, files: s.files.length });

function save(run: Run) {
  writeFileSync(join(DASH, run.id, "run.json"), JSON.stringify(run, null, 1));
}

/** Starts a run; its lines and parsed events go to `emit` as they come. */
export function startRun(req: RunRequest, emit: Emit): Run {
  const id = `${stamp()}-${req.where}${req.files.length === 1 ? `-${req.files[0]!.replace(/[^a-z0-9-]+/gi, "-").slice(0, 30)}` : ""}`;
  const dir = join(DASH, id);
  mkdirSync(dir, { recursive: true });
  const args = ["bun", "scripts/e2e.ts"];
  if (req.where === "mini") {
    args.push("--remote", "--name", `dash-${id.slice(9, 15)}`);
    if (req.headless) args.push("--headless");
    if (req.hold) args.push("--hold", String(req.hold));
  }
  if (req.each) args.push("--each");
  args.push(...req.files);
  if (req.testName) args.push("-t", req.testName);
  const extra = Object.fromEntries(Object.entries(req.env ?? {}).filter(([k]) => ENV_ALLOWED.has(k)));
  // (the mini gets the variables in its command: remote.ts runs `E2E=1 <cmd>` there)
  const prefix = Object.entries(extra).map(([k, v]) => `${k}=${v}`);
  const run: Run = {
    id,
    source: "dash",
    title: req.files.length ? req.files.join(" ") : "all e2e",
    where: req.where === "mini" ? "kerr-mini" : "here",
    cmd: [...prefix, ...args].join(" "),
    state: "running",
    started: Date.now(),
    counts: { pass: 0, fail: 0, skip: 0, files: 0 },
    hasLog: true,
    request: req,
  };
  return launch(run, args, { ...extra, E2E_SUMMARY: join(dir, "summary.json") }, emit);
}

/** Follows a job of the mini's started elsewhere (remote.ts logs -f): streamed and kept like a run of its own. */
export function attachRun(job: string, emit: Emit): Run {
  if (!/^[\w.-]+$/.test(job)) throw new Error(`not a job id: ${job}`);
  const already = [...live.values()].find((l) => l.run.remoteJob === job);
  if (already) return already.run;
  const id = `${stamp()}-mini-follow-${job.slice(16, 40)}`;
  mkdirSync(join(DASH, id), { recursive: true });
  const args = ["bun", "scripts/remote.ts", "logs", job, "-f"];
  const run: Run = {
    id,
    source: "dash",
    title: `following ${job}`,
    where: "kerr-mini",
    cmd: args.join(" "),
    state: "running",
    started: Date.now(),
    remoteJob: job,
    counts: { pass: 0, fail: 0, skip: 0, files: 0 },
    hasLog: true,
  };
  return launch(run, args, {}, emit);
}

function launch(run: Run, args: string[], env: Record<string, string>, emit: Emit): Run {
  const id = run.id;
  const dir = join(DASH, id);
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
    env: { ...process.env, ...env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  const l: Live = { run, proc, parser: new LogParser(), lines: [] };
  live.set(id, l);
  save(run);
  emit({ t: "run", run });
  const logPath = join(dir, "log");
  writeFileSync(logPath, `$ ${run.cmd}\n`);
  const onLine = (line: string) => {
    l.lines.push(line);
    Bun.write(logPath, `${l.lines.join("\n")}\n`).catch(() => {});
    const m = line.match(/^remote: (\S+) started on/);
    if (m) {
      run.remoteJob = m[1];
      save(run);
    }
    const evs: LogEvent[] = l.parser.push(line);
    emit({ t: "line", id, line });
    for (const ev of evs) emit({ t: "ev", id, ev });
    if (evs.length) {
      run.counts = countsOf(l.parser.summary());
      emit({ t: "run", run });
    }
  };
  const pump = async (s: ReadableStream<Uint8Array>) => {
    let rest = "";
    const dec = new TextDecoder();
    for await (const chunk of s) {
      rest += dec.decode(chunk, { stream: true });
      const parts = rest.split(/\r?\n/);
      rest = parts.pop() ?? "";
      for (const p of parts) onLine(p);
    }
    if (rest) onLine(rest);
  };
  void Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>)]).then(async () => {
    const code = await proc.exited;
    if (run.state === "running") run.state = "done";
    run.exit = code;
    run.ended = Date.now();
    run.counts = countsOf(l.parser.summary());
    writeFileSync(logPath, `${l.lines.join("\n")}\n`);
    save(run);
    live.delete(id);
    emit({ t: "run", run });
    emit({ t: "history" });
  });
  return run;
}

/** Stops a run and what it started (its process group; on the mini, its job). */
export async function cancelRun(id: string) {
  const l = live.get(id);
  if (!l) return false;
  l.run.state = "cancelled";
  try {
    process.kill(-l.proc.pid, "SIGTERM");
  } catch {
    l.proc.kill();
  }
  if (l.run.remoteJob) await Bun.$`bun scripts/remote.ts cancel ${l.run.remoteJob}`.nothrow().quiet();
  return true;
}

/** The lines so far of a live run (a page opened mid-run catches up). */
export const liveLines = (id: string) => live.get(id)?.lines ?? null;
export const liveRuns = () => [...live.values()].map((l) => l.run);

// ------------------------------------------------------------------------------------------- history

const cache = new Map<string, { mtime: number; summary: LogSummary }>();
function summaryOf(logPath: string): LogSummary {
  const mtime = statSync(logPath).mtimeMs;
  const c = cache.get(logPath);
  if (c && c.mtime === mtime) return c.summary;
  const summary = parseLog(readFileSync(logPath, "utf8"));
  cache.set(logPath, { mtime, summary });
  return summary;
}

const readJson = <T>(f: string): T | null => {
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Every run on disk, newest first. */
export function history(): Run[] {
  const out: Run[] = [];
  const seenJobs = new Set<string>();
  const liveIds = new Set(live.keys());
  if (existsSync(DASH))
    for (const id of readdirSync(DASH)) {
      const r = readJson<Run>(join(DASH, id, "run.json"));
      if (!r) continue;
      if (r.remoteJob) seenJobs.add(r.remoteJob);
      // (a run the server was stopped during: no process left to end it)
      if (r.state === "running" && !liveIds.has(id)) r.state = "done";
      out.push(liveIds.has(id) ? live.get(id)!.run : r);
    }
  if (existsSync(RESULTS))
    for (const id of readdirSync(RESULTS)) {
      const meta = join(RESULTS, id, "meta.json");
      if (id === "dash" || seenJobs.has(id) || !existsSync(meta)) continue;
      const m = readJson<{
        cmd: string;
        state: string;
        created: number;
        started?: number;
        ended?: number;
        exit?: number | null;
        headed?: boolean;
      }>(meta);
      if (!m) continue;
      const log = join(RESULTS, id, "log");
      const s = existsSync(log) ? summaryOf(log) : null;
      out.push({
        id,
        source: "remote",
        title: m.cmd.replace(/^E2E=1 /, "").slice(0, 120),
        where: "kerr-mini",
        cmd: m.cmd,
        state: m.state === "done" ? "done" : m.state === "queued" ? "queued" : "running",
        started: m.started ?? m.created,
        ended: m.ended,
        exit: m.exit,
        counts: s ? countsOf(s) : { pass: 0, fail: 0, skip: 0, files: 0 },
        hasLog: !!s,
      });
    }
  // (the --each summaries written outside a dashboard run)
  if (existsSync(RESULTS))
    for (const f of readdirSync(RESULTS).filter((f) => /^e2e-summary-.*\.json$/.test(f))) {
      const s = readJson<{
        host: string;
        commit: string;
        dirty: boolean;
        at: string;
        seconds: number;
        rows: { file: string; code: number; pass: number; fail: number; skip: number }[];
      }>(join(RESULTS, f));
      if (!s) continue;
      const t = Date.parse(s.at);
      out.push({
        id: f.replace(/\.json$/, ""),
        source: "summary",
        title: `${s.rows.length} files (--each)`,
        where: s.host,
        cmd: `bun run e2e --each (${s.commit}${s.dirty ? "+dirty" : ""})`,
        state: "done",
        started: t - s.seconds * 1000,
        ended: t,
        exit: s.rows.some((r) => r.code) ? 1 : 0,
        counts: {
          pass: s.rows.reduce((a, r) => a + r.pass, 0),
          fail: s.rows.reduce((a, r) => a + r.fail, 0),
          skip: s.rows.reduce((a, r) => a + r.skip, 0),
          files: s.rows.length,
        },
        hasLog: false,
      });
    }
  if (existsSync(FLIGHTS))
    for (const id of readdirSync(FLIGHTS)) {
      const dir = join(FLIGHTS, id);
      if (!statSync(dir).isDirectory()) continue;
      const st = statSync(dir);
      out.push({
        id: `flight:${id}`,
        source: "flightlab",
        title: `flight lab ${id.replace(/^\d{8}-\d{6}-/, "")}`,
        where: id.includes("mini") ? "kerr-mini" : "here",
        cmd: "bun scripts/flightlab.ts run",
        state: "done",
        started: st.birthtimeMs,
        ended: st.mtimeMs,
        counts: { pass: 0, fail: 0, skip: 0, files: 0 },
        hasLog: false,
        report: existsSync(join(dir, "report.html")) ? `/files/${FLIGHTS}/${id}/report.html` : undefined,
      });
    }
  return out.sort((a, b) => b.started - a.started);
}

/** One run in full: its record, its parsed log, its log text, its pictures. */
export function runDetail(id: string) {
  const run = history().find((r) => r.id === id);
  if (!run) return null;
  let logPath: string | null = null;
  let summaryJson: unknown = null;
  if (run.source === "dash") {
    logPath = join(DASH, id, "log");
    summaryJson = readJson(join(DASH, id, "summary.json"));
  } else if (run.source === "remote") logPath = join(RESULTS, id, "log");
  else if (run.source === "summary") summaryJson = readJson(join(RESULTS, `${id}.json`));
  const lines = liveLines(id);
  const text = lines ? lines.join("\n") : logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  return {
    run,
    log: text.length > 2_000_000 ? text.slice(-2_000_000) : text,
    parsed: text ? parseLog(text) : null,
    summary: summaryJson,
    shots: shots().filter(
      (s) => s.run === id || (run.remoteJob && s.run === run.remoteJob) || (run.id === `flight:${s.run}` && s.root === FLIGHTS),
    ),
  };
}

// ------------------------------------------------------------------------------------------- pictures

export interface Shot {
  url: string;
  root: string;
  run: string;
  name: string;
  path: string;
  mtime: number;
  size: number;
}

let shotCache: { at: number; list: Shot[] } | null = null;
/** Every picture the runs left (PNG, JPEG, WebP), newest first — cached a few seconds. */
export function shots(): Shot[] {
  if (shotCache && Date.now() - shotCache.at < 4000) return shotCache.list;
  const list: Shot[] = [];
  const walk = (root: string, rel: string, depth: number) => {
    const dir = join(root, rel);
    if (depth > 8 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(root, r, depth + 1);
      else if (/\.(png|jpe?g|webp)$/i.test(e.name)) {
        const st = statSync(join(root, r));
        list.push({
          url: `/files/${root}/${r.split("/").map(encodeURIComponent).join("/")}`,
          root,
          run: r.includes("/") ? r.split("/")[0]! : "(loose)",
          name: e.name,
          path: `${root}/${r}`,
          mtime: st.mtimeMs,
          size: st.size,
        });
      }
    }
  };
  walk(RESULTS, "", 0);
  walk(FLIGHTS, "", 0);
  list.sort((a, b) => b.mtime - a.mtime);
  shotCache = { at: Date.now(), list };
  return list;
}

// ------------------------------------------------------------------------------------------- files

/** Each e2e file's record across the history: its last result, its pass rate, its usual duration. */
export function fileStats() {
  const stats = new Map<
    string,
    {
      runs: number;
      passed: number;
      last?: { status: "pass" | "fail"; at: number; where: string; run: string };
      seconds: number[];
      recent: ("pass" | "fail")[];
    }
  >();
  for (const r of history()) {
    if (r.source === "flightlab") continue;
    let files: { file: string; fail: number; ms?: number; seconds?: number }[] = [];
    if (r.source === "summary") {
      const s = readJson<{ rows: { file: string; fail: number; code: number; seconds: number }[] }>(join(RESULTS, `${r.id}.json`));
      files = (s?.rows ?? []).map((x) => ({ file: x.file, fail: x.fail || (x.code ? 1 : 0), seconds: x.seconds }));
    } else {
      const logPath = r.source === "dash" ? join(DASH, r.id, "log") : join(RESULTS, r.id, "log");
      if (!existsSync(logPath) || live.has(r.id)) continue;
      const each = r.source === "dash" ? readJson<{ rows: { file: string; seconds: number }[] }>(join(DASH, r.id, "summary.json")) : null;
      files = summaryOf(logPath).files.map((f) => ({
        file: f.file.replace(/^.*\//, ""),
        fail: f.fail,
        ms: f.ms,
        seconds: each?.rows.find((x) => x.file === f.file.replace(/^.*\//, ""))?.seconds,
      }));
    }
    for (const f of files) {
      const s = stats.get(f.file) ?? { runs: 0, passed: 0, seconds: [], recent: [] };
      // (newest first: the last six results — a file flaky lately, not once long ago)
      if (s.recent.length < 6) s.recent.push(f.fail ? "fail" : "pass");
      s.runs++;
      if (!f.fail) s.passed++;
      // (history is newest first: the first seen is the last result)
      s.last ??= { status: f.fail ? "fail" : "pass", at: r.started, where: r.where, run: r.id };
      if (f.seconds) s.seconds.push(f.seconds);
      else if (f.ms) s.seconds.push(Math.round(f.ms / 1000));
      stats.set(f.file, s);
    }
  }
  return stats;
}
