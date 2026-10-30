import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PLANETES-AAA P6: the Moon's 118 m relief in tiles (server/moon-tiles.ts made them on the room server; src/system/
// moon-tiles.ts streams them — from data/moon/lola when the local server has a box built, else stream.samlepirate.org) with
// Clementine's albedo: Triesnecker crater from 4 km, the tiles on then off (the global map's 2.7 km alone), Rima Hyginus,
// the walker on Triesnecker's rim; the tiles drawn, none failed, no GPU error.
// Duration: ~5 min on kerr-mini.
// Done when: every view shot, the tiles drawn and none failed.

const OUT = process.env.OUT ?? "remote-results/moon-tiles";
// (shots of the ground compared: no depth of field — the scenes turn it on — nor motion blur, every pixel shaded, full scale)
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0, earthRasterShading: "every", earthRasterScale: 1 });`;
const view = (name: string, at: [number, number], altKm: number, off: [number, number]) =>
  `__bh.presets.${name} = { ...__bh.presets["Mars: from orbit"], target: "moon", fov: 60, ship: false, pose: { at: [${at}], body: "moon", altKm: ${altKm}, look: "moon", off: [${off}] } }; __bh.game.preset("${name}"); ${HOLD}`;

describe.skipIf(!E2E)("P6: the Moon's relief tiles", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Moon: an afternoon on the plains")}` });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  // (the tracer compiled, the tiles in — their heights and Clementine's albedo —, then a few frames)
  const settle = () =>
    app.js(`(async () => { const r = __bh.renderer, m = r.moonTiles, t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || m.pending > 0) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      const i0 = m.imagery; const t1 = performance.now();
      while (performance.now() - t1 < 4000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      for (let i = 0; i < 60; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return m.imagery - i0; })()`);
  const shot = async (name: string) => {
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/${name}.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  };
  const state = () =>
    app.js<Record<string, unknown>>(
      `(() => { const r = __bh.renderer, m = r.moonTiles; return { drawn: m.drawn, loaded: m.loaded, failed: m.failed, imagery: m.imagery, top: Math.round(m.top), raster: r.bodyRasterNow, pipeline: r.earthPipelineNow?.(__bh.settings), gpuErrors: r.gpuErrors, from: m.source }; })()`,
    );

  test("Triesnecker from 4 km: the tiles drawn, then the global map alone", async () => {
    await app.js(`(() => { ${view("p6a", [3.45, 3.6], 4, [0, 66])} return 1; })()`);
    await settle();
    const st = await state();
    console.log(`  triesnecker: ${JSON.stringify(st)}`);
    await shot("triesnecker-tiles");
    expect(st.drawn).toBe(true);
    expect(st.loaded as number).toBeGreaterThanOrEqual(16);
    expect(st.failed).toBe(0);
    await app.js(`(() => { __bh.renderer.moonTiles.enabled = false; return 1; })()`);
    await settle();
    await shot("triesnecker-global");
    expect(await app.js<boolean>(`(() => __bh.renderer.moonTiles.drawn)()`)).toBe(false);
    await app.js(`(() => { __bh.renderer.moonTiles.enabled = true; return 1; })()`);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("Rima Hyginus from 5 km", async () => {
    await app.js(`(() => { ${view("p6b", [6.6, 5.6], 5, [0, 60])} return 1; })()`);
    await settle();
    const st = await state();
    console.log(`  hyginus: ${JSON.stringify(st)}`);
    await shot("hyginus");
    expect(st.drawn).toBe(true);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("the walker on Triesnecker's rim, standing on the tiles' ground", async () => {
    await app.js(`(() => { __bh.game.preset("Moon: an afternoon on the plains"); ${HOLD}
      __bh.camera.character.start("moon", 4.62, 3.6); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`);
    await settle();
    const st = await state();
    // (his height over the ground he stands on — the tiles' relief, the CPU's —: a centimetre or so)
    const h = await app.js<number>(`(() => __bh.camera.character.state().heightM ?? -1)()`);
    console.log(`  foot: ${JSON.stringify(st)} height over the ground ${h} m`);
    await shot("foot");
    expect(st.drawn).toBe(true);
    expect(Math.abs(h)).toBeLessThan(0.1);
    expect(st.gpuErrors).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
