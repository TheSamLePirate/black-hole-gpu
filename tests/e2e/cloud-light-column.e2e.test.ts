import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C10 — one light for a cloud however it is marched: the weather's clouds in the cloud pass (the sunward march through
// them) against the same marched by each ray (renderer.cloudPassOn false: the column of the layer over the point, its optical
// depth × CLOUD_COLUMN_K for a broken layer, whole for an overcast — what reflections, probes and the pass off use). La Mancha, the F-35's cockpit, frozen, the
// exposure locked at the pass's: "overcast" from 300 m looking 30° up (the deck's base) at 17:00 UTC, "cloudy" from 4 000 m
// 10° down at 13:00 (the cumulus's tops and sides), and from 300 m 30° up at 17:00 (their bases). At each: the pass, then without it at CLOUD_COLUMN_K 0.4 (the default), 0.7, 1.0;
// the mean luminance of the clouds' band against the pass's. CC_OUT: the shots (remote-results/cloud-light-column).
// Duration: ~6 min on this Mac.
// Done when: the twelve shots taken and each one's band mean logged, no GPU error.
const OUT = process.env.CC_OUT ?? "remote-results/cloud-light-column";
afterAll(stopServer);
test.skipIf(!E2E)(
  "C10: the weather's clouds marched by each ray lit as the cloud pass lights them",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const [place, wx, iso, alt, pitch, band] of [
        ["overcast", "overcast", "2026-07-10T17:00:00Z", 300, 30, [0.15, 0.55]],
        ["cloudy", "cloudy", "2026-07-10T13:00:00Z", 4000, -10, [0.35, 0.75]],
        ["cumulus-base", "cloudy", "2026-07-10T17:00:00Z", 300, 30, [0.15, 0.55]],
      ] as const) {
        await app.js(
          `(() => { __bh.renderer.cloudPassOn = true; __bh.renderer.tune = {}; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; __bh.game.setDate("${iso}"); __bh.game.set("weather", "${wx}"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, ${alt}, 270, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(
          `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${pitch}); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
        );
        let ref = 0;
        let locked = false;
        for (const [k, js] of [
          ["pass", "__bh.renderer.cloudPassOn = true; __bh.renderer.tune = {};"],
          ["k04", "__bh.renderer.cloudPassOn = false; __bh.renderer.tune = {};"],
          ["k07", "__bh.renderer.cloudPassOn = false; __bh.renderer.tune = { CLOUD_COLUMN_K: 0.7 };"],
          ["k10", "__bh.renderer.cloudPassOn = false; __bh.renderer.tune = { CLOUD_COLUMN_K: 1.0 };"],
        ] as const) {
          await app.js(`(() => { ${js} __bh.touch(); return 1; })()`);
          await app.settled(120_000);
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 120; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          if (!locked) {
            await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
            await app.js(
              `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`,
            );
            locked = true;
          }
          const file = `${OUT}/${place}-${k}.png`;
          await app.shot(file);
          const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
          let s = 0;
          let n = 0;
          for (let y = Math.floor(band[0] * img.height); y < band[1] * img.height; y++)
            for (let x = Math.floor(0.15 * img.width); x < 0.85 * img.width; x++) {
              const o = (y * img.width + x) * img.channels;
              s += 0.2126 * img.data[o]! + 0.7152 * img.data[o + 1]! + 0.0722 * img.data[o + 2]!;
              n++;
            }
          const mean = s / n;
          if (k === "pass") ref = mean;
          out[`${place}-${k}`] = { mean: +mean.toFixed(2), ratio: +(mean / ref).toFixed(3) };
          console.log(`  ${place} ${k}: band mean ${mean.toFixed(2)} (${(mean / ref).toFixed(3)} of the pass's)`);
        }
      }
      await app.js(
        `(() => { __bh.renderer.cloudPassOn = true; __bh.renderer.tune = {}; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/column.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
