import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { placeLow } from "./lib/place";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng } from "./lib/png";

// The image frame by frame (Sam, 4 Nov 2026: the flicker analysed on consecutive captures) — Paris from the west at 400 m, the Sun
// ~20°, the buildings in the relief's cascades on (Q4 S1) and off. Two regimes, each mode:
//   still: the world frozen, 30 consecutive frames captured — each pixel's standard deviation over them, the flicker alone
//     (C0-12: ≤ 1 % on 30 frozen frames), in the city's band (rows 0.3–0.5 of the height);
//   flight: 24 frames each after a step of 1/30 s, captured one by one, and for each whether the cascades were drawn again
//     (renderer.terrainRaster.sunDrewNow) — the shadows' pops beside their redraws.
// Output: remote-results/city-flicker/<mode>-<still|fly>-NN.png, city-flicker.json (CF_OUT). Sheets and a GIF are made from them.
// Done when: placed level (lib/place.ts), the four series captured, no GPU error (their texts said). Duration: ~4 min.
const OUT = process.env.CF_OUT ?? "remote-results/city-flicker";
afterAll(stopServer);
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
const lumAt = (p: ReturnType<typeof png>, i: number) =>
  0.2126 * p.data[i * p.channels]! + 0.7152 * p.data[i * p.channels + 1]! + 0.0722 * p.data[i * p.channels + 2]!;

test.skipIf(!E2E)(
  "the city's image frame by frame: frozen flicker and flight pops, buildings in the cascades on and off",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", traffic: false, f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(
        `(() => { __bh.game.setDate("2026-07-10T17:45:00Z"); __bh.game.set("weather", "fair"); document.body.classList.add("hide-ui"); return 1; })()`,
      );
      out.placed = await placeLow(app, [48.856, 2.255, 400, 90, 140], -8);
      await app
        .waitFor(
          `(() => { const sc = __bh.renderer.earthScenery.stats(); return __bh.renderer.earthTiles.pending === 0 && sc.status === "ready" && !sc.pending; })()`,
          60_000,
        )
        .catch(() => console.log("  the scenery not whole after 60 s — captured anyway"));
      await app.settled(60_000);
      await app.exposureSettled();
      const save = await app.js<string>(`JSON.stringify(__bh.game.snapshot("city-flicker"))`);
      const grab = async (f: string) => {
        const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
        await Bun.write(f, Buffer.from(data, "base64"));
      };
      for (const [mode, on] of [
        ["on", true],
        ["off", false],
      ] as const) {
        // (the same start for each mode: the saved state, frozen, the exposure held)
        await app.js(`(() => { __bh.freeze(false); __bh.game.importSave(${JSON.stringify(save)}, false); __bh.settings.shipMount = "cockpit";
          __bh.freeze(true); __bh.renderer.sceneryInCascades = ${on}; document.body.classList.add("hide-ui"); return 1; })()`);
        await app.settled(60_000);
        await app.js(
          `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else q(1); }; f(); })`,
        );
        await app.js(
          `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
        );
        // still: 30 consecutive frames, one capture each
        for (let i = 0; i < 30; i++) {
          await app.js(`new Promise((q) => { __bh.touch(); requestAnimationFrame(() => q(1)); })`);
          await grab(`${OUT}/${mode}-still-${String(i).padStart(2, "0")}.png`);
        }
        // flight: 24 frames stepped 1/30 s, each awaited to its end, then captured; the cascades' redraws noted
        const redraws: number[] = [];
        for (let i = 0; i < 24; i++) {
          const drew =
            await app.js<boolean>(`(async () => { const r = __bh.renderer; __bh.step(1 / 30); __bh.touch(); const last = r.lastDoneAt; let k = 0;
            while (r.lastDoneAt === last && k++ < 120) await new Promise((q) => requestAnimationFrame(q)); return !!r.terrainRaster?.sunDrewNow; })()`);
          if (drew) redraws.push(i);
          await grab(`${OUT}/${mode}-fly-${String(i).padStart(2, "0")}.png`);
        }
        await app.js(`(() => { window.__ev = null; return 1; })()`);
        // (the frozen flicker: each pixel's standard deviation over the 30 frames, over its mean, in the city's band)
        const frames = Array.from({ length: 30 }, (_, i) => png(`${OUT}/${mode}-still-${String(i).padStart(2, "0")}.png`));
        const W = frames[0]!.width,
          H = frames[0]!.height;
        let n = 0,
          rel = 0,
          over1 = 0;
        for (let y = Math.floor(0.3 * H); y < 0.5 * H; y++)
          for (let x = 0; x < W; x++) {
            const i = y * W + x;
            let s = 0,
              s2 = 0;
            for (const f of frames) {
              const l = lumAt(f, i);
              s += l;
              s2 += l * l;
            }
            const m = s / 30;
            if (m < 12) continue;
            const sd = Math.sqrt(Math.max(s2 / 30 - m * m, 0));
            n++;
            rel += sd / m;
            if (sd / m > 0.01) over1++;
          }
        out[mode] = {
          stillMeanRelStd: +(rel / Math.max(n, 1)).toFixed(4),
          stillPixelsOver1pc: +(over1 / Math.max(n, 1)).toFixed(4),
          flightRedrawFrames: redraws,
        };
        console.log(`  ${mode}: ${JSON.stringify(out[mode])}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
      await app.js(`(() => { __bh.renderer.sceneryInCascades = true; __bh.freeze(false); return 1; })()`);
    } finally {
      await Bun.write(`${OUT}/city-flicker.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
