import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { SHOW } from "./lib/cdp";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q6 I7 — the cadence as the display presents it (docs/PLAN-REFRACTION-HORIZONS.md Q6: "la cadence réglée sur la
// présentation"): a frame shown for one refresh then for two — 16.7 then 33.3 ms at 60 Hz, 8.3/16.7/25 at 120 Hz — judders
// more than a steady slower one. In a **visible window** (headless Chrome follows no display: its frames keep no vsync — the
// test says so and stops): the F-35 low over Tarifa on its autopilot and autothrottle, in real time, the tiles in; for each
// cap (CAPS: settings.fpsCap — 0, 60, 30), MEASURE_S seconds of the page's frames: each requestAnimationFrame callback's time
// and whether a new image was finished since (renderer.completedFrames) — the intervals between new images: their median,
// 95th percentile, the share within a quarter refresh of the median (steady), the judder (consecutive intervals more than
// half a refresh apart); the display's refresh (renderer.refreshMs).
// Output: remote-results/cadence/cadence.json (CAD_OUT).
// Done when: every cap measured, no GPU error.
// Duration: ~2 min on kerr-mini (the tiles, 3 × 15 s).
const OUT = process.env.CAD_OUT ?? "remote-results/cadence";
const CAPS = (process.env.CAPS ?? "0,60,30").split(",").map(Number);
const MEASURE_S = Number(process.env.MEASURE_S ?? 15);

describe.skipIf(!E2E)("Q6 I7: the cadence as the display presents it", () => {
  let app: App;
  const rows: Record<string, unknown>[] = [];
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.flyAt(36.08, -5.6, 700, 20, 200);
      __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
      const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); return 1; })()`);
    await app.waitOptional(`__bh.renderer.earthTiles.pending === 0`, 90_000);
    await app.settled(60_000);
  }, 300_000);
  afterAll(async () => {
    await Bun.write(`${OUT}/cadence.json`, JSON.stringify(rows, null, 2));
    await app?.close();
    stopServer();
  });

  for (const cap of CAPS)
    test(`cap ${cap}`, async () => {
      if (SHOW === "headless") {
        console.log("  cadence: headless Chrome keeps no vsync — run it in a window (~/.kerr-lab/config.json chrome: window)");
        return;
      }
      const r = await app.js<{
        refreshMs: number;
        n: number;
        median: number;
        p95: number;
        steady: number;
        judder: number;
        fps: number;
        hist: Record<string, number>;
      }>(`(async () => {
        const R = __bh.renderer; __bh.settings.fpsCap = ${cap}; __bh.touch();
        for (let i = 0; i < 60; i++) await new Promise((q) => requestAnimationFrame(q));
        const times = []; let last = R.completedFrames ?? 0; const t0 = performance.now();
        await new Promise((done) => { const f = (t) => { const c = R.completedFrames ?? 0; if (c !== last) { last = c; times.push(t); }
          if (t - t0 < ${MEASURE_S * 1000}) requestAnimationFrame(f); else done(1); }; requestAnimationFrame(f); });
        const iv = []; for (let i = 1; i < times.length; i++) iv.push(times[i] - times[i - 1]);
        const s = [...iv].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
        const med = q(0.5), rf = R.refreshMs || 16.7;
        const steady = iv.filter((x) => Math.abs(x - med) < 0.25 * rf).length / Math.max(iv.length, 1);
        let jud = 0; for (let i = 1; i < iv.length; i++) if (Math.abs(iv[i] - iv[i - 1]) > 0.5 * rf) jud++;
        const hist = {}; for (const x of iv) { const k = Math.round(x / rf); hist[k] = (hist[k] ?? 0) + 1; }
        __bh.settings.fpsCap = 0;
        return { refreshMs: +rf.toFixed(2), n: iv.length, median: +med.toFixed(2), p95: +q(0.95).toFixed(2), steady: +steady.toFixed(3),
          judder: +(jud / Math.max(iv.length - 1, 1)).toFixed(3), fps: +(iv.length / ${MEASURE_S}).toFixed(1), hist }; })()`);
      const row = { cap, ...r, gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`) };
      rows.push(row);
      console.log(JSON.stringify(row));
      expect(row.gpuErrors).toBe(0);
    }, 120_000);
});
