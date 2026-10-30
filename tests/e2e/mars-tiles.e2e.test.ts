import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PLANETES-AAA P7: Mars's ground — its relief marched (trace.wgsl earthNear: nearMarch; the sphere before), its HRSC and
// MOLA tiles (server/moon-tiles.ts made them on the room server; src/system/moon-tiles.ts streams them — from data/mars/dem
// when the local server has a box built, else stream.samlepirate.org), Viking's colour and CTX's detail (Esri's OnMars), its
// craters and finest ground: Valles Marineris (Coprates) from 4 km with the tiles then without (the global maps alone),
// Gale crater from 5 km, the walker on the canyon's plateau; each place at the same afternoon hour — the scene's clock set
// for it —; the tiles drawn, none failed, no GPU error.
// Duration: ~6 min on kerr-mini.
// Done when: every view shot, the tiles drawn and none failed.

const OUT = process.env.OUT ?? "remote-results/mars-tiles";
// (shots of the ground compared: no depth of field, nor motion blur, every pixel shaded, full scale)
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0, earthRasterShading: "every", earthRasterScale: 1 });`;
// (the scene "Mars: from orbit" at 109.6 M has the Sun over ~125° W in the afternoon; a place east of it the same hour earlier
// by its longitude's difference — a sol 88 775 s, a second 1/(4.925490947e-6 · 10⁸) M)
const at = (lon: number) => 109.6 - ((((((lon + 125) % 360) + 360) % 360) / 360) * 88775) / (4.925490947e-6 * 1e8);
const view = (name: string, ll: [number, number], altKm: number, off: [number, number]) =>
  `__bh.presets.${name} = { ...__bh.presets["Mars: from orbit"], time: ${at(ll[1])}, target: "mars", fov: 60, ship: false, pose: { at: [${ll}], body: "mars", altKm: ${altKm}, look: "mars", off: [${off}] } }; __bh.game.preset("${name}"); ${HOLD}`;

describe.skipIf(!E2E)("P7: Mars's ground", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Mars: from orbit")}` });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  // (the tracer compiled, the tiles in — their heights and imagery, CTX's slow: a few seconds more —, then a few frames)
  const settle = () =>
    app.js(`(async () => { const r = __bh.renderer, m = r.moonTiles, t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || m.pending > 0) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      const t1 = performance.now();
      while (performance.now() - t1 < 8000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      return 1; })()`);
  const shot = async (name: string) => {
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/${name}.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  };
  const state = () =>
    app.js<Record<string, unknown>>(
      `(() => { const r = __bh.renderer, m = r.moonTiles; return { world: m.world, drawn: m.drawn, loaded: m.loaded, failed: m.failed, imagery: m.imagery, top: Math.round(m.top), pipeline: r.earthPipelineNow?.(__bh.settings), gpuErrors: r.gpuErrors, from: m.source, body: { now: r.bodyRasterNow, ready: !!r.bodyRaster?.ready, reach: Math.round(r.bodyRaster?.reach ?? 0), tr: r.terrainRaster?.active ? "drawn" : r.terrainRaster?.reason, primary: r.rasterPrimaryOn } }; })()`,
    );

  test("Valles Marineris from 4 km: the tiles drawn, then the global maps alone", async () => {
    await app.js(`(() => { ${view("p7a", [-11.5, -70], 4, [0, 70])} return 1; })()`);
    await settle();
    const st = await state();
    console.log(`  valles: ${JSON.stringify(st)}`);
    await shot("valles-tiles");
    expect(st.world).toBe("mars");
    expect(st.drawn).toBe(true);
    expect(st.failed).toBe(0);
    await app.js(`(() => { __bh.renderer.moonTiles.enabled = false; return 1; })()`);
    await settle();
    await shot("valles-global");
    await app.js(`(() => { __bh.renderer.moonTiles.enabled = true; return 1; })()`);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("Gale crater from 5 km", async () => {
    await app.js(`(() => { ${view("p7b", [-6.2, 137.4], 5, [0, 68])} return 1; })()`);
    await settle();
    const st = await state();
    console.log(`  gale: ${JSON.stringify(st)}`);
    await shot("gale");
    expect(st.drawn).toBe(true);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("the walker on the plateau over Coprates, standing on the tiles' ground", async () => {
    await app.js(`(() => { ${view("p7c", [-11.5, -70], 4, [0, 70])}
      __bh.camera.character.start("mars", -11.5, -70); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`);
    await settle();
    const st = await state();
    const h = await app.js<number>(`(() => __bh.camera.character.state().heightM ?? -1)()`);
    console.log(`  foot: ${JSON.stringify(st)} height over the ground ${h} m`);
    await shot("foot");
    expect(st.drawn).toBe(true);
    expect(Math.abs(h)).toBeLessThan(0.1);
    expect(st.gpuErrors).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
