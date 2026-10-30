import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// PLAN-PLANETES-AAA P8 (Venus): its ground under its clouds — a solid surface at its radius (no longer the cloud deck drawn as
// the ground), Magellan's altimetry marched as Mars's relief is and drawn by the body raster (its kernel, NEAR_KIND 6: Mars's paths and its cloud slab), its ground's map
// from Magellan's radar (a basalt's albedo) with the radar's tiles for its detail, and its cloud deck as a slab in its air (trace.wgsl AIR_SLAB: 47–70 km, τ ≈ 30) —
// bright from space, an orange glow and ~3 % of the sunlight on the ground: the disc from 15 000 km (its centre bright), the
// plains from 3 km, the walker on them near the point under the Sun; Venus's map loaded, no GPU error.
// Duration: ~5 min on kerr-mini.
// Done when: every view shot, the walker on the ground, no GPU error.

const OUT = process.env.OUT ?? "remote-results/venus-ground";
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0, earthRasterShading: "every", earthRasterScale: 1 });`;
// (the scene "Venus: above the clouds" has the Sun over ~3° S, 59° E: the place below a little west of it, the Sun high)
const AT: [number, number] = [-5, 40];

describe.skipIf(!E2E)("P8: Venus's ground", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Venus: above the clouds")}` });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const settle = (map = true) =>
    app.js(`(async () => { const r = __bh.renderer, t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || (${map} && (r.hdMap.name !== "venus" || r.moonTiles.pending > 0))) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
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
      `(() => { const r = __bh.renderer; return { kind: (r.featureKey >> 26) & 7, raster: r.bodyRasterNow, hd: r.hdMap.name, pipeline: r.earthPipelineNow?.(__bh.settings), gpuErrors: r.gpuErrors, tiles: { world: r.moonTiles.world, drawn: r.moonTiles.drawn, imagery: r.moonTiles.imagery, failed: r.moonTiles.failed } }; })()`,
    );
  // (a shot's mean over a tenth of it about its centre [/255])
  const centre = async (name: string) => {
    const px = readPng(new Uint8Array(await Bun.file(`${OUT}/${name}.png`).arrayBuffer()));
    let sum = 0,
      n = 0;
    for (let y = Math.floor(px.height * 0.45); y < px.height * 0.55; y++)
      for (let x = Math.floor(px.width * 0.45); x < px.width * 0.55; x++, n++) {
        const i = (y * px.width + x) * px.channels;
        sum += (px.data[i]! + px.data[i + 1]! + px.data[i + 2]!) / 3;
      }
    return sum / n;
  };

  test("the disc from 15 000 km: the cloud deck bright", async () => {
    await app.js(`(() => { __bh.game.preset("Venus: above the clouds"); ${HOLD} return 1; })()`);
    await settle(false);
    const st = await state();
    await shot("orbit");
    const c = await centre("orbit");
    console.log(`  orbit: ${JSON.stringify(st)} the disc's centre ${c.toFixed(1)} / 255`);
    expect(c).toBeGreaterThan(80);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("the plains from 3 km under the clouds", async () => {
    await app.js(
      `(() => { __bh.presets.v8l = { ...__bh.presets["Venus: above the clouds"], fov: 60, ship: false, pose: { body: "venus", altKm: 3, at: [${AT}], look: "venus", off: [0, 78] } }; __bh.game.preset("v8l"); ${HOLD} return 1; })()`,
    );
    await settle();
    const st = await state();
    console.log(`  low: ${JSON.stringify(st)}`);
    await shot("low");
    expect(st.kind).toBe(6);
    expect(st.hd).toBe("venus");
    // (Magellan's radar's tiles in — its albedo's detail, moon-tiles.ts WORLDS.venus)
    expect(st.tiles).toMatchObject({ world: "venus", drawn: true, failed: 0 });
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("the walker on the plains, standing on Magellan's relief", async () => {
    await app.js(`(() => { __bh.game.preset("Venus: above the clouds"); ${HOLD}
      __bh.camera.character.start("venus", ${AT[0]}, ${AT[1]}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`);
    await settle();
    const st = await state();
    const h = await app.js<number>(`(() => __bh.camera.character.state().heightM ?? -1)()`);
    console.log(`  foot: ${JSON.stringify(st)} height over the ground ${h} m`);
    await shot("foot");
    expect(st.raster).toBe(true);
    expect(Math.abs(h)).toBeLessThan(0.1);
    expect(st.gpuErrors).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
