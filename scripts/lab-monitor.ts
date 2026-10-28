// What runs on each machine of the lab, at a glance — this Mac and the others over ssh (scripts/lib/lab-hosts.ts:
// kerr-mini, the Mac mini; kerr-pc, the Windows PC):
//   - its Chrome (scripts/lib/chrome-lock.ts: one at a time): who holds it, since when, who waits;
//   - the Chrome processes really alive (a leftover shows here);
//   - the flight lab's campaigns (scripts/flightlab.ts registers each in ~/.kerr-lab/runs/): the scenario
//     flying, its progress, the latest sample — asked of their control servers;
//   - the remote runner's jobs (scripts/remote-runner.ts: running, queued);
//   - the test runs (bun test).
//
//   bun scripts/lab-monitor.ts                 every machine, once
//   bun scripts/lab-monitor.ts --host kerr-pc  this Mac and that one only
//   bun scripts/lab-monitor.ts --watch [s]     refreshed every s seconds (5)
//   bun scripts/lab-monitor.ts --local         this Mac only
//   bun scripts/lab-monitor.ts --json          the state as JSON (what the other machines answer over ssh)
//   bun scripts/lab-monitor.ts --sweep         and the orphan Chromes ended (a dead process's, still rendering)
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import { holder, LAB_DIR, orphanChromes, waiters } from "./lib/chrome-lock";
import { HOSTS, type LabHost, labHost, remoteCommand, takeHost } from "./lib/lab-hosts";
import { alive, orphaned, processes, WINDOWS } from "./lib/procs";

const argv = process.argv.slice(2);
const only = takeHost(argv);
// (run from a runner's base — over ssh, --json —: that runner's folder; else this machine's default one)
const HERE = resolve(import.meta.dir, "..");
const RUNNER_DIR = basename(HERE) === "base" ? resolve(HERE, "..") : join(homedir(), process.env.KERR_REMOTE_DIR ?? "kerr-runner");

interface Campaign {
  pid: number;
  port: number;
  out: string;
  cwd: string;
  since: number;
  status?: {
    scenario: { id: string; wallS: number } | null;
    done: string[];
    left: number;
    control: string;
    T: Record<string, unknown> | null;
  } | null;
}
interface State {
  host: string;
  at: number;
  lock: ReturnType<typeof holder>;
  waiting: ReturnType<typeof waiters>;
  chromes: { pid: number; elapsed: string; headless: boolean; cwd: string }[];
  campaigns: Campaign[];
  jobs: { id: string; state: string; cmd: string; started?: number }[];
  tests: { pid: number; elapsed: string; cmd: string; cwd: string }[];
  /** what dead processes left running: Chromes, the tests' servers */
  orphans: { pid: number; elapsed: string; what: string }[];
}

/** A process's working directory (whose worktree it runs in) — none on Windows: no lsof there. */
const cwdOf = (pid: number) =>
  WINDOWS
    ? ""
    : (Bun.spawnSync(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], { stdout: "pipe" })
        .stdout.toString()
        .split("\n")
        .find((l) => l.startsWith("n"))
        ?.slice(1) ?? "");

async function local(): Promise<State> {
  // (every process once a round: on Windows a PowerShell call, a second each)
  const all = processes();
  const ps = (pattern: string) => all.filter((p) => new RegExp(pattern).test(p.command));
  const chromes = ps("--remote-debugging-port=")
    .filter((p) => !/--type=/.test(p.command) && /chrome/i.test(p.command))
    .map((p) => ({ pid: p.pid, elapsed: p.elapsed, headless: p.command.includes("--headless"), cwd: cwdOf(p.pid) }));
  const runs = join(LAB_DIR, "runs");
  const campaigns: Campaign[] = [];
  for (const f of existsSync(runs) ? readdirSync(runs) : []) {
    try {
      const c = JSON.parse(readFileSync(join(runs, f), "utf8")) as Campaign;
      if (!alive(c.pid)) {
        rmSync(join(runs, f), { force: true });
        continue;
      }
      c.status = await fetch(`http://127.0.0.1:${c.port}/status`, { signal: AbortSignal.timeout(3000) })
        .then((r) => r.json() as Promise<Campaign["status"]>)
        .catch(() => null);
      campaigns.push(c);
    } catch {
      /* (a file being written) */
    }
  }
  const jobs: State["jobs"] = [];
  const rd = join(RUNNER_DIR, "runs");
  for (const id of existsSync(rd) ? readdirSync(rd) : []) {
    try {
      const m = JSON.parse(readFileSync(join(rd, id, ".job", "meta.json"), "utf8"));
      if (m.state === "running" || m.state === "queued")
        jobs.push({ id, state: m.state, cmd: String(m.cmd ?? m.job?.cmd ?? ""), started: m.started });
    } catch {
      /* (not a job) */
    }
  }
  // (Windows: bun.exe's full path, maybe quoted)
  const tests = ps('^"?(\\S*[/\\\\])?bun(\\.exe)?"? (test|run e2e)').map((p) => ({
    pid: p.pid,
    elapsed: p.elapsed,
    cmd: p.command.slice(0, 120),
    cwd: cwdOf(p.pid),
  }));
  const sweep = argv.includes("--sweep");
  const orphans = [
    ...orphanChromes(sweep).map((o) => ({ pid: o.pid, elapsed: o.elapsed, what: `Chrome ${o.profile}${sweep ? " — ended" : ""}` })),
    // (a test's production server outlives its process no longer — server.ts watches KERR_PARENT_PID —: an
    // older one still may)
    ...ps('bun(\\.exe)?"? server\\.ts')
      .filter(orphaned)
      .map((p) => ({ pid: p.pid, elapsed: p.elapsed, what: `bun server.ts in ${where(cwdOf(p.pid))}` })),
  ];
  return {
    host: hostname().replace(/\.local$/, ""),
    at: Date.now(),
    lock: holder(),
    waiting: waiters(),
    chromes,
    campaigns,
    jobs,
    tests,
    orphans,
  };
}

/** Another machine's state, its own monitor asked over ssh (an answer within 20 s, else said unreachable). */
async function remoteState(h: LabHost): Promise<State | string> {
  const opt = h.name === "kerr-mini" ? "" : `--host ${h.name} `;
  const p = Bun.spawn(
    [
      "ssh",
      ...["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=3"],
      h.name,
      remoteCommand(h, `cd ${h.dir}/base 2>/dev/null && ${h.bun} scripts/lab-monitor.ts --json`),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => p.kill(), 20_000);
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  clearTimeout(timer);
  if ((await p.exited) !== 0)
    return /not found|Cannot find|ENOENT/.test(err) || !err.trim()
      ? `${h.name}: the monitor is not there yet — bun scripts/remote.ts ${opt}sync`
      : `${h.name}: unreachable — ${err.trim().split("\n").pop()} (bun scripts/remote.ts ${opt}doctor)`;
  try {
    return JSON.parse(out) as State;
  } catch {
    return `${h.name}: ${out.slice(0, 200)}`;
  }
}

const age = (since: number) => {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return s >= 3600
    ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`
    : s >= 60
      ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
      : `${s}s`;
};
const where = (cwd = "") => {
  if (!cwd) return "";
  const w = cwd.match(/worktrees\/(agent-[0-9a-f]{6})/)?.[1];
  return w ? `worktree ${w}` : cwd.includes("kerr-runner") ? "remote job" : cwd.replace(homedir(), "~");
};

function show(s: State | string, title: string) {
  const bar = (t: string) => `━━ ${t} ${"━".repeat(Math.max(4, 72 - t.length))}`;
  if (typeof s === "string") {
    console.log(bar(title));
    console.log(`  ${s}\n`);
    return;
  }
  console.log(bar(`${s.host} (${title})`));
  const L = s.lock;
  console.log(L ? `  Chrome: held by pid ${L.pid} · ${L.label} · ${where(L.cwd)} · ${age(L.since)}` : "  Chrome: free");
  for (const w of s.waiting) console.log(`    waiting: pid ${w.pid} · ${w.label} · ${where(w.cwd)} · ${age(w.since)}`);
  const n = s.chromes.length;
  console.log(
    `  Chrome processes: ${n}${n ? ` — ${s.chromes.map((c) => `pid ${c.pid} ${c.headless ? "headless" : "on screen"} ${c.elapsed}${c.cwd ? ` (${where(c.cwd)})` : ""}`).join(", ")}` : ""}${n > 1 ? "  ⚠ more than one" : ""}`,
  );
  if (s.campaigns.length) console.log("  Flight lab:");
  for (const c of s.campaigns) {
    const st = c.status;
    const done = st?.done ?? [];
    const pass = done.filter((d) => d.startsWith("PASS")).length;
    const T = st?.T as Record<string, unknown> | null | undefined;
    const hub = T?.hub as { title?: string; phase?: string } | null | undefined;
    console.log(
      `    pid ${c.pid} :${c.port} ${c.out} · ${where(c.cwd)} · ${age(c.since)} · ${done.length} done (${pass} ✓, ${done.length - pass} ✗) · ${st?.left ?? "?"} left${st?.control && st.control !== "run" ? ` · ${st.control.toUpperCase()}` : ""}`,
    );
    if (st?.scenario)
      console.log(
        `      ▶ ${st.scenario.id} ${st.scenario.wallS}s · ${T?.label ?? ""} alt ${T?.alt ?? "-"} km · v ${T?.v ?? "-"} m/s · auto ${T?.auto ?? "-"}${hub?.title ? ` · ${hub.title}/${hub.phase ?? ""}` : ""} · warp ${T?.warp ?? "-"}`,
      );
    for (const d of done.filter((x) => !x.startsWith("PASS")).slice(-3)) console.log(`      ✗ ${d.slice(0, 150)}`);
  }
  for (const j of s.jobs) console.log(`  job ${j.state}: ${j.id} · ${j.cmd.slice(0, 90)}${j.started ? ` · ${age(j.started)}` : ""}`);
  for (const o of s.orphans ?? []) console.log(`  ⚠ orphan pid ${o.pid} ${o.elapsed}: ${o.what}`);
  for (const t of s.tests) console.log(`  test pid ${t.pid} ${t.elapsed}${t.cwd ? ` · ${where(t.cwd)}` : ""}: ${t.cmd}`);
  console.log("");
}

if (argv.includes("--json")) console.log(JSON.stringify(await local()));
else {
  const watch = argv.includes("--watch");
  const every = Number(argv[argv.indexOf("--watch") + 1]) || 5;
  for (;;) {
    const others = argv.includes("--local") ? [] : HOSTS.filter((h) => !only || h.name === only).map((h) => labHost(h.name));
    const [here, ...there] = await Promise.all([local(), ...others.map(remoteState)]);
    if (watch) process.stdout.write("\x1b[2J\x1b[H");
    console.log(`lab — ${new Date().toLocaleTimeString()}\n`);
    show(here!, "this Mac");
    there.forEach((s, i) => show(s, others[i]!.label));
    if (!watch) break;
    await Bun.sleep(every * 1000);
  }
}
