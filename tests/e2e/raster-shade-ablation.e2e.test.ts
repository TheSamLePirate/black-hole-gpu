// What the raster's primary visibility spends its shading on (docs/PLAN-RENDU-RASTER-AAA.md étape 1): one view with
// `earthPipeline: "raster"`, the kernel shade's GPU time with each part of the ground's shading left out in turn
// (renderer.tune: trace.wgsl TUNE_GSKIP's bits, TUNE_DETAIL, TUNE_SHADOW_N), alternated with the untouched kernel —
// a part's cost is the drop it leaves. A measure: the images then differ, on purpose.
// RP_PLACE=kennedy (default) | alps | canyon; RP_POSE: a pose's index (0); RP_FULL=1: clouds, surface, scenery on.
// Measures remote-results/raster-shade-ablation-<place>.json.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);

const PLACES: Record<string, { at: [number, number]; altKm: number; off: number[]; tiles: boolean }[]> = {
  kennedy: [
    { at: [28.6155, -80.6945], altKm: 3, off: [0, 55], tiles: false },
    { at: [28.6155, -80.6945], altKm: 0.9, off: [0, 80], tiles: false },
  ],
  alps: [{ at: [45.9, 6.95], altKm: 3, off: [0, 78], tiles: true }],
  canyon: [{ at: [36.1, -112.1], altKm: 2.2, off: [0, 20], tiles: true }],
};
const PLACE_NAME = process.env.RP_PLACE ?? "kennedy";
const POSE = PLACES[PLACE_NAME]![Number(process.env.RP_POSE ?? 0)]!;
const FULL = process.env.RP_FULL === "1";
const ABLATIONS: { name: string; tune: Record<string, number> }[] = [
  { name: "relief normal", tune: { TUNE_GSKIP: 1 } },
  { name: "relief shadows", tune: { TUNE_GSKIP: 2 } },
  { name: "near materials", tune: { TUNE_GSKIP: 4 } },
  { name: "fine noise", tune: { TUNE_GSKIP: 8 } },
  { name: "cloud shadows", tune: { TUNE_GSKIP: 16 } },
  { name: "tile imagery", tune: { TUNE_GSKIP: 32 } },
  { name: "surface textures", tune: { TUNE_GSKIP: 64 } },
  { name: "sea shading", tune: { TUNE_GSKIP: 128 } },
  { name: "scenery surfaces", tune: { TUNE_GSKIP: 256 } },
  { name: "ground detail", tune: { TUNE_DETAIL: 0 } },
  { name: "all ground shading", tune: { TUNE_GSKIP: 511 } },
];

test.skipIf(!E2E)(
  "the raster's shading: what each part of the ground's costs",
  async () => {
    const app = await App.boot({
      hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`,
      width: 1280,
      height: 800,
      tiles: POSE.tiles,
    });
    try {
      await app.js(
        `(() => { window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`,
      );
      const extras = FULL
        ? `earthClouds:0.4, volumetricClouds:true, earthSurface:"satellite", earthScenery:"balanced"`
        : `earthClouds:0, volumetricClouds:false, earthSurface:"off", earthScenery:"off"`;
      await app.js(`(() => { __bh.game.setDate("2021-06-21T16:00:00Z");
        __bh.presets["RPA"] = {...__bh.presets["Earth: the Blue Marble"], animate:false, ship:false, time:__bh.sim.time, ${extras},
          dynamicResolution:false, realtimeSubsampling:4, pixelRatio:1, temporalReprojection:false, fpsCap:0,
          earthTerrainCache:false, earthTerrainRasterLevel:2, earthTerrainRasterView:"off", earthTerrainRasterUse:false, earthPipeline:"raster",
          pose:{body:"earth", at:[${POSE.at[0]},${POSE.at[1]}], altKm:${POSE.altKm}, look:"earth", off:${JSON.stringify(POSE.off)}}};
        __bh.preset("RPA"); __bh.resize(); return true; })()`);
      const measure = async (tune: Record<string, number>) => {
        await app.js(`(() => { __bh.renderer.tune = ${JSON.stringify(tune)}; __bh.touch(); return true; })()`);
        await app.waitFor("__bh.renderer.variantReady", 300_000);
        if (POSE.tiles) await app.waitFor("__bh.renderer.earthTiles.pending === 0", 120_000).catch(() => {});
        await app.waitFor(
          `__bh.renderer.terrainRasterStats.primary && __bh.renderer.terrainRasterStats.reason === "pilot" && __bh.renderer.terrainRasterStats.encodedFrames > 5`,
          180_000,
        );
        const w = await app.js<number>("__bh.renderer.completedFrames");
        await app.waitFor(`__bh.renderer.completedFrames >= ${w + 30}`, 120_000);
        await app.js("(() => { __bh.game.perf(); __bh.renderer.prof.every = 1; __bh.renderer.prof.reset(); return true; })()");
        await app.waitFor("__bh.renderer.prof.frames >= 40", 120_000);
        const t = await app.js<{ label: string; ms: number }[]>("__bh.renderer.prof.table()");
        return t.find((p) => p.label === "earth shade (raster)")?.ms ?? Number.NaN;
      };
      const rows: { name: string; base: number[]; without: number[]; drop: number }[] = [];
      const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)] ?? 0;
      for (const a of ABLATIONS) {
        const base: number[] = [];
        const without: number[] = [];
        for (let r = 0; r < 2; r++) {
          base.push(await measure({}));
          without.push(await measure(a.tune));
        }
        const row = { name: a.name, base, without, drop: +(med(base) - med(without)).toFixed(2) };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
      await app.js(`(() => { __bh.renderer.tune = {}; return true; })()`);
      await Bun.write(
        `remote-results/raster-shade-ablation-${PLACE_NAME}${FULL ? "-full" : ""}.json`,
        JSON.stringify({ pose: POSE, full: FULL, rows }, null, 2),
      );
      for (const r of rows) expect(Number.isFinite(r.drop)).toBe(true);
    } finally {
      await app.close();
    }
  },
  3_600_000,
);
