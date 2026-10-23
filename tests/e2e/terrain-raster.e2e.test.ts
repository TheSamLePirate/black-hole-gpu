// The experimental raster terrain pilot (docs/progress/terrestrial-aaa/P1b.md) on a GPU: it compiles, draws its patch
// over Kennedy's oblique runway (heading 150°) in the three inspector views, reports a conforming mesh, resizes, releases
// its targets when switched off — and what the `difference` view shows is measured from the captured pixels (its colour
// scale inverted into metres), at three views and two cache levels. What the pilot adds to the frame is measured against
// the same frames without it. Captures: remote-results/terrain-raster-<view>-<pose>.png; terrain-raster.json.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

afterAll(stopServer);

const POSES = [
  { name: "nadir-900m", altKm: 0.9, off: [0, 0] },
  { name: "oblique-900m", altKm: 0.9, off: [0, 35] },
  { name: "oblique-3km", altKm: 3, off: [0, 55] },
];

const scene = (app: App, pose: (typeof POSES)[number], level: number, view = "off") =>
  app.js(`(() => {
  __bh.game.setDate("2021-06-21T16:00:00Z");
  __bh.presets["Raster pilot"] = {...__bh.presets["Earth: the Blue Marble"], animate:false, ship:false,
    time:__bh.sim.time, earthClouds:0, volumetricClouds:false, earthSurface:"off", earthScenery:"off",
    dynamicResolution:false, realtimeSubsampling:1, pixelRatio:1, temporalReprojection:true, fpsCap:0,
    earthTerrainCache:true, earthTerrainRasterLevel:${level}, earthTerrainRasterView:${JSON.stringify(view)},
    pose:{body:"earth", at:[28.6155,-80.6945], altKm:${pose.altKm}, look:"earth", off:${JSON.stringify(pose.off)}}};
  __bh.preset("Raster pilot");
  // (the inspector over the traced pipeline — its reference: the raster pipeline, the default, a preference no scene sets)
  __bh.settings.earthPipeline = "trace"; __bh.resize();
  return true;
})()`);

const frames = async (app: App, n: number) => {
  await app.waitFor("__bh.renderer.variantReady", 180_000);
  const warm = await app.js<number>("__bh.renderer.completedFrames");
  await app.waitFor(`__bh.renderer.completedFrames >= ${warm + n}`, 120_000);
};
const view = async (app: App, v: string) => {
  await app.js(`(() => { __bh.settings.earthTerrainRasterView=${JSON.stringify(v)}; __bh.touch(); return true; })()`);
  await frames(app, 30);
  if (v !== "off") {
    await app.waitFor(`__bh.renderer.terrainRasterStats.reason === "pilot" && __bh.renderer.terrainRasterStats.encodedFrames > 5`, 120_000);
    await frames(app, 20);
  }
};

/** The `difference` view's colour scale inverted: |error| [m] per pixel, below the toolbar. */
function differenceStats(path: string) {
  const p = readPng(new Uint8Array(require("node:fs").readFileSync(path)));
  const errors: number[] = [];
  let uncovered = 0;
  for (let y = 60; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * p.channels;
      const r = p.data[i]! / 255,
        g = p.data[i + 1]! / 255,
        b = p.data[i + 2]! / 255;
      // yellow (1,0.8,0): no reference depth; the patch absent (the normal frame) is anything else
      if (r > 0.9 && g > 0.7 && b < 0.2) {
        uncovered++;
        continue;
      }
      const red = Math.max(0, (r - 0.05) / 0.95),
        blue = Math.max(0, (b - 0.1) / 0.9);
      errors.push(101 ** Math.min(1, Math.max(red, blue)) - 1);
    }
  errors.sort((a, c) => a - c);
  const q = (f: number) => errors[Math.min(errors.length - 1, Math.floor(f * errors.length))] ?? 0;
  return { pixels: errors.length, noReference: uncovered, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) };
}

test.skipIf(!E2E)(
  "the raster terrain pilot compiles, draws, conforms, resizes, releases; its error and cost are measured",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540 });
    try {
      const report: Record<string, unknown> = { adapter: await app.js<{ vendor: string; architecture: string }>("__bh.renderer.adapter") };
      await app.js(
        `(() => { window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`,
      );
      const rows: unknown[] = [];
      for (const level of [2, 1]) {
        for (const pose of POSES) {
          await scene(app, pose, level);
          await view(app, "off");
          const costs: Record<string, number> = {};
          for (const v of ["off", "depth", "difference"]) {
            await view(app, v);
            await app.js(
              "(() => { __bh.game.perf(); __bh.renderer.prof.every = 1; __bh.renderer.prof.reset(); window.__f0 = __bh.renderer.completedFrames; return true; })()",
            );
            await app.waitFor("__bh.renderer.prof.frames >= 40", 120_000);
            const m = await app.js<{ gpu: number; ms: number[]; passes: Record<string, number> }>(
              `({ gpu: __bh.renderer.prof.frameMs, ms: __bh.renderer.frameTelemetry.durationsMs.slice(-Math.max(1, __bh.renderer.completedFrames - window.__f0)),
                 passes: Object.fromEntries(__bh.renderer.prof.table().filter((p) => /trace|terrain/.test(p.label)).map((p) => [p.label, p.ms])) })`,
            );
            for (const [label, ms] of Object.entries(m.passes)) costs[`${v}:${label}`] = ms;
            const sorted = [...m.ms].sort((a, b) => a - b);
            costs[v] = m.gpu;
            costs[`${v}Frame50`] = sorted[Math.floor(sorted.length / 2)] ?? 0;
            if (v === "difference") {
              const png = `remote-results/terrain-raster-difference-${pose.name}-L${level}.png`;
              await app.shot(png);
              const stats = await app.js<Record<string, unknown>>("__bh.renderer.terrainRasterStats");
              rows.push({ level, pose: pose.name, costs, error: differenceStats(png), stats });
            }
          }
          await app.shot(`remote-results/terrain-raster-off-${pose.name}-L${level}.png`).catch(() => {});
        }
      }
      report.rows = rows;
      await Bun.write("remote-results/terrain-raster.json", JSON.stringify(report, null, 2));
      for (const r of rows as { stats: Record<string, unknown> }[]) {
        expect(r.stats.error).toBeFalsy();
        expect(r.stats.compiled).toBe(true);
        expect(r.stats.reason).toBe("pilot");
        expect(r.stats.conforming).toBe(true);
      }
      // switching off releases the targets; a resize while on keeps at most the pair
      await app.js(`(() => { __bh.settings.earthTerrainRasterView="depth"; __bh.touch(); return true; })()`);
      await frames(app, 20);
      await app.js(`(() => { __bh.resize(); return true; })()`);
      await app.js(`(() => { __bh.settings.earthTerrainRasterView="off"; __bh.touch(); return true; })()`);
      await frames(app, 20);
      const off = await app.js<Record<string, number>>("__bh.renderer.terrainRasterStats");
      expect(off.targetBytes).toBe(0);
    } finally {
      await app.close();
    }
  },
  1_800_000,
);
