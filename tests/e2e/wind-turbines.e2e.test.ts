import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q8 D1's first step — the wind turbines (system/turbines.ts: Overture's base theme, OSM's power=generator wind; their tower,
// nacelle and blades in the scenery's meshes, the raster's RASTER_CODE.turbine, shaded by shadeLite white and matte, their shadows
// in the buildings' map): over the Beauce between two wind farms (WT_SITE "lat,lon"), the F-35 150 m over the ground facing
// east, the cockpit looking 3° down, 13:00 UTC in July, frozen, the exposure locked; the scenery's turbines counted, a shot, and
// another a second later (the blades turned).
// WT_HDG, WT_ALT, WT_PITCH: the heading [°], the height over the ground [m], the look's pitch [°] (90, 150, −3) — the pylons' view: WT_SITE=48.2790,1.7200
// WT_HDG=315 WT_ALT=60, a 225 kV line ~580 m ahead.
// WT_ISO: the time (the obstruction lights: "2026-07-10T22:00:00Z", red flashes 40 a minute on the nacelles).
// WT_WAIT: the scenery's wait [s] (60).
// WT_OUT: the shots (remote-results/wind-turbines).
// Duration: ~3 min on this Mac.
// Done when: the turbines counted (some), both shots taken, no GPU error.
const OUT = process.env.WT_OUT ?? "remote-results/wind-turbines";
const [LAT, LON] = (process.env.WT_SITE ?? "48.2350,1.8050").split(",").map(Number) as [number, number];
const HDG = Number(process.env.WT_HDG ?? 90);
const ALT = Number(process.env.WT_ALT ?? 150);
const PITCH = Number(process.env.WT_PITCH ?? -3);
const WAIT = Number(process.env.WT_WAIT ?? 60) * 1000;
afterAll(stopServer);
test.skipIf(!E2E)(
  "D1: wind turbines in the scenery — counted, seen from the cockpit",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair" }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = process.env.WT_ISO ?? "2026-07-10T13:00:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(${LAT}, ${LON}, ${ALT}, ${HDG}, 0); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${PITCH}); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
      );
      await app
        .waitFor(
          `(() => { __bh.touch(); const r = __bh.renderer, sc = r.earthScenery.stats(); return r.earthTiles.pending === 0 && r.earthTiles.orthoPending === 0 && sc.status === "ready" && !sc.pending; })()`,
          WAIT,
        )
        .catch(async () =>
          console.warn(`  still loading after 60 s — ${await app.js<string>(`JSON.stringify(__bh.renderer.earthScenery.stats().status)`)}`),
        );
      await app.settled(120_000);
      await app.js(
        `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 120; i++) { __bh.touch(); await f(); } return 1; })()`,
      );
      out.stats = await app.js<Record<string, unknown>>(
        `(() => { const s = __bh.renderer.earthScenery.stats(); return { turbines: s.turbines, pylons: s.pylons, cables: s.cables, cars: s.cars, roads: s.trafficRoads, pieces: s.roadPieces, surveyError: s.surveyError, phases: s.phases, windFrom: +(__bh.renderer.sceneryRaster?.windFrom ?? -1).toFixed(1), status: s.status, errors: s.errors ?? s.surveyErrors ?? null, pipe: __bh.renderer.earthPipelineNow(__bh.settings), mount: __bh.settings.shipMount }; })()`,
      );
      console.log(`  ${JSON.stringify(out.stats)}`);
      await app.shot(`${OUT}/cockpit.png`);
      // (the blades turning: the world run a second and frozen again — the same view, the rotors a sixth of a turn on)
      await app.js(`new Promise((q) => { __bh.freeze(false); setTimeout(() => { __bh.freeze(true); q(1); }, 1000); })`);
      await app.settled(60_000);
      await app.shot(`${OUT}/cockpit-1s.png`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/turbines.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    const st = out.stats as { turbines: number; pylons: number; cars: number };
    expect(st.turbines + st.pylons + st.cars).toBeGreaterThan(0);
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
