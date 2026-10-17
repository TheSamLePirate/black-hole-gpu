import { afterAll, beforeAll, describe, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The realtime image's quality in flight (scripts/quality.ts's way, on kerr-mini): from the cockpit, flown straight
// for FRAMES frames done, then held (targetSpp 0, the clock stopped — the last realtime frame kept, its history
// with it) and captured; then left to converge (targetSpp 64) and captured again — the reference. Each config
// (CONFIGS below, or CONF=a,b) on each place (PLACES=alps,tarifa). The PSNR is reckoned off the runner (no numpy
// there): scratchpad psnr.py over E2E_SHOTS=<dir> — <place>-<config>.png against <place>-<config>-ref.png.

const PLACES: Record<string, string> = {
  alps: `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
  tarifa: `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3);
    __bh.game.flyAt(36.1, -5.55, 900, 200, 210);`,
};
// (the hard cases: low and fast over the hills, turning — the near ground uncovered at each frame)
const TURNS: Record<string, number> = { "alps-turn": 70, "tarifa-low": 60 };
PLACES["alps-turn"] = PLACES.alps!;
PLACES["tarifa-low"] = `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`;
const CONFIGS: Record<string, string> = {
  // (the history dropped once the ground's parallax passes half a pixel: in low flight, every frame — today's)
  x4drop: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 0.5;`,
  x4keep: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64;`,
  x4px4: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 4;`,
  x3drop: `__bh.game.set("realtimeSubsampling", 3); __bh.renderer.taParallaxPx = 0.5;`,
  x3keep: `__bh.game.set("realtimeSubsampling", 3); __bh.renderer.taParallaxPx = 64;`,
  // (the reprojection's weights — renderer.taParams: a fresh pixel's least α, a pixel between rays' weight, the clamp's
  // width in σ — and the sharpening, in a turn: what keeps the near ground sharp)
  g3: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.renderer.taParams = [1 / 16, 0.05, 3];`,
  g15: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.renderer.taParams = [1 / 16, 0.05, 1.5];`,
  w10: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.renderer.taParams = [1 / 16, 0.1, 2];`,
  w02: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.renderer.taParams = [1 / 16, 0.02, 2];`,
  n32: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.renderer.taParams = [1 / 32, 0.05, 2];`,
  // (bounds: the history's clamp almost off — 100 σ —, and its weight capped at 64 frames rather than 16)
  g100: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.renderer.taParams = [1 / 16, 0.05, 100];`,
  g100n64: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.renderer.taParams = [1 / 64, 0.05, 100];`,
  // (the reconstruction alone: no reprojection — what the history covers)
  nota: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.settings.temporalReprojection = false;`,
  sh6: `__bh.game.set("realtimeSubsampling", 4); __bh.renderer.taParallaxPx = 64; __bh.settings.sharpen = 0.6;`,
};
const places = (process.env.PLACES ?? "alps,tarifa").split(",");
const confs = process.env.CONF ? process.env.CONF.split(",") : Object.keys(CONFIGS);
const FRAMES = Number(process.env.FRAMES ?? 90);

describe.skipIf(!E2E)("the realtime image's quality in flight, against the converged one", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  // (a config asked again — CONF=a,b,a,b, alternated: the flights differ a little each time — its shots numbered)
  const seen = new Map<string, number>();
  for (const pl of places)
    for (const cf of confs) {
      const n = (seen.get(`${pl}-${cf}`) ?? 0) + 1;
      seen.set(`${pl}-${cf}`, n);
      const tag = n > 1 ? `${cf}${n}` : cf;
      test(`${pl}: ${tag}`, async () => {
        await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64 });
          ${PLACES[pl]} __bh.settings.shipMount = "cockpit"; ${CONFIGS[cf]}
          const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          c.jetModes.alt = c.last?.alt ?? c.jetModes.alt; return 1; })()`);
        await app.waitFor(`!!__bh.renderer.variantReady`, 180_000).catch(() => {});
        // (the ground's tiles in; then FRAMES frames flown)
        await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          const t0 = performance.now(); let calm = 0;
          while (performance.now() - t0 < 60000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0; if (calm && performance.now() - calm > 1500) break; await frame(); }
          // (a turn asked as the frames are flown: the autopilot's heading TURNS[place]° on)
          // (from the track flown now — the heading asked before added up from one test to the next: each later turn
          // asked 70° more, a tighter image the first time at each place)
          ${TURNS[pl] ? `{ const c = __bh.camera; c.jetModes.hdg = (c.geoNow()?.track ?? 0) + ${TURNS[pl]} * Math.PI / 180; }` : ""}
          let done = 0, last = r.lastDoneAt;
          while (done < ${FRAMES}) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; } }
          window.__spp = __bh.settings.targetSpp; __bh.settings.targetSpp = 0; __bh.settings.animate = false; return 1; })()`);
        await Bun.sleep(600);
        await shot(`${pl}-${tag}`);
        await app.js(`(() => { __bh.settings.targetSpp = 64; __bh.touch(); return 1; })()`);
        for (let i = 0; i < 80; i++) {
          await Bun.sleep(500);
          if (await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`)) break;
        }
        await shot(`${pl}-${tag}-ref`);
        await app.js(
          `(() => { __bh.settings.animate = true; __bh.renderer.taParallaxPx = 0.5; __bh.renderer.taParams = [1 / 16, 0.05, 2]; __bh.settings.sharpen = 0.3; __bh.settings.temporalReprojection = true; return 1; })()`,
        );
      }, 400_000);
    }
});
