// The rain on the canopy and in the air (display.wgsl glassWater, rainStreaks): the F-35 from its cockpit under the rain —
// at rest on Le Bourget's runway (drops landing, sliding down in their trails), at 150 m/s and in a storm at 220 m/s (the glass swept, the
// rivulets the air drives up and out; no streaks rushing from ahead). Two shots a quarter-second apart each: the motion.
// E2E_SHOTS=<dir> (rain-<view>-<0|1>.png); remote-results/rain-glass.json: each view's GPU time.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

describe.skipIf(!E2E)("the rain on the canopy and in the air", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS ?? "remote-results/rain-glass";
  const rows: { view: string; gpuMs: number; displayMs: number }[] = [];
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: true, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, targetSpp: 0,
      earthPipeline: "raster", shipMount: "cockpit" }); __bh.renderer.tune = {}; return 1; })()`);
    await Bun.$`mkdir -p ${shots}`;
  }, 300_000);
  afterAll(async () => {
    await Bun.write("remote-results/rain-glass.json", JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  const views: [string, string, number][] = [
    ["ground", `__bh.game.set("weather", "rain"); __bh.game.lineUp("Bourget");`, 0],
    ["cruise", `__bh.game.set("weather", "rain"); __bh.game.flyAt(36.08, -5.6, 400, 20, 150);`, 150],
    ["storm", `__bh.game.set("weather", "storm"); __bh.game.flyAt(36.08, -5.6, 300, 20, 220);`, 220],
  ];
  for (const [name, setup, speed] of views)
    test(`${name}: ${speed} m/s`, async () => {
      await app.js(`(() => { __bh.settings.animate = true; __bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("earthClouds", 1); ${setup}
        const c = __bh.camera; if (${speed} > 0) { if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        c.jetModes.alt = c.last?.alt ?? c.jetModes.alt; c.jetModes.spd = ${speed}; } return 1; })()`);
      await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
      await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let calm = 0;
        while (performance.now() - t0 < 45000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 3000) break; await frame(); }
        return 1; })()`);
      const gpuMs =
        await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        r.prof.enabled = true; r.prof.every = 1;
        for (let i = 0; i < 20; i++) await frame();
        r.prof.reset();
        let done = 0, last = r.lastDoneAt, gpu = 0, disp = 0;
        while (done < 60) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; gpu += r.lastGpuMs;
          disp += r.prof.table().find((p) => p.label === "display")?.last ?? 0; } }
        window.__disp = +(disp / done).toFixed(3);
        return +(gpu / done).toFixed(2); })()`);
      const displayMs = await app.js<number>("window.__disp");
      await app.shot(`${shots}/rain-${name}-0.png`);
      await Bun.sleep(250);
      await app.shot(`${shots}/rain-${name}-1.png`);
      const rain = await app.js<number>(`__bh.renderer.weatherNow?.rain ?? -1`).catch(() => -1);
      rows.push({ view: name, gpuMs, displayMs });
      console.log(`  ${name}: ${gpuMs} ms GPU, display ${displayMs} ms (rain ${rain})`);
      expect(gpuMs).toBeGreaterThan(0);
    }, 300_000);
});
