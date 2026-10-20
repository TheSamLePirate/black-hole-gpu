// The experimental raster hint (docs/progress/terrestrial-aaa/P1d.md): the tracer's ground rays start from the raster
// patch's distances (`earthTerrainRasterUse`). The same frames with it off and on, alternated: the trace pass's GPU time,
// and the images compared pixel by pixel (the hint verifies the ground by two reads of the full relief, so an image
// that differs is a ray whose ground was not where the patch said, and the march was not done as before).
// Captures remote-results/hint-<pose>-<off|on>.png; measures remote-results/terrain-raster-hint.json.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

afterAll(stopServer);

const POSES = [
  { name: "nadir-900m", altKm: 0.9, off: [0, 0] },
  { name: "oblique-900m", altKm: 0.9, off: [0, 35] },
  { name: "oblique-3km", altKm: 3, off: [0, 55] },
  { name: "oblique-10km", altKm: 10, off: [0, 65] },
];
const LEVEL = Number(process.env.HINT_LEVEL ?? 2);

test.skipIf(!E2E)(
  "the raster hint: the same image, the ground found from the patch",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540 });
    try {
      await app.js(
        `(() => { window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`,
      );
      const rows: unknown[] = [];
      for (const pose of POSES) {
        await app.js(`(() => { __bh.game.setDate("2021-06-21T16:00:00Z");
          __bh.presets["Hint"] = {...__bh.presets["Earth: the Blue Marble"], animate:false, ship:false, time:__bh.sim.time, earthClouds:0, volumetricClouds:false,
            earthSurface:"off", earthScenery:"off", dynamicResolution:false, realtimeSubsampling:1, pixelRatio:1, temporalReprojection:false, fpsCap:0,
            earthTerrainCache:false, earthTerrainRasterLevel:${LEVEL}, earthTerrainRasterView:"off", earthTerrainRasterUse:false,
            pose:{body:"earth", at:[28.6155,-80.6945], altKm:${pose.altKm}, look:"earth", off:${JSON.stringify(pose.off)}}};
          __bh.preset("Hint"); __bh.resize(); return true; })()`);
        const trace: Record<string, number[]> = { off: [], on: [] };
        const images: Record<string, ReturnType<typeof readPng>> = {};
        let stats: Record<string, unknown> = {};
        for (const round of [0, 1, 2]) {
          for (const mode of ["off", "on"]) {
            await app.js(`(() => { __bh.settings.earthTerrainRasterUse=${mode === "on"}; __bh.touch(); return true; })()`);
            await app.waitFor("__bh.renderer.variantReady", 300_000);
            if (mode === "on")
              await app.waitFor(
                `__bh.renderer.terrainRasterStats.reason === "pilot" && __bh.renderer.terrainRasterStats.encodedFrames > 5`,
                120_000,
              );
            const w = await app.js<number>("__bh.renderer.completedFrames");
            await app.waitFor(`__bh.renderer.completedFrames >= ${w + 40}`, 120_000);
            await app.js("(() => { __bh.game.perf(); __bh.renderer.prof.every = 1; __bh.renderer.prof.reset(); return true; })()");
            await app.waitFor("__bh.renderer.prof.frames >= 50", 120_000);
            const ms = await app.js<number>(`__bh.renderer.prof.table().find((p) => p.label === "trace")?.ms`);
            if (round > 0) trace[mode]!.push(ms);
            if (round === 2) {
              const f = `remote-results/hint-${pose.name}-L${LEVEL}-${mode}.png`;
              await app.shot(f);
              images[mode] = readPng(new Uint8Array(require("node:fs").readFileSync(f)));
              if (mode === "on") stats = await app.js("({ ...__bh.renderer.terrainRasterStats, key: __bh.renderer.featureKey })");
            }
          }
        }
        // (the frame-to-frame noise of the reference itself: a second capture with the hint off)
        await app.js(`(() => { __bh.settings.earthTerrainRasterUse=false; __bh.touch(); return true; })()`);
        await app.waitFor("__bh.renderer.variantReady", 300_000);
        const w2 = await app.js<number>("__bh.renderer.completedFrames");
        await app.waitFor(`__bh.renderer.completedFrames >= ${w2 + 40}`, 120_000);
        const f2 = `remote-results/hint-${pose.name}-L${LEVEL}-off2.png`;
        await app.shot(f2);
        images.off2 = readPng(new Uint8Array(require("node:fs").readFileSync(f2)));
        // (ground march steps and heights read per pixel, each way: the share of rays the hint saved the march)
        const work: Record<string, number[]> = {};
        for (const mode of ["off", "on"]) {
          await app.js(
            `(() => { __bh.settings.earthTerrainRasterUse=${mode === "on"}; __bh.renderer.costView = 14; __bh.touch(); return true; })()`,
          );
          await app.waitFor("__bh.renderer.variantReady", 300_000);
          const w3 = await app.js<number>("__bh.renderer.completedFrames");
          await app.waitFor(`__bh.renderer.completedFrames >= ${w3 + 30}`, 120_000);
          const c = await app.js<{ mean: number }[]>("__bh.renderer.costStats()");
          work[mode] = c.map((x) => +x.mean.toFixed(1));
        }
        await app.js(`(() => { __bh.renderer.costView = 0; __bh.settings.earthTerrainRasterUse=false; return true; })()`);
        const diff = (a: ReturnType<typeof readPng>, b: ReturnType<typeof readPng>) => {
          let sum = 0,
            max = 0,
            big = 0,
            n = 0;
          for (let y = 60; y < a.height; y++)
            for (let x = 0; x < a.width; x++)
              for (let c = 0; c < 3; c++) {
                const i = (y * a.width + x) * a.channels + c;
                const d = Math.abs(a.data[i]! - b.data[i]!);
                sum += d;
                if (d > max) max = d;
                if (d > 24) big++;
                n++;
              }
          return { mean: sum / n, max, share24: big / n };
        };
        const noise = diff(images.off!, images.off2!);
        const { mean: sum2, max, share24: big2 } = diff(images.off!, images.on!);
        const sum = sum2,
          big = big2;
        const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)] ?? 0;
        const row = {
          pose: pose.name,
          level: LEVEL,
          traceOff: trace.off,
          traceOn: trace.on,
          medianOff: med(trace.off!),
          medianOn: med(trace.on!),
          meanAbsDiff: sum,
          maxDiff: max,
          share24: big,
          noise,
          work,
          stats,
        };
        rows.push(row);
        console.log(JSON.stringify({ ...row, stats: undefined }));
      }
      await Bun.write(`remote-results/terrain-raster-hint-L${LEVEL}.json`, JSON.stringify(rows, null, 2));
      for (const r of rows as { stats: Record<string, unknown>; meanAbsDiff: number }[]) {
        expect(r.stats.error).toBeFalsy();
        expect(r.stats.reason).toBe("pilot");
      }
    } finally {
      await app.close();
    }
  },
  1_800_000,
);
