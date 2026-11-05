import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 VIPER C4 — the glory on the clouds (trace.wgsl gloryPhase: coloured rings round the antisolar point in the droplets'
// single scattering) and the craft's shadow on them at its centre (shipCloudShadow: its shadow map's silhouette on the cloud
// pass's samples, faded past its umbra's reach). La Mancha, 17:00 UTC (the Sun ~29° up), one deck of the weather (a model's hour
// injected — the grid off —: 1 000–2 000 m, cover 1), the F-35 at 2 100 m flying away from the Sun; the camera outside it,
// 10° aside, 30° above, 100 m off (the "around" mount: the antisolar point in view — the cockpit's floor hides it from inside).
// Frozen, the exposure locked; shots with both, without the glory (TUNE_GSKIP 67108864), with both again (the measure's noise),
// without the shadow (134217728), and with its whole column dark (268435456: where the shadow is, to measure it there).
// GL_OUT: the shots (remote-results/cloud-glory).
// Duration: ~3 min on this Mac.
// Done when: the five shots taken, the glory's strongest difference and the shadow's at its column each over three times the
// noise there, no GPU error.
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
      const iso = "2026-07-10T17:00:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.set("earthClouds", 1); __bh.renderer.weatherGridEnabled = false;
          __bh.camera.weatherReal = __bh.renderer.weatherReal = { source: "model", kind: "overcast", wind: { u10: 3, from: null, gust: 0, turb: 0, shear: 0 }, visibility: 30000, fogTop: 0,
            layers: [{ base: 1000, top: 2000, cover: 1, cls: 0 }], rain: 0, dust: 0,
            model: { provider: "open-meteo", kind: "forecast", lat: 39.42, lon: -3.05, t: Date.parse("${iso}"), T: 20, Td: 12, p: 950, high: 0, code: 3, precip: 0 } };
          __bh.settings.weather = "real"; __bh.game.flyAt(39.42, -3.05, 2100, 0, 140); return 1; })()`,
      );
      await Bun.sleep(500);
      const sun = await app.js<{ azDeg: number; altDeg: number }>(`__bh.camera.skyInfo().sun`);
      await app.js(
        `(() => { __bh.game.flyAt(39.42, -3.05, 2100, ${(sun.azDeg + 180) % 360}, 140); __bh.settings.shipMount = "around"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      // (the mount set first — it resets the view about the craft —, then the view)
      await Bun.sleep(300);
      await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 10, pitch: 30, dist: 100 }); return 1; })()`);
      await Bun.sleep(700);
      await app.js(`new Promise((q) => setTimeout(() => { __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 1500))`);
      // (the craft's shadow's inputs: drawn — its sphere in the camera's axes —, the setting)
      const sb = await app.js(
        `(() => { const r = __bh.renderer; return { ship: __bh.settings.ship, inView: r.shipInView, bound: r.ship?.shadowBound ?? null }; })()`,
      );
      console.log(`  the craft's shadow: ${JSON.stringify(sb)}`);
      let locked = false;
      const shots: Record<string, Uint8Array> = {};
      let W = 0;
      let H = 0;
      let C = 3;
      for (const [k, tune] of [
        ["glory", "{}"],
        ["none", "{ TUNE_GSKIP: 67108864 }"],
        ["glory2", "{}"],
        ["noshadow", "{ TUNE_GSKIP: 134217728 }"],
        ["column", "{ TUNE_GSKIP: 268435456 }"],
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
      // (the craft's shadow on the deck — VIPER C4's other half —: located by the column test's dark disc — the strongest cell of
      // with it and without —, then with and without the shadow there, against the noise there)
      let at = { e: 0, x: 0, y: 0 };
      for (let cy = Math.ceil((0.05 * H) / 32) * 32; cy + 32 <= 0.85 * H; cy += 32)
        for (let cx = 0; cx + 32 <= W; cx += 32) {
          const e = cell(shots.glory!, shots.column!, cx, cy);
          if (e > at.e) at = { e, x: cx, y: cy };
        }
      // (the silhouette a few tens of pixels: its darkest 8 × 8 window within 64 px of the column's cell)
      const win = (a: Uint8Array, b: Uint8Array, x0: number, y0: number) => {
        let e = 0;
        for (let y = y0; y < y0 + 8; y++)
          for (let x = x0; x < x0 + 8; x++) {
            const o = (y * W + x) * C;
            for (let c = 0; c < 3; c++) e += Math.abs(a[o + c]! - b[o + c]!);
          }
        return e / (8 * 8 * 3);
      };
      let shadow = { e: 0, x: 0, y: 0 };
      for (let y = Math.max(at.y + 16 - 64, 0); y + 8 <= Math.min(at.y + 16 + 64, H); y += 4)
        for (let x = Math.max(at.x + 16 - 64, 0); x + 8 <= Math.min(at.x + 16 + 64, W); x += 4) {
          const e = win(shots.glory!, shots.noshadow!, x, y);
          if (e > shadow.e) shadow = { e, x, y };
        }
      const shadowNoise = win(shots.glory!, shots.glory2!, shadow.x, shadow.y);
      out.shadow = { ...shadow, noise: shadowNoise };
      console.log(
        `  the craft's shadow (near its column's cell ${at.x + 16}, ${at.y + 16}): |Δ| ${shadow.e.toFixed(2)} at ${shadow.x + 4}, ${shadow.y + 4}; the noise there ${shadowNoise.toFixed(2)}`,
      );
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
    const sh = (out as { shadow: { e: number; noise: number } }).shadow;
    expect(sh.e).toBeGreaterThan(3 * sh.noise);
    expect(r.gpuErrors).toBe(0);
  },
  6 * 60_000,
);
