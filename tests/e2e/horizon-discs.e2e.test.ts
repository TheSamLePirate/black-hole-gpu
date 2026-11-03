import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { type Pixels, readPng, writePng } from "./lib/png";

// H1b + H2 — the Moon at the telescope from the Earth (docs/PLAN-REFRACTION-HORIZONS.md): the world looked at gets its
// relief alone (its measured heights, the coarse colour kept, the CPU's ground untouched), its horizon maps baked, and its
// disc (trace.wgsl ourSegment → horizonLight) shaded with the long shadows of the terminator.
// The first quarter over the Andes, the time frozen, an 0.8° field on the Moon, three images at the same framing:
//   A. before H1b: the view's looked-at list emptied (the relief released 3 s later) — the coarse disc;
//   B. H1b + H2: the relief loaded and the horizons baked — the relief's normals and the horizon's shadows;
//   C. the setting "horizonMaps" off: the relief, no horizon shadows.
// Measured: the relief's load and the bake's times, the longest frame gap during the load (the DEM decoded on the page's
// thread), the GPU time a frame (each frame drawn anew) in A, B, C, the pixels B darkens against C (the horizons') and
// against A, the CPU's ground (the Moon's tiles and their fallback untouched).
// Output: remote-results/horizon-discs/ — a.png, b.png, c.png, side.png (A | B | C | B against C), horizon-discs.json.
// Done when: the relief and the bake are in within 60 s and 90 s, no GPU error, the CPU's ground untouched, the horizons
// darken ≥ 0.05 % of the lit pixels (the slopes past the terminator the relief's normals lit: 0.13 % the first run), brighten
// < 0.2 %.
// Duration: ~2 min (the Earth's tiles round Aconcagua, the Moon's DEM and its horizons' bake ~35 s, 3 images, 3 × 60 frames timed).
const OUT = process.env.AB_OUT ?? "remote-results/horizon-discs";
afterAll(stopServer);

const SCENE = "Earth: first quarter over the Andes";
const VIEW = `__bh.presets["H2: the Moon at the telescope"] = { ...__bh.presets[${JSON.stringify(SCENE)}], fov: 0.8, earthClouds: 0 };
  __bh.game.preset("H2: the Moon at the telescope"); Object.assign(__bh.settings, { animate: false }); __bh.touch();`;

test.skipIf(!E2E)(
  "H1b + H2: the Moon at the telescope — its relief alone, its terminator's long shadows",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: `scene=${encodeURIComponent(SCENE)}` });
    const out: Record<string, unknown> = {};
    try {
      // A. the coarse disc: the looked-at list held empty (no relief wanted)
      await app.js(`(() => { const r = __bh.renderer; Object.defineProperty(r, "looked", { configurable: true, get: () => [], set: () => {} });
        ${VIEW} return 1; })()`);
      await app.settled();
      // (the raster keeps drawing — no "converged" phase —: its history settled after 60 frames done)
      const still = async (label: string) => {
        const t0 = Date.now();
        const ok = await app
          .js<boolean>(`(async () => { const r = __bh.renderer, f0 = r.completedFrames, t0 = performance.now();
            while (r.completedFrames - f0 < 60 && performance.now() - t0 < 20000) await new Promise((q) => requestAnimationFrame(q));
            return r.completedFrames - f0 >= 60; })()`)
          .catch(() => false);
        console.log(`  ${label}: ${ok ? "60 frames" : "NOT 60 frames"} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return ok;
      };
      const timed = () =>
        app.js<number>(`(async () => { const r = __bh.renderer;
          for (let i = 0; i < 70; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
          const d = [...r.completedDurations].slice(-60).sort((a, b) => a - b); return +d[30].toFixed(2); })()`);
      await app.waitFor(`__bh.renderer.hdMap.name === null`, 10_000).catch(() => console.warn("  a finer map still in for A"));
      out.aHd = await app.js(`__bh.renderer.hdMap.name`);
      out.aConverged = await still("A (coarse)");
      await app.shot(`${OUT}/a.png`);
      out.aMs = await timed();
      // B. the relief wanted again: its load timed, the frame gaps watched meanwhile
      const t0 = Date.now();
      await app.js(`(() => { const r = __bh.renderer; delete r.looked; r.looked = [];
        window.__gaps = { max: 0, last: performance.now(), on: true };
        const f = () => { const g = window.__gaps, n = performance.now(); g.max = Math.max(g.max, n - g.last); g.last = n; if (g.on) requestAnimationFrame(f); };
        requestAnimationFrame(f); __bh.touch(); return 1; })()`);
      const relief = await app.waitFor(`__bh.renderer.hdMap.name === "moon" && __bh.renderer.hdMap.mode === "relief"`, 60_000).then(
        () => true,
        () => false,
      );
      out.reliefS = +((Date.now() - t0) / 1000).toFixed(1);
      out.loadMaxGapMs = +(await app.js<number>(`(() => { window.__gaps.on = false; return window.__gaps.max; })()`)).toFixed(1);
      if (!relief)
        throw new Error(
          `the Moon's relief not in within 60 s: ${await app.js(`JSON.stringify({ hd: __bh.renderer.hdMap.name, mode: __bh.renderer.hdMap.mode, loading: __bh.renderer.hdLoadingName, looked: __bh.renderer.looked })`)}`,
        );
      const t1 = Date.now();
      const baked = await app.waitFor(`__bh.renderer.horizonRow[0] === 1`, 90_000).then(
        () => true,
        () => false,
      );
      out.bakeS = +((Date.now() - t1) / 1000).toFixed(1);
      out.bake = await app.js(
        `(() => { const s = __bh.renderer.horizonMaps.stats(); return { state: s.state, doneMs: s.doneMs, bands: s.bands, bytes: s.bytes }; })()`,
      );
      if (!baked) throw new Error(`the bake not in within 90 s: ${JSON.stringify(out.bake)}`);
      // (the CPU's ground: the Moon's tiles not set on, no fallback heights)
      out.cpuGround = await app.js(`(() => { const t = __bh.renderer.moonTiles; return { active: t.active, fallback: !!t.fallback }; })()`);
      out.hdGeneration = await app.js(`__bh.renderer.hdGeneration`);
      out.bConverged = await still("B (relief + horizons)");
      await app.shot(`${OUT}/b.png`);
      out.bMs = await timed();
      // C. the horizons off: the relief alone
      await app.js(`(() => { __bh.settings.horizonMaps = false; __bh.touch(); return 1; })()`);
      await app.waitFor(`__bh.renderer.horizonRow[0] === 0`, 10_000);
      out.cConverged = await still("C (relief, no horizons)");
      await app.shot(`${OUT}/c.png`);
      out.cMs = await timed();
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      if (out.gpuErrors) console.log(`  page errors: ${JSON.stringify(app.cdp.errors.slice(0, 5))}`);
    } finally {
      await app.close();
    }
    const load = async (n: string) => readPng(new Uint8Array(await Bun.file(`${OUT}/${n}.png`).arrayBuffer()));
    const [a, b, c] = [await load("a"), await load("b"), await load("c")];
    const { width: W, height: H } = b;
    const lum = (p: Pixels, i: number) =>
      0.2126 * p.data[i * p.channels]! + 0.7152 * p.data[i * p.channels + 1]! + 0.0722 * p.data[i * p.channels + 2]!;
    // (x darker or brighter than y, over y's lit pixels; the diff image: red darkened, blue brightened)
    const compare = (x: Pixels, y: Pixels) => {
      const img = new Uint8Array(W * H * 3);
      let lit = 0,
        darker = 0,
        brighter = 0;
      for (let i = 0; i < W * H; i++) {
        const p = lum(x, i),
          q = lum(y, i);
        const g = Math.round(0.35 * q);
        img.set([g, g, g], i * 3);
        if (q < 12) continue;
        lit++;
        if (p < 0.8 * q) {
          darker++;
          img.set([255, Math.round(0.4 * p), Math.round(0.4 * p)], i * 3);
        } else if (p > 1.25 * q + 3) {
          brighter++;
          img.set([40, 90, 255], i * 3);
        }
      }
      return {
        img,
        lit,
        darker,
        brighter,
        darkerShare: +(darker / Math.max(lit, 1)).toFixed(5),
        brighterShare: +(brighter / Math.max(lit, 1)).toFixed(5),
      };
    };
    const hz = compare(b, c);
    const all = compare(b, a);
    out.horizons = { ...hz, img: undefined };
    out.h1bAgainstCoarse = { ...all, img: undefined };
    // (side by side, each halved: A | B | C | B against C)
    const n = 4,
      w2 = W >> 1,
      h2 = H >> 1;
    const side = new Uint8Array(n * w2 * h2 * 3);
    const put = (src: Uint8Array, ch: number, k: number) => {
      for (let y = 0; y < h2; y++)
        for (let x = 0; x < w2; x++) {
          const s = (2 * y * W + 2 * x) * ch,
            d = (y * n * w2 + k * w2 + x) * 3;
          side[d] = src[s]!;
          side[d + 1] = src[s + 1]!;
          side[d + 2] = src[s + 2]!;
        }
    };
    put(a.data, a.channels, 0);
    put(b.data, b.channels, 1);
    put(c.data, c.channels, 2);
    put(hz.img, 3, 3);
    writeFileSync(`${OUT}/side.png`, writePng(n * w2, h2, side));
    writeFileSync(`${OUT}/diff-horizons.png`, writePng(W, H, hz.img));
    console.log(`  ${JSON.stringify(out)}`);
    writeFileSync(`${OUT}/horizon-discs.json`, JSON.stringify(out, null, 2));
    expect(out.gpuErrors).toBe(0);
    expect(out.cpuGround).toEqual({ active: false, fallback: false });
    expect(hz.darker / Math.max(hz.lit, 1)).toBeGreaterThanOrEqual(0.0005);
    expect(hz.brighter / Math.max(hz.lit, 1)).toBeLessThan(0.002);
  },
  420_000,
);
