import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// The procedural forests on real places (src/system/forest.ts, src/shaders/forest.wgsl): the Vosges' mixed
// conifers, the Landes' pines, the Amazon's broadleaf and palms — each from the forest floor (a tripod) and
// from 300 m up. Every tree of the grid where WorldCover says trees grow (tens of thousands, no cap), their
// kinds by climate, the carved crowns near and the dappled shade under them, the frame's cost with the
// scenery on and off. Captures `forest-aaa-*.png`, measures in `forest-aaa.json`.
afterAll(stopServer);

const PLACES = [
  { name: "vosges", lat: 48.05, lon: 7.0, minTrees: 50000 },
  { name: "landes", lat: 44.2, lon: -0.9, minTrees: 50000 },
  { name: "amazon", lat: -3.12, lon: -60.0, minTrees: 50000 },
];

test.skipIf(!E2E)(
  "real forests: dense, by climate, carved near, dappled shade, their cost measured",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 1280, height: 720, tiles: true });
    const report: Record<string, unknown> = {};
    try {
      await app.js(
        `(()=>{window.__forestTick=true;const tick=()=>{if(!window.__forestTick)return;__bh.touch();requestAnimationFrame(tick);};requestAnimationFrame(tick);return true;})()`,
      );
      for (const place of PLACES) {
        // (mid-morning there: a low Sun through the trunks)
        const date = new Date(Date.UTC(2021, 5, 21, 9, 30) - (place.lon / 15) * 3600000).toISOString();
        for (const view of ["floor", "air"] as const) {
          const pose =
            view === "floor"
              ? `{body:"earth",at:[${place.lat},${place.lon}],heading:120,off:[0,8]}`
              : `{body:"earth",at:[${place.lat},${place.lon}],altKm:.3,look:"earth",off:[0,62]}`;
          await app.js(`(()=>{__bh.freeze(true);__bh.game.setDate(${JSON.stringify(date)});
            __bh.presets["Forest"]={...__bh.presets["Earth: the Blue Marble"],animate:false,ship:false,time:__bh.sim.time,
              earthScenery:"high",earthSceneryShadows:true,earthSurface:"satellite",earthTerrain:true,earthClouds:0,volumetricClouds:false,
              dynamicResolution:false,realtimeSubsampling:2,pixelRatio:1,temporalReprojection:true,pose:${pose}};
            __bh.preset("Forest");__bh.resize();return true;})()`);
          await app.waitFor(
            `__bh.renderer.earthScenery.stats().lat!==null && Math.abs(__bh.renderer.earthScenery.stats().lat-(${place.lat}))<.02 && !__bh.renderer.earthScenery.pending`,
            180000,
          );
          await app.waitFor("__bh.renderer.variantReady && __bh.renderer.earthTiles.pending===0", 180000);
          const stats = await app.js<{ trees: number; forestCells: number; forestCellM: number; workerMs: number; coverPixels: number }>(
            "__bh.renderer.earthScenery.stats()",
          );
          expect(stats.coverPixels).toBeGreaterThan(1000);
          expect(stats.trees).toBeGreaterThan(place.minTrees);
          expect(stats.trees).toBeLessThanOrEqual(stats.forestCells);
          expect(stats.forestCellM).toBeGreaterThan(6.5);
          expect(stats.forestCellM).toBeLessThan(7.5);
          await app.js("new Promise(r=>setTimeout(r,1500))");
          // the frame's cost with the forest and without the scenery at all (its share: the trees, the shadows)
          const frame = async () => {
            // (every frame profiled while measured: one in eight never reached 90 on the mini's 1920×1080 kiosk)
            await app.js("(()=>{__bh.renderer.prof.every=1;__bh.renderer.prof.reset();window.__profT0=performance.now();return true;})()");
            await app.waitFor(
              "__bh.renderer.prof.frames>=90 || (__bh.renderer.prof.frames>=12 && performance.now()-window.__profT0>45000)",
              90000,
            );
            return app.js<{ frameMs?: number; gpuMs?: number }>("__bh.game.perf()");
          };
          const withTrees = await frame();
          await app.shot(`remote-results/forest-aaa-${place.name}-${view}.png`);
          let shade: unknown = null;
          if (view === "floor") {
            // dappled shade: the same view without the scenery's shadows — the floor brighter in patches
            await app.js("(()=>{__bh.settings.earthSceneryShadows=false;__bh.touch();return true;})()");
            await app.js("new Promise(r=>setTimeout(r,2500))");
            await app.shot(`remote-results/forest-aaa-${place.name}-floor-noshadow.png`);
            await app.js("(()=>{__bh.settings.earthSceneryShadows=true;__bh.touch();return true;})()");
            const shots = await Promise.all(
              ["floor", "floor-noshadow"].map(async (v) =>
                Buffer.from(await Bun.file(`remote-results/forest-aaa-${place.name}-${v}.png`).arrayBuffer()).toString("base64"),
              ),
            );
            // (the shots at their own size — the mini's kiosk draws 1920×1080 —, sampled as at 1280×720)
            shade =
              await app.js(`(async()=>{const images=await Promise.all(${JSON.stringify(shots)}.map(async b=>createImageBitmap(await(await fetch("data:image/png;base64,"+b)).blob())));
              const W=images[0].width,H=images[0].height,c=new OffscreenCanvas(W,H),ctx=c.getContext("2d");const data=images.map(im=>{ctx.drawImage(im,0,0);im.close();return ctx.getImageData(0,0,W,H).data;});
              let darker=0,total=0;const step=Math.max(2,Math.round(2*W/1280));for(let y=H>>1;y<H;y+=step)for(let x=0;x<W;x+=step){const p=(y*W+x)*4;
              const a=.2126*data[0][p]+.7152*data[0][p+1]+.0722*data[0][p+2],b=.2126*data[1][p]+.7152*data[1][p+1]+.0722*data[1][p+2];
              if(b-a>6)darker++;total++;}return {darker,total};})()`);
            expect((shade as { darker: number }).darker).toBeGreaterThan(500);
          }
          await app.js("(()=>{__bh.settings.earthScenery='off';__bh.touch();return true;})()");
          await app.js("new Promise(r=>setTimeout(r,1500))");
          const without = await frame();
          await app.js("(()=>{__bh.settings.earthScenery='high';__bh.touch();return true;})()");
          await app.waitFor("!__bh.renderer.earthScenery.pending && __bh.renderer.earthScenery.active", 180000);
          report[`${place.name}-${view}`] = { stats, withTrees, without, shade };
          await Bun.write("remote-results/forest-aaa.json", JSON.stringify(report, null, 2));
        }
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
      await app.js("window.__forestTick=false");
    } finally {
      app.close();
    }
  },
  1800000,
);
