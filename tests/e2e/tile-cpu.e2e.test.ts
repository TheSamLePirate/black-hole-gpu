import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T8 — the tiles' work on the page's thread (docs/PLAN-REFRACTION-HORIZONS.md T8: "no long task of the main thread due to the
// tiles"): the F-35 low over Paris (450 m, 120 m/s, a July morning) on its autopilot for 25 s, its tiles streaming in —
// the relief, the imagery, the orthophotos —, the counters of src/system/earth-tiles.ts TILE_CPU reset at the start: the
// decoding (bitmaps drawn and read back, Terrarium's heights), the colours (EOX's, the orthophotos' fits, the lights), the
// writes (put); and the page's long tasks (PerformanceObserver "longtask", > 50 ms) over the same 25 s.
// Output: remote-results/tile-cpu/tile-cpu-<side><run>.json (AB_SIDE, AB_RUN: an A/B through scripts/ab-e2e.ts), a shot at
// the end.
// Done when: the flight flown 25 s, the counters and the long tasks read, no GPU error.
// Duration: ~1.5 min (the airfield's start, 25 s of flight).
const OUT = process.env.TC_OUT ?? "remote-results/tile-cpu";
const TAG = `${process.env.AB_SIDE ?? "X"}${process.env.AB_RUN ?? "0"}`;
afterAll(stopServer);

test.skipIf(!E2E)(
  "T8: the tiles' work on the page's thread in a low flight over Paris — its total, its longest piece, the long tasks",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { tag: TAG };
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate("2026-07-10T08:30:00Z"); __bh.game.flyAt(48.80, 2.20, 450, 60, 120);
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
      await app.settled();
      await app.js(`(() => { const c = __bh.camera;
        if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        if (c.jetModes.spd !== null) c.jetModes.spd = 120; return 1; })()`);
      // (the counters from now, the long tasks over the flight)
      out.flight = await app.js(`(async () => {
        const T = __bh.renderer.earthTiles.cpu ?? {}; // (none before T8a: the long tasks alone)
        for (const k of Object.keys(T)) Object.assign(T[k], { ms: 0, max: 0, n: 0 });
        const long = [];
        const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration); });
        obs.observe({ entryTypes: ["longtask"] });
        const r = __bh.renderer, f0 = r.completedFrames, t0 = performance.now(), loaded0 = r.earthTiles.loaded;
        while (performance.now() - t0 < 25000) { __bh.touch(); await new Promise((q) => setTimeout(q, 250)); }
        obs.disconnect();
        const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ms: +v.ms.toFixed(1), max: +v.max.toFixed(2), n: v.n }]));
        long.sort((a, b) => b - a);
        return { s: +((performance.now() - t0) / 1000).toFixed(1), frames: r.completedFrames - f0, tilesLoaded: r.earthTiles.loaded - loaded0,
          pending: r.earthTiles.pending, orthoPending: r.earthTiles.orthoPending, cpu: round(T),
          longTasks: { n: long.length, totalMs: Math.round(long.reduce((a, b) => a + b, 0)), worst: long.slice(0, 5).map((x) => Math.round(x)) } }; })()`);
      console.log(`  ${TAG} flight: ${JSON.stringify(out.flight)}`);
      await app.shot(`${OUT}/${TAG}-end.png`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await app.close();
    }
    writeFileSync(`${OUT}/tile-cpu-${TAG}.json`, JSON.stringify(out, null, 2));
    expect(out.gpuErrors).toBe(0);
  },
  240_000,
);
