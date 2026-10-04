// Tests and measures run on another Mac on the network (docs/REMOTE-TESTS.md): this tree as it is —
// uncommitted changes and untracked files with it, what .gitignore leaves out left out — copied there,
// the command run in that copy, its log streamed here and what it wrote brought back.
//
//   bun scripts/remote.ts run [--headless] [--cpu] [--hold <s>] [--name <n>] [--detach] -- <command…>
//   bun scripts/remote.ts status | logs <id> [-f] | fetch <id> | cancel <id> | clean [--keep 10] | sync
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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const HOST = process.env.KERR_REMOTE ?? "kerr-mini";
const DIR = process.env.KERR_REMOTE_DIR ?? "kerr-runner";
const RESULTS = "remote-results";
const RUNNER = `~/.bun/bin/bun ${DIR}/base/scripts/remote-runner.ts`;

const die = (msg: string): never => {
  console.error(`remote: ${msg}`);
  process.exit(2);
};

/** The runner over ssh: its output here, its exit code back. */
async function runner(args: string[], o: { stdin?: Uint8Array; quiet?: boolean } = {}) {
  const p = Bun.spawn(["ssh", "-o", "BatchMode=yes", HOST, `${RUNNER} ${args.map((a) => `'${a}'`).join(" ")}`], {
    stdin: o.stdin ?? "ignore",
    stdout: o.quiet ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const out = o.quiet ? await new Response(p.stdout).text() : "";
  return { code: await p.exited, out: out.trim() };
}

/** One sync at a time from here (two runs started together would prune each other's base). */
async function withSyncLock<T>(f: () => Promise<T>) {
  mkdirSync(RESULTS, { recursive: true });
  const lock = `${RESULTS}/.sync.lock`;
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

/** The tree as git sees it, ignored files out — the remote base made equal to it; then a run's copy. */
async function sync(id?: string) {
  const files = (await Bun.$`git ls-files -co --exclude-standard -z`.text()).split("\0").filter((f) => f && existsSync(f));
  const list = new TextEncoder().encode(files.join("\0"));
  const t0 = performance.now();
  await Bun.$`ssh -o BatchMode=yes ${HOST} mkdir -p ${DIR}/base`;
  // (the network drops now and then — Wi-Fi —: a transfer cut short is resumed, the files already there kept)
  let stats = "";
  for (let attempt = 1; ; attempt++) {
    const rs = Bun.spawn(["rsync", "-a", "--from0", "--files-from=-", "--stats", ".", `${HOST}:${DIR}/base/`], {
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
  if (id && (await runner(["prepare", id], { stdin: list })).code !== 0) die("prepare failed");
}

async function fetch(id: string) {
  mkdirSync(`${RESULTS}/${id}`, { recursive: true });
  const r = Bun.spawnSync(["rsync", "-a", `${HOST}:${DIR}/runs/${id}/.job/`, `${RESULTS}/${id}/`], { stderr: "inherit" });
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

const argv = process.argv.slice(2);
const sub = argv[0];
if (sub === "run") {
  const dd = argv.indexOf("--");
  if (dd < 0 || dd === argv.length - 1) die("run [--headless] [--cpu] [--hold s] [--name n] [--detach] -- <command…>");
  const opts = argv.slice(1, dd);
  const cmd = argv.slice(dd + 1).join(" ");
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
  process.exit(
    Bun.spawnSync(["ssh", "-o", "BatchMode=yes", HOST, `cat ${DIR}/runs/${id}/.job/log`], { stdout: "inherit", stderr: "inherit" })
      .exitCode,
  );
} else if (sub === "fetch") await fetch(argv[1] ?? die("fetch <id>"));
else if (sub === "cancel") process.exit((await runner(["cancel", argv[1] ?? die("cancel <id>")])).code);
else if (sub === "clean")
  process.exit((await runner(["clean", "--keep", argv.includes("--keep") ? argv[argv.indexOf("--keep") + 1]! : "10"])).code);
else die("run | status | logs <id> [-f] | fetch <id> | cancel <id> | clean [--keep n] | sync — see the header of scripts/remote.ts");
