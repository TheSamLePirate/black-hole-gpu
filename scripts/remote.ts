// Tests and measures run on another Mac on the network (docs/REMOTE-TESTS.md): this tree as it is —
// uncommitted changes and untracked files with it, what .gitignore leaves out left out — copied there,
// the command run in that copy, its log streamed here and what it wrote brought back.
//
//   bun scripts/remote.ts [--host kerr-pc] run [--headless] [--cpu] [--hold <s>] [--name <n>] [--detach] -- <command…>
//   bun scripts/remote.ts [--host kerr-pc] status | logs <id> [-f] | fetch <id> | cancel <id> | clean [--keep 10] | sync | doctor
//
//   --host     which machine of the lab (scripts/lib/lab-hosts.ts): kerr-mini (the default, KERR_REMOTE) or
//              kerr-pc, the Windows PC (RTX 5070 Ti) — the same commands, its tree sent another way (below)
//
//   doctor     the other Mac's health before a campaign: reached (by name, else its last address), internet,
//              a screen session, Chrome, bun's version, disk, sleep, the GPU queue
//
//   (default)  Chrome full screen on that Mac's display (E2E_HEADED=1, tests/e2e/lib/cdp.ts): who sits at it
//              sees it is in use, and can watch; one job at a time there, the others queued (the GPU lock)
//   --headless no window (bench.ts, trace-ab.ts and the other scripts are headless whatever this says)
//   --cpu      no browser in it (bun test, typecheck): runs beside the GPU jobs, without the lock
//   --hold <s> each e2e Chrome left open <s> seconds at its close (E2E_HOLD), to see where it ended
//   --detach   back at once with the job's id (logs <id> -f, fetch <id> later)
//
// e.g. bun scripts/remote.ts run -- E2E=1 bun test tests/e2e/landing.e2e.test.ts --timeout 600000
//      bun scripts/remote.ts run --cpu -- bun test && bun run typecheck
// (not `bun run e2e <file>`: the script's own tests/e2e filter adds to the file's — every e2e runs)
//
// The command runs by zsh in the copy (VAR=1 cmd, &&: as typed). It ends with the job's exit code; its
// log, meta.json and artifacts/ (every file it wrote, at its path in the tree) land in remote-results/<id>/.
// The machine: ssh's alias, --host or KERR_REMOTE (kerr-mini), the folder there KERR_REMOTE_DIR (kerr-runner, in
// its home) — the hosts' folders in scripts/lib/lab-hosts.ts.
// To Windows (kerr-pc) no rsync: its base is a git worktree of its clone, put at the pushed commit this tree
// comes from (HEAD if pushed, else its merge-base with origin/main) with what differs from it here — changed,
// added, untracked files: a tar over ssh — laid over it, the deleted ones deleted; results come back by tar.
// Its own clone of the repository (KERR_REMOTE_CLONE, Documents/DEV/black-hole-gpu in its home; empty: none)
// is pulled at each sync — fast-forward only, never in the way of the run: the jobs run on the copy sent
// from here, not on it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LAB_DIR, labConfig } from "./lib/chrome-lock";
import { labHost, remoteCommand, takeHost } from "./lib/lab-hosts";
import { shellJoin } from "./lib/shell";

const argv = process.argv.slice(2);
const H = labHost(takeHost(argv));
const HOST = H.name;
const WIN = H.os === "windows";
const DIR = H.dir;
const RESULTS = "remote-results";
const CLONE = H.clone;
// (Windows: the runner from its own folder, bin/, sent at each sync before the tree — the tree's overlay is its work)
const RUNNER = `${H.bun} ${DIR}/${WIN ? "bin" : "base"}/scripts/remote-runner.ts`;

// (ssh never waits for ever: a Mac asleep or off the network fails in seconds, a link gone quiet in a minute —
// a run once hung 20 minutes on a name that no longer resolved)
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"];
// (its address as last seen — remote-results/.host-ip, written by `doctor` and every reachable run: used when
// its .local name no longer resolves, the Bonjour name being the first thing to go)
const IP_FILE = HOST === "kerr-mini" ? `${RESULTS}/.host-ip` : `${RESULTS}/.host-ip-${HOST}`;
const VIA: string[] = [];
const ssh = (...a: string[]) => ["ssh", ...SSH, ...VIA, ...a];
/** A shell script run there (Git Bash on Windows: scripts/lib/lab-hosts.ts, remoteCommand). */
const sh = (script: string) => ssh(HOST, remoteCommand(H, script));
const rsyncE = () => ["-e", ["ssh", ...SSH, ...VIA].join(" ")];

/** The machine reached: by its name, else at its last known address; its address then remembered. */
async function reach(): Promise<boolean> {
  const tryIt = async (via: string[]) => {
    // (Windows: its Tailscale address is its name already — nothing to remember)
    const probe = WIN ? "echo reached" : "ipconfig getifaddr en0 || ipconfig getifaddr en1";
    const p = Bun.spawn(["ssh", ...SSH, ...via, HOST, remoteCommand(H, probe)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = (await new Response(p.stdout).text()).trim();
    const err = (await new Response(p.stderr).text()).trim();
    return { ok: (await p.exited) === 0, ip: out.split("\n").pop() ?? "", err };
  };
  let r = await tryIt([]);
  if (!r.ok && existsSync(IP_FILE)) {
    const ip = readFileSync(IP_FILE, "utf8").trim();
    console.error(`remote: ${HOST} unreachable by name (${r.err.split("\n").pop()}) — trying its last address ${ip}`);
    r = await tryIt(["-o", `HostName=${ip}`]);
    if (r.ok) VIA.push("-o", `HostName=${ip}`);
  }
  if (r.ok && /^\d+\.\d+\.\d+\.\d+$/.test(r.ip)) {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(IP_FILE, r.ip);
  }
  if (!r.ok)
    console.error(`remote: ${HOST} unreachable — ${r.err.split("\n").pop()} (asleep, off the network? \`bun scripts/remote.ts doctor\`)`);
  return r.ok;
}

const die = (msg: string): never => {
  console.error(`remote: ${msg}`);
  process.exit(2);
};

/** The runner over ssh: its output here, its exit code back. */
async function runner(args: string[], o: { stdin?: Uint8Array; quiet?: boolean } = {}) {
  const p = Bun.spawn(sh(`${RUNNER} ${args.map((a) => `'${a}'`).join(" ")}`), {
    stdin: o.stdin ?? "ignore",
    stdout: o.quiet ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const out = o.quiet ? await new Response(p.stdout).text() : "";
  return { code: await p.exited, out: out.trim() };
}

/**
 * One sync at a time from this Mac — from any of its checkouts and worktrees: the other Mac has one base,
 * and two syncs of different trees pruned each other's files while their jobs' copies were made (agents'
 * worktrees did, jobs then died at once) — the lock in ~/.kerr-lab, not in this checkout.
 */
async function withSyncLock<T>(f: () => Promise<T>) {
  mkdirSync(RESULTS, { recursive: true });
  // (one per host: the Mac mini's and the PC's syncs do not wait on each other)
  const lock = join(LAB_DIR, HOST === "kerr-mini" ? "sync.lock" : `sync-${HOST}.lock`);
  mkdirSync(LAB_DIR, { recursive: true });
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      writeFileSync(`${lock}/pid`, String(process.pid));
      break;
    } catch {
      try {
        process.kill(Number(readFileSync(`${lock}/pid`, "utf8")), 0);
      } catch {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (i === 0) console.error("remote: another sync is running, waiting…");
      await Bun.sleep(500);
    }
  }
  try {
    return await f();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** The remote Mac's clone brought up to GitHub's main — said when it cannot (local changes, no network). */
async function pullClone() {
  if (!CLONE) return;
  const p = Bun.spawn(
    // (Homebrew's git-lfs on the PATH: the clone's LFS assets — a non-login ssh shell has not got it)
    sh(
      `export PATH=/opt/homebrew/bin:$PATH; cd '${CLONE}' && git fetch -q origin 2>&1 && git merge --ff-only -q '@{u}' 2>&1 && git log -1 --format='%h %s' | cut -c1-80`,
    ),
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = (await new Response(p.stdout).text()).trim();
  const err = (await new Response(p.stderr).text()).trim();
  if ((await p.exited) === 0) console.error(`remote: ${HOST}:~/${CLONE} pulled — at ${out.split("\n").pop()}`);
  else console.error(`remote: WARNING — ${HOST}:~/${CLONE} not pulled: ${(out || err).split("\n").slice(-2).join(" ")}`);
}

/** Windows: this tree's runner (and what it imports) put in <dir>/bin, where RUNNER runs it from. */
async function installRunner() {
  const tar = Bun.spawn(["tar", "-czf", "-", "--no-xattrs", "--no-mac-metadata", "scripts/remote-runner.ts", "scripts/lib/procs.ts"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const x = Bun.spawn(sh(`mkdir -p '${DIR}/bin' && tar -xzf - -C '${DIR}/bin'`), { stdin: tar.stdout, stderr: "inherit" });
  if ((await tar.exited) !== 0 || (await x.exited) !== 0) die(`the runner not installed on ${HOST}`);
}

/**
 * Windows: the pushed commit this tree comes from, and what differs from it here (changed, added, untracked;
 * ignored files out) sent as a tar — the runner's `overlay` lays it on its worktree (scripts/remote-runner.ts).
 */
async function syncWindows(id?: string) {
  // (first: the overlay fetches in the same clone)
  await pullClone();
  const t0 = performance.now();
  const git = async (...a: string[]) => (await Bun.$`git ${a}`.quiet().nothrow().text()).trim();
  const head = await git("rev-parse", "HEAD");
  const pushed = !!(await git("branch", "-r", "--contains", head));
  const base = pushed ? head : await git("merge-base", "HEAD", "origin/main");
  if (!base) die("no pushed commit under HEAD (git fetch origin?)");
  const z = (out: string) => out.split("\0").filter(Boolean);
  const changed = z(await git("diff", "--name-only", "-z", "--no-renames", base));
  const deleted = z(await git("diff", "--name-only", "-z", "--no-renames", "--diff-filter=D", base));
  const files = [...new Set([...changed, ...z(await git("ls-files", "-o", "--exclude-standard", "-z"))])].filter((f) => existsSync(f));
  const meta = join(tmpdir(), `kerr-overlay-${process.pid}`);
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(meta, ".kerr-overlay.json"), JSON.stringify({ base, deleted }));
  await installRunner();
  // (the deletions' file by its full path, renamed to the archive's top by -s; then the files; gzip: the PC is over
  // the internet; no macOS extended attributes: GNU tar there would warn of each)
  const overlayFile = join(meta, ".kerr-overlay.json");
  const tar = Bun.spawn(
    ["tar", "-czf", "-", "--no-xattrs", "--no-mac-metadata", "-s", ",^.*/\\.kerr-overlay\\.json$,.kerr-overlay.json,", "--null", "-T", "-"],
    {
      stdin: new TextEncoder().encode([overlayFile, ...files].join("\0")),
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const up = Bun.spawn(sh(`${RUNNER} overlay '${CLONE}' '${base}'`), { stdin: tar.stdout, stdout: "inherit", stderr: "inherit" });
  const [tc, uc] = await Promise.all([tar.exited, up.exited]);
  rmSync(meta, { recursive: true, force: true });
  if (tc !== 0 || uc !== 0) die(`sync to ${HOST} failed (tar ${tc}, overlay ${uc})`);
  console.error(
    `remote: ${HOST} at ${base.slice(0, 8)}${pushed ? "" : " (HEAD not pushed: its merge-base)"} + ${files.length} files, ${deleted.length} deleted (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
  );
  if (id && (await runner(["prepare", id])).code !== 0) die("prepare failed");
}

/** The tree as git sees it, ignored files out — the remote base made equal to it; then a run's copy. */
async function sync(id?: string) {
  if (WIN) return syncWindows(id);
  const pulled = pullClone();
  const files = (await Bun.$`git ls-files -co --exclude-standard -z`.text()).split("\0").filter((f) => f && existsSync(f));
  const list = new TextEncoder().encode(files.join("\0"));
  const t0 = performance.now();
  await Bun.$`${sh(`mkdir -p ${DIR}/base`)}`;
  // (the network drops now and then — Wi-Fi —: a transfer cut short is resumed, the files already there kept)
  let stats = "";
  for (let attempt = 1; ; attempt++) {
    const rs = Bun.spawn(["rsync", ...rsyncE(), "-a", "--from0", "--files-from=-", "--stats", ".", `${HOST}:${DIR}/base/`], {
      stdin: list,
      stdout: "pipe",
      stderr: "inherit",
    });
    stats = await new Response(rs.stdout).text();
    if ((await rs.exited) === 0) break;
    if (attempt === 3) die(`rsync failed 3 times — is ${HOST} reachable? (ssh ${HOST} true)`);
    console.error(`remote: rsync cut short, again (${attempt + 1}/3)…`);
    await Bun.sleep(3000);
  }
  const sent = stats.match(/Total transferred file size: ([\d,.]+\s*\w*)/)?.[1] ?? "?";
  console.error(`remote: synced ${files.length} files to ${HOST} (${sent} sent, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  await pulled;
  if (id && (await runner(["prepare", id], { stdin: list })).code !== 0) die("prepare failed");
}

async function fetch(id: string) {
  mkdirSync(`${RESULTS}/${id}`, { recursive: true });
  if (WIN) {
    // (no rsync there: the job's folder as a tar)
    const tar = Bun.spawn(sh(`tar -czf - -C '${DIR}/runs/${id}/.job' .`), { stdout: "pipe", stderr: "inherit" });
    const x = Bun.spawn(["tar", "-xzf", "-", "-C", `${RESULTS}/${id}`], { stdin: tar.stdout, stderr: "inherit" });
    if ((await tar.exited) !== 0 || (await x.exited) !== 0) die(`fetch ${id} failed`);
  } else {
    const r = Bun.spawnSync(["rsync", ...rsyncE(), "-a", `${HOST}:${DIR}/runs/${id}/.job/`, `${RESULTS}/${id}/`], { stderr: "inherit" });
    if (r.exitCode !== 0) die(`fetch ${id} failed`);
  }
  const art = `${RESULTS}/${id}/artifacts`;
  const n = existsSync(art) ? (await Bun.$`find ${art} -type f`.text()).split("\n").filter(Boolean) : [];
  console.error(
    `remote: ${RESULTS}/${id}/ (log, meta.json${
      n.length
        ? `, ${n.length} artifacts: ${n
            .slice(0, 5)
            .map((f) => f.slice(art.length + 1))
            .join(", ")}${n.length > 5 ? "…" : ""}`
        : ""
    })`,
  );
}

async function follow(id: string) {
  const { code } = await runner(["follow", id]);
  await fetch(id);
  console.error(`remote: ${id} ended, exit ${code}`);
  return code;
}

/** The other Mac's health, before a campaign: reached, its network, its screen, its tools, its queue. */
async function doctor() {
  const t0 = performance.now();
  if (!(await reach())) process.exit(1);
  const ms = Math.round(performance.now() - t0);
  if (WIN) {
    await installRunner();
    return doctorWindows(ms);
  }
  const probe = [
    "echo os=$(sw_vers -productVersion)",
    "echo bun=$(~/.bun/bin/bun --version 2>/dev/null || echo none)",
    "echo user=$(whoami)",
    // (a graphical session: the full-screen Chrome needs one — nobody logged in at its screen, it cannot open)
    "echo console=$(stat -f %Su /dev/console)",
    // (the internet: Chrome hangs at its start without it, headless too — seen on 2026-10-04)
    "echo internet=$(curl -s -o /dev/null -m 6 -w %{http_code} https://www.google.com || echo 000)",
    `echo chrome=$(test -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" && echo yes || echo no)`,
    "echo disk=$(df -h ~ | tail -1 | awk '{print $4}')",
    "echo sleep=$(pmset -g | awk '/^ sleep/{print $2}')",
    "echo display_sleep=$(pmset -g | awk '/displaysleep/{print $2}')",
    "echo load=$(sysctl -n vm.loadavg | tr -d '{}')",
    // (how its Chromes show — the lab's choice: full screen there, headless here; docs/E2E.md)
    `echo chrome_mode=$(sed -n 's/.*"chrome": *"\\([a-z]*\\)".*/\\1/p' ~/.kerr-lab/config.json 2>/dev/null)`,
    // (a test Chrome alive there: one at a time per Mac — scripts/lib/chrome-lock.ts)
    `echo chromes=$(pgrep -f -- '--remote-debugging-port=[0-9]' | wc -l | tr -d ' ')`,
    `echo gpu_lock=$(test -e ${DIR}/gpu.lock && cat ${DIR}/gpu.lock 2>/dev/null | head -c 80 || echo free)`,
  ].join("; ");
  const kv = await probeKv(probe);
  const local = Bun.version;
  const checks: [string, boolean, string][] = [
    ["reached", true, `${ms} ms${VIA.length ? ` (by its last address, ${VIA[1]?.slice(9)} — its .local name does not resolve)` : ""}`],
    [
      "internet",
      kv.internet === "200" || kv.internet === "301" || kv.internet === "302",
      `HTTP ${kv.internet} (Chrome hangs at start without it)`,
    ],
    ["screen session", !!kv.console && kv.console !== "root", `console user: ${kv.console} (the full-screen Chrome needs one)`],
    ["Chrome", kv.chrome === "yes", kv.chrome ?? "?"],
    ["bun", kv.bun === local, `${kv.bun} there, ${local} here`],
    ["disk", true, `${kv.disk} free`],
    [
      "Chrome mode",
      kv.chrome_mode === "kiosk",
      `${kv.chrome_mode || "unset (headless)"} there, ${labConfig().chrome ?? "headless"} here (~/.kerr-lab/config.json; the lab wants kiosk there)`,
    ],
    ["test Chromes", Number(kv.chromes) <= 1, `${kv.chromes} running there (one at a time per Mac)`],
    ["sleep", kv.sleep === "0", `system sleep ${kv.sleep} min (0: never — a sleeping Mac drops the run)`],
    ["load", true, kv.load ?? "?"],
    ["GPU queue", true, kv.gpu_lock ?? "?"],
  ];
  console.log(`${HOST} — macOS ${kv.os}, ${kv.user}`);
  for (const [k, ok, d] of checks) console.log(`  ${ok ? "✓" : "✗"} ${k.padEnd(15)} ${d}`);
  const bad = checks.filter((c) => !c[1]).length;
  if (!bad) await runner(["status"]);
  process.exit(bad ? 1 : 0);
}

/** A probe's `key=value` lines, as an object. */
async function probeKv(script: string): Promise<Record<string, string>> {
  const p = Bun.spawn(sh(script), { stdout: "pipe", stderr: "inherit" });
  const kv = Object.fromEntries(
    (await new Response(p.stdout).text())
      .trim()
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  await p.exited;
  return kv;
}

// (PowerShell carried as -EncodedCommand: no quote of it for bash or cmd to read)
const ps1 = (script: string) =>
  `powershell -NoProfile -EncodedCommand ${Buffer.from(`$ProgressPreference="SilentlyContinue"; ${script}`, "utf16le").toString("base64")} 2>/dev/null`;

/** The PC's health: reached, its network, its desktop session, Chrome, bun, its GPU, its power plan, its queue. */
async function doctorWindows(ms: number) {
  // (powercfg: a setting's AC index is the second last hex of its query; Windows' names are localised, the GUIDs
  // are not — sleep: SUB_SLEEP/STANDBYIDLE, the screen: SUB_VIDEO/VIDEOIDLE)
  const power = (group: string, setting: string) =>
    `$(powercfg //query SCHEME_CURRENT ${group} ${setting} | grep -o '0x[0-9a-f]\\{8\\}' | tail -2 | head -1)`;
  const testChromes =
    "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'remote-debugging-port=' -and $_.CommandLine -notmatch '--type=' }).Count";
  const probe = [
    "echo os=$(cmd //c ver | tr -d '\\r' | grep -o '[0-9][0-9.]*' | head -1)",
    "echo bun=$(bun --version 2>/dev/null || echo none)",
    "echo user=$(whoami)",
    // (the full-screen Chrome needs the user's open desktop session: the job's scheduled task runs in it)
    "echo console=$(query user 2>/dev/null | grep -i console | awk '{print $1}' | tr -d '>')",
    "echo internet=$(curl -s -o /dev/null -m 6 -w %{http_code} https://www.google.com || echo 000)",
    `echo chrome=$(test -f "/c/Program Files/Google/Chrome/Application/chrome.exe" && echo yes || echo no)`,
    "echo disk=$(df -h ~ | tail -1 | awk '{print $4}')",
    "echo gpu=$(nvidia-smi --query-gpu=name,driver_version,memory.used --format=csv,noheader 2>/dev/null | head -1)",
    `echo sleep=${power("238c9fa8-0aad-41ed-83f4-97be242c8f20", "29f6c1db-86da-48c5-9fdb-f2b67b1f44da")}`,
    `echo display_sleep=${power("7516b95f-f776-4464-8c53-06167f40cc99", "3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e")}`,
    `echo chrome_mode=$(sed -n 's/.*"chrome": *"\\([a-z]*\\)".*/\\1/p' ~/.kerr-lab/config.json 2>/dev/null)`,
    `echo chromes=$(${ps1(testChromes)} | tr -d '\\r')`,
    `echo gpu_lock=$(test -e ${DIR}/gpu.lock && cat ${DIR}/gpu.lock/owner 2>/dev/null | head -c 80 || echo free)`,
    `echo clone=$(cd '${CLONE}' 2>/dev/null && echo "$(git log -1 --format=%h) autocrlf=$(git config core.autocrlf)")`,
  ].join("; ");
  const kv = await probeKv(probe);
  const local = Bun.version;
  const secs = (h?: string) => (h ? Number.parseInt(h, 16) : Number.NaN);
  const minutes = (h?: string) => (secs(h) === 0 ? "never" : Number.isNaN(secs(h)) ? "?" : `${Math.round(secs(h) / 60)} min`);
  const me = (kv.user ?? "").split("\\").pop()!.toLowerCase();
  const checks: [string, boolean, string][] = [
    ["reached", true, `${ms} ms`],
    ["internet", ["200", "301", "302"].includes(kv.internet ?? ""), `HTTP ${kv.internet} (Chrome hangs at start without it)`],
    [
      "desktop session",
      !!kv.console && kv.console.toLowerCase() === me,
      `console user: ${kv.console || "nobody"} (the full-screen Chrome needs ${me}'s open session)`,
    ],
    ["Chrome", kv.chrome === "yes", kv.chrome ?? "?"],
    ["bun", kv.bun === local, `${kv.bun} there, ${local} here`],
    ["GPU", !!kv.gpu, kv.gpu || "nvidia-smi said nothing"],
    ["disk", true, `${kv.disk} free`],
    [
      "Chrome mode",
      kv.chrome_mode === "kiosk",
      `${kv.chrome_mode || "unset (headless)"} there (~/.kerr-lab/config.json; the lab wants kiosk there)`,
    ],
    ["test Chromes", Number(kv.chromes) <= 1, `${kv.chromes} running there (one at a time per machine)`],
    ["sleep", secs(kv.sleep) === 0, `system sleep on mains: ${minutes(kv.sleep)} (never: a sleeping PC drops the run)`],
    ["display sleep", true, `screen off after ${minutes(kv.display_sleep)} on mains`],
    ["clone", /autocrlf=false/.test(kv.clone ?? ""), `~/${CLONE} at ${kv.clone || "— missing"} (false: LF, as the shaders want)`],
    ["GPU queue", true, kv.gpu_lock ?? "?"],
  ];
  console.log(`${HOST} — Windows ${kv.os}, ${kv.user}`);
  for (const [k, ok, d] of checks) console.log(`  ${ok ? "✓" : "✗"} ${k.padEnd(15)} ${d}`);
  const bad = checks.filter((c) => !c[1]).length;
  if (!bad) await runner(["status"]);
  process.exit(bad ? 1 : 0);
}

const sub = argv[0];
if (sub === "doctor") await doctor();
else if (!(await reach())) process.exit(2);
if (sub === "run") {
  const dd = argv.indexOf("--");
  if (dd < 0 || dd === argv.length - 1) die("run [--headless] [--cpu] [--hold s] [--name n] [--detach] -- <command…>");
  const opts = argv.slice(1, dd);
  const cmd = shellJoin(argv.slice(dd + 1));
  const flag = (k: string) => opts.includes(`--${k}`);
  const val = (k: string) => {
    const i = opts.indexOf(`--${k}`);
    return i >= 0 ? opts[i + 1] : undefined;
  };
  const cpu = flag("cpu");
  const job = { cmd, gpu: !cpu, headed: !cpu && !flag("headless"), hold: Number(val("hold") ?? 0), host: HOST };
  // (its name: --name, or the test file's, or the command's first word)
  // (a test file first — not bun test's --preload one, named before it)
  const words = cmd.split(/\s+/);
  const guess =
    (words.find((w) => /\.test\.ts$/.test(w)) ?? words.find((w) => /\.(ts|js)$/.test(w)))
      ?.replace(/^.*\//, "")
      .replace(/(\.e2e)?(\.test)?\.ts$/, "") ?? words.find((w) => !w.includes("="));
  const name = (val("name") ?? guess ?? "job").replace(/[^a-z0-9-]+/gi, "-").slice(0, 40);
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${name}`;
  await withSyncLock(() => sync(id));
  const b64 = Buffer.from(JSON.stringify(job)).toString("base64");
  if ((await runner(["start", id, b64], { quiet: true })).code !== 0) die("start failed");
  console.error(`remote: ${id} started on ${HOST}${job.headed ? ", full screen" : job.gpu ? ", headless" : ", CPU only"}`);
  if (flag("detach")) console.log(id);
  else process.exit(await follow(id));
} else if (sub === "sync") await withSyncLock(() => sync());
else if (sub === "status") process.exit((await runner(["status"])).code);
else if (sub === "logs") {
  const id = argv[1] ?? die("logs <id> [-f]");
  if (argv.includes("-f")) process.exit(await follow(id));
  process.exit(Bun.spawnSync(sh(`cat ${DIR}/runs/${id}/.job/log`), { stdout: "inherit", stderr: "inherit" }).exitCode);
} else if (sub === "fetch") await fetch(argv[1] ?? die("fetch <id>"));
else if (sub === "cancel") process.exit((await runner(["cancel", argv[1] ?? die("cancel <id>")])).code);
else if (sub === "clean")
  process.exit((await runner(["clean", "--keep", argv.includes("--keep") ? argv[argv.indexOf("--keep") + 1]! : "10"])).code);
else
  die("run | status | logs <id> [-f] | fetch <id> | cancel <id> | clean [--keep n] | sync | doctor — see the header of scripts/remote.ts");
