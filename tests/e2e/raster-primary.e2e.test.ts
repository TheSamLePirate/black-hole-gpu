// The raster's primary visibility (docs/PLAN-RENDU-RASTER-AAA.md étape 1, `earthPipeline: "raster"`): the patch's pixels
// shaded one a pixel (trace.wgsl shade), the rest traced as before. The same views traced at ×6, ×4 and ×1 (one ray a
// pixel: the reference the raster's ground should match), then with the raster (the sky still one ray a ×4 block): each
// mode's GPU passes, and its image against the ×1 one. The view is touched every frame — the realtime path, fresh rays,
// no convergence of a still camera — so ×4 and ×6 show what a moving camera shows.
// RP_PLACE=kennedy (default, flat, offline) | alps | chamonix | canyon (live elevation tiles: the network); RP_FULL=1: clouds,
// regional surface and scenery on (the default leaves them off, as P1c/P1d did); RP_W, RP_H: the image (1280 × 800).
// RP_MODES=trace4,raster: some of the modes only. Captures remote-results/rp-<place>-<pose>-<mode>.png; measures
// remote-results/raster-primary-<place>.json.
// Duration: ~6 min a pose on kerr-mini (×1 with RP_FULL: longer).
// Done when: the last pose's modes are all captured and the figures written.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

afterAll(stopServer);

const PLACES: Record<string, { at: [number, number]; poses: { name: string; altKm: number; off: number[] }[]; tiles: boolean }> = {
  kennedy: {
    at: [28.6155, -80.6945],
    tiles: false,
    poses: [
      { name: "oblique-900m", altKm: 0.9, off: [0, 35] },
      { name: "oblique-3km", altKm: 3, off: [0, 55] },
      { name: "horizon-900m", altKm: 0.9, off: [0, 80] },
    ],
  },
  alps: {
    at: [45.9, 6.95],
    tiles: true,
    poses: [
      { name: "valley-2km", altKm: 2, off: [0, 15] },
      { name: "ridges-3km", altKm: 3, off: [0, 78] },
    ],
  },
  // (over Chamonix's valley — its floor at ~1 035 m — at 3.5 km over the ellipsoid, looking out to the horizon and the
  // Mont-Blanc massif: the ridges, the valley's clouds, the sky; "alps" above looks down at the slopes from close)
  chamonix: {
    at: [45.92, 6.87],
    tiles: true,
    poses: [{ name: "valley-3.5km", altKm: 3.5, off: [0, 78] }],
  },
  canyon: {
    at: [36.1, -112.1],
    tiles: true,
    poses: [
      { name: "rim-2km", altKm: 2.2, off: [0, 20] },
      { name: "rim-horizon", altKm: 2.2, off: [0, 80] },
    ],
  },
};
const PLACE_NAME = process.env.RP_PLACE ?? "kennedy";
const PLACE = PLACES[PLACE_NAME]!;
const FULL = process.env.RP_FULL === "1";
const W = Number(process.env.RP_W ?? 1280);
const H = Number(process.env.RP_H ?? 800);
const ALL_MODES = [
  { name: "trace6", pipeline: "trace", sub: 6 },
  { name: "trace4", pipeline: "trace", sub: 4 },
  { name: "trace1", pipeline: "trace", sub: 1 },
  { name: "raster", pipeline: "raster", sub: 4 },
] as const;
// (RP_MODES=trace4,raster: some of them — the reference for the comparisons is trace1 when it is among them, else the first)
const MODES = process.env.RP_MODES ? process.env.RP_MODES.split(",").flatMap((n) => ALL_MODES.filter((m) => m.name === n)) : ALL_MODES;
const REF = MODES.some((m) => m.name === "trace1") ? "trace1" : MODES[0]!.name;

type Png = ReturnType<typeof readPng>;
/** mean absolute difference (0–255) and PSNR [dB] below the toolbar */
function compare(a: Png, b: Png) {
  let sum = 0,
    sq = 0,
    n = 0;
  for (let y = 60; y < a.height; y++)
    for (let x = 0; x < a.width; x++)
      for (let c = 0; c < 3; c++) {
        const i = (y * a.width + x) * a.channels + c;
        const d = a.data[i]! - b.data[i]!;
        sum += Math.abs(d);
        sq += d * d;
        n++;
      }
  return { mean: +(sum / n).toFixed(2), psnr: +(10 * Math.log10((255 * 255) / Math.max(sq / n, 1e-9))).toFixed(2) };
}

test.skipIf(!E2E)(
  "the raster's primary visibility: the ground one sample a pixel, its cost against the traced ×6, ×4, ×1",
  async () => {
    const app = await App.boot({
      hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`,
      width: W,
      height: H,
      tiles: PLACE.tiles,
    });
    try {
      await app.js(
        `(() => { window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`,
      );
      const rows: unknown[] = [];
      for (const pose of PLACE.poses) {
        const extras = FULL
          ? `earthClouds:0.4, volumetricClouds:true, earthSurface:"satellite", earthScenery:"balanced"`
          : `earthClouds:0, volumetricClouds:false, earthSurface:"off", earthScenery:"off"`;
        await app.js(`(() => { __bh.game.setDate("2021-06-21T16:00:00Z");
          __bh.presets["RP"] = {...__bh.presets["Earth: the Blue Marble"], animate:false, ship:false, time:__bh.sim.time, ${extras},
            dynamicResolution:false, realtimeSubsampling:4, pixelRatio:1, temporalReprojection:false, fpsCap:0,
            earthTerrainCache:false, earthTerrainRasterLevel:2, earthTerrainRasterView:"off", earthTerrainRasterUse:false, earthPipeline:"trace",
            pose:{body:"earth", at:[${PLACE.at[0]},${PLACE.at[1]}], altKm:${pose.altKm}, look:"earth", off:${JSON.stringify(pose.off)}}};
          __bh.preset("RP"); __bh.resize(); return true; })()`);
        const images: Record<string, Png> = {};
        const passes: Record<string, Record<string, number>> = {};
        for (const mode of MODES) {
          await app.js(
            `(() => { __bh.settings.earthPipeline=${JSON.stringify(mode.pipeline)}; __bh.settings.realtimeSubsampling=${mode.sub}; __bh.touch(); return true; })()`,
          );
          await app.waitFor("__bh.renderer.variantReady", 300_000);
          // (the relief's tiles all in — none asked for 4 s on end: the finest levels come after the coarse ones; a capture
          // before them shows a lower, smoother relief, its summits under the clouds' deck)
          if (PLACE.tiles)
            await app.js(`(async () => { const r = __bh.renderer, t0 = performance.now(); let calm = 0;
              while (performance.now() - t0 < 180000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
                if (calm && performance.now() - calm > 4000) break; await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`);
          if (mode.pipeline === "raster")
            await app.waitFor(
              `__bh.renderer.terrainRasterStats.primary && __bh.renderer.terrainRasterStats.reason === "pilot" && __bh.renderer.terrainRasterStats.encodedFrames > 5`,
              180_000,
            );
          const w = await app.js<number>("__bh.renderer.completedFrames");
          await app.waitFor(`__bh.renderer.completedFrames >= ${w + 40}`, 120_000);
          await app.js("(() => { __bh.game.perf(); __bh.renderer.prof.every = 1; __bh.renderer.prof.reset(); return true; })()");
          // (50 frames timed, or — a slow mode: ×1 with the scenery on an M1 takes seconds a frame — 8 after a minute)
          await app.js("(() => { window.__rpT0 = performance.now(); return 1; })()");
          await app.waitFor(
            "__bh.renderer.prof.frames >= 50 || (performance.now() - window.__rpT0 > 60000 && __bh.renderer.prof.frames >= 8)",
            600_000,
          );
          const table = await app.js<{ label: string; ms: number }[]>("__bh.renderer.prof.table()");
          passes[mode.name] = Object.fromEntries(table.map((p) => [p.label, +p.ms.toFixed(2)]));
          const f = `remote-results/rp-${PLACE_NAME}${FULL ? "-full" : ""}-${pose.name}-${mode.name}.png`;
          await app.shot(f);
          images[mode.name] = readPng(new Uint8Array(require("node:fs").readFileSync(f)));
        }
        const sumOf = (m: string) =>
          ["trace", "earth shade (raster)", "terrain raster visibility"].reduce((a, k) => a + (passes[m]![k] ?? 0), 0);
        const row = {
          pose: pose.name,
          full: FULL,
          size: [W, H],
          rays: Object.fromEntries(MODES.map((m) => [m.name, +sumOf(m.name).toFixed(2)])),
          vsRef: { ref: REF, ...Object.fromEntries(MODES.map((m) => [m.name, compare(images[m.name]!, images[REF]!)])) },
          stats: await app.js("({ ...__bh.renderer.terrainRasterStats })"),
          passes,
        };
        rows.push(row);
        console.log(JSON.stringify({ pose: row.pose, rays: row.rays, vsRef: row.vsRef }));
        await app.js(`(() => { __bh.settings.earthPipeline="trace"; return true; })()`);
      }
      await Bun.write(`remote-results/raster-primary-${PLACE_NAME}${FULL ? "-full" : ""}.json`, JSON.stringify(rows, null, 2));
      for (const r of rows as { stats: Record<string, unknown> }[]) expect(r.stats.error).toBeFalsy();
    } finally {
      await app.close();
    }
  },
  2_400_000,
);
