// (a measuring campaign, not in `bun run e2e`: RASTER_BENCH=1 to run it — as scenery-bench)
// Frame rates in flight (docs/PLAN-RENDU-RASTER-AAA.md): the F-35 flown — the clock running, the autopilot holding its
// height, course and speed — over a few places, the details at their most, and for each realtime setting (the traced
// pipeline at ×2 … ×8 and auto; the raster pipeline, its sky at ×2/×4/×6, its surfaces shaded every pixel, one in two, one in
// four) the images finished per second, the browser's frames per second, the GPU's mean time and the 95th percentile of the
// frames' intervals. Not a pass/fail test: remote-results/perf-fps.json. PERF_PLACES, PERF_SECONDS (8), PERF_CONFIGS (all).
import { afterAll, beforeAll, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const PLACES: Record<string, string> = {
  "tarifa-low": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  "tarifa-cumulus": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  "porto-sea": `__bh.game.setDate("2026-07-10T17:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.4);
    __bh.game.flyAt(42.26, 8.58, 500, 80, 220);`,
};
const raster = (sub: number, shading: string) =>
  `Object.assign(__bh.settings, { earthPipeline: "raster", earthRasterShading: "${shading}" }); __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", ${sub});`;
const trace = (sub: number | string) =>
  `Object.assign(__bh.settings, { earthPipeline: "trace" }); __bh.game.set("realtimeSubsampling", ${JSON.stringify(sub)});`;
const CONFIGS: Record<string, string> = {
  "trace x2": trace(2),
  "trace x3": trace(3),
  "trace x4": trace(4),
  "trace x6": trace(6),
  "trace x8": trace(8),
  "trace auto": trace("auto"),
  "raster sky x2 quarter": raster(2, "quarter"),
  "raster sky x4 quarter": raster(4, "quarter"),
  "raster sky x6 quarter": raster(6, "quarter"),
  "raster sky x4 half": raster(4, "half"),
  "raster sky x4 every": raster(4, "every"),
  // (the raster's defaults: its render scale, 75 %, and shading, a quarter)
  "raster defaults": `Object.assign(__bh.settings, { earthPipeline: "raster", earthRasterShading: "quarter", earthRasterScale: 0.75 }); __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4);`,
  "raster native eighth": `Object.assign(__bh.settings, { earthPipeline: "raster", earthRasterShading: "eighth", earthRasterScale: 1 }); __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4);`,
};
const places = (process.env.PERF_PLACES ?? Object.keys(PLACES).join(",")).split(",");
const configs = (process.env.PERF_CONFIGS ?? Object.keys(CONFIGS).join(",")).split(",");
const SECONDS = Number(process.env.PERF_SECONDS ?? 8);

let app: App;
const rows: Record<string, unknown>[] = [];
beforeAll(async () => {
  if (!E2E) return;
  app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
  await app.js(
    `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
  );
  await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
}, 300_000);
afterAll(async () => {
  if (E2E) await Bun.write("remote-results/perf-fps.json", JSON.stringify(rows, null, 2));
  app?.close();
  stopServer();
});

for (const pl of places)
  test.skipIf(!E2E || process.env.RASTER_BENCH !== "1")(
    `frame rates over ${pl}`,
    async () => {
      await app.js(`(() => { __bh.game.quality("realtime");
        Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 0, earthScenery: "high", detailReach: "veryFar",
          earthSceneryShadows: true, earthSurface: "satellite", shipMount: "cockpit" });
        ${PLACES[pl]}
        const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        return 1; })()`);
      // (the ground's tiles in before the first measure)
      await app.js(`(async () => { const r = __bh.renderer, t0 = performance.now(); let calm = 0;
        while (performance.now() - t0 < 90000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 3000) break; await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`);
      for (const cf of configs) {
        // (the craft put back where it was for each setting: the same view measured, not a drift)
        // (the height held: the craft's own once put there — not the last place's, which the autopilot climbed back to)
        await app.js(`(async () => { ${PLACES[pl]} ${CONFIGS[cf]} __bh.touch();
          for (let i = 0; i < 3; i++) await new Promise((q) => requestAnimationFrame(q));
          const c = __bh.camera, g = c.geoNow(); if (g) c.jetModes.alt = g.alt; return 1; })()`);
        await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
        // (settled: the new kernels in, the history refilled)
        await Bun.sleep(4000);
        const m = await app.js<Record<string, number>>(`(async () => { const r = __bh.renderer;
          const t0 = performance.now(); let raf = 0, done = 0, last = r.lastDoneAt, gpu = 0, prev = t0; const iv = [];
          while (performance.now() - t0 < ${SECONDS * 1000}) { await new Promise((q) => requestAnimationFrame(q)); const now = performance.now();
            iv.push(now - prev); prev = now; raf++; if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; gpu += r.lastGpuMs; } }
          const s = (performance.now() - t0) / 1000; iv.sort((a, b) => a - b);
          const g = __bh.camera.geoNow();
          return { fps: +(done / s).toFixed(1), rafFps: +(raf / s).toFixed(1), gpuMs: +(gpu / Math.max(done, 1)).toFixed(1),
            p95Ms: +iv[Math.floor(iv.length * 0.95)].toFixed(1), alt: g ? Math.round(g.alt) : null, renderW: r.live.width }; })()`);
        const row = { place: pl, config: cf, ...m };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
    },
    1_800_000,
  );
