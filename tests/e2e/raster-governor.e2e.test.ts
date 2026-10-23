// The raster pipeline as the default near the Earth, governed (the audit of 2026-10-23 — docs/progress/raster-aaa/ETAPE-1.md).
// The F-35 flown over the Alps in its cockpit, the autopilot holding its height and speed, the settings as they come: the
// raster draws the ground, no diagnostic holds the automatic quality. Its budget squeezed (realtimeBudget 8 ms): the
// automatic shading rate goes coarser to one pixel in sixteen, then — still far over — the game falls back to the traced
// pipeline and says so; the setting chosen again, the raster back; a wide budget: the rate finer again. The traced pipeline
// by the player's choice, a fixed rate. Then the Moon's shadow from orbit: the physical sky light carried to each point by
// its eclipse — the umbra as dark with it as with the old model (it was lit by the camera's day sky).
// Every wait bounded, the renderer's state printed when one runs out. Captures remote-results/rg-*.png; figures
// remote-results/raster-governor.json.
// Duration: ~12 min on kerr-mini (the kernels' compiles 3–5 min of it).
// Done when: the Moon's shadow is captured twice (physical sky, old model) and its darkest compared.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

afterAll(stopServer);

/** the darkest 48 × 48 block's mean luminance (0–255) of the day side (blocks over 3) under the toolbar, and the image's mean */
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

/** the renderer's state, printed when a wait runs out */
const STATE = `(() => { const r = __bh.renderer, g = __bh.camera.geoNow?.(), v = r.variants?.get?.(r.featureKey);
  return { primary: r.rasterPrimaryNow, fellBack: r.rasterFellBack, inspecting: r.terrainRasterInspecting,
    raster: { ...r.terrainRasterStats, scenery: undefined }, block: r.realtimeBlockNow, gpuMs: r.lastGpuMs,
    tracerSettled: r.tracerSettled, kernelsSettled: r.kernelsSettled, variant: v && { rt: !!v.rt, shade: !!v.shade, mark: !!v.shadeMark, busy: v.busy, failed: v.failed },
    tiles: r.earthTiles.pending, vessel: __bh.fleet.active, geo: g && { alt: Math.round(g.alt), gs: Math.round(g.gs) }, gpuErrors: r.gpuErrors }; })()`;

test.skipIf(!E2E)(
  "the raster pipeline by default: governed, its rate automatic, the traced one at hand, the eclipse kept",
  async () => {
    const app = await App.boot({ width: 1280, height: 800, lang: "fr", hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    /** a wait that says where it stopped: the renderer's state in the error */
    const until = async (expr: string, ms: number, what: string) => {
      try {
        await app.waitFor(expr, ms);
      } catch {
        const st = await app.js(STATE).catch((e) => String(e));
        throw new Error(`${what}: not within ${ms / 1000} s — ${JSON.stringify(st)}`);
      }
    };
    const frames = (n: number) =>
      app.js(`(async () => { for (let i = 0; i < ${n}; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
    try {
      // (the defaults themselves, before anything is set: the raster, its shading automatic)
      const defaults = await app.js<Record<string, unknown>>(
        `(() => ({ pipeline: __bh.settings.earthPipeline, shading: __bh.settings.earthRasterShading, scale: __bh.settings.earthRasterScale,
          scenery: __bh.settings.earthScenery, reach: __bh.settings.detailReach, quality: __bh.settings.quality, tier: __bh.renderer.tier.level }))()`,
      );
      out.defaults = defaults;
      expect(defaults.pipeline).toBe("raster");
      expect(defaults.shading).toBe("auto");
      await app.js(
        `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
      );
      await until(`__bh.fleet.active === "f35"`, 30_000, "the F-35");
      // (the Alps first, in its cockpit, put at 2 500 m and 200 m/s; the clock stopped ten frames on — the craft does not fly
      // on while the kernels compile, minutes on the mini, nor fall —, the view touched every frame: the realtime path, the
      // governor's)
      await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.2);
        __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "cockpit"; __bh.settings.animate = true;
        window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return 1; })()`);
      await frames(10);
      await app.js(`(() => { __bh.settings.animate = false; return 1; })()`);
      // (the tracer compiled, the tiles in, the raster's shading kernels compiled)
      await until("__bh.renderer.tracerSettled", 300_000, "the tracer compiled");
      await app.waitFor("__bh.renderer.earthTiles.pending === 0", 90_000).catch(() => {});
      await until(
        `(() => { const r = __bh.renderer, v = r.variants.get(r.featureKey); return !!(v && v.shade && v.shadeMark); })()`,
        300_000,
        "the raster's shading kernels compiled",
      );
      await until(
        `__bh.renderer.rasterPrimaryNow && __bh.renderer.terrainRasterStats.encodedFrames > 30`,
        120_000,
        "the raster drawing the ground",
      );
      // (governed: no diagnostic hold — the calibration, the automatic block and scale at work)
      expect(await app.js<boolean>("__bh.renderer.terrainRasterInspecting")).toBe(false);
      await frames(120);
      const geo = await app.js<{ alt: number; gs: number }>(
        `(() => { const g = __bh.camera.geoNow(); return { alt: g.alt, gs: g.gs }; })()`,
      );
      out.alps = { ...(await app.js<Record<string, unknown>>(STATE)), geo };
      expect([2, 4, 8, 16]).toContain((out.alps as { raster: { rate: number } }).raster.rate);
      // (where it was put, the clock stopped: not fallen)
      expect(geo.alt).toBeGreaterThan(2000);
      await app.shot("remote-results/rg-alps-raster.png");

      // (the budget squeezed: the shading rate coarser to its floor, then the fallback to the traced pipeline, said)
      await app.js(`(() => { __bh.settings.realtimeBudget = 8; return 1; })()`);
      await until("__bh.renderer.terrainRasterStats.rate === 16", 90_000, "the automatic rate at one in sixteen");
      await until("__bh.renderer.rasterFellBack", 90_000, "the fallback to the traced pipeline");
      await until("!__bh.renderer.rasterPrimaryNow", 30_000, "the traced pipeline drawing");
      await frames(60);
      await app.shot("remote-results/rg-alps-fellback.png");
      out.fellBack = await app.js(STATE);
      // (the setting chosen again: the raster tried again; a wide budget: the rate finer again)
      await app.js(`(() => { __bh.settings.realtimeBudget = 200; __bh.game.set("earthPipeline", "raster"); return 1; })()`);
      expect(await app.js<boolean>("__bh.renderer.rasterFellBack")).toBe(false);
      await until("__bh.renderer.rasterPrimaryNow", 120_000, "the raster back");
      await until("__bh.renderer.terrainRasterStats.rate <= 4", 90_000, "the automatic rate finer again");
      out.roomy = await app.js(STATE);
      await app.js(`(() => { __bh.settings.realtimeBudget = 30; return 1; })()`);

      // (the traced pipeline by the player's choice; a fixed rate)
      await app.js(`(() => { __bh.game.set("earthPipeline", "trace"); return 1; })()`);
      await until("!__bh.renderer.rasterPrimaryNow", 60_000, "the traced pipeline by choice");
      await until("__bh.renderer.tracerSettled", 300_000, "the traced kernel compiled");
      await frames(90);
      await app.shot("remote-results/rg-alps-traced.png");
      await app.js(`(() => { __bh.game.set("earthPipeline", "raster"); __bh.game.set("earthRasterShading", "quarter"); return 1; })()`);
      await until("__bh.renderer.rasterPrimaryNow && __bh.renderer.terrainRasterStats.rate === 4", 120_000, "the fixed quarter");
      await app.js(`(() => { __bh.game.set("earthRasterShading", "auto"); window.__t = false; return 1; })()`);
      out.gpuErrors = await app.js<number>("__bh.renderer.gpuErrors");
      expect(out.gpuErrors).toBe(0);

      // (the Moon's shadow from 3 000 km: the physical sky light — skyAmbientOn — against the old model; with the eclipse
      // carried to each point the day side's darkest alike)
      await app.js(`(() => { __bh.preset("Earth: the Moon's shadow from orbit, 12 Aug 2026"); __bh.resize(); return 1; })()`);
      await until("__bh.renderer.tracerSettled", 300_000, "the orbit's tracer compiled");
      await app.waitFor("__bh.renderer.earthSettled", 120_000).catch(() => {});
      const shadow: Record<string, { min: number; mean: number }> = {};
      for (const on of [true, false]) {
        await app.js(`(() => { __bh.renderer.skyAmbientOn = ${on}; __bh.renderer.invalidate(); __bh.touch(); return 1; })()`);
        await frames(90);
        const f = `remote-results/rg-moon-shadow-${on ? "physical" : "old"}.png`;
        await app.shot(f);
        shadow[on ? "physical" : "old"] = darkest(f);
      }
      await app.js(`(() => { __bh.renderer.skyAmbientOn = true; return 1; })()`);
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
