import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C10 — no jump as the camera climbs through 30 km: the map's clouds a volume below, a flat layer above, faded into each
// other from 25 to 35 km (renderer.cloudVolumeFade; trace.wgsl earthClouds's weight vw — false: the old step at 30 km). The
// Gulf of Biscay's real clouds (the day's map, fair weather: the map's clouds alone), 13:00 UTC, the F-35's cockpit looking
// 35° down (the cockpit, unchanged, and the clouds by its sides: a nose-high view's rows move with the craft's trim), frozen, the exposure locked at the first view's: the camera at 24, 27, 29, 29.9, 30.1, 31, 33 and 36 km, a shot
// at each, the fade on then off; the mean luminance of the image's lower half at each height. CF_OUT: the shots
// (remote-results/cloud-volume-fade).
// Duration: ~5 min on this Mac.
// Done when: the sixteen shots taken and the step across 30 km (29.9 → 30.1) logged for both, no GPU error.
const OUT = process.env.CF_OUT ?? "remote-results/cloud-volume-fade";
const HEIGHTS = [24, 27, 29, 29.9, 30.1, 31, 33, 36];
afterAll(stopServer);
test.skipIf(!E2E)(
  "C10: the clouds' volume faded into the flat layer across 30 km",
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
      let locked = false;
      for (const fade of [true, false]) {
        const means: number[] = [];
        for (const h of HEIGHTS) {
          await app.js(
            `(() => { __bh.renderer.cloudVolumeFade = ${fade}; __bh.game.setDate("${iso}"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 1); __bh.freeze(false); __bh.game.flyAt(45.5, -4.0, ${h * 1000}, 180, 200); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
          );
          await app.js(
            `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -35); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 600))`,
          );
          await app.settled(120_000);
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 90; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          if (!locked) {
            await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
            await app.js(
              `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`,
            );
            locked = true;
          }
          const file = `${OUT}/${fade ? "fade" : "step"}-${h}.png`;
          await app.shot(file);
          const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
          let s = 0;
          let n = 0;
          for (let y = Math.floor(0.5 * img.height); y < 0.95 * img.height; y += 2)
            for (let x = Math.floor(0.1 * img.width); x < 0.9 * img.width; x += 2) {
              const o = (y * img.width + x) * img.channels;
              s += 0.2126 * img.data[o]! + 0.7152 * img.data[o + 1]! + 0.0722 * img.data[o + 2]!;
              n++;
            }
          means.push(+(s / n).toFixed(2));
        }
        const step = means[HEIGHTS.indexOf(30.1)]! - means[HEIGHTS.indexOf(29.9)]!;
        out[fade ? "fade" : "step"] = { heights: HEIGHTS, means, step: +step.toFixed(2) };
        console.log(`  ${fade ? "fade" : "step"}: means ${means.join(", ")} — across 30 km ${step.toFixed(2)}`);
      }
      await app.js(
        `(() => { __bh.renderer.cloudVolumeFade = true; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/fade.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  12 * 60_000,
);
