// The F-35's trail on the sea (docs/PLAN-NUAGES-AAA.md N6b — trace.wgsl seaCraftWake): flown fast at 15 m over the strait,
// the autopilot holding it there, seen from ahead and aside looking back at it (the fly-by view: its trail beside the line of sight, not hidden behind it) — its exhaust and downwash ruffling a lane of the water
// behind it, torn into spray. The image as drawn (remote-results/f35-sea-trail.png) and the wakes' debug view
// (TUNE_GSKIP 32768: their foam red, their ruffle green, their bubbles blue — f35-sea-trail-debug.png): there, the trail must
// show — enough of the water marked, drawn out in a lane.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

afterAll(stopServer);

test.skipIf(!E2E)(
  "the F-35 fast at 15 m over the sea leaves its trail on the water",
  async () => {
    const app = await App.boot({ width: 1280, height: 800, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
      await app.js(`(() => { __bh.game.quality("realtime");
        Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 0, earthPipeline: "raster", earthRasterShading: "quarter" });
        __bh.game.set("realtimeSubsampling", 4);
        __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.2);
        __bh.game.flyAt(35.99, -5.52, 15, 190, 150);
        const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        c.jetModes.alt = 15; c.jetModes.spd = 150; c.jetModes.hdg = 190 * Math.PI / 180;
        __bh.settings.shipMount = "flyby";
        window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return 1; })()`);
      // (the clock stopped ten frames after it is put there — still at its height and speed: the trail is drawn from them, no
      // history needed —; then the ground's tiles waited for)
      await app.js(
        `(async () => { for (let i = 0; i < 10; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.settings.animate = false; return 1; })()`,
      );
      await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
      await app.js(`(async () => { const r = __bh.renderer, t0 = performance.now(); let calm = 0;
        while (performance.now() - t0 < 120000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 3000) break; await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`);
      const g = await app.js<{ alt: number; gs: number } | null>(
        `(() => { const g = __bh.camera.geoNow(); return g && { alt: g.alt, gs: g.gs }; })()`,
      );
      const wake = await app.js<{ U: number; len: number }[]>("__bh.renderer.seaWakes.slice(0, 1)");
      console.log(`  the craft: ${JSON.stringify(g)}, its wake ${JSON.stringify(wake)}`);
      console.log(
        `  drawn at (camera axes) ${JSON.stringify(await app.js("__bh.renderer.ship.ready ? __bh.renderer.ship.shadowBound : 'not ready'"))}`,
      );
      // (low and fast: not on the water, not in the hover)
      expect(g!.gs).toBeGreaterThan(100);
      expect(g!.alt).toBeGreaterThan(5);
      expect(g!.alt).toBeLessThan(40);
      expect(wake[0]!.len).toBeGreaterThan(-1.05);
      const frames = (n: number) =>
        app.js(`(async () => { for (let i = 0; i < ${n}; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
      await app.waitFor(`__bh.renderer.terrainRasterStats.primary`, 300_000).catch(() => {});
      await app.js(`(() => { __bh.renderer.tune = {}; return 1; })()`);
      await frames(5);
      await app.waitFor(`(() => { const r = __bh.renderer, v = r.variants.get(r.featureKey); return !!(v && v.shade); })()`, 300_000);
      await frames(60);
      await app.shot("remote-results/f35-sea-trail.png");
      await app.js(`(() => { __bh.renderer.tune = { TUNE_GSKIP: 32768 }; return 1; })()`);
      await frames(5);
      await app.waitFor(`(() => { const r = __bh.renderer, v = r.variants.get(r.featureKey); return !!(v && v.shade); })()`, 300_000);
      await frames(60);
      await app.shot("remote-results/f35-sea-trail-debug.png");
      await app.js(`(() => { __bh.renderer.tune = {}; window.__t = false; return 1; })()`);
      // (the wakes' marks in the debug view: the water black but where a wake ruffles, foams or aerates it — a marked
      // pixel a coloured one, its green or red over its blue by half again, not the grey sky, hull or ground)
      const img = readPng(new Uint8Array(require("node:fs").readFileSync("remote-results/f35-sea-trail-debug.png")));
      let marked = 0;
      let x0 = img.width;
      let x1 = 0;
      for (let y = Math.floor(img.height * 0.45); y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * img.channels;
          const r = img.data[i]!,
            gr = img.data[i + 1]!,
            b = img.data[i + 2]!;
          if (Math.max(r, gr) > 25 && Math.max(r, gr) > 1.5 * b && Math.abs(r - gr) > 12) {
            marked++;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
          }
        }
      const spread = (x1 - x0) / img.width;
      console.log(`  the trail: ${marked} pixels marked over ${(spread * 100).toFixed(0)} % of the width`);
      // (a lane: enough water marked, drawn out across the view — not a speck under the craft)
      expect(marked).toBeGreaterThan(1500);
      expect(spread).toBeGreaterThan(0.1);
    } finally {
      await app.close();
    }
  },
  900_000,
);
