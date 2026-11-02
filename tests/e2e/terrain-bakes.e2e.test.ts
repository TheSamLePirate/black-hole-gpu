import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T4 — the relief cache's bakes (docs/PLAN-REFRACTION-HORIZONS.md): a low flight over Chamonix (the F-35 from its cockpit, the
// autopilot holding 450 m at 120 m/s, the tiles streaming in — the IGN's z 15 … 17 over France), the raster pipeline; the bakes
// counted by level and by cause (terrain-cache.ts stats: a window moved, or newer tiles), their GPU time, the frame time. Shots
// at the start and the end. Figures in remote-results/terrain-bakes/<tag>/ (TB_TAG, or the A/B's side and run).
// Duration: ~2 min (this Mac).
const SIDE = process.env.AB_SIDE ?? "",
  RUN = process.env.AB_RUN ?? "";
const TAG = process.env.TB_TAG ?? (SIDE ? `${SIDE}${RUN}` : "solo");
const OUT = `remote-results/terrain-bakes/${TAG}`;
const FLIGHT_S = Number(process.env.TB_FLIGHT_S ?? 20);
afterAll(stopServer);

test.skipIf(!E2E)(
  "the relief cache's bakes in a low flight over Chamonix: by level and cause, their cost",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const t0 = performance.now();
    const step = (what: string) => console.log(`  [${((performance.now() - t0) / 1000).toFixed(0)} s] ${what}`);
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    // (Chrome closed whatever happens — a failed expect, a timeout —: none left on the GPU)
    try {
      step("booted");
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      step("the F-35 in");
      const place = `__bh.game.flyAt(45.88, 6.80, 450, 60, 120); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.game.setDate("2026-07-10T09:00:00Z"); ${place} __bh.freeze(true); return 1; })()`);
      const tiles = await app.waitFor(`__bh.renderer.earthTiles.pending <= 2 && __bh.renderer.earthTiles.finest >= 14`, 60_000).then(
        () => true,
        () => false,
      );
      step(
        `tiles ${tiles ? "in" : "NOT in after 60 s"}: ${JSON.stringify(await app.js(`(() => { const t = __bh.renderer.earthTiles; return { pending: t.pending, finest: t.finest }; })()`))}`,
      );
      await app.js(`(() => { ${place} return 1; })()`);
      await app.settled(60_000);
      step("settled");
      await app.shot(`${OUT}/start.png`);
      const r = await app.js<
        Record<string, unknown>
      >(`(async () => { const R = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(1)));
        R.prof.enabled = true; R.prof.every = 2; R.prof.reset();
        const c = __bh.camera; __bh.freeze(false); if (c.jetModes.alt === null) c.jetToggle("ap");
        const s0 = R.terrainCacheStats, t0 = performance.now(); let n = 0; const ms = [];
        let last = performance.now();
        while (performance.now() - t0 < ${FLIGHT_S * 1000}) { await frame(); const now = performance.now(); ms.push(now - last); last = now; n++; }
        const s1 = R.terrainCacheStats, dt = (performance.now() - t0) / 1000;
        const p = R.prof.table(), pick = (re) => +p.filter((x) => re.test(x.label)).reduce((a, x) => a + x.ms, 0).toFixed(3);
        ms.sort((a, b) => a - b);
        const by = (k) => (s1[k] ? s1[k].map((v, i) => +((v - s0[k][i]) / dt).toFixed(2)) : null);
        const rate = (k) => (s1[k] === undefined ? null : +((s1[k] - s0[k]) / dt).toFixed(2));
        return { seconds: +dt.toFixed(1), frames: n, frameMs: +ms[Math.floor(n / 2)].toFixed(1), frameP95: +ms[Math.floor(0.95 * n)].toFixed(1),
          bakesPerS: +((s1.builds - s0.builds) / dt).toFixed(2), invalidationsPerS: +((s1.invalidations - s0.invalidations) / dt).toFixed(2),
          movedPerS: by("bakesMoved"), dirtyPerS: by("bakesDirty"), tileChangesPerS: { visible: rate("changesVisible"), hidden: rate("changesHidden") }, bakeMs: pick(/terrain surface cache/), gpuErrors: R.gpuErrors }; })()`);
      step("flown");
      await app.js(`(() => { __bh.freeze(true); return 1; })()`);
      await app.settled(30_000);
      await app.shot(`${OUT}/end.png`);
      console.log(`  ${TAG}: tiles in ${tiles}; ${JSON.stringify(r)}`);
      writeFileSync(`${OUT}/terrain-bakes.json`, JSON.stringify({ tiles, ...r }, null, 1));
      expect(r.gpuErrors).toBe(0);
    } finally {
      app.close();
    }
  },
  6 * 60_000,
);
