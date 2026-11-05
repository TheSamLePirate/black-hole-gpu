import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 P8 — the clouds' shadow map amortised (trace.wgsl cloudShadow, CSM_EVERY; renderer.csmEvery): a row in four refreshed a
// frame, in turn, all of them whenever the map's frame moves (its centre by a tenth of a texel, the Sun by 0.02°). La Mancha,
// "cloudy" (cumulus 1 200–2 600 m), 13:00 UTC, the F-35's cockpit at 4 000 m looking 25° down — the cumulus's shadows on the
// ground —, the exposure locked. Frozen, placed once: the map's pass's cost (2 s) and a shot with csmEvery 4, 1, 4. Flying (the world
// running, 140 m/s, 2 s): the map's cost with 4, 1, 4 — its centre following the camera. Frozen, the PSNR of the a-row-in-four
// shot against the every-row one (the shadows the same), and of the two a-row-in-four ones (the measure's noise). CA_OUT: the shots (remote-results/cloud-shadow-amortise).
// Duration: ~4 min on this Mac.
// Done when: the four shots taken, each mode's map cost and the PSNRs logged, no GPU error.
const OUT = process.env.CA_OUT ?? "remote-results/cloud-shadow-amortise";
afterAll(stopServer);
const psnr = (a: Uint8Array, b: Uint8Array, W: number, H: number, C: number) => {
  let se = 0;
  let n = 0;
  for (let y = Math.floor(0.3 * H); y < 0.75 * H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C;
      for (let c = 0; c < 3; c++) {
        const d = a[o + c]! - b[o + c]!;
        se += d * d;
        n++;
      }
    }
  return 10 * Math.log10((255 * 255) / Math.max(se / n, 1e-9));
};
test.skipIf(!E2E)(
  "P8: the clouds' shadow map a row in four a frame — its cost, the ground's shadows the same",
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
      // (placed once and frozen: every mode's shot of the same view)
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, 4000, 270, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -25); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
      );
      await app.settled(120_000);
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      await frames(180);
      await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
      const cost = (moving: boolean) =>
        app.js<{ csm: number; clouds: number }>(`(async () => {
          const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          ${moving ? "__bh.freeze(false);" : ""}
          r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
          while (performance.now() - t0 < 2000) { __bh.touch(); await f(); }
          const rows = r.prof.table(); const g = (re) => +rows.filter((p) => re.test(p.label)).reduce((s, p) => s + p.ms, 0).toFixed(3);
          r.prof.enabled = false; ${moving ? "__bh.freeze(true);" : ""}
          return { csm: g(/clouds' shadow map/), clouds: g(/^clouds \\(half\\)/) }; })()`);
      const imgs: Record<string, Uint8Array> = {};
      let W = 0;
      let H = 0;
      let C = 3;
      for (const [k, every] of [
        ["every4", 4],
        ["every1", 1],
        ["every4b", 4],
      ] as const) {
        await app.js(`(() => { __bh.renderer.csmEvery = ${every}; __bh.touch(); return 1; })()`);
        await app.settled(120_000);
        await frames(60);
        const m = await cost(false);
        const file = `${OUT}/still-${k}.png`;
        await app.shot(file);
        const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
        imgs[k] = img.data;
        W = img.width;
        H = img.height;
        C = img.channels;
        out[`still-${k}`] = m;
        console.log(`  still csmEvery ${every}: the map ${m.csm} ms, the cloud pass ${m.clouds} ms`);
      }
      const a = psnr(imgs.every4!, imgs.every1!, W, H, C);
      const b = psnr(imgs.every4!, imgs.every4b!, W, H, C);
      out["still-psnr"] = { vsEveryRow: +a.toFixed(2), noise: +b.toFixed(2) };
      console.log(`  still: PSNR a row in four against every row ${a.toFixed(2)} dB; the two a-row-in-four ${b.toFixed(2)} dB`);
      // (flying: the map's frame following the camera — its cost alone, the views not the same)
      for (const every of [4, 1, 4]) {
        await app.js(`(() => { __bh.renderer.csmEvery = ${every}; __bh.touch(); return 1; })()`);
        await app.settled(120_000);
        const m = await cost(true);
        out[`flying-${every}-${Object.keys(out).length}`] = m;
        console.log(`  flying csmEvery ${every}: the map ${m.csm} ms, the cloud pass ${m.clouds} ms`);
      }
      await app.shot(`${OUT}/flying.png`);
      await app.js(`(() => { __bh.renderer.csmEvery = 4; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/amortise.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
