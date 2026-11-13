import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The auroras' and the magnetosphere diagram's GPU cost (PLAN-AURORES-MAGNETOSPHERES AM2, AM3, AM7): at fixed views, each
// feature off then on, twice (ABAB, the drift averaged out), the GPU frame time's median over 24 readings 300 ms apart
// (game.perf gpuFrameMs), the render scale noted. Views: Tromsø at Kp 4 looking south; 400 km over Manitoba looking south at
// Kp 5; 7 000 km over Jupiter's night side at activity 5; the magnetosphere diagram from 400 000 km over the Earth. AC_OUT,
// AC_ONLY (the views whose name holds it), AC_FIXED=1 (the render scale held: dynamic resolution off).
// Output: remote-results/aurora-cost/cost.json, a shot of each view on. Done when: every view measured both ways, no GPU
// error. Duration: ~6 min warm (Jupiter's near kernel: ~200 s cold — docs/PROBLEMES-A-REGLER.md).
const OUT = process.env.AC_OUT ?? "remote-results/aurora-cost";
afterAll(stopServer);

test.skipIf(!E2E)(
  "the auroras' and the magnetosphere diagram's GPU cost, off against on",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const cost: Record<string, unknown> = {};
    let gpuErrors = -1;
    const settle = async () => {
      await Bun.sleep(2500);
      for (let k = 0; k < 60 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) {
        if (k % 6 === 0) console.log(`    compiling ${k * 5} s: ${JSON.stringify(await app.js(`__bh.renderer.compilingNow`))}`);
        await Bun.sleep(5000);
      }
      await Bun.sleep(3000);
    };
    const sample = async () => {
      const v: number[] = [];
      const sc: number[] = [];
      for (let k = 0; k < 24; k++) {
        await Bun.sleep(300);
        const p = await app.js<{ gpuFrameMs: number; renderScale: number }>(`__bh.game.perf({ gpu: true })`);
        v.push(p.gpuFrameMs);
        sc.push(p.renderScale);
      }
      v.sort((a, b) => a - b);
      return { ms: v[12]!, scale: sc.reduce((a, b) => a + b, 0) / sc.length };
    };
    const measure = async (name: string, place: string, on: string, off: string) => {
      // (AC_ONLY: the views whose name holds it)
      if (process.env.AC_ONLY && !name.includes(process.env.AC_ONLY)) return;
      // (AC_FIXED=1: the render scale held — dynamic resolution off — so that both sides are read at one scale: the orbit's and the
      // magnetosphere's sides came at 0.88 / 1.00 and 0.88 / 0.80, 13 Nov 2026)
      const fixed = process.env.AC_FIXED ? "__bh.settings.dynamicResolution = false;" : "";
      await app.js(`(() => { ${fixed} ${off}; ${place}; return 1; })()`);
      await settle();
      const runs: { off: number[]; on: number[]; scaleOff: number[]; scaleOn: number[] } = { off: [], on: [], scaleOff: [], scaleOn: [] };
      for (let r = 0; r < 2; r++) {
        await app.js(`(() => { ${off}; return 1; })()`);
        await settle();
        const a = await sample();
        runs.off.push(a.ms);
        runs.scaleOff.push(a.scale);
        await app.js(`(() => { ${on}; return 1; })()`);
        await settle();
        const b = await sample();
        runs.on.push(b.ms);
        runs.scaleOn.push(b.scale);
      }
      await app.shot(`${OUT}/${name}.png`);
      await app.js(`(() => { ${off}; return 1; })()`);
      const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      cost[name] = { ...runs, offMs: m(runs.off), onMs: m(runs.on), deltaMs: m(runs.on) - m(runs.off) };
      console.log(
        `  ${name}: off ${m(runs.off).toFixed(2)} ms, on ${m(runs.on).toFixed(2)} ms (scale ${m(runs.scaleOff).toFixed(2)} / ${m(runs.scaleOn).toFixed(2)})`,
      );
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.game.set("weather", "fair"); __bh.settings.auroraLive = false; return 1; })()`);
      await measure(
        "tromso-kp4",
        `__bh.game.setDate("2026-12-21T22:00:00Z"); __bh.viewAt(69.65, 18.96, { altM: 60 + __bh.sys.geoid(69.65, 18.96), heading: 180, pitch: 30, fov: 80 })`,
        `__bh.settings.aurora = 4`,
        `__bh.settings.aurora = 0`,
      );
      await measure(
        "orbit-south-kp5",
        `__bh.game.setDate("2026-12-21T07:00:00Z"); __bh.viewAt(58, -95, { altM: 400_000, heading: 180, pitch: -20, fov: 90 })`,
        `__bh.settings.aurora = 5`,
        `__bh.settings.aurora = 0`,
      );
      await measure(
        "magnetosphere-earth",
        `__bh.game.setDate("2026-12-21T12:00:00Z"); const ss = __bh.sys.subsolar("earth"); __bh.viewAt(20, ss[1] + 90, { body: "earth", altM: 400_000_000, heading: 0, pitch: -89, fov: 60 })`,
        `__bh.settings.magnetosphere = true`,
        `__bh.settings.magnetosphere = false`,
      );
      await measure(
        "jupiter-act5",
        `__bh.game.setDate("2026-12-21T10:02:00Z"); const ss = __bh.sys.subsolar("jupiter"); __bh.viewAt(45, ss[1] + 180, { body: "jupiter", altM: 7.15e6, heading: 0, pitch: -22, fov: 70 })`,
        `__bh.settings.aurora = 5`,
        `__bh.settings.aurora = 0`,
      );
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/cost.json`, JSON.stringify(cost, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  20 * 60_000,
);
