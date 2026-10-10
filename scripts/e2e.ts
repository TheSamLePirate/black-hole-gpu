// The e2e runner (docs/E2E.md): the files named, or all of tests/e2e — here, or on kerr-mini.
//
//   bun run e2e                              every e2e, here (~20 min)
//   bun run e2e smoke landing                tests/e2e/smoke.e2e.test.ts and landing's (a name, a path, or a glob's part)
//   bun run e2e smoke -t "radial wheel"      bun test's own flags after the names (-t: a test's name)
//   bun run e2e --remote smoke               the same on kerr-mini (bun scripts/remote.ts run): full screen there
//   bun run e2e --remote --detach landing    …queued there, back at once (bun scripts/remote.ts logs <id> -f)
//   bun run e2e --each [names…]              a bun test per file: a table of pass / fail / skip / seconds at the end,
//                                            and remote-results/e2e-summary-<time>.json (with --remote: made there)
//   bun run e2e --list                       the e2e files
//
// Every test is recorded (tests/e2e/lib/telemetry.ts): remote-results/e2e-reports/<time>-<host>/<file>/<NN>/
// (E2E_REPORT_ROOT to choose; E2E_TELEMETRY=0: none) — its line "e2e reports: <root>" says where.
//
// (it replaces `E2E=1 bun test tests/e2e …`, whose tests/e2e filter added to a file named after it: every e2e ran)
import { readdirSync } from "node:fs";
import { reportRoot } from "../tests/e2e/lib/telemetry";
import { shellJoin } from "./lib/shell";

// (every test recorded — its telemetry, frame rate, moments, a picture — under one root per run:
// tests/e2e/lib/telemetry.ts; the dashboard reads them)
const PRELOAD = ["--preload", "./tests/e2e/lib/preload.ts"];

const DIR = "tests/e2e";
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".e2e.test.ts"))
  .sort();

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  for (const f of files) console.log(`${DIR}/${f}`);
  process.exit(0);
}

// (the remote runner's own flags, taken before the names)
const REMOTE_FLAGS = new Set(["--headless", "--detach"]);
const REMOTE_VALUED = new Set(["--hold", "--name"]);
let remote = false;
let each = false;
const remoteArgs: string[] = [];
const names: string[] = [];
const testArgs: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--remote") remote = true;
  else if (a === "--each") each = true;
  else if (REMOTE_FLAGS.has(a)) remoteArgs.push(a);
  else if (REMOTE_VALUED.has(a)) remoteArgs.push(a, argv[++i] ?? "");
  else if (a.startsWith("-")) {
    // (bun test's: the rest of the line, its values with it)
    testArgs.push(...argv.slice(i));
    break;
  } else names.push(a);
}
if (remoteArgs.length && !remote) {
  console.error(`e2e: ${remoteArgs.join(" ")} only with --remote`);
  process.exit(2);
}

// (a name: a path, a file's name, or a part of one — "smoke", "assist-", "tars-agent.e2e")
const chosen: string[] = [];
for (const n of names) {
  const exact = files.filter((f) => `${DIR}/${f}` === n || f === n || f === `${n}.e2e.test.ts`);
  const hits = exact.length ? exact : files.filter((f) => f.includes(n));
  if (!hits.length) {
    console.error(`e2e: no e2e file matches "${n}" (bun run e2e --list)`);
    process.exit(2);
  }
  for (const h of hits) if (!chosen.includes(`${DIR}/${h}`)) chosen.push(`${DIR}/${h}`);
}

const targets = chosen.length ? chosen : files.map((f) => `${DIR}/${f}`);
console.error(
  `e2e: ${chosen.length || "all"} file${chosen.length === 1 ? "" : "s"}${each ? ", one process each" : ""}${remote ? " on kerr-mini" : ""}: ${chosen.map((c) => c.slice(DIR.length + 1)).join(" ") || DIR}`,
);

if (remote) {
  // (on the mini, this same script: --each's summary is written there and brought back with the artifacts)
  const there = each
    ? ["bun", "scripts/e2e.ts", "--each", ...chosen, ...testArgs]
    : ["bun", "test", ...PRELOAD, ...(chosen.length ? chosen : [DIR]), "--timeout", "600000", ...testArgs];
  const p = Bun.spawn(["bun", "scripts/remote.ts", "run", ...remoteArgs, "--", `E2E=1 ${shellJoin(there)}`], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(await p.exited);
}

if (!each) {
  const p = Bun.spawn(["bun", "test", ...PRELOAD, ...(chosen.length ? chosen : [DIR]), "--timeout", "600000", ...testArgs], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, E2E: "1", E2E_REPORT_ROOT: reportRoot() },
  });
  process.exit(await p.exited);
}

// --each: a bun test per file, its output streamed, its counts and wall time kept — the campaign's table
interface Row {
  file: string;
  code: number;
  pass: number;
  fail: number;
  skip: number;
  seconds: number;
  failures: string[];
}
const rows: Row[] = [];
const t0 = Date.now();
for (const file of targets) {
  const t = Date.now();
  const p = Bun.spawn(["bun", "test", ...PRELOAD, file, "--timeout", "600000", ...testArgs], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, E2E: "1", E2E_REPORT_ROOT: reportRoot(), E2E_FILE: file.slice(DIR.length + 1) },
  });
  let out = "";
  const pump = async (s: ReadableStream<Uint8Array>, to: NodeJS.WriteStream) => {
    for await (const chunk of s as unknown as AsyncIterable<Uint8Array>) {
      const txt = new TextDecoder().decode(chunk);
      out += txt;
      to.write(txt);
    }
  };
  await Promise.all([pump(p.stdout, process.stdout), pump(p.stderr, process.stderr)]);
  const code = await p.exited;
  const n = (k: string) => Number(out.match(new RegExp(`^\\s*(\\d+) ${k}$`, "m"))?.[1] ?? 0);
  rows.push({
    file: file.slice(DIR.length + 1),
    code,
    pass: n("pass"),
    fail: n("fail"),
    skip: n("skip"),
    seconds: Math.round((Date.now() - t) / 1000),
    failures: [...out.matchAll(/^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/gm)].map((m) => m[1]!),
  });
}
const failed = rows.filter((r) => r.code !== 0);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
// (E2E_SUMMARY: where to write it — the dashboard's runs keep theirs beside their log)
const summaryFile = process.env.E2E_SUMMARY || `remote-results/e2e-summary-${stamp}.json`;
const summary = {
  host: (await Bun.$`hostname -s`.text()).trim(),
  commit: (await Bun.$`git rev-parse --short HEAD`.nothrow().text()).trim(),
  dirty: (await Bun.$`git status --porcelain`.nothrow().text()).trim() !== "",
  reports: reportRoot(),
  at: new Date().toISOString(),
  seconds: Math.round((Date.now() - t0) / 1000),
  files: rows.length,
  failed: failed.map((r) => r.file),
  rows,
};
await Bun.write(summaryFile, JSON.stringify(summary, null, 1));
console.log(
  `\ne2e summary — ${summary.host} ${summary.commit}${summary.dirty ? "+dirty" : ""}, ${rows.length} files, ${summary.seconds} s`,
);
console.log("  file".padEnd(42), "pass fail skip    s");
for (const r of rows)
  console.log(
    `${r.code ? "✗" : "✓"} ${r.file.padEnd(40)} ${String(r.pass).padStart(4)} ${String(r.fail).padStart(4)} ${String(r.skip).padStart(4)} ${String(r.seconds).padStart(4)}`,
  );
for (const r of failed) console.log(`\n✗ ${r.file} (exit ${r.code})${r.failures.map((f) => `\n    ${f}`).join("")}`);
console.log(`\n${summaryFile}`);
process.exit(failed.length ? 1 : 0);
