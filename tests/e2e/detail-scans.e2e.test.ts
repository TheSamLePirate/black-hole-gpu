import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q7 L8 / VIPER B3 — the ground's detail scans (system/detail-scans.ts, trace.wgsl groundDetail; settings.earthDetail): low over
// the Beauce's fields and a road (DS_SITE "lat,lon"), the F-35 30 m over the ground, the cockpit looking 25° down, 13:00 UTC in
// July, frozen, the exposure locked: with the scans, without, with again — shots, their PSNR (the change against two shots
// alike), the near ground's local contrast (the luminance's standard deviation in 8-px cells, the image's lower half), the GPU's
// completed frames' interval.
// DS_OUT: the shots (remote-results/detail-scans).
// Duration: ~4 min on this Mac.
// Done when: the three shots taken, the scans in, no GPU error.
const OUT = process.env.DS_OUT ?? "remote-results/detail-scans";
const [LAT, LON] = (process.env.DS_SITE ?? "48.2350,1.8050").split(",").map(Number) as [number, number];
afterAll(stopServer);
test.skipIf(!E2E)(
  "L8: the ground's detail scans on and off — the change, the contrast near, the frame",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair", earthDetail: true }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T13:00:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(${LAT}, ${LON}, 30, 90, 0); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -25); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
      );
      await app
        .waitFor(
          `(() => { __bh.touch(); const r = __bh.renderer, sc = r.earthScenery.stats(); return !!r.detail?.ready && r.earthTiles.pending === 0 && r.earthTiles.orthoPending === 0 && sc.status !== "loading"; })()`,
          60_000,
        )
        .catch(async () =>
          console.warn(
            `  not all in after 60 s — ${await app.js<string>(`JSON.stringify({ detail: __bh.renderer.detail?.ready, failed: __bh.renderer.detail?.failed, scenery: __bh.renderer.earthScenery.stats().status })`)}`,
          ),
        );
      await app.settled(120_000);
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      await frames(150);
      await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
      const shots: Record<string, Uint8Array> = {};
      let W = 0,
        H = 0;
      for (const [k, on] of [
        ["detail", true],
        ["plain", false],
        ["detail2", true],
      ] as const) {
        await app.js(`(() => { __bh.settings.earthDetail = ${on}; __bh.touch(); return 1; })()`);
        await frames(120);
        const fr = await app.js<number>(`(async () => {
          const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          await f(); const c0 = r.completedFrames, t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await f(); }
          return +((performance.now() - t0) / Math.max(1, r.completedFrames - c0)).toFixed(1); })()`);
        await app.shot(`${OUT}/${k}.png`);
        const p = readPng(new Uint8Array(await Bun.file(`${OUT}/${k}.png`).arrayBuffer()));
        shots[k] = p.data;
        W = p.width;
        H = p.height;
        out[k] = {
          frameMs: fr,
          pipe: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings) + " " + __bh.settings.shipMount`),
        };
      }
      const psnr = (a: Uint8Array, b: Uint8Array) => {
        let se = 0;
        for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2;
        return +(10 * Math.log10((255 * 255) / Math.max(se / a.length, 1e-9))).toFixed(2);
      };
      // (the near ground's local contrast: the luminance's σ in 8-px cells over the image's lower half, their median)
      const contrast = (d: Uint8Array) => {
        const s: number[] = [];
        for (let y0 = Math.floor(H / 2); y0 + 8 <= H - 60; y0 += 8)
          for (let x0 = 0; x0 + 8 <= W; x0 += 8) {
            const v: number[] = [];
            for (let y = y0; y < y0 + 8; y++)
              for (let x = x0; x < x0 + 8; x++) {
                const i = 4 * (y * W + x);
                v.push(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!);
              }
            const m = v.reduce((a, b) => a + b, 0) / v.length;
            s.push(Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length));
          }
        s.sort((a, b) => a - b);
        return +s[s.length >> 1]!.toFixed(2);
      };
      out.psnr = { detailVsPlain: psnr(shots.detail!, shots.plain!), detailVsDetail2: psnr(shots.detail!, shots.detail2!) };
      out.contrast = Object.fromEntries(Object.entries(shots).map(([k, d]) => [k, contrast(d)]));
      console.log(
        `  ${JSON.stringify({ frames: ["detail", "plain", "detail2"].map((k) => (out[k] as { frameMs: number }).frameMs), psnr: out.psnr, contrast: out.contrast, pipe: (out.detail as { pipe: string }).pipe })}`,
      );
      await app.js(
        `(() => { __bh.settings.earthDetail = true; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.ready = await app.js<boolean>(`!!__bh.renderer.detail?.ready`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/detail.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.ready).toBe(true);
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
