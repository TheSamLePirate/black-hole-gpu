import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// PLAN-PLANETES-AAA P8 (Titan): its ground under its haze — the sky's light many times scattered (trace.wgsl setAir: the
// orange sky from the ground, the disc light from space), its relief (titanRelief: dunes, hills — the walker on the CPU's
// twin) drawn by the body raster in its own kernel (NEAR_KIND 5), its finer map (Cassini ISS), its radar's tiles (its albedo's
// detail) and its seas (Cassini's radar: Ontario Lacus, a methane mirror, its waves by FFT at Titan's gravity): the walker on the equatorial dunes, Ontario Lacus from 300 m at its local noon, the disc
// from 6 000 km; Titan's kernel and raster in, its map loaded, no GPU error.
// Duration: ~6 min on kerr-mini.
// Done when: every view shot, the walker on the ground, no GPU error.

const OUT = process.env.OUT ?? "remote-results/titan-ground";
// (shots of the ground compared: no depth of field, nor motion blur, every pixel shaded, full scale)
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0, earthRasterShading: "every", earthRasterScale: 1 });`;
// (the scene "Titan: the orange haze" has the Sun over 8° S, 43° W; 1 089 M later — 6.2 days of Titan's 15.9 — over 176° E:
// Ontario Lacus's noon)
const ONTARIO_NOON = 1089.3;

describe.skipIf(!E2E)("P8: Titan's ground", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Titan: the orange haze")}` });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  // (the tracer and the raster compiled, Titan's finer map in, then a few frames)
  const settle = () =>
    app.js(`(async () => { const r = __bh.renderer, t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || r.hdMap.name !== "titan" || r.moonTiles.pending > 0) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      const t1 = performance.now();
      while (performance.now() - t1 < 6000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      return 1; })()`);
  const shot = async (name: string) => {
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/${name}.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  };
  const state = () =>
    app.js<Record<string, unknown>>(
      `(() => { const r = __bh.renderer; return { kind: (r.featureKey >> 26) & 7, raster: r.bodyRasterNow, hd: r.hdMap.name, pipeline: r.earthPipelineNow?.(__bh.settings), gpuErrors: r.gpuErrors, tiles: { world: r.moonTiles.world, drawn: r.moonTiles.drawn, imagery: r.moonTiles.imagery, failed: r.moonTiles.failed }, sea: r.seaHere?.world ?? null }; })()`,
    );

  test("the walker on the equatorial dunes, standing on the CPU's ground, Titan's kernel and raster in", async () => {
    await app.js(`(() => { __bh.game.preset("Titan: the orange haze"); ${HOLD}
      __bh.camera.character.start("titan", -8, -30); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`);
    await settle();
    const st = await state();
    const h = await app.js<number>(`(() => __bh.camera.character.state().heightM ?? -1)()`);
    console.log(`  dunes: ${JSON.stringify(st)} height over the ground ${h} m`);
    await shot("dunes");
    expect(st.kind).toBe(5);
    expect(st.raster).toBe(true);
    // (its radar's tiles in — the albedo's detail, moon-tiles.ts WORLDS.titan)
    expect(st.tiles).toMatchObject({ world: "titan", drawn: true, failed: 0 });
    // (no sea within 30 km of the equator's dunes: no waves computed)
    expect(st.sea).toBe(null);
    expect(st.hd).toBe("titan");
    expect(Math.abs(h)).toBeLessThan(0.1);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("Ontario Lacus from 300 m at its noon: the methane's mirror", async () => {
    await app.js(
      `(() => { __bh.presets.t8o = { ...__bh.presets["Titan: the orange haze"], time: __bh.presets["Titan: the orange haze"].time + ${ONTARIO_NOON}, fov: 60, ship: false, pose: { body: "titan", altKm: 0.3, at: [-71, 175], look: "titan", off: [0, 84] } }; __bh.game.preset("t8o"); ${HOLD} return 1; })()`,
    );
    await settle();
    const st = await state();
    console.log(`  ontario: ${JSON.stringify(st)}`);
    await shot("ontario");
    expect(st.kind).toBe(5);
    // (its waves by FFT at Titan's gravity — renderer seaFftParams: the sea near)
    expect(st.sea).toBe("titan");
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("the disc from 6 000 km: the haze lit by its many scatterings", async () => {
    await app.js(`(() => { __bh.game.preset("Titan: the orange haze"); ${HOLD} return 1; })()`);
    await app.js(
      `(async () => { const r = __bh.renderer, t0 = performance.now(); while ((!r.kernelsSettled || r.compilesPending > 0) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } for (let i = 0; i < 60; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
    );
    const st = await state();
    console.log(`  orbit: ${JSON.stringify(st)}`);
    await shot("orbit");
    // (the disc's centre the haze's light, not the black of rays past the march's reach gone through it)
    const px = readPng(new Uint8Array(await Bun.file(`${OUT}/orbit.png`).arrayBuffer()));
    let sum = 0,
      n = 0;
    for (let y = Math.floor(px.height * 0.45); y < px.height * 0.55; y++)
      for (let x = Math.floor(px.width * 0.45); x < px.width * 0.55; x++, n++) {
        const i = (y * px.width + x) * px.channels;
        sum += (px.data[i]! + px.data[i + 1]! + px.data[i + 2]!) / 3;
      }
    console.log(`  orbit: the disc's centre ${(sum / n).toFixed(1)} / 255`);
    expect(sum / n).toBeGreaterThan(40);
    expect(st.gpuErrors).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
