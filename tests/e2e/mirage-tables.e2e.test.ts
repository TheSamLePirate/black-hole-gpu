import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// R6a-ciel — the mirages' tables in the page (renderer.mirageProfile, renderer.updateMirage → mirage-worker.js → the tracer's
// table TABLE_MIR): over the Atlantic off Biarritz, the F-35 at 10 m over the sea, a warm sea forced: the worker's answer
// published (renderer.mirageNow) within 20 s, for the eye's height; then "off": the tables cleared. Nothing drawn yet — the
// GPU's reading is the next lot.
// Duration: ~1 min on this Mac.
// Done when: the tables published for a warm sea at ~10 m, then cleared, no GPU error.
afterAll(stopServer);
test.skipIf(!E2E)(
  "R6a-ciel: the mirages' tables traced off the frame and published",
  async () => {
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { f35Invulnerable: true, earthPipeline: "raster" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.flyAt(43.5, -1.8, 10, 270, 100); __bh.settings.shipMount = "cockpit"; return 1; })()`);
      await app.js(`new Promise((q) => setTimeout(() => { __bh.freeze(true); __bh.renderer.mirageProfile = "warmSea"; q(1); }, 600))`);
      const t0 = Date.now();
      await app.waitFor(`__bh.renderer.mirageNow.startsWith("warmSea@")`, 20_000);
      const now = await app.js<string>(`__bh.renderer.mirageNow`);
      console.log(`  published: ${now} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      const h = Number(now.split("@")[1]);
      expect(h).toBeGreaterThan(1);
      expect(h).toBeLessThan(60);
      await app.js(`(() => { __bh.renderer.mirageProfile = "off"; __bh.touch(); return 1; })()`);
      await app.waitFor(`__bh.renderer.mirageNow === ""`, 5_000);
      const errs = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  cleared; GPU errors ${errs}`);
      expect(errs).toBe(0);
    } finally {
      await app.close();
    }
  },
  3 * 60_000,
);
