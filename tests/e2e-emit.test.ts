// The e2e emitter (tests/e2e/lib/emit.ts): one JSON line per fact, in order, stamped with the file and the test;
// off on demand; silent when it cannot write; old files swept.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMIT_VERSION, Emitter } from "./e2e/lib/emit";

const lines = (path: string) =>
  readFileSync(path, "utf8")
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l));

describe("e2e emitter", () => {
  test("says the process first, then each fact with its file, its test and its order", () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-"));
    let t = 1000;
    const e = new Emitter(dir, false, () => t++);
    expect(e.target).toBeNull();
    e.at("x.e2e.test.ts", 1);
    e.say("step_started", { index: 2, total: 5, name: "zone" });
    e.at("x.e2e.test.ts", 2);
    e.say("step_ended", { index: 2, ok: false, text: "zone 15,1 min" });
    const L = lines(e.target as string);
    expect(L.map((l) => l.kind)).toEqual(["process", "step_started", "step_ended"]);
    expect(L.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(L.every((l) => l.v === EMIT_VERSION && l.pid === process.pid)).toBe(true);
    expect(L[0].data.cwd).toBe(process.cwd());
    expect(L[1]).toMatchObject({ file: "x.e2e.test.ts", k: 1, data: { index: 2, total: 5, name: "zone" } });
    expect(L[2]).toMatchObject({ k: 2, data: { ok: false } });
    expect(L[1].at).toBeLessThan(L[2].at);
  });

  test("off: nothing written, no file made", () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-"));
    const e = new Emitter(dir, true);
    e.say("scenario", { label: "a" });
    expect(e.target).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a folder it cannot write to: silent, and off from then on", () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-"));
    const blocked = join(dir, "a-file");
    writeFileSync(blocked, "");
    const e = new Emitter(join(blocked, "events"), false);
    expect(() => e.say("scenario", { label: "a" })).not.toThrow();
    expect(() => e.say("scenario", { label: "b" })).not.toThrow();
  });

  test("old files swept at the first line, the others and the strangers kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-"));
    const old = join(dir, "e2e-1-1.jsonl");
    const recent = join(dir, "e2e-2-2.jsonl");
    const stranger = join(dir, "notes.txt");
    for (const p of [old, recent, stranger]) writeFileSync(p, "");
    const longAgo = new Date(Date.now() - 20 * 86_400_000);
    utimesSync(old, longAgo, longAgo);
    utimesSync(stranger, longAgo, longAgo);
    new Emitter(dir, false).say("scenario", { label: "a" });
    const left = readdirSync(dir);
    expect(left).not.toContain("e2e-1-1.jsonl");
    expect(left).toContain("e2e-2-2.jsonl");
    expect(left).toContain("notes.txt");
  });

  test("the recorder says a test's steps, their results, its progress and its pictures (a process of its own)", () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-"));
    const code = `
      const { recorder } = await import("./tests/e2e/lib/telemetry");
      recorder.lightOn();
      recorder.steps(["boot", "zone"]);
      recorder.estimate(120);
      await recorder.step("zone");
      await recorder.progress("zone 3 / 9", "GPU p50 59 ms");
      await recorder.stepDone("zone 15,1 min", false);
      await recorder.scenario("SLCB 05");
      recorder.shot("out/a.png");
      await recorder.close("live");
    `;
    const r = Bun.spawnSync(["bun", "-e", code], {
      env: { ...process.env, KERR_EVENTS_DIR: join(dir, "events"), KERR_LIVE_DIR: join(dir, "live"), E2E_EMIT: "1" },
    });
    expect(r.exitCode).toBe(0);
    const files = readdirSync(join(dir, "events"));
    expect(files.length).toBe(1);
    const L = lines(join(dir, "events", files[0] as string));
    expect(L.map((l) => l.kind)).toEqual([
      "process",
      "step_declared",
      "estimate",
      "step_started",
      "progress",
      "step_ended",
      "scenario",
      "shot",
    ]);
    expect(L[1].data).toEqual({ total: 2, names: ["boot", "zone"] });
    expect(L[3].data).toEqual({ index: 2, total: 2, name: "zone" });
    expect(L[4].data).toEqual({ index: 2, text: "zone 3 / 9", values: "GPU p50 59 ms" });
    expect(L[5].data).toEqual({ index: 2, ok: false, text: "zone 15,1 min" });
    expect(L[6].data.label).toBe("SLCB 05");
    expect(L[7].data.path.endsWith("/out/a.png")).toBe(true);
  });

  test("E2E_EMIT=0: the recorder says nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-"));
    const code = `
      const { recorder } = await import("./tests/e2e/lib/telemetry");
      recorder.lightOn();
      await recorder.step("zone");
      await recorder.close("live");
    `;
    const r = Bun.spawnSync(["bun", "-e", code], {
      env: { ...process.env, KERR_EVENTS_DIR: join(dir, "events"), KERR_LIVE_DIR: join(dir, "live"), E2E_EMIT: "0" },
    });
    expect(r.exitCode).toBe(0);
    expect(readdirSync(dir)).not.toContain("events");
  });
});
