import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS, sceneryReady } from "./lib/plan-views";

// The night (Q2, the calibrated night — docs/PLAN-REFRACTION-HORIZONS.md): Paris from the F-35's cockpit at 300 m, from 12 km,
// from 400 km, on a moonless night (9 Nov 2026, the new Moon) and under the full Moon (24 Nov 2026) — six shots without the
// interface, the exposure the meter chose for each, the screen's brightness over the city and over the dark country round it.
// Figures and shots in remote-results/night-views/<tag> (NV_TAG, else the A/B side and run — scripts/ab-e2e.ts —, else "solo").
// Done when: the six views are shot (tiles waited 30 s at most each, the scenery — the streets — 60 s for the low one), no GPU
// error. NV_ONLY=300m (a view's name) for one height.
// Duration: ~2.5 min (kerr-mini).
const TAG = process.env.NV_TAG ?? (process.env.AB_SIDE ? `${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "solo");
const OUT = `remote-results/night-views/${TAG}`;
afterAll(stopServer);
const NIGHTS = [
  { name: "moonless", date: "2026-11-09T21:30:00Z" },
  { name: "fullmoon", date: "2026-11-24T23:00:00Z" },
];
// (west of Paris looking east at it: La Défense then the city; higher, the same line of sight over it)
const VIEWS = [
  { name: "300m", at: [48.86, 2.15, 300, 95, 120] },
  { name: "12km", at: [48.86, 1.95, 12000, 95, 200] },
  { name: "400km", at: [48.0, 0.5, 400000, 60, 200] },
];

test.skipIf(!E2E)(
  "the night over Paris at three heights, moonless and under the full Moon",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const t0 = performance.now();
    const step = (what: string) => console.log(`  [${((performance.now() - t0) / 1000).toFixed(0)} s] ${what}`);
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const n of NIGHTS)
        for (const v of VIEWS.filter((x) => !process.env.NV_ONLY || x.name === process.env.NV_ONLY)) {
          const place = `__bh.game.flyAt(${v.at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
          await app.js(`(() => { __bh.game.setDate(${JSON.stringify(n.date)}); ${place} __bh.freeze(true); return 1; })()`);
          await app.waitFor(`__bh.renderer.earthTiles.pending <= 4`, 30_000).catch(() => {});
          if (v.at[2]! < 1000) step(`${n.name} ${v.name}: scenery ${JSON.stringify(await sceneryReady(app, 60_000))}`);
          await app.js(`(() => { ${place} return 1; })()`);
          await app.settled(30_000);
          // (the exposure settled: 3 s of frames — the meter eases over ~1 s)
          await app.js(
            `new Promise((r) => { const t = performance.now(); const f = () => { __bh.touch(); if (performance.now() - t < 3000) requestAnimationFrame(f); else r(1); }; f(); })`,
          );
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          const file = `${OUT}/${n.name}-${v.name}.png`;
          await app.shot(file);
          await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
          const ev = await app.js<number>(`(() => +__bh.renderer.ev(__bh.settings).toFixed(2))()`);
          const r = { ev, file };
          out[`${n.name}-${v.name}`] = r;
          step(`${n.name} ${v.name}: EV ${ev}`);
        }
      const gpuErrors = await app.js<number>(`(() => __bh.renderer.gpuErrors)()`);
      writeFileSync(`${OUT}/night-views.json`, JSON.stringify({ ...out, gpuErrors }, null, 1));
      expect(gpuErrors).toBe(0);
    } finally {
      app.close();
    }
  },
  6 * 60_000,
);
