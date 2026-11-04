import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { placeLow } from "./lib/place";
import { readPng } from "./lib/png";

// Q4 L4 — the known materials' specular (trace.wgsl shadeLite; C0-11: a runway's paving, the regional surface's classes, an unknown
// ground matt): GGX on a dielectric, the roughness the material's (renderer.groundSpecular: off by default, set here). Facing a low Sun, the sheen a photograph cannot hold: each view
// placed level over the relief in (lib/place.ts placeLow), frozen, the exposure held; shot without the specular (renderer.liteSkip
// 67108864), with it, without again (the scene's drift on both sides) — the image's ratio over the landscape, and over the band
// towards the Sun (the middle third across).
//   cdg: 40 m over Roissy's runway 27R at sunset, facing the Sun; beauce: 60 m over the Beauce's fields, against the Sun.
// Output: remote-results/l4-specular/<view>-{off,on,off2}.png, l4.json (L4_OUT).
// Done when: both views' three shots taken and compared (the relief 90 s, the scenery 60 s at most, what is missing said), no GPU
// error (its text said). Duration: ~3 min.
const OUT = process.env.L4_OUT ?? "remote-results/l4-specular";
afterAll(stopServer);
const VIEWS: { name: string; at: [number, number, number, number, number]; date: string; weather?: string }[] = [
  { name: "cdg", at: [49.0255, 2.585, 40, 266, 140], date: "2026-07-10T19:00:00Z" },
  { name: "beauce", at: [48.25, 1.65, 60, 290, 140], date: "2026-07-10T19:15:00Z" },
];
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
/** the landscape's mean luminance (rows 0.45–0.8 of the height: below the horizon, above the panel; mid: the middle third across) */
function meanLum(f: string, mid = false) {
  const p = png(f);
  let s = 0,
    n = 0;
  for (let y = Math.floor(p.height * 0.45); y < p.height * 0.8; y++)
    for (let x = mid ? Math.floor(p.width / 3) : 0; x < (mid ? (2 * p.width) / 3 : p.width); x++) {
      const i = (y * p.width + x) * p.channels;
      s += 0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!;
      n++;
    }
  return s / n;
}

test.skipIf(!E2E)(
  "Q4 L4: the known materials' sheen towards a low Sun",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      for (const v of VIEWS) {
        await app.load("scene=game:artemis");
        await app.js(
          `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: ${v.weather ? 1 : 0}, lookProfile: "neutral", traffic: false, f35Invulnerable: true, f35AutoProtect: true }); return 1; })()`,
        );
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        await app.js(
          `(() => { __bh.game.setDate(${JSON.stringify(v.date)}); __bh.game.set("weather", ${JSON.stringify(v.weather ?? "fair")}); document.body.classList.add("hide-ui"); return 1; })()`,
        );
        // (placed level at its height over the relief in — lib/place.ts: else an error, not a shot)
        const placed = await placeLow(app, v.at, -6);
        const world = await app
          .waitFor(
            `(() => { const r = __bh.renderer, sc = r.earthScenery.stats(); return r.earthTiles.pending === 0 && sc.status === "ready" && !sc.pending; })()`,
            60_000,
          )
          .then(
            () => "all in",
            () => "not all in after 60 s",
          );
        await app.settled(60_000);
        // (the exposure settled on the view before it is held — frozen at once, it stayed on the load's)
        await app.exposureSettled();
        await app.js(
          `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
        );
        const lum: Record<string, number> = {};
        for (const [tag, skip] of [
          ["off", 67108864],
          ["on", 0],
          ["off2", 67108864],
        ] as const) {
          await app.js(`(() => { __bh.renderer.groundSpecular = true; __bh.renderer.liteSkip = ${skip}; __bh.touch(); return 1; })()`);
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${v.name}-${tag}.png`);
          lum[tag] = +meanLum(`${OUT}/${v.name}-${tag}.png`).toFixed(2);
          lum[`${tag}Mid`] = +meanLum(`${OUT}/${v.name}-${tag}.png`, true).toFixed(2);
        }
        await app.js(`(() => { window.__ev = null; __bh.renderer.liteSkip = 0; __bh.freeze(false); return 1; })()`);
        out[v.name] = {
          placed,
          world,
          lum,
          ratio: +(lum.on! / ((lum.off! + lum.off2!) / 2)).toFixed(4),
          noise: +(lum.off2! / lum.off!).toFixed(4),
          ratioMid: +(lum.onMid! / ((lum.offMid! + lum.off2Mid!) / 2)).toFixed(4),
          pipeline: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
        };
        console.log(`  ${v.name}: ${JSON.stringify(out[v.name])}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
    } finally {
      await Bun.write(`${OUT}/l4.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
