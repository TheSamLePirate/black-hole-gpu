import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C1 (second lot) — the air's multiple scattering from its table (renderer.msLutOn; trace.wgsl earthAir σ_s Ψ_ms) against
// the single scattering's isotropic stand-in (0.8 and 0.3 of it, under the Sun's ray): the Alps from Chamonix at 1 500 m,
// the F-35's cockpit, looking west (the Sun's side) then east (away), the Sun at ~30°, 10°, 2°, −4° and −8° (the twilight's
// sky past the terminator). Each: the table on, then off, the exposure held at the table's — the image's upper third (the sky)
// and lower third (the slopes), a shot of each, the passes over 2 s. MS_OUT: where the shots go (remote-results/air-ms).
// Done when: the five moments measured both ways, no GPU error. Duration: ~5 min.
const OUT = process.env.MS_OUT ?? "remote-results/air-ms";
afterAll(stopServer);
test.skipIf(!E2E)(
  "Q5 C1: the multiple scattering's table against the isotropic stand-in, from day to twilight",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, refraction: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (Chamonix, 10 July 2026: the Sun's heights by the clock — UTC)
      for (const [tag, iso, hdg] of [
        ["sun30", "2026-07-10T16:00:00Z", 270],
        ["sun10", "2026-07-10T17:55:00Z", 270],
        ["sun2", "2026-07-10T19:00:00Z", 290],
        ["m4", "2026-07-10T19:45:00Z", 300],
        ["m8", "2026-07-10T20:15:00Z", 300],
      ] as const) {
        await app.js(
          `(() => { __bh.freeze(false); __bh.game.setDate("${iso}"); __bh.game.flyAt(45.92, 6.87, 1500, ${hdg}, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(
          `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, 4); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 500))`,
        );
        await app.waitFor(`__bh.renderer.tlutPublished`, 30_000).catch(() => console.warn("  the tables not in after 30 s"));
        await app.settled(120_000);
        await app.exposureSettled();
        await app.js(
          `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
        );
        for (const [k, on] of [
          ["on", true],
          ["off", false],
        ] as const) {
          const m = await app.js<{ low: number[]; high: number[]; ev: number; pass: Record<string, number> }>(`(async () => {
            const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
            r.msLutOn = ${on}; for (let i = 0; i < 90; i++) { __bh.touch(); await frame(); }
            const cv = document.querySelector("canvas"); let b, d, mx = 0;
            for (let k = 0; k < 20 && mx === 0; k++) { __bh.touch(); await frame(); __bh.touch();
              b = await new Promise((q) => requestAnimationFrame(() => q(createImageBitmap(cv))));
              const o = new OffscreenCanvas(b.width, b.height), g = o.getContext("2d"); g.drawImage(b, 0, 0);
              d = g.getImageData(0, 0, b.width, b.height).data; for (let i = 0; i < d.length; i += 64) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]); }
            const mean = (y0, y1) => { const s = [0, 0, 0]; let n = 0; for (let y = Math.round(y0 * b.height); y < Math.round(y1 * b.height); y += 2) for (let x = 0; x < b.width; x += 2) { const i = 4 * (y * b.width + x); s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; } return s.map((v) => +(v / n).toFixed(1)); };
            // (the passes over 2 s: the multiple scattering's cost)
            r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
            while (performance.now() - t0 < 2000) { __bh.touch(); await frame(); }
            const pass = Object.fromEntries(r.prof.table().filter((p) => /trace|earth lite|sky|air/.test(p.label)).map((p) => [p.label, +p.ms.toFixed(3)]));
            r.prof.enabled = false;
            return { low: mean(0.62, 0.95), high: mean(0.05, 0.38), ev: +window.__ev.toFixed(2), pass }; })()`);
          await app.shot(`${OUT}/${tag}-${k}.png`);
          out[`${tag}-${k}`] = m;
          console.log(`  ${tag} ${k}: ${JSON.stringify(m)}`);
        }
        await app.js(`(() => { window.__ev = null; __bh.renderer.msLutOn = true; return 1; })()`);
      }
      out.pipeline = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  pipeline ${out.pipeline}, GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/ms.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
