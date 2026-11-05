import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 VIPER C3 — the clouds' near field (trace.wgsl wxCloud: the camera in a layer or within 300 m of it, its rays' first 900 m
// marched finely — 20 steps to 450 m, 8 to 900 — before the layer's own samples). La Mancha, the "cloudy" weather (cumulus
// 1 200–2 600 m, cover 0.45), 13:00 UTC, the F-35's cockpit at 1 900 m inside the layer, looking level west, frozen, the
// exposure locked: a shot and the clouds' pass's cost (2 s) with the near field (TUNE_GSKIP 536870912: off by default), without
// it, with it again; then above the layer (3 500 m: the near field off by itself — its cost the same as without). CN_OUT: the shots
// (remote-results/cloud-near-field).
// Duration: ~3 min on this Mac.
// Done when: the four shots taken and each one's pass cost logged, no GPU error.
const OUT = process.env.CN_OUT ?? "remote-results/cloud-near-field";
afterAll(stopServer);
test.skipIf(!E2E)(
  "VIPER C3: inside a cumulus layer, its first 900 m marched finely",
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
      for (const [k, alt, tune] of [
        ["near", 1900, "{ TUNE_GSKIP: 536870912 }"],
        ["none", 1900, "{}"],
        ["near2", 1900, "{ TUNE_GSKIP: 536870912 }"],
        ["above", 3500, "{ TUNE_GSKIP: 536870912 }"],
      ] as const) {
        await app.js(
          `(() => { __bh.renderer.tune = ${tune}; __bh.freeze(false); __bh.game.setDate("${iso}"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, ${alt}, 270, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(
          `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, 2); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
        );
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
        const m = await app.js<{ clouds: number }>(`(async () => {
          const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
          while (performance.now() - t0 < 2000) { __bh.touch(); await f(); }
          const rows = r.prof.table(); const g = (re) => +rows.filter((p) => re.test(p.label)).reduce((s, p) => s + p.ms, 0).toFixed(3);
          r.prof.enabled = false; return { clouds: g(/^clouds \\(half\\)/) }; })()`);
        const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
        out[k] = { ...m, pipe };
        await app.shot(`${OUT}/${k}.png`);
        console.log(`  ${k}: clouds (half) ${m.clouds} ms (${pipe})`);
      }
      await app.js(`(() => { __bh.renderer.tune = {}; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/near.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
