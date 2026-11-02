// The lab's thermal service (docs/THERMAL.md): each Mac's heat and GPU clock, a snapshot every 5 s, for whoever
// measures — an agent before a bench, the e2e's summaries, the lab's monitor. tools/mac-thermal is the toolkit;
// this installs it on a Mac and reads it.
//
//   bun scripts/thermal.ts [status] [--host kerr-mini | --all] [--json]   the latest snapshot, briefly (this Mac by default)
//   bun scripts/thermal.ts window [--minutes 10] [--json]                  this Mac's last minutes: pressure counts, GPU clock
//   bun scripts/thermal.ts series [--minutes 60] [--points 240] [--to ms]  this Mac's last minutes (before --to) as a chart's series (JSON)
//   bun scripts/thermal.ts doctor [--host kerr-mini | --all]               the agent, the root feed, macmon, the files' age
//   bun scripts/thermal.ts install [--host kerr-mini]                      the user half (LaunchAgent, no sudo) — then once,
//                                                                          by hand, the root half's sudo command it prints
//   bun scripts/thermal.ts uninstall [--host kerr-mini]                    the agent removed (the root half: install-root.sh --uninstall)
//
// The service: the LaunchAgent org.samlepirate.kerr-thermal (`bun mac-thermal.js service`: one macmon streaming,
// notifyd's thermal pressure, NSProcessInfo's thermal state — no root) writes ~/.local/state/kerr-thermal/latest.json
// and history.jsonl (8 MiB × 3, ~2 h); the LaunchDaemon org.samlepirate.kerr-thermal-feed (root: powermetrics alone,
// /var/run/kerr-thermal/powermetrics.txt) adds the GPU's active residency, its clock histogram and its power.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HOSTS, labHost } from "./lib/lab-hosts";
import { brief, thermalLine, thermalNow, thermalSeries, thermalWarning, thermalWindow } from "./lib/thermal";

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(`--${k}`);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const cmd =
  argv.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--host", "--minutes", "--points", "--to"].includes(argv[i - 1]!))) ?? "status";
const JSON_OUT = flag("json");
const ROOT = resolve(import.meta.dir, "..");
const SHARE = ".local/share/kerr-thermal";
const LABEL = "org.samlepirate.kerr-thermal";
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"];

/** the hosts asked: this Mac (null) unless --host h, or every Mac of the lab with --all */
const targets: (string | null)[] = flag("all")
  ? [null, ...HOSTS.filter((h) => h.os === "mac").map((h) => h.name)]
  : [opt("host", "") || null];
for (const t of targets)
  if (t && labHost(t).os !== "mac") {
    console.error(`${t}: macOS only — the toolkit reads Apple Silicon's sensors`);
    process.exit(2);
  }

async function run(host: string | null, script: string, inherit = false) {
  const args = host ? ["ssh", ...SSH, host, script] : ["sh", "-c", script];
  const p = Bun.spawn(args, { stdout: inherit ? "inherit" : "pipe", stderr: inherit ? "inherit" : "pipe", stdin: "ignore" });
  const out = inherit ? "" : await new Response(p.stdout as ReadableStream).text();
  const err = inherit ? "" : await new Response(p.stderr as ReadableStream).text();
  return { code: await p.exited, out, err };
}

async function status(host: string | null) {
  if (!host) return thermalNow(3600);
  const r = await run(host, "cat ~/.local/state/kerr-thermal/latest.json");
  if (r.code !== 0) return null;
  try {
    return brief(JSON.parse(r.out), Date.now(), host);
  } catch {
    return null;
  }
}

const DOCTOR = `
uid=$(id -u); now=$(date +%s)
st=$(launchctl print gui/$uid/${LABEL} 2>/dev/null | awk '/^[[:space:]]+state = /{print $3; exit}')
echo "agent: \${st:-not loaded}"
fd=$(launchctl print system/${LABEL}-feed 2>/dev/null | awk '/^[[:space:]]+state = /{print $3; exit}')
echo "root daemon: \${fd:-not loaded}"
if [ -f /var/run/kerr-thermal/powermetrics.txt ]; then echo "root feed: $((now - $(stat -f %m /var/run/kerr-thermal/powermetrics.txt))) s old"; else echo "root feed: absent"; fi
if [ -f ~/.local/state/kerr-thermal/latest.json ]; then echo "latest.json: $((now - $(stat -f %m ~/.local/state/kerr-thermal/latest.json))) s old"; else echo "latest.json: absent"; fi
m=$(PATH=/opt/homebrew/bin:/usr/local/bin:$PATH command -v macmon); echo "macmon: \${m:-missing}"
[ -s ~/.local/state/kerr-thermal/agent.log ] && { echo "agent.log (end):"; tail -3 ~/.local/state/kerr-thermal/agent.log; }
true`;

async function install(host: string | null, uninstall: boolean) {
  const where = host ?? "this Mac";
  if (uninstall) {
    const r = await run(host, `sh ~/${SHARE}/install-agent.sh --uninstall`, true);
    console.log(`${where}: root half, if installed: ${host ? `ssh -t ${host} ` : ""}sudo sh ~/${SHARE}/install-root.sh --uninstall`);
    return r.code;
  }
  // (the toolkit bundled — zod in it —, beside the two halves' scripts)
  const tmp = mkdtempSync(join(tmpdir(), "kerr-thermal-"));
  try {
    const b = await Bun.build({
      entrypoints: [join(ROOT, "tools/mac-thermal/mac-thermal.ts")],
      outdir: tmp,
      target: "bun",
      naming: "mac-thermal.js",
    });
    if (!b.success) throw new Error(b.logs.map(String).join("\n"));
    const files = ["mac-thermal.js", "install-agent.sh", "install-root.sh", "powermetrics-feed.sh"];
    for (const f of files.slice(1)) copyFileSync(join(ROOT, "tools/mac-thermal/service", f), join(tmp, f));
    if (host) {
      if ((await run(host, `mkdir -p ~/${SHARE}`)).code !== 0) throw new Error(`${host} unreachable`);
      const scp = Bun.spawn(["scp", ...SSH, "-q", ...files.map((f) => join(tmp, f)), `${host}:${SHARE}/`], { stderr: "inherit" });
      if ((await scp.exited) !== 0) throw new Error(`scp to ${host} failed`);
    } else {
      mkdirSync(join(homedir(), SHARE), { recursive: true });
      for (const f of files) copyFileSync(join(tmp, f), join(homedir(), SHARE, f));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${where}: the agent…`);
  const r = await run(host, `sh ~/${SHARE}/install-agent.sh`, true);
  if (r.code === 0)
    console.log(
      `\n${where}: for powermetrics' figures (GPU active residency, clock histogram), once, in a terminal:\n  ${host ? `ssh -t ${host} ` : ""}sudo sh ~/${SHARE}/install-root.sh`,
    );
  return r.code;
}

if (cmd === "install" || cmd === "uninstall") {
  let code = 0;
  for (const t of targets) code ||= await install(t, cmd === "uninstall");
  process.exit(code);
} else if (cmd === "doctor") {
  for (const t of targets) {
    console.log(`━━ ${t ?? "this Mac"}`);
    const r = await run(t, DOCTOR);
    console.log((r.out + r.err).trim() || `unreachable (code ${r.code})`);
  }
} else if (cmd === "window") {
  const minutes = Number(opt("minutes", "10"));
  const w = thermalWindow(Date.now() - minutes * 60_000);
  if (JSON_OUT) console.log(JSON.stringify(w));
  else if (!w) console.log(`no samples in the last ${minutes} min (bun scripts/thermal.ts doctor)`);
  else
    console.log(
      `${w.host} · ${w.n} samples ${w.from} → ${w.to}\n  pressure ${Object.entries(w.pressure)
        .map(([k, n]) => `${k} ${n}`)
        .join(
          ", ",
        )} · GPU ${w.gpuMHz ? `${w.gpuMHz.min}–${w.gpuMHz.max} MHz (median ${w.gpuMHz.median}, ${w.gpuOfMaxPct?.median ?? "?"} % of max)` : "?"} · GPU ≤ ${w.gpuTempMaxC ?? "?"} °C · CPU ≤ ${w.cpuTempMaxC ?? "?"} °C${w.feed ? "" : " · (no root feed)"}`,
    );
} else if (cmd === "series") {
  // (the dashboard's heat charts: asked here, or over ssh of another Mac's runner base)
  const minutes = Math.min(24 * 60, Math.max(1, Number(opt("minutes", "60")) || 60));
  const to = Number(opt("to", "")) || Date.now();
  console.log(JSON.stringify(thermalSeries(minutes, Math.min(2000, Math.max(10, Number(opt("points", "240")) || 240)), to)));
} else if (cmd === "status") {
  const all = await Promise.all(targets.map(status));
  if (JSON_OUT) console.log(JSON.stringify(targets.length > 1 ? all : all[0]));
  else
    targets.forEach((t, i) => {
      const b = all[i] ?? null;
      console.log(`${(t ?? "this Mac").padEnd(10)} ${thermalLine(b)}`);
      const w = thermalWarning(b);
      if (w) console.log(`${"".padEnd(10)} ⚠ ${w}`);
    });
} else {
  console.error(`unknown command ${cmd} — status | window | series | doctor | install | uninstall`);
  process.exit(2);
}
