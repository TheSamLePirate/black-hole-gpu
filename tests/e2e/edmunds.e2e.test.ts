import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PLANETES-AAA P5: Edmunds — its steep-sided mesas, its canyons, its asymmetric dunes (terrain.ts and trace.wgsl
// reliefBase, the same), its strata's colours (trace.wgsl planetAlbedo, EDM_H): the body raster drawing them, no GPU error;
// shots from 2.6 km towards the horizon (chase), from high looking down, on foot.
// Duration: ~2 min on kerr-mini.
// Done when: every view shot without a GPU error.

const OUT = process.env.OUT ?? "remote-results/edmunds";
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false });`;
const VIEWS: [string, string][] = [
  [
    "horizon",
    `__bh.presets.ed1 = { ...__bh.presets["Edmunds: the plains"], shipMount: "chase", fov: 70, pose: { body: "edmunds", altKm: 2.6, nu: 240, off: [0, 86] } }; __bh.game.preset("ed1"); ${HOLD}`,
  ],
  [
    "down",
    `__bh.presets.ed2 = { ...__bh.presets["Edmunds: the plains"], ship: false, fov: 60, pose: { body: "edmunds", altKm: 6, nu: 240, off: [0, 55] } }; __bh.game.preset("ed2"); ${HOLD}`,
  ],
];

describe.skipIf(!E2E)("P5: Edmunds", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Edmunds: the desert world")}` });
    await app.js(`(() => { __bh.settings.showFps = true; return 1; })()`);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const settle = () =>
    app.js(`(async () => { const r = __bh.renderer; const t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      for (let i = 0; i < 60; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`);
  const shot = async (name: string) => {
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/${name}.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  };
  const state = () =>
    app.js<Record<string, unknown>>(
      `(() => { const r = __bh.renderer; return { raster: r.bodyRasterNow, levels: r.bodyRaster?.levels ?? 0, err: r.bodyRaster?.error ?? null, gpuErrors: r.gpuErrors }; })()`,
    );

  for (const [name, set] of VIEWS)
    test(name, async () => {
      await app.js(`(() => { ${set} return 1; })()`);
      await settle();
      const st = await state();
      console.log(`  ${name}: ${JSON.stringify(st)}`);
      await shot(name);
      expect(st.err).toBeNull();
      expect(st.gpuErrors).toBe(0);
    }, 900_000);

  test("on foot", async () => {
    await app.js(`(() => { __bh.game.preset("Edmunds: the desert world"); ${HOLD} return 1; })()`);
    await settle();
    let best = 0;
    let lum = -1;
    for (const lon of [0, 90, 180, 270]) {
      await app.js(
        `(() => { __bh.camera.character.start("edmunds", 0, ${lon}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`,
      );
      await settle();
      const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60 });
      const L = await app.js<number>(`(async () => {
        const i = await createImageBitmap(await (await fetch("data:image/jpeg;base64,${data}")).blob());
        const c = new OffscreenCanvas(160, 100), g = c.getContext("2d"); g.drawImage(i, 0, 0, 160, 100);
        const d = g.getImageData(0, 55, 160, 45).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2];
        return s / (d.length / 4) / 3; })()`);
      if (L > lum) [lum, best] = [L, lon];
      await app.js(`(() => { __bh.camera.character.stop(); return 1; })()`);
    }
    await app.js(
      `(() => { __bh.camera.character.start("edmunds", 0, ${best}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`,
    );
    await settle();
    await shot("foot");
    const st = await state();
    console.log(`  foot: ${JSON.stringify(st)}`);
    expect(st.gpuErrors).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
