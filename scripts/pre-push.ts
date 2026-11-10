// The checks before a push (audit 2026-11-10, QA-01): the CI's fast verifications — Biome, types, the shaders
// compiled by Chrome's WebGPU, the binaries' budget — run on the EXACT revision being pushed, not on the working
// tree. Several sessions share this checkout: another session's unfinished file must neither fail nor pass a push
// that does not contain it. Each pushed commit is checked out alone (a detached worktree in the temporary
// directory, LFS left as pointers: none of these checks reads a binary's bytes), the checkout's node_modules lent.
//
//   git push                                   (.githooks/pre-push runs it: git config core.hooksPath — bun run hooks)
//   bun scripts/pre-push.ts --rev <sha>        (by hand: one revision, against origin/main)
//   KERR_SKIP_CHECKS=1 git push                (an emergency: said aloud, the CI still judges)
//
// The unit tests are left to the CI (≈ 8 min on its runner, ≈ 35 min here); this gate is the ≈ 30 s that keeps the
// CI from going red on format or types (36 red runs in a row, 4–8 November). Exit 1 on any failure, every failing
// check's whole output printed.
import { $ } from "bun";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ZERO = /^0+$/;
/** the checkout this script lives in: its node_modules are lent to the revision's worktree */
const HOME = resolve(import.meta.dir, "..");

export interface PushedRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

/** git's pre-push standard input: one line per ref, "<local ref> <local sha> <remote ref> <remote sha>" */
export function parsePushLines(input: string): PushedRef[] {
  const out: PushedRef[] = [];
  for (const line of input.split("\n")) {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!localRef || !localSha || !remoteRef || !remoteSha) continue;
    out.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return out;
}

/** the revisions to check (a deletion pushes nothing), each with the base its new binaries are counted from */
export function revisionsToCheck(refs: PushedRef[], fallbackBase: string | undefined): { sha: string; base?: string }[] {
  const seen = new Map<string, string | undefined>();
  for (const r of refs) {
    if (ZERO.test(r.localSha) || seen.has(r.localSha)) continue;
    seen.set(r.localSha, ZERO.test(r.remoteSha) ? fallbackBase : r.remoteSha);
  }
  return [...seen].map(([sha, base]) => ({ sha, base }));
}

interface Check {
  name: string;
  cmd: string[];
}

async function run(c: Check, cwd: string) {
  const t0 = performance.now();
  const p = Bun.spawn(c.cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { ...c, code, out: out + err, s: (performance.now() - t0) / 1000 };
}

/** the checkout's own tools — never `bunx`: without node_modules it fetched a registry package named "tsc" (5.0.2, no
 * import attributes) and failed every push with parse errors (10 Nov) — and a pre-push hook must not run downloaded code */
const BIN = (tool: string) => join(HOME, "node_modules", ".bin", tool);

async function checkRevision(sha: string, base: string | undefined): Promise<boolean> {
  for (const tool of ["biome", "tsc"])
    if (!existsSync(BIN(tool))) {
      console.log(`pre-push: ${BIN(tool)} missing — run \`bun install --frozen-lockfile\` in ${HOME}, then push again`);
      return false;
    }
  const short = sha.slice(0, 8);
  const dir = mkdtempSync(join(tmpdir(), `kerr-prepush-${short}-`));
  const wt = join(dir, "wt");
  const t0 = performance.now();
  try {
    await $`git worktree add --detach -q ${wt} ${sha}`.env({ ...process.env, GIT_LFS_SKIP_SMUDGE: "1" }).quiet();
    symlinkSync(join(HOME, "node_modules"), join(wt, "node_modules"));
    console.log(`pre-push: ${short} checked out alone (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    // (Biome first: the cheapest and the most frequent red; then the three slow ones side by side)
    const first = await run({ name: "biome ci", cmd: [BIN("biome"), "ci", ".", "--colors=off", "--diagnostic-level=error"] }, wt);
    const results = [first];
    if (first.code === 0) {
      const sizeArgs = base ? ["--base", base] : [];
      results.push(
        ...(await Promise.all([
          run({ name: "tsc", cmd: [BIN("tsc"), "--noEmit"] }, wt),
          run({ name: "check-wgsl", cmd: ["bun", "scripts/check-wgsl.ts"] }, wt),
          ...(existsSync(join(wt, "scripts/check-repo-size.ts"))
            ? [run({ name: "check-repo-size", cmd: ["bun", "scripts/check-repo-size.ts", ...sizeArgs] }, wt)]
            : []),
        ])),
      );
    }
    let ok = true;
    for (const r of results) {
      const verdict = r.code === 0 ? "✓" : "✗";
      console.log(`pre-push: ${verdict} ${r.name} (${r.s.toFixed(1)} s)`);
      if (r.code !== 0) {
        ok = false;
        console.log(`----- ${r.name} on ${short}: whole output -----\n${r.out.trimEnd()}\n----- end of ${r.name} -----`);
      }
      // (check-wgsl passes without a WebGPU adapter: say it, nothing was compiled — QA-26)
      if (r.name === "check-wgsl" && r.code === 0 && !/shaders compile/.test(r.out))
        console.log(`pre-push: ! check-wgsl compiled nothing (no WebGPU adapter?):\n${r.out.trimEnd()}`);
      if (r.name === "check-repo-size") for (const l of r.out.split("\n")) if (/^!|✗/.test(l)) console.log(`pre-push:   ${l}`);
    }
    if (first.code !== 0) console.log("pre-push: tsc, check-wgsl and check-repo-size not run (Biome failed first)");
    console.log(`pre-push: ${short} ${ok ? "passes" : "FAILS"} (${((performance.now() - t0) / 1000).toFixed(1)} s in all)`);
    return ok;
  } finally {
    await $`git worktree remove --force ${wt}`.quiet().nothrow();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (process.env.KERR_SKIP_CHECKS === "1") {
    console.log("pre-push: KERR_SKIP_CHECKS=1 — checks skipped; the CI will judge this push (no push on a red CI)");
    return 0;
  }
  const i = process.argv.indexOf("--rev");
  const originMain = (await $`git rev-parse --verify -q origin/main`.quiet().nothrow()).stdout.toString().trim() || undefined;
  const revs =
    i > 0 && process.argv[i + 1]
      ? [{ sha: (await $`git rev-parse ${process.argv[i + 1]!}`.quiet().text()).trim(), base: originMain }]
      : revisionsToCheck(parsePushLines(await Bun.stdin.text()), originMain);
  if (!revs.length) return 0;
  let ok = true;
  for (const r of revs) ok = (await checkRevision(r.sha, r.base)) && ok;
  if (!ok)
    console.log(
      "pre-push: push refused. Fix and commit, then push again (bunx biome check --write . formats; KERR_SKIP_CHECKS=1 only in an emergency).",
    );
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
