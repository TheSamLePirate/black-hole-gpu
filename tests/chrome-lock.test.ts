import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// One Chrome at a time on a machine (scripts/lib/chrome-lock.ts): processes that want it take turns —
// their holds never overlap —, and a holder whose process is gone does not block the others.

const holderScript = (out: string) => `
  import { chromeLock } from ${JSON.stringify(join(import.meta.dir, "../scripts/lib/chrome-lock"))};
  const release = await chromeLock("test " + process.pid);
  const t0 = Date.now(); await Bun.sleep(400); const t1 = Date.now();
  release();
  await Bun.write(${JSON.stringify(out)} + "/" + process.pid + ".json", JSON.stringify([t0, t1]));
`;

test("three processes wanting Chrome hold it one after the other", async () => {
  const home = mkdtempSync(join(tmpdir(), "kerr-lock-"));
  const out = mkdtempSync(join(tmpdir(), "kerr-lock-out-"));
  const file = join(out, "holder.ts");
  writeFileSync(file, holderScript(out));
  const procs = [0, 1, 2].map(() => Bun.spawn(["bun", file], { env: { ...process.env, HOME: home }, stderr: "inherit" }));
  for (const p of procs) expect(await p.exited).toBe(0);
  const spans = procs
    .map((p) => JSON.parse(readFileSync(join(out, `${p.pid}.json`), "utf8")) as [number, number])
    .sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < spans.length; k++) expect(spans[k]![0]).toBeGreaterThanOrEqual(spans[k - 1]![1]);
}, 30_000);

test("a holder whose process is gone is cleared", async () => {
  const home = mkdtempSync(join(tmpdir(), "kerr-lock-"));
  const out = mkdtempSync(join(tmpdir(), "kerr-lock-out-"));
  // (a lock left by a process that no longer exists)
  mkdirSync(join(home, ".kerr-lab", "chrome.lock"), { recursive: true });
  writeFileSync(
    join(home, ".kerr-lab", "chrome.lock", "owner.json"),
    JSON.stringify({ pid: 999_999, label: "gone", cwd: "", host: "", since: 0 }),
  );
  const file = join(out, "holder.ts");
  writeFileSync(file, holderScript(out));
  const p = Bun.spawn(["bun", file], { env: { ...process.env, HOME: home }, stderr: "inherit" });
  expect(await p.exited).toBe(0);
}, 30_000);

// (macOS only: an orphan is adopted by launchd, pid 1 — on Linux, by whatever subreaper the session has)
test.skipIf(process.platform !== "darwin")(
  "a test Chrome whose process died is found and ended — never the user's own Chrome",
  async () => {
    const { orphanChromes } = await import("../scripts/lib/chrome-lock");
    // (an orphan: a process named like a test Chrome — a DevTools port — whose parent exited, adopted by launchd;
    // its output let go — holding spawnSync's pipe, it kept the test waiting its whole minute of sleep)
    Bun.spawnSync([
      "bash",
      "-c",
      `(exec -a "Google Chrome" perl -e 'sleep 60' -- --remote-debugging-port=9999 --user-data-dir=/tmp/kerr-e2e-test >/dev/null 2>&1 &)`,
    ]);
    // (the user's Chrome: no DevTools port — left alone)
    Bun.spawnSync(["bash", "-c", `(exec -a "Google Chrome" perl -e 'sleep 60' -- --user-data-dir=/tmp/kerr-user-test >/dev/null 2>&1 &)`]);
    await Bun.sleep(300);
    const found = orphanChromes().filter((o) => o.profile === "/tmp/kerr-e2e-test");
    expect(found.length).toBe(1);
    expect(orphanChromes().some((o) => o.profile === "/tmp/kerr-user-test")).toBe(false);
    orphanChromes(true);
    await Bun.sleep(300);
    expect(orphanChromes().some((o) => o.profile === "/tmp/kerr-e2e-test")).toBe(false);
    Bun.spawnSync(["pkill", "-f", "kerr-user-test"]);
  },
);
