// A diagnostic of the raster pipeline's passes (docs/PLAN-RENDU-RASTER-AAA.md, PLAN-NUAGES-AAA.md): a cloudy raster view, then
// every 15 s the GPU passes that ran, the console's warnings and errors (a pipeline that failed to compile says why there),
// the kernel variants' state and the passes' own switches. Not a pass/fail test: what a new pass that never shows needs.
// RD_WEATHER (cloudy), RD_ROUNDS (4).
import { afterAll, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);

test.skipIf(!E2E)(
  "the raster pipeline's passes: what ran, what failed",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 600, tiles: false });
    try {
      await app.js(`(() => { window.__w = []; const ow = console.warn, oe = console.error;
        console.warn = (...a) => { window.__w.push(String(a.map(String).join(" ")).slice(0, 600)); ow(...a); };
        console.error = (...a) => { window.__w.push("E " + String(a.map(String).join(" ")).slice(0, 600)); oe(...a); };
        window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        __bh.game.setDate("2021-06-21T16:00:00Z");
        __bh.presets["RD"] = {...__bh.presets["Earth: the Blue Marble"], animate:false, ship:false, time:__bh.sim.time, earthClouds:1,
          earthSurface:"off", earthScenery:"off", dynamicResolution:false, realtimeSubsampling:4, pixelRatio:1, fpsCap:0,
          earthPipeline:"raster", pose:{body:"earth", at:[28.6155,-80.6945], altKm:0.9, look:"earth", off:[0,70]}};
        __bh.preset("RD"); __bh.game.set("weather", ${JSON.stringify(process.env.RD_WEATHER ?? "cloudy")}); __bh.resize();
        const r = __bh.renderer; r.prof.enabled = true; r.prof.every = 1; return 1; })()`);
      for (let i = 0; i < Number(process.env.RD_ROUNDS ?? 4); i++) {
        await Bun.sleep(15000);
        const info = await app.js(`(() => { const r = __bh.renderer; return {
          key: r.featureKey, clouds: r.cloudPassStats, sky: { on: r.skyAmbientOn, pipe: !!r.skyPipe, table: r.skyTableOn, wanted: r.skyWanted, near: !!r.lastNear, out: !!r.skyOut },
          raster: { primary: r.terrainRasterStats.primary, reason: r.terrainRasterStats.reason },
          variants: [...r.variants.entries()].map(([k, v]) => [k, Object.entries(v).filter(([, x]) => x && typeof x === "object").map(([n]) => n).join(","), v.failed]),
          passes: r.prof.table().map((p) => p.label),
          warns: window.__w.filter((w) => !/Terrain tile/.test(w)).slice(-5) }; })()`);
        console.log(JSON.stringify(info));
      }
    } finally {
      await app.close();
    }
  },
  900_000,
);
