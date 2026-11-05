import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q7 L9 — the season's snow on the near ground (trace.wgsl seasonSnow: the snow line slid from the summer's towards the
// winter's by the Sun's declination, over the photographs too, the roads and runways drawn after it — cleared): over the
// Annecy basin and the Bornes (SS_LAT, SS_LON) at 2 500 m, the cockpit looking 20° down, noon, frozen, the exposure locked
// at the first shot: 15 January with it, 15 January without (TUNE_SC_SKIP 1024), 15 July with it. The ground's mean
// luminance (the middle 60 % across, 45–75 % down) in each.
// SS_OUT: the shots (remote-results/season-snow).
// Duration: ~4 min on this Mac.
// Done when: the three shots taken and the ground's luminance logged, no GPU error.
const OUT = process.env.SS_OUT ?? "remote-results/season-snow";
const LAT = Number(process.env.SS_LAT ?? 45.9);
const LON = Number(process.env.SS_LON ?? 6.25);
afterAll(stopServer);
test.skipIf(!E2E)(
  "L9: the winter's snow on the near ground, none in July, none with it off",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair", bloom: 0 }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      let locked = false;
      for (const [k, iso, tune] of [
        ["january", "2026-01-15T11:30:00Z", "{}"],
        ["january-off", "2026-01-15T11:30:00Z", "{ TUNE_SC_SKIP: 1024 }"],
        ["july", "2026-07-15T11:30:00Z", "{}"],
      ] as const) {
        await app.js(
          `(() => { __bh.freeze(false); __bh.renderer.tune = ${tune}; __bh.game.setDate("${iso}"); __bh.game.flyAt(${LAT}, ${LON}, 2500, 120, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(
          `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -20); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
        );
        await app.settled(120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 150; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
        if (!locked) {
          await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
          locked = true;
        }
        const file = `${OUT}/${k}.png`;
        await app.shot(file);
        const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
        // (the ground's mean luminance under the horizon — the panel's corner left out: the middle 60 % across, 45–75 % down)
        let lum = 0,
          n = 0;
        for (let y = Math.floor(0.45 * img.height); y < 0.75 * img.height; y += 2)
          for (let x = Math.floor(0.2 * img.width); x < 0.8 * img.width; x += 2) {
            const o = (y * img.width + x) * img.channels;
            lum += (0.2126 * img.data[o]! + 0.7152 * img.data[o + 1]! + 0.0722 * img.data[o + 2]!) / 255;
            n++;
          }
        const snow = lum;
        const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings) + " " + __bh.settings.shipMount`);
        out[k] = { groundLum: +(snow / n).toFixed(3), pipe };
        console.log(`  ${k}: the ground's mean luminance ${(snow / n).toFixed(3)} (${pipe})`);
      }
      await app.js(`(() => { __bh.renderer.tune = {}; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/snow.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
