import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED } from "./lib/j0-scene";

// PLAN-J8 J8-E — the whole view's rivers and lakes (Sam, 16 Nov 2026): past the near scene's square, the street levels' inland water
// (water-mask.ts in the tiles' g, trace.wgsl tileWaterAt) drawn as water. Views, the free camera, no craft, the world frozen: the
// Seine at the Pont d'Iéna from 1, 5 and 15 km (south-west, its point in the image's middle), the Gapeau north of Hyères from 3 km
// (a river under the tiles' texel: it must fade, no dotted line); each by day with the tiles' water and without (renderer.tune
// TUNE_TILE_WATER 0 — the A/B in one build), the Seine at 5 and 9 km by night too. Shots; the GPU time (median); the scene's square. Not a
// pass/fail on the image (j8-water.json); it fails on a GPU error or the device lost.
// Duration: ~12 min on kerr-mini.
// Done when: every view shot with and without the tiles' water, j8-water.json written.
afterAll(stopServer);
const MACHINE = process.env.J8W_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
// (an A/B's side its own directory — scripts/ab-e2e.ts AB_SIDE, AB_RUN)
const SIDE = process.env.AB_SIDE ? `-${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "";
const OUT = process.env.J8W_OUT ?? `remote-results/j8-water/${MACHINE}${SIDE}`;
const DAY = "2026-07-10T13:30:00Z";
const NIGHT = "2026-07-10T21:30:00Z";
/** a point seen from d [km] towards bearing (from it) b [°], at altM: the camera's place and its look at the point */
function from(lat: number, lon: number, dKm: number, b: number, altM: number) {
  const r = (b * Math.PI) / 180;
  const la = lat + (dKm * 1000 * Math.cos(r)) / 111320;
  const lo = lon + (dKm * 1000 * Math.sin(r)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: la, lon: lo, altM, heading: (b + 180) % 360, pitch: -(Math.atan2(altM, dKm * 1000) * 180) / Math.PI };
}
const SEINE = [48.86, 2.2925] as const;
const GAPEAU = [43.135, 6.15] as const;
const VIEWS = [
  { name: "seine-1km", label: "la Seine depuis 1 km", ...from(SEINE[0], SEINE[1], 1, 225, 250), night: false },
  { name: "seine-5km", label: "la Seine depuis 5 km", ...from(SEINE[0], SEINE[1], 5, 225, 600), night: true },
  { name: "seine-9km", label: "la Seine depuis 9 km", ...from(SEINE[0], SEINE[1], 9, 225, 900), night: true },
  { name: "seine-15km", label: "la Seine depuis 15 km", ...from(SEINE[0], SEINE[1], 15, 225, 1200), night: false },
  { name: "gapeau-3km", label: "le Gapeau depuis 3 km", ...from(GAPEAU[0], GAPEAU[1], 3, 200, 400), night: false },
];
test.skipIf(!E2E)(
  "J8-E: the rivers past the near scene — the Seine from 1, 5, 15 km and the Gapeau, with and without the tiles' water, day and night",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), machine: MACHINE, views: {} };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}, { ship: false, earthClouds: 0, weather: "fair", dof: false, motionBlur: 0,
        earthPipeline: "raster" }); __bh.renderer.debugSkipShip = true; return 1; })()`);
      const only = process.env.J8W_VIEWS?.split(",");
      for (const v of VIEWS.filter((w) => !only || only.includes(w.name))) {
        await app.scenario(v.label);
        await app.js(`(() => { __bh.freeze(false); __bh.renderer.tune = {}; __bh.game.setDate("${DAY}"); return 1; })()`);
        const why = await app.js<string | null>(
          `__bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch.toFixed(2)}, fov: 50 }) ?? null`,
        );
        if (why) throw new Error(`viewAt ${v.name}: ${why}`);
        await app.js(`(async () => { for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
        await app.dataSettled(v.label, { maxMs: 150_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 200)})`));
        await app
          .waitProgress(
            `(() => { const sc = __bh.renderer.earthScenery.stats(); __bh.touch(); return sc.status === "ready" && !sc.quick; })()`,
            `${v.name}: the scene whole`,
            { stallMs: 60_000, maxMs: 150_000 },
          )
          .catch((e) => console.log(`  (${v.name}: ${String(e).slice(0, 200)})`));
        const rows: Record<string, unknown> = {};
        for (const [tod, date] of v.night
          ? ([
              ["jour", DAY],
              ["nuit", NIGHT],
            ] as const)
          : ([["jour", DAY]] as const)) {
          await app.js(`(() => { __bh.game.setDate("${date}"); __bh.freeze(true); __bh.touch(); return 1; })()`);
          // (J8W_AVEC_ONLY: the build as it is alone — an A/B by commits, the older side without the lever)
          for (const [tag, tune] of (process.env.J8W_AVEC_ONLY
            ? [["avec", "{}"]]
            : [
                ["avec", "{}"],
                ["sans", "{ TUNE_TILE_WATER: 0 }"],
              ]) as [string, string][]) {
            await app.js(`(() => { __bh.renderer.tune = ${tune}; __bh.touch(); return 1; })()`);
            await app.settled(90_000);
            const m = await app.js<Record<string, unknown>>(`(async () => {
              const R = __bh.renderer; for (let i = 0; i < 20; i++) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch(); }
              const g = []; let done = R.completedFrames; const t0 = performance.now();
              while (performance.now() - t0 < 4000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
                if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
              g.sort((a, b) => a - b); const b = R.earthScenery.drawnBox?.();
              return { p50: +(g[g.length >> 1] ?? 0).toFixed(2), sceneHalfM: b ? Math.round(b.half) : null,
                pipeline: R.earthPipelineNow?.(__bh.settings) ?? null, waterTiles: { ...R.earthTiles.waterTiles } }; })()`);
            await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
            await app.shot(`${OUT}/${v.name}-${tod}-${tag}.png`);
            await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
            rows[`${tod}-${tag}`] = m;
            // (J8W_KINDS: the water's cover by its kind — liteSkip 512: red the sea, green a river, blue a lake —, what liteWater sees)
            if (process.env.J8W_KINDS && tag === "avec") {
              await app.js(`(() => { __bh.renderer.liteSkip = 512; __bh.touch(); return 1; })()`);
              await app.settled(30_000);
              await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
              await app.shot(`${OUT}/${v.name}-${tod}-kinds.png`);
              await app.js(`(() => { __bh.renderer.liteSkip = 0; document.body.classList.remove("hide-ui"); __bh.touch(); return 1; })()`);
            }
            console.log(`  ${v.name} ${tod} ${tag}: ${JSON.stringify(m)}`);
          }
          await app.js(`(() => { __bh.renderer.tune = {}; __bh.freeze(false); return 1; })()`);
        }
        (out.views as Record<string, unknown>)[v.name] = { ...v, rows };
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      const lost = await app.js<unknown[]>(
        `(__bh.graphicsDiagnostic().events ?? []).filter((e) => String(e.kind).startsWith("device-lost"))`,
      );
      expect(lost).toEqual([]);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-water.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  1_800_000,
);
