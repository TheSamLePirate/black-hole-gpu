import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-8 lot (1) — the near buildings' mesh cells prepared in the game (src/system/mesh-cells.ts kerr-mesh-v1, mesh-prep.ts; the
// cell worker's mesh path — cell-worker.ts — and its pool, cell-workers.ts meshPool, `__bh.sys.meshes`): Toulon's centre, the 3 × 3 z 15
// cells round 16923/12025 (their BD TOPO tiles on the e2e's Earth data on disk), asked of the meshes' pool from the boot's place; each
// handed, its building cell (kerr-cells-v1) made first — the same buildings, the same generation —, its buildings, triangles and time
// read; no image over 100 ms while they were prepared (the workers' own threads); the page loaded again, all nine from the prepared
// cache. Then outside France: Tarifa's Overture z 14 tile's four mesh cells (J8-7's cells), each with its building cell's count and
// generation.
// Done when: nine mesh cells handed, each with its building cell's count and generation, no image over 100 ms, all nine from the
// cache after the reload; Tarifa's four Overture mesh cells, their building cells' counts and generation.
// Duration: ~1 min.

afterAll(stopServer);
const CELLS: { x: number; y: number; priority: number; d: number }[] = [];
for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) CELLS.push({ x: 16923 + i, y: 12025 + j, priority: 0, d: CELLS.length });
/** each mesh cell in the prepared cache beside its building cell: their buildings and generations */
const PAIRS = `(async () => { const m = await caches.open("kerr-mesh-v1"), c = await caches.open("kerr-cells-v1"); const out = [];
  for (const r of await m.keys()) { const b = await (await m.match(r)).arrayBuffer(); const v = new DataView(b);
    const x = v.getUint32(12, true), y = v.getUint32(16, true);
    const k = (await c.keys()).find((q) => q.url.endsWith("/" + x + "/" + y + ".kbc"));
    const cb = k ? await (await c.match(k)).arrayBuffer() : null; const cv = cb ? new DataView(cb) : null;
    out.push({ key: x + "/" + y, bytes: b.byteLength, buildings: v.getUint32(20, true), generation: v.getUint32(24, true),
      triangles: v.getUint32(32, true), flags: v.getUint8(9),
      cellBuildings: cv ? cv.getUint32(20, true) : -1, cellGeneration: cv ? cv.getUint32(24, true) : -1 }); } return out; })()`;

describe.skipIf(!E2E)("PLAN-J8 J8-8: the near mesh cells prepared in the game", () => {
  test("Toulon's centre: nine mesh cells handed beside their building cells, no image over 100 ms; after a reload, all from the cache", async () => {
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.scenario("Toulon's centre · the mesh cells prepared");
      await app.js(`(() => { window.__gap = { n: 0, max: 0, on: true }; let last = performance.now();
        const f = (t) => { const h = window.__gap; if (!h.on) return; const d = t - last; last = t; if (d > 100) h.n++; h.max = Math.max(h.max, d);
          requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`);
      const t0 = Date.now();
      await app.js(`(() => { __bh.sys.meshes.clear(); __bh.sys.meshes.want(${JSON.stringify(CELLS)}); return 1; })()`);
      await app.waitFor(`__bh.sys.meshes.got().length >= ${CELLS.length}`, 90_000);
      const gap = await app.js<{ n: number; max: number }>(`(() => { window.__gap.on = false; return window.__gap; })()`);
      const s1 = await app.js<Record<string, number>>(`__bh.sys.meshes.stats()`);
      const got = await app.js<{ key: string; ms: number; buildings: number; triangles: number }[]>(`__bh.sys.meshes.got()`);
      const pairs =
        await app.js<
          {
            key: string;
            bytes: number;
            buildings: number;
            generation: number;
            triangles: number;
            cellBuildings: number;
            cellGeneration: number;
          }[]
        >(PAIRS);
      const sum = (k: "buildings" | "triangles" | "bytes") => pairs.reduce((s, p) => s + p[k], 0);
      const ms = got.map((g) => g.ms).sort((a, b) => a - b);
      console.log(
        `  cold: ${CELLS.length} cells in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${sum("buildings")} buildings, ${sum("triangles")} triangles, ${(sum("bytes") / 1e6).toFixed(1)} MB · per cell ${ms[0]}–${ms[ms.length - 1]} ms (median ${ms[ms.length >> 1]}) · longest image ${gap.max.toFixed(0)} ms · ${JSON.stringify(s1)}`,
      );
      for (const p of pairs) console.log(`    ${JSON.stringify(p)}`);
      expect(s1.failed).toBe(0);
      expect(pairs.length).toBe(CELLS.length);
      // (the same buildings as the building cell, the same generation: the ranks agree)
      for (const p of pairs) {
        expect(p.buildings).toBe(p.cellBuildings);
        expect(p.generation).toBe(p.cellGeneration);
      }
      expect(sum("buildings")).toBeGreaterThan(2000);
      expect(sum("triangles")).toBeGreaterThan(20 * sum("buildings") * 0.5);
      expect(gap.n).toBe(0);

      await app.scenario("Toulon's centre · the mesh cells after a reload");
      await app.load("scene=game:artemis");
      await app.js(`(() => { __bh.sys.meshes.clear(); __bh.sys.meshes.want(${JSON.stringify(CELLS)}); return 1; })()`);
      await app.waitFor(`__bh.sys.meshes.got().length >= ${CELLS.length}`, 20_000);
      const s2 = await app.js<{ cached: number; prepared: number }>(`__bh.sys.meshes.stats()`);
      console.log(`  warm: ${JSON.stringify(s2)}`);
      expect(s2.cached).toBe(CELLS.length);
      expect(s2.prepared).toBe(0);

      // (outside France — J8-7's Overture cells: Tarifa's z 14 tile 7936/6432, its four cells made at once)
      await app.scenario("Tarifa · Overture's mesh cells");
      const T = [0, 1, 2, 3].map((k) => ({ x: 7936 * 2 + (k % 2), y: 6432 * 2 + Math.floor(k / 2), priority: 0, d: k }));
      await app.js(`(() => { __bh.sys.meshes.clear(); __bh.sys.meshes.want(${JSON.stringify(T)}); return 1; })()`);
      await app.waitFor(`__bh.sys.meshes.got().length >= 4`, 90_000);
      const tp = (
        await app.js<
          {
            key: string;
            buildings: number;
            generation: number;
            triangles: number;
            flags: number;
            cellBuildings: number;
            cellGeneration: number;
          }[]
        >(PAIRS)
      ).filter((p) => T.some((t) => p.key === `${t.x}/${t.y}`));
      for (const p of tp) console.log(`    ${JSON.stringify(p)}`);
      expect(tp.length).toBe(4);
      for (const p of tp) {
        expect(p.buildings).toBe(p.cellBuildings);
        expect(p.generation).toBe(p.cellGeneration);
        expect(p.flags & 2).toBe(0);
      }
      expect(tp.reduce((t, p) => t + p.triangles, 0)).toBeGreaterThan(10_000);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);
});
