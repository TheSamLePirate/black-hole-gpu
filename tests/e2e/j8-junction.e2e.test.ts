import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J8 J8-5 — where the near buildings hand over to the far layer (the junction's distance decided 0 by Sam, 16 Nov 2026; its lever
// farNearOnlyM retired with J8-8 on, 17 Nov 2026: the near buildings from their mesh cells, the far layer past them, cell by cell). Two views, the free camera, no
// craft, the world frozen, 350 m up, 2.5 km from a dense city (Toulon: the cap bites) and a lighter one (Hyères: the scene's box does);
// at each the scene made and waited for, the same hour set, then 5 s: the GPU time (median), the scene's buildings and those left to the layer, the
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
/** (one pass — the junction's lever retired; J8J_RUN repeats the scene's wait: J8J_REPEAT passes) */
const JUNCTIONS = Array.from({ length: Number(process.env.J8J_REPEAT ?? 1) }, () => 0);
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
      // (J8J_RUN: a recorder each frame — the camera's place, what holds the step, the clock, the free camera's rig (its key, body, offset
      // from the body's centre): the frames round a loss, a re-key or a jump of the offset over 1 km kept)
      if (process.env.J8J_RUN)
        await app.js(`(() => { const ring = []; window.__j8jLost = [];
          const tick = () => { const g = __bh.camera.geoNow?.(), f = { ms: Math.round(performance.now()), held: __bh.held?.() ?? null,
              now: __bh.game.now?.() ?? null, g: g && [+g.lat.toFixed(4), +g.lon.toFixed(4), Math.round(g.alt)], scene: __bh.renderer.earthScenery.stats().status,
              rig: { key: __bh.camera.rig.key, ref: __bh.camera.rig.ref, on: __bh.camera.rig.on, offKm: +(Math.hypot(...__bh.camera.rig.off) * 1.476625 * __bh.settings.massSolar).toFixed(3) }, near: (() => {
                const C = __bh.camera, w = C.rigWorld(), t = C.nowTime(), mR = 1476.625 * __bh.settings.massSolar; if (!w) return null;
                const n = C.rigNearest(w.ours, w.X, t), rb = C.rigBody(__bh.fleet.active, w.ours, t);
                return { id: n?.id ?? null, d: n ? +((Math.hypot(...n.C.map((c, i) => w.X[i] - c)) - n.R) / n.R).toExponential(2) : null,
                  craftKm: rb ? +(Math.hypot(...rb.C.map((c, i) => w.X[i] - c)) * mR / 1000).toFixed(3) : null }; })() };
            const p = ring[ring.length - 1];
            if (p && ((p.g && !f.g) || (p.g && f.g && Math.abs(p.g[2] - f.g[2]) > 3000) || p.rig.key !== f.rig.key || p.near?.id !== f.near?.id || Math.abs(p.rig.offKm - f.rig.offKm) > 1)) window.__j8jLost.push({ before: ring.slice(-6), at: f });
            ring.push(f); if (ring.length > 12) ring.shift(); requestAnimationFrame(tick); };
          requestAnimationFrame(tick); return 1; })()`);
      // (J8J_STALL ms: the main thread blocked that long every 2 s — a slower machine's hitches, kerr-mini's)
      if (process.env.J8J_STALL)
        await app.js(
          `(() => { setInterval(() => { const t = performance.now(); while (performance.now() - t < ${Number(process.env.J8J_STALL)}); }, 2000); return 1; })()`,
        );
      // (J8J_VIEWS: the views by name, comma-separated — a diagnosis on one)
      const only = process.env.J8J_VIEWS?.split(",");
      for (const v of VIEWS.filter((w) => !only || only.includes(w.name))) {
        const rows: unknown[] = [];
        for (const j of JUNCTIONS) {
          await app.scenario(`${v.label} · jonction ${j ? `${j / 1000} km` : "aucune (la scène garde tout)"}`);
          // (the world kept frozen while the scene is made — rule 13's way: the free camera without a craft is not carried with the Earth,
          // the world running left it in space — « away from the Earth », 16 Nov 2026, PROBLEMES)
          // (J8J_RUN: the world left running during the wait, as before — the camera lost reproduced, PROBLEMES)
          await app.js(`(() => { __bh.freeze(${!process.env.J8J_RUN}); return 1; })()`);
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
            .catch(async (e) => {
              console.log(`  (${v.name} ${j}: ${String(e).slice(0, 200)})`);
              // (what the page is in when the scene never comes whole: the camera, the scene, the tiles, the image's path)
              const st = await app.js(`(() => { const R = __bh.renderer, sc = R.earthScenery.stats(), g = __bh.camera.geoNow?.();
                return { geo: g && { lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), alt: Math.round(g.alt ?? 0) },
                  scene: { status: sc.status, quick: sc.quick, lat: sc.lat, lon: sc.lon, buildings: sc.buildings, trees: sc.trees,
                    pending: sc.pending, progress: sc.progress, reason: sc.reason ?? null, error: sc.error ?? sc.lastError ?? null },
                  box: R.earthScenery.drawnBox?.() ?? null, tiles: { pending: R.earthTiles.pending, ortho: R.earthTiles.orthoPending },
                  pipeline: R.earthPipelineNow?.(__bh.settings) ?? null, frozen: __bh.frozen ?? null, gpuMs: R.lastGpuMs }; })()`);
              console.log(`  (${v.name} ${j}: the page: ${JSON.stringify(st)})`);
            });
          const sceneS = (Date.now() - t0) / 1000;
          if (process.env.J8J_RUN)
            console.log(`  (${v.name} ${j}: the camera's losses: ${JSON.stringify(await app.js(`window.__j8jLost.splice(0)`))})`);
          if (process.env.J8J_RUN)
            console.log(
              `  (${v.name} ${j}: after the wait, the world running: ${JSON.stringify(
                await app.js(`(async () => {
              const R = __bh.renderer, sc = R.earthScenery.stats(), s = await R.surfaceAt(0.5, 0.65), g = __bh.camera.geoNow?.();
              return { scene: sc.status, lat: sc.lat, lon: sc.lon, kind: s?.kind ?? "none", d: Math.round(s?.nearest ?? -1), date: __bh.game.date?.() ?? null,
                craft: { active: __bh.fleet?.active, geo: g && [+g.lat.toFixed(3), +g.lon.toFixed(3), Math.round(g.alt ?? 0)] } }; })()`),
              )})`,
            );
          // (the same hour at every shot: the sun as the first's — the world ran while the scene was made)
          // (the date set back, the free camera set again at its place: a jump in time left it where the Earth was — « away from the
          // Earth », the image black, the scene empty: 3 runs in 5 on 16 Nov 2026, PROBLEMES)
          await app.js(`(() => { __bh.game.setDate("${J0_SCENE.date}");
            __bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 });
            __bh.freeze(true); __bh.touch(); return 1; })()`);
          await app.settled(60_000);
          const m = await app.js<Record<string, unknown>>(`(async () => {
            const R = __bh.renderer; for (let i = 0; i < 20; i++) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch(); }
            const g = []; let done = R.completedFrames; const t0 = performance.now();
            while (performance.now() - t0 < 5000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
              if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
            g.sort((a, b) => a - b); const sc = R.earthScenery.stats(), far = await R.farBuildings();
            return { p50: +(g[g.length >> 1] ?? 0).toFixed(2), buildings: sc.buildings, meshLeft: sc.meshLeft, cut: sc.cutBuildings,
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
        await app.js(
          `(() => { __bh.game.setDate("${NIGHT}"); __bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 }); __bh.touch(); return 1; })()`,
        );
        await app.js(`new Promise((q) => setTimeout(q, 3000))`);
        const night = await pair("nuit");
        // (J8J_JUMP: the night jumped to with the far materials on — shots 3 s and 30 s after: a transient? PROBLEMES 16 Nov 2026)
        if (process.env.J8J_JUMP) {
          await app.js(
            `(() => { __bh.renderer.farMaterials = true; __bh.game.setDate("${J0_SCENE.date}"); __bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 }); __bh.touch(); return 1; })()`,
          );
          await app.settled(30_000);
          await app.js(`new Promise((q) => setTimeout(q, 5000))`);
          await app.js(
            `(() => { __bh.game.setDate("${NIGHT}"); __bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 }); __bh.touch(); return 1; })()`,
          );
          for (const [tag, ms] of [
            ["3s", 3000],
            ["30s", 27000],
          ] as const) {
            await app.js(`new Promise((q) => setTimeout(q, ${ms}))`);
            await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
            await app.shot(`${OUT}/${v.name}-saut-nuit-${tag}.png`);
            await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
          }
          await app.js(`(() => { __bh.renderer.farMaterials = false; __bh.touch(); return 1; })()`);
        }
        // (J8J_PROBE "x,y;x,y…" [px of the 1920 × 1080 shot]: the night with the far materials on, those pixels' visibility — what the
        // white squares are, PROBLEMES 16 Nov 2026)
        if (process.env.J8J_PROBE) {
          await app.js(`(() => { __bh.renderer.farMaterials = true; __bh.touch(); return 1; })()`);
          await app.settled(30_000);
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          await app.shot(`${OUT}/${v.name}-nuit-materiaux.png`);
          await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
          const probes = await app.js(`(async () => { const r = [];
            for (const p of ${JSON.stringify(process.env.J8J_PROBE.split(/[;/]/).map((q) => q.split(",").map(Number)))}) {
              const s = await __bh.renderer.surfaceAt(p[0] / 1920, p[1] / 1080);
              r.push({ px: p, kind: s?.kind, vis: s?.vis, nearest: s && Math.round(s.nearest), id: s?.id }); }
            return r; })()`);
          console.log(`  ${v.name} night probes: ${JSON.stringify(probes)}`);
          (out as Record<string, unknown>).probes = probes;
          // (J8J_SKIPS "16,128,…": the same night with each liteSkip bit — what part of the shading lights the white squares)
          for (const bit of (process.env.J8J_SKIPS ?? "").split(",").filter(Boolean).map(Number)) {
            await app.js(`(() => { __bh.renderer.liteSkip = ${bit}; __bh.touch(); return 1; })()`);
            await app.settled(30_000);
            await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
            await app.shot(`${OUT}/${v.name}-nuit-materiaux-skip-${bit}.png`);
            await app.js(`(() => { __bh.renderer.liteSkip = 0; document.body.classList.remove("hide-ui"); __bh.touch(); return 1; })()`);
          }
          await app.js(`(() => { __bh.renderer.farMaterials = false; __bh.touch(); return 1; })()`);
        }
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
        await app.js(
          `(() => { __bh.game.setDate("${J0_SCENE.date}"); __bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 }); return 1; })()`,
        );
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
