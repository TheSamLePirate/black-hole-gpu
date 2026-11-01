import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// The worlds' details after P11 (PLAN-PLANETES-AAA, the leftovers): the Moon's rocks (trace.wgsl airlessRocks — the body raster's
// geometry and the shading: blocks, cobbles, pebbles, their shadows), Mars's seasonal CO₂ caps (marsFrost, by Ls —
// system/mars-season.ts) and its dust devils (marsDevils), Jupiter's convective towers (giantTowers — JunoCam's pop-up clouds,
// at the terminator). Each seen with and without (renderer.liteSkip 512 the rocks, 2048 the towers; the caps by the season),
// the HUD hidden; no GPU error.
// Duration: ~3 min on this Mac
// Done when: the four compared.

const OUT = "remote-results/world-details";
const T0 = 109.6;
const DAY = 86400 / 492.5490947;
const TURN = (9.925 * 3600) / 492.5490947;
afterAll(stopServer);

/** the mean absolute difference of two captures over a box (fractions of the image), 0 … 255 */
async function diff(a: string, b: string, box = [0, 0, 1, 1]) {
  const A = readPng(new Uint8Array(await Bun.file(a).arrayBuffer())),
    B = readPng(new Uint8Array(await Bun.file(b).arrayBuffer()));
  let s = 0,
    n = 0;
  for (let y = Math.floor(box[1]! * A.height); y < box[3]! * A.height; y += 2)
    for (let x = Math.floor(box[0]! * A.width); x < box[2]! * A.width; x += 2) {
      const i = (y * A.width + x) * A.channels;
      for (let c = 0; c < 3; c++) s += Math.abs(A.data[i + c]! - B.data[i + c]!);
      n += 3;
    }
  return s / n;
}
/** the mean brightness over a box (fractions of the image), 0 … 255 */
async function bright(a: string, box: number[]) {
  const A = readPng(new Uint8Array(await Bun.file(a).arrayBuffer()));
  let s = 0,
    n = 0;
  for (let y = Math.floor(box[1]! * A.height); y < box[3]! * A.height; y++)
    for (let x = Math.floor(box[0]! * A.width); x < box[2]! * A.width; x++) {
      const i = (y * A.width + x) * A.channels;
      s += (A.data[i]! + A.data[i + 1]! + A.data[i + 2]!) / 3;
      n++;
    }
  return s / n;
}

test.skipIf(!E2E)(
  "the Moon's rocks, Mars's caps and dust devils, Jupiter's convective towers",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Moon: Earthrise")}` });
    try {
      const shot = async (name: string, scene: string, patch: string, skip = 0) => {
        await app.js(`(() => { __bh.renderer.liteSkip = ${skip}; __bh.presets.zzpd = { ...__bh.presets[${JSON.stringify(scene)}], ship: false, ${patch} };
          __bh.game.preset("zzpd"); Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9 }); return 1; })()`);
        await app.settled();
        // (the kernels and the tiles in — heights, imagery —, then frames drawn: the image settled, the ground at its finest)
        await app.js(`(async () => { const r = __bh.renderer, m = r.moonTiles, t0 = performance.now();
          for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
          while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || m.pending > 0) && performance.now() - t0 < 300000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
          const t1 = performance.now();
          while (performance.now() - t1 < 4000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
          return 1; })()`);
        await app.js(`(() => { let s = document.getElementById("zz-clean"); if (!s) { s = document.createElement("style"); s.id = "zz-clean";
          s.textContent = "body * { visibility: hidden !important } canvas#view { visibility: visible !important }"; document.head.append(s); } return 1; })()`);
        const file = `${OUT}/${name}.png`;
        await app.shot(file);
        await app.js(`(() => { document.getElementById("zz-clean")?.remove(); __bh.renderer.liteSkip = 0; return 1; })()`);
        return file;
      };
      // (the Moon: a person's view at 1.7 m, the Sun at 40° from the side — the rocks, their shadows — with and without)
      const moon = `fov: 60, pose: { body: "moon", at: [-20, 0], sunEl: 40, heading: 0, standM: 1.7, off: [0, -14] }`;
      const r1 = await shot("moon-rocks", "Moon: Earthrise", moon);
      const r0 = await shot("moon-rocks-off", "Moon: Earthrise", moon, 512);
      const dr = await diff(r1, r0, [0, 0.4, 1, 1]);
      console.log(`  the Moon's rocks: the ground's lower half ${dr.toFixed(2)} / 255 apart`);
      expect(dr).toBeGreaterThan(0.5);
      // (Mars from 9 000 km over 45° N: the north cap at the end of its winter — Ls ~350, its edge ~59° N — against the start of
      // its autumn — Ls ~190, but the residual cap —, the Sun near its equator both times: the same light)
      const orbit = `fov: 50, pose: { body: "mars", altKm: 9000, phase: 25, at: [45, 0], look: "mars" }`;
      const w = await shot("mars-ls350", "Mars: the blue sunset", `time: ${T0 + 390 * DAY}, ${orbit}`);
      const su = await shot("mars-ls190", "Mars: the blue sunset", `time: ${T0 + 122.5 * DAY}, ${orbit}`);
      // (the disc's northern part — the stars out of the count)
      const north = [0.38, 0.22, 0.62, 0.42];
      const fw = await bright(w, north),
        fs = await bright(su, north);
      console.log(
        `  Mars's northern disc: ${fw.toFixed(1)} at Ls 350 (the seasonal cap), ${fs.toFixed(1)} at Ls 190 (the residual cap alone)`,
      );
      expect(fw).toBeGreaterThan(1.15 * fs);
      // (Mars's dust devils: a southern summer's afternoon at 15° S, looking south — a shot)
      // (twice: the first placing stands on the ground known before its tiles came)
      const devils = `time: ${T0 + 251.5 * DAY}, fov: 60, pose: { body: "mars", at: [-15, 0], sunEl: 50, heading: 180, standM: 2, off: [0, 4] }`;
      await shot("mars-devils", "Mars: the blue sunset", devils);
      const dv = await shot("mars-devils", "Mars: the blue sunset", devils);
      // (a devil in front of the dunes: its column, against the sky just over the horizon — 4096 cuts them)
      const dv0 = await shot("mars-devils-off", "Mars: the blue sunset", devils, 4096);
      const dd = await diff(dv, dv0, [0.3, 0.25, 0.7, 0.5]);
      console.log(`  Mars's dust devils: the sky over the horizon ${dd.toFixed(3)} / 255 apart`);
      expect(dd).toBeGreaterThan(0.05);
      // (Jupiter from 5 000 km in its late afternoon, 22° S: the towers, with and without)
      const jup = `time: ${T0 + 49.7 + 0.235 * TURN}, target: "jupiter", fov: 58, pose: { body: "jupiter", altKm: 5000, phase: 76, at: [-22, 0], look: "jupiter" }`;
      const j1 = await shot("jupiter-towers", "Jupiter: from orbit", jup);
      const j0 = await shot("jupiter-towers-off", "Jupiter: from orbit", jup, 2048);
      const dj = await diff(j1, j0);
      console.log(`  Jupiter's towers: ${dj.toFixed(3)} / 255 apart`);
      expect(dj).toBeGreaterThan(0.02);
      expect(await app.js<number>(`__bh.renderer.gpuErrors ?? 0`)).toBe(0);
    } finally {
      app.close();
    }
  },
  900_000,
);
