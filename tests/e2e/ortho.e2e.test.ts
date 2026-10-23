import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The IGN's orthophotos over France (docs/ANALYSE-IGN-LIDAR.md I1, src/system/earth-tiles.ts): z 15 … 18 streamed in
// near a low camera, drawn over the satellite's imagery, credited; none asked for abroad. The Alps first (Chamonix),
// then Paris; each view the same with them and without (settings.earthOrtho), its frame rate said — the depth of field
// off (the scene's preset blurs the ground behind the craft).
// (E2E_SHOTS=<dir>: the views, ortho-<place>-on / -off.)
// Duration: ~8 min on kerr-mini (two places, each four frozen raster views: ahead and the ground near, with and without).
// Done when: abroad (Tarifa) no orthophoto is asked for nor drawn.

const PLACES = [
  // (from Les Houches up the valley, 600 m over it: at 150 m on 040 the craft met the Brévent while the tiles came in, at
  // 300 m on 045 it came down on its belly where the valley rises to Argentière)
  { name: "chamonix", lat: 45.892, lon: 6.8, agl: 600, hdg: 45 },
  { name: "paris", lat: 48.853, lon: 2.335, agl: 300, hdg: 60 },
];

describe.skipIf(!E2E)("the IGN's orthophotos", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster" }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  // (the autopilot and the autothrottle engaged on the craft as it is now — jetToggle toggles: a second place's call let the
  // first's holds go, and a craft flown on with none after a jump across the map went into the sea, "broke under 293 g")
  const holdHere = () =>
    app.js(
      `(() => { const c = __bh.camera, m = c.jetModes; m.alt = m.hdg = m.spd = null; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`,
    );
  // (the craft lost — the telemetry's screen: why, or null)
  const lost = () => app.js<string | null>(`document.querySelector(".craft-lost .cl-why")?.textContent ?? null`);
  // (the frame rate over two seconds, the world running)
  const fps = async () => {
    // (the tracer compiled first: a rate measured while it compiles is the compiler's)
    await app.settled();
    // (the world let run those two seconds — held otherwise, the craft where the test put it —, then held again)
    return app.js<number>(
      `new Promise((r) => { __bh.freeze(false); let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : (__bh.freeze(true), r(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(f); })`,
    );
  };
  // (the tiles in — the relief's and the orthophotos' —, bounded: said, not failed, if the network is slow)
  // (the world under the view in — the Earth's maps, the relief's tiles and the orthophotos', the regional imagery, the
  // scenery done asking (ready, or degraded: its sources refused) —, bounded: what is still missing said, not failed, if the network is slow)
  const LOADED = `(() => { const r = __bh.renderer, s = r.earthScenery.stats(); return r.earthMaps.tier === "high" && r.earthTiles.pending === 0 &&
    r.earthTiles.orthoPending === 0 && !r.earthSurface.pending && !s.pending; })()`;
  const tilesIn = () =>
    app.waitFor(LOADED, 90_000).catch(async () => {
      const m =
        await app.js(`(() => { const r = __bh.renderer, s = r.earthScenery.stats(); return { maps: r.earthMaps.tier, tiles: r.earthTiles.pending,
        ortho: r.earthTiles.orthoPending, surface: r.earthSurface.pending, scenery: s.status, sceneryPending: s.pending }; })()`);
      console.log(`  (still loading after 90 s: ${JSON.stringify(m)})`);
    });

  for (const P of PLACES)
    test(`${P.name}: the orthophotos in at z 17 or finer near the ground, over the satellite's — the same view without them`, async () => {
      // (the world let go and the date set, then a second for the clock to take it, then the jump: a jump in the same tick as
      // a thaw or a date set lost the craft — 1 140 K, 293 g: placed by the clock of before)
      await app.js(
        `(() => { __bh.freeze(false); __bh.settings.earthOrtho = true; __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`,
      );
      await Bun.sleep(1000);
      await app.js(
        `(() => { __bh.game.flyAt(${P.lat}, ${P.lon}, ${P.agl}, ${P.hdg}, 140); __bh.settings.shipMount = "cockpit"; return 1; })()`,
      );
      await Bun.sleep(1500);
      await holdHere();
      await Bun.sleep(3000);
      await tilesIn();
      // (the finest the ground under a low craft needs: z 17 at least, within a minute)
      await app.waitFor(`__bh.renderer.earthTiles.orthoFinest >= 17`, 60_000).catch(() => {});
      const r = await app.js<{ z: number; loaded: number; credit: boolean }>(
        `({ z: __bh.renderer.earthTiles.orthoFinest, loaded: __bh.renderer.earthTiles.orthoLoaded, credit: !document.querySelector('[data-testid="ortho-credit"]').hidden })`,
      );
      const on = await fps();
      const mount = await app.js<string>(`__bh.settings.shipMount`);
      console.log(
        `  ${P.name}: orthophotos to z ${r.z} (${r.loaded} tiles so far), credited ${r.credit} · ${on.toFixed(0)} fps · view ${mount}`,
      );
      expect(r.z).toBeGreaterThanOrEqual(17);
      expect(r.credit).toBe(true);
      expect(await lost()).toBeNull();
      if (shots) {
        // (the craft flown on while its tiles came in has left the place — from Chamonix into the Valais —: put back at it,
        // its tiles from the caches in seconds, then the world held there — held, nothing more streams)
        await app.js(
          `(() => { __bh.game.flyAt(${P.lat}, ${P.lon}, ${P.agl}, ${P.hdg}, 140); __bh.settings.shipMount = "cockpit"; return 1; })()`,
        );
        await Bun.sleep(1500);
        await holdHere();
        await app.waitFor(`__bh.renderer.earthTiles.orthoFinest >= 17`, 30_000).catch(() => {});
        await tilesIn();
        // (in the raster pipeline — the default —, the world frozen, every pixel shaded each frame at the full scale — no
        // dynamic resolution, the raster's shading not one pixel in 2 … 16 —: the cockpit's view ahead, then the ground
        // near seen from above and behind the craft; each with the orthophotos and without. The settings put back after)
        await Bun.$`mkdir -p ${shots}`;
        const kept = await app.js<Record<string, unknown>>(
          `(({ dynamicResolution, earthRasterShading, earthRasterScale, shipMount, denoise, motionBlur }) => ({ dynamicResolution, earthRasterShading, earthRasterScale, shipMount, denoise, motionBlur }))(__bh.settings)`,
        );
        // (no denoiser — made for the traced image's noise, it smears the raster's sharp ground —, no motion blur)
        // (set once frozen — in motion, every pixel shaded at the full scale is over a small GPU's budget: its governor would
        // give the raster up for the traced pipeline —; a change of the raster's shading arms it again)
        // (the raster given up by the governor in flight — rasterFellBack — said, then armed again: settings written
        // directly do not pass through the change that would)
        const fell = await app.js<boolean>(`__bh.renderer.rasterFellBack`);
        if (fell) console.log(`  ${P.name}: the governor had given the raster up for the traced pipeline in flight (this GPU, loading)`);
        const heavy = `Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, denoise: false, motionBlur: 0 }); __bh.renderer.rasterFellBack = false`;
        const light = `Object.assign(__bh.settings, ${JSON.stringify(kept)})`;
        for (const [view, mount] of [
          ["ahead", `__bh.settings.shipMount = "cockpit"`],
          ["ground", `__bh.settings.shipMount = "around"; Object.assign(__bh.camera.outside, { yaw: 160, pitch: 40, dist: 140 })`],
        ] as const) {
          // (the view set while the world runs — frozen, the camera's rig is held too —, then frozen)
          await app.js(`(() => { ${light}; __bh.freeze(false); ${mount}; return 1; })()`);
          await Bun.sleep(1500);
          await app.js(`(() => { __bh.freeze(true); ${heavy}; return 1; })()`);
          for (const on of [true, false]) {
            await app.js(`(() => { __bh.settings.earthOrtho = ${on}; return 1; })()`);
            await tilesIn();
            await app.settled();
            await Bun.sleep(2500);
            const st = await app.js<{
              pipe: string;
              primary: boolean;
              z: number;
              rate: number;
              perf: { renderScale: number; block: number; image: string };
            }>(
              `({ pipe: __bh.renderer.earthPipelineNow(__bh.settings), primary: !!__bh.renderer.terrainRasterStats.primary, z: __bh.renderer.earthTiles.orthoFinest,
                  rate: __bh.renderer.rasterRate, perf: __bh.game.perf({ gpu: false }) })`,
            );
            console.log(
              `  ${P.name} ${view} ortho ${on ? "on" : "off"}: ${st.pipe} (primary ${st.primary}, shading 1/${st.rate}), scale ${st.perf.renderScale} of ${st.perf.image}, block ${st.perf.block}, ortho z ${st.z}`,
            );
            expect(st.pipe).toBe("raster");
            await app.shot(`${shots}/ortho-${P.name}-${view}-${on ? "on" : "off"}.png`);
          }
        }
        await app.js(
          `(() => { Object.assign(__bh.settings, ${JSON.stringify(kept)}, { earthOrtho: true, shipMount: "cockpit" }); __bh.freeze(false); return 1; })()`,
        );
      }
      // (off: none drawn, none credited)
      await app.js(`(() => { __bh.settings.earthOrtho = false; return 1; })()`);
      await app.waitFor(`__bh.renderer.earthTiles.orthoFinest === 0`, 10_000);
      const off = await fps();
      console.log(`  ${P.name} without them: ${off.toFixed(0)} fps`);
      await app.waitFor(`document.querySelector('[data-testid="ortho-credit"]').hidden`, 5_000);
      await app.js(`(() => { __bh.settings.earthOrtho = true; return 1; })()`);
    }, 420_000);

  test("abroad (Tarifa): none asked for, none drawn", async () => {
    await app.js(`(__bh.freeze(false), 1)`);
    await Bun.sleep(1000);
    await app.js(`(() => { __bh.game.flyAt(36.02, -5.62, 300, 90, 140); return 1; })()`);
    await Bun.sleep(1500);
    await holdHere();
    // (counted once there: the last of the orthophotos asked for before the jump may still come in)
    await Bun.sleep(2000);
    const before = await app.js<number>(`__bh.renderer.earthTiles.orthoLoaded`);
    await Bun.sleep(5000);
    expect(await lost()).toBeNull();
    const r = await app.js<{ z: number; loaded: number }>(
      `({ z: __bh.renderer.earthTiles.orthoFinest, loaded: __bh.renderer.earthTiles.orthoLoaded })`,
    );
    expect(r.z).toBe(0);
    expect(r.loaded).toBe(before);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
