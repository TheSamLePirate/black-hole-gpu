import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The boot's timeline (PLAN-TITRE-AAA E0), read from __bh.boot(): each run a fresh Chrome profile (cold: no
// shader cache) then the same page loaded again (warm) — when each stage was reached, the first image, and how
// long the main thread was busy before it (the long tasks, the gaps between animation frames: what a menu or an
// animation on that thread would have suffered). RUNS=<n> (3), OUT=<file.json> to keep the figures.
// Then #slowboot=10: the graphics held 10 s more, the title still there.

const RUNS = Number(process.env.RUNS ?? 3);

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

  // (NET=<Mbit/s>: the page loaded again with the browser's cache off and the network throttled — the
  // downloads (the bundle, DE440, the sky, the stars) as a player's first visit over that link)
  test.skipIf(!process.env.NET)(
    "a first visit over a slow link",
    async () => {
      const mbit = Number(process.env.NET);
      app = await App.boot({ telemetry: false });
      await app.cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await app.cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 40,
        downloadThroughput: (mbit * 1e6) / 8,
        uploadThroughput: (mbit * 1e6) / 8 / 4,
      });
      await app.js(
        "(Object.keys(localStorage).filter((k) => k.includes('kerr.autosave')).forEach((k) => localStorage.removeItem(k)), true)",
      );
      await app.load("");
      const r = await app.js<Report>("__bh.boot()");
      console.log(line(`${mbit} Mbit/s`, r));
      console.log(`  stages: ${r.marks.map((m) => `${m.name} ${m.t}`).join(" · ")}`);
      app.close();
      app = undefined;
    },
    600_000,
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
