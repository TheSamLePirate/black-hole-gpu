import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C11 — the clouds' layers each under their own air (trace.wgsl cloudsAdd, CloudVol.ta): the air before the clouds read
// where their light comes from — their samples' distance weighted by their light — rather than at the nearest one's. La Mancha,
// 13:00 UTC, the F-35's cockpit looking east, frozen, the exposure locked at the meter's first reading: the "overcast" weather
// (a deck 600–2 000 m, cover 0.95, under a broken layer 4 000–5 500 m, 0.5; visibility 12 km) from 7 000 m, the view 1° and 4°
// down — the low deck seen through the upper layer's gaps and thin edges —, and the "cloudy" one (cumulus 1 200–2 600 m) from
// 4 000 m, 3° down. At each: C11 on, off (TUNE_GSKIP 524288: the air at the nearest cloud's distance, as before), on again —
// the two "on" alike: the measure's own noise —, a shot each (compared after: docs/progress/refraction-horizons/Q5.md).
// CL_OUT: the shots (remote-results/cloud-layers-air).
// Duration: ~5 min on this Mac.
const OUT = process.env.CL_OUT ?? "remote-results/cloud-layers-air";
afterAll(stopServer);
test.skipIf(!E2E)(
  "C11: the far clouds under their own air — under the layer and above it, the composition on, off, on",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T13:00:00Z";
      for (const [place, wx, alt, pitch] of [
        ["overcast-1", "overcast", 7000, -1],
        ["overcast-4", "overcast", 7000, -4],
        ["cloudy-3", "cloudy", 4000, -3],
      ] as const) {
        await app.js(
          `(() => { __bh.game.setDate("${iso}"); __bh.settings.autoExposure = true; __bh.settings.exposure = 0; __bh.game.set("weather", "${wx}"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, ${alt}, 90, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(
          `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${pitch}); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
        );
        let locked = false;
        for (const [k, tune] of [
          ["on", 0],
          ["off", 524288],
          ["on2", 0],
        ] as const) {
          await app.js(`(() => { __bh.renderer.tune = { TUNE_GSKIP: ${tune} }; return 1; })()`);
          await app.settled(120_000);
          // (frozen: the raster's shading round every pixel, the clouds' history converged)
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 120; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          // (the exposure locked at the meter's reading after the first: the three shots exposed alike)
          if (!locked) {
            const ev = await app.js<number>(
              `(() => { const ev = __bh.renderer.autoEV; __bh.settings.autoExposure = false; __bh.settings.exposure = ev; return ev; })()`,
            );
            await app.js(
              `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`,
            );
            console.log(`  ${place}: exposure locked at ${ev.toFixed(2)} EV`);
            locked = true;
          }
          const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
          const mount = await app.js<string>(`__bh.settings.shipMount`);
          out[`${place}-${k}`] = { pipe, mount };
          await app.shot(`${OUT}/${place}-${k}.png`);
          console.log(`  ${place} ${k}: shot (${pipe}, ${mount})`);
        }
      }
      await app.js(`(() => { __bh.renderer.tune = {}; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/layers.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
