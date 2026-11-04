import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C1 — the Earth's air's transmittance table (renderer.tlutOn; trace.wgsl sunThrough): the integral where Chapman's column
// let 10–35 % too much sunlight through with the Sun 1–10° up. Two low-Sun views from the F-35's cockpit, frozen, the exposure
// held at the table's: the Alps from Chamonix at 1 500 m (the Sun ~4° up, lit slopes) and the Atlantic from 300 m at sunset.
// Each: the table on, off, on, off — a shot, the lower and upper thirds' mean colour, the GPU's passes over 3 s.
// AT_OUT: where the shots go (remote-results/air-tlut).
// Done when: both views measured four times, no GPU error. Duration: ~4 min.
const OUT = process.env.AT_OUT ?? "remote-results/air-tlut";
afterAll(stopServer);
test.skipIf(!E2E)(
  "Q5 C1: the transmittance table against Chapman's column — the low Sun's light and the cost, A/B",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, refraction: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const [view, iso, lat, lon, agl, hdg, pitch] of [
        ["alps", "2026-07-10T18:40:00Z", 45.92, 6.87, 1500, 260, -3],
        ["sea", "2026-07-10T19:50:00Z", 47.5, -7.0, 300, 300, 2],
      ] as const) {
        await app.js(
          `(() => { __bh.freeze(false); __bh.game.setDate("${iso}"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${pitch}); __bh.freeze(true); q(1); }, 500))`);
        await app.waitFor(`__bh.renderer.tlutPublished`, 30_000).catch(() => console.warn("  the table not in after 30 s"));
        await app
          .waitFor(`__bh.renderer.earthTiles.pending === 0 && __bh.renderer.earthTiles.orthoPending === 0`, 60_000)
          .catch(() => console.warn("  tiles still pending after 60 s"));
        await app.settled(120_000);
        await app.exposureSettled();
        await app.js(
          `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
        );
        for (const [k, on] of [
          ["on", true],
          ["off", false],
          ["on2", true],
          ["off2", false],
        ] as const) {
          const m = await app.js<{ total: number; rows: [string, number][]; low: number[]; high: number[] }>(`(async () => {
            const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
            r.tlutOn = ${on}; for (let i = 0; i < 60; i++) { __bh.touch(); await frame(); }
            for (let i = 0; i < 600 && ${on} && !r.tlutPublished; i++) { __bh.touch(); await frame(); }
            for (let i = 0; i < 90; i++) { __bh.touch(); await frame(); }
            // (read back after a frame drawn — frozen and untouched the canvas reads black —, again until it is not)
            const cv = document.querySelector("canvas"); let b, d, mx = 0;
            for (let k = 0; k < 20 && mx === 0; k++) { __bh.touch(); await frame(); __bh.touch();
              b = await new Promise((q) => requestAnimationFrame(() => q(createImageBitmap(cv))));
              const o = new OffscreenCanvas(b.width, b.height), g = o.getContext("2d"); g.drawImage(b, 0, 0);
              d = g.getImageData(0, 0, b.width, b.height).data; for (let i = 0; i < d.length; i += 64) mx = Math.max(mx, d[i + 1]); }
            const mean = (y0, y1) => { const s = [0, 0, 0]; let n = 0; for (let y = Math.round(y0 * b.height); y < Math.round(y1 * b.height); y += 2) for (let x = 0; x < b.width; x += 2) { const i = 4 * (y * b.width + x); s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; } return s.map((v) => +(v / n).toFixed(1)); };
            r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
            while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
            const rows = r.prof.table().filter((p) => p.ms > 0.3).map((p) => [p.label, +p.ms.toFixed(3)]);
            const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false;
            return { total, rows, low: mean(0.62, 0.95), high: mean(0.05, 0.38) }; })()`);
          await app.shot(`${OUT}/${view}-${k}.png`);
          out[`${view}-${k}`] = m;
          console.log(`  ${view} ${k}: ${JSON.stringify(m)}`);
        }
        await app.js(`(() => { window.__ev = null; __bh.renderer.tlutOn = true; return 1; })()`);
      }
      out.pipeline = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  pipeline ${out.pipeline}, GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/tlut.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
