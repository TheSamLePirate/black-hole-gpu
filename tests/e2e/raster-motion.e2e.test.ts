// The raster's image in motion (docs/PLAN-RENDU-RASTER-AAA.md étape 4, the temporal stabilisation): the F-35 from its
// cockpit, flown FRAMES frames in a turn over the live relief (the scenery high, very far) — the history at work, the
// view sliding — then the last realtime frame held (the clock stopped, the history kept) and captured, then left to
// converge, the reference (flight-quality.e2e.test.ts's way). Each mode from the same start.
// PLACES=tarifa-low,alps (default); MODES (below; default trace4,raster); FRAMES (120); TURN (degrees, 60).
// Captures remote-results/rm-<place>-<mode>[-ref].png; measures remote-results/raster-motion.json.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

const PLACES: Record<string, string> = {
  "tarifa-low": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  alps: `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
  // (the weather's clouds — docs/PLAN-NUAGES-AAA.md —: under a cumulus deck, over it)
  "tarifa-cumulus": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  "cumulus-above": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 3400, 20, 240);`,
};
const RASTER = `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.game.set("realtimeSubsampling", 4);`;
const MODES: Record<string, string> = {
  trace6: `__bh.settings.earthPipeline = "trace"; __bh.game.set("realtimeSubsampling", 6);`,
  trace4: `__bh.settings.earthPipeline = "trace"; __bh.game.set("realtimeSubsampling", 4);`,
  raster: RASTER,
  rastergauss: `${RASTER} __bh.renderer.rasterJitter = "gauss";`,
  rasterhalton: `${RASTER} __bh.renderer.rasterJitter = "halton";`,
  // (the sharpening after the history — AMD's RCAS, settings.sharpen 0.3 by default — and a rebuilt pixel's weight in it
  // — renderer.taParams[1], 0.05: the history kept; more, quicker to follow a turn)
  rastersharp: `${RASTER} __bh.renderer.rasterJitter = "gauss"; __bh.settings.sharpen = 0.6; __bh.renderer.taParams = [1 / 16, 0.05, 2];`,
  rasterw15: `${RASTER} __bh.renderer.rasterJitter = "gauss"; __bh.settings.sharpen = 0.3; __bh.renderer.taParams = [1 / 16, 0.15, 2];`,
  rasterdefault: `${RASTER} __bh.renderer.rasterJitter = "gauss"; __bh.settings.sharpen = 0.3; __bh.renderer.taParams = [1 / 16, 0.05, 2];`,
  // (the cloud pass — trace.wgsl clouds — and its history off: each pixel marches its clouds)
  rasternopass: `${RASTER} __bh.renderer.rasterJitter = "gauss"; __bh.settings.sharpen = 0.3; __bh.renderer.taParams = [1 / 16, 0.05, 2]; __bh.renderer.cloudPassOn = false;`,
  rasterpass: `${RASTER} __bh.renderer.rasterJitter = "gauss"; __bh.settings.sharpen = 0.3; __bh.renderer.taParams = [1 / 16, 0.05, 2]; __bh.renderer.cloudPassOn = true;`,
};
const DETAIL = `Object.assign(__bh.settings, { earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true, earthSurface: "satellite" });`;
const places = (process.env.PLACES ?? "tarifa-low,alps").split(",");
const modes = (process.env.MODES ?? "trace4,raster").split(",");
const FRAMES = Number(process.env.FRAMES ?? 120);
const TURN = Number(process.env.TURN ?? 60);

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

describe.skipIf(!E2E)("the raster's image in motion, against the converged one", () => {
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
    await Bun.write("remote-results/raster-motion.json", JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  for (const pl of places)
    for (const md of modes)
      test(`${pl}: ${md}`, async () => {
        await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64 });
          ${PLACES[pl]} __bh.settings.shipMount = "cockpit"; ${DETAIL} ${MODES[md]}
          const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          c.jetModes.alt = c.last?.alt ?? c.jetModes.alt; return 1; })()`);
        // (the clock stopped while the ground's tiles, the scenery and the kernels come in: every mode flies from the same place)
        await app.js(
          `(async () => { for (let i = 0; i < 10; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.settings.animate = false; return 1; })()`,
        );
        await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
        const raster = MODES[md]!.includes(`earthPipeline = "raster"`);
        await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          r.prof.enabled = true; r.prof.every = 1;
          const t0 = performance.now(); let calm = 0;
          while (performance.now() - t0 < 120000) {
            const shading = ${raster} ? r.terrainRasterStats.primary && r.prof.table().some((p) => p.label === "earth shade (raster)") : true;
            const ok = r.earthTiles.pending === 0 && shading; calm = ok ? calm || performance.now() : 0;
            if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
          // (flown: FRAMES frames done, a turn of TURN° asked as they start)
          __bh.settings.animate = true;
          { const c = __bh.camera; c.jetModes.hdg = (c.geoNow()?.track ?? 0) + ${TURN} * Math.PI / 180; }
          let done = 0, last = r.lastDoneAt, gpu = 0;
          while (done < ${FRAMES}) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; gpu += r.lastGpuMs; } }
          window.__flown = { gpuMs: +(gpu / done).toFixed(1), turn: r.imageTurnPx, ground: r.imageGroundPx };
          __bh.settings.targetSpp = 0; __bh.settings.animate = false; return 1; })()`);
        const fl = await app.js<{ gpuMs: number; turn: number; ground: number }>("window.__flown");
        await Bun.sleep(600);
        const f = `remote-results/rm-${pl}-${md}.png`;
        await app.shot(f);
        await app.js(`(() => { __bh.settings.targetSpp = 64; __bh.touch(); return 1; })()`);
        for (let i = 0; i < 180; i++) {
          await Bun.sleep(500);
          if (await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`)) break;
        }
        const fr = `remote-results/rm-${pl}-${md}-ref.png`;
        await app.shot(fr);
        const row = { place: pl, mode: md, gpuMs: fl.gpuMs, psnrInMotion: psnr(png(f), png(fr)), turnPx: fl.turn, groundPx: fl.ground };
        rows.push(row);
        console.log(JSON.stringify(row));
        await app.js(`(() => { __bh.settings.animate = true; __bh.settings.earthPipeline = "trace"; return 1; })()`);
        expect(Number.isFinite(row.psnrInMotion)).toBe(true);
      }, 600_000);
});
