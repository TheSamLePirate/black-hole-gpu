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
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
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

const DIR = resolve(import.meta.dir, "../..");
const BASE = join(DIR, "base");
const RUNS = join(DIR, "runs");
const LOCK = join(DIR, "gpu.lock");
const PATH = [`${homedir()}/.bun/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");

interface Job {
  cmd: string;
  gpu: boolean;
  headed: boolean;
  hold: number;
}
interface Meta extends Job {
  id: string;
  state: "queued" | "running" | "done";
  created: number;
  started?: number;
  ended?: number;
  exit?: number;
  pid?: number;
  /** the job's process group (its zsh, and the server and Chrome it starts) */
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
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The job's whole group ended — its zsh, its server, its Chrome —, whether its worker lives or not. */
function killGroup(m: Meta, sig: NodeJS.Signals) {
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
    if (e.name === "node_modules" || e.name === ".job") continue;
    if (e.isDirectory()) walk(root, p, out);
    else out.push(p);
  }
  return out;
}

async function prepare(id: string) {
  const keep = new Set((await Bun.stdin.text()).split("\0").filter(Boolean));
  if (!keep.size) fail("prepare: no file list on stdin");
  // (a file deleted here since the last sync goes there too)
  for (const f of walk(BASE)) if (!keep.has(f)) rmSync(join(BASE, f), { force: true });
  const lock = readFileSync(join(BASE, "bun.lock"));
  const hash = createHash("sha256").update(lock).digest("hex");
  const stamp = join(DIR, "bun.lock.sha256");
  if (!existsSync(join(BASE, "node_modules")) || (existsSync(stamp) ? readFileSync(stamp, "utf8") : "") !== hash) {
    console.error("remote-runner: bun install (bun.lock changed)");
    const r = spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: BASE, stdio: ["ignore", 2, 2], env: { ...process.env, PATH } });
    if (r.status !== 0) fail("bun install failed");
    writeFileSync(stamp, hash);
  }
  const run = join(RUNS, id);
  if (existsSync(run)) fail(`run ${id} exists`);
  mkdirSync(run, { recursive: true });
  // (clones that keep their dates: what the job writes is what is newer than its start)
  const top = readdirSync(BASE).filter((n) => n !== "node_modules");
  const r = spawnSync("cp", ["-cRp", ...top.map((n) => join(BASE, n)), run], { stdio: ["ignore", 2, 2] });
  if (r.status !== 0) fail("clone failed");
  symlinkSync(join(BASE, "node_modules"), join(run, "node_modules"));
  mkdirSync(jobDir(id));
}

function start(id: string, b64: string) {
  const job: Job = JSON.parse(Buffer.from(b64, "base64").toString());
  if (!existsSync(jobDir(id))) fail(`no run ${id} (prepare first)`);
  if (job.headed) {
    const owner = spawnSync("stat", ["-f", "%Su", "/dev/console"]).stdout.toString().trim();
    if (owner !== userInfo().username)
      fail(
        `--headed: no graphical session of ${userInfo().username} on this Mac (the console is ${owner || "nobody"}'s) — log in there first`,
      );
  }
  // (without the internet, Chrome — headless too — hangs at its start, its DevTools never answering:
  // seen when that Mac's Wi-Fi had lost it)
  if (job.gpu && spawnSync("curl", ["-s", "-m", "5", "-o", "/dev/null", "https://clients3.google.com/generate_204"]).status !== 0)
    console.error('remote-runner: WARNING — this Mac does not reach the internet; Chrome may hang at its start ("Chrome did not start")');
  writeMeta({ ...job, id, state: "queued", created: Date.now() });
  // (its own session: the ssh that started it can drop, it runs on)
  spawn(process.execPath, [import.meta.path, "worker", id], { detached: true, stdio: "ignore" }).unref();
  console.log(id);
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
  const env = { ...process.env, PATH, KERR_REMOTE_JOB: id, E2E_HEADED: m.headed ? "1" : "0", E2E_HOLD: m.hold ? String(m.hold) : "" };
  const child = spawn("/bin/zsh", ["-c", m.cmd], { cwd: run, env, detached: true, stdio: ["ignore", log, log] });
  m.pgid = child.pid;
  writeMeta(m);
  // (the screen and the machine kept awake while it runs: a sleeping display stops a headed page's frames)
  if (m.gpu) spawn("caffeinate", ["-dimsu", "-w", String(child.pid)], { stdio: "ignore" }).unref();
  const code = await new Promise<number>((ok) => child.on("exit", (c, s) => ok(c ?? 128 + (s === "SIGKILL" ? 9 : 15))));
  // (what it left behind — a Chrome, a server — goes with it: they are in its process group)
  try {
    process.kill(-child.pid!, "SIGKILL");
  } catch {}
  closeSync(log);
  const art = join(jobDir(id), "artifacts");
  for (const f of walk(run)) {
    if (statSync(join(run, f)).mtimeMs < m.started) continue;
    mkdirSync(dirname(join(art, f)), { recursive: true });
    spawnSync("cp", ["-cp", join(run, f), join(art, f)]);
  }
  if (m.gpu) rmSync(LOCK, { recursive: true, force: true });
  Object.assign(m, { state: "done", ended: Date.now(), exit: code });
  writeMeta(m);
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
      const o = existsSync(join(LOCK, "owner")) ? JSON.parse(readFileSync(join(LOCK, "owner"), "utf8")).id : "?";
      console.error(`remote-runner: ${id} waits for the GPU (held by ${o})`);
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
if (cmd === "prepare") await prepare(a ?? fail("prepare <id>"));
else if (cmd === "start") start(a ?? fail("start <id> <job>"), b ?? fail("start <id> <job>"));
else if (cmd === "worker") await worker(a!);
else if (cmd === "follow") await follow(a ?? fail("follow <id>"), b === "--from" ? Number(c) : 0);
else if (cmd === "status") status();
else if (cmd === "cancel") cancel(a ?? fail("cancel <id>"));
else if (cmd === "clean") clean(a === "--keep" ? Number(b) : 10);
else fail(`unknown command ${cmd ?? ""}`);
