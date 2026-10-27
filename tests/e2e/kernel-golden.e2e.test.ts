import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// A shader change that must not change a pixel (docs/PLAN-LEAN-TRACER-KERNELS.md P9: the tracer's code restructured for
// fewer inlined copies — a loop where calls were written out —, the same arithmetic): the reference scenes rendered
// offline at a fixed clock, KG=record before the change (the PNGs kept in $KG_DIR), KG=compare after it — the same build
// otherwise, the same machine. At most a few values off by more than a level (the GPU compiler may order a few operations
// differently); counted and printed.
// (Miller is not in the list: two loads of its saved state do not render the same — ~14k values off with the same code.)
// Duration: ~1 min a scene.
// Done when: every scene is recorded or compared.

const DIR = process.env.KG_DIR ?? "remote-results/kernel-golden";
const MODE = process.env.KG ?? "compare";
const SCENES = (
  process.env.SCENES ??
  "Kerr a=0.94, near edge-on|Interstellar: wormhole to Gargantua|Earth: full Moon rising over the Andes|Mars: the blue sunset|Moon: an afternoon on the plains"
).split("|");
const OPTIONS = `{ width: 192, height: 120, spp: 4, tolerance: 1e-3, eps: 0.1, maxSteps: 4000, noiseThreshold: 0, minSpp: 4, shutter: 0, budgetMs: 40 }`;
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

describe.skipIf(!E2E)(`the tracer's restructured code draws the same images (${MODE})`, () => {
  afterAll(() => stopServer());
  for (const scene of SCENES)
    test(scene, async () => {
      mkdirSync(DIR, { recursive: true });
      const app = await App.boot({ hash: `scene=${encodeURIComponent(scene)}`, width: 640, height: 400 });
      try {
        // (every map in — the Earth's, a planet's finer one streaming in: a render before it drew a coarser world)
        await app.waitFor("__bh.renderer.earthSettled", 180_000).catch(() => {});
        await app.waitFor("!__bh.renderer.hdLoading", 180_000).catch(() => {});
        await Bun.sleep(3000);
        await app.waitFor("!__bh.renderer.hdLoading", 180_000).catch(() => {});
        // (the clock and the whole state — the camera, a craft settling on the ground — as recorded, kept beside the image
        // and loaded again to compare: two launches of a scene do not stand at the same place; a preset's stored time can
        // be night, a black image)
        const state = `${DIR}/${slug(scene)}.json`;
        let T: number;
        if (MODE === "record") {
          const s = await app.js<{ T: number; save: string }>(
            `(__bh.freeze(true), { T: __bh.time(), save: JSON.stringify(__bh.game.snapshot("golden")) })`,
          );
          T = s.T;
          writeFileSync(state, JSON.stringify(s));
        } else {
          const s = JSON.parse(readFileSync(state, "utf8")) as { T: number; save: string };
          T = s.T;
          await app.js(`(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(s.save)}, false), __bh.freeze(true), true)`);
          await app.waitFor("__bh.renderer.earthSettled", 180_000).catch(() => {});
          await app.waitFor("!__bh.renderer.hdLoading", 180_000).catch(() => {});
          await Bun.sleep(3000);
          await app.waitFor("!__bh.renderer.hdLoading", 180_000).catch(() => {});
        }
        await app.js(`(async () => {
          __bh.freeze(true);
          const r = __bh.renderer, T = ${T};
          const k = r.featureKey, t0 = performance.now();
          while (!r.variants.get(k)?.q && performance.now() - t0 < 300000) { r.traceVariant("q", k); await new Promise((q) => setTimeout(q, 200)); }
          r.startOffline(__bh.settings, T, ${OPTIONS});
          return 1; })()`);
        await app.waitFor("__bh.renderer.offlineState?.done || __bh.renderer.offlineState?.error", 600_000);
        const b64 = await app.js<string>(`(async () => {
          const blob = await __bh.renderer.exportPNG(__bh.settings);
          const u = new Uint8Array(await blob.arrayBuffer());
          let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
          return btoa(s); })()`);
        const bytes = new Uint8Array(Buffer.from(b64, "base64"));
        const file = `${DIR}/${slug(scene)}.png`;
        const b = readPng(bytes);
        const mean = b.data.reduce((x, v) => x + v, 0) / b.data.length;
        if (MODE === "record") {
          writeFileSync(file, bytes);
          console.log(`  ${scene}: recorded, mean level ${mean.toFixed(1)}`);
          expect(mean).toBeGreaterThan(1);
          return;
        }
        writeFileSync(`${DIR}/${slug(scene)}.new.png`, bytes);
        const a = readPng(new Uint8Array(readFileSync(file)));
        let off = 0;
        let worst = 0;
        for (let i = 0; i < a.data.length; i++) {
          const d = Math.abs(a.data[i]! - b.data[i]!);
          if (d > 1) off++;
          worst = Math.max(worst, d);
        }
        console.log(`  ${scene}: ${off} values off by more than 1 of ${a.data.length}, the worst ${worst}`);
        expect(off / a.data.length).toBeLessThan(0.002);
      } finally {
        app.close();
      }
    }, 900_000);
});
