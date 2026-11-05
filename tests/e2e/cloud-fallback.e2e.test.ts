import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 — the clouds before the raster's ground on a device without the cloud pass (trace.wgsl cloudsFallback through
// cloudsLiteFallback: the weather's layers flat at their middle height, their cover and a flat layer's light — before, none
// there at all). The page's device capped at 24 sampled textures a stage (hash gpuTextures=24: under the cloud pass's 25 —
// a smaller GPU's), La Mancha, "cloudy" (cumulus 1 200–2 600 m), 13:00 UTC, the F-35's cockpit at 4 000 m looking 10° down,
// frozen, the exposure locked: the stand-in on, off (TUNE_GSKIP 2147483648), on again; the clouds' band's mean and spread
// (rows 35–75 %). CF_OUT: the shots (remote-results/cloud-fallback).
// Duration: ~3 min on this Mac.
// Done when: the cloud pass reported off, the three shots taken, the stand-in's band brighter and more varied than without it,
// no GPU error.
const OUT = process.env.CF_OUT ?? "remote-results/cloud-fallback";
afterAll(stopServer);
test.skipIf(!E2E)(
  "without the cloud pass, the weather's clouds drawn flat before the raster's ground",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis&gpuTextures=24", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      out.cloudPass = await app.js(`__bh.renderer.cloudPassStats`);
      console.log(`  the cloud pass: ${JSON.stringify(out.cloudPass)}`);
      const iso = "2026-07-10T13:00:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, 4000, 270, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -10); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
      );
      let locked = false;
      for (const [k, tune] of [
        ["fallback", "{}"],
        ["none", "{ TUNE_GSKIP: 2147483648 }"],
        ["fallback2", "{}"],
      ] as const) {
        await app.js(`(() => { __bh.renderer.tune = ${tune}; __bh.touch(); return 1; })()`);
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
        const file = `${OUT}/${k}.png`;
        await app.shot(file);
        const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
        let s = 0;
        let s2 = 0;
        let n = 0;
        for (let y = Math.floor(0.35 * img.height); y < 0.75 * img.height; y += 2)
          for (let x = Math.floor(0.1 * img.width); x < 0.9 * img.width; x += 2) {
            const o = (y * img.width + x) * img.channels;
            const l = 0.2126 * img.data[o]! + 0.7152 * img.data[o + 1]! + 0.0722 * img.data[o + 2]!;
            s += l;
            s2 += l * l;
            n++;
          }
        const mean = s / n;
        const sd = Math.sqrt(Math.max(s2 / n - mean * mean, 0));
        out[k] = { mean: +mean.toFixed(2), sd: +sd.toFixed(2) };
        console.log(`  ${k}: band mean ${mean.toFixed(2)}, spread ${sd.toFixed(2)}`);
      }
      await app.js(`(() => { __bh.renderer.tune = {}; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/fallback.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    const r = out as {
      cloudPass: { supported: boolean };
      fallback: { mean: number; sd: number };
      none: { mean: number; sd: number };
      gpuErrors: number;
    };
    expect(r.cloudPass.supported).toBe(false);
    expect(r.fallback.mean).toBeGreaterThan(r.none.mean + 3);
    expect(r.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
