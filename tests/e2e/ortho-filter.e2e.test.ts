import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS, EARTH_VIEWS, sceneryReady } from "./lib/plan-views";

// T9a — the IGN's orthophotos filtered by the hardware (docs/PLAN-REFRACTION-HORIZONS.md T9, contract C0-4; src/system/
// earth-tiles.ts orthoTexture, trace.wgsl orthoAt/orthoGrad): their own texture, mips by tile, sRGB decoded before the
// filtering, anisotropic to 16 — in place of the hand-made bilinear of 4 loads a tap, n taps along the footprint. Made to be
// run on both sides of an A/B (scripts/ab-commit.ts with AB_CMD=scripts/ab-e2e.ts: E2E_URL, AB_SIDE, AB_RUN).
// The plan's Paris view (450 m, a July morning, the F-35's cockpit, frozen), the orthophotos all in (none pending) and the
// scenery whole (its buildings — not the quick first scene before it):
//   1. ahead — the city to the horizon, the grazing ground where the anisotropic filter tells;
//   2. the ground 35° down — the orthophotos' near detail.
// Each: a screenshot, the raster material's and the frame's GPU time over 3 s (the profiler on, each frame drawn anew).
// Output: remote-results/ortho-filter/<side><run>-<view>.png, ortho-filter-<side><run>.json.
// OF_CHROME_PROFILE=<folder>: one Chrome profile kept across runs — its HTTP cache serving the same tiles once warmed (an A/B
// independent of the Géoplateforme's answers that day).
// Before each shot the exposure is brought to the meter's reading (app.exposureSettled: frozen, it held the loading's).
// Done when: the orthophotos in within 90 s, the scenery whole within 60 s (else said), both views measured, no GPU error.
// Duration: ~2.5 min a run (Paris's tiles, orthophotos and buildings, two views × 3 s timed).
const OUT = process.env.OF_OUT ?? "remote-results/ortho-filter";
const TAG = `${process.env.AB_SIDE ?? "X"}${process.env.AB_RUN ?? "0"}`;
afterAll(stopServer);

test.skipIf(!E2E)(
  "T9a: the orthophotos filtered by the hardware — Paris low, ahead and down, the material's time",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const v = EARTH_VIEWS.find((x) => x.name === "paris-low")!;
    const app = await App.boot({
      width: 1280,
      height: 800,
      hash: "scene=game:artemis",
      tiles: true,
      profile: process.env.OF_CHROME_PROFILE || undefined,
    });
    const out: Record<string, unknown> = { tag: TAG, view: v.what };
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = `__bh.game.flyAt(${v.at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.game.setDate(${JSON.stringify(v.date)}); ${place} __bh.freeze(true); return 1; })()`);
      const t0 = Date.now();
      const ok = await app
        .waitFor(
          `(() => { const t = __bh.renderer.earthTiles; return t.orthoFinest >= 17 && t.orthoPending === 0 && t.pending === 0; })()`,
          90_000,
        )
        .then(
          () => true,
          () => false,
        );
      out.tiles = await app.js(
        `(() => { const t = __bh.renderer.earthTiles; return { pending: t.pending, orthoPending: t.orthoPending, orthoFinest: t.orthoFinest }; })()`,
      );
      out.tilesS = +((Date.now() - t0) / 1000).toFixed(1);
      if (!ok) throw new Error(`the orthophotos not all in within 90 s: ${JSON.stringify(out.tiles)}`);
      // (the scenery whole — its buildings, its trees —: not the quick first scene — a reduced box — that comes before it; 60 s
      // at most, what came said)
      const t1 = Date.now();
      await sceneryReady(app, 60_000);
      await Bun.sleep(2000);
      out.scenery = await sceneryReady(app, 60_000);
      out.sceneryS = +((Date.now() - t1) / 1000).toFixed(1);
      console.log(`  ${TAG} scenery: ${JSON.stringify(out.scenery)} in ${out.sceneryS} s`);
      await app.js(`(() => { ${place} document.body.classList.add("hide-ui"); return 1; })()`);
      await app.settled();
      const settle = () =>
        app.js(
          `new Promise((r) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else r(1); }; f(); })`,
        );
      for (const [name, pitch] of [
        ["ahead", 0],
        ["down", -35],
      ] as const) {
        await app.js(`(() => { __bh.camera.setLook(0, ${pitch}); __bh.touch(); return 1; })()`);
        await settle();
        // (the exposure at the meter's reading: frozen, it held the one of the loading's frames — T8e)
        const gap = await app.exposureSettled();
        if (Math.abs(gap) >= 0.02) console.log(`  ${TAG} ${name}: the exposure ${gap.toFixed(3)} EV off its reading after 5 s`);
        await app.shot(`${OUT}/${TAG}-${name}.png`);
        out[name] =
          await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
          __bh.game.perf(); r.prof.enabled = true; const t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
          const p = __bh.game.perf(); r.prof.enabled = false;
          const pick = (re) => +p.gpu.filter((x) => re.test(x.pass)).reduce((a, x) => a + x.ms, 0).toFixed(2);
          return { frame: +p.gpuFrameMs.toFixed(1), lite: pick(/earth lite/) }; })()`);
        console.log(`  ${TAG} ${name}: ${JSON.stringify(out[name])}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      if (out.gpuErrors) console.log(`  page errors: ${JSON.stringify(app.cdp.errors.slice(0, 5))}`);
    } finally {
      await app.close();
    }
    writeFileSync(`${OUT}/ortho-filter-${TAG}.json`, JSON.stringify(out, null, 2));
    expect(out.gpuErrors).toBe(0);
  },
  300_000,
);
