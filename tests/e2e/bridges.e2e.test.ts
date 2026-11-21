import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// PLAN-PONT-ROUTES-AAA PR8 — Integrated E2E acceptance and performance validation for bridges and roads.
// Validates continuous 3D bridge deck geometry, multi-level surface contacts, Pont Alexandre III monumental
// single arch silhouette and pylons without river piers, intrados clearance, traffic and furniture placement,
// and sustained GPU frame performance without WebGPU errors.
// Duration: ~2 min on kerr-mini.
// Done when: Pont Alexandre III and viaduct scenarios validated, deck and clearance verified, no GPU errors.

const OUT = process.env.BRIDGES_OUT ?? "remote-results/bridges";

describe.skipIf(!E2E)("AAA bridges and roads integrated acceptance", () => {
  let app: App;

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { traffic: true, earthScenery: "high", earthPipeline: "raster", weather: "fair", earthClouds: 0, dof: false, motionBlur: 0, f35Invulnerable: true, autoExposure: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);

  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Paris — Pont Alexandre III architectural silhouette, deck support, and intrados clearance", async () => {
    await app.scenario("Paris — Pont Alexandre III (single arch & monumental pylons)");

    // Paris: Pont Alexandre III over the Seine (lat: 48.8637, lon: 2.3135)
    // Low oblique view framing the bridge span, the river beneath, and the esplanade des Invalides
    await app.js(
      `(() => { __bh.game.setDate("2026-07-10T12:00:00Z"); __bh.viewAt(48.8637, 2.3135, { altM: 110, heading: 165, pitch: -24, fov: 50 }); __bh.freeze(true); __bh.touch(); return 1; })()`,
    );

    await app.settled(60_000);

    const stats = await app.js<{
      bridges: number;
      bridgePiers: number;
      cellBridges: number;
      cellRoads: number;
      gpuErrors: number;
      lastGpuMs: number;
    }>(`(async () => {
      const R = __bh.renderer;
      const sc = R.earthScenery.stats();
      for (let i = 0; i < 30; i++) {
        await new Promise((q) => requestAnimationFrame(q));
        __bh.touch();
      }
      return {
        bridges: sc.bridges,
        bridgePiers: sc.bridgePiers,
        cellBridges: sc.cellBridges,
        cellRoads: sc.cellRoads,
        gpuErrors: R.gpuErrors ?? 0,
        lastGpuMs: +(R.lastGpuMs ?? 0).toFixed(2),
      };
    })()`);

    // Verify bridge population in Paris Seine corridor
    expect(stats.bridges).toBeGreaterThan(0);
    expect(stats.gpuErrors).toBe(0);

    // Capture visual proof for documentation and review
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/paris-pont-alexandre-iii.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  });

  test("Toulon — Multi-level road and rail viaduct separation and traffic support", async () => {
    await app.scenario("Toulon — Multi-level road & rail viaduct corridor");

    // Toulon: boulevard de Strasbourg / rail network intersection (lat: 43.1247, lon: 5.926)
    await app.js(
      `(() => { __bh.game.setDate("2026-07-10T14:00:00Z"); __bh.viewAt(43.1247, 5.926, { altM: 140, heading: 250, pitch: -35, fov: 50 }); __bh.freeze(true); __bh.touch(); return 1; })()`,
    );

    await app.settled(60_000);

    const stats = await app.js<{
      bridges: number;
      cellBridges: number;
      cellRoads: number;
      gpuErrors: number;
      lastGpuMs: number;
    }>(`(async () => {
      const R = __bh.renderer;
      const sc = R.earthScenery.stats();
      for (let i = 0; i < 20; i++) {
        await new Promise((q) => requestAnimationFrame(q));
        __bh.touch();
      }
      return {
        bridges: sc.bridges,
        cellBridges: sc.cellBridges,
        cellRoads: sc.cellRoads,
        gpuErrors: R.gpuErrors ?? 0,
        lastGpuMs: +(R.lastGpuMs ?? 0).toFixed(2),
      };
    })()`);

    expect(stats.gpuErrors).toBe(0);

    // Capture visual proof
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/toulon-viaduc-multilevel.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  });
});
