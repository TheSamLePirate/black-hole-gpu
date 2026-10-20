// An A/B of this tree against an older commit, on this machine (PLAN-TITRE-AAA E11: the first image against the
// code before the menus): the commit checked out in a worktree beside — its node_modules and its assets borrowed
// from this tree (the untracked and LFS ones a fresh worktree would lack) —, each side served by its own dev
// server, scripts/ab-pages.ts run between them (A the commit, B this tree, interleaved A B B A, a fresh profile a
// run), the servers stopped and the worktree removed after.
//   bun scripts/ab-commit.ts <rev> [rounds=3]       (on kerr-mini: bun scripts/remote.ts run -- bun scripts/ab-commit.ts …)
// The commit's repository: this tree if it is a checkout, else KERR_AB_REPO (default ~/Documents/DEV/black-hole-gpu,
// the mini's own checkout — the remote runner's copies are not ones). Results in AB_OUT (remote-results/…-ab-<rev>).
import { $ } from "bun";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const rev = process.argv[2];
if (!rev) throw new Error("usage: bun scripts/ab-commit.ts <rev> [rounds]");
const rounds = process.argv[3] ?? "3";
const here = process.cwd();
const repo = existsSync(join(here, ".git")) ? here : (process.env.KERR_AB_REPO ?? join(homedir(), "Documents/DEV/black-hole-gpu"));
const dir = `/tmp/kerr-ab-${rev.slice(0, 12)}`;
const out = process.env.AB_OUT ?? `remote-results/${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}-ab-${rev.slice(0, 8)}`;

await $`git -C ${repo} fetch -q origin`.nothrow();
if (existsSync(dir)) await $`git -C ${repo} worktree remove --force ${dir}`.nothrow();
rmSync(dir, { recursive: true, force: true });
// (git-lfs maybe not installed there: its filters off — the LFS files' pointers left, this tree's assets used)
const noLfs = ["-c", "filter.lfs.process=", "-c", "filter.lfs.smudge=cat", "-c", "filter.lfs.clean=cat", "-c", "filter.lfs.required=false"];
await $`git -C ${repo} ${noLfs} -c core.hooksPath=/dev/null worktree add --quiet --force --detach ${dir} ${rev}`.env({
  ...process.env,
  GIT_LFS_SKIP_SMUDGE: "1",
});
// (this tree's node_modules and assets: the commit's own reference a subset of them)
rmSync(join(dir, "node_modules"), { recursive: true, force: true });
symlinkSync(join(here, "node_modules"), join(dir, "node_modules"));
rmSync(join(dir, "assets"), { recursive: true, force: true });
symlinkSync(join(here, "assets"), join(dir, "assets"));
if (existsSync(join(here, ".env"))) symlinkSync(join(here, ".env"), join(dir, ".env"));
// (its dev server's own folders, not in the repository: the rooms' database's)
for (const d of [dir, here]) mkdirSync(join(d, "snapshots"), { recursive: true });

mkdirSync(out, { recursive: true });
// (each server's output kept beside the results: a side that does not start says why)
const serve = (cwd: string, port: number) =>
  Bun.spawn(["bun", "server.ts"], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdout: Bun.file(join(out, `server-${port}.log`)),
    stderr: Bun.file(join(out, `server-${port}.err`)),
  });
const ready = async (port: number) => {
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`http://localhost:${port}/`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await Bun.sleep(500);
  }
  throw new Error(`the server on ${port} did not answer`);
};
const A = serve(dir, 3101);
const B = serve(here, 3102);
try {
  await ready(3101);
  await ready(3102);
  // (each side's bundle built once before the runs: a dev server builds it at its first request)
  for (const p of [3101, 3102]) await fetch(`http://localhost:${p}/`).then((r) => r.text());
  // (AB_DRY=1: the two sides served and answering — no measure)
  if (process.env.AB_DRY !== "1")
    await $`bun scripts/ab-pages.ts`.env({
      ...process.env,
      AB_MAIN_URL: "http://localhost:3101/",
      AB_TEST_URL: "http://localhost:3102/",
      AB_ROUNDS: rounds,
      AB_OUT: out,
    });
} finally {
  A.kill();
  B.kill();
  await $`git -C ${repo} worktree remove --force ${dir}`.nothrow();
}
console.log(`A/B ${rev} (A) against this tree (B): ${out}/ab-report.json`);
