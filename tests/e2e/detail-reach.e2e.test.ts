import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The detail's reach (settings.detailReach — Normal, Far, Very far: the scenery's box ×1, 1.5, 2 wide, the relief's
// windows 4 or 8 tiles a side, the tiles kept past them and the ring loaded ahead; docs/PLAN-RENDU-PERF.md 14.): from
// the cockpit, at each place (PLACES=alps,tarifa) and each reach (REACH=normal,far,veryFar — alternated if asked
// again), the craft held where it was put, the ground's tiles and the scenery waited for — the time they took, what
// they hold —, the image converged and shot; then flown FRAMES frames: the trace pass's time.
// E2E_SHOTS=<dir>: <place>-<reach>.png.

const PLACES: Record<string, string> = {
  alps: `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
  tarifa: `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.1, -5.55, 600, 110, 210);`,
};
const places = (process.env.PLACES ?? "alps,tarifa").split(",");
const reaches = (process.env.REACH ?? "normal,far,veryFar").split(",");
const FRAMES = Number(process.env.FRAMES ?? 90);

describe.skipIf(!E2E)("the detail's reach", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: true, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const seen = new Map<string, number>();
  for (const pl of places)
    for (const rc of reaches) {
      const n = (seen.get(`${pl}-${rc}`) ?? 0) + 1;
      seen.set(`${pl}-${rc}`, n);
      const tag = n > 1 ? `${rc}${n}` : rc;
      test(`${pl}: ${tag}`, async () => {
        // (put there, held — the clock stopped: the same view for every reach —, the reach asked)
        await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64 });
          ${PLACES[pl]} __bh.settings.shipMount = "cockpit"; __bh.settings.detailReach = "${rc}"; __bh.settings.animate = false;
          window.__t0 = performance.now(); window.__loaded0 = __bh.renderer.earthTiles.loaded; return 1; })()`);
        await app.waitFor(`!!__bh.renderer.variantReady`, 180_000).catch(() => {});
        // (the ground's tiles whole and the scenery built for this reach, a second and a half calm)
        const load = await app.js<{
          ms: number;
          tiles: number;
          kept: number;
          pending: number;
          scenery: Record<string, unknown>;
        }>(`(async () => {
          const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          let calm = 0;
          while (performance.now() - window.__t0 < 150000) {
            const st = r.earthScenery.stats();
            const ok = r.earthTiles.pending === 0 && !r.earthScenery.pending && st.status === "ready";
            calm = ok ? calm || performance.now() : 0; if (calm && performance.now() - calm > 1500) break; await frame(); }
          const st = r.earthScenery.stats();
          return { ms: (calm || performance.now()) - window.__t0, tiles: r.earthTiles.loaded - window.__loaded0, kept: r.earthTiles.kept, pending: r.earthTiles.pending,
            scenery: { reach: st.reach, gpuMB: st.gpuBytes / 2 ** 20, trees: st.trees, forestCells: st.forestCells, buildings: st.buildings, roads: st.roads, workerMs: st.workerMs } };
        })()`);
        console.log(
          `  ${pl} ${tag}: loaded in ${(load.ms / 1000).toFixed(1)} s — ${load.tiles} tiles (${load.pending} pending, ${load.kept} kept ahead) — the scenery ${JSON.stringify(load.scenery)}`,
        );
        expect(load.pending).toBe(0);
        // (the image converged, shot)
        for (let i = 0; i < 80; i++) {
          await Bun.sleep(500);
          if (await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`)) break;
        }
        if (shots) {
          await Bun.$`mkdir -p ${shots}`;
          await app.shot(`${shots}/${pl}-${tag}.png`);
        }
        // (flown FRAMES frames: the trace pass's time, the tiles loaded meanwhile — the ring's drawn from memory)
        const fl = await app.js<{ trace: number; tiles: number; kept: number; short: number }>(`(async () => {
          const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          __bh.settings.animate = true; const l0 = r.earthTiles.loaded;
          r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
          let done = 0, last = r.lastDoneAt, traceMs = 0, short = 0;
          while (done < ${FRAMES}) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++;
            traceMs += r.prof.table().find((p) => p.label === "trace")?.last ?? 0; if (r.earthTiles.pending) short++; } }
          return { trace: traceMs / done, tiles: r.earthTiles.loaded - l0, kept: r.earthTiles.kept, short: short / done };
        })()`);
        console.log(
          `  ${pl} ${tag}: the trace ${fl.trace.toFixed(1)} ms a frame flown — ${fl.tiles} tiles loaded meanwhile, ${fl.kept} kept, ${(100 * fl.short).toFixed(0)} % of the frames with a window short`,
        );
        await app.js(`(() => { __bh.settings.detailReach = "normal"; return 1; })()`);
      }, 400_000);
    }
});
