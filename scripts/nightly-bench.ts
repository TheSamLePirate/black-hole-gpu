// The nightly bench (audit 2026-11-10, QA-12 — Sam, 14 Nov 2026: « banc de nuit sur le mini »): no performance regression was caught by
// anything automatic — the tools existed (bench, trace-ab, ab-commit), all run by hand. Each night on kerr-mini, in its own clone of
// main: J0's measured flight (tests/e2e/j0-reference.e2e.test.ts, J0_PHASES=flight — the way in cold, then the flight), the machine
// rested first (its thermal pressure Nominal, waited for); its figures appended to a history; a night whose GPU p50 passes the last
// nights' median by more than 10 % written to the alerts.
//
//   bun scripts/nightly-bench.ts run [--pull]     (on the mini: --pull updates its clone to origin/main first)
//   bun scripts/nightly-bench.ts install          (on the mini: its LaunchAgent, each night at 03:30)
//   bun scripts/nightly-bench.ts fetch [--host kerr-mini]   (here: its history and alerts into docs/perf/nightly-mini.jsonl)
//
// Its history and alerts: ~/.kerr-lab/nightly/ on the machine that runs it (history.jsonl, alerts.md, the runs' j0.json and log).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { thermalLine, thermalNow, thermalWarning } from "./lib/thermal";

export interface NightRow {
  /** when it ran (ISO), the commit measured, whether J0's flight was measured */
  at: string;
  commit: string;
  ok: boolean;
  /** J0's flight: the GPU's time per frame (p50, p95) [ms], the frame time's (p50, p95) [ms], images a second */
  gpuP50?: number;
  gpuP95?: number;
  p50?: number;
  p95?: number;
  imagesPerS?: number;
  /** the thermal state before, as the lab's monitor wrote it; why it did not run */
  thermal?: string;
  note?: string;
}

/** The GPU p50 the night is judged against: the median of the last `n` measured nights before it (null: fewer than 3). */
export function baseline(rows: NightRow[], n = 7): number | null {
  const v = rows
    .filter((r) => r.ok && Number.isFinite(r.gpuP50))
    .slice(-n)
    .map((r) => r.gpuP50!)
    .sort((a, b) => a - b);
  if (v.length < 3) return null;
  return v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
}

/** A night's verdict: its GPU p50 against the baseline — over by more than `limit` (0.10: 10 %): a regression said. */
export function judge(row: NightRow, before: NightRow[], limit = 0.1): { base: number | null; over: number | null; regressed: boolean } {
  const base = baseline(before);
  if (!row.ok || base === null || !Number.isFinite(row.gpuP50)) return { base, over: null, regressed: false };
  const over = row.gpuP50! / base - 1;
  return { base, over, regressed: over > limit };
}

const DIR = join(homedir(), ".kerr-lab", "nightly");
const HISTORY = join(DIR, "history.jsonl");
const ALERTS = join(DIR, "alerts.md");
const ROOT = join(import.meta.dir, "..");
const readRows = (file: string): NightRow[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as NightRow)
    : [];

async function run(pull: boolean) {
  mkdirSync(DIR, { recursive: true });
  if (pull) {
    await $`git -C ${ROOT} fetch -q origin main && git -C ${ROOT} merge -q --ff-only origin/main`.nothrow();
    await $`bun install --frozen-lockfile`.cwd(ROOT).quiet().nothrow();
  }
  const commit = (await $`git -C ${ROOT} rev-parse --short HEAD`.nothrow().quiet().text()).trim() || "unknown";
  const at = new Date().toISOString();
  // (the machine rested: its pressure Nominal — waited for, 20 min at most —, else the night skipped, said)
  let th = thermalNow(120);
  for (let i = 0; i < 40 && thermalWarning(th); i++) {
    await Bun.sleep(30_000);
    th = thermalNow(120);
  }
  const row: NightRow = { at, commit, ok: false, thermal: thermalLine(th) };
  if (thermalWarning(th)) {
    row.note = `skipped: ${thermalWarning(th)}`;
  } else {
    const out = join(DIR, `run-${at.slice(0, 10)}`);
    const log = join(DIR, "log.txt");
    // (J0's flight, its output kept in log.txt — Bun.spawn: Bun's shell takes no « > file 2>&1 »)
    const p = Bun.spawn(["bun", "test", "tests/e2e/j0-reference.e2e.test.ts", "--timeout", "900000"], {
      cwd: ROOT,
      env: { ...process.env, E2E: "1", E2E_HEADED: "0", J0_PHASES: "flight", J0_MACHINE: "nightly", J0_OUT: out },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const r = { exitCode: await p.exited };
    writeFileSync(log, o + e);
    const file = join(out, "j0.json");
    if (existsSync(file)) {
      // (j0.json's flight: its whole flight's statistics — scripts/j0-fiche.ts reads the same)
      const j = JSON.parse(readFileSync(file, "utf8")) as {
        flight?: { stats?: { all?: { gpuP50: number; gpuP95: number; p50: number; p95: number; imagesPerS: number } } };
      };
      const f = j.flight?.stats?.all;
      if (f) Object.assign(row, { ok: true, gpuP50: f.gpuP50, gpuP95: f.gpuP95, p50: f.p50, p95: f.p95, imagesPerS: f.imagesPerS });
    }
    if (!row.ok) row.note = `J0's flight not measured (exit ${r.exitCode}; ${log})`;
  }
  const before = readRows(HISTORY);
  appendFileSync(HISTORY, `${JSON.stringify(row)}\n`);
  const v = judge(row, before);
  const said = row.ok
    ? `${at} ${commit}: GPU p50 ${row.gpuP50!.toFixed(2)} ms` +
      (v.base !== null ? ` (the last nights' ${v.base.toFixed(2)} ms: ${((v.over ?? 0) * 100).toFixed(1)} %)` : " (no baseline yet)")
    : `${at} ${commit}: ${row.note}`;
  console.log(`nightly: ${said}`);
  if (v.regressed) {
    appendFileSync(ALERTS, `- ${said} — over the 10 % limit\n`);
    process.exit(2);
  }
  process.exit(row.ok || row.note?.startsWith("skipped") ? 0 : 1);
}

async function install() {
  const bun = process.execPath;
  const label = "org.samlepirate.kerr-nightly";
  const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${bun}</string><string>scripts/nightly-bench.ts</string><string>run</string><string>--pull</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${join(homedir(), ".bun/bin")}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>${join(DIR, "agent.out")}</string>
  <key>StandardErrorPath</key><string>${join(DIR, "agent.err")}</string>
</dict></plist>
`,
  );
  await $`launchctl unload ${plist}`.nothrow().quiet();
  await $`launchctl load ${plist}`.nothrow();
  console.log(`nightly: ${plist} loaded — each night at 03:30, in ${ROOT}`);
}

async function fetchHistory(host: string) {
  const text =
    await $`ssh -o ConnectTimeout=10 -o BatchMode=yes ${host} ${"cat ~/.kerr-lab/nightly/history.jsonl 2>/dev/null; echo '---'; cat ~/.kerr-lab/nightly/alerts.md 2>/dev/null"}`
      .nothrow()
      .quiet()
      .text();
  const [hist = "", alerts = ""] = text.split("---\n");
  const theirs = hist
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as NightRow);
  const file = join(ROOT, "docs", "perf", `nightly-${host.replace(/^kerr-/, "")}.jsonl`);
  const ours = readRows(file);
  const seen = new Set(ours.map((r) => r.at));
  const fresh = theirs.filter((r) => !seen.has(r.at));
  if (fresh.length) appendFileSync(file, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`nightly: ${fresh.length} new nights from ${host} into ${file} (${ours.length + fresh.length} in all)`);
  for (const r of [...ours, ...fresh].slice(-7))
    console.log(`  ${r.at.slice(0, 16)} ${r.commit} ${r.ok ? `GPU p50 ${r.gpuP50?.toFixed(2)} ms, p95 ${r.gpuP95?.toFixed(2)}` : r.note}`);
  if (alerts.trim()) console.log(`  alerts:\n${alerts.trim()}`);
}

if (import.meta.main) {
  const [cmd = "run"] = process.argv.slice(2);
  const hostAt = process.argv.indexOf("--host");
  if (cmd === "run") await run(process.argv.includes("--pull"));
  else if (cmd === "install") await install();
  else if (cmd === "fetch") await fetchHistory(hostAt > 0 ? process.argv[hostAt + 1]! : "kerr-mini");
  else {
    console.error("nightly-bench: run [--pull] | install | fetch [--host kerr-mini]");
    process.exit(1);
  }
}
