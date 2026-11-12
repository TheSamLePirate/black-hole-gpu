import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// Probe — not in `bun run e2e`: E2E_PROBE=1 — (PLAN-VEGETATION-V2 V2e, F1): the near trees sway in the wind (forest.wgsl
// forestSway), against still trees (renderer.treeWindOn false), over the Maures' forest north of Hyères, a strong wind (the
// setting's 3): 60 m over the canopy looking along the slope. For each, in turn: two shots half a second apart, the time running —
// their difference over the trees' band (the sway, the noise of the image's own jitter beside it) —, GPU p50/p95 over 6 s.
// Duration: ~3 min. Done when: both ways shot and measured, twice.
afterAll(stopServer);
const OUT = process.env.WIND_OUT ?? "remote-results/forest-wind";
mkdirSync(OUT, { recursive: true });
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the near trees sway in the wind",
  async () => {
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { traffic: false, autosave: false, weather: "fair", earthClouds: 0.1, wind: 3 });
        __bh.game.setDate("2026-07-10T09:30:00Z"); return 1; })()`);
      const why = await app.js(`(() => __bh.viewAt(43.19, 6.25, { altM: 60, heading: 60, pitch: -10, fov: 50 }) ?? null)()`);
      if (why) throw new Error(`viewAt: ${why}`);
      await app.dataSettled("forest", { maxMs: 90_000 }).catch((e) => console.log(`(not settled: ${String(e).slice(0, 160)})`));
      // (the tracer's kernels compiled for this view — a changed shader takes tens of seconds —: not its black first frames)
      await app.settled(180_000);
      await app.exposureSettled?.();
      const sway = await app.js(
        `(() => ({ raster: __bh.renderer.sceneryRaster?.sway ?? null, tracer: __bh.renderer.earthScenery.sway }))()`,
      );
      console.log("  the wind:", JSON.stringify(sway));
      // (the mean absolute step of luminance between two images over the lower half — the canopy —, 0…255)
      const diff = (a: Uint8Array, b: Uint8Array) => {
        const A = readPng(a),
          B = readPng(b);
        let s = 0,
          n = 0;
        for (let y = Math.floor(A.height * 0.5); y < Math.floor(A.height * 0.85); y++)
          for (let x = Math.floor(A.width * 0.1); x < Math.floor(A.width * 0.9); x++) {
            const i = A.channels * (y * A.width + x);
            const L = (P: Uint8Array) => 0.2126 * P[i]! + 0.7152 * P[i + 1]! + 0.0722 * P[i + 2]!;
            s += Math.abs(L(A.data) - L(B.data));
            n++;
          }
        return s / n;
      };
      const shot = async (file: string) => {
        await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
        // (straight from the page — app.shot waits for the image to settle: not half a second apart)
        const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
        const b = new Uint8Array(Buffer.from(r.data, "base64"));
        await Bun.write(file, b);
        await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
        return b;
      };
      for (const pass of [1, 2])
        for (const on of [true, false]) {
          await app.js(`(() => { __bh.renderer.treeWindOn = ${on}; return 1; })()`);
          await Bun.sleep(2500);
          const a = await shot(`${OUT}/p${pass}-${on ? "wind" : "still"}-a.png`);
          await Bun.sleep(500);
          const b = await shot(`${OUT}/p${pass}-${on ? "wind" : "still"}-b.png`);
          const r = await app.js<{ gpu: number[] }>(`(async () => {
            const R = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q)); const gpu = []; let last = R.completedFrames; const t0 = performance.now();
            while (performance.now() - t0 < 6000) { __bh.touch(); await f(); if (R.completedFrames !== last) { last = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); } }
            return { gpu }; })()`);
          const s = [...r.gpu].sort((x, y) => x - y);
          const passes = await app.js(
            `(() => __bh.renderer.prof?.table?.().filter((p) => /earth lite|scenery raster/.test(p.label)).map((p) => [p.label, +p.ms.toFixed(2)]) ?? null)()`,
          );
          console.log(
            JSON.stringify({
              pass,
              wind: on,
              step: +diff(a, b).toFixed(2),
              images: s.length,
              gpuP50: s[Math.floor(s.length / 2)],
              gpuP95: s[Math.floor(s.length * 0.95)],
              passes,
            }),
          );
        }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  600_000,
);
