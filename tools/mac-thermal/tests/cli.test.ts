import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
// (four bun starts in a row: more than 5 s on a loaded Mac)
setDefaultTimeout(30_000);
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sample } from "./fixtures.ts";
const directory = mkdtempSync(join(tmpdir(), "mac-thermal-cli-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const entry = resolve(import.meta.dir, "../mac-thermal.ts");
async function cli(args: string[]) {
  // (env passed explicitly: under bun test in a tree with a .env, an inherited environment left the child silent)
  const child = Bun.spawn([process.execPath, entry, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { data: JSON.parse(out), out, err, code };
}

test("LLM discovery commands emit one JSON document without ANSI or stderr", async () => {
  for (const command of ["help", "catalog", "schema", "version"]) {
    const r = await cli([command]);
    expect(r.code).toBe(0); expect(r.err).toBe(""); expect(r.out.includes("\x1b")).toBe(false);
    expect(r.data.schemaVersion).toBe("2.0.0");
  }
});
test("invalid arguments fail before sampling and use stable JSON errors", async () => {
  for (const args of [["snapshot", "--interval", "1000;id"], ["snapshot", "--password", "secret"],
    ["snapshot", "--interval", "0"], ["doctor", "--authenticate"], ["compare"], ["does-not-exist"]]) {
    const r = await cli(args);
    expect(r.code).toBe(2); expect(r.data.kind).toBe("error"); expect(r.err).toBe("");
  }
});
test("offline analysis, comparison, selection and latest need no root access", async () => {
  const p = join(directory, "snapshot.json");
  writeFileSync(p, JSON.stringify(sample(Date.now())));
  const a = await cli(["analyze", p, "--metrics", "gpu.temperature_c"]);
  expect(a.data.report.sampleCount).toBe(1); expect(Object.keys(a.data.report.metrics)).toEqual(["gpu.temperature_c"]);
  const b = await cli(["compare", p, p, "--same-workload"]);
  expect(b.data.metrics["gpu.temperature_c"].delta).toBe(0);
  const c = await cli(["latest", p, "--max-age", "60", "--metrics", "gpu.*"]);
  expect(c.data.freshness.stale).toBe(false); expect(c.data.selection.length).toBeGreaterThan(0);
});
test("stale snapshots have a distinct nonzero exit code and actionable error", async () => {
  const p = join(directory, "old.json");
  writeFileSync(p, JSON.stringify(sample(Date.now() - 60000)));
  const r = await cli(["latest", p]);
  expect(r.code).toBe(6); expect(r.data.error.code).toBe("STALE_SNAPSHOT");
});
