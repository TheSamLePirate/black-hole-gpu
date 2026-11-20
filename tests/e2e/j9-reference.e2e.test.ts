import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { TREE_SURFACE_PROBE, treeSurfaceProbe, TREE_OCCLUSION_COMPARE, TREE_OCCLUSION_PICK } from "./lib/tree-surface-probe";

// J9-0: the near forest at a known height over loaded WGS84 ground, with and without near-tree rays.
// Three fixed views (Maures floor, Maures low flight height, Chamonix slope), A/B/A in each. No craft is flown.
// Strict readiness, actual render dimensions and samples recorded; missing data fail instead of being ignored.
// Duration: ~6 min on kerr-mini.
// Done when: three views measured and captured A/B/A, trees present, raster active, no GPU or console error.
afterAll(stopServer);
const OUT = process.env.J9_OUT ?? "remote-results/j9-reference";
const GEOMETRY = process.env.J9_GEOMETRY === "1";
// Diagnostic reach, recorded with every sample; the product prototype keeps its 80 m default.
const REACH = Number(process.env.J9_REACH ?? 80);
if (!Number.isFinite(REACH) || REACH <= 0 || REACH > 1000) throw Error("J9_REACH must be in (0, 1000] metres");
const VIEWS = [
  { name: "maures-floor", lat: 43.19, lon: 6.25, agl: 3, heading: 60, pitch: 5 },
  { name: "maures-low", lat: 43.19, lon: 6.25, agl: 60, heading: 60, pitch: -12 },
  { name: "chamonix-slope", lat: 45.92, lon: 6.87, agl: 5, heading: 100, pitch: 0 },
]
  .map((v) => ({ ...v, pitch: process.env.J9_PITCH ? Number(process.env.J9_PITCH) : v.pitch }))
  .filter((v) => !process.env.J9_CASES || process.env.J9_CASES.split(",").includes(v.name));

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
        if (GEOMETRY) {
          await app.js("(() => {__bh.renderer.nearTreeGeometryOn=true;__bh.touch();return true;})()");
          await app.waitFor("__bh.renderer.sceneryRaster?.nearTrees.ready || __bh.renderer.sceneryRaster?.nearTrees.error", 120_000);
          const error = await app.js<string | null>("__bh.renderer.sceneryRaster.nearTrees.error");
          if (error) throw Error(error);
          await app.js(`(() => {__bh.renderer.sceneryRaster.nearTrees.reachM=${REACH};return true;})()`);
        }
        const trees = await app.js<number>("__bh.renderer.earthScenery.stats().trees");
        expect(trees).toBeGreaterThan(0);
        for (const [index, rays] of [true, false, true].entries()) {
          await app.progress(
            `A/B/A ${index + 1}/3 · ${GEOMETRY ? `geometry ${!rays}` : `rays ${rays}`}`,
            JSON.stringify({ ground, trees }),
          );
          await app.js(
            `(() => { __bh.renderer.nearTreesRays = ${GEOMETRY ? true : rays}; __bh.renderer.nearTreeGeometryOn = ${GEOMETRY && !rays}; __bh.touch(); return true; })()`,
          );
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
          expect(result.near).toBe(GEOMETRY ? true : rays);
          expect(result.gpu.length).toBeGreaterThan(20);
          expect(result.gpu.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
          const ordered = [...result.gpu].sort((a, b) => a - b);
          const counts = GEOMETRY
            ? await app.js<{ instances: number[]; overflow: number }>("__bh.renderer.sceneryRaster.nearTrees.readCounts()")
            : null;
          if (counts) {
            expect(counts.overflow).toBe(0);
            if (rays) expect(counts.instances.reduce((a, b) => a + b, 0)).toBe(0);
            else if (v.agl < 10) expect(counts.instances.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
          }
          const surface =
            GEOMETRY && !rays && v.agl < 10
              ? await app.js<{ aaDelta: number; pixels: number; validDepth: number; identified: number; sky: number }>(TREE_SURFACE_PROBE)
              : null;
          if (surface) {
            expect(surface.aaDelta).toBe(0);
            expect(surface.pixels).toBeGreaterThan(0);
            expect(surface.validDepth).toBe(surface.pixels);
            expect(surface.identified).toBe(surface.pixels);
          }
          const entry = {
            surface,
            geometry: GEOMETRY && !rays,
            reachM: GEOMETRY ? REACH : null,
            counts,
            view: v,
            ground,
            trees,
            index,
            rays: GEOMETRY ? true : rays,
            ...result,
            p50: ordered[Math.floor(ordered.length * 0.5)],
            p95: ordered[Math.floor(ordered.length * 0.95)],
          };
          report.push(entry);
          console.log(JSON.stringify({ ...entry, gpu: `${result.gpu.length} samples in samples.json` }));
          await Bun.write(`${OUT}/samples.json`, JSON.stringify(report, null, 2));
          await app.shot(`${OUT}/${v.name}-${index}-${rays ? "rays" : GEOMETRY ? "geometry" : "smooth"}.png`);
        }
        if (GEOMETRY && v.agl < 10) {
          if (process.env.J9_OCCLUSION === "1") {
            await app.js("(() => {__bh.renderer.nearTreeGeometryOn=true;__bh.touch();return true;})()");
            await Bun.sleep(1000);
            const complete = await app.js<{ trees: [number, number][]; aaDelta: number }>(treeSurfaceProbe("complete"));
            const candidate = await app.js<{ id: number; visibleGaps: number }>(TREE_OCCLUSION_PICK);
            const frontId = candidate.id;
            console.log(JSON.stringify({ occlusionCandidate: candidate }));
            expect(complete.aaDelta).toBe(0);
            await app.js("(() => {__j9Surfaces.front=__j9Surfaces.complete;__j9Surfaces.back=__j9Surfaces.complete;return true;})()");
            const aa = await app.js<{ wrongDepth: number; wrongHole: number }>(TREE_OCCLUSION_COMPARE);
            expect(aa.wrongDepth + aa.wrongHole).toBe(0);
            await app.js(`(() => {__bh.renderer.sceneryRaster.nearTrees.debugTreeId=${-frontId};return true;})()`);
            await Bun.sleep(1000);
            await app.js(treeSurfaceProbe("front"));
            await app.shot(`${OUT}/${v.name}-front-only.png`);
            await app.js(`(() => {__bh.renderer.sceneryRaster.nearTrees.debugTreeId=${frontId};return true;})()`);
            await Bun.sleep(1000);
            await app.js(treeSurfaceProbe("back"));
            await app.shot(`${OUT}/${v.name}-front-hidden.png`);
            const comparison = await app.js<{ overlap: number; wrongDepth: number; holes: number; wrongHole: number }>(
              TREE_OCCLUSION_COMPARE,
            );
            console.log(JSON.stringify({ frontId, occlusion: comparison }));
            await Bun.write(`${OUT}/${v.name}-occlusion.json`, JSON.stringify({ frontId, ...comparison }, null, 2));
            expect(comparison.overlap).toBeGreaterThan(0);
            expect(comparison.wrongDepth).toBe(0);
            expect(comparison.holes).toBeGreaterThan(0);
            expect(comparison.wrongHole).toBe(0);
            // Positive witness: move every complete-scene distance one metre away; the comparison must reject it.
            await app.js(
              "(() => {for(const [i,id] of __j9Surfaces.complete.ids.entries())if(id)__j9Surfaces.complete.distances[i]+=1;return true;})()",
            );
            const fault = await app.js<{ wrongDepth: number; wrongHole: number }>(TREE_OCCLUSION_COMPARE);
            expect(fault.wrongDepth + fault.wrongHole).toBeGreaterThan(0);
            await app.js("(() => {__bh.renderer.sceneryRaster.nearTrees.debugTreeId=0;delete globalThis.__j9Surfaces;return true;})()");
          }
          await app.js(
            "(() => {const r=__bh.renderer;r.nearTreeGeometryOn=true;r.sceneryRaster.nearTrees.capacity=1;__bh.touch();return true;})()",
          );
          await Bun.sleep(1500);
          const witness = await app.js<{ instances: number[]; overflow: number }>("__bh.renderer.sceneryRaster.nearTrees.readCounts()");
          expect(witness.overflow).toBeGreaterThan(0);
          console.log(JSON.stringify({ overflowWitness: witness }));
          await app.js("(() => {__bh.renderer.sceneryRaster.debugSkip=1;return true;})()");
          await Bun.sleep(1000);
          const missing = await app.js<{ pixels: number }>(TREE_SURFACE_PROBE);
          expect(missing.pixels).toBe(0);
          console.log(JSON.stringify({ missingSurfaceWitness: missing.pixels }));
          await app.js("(() => {__bh.renderer.sceneryRaster.debugSkip=0;return true;})()");
          await app.js("(() => {__bh.renderer.sceneryRaster.nearTrees.capacity=4096;return true;})()");
        }
        await app.stepDone(`${v.name}: trees ${trees}, A/B/A captured`);
      }
      await app.step("checks");
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
      await app.stepDone("no GPU or console error");
    } finally {
      await app
        .js(
          "(() => {__bh.renderer.nearTreesRays=true;__bh.renderer.nearTreeGeometryOn=false;if(__bh.renderer.sceneryRaster)__bh.renderer.sceneryRaster.nearTrees.debugTreeId=0;delete globalThis.__j9Surfaces;return true;})()",
        )
        .catch(() => {});
      app.close();
    }
  },
  900_000,
);
