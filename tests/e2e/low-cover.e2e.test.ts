import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q8 VIPER B5 — the low cover (character-renderer.ts COVER, character.wgsl coverGrow/coverVs/coverFs, settings.earthLowCover):
// tufts, bushes and reed clumps round a camera under 300 m over the Earth, out to 240 m, on a 4 m ground grid of their own.
// The F-35 lined up on a runway (LC_SITE, Le Bourget by default) — the cockpit looking 4° down the runway — and 40 m over the
// ground 1 km west of Toussus-le-Noble's field (fields and the airfield's grass ahead), 13:00 UTC in July, frozen, the exposure locked: shots with the cover, without, with again;
// the clumps drawn, the grid's CPU time, the GPU's completed frames' interval (median over 3 s) in each.
// LC_OUT: the shots (remote-results/low-cover).
// Duration: ~4 min on this Mac.
// Done when: both views shot with and without the cover, clumps drawn on the runway's grass, no GPU error.
const OUT = process.env.LC_OUT ?? "remote-results/low-cover";
const SITE = process.env.LC_SITE ?? "Bourget";
afterAll(stopServer);
test.skipIf(!E2E)(
  "B5: the low cover round the runway and on final — clumps drawn, shots with and without, the frame's cost",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair", earthLowCover: true }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T13:00:00Z";
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      // (the world in: the photographs, the scenery, the cover's grid — said if not within 60 s)
      const loaded = async (k: string) => {
        await app
          .waitFor(
            `(() => { __bh.touch(); const r = __bh.renderer, t = r.earthTiles, sc = r.earthScenery.stats(), c = r.characterRenderer.stats().cover; return t.pending === 0 && t.orthoPending === 0 && sc.status === "ready" && !sc.pending && (!__bh.settings.earthLowCover || (c.pending === 0 && c.on)); })()`,
            60_000,
          )
          .catch(async () =>
            console.warn(
              `  ${k}: still loading after 60 s — ${await app.js<string>(`JSON.stringify({ tiles: __bh.renderer.earthTiles.pending, ortho: __bh.renderer.earthTiles.orthoPending, scenery: __bh.renderer.earthScenery.stats().status, cover: __bh.renderer.characterRenderer.stats().cover })`)}`,
            ),
          );
        await app.settled(120_000);
        await frames(90);
      };
      const rate = () =>
        app.js<{ med: number; frames: number }>(`(async () => {
          const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          await f(); const c0 = r.completedFrames, dt = []; let c = c0, t = performance.now(); const t0 = t;
          while (performance.now() - t0 < 3000) { __bh.touch(); await f(); const n = performance.now(); if (r.completedFrames !== c) { dt.push((n - t) / (r.completedFrames - c)); c = r.completedFrames; t = n; } }
          dt.sort((a, b) => a - b);
          return { med: +dt[dt.length >> 1].toFixed(1), frames: c - c0 }; })()`);
      for (const view of ["runway", "final"] as const) {
        if (view === "runway")
          console.log(
            `  lined up: ${await app.js<string>(`(() => { __bh.game.setDate("${iso}"); const n = __bh.game.lineUp("${SITE}", 120); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return n; })()`)}`,
          );
        else
          await app.js(
            `(() => { __bh.freeze(false); __bh.game.setDate("${iso}"); __bh.game.flyAt(48.7519, 2.0950, 40, 90, 75); __bh.settings.shipMount = "cockpit"; return 1; })()`,
          );
        await app.js(
          `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${view === "runway" ? -4 : -8}); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
        );
        await loaded(view);
        await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
        for (const [k, on] of [
          ["cover", true],
          ["bare", false],
          ["cover2", true],
        ] as const) {
          await app.js(`(() => { __bh.settings.earthLowCover = ${on}; __bh.touch(); return 1; })()`);
          await loaded(`${view} ${k}`);
          const st = await app.js<Record<string, unknown>>(
            `(() => { const c = __bh.renderer.characterRenderer.stats(); return { cover: c.cover, reason: c.reason, stones: c.stones, pipe: __bh.renderer.earthPipelineNow(__bh.settings), mount: __bh.settings.shipMount }; })()`,
          );
          const r = await rate();
          await app.shot(`${OUT}/${view}-${k}.png`);
          out[`${view}-${k}`] = { ...st, ...r };
          console.log(`  ${view} ${k}: ${JSON.stringify(st)} — frame ${r.med} ms over ${r.frames}`);
        }
        await app.js(`(() => { __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/cover.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    const clumps = (out["runway-cover"] as { cover?: { clumps: number } } | undefined)?.cover?.clumps ?? 0;
    expect(clumps).toBeGreaterThan(0);
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
