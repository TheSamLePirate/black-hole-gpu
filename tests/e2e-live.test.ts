// The e2e's live state (tests/e2e/lib/live.ts): what a running e2e tells the lab's monitor and the dashboard —
// written, read back, a dead process's file swept, a picture asked for and delivered.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "e2e-live-"));
process.env.KERR_LIVE_DIR = join(home, ".kerr-lab", "live");
const { LIVE_DIR, LiveState, craftOf, liveE2e } = await import("./e2e/lib/live");
afterAll(() => rmSync(home, { recursive: true, force: true }));

test("the live state lives where KERR_LIVE_DIR says (~/.kerr-lab/live otherwise)", () => {
  expect(LIVE_DIR).toBe(join(home, ".kerr-lab", "live"));
});

test("a sample's craft: the figures a watcher reads, absent ones null", () => {
  const c = craftOf({
    vessel: "f35",
    label: "climb",
    alt: 3.2,
    v: 210.5,
    auto: "alt",
    hub: { title: "Climb", phase: "level-off" },
    geo: { body: "earth", lat: 48.85, lon: 2.35, altM: 3200 },
    att: { pitch: 8, bank: -2, hdg: 271 },
    air: { mach: 0.62, g: 1.1, h: 3150 },
    perf: { gpuFrameMs: 9.4, renderScale: 1, quality: "high" },
  });
  expect(c).toMatchObject({
    vessel: "f35",
    label: "climb",
    body: "earth",
    altKm: 3.2,
    aglM: 3150,
    v: 210.5,
    hub: "Climb",
    phase: "level-off",
  });
  expect(c?.gpuMs).toBe(9.4);
  expect(c?.entry).toBeNull();
  expect(craftOf(null)).toBeNull();
});

test("written and read back: file, test, series, ended tests, moments", () => {
  const L = new LiveState();
  L.file("tests/e2e/demo.e2e.test.ts", "demo", 3, join(home, "reports"));
  L.test(1, "takes off", join(home, "reports/demo/01"));
  L.drained(
    [
      { alt: 0.1, v: 80 },
      { alt: 0.3, v: 95 },
    ],
    [[1, 58, 21]],
    [{ kind: "phase", text: "auto: null → climb" }],
  );
  L.ended(1, "takes off", 12.5);
  L.write();
  const all = liveE2e((pid) => pid === process.pid);
  expect(all.length).toBe(1);
  const e = all[0]!;
  expect(e).toMatchObject({ kind: "e2e", pid: process.pid, file: "tests/e2e/demo.e2e.test.ts", n: 3, k: 1, test: "takes off", fps: 58 });
  expect(e.craft?.altKm).toBe(0.3);
  expect(e.series.length).toBeGreaterThan(0);
  expect(e.done).toEqual([{ k: 1, test: "takes off", wallS: 12.5 }]);
  expect(e.events[0]?.text).toContain("climb");
  L.remove();
  expect(liveE2e(() => true)).toEqual([]);
});

test("a dead process's files swept by the reader", () => {
  const dead = join(LIVE_DIR, "e2e-999999.json");
  writeFileSync(dead, JSON.stringify({ kind: "e2e", pid: 999999 }));
  writeFileSync(join(LIVE_DIR, "e2e-999999.jpg"), "x");
  expect(liveE2e(() => false)).toEqual([]);
  expect(existsSync(dead)).toBe(false);
  expect(existsSync(join(LIVE_DIR, "e2e-999999.jpg"))).toBe(false);
});

test("a peek: asked by a file, consumed once, the picture written beside the state", () => {
  const L = new LiveState();
  L.file("x.e2e.test.ts", "", 1, home);
  L.write();
  expect(L.peekWanted()).toBe(false);
  writeFileSync(join(LIVE_DIR, `e2e-${process.pid}.peek`), "");
  expect(L.peekWanted()).toBe(true);
  expect(L.peekWanted()).toBe(false);
  L.peeked(Buffer.from([0xff, 0xd8, 0xff]));
  L.write();
  const e = liveE2e(() => true)[0]!;
  expect(e.shot?.path).toBe(join(LIVE_DIR, `e2e-${process.pid}.jpg`));
  expect(existsSync(e.shot!.path)).toBe(true);
  L.remove();
});

test("the series starts again at a leap no flight makes (a scene loaded), not at a climb", () => {
  const L = new LiveState();
  L.file("y.e2e.test.ts", "", 1, home);
  L.test(1, "t", home);
  L.drained([{ alt: 16296, v: 7500 }], [], []);
  L.drained([{ alt: 0.1, v: 0 }], [], []);
  L.drained([{ alt: 0.3, v: 80 }], [], []);
  L.write();
  const e = liveE2e(() => true).find((x) => x.file === "y.e2e.test.ts")!;
  expect(e.series.map((p) => p[1])).not.toContain(16296);
  expect(e.series.at(-1)?.[1]).toBe(0.3);
  L.remove();
});
