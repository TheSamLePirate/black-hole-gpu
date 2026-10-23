// The raster pipeline as the default near the Earth, governed (the audit of 2026-10-23 — docs/progress/raster-aaa/ETAPE-1.md):
// the F-35 flown over the Alps in its cockpit with the settings as they come, the raster drawing the ground; the automatic
// quality not held by it (the calibration settles — it never did while the raster was on); its shading rate chosen by the
// renderer; the fallback to the traced pipeline and back by the setting; the Earth rendering's rows on the player's
// Graphics tab. Then the Moon's shadow from orbit: the physical sky light carried to each point by its eclipse — the
// umbra as dark with it as with the old model (it was lit by the camera's day sky).
// Captures remote-results/rg-*.png; figures remote-results/raster-governor.json.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

afterAll(stopServer);

/** the darkest 48 × 48 block's mean luminance (0–255) under the toolbar, and the image's mean */
function darkest(file: string) {
  const p = readPng(new Uint8Array(require("node:fs").readFileSync(file)));
  const B = 48;
  let min = 255,
    sum = 0,
    n = 0;
  for (let by = 64; by + B <= p.height; by += B)
    for (let bx = 0; bx + B <= p.width; bx += B) {
      let s = 0;
      for (let y = by; y < by + B; y++)
        for (let x = bx; x < bx + B; x++) {
          const i = (y * p.width + x) * p.channels;
          s += 0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!;
        }
      const m = s / (B * B);
      // (a block of space or of the night side, black either way, says nothing: the day side's darkest)
      if (m > 3) min = Math.min(min, m);
      sum += m;
      n++;
    }
  return { min: +min.toFixed(2), mean: +(sum / n).toFixed(2) };
}

test.skipIf(!E2E)(
  "the raster pipeline by default: governed, its rate automatic, the traced one at hand, the eclipse kept",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 1280, height: 800, tiles: true });
    const out: Record<string, unknown> = {};
    try {
      // (the defaults themselves: the raster, its shading automatic, the scenery high and very far)
      const defaults = await app.js<Record<string, unknown>>(
        `(() => ({ pipeline: __bh.settings.earthPipeline, shading: __bh.settings.earthRasterShading, scale: __bh.settings.earthRasterScale,
          scenery: __bh.settings.earthScenery, reach: __bh.settings.detailReach, tier: __bh.renderer.tier.level }))()`,
      );
      out.defaults = defaults;
      expect(defaults.pipeline).toBe("raster");
      expect(defaults.shading).toBe("auto");
      // (the Alps first: the relief seen in the F-35's cockpit, the clock running)
      await app.js(`(() => { __bh.game.setDate("2026-07-10T09:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.2);
        __bh.game.flyAt(45.92, 6.87, 1800, 60, 180); return 1; })()`);
      await app.waitFor("__bh.renderer.tracerSettled", 300_000);
      await app.waitFor("__bh.renderer.earthTiles.pending === 0", 120_000).catch(() => {});
      await app.waitFor(
        `__bh.renderer.rasterPrimaryNow && __bh.renderer.terrainRasterStats.reason === "pilot" && __bh.renderer.terrainRasterStats.encodedFrames > 30`,
        300_000,
      );
      // (governed: no diagnostic hold — the calibration settles, the automatic block and scale at work)
      expect(await app.js<boolean>("__bh.renderer.terrainRasterInspecting")).toBe(false);
      await app.waitFor("__bh.renderer.calibrationReady", 180_000);
      const w0 = await app.js<number>("__bh.renderer.completedFrames");
      await app.waitFor(`__bh.renderer.completedFrames >= ${w0 + 240}`, 180_000);
      const live = await app.js<Record<string, unknown>>(
        `(() => ({ rate: __bh.renderer.terrainRasterStats.rate, block: __bh.renderer.realtimeBlockNow,
          gpuMs: __bh.renderer.lastGpuMs, clouds: __bh.renderer.cloudPassStats, calibrated: __bh.renderer.calibrationReady,
          fellBack: __bh.renderer.rasterFellBack }))()`,
      );
      out.alps = live;
      expect([2, 4, 8, 16]).toContain(live.rate as number);
      expect(live.fellBack).toBe(false);
      await app.shot("remote-results/rg-alps-raster.png");
      // (the fallback: the traced pipeline drawn; the setting chosen again, the raster back)
      await app.js("(() => { __bh.renderer.rasterFellBack = true; __bh.touch(); return 1; })()");
      await app.waitFor("!__bh.renderer.rasterPrimaryNow", 60_000);
      const w1 = await app.js<number>("__bh.renderer.completedFrames");
      await app.waitFor(`__bh.renderer.completedFrames >= ${w1 + 60}`, 120_000);
      expect(await app.js<boolean>("__bh.renderer.rasterPrimaryNow")).toBe(false);
      await app.shot("remote-results/rg-alps-fellback.png");
      await app.js(`(() => { __bh.game.set("earthPipeline", "raster"); return 1; })()`);
      expect(await app.js<boolean>("__bh.renderer.rasterFellBack")).toBe(false);
      await app.waitFor("__bh.renderer.rasterPrimaryNow", 120_000);
      // (the traced pipeline by the player's choice, then the raster again)
      await app.js(`(() => { __bh.game.set("earthPipeline", "trace"); return 1; })()`);
      await app.waitFor("!__bh.renderer.rasterPrimaryNow", 60_000);
      const w2 = await app.js<number>("__bh.renderer.completedFrames");
      await app.waitFor(`__bh.renderer.completedFrames >= ${w2 + 60}`, 120_000);
      await app.shot("remote-results/rg-alps-traced.png");
      await app.js(`(() => { __bh.game.set("earthPipeline", "raster"); __bh.game.set("earthRasterShading", "quarter"); return 1; })()`);
      await app.waitFor("__bh.renderer.rasterPrimaryNow && __bh.renderer.terrainRasterStats.rate === 4", 120_000);
      await app.js(`(() => { __bh.game.set("earthRasterShading", "auto"); return 1; })()`);
      out.gpuErrors = await app.js<number>("__bh.renderer.gpuErrors");
      expect(out.gpuErrors).toBe(0);

      // (the Moon's shadow from 3 000 km: the physical sky light — skyAmbientOn — against the old model; with the eclipse
      // carried to each point the darkest of the day side alike)
      await app.js(`(() => { __bh.preset("Earth: the Moon's shadow from orbit, 12 Aug 2026"); __bh.resize(); return 1; })()`);
      await app.waitFor("__bh.renderer.tracerSettled", 300_000);
      const shadow: Record<string, { min: number; mean: number }> = {};
      for (const on of [true, false]) {
        await app.js(`(() => { __bh.renderer.skyAmbientOn = ${on}; __bh.renderer.invalidate(); __bh.touch(); return 1; })()`);
        const w = await app.js<number>("__bh.renderer.completedFrames");
        await app.waitFor(`__bh.renderer.completedFrames >= ${w + 90}`, 180_000);
        const f = `remote-results/rg-moon-shadow-${on ? "physical" : "old"}.png`;
        await app.shot(f);
        shadow[on ? "physical" : "old"] = darkest(f);
      }
      out.moonShadow = shadow;
      // (the physical sky's umbra no more than a little brighter than the old model's — before the fix it took the camera's
      // day sky)
      expect(shadow.physical!.min).toBeLessThan(Math.max(2 * shadow.old!.min, shadow.old!.min + 6));
    } finally {
      await Bun.write("remote-results/raster-governor.json", JSON.stringify(out, null, 2));
      console.log(JSON.stringify(out));
      await app.close();
    }
  },
  1_800_000,
);
