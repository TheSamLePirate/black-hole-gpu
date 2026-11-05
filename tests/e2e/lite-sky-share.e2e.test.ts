import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q9 P9, the measure before the work — what the raster's material passes spend where they have none (trace.wgsl shadeLite,
// shadeWater: dispatched over the whole image, a sky's or a land's pixel returning at once): the F-35's cockpit over La Mancha
// (no water) at 2 000 m, frozen, its look raised step by step (−10°, 0°, +10°, +20°: the ground's share of the image falling);
// at each the passes' cost (2 s) and the ground's share (the shot's pixels under the horizon's row, by the sky's blue). If the
// material's cost follows the ground's share, the empty groups cost nothing: a tiles' classification and an indirect dispatch
// would gain little.
// LS_OUT: the shots and figures (remote-results/lite-sky-share).
// Duration: ~3 min on this Mac.
// Done when: the four looks measured, no GPU error.
const OUT = process.env.LS_OUT ?? "remote-results/lite-sky-share";
afterAll(stopServer);
test.skipIf(!E2E)(
  "P9: the raster material's cost against the ground's share of the image",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair" }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T11:00:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(39.42, -3.05, 2000, 90, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await Bun.sleep(800);
      const rows: unknown[] = [];
      for (const pitch of [-10, 0, 10, 20]) {
        await app.js(`(() => { __bh.freeze(false); __bh.camera.setLook(0, ${pitch}); return 1; })()`);
        await Bun.sleep(600);
        await app.js(`(() => { __bh.camera.setLook(0, ${pitch}); __bh.game.setDate("${iso}"); __bh.freeze(true); return 1; })()`);
        await app.settled(120_000);
        const m = await app.js<{ lite: number; water: number; vis: number; total: number }>(`(async () => {
          const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 60; i++) { __bh.touch(); await f(); }
          r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
          while (performance.now() - t0 < 2000) { __bh.touch(); await f(); }
          const rows = r.prof.table(); const g = (re) => +rows.filter((p) => re.test(p.label)).reduce((s, p) => s + p.ms, 0).toFixed(3);
          const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false;
          return { lite: g(/^earth lite/), water: g(/^earth water/), vis: g(/terrain raster visibility/), total }; })()`);
        const file = `${OUT}/pitch${pitch}.png`;
        await app.shot(file);
        const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
        // (the ground's share: pixels less blue than green-and-red's mean by 10 % — the sky's blue left out)
        let ground = 0;
        for (let o = 0; o < img.data.length; o += img.channels * 7) {
          const r = img.data[o]!,
            g = img.data[o + 1]!,
            b = img.data[o + 2]!;
          if (b < 1.1 * (0.5 * (r + g))) ground++;
        }
        const share = +(ground / (img.data.length / (img.channels * 7))).toFixed(3);
        const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
        const row = { pitch, share, ...m, pipe };
        rows.push(row);
        console.log(
          `  look ${pitch}°: ground ${share}, earth lite ${m.lite} ms, earth water ${m.water} ms, visibility ${m.vis} ms, GPU ${m.total} ms (${pipe})`,
        );
      }
      out.rows = rows;
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/share.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
