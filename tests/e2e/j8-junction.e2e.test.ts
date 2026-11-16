import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J8 J8-5 — where the near scene's buildings hand over to the far layer: the scene keeps its own within farNearOnlyM of its
// corridor, the far layer (J8-4, on) draws past it. Its distance decided by Sam on these captures (the analysis session, 16 Nov 2026:
// an envelope ~10 px at 2 km). Two views of Toulon, the free camera, no craft, the world frozen, 300 m up looking at the city from
// 2.5 km and from 4 km; at each the junction at 0 (the scene keeps all its own, as before), 2 000, 3 000 and 4 000 m — the scene made
// again for each and waited for, then 5 s: the GPU time (median), the scene's buildings and those left to the layer, the layer's drawn,
// how long the scene took; a shot — at 2 km a second with the far roofs' tint as before (renderer.farRoofHue false: the
// far roofs beside the near mesh's, Sam's question on their colour). Not a pass/fail on the image (j8-junction.json); it fails on a GPU error or a scene never made.
// Duration: ~10 min on kerr-mini.
// Done when: both views shot at the four junctions, j8-junction.json written.
afterAll(stopServer);
const MACHINE = process.env.J8J_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.J8J_OUT ?? `remote-results/j8-junction/${MACHINE}`;
const VIEWS = [
  { name: "a-2500m", label: "Toulon depuis 2,5 km", lat: 43.124, lon: 5.958, altM: 350, heading: 270, pitch: -6 },
  { name: "b-4000m", label: "Toulon depuis 4 km", lat: 43.124, lon: 5.977, altM: 350, heading: 270, pitch: -4 },
] as const;
const JUNCTIONS = [0, 2000, 3000, 4000] as const;
test.skipIf(!E2E)(
  "J8-5: the near scene / far layer junction at 0, 2, 3 and 4 km — Toulon from 2.5 and 4 km, shots, GPU, the scene's time",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), machine: MACHINE, views: {} };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}, { ship: false, earthClouds: 0, weather: "fair", dof: false, motionBlur: 0,
        earthPipeline: "raster" }); __bh.renderer.debugSkipShip = true; __bh.renderer.farBuildingsOn = true; __bh.game.setDate("${J0_SCENE.date}");
        return 1; })()`);
      for (const v of VIEWS) {
        const rows: unknown[] = [];
        for (const j of JUNCTIONS) {
          await app.scenario(`${v.label} · jonction ${j ? `${j / 1000} km` : "aucune (la scène garde tout)"}`);
          await app.js(`(() => { __bh.freeze(false); __bh.renderer.farNearOnlyM = ${j}; return 1; })()`);
          const why = await app.js<string | null>(
            `__bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 }) ?? null`,
          );
          if (why) throw new Error(`viewAt ${v.name}: ${why}`);
          const t0 = Date.now();
          await app.js(`(async () => { for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
          await app.dataSettled(v.label, { maxMs: 150_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 200)})`));
          await app
            .waitProgress(
              `(() => { const sc = __bh.renderer.earthScenery.stats(); __bh.touch(); return sc.status === "ready" && !sc.quick; })()`,
              `${v.name} ${j}: the scene whole`,
              { stallMs: 60_000, maxMs: 150_000 },
            )
            .catch((e) => console.log(`  (${v.name} ${j}: ${String(e).slice(0, 200)})`));
          const sceneS = (Date.now() - t0) / 1000;
          await app.js(`(() => { __bh.freeze(true); __bh.touch(); return 1; })()`);
          await app.settled(60_000);
          const m = await app.js<Record<string, unknown>>(`(async () => {
            const R = __bh.renderer; for (let i = 0; i < 20; i++) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch(); }
            const g = []; let done = R.completedFrames; const t0 = performance.now();
            while (performance.now() - t0 < 5000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
              if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
            g.sort((a, b) => a - b); const sc = R.earthScenery.stats(), far = await R.farBuildings();
            return { p50: +(g[g.length >> 1] ?? 0).toFixed(2), buildings: sc.buildings, farLeft: sc.farLeft, cut: sc.cutBuildings,
              keptM: Math.round(sc.keptReachM), inView: far.inView, phases: sc.phases }; })()`);
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          await app.shot(`${OUT}/${v.name}-jonction-${j}.png`);
          // (at 2 km the far roofs beside the near mesh's: their tint as before — desaturated — for the comparison, J8-4)
          if (j === 2000) {
            await app.js(`(() => { __bh.renderer.farRoofHue = false; __bh.touch(); return 1; })()`);
            await app.settled(30_000);
            await app.shot(`${OUT}/${v.name}-jonction-${j}-teinte-avant.png`);
            await app.js(`(() => { __bh.renderer.farRoofHue = true; __bh.touch(); return 1; })()`);
            await app.settled(30_000);
          }
          await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
          const row = { junction: j, sceneS, ...m };
          rows.push(row);
          console.log(`  ${v.name} · ${j} m: ${JSON.stringify({ ...row, phases: undefined })}`);
        }
        (out.views as Record<string, unknown>)[v.name] = rows;
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-junction.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  1_800_000,
);
