import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C6 — the clouds' near self-shadow and their wide shadow field apart (trace.wgsl wxCloud: the march its own layer's first
// 3.8 km towards the Sun — CLOUD_NEAR_N 6 steps —, the clouds' shadow map from there on — every layer's, on the same sunbeam —
// in place of the other layers' mean veil), and the shadow map's march where the clouds are (the layers' heights, not
// 300 m – 13 km) with a fixed jitter a texel. The F-35's cockpit, frozen, the exposure locked at the meter's first reading:
// La Mancha "overcast" (a deck 600–2 000 m under a broken layer 4 000–5 500 m) from 7 000 m, 4° down, 13:00 UTC — the low
// deck's top under the upper layer's gaps —; a "storm" from 3 000 m at 17:30 UTC, the Sun low behind — towers' shadows on
// their neighbours. At each, a shot and the clouds' passes' cost (2 s): C6 (3.8 km + map), C6 with 900 m of march
// (CLOUD_NEAR_N 4), before (the far field off — TUNE_GSKIP 1048576: 3.8 km and the veil), the reference (4194304: every
// cloud on the sunbeam marched out to 120 km, no map), C6 again (the measure's own noise). CS_OUT: the shots and figures
// (remote-results/cloud-shadow-c6).
// Duration: ~6 min on this Mac.
// Done when: the ten shots taken and each mode's pass costs logged, no GPU error.
const OUT = process.env.CS_OUT ?? "remote-results/cloud-shadow-c6";
afterAll(stopServer);
test.skipIf(!E2E)(
  "C6: the clouds lit by the shadow map past their own near march, the map marched where the clouds are",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const [place, wx, iso, alt, hdg, pitch] of [
        ["overcast", "overcast", "2026-07-10T13:00:00Z", 7000, 90, -4],
        ["storm", "storm", "2026-07-10T17:30:00Z", 3000, 90, 1],
      ] as const) {
        await app.js(
          `(() => { __bh.game.setDate("${iso}"); __bh.settings.autoExposure = true; __bh.settings.exposure = 0; __bh.game.set("weather", "${wx}"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, ${alt}, ${hdg}, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(
          `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${pitch}); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
        );
        let locked = false;
        for (const [k, tune] of [
          ["on", "{}"],
          ["near4", "{ CLOUD_NEAR_N: 4 }"],
          ["nofar", "{ TUNE_GSKIP: 1048576 }"],
          ["ref", "{ TUNE_GSKIP: 4194304 }"],
          ["on2", "{}"],
        ] as const) {
          await app.js(`(() => { __bh.renderer.tune = ${tune}; return 1; })()`);
          await app.settled(120_000);
          // (frozen: the raster's shading round every pixel, the clouds' history converged)
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 120; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          // (the exposure locked at the meter's reading after the first: the five shots exposed alike)
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
          const m = await app.js<{ clouds: number; csm: number; total: number }>(`(async () => {
            const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
            r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
            while (performance.now() - t0 < 2000) { __bh.touch(); await f(); }
            const rows = r.prof.table(); const g = (re) => +rows.filter((p) => re.test(p.label)).reduce((s, p) => s + p.ms, 0).toFixed(3);
            const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false;
            return { clouds: g(/^clouds \\(half\\)/), csm: g(/clouds' shadow map/), total }; })()`);
          const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
          const mount = await app.js<string>(`__bh.settings.shipMount`);
          out[`${place}-${k}`] = { ...m, pipe, mount };
          await app.shot(`${OUT}/${place}-${k}.png`);
          console.log(`  ${place} ${k}: clouds ${m.clouds} ms, shadow map ${m.csm} ms, GPU ${m.total} ms (${pipe}, ${mount})`);
        }
      }
      await app.js(`(() => { __bh.renderer.tune = {}; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/c6.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  12 * 60_000,
);
