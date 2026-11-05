import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Decision 42 (Sam, 5 Nov 2026) — the flown craft's shadow map kept (ship.ts: drawn again only when the key light turns by
// ~0.3° against the craft, its pose changes, or other craft cast into it; its frame tied to the craft — S.shRefA/B — so the head
// turning keeps it) against every other frame before (renderer.ship.tuneShadowEvery): the F-35's cockpit in La Mancha's storm at
// 3 000 m (the M1's 4–6 images/s), 17:30 UTC, frozen (all four) then flying, alternated cache, every, cache, every, 3 s each; the
// real frame (the GPU's completed frames: median, p95 — the profiler's pass timestamps overlap on Apple), the maps drawn, the keys seen; frozen, the
// shots' PSNR cache against every (the same image); last, frozen, the frame without the craft and with it again.
// SC_OUT: the shots (remote-results/ship-shadow-cache).
// Duration: ~2 min on kerr-mini.
// Done when: the four modes measured frozen and flying, the PSNR logged, no GPU error.
const OUT = process.env.SC_OUT ?? "remote-results/ship-shadow-cache";
afterAll(stopServer);
const psnr = (a: Uint8Array, b: Uint8Array) => {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2;
  return 10 * Math.log10((255 * 255) / Math.max(se / a.length, 1e-9));
};
test.skipIf(!E2E)(
  "Decision 42: the craft's shadow map kept while the light holds against it — its cost, the same image",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T17:30:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.set("weather", "storm"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, 3000, 90, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(`new Promise((q) => setTimeout(() => { __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`);
      await app.settled(120_000);
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      await frames(150);
      await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
      // (the real frame: the GPU's completed frames' intervals, median and 95th percentile over 3 s — the profiler's pass timestamps
      // overlap on Apple and sum past the frame; the game renders a frame every few rAFs there —, the shadow maps drawn, the keys seen)
      const rate = (moving: boolean) =>
        app.js<{ med: number; p95: number; frames: number; draws: number; keys: number; shadow: number }>(`(async () => {
          const r = __bh.renderer, sh = r.ship, f = () => new Promise((q) => requestAnimationFrame(q));
          ${moving ? "__bh.freeze(false);" : ""}
          await f(); const d0 = sh.shadowDraws, c0 = r.completedFrames, keys = new Set(), dt = []; let c = c0, t = performance.now(); const t0 = t;
          r.prof.enabled = true; r.prof.reset();
          while (performance.now() - t0 < 3000) { __bh.touch(); await f(); const n = performance.now(); if (r.completedFrames !== c) { dt.push((n - t) / (r.completedFrames - c)); c = r.completedFrames; t = n; } keys.add(sh.shadowKey); }
          const rows = r.prof.table(); const shadow = +rows.filter((p) => /^ship: shadow map/.test(p.label)).reduce((s, p) => s + p.ms, 0).toFixed(2);
          r.prof.enabled = false; ${moving ? "__bh.freeze(true);" : ""}
          dt.sort((a, b) => a - b);
          return { med: +dt[dt.length >> 1].toFixed(1), p95: +dt[Math.floor(dt.length * 0.95)].toFixed(1), frames: c - c0, draws: sh.shadowDraws - d0, keys: keys.size, shadow }; })()`);
      const shots: Record<string, Uint8Array> = {};
      const modes = [
        ["cache", false],
        ["every", true],
        ["cache2", false],
        ["every2", true],
      ] as const;
      // (frozen first, all four: the same instant for the shots)
      for (const [k, every] of modes) {
        await app.js(`(() => { __bh.renderer.ship.tuneShadowEvery = ${every}; __bh.touch(); return 1; })()`);
        await frames(60);
        const still = await rate(false);
        const file = `${OUT}/${k}.png`;
        await app.shot(file);
        shots[k] = readPng(new Uint8Array(await Bun.file(file).arrayBuffer())).data;
        out[k] = { still };
        console.log(
          `  ${k} frozen: frame ${still.med} ms (p95 ${still.p95}), ${still.draws} maps drawn in ${still.frames} frames, ${still.keys} keys, pass ${still.shadow} ms`,
        );
      }
      out.psnr = { cacheVsEvery: +psnr(shots.cache!, shots.every!).toFixed(2), noise: +psnr(shots.cache!, shots.cache2!).toFixed(2) };
      console.log(
        `  frozen: PSNR cache vs every ${(out.psnr as { cacheVsEvery: number }).cacheVsEvery} dB, cache vs cache ${(out.psnr as { noise: number }).noise} dB`,
      );
      for (const [k, every] of modes) {
        await app.js(`(() => { __bh.renderer.ship.tuneShadowEvery = ${every}; __bh.touch(); return 1; })()`);
        const flying = await rate(true);
        (out[k] as Record<string, unknown>).flying = flying;
        console.log(
          `  ${k} flying: frame ${flying.med} ms (p95 ${flying.p95}), ${flying.draws} maps drawn in ${flying.frames} frames, ${flying.keys} keys, pass ${flying.shadow} ms`,
        );
      }
      // (the craft's whole cost, the same way: without it, then with it again — frozen)
      for (const [k, on] of [
        ["noShip", false],
        ["ship", true],
      ] as const) {
        await app.js(`(() => { __bh.renderer.ship.tuneShadowEvery = false; __bh.settings.ship = ${on}; __bh.touch(); return 1; })()`);
        await app.settled(120_000);
        await frames(60);
        const still = await rate(false);
        out[k] = { still };
        console.log(`  ${k} frozen: frame ${still.med} ms (p95 ${still.p95}) in ${still.frames} frames`);
      }
      out.keySample = await app.js<string>(`__bh.renderer.ship.shadowKey`);
      console.log(`  a key: ${out.keySample}`);
      await app.js(
        `(() => { __bh.renderer.ship.tuneShadowEvery = false; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/cache.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
