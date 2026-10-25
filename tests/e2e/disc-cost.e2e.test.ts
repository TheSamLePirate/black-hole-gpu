import { afterAll, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// What a ray of the sky's discs costs (TERRE-UNREAL U8 → U9): the total eclipse of 12 August 2026 over Burgos, the F-35 at
// 1 800 m on its autopilot, the stabilised telescope on the Sun at 1.6° — the Moon and the Sun's 4-radii rectangle over the
// whole field, a 4 × 4 block's pixel a frame —; the GPU's time a frame (the median of 30 completions), then the same with a
// part of the ray left out (renderer.tune: trace.wgsl TUNE_SKIP — 128 the worlds' air, 256 the corona, 512 the stars'
// discs, 32 the bodies met), each its own kernel compiled first. Figures in $OUT/disc-cost.json, a shot a lever.
// Duration: ~4 min a lever on an M1 Max (its compile), ~25 min in all.
// Done when: every lever measured.

const OUT = process.env.AB_OUT ?? "remote-results";
const LEVERS: [string, Record<string, number>][] = (
  process.env.DISC_LEVERS
    ? JSON.parse(process.env.DISC_LEVERS)
    : [
        ["base", {}],
        ["no-air", { TUNE_SKIP: 128 }],
        ["no-corona", { TUNE_SKIP: 256 }],
        ["no-star-discs", { TUNE_SKIP: 512 }],
        ["no-bodies", { TUNE_SKIP: 32 }],
      ]
) as [string, Record<string, number>][];
const FIELD = Number(process.env.DISC_FIELD ?? 1.6);
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthRasterShading: "every", earthRasterScale: 1, dynamicResolution: false, autoGear: false, f35AutoProtect: false, telescopeSpot: true, showFps: true }`;

afterAll(stopServer);

test.skipIf(!E2E)(
  "the sky's discs' ray: its parts' cost in the telescope",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = () =>
        app.js(`(() => { __bh.game.setDate("2026-08-12T18:29:00Z"); __bh.game.flyAt(42.34, -3.7, 1800, 285, 140);
          __bh.settings.shipMount = "cockpit"; __bh.settings.target = "sun"; return 1; })()`);
      const hold = () =>
        app.js(`(() => { const c = __bh.camera;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          if (c.jetModes.spd !== null) c.jetModes.spd = 140; return 1; })()`);
      await place();
      await Bun.sleep(1500);
      await hold();
      const settled = (ms: number) =>
        app
          .waitFor(
            `__bh.renderer.rasterLiteActive && __bh.renderer.variantQueue.pending === 0 && __bh.renderer.compilingNow.length === 0`,
            ms,
          )
          .catch(() => console.warn("  kernels not all in"));
      await settled(900_000);
      if (!(await app.js<boolean>(`__bh.settings.lookAt`))) await app.press("KeyC");
      await Bun.sleep(1000);
      if (!(await app.js<boolean>(`__bh.settings.telescope`))) await app.press("KeyY");
      const results: Record<string, unknown>[] = [];
      for (const [name, tune] of LEVERS) {
        await app.js(`(() => { __bh.renderer.tune = ${JSON.stringify(tune)}; return 1; })()`);
        await Bun.sleep(1000);
        await settled(900_000);
        // (the clock back at mid-totality, the jet placed again — minutes of compile flown meanwhile)
        await place();
        await Bun.sleep(1500);
        await hold();
        await app.js(`(__bh.camera.setFov(${FIELD}), 1)`);
        await Bun.sleep(6000);
        const st = await app.js<Record<string, unknown>>(`(async () => { const r = __bh.renderer, f0 = r.completedFrames;
          await new Promise((q) => setTimeout(q, 4000));
          return { fps: +((r.completedFrames - f0) / 4).toFixed(1), gpuMs: +[...r.completedDurations].slice(-30).sort((a, b) => a - b)[15]?.toFixed(1),
            discs: r.discRects(r.live).map((x) => [x[2], x[3] & 0xffff, (x[3] >> 18) & 3]), size: [r.live.width, r.live.height],
            fov: +__bh.settings.fov.toFixed(3), tune: r.tune }; })()`);
        await app.shot(`${OUT}/disc-cost-${name}.png`);
        console.log(`  ${name}: ${JSON.stringify(st)}`);
        results.push({ name, ...st });
        writeFileSync(`${OUT}/disc-cost.json`, JSON.stringify(results, null, 1));
      }
    } finally {
      app.close();
    }
  },
  3_600_000,
);
