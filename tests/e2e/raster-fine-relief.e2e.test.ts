import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The raster's finest relief near the camera (docs/ANALYSE-IGN-LIDAR.md I3): the surface cache's two finer levels — nodes
// 1.2 and 2.4 m apart — and the raster's patch on the finest, the coarser ones rings round it out to 2.4 km nodes; the
// survey's normals in its own grid down to half a metre. At Étretat over the IGN's relief, held: the patch of before (153 m
// nodes, level 4) against the new one (level 0) — the visibility pass's and the raster's shading's GPU time, the rings
// drawn, a held view of each. (E2E_SHOTS=<dir>: raster-fine-etretat-level4 / -level0.)
// Duration: ~6 min on kerr-mini.
// Done when: the new patch's visibility pass measured against the old one's on the same pixels (within 2 ms more), its rings
// all drawn.

describe.skipIf(!E2E)("the raster's finest relief", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("at Étretat: the patch on the 1.2 m level, its rings round it — the visibility pass measured against the 153 m patch's", async () => {
    // (the date set, a second for the clock to take it, then the jump — never in the same tick; held at once over the
    // plateau behind the cliffs, the chase view out to sea: the tiles stream in all the same)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    await app.js(`(() => { __bh.game.flyAt(49.698, 0.214, 250, 315, 120); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(__bh.freeze(true), 1)`);
    await app
      .waitFor(
        `(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return t.pending === 0 && t.orthoPending === 0 && !s.pending && t.finest >= 16; })()`,
        120_000,
      )
      .catch(() => console.log("  (still loading after 120 s)"));
    // (the clock stopped, every frame drawn — the image held still, re-rendered —, the GPU's passes timed every frame)
    // (the GPU's timestamps switched on ahead — their first frames come back empty)
    await app.js(`(() => { const r = __bh.renderer; r.prof.enabled = true; r.prof.every = 1; r.prof.reset(); return 1; })()`);
    await Bun.sleep(3000);
    await app.js(`(() => { __bh.settings.animate = false; window.__t = true;
      const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()`);
    // (both patches measured on the same pixels: the scale, the shading rate pinned — the shots' settings undone after each)
    const MEASURE = `{ dynamicResolution: false, earthRasterShading: "half", earthRasterScale: 0.75, motionBlur: 0.5 }`;
    const measure = async (level: number, shoot = true) => {
      await app.js(
        `(() => { Object.assign(__bh.settings, ${MEASURE}); __bh.settings.earthTerrainRasterLevel = ${level}; __bh.renderer.rasterFellBack = false; return 1; })()`,
      );
      await app
        .waitFor(`__bh.renderer.terrainRasterStats.level === ${level} && __bh.renderer.terrainRasterStats.primary`, 60_000)
        .catch(() => {});
      await app.settled();
      await Bun.sleep(3000);
      const r = await app.js<{
        n: number;
        vis: number;
        shade: number;
        rings: number;
        level: number;
        pipe: string;
        fps: number;
      }>(`(async () => {
        const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
        for (let i = 0; i < 20; i++) await frame();
        r.prof.reset();
        let done = 0, last = r.lastDoneAt, vis = 0, shade = 0, n = 0; const t0 = performance.now(); let frames = 0;
        while (done < 40) { await frame(); frames++; if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++;
          const tb = r.prof.table(), v = tb.find((p) => p.label === "terrain raster visibility"), s = tb.find((p) => p.label === "earth shade (raster)");
          if (v && s) { vis += v.last; shade += s.last; n++; } } }
        return { n, vis: vis / Math.max(n, 1), shade: shade / Math.max(n, 1), rings: r.terrainRaster?.ringsDrawn ?? 0, level: r.terrainRasterStats.level,
          pipe: r.earthPipelineNow(__bh.settings), fps: frames / ((performance.now() - t0) / 1000) };
      })()`);
      console.log(
        `  patch on level ${r.level}: visibility ${r.vis.toFixed(2)} ms, raster shading ${r.shade.toFixed(2)} ms, ${r.rings} rings, ${r.pipe}, ${r.fps.toFixed(0)} fps`,
      );
      expect(r.pipe).toBe("raster");
      // (the passes timed on enough frames: a figure, not an empty table)
      expect(r.n).toBeGreaterThanOrEqual(20);
      if (shots && shoot) {
        await app.js(
          `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; return 1; })()`,
        );
        await Bun.sleep(3000);
        await Bun.$`mkdir -p ${shots}`;
        await app.shot(`${shots}/raster-fine-etretat-level${level}.png`);
        await app.js(`(() => { Object.assign(__bh.settings, ${MEASURE}); return 1; })()`);
      }
      return r;
    };
    const before = await measure(4);
    const after = await measure(0);
    // (the old patch again: the drift between the two of before, the figures' noise)
    const again = await measure(4, false);
    console.log(
      `  the old patch twice: visibility ${before.vis.toFixed(2)} / ${again.vis.toFixed(2)} ms, shading ${before.shade.toFixed(2)} / ${again.shade.toFixed(2)} ms`,
    );
    await app.js(
      `(() => { window.__t = false; Object.assign(__bh.settings, { animate: true, earthRasterShading: "auto", dynamicResolution: true }); return 1; })()`,
    );
    console.log(`  the visibility pass: ${(after.vis - before.vis).toFixed(2)} ms more on the 1.2 m patch`);
    expect(after.level).toBe(0);
    // (its rings: 1 … 6 — 2.4 m out to 2.4 km nodes)
    expect(after.rings).toBeGreaterThanOrEqual(5);
    expect(after.vis).toBeLessThan(Math.max(before.vis, again.vis) + 2);
    expect(app.cdp.errors).toEqual([]);
  }, 600_000);
});
