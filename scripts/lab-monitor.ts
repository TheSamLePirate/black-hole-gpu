// What runs on each Mac of the lab, at a glance — this one and the other (kerr-mini, over ssh):
//   - its Chrome (scripts/lib/chrome-lock.ts: one at a time): who holds it, since when, who waits;
//   - the Chrome processes really alive (a leftover shows here);
//   - the flight lab's campaigns (scripts/flightlab.ts registers each in ~/.kerr-lab/runs/): the scenario
//     flying, its progress, the latest sample — asked of their control servers;
//   - the remote runner's jobs (scripts/remote-runner.ts: running, queued);
//   - the test runs (bun test).
//
//   bun scripts/lab-monitor.ts                 both Macs, once
//   bun scripts/lab-monitor.ts --watch [s]     refreshed every s seconds (5)
//   bun scripts/lab-monitor.ts --local         this Mac only
//   bun scripts/lab-monitor.ts --json          the state as JSON (what the other Mac answers over ssh)
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { holder, LAB_DIR, waiters } from "./lib/chrome-lock";

const HOST = process.env.KERR_REMOTE ?? "kerr-mini";
const RUNNER_DIR = join(homedir(), process.env.KERR_REMOTE_DIR ?? "kerr-runner");
const argv = process.argv.slice(2);

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
  chromes: { pid: number; elapsed: string; headless: boolean }[];
  campaigns: Campaign[];
  jobs: { id: string; state: string; cmd: string; started?: number }[];
  tests: { pid: number; elapsed: string; cmd: string }[];
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const ps = (pattern: string) =>
  Bun.spawnSync(["ps", "-axo", "pid=,etime=,command="], { stdout: "pipe" })
    .stdout.toString()
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m && new RegExp(pattern).test(m[3]!));

async function local(): Promise<State> {
  const chromes = ps("--remote-debugging-port=")
    .filter((m) => !/--type=/.test(m[3]!))
    .map((m) => ({ pid: Number(m[1]), elapsed: m[2]!, headless: m[3]!.includes("--headless") }));
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
  const tests = ps("bun (test|run e2e)").map((m) => ({ pid: Number(m[1]), elapsed: m[2]!, cmd: m[3]!.slice(0, 120) }));
  return { host: hostname().replace(/\.local$/, ""), at: Date.now(), lock: holder(), waiting: waiters(), chromes, campaigns, jobs, tests };
}

async function remote(): Promise<State | string> {
  const p = Bun.spawn(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      HOST,
      `cd ${RUNNER_DIR}/base 2>/dev/null && ~/.bun/bin/bun scripts/lab-monitor.ts --json`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  if ((await p.exited) !== 0)
    return /not found|Cannot find|ENOENT/.test(err)
      ? `${HOST}: the monitor is not there yet — bun scripts/remote.ts sync`
      : `${HOST}: unreachable — ${err.trim().split("\n").pop()} (bun scripts/remote.ts doctor)`;
  try {
    return JSON.parse(out) as State;
  } catch {
    return `${HOST}: ${out.slice(0, 200)}`;
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
const where = (cwd: string) => {
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
    `  Chrome processes: ${n}${n ? ` — ${s.chromes.map((c) => `pid ${c.pid} ${c.headless ? "headless" : "on screen"} ${c.elapsed}`).join(", ")}` : ""}${n > 1 ? "  ⚠ more than one" : ""}`,
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
  for (const t of s.tests) console.log(`  test pid ${t.pid} ${t.elapsed}: ${t.cmd}`);
  console.log("");
}

if (argv.includes("--json")) console.log(JSON.stringify(await local()));
else {
  const watch = argv.includes("--watch");
  const every = Number(argv[argv.indexOf("--watch") + 1]) || 5;
  for (;;) {
    const [here, there] = await Promise.all([local(), argv.includes("--local") ? Promise.resolve(null) : remote()]);
    if (watch) process.stdout.write("\x1b[2J\x1b[H");
    console.log(`lab — ${new Date().toLocaleTimeString()}\n`);
    show(here, "this Mac");
    if (there) show(there, "the other Mac");
    if (!watch) break;
    await Bun.sleep(every * 1000);
  }
}
