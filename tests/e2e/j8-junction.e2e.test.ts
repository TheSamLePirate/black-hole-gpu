import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J8 J8-5 — where the near scene's buildings hand over to the far layer: the scene keeps its own within farNearOnlyM of its
// corridor (and within its cap's kept reach — 32 000 buildings: ~1.4 km of it in Toulon), the far layer (J8-4, on) draws past it — its
// mask measured along the same corridor. Its distance decided by Sam on these captures (16 Nov 2026). Two views, the free camera, no
// craft, the world frozen, 350 m up, 2.5 km from a dense city (Toulon: the cap bites) and a lighter one (Hyères: the scene's box does);
// at each the junction at 0 (the scene keeps all its own, as before), 1 000, 2 000 and 3 000 m (J8J_JUNCTIONS) — the scene made again
// for each and waited for, the same hour set, then 5 s: the GPU time (median), the scene's buildings and those left to the layer, the
// layer's drawn, how long the scene took; a shot — at the last a second with the far roofs' tint as before (renderer.farMaterials false:
// Sam's question on their colour); then J8-A's witness by day and by night (23:00): a grid read by surfaceAt, the layer on and off
// (its pixels), for the colour gap either side of the junction by band of distance. Not a pass/fail on the image (j8-junction.json); it fails on a GPU error or the device lost.
// Duration: ~14 min on kerr-mini.
// Done when: both views shot at the four junctions, j8-junction.json written.
afterAll(stopServer);
const MACHINE = process.env.J8J_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.J8J_OUT ?? `remote-results/j8-junction/${MACHINE}`;
const VIEWS = [
  { name: "a-toulon", label: "Toulon depuis 2,5 km", lat: 43.124, lon: 5.958, altM: 350, heading: 270, pitch: -6 },
  { name: "b-hyeres", label: "Hyères depuis 2,5 km", lat: 43.12, lon: 6.161, altM: 350, heading: 270, pitch: -6 },
] as const;
/** the night's hour — 23:00 at Toulon in July, dark: the windows lit (J8-A, Sam's « jour et nuit ») */
const NIGHT = "2026-07-10T21:00:00Z";
const JUNCTIONS = (process.env.J8J_JUNCTIONS ?? "0,1000,2000,3000").split(",").map(Number);
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
      // (J8J_VIEWS: the views by name, comma-separated — a diagnosis on one)
      const only = process.env.J8J_VIEWS?.split(",");
      for (const v of VIEWS.filter((w) => !only || only.includes(w.name))) {
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
          // (the same hour at every shot: the sun as the first's — the world ran while the scene was made)
          await app.js(`(() => { __bh.game.setDate("${J0_SCENE.date}"); __bh.freeze(true); __bh.touch(); return 1; })()`);
          await app.settled(60_000);
          const m = await app.js<Record<string, unknown>>(`(async () => {
            const R = __bh.renderer; for (let i = 0; i < 20; i++) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch(); }
            const g = []; let done = R.completedFrames; const t0 = performance.now();
            while (performance.now() - t0 < 5000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
              if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
            g.sort((a, b) => a - b); const sc = R.earthScenery.stats(), far = await R.farBuildings();
            return { p50: +(g[g.length >> 1] ?? 0).toFixed(2), buildings: sc.buildings, farLeft: sc.farLeft, cut: sc.cutBuildings,
              keptM: Math.round(sc.keptReachM), corridorM: sc.corridorM, inView: far.inView, phases: sc.phases,
              lost: (__bh.graphicsDiagnostic().events ?? []).filter((e) => String(e.kind).startsWith("device-lost")).length }; })()`);
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          await app.shot(`${OUT}/${v.name}-jonction-${j}.png`);
          // (at the last junction the far roofs beside the near mesh's: their tint as before — desaturated — for the comparison, J8-4)
          if (j === JUNCTIONS[JUNCTIONS.length - 1]) {
            await app.js(`(() => { __bh.renderer.farMaterials = false; __bh.touch(); return 1; })()`);
            await app.settled(30_000);
            await app.shot(`${OUT}/${v.name}-jonction-${j}-teinte-avant.png`);
            await app.js(`(() => { __bh.renderer.farMaterials = true; __bh.touch(); return 1; })()`);
            await app.settled(30_000);
          }
          await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
          const row = { junction: j, sceneS, ...m };
          rows.push(row);
          console.log(`  ${v.name} · ${j} m: ${JSON.stringify({ ...row, phases: undefined })}`);
        }
        // (J8-A's witness — the near mesh and the far layer side by side, by day and by night: at the last junction a grid of the
        // image's lower part read by surfaceAt — kind, distance —, the layer drawn then not (sceneryRaster.farSkip 6: its draws left out, the scene the same — their difference its pixels); the same at
        // night, the windows lit. The colour gap by band of distance is read from the shots and the grid offline)
        const probe = () =>
          app.js<{ fx: number; fy: number; x: number; y: number; kind: string; d: number }[]>(`(async () => { const r = [];
            for (let j = 0; j < 26; j++) for (let i = 0; i < 48; i++) { const x = (i + 0.5) / 48, y = 0.36 + (j + 0.5) * 0.64 / 26;
              const s = await __bh.renderer.surfaceAt(x, y); if (s) r.push({ fx: x, fy: y, x: s.x, y: s.y, kind: s.kind, d: Math.round(s.nearest ?? s.ground ?? -1) }); }
            return r; })()`);
        const pair = async (tag: string) => {
          await app.settled(30_000);
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          await app.shot(`${OUT}/${v.name}-${tag}.png`);
          const grid = await probe();
          await app.js(`(() => { __bh.renderer.sceneryRaster.farSkip = 6; __bh.touch(); return 1; })()`);
          await app.settled(30_000);
          await app.shot(`${OUT}/${v.name}-${tag}-sans.png`);
          await app.js(
            `(() => { __bh.renderer.sceneryRaster.farSkip = 0; document.body.classList.remove("hide-ui"); __bh.touch(); return 1; })()`,
          );
          return grid;
        };
        await app.scenario(`${v.label} · le témoin de J8-A, de jour`);
        const day = await pair("jour");
        await app.scenario(`${v.label} · le témoin de J8-A, de nuit`);
        await app.js(`(() => { __bh.game.setDate("${NIGHT}"); __bh.touch(); return 1; })()`);
        await app.js(`new Promise((q) => setTimeout(q, 3000))`);
        const night = await pair("nuit");
        // (J8J_DIAG: the night's far layer as boxes alone, then generic — what lights it, PLAN-J8 J8-A)
        if (process.env.J8J_DIAG) {
          for (const [tag, set, back] of [
            ["nuit-boites", "__bh.renderer.farQuadPx = 0", "__bh.renderer.farQuadPx = 8"],
            ["nuit-generique", "__bh.renderer.farMaterials = false", "__bh.renderer.farMaterials = true"],
          ] as const) {
            await app.js(`(() => { ${set}; __bh.touch(); return 1; })()`);
            await app.settled(30_000);
            await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
            await app.shot(`${OUT}/${v.name}-${tag}.png`);
            await app.js(`(() => { ${back}; document.body.classList.remove("hide-ui"); return 1; })()`);
          }
        }
        await app.js(`(() => { __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`);
        (out.views as Record<string, unknown>)[v.name] = { rows, witness: { junction: JUNCTIONS[JUNCTIONS.length - 1], day, night } };
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      // (the device never lost — a loss remakes the renderer: a black image, the scene empty, the GPU's time cut — 16 Nov 2026's run)
      const lost = await app.js<unknown[]>(
        `(__bh.graphicsDiagnostic().events ?? []).filter((e) => String(e.kind).startsWith("device-lost"))`,
      );
      expect(lost).toEqual([]);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-junction.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  1_800_000,
);
