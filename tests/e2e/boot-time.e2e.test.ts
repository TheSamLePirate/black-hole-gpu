import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The boot's timeline (PLAN-TITRE-AAA E0), read from __bh.boot(): each run a fresh Chrome profile (cold: no
// shader cache) then the same page loaded again (warm) — when each stage was reached, the first image, and how
// long the main thread was busy before it (the long tasks, the gaps between animation frames: what a menu or an
// animation on that thread would have suffered). RUNS=<n> (3), OUT=<file.json> to keep the figures.
// Then #slowboot=10: the graphics held 10 s more, the title still there.

const RUNS = Number(process.env.RUNS ?? 3);
const FIRST = process.env.FIRST === "1";
const CLEAR_SAVE = `try { for (const k of Object.keys(localStorage)) if (k.includes("kerr.autosave")) localStorage.removeItem(k); } catch {}`;

interface Report {
  marks: { name: string; t: number }[];
  firstImage: number | null;
  long: { count: number; totalMs: number; maxMs: number; list: [number, number][] };
  gaps: { count: number; maxMs: number; list: [number, number][] };
  blockedMs: number;
  blockedShare: number;
}

const at = (r: Report, name: string) => r.marks.find((m) => m.name === name)?.t ?? null;
const line = (label: string, r: Report) => {
  const big = r.long.list
    .filter(([, d]) => d >= 100)
    .map(([s, d]) => `${(s / 1000).toFixed(1)}s:${d}`)
    .join(" ");
  return `  ${label.padEnd(9)} renderer ${at(r, "renderer")} · title ${at(r, "title")} · first image ${r.firstImage} · lifted ${at(r, "splash-lifted")} ms | long ${r.long.count} (Σ ${r.long.totalMs}, max ${r.long.maxMs}) · blocked before the image ${r.blockedMs} ms (${(100 * r.blockedShare).toFixed(0)} %) · worst frame gap ${r.gaps.maxMs} ms | ≥100 ms: ${big}`;
};

describe.skipIf(!E2E)("the boot's timeline", () => {
  let app: App | undefined;
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("cold and warm starts", async () => {
    const out: { cold: Report; warm: Report }[] = [];
    for (let i = 0; i < RUNS; i++) {
      app = await App.boot({ telemetry: false });
      const cold = await app.js<Report>("__bh.boot()");
      // (the same page again: the browser's shader cache warm; no flight saved behind the title)
      await app.js(
        "(Object.keys(localStorage).filter((k) => k.includes('kerr.autosave')).forEach((k) => localStorage.removeItem(k)), true)",
      );
      await app.load("");
      const warm = await app.js<Report>("__bh.boot()");
      app.close();
      app = undefined;
      out.push({ cold, warm });
      console.log(line(`#${i + 1} cold`, cold));
      console.log(line(`#${i + 1} warm`, warm));
    }
    const marks = out[0]!.cold.marks.map((m) => `${m.name} ${m.t}`).join(" · ");
    console.log(`  stages (#1 cold): ${marks}`);
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    for (const k of ["cold", "warm"] as const)
      console.log(
        `  median ${k}: first image ${med(out.map((o) => o[k].firstImage ?? 0))} ms · blocked ${med(out.map((o) => o[k].blockedMs))} ms · worst gap ${med(out.map((o) => o[k].gaps.maxMs))} ms`,
      );
    if (process.env.OUT) await Bun.write(process.env.OUT, JSON.stringify(out, null, 1));
    expect(out.every((o) => o.cold.firstImage && o.warm.firstImage)).toBe(true);
  }, 1_200_000);

  // (NET=<Mbit/s>: a first visit over that link — each run its own Chrome (nothing left in flight by the run before
  // on the throttled link), the page booted once then loaded again with the cache off and the link throttled. The
  // downloads that began before the splash lifted, by size: who shares the link with what the scene needs first)
  test.skipIf(!process.env.NET)(
    "a first visit over a slow link",
    async () => {
      const mbit = Number(process.env.NET);
      const runs: Report[] = [];
      for (let i = 0; i < RUNS; i++) {
        // (FIRST=1: a first visitor — no flight saved, cleared before the page's scripts at each load; else a
        // returning player's, the boot's own autosave behind the title)
        app = await App.boot({ telemetry: false, initScript: FIRST ? CLEAR_SAVE : undefined });
        await app.cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await app.cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 40,
          downloadThroughput: (mbit * 1e6) / 8,
          uploadThroughput: (mbit * 1e6) / 8 / 4,
        });
        await app.load("");
        const r = await app.js<Report>("__bh.boot()");
        runs.push(r);
        console.log(line(`${mbit} Mbit/s`, r));
        console.log(`  stages: ${r.marks.map((m) => `${m.name} ${m.t}`).join(" · ")}`);
        if (i === 0) {
          const big = await app.js<[string, number, number, number][]>(`performance.getEntriesByType("resource")
            .filter((e) => e.startTime < (__bh.boot().marks.find((m) => m.name === "splash-lifted")?.t ?? 1e9) && e.encodedBodySize > 100000)
            .sort((a, b) => b.encodedBodySize - a.encodedBodySize)
            .map((e) => [e.name.replace(location.origin, "").split("?")[0], Math.round(e.encodedBodySize / 1024), Math.round(e.startTime), Math.round(e.responseEnd)])`);
          console.log(
            `  before the splash lifted (KB, start → end ms):\n${big.map(([n, kb, s, e]) => `    ${n} ${kb} KB ${s} → ${e}`).join("\n")}`,
          );
        }
        app.close();
        app = undefined;
      }
      const med = (f: (r: Report) => number | null) => runs.map((r) => f(r) ?? 0).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
      console.log(
        `  median at ${mbit} Mbit/s, ${FIRST ? "first visit" : "a flight saved"}: main ${med((r) => at(r, "main"))} · ephemerides ${med((r) => at(r, "ephemerides"))} · title ${med((r) => at(r, "title"))} · first image ${med((r) => r.firstImage)} · sky done ${med((r) => at(r, "sky done"))} · stars done ${med((r) => at(r, "stars done"))} · lifted ${med((r) => at(r, "splash-lifted"))} ms`,
      );
      if (process.env.OUT) await Bun.write(process.env.OUT, JSON.stringify(runs, null, 1));
    },
    900_000,
  );

  test("#slowboot=10: the graphics held 10 s, the game still starts", async () => {
    app = await App.boot({ hash: "slowboot=10", telemetry: false });
    const r = await app.js<Report>("__bh.boot()");
    console.log(line("slowboot", r));
    expect(at(r, "renderer")!).toBeGreaterThan(10_000);
    expect(r.firstImage!).toBeGreaterThan(10_000);
    // (the flag taken out of the address: the title opened as with no link)
    expect(await app.js<string>("location.hash")).toBe("");
    expect(at(r, "title")).not.toBeNull();
  }, 300_000);
});
