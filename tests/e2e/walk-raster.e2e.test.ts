import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// Probe — no assertion but no GPU error; not in `bun run e2e`: E2E_PROBE=1 — (PLAN-J5 J5-3) the walker on the Earth, traced as ever or
// drawn by the raster (renderer.walkRasterOn, a measure): the astronaut standing at Chamonix (45.92° N, 6.87° E, the relief's and the
// scenery's tiles in), the scene's clock held, the third-person camera; each way its frames' GPU time over 4 s and a shot — the feet
// against the ground the image draws (the raster's mesh from the height cache, the tracer's march on the walker's own grid).
// Duration: ~4 min on kerr-mini.
// (and the raster with the near trees' geometry off — renderer.nearTreeGeometryOn false: their crowns' cut proxies, the material's;
// the rays' near-tree path and its lever nearTreesRays were retired on 24 Nov 2026)
// Done when: the three ways measured and shot, at Chamonix then at WALK_SPOTS' other places.
afterAll(stopServer);
const OUT = process.env.WALK_OUT ?? "remote-results/walk-raster";
const SPOTS = (process.env.WALK_SPOTS ?? "45.92,6.87").split(";").map((s) => s.split(",").map(Number) as [number, number]);
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the walker on the Earth, traced or by the raster: GPU time and the feet on the ground",
  async () => {
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      for (const [lat, lon] of SPOTS) {
        // (false: traced; true: the raster, the near trees' geometry on — the default —; "cut": the raster, that geometry off — the
        // crowns' cut proxies —; "imp": as "cut", the near trees read from their impostors — renderer.tune IMPOSTOR_NEAR_M −100,
        // PLAN-J5 J5-3b)
        const ways = (process.env.WALK_WAYS?.split(",") ?? ["false", "true", "cut", "false"]).map((w) =>
          w === "false" ? false : w === "true" ? true : w,
        );
        for (const on of ways) {
          await app.js(`(() => { __bh.renderer.walkRasterOn = ${on !== false}; __bh.renderer.nearTreeGeometryOn = ${on !== "cut" && on !== "imp"};
            __bh.renderer.tune = ${on === "imp" ? "{ IMPOSTOR_NEAR_M: -100 }" : "{}"};
            Object.assign(__bh.settings, { traffic: false, autosave: false, damage: false, showFps: true, dof: false, motionBlur: 0 });
            __bh.game.setDate("2026-07-10T10:30:00Z");
            const r = __bh.camera.character.start("earth", ${lat}, ${lon}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return r ?? 1; })()`);
          await app
            .dataSettled(`walk ${lat},${lon} ${on === false ? "traced" : on === true ? "raster" : `raster-${on}`}`, { maxMs: 90_000 })
            .catch((e) => console.log(`(not settled: ${String(e).slice(0, 160)})`));
          await app.settled();
          const r = await app.js<{ gpu: number[]; raster: boolean; passes: unknown }>(`(async () => {
            const R = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q)); const gpu = []; let last = R.completedFrames;
            const t0 = performance.now();
            while (performance.now() - t0 < 4000) { __bh.touch(); await f(); if (R.completedFrames !== last) { last = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); } }
            // (the passes' split: the profiler on for 2 s — the timestamps cost on Apple, after the GPU's own time)
            R.prof.enabled = true; R.prof.every = 1; R.prof.reset(); const t1 = performance.now();
            while (performance.now() - t1 < 2000) { __bh.touch(); await f(); }
            const passes = R.prof.table().filter((p) => p.ms > 0.4).map((p) => [p.label, +p.ms.toFixed(2)]);
            R.prof.enabled = false; R.prof.every = 8;
            return { gpu, raster: R.rasterPrimaryNow, passes }; })()`);
          const s = [...r.gpu].sort((a, b) => a - b);
          console.log(
            JSON.stringify({
              at: [lat, lon],
              walkRaster: on,
              rasterNow: r.raster,
              images: s.length,
              gpuP50: s[s.length >> 1],
              gpuP95: s[Math.floor(s.length * 0.95)],
              passes: r.passes,
            }),
          );
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          await app.shot(`${OUT}/walk-${lat}-${lon}-${on === false ? "traced" : on === true ? "raster" : `raster-${on}`}.png`);
          await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
        }
      }
      await app.js(
        `(() => { __bh.renderer.walkRasterOn = false; __bh.renderer.nearTreeGeometryOn = true; __bh.renderer.tune = {}; return 1; })()`,
      );
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  600_000,
);
