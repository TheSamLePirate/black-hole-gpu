import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// The raster's companion kernels lean (docs/PLAN-LEAN-TRACER-KERNELS.md P4: NEAR_DETAIL off in the Earth-raster profile's
// main and discs — the near ground's sub-pixel detail out, the raster drawing it): the same raster views with the whole
// near ground in the traced kernels (renderer.leanMain = false) and without, against the run-to-run noise of the realtime
// view (the whole kernels twice). Poses: low over Kennedy, 3 km over the Alps (the far ground beyond the raster's rings
// traced), 12 km (the horizon's mountains), 60 km.
// RC_FLAG: the renderer's switches compared instead (comma-separated, each on for "lean", off for "whole") — otherUniverseOut,
// leanShade (the cuts after P10).
// Duration: ~4–8 min on kerr-mini (the kernels compiled twice).
// Done when: every pose's three captures are compared.

const POSES = [
  { name: "kennedy-900m", at: [28.6155, -80.6945], altKm: 0.9, off: [0, 35] },
  { name: "alps-3km", at: [45.9, 6.95], altKm: 3, off: [0, 82] },
  { name: "alps-12km", at: [45.9, 6.95], altKm: 12, off: [0, 86] },
  { name: "alps-60km", at: [45.9, 6.95], altKm: 60, off: [0, 75] },
  // (from orbit: no raster — the traced Earth, the other universe's hole out of it too with otherUniverseOut)
  { name: "orbit-400km", at: [45.9, 6.95], altKm: 400, off: [0, 70] },
];
const FLAGS = (process.env.RC_FLAG ?? "leanMain").split(",");
type Png = ReturnType<typeof readPng>;
function psnr(a: Png, b: Png) {
  let sq = 0;
  let n = 0;
  for (let y = 60; y < a.height; y++)
    for (let x = 0; x < a.width; x++)
      for (let c = 0; c < 3; c++) {
        const i = (y * a.width + x) * a.channels + c;
        const d = a.data[i]! - b.data[i]!;
        sq += d * d;
        n++;
      }
  return +(10 * Math.log10((255 * 255) / Math.max(sq / n, 1e-9))).toFixed(2);
}

describe.skipIf(!E2E)("the raster's lean companion kernels draw the same image", () => {
  let app: App;
  const rows: unknown[] = [];
  afterAll(async () => {
    await Bun.write("remote-results/raster-companion.json", JSON.stringify(rows, null, 1));
    app?.close();
    stopServer();
  });
  test("each pose: lean against whole, and the noise", async () => {
    app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 1280, height: 800, tiles: true });
    await app.js(
      `(() => { window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`,
    );
    for (const pose of POSES) {
      const shots: Record<string, Png> = {};
      for (const [run, lean] of [
        ["whole", false],
        ["lean", true],
        ["whole2", false],
      ] as const) {
        await app.js(`(() => { ${FLAGS.map((f) => `__bh.renderer.${f} = ${lean};`).join(" ")} __bh.renderer.variants.clear(); __bh.game.setDate("2021-06-21T15:00:00Z");
          __bh.presets["RC"] = {...__bh.presets["Earth: the Blue Marble"], animate:false, ship:false, time:__bh.sim.time, earthClouds:0,
            volumetricClouds:false, dynamicResolution:false, realtimeSubsampling:4, pixelRatio:1, fpsCap:0, earthPipeline:"raster",
            pose:{body:"earth", at:${JSON.stringify(pose.at)}, altKm:${pose.altKm}, look:"earth", off:${JSON.stringify(pose.off)}}};
          __bh.preset("RC"); __bh.resize(); return true; })()`);
        await app.waitFor("__bh.renderer.variantReady && __bh.renderer.compilesPending === 0", 600_000);
        await app.js(`(async () => { const r = __bh.renderer, t0 = performance.now(); let calm = 0;
          while (performance.now() - t0 < 120000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
            if (calm && performance.now() - calm > 4000) break; await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`);
        const w = await app.js<number>("__bh.renderer.completedFrames");
        await app.waitFor(`__bh.renderer.completedFrames >= ${w + 60}`, 120_000);
        const f = `remote-results/rc-${pose.name}-${run}.png`;
        await app.shot(f);
        shots[run] = readPng(new Uint8Array(require("node:fs").readFileSync(f)));
      }
      const noise = psnr(shots.whole!, shots.whole2!);
      const lean = Math.min(psnr(shots.lean!, shots.whole!), psnr(shots.lean!, shots.whole2!));
      const raster = await app.js<boolean>("__bh.renderer.rasterLiteActive");
      console.log(`  ${pose.name}: lean vs whole ${lean} dB, whole vs whole ${noise} dB${raster ? "" : " (raster not drawing)"}`);
      rows.push({ pose: pose.name, lean, noise, raster });
      // (within the noise of the realtime view, give or take)
      expect(lean).toBeGreaterThan(noise - 3);
    }
  }, 3_600_000);
});
