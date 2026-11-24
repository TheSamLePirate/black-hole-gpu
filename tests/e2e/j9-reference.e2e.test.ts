import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import {
  TREE_OBJECT_COMPARE,
  TREE_OBJECT_PICK,
  TREE_OCCLUSION_COMPARE,
  TREE_OCCLUSION_PICK,
  TREE_SHADOW_COMPARE,
  TREE_SURFACE_PROBE,
  TREE_CONTACT_PROBE,
  treeShadowProbe,
  treeSurfaceProbe,
} from "./lib/tree-surface-probe";

// J9-0: the near forest at a known height over loaded WGS84 ground, the near trees' geometry off (their proxies cut to their
// crowns — the rays' path retired on 24 Nov 2026: this A is no longer J9-0's) and on.
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
        // (cut: the near geometry off — its crowns' cut proxies, the interim the game shows while the asset loads)
        for (const [index, cut] of [true, false, true].entries()) {
          await app.progress(`A/B/A ${index + 1}/3 · geometry ${!cut}`, JSON.stringify({ ground, trees }));
          await app.js(`(() => { __bh.renderer.nearTreeGeometryOn = ${!cut}; __bh.touch(); return true; })()`);
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
          return {gpu,raster:R.rasterPrimaryNow,near:R.nearTreeGeometryOn&&!!R.sceneryRaster?.nearTrees.ready,width:document.querySelector("#view").width,height:document.querySelector("#view").height,scale:R.live.width/document.querySelector("#view").width,internalWidth:R.live.width,internalHeight:R.live.height,tier:R.tier.level,rasterRate:R.rasterRate};
        })()`);
          expect(result.raster).toBe(true);
          expect(result.near).toBe(!cut);
          expect(result.gpu.length).toBeGreaterThan(20);
          expect(result.gpu.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
          const ordered = [...result.gpu].sort((a, b) => a - b);
          const counts = GEOMETRY
            ? await app.js<{ instances: number[]; lod0: number[]; lod1: number[]; proxies: number[]; overflow: number }>(
                "__bh.renderer.sceneryRaster.nearTrees.readCounts()",
              )
            : null;
          if (counts) {
            expect(counts.overflow).toBe(0);
            if (cut) {
              expect(counts.instances.reduce((a, b) => a + b, 0)).toBe(0);
              if (v.agl < 10) expect(counts.proxies.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
            } else if (v.agl < 10) {
              expect(counts.instances.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
              expect(counts.lod0.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
              expect(counts.lod1.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
            }
          }
          const surface =
            GEOMETRY && !cut && v.agl < 10
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
            geometry: !cut,
            reachM: GEOMETRY ? REACH : null,
            counts,
            view: v,
            ground,
            trees,
            index,
            cutProxies: cut,
            ...result,
            p50: ordered[Math.floor(ordered.length * 0.5)],
            p95: ordered[Math.floor(ordered.length * 0.95)],
          };
          report.push(entry);
          console.log(JSON.stringify({ ...entry, gpu: `${result.gpu.length} samples in samples.json` }));
          await Bun.write(`${OUT}/samples.json`, JSON.stringify(report, null, 2));
          await app.shot(`${OUT}/${v.name}-${index}-${cut ? "cut" : "geometry"}.png`);
        }
        if (GEOMETRY && v.agl < 10) {
          if (process.env.J9_OCCLUSION === "1" && (v.name === "maures-floor" || process.env.J9_CASES === v.name)) {
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
          if (process.env.J9_OBJECT_OCCLUSION === "1" && (v.name === "chamonix-slope" || process.env.J9_CASES === v.name)) {
            await app.js("(() => {__bh.renderer.nearTreeGeometryOn=true;__bh.touch();return true;})()");
            await Bun.sleep(1000);
            const complete = await app.js<{ trees: [number, number][]; aaDelta: number }>(treeSurfaceProbe("complete"));
            const candidate = await app.js<{ id: number; visibleObjectGaps: number }>(TREE_OBJECT_PICK);
            const frontId = candidate.id;
            console.log(JSON.stringify({ objectOcclusionCandidate: candidate }));
            expect(complete.aaDelta).toBe(0);
            await app.js("(() => {__j9Surfaces.front=__j9Surfaces.complete;__j9Surfaces.back=__j9Surfaces.complete;return true;})()");
            const aa = await app.js<{ wrongDepth: number; wrongHole: number }>(TREE_OBJECT_COMPARE);
            expect(aa.wrongDepth + aa.wrongHole).toBe(0);
            await app.js(`(() => {__bh.renderer.sceneryRaster.nearTrees.debugTreeId=${-frontId};return true;})()`);
            await Bun.sleep(1000);
            await app.js(treeSurfaceProbe("front"));
            await app.shot(`${OUT}/${v.name}-object-front-only.png`);
            await app.js(`(() => {__bh.renderer.sceneryRaster.nearTrees.debugTreeId=${frontId};return true;})()`);
            await Bun.sleep(1000);
            await app.js(treeSurfaceProbe("back"));
            await app.shot(`${OUT}/${v.name}-object-front-hidden.png`);
            const comparison = await app.js<{
              overlap: number;
              wrongDepth: number;
              holes: number;
              wrongHole: number;
              codes: number[];
            }>(TREE_OBJECT_COMPARE);
            console.log(JSON.stringify({ frontId, objectOcclusion: comparison }));
            await Bun.write(`${OUT}/${v.name}-object-occlusion.json`, JSON.stringify({ frontId, ...comparison }, null, 2));
            expect(comparison.overlap).toBeGreaterThan(0);
            expect(comparison.wrongDepth).toBe(0);
            expect(comparison.holes).toBeGreaterThan(0);
            expect(comparison.wrongHole).toBe(0);
            await app.js(
              "(() => {for(let i=0;i<__j9Surfaces.complete.distances.length;i++){if(__j9Surfaces.complete.ids[i])__j9Surfaces.complete.distances[i]+=1;if(__j9Surfaces.complete.objCodes[i])__j9Surfaces.complete.objDistances[i]+=1;}return true;})()",
            );
            const fault = await app.js<{ wrongDepth: number; wrongHole: number }>(TREE_OBJECT_COMPARE);
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
          if (process.env.J9_TRANSITIONS === "1") {
            await app.js(
              "(() => {__bh.renderer.nearTreeGeometryOn=true;__bh.renderer.treeWindOn=false;__bh.freeze(true);__bh.touch();return true;})()",
            );
            await Bun.sleep(1000);
            // 1. Stationary treeWindOn=false negative witness for motion vectors, then treeWindOn=true positive witness with advancing clock.
            const calmProbe = await app.js<{
              pixels: number;
              leafPixels: number;
              barkPixels: number;
              motionValid: number;
              motionMoving: number;
            }>(TREE_SURFACE_PROBE);
            expect(calmProbe.pixels).toBeGreaterThan(0);
            expect(calmProbe.leafPixels).toBeGreaterThan(0);
            expect(calmProbe.motionValid).toBe(0);
            expect(calmProbe.motionMoving).toBe(0);
            await app.js("(() => {__bh.settings.wind=1.5;__bh.renderer.treeWindOn=true;__bh.touch();return true;})()");
            await Bun.sleep(800);
            const windProbe = await app.js<{ motionValid: number; motionMoving: number }>(TREE_SURFACE_PROBE);
            await app.shot(`${OUT}/${v.name}-wind.png`);
            await app.js("(() => {__bh.settings.wind=0;__bh.touch();return true;})()");
            expect(windProbe.motionValid).toBeGreaterThan(0);
            expect(windProbe.motionMoving).toBeGreaterThan(0);
            // 2. Seasons: autumn colour & winter bare deciduous crowns (leaf cards discarded, 3D branches exposed).
            await app.js('(() => {__bh.game.setDate("2026-10-25T09:30:00Z");__bh.touch();return true;})()');
            await Bun.sleep(1200);
            await app.shot(`${OUT}/${v.name}-autumn.png`);
            await app.js('(() => {__bh.game.setDate("2026-01-15T09:30:00Z");__bh.touch();return true;})()');
            await Bun.sleep(1200);
            const winterProbe = await app.js<{ pixels: number; leafPixels: number; barkPixels: number }>(TREE_SURFACE_PROBE);
            await app.shot(`${OUT}/${v.name}-winter.png`);
            expect(winterProbe.pixels).toBeGreaterThan(0);
            expect(winterProbe.barkPixels).toBeGreaterThan(calmProbe.barkPixels);
            expect(winterProbe.leafPixels).toBeLessThan(calmProbe.leafPixels);
            await app.js('(() => {__bh.game.setDate("2026-07-10T09:30:00Z");__bh.touch();return true;})()');
            await Bun.sleep(1000);
            // 3. Underside crown view (+6 deg pitch from 0.8 m AGL at the trunk base) and approach/recede hysteresis across the LOD boundary.
            await app.js(`__bh.viewAt(${v.lat},${v.lon},{altM:${ground + 0.8},heading:${v.heading},pitch:${v.pitch + 6},fov:50})`);
            await Bun.sleep(1000);
            const underProbe = await app.js<{ pixels: number; validDepth: number; identified: number }>(TREE_SURFACE_PROBE);
            await app.shot(`${OUT}/${v.name}-underside.png`);
            expect(underProbe.pixels).toBeGreaterThan(0);
            expect(underProbe.validDepth).toBe(underProbe.pixels);
            expect(underProbe.identified).toBe(underProbe.pixels);
            // (the hand-over's band is ±5 % of the reach about each tree's limit — 76…84 m at 80 m —, the LOD's 0.50…0.56 of it: the
            // camera brought to one place from 12 m behind, then from 12 m ahead, along its heading — each crossing both bands for
            // the trees about them —; the per-tree state keeps what it had in the band: strictly more geometry and LOD 0 coming
            // back than going in, whichever way the camera last moved. Waits past the 0.3 s crossfade)
            const along = (m: number) => {
              const h = (v.heading * Math.PI) / 180;
              return `${v.lat + (m * Math.cos(h)) / 111_320},${v.lon + (m * Math.sin(h)) / (111_320 * Math.cos((v.lat * Math.PI) / 180))}`;
            };
            const hold = `altM:${ground + v.agl},heading:${v.heading},pitch:${v.pitch},fov:50`;
            await app.js(`__bh.viewAt(${along(-12)},{${hold}})`);
            await Bun.sleep(800);
            await app.js(`__bh.viewAt(${v.lat},${v.lon},{${hold}})`);
            await Bun.sleep(800);
            const approachCounts = await app.js<{ instances: number[]; lod0: number[]; lod1: number[]; overflow: number }>(
              "__bh.renderer.sceneryRaster.nearTrees.readCounts()",
            );
            await app.js(`__bh.viewAt(${along(12)},{${hold}})`);
            await Bun.sleep(800);
            await app.js(`__bh.viewAt(${v.lat},${v.lon},{${hold}})`);
            await Bun.sleep(800);
            const recedeCounts = await app.js<{ instances: number[]; lod0: number[]; lod1: number[]; overflow: number }>(
              "__bh.renderer.sceneryRaster.nearTrees.readCounts()",
            );
            await app.js(`__bh.viewAt(${v.lat},${v.lon},{altM:${ground + v.agl},heading:${v.heading},pitch:${v.pitch},fov:50})`);
            await Bun.sleep(800);
            expect(approachCounts.overflow).toBe(0);
            expect(recedeCounts.overflow).toBe(0);
            const approachTotal = approachCounts.instances.reduce((a, b) => a + b, 0);
            const recedeTotal = recedeCounts.instances.reduce((a, b) => a + b, 0);
            const approachLod0 = approachCounts.lod0.reduce((a, b) => a + b, 0);
            const recedeLod0 = recedeCounts.lod0.reduce((a, b) => a + b, 0);
            // (strict: equal counts would pass with no hysteresis at all — review of 24 Nov 2026)
            expect(recedeTotal).toBeGreaterThan(approachTotal);
            expect(recedeLod0).toBeGreaterThan(approachLod0);
            const transitions = {
              calm: {
                pixels: calmProbe.pixels,
                leafPixels: calmProbe.leafPixels,
                barkPixels: calmProbe.barkPixels,
                motionValid: calmProbe.motionValid,
                motionMoving: calmProbe.motionMoving,
              },
              wind: windProbe,
              winter: winterProbe,
              underside: underProbe,
              approachTotal,
              recedeTotal,
              approachLod0,
              recedeLod0,
            };
            console.log(JSON.stringify({ transitions }));
            await Bun.write(`${OUT}/${v.name}-transitions.json`, JSON.stringify(transitions, null, 2));
          }
          if (process.env.J9_SHADOWS === "1") {
            // 1. Proxy shadow map vs alpha-cut 3D near tree shadow map (layer 0 of tsmTex).
            await app.js(
              "(() => {__bh.renderer.nearTreeGeometryOn=false;__bh.renderer.sceneryRaster.nearTrees.debugTreeId=0;__bh.freeze(true);__bh.touch();return true;})()",
            );
            await Bun.sleep(800);
            const proxyShadow = await app.js<{
              aaDelta: number;
              totalOccluded: number;
              nearOccluded: number;
              farOccluded: number;
              tsmDraws: number;
            }>(treeShadowProbe("proxy"));
            expect(proxyShadow.aaDelta).toBe(0);
            expect(proxyShadow.nearOccluded).toBeGreaterThan(0);
            expect(proxyShadow.farOccluded).toBeGreaterThan(0);

            await app.js("(() => {__bh.renderer.nearTreeGeometryOn=true;__bh.touch();return true;})()");
            await Bun.sleep(800);
            const geomShadow = await app.js<{
              aaDelta: number;
              totalOccluded: number;
              nearOccluded: number;
              farOccluded: number;
              tsmDraws: number;
            }>(treeShadowProbe("geom"));
            expect(geomShadow.aaDelta).toBe(0);
            expect(geomShadow.nearOccluded).toBeGreaterThan(0);
            expect(geomShadow.farOccluded).toBeGreaterThan(0);
            expect(geomShadow.tsmDraws).toBeGreaterThan(proxyShadow.tsmDraws);

            const shadowCmp = await app.js<{
              bothOccluded: number;
              carvedOpenings: number;
              detailAdded: number;
              proxyNear: number;
              geomNear: number;
              farOccluded: number;
            }>(TREE_SHADOW_COMPARE);
            expect(shadowCmp.bothOccluded).toBeGreaterThan(0);
            expect(shadowCmp.carvedOpenings).toBeGreaterThan(0);
            expect(shadowCmp.farOccluded).toBeGreaterThan(0);

            // 2. Amortized shadow map stability: 0 extra tsmDraws while stationary, and pause/step contract.
            const drawsBeforeStill = geomShadow.tsmDraws;
            await Bun.sleep(600);
            const drawsAfterStill = await app.js<number>("__bh.renderer.tsmDraws");
            expect(drawsAfterStill).toBe(drawsBeforeStill);
            await app.js("(() => {__bh.step(1/60);__bh.touch();return true;})()");
            await Bun.sleep(300);

            // Positive witness: skipping near tree shadow draw removes near 3D shadow texels while keeping far forest shadows.
            await app.js(
              "(() => {__bh.renderer.sceneryRaster.debugSkip=1;__bh.renderer.sceneryRaster.nearTrees.debugTreeId=-1;__bh.touch();return true;})()",
            );
            await Bun.sleep(600);
            const skippedShadow = await app.js<{ nearOccluded: number; farOccluded: number }>(treeShadowProbe());
            expect(skippedShadow.nearOccluded).toBeLessThan(geomShadow.nearOccluded);
            await app.js(
              "(() => {__bh.renderer.sceneryRaster.debugSkip=0;__bh.renderer.sceneryRaster.nearTrees.debugTreeId=0;__bh.touch();return true;})()",
            );
            await Bun.sleep(600);

            // 3. Winter bare deciduous skeleton shadows (compared at the same winter Sun angle), grazing Sun, night + rain, and visual contact.
            await app.js(
              '(() => {__bh.renderer.nearTreeGeometryOn=false;__bh.game.setDate("2026-01-15T09:30:00Z");__bh.touch();return true;})()',
            );
            await Bun.sleep(800);
            const winterProxyShadow = await app.js<{ nearOccluded: number; farOccluded: number; tsmDraws: number }>(
              treeShadowProbe("winterProxy"),
            );
            await app.js("(() => {__bh.renderer.nearTreeGeometryOn=true;__bh.touch();return true;})()");
            await Bun.sleep(800);
            const winterShadow = await app.js<{ nearOccluded: number; farOccluded: number; tsmDraws: number }>(treeShadowProbe("winter"));
            expect(winterShadow.nearOccluded).toBeGreaterThan(0);
            expect(winterShadow.nearOccluded).toBeLessThan(winterProxyShadow.nearOccluded);

            await app.js('(() => {__bh.game.setDate("2026-07-10T05:35:00Z");__bh.touch();return true;})()');
            await Bun.sleep(1000);
            const grazingProbe = await app.js<{ pixels: number; validDepth: number }>(TREE_SURFACE_PROBE);
            const grazingShadow = await app.js<{ nearOccluded: number; farOccluded: number }>(treeShadowProbe());
            await app.shot(`${OUT}/${v.name}-grazing-sun.png`);
            expect(grazingProbe.pixels).toBeGreaterThan(0);
            expect(grazingProbe.validDepth).toBe(grazingProbe.pixels);
            expect(grazingShadow.nearOccluded).toBeGreaterThan(0);

            await app.js('(() => {__bh.game.setDate("2026-07-10T19:45:00Z");__bh.settings.weather="rain";__bh.touch();return true;})()');
            await Bun.sleep(1200);
            const nightRainProbe = await app.js<{ pixels: number; validDepth: number }>(TREE_SURFACE_PROBE);
            await app.shot(`${OUT}/${v.name}-night-rain.png`);
            expect(nightRainProbe.pixels).toBeGreaterThan(0);
            expect(nightRainProbe.validDepth).toBe(nightRainProbe.pixels);

            await app.js('(() => {__bh.settings.weather="fair";__bh.game.setDate("2026-07-10T09:30:00Z");__bh.touch();return true;})()');
            await Bun.sleep(1000);

            const contactProbe = await app.js<{ trees: number; buildings: number; segments: number }>(TREE_CONTACT_PROBE);
            expect(contactProbe.trees).toBeGreaterThan(0);
            expect(contactProbe.segments).toBeGreaterThan(0);

            const shadowCounts = await app.js<{
              instances: number[];
              lod0: number[];
              lod1: number[];
              shadow: number[];
              overflow: number;
            }>("__bh.renderer.sceneryRaster.nearTrees.readCounts()");
            const shadowInstances = shadowCounts.shadow.reduce((a, b) => a + b, 0);
            expect(shadowInstances).toBeGreaterThan(0);

            const shadowsReport = {
              proxyShadow,
              geomShadow,
              shadowCmp,
              drawsBeforeStill,
              drawsAfterStill,
              skippedNearOccluded: skippedShadow.nearOccluded,
              winterProxyNearOccluded: winterProxyShadow.nearOccluded,
              winterNearOccluded: winterShadow.nearOccluded,
              grazingPixels: grazingProbe.pixels,
              grazingNearOccluded: grazingShadow.nearOccluded,
              nightRainPixels: nightRainProbe.pixels,
              contact: contactProbe,
              shadowInstances,
            };
            console.log(JSON.stringify({ shadows: shadowsReport }));
            await Bun.write(`${OUT}/${v.name}-shadows.json`, JSON.stringify(shadowsReport, null, 2));
          }
          if (process.env.J9_PWA === "1") {
            // 1. Bounded GPU memory and buffers verification.
            const gpu = await app.js<{
              vertices: number;
              indices: number;
              lists: number;
              draws: number;
              uniforms: number;
              total: number;
              capacity: number;
              slots: number;
              ready: boolean;
            }>("__bh.renderer.sceneryRaster.nearTrees.gpuBytes()");
            expect(gpu.ready).toBe(true);
            expect(gpu.vertices).toBe(8112240);
            expect(gpu.indices).toBe(1405632);
            expect(gpu.lists).toBe(589824);
            expect(gpu.draws).toBe(752);
            expect(gpu.uniforms).toBe(16);
            expect(gpu.total).toBe(10108464);
            expect(gpu.capacity).toBe(4096);
            expect(gpu.slots).toBe(36);

            const initialCounts = await app.js<{
              instances: number[];
              lod0: number[];
              lod1: number[];
              shadow: number[];
              overflow: number;
            }>("__bh.renderer.sceneryRaster.nearTrees.readCounts()");
            expect(initialCounts.overflow).toBe(0);

            // 2. Sustained low flight & absence of J8 regression (at maures-low or during flight).
            let flightReport: { steps: number; minInstances: number; maxOverflow: number; sceneryWorkerMs?: number } | null = null;
            if (v.name === "maures-low") {
              const samples: number[] = [];
              let maxOf = 0;
              await app.js("(() => { __bh.freeze(false); return true; })()");
              for (let f = 0; f < 5; f++) {
                await Bun.sleep(200);
                const cnt = await app.js<{ instances: number[]; shadow: number[]; overflow: number }>(
                  "__bh.renderer.sceneryRaster.nearTrees.readCounts()",
                );
                const sum = cnt.instances.reduce((a, b) => a + b, 0) + cnt.shadow.reduce((a, b) => a + b, 0);
                samples.push(sum);
                maxOf = Math.max(maxOf, cnt.overflow);
              }
              await app.js("(() => { __bh.freeze(true); return true; })()");
              expect(maxOf).toBe(0);
              expect(Math.min(...samples)).toBeGreaterThan(0);
              const workerMs = await app.js<number>("__bh.renderer.earthScenery?.stats?.()?.workerMs ?? 0");
              flightReport = {
                steps: samples.length,
                minInstances: Math.min(...samples),
                maxOverflow: maxOf,
                sceneryWorkerMs: workerMs,
              };
            }

            // 3. Population consistency across settled refresh.
            // When re-evaluating the place, verify the deterministic instance counts are strictly identical.
            await app.js("(() => { __bh.touch(); return true; })()");
            await Bun.sleep(500);
            const settledCounts = await app.js<{
              instances: number[];
              lod0: number[];
              lod1: number[];
              shadow: number[];
              overflow: number;
            }>("__bh.renderer.sceneryRaster.nearTrees.readCounts()");
            expect(settledCounts.lod0).toEqual(initialCounts.lod0);
            expect(settledCounts.lod1).toEqual(initialCounts.lod1);
            expect(settledCounts.shadow).toEqual(initialCounts.shadow);
            expect(settledCounts.overflow).toBe(0);

            const pwaReport = {
              gpu,
              initialCounts,
              flightReport,
            };
            console.log(JSON.stringify({ pwa: pwaReport }));
            await Bun.write(`${OUT}/${v.name}-pwa.json`, JSON.stringify(pwaReport, null, 2));
          }
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
          "(() => {__bh.renderer.nearTreeGeometryOn=true;if(__bh.renderer.sceneryRaster)__bh.renderer.sceneryRaster.nearTrees.debugTreeId=0;delete globalThis.__j9Surfaces;return true;})()",
        )
        .catch(() => {});
      app.close();
    }
  },
  900_000,
);
