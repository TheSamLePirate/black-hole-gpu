import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PLANETES-AAA P8 A4 (the moons): their own ground over their craters (trace.wgsl moonOwn; terrain.ts moonOwn, the same
// on the CPU — the walker on it): Europa's double ridges and chaos, Ganymede's grooved lanes, Io's paterae and massifs,
// Enceladus's tiger stripes about its south pole — each from a few km up in its afternoon, then the walker there, standing
// on the CPU's ground —; and two of the maps set right on the game's axes (scripts/fix-moon-maps.py): Rhea's wispy trailing
// side and Callisto from orbit, their sunlit discs. No GPU error.
// Duration: ~9 min on kerr-mini.
// Done when: every view shot, every walker on the ground, no GPU error.

const OUT = process.env.OUT ?? "remote-results/moons-ground";
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0, earthRasterShading: "every", earthRasterScale: 1 });`;
// (the scenes' 109.6 M: the Sun over Io's 43° W, Europa's 46° W, Ganymede's 136° W, Enceladus's 8° S 158° W — each place
// ~55° east of it, its afternoon; Enceladus's stripes near its south pole, the Sun ~13° up there)
const SITES: { body: string; at: [number, number]; altKm: number; off: [number, number]; from?: [number, number] }[] = [
  { body: "europa", at: [10, 10], altKm: 4, off: [0, 78] },
  { body: "ganymede", at: [20, -76], altKm: 6, off: [0, 76] },
  // (Io: a patera at 13.5° S 9.5° E — moonOwn —, seen from the south; the walker on its floor)
  { body: "io", at: [-13.5, 9.5], altKm: 12, off: [0, 74], from: [-15.3, 9.5] },
  // (from 84° S looking north — off's first angle turns the view about its axis: 180 looked at the sky —, the stripes about it)
  { body: "enceladus", at: [-84, -118], altKm: 8, off: [0, 70] },
];
const view = (name: string, body: string, ll: [number, number], altKm: number, off: [number, number]) =>
  `__bh.presets.${name} = { ...__bh.presets["Mercury: from orbit"], time: 109.6, target: "${body}", fov: 60, ship: false, pose: { at: [${ll}], body: "${body}", altKm: ${altKm}, look: "${body}", off: [${off}] } }; __bh.game.preset("${name}"); ${HOLD}`;

describe.skipIf(!E2E)("P8 A4: the moons' ground", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Europa: Jupiter over the ice")}` });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  // (the tracer compiled, the world's finer maps in, then a few frames)
  const settle = (body: string) =>
    app.js(`(async () => { const r = __bh.renderer, t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || r.hdMap.name !== ${JSON.stringify(body)}) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      const t1 = performance.now();
      while (performance.now() - t1 < 6000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      return 1; })()`);
  const shot = async (name: string) => {
    // (no picture from a tracer still compiling)
    await app.settled();
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/${name}.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  };
  const state = () =>
    app.js<Record<string, unknown>>(
      `(() => { const r = __bh.renderer; return { hd: r.hdMap.name, raster: r.bodyRasterNow, pipeline: r.earthPipelineNow?.(__bh.settings), mount: __bh.settings.shipMount, gpuErrors: r.gpuErrors }; })()`,
    );

  for (const s of SITES)
    test(`${s.body}: its own ground from ${s.altKm} km in its afternoon, then the walker on it`, async () => {
      await app.js(`(() => { ${view(`p8${s.body}`, s.body, s.from ?? s.at, s.altKm, s.off)} return 1; })()`);
      await settle(s.body);
      const st = await state();
      console.log(`  ${s.body} low: ${JSON.stringify(st)}`);
      await shot(`${s.body}-low`);
      expect(st.gpuErrors).toBe(0);
      await app.js(
        `(() => { __bh.camera.character.start("${s.body}", ${s.at[0]}, ${s.at[1]}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`,
      );
      await settle(s.body);
      const h = await app.js<number>(`(() => __bh.camera.character.state().heightM ?? -1)()`);
      const sf = await state();
      console.log(`  ${s.body} foot: ${JSON.stringify(sf)} height over the ground ${h} m`);
      await shot(`${s.body}-foot`);
      expect(Math.abs(h)).toBeLessThan(0.1);
      expect(sf.gpuErrors).toBe(0);
    }, 900_000);

  for (const [body, ll] of [
    ["rhea", [0, 90]],
    ["callisto", [0, 80]],
  ] as const)
    test(`${body} from orbit: its map on the game's axes, its disc lit`, async () => {
      await app.js(
        `(() => { ${view(`p8o${body}`, body, ll as unknown as [number, number], body === "rhea" ? 1000 : 3500, [0, 0])} return 1; })()`,
      );
      await settle(body);
      const st = await state();
      console.log(`  ${body} orbit: ${JSON.stringify(st)}`);
      await shot(`${body}-orbit`);
      expect(st.gpuErrors).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    }, 900_000);
});
