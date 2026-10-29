import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PLANETES-AAA P2: Miller's sea — its wind's chop by FFT (sea/fft-gpu.ts), knee-deep under 1.3 g (sea/spectrum.ts
// MILLER_SEA, renderer millerSeaParams), on the giant waves (trace.wgsl shadeNear): the FFT running for Miller, its waves
// in the image (the water's detail — the luminance's steps between neighbours —, more with them than without), no GPU
// error; shots 300 m and 40 m over the water and on foot, the time held then running.
// Duration: ~4 min.
// Done when: every view shot, the FFT's runs counted, the detail measured.

const OUT = process.env.OUT ?? "remote-results/miller-sea";
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false });`;
// (on the water — the Ranger landed —, Gargantua 25° up ahead: its light's path on the sea; and looking down at the water)
const VIEWS: [string, string][] = [
  ["gargantua", `__bh.game.preset("Miller: Gargantua over the sea"); ${HOLD}`],
  [
    "down",
    `__bh.presets.msd = { ...__bh.presets["Miller: Gargantua over the sea"], pose: { body: "miller", holeEl: 25, holeAz: 0, off: [0, -45] } }; __bh.game.preset("msd"); ${HOLD}`,
  ],
];

describe.skipIf(!E2E)("P2: Miller's sea", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Miller: the water world")}` });
    await app.js(`(() => { __bh.settings.showFps = true; return 1; })()`);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const settle = () =>
    app.js<number>(`(async () => {
      const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0) && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
      while (!r.planetProbes.has("miller") && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
      for (let i = 0; i < 60; i++) { __bh.touch(); await frame(); }
      return Math.round(performance.now() - t0); })()`);
  /** the mean luminance step between neighbouring pixels over the lower half (the water) */
  const detail = async () => {
    const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    return app.js<number>(`(async () => {
      const i = await createImageBitmap(await (await fetch("data:image/png;base64,${data}")).blob());
      const c = new OffscreenCanvas(i.width, i.height), g = c.getContext("2d"); g.drawImage(i, 0, 0);
      const y0 = Math.round(0.55 * i.height), y1 = Math.round(0.95 * i.height), x0 = Math.round(0.1 * i.width), x1 = Math.round(0.9 * i.width);
      const px = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0;
      const L = (k) => 0.2126 * px[4 * k] + 0.7152 * px[4 * k + 1] + 0.0722 * px[4 * k + 2];
      let s = 0, n = 0; for (let y = 0; y < y1 - y0; y++) for (let x = 1; x < w; x++) { s += Math.abs(L(y * w + x) - L(y * w + x - 1)); n++; }
      return +(s / n).toFixed(2); })()`);
  };
  /** the mean luminance over the lower half (the water: its sunlit side the brightest) */
  const brightness = async () => {
    const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60 });
    return app.js<number>(`(async () => {
      const i = await createImageBitmap(await (await fetch("data:image/jpeg;base64,${data}")).blob());
      const c = new OffscreenCanvas(160, 100), g = c.getContext("2d"); g.drawImage(i, 0, 0, 160, 100);
      const d = g.getImageData(0, 55, 160, 45).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2];
      return s / (d.length / 4) / 3; })()`);
  };
  const shot = async (name: string) => {
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/${name}.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  };

  for (const [name, set] of VIEWS)
    test(name, async () => {
      await app.js(`(() => { ${set} return 1; })()`);
      await settle();
      const st = await app.js<Record<string, unknown>>(`(() => { const r = __bh.renderer; return {
        world: r.seaHere?.world ?? null, runs: r.seaFft?.runs ?? -1, raster: r.bodyRasterNow, gpuErrors: r.gpuErrors }; })()`);
      const d = await detail();
      await shot(`${name}-held`);
      // (the clock running a few seconds: the waves move)
      await app.js(
        `(async () => { __bh.settings.animate = true; const t0 = performance.now(); while (performance.now() - t0 < 3000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } __bh.settings.animate = false; return 1; })()`,
      );
      await shot(`${name}-running`);
      const runs = await app.js<number>("__bh.renderer.seaFft?.runs ?? -1");
      console.log(`  ${name}: ${JSON.stringify(st)}, detail ${d}, FFT runs ${st.runs} → ${runs}`);
      expect(st.world).toBe("miller");
      expect(runs).toBeGreaterThan(st.runs as number);
      expect(st.gpuErrors).toBe(0);
    }, 900_000);

  test("on foot", async () => {
    await app.js(
      `(() => { __bh.presets.ms0 = { ...__bh.presets["Miller: the water world"] }; __bh.game.preset("ms0"); ${HOLD} return 1; })()`,
    );
    await settle();
    // (the walker's sunlit side: the brightest of four longitudes)
    let best = 0;
    let lum = -1;
    for (const lon of [0, 90, 180, 270]) {
      await app.js(
        `(() => { __bh.camera.character.start("miller", 0, ${lon}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`,
      );
      await settle();
      const d = await brightness();
      if (d > lum) [lum, best] = [d, lon];
      await app.js(`(() => { __bh.camera.character.stop(); return 1; })()`);
    }
    await app.js(
      `(() => { __bh.camera.character.start("miller", 0, ${best}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`,
    );
    await settle();
    await shot("foot");
    // (SEA_LEVERS=4096,…: renderer.liteSkip's measures, each one's shot)
    for (const lv of process.env.SEA_LEVERS?.split(",") ?? []) {
      await app.js(
        `(async () => { __bh.renderer.liteSkip = ${Number(lv)}; for (let i = 0; i < 30; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
      );
      await shot(`foot-${lv}`);
      await app.js(`(() => { __bh.renderer.liteSkip = 0; return 1; })()`);
    }
    const st = await app.js<Record<string, unknown>>(
      `(() => ({ world: __bh.renderer.seaHere?.world ?? null, gpuErrors: __bh.renderer.gpuErrors, stats: __bh.renderer.seaFft?.stats, state: __bh.renderer.seaState, key: __bh.renderer.seaKey }))()`,
    );
    console.log(`  foot: ${JSON.stringify(st)}, detail ${await detail()}`);
    expect(st.world).toBe("miller");
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
