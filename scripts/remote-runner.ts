// The remote machine's half of scripts/remote.ts — runs there (a Mac on the network, bun and Chrome
// installed), from its own copy of the tree: <dir>/base/scripts/remote-runner.ts, <dir> its parent's
// parent (~/kerr-runner). Never run by hand on this machine; remote.ts calls it over ssh:
//
//   prepare <id>          (stdin: the tree's files, NUL-separated) base pruned to them, bun install if
//                         bun.lock changed, then base cloned into runs/<id> (APFS clones: free, and a
//                         job writing a file — a golden, a shot — touches only its own copy)
//   start <id> <job>      the job (base64 JSON: cmd, gpu, headed, hold) queued, its worker detached
//   follow <id> [--from n] its log streamed until it ends; exits with the job's code
//   status | cancel <id> | clean [--keep n]
//
// A job's folder, runs/<id>/.job/: meta.json (its state, times, exit code), log, artifacts/ (every file
// the job wrote in the tree, at its path). GPU jobs take <dir>/gpu.lock one at a time: two renderers
// on one GPU halve both, and the measures with them.
//
// On Windows (kerr-pc, scripts/lib/lab-hosts.ts) the same, but: base is a git worktree of the host's clone,
// set by `overlay <clone> <commit>` (stdin: a tar of this tree's changes over that pushed commit, and the
// files it deleted) instead of a pruned rsync copy; a run's copy is robocopy's (no clones on NTFS), its
// node_modules a junction; the worker starts as a scheduled task in the user's desktop session (/IT: what
// sshd starts lives in a session with no screen, and dies with the connection); jobs run by Git Bash; a
// process tree is ended by taskkill (scripts/lib/procs.ts).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { alive, killTree, WINDOWS } from "./lib/procs";

const DIR = resolve(import.meta.dir, "../..");
const BASE = join(DIR, "base");
const RUNS = join(DIR, "runs");
const LOCK = join(DIR, "gpu.lock");
// (Windows: the user's own PATH, as the scheduled task and sshd give it — bun from WinGet, Git's tools)
const PATH = WINDOWS
  ? (process.env.PATH ?? "")
  : [`${homedir()}/.bun/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
const BASH = process.env.KERR_BASH ?? "C:/Program Files/Git/bin/bash.exe";

interface Job {
  cmd: string;
  gpu: boolean;
  headed: boolean;
  hold: number;
  /** the lab's name of the machine it runs on (scripts/lib/lab-hosts.ts) — the dashboard files the run under it */
  host?: string;
  /** the commit the tree was sent from ("+": changed since) — KERR_COMMIT in the job */
  commit?: string;
}
interface Meta extends Job {
  id: string;
  state: "queued" | "running" | "done";
  created: number;
  started?: number;
  ended?: number;
  exit?: number;
  pid?: number;
  /** the job's process group (its zsh, and the server and Chrome it starts); on Windows its shell's pid, the tree's root */
  pgid?: number;
  error?: string;
}

const jobDir = (id: string) => join(RUNS, id, ".job");
const readMeta = (id: string): Meta => JSON.parse(readFileSync(join(jobDir(id), "meta.json"), "utf8"));
function writeMeta(m: Meta) {
  const f = join(jobDir(m.id), "meta.json");
  writeFileSync(`${f}.tmp`, JSON.stringify(m, null, 1));
  renameSync(`${f}.tmp`, f);
}

/** The job's whole group ended — its zsh, its server, its Chrome —, whether its worker lives or not. */
function killGroup(m: Meta, sig: NodeJS.Signals) {
  if (WINDOWS) {
    if (m.pgid) killTree(m.pgid);
    return;
  }
  if (m.pgid)
    try {
      process.kill(-m.pgid, sig);
    } catch {}
  if (m.pid)
    for (const k of spawnSync("pgrep", ["-P", String(m.pid)])
      .stdout.toString()
      .split("\n")
      .filter(Boolean))
      try {
        process.kill(-Number(k), sig);
      } catch {}
}

/**
 * A job whose worker died (killed, crashed) is done — said so, what it started ended, the GPU let go if it
 * held it —, never "running" for ever (the monitor once showed two such ghosts).
 */
function settle(m: Meta): Meta {
  // (Windows: a scheduled task that never ran its worker — no desktop session, a refused task — said so, not
  // left queued for ever)
  if (WINDOWS && m.state === "queued" && !m.pid && Date.now() - m.created > 60_000) {
    Object.assign(m, { state: "done", ended: Date.now(), exit: 255, error: "its worker never started (the scheduled task)" });
    writeMeta(m);
    return m;
  }
  if (m.state === "done" || !m.pid || alive(m.pid)) return m;
  killGroup(m, "SIGKILL");
  try {
    if (JSON.parse(readFileSync(join(LOCK, "owner"), "utf8")).pid === m.pid) rmSync(LOCK, { recursive: true, force: true });
  } catch {}
  Object.assign(m, { state: "done", ended: Date.now(), exit: m.exit ?? 255, error: m.error ?? "its worker died" });
  writeMeta(m);
  return m;
}
const fail = (msg: string): never => {
  console.error(`remote-runner: ${msg}`);
  process.exit(2);
};

/** Every file under root, relative, node_modules and the job folders left out. */
function walk(root: string, rel = "", out: string[] = []) {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.name === "node_modules" || e.name === ".job" || e.name === ".git") continue;
    if (e.isDirectory()) walk(root, p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Windows: base put at `commit` (pushed — its clone fetches it) with the tar on stdin laid over it — the files
 * changed or added since that commit, .kerr-overlay.json listing those deleted. A git worktree of the clone:
 * its LFS assets come from the clone's store, unchanged files keep their dates.
 */
function overlay(clone: string, commit: string) {
  const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, ...a], { stdio: ["ignore", 2, 2] }).status === 0;
  const cl = resolve(homedir(), clone);
  if (!git(cl, "cat-file", "-e", `${commit}^{commit}`) && !git(cl, "fetch", "-q", "origin"))
    fail(`overlay: ${clone} cannot fetch (the network?)`);
  if (!git(cl, "cat-file", "-e", `${commit}^{commit}`)) fail(`overlay: ${commit} is not on GitHub — push it first`);
  // (LF as written: the WGSL specialiser reads lines; CRLF broke every kernel there)
  git(cl, "config", "core.autocrlf", "false");
  if (!existsSync(join(BASE, ".git"))) {
    rmSync(BASE, { recursive: true, force: true });
    git(cl, "worktree", "prune");
    if (!git(cl, "worktree", "add", "-q", "-f", "--detach", BASE, commit)) fail("overlay: git worktree add failed");
  }
  if (!git(BASE, "checkout", "-q", "-f", "--detach", commit)) fail(`overlay: checkout ${commit} failed`);
  // (what an earlier overlay added, gone — node_modules and the other ignored files kept)
  git(BASE, "clean", "-fdq");
  // (in base, not -C base: to Git's tar "C:" would name a remote host)
  const r = spawnSync("tar", ["-xzf", "-"], { cwd: BASE, stdio: [0, 2, 2] });
  if (r.status !== 0) fail("overlay: tar failed");
  const list = join(BASE, ".kerr-overlay.json");
  const { deleted = [] } = existsSync(list) ? (JSON.parse(readFileSync(list, "utf8")) as { deleted?: string[] }) : {};
  for (const f of deleted) rmSync(join(BASE, f), { force: true });
  rmSync(list, { force: true });
}

async function prepare(id: string) {
  if (!WINDOWS) {
    const keep = new Set((await Bun.stdin.text()).split("\0").filter(Boolean));
    if (!keep.size) fail("prepare: no file list on stdin");
    // (a file deleted here since the last sync goes there too)
    for (const f of walk(BASE)) if (!keep.has(f)) rmSync(join(BASE, f), { force: true });
  }
  const lock = readFileSync(join(BASE, "bun.lock"));
  const hash = createHash("sha256").update(lock).digest("hex");
  const stamp = join(DIR, "bun.lock.sha256");
  if (!existsSync(join(BASE, "node_modules")) || (existsSync(stamp) ? readFileSync(stamp, "utf8") : "") !== hash) {
    console.error("remote-runner: bun install (bun.lock changed)");
    const r = spawnSync(WINDOWS ? process.execPath : "bun", ["install", "--frozen-lockfile"], {
      cwd: BASE,
      stdio: ["ignore", 2, 2],
      env: { ...process.env, PATH },
    });
    if (r.status !== 0) fail("bun install failed");
    writeFileSync(stamp, hash);
  }
  const run = join(RUNS, id);
  if (existsSync(run)) fail(`run ${id} exists`);
  mkdirSync(run, { recursive: true });
  // (clones that keep their dates: what the job writes is what is newer than its start)
  if (WINDOWS) {
    // (robocopy keeps them too; its codes under 8 are successes)
    const r = spawnSync(
      "robocopy",
      [BASE, run, "/E", "/COPY:DAT", "/DCOPY:T", "/MT:16", "/XD", "node_modules", "/XF", ".git", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"],
      {
        stdio: ["ignore", "ignore", 2],
      },
    );
    if ((r.status ?? 16) >= 8) fail(`copy failed (robocopy ${r.status})`);
    // (a junction: a symbolic link needs the administrator's right on Windows)
    symlinkSync(join(BASE, "node_modules"), join(run, "node_modules"), "junction");
  } else {
    const top = readdirSync(BASE).filter((n) => n !== "node_modules");
    const r = spawnSync("cp", ["-cRp", ...top.map((n) => join(BASE, n)), run], { stdio: ["ignore", 2, 2] });
    if (r.status !== 0) fail("clone failed");
    symlinkSync(join(BASE, "node_modules"), join(run, "node_modules"));
  }
  mkdirSync(jobDir(id));
}

function start(id: string, b64: string) {
  const job: Job = JSON.parse(Buffer.from(b64, "base64").toString());
  if (!existsSync(jobDir(id))) fail(`no run ${id} (prepare first)`);
  if (job.headed && WINDOWS) {
    if (!desktopSession())
      fail(`--headed: ${userInfo().username} has no open desktop session on this PC (query user) — log in there first`);
  } else if (job.headed) {
    const owner = spawnSync("stat", ["-f", "%Su", "/dev/console"]).stdout.toString().trim();
    if (owner !== userInfo().username)
      fail(
        `--headed: no graphical session of ${userInfo().username} on this Mac (the console is ${owner || "nobody"}'s) — log in there first`,
      );
  }
  // (without the internet, Chrome — headless too — hangs at its start, its DevTools never answering:
  // seen when that Mac's Wi-Fi had lost it)
  if (
    job.gpu &&
    spawnSync("curl", ["-s", "-m", "5", "-o", WINDOWS ? "NUL" : "/dev/null", "https://clients3.google.com/generate_204"]).status !== 0
  )
    console.error(
      'remote-runner: WARNING — this machine does not reach the internet; Chrome may hang at its start ("Chrome did not start")',
    );
  writeMeta({ ...job, id, state: "queued", created: Date.now() });
  // (its own session: the ssh that started it can drop, it runs on)
  if (WINDOWS) startTask(id);
  else spawn(process.execPath, [import.meta.path, "worker", id], { detached: true, stdio: "ignore" }).unref();
  console.log(id);
}

/** Windows: the user logged in at the PC's screen (query user: a session "console", active). */
function desktopSession() {
  const q = spawnSync("query", ["user"]).stdout?.toString() ?? "";
  return q.split("\n").some((l) => l.toLowerCase().includes(userInfo().username.toLowerCase()) && /console/i.test(l));
}

/**
 * Windows: the worker as a scheduled task run now in the user's desktop session (/IT) — a process sshd starts
 * has no screen (its Chrome, full screen, shows nowhere) and ends with the connection. The task runs a .cmd in
 * the job's folder (schtasks /TR takes no quotes well); the worker removes the task at its end.
 */
function startTask(id: string) {
  const cmd = join(jobDir(id), "worker.cmd");
  writeFileSync(cmd, `@title kerr job ${id}\r\n@"${process.execPath}" "${import.meta.path}" worker ${id}\r\n`);
  const tn = `kerr-${id}`;
  const st = (...a: string[]) => spawnSync("schtasks", a, { stdio: ["ignore", "ignore", 2] }).status === 0;
  if (!st("/Create", "/TN", tn, "/TR", cmd, "/SC", "ONCE", "/ST", "23:59", "/IT", "/F")) fail("schtasks /Create failed");
  if (!st("/Run", "/TN", tn)) fail("schtasks /Run failed");
}

async function takeGpu(id: string) {
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "owner"), JSON.stringify({ id, pid: process.pid }));
      return;
    } catch {
      // (a holder that died leaves its lock: taken over)
      try {
        const o = JSON.parse(readFileSync(join(LOCK, "owner"), "utf8"));
        if (!alive(o.pid)) rmSync(LOCK, { recursive: true, force: true });
      } catch {
        // (being written: the next turn reads it)
      }
      await Bun.sleep(2000);
    }
  }
}

async function worker(id: string) {
  const m = readMeta(id);
  const run = join(RUNS, id);
  const log = openSync(join(jobDir(id), "log"), "a");
  m.pid = process.pid;
  writeMeta(m);
  if (m.gpu) await takeGpu(id);
  m.state = "running";
  m.started = Date.now();
  writeMeta(m);
  const env = {
    ...process.env,
    PATH,
    KERR_REMOTE_JOB: id,
    KERR_COMMIT: m.commit ?? "",
    E2E_HEADED: m.headed ? "1" : "0",
    E2E_HOLD: m.hold ? String(m.hold) : "",
  };
  const child = WINDOWS
    ? spawn(BASH, ["-c", m.cmd], { cwd: run, env, stdio: ["ignore", log, log], windowsHide: true })
    : spawn("/bin/zsh", ["-c", m.cmd], { cwd: run, env, detached: true, stdio: ["ignore", log, log] });
  m.pgid = child.pid;
  writeMeta(m);
  // (the screen and the machine kept awake while it runs: a sleeping display stops a headed page's frames —
  // on Windows the power plan's: `remote.ts doctor --host kerr-pc` says it)
  if (m.gpu && !WINDOWS) spawn("caffeinate", ["-dimsu", "-w", String(child.pid)], { stdio: "ignore" }).unref();
  const code = await new Promise<number>((ok) => child.on("exit", (c, s) => ok(c ?? 128 + (s === "SIGKILL" ? 9 : 15))));
  // (what it left behind — a Chrome, a server — goes with it: they are in its process group; on Windows its tree)
  if (WINDOWS) killTree(child.pid!);
  else
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
  closeSync(log);
  const art = join(jobDir(id), "artifacts");
  for (const f of walk(run)) {
    if (statSync(join(run, f)).mtimeMs < m.started) continue;
    mkdirSync(dirname(join(art, f)), { recursive: true });
    if (WINDOWS) copyFileSync(join(run, f), join(art, f));
    else spawnSync("cp", ["-cp", join(run, f), join(art, f)]);
  }
  if (m.gpu) rmSync(LOCK, { recursive: true, force: true });
  Object.assign(m, { state: "done", ended: Date.now(), exit: code });
  writeMeta(m);
  if (WINDOWS) spawnSync("schtasks", ["/Delete", "/TN", `kerr-${id}`, "/F"], { stdio: "ignore" });
}

async function follow(id: string, from: number) {
  if (!existsSync(jobDir(id))) fail(`no run ${id}`);
  const file = join(jobDir(id), "log");
  let pos = from,
    said = "";
  for (;;) {
    const m = readMeta(id);
    if (m.state === "queued" && said !== "queued") {
      said = "queued";
      const o = existsSync(join(LOCK, "owner")) ? JSON.parse(readFileSync(join(LOCK, "owner"), "utf8")).id : null;
      console.error(o ? `remote-runner: ${id} waits for the GPU (held by ${o})` : `remote-runner: ${id} queued, its worker starting`);
    }
    if (existsSync(file)) {
      const size = statSync(file).size;
      if (size > pos) {
        const fd = openSync(file, "r");
        const buf = Buffer.alloc(size - pos);
        readSync(fd, buf, 0, buf.length, pos);
        closeSync(fd);
        process.stdout.write(buf);
        pos = size;
      }
    }
    if (m.state === "done") process.exit(m.exit ?? 1);
    if (m.pid && !alive(m.pid)) {
      settle(m);
      fail(`${id}: its worker died (state ${m.state}) — settled, what it started ended`);
    }
    if (settle(m).state === "done") fail(`${id}: ${m.error}`);
    await Bun.sleep(500);
  }
}

function status() {
  if (!existsSync(RUNS)) return;
  const fmt = (ms?: number) => (ms === undefined ? "" : `${Math.round(ms / 1000)} s`);
  for (const id of readdirSync(RUNS).sort()) {
    let m: Meta;
    try {
      m = readMeta(id);
    } catch {
      console.log(`${id}  (prepared, not started)`);
      continue;
    }
    m = settle(m);
    const took = m.ended && m.started ? fmt(m.ended - m.started) : m.started ? `${fmt(Date.now() - m.started)}…` : "";
    const flags = [m.gpu && "gpu", m.headed && "headed"].filter(Boolean).join(",");
    console.log(`${`${id}  ${m.state.padEnd(7)} ${m.exit ?? ""}`.padEnd(48)}${took.padEnd(8)} ${flags.padEnd(10)} ${m.cmd.slice(0, 90)}`);
  }
}

function cancel(id: string) {
  const m = settle(readMeta(id));
  if (m.state === "done") return console.log(`${id} ${m.error === "its worker died" ? "settled (its worker had died)" : "already done"}`);
  // (the job's group: its zsh, its server, its Chrome — the worker then writes its end)
  killGroup(m, "SIGTERM");
  if (m.state === "queued" && m.pid) {
    process.kill(m.pid, "SIGTERM");
    Object.assign(m, { state: "done", ended: Date.now(), exit: 130, error: "cancelled" });
    writeMeta(m);
  }
  console.log(`${id} cancelled`);
}

function clean(keep: number) {
  if (!existsSync(RUNS)) return;
  const ids = readdirSync(RUNS).sort();
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) {
    try {
      if (readMeta(id).state !== "done") continue;
    } catch {}
    rmSync(join(RUNS, id), { recursive: true, force: true });
    console.log(`removed ${id}`);
  }
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === "overlay") overlay(a ?? fail("overlay <clone> <commit>"), b ?? fail("overlay <clone> <commit>"));
else if (cmd === "prepare") await prepare(a ?? fail("prepare <id>"));
else if (cmd === "start") start(a ?? fail("start <id> <job>"), b ?? fail("start <id> <job>"));
else if (cmd === "worker") await worker(a!);
else if (cmd === "follow") await follow(a ?? fail("follow <id>"), b === "--from" ? Number(c) : 0);
else if (cmd === "status") status();
else if (cmd === "cancel") cancel(a ?? fail("cancel <id>"));
else if (cmd === "clean") clean(a === "--keep" ? Number(b) : 10);
else fail(`unknown command ${cmd ?? ""}`);
