import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-8 lots (2)–(4) — the near buildings from their mesh cells (renderer.nearCellsOn: near-meshes.ts, kerr-mesh-v1) against the
// near scene's own, as now. Toulon from 2.5 km, 350 m up (NC_LAT, NC_LON, NC_ALT, NC_HDG, NC_PITCH another view), the free camera, the
// world frozen: the scene as now — GPU time, a shot —; then the cells on (the scene leaving its BD TOPO buildings to them, the far layer
// drawing past them), the cells' arrival (the page's longest frames while they come), GPU time, a shot. Not a pass/fail on the image; it
// fails on a GPU error or no cell resident.
// Duration: ~5 min on kerr-mini.
// Done when: both shot and measured.
afterAll(stopServer);
const MACHINE = process.env.NC_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.NC_OUT ?? `remote-results/j8-near-cells/${MACHINE}`;
const V = {
  lat: Number(process.env.NC_LAT ?? 43.124),
  lon: Number(process.env.NC_LON ?? 5.958),
  altM: Number(process.env.NC_ALT ?? 350),
  heading: Number(process.env.NC_HDG ?? 270),
  pitch: Number(process.env.NC_PITCH ?? -6),
};
test.skipIf(!E2E)(
  "J8-8: the near buildings from their mesh cells against the scene's own — GPU, the cells' arrival, shots",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { ship: false, earthPipeline: "raster", earthClouds: 0, weather: "fair", dof: false, motionBlur: 0, hud: false });
      __bh.renderer.debugSkipShip = true; __bh.game.setDate("2026-07-10T13:30:00Z"); return 1; })()`);
      await app.js(
        `(() => { __bh.freeze(true); __bh.viewAt(${V.lat}, ${V.lon}, { altM: ${V.altM}, heading: ${V.heading}, pitch: ${V.pitch}, fov: 50 }); __bh.touch(); return 1; })()`,
      );
      const scene = () =>
        app
          .waitProgress(
            `(() => { const sc = __bh.renderer.earthScenery.stats(); __bh.touch(); return sc.status === "ready" && !sc.quick && !sc.pending; })()`,
            "the scene whole",
            { stallMs: 60_000, maxMs: 180_000 },
          )
          .catch((e) => console.log(`  (${String(e).slice(0, 200)})`));
      await scene();
      const measure = async (tag: string) => {
        await app.settled(30_000);
        const m = await app.js(`(async () => {
        const R = __bh.renderer; for (let i = 0; i < 20; i++) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch(); }
        const g = []; let done = R.completedFrames; const t0 = performance.now();
        while (performance.now() - t0 < 5000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
          if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
        g.sort((a, b) => a - b); const sc = R.earthScenery.stats();
        return { p50: +(g[g.length >> 1] ?? 0).toFixed(2), images: g.length, errors: R.gpuErrors, scene: sc.buildings, meshLeft: sc.meshLeft, far: (await R.farBuildings()).inView, near: R.nearCells() }; })()`);
        await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
        await app.shot(`${OUT}/${tag}.png`);
        await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
        console.log(`  ${tag}: ${JSON.stringify(m)}`);
        expect((m as { errors: number }).errors).toBe(0);
        return m as { near: { cells: number } | null };
      };
      await app.scenario("la scène proche telle qu'aujourd'hui");
      await measure("1-scene");
      await app.scenario("les cellules de maillage, la scène sans ses bâtiments");
      await app.js(`(() => { window.__gaps = []; let last = performance.now(); const f = (t) => { window.__gaps.push(t - last); last = t; if (window.__gaps.length < 100000) requestAnimationFrame(f); }; requestAnimationFrame(f);
      __bh.renderer.nearCellsOn = true; __bh.touch(); return 1; })()`);
      for (let s = 0; s < 36; s++) {
        const n = await app.js<{ cells: number; missing: number } | null>(`(() => { __bh.touch(); return __bh.renderer.nearCells(); })()`);
        if (n && n.cells > 0 && n.missing === 0) break;
        if (s % 2 === 1) console.log(`  … the mesh cells: ${JSON.stringify(n)}`);
        await app.js(`new Promise((q) => setTimeout(q, 5000))`);
      }
      console.log(
        `  the frames while the cells came: ${JSON.stringify(await app.js(`(() => { const g = window.__gaps.slice().sort((a, b) => b - a); return { n: g.length, max: g.slice(0, 5).map((x) => Math.round(x)) }; })()`))}`,
      );
      await scene();
      const on = await measure("2-cellules");
      expect(on.near?.cells ?? 0).toBeGreaterThan(0);
    } finally {
      app.close();
    }
  },
  900_000,
);
