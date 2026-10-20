// What the raster's primary visibility spends its shading on, in flight (docs/PLAN-RENDU-RASTER-AAA.md étape 1): the
// F-35 from its cockpit (raster-flight.e2e.test.ts's places and detail: the scenery high, drawn very far), the clock
// stopped on one view, `earthPipeline: "raster"`; the kernel shade's GPU time with each part left out in turn —
// a tuning of the kernel (renderer.tune: trace.wgsl TUNE_GSKIP's bits, TUNE_DETAIL, TUNE_HINT_GRAZE) or a setting
// (the scenery, the clouds) —, alternated with the untouched view: a part's cost is the drop it leaves. A measure: the
// images then differ, on purpose. RP_PLACE=tarifa-low (default) | tarifa | alps.
// Measures remote-results/raster-shade-ablation-<place>.json.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);

const PLACES: Record<string, string> = {
  "tarifa-low": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  tarifa: `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3);
    __bh.game.flyAt(36.1, -5.55, 900, 200, 210);`,
  alps: `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
};
const PLACE = process.env.RP_PLACE ?? "tarifa-low";
const DETAIL = `{ earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true, earthSurface: "satellite" }`;
const ABLATIONS: { name: string; tune?: Record<string, number>; settings?: string }[] = [
  { name: "grazing rays not marched", tune: { TUNE_HINT_GRAZE: 0 } },
  { name: "scenery off", settings: `{ earthScenery: "off" }` },
  { name: "clouds off", settings: `{ earthClouds: 0, volumetricClouds: false }` },
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
  { name: "scenery shadows off", settings: `{ earthSceneryShadows: false }` },
  { name: "crown carving off", tune: { TUNE_FOREST_DETAIL: 0 } },
  // (the shaded sample's footprint a pixel's own rather than its square's: the drop is negative — what that costs)
  { name: "pixel footprint", tune: { TUNE_RASTER_FOOT: 1 } },
  { name: "relief shadow steps 12", tune: { TUNE_SHADOW_N: 12 } },
  { name: "hint refinement 2 steps", tune: { TUNE_HINT_ITER: 2 } },
  { name: "scenery balanced", settings: `{ earthScenery: "balanced" }` },
  { name: "detail reach normal", settings: `{ detailReach: "normal" }` },
];
// (RP_ABL="scenery off,scenery shadows off": those alone)
const CHOSEN = process.env.RP_ABL ? ABLATIONS.filter((a) => process.env.RP_ABL!.split(",").includes(a.name)) : ABLATIONS;

test.skipIf(!E2E)(
  "the raster's shading in flight: what each part costs",
  async () => {
    const app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
      await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 0 });
        ${PLACES[PLACE]} __bh.settings.shipMount = "cockpit"; Object.assign(__bh.settings, ${DETAIL});
        __bh.settings.earthPipeline = "raster"; __bh.game.set("realtimeSubsampling", 4);
        const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        c.jetModes.alt = c.last?.alt ?? c.jetModes.alt; return 1; })()`);
      await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
      await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let calm = 0;
        while (performance.now() - t0 < 120000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 4000) break; await frame(); }
        __bh.settings.animate = false;
        window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return 1; })()`);
      const measure = async (tune: Record<string, number>, settings: string) => {
        await app.js(`(() => { Object.assign(__bh.settings, ${settings}); __bh.renderer.tune = ${JSON.stringify(tune)};
          const r = __bh.renderer; r.prof.enabled = true; r.prof.every = 1; r.prof.reset(); __bh.touch(); return true; })()`);
        // (a tuning is a kernel variant of its own, its main then its shade compiled in the background — the general kernel
        // draws meanwhile, tracing every pixel, and one frame of the earlier kernel's shade may still be counted: measured
        // once the shade has drawn 20 frames since the reset; the scenery, switched back on, loaded again first)
        await app.waitFor(
          `__bh.renderer.terrainRasterStats.primary && (__bh.renderer.prof.table().find((p) => p.label === "earth shade (raster)")?.n ?? 0) >= 20`,
          600_000,
        );
        await app
          .waitFor(`__bh.settings.earthScenery === "off" || __bh.renderer.earthScenery.stats().status === "ready"`, 120_000)
          .catch(() => {});
        return await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 30; i++) await frame();
          r.prof.reset(); let done = 0, last = r.lastDoneAt, sum = 0, n = 0;
          while (done < 40) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++;
            const s = r.prof.table().find((p) => p.label === "earth shade (raster)"); if (s) { sum += s.last; n++; } } }
          if (r.terrainRasterStats.rate !== window.__rate) console.warn('rate', r.terrainRasterStats.rate);
          window.__rates = [...(window.__rates ?? []), r.terrainRasterStats.rate];
          return n >= 30 ? +(sum / n).toFixed(2) : Number.NaN; })()`);
      };
      const initial = await app.js<string>(
        `JSON.stringify({ earthScenery: __bh.settings.earthScenery, earthClouds: __bh.settings.earthClouds, volumetricClouds: __bh.settings.volumetricClouds,
          earthSceneryShadows: __bh.settings.earthSceneryShadows, detailReach: __bh.settings.detailReach })`,
      );
      const rows: { name: string; base: number[]; without: number[]; drop: number }[] = [];
      const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)] ?? 0;
      for (const a of CHOSEN) {
        const b: number[] = [];
        const w: number[] = [];
        for (let r = 0; r < 2; r++) {
          b.push(await measure({}, initial));
          w.push(await measure(a.tune ?? {}, a.settings ?? initial));
        }
        const row = { name: a.name, base: b, without: w, drop: +(med(b) - med(w)).toFixed(2), rates: await app.js("window.__rates") };
        await app.js("(() => { window.__rates = []; return 1; })()");
        rows.push(row);
        console.log(JSON.stringify(row));
      }
      await app.js(`(() => { window.__t = false; __bh.renderer.tune = {}; return true; })()`);
      await Bun.write(`remote-results/raster-shade-ablation-${PLACE}.json`, JSON.stringify({ place: PLACE, rows }, null, 2));
      for (const r of rows) expect(Number.isFinite(r.drop)).toBe(true);
    } finally {
      await app.close();
    }
  },
  3_600_000,
);
