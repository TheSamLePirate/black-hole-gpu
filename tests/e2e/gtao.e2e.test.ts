import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { placeLow } from "./lib/place";
import { readPng } from "./lib/png";

// Q4 L2a — the ground's ambient occlusion (system/gtao.ts; decision 41: from the visibility's distances, before the shading; off
// by default — renderer.gtaoOn set here):
// the sky's and the bounce's light of the raster's ground darkened where the relief and the buildings hide the sky near the
// point — the streets between Paris's blocks, the buildings' feet, the hollows of a mountainside. Each view frozen, the
// exposure held, the scenery whole: shot without the occlusion (renderer.liteSkip 16777216), with it, without again (the
// scene's drift on both sides), and the occlusion itself drawn (33554432, × 5); the occlusion's pass timed.
//   paris: 60 m over the streets near the Champs-Élysées, looking down them; alps: 30 m over a slope of the Valais, across it.
// (Higher, the radius of a few metres falls under a pixel: the photographs carry the occlusion of what is far — none added.)
//   paris-overcast: the same under an overcast sky — its light the sky's alone.
// Output: remote-results/gtao/<view>-{off,on,off2,ao}.png, gtao.json (GT_OUT).
// Each placed level at its height over the relief in (lib/place.ts placeLow: an error otherwise — a craft placed before the
// fine relief ended inside a mountain, upside down). Done when: the three views' four shots taken and compared (the relief
// 90 s, the scenery 60 s at most, what is missing said), the pass compiled, no GPU error.
// Duration: ~4 min (two places, Paris's buildings, three views).
const OUT = process.env.GT_OUT ?? "remote-results/gtao";
afterAll(stopServer);
const VIEWS: { name: string; at: [number, number, number, number, number]; date: string; weather?: string }[] = [
  { name: "paris", at: [48.8695, 2.3075, 60, 120, 140], date: "2026-07-10T16:30:00Z" },
  { name: "alps", at: [46.12, 7.32, 40, 30, 140], date: "2026-07-10T10:30:00Z" },
  // (overcast: the sky's the only light — where the occlusion shows)
  { name: "paris-overcast", at: [48.8695, 2.3075, 60, 120, 140], date: "2026-07-10T16:30:00Z", weather: "overcast" },
];
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
/** the landscape's mean luminance (rows 0.45–0.8 of the height: below the horizon, above the panel) */
function meanLum(f: string) {
  const p = png(f);
  let s = 0,
    n = 0;
  for (let y = Math.floor(p.height * 0.45); y < p.height * 0.8; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * p.channels;
      s += 0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!;
      n++;
    }
  return s / n;
}

test.skipIf(!E2E)(
  "Q4 L2a: the ground's occlusion darkens the streets and the hollows, its pass compiled and timed",
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
        const placed = await placeLow(app, v.at, -18);
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
        const gt = await app.js<{ bound: boolean; ready: boolean; error: string | null }>(
          `({ bound: !!__bh.renderer.gtao, ready: !!__bh.renderer.gtao?.ready, error: __bh.renderer.gtao?.error ?? null })`,
        );
        await app.js(`(() => { __bh.renderer.gtaoOn = true; return 1; })()`);
        await app.js(
          `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
        );
        const lum: Record<string, number> = {};
        const cost: Record<string, number> = {};
        for (const [tag, skip] of [
          ["off", 16777216],
          ["on", 0],
          ["off2", 16777216],
          ["ao", 33554432],
        ] as const) {
          await app.js(`(() => { __bh.renderer.liteSkip = ${skip}; __bh.touch(); return 1; })()`);
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${v.name}-${tag}.png`);
          lum[tag] = +meanLum(`${OUT}/${v.name}-${tag}.png`).toFixed(2);
          if (tag === "on")
            cost.pass =
              await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
              r.prof.enabled = true; r.prof.every = 1; r.prof.reset(); const t0 = performance.now();
              while (performance.now() - t0 < 2000) { __bh.touch(); await frame(); }
              const T = r.prof.table(); r.prof.enabled = false; return +(T.find((x) => x.label === "ground occlusion")?.ms ?? -1).toFixed(3); })()`);
        }
        await app.js(`(() => { window.__ev = null; __bh.renderer.liteSkip = 0; __bh.freeze(false); return 1; })()`);
        out[v.name] = {
          placed,
          world,
          gtao: gt,
          lum,
          ratio: +(lum.on! / ((lum.off! + lum.off2!) / 2)).toFixed(4),
          noise: +(lum.off2! / lum.off!).toFixed(4),
          passMs: cost.pass,
          pipeline: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
        };
        console.log(`  ${v.name}: ${JSON.stringify(out[v.name])}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/gtao.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
    for (const v of VIEWS) expect((out[v.name] as { gtao: { error: string | null } }).gtao.error).toBeNull();
  },
  8 * 60_000,
);
