import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C3 — the day's aerosols (system/aerosols.ts; renderer.aerosolOverride, tlutAerosols, aerosolSource): the Alps from
// Chamonix at 1 500 m, the Sun ~10° up, the F-35's cockpit, frozen, the exposure held — the air's tables built for an optical
// depth at 550 nm of 0.028 (an ordinary day's), 0.15 and 0.4 (a hazy one): shots, the sky's and the slopes' colours. Then the
// real weather: CAMS's optical depth asked of Open-Meteo from the browser (its CORS), the tables built for it, its credit shown.
// AA_OUT: where the shots go (remote-results/air-aerosols).
// Done when: the three hazes shot and the real weather's aerosols in (or said missing after 30 s), no GPU error.
// Duration: ~3 min.
const OUT = process.env.AA_OUT ?? "remote-results/air-aerosols";
afterAll(stopServer);
test.skipIf(!E2E)(
  "Q5 C3: the air's tables built for the day's aerosols — forced hazes, then CAMS's through Open-Meteo",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, refraction: true, weather: "fair" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T17:55:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(45.92, 6.87, 1500, 270, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, 2); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 500))`,
      );
      await app.waitFor(`__bh.renderer.tlutPublished`, 30_000).catch(() => console.warn("  the tables not in after 30 s"));
      await app.settled(120_000);
      await app.exposureSettled();
      await app.js(
        `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
      );
      for (const aod of [0.028, 0.15, 0.4]) {
        const m = await app.js<{ low: number[]; high: number[]; k: number }>(`(async () => {
          const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          r.aerosolOverride = ${aod};
          for (let i = 0; i < 1200 && Math.abs(r.tlutAerosols - ${aod} / 0.028) > 0.05 * ${aod} / 0.028; i++) { __bh.touch(); await frame(); }
          for (let i = 0; i < 90; i++) { __bh.touch(); await frame(); }
          const cv = document.querySelector("canvas"); let b, d, mx = 0;
          for (let k = 0; k < 20 && mx === 0; k++) { __bh.touch(); await frame(); __bh.touch();
            b = await new Promise((q) => requestAnimationFrame(() => q(createImageBitmap(cv))));
            const o = new OffscreenCanvas(b.width, b.height), g = o.getContext("2d"); g.drawImage(b, 0, 0);
            d = g.getImageData(0, 0, b.width, b.height).data; for (let i = 0; i < d.length; i += 64) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]); }
          const mean = (y0, y1) => { const s = [0, 0, 0]; let n = 0; for (let y = Math.round(y0 * b.height); y < Math.round(y1 * b.height); y += 2) for (let x = 0; x < b.width; x += 2) { const i = 4 * (y * b.width + x); s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; } return s.map((v) => +(v / n).toFixed(1)); };
          return { low: mean(0.62, 0.95), high: mean(0.05, 0.38), k: r.tlutAerosols }; })()`);
        await app.shot(`${OUT}/aod-${aod}.png`);
        out[`aod-${aod}`] = m;
        console.log(`  τ ${aod}: ${JSON.stringify(m)}`);
      }
      await app.js(`(() => { window.__ev = null; __bh.renderer.aerosolOverride = null; return 1; })()`);
      // (the real weather: the day's aerosols from CAMS — a date with its data: today's)
      const now = `${new Date().toISOString().slice(0, 13)}:00:00Z`;
      await app.js(`(() => { __bh.freeze(false); __bh.game.setDate("${now}"); __bh.settings.weather = "real"; return 1; })()`);
      out.real = await app
        .waitFor(`__bh.renderer.aerosolSource === "cams"`, 30_000)
        .then(async () => {
          await app.waitFor(`__bh.renderer.tlutAerosols === __bh.renderer.tlutWanted`, 30_000).catch(() => {});
          return app.js(
            `(() => ({ source: __bh.renderer.aerosolSource, k: __bh.renderer.tlutAerosols, aod: +(__bh.renderer.tlutAerosols * 0.028).toFixed(3), credit: !document.querySelector('[data-testid="aerosol-credit"]').hidden }))()`,
          );
        })
        .catch(() => "CAMS's aerosols not in after 30 s");
      console.log(`  real weather: ${JSON.stringify(out.real)}`);
      await app.shot(`${OUT}/real.png`);
      out.pipeline = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  pipeline ${out.pipeline}, GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/aerosols.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
    expect(typeof out.real).toBe("object");
  },
  6 * 60_000,
);
