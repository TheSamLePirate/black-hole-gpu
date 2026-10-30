import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// PLAN-PLANETES-AAA P8 (the airless worlds): Mercury's and Ceres's measured ground — their global relief maps (MESSENGER's
// 665 m model, Dawn's HAMO 137 m: scripts/build-dem.py) and their relief tiles round the camera (server/moon-tiles.ts made
// them on the room server; src/system/moon-tiles.ts streams them — from data/<body>/dem when the local server has a box
// built, else stream.samlepirate.org), Mercury's low-incidence MESSENGER mosaic for its albedo's detail, Ceres's map now
// Dawn's (the texture pack's was an invented one): each disc from orbit (its centre lit), Raditladi basin on Mercury under a
// low Sun from 15 km with the tiles then without (the global maps alone), Occator crater on Ceres in its afternoon from
// 25 km, the walker on each; the tiles drawn, none failed, no GPU error.
// Duration: ~8 min on kerr-mini.
// Done when: every view shot, the walkers on the ground, no GPU error.

const OUT = process.env.OUT ?? "remote-results/airless-ground";
// (shots of the ground compared: no depth of field, nor motion blur, every pixel shaded, full scale)
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0, earthRasterShading: "every", earthRasterScale: 1 });`;
// (at the scenes' 109.6 M the Sun stands over 0° N 40.4° E on Mercury — barely moving: its day is 176 of ours —, over
// 0.7° S 130.4° E on Ceres, going west 54.27° every 10 M: Occator, 239.3° E, at ~60° east of it — its afternoon — at 166.9 M)
const RADITLADI: [number, number] = [27.3, 119.1];
const OCCATOR: [number, number] = [19.8, -120.7];
const CERES_T = 166.93;
const view = (name: string, body: string, ll: [number, number], altKm: number, off: [number, number], time = 109.6) =>
  `__bh.presets.${name} = { ...__bh.presets["Mercury: from orbit"], time: ${time}, target: "${body}", fov: 60, ship: false, pose: { at: [${ll}], body: "${body}", altKm: ${altKm}, look: "${body}", off: [${off}] } }; __bh.game.preset("${name}"); ${HOLD}`;

describe.skipIf(!E2E)("P8: the airless worlds' ground", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Mercury: from orbit")}` });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  // (the tracer compiled, the world's map and its tiles in, then a few frames)
  const settle = (body: string | null) =>
    app.js(`(async () => { const r = __bh.renderer, m = r.moonTiles, t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || (${JSON.stringify(body)} && (r.hdMap.name !== ${JSON.stringify(body)} || m.pending > 0))) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      const t1 = performance.now();
      while (performance.now() - t1 < 6000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      return 1; })()`);
  const shot = async (name: string) => {
    // (no picture from a tracer still compiling — the refining one starts once the realtime one is in)
    await app.settled();
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/${name}.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  };
  const state = () =>
    app.js<Record<string, unknown>>(
      `(() => { const r = __bh.renderer, m = r.moonTiles; return { hd: r.hdMap.name, dem: !!r.hdMap.dem, world: m.world, drawn: m.drawn, loaded: m.loaded, failed: m.failed, imagery: m.imagery, from: m.source, raster: r.bodyRasterNow, pipeline: r.earthPipelineNow?.(__bh.settings), mount: __bh.settings.shipMount, gpuErrors: r.gpuErrors }; })()`,
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
  const walk = async (body: string, ll: [number, number]) => {
    await app.js(
      `(() => { __bh.camera.character.start("${body}", ${ll[0]}, ${ll[1]}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`,
    );
    await settle(body);
    return app.js<number>(`(() => __bh.camera.character.state().heightM ?? -1)()`);
  };

  test("Mercury from orbit: the disc lit at its centre, MESSENGER's relief under it", async () => {
    await app.js(`(() => { __bh.game.preset("Mercury: from orbit"); ${HOLD} return 1; })()`);
    await settle("mercury");
    const st = await state();
    await shot("mercury-orbit");
    const mid = await centre("mercury-orbit");
    console.log(`  mercury orbit: ${JSON.stringify(st)} centre ${mid.toFixed(1)} / 255`);
    expect(st.dem).toBe(true);
    expect(mid).toBeGreaterThan(20);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("Raditladi from 15 km under a low Sun, across its floor to its peak ring: the tiles drawn, then the global maps alone", async () => {
    await app.js(`(() => { ${view("p8m", "mercury", [RADITLADI[0] - 1.6, RADITLADI[1]], 15, [0, 74])} return 1; })()`);
    await settle("mercury");
    const st = await state();
    console.log(`  raditladi: ${JSON.stringify(st)}`);
    await shot("raditladi-tiles");
    expect(st.world).toBe("mercury");
    expect(st.drawn).toBe(true);
    expect(st.failed).toBe(0);
    await app.js(`(() => { __bh.renderer.moonTiles.enabled = false; return 1; })()`);
    await settle("mercury");
    await shot("raditladi-global");
    await app.js(`(() => { __bh.renderer.moonTiles.enabled = true; return 1; })()`);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("the walker on Raditladi's floor, standing on the tiles' ground", async () => {
    const h = await walk("mercury", [RADITLADI[0] - 0.4, RADITLADI[1]]);
    const st = await state();
    console.log(`  mercury foot: ${JSON.stringify(st)} height over the ground ${h} m`);
    await shot("mercury-foot");
    expect(st.drawn).toBe(true);
    expect(Math.abs(h)).toBeLessThan(0.1);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("Ceres from orbit: Dawn's map, the disc lit at its centre", async () => {
    await app.js(`(() => { ${view("p8c0", "ceres", [OCCATOR[0], OCCATOR[1] + 10], 700, [0, 0], CERES_T)} return 1; })()`);
    await settle("ceres");
    const st = await state();
    await shot("ceres-orbit");
    const mid = await centre("ceres-orbit");
    console.log(`  ceres orbit: ${JSON.stringify(st)} centre ${mid.toFixed(1)} / 255`);
    expect(st.dem).toBe(true);
    expect(mid).toBeGreaterThan(20);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("Occator from 25 km in its afternoon: the tiles drawn", async () => {
    await app.js(`(() => { ${view("p8c", "ceres", [OCCATOR[0] - 0.9, OCCATOR[1]], 25, [0, 55], CERES_T)} return 1; })()`);
    await settle("ceres");
    const st = await state();
    console.log(`  occator: ${JSON.stringify(st)}`);
    await shot("occator");
    expect(st.world).toBe("ceres");
    expect(st.drawn).toBe(true);
    expect(st.failed).toBe(0);
    expect(st.gpuErrors).toBe(0);
  }, 900_000);

  test("the walker on Ceres by Occator, standing on the tiles' ground", async () => {
    const h = await walk("ceres", [OCCATOR[0] - 0.9, OCCATOR[1]]);
    const st = await state();
    console.log(`  ceres foot: ${JSON.stringify(st)} height over the ground ${h} m`);
    await shot("ceres-foot");
    expect(st.drawn).toBe(true);
    expect(Math.abs(h)).toBeLessThan(0.1);
    expect(st.gpuErrors).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
