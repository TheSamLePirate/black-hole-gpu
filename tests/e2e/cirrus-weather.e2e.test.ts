import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C7 — the cirrus tied to the weather (trace.wgsl wxCirrusCover, cirrusWeather): where the weather reaches and its model
// gives the high cover, the cirrus's shell at 9 km follows it — none under a clear high sky, a veil at full cover — instead of
// the jet streams' climatology. La Mancha (39.4° N: inside the climatology's band, its cirrus there), 13:00 UTC, the F-35's
// cockpit at 1 000 m looking 35° up, frozen, the exposure locked at the meter's first reading; the real weather replaced by a
// model's hour (renderer.weatherReal: a few cumulus at 1.5 km, the model's high cover 0, 0.6, 1; the grid off — its cover
// from the hour), then the climatology's cirrus (TUNE_GSKIP 33554432) and high 0 again (the measure's own noise). A shot each
// (the sky's luminance and its spread measured on them after: docs/progress/refraction-horizons/Q5.md).
// Duration: ~3 min on this Mac.
// Done when: the five shots taken, each with its pipeline and mount logged, no GPU error.
const OUT = process.env.CW_OUT ?? "remote-results/cirrus-weather";
afterAll(stopServer);
const HOUR = (high: number) =>
  `({ source: "model", kind: "cloudy", wind: { u10: 3, from: null, gust: 0, turb: 0, shear: 0 }, visibility: 25000, fogTop: 0,
    layers: [{ base: 1500, top: 2300, cover: 0.15, cls: 0 }], rain: 0, dust: 0,
    model: { provider: "open-meteo", kind: "forecast", lat: 39.42, lon: -3.05, t: Date.parse("2026-07-10T13:00:00Z"), T: 28, Td: 9,
      p: 950, high: ${high}, code: 2, precip: 0 } })`;
test.skipIf(!E2E)(
  "C7: the cirrus follows the weather model's high cover where the weather reaches",
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
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.set("earthClouds", 1); __bh.renderer.weatherGridEnabled = false;
          __bh.camera.weatherReal = __bh.renderer.weatherReal = ${HOUR(0)}; __bh.settings.weather = "real";
          __bh.game.flyAt(39.42, -3.05, 1000, 0, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, 35); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
      );
      let locked = false;
      for (const [k, high, tune] of [
        ["high0", 0, 0],
        ["high06", 0.6, 0],
        ["high1", 1, 0],
        ["climatology", 0, 33554432],
        ["high0b", 0, 0],
      ] as const) {
        await app.js(
          `(() => { __bh.camera.weatherReal = __bh.renderer.weatherReal = ${HOUR(high)}; __bh.renderer.tune = ${tune ? `{ TUNE_GSKIP: ${tune} }` : "{}"}; __bh.touch(); return 1; })()`,
        );
        await app.settled(120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 120; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
        if (!locked) {
          const ev = await app.js<number>(
            `(() => { const ev = __bh.renderer.autoEV; __bh.settings.autoExposure = false; __bh.settings.exposure = ev; return ev; })()`,
          );
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          console.log(`  exposure locked at ${ev.toFixed(2)} EV`);
          locked = true;
        }
        const st = await app.js(
          `(() => { const r = __bh.renderer; return { key: r.weatherGridKey, src: r.weatherReal?.source, high: r.weatherReal?.model?.high, weather: __bh.settings.weather, wxLight: r.wxLight }; })()`,
        );
        console.log(`  ${k} state ${JSON.stringify(st)}`);
        const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
        const mount = await app.js<string>(`__bh.settings.shipMount`);
        out[k] = { high, tune, pipe, mount };
        await app.shot(`${OUT}/${k}.png`);
        console.log(`  ${k}: shot (${pipe}, ${mount})`);
      }
      await app.js(
        `(() => { __bh.renderer.tune = {}; __bh.renderer.weatherGridEnabled = true; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/cirrus.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
