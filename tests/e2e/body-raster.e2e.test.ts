import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PLANETES-AAA P1: another world's ground drawn by the raster (system/body-raster.ts, trace.wgsl bodyLite) — Miller,
// Mann, Edmunds and the Moon 3 km up: the body raster on (its target drawn, every pixel shaded), no GPU error; the same view
// with it off (renderer.bodyRasterOn = false: the tracer's march, as before) — both shots, side by side, and their GPU time.
// Duration: ~4 min (each world's kernels compiled once).
// Done when: every world drawn by the raster, without error.

const OUT = process.env.OUT ?? "remote-results/body-raster";
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, fpsCap: 0 });`;
const scene = (name: string, base: string, patch: string) =>
  `__bh.presets[${JSON.stringify(name)}] = { ...__bh.presets[${JSON.stringify(base)}], ${patch} }; __bh.game.preset(${JSON.stringify(name)}); ${HOLD}`;
const WORLDS: [string, string][] = [
  [
    "miller",
    scene("P1 miller", "Miller: the shallow sea", `shipMount: "cockpit", pose: { body: "miller", altKm: 3, nu: 120, off: [0, 92] }`),
  ],
  ["mann", scene("P1 mann", "Mann: the glaciers", `shipMount: "cockpit", pose: { body: "mann", altKm: 3, nu: 225, off: [0, 92] }`)],
  [
    "edmunds",
    scene("P1 edmunds", "Edmunds: the plains", `shipMount: "cockpit", pose: { body: "edmunds", altKm: 2, nu: 240, off: [0, 92] }`),
  ],
  [
    "moon",
    scene(
      "P1 moon",
      "Mars: from orbit",
      `target: "moon", fov: 60, pose: { body: "moon", altKm: 3, phase: 50, look: "moon", off: [0, 80] }`,
    ),
  ],
];
const ONLY = process.env.ONLY?.split(",");

describe.skipIf(!E2E)("P1: other worlds' ground drawn by the raster", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Kerr a=0.94, near edge-on")}` });
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
      while (!r.kernelsSettled && performance.now() - t0 < 300000) { __bh.touch(); await frame(); }
      while ((r.compilesPending > 0 || r.compilingNow.length > 0) && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
      for (let i = 0; i < 30; i++) { __bh.touch(); await frame(); }
      return Math.round(performance.now() - t0); })()`);
  const gpu = () =>
    app.js<number>(`(async () => {
      const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
      const g = []; let done = r.completedFrames; const t0 = performance.now();
      while (g.length < 60 && performance.now() - t0 < 30000) { __bh.touch(); await frame();
        if (r.completedFrames !== done) { done = r.completedFrames; g.push(r.completedDurations[r.completedDurations.length - 1]); } }
      g.sort((a, b) => a - b); return +(g[g.length >> 1] ?? 0).toFixed(1); })()`);

  for (const [body, set] of WORLDS.filter(([b]) => !ONLY || ONLY.includes(b)))
    test(body, async () => {
      const shots: [string, string][] = [];
      for (const on of [true, false]) {
        await app.js(`(() => { __bh.renderer.bodyRasterOn = ${on}; ${set} return 1; })()`);
        const ms = await settle();
        const st = await app.js<Record<string, unknown>>(`(() => { const r = __bh.renderer; return {
          now: r.bodyRasterNow, primary: r.rasterPrimaryNow ?? null, lite: r.rasterLiteActive, levels: r.bodyRaster?.levels ?? 0,
          err: r.bodyRaster?.error ?? null, reason: r.terrainRaster?.reason ?? null, gpuErrors: r.gpuErrors, block: r.realtimeBlockNow }; })()`);
        const g = await gpu();
        // (LEVERS=4,…: the raster's material's parts cut — renderer.liteSkip —, each one's GPU time: what they cost)
        if (on)
          for (const lv of process.env.LEVERS?.split(",") ?? []) {
            await app.js(`(() => { __bh.renderer.liteSkip = ${Number(lv)}; return 1; })()`);
            console.log(`    liteSkip ${lv}: gpu ${await gpu()} ms`);
            await app.js(`(() => { __bh.renderer.liteSkip = 0; return 1; })()`);
          }
        if (on && process.env.PASSES)
          console.log(
            `    passes: ${await app.js(`(async () => { const r = __bh.renderer; r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
            const t0 = performance.now(); while (performance.now() - t0 < 3000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
            const t = r.prof.table().filter((p) => p.ms > 0.2).sort((a, b) => b.ms - a.ms).slice(0, 12).map((p) => p.label + " " + p.ms.toFixed(1)).join(", ");
            r.prof.enabled = false; return t; })()`)}`,
          );
        console.log(`  ${body} raster ${on ? "on " : "off"}: gpu ${g} ms, settled ${(ms / 1000).toFixed(0)} s, ${JSON.stringify(st)}`);
        await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
        const file = `${OUT}/${body}-${on ? "raster" : "traced"}.png`;
        await app.shot(file);
        await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
        shots.push([file, `${on ? "raster" : "tracé"} ${g} ms`]);
        if (on) {
          expect(st.err).toBeNull();
          expect(st.now).toBe(true);
          expect(st.lite).toBe(true);
          expect(st.reason).toBe("body");
        }
        expect(st.gpuErrors).toBe(0);
      }
      await Bun.$`python3 scripts/compose.py ${OUT}/${body}.jpg ${`P1 — ${body}, raster du corps / tracé`} ${shots[0]![0]} ${shots[0]![1]} ${shots[1]![0]} ${shots[1]![1]} --width 1600`.quiet();
      expect(app.cdp.errors).toEqual([]);
    }, 900_000);
});
