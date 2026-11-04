import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng } from "./lib/png";

// Q6 I6 A2 — the canopy's scratches (decision 40: on the glass itself — ship.wgsl canopyScratchLight —, off by default; set here
// by renderer.canopyScratches): in the Camera profile's cockpit view, the acrylic's polishing swirls lit where their tangent is
// across v + l — arcs round the Sun —, over a faint veil. The F-35's cockpit over Tarifa at 10:00 UTC, heading into the Sun's
// azimuth, the look raised towards it, frozen, the exposure settled: shot with the scratches off then on — the 8 × 8 blocks they
// brighten (by more than a level: the grain averaged out) counted, and how much brighter the image is round the Sun (its brightest tenth) than over the
// rest; the Neutral profile shot with them asked and not: none there.
// Output: remote-results/canopy-scratches/{off,on,neutral,neutral0}.png (CS_OUT).
// Done when: the four shots taken, timed (the GPU's frame over 3 s each) and compared, no GPU error.
// Duration: ~1.5 min (the tiles, four shots).
const OUT = process.env.CS_OUT ?? "remote-results/canopy-scratches";
afterAll(stopServer);

const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
const lum = (a: ReturnType<typeof png>, i: number) => 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;

test.skipIf(!E2E)(
  "Q6 I6 A2: the canopy's scratches glint round the Sun in the Camera profile's cockpit, nowhere in Neutral",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, traffic: false }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.flyAt(36.08, -5.6, 700, 100, 200);
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
      await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 60_000).catch(() => {});
      await Bun.sleep(800);
      await app.js(`(() => { __bh.camera.setLook(0, 38); return 1; })()`);
      await Bun.sleep(1500);
      await app.js(`(() => { __bh.freeze(true); document.body.classList.add("hide-ui"); return 1; })()`);
      await app.settled(60_000);
      const gpu: Record<string, number> = {};
      for (const [name, profile, k] of [
        ["off", "camera", 0],
        ["on", "camera", 1],
        ["neutral", "neutral", 1],
        ["neutral0", "neutral", 0],
      ] as const) {
        await app.js(
          `(() => { __bh.settings.lookProfile = "${profile}"; __bh.renderer.canopyScratches = ${k}; __bh.touch(); return 1; })()`,
        );
        await app.js(
          `new Promise((r) => { let n = 0; const f = () => { __bh.touch(); (++n >= 20 ? r(1) : requestAnimationFrame(f)); }; requestAnimationFrame(f); })`,
        );
        await app.exposureSettled();
        await app.shot(`${OUT}/${name}.png`);
        // (their cost: the GPU's frame over 3 s, the view still — the scratches drawn on the canopy's pixels)
        gpu[name] =
          await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          __bh.game.perf(); r.prof.enabled = true; const t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
          const p = __bh.game.perf(); r.prof.enabled = false; return +p.gpuFrameMs.toFixed(2); })()`);
      }
      const off = png(`${OUT}/off.png`),
        on = png(`${OUT}/on.png`);
      // (the brightest tenth of the off image — round the Sun — against the rest: how much the scratches add in each)
      // (on 8 × 8 blocks' means — the Camera profile's grain, new each frame, averaged out)
      const blocks = (a: ReturnType<typeof png>) => {
        const B = 8,
          bw = Math.floor(a.width / B),
          bh = Math.floor(a.height / B),
          m = new Float64Array(bw * bh);
        for (let y = 0; y < bh * B; y++)
          for (let x = 0; x < bw * B; x++)
            m[Math.floor(y / B) * bw + Math.floor(x / B)]! += lum(a, (y * a.width + x) * a.channels) / (B * B);
        return m;
      };
      const L = blocks(off),
        O = blocks(on);
      const cut = [...L].sort((a, b) => a - b)[Math.floor(L.length * 0.9)]!;
      let brightened = 0,
        addSun = 0,
        nSun = 0,
        addRest = 0,
        nRest = 0;
      for (let p = 0; p < L.length; p++) {
        const d = O[p]! - L[p]!;
        if (d > 1) brightened++;
        if (L[p]! >= cut) {
          addSun += d;
          nSun++;
        } else {
          addRest += d;
          nRest++;
        }
      }
      // (Neutral: the scratches asked but not drawn — the same image with them off)
      const N1 = blocks(png(`${OUT}/neutral.png`)),
        N0 = blocks(png(`${OUT}/neutral0.png`));
      let neutralBrightened = 0;
      for (let p = 0; p < N1.length; p++) if (N1[p]! - N0[p]! > 1) neutralBrightened++;
      const row = {
        brightened,
        neutralBrightened,
        gpuMs: gpu,
        addSun: +(addSun / Math.max(nSun, 1)).toFixed(2),
        addRest: +(addRest / Math.max(nRest, 1)).toFixed(2),
        look: await app.js<string>(`__bh.settings.lookProfile`),
        mount: await app.js<string>(`__bh.settings.shipMount`),
        gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`),
      };
      console.log(`  canopy scratches: ${JSON.stringify(row)}`);
      expect(row.brightened).toBeGreaterThan(50);
      expect(row.addSun).toBeGreaterThan(row.addRest);
      expect(row.neutralBrightened).toBeLessThan(30);
      expect(row.gpuErrors).toBe(0);
      await app.js(
        `(() => { __bh.settings.lookProfile = "auto"; __bh.renderer.canopyScratches = 1; __bh.freeze(false); document.body.classList.remove("hide-ui"); return 1; })()`,
      );
    } finally {
      await app.close();
    }
  },
  300_000,
);
