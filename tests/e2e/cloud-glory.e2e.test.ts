import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 VIPER C4 — the glory on the clouds (trace.wgsl gloryPhase: coloured rings round the antisolar point in the droplets'
// single scattering). La Mancha, 18:50 UTC (the Sun ~8° up), one deck of the weather (a model's hour injected — the grid off —:
// 1 000–2 000 m, cover 1), the F-35 at 2 300 m flying away from the Sun; the camera outside behind it, 10° aside and 100 m off (the "around" mount: the
// antisolar point, 8° under the horizon ahead, in view and clear of the craft — the cockpit's floor hides it from inside). Frozen, the exposure
// locked; a shot with the glory and without it (TUNE_GSKIP 67108864), then with it again: where the two first differ (the
// glory's rings), against where the two with it do (the measure's noise). GL_OUT: the shots and the difference
// (remote-results/cloud-glory).
// Duration: ~2 min on this Mac.
// Done when: the three shots taken, the glory's strongest difference over three times the noise in its cell, no GPU error.
const OUT = process.env.GL_OUT ?? "remote-results/cloud-glory";
afterAll(stopServer);
test.skipIf(!E2E)(
  "VIPER C4: the glory round the antisolar point on a deck",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", bloom: 0, lensFlare: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T18:50:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.set("earthClouds", 1); __bh.renderer.weatherGridEnabled = false;
          __bh.camera.weatherReal = __bh.renderer.weatherReal = { source: "model", kind: "overcast", wind: { u10: 3, from: null, gust: 0, turb: 0, shear: 0 }, visibility: 30000, fogTop: 0,
            layers: [{ base: 1000, top: 2000, cover: 1, cls: 0 }], rain: 0, dust: 0,
            model: { provider: "open-meteo", kind: "forecast", lat: 39.42, lon: -3.05, t: Date.parse("${iso}"), T: 20, Td: 12, p: 950, high: 0, code: 3, precip: 0 } };
          __bh.settings.weather = "real"; __bh.game.flyAt(39.42, -3.05, 2300, 0, 140); return 1; })()`,
      );
      await Bun.sleep(500);
      const sun = await app.js<{ azDeg: number; altDeg: number }>(`__bh.camera.skyInfo().sun`);
      await app.js(
        `(() => { __bh.game.flyAt(39.42, -3.05, 2300, ${(sun.azDeg + 180) % 360}, 140); __bh.settings.shipMount = "around"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      // (the mount set first — it resets the view about the craft —, then the view)
      await Bun.sleep(300);
      await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 10, pitch: 5, dist: 100 }); return 1; })()`);
      await Bun.sleep(700);
      await app.js(`new Promise((q) => setTimeout(() => { __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 1500))`);
      let locked = false;
      const shots: Record<string, Uint8Array> = {};
      let W = 0;
      let H = 0;
      let C = 3;
      for (const [k, tune] of [
        ["glory", "{}"],
        ["none", "{ TUNE_GSKIP: 67108864 }"],
        ["glory2", "{}"],
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
        shots[k] = img.data;
        W = img.width;
        H = img.height;
        C = img.channels;
      }
      // (the differences' energy in 32 × 32 px cells: the glory's cell the largest — its rings —, the noise's the same cell)
      // (the differences' energy in 32 × 32 px cells, the image's middle — not the frame counter's top nor the map's bottom —:
      // the glory's cell the largest — its rings —, and the noise in that same cell)
      const cell = (a: Uint8Array, b: Uint8Array, cx: number, cy: number) => {
        let e = 0;
        for (let y = cy; y < cy + 32; y++)
          for (let x = cx; x < cx + 32; x++) {
            const o = (y * W + x) * C;
            for (let c = 0; c < 3; c++) e += Math.abs(a[o + c]! - b[o + c]!);
          }
        return e / (32 * 32 * 3);
      };
      let glory = { e: 0, x: 0, y: 0 };
      for (let cy = Math.ceil((0.05 * H) / 32) * 32; cy + 32 <= 0.85 * H; cy += 32)
        for (let cx = 0; cx + 32 <= W; cx += 32) {
          const e = cell(shots.glory!, shots.none!, cx, cy);
          if (e > glory.e) glory = { e, x: cx, y: cy };
        }
      const noise = { e: cell(shots.glory!, shots.glory2!, glory.x, glory.y), x: glory.x, y: glory.y };
      out.glory = glory;
      out.noise = noise;
      console.log(
        `  the glory's strongest cell: |Δ| ${glory.e.toFixed(2)} at ${glory.x + 16}, ${glory.y + 16}; the noise there ${noise.e.toFixed(2)}`,
      );
      await app.js(
        `(() => { __bh.renderer.tune = {}; __bh.renderer.weatherGridEnabled = true; __bh.settings.shipMount = "cockpit"; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/glory.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    const r = out as { glory: { e: number }; noise: { e: number }; gpuErrors: number };
    expect(r.glory.e).toBeGreaterThan(3 * r.noise.e);
    expect(r.gpuErrors).toBe(0);
  },
  6 * 60_000,
);
