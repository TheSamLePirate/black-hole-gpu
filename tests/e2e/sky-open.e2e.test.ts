import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { EARTH_SKY_OPEN } from "../../src/system/earth-horizons";
import { type Pixels, readPng, writePng } from "./lib/png";

// Q4 L2b — the valleys' sky (trace.wgsl earthSkyOpen; system/earth-horizons.ts): the share of the sky's light a ground point
// still receives over its relief, from H5's horizons in 8 directions weighed by the clear sky's radiance in each. The F-35, no
// clouds, the raster pipeline, the time frozen; each view shot with the sky's share read and without (renderer.liteSkip
// 4194304 — the same session, the same tiles, the exposure held at the meter's reading), and again without (the noise); the
// raster's material timed (3 s each).
//   1. over the Valais at 3 000 m at noon, looking down the Rhône's valley; 2. the same at 17:30 UTC (the valley's floor in the
//   relief's shade: lit by the sky alone); 3. La Mancha's plain at 1 500 m (nothing to hide the sky: nothing changes).
// (Needs EARTH_SKY_OPEN in system/earth-horizons.ts — compiled out by default — and renderer.skyOpen, set here.) Done when: the three levels baked within 90 s, no GPU error; the valleys' darkening and
// its cost reported; nothing brightened beyond twice the noise (or 0.2 %); the plain darker by 3 % < 1 %.
// Output: remote-results/sky-open/ — <view>-on.png, -off.png, -off2.png, -diff.png, sky-open.json (SO_OUT).
// Duration: ~4 min (two places' tiles, three views, 2 × 3 s timed each).
const OUT = process.env.SO_OUT ?? "remote-results/sky-open";
afterAll(stopServer);
const VIEWS = [
  { name: "valais-noon", at: [46.2, 7.2, 3000, 60, 120], date: "2026-07-10T11:30:00Z", low: true },
  { name: "valais-late", at: [46.2, 7.2, 3000, 60, 120], date: "2026-07-10T17:30:00Z", low: true },
  { name: "mancha-plain", at: [39.42, -3.05, 1500, 90, 120], date: "2026-07-10T11:30:00Z", low: false },
];
const lum = (p: Pixels, i: number) =>
  0.2126 * p.data[i * p.channels]! + 0.7152 * p.data[i * p.channels + 1]! + 0.0722 * p.data[i * p.channels + 2]!;
// (x against y over y's lit pixels between the banner and the panel: darker by 20 %, brighter by 25 %; a diff image — red
// darkened, blue brightened)
const compare = (x: Pixels, y: Pixels) => {
  const img = new Uint8Array(x.width * x.height * 3);
  let lit = 0,
    darker = 0,
    brighter = 0,
    slight = 0,
    sa = 0,
    sb = 0;
  for (let i = 0; i < x.width * x.height; i++) {
    const a = lum(x, i),
      b = lum(y, i);
    const g = Math.round(0.35 * b);
    img.set([g, g, g], i * 3);
    // (the landscape only: not the place's banner on top, nor the cockpit's panel below — their figures change)
    const row = Math.floor(i / x.width);
    if (b < 12 || row < 0.08 * x.height || row > 0.8 * x.height) continue;
    lit++;
    sa += a;
    sb += b;
    if (a < 0.97 * b - 1) slight++;
    if (a < 0.8 * b) {
      darker++;
      img.set([255, Math.round(0.4 * a), Math.round(0.4 * a)], i * 3);
    } else if (a > 1.25 * b + 3) {
      brighter++;
      img.set([40, 90, 255], i * 3);
    }
  }
  return {
    img,
    lit,
    darker: darker / Math.max(lit, 1),
    brighter: brighter / Math.max(lit, 1),
    slight: slight / Math.max(lit, 1),
    ratio: sa / Math.max(sb, 1),
  };
};

// (compiled out by default — EARTH_SKY_OPEN, the kernels' budgets: skipped then)
test.skipIf(!E2E || !EARTH_SKY_OPEN)(
  "Q4 L2b: the valleys' sky hidden by their relief — darker valleys, nothing brightened, the plain unchanged",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const settle = (n = 60) =>
      app.js(
        `new Promise((r) => { let k = 0; const f = () => { __bh.touch(); if (++k < ${n}) requestAnimationFrame(f); else r(1); }; f(); })`,
      );
    const grab = async (file: string) => {
      const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      const b = Buffer.from(data, "base64");
      await Bun.write(file, b);
      return readPng(b);
    };
    const place = (v: (typeof VIEWS)[number]) =>
      `__bh.game.flyAt(${v.at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
    const out: Record<string, unknown> = {};
    try {
      for (const v of VIEWS) {
        await app.load("scene=game:artemis");
        await app.js(
          `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral" }); return 1; })()`,
        );
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        await app.js(`(() => { __bh.game.setDate(${JSON.stringify(v.date)}); ${place(v)} __bh.freeze(true); return 1; })()`);
        const tiles = await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 60_000).then(
          () => true,
          () => false,
        );
        if (!tiles) console.log(`  ${v.name}: tiles still pending after 60 s — measured all the same`);
        await app.js(
          `(() => { ${place(v)} document.body.classList.add("hide-ui"); __bh.renderer.liteSkip = 0; __bh.renderer.skyOpen = true; return 1; })()`,
        );
        const t0 = Date.now();
        // (the three levels' horizons baked and faded in)
        const baked = await app
          .waitFor(
            `(() => { const h = __bh.renderer.earthHorizons; return !!h && h.stats().levels.every((l) => l.weight === 1); })()`,
            90_000,
          )
          .then(
            () => true,
            () => false,
          );
        const stats = await app.js(`__bh.renderer.earthHorizons ? __bh.renderer.earthHorizons.stats() : null`);
        if (!baked) throw new Error(`${v.name}: the horizons not baked within 90 s: ${JSON.stringify(stats)}`);
        const ready = +((Date.now() - t0) / 1000).toFixed(1);
        await app.settled();
        await settle(60);
        // (the exposure held at the meter's fresh reading, the horizons read — the auto exposure's own value, frame by frame:
        // turned off, the sky is drawn at its physical scale, not the image's — its stars out by day, H3's lesson)
        const meterBefore = await app.js<number>(`__bh.renderer.meterAt`);
        await app
          .waitFor(`__bh.renderer.meterAt > ${meterBefore} && __bh.renderer.meterSettled`, 15_000)
          .catch(() => console.log(`  ${v.name}: no new meter reading in 15 s — the exposure held as it is`));
        const ev = await app.js<number>(
          `(() => { const r = __bh.renderer; const ev = r.autoExposureEV; window.__evHold = ev; const f = () => { if (window.__evHold == null) return; r.autoExposureEV = window.__evHold; requestAnimationFrame(f); }; requestAnimationFrame(f); return +r.ev(__bh.settings).toFixed(2); })()`,
        );
        const shots: Record<string, Pixels> = {};
        const cost: Record<string, unknown> = {};
        const evs: Record<string, number> = {};
        for (const [tag, skip] of [
          // (off, on, off again: the scene's own drift — the imagery, the exposure settling — on both sides of the measure; a plain
          // brightened 4 % between two identical shots, an "on" taken first read as a darkening)
          ["off", 4194304],
          ["on", 0],
          ["off2", 4194304],
        ] as const) {
          await app.js(`(() => { __bh.renderer.liteSkip = ${skip}; __bh.touch(); return 1; })()`);
          await settle(60);
          shots[tag] = await grab(`${OUT}/${v.name}-${tag}.png`);
          evs[tag] = await app.js<number>(`+__bh.renderer.ev(__bh.settings).toFixed(2)`);
          if (tag === "off2") continue;
          cost[tag] =
            await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
            __bh.game.perf(); r.prof.enabled = true; const t0 = performance.now();
            while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
            const p = __bh.game.perf(); r.prof.enabled = false;
            const pick = (re) => +p.gpu.filter((x) => re.test(x.pass)).reduce((a, x) => a + x.ms, 0).toFixed(2);
            return { frame: +p.gpuFrameMs.toFixed(1), lite: pick(/earth lite/), bake: pick(/earth horizons/) }; })()`);
        }
        await app.js(`(() => { __bh.renderer.liteSkip = 0; window.__evHold = null; return 1; })()`);
        // (on against the off nearer to it in brightness — the drift's — and the two offs against each other: the noise)
        const c0 = compare(shots.on!, shots.off!),
          c2 = compare(shots.on!, shots.off2!);
        const c = Math.abs(1 - c0.ratio) < Math.abs(1 - c2.ratio) ? c0 : c2,
          noise = compare(shots.off2!, shots.off!);
        writeFileSync(`${OUT}/${v.name}-diff.png`, writePng(shots.on!.width, shots.on!.height, c.img));
        const sun = await app.js<number>(`(() => +(__bh.camera.skyInfo?.()?.sun?.altDeg ?? -99).toFixed(2))()`);
        out[v.name] = {
          ready,
          ev,
          evs,
          sun,
          lit: c.lit,
          darker: +c.darker.toFixed(5),
          slight: +c.slight.toFixed(5),
          ratio: +c.ratio.toFixed(4),
          noiseSlight: +noise.slight.toFixed(5),
          noiseRatio: +noise.ratio.toFixed(4),
          brighter: +c.brighter.toFixed(5),
          noiseDarker: +noise.darker.toFixed(5),
          noiseBrighter: +noise.brighter.toFixed(5),
          cost,
          stats: await app.js(`__bh.renderer.earthHorizons.stats()`),
        };
        console.log(`  ${v.name}: ${JSON.stringify(out[v.name])}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      writeFileSync(`${OUT}/sky-open.json`, JSON.stringify(out, null, 1));
      app.close();
    }
    expect(out.gpuErrors).toBe(0);
    // (the valleys' darkening reported, not required: measured ~0.1 % of the light at the horizons' scale — Q4 L2b)
    for (const v of VIEWS) {
      const o = out[v.name] as { darker: number; brighter: number; noiseBrighter: number };
      expect(o.brighter).toBeLessThanOrEqual(Math.max(0.002, 2 * o.noiseBrighter));
      if (!v.low) expect((o as unknown as { slight: number }).slight).toBeLessThan(0.01);
    }
  },
  10 * 60_000,
);
