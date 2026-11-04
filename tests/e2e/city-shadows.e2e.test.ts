import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { placeLow } from "./lib/place";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng, writePng } from "./lib/png";

// Q4 S1 — the city's shadows past the scenery's own shadow map (renderer.sceneryInCascades; scenery-raster.ts encodeCascade): the
// buildings drawn into the relief's shadow cascades (T6: ±1.5 km at 1.5 m a texel, ±10 km at 9.8 m), their shadows read on the
// ground out to the scenery's reach — before, its own map's ±900 m faded out from 550 m, the far city shadowless. Paris from the
// west, 400 m up, the Sun ~20° behind, frozen, the exposure held; shot with the buildings in the cascades off, on, off again (the
// scene's drift on both sides): the image's darkening in the city's band (rows 0.3–0.5: 1–4 km off), the pixels darkened by
// 20 %, a map of them; the cascades' pass timed with and without.
// Output: remote-results/city-shadows/{off,on,off2,diff}.png, city-shadows.json (CS2_OUT).
// Done when: placed level over the relief in (lib/place.ts), the scenery whole (60 s at most), the three shots compared, no GPU
// error. Duration: ~3 min (Paris's buildings).
const OUT = process.env.CS2_OUT ?? "remote-results/city-shadows";
afterAll(stopServer);
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
const lum = (p: ReturnType<typeof png>, i: number) =>
  0.2126 * p.data[i * p.channels]! + 0.7152 * p.data[i * p.channels + 1]! + 0.0722 * p.data[i * p.channels + 2]!;

test.skipIf(!E2E)(
  "Q4 S1: the far city casts its shadows — the buildings in the relief's cascades",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", traffic: false, f35Invulnerable: true, f35AutoProtect: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(
        `(() => { __bh.game.setDate("2026-07-10T17:45:00Z"); __bh.game.set("weather", "fair"); document.body.classList.add("hide-ui"); return 1; })()`,
      );
      const placed = await placeLow(app, [48.856, 2.255, 400, 90, 140], -8);
      const world = await app
        .waitFor(
          `(() => { const sc = __bh.renderer.earthScenery.stats(); return __bh.renderer.earthTiles.pending === 0 && sc.status === "ready" && !sc.pending; })()`,
          60_000,
        )
        .then(
          () => "all in",
          () => "not all in after 60 s",
        );
      await app.settled(60_000);
      await app.exposureSettled();
      await app.js(
        `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
      );
      // (the GPU's errors told by their text, not only counted)
      await app.js(
        `(() => { const r = __bh.renderer, prev = r.onGpuError; window.__gpuMsgs = []; r.onGpuError = (m) => { window.__gpuMsgs.push(String(m).slice(0, 400)); prev?.(m); }; return 1; })()`,
      );
      const cost: Record<string, number> = {};
      for (const [tag, on] of [
        ["off", false],
        ["on", true],
        ["off2", false],
      ] as const) {
        await app.js(`(() => { __bh.renderer.sceneryInCascades = ${on}; __bh.touch(); return 1; })()`);
        cost[tag] =
          await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
          for (let i = 0; i < 60; i++) { __bh.touch(); await frame(); }
          const T = r.prof.table(); r.prof.enabled = false; return +(T.find((x) => x.label === "terrain from the Sun")?.ms ?? -1).toFixed(3); })()`);
        await app.shot(`${OUT}/${tag}.png`);
      }
      await app.js(`(() => { window.__ev = null; __bh.renderer.sceneryInCascades = true; __bh.freeze(false); return 1; })()`);
      const off = png(`${OUT}/off.png`),
        on = png(`${OUT}/on.png`),
        off2 = png(`${OUT}/off2.png`);
      const W = off.width,
        H = off.height;
      const img = new Uint8Array(W * H * 3);
      let n = 0,
        sOn = 0,
        sOff = 0,
        sOff2 = 0,
        darker = 0,
        noiseDarker = 0;
      for (let i = 0; i < W * H; i++) {
        const row = Math.floor(i / W);
        const a = lum(on, i),
          b = lum(off, i),
          c = lum(off2, i);
        const g = Math.round(0.35 * b);
        img.set([g, g, g], i * 3);
        if (row < 0.3 * H || row > 0.5 * H || b < 12) continue;
        n++;
        sOn += a;
        sOff += b;
        sOff2 += c;
        if (a < 0.8 * Math.max(b, c)) {
          darker++;
          img.set([255, Math.round(0.4 * a), Math.round(0.4 * a)], i * 3);
        }
        if (c < 0.8 * b) noiseDarker++;
      }
      writeFileSync(`${OUT}/diff.png`, writePng(W, H, img));
      const out = {
        placed,
        world,
        band: n,
        ratio: +(sOn / ((sOff + sOff2) / 2)).toFixed(4),
        noise: +(sOff2 / sOff).toFixed(4),
        darker: +(darker / Math.max(n, 1)).toFixed(4),
        noiseDarker: +(noiseDarker / Math.max(n, 1)).toFixed(4),
        sunPassMs: cost,
        gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`),
        gpuMessages: app.cdp.errors
          .filter((e) => /WebGPU/i.test(e))
          .slice(0, 4)
          .map((e) => e.slice(0, 600)),
      };
      console.log(`  city shadows: ${JSON.stringify(out)}`);
      await Bun.write(`${OUT}/city-shadows.json`, JSON.stringify(out, null, 1));
      expect(out.gpuErrors).toBe(0);
    } finally {
      await app.close();
    }
  },
  8 * 60_000,
);
