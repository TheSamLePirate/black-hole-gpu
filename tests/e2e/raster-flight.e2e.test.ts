// The raster's primary visibility in flight (docs/PLAN-RENDU-RASTER-AAA.md étape 1): the F-35 from its cockpit over the
// live relief, its imagery, the regional surface, the scenery and the clouds — the game as it is played. At each place
// the craft is flown until the ground is in, then the clock is stopped and the same view drawn with the near Earth traced
// at ×6, at ×4, then shaded by the raster (`earthPipeline: "raster"`, the sky at ×4), the view touched every frame (fresh
// rays, no history: a fast turn's worst); each mode's GPU passes and image, against the same view converged.
// PLACES=tarifa-low,tarifa,alps (default all); FRAMES: frames flown a mode (90); MODES=trace6,trace4,rasterwalk,raster (rasterwalk: the raster without the trees' instances); RF_DETAIL (below).
// Captures remote-results/rf-<place>-<mode>[-ref].png; measures remote-results/raster-flight.json.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

const PLACES: Record<string, string> = {
  "tarifa-low": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  tarifa: `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3);
    __bh.game.flyAt(36.1, -5.55, 900, 200, 210);`,
  alps: `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
};
const MODE_SET: Record<string, string> = {
  trace6: `__bh.settings.earthPipeline = "trace"; __bh.game.set("realtimeSubsampling", 6);`,
  trace4: `__bh.settings.earthPipeline = "trace"; __bh.game.set("realtimeSubsampling", 4);`,
  raster: `__bh.settings.earthPipeline = "raster"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4);`,
  // (the raster without the trees' instances: the grid walked from every pixel, as étape 1a had it)
  rasterwalk: `__bh.settings.earthPipeline = "raster"; __bh.renderer.sceneryRasterOn = false; __bh.game.set("realtimeSubsampling", 4);`,
};
const places = (process.env.PLACES ?? "tarifa-low,tarifa,alps").split(",");
const modes = (process.env.MODES ?? "trace6,trace4,rasterwalk,raster").split(",");
const FRAMES = Number(process.env.FRAMES ?? 90);
// (RF_DETAIL=max, the default: the scenery's trees and buildings at their most, drawn farthest, with their shadows and the
// satellite surface — the image aimed at; RF_DETAIL=game: the game's own settings)
const DETAIL =
  process.env.RF_DETAIL === "game"
    ? ""
    : `Object.assign(__bh.settings, { earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true, earthSurface: "satellite" });`;

type Png = ReturnType<typeof readPng>;
function psnr(a: Png, b: Png) {
  let sq = 0,
    n = 0;
  for (let y = 60; y < a.height; y++)
    for (let x = 0; x < a.width; x++)
      for (let c = 0; c < 3; c++) {
        const i = (y * a.width + x) * a.channels + c;
        const d = a.data[i]! - b.data[i]!;
        sq += d * d;
        n++;
      }
  return +(10 * Math.log10((255 * 255) / Math.max(sq / n, 1e-9))).toFixed(2);
}
const png = (f: string) => readPng(new Uint8Array(require("node:fs").readFileSync(f)));

describe.skipIf(!E2E)("the raster's primary visibility in flight: frame rate and image, against the traced ×6 and ×4", () => {
  let app: App;
  const rows: unknown[] = [];
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(async () => {
    await Bun.write("remote-results/raster-flight.json", JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  for (const pl of places)
    test(`${pl}: ${modes.join(", ")}`, async () => {
      // (the craft put there and flown until the ground's tiles and the scenery are in; then the clock stopped — every
      // mode draws the same view —, the view touched every frame: fresh rays, no history, the worst of a fast turn)
      await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 0 });
        ${PLACES[pl]} __bh.settings.shipMount = "cockpit"; ${DETAIL} __bh.settings.earthPipeline = "trace";
        const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        c.jetModes.alt = c.last?.alt ?? c.jetModes.alt; return 1; })()`);
      // (the clock stopped a few frames after the craft is put there: every run sees the same view, however long the
      // ground's tiles and the kernels take)
      await app.js(
        `(async () => { for (let i = 0; i < 10; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.settings.animate = false; return 1; })()`,
      );
      await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
      await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let calm = 0;
        while (performance.now() - t0 < 120000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 4000) break; await frame(); }
        __bh.settings.animate = false;
        window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return 1; })()`);
      const shots: Record<string, string> = {};
      const measured: Record<string, { gpuMs: number; passes: Record<string, number>; raster: Record<string, unknown> }> = {};
      for (const md of modes) {
        await app.js(`(() => { ${MODE_SET[md]} __bh.touch(); return 1; })()`);
        await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
        await app.js(`(() => { const r = __bh.renderer; r.prof.enabled = true; r.prof.every = 1; r.prof.reset(); return 1; })()`);
        if (md === "raster")
          await app.waitFor(
            `__bh.renderer.terrainRasterStats.primary && __bh.renderer.prof.table().some((p) => p.label === "earth shade (raster)")`,
            300_000,
          );
        await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 30; i++) await frame();
          r.prof.reset();
          let done = 0, last = r.lastDoneAt; const sum = {}; let gpu = 0;
          while (done < ${FRAMES}) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; gpu += r.lastGpuMs;
            for (const p of r.prof.table()) sum[p.label] = (sum[p.label] ?? 0) + p.last; } }
          window.__m = { gpuMs: +(gpu / done).toFixed(1), raster: { ...r.terrainRasterStats },
            passes: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / done).toFixed(2)])) };
          return 1; })()`);
        measured[md] = await app.js("window.__m");
        shots[md] = `remote-results/rf-${pl}-${md}.png`;
        await app.shot(shots[md]!);
      }
      // (the reference: the same view, the touching stopped, converged)
      await app.js(
        `(() => { window.__t = false; __bh.settings.earthPipeline = "trace"; __bh.settings.targetSpp = 64; __bh.touch(); return 1; })()`,
      );
      for (let i = 0; i < 180; i++) {
        await Bun.sleep(500);
        if (await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`)) break;
      }
      const fr = `remote-results/rf-${pl}-ref.png`;
      await app.shot(fr);
      const ref = png(fr);
      for (const md of modes) {
        const m = measured[md]!;
        const rays = ["trace", "earth shade (raster)", "terrain raster visibility"].reduce((a, k) => a + (m.passes[k] ?? 0), 0);
        const row = {
          place: pl,
          mode: md,
          gpuMs: m.gpuMs,
          raysMs: +rays.toFixed(1),
          psnrVsConverged: psnr(png(shots[md]!), ref),
          primary: m.raster.primary,
          trees: (m.raster.scenery as { active?: boolean } | null)?.active ?? false,
          passes: m.passes,
        };
        rows.push(row);
        console.log(JSON.stringify({ ...row, passes: undefined }));
        if (md === "raster") expect(m.raster.error).toBeFalsy();
      }
      await app.js(`(() => { __bh.settings.animate = true; __bh.settings.targetSpp = 0; return 1; })()`);
    }, 1_200_000);
});
