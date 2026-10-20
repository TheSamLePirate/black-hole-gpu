// How the raster's pixels find their scenery (docs/PLAN-RENDU-RASTER-AAA.md étape 1b): the F-35's frozen view at
// Tarifa (raster-flight.e2e.test.ts's place, the scenery high and very far), `earthPipeline: "raster"`, drawn with
// trace.wgsl TUNE_RASTER_PATHS — red: the tree the instance named, hit; blue: missed, the grid walked; green: no
// instance, no walk; white: the walk as before — and each colour's share of the image counted.
// Captures remote-results/raster-paths.png; prints the shares.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

afterAll(stopServer);

test.skipIf(!E2E)(
  "the raster's pixels: which way their scenery was found",
  async () => {
    const app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
      await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 0 });
        __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
        __bh.game.flyAt(36.08, -5.6, 700, 20, 240); __bh.settings.shipMount = "cockpit";
        Object.assign(__bh.settings, { earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true, earthSurface: "satellite" });
        __bh.settings.earthPipeline = "raster"; __bh.game.set("realtimeSubsampling", 4); __bh.settings.temporalReprojection = false;
        const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        c.jetModes.alt = c.last?.alt ?? c.jetModes.alt; return 1; })()`);
      await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
      await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let calm = 0;
        while (performance.now() - t0 < 120000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 4000) break; await frame(); }
        __bh.settings.animate = false;
        window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        __bh.renderer.tune = { TUNE_RASTER_PATHS: 1 }; const p = r.prof; p.enabled = true; p.every = 1; p.reset(); return 1; })()`);
      await app.waitFor(`(__bh.renderer.prof.table().find((p) => p.label === "earth shade (raster)")?.n ?? 0) >= 30`, 600_000);
      const stats = await app.js<Record<string, unknown>>("({ ...__bh.renderer.terrainRasterStats })");
      await app.shot("remote-results/raster-paths.png");
      const png = readPng(new Uint8Array(require("node:fs").readFileSync("remote-results/raster-paths.png")));
      const n = { red: 0, blue: 0, green: 0, white: 0, other: 0 };
      for (let y = 60; y < png.height; y++)
        for (let x = 0; x < png.width; x++) {
          const i = (y * png.width + x) * png.channels;
          const [r, g, b] = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
          const hi = Math.max(r, g, b);
          // (a pixel of the image: its colour's share of each path — the reconstruction and the tone map mix neighbours)
          if (hi < 40) {
            n.other++;
            continue;
          }
          const w = Math.min(r, g, b);
          n.white += w / hi;
          n.red += (r - w) / hi;
          n.green += (g - w) / hi;
          n.blue += (b - w) / hi;
        }
      const total = Object.values(n).reduce((a, b) => a + b, 0);
      console.log(
        JSON.stringify({
          shares: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, +(v / total).toFixed(3)])),
          scenery: stats.scenery,
        }),
      );
      expect(stats.error).toBeFalsy();
    } finally {
      await app.close();
    }
  },
  1_200_000,
);
