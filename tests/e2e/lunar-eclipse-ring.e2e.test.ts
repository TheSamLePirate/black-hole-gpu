import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// R2 — the eclipsed Moon on the layered air's tables (PLAN-REFRACTION-HORIZONS R2, trace.wgsl earthRingLight: the light the
// Earth's air bends into its shadow, its bending and its slope now B_limbe's): the total eclipse of 7 September 2025 seen from
// over Bangalore (the F-35 at 1 000 m, the cockpit, the telescope on the Moon at a 1.2° field), at mid-totality (18:12 UTC)
// and 5 min after the second contact (17:35 UTC: the Moon by the umbra's edge). At each, the tables on, off (C3's
// exponential air), on — the exposure held at the first's —: shots, and the disc's mean colour at its centre and whole.
// Writes $AB_OUT/lunar-eclipse-ring/<moment>-<on|off|on2>.png and ring.json.
// Duration: ~4 min on this Mac.
// Done when: both moments shot three times, the disc's colours read, no GPU error.
const OUT = `${process.env.AB_OUT ?? "remote-results"}/lunar-eclipse-ring`;
const FOV = 1.2;
afterAll(stopServer);

test.skipIf(!E2E)(
  "R2: the eclipsed Moon of 7 September 2025 lit through the layered air's tables, against C3's exponential air",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const out: Record<string, unknown> = {};
    const [lat, lon] = [12.97, 77.59];
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0,
        dof: false, motionBlur: 0, earthPipeline: "raster", dynamicResolution: false, autoGear: false, f35AutoProtect: false,
        f35Invulnerable: true, refraction: true, lookProfile: "neutral", telescopeSpot: true }); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = (iso: string) =>
        app.js(`(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(${lat}, ${lon}, 1000, 270, 160);
          __bh.settings.shipMount = "cockpit"; __bh.settings.target = "moon"; document.body.classList.add("hide-ui"); return 1; })()`);
      await place("2025-09-07T18:12:00Z");
      await Bun.sleep(1500);
      await app
        .waitFor(`__bh.renderer.rasterLiteActive && __bh.renderer.variantQueue.pending === 0`, 60_000)
        .catch(() => console.warn("  raster kernels not all in after 60 s"));
      if (!(await app.js<boolean>(`__bh.settings.lookAt`))) await app.press("KeyC");
      await Bun.sleep(1000);
      await app.press("KeyY");
      await app.js(`(__bh.camera.setFov(${FOV}), 1)`);
      await app.waitFor(`Math.abs(__bh.settings.fov - ${FOV}) < 0.002`, 30_000);
      out.tables = await app.waitFor(`__bh.renderer.refrPublished !== ""`, 30_000).then(
        () => "published",
        () => "not published after 30 s",
      );
      for (const [moment, iso] of [
        ["mid", "2025-09-07T18:12:00Z"],
        ["c2", "2025-09-07T17:35:00Z"],
      ] as const) {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.game.setDate("${iso}"); __bh.game.flyAt(${lat}, ${lon}, 1000, 270, 160); __bh.settings.shipMount = "cockpit";
          for (let i = 0; i < 30; i++) await f(); __bh.game.setDate("${iso}"); __bh.freeze(true);
          for (let i = 0; i < 90; i++) { __bh.touch(); await f(); } return 1; })()`);
        await app.settled(60_000);
        await app.exposureSettled();
        // (the exposure held at the tables' — the off shot's light compared, not re-metered)
        await app.js(
          `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
        );
        for (const [tag, on] of [
          ["on", true],
          ["off", false],
          ["on2", true],
        ] as const) {
          await app.js(`(() => { __bh.renderer.refrTablesOn = ${on}; return 1; })()`);
          if (on) await app.waitFor(`__bh.renderer.refrPublished !== ""`, 30_000).catch(() => console.warn("  tables not back"));
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 40) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${moment}-${tag}.png`);
          // (the disc: the image's centre — the telescope on the Moon —, its radius from the field: the centre's fifth, the whole)
          const m = await app.js<{ centre: number[]; disc: number[]; rPx: number }>(`(async () => {
            const cv = document.querySelector("canvas");
            const b = await new Promise((r) => requestAnimationFrame(() => r(createImageBitmap(cv))));
            const o = new OffscreenCanvas(b.width, b.height), g = o.getContext("2d"); g.drawImage(b, 0, 0);
            const d = g.getImageData(0, 0, b.width, b.height).data;
            const rPx = (0.26 / __bh.settings.fov) * b.height;
            const acc = (k) => { const s = [0, 0, 0]; let n = 0;
              for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
                const q = Math.hypot(x - b.width / 2, y - b.height / 2) / rPx; if (q > k) continue;
                const i = 4 * (y * b.width + x); s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; }
              return s.map((v) => +(v / Math.max(n, 1)).toFixed(1)); };
            return { centre: acc(0.2), disc: acc(0.9), rPx: +rPx.toFixed(1) }; })()`);
          out[`${moment}-${tag}`] = { ...m, ev: await app.js<number>(`window.__ev`) };
          console.log(`  ${moment} ${tag}: ${JSON.stringify(out[`${moment}-${tag}`])}`);
        }
        await app.js(`(() => { window.__ev = null; return 1; })()`);
      }
      out.pipeline = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
      out.mount = await app.js<string>(`__bh.settings.shipMount`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.errors = app.cdp.errors.slice(0, 5);
      console.log(`  pipeline ${out.pipeline}, mount ${out.mount}, tables ${out.tables}, GPU errors ${out.gpuErrors}`);
    } finally {
      writeFileSync(`${OUT}/ring.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
