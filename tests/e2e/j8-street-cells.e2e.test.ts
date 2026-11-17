import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-L — the streets' cells prepared in the game (src/system/street-cells.ts, street-prep.ts; the cell worker's street path —
// cell-worker.ts — and its pool, cell-workers.ts streetPool, `__bh.sys.streets`): Toulon's centre, the four z 15 cells of the
// OpenMapTiles z 14 tile 8461/6012 (its data on the e2e's Earth data on disk: the roads' tile and the BD TOPO's four tiles), asked of the
// streets' pool from the boot's place (no placing: nothing else loaded for it); each handed (its lamps, segments and junctions counted from its
// header), no image over 100 ms while they were prepared; the page loaded again, all four from the prepared cache (kerr-street-v4).
// Done when: the four street cells handed with their lamps, segments and junctions, no image over 100 ms, all four from the cache after the
// reload.
// Duration: ~1 min.

afterAll(stopServer);
const CELLS = [0, 1, 2, 3].map((k) => ({ x: 8461 * 2 + (k % 2), y: 6012 * 2 + Math.floor(k / 2), priority: 0, d: k }));
/** the street cells' counts read from the prepared cache: their header's lamps, segments and junctions */
const COUNTS = `(async () => { const c = await caches.open("kerr-street-v4"); const out = [];
  for (const r of await c.keys()) { const b = await (await c.match(r)).arrayBuffer(); const v = new DataView(b);
    out.push({ key: r.url.split("/").slice(-2).join("/"), lamps: v.getUint32(20, true), segments: v.getUint32(24, true), junctions: v.getUint16(6, true) }); } return out; })()`;

describe.skipIf(!E2E)("PLAN-J8 J8-L: the streets' cells prepared in the game", () => {
  test("Toulon's centre: four street cells handed, no image over 100 ms; after a reload, all from the prepared cache", async () => {
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.scenario("Toulon's centre · the street cells prepared");
      await app.js(`(() => { window.__gap = { n: 0, max: 0, on: true }; let last = performance.now();
        const f = (t) => { const h = window.__gap; if (!h.on) return; const d = t - last; last = t; if (d > 100) h.n++; h.max = Math.max(h.max, d);
          requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`);
      const t0 = Date.now();
      await app.js(`(() => { __bh.sys.streets.clear(); __bh.sys.streets.want(${JSON.stringify(CELLS)}); return 1; })()`);
      await app.waitFor(`__bh.sys.streets.got().length >= 4`, 60_000);
      const gap = await app.js<{ n: number; max: number }>(`(() => { window.__gap.on = false; return window.__gap; })()`);
      const s1 = await app.js<Record<string, number>>(`__bh.sys.streets.stats()`);
      const counts = await app.js<{ key: string; lamps: number; segments: number; junctions: number }[]>(COUNTS);
      console.log(
        `  cold: 4 cells in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${JSON.stringify(counts)} · longest image ${gap.max.toFixed(0)} ms · ${JSON.stringify(s1)}`,
      );
      expect(s1.failed).toBe(0);
      expect(counts.reduce((s, c) => s + c.lamps, 0)).toBeGreaterThan(200);
      // (format 4 — VB1: every road's segments, the BD TOPO's in France, and their junctions; VB2/VB5a/VB6/VB7's details beside)
      expect(counts.reduce((s, c) => s + c.segments, 0)).toBeGreaterThan(1000);
      expect(counts.reduce((s, c) => s + c.junctions, 0)).toBeGreaterThan(100);
      expect(gap.n).toBe(0);

      await app.scenario("Toulon's centre · the street cells after a reload");
      await app.load("scene=game:artemis");
      await app.js(`(() => { __bh.sys.streets.clear(); __bh.sys.streets.want(${JSON.stringify(CELLS)}); return 1; })()`);
      await app.waitFor(`__bh.sys.streets.got().length >= 4`, 20_000);
      const s2 = await app.js<{ cached: number; prepared: number }>(`__bh.sys.streets.stats()`);
      console.log(`  warm: ${JSON.stringify(s2)}`);
      expect(s2.cached).toBe(4);
      expect(s2.prepared).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);
});
