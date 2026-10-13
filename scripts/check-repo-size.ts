// The repository's binaries against their budgets (docs/ASSETS.md): every binary git tracks at HEAD, summed — a
// warning past WARN_TOTAL_MB, a failure past MAX_TOTAL_MB —, and, given a base, each binary blob the change adds
// or rewrites (a new file, or new bytes under an old name: either stays in the history for good) — a failure past
// MAX_FILE_MB, a warning when they come to more than WARN_ADDED_MB together. Git's own detection says what is
// binary (`git ls-files --eol`: i/-text); sizes are the blobs' (`git ls-tree -l`), whatever the working tree.
//
//   bun scripts/check-repo-size.ts [--base <rev>]      (the CI: --base HEAD^1 — a pull request's base, a push's
//                                                       previous commit; without a base: the total alone)
//
// Raising a budget is a decision made in the same change, in this file, where a review sees it.
import { $ } from "bun";

const MAX_FILE_MB = 8;
const WARN_ADDED_MB = 20;
const WARN_TOTAL_MB = 560;
const MAX_TOTAL_MB = 600;

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const MB = 1e6;
const mb = (n: number) => `${(n / MB).toFixed(1)} MB`;
// (annotations on the CI's run page)
const ci = !!process.env.GITHUB_ACTIONS;
const warn = (msg: string) => console.warn(ci ? `::warning title=Repository size::${msg}` : `! ${msg}`);
const fail = (msg: string) => console.error(ci ? `::error title=Repository size::${msg}` : `✗ ${msg}`);

/** path → its blob (id, size) at a revision — files only */
async function tree(rev: string) {
  const out = new Map<string, { sha: string; size: number }>();
  for (const line of (await $`git ls-tree -r -l -z ${rev}`.quiet().text()).split("\0")) {
    const m = /^\d+ blob ([0-9a-f]+) +(\d+)\t(.*)$/s.exec(line);
    if (m) out.set(m[3]!, { sha: m[1]!, size: Number(m[2]) });
  }
  return out;
}
/** the paths git sees as binary in the index */
async function binaries() {
  const out = new Set<string>();
  for (const line of (await $`git ls-files --eol -z`.quiet().text()).split("\0")) {
    const m = /^i\/(\S*)\s+w\/\S*\s+attr\/[^\t]*\t(.*)$/s.exec(line);
    if (m && m[1] === "-text") out.add(m[2]!);
  }
  return out;
}

const head = await tree("HEAD");
const binary = await binaries();
let total = 0;
for (const [path, b] of head) if (binary.has(path)) total += b.size;
let failed = false;
const all = [...head.values()].reduce((a, b) => a + b.size, 0);
console.log(`check-repo-size: ${mb(total)} of binaries tracked (${mb(all)} in all), budget ${MAX_TOTAL_MB} MB`);
if (total > MAX_TOTAL_MB * MB) {
  fail(`the tracked binaries exceed ${MAX_TOTAL_MB} MB — see docs/ASSETS.md`);
  failed = true;
} else if (total > WARN_TOTAL_MB * MB) warn(`the tracked binaries pass ${WARN_TOTAL_MB} MB — see docs/ASSETS.md`);

const base = arg("base");
const baseOk = base && (await $`git rev-parse --verify --quiet ${`${base}^{commit}`}`.nothrow().quiet()).exitCode === 0;
if (base && !baseOk) warn(`no revision ${base} here (a shallow clone?) — the new blobs not checked`);
if (baseOk) {
  const before = await tree(base);
  const known = new Set([...before.values()].map((b) => b.sha));
  const added = [...head]
    .filter(([path, b]) => binary.has(path) && !known.has(b.sha))
    .map(([path, b]) => [path, b.size] as const)
    .sort((a, b) => b[1] - a[1]);
  const sum = added.reduce((a, [, s]) => a + s, 0);
  console.log(`check-repo-size: ${added.length} new binary blob(s) since ${base}, ${mb(sum)}`);
  for (const [path, size] of added.slice(0, 10)) console.log(`  ${mb(size).padStart(9)}  ${path}${before.has(path) ? " (rewritten)" : ""}`);
  const big = added.filter(([, s]) => s > MAX_FILE_MB * MB);
  for (const [path, size] of big) fail(`${path}: ${mb(size)}, over ${MAX_FILE_MB} MB for one new binary — see docs/ASSETS.md`);
  if (big.length) failed = true;
  if (sum > WARN_ADDED_MB * MB) warn(`${mb(sum)} of new binaries in one change (over ${WARN_ADDED_MB} MB): they stay in the history`);
}
process.exit(failed ? 1 : 0);
