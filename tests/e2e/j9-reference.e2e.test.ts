import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// J9-0: the near forest at a known height over loaded WGS84 ground, with and without near-tree rays.
// Three fixed views (Maures floor, Maures low flight height, Chamonix slope), A/B/A in each. No craft is flown.
// Strict readiness, actual render dimensions and samples recorded; missing data fail instead of being ignored.
// Duration: ~6 min on kerr-mini.
// Done when: three views measured and captured A/B/A, trees present, raster active, no GPU or console error.
afterAll(stopServer);
const OUT = process.env.J9_OUT ?? "remote-results/j9-reference";
const VIEWS = [
  { name: "maures-floor", lat: 43.19, lon: 6.25, agl: 3, heading: 60, pitch: 5 },
  { name: "maures-low", lat: 43.19, lon: 6.25, agl: 60, heading: 60, pitch: -12 },
  { name: "chamonix-slope", lat: 45.92, lon: 6.87, agl: 5, heading: 100, pitch: 0 },
];

test.skipIf(!E2E)(
  "J9 near forest reference: loaded ground, strict readiness, A/B/A",
  async () => {
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    const report: unknown[] = [];
    try {
      app.steps(["settings", ...VIEWS.map((v) => v.name), "checks"]);
      app.estimate(360);
      await app.step("settings");
      await app.js(`(() => {
      __bh.freeze(true);
      Object.assign(__bh.settings, { traffic: false, autosave: false, weather: "fair", earthClouds: 0,
        wind: 0, dof: false, motionBlur: 0, dynamicResolution: false, pixelRatio: 1, fpsCap: 30, earthScenery: "high" });
      __bh.game.setDate("2026-07-10T09:30:00Z"); __bh.resize(); return true;
    })()`);
      await app.stepDone("fixed weather, wind and quality; cap 30");
      for (const v of VIEWS) {
        await app.step(v.name);
        // First load the place on a tripod; never mistake an ellipsoidal height for AGL.
        expect(await app.js(`__bh.viewAt(${v.lat}, ${v.lon}, {tripod:true,heading:${v.heading},pitch:${v.pitch},fov:50})`)).toBeNull();
        await app.dataSettled(`${v.name}: ground`, { maxMs: 180_000 });
        let ground = await app.js<number>(`__bh.sys.groundAt(${v.lat},${v.lon})`);
        const start = Date.now();
        for (;;) {
          await app.progress("checking loaded ground height", JSON.stringify({ ground }));
          await Bun.sleep(3000);
          const next = await app.js<number>(`__bh.sys.groundAt(${v.lat},${v.lon})`);
          if (Math.abs(next - ground) < 0.25) {
            ground = next;
            break;
          }
          ground = next;
          if (Date.now() - start > 60_000) throw new Error(`${v.name}: ground still changing`);
        }
        expect(Number.isFinite(ground)).toBe(true);
        expect(
          await app.js(`__bh.viewAt(${v.lat},${v.lon},{altM:${ground + v.agl},heading:${v.heading},pitch:${v.pitch},fov:50})`),
        ).toBeNull();
        await app.dataSettled(v.name, { maxMs: 180_000 });
        await app.exposureSettled();
        const trees = await app.js<number>("__bh.renderer.earthScenery.stats().trees");
        expect(trees).toBeGreaterThan(0);
        for (const [index, rays] of [true, false, true].entries()) {
          await app.progress(`A/B/A ${index + 1}/3 · rays ${rays}`, JSON.stringify({ ground, trees }));
          await app.js(`(() => { __bh.renderer.nearTreesRays = ${rays}; __bh.touch(); return true; })()`);
          // Only settling, not a readiness shortcut: all data were required above.
          await Bun.sleep(2000);
          const result = await app.js<{
            gpu: number[];
            raster: boolean;
            near: boolean;
            width: number;
            height: number;
            scale: number;
          }>(`(async () => {
          const R=__bh.renderer, gpu=[]; let last=R.completedFrames; const start=performance.now();
          while(performance.now()-start<12000){ __bh.touch(); await new Promise(requestAnimationFrame);
            if(R.completedFrames!==last){const n=R.completedFrames-last;last=R.completedFrames;gpu.push(...R.completedDurations.slice(-n));} }
          return {gpu,raster:R.rasterPrimaryNow,near:R.nearTreesNow,width:document.querySelector("#view").width,height:document.querySelector("#view").height,scale:R.live.width/document.querySelector("#view").width,internalWidth:R.live.width,internalHeight:R.live.height,tier:R.tier.level,rasterRate:R.rasterRate};
        })()`);
          expect(result.raster).toBe(true);
          expect(result.near).toBe(rays);
          expect(result.gpu.length).toBeGreaterThan(20);
          expect(result.gpu.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
          const ordered = [...result.gpu].sort((a, b) => a - b);
          const entry = {
            view: v,
            ground,
            trees,
            index,
            rays,
            ...result,
            p50: ordered[Math.floor(ordered.length * 0.5)],
            p95: ordered[Math.floor(ordered.length * 0.95)],
          };
          report.push(entry);
          console.log(JSON.stringify({ ...entry, gpu: `${result.gpu.length} samples in samples.json` }));
          await Bun.write(`${OUT}/samples.json`, JSON.stringify(report, null, 2));
          await app.shot(`${OUT}/${v.name}-${index}-${rays ? "rays" : "smooth"}.png`);
        }
        await app.stepDone(`${v.name}: trees ${trees}, A/B/A captured`);
      }
      await app.step("checks");
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
      await app.stepDone("no GPU or console error");
    } finally {
      await app.js("(() => {__bh.renderer.nearTreesRays=true;return true;})()").catch(() => {});
      app.close();
    }
  },
  900_000,
);
