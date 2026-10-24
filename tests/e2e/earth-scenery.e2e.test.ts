import { afterAll, expect, test } from "bun:test";
import { sceneryBudget } from "../../src/system/scenery-data";
import { App, E2E, stopServer } from "./lib/app";

// (each measure profiles every frame — prof.every = 1, 2–3 % of GPU time: one in eight, the M1's kiosk at
// 1920×1080 — the screen's size whatever the test asks — never had 60 profiled in a minute)
afterAll(stopServer);
test.skipIf(!E2E)(
  "riverbanks and bridge volumes share illuminated terrain and water",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: true });
    try {
      await app.js(`(()=>{__bh.freeze(true);__bh.game.setDate("2021-06-21T15:00:00Z");
        __bh.presets["River view"]={...__bh.presets["Earth: the Blue Marble"],animate:false,ship:false,time:__bh.sim.time,
        earthScenery:"balanced",earthSceneryShadows:true,earthSurface:"satellite",earthTerrain:true,earthClouds:0,volumetricClouds:false,
        dynamicResolution:false,realtimeSubsampling:2,pixelRatio:1,temporalReprojection:true,
        pose:{body:"earth",at:[48.8581,2.3377],altKm:.22,look:"earth",off:[0,0]}};
        __bh.preset("River view");__bh.resize();window.__riverTick=true;
        const tick=()=>{if(!window.__riverTick)return;__bh.touch();requestAnimationFrame(tick);};requestAnimationFrame(tick);return true;})()`);
      await app.waitFor("__bh.renderer.earthScenery.active&&!__bh.renderer.earthScenery.pending", 120000);
      await app.waitFor("__bh.renderer.variantReady&&__bh.renderer.earthTiles.pending===0", 180000);
      const stats = await app.js("__bh.renderer.earthScenery.stats()");
      expect(stats.bridges).toBeGreaterThan(0);
      expect(stats.waterPolygons).toBeGreaterThan(0);
      expect(stats.shadows).toBe(true);
      await app.js("(()=>{__bh.renderer.prof.every=1;__bh.renderer.prof.reset();window.__profT0=performance.now();return true;})()");
      await app.waitFor(
        "__bh.renderer.prof.frames>=60 || (__bh.renderer.prof.frames>=12 && performance.now()-window.__profT0>45000)",
        60000,
      );
      await app.shot("remote-results/earth-scenery-seine.png");
      await Bun.write("remote-results/earth-scenery-seine.json", JSON.stringify(stats, null, 2));
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
      await app.js("window.__riverTick=false");
    } finally {
      app.close();
    }
  },
  400000,
);
test.skipIf(!E2E)(
  "worldwide forests and OSM volumes render on real data outside pilot packs",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: true });
    const reports: unknown[] = [];
    try {
      await app.js(
        `(()=>{window.__sceneryTick=true;const tick=()=>{if(!window.__sceneryTick)return;__bh.touch();requestAnimationFrame(tick);};requestAnimationFrame(tick);return true;})()`,
      );
      for (const place of [
        { name: "paris", lat: 48.86, lon: 2.35, buildings: 100 },
        { name: "cevennes", lat: 44.2, lon: 4.15, trees: 100 },
        { name: "tokyo", lat: 35.68, lon: 139.76, buildings: 100 },
        { name: "sydney", lat: -33.87, lon: 151.2, buildings: 100 },
      ]) {
        const date = new Date(Date.UTC(2021, 5, 21, 12) - (place.lon / 15) * 3600000).toISOString();
        await app.js(`(()=>{__bh.freeze(true);__bh.game.setDate(${JSON.stringify(date)});
      __bh.presets["World scenery"]={...__bh.presets["Earth: the Blue Marble"],animate:false,ship:false,time:__bh.sim.time,
        earthScenery:"balanced",earthSurface:"satellite",earthTerrain:true,earthClouds:0,volumetricClouds:false,
        dynamicResolution:false,realtimeSubsampling:2,pixelRatio:1,temporalReprojection:true,
        pose:{body:"earth",at:[${place.lat},${place.lon}],altKm:${place.name === "cevennes" ? 1.2 : 0.4},look:"earth",off:[0,35]}};
      __bh.preset("World scenery");__bh.resize();return true;})()`);
        await app.waitFor(
          `__bh.renderer.earthScenery.stats().lat!==null && Math.abs(__bh.renderer.earthScenery.stats().lat-(${place.lat}))<.01 && !__bh.renderer.earthScenery.pending`,
          120000,
        );
        const stats = await app.js("__bh.renderer.earthScenery.stats()");
        console.log(place.name, JSON.stringify(stats));
        // (the buffer the scene's detail reach asks — DETAIL_REACH: 16 MiB at the normal one, 64 at the very far one, a
        // capable machine's default)
        expect(stats.gpuBytes).toBe(sceneryBudget(stats.reach));
        expect(stats.coverPixels).toBeGreaterThan(1000);
        expect(stats.rgbPixels).toBeGreaterThan(1000);
        expect(stats.roads).toBeGreaterThan(100);
        expect(stats.osmLayers.transportation.fields).toContain("brunnel");
        expect(stats.osmLayers.water).toBeDefined();
        if (place.name === "paris") {
          expect(stats.bridges).toBeGreaterThan(0);
          expect(stats.waterPolygons).toBeGreaterThan(0);
        }
        if (place.name === "tokyo") expect(stats.railways).toBeGreaterThan(0);
        if (place.buildings) expect(stats.buildings).toBeGreaterThan(place.buildings);
        if (place.trees) expect(stats.trees).toBeGreaterThan(place.trees);
        await app.waitFor("__bh.renderer.variantReady", 180000);
        await app.waitFor("__bh.renderer.earthTiles.pending===0", 90000);
        await app.js("new Promise(r=>setTimeout(r,1500))");
        await app.js(
          "(()=>{__bh.game.perf();__bh.renderer.prof.every=1;__bh.renderer.prof.reset();window.__profT0=performance.now();return true;})()",
        );
        await app.waitFor(
          "__bh.renderer.prof.frames>=60 || (__bh.renderer.prof.frames>=12 && performance.now()-window.__profT0>45000)",
          60000,
        );
        await app.shot(`remote-results/earth-scenery-${place.name}.png`);
        if (place.name === "paris") {
          for (const shadows of [false, true]) {
            await app.js(`(()=>{__bh.settings.earthSceneryShadows=${shadows};__bh.touch();return true;})()`);
            await app.js("new Promise(r=>setTimeout(r,2000))");
            await app.shot(`remote-results/earth-scenery-shadows-${shadows}.png`);
          }
          const shots = await Promise.all(
            [false, true].map(async (v) =>
              Buffer.from(await Bun.file(`remote-results/earth-scenery-shadows-${v}.png`).arrayBuffer()).toString("base64"),
            ),
          );
          const difference =
            await app.js(`(async()=>{const images=await Promise.all(${JSON.stringify(shots)}.map(async b=>createImageBitmap(await(await fetch("data:image/png;base64,"+b)).blob())));
            const c=new OffscreenCanvas(960,540),ctx=c.getContext("2d");const data=images.map(im=>{ctx.drawImage(im,0,0);im.close();return ctx.getImageData(0,0,960,540).data;});
            let darker=0,brighter=0,total=0;for(let y=130;y<440;y++)for(let x=220;x<850;x++){const p=(y*960+x)*4;
            const a=.2126*data[0][p]+.7152*data[0][p+1]+.0722*data[0][p+2],b=.2126*data[1][p]+.7152*data[1][p+1]+.0722*data[1][p+2];
            if(a-b>4)darker++;if(b-a>4)brighter++;total++;}return {darker,brighter,total};})()`);
          console.log("shadow image difference", difference);
          expect(difference.darker).toBeGreaterThan(100);
          expect(difference.darker).toBeGreaterThan(difference.brighter);
          await Bun.write("remote-results/earth-scenery-shadows.json", JSON.stringify(difference, null, 2));
        }
        reports.push({ place, stats, perf: await app.js("__bh.game.perf({gpu:false})") });
        if (place.name === "cevennes" || place.name === "tokyo") {
          await app.js(
            `(()=>{const r=__bh.renderer.earthScenery;window.__sceneParams=r.params.bind(r);r.params=()=>{const p=window.__sceneParams();if(window.__sceneVolumesOff)p[3]=0;return p;};return true;})()`,
          );
          for (const volumes of [false, true, false]) {
            await app.js(`(()=>{window.__sceneVolumesOff=${!volumes};__bh.touch();return true;})()`);
            await app.js("new Promise(r=>setTimeout(r,1000))");
            await app.js(
              "(()=>{__bh.game.perf();__bh.renderer.prof.every=1;__bh.renderer.prof.reset();window.__profT0=performance.now();return true;})()",
            );
            await app.waitFor(
              "__bh.renderer.prof.frames>=90 || (__bh.renderer.prof.frames>=12 && performance.now()-window.__profT0>45000)",
              60000,
            );
            reports.push({
              place,
              volumes,
              perf: await app.js("__bh.game.perf({gpu:false})"),
              completedDurations: await app.js("__bh.renderer.frameTelemetry.durationsMs"),
            });
          }
          await app.js("(()=>{__bh.renderer.earthScenery.params=window.__sceneParams;window.__sceneVolumesOff=false;return true;})()");
        }
        expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      }
      await Bun.write("remote-results/earth-scenery-world.json", JSON.stringify(reports, null, 2));
      await app.js('(()=>{__bh.settings.earthScenery="off";__bh.touch();return true;})()');
      await app.waitFor("__bh.renderer.earthScenery.stats().gpuBytes===64");
      await app.js("window.__sceneryTick=false");
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  600000,
);
test.skipIf(!E2E)(
  "eight storage buffers keep baseline renderer without world scenery",
  async () => {
    const app = await App.boot({
      hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`,
      width: 320,
      height: 240,
      initScript:
        'Object.defineProperty(GPUSupportedLimits.prototype,"maxStorageBuffersPerShaderStage",{get(){return 8;},configurable:true});',
    });
    try {
      expect(await app.js<boolean>("__bh.renderer.earthScenery.stats().supported")).toBe(false);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  180000,
);
test.skipIf(!E2E)(
  "high scenery renders in airplane cockpit with terrain and regional satellite pages",
  async () => {
    const app = await App.boot({ hash: "scene=game:artemis", width: 960, height: 540, tiles: true });
    try {
      await app.js(`(()=>{__bh.game.setDate("2021-06-21T12:00:00Z");__bh.game.set("flightMode","plane");__bh.game.glideTo("Bourget",6,.5,120);
        __bh.settings.earthSurface="satellite";__bh.settings.earthScenery="high";__bh.settings.earthTerrain=true;__bh.settings.earthClouds=0;
        __bh.settings.dynamicResolution=false;__bh.settings.realtimeSubsampling=2;__bh.settings.pixelRatio=1;
        __bh.game.set("shipMount","cockpit");__bh.freeze(true);__bh.step(0);__bh.resize();
        window.__sceneryTick=true;const tick=()=>{if(!window.__sceneryTick)return;__bh.touch();requestAnimationFrame(tick);};requestAnimationFrame(tick);return true;})()`);
      await app.waitFor(
        '__bh.renderer.earthScenery.stats().mode==="high" && __bh.renderer.earthScenery.stats().lat!==null && !__bh.renderer.earthScenery.pending',
        120000,
      );
      await app.waitFor("__bh.renderer.variantReady", 180000);
      await app.waitFor("__bh.renderer.earthTiles.pending===0 && !__bh.renderer.earthSurface.pending", 90000);
      await app.js(
        "(()=>{__bh.game.perf();__bh.renderer.prof.every=1;__bh.renderer.prof.reset();window.__profT0=performance.now();return true;})()",
      );
      await app.waitFor(
        "__bh.renderer.prof.frames>=60 || (__bh.renderer.prof.frames>=12 && performance.now()-window.__profT0>45000)",
        60000,
      );
      expect(await app.js<string>("__bh.camera.flightModeNow()")).toBe("plane");
      expect(await app.js<number>("__bh.renderer.earthScenery.stats().buildings")).toBeGreaterThan(100);
      const held = await app.js<{ gpuBytes: number; reach: number }>("__bh.renderer.earthScenery.stats()");
      expect(held.gpuBytes).toBe(sceneryBudget(held.reach));
      // (the trees: a world-fixed grid, one at most a cell — no count to cap)
      expect(await app.js<number>("__bh.renderer.earthScenery.stats().forestCells")).toBeGreaterThan(0);
      expect(await app.js<number>("__bh.renderer.earthScenery.stats().trees")).toBeLessThanOrEqual(
        await app.js<number>("__bh.renderer.earthScenery.stats().forestCells"),
      );
      // (the buildings capped as the worker caps them: 8 000 a unit of reach², high)
      expect(await app.js<number>("__bh.renderer.earthScenery.stats().buildings")).toBeLessThanOrEqual(
        Math.round(8000 * held.reach * held.reach),
      );
      await app.shot("remote-results/earth-scenery-plane-high.png");
      await Bun.write(
        "remote-results/earth-scenery-plane.json",
        JSON.stringify(
          await app.js("({stats:__bh.renderer.earthScenery.stats(),perf:__bh.game.perf({gpu:false}),adapter:__bh.renderer.adapter})"),
          null,
          2,
        ),
      );
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
      await app.js("window.__sceneryTick=false");
    } finally {
      app.close();
    }
  },
  500000,
);
