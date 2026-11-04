import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { placeLow } from "./lib/place";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng } from "./lib/png";

// T7 — the sea at sunset (docs/PLAN-REFRACTION-HORIZONS.md T7: "plus de moiré au couchant ; le reflet solaire continu en largeur
// et en énergie"): the open Atlantic west of Brittany, the F-35 placed level at SS_H m (300 and 3 000 by default) facing the
// setting Sun, the world frozen; a shot, and 12 frames captured one by one (the history's shimmer there), the craft still.
// Measured on the sea under the horizon: the glint's band (its brightness by column, its width and its holes), and the frames'
// flicker (each pixel's standard deviation over the 12, over its mean) — a moiré is a pattern that crawls frame to frame.
// Output: remote-results/sea-sunset/<sun>-<H>.png, <sun>-<H>-NN.png, sunset.json (SS_OUT). Done when: each height's shots taken and measured,
// no GPU error. Duration: ~3 min.
const OUT = process.env.SS_OUT ?? "remote-results/sea-sunset";
afterAll(stopServer);
const HEIGHTS = (process.env.SS_H ?? "300,3000").split(",").map(Number);
const lum = (d: Uint8Array, i: number) => 0.2126 * d[4 * i]! + 0.7152 * d[4 * i + 1]! + 0.0722 * d[4 * i + 2]!;
/** a decoded PNG as RGBA bytes */
function rgba(p: ReturnType<typeof readPng>): Uint8Array {
  const o = new Uint8Array(p.width * p.height * 4);
  for (let i = 0; i < p.width * p.height; i++)
    for (let c = 0; c < 4; c++) o[4 * i + c] = c < p.channels ? p.data[i * p.channels + c]! : 255;
  return o;
}

test.skipIf(!E2E)(
  "T7: the sea facing the setting Sun — the glint's band and the frames' shimmer",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0, dof: false, hudJet: "off" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (the Sun ~4° and ~1° up in the west-north-west at 47.5° N, 7° W on 10 July — at 20:35 it had set, 2° under)
      for (const [sun, date] of [
        ["sun4", "2026-07-10T19:50:00Z"],
        ["sun1", "2026-07-10T20:12:00Z"],
      ] as const)
        for (const H of HEIGHTS) {
          const name = `${sun}-${H}`;
          await app.js(
            `(() => { __bh.freeze(false); __bh.game.setDate("${date}"); __bh.game.set("weather", "fair"); document.body.classList.add("hide-ui"); return 1; })()`,
          );
          const placed = await placeLow(app, [47.5, -7.0, H, 300, 140], H > 1000 ? -6 : -2);
          await app.settled(60_000);
          await app.exposureSettled();
          await app.js(
            `(() => { const m = document.querySelector("[data-testid=jetmap]"); if (m) m.style.visibility = "hidden"; return 1; })()`,
          );
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${name}.png`);
          // (12 frames, each marked changed — a camera still in a running world —, captured one by one)
          const frames: Uint8Array[] = [];
          let W = 0,
            Hh = 0;
          for (let i = 0; i < 12; i++) {
            await app.js(`new Promise((q) => { __bh.touch(); requestAnimationFrame(() => q(1)); })`);
            const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
            const f = `${OUT}/${name}-${String(i).padStart(2, "0")}.png`;
            await Bun.write(f, Buffer.from(data, "base64"));
            const px = readPng(new Uint8Array(readFileSync(f)));
            W = px.width;
            Hh = px.height;
            frames.push(rgba(px));
          }
          // (the sea alone: from just under the horizon — the look's pitch puts it at ~47 % of the height at 300 m, ~40 % at 3 km —
          // to the nose's top at ~66 %; across, 5–65 % of the width — the instruments on the right left out)
          const y0 = Math.floor(Hh * (H > 1000 ? 0.42 : 0.49)),
            y1 = Math.floor(Hh * 0.66),
            xa = Math.floor(W * 0.05),
            xb = Math.floor(W * 0.65);
          let rel = 0,
            n = 0,
            over2 = 0;
          const col = new Float64Array(W);
          for (let y = y0; y < y1; y++)
            for (let x = xa; x < xb; x++) {
              const i = y * W + x;
              let s = 0,
                s2 = 0;
              for (const f of frames) {
                const l = lum(f, i);
                s += l;
                s2 += l * l;
              }
              const m = s / frames.length;
              col[x] = (col[x] ?? 0) + m;
              if (m < 8) continue;
              const sd = Math.sqrt(Math.max(s2 / frames.length - m * m, 0));
              n++;
              rel += sd / m;
              if (sd / m > 0.02) over2++;
            }
          // (the glint's band: the columns over half its peak — its width, and the holes inside it under a third of the peak)
          const peak = Math.max(...col);
          const hot = [...col.keys()].filter((x) => col[x]! > 0.5 * peak);
          const width = hot.length ? hot.at(-1)! - hot[0]! + 1 : 0;
          let holes = 0;
          if (hot.length) for (let x = hot[0]!; x <= hot.at(-1)!; x++) if (col[x]! < peak / 3) holes++;
          out[name] = {
            placed,
            flickerRel: +(rel / Math.max(n, 1)).toFixed(4),
            pixelsOver2pc: +(over2 / Math.max(n, 1)).toFixed(4),
            glint: { widthPx: width, holes, peakMean: +(peak / (y1 - y0)).toFixed(1) },
            pipeline: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
          };
          console.log(`  ${name}: ${JSON.stringify(out[name])}`);
        }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
    } finally {
      await Bun.write(`${OUT}/sunset.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
