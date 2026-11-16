import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J8 J8-4 — the far buildings' layer seen: the BD TOPO's cells round the eye (cellPool, J8-3) resident on the GPU (BuildingFar),
// culled at the pixel, drawn as boxes and as quads under 8 px (Sam's decision of 16 Nov 2026), into the shadow map; the near scene's
// own buildings left to it. Views, the free camera, no craft, the world frozen (J8F_VIEWS picks): J0's start (500 m over the sea off Hyères, west —
// the coast 10–30 km away, ~129 000 buildings in its field: the census, docs/progress/j8/census-j0.json) Toulon from 12 km east, Paris from 12 km west (J8-A (c): the pool's budget for Paris).
// Each: the place's data in, the far cells all in (the preparation pool idle), then the layer with quads under 8 px (Sam's decision),
// under 4, boxes only, off, on again — 5 s each: the GPU time (median), the buildings drawn (boxes, quads), a shot (their looks compared:
// the analysis session's question of 16 Nov 2026). Not a pass/fail on the times (j8-far-layer.json); it fails on a GPU
// error, no cell resident, or none drawn in J0's view.
// J8F_BUDGET [MiB]: the layer's pool (renderer.farBudgetMiB; 96: Sam's measure 2, all Paris resident). J8F_NIGHT: the view at night too.
// Duration: ~8 min on kerr-mini.
// Done when: both views measured on, off and on again, j8-far-layer.json written.
afterAll(stopServer);
const MACHINE = process.env.J8F_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const SIDE = process.env.AB_SIDE ? `-${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "";
const OUT = process.env.J8F_OUT ?? `remote-results/j8-far-layer/${MACHINE}${SIDE}`;
/** the night's hour (23:00 in Paris in July) */
const NIGHT = "2026-07-10T21:30:00Z";
const VIEWS = [
  { name: "1-depart-j0", label: "le départ de J0, vers la côte", lat: 43.06, lon: 6.32, altM: 550, heading: 270, pitch: -2 },
  { name: "2-toulon-12km", label: "Toulon à 12 km, depuis l'est", lat: 43.11, lon: 6.08, altM: 400, heading: 272, pitch: -3 },
  // (PLAN-J8 J8-A (c): Paris — the layer's pool sized for it — from 12 km west, over the Seine's loops)
  { name: "3-paris-12km", label: "Paris à 12 km, depuis l'ouest", lat: 48.865, lon: 2.185, altM: 500, heading: 90, pitch: -3 },
] as const;
test.skipIf(!E2E)(
  "J8-4: the far buildings' layer — J0's view and Toulon's, the layer on, off, on: its buildings drawn, its GPU time, shots",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), machine: MACHINE, views: {} };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}, { ship: false, earthClouds: 0, weather: "fair", dof: false, motionBlur: 0,
        earthPipeline: "raster" }); __bh.renderer.debugSkipShip = true; __bh.game.setDate("${J0_SCENE.date}");
        __bh.renderer.farBudgetMiB = ${Number(process.env.J8F_BUDGET ?? 72)}; return 1; })()`);
      // (J8F_VIEWS: the views by name, comma-separated)
      const only = process.env.J8F_VIEWS?.split(",");
      for (const v of VIEWS.filter((w) => !only || only.includes(w.name))) {
        await app.scenario(v.label);
        await app.js(`(() => { __bh.freeze(false); __bh.renderer.farBuildingsOn = true; return 1; })()`);
        const why = await app.js<string | null>(
          `__bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 }) ?? null`,
        );
        if (why) throw new Error(`viewAt ${v.name}: ${why}`);
        await app.js(`(async () => { for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
        await app.dataSettled(v.label, { maxMs: 150_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 200)})`));
        // (the far cells in: the preparation pool idle, nothing queued — said every 10 s, 150 s at most)
        let far: { layer: Record<string, number> | null; inView: { boxes: number; quads: number }; pool: Record<string, number> } | null =
          null;
        // (a larger pool — J8F_BUDGET — holds more to prepare: 300 s at most then, said every 10 s)
        for (let s = 0; s < (process.env.J8F_BUDGET ? 60 : 30); s++) {
          far = await app.js(`(async () => { __bh.touch(); return await __bh.renderer.farBuildings(); })()`);
          if (far && far.layer && far.pool.queued === 0 && far.pool.running === 0 && (far.layer.put ?? 0) > 0) break;
          if (s % 2 === 1) console.log(`  … ${v.name}: the far cells — ${JSON.stringify({ layer: far?.layer, pool: far?.pool })}`);
          await app.js(`new Promise((q) => setTimeout(q, 5000))`);
        }
        await app.js(`(() => { __bh.freeze(true); __bh.touch(); return 1; })()`);
        await app.settled(60_000);
        const measure = async (on: boolean, tag: string, quadPx = 8) => {
          await app.js(`(() => { __bh.renderer.farBuildingsOn = ${on}; __bh.renderer.farQuadPx = ${quadPx}; __bh.touch(); return 1; })()`);
          await app.settled(30_000);
          const m = await app.js<{ p50: number; p95: number; images: number }>(`(async () => {
            const R = __bh.renderer; for (let i = 0; i < 20; i++) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch(); }
            const g = []; let done = R.completedFrames; const t0 = performance.now();
            while (performance.now() - t0 < 5000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
              if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
            g.sort((a, b) => a - b);
            return { p50: +(g[g.length >> 1] ?? 0).toFixed(2), p95: +(g[Math.floor(g.length * 0.95)] ?? 0).toFixed(2), images: g.length }; })()`);
          const f = await app.js<typeof far>(`__bh.renderer.farBuildings()`);
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          await app.shot(`${OUT}/${v.name}-${tag}.png`);
          await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
          return { on, quadPx, ...m, inView: f?.inView, layer: f?.layer };
        };
        // (the layer with quads under 8 px — Sam's decision —, under 4, none; then off; then on again: the A/B/A's)
        const a = await measure(true, "avec-quads-8px", 8);
        const q4 = await measure(true, "avec-quads-4px", 4);
        const q0 = await measure(true, "avec-boites-seules", 0);
        const b = await measure(false, "sans");
        const a2 = await measure(true, "avec-quads-8px-2", 8);
        // (J8F_NIGHT: the same view at night, the layer on and off — the edge of the layer against the IGN's built relief by night,
        // Sam's decision of 16 Nov 2026)
        let night: unknown = null;
        if (process.env.J8F_NIGHT) {
          await app.js(`(() => { __bh.game.setDate("${NIGHT}"); __bh.touch(); return 1; })()`);
          await app.js(`new Promise((q) => setTimeout(q, 30000))`);
          night = { on: await measure(true, "nuit-avec", 8), off: await measure(false, "nuit-sans") };
          await app.js(`(() => { __bh.game.setDate("${J0_SCENE.date}"); __bh.touch(); return 1; })()`);
        }
        const row = {
          ...v,
          budgetMiB: Number(process.env.J8F_BUDGET ?? 72),
          on: a,
          quads4: q4,
          boxesOnly: q0,
          off: b,
          onAgain: a2,
          night,
          addedP50: +((a.p50 + a2.p50) / 2 - b.p50).toFixed(2),
        };
        (out.views as Record<string, unknown>)[v.name] = row;
        console.log(
          `  ${v.name}: ${JSON.stringify({ on8: a.p50, on4: q4.p50, boxes: q0.p50, off: b.p50, onAgain: a2.p50, inView: a.inView, layer: a.layer })}`,
        );
        await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      }
      const j0 = (out.views as Record<string, { on: { inView?: { boxes: number; quads: number }; layer?: { cells: number } } }>)[
        "1-depart-j0"
      ];
      if (j0) {
        expect(j0.on.layer?.cells ?? 0).toBeGreaterThan(0);
        expect((j0.on.inView?.boxes ?? 0) + (j0.on.inView?.quads ?? 0)).toBeGreaterThan(0);
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-far-layer.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  1_200_000,
);
