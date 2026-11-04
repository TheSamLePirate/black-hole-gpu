import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { type Pixels, readPng, writePng } from "./lib/png";

// H5, the rest — the horizons' shadows against the tracer's (docs/progress/refraction-horizons/H5.md "Reste : la justesse"): the
// raster's relief shadows — the cascades (T6), and past them the horizons (H5) — against the traced ground's own march along the
// Sun (earthTerrainShadow, out to ~50 km). Each pipeline against itself with its shadows off, the same view, the time frozen, the
// exposure held: the raster with all (liteSkip 0), without H5 (1048576), without any relief shadow (4); the traced with its
// shadows (refined) and without (renderer.tune TUNE_GSKIP 2). Each shadow mask: the pixels darker than their shadowless image by
// 20 %. Measured: the masks' agreement (IoU) with and without H5; H5's own pixels — the raster's with it, not without — inside the
// traced shadow (its precision); the traced shadow the raster misses.
//   valais-sunset: the Valais at 3 000 m, half an hour before sunset; annecy-sunset: Annecy at 5 000 m, the Sun ~2° up.
// Output: remote-results/earth-horizons-truth/ — <view>-{rall,rnoh5,rnone,tall,tnone}.png, <view>-masks.png (green both, red the
// raster alone, blue the traced alone, yellow H5's own), truth.json (EHT_OUT).
// Done when: both views' five shots taken and compared (the horizons baked 90 s at most, the traced image refined 60 s at most,
// what is missing said), no GPU error.
// Duration: ~5 min (two places, the tracer's specialisations).
const OUT = process.env.EHT_OUT ?? "remote-results/earth-horizons-truth";
afterAll(stopServer);
const VIEWS = [
  { name: "valais-sunset", at: [46.15, 7.05, 3000, 70, 120], date: "2026-07-10T18:55:00Z" },
  { name: "annecy-sunset", at: [45.85, 6.15, 5000, 95, 120], date: "2026-07-10T19:05:00Z" },
];
const lum = (p: Pixels, i: number) =>
  0.2126 * p.data[i * p.channels]! + 0.7152 * p.data[i * p.channels + 1]! + 0.0722 * p.data[i * p.channels + 2]!;
/** the shadow mask: x darker than its shadowless y by 20 %, over y's lit landscape (not the banner, nor the cockpit's panel) */
const mask = (x: Pixels, y: Pixels) => {
  const m = new Uint8Array(x.width * x.height);
  for (let i = 0; i < m.length; i++) {
    const row = Math.floor(i / x.width);
    const b = lum(y, i);
    if (b < 12 || row < 0.08 * x.height || row > 0.8 * x.height) {
      m[i] = 2;
      continue;
    }
    m[i] = lum(x, i) < 0.8 * b ? 1 : 0;
  }
  return m;
};

test.skipIf(!E2E)(
  "H5: the raster's horizons' shadows against the traced ground's march",
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
    // (the exposure held at the meter's reading: frame by frame)
    const holdEv = () =>
      app.js<number>(
        `(() => { const r = __bh.renderer; const ev = r.autoExposureEV; window.__evHold = ev; const f = () => { if (window.__evHold == null) return; r.autoExposureEV = window.__evHold; requestAnimationFrame(f); }; requestAnimationFrame(f); return +r.ev(__bh.settings).toFixed(2); })()`,
      );
    const out: Record<string, unknown> = {};
    try {
      for (const v of VIEWS) {
        await app.load("scene=game:artemis");
        await app.js(
          `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", earthPipeline: "raster" }); return 1; })()`,
        );
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        await app.js(`(() => { __bh.game.setDate(${JSON.stringify(v.date)}); ${place(v)} __bh.freeze(true); return 1; })()`);
        if (
          !(await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 60_000).then(
            () => true,
            () => false,
          ))
        )
          console.log(`  ${v.name}: tiles still pending after 60 s — measured all the same`);
        await app.js(`(() => { ${place(v)} document.body.classList.add("hide-ui"); __bh.renderer.liteSkip = 0; return 1; })()`);
        const baked = await app
          .waitFor(
            `(() => { const h = __bh.renderer.earthHorizons; return !!h && h.stats().levels.every((l) => l.weight === 1); })()`,
            90_000,
          )
          .then(
            () => true,
            () => false,
          );
        if (!baked) console.log(`  ${v.name}: the horizons not all baked within 90 s — measured all the same`);
        await app.settled();
        await settle(60);
        const meterBefore = await app.js<number>(`__bh.renderer.meterAt`);
        await app.waitFor(`__bh.renderer.meterAt > ${meterBefore} && __bh.renderer.meterSettled`, 15_000).catch(() => {});
        const evR = await holdEv();
        const s: Record<string, Pixels> = {};
        for (const [tag, skip] of [
          ["rall", 0],
          ["rnoh5", 1048576],
          ["rnone", 4],
        ] as const) {
          await app.js(`(() => { __bh.renderer.liteSkip = ${skip}; __bh.touch(); return 1; })()`);
          await settle(60);
          s[tag] = await grab(`${OUT}/${v.name}-${tag}.png`);
        }
        // (the traced ground: its own march; refined, the time frozen — its exposure held anew)
        await app.js(
          `(() => { window.__evHold = null; __bh.renderer.liteSkip = 0; __bh.settings.earthPipeline = "trace"; __bh.touch(); return 1; })()`,
        );
        await app.settled(120_000);
        const tracePhase = async () => {
          let ok = false;
          for (let i = 0; i < 120 && !ok; i++) {
            await Bun.sleep(500);
            ok = await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`);
          }
          return ok;
        };
        const conv: Record<string, boolean> = {};
        conv.tall = await tracePhase();
        const evT = await holdEv();
        s.tall = await grab(`${OUT}/${v.name}-tall.png`);
        await app.js(`(() => { __bh.renderer.tune = { TUNE_GSKIP: 2 }; __bh.touch(); return 1; })()`);
        await app.settled(120_000);
        conv.tnone = await tracePhase();
        s.tnone = await grab(`${OUT}/${v.name}-tnone.png`);
        await app.js(`(() => { window.__evHold = null; __bh.renderer.tune = {}; __bh.settings.earthPipeline = "raster"; return 1; })()`);
        // (the masks and their agreement)
        const mAll = mask(s.rall!, s.rnone!),
          mNo = mask(s.rnoh5!, s.rnone!),
          mT = mask(s.tall!, s.tnone!);
        let iA = 0,
          uA = 0,
          iN = 0,
          uN = 0,
          h5 = 0,
          h5in = 0,
          tr = 0,
          trMiss = 0,
          n = 0;
        const W = s.rall!.width,
          H = s.rall!.height;
        const img = new Uint8Array(W * H * 3);
        for (let i = 0; i < W * H; i++) {
          const g = Math.round(0.3 * lum(s.rnone!, i));
          img.set([g, g, g], i * 3);
          if (mAll[i] === 2 || mT[i] === 2) continue;
          n++;
          const a = mAll[i] === 1,
            b = mNo[i] === 1,
            t = mT[i] === 1;
          if (a && t) iA++;
          if (a || t) uA++;
          if (b && t) iN++;
          if (b || t) uN++;
          if (t) {
            tr++;
            if (!a) trMiss++;
          }
          if (a && !b) {
            h5++;
            if (t) h5in++;
            img.set([255, 220, 40], i * 3);
          } else if (a && t) img.set([60, 200, 90], i * 3);
          else if (a) img.set([230, 60, 60], i * 3);
          else if (t) img.set([60, 110, 255], i * 3);
        }
        writeFileSync(`${OUT}/${v.name}-masks.png`, writePng(W, H, img));
        out[v.name] = {
          pixels: n,
          evR,
          evT,
          tracedConverged: conv,
          iouWithH5: +(iA / Math.max(uA, 1)).toFixed(4),
          iouWithoutH5: +(iN / Math.max(uN, 1)).toFixed(4),
          h5Pixels: h5,
          h5Precision: +(h5in / Math.max(h5, 1)).toFixed(4),
          tracedShadow: tr,
          tracedMissed: +(trMiss / Math.max(tr, 1)).toFixed(4),
          pipeline: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
        };
        console.log(`  ${v.name}: ${JSON.stringify(out[v.name])}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      writeFileSync(`${OUT}/truth.json`, JSON.stringify(out, null, 1));
      app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  15 * 60_000,
);
