import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
afterAll(stopServer);
// Run separately from unit/build jobs: SCENERY_BENCH=1 bun run e2e scenery-bench.
test.skipIf(!E2E || process.env.SCENERY_BENCH !== "1")(
  "steady-state scenery cost with calibrated kernels and per-frame medians",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: true });
    const report: unknown[] = [];
    try {
      await app.js(
        `(()=>{window.__benchTick=true;const tick=()=>{if(!window.__benchTick)return;__bh.touch();requestAnimationFrame(tick);};requestAnimationFrame(tick);return true;})()`,
      );
      for (const place of [
        { name: "cevennes", lat: 44.2, lon: 4.15, alt: 0.45 },
        { name: "tokyo", lat: 35.68, lon: 139.76, alt: 0.4 },
      ]) {
        const date = new Date(Date.UTC(2021, 5, 21, 12) - (place.lon / 15) * 3600000).toISOString();
        await app.js(`(()=>{__bh.freeze(true);__bh.game.setDate(${JSON.stringify(date)});
        __bh.presets["Scenery bench"]={...__bh.presets["Earth: the Blue Marble"],animate:false,ship:false,time:__bh.sim.time,
        earthScenery:"balanced",earthSurface:"satellite",earthTerrain:true,earthClouds:0,volumetricClouds:false,
        dynamicResolution:false,realtimeSubsampling:2,pixelRatio:1,temporalReprojection:true,
        pose:{body:"earth",at:[${place.lat},${place.lon}],altKm:${place.alt},look:"earth",off:[0,35]}};
        __bh.preset("Scenery bench");__bh.resize();return true;})()`);
        await app.waitFor(
          `__bh.renderer.earthScenery.stats().lat!==null&&Math.abs(__bh.renderer.earthScenery.stats().lat-(${place.lat}))<.01&&!__bh.renderer.earthScenery.pending`,
          120000,
        );
        await app.waitFor("__bh.renderer.calibrationReady", 300000);
        expect(await app.js<string>("__bh.renderer.earthScenery.stats().status")).toBe("ready");
        expect(await app.js<number>("__bh.renderer.earthScenery.stats().trees")).toBeGreaterThan(100);
        expect(await app.js<number>("__bh.renderer.earthScenery.stats().buildings")).toBeGreaterThan(100);
        await app.js(
          `(()=>{const r=__bh.renderer.earthScenery;window.__sceneParams=r.params.bind(r);r.params=()=>{const p=window.__sceneParams();if(window.__sceneVolumesOff)p[3]=0;if(window.__sceneShadowsOff)p[23]=0;return p;};__bh.renderer.prof.every=1;return true;})()`,
        );
        // Let driver caches and GPU clocks settle after switching from the CPU/network preparation.
        await app.js("new Promise(r=>setTimeout(r,20000))");
        for (const mode of [
          { volumes: false, shadows: false },
          { volumes: true, shadows: false },
          { volumes: true, shadows: true },
          { volumes: false, shadows: false },
          { volumes: true, shadows: false },
          { volumes: true, shadows: true },
          { volumes: false, shadows: false },
        ]) {
          const { volumes, shadows } = mode;
          await app.js(`(()=>{window.__sceneVolumesOff=${!volumes};window.__sceneShadowsOff=${!shadows};__bh.touch();return true;})()`);
          await app.js("new Promise(r=>setTimeout(r,2000))");
          const sample =
            await app.js(`(async()=>{await __bh.renderer.device.queue.onSubmittedWorkDone();const prof=__bh.renderer.prof;prof.reset();let seen=prof.frames;const times=[];
          await new Promise(resolve=>{const tick=()=>{if(prof.frames>seen){seen=prof.frames;const p=prof.table().find(p=>p.label==="trace");if(p)times.push(p.last);}if(times.length>=180)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
          const sorted=[...times].sort((a,b)=>a-b),q=p=>sorted[Math.floor((sorted.length-1)*p)];
          return {trace:{median:q(.5),p10:q(.1),p90:q(.9),samples:times.length},times,perf:__bh.game.perf({gpu:false}),calibrationReady:__bh.renderer.calibrationReady};})()`);
          report.push({ place, volumes, shadows, ...sample });
          console.log(place.name, volumes, shadows, sample.trace);
          expect(sample.calibrationReady).toBe(true);
          if (volumes && report.length === 2) {
            expect(await app.js<number>('document.querySelectorAll(".scenery-credit:not([hidden])").length')).toBe(1);
            await app.shot("remote-results/earth-scenery-credit.png");
          }
        }
        await app.js(
          "(()=>{__bh.renderer.earthScenery.params=window.__sceneParams;window.__sceneVolumesOff=false;window.__sceneShadowsOff=false;return true;})()",
        );
      }
      await Bun.write("remote-results/earth-scenery-calibrated.json", JSON.stringify(report, null, 2));
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
      await app.js("window.__benchTick=false");
    } finally {
      app.close();
    }
  },
  900000,
);
