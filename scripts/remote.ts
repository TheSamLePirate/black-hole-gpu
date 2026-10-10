// Tests and measures run on another Mac on the network (docs/REMOTE-TESTS.md): this tree as it is —
// uncommitted changes and untracked files with it, what .gitignore leaves out left out — copied there,
// the command run in that copy, its log streamed here and what it wrote brought back.
//
//   bun scripts/remote.ts run [--headless] [--cpu] [--hold <s>] [--name <n>] [--detach] -- <command…>
//   bun scripts/remote.ts status | logs <id> [-f] | fetch <id> | cancel <id> | clean [--keep 10] | sync | doctor
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
// The machine: ssh's alias KERR_REMOTE (kerr-mini), the folder there KERR_REMOTE_DIR (kerr-runner, in its
// home) — nothing of it in the repository.
// Its own clone of the repository (KERR_REMOTE_CLONE, Documents/DEV/black-hole-gpu in its home; empty: none)
// is pulled at each sync — fast-forward only, never in the way of the run: the jobs run on the copy sent
// from here, not on it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_DIR, labConfig } from "./lib/chrome-lock";
import { shellJoin } from "./lib/shell";

const HOST = process.env.KERR_REMOTE ?? "kerr-mini";
const DIR = process.env.KERR_REMOTE_DIR ?? "kerr-runner";
const RESULTS = "remote-results";
const CLONE = process.env.KERR_REMOTE_CLONE ?? "Documents/DEV/black-hole-gpu";
const RUNNER = `~/.bun/bin/bun ${DIR}/base/scripts/remote-runner.ts`;

// (ssh never waits for ever: a Mac asleep or off the network fails in seconds, a link gone quiet in a minute —
// a run once hung 20 minutes on a name that no longer resolved)
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"];
// (its address as last seen — remote-results/.host-ip, written by `doctor` and every reachable run: used when
// its .local name no longer resolves, the Bonjour name being the first thing to go)
const IP_FILE = `${RESULTS}/.host-ip`;
const VIA: string[] = [];
const ssh = (...a: string[]) => ["ssh", ...SSH, ...VIA, ...a];
const rsyncE = () => ["-e", ["ssh", ...SSH, ...VIA].join(" ")];

/** The machine reached: by its name, else at its last known address; its address then remembered. */
async function reach(): Promise<boolean> {
  const tryIt = async (via: string[]) => {
    const p = Bun.spawn(["ssh", ...SSH, ...via, HOST, "ipconfig getifaddr en0 || ipconfig getifaddr en1"], {
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
  const p = Bun.spawn(ssh(HOST, `${RUNNER} ${args.map((a) => `'${a}'`).join(" ")}`), {
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
  const lock = join(LAB_DIR, "sync.lock");
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
    [
      ...ssh(HOST),
      `cd '${CLONE}' && git fetch -q origin 2>&1 && git merge --ff-only -q '@{u}' 2>&1 && git log -1 --format='%h %s' | cut -c1-80`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = (await new Response(p.stdout).text()).trim();
  const err = (await new Response(p.stderr).text()).trim();
  if ((await p.exited) === 0) console.error(`remote: ${HOST}:~/${CLONE} pulled — at ${out.split("\n").pop()}`);
  else console.error(`remote: WARNING — ${HOST}:~/${CLONE} not pulled: ${(out || err).split("\n").slice(-2).join(" ")}`);
}

/** The tree as git sees it, ignored files out — the remote base made equal to it; then a run's copy. */
async function sync(id?: string) {
  const pulled = pullClone();
  const files = (await Bun.$`git ls-files -co --exclude-standard -z`.text()).split("\0").filter((f) => f && existsSync(f));
  const list = new TextEncoder().encode(files.join("\0"));
  const t0 = performance.now();
  await Bun.$`${ssh(HOST, `mkdir -p ${DIR}/base`)}`;
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
  const r = Bun.spawnSync(["rsync", ...rsyncE(), "-a", `${HOST}:${DIR}/runs/${id}/.job/`, `${RESULTS}/${id}/`], { stderr: "inherit" });
  if (r.exitCode !== 0) die(`fetch ${id} failed`);
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
  const p = Bun.spawn(ssh(HOST, probe), { stdout: "pipe", stderr: "inherit" });
  const kv = Object.fromEntries(
    (await new Response(p.stdout).text())
      .trim()
      .split("\n")
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  await p.exited;
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

const argv = process.argv.slice(2);
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
  const job = { cmd, gpu: !cpu, headed: !cpu && !flag("headless"), hold: Number(val("hold") ?? 0) };
  // (its name: --name, or the test file's, or the command's first word)
  const guess =
    cmd
      .split(/\s+/)
      .find((w) => /\.(ts|js)$/.test(w))
      ?.replace(/^.*\//, "")
      .replace(/(\.e2e)?(\.test)?\.ts$/, "") ?? cmd.split(/\s+/).find((w) => !w.includes("="));
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
  process.exit(Bun.spawnSync(ssh(HOST, `cat ${DIR}/runs/${id}/.job/log`), { stdout: "inherit", stderr: "inherit" }).exitCode);
} else if (sub === "fetch") await fetch(argv[1] ?? die("fetch <id>"));
else if (sub === "cancel") process.exit((await runner(["cancel", argv[1] ?? die("cancel <id>")])).code);
else if (sub === "clean")
  process.exit((await runner(["clean", "--keep", argv.includes("--keep") ? argv[argv.indexOf("--keep") + 1]! : "10"])).code);
else
  die("run | status | logs <id> [-f] | fetch <id> | cancel <id> | clean [--keep n] | sync | doctor — see the header of scripts/remote.ts");
