import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED } from "./lib/j0-scene";

// PLAN-J8 J8-7 — the far buildings outside France, from Overture Maps (src/system/cell-prep-overture.ts, cell-overture.ts; the cell
// worker's source: the BD TOPO within the IGN's box, Overture beyond it and wherever the BD TOPO has no building in a cell): two views,
// the free camera, no craft — Tarifa from 3 km over the strait (outside the box: Overture's alone) and Brussels from 4 km (inside the
// box, the BD TOPO empty there: Overture's by the fallback). Each: the place's data in and its compiles settled with the far layer off
// (its arrival's own hitches apart: 16 Nov 2026, Tarifa's tiles and kernel at the placing — « boot » — gave five over 100 ms), then the
// layer on (renderer.farBuildingsOn, J8-4 — off by default, on here for the look), its cells all in (the preparation pool idle), the
// hitches over 100 ms counted while they came in, the layer's census (cells, buildings resident; drawn as boxes and quads), a shot.
// Done when: at both places the far layer holds buildings from Overture's cells (none failed), drawn in view, no image over 100 ms while
// the cells came in, a shot of each.
// Duration: ~4 min (two places; Overture's tiles 0.5–2.7 MB each from S3, no IGN load at Tarifa).

afterAll(stopServer);
const OUT = "remote-results/j8-overture-cells";
const VIEWS = [
  { name: "tarifa", label: "Tarifa, depuis le détroit", lat: 35.99, lon: -5.62, altM: 350, heading: 20, pitch: -6 },
  { name: "bruxelles", label: "Bruxelles, depuis le sud", lat: 50.81, lon: 4.35, altM: 450, heading: 0, pitch: -5 },
] as const;

test.skipIf(!E2E)(
  "J8-7: Overture's cells at Tarifa and Brussels — resident, drawn, no hitch while they come",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}, { ship: false, earthClouds: 0, weather: "fair", dof: false, motionBlur: 0,
        earthPipeline: "raster" }); __bh.renderer.debugSkipShip = true; __bh.game.setDate("2026-06-21T15:00:00Z"); return 1; })()`);
      type Far = { layer: Record<string, number> | null; inView: { boxes: number; quads: number }; pool: Record<string, number> };
      for (const v of VIEWS) {
        await app.scenario(v.label);
        const handed0 = (await app.js<Far>(`(async () => await __bh.renderer.farBuildings())()`))?.layer?.handed ?? 0;
        // (the place first, the far layer off: its tiles and compiles settled — their own hitches are the place's arrival, not the cells')
        await app.js(`(() => { __bh.freeze(false); __bh.renderer.farBuildingsOn = false; return 1; })()`);
        const why = await app.js<string | null>(
          `__bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 }) ?? null`,
        );
        if (why) throw new Error(`viewAt ${v.name}: ${why}`);
        await app.dataSettled(v.label, { maxMs: 120_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 200)})`));
        await app.settled(60_000);
        // (then the far layer on, and the hitches while its cells come in: the gaps between two frames over 100 ms, counted from here)
        await app.js(`(() => { const h = (window.__hitch = { n: 0, max: 0, on: true }); let last = performance.now();
          const f = (t) => { if (!h.on) return; const d = t - last; last = t; if (d > 100) h.n++; h.max = Math.max(h.max, d);
            requestAnimationFrame(f); }; requestAnimationFrame(f); __bh.renderer.farBuildingsOn = true; return 1; })()`);
        // (this place's far cells in: more handed than before the move — the layer's cells follow the scene —, the pool idle, nothing
        // queued; said every 10 s, 150 s at most)
        let far: Far | null = null;
        for (let s = 0; s < 30; s++) {
          far = await app.js<Far>(`(async () => { __bh.touch(); return await __bh.renderer.farBuildings(); })()`);
          if (
            far?.layer &&
            (far.layer.handed ?? 0) >= handed0 + 100 &&
            far.pool.queued === 0 &&
            far.pool.running === 0 &&
            (far.pool.beyond ?? 0) === 0
          )
            break;
          if (s % 2 === 1) console.log(`  … ${v.name}: ${JSON.stringify({ layer: far?.layer, pool: far?.pool })}`);
          await app.js(`new Promise((q) => setTimeout(q, 5000))`);
        }
        const hitch = await app.js<{ n: number; max: number }>(`(() => { const h = window.__hitch; h.on = false; return h; })()`);
        await app.js(`(() => { __bh.freeze(true); __bh.touch(); return 1; })()`);
        await app.settled(60_000);
        far = await app.js<Far>(`(async () => { __bh.touch(); return await __bh.renderer.farBuildings(); })()`);
        console.log(`  ${v.name}: ${JSON.stringify(far)} · hitches over 100 ms: ${hitch.n} (longest ${hitch.max.toFixed(0)} ms)`);
        await app.shot(`${OUT}/${v.name}.png`);
        expect(far?.layer?.handed ?? 0).toBeGreaterThanOrEqual(handed0 + 100);
        expect(far?.layer?.put ?? 0).toBeGreaterThan(0);
        expect(far?.layer?.records ?? 0).toBeGreaterThan(100);
        expect(far?.pool.failed ?? 1).toBe(0);
        expect((far?.inView.boxes ?? 0) + (far?.inView.quads ?? 0)).toBeGreaterThan(0);
        expect(hitch.n).toBe(0);
      }
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  600_000,
);
