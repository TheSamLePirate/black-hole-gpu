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
  const spans = procs.map((p) => JSON.parse(readFileSync(join(out, `${p.pid}.json`), "utf8")) as [number, number]).sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < spans.length; k++) expect(spans[k]![0]).toBeGreaterThanOrEqual(spans[k - 1]![1]);
}, 30_000);

test("a holder whose process is gone is cleared", async () => {
  const home = mkdtempSync(join(tmpdir(), "kerr-lock-"));
  const out = mkdtempSync(join(tmpdir(), "kerr-lock-out-"));
  // (a lock left by a process that no longer exists)
  mkdirSync(join(home, ".kerr-lab", "chrome.lock"), { recursive: true });
  writeFileSync(join(home, ".kerr-lab", "chrome.lock", "owner.json"), JSON.stringify({ pid: 999_999, label: "gone", cwd: "", host: "", since: 0 }));
  const file = join(out, "holder.ts");
  writeFileSync(file, holderScript(out));
  const p = Bun.spawn(["bun", file], { env: { ...process.env, HOME: home }, stderr: "inherit" });
  expect(await p.exited).toBe(0);
}, 30_000);
