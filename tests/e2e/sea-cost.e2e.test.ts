import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The sea's GPU cost (docs/PLAN-AVIATION-AAA.md, M1 — its criterion): over the Alps first (the image as ever),
// then a force 5 at 60 m, flying: the FFT's own pass and the trace's, with the FFT and with the twelve trains
// (the setting off), each its kernel compiled first; the GPU's timestamps (renderer.prof).

const D = Math.PI / 180;

describe.skipIf(!E2E)("the sea's GPU cost", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** the passes' times [ms], their running means over a few seconds of flight */
  const measure = async () => {
    await app.settled();
    await app.js(`(__bh.renderer.prof.enabled = true, __bh.renderer.prof.reset(), 1)`);
    await Bun.sleep(6000);
    return app.js<{ fft: number; trace: number; gpu: number }>(`(() => {
      const st = __bh.renderer.prof.stats, g = (l) => st.get(l)?.ms ?? 0;
      return { fft: g("sea fft"), trace: g("trace"), gpu: __bh.renderer.lastGpuMs };
    })()`);
  };

  test("the Alps, then a force 5 at 60 m: the FFT's pass and the trace with it and without", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(5000);
    await app.settled();
    await app.js(`(() => { Object.assign(__bh.settings, { wind: 3, earthClouds: 1, seaFft: true });
      __bh.renderer.seaOverride = { wind: { hs: 2, tp: 6.5, to: ${70 * D} }, swell: { hs: 1, tp: 11, to: ${40 * D} }, source: "marine" };
      __bh.game.flyAt(47.6, -6.2, 60, 260, 140); return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    const on = await measure();
    await app.js(`(__bh.settings.seaFft = false, 1)`);
    const off = await measure();
    const gpu = await app.js<string>(`__bh.renderer.adapter?.description || __bh.renderer.adapter?.architecture || "?"`);
    console.log(
      `  ${gpu}: the FFT's pass ${on.fft.toFixed(2)} ms; the trace ${on.trace.toFixed(2)} ms with the FFT, ${off.trace.toFixed(2)} ms with the trains (${(on.trace - off.trace >= 0 ? "+" : "") + (on.trace - off.trace).toFixed(2)} ms); the frame's GPU ${on.gpu.toFixed(1)} / ${off.gpu.toFixed(1)} ms`,
    );
    expect(on.fft).toBeGreaterThan(0);
    expect(on.fft).toBeLessThan(3);
  }, 300_000);
});
