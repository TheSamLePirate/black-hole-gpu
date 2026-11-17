import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-8b lot (1) — the forest's cells prepared in the game (src/system/forest-cells.ts kerr-forest-v1, forest-prep.ts,
// forest-cover.ts, forest-exclusions.ts; the cell worker's forest path — cell-worker.ts — and its pool, cell-workers.ts forestPool,
// `__bh.sys.forests`): four z 15 cells round Toulon — its centre (16923/12025: a town, few trees) and three on Mont Faron's wooded slope
// (16924/12022, 16923/12022, 16924/12023) —, their sources on the e2e's Earth data on disk (the land cover's cells, the BD TOPO's tiles,
// OpenMapTiles'), asked of the forests' pool from the boot's place; each handed with its candidates, the wooded ones more than the town's;
// no image over 100 ms while they were prepared (the workers' threads); the page loaded again, all four from the prepared cache. Nothing
// is drawn from them yet (lot 2, the render session's).
// Done when: four forest cells handed with their candidates — Mont Faron's more than the town's —, no image over 100 ms, all four from
// the cache after the reload.
// Duration: ~1 min.

afterAll(stopServer);
const CELLS = [
  [16923, 12025],
  [16924, 12022],
  [16923, 12022],
  [16924, 12023],
].map(([x, y], d) => ({ x: x!, y: y!, priority: 0, d }));

describe.skipIf(!E2E)("PLAN-J8 J8-8b: the forest cells prepared in the game", () => {
  test("Toulon and Mont Faron: four forest cells handed with their candidates, no image over 100 ms; after a reload, all from the cache", async () => {
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.scenario("Toulon and Mont Faron · the forest cells prepared");
      await app.js(`(() => { window.__gap = { n: 0, max: 0, on: true }; let last = performance.now();
        const f = (t) => { const h = window.__gap; if (!h.on) return; const d = t - last; last = t; if (d > 100) h.n++; h.max = Math.max(h.max, d);
          requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`);
      const t0 = Date.now();
      await app.js(`(() => { __bh.sys.forests.clear(); __bh.sys.forests.want(${JSON.stringify(CELLS)}); return 1; })()`);
      await app.waitFor(`__bh.sys.forests.got().length >= ${CELLS.length}`, 90_000);
      const gap = await app.js<{ n: number; max: number }>(`(() => { window.__gap.on = false; return window.__gap; })()`);
      const s1 = await app.js<Record<string, number>>(`__bh.sys.forests.stats()`);
      const got = await app.js<{ key: string; bytes: number; candidates: number; ms: number }[]>(`__bh.sys.forests.got()`);
      console.log(
        `  cold: ${CELLS.length} cells in ${((Date.now() - t0) / 1000).toFixed(1)} s · longest image ${gap.max.toFixed(0)} ms · ${JSON.stringify(s1)}`,
      );
      for (const g of got) console.log(`    ${JSON.stringify(g)}`);
      expect(s1.failed).toBe(0);
      const by = Object.fromEntries(got.map((g) => [g.key, g]));
      const town = by["16923/12025"]!.candidates,
        faron = by["16924/12022"]!.candidates;
      expect(faron).toBeGreaterThan(1000);
      expect(faron).toBeGreaterThan(town);
      expect(gap.n).toBe(0);

      await app.scenario("Toulon and Mont Faron · the forest cells after a reload");
      await app.load("scene=game:artemis");
      await app.js(`(() => { __bh.sys.forests.clear(); __bh.sys.forests.want(${JSON.stringify(CELLS)}); return 1; })()`);
      await app.waitFor(`__bh.sys.forests.got().length >= ${CELLS.length}`, 20_000);
      const s2 = await app.js<{ cached: number; prepared: number }>(`__bh.sys.forests.stats()`);
      console.log(`  warm: ${JSON.stringify(s2)}`);
      expect(s2.cached).toBe(CELLS.length);
      expect(s2.prepared).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);
});
