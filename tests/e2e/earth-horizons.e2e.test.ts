import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { type Pixels, readPng, writePng } from "./lib/png";

// H5 — the Earth's horizons in 8 directions (docs/PLAN-REFRACTION-HORIZONS.md; system/earth-horizons.ts): the relief cache's
// levels 4–6 each carry their nodes' horizons, baked from the cache's heights, read by the raster's ground past the shadow
// cascades (T6). The F-35 in the Alps, no clouds, the raster pipeline, the time frozen; each view shot with the horizons read
// and without (renderer.liteSkip 1048576 — the same session, the same tiles, the exposure held at the meter's reading), and
// again without (the captures' own noise); the GPU's frame and the bake's band timed (the profiler on, 3 s each).
//   1. over the Valais at 3 000 m, half an hour before sunset, looking east-north-east (the Sun ~3° up behind);
//   2. over Annecy at 5 000 m, the Sun ~2° up behind, looking east to the Mont Blanc;
//   3. the Valais at noon (the Sun 60° up: nothing read).
// Done when: the three levels baked and faded in within 90 s, no GPU error; in a sunset view the horizons darken ≥ 0.5 % of the
// lit pixels; they brighten no more than twice the captures' noise (or 0.2 %); at noon they change < 0.05 %.
// Output: remote-results/earth-horizons/ — <view>-on.png, -off.png, -off2.png, -diff.png (red: darkened by the horizons, blue:
// brightened), earth-horizons.json. Duration: ~4 min (the tiles of two places, three views, 4 × 3 s timed).
const OUT = process.env.EH_OUT ?? "remote-results/earth-horizons";
afterAll(stopServer);
const VIEWS = [
  { name: "valais-sunset", at: [46.15, 7.05, 3000, 70, 120], date: "2026-07-10T18:55:00Z", low: true },
  { name: "annecy-sunset", at: [45.85, 6.15, 5000, 95, 120], date: "2026-07-10T19:05:00Z", low: true },
  { name: "valais-noon", at: [46.15, 7.05, 3000, 70, 120], date: "2026-07-10T11:30:00Z", low: false },
];
const lum = (p: Pixels, i: number) =>
  0.2126 * p.data[i * p.channels]! + 0.7152 * p.data[i * p.channels + 1]! + 0.0722 * p.data[i * p.channels + 2]!;
// (x against y over y's lit pixels between the banner and the panel: darker by 20 %, brighter by 25 %; a diff image — red
// darkened, blue brightened)
const compare = (x: Pixels, y: Pixels) => {
  const img = new Uint8Array(x.width * x.height * 3);
  let lit = 0,
    darker = 0,
    brighter = 0;
  for (let i = 0; i < x.width * x.height; i++) {
    const a = lum(x, i),
      b = lum(y, i);
    const g = Math.round(0.35 * b);
    img.set([g, g, g], i * 3);
    // (the landscape only: not the place's banner on top, nor the cockpit's panel below — their figures change)
    const row = Math.floor(i / x.width);
    if (b < 12 || row < 0.08 * x.height || row > 0.8 * x.height) continue;
    lit++;
    if (a < 0.8 * b) {
      darker++;
      img.set([255, Math.round(0.4 * a), Math.round(0.4 * a)], i * 3);
    } else if (a > 1.25 * b + 3) {
      brighter++;
      img.set([40, 90, 255], i * 3);
    }
  }
  return { img, lit, darker: darker / Math.max(lit, 1), brighter: brighter / Math.max(lit, 1) };
};

test.skipIf(!E2E)(
  "H5: the Earth's horizons — the far ranges' shadows at sunset, nothing brightened, nothing at noon",
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
          `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
        );
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        await app.js(`(() => { __bh.game.setDate(${JSON.stringify(v.date)}); ${place(v)} __bh.freeze(true); return 1; })()`);
        const tiles = await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 60_000).then(
          () => true,
          () => false,
        );
        if (!tiles) console.log(`  ${v.name}: tiles still pending after 60 s — measured all the same`);
        await app.js(`(() => { ${place(v)} document.body.classList.add("hide-ui"); __bh.renderer.liteSkip = 0; return 1; })()`);
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
        await app.waitFor(`__bh.renderer.meterAt > ${meterBefore} && __bh.renderer.meterSettled`, 15_000);
        const ev = await app.js<number>(
          `(() => { const r = __bh.renderer; const ev = r.autoExposureEV; window.__evHold = ev; const f = () => { if (window.__evHold == null) return; r.autoExposureEV = window.__evHold; requestAnimationFrame(f); }; requestAnimationFrame(f); return +r.ev(__bh.settings).toFixed(2); })()`,
        );
        const shots: Record<string, Pixels> = {};
        const cost: Record<string, unknown> = {};
        const evs: Record<string, number> = {};
        for (const [tag, skip] of [
          ["on", 0],
          ["off", 1048576],
          ["off2", 1048576],
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
        const c = compare(shots.on!, shots.off!),
          noise = compare(shots.off2!, shots.off!);
        writeFileSync(`${OUT}/${v.name}-diff.png`, writePng(shots.on!.width, shots.on!.height, c.img));
        const sun = await app.js<number>(
          `(() => { const r = __bh.renderer; return r.sunElevationDeg ? +r.sunElevationDeg().toFixed(2) : -99; })()`,
        );
        out[v.name] = {
          ready,
          ev,
          evs,
          sun,
          lit: c.lit,
          darker: +c.darker.toFixed(5),
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
      writeFileSync(`${OUT}/earth-horizons.json`, JSON.stringify(out, null, 1));
      app.close();
    }
    expect(out.gpuErrors).toBe(0);
    const sunset = VIEWS.filter((v) => v.low).map((v) => out[v.name] as { darker: number; brighter: number; noiseBrighter: number });
    expect(Math.max(...sunset.map((o) => o.darker))).toBeGreaterThanOrEqual(0.005);
    for (const v of VIEWS) {
      const o = out[v.name] as { darker: number; brighter: number; noiseBrighter: number };
      expect(o.brighter).toBeLessThanOrEqual(Math.max(0.002, 2 * o.noiseBrighter));
      if (!v.low) expect(o.darker).toBeLessThan(0.0005);
    }
  },
  10 * 60_000,
);
