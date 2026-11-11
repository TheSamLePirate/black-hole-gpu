import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// The ground's mesh cut along the runways (terrain-raster-mesh.ts), in the raster pipeline, with the real tiles: the F-35 put
// 60 m over Kennedy's oblique runway (150°) and Le Bourget's (249°), 1 km before its middle, held to read the patch's mesh
// (cut along the runway: conforming), then flown down the runway STABILISED — gear down, the autopilot holding the height and
// the runway's heading, the autothrottle 85 m/s —: 8 s to settle, then 12 s measured: the frame times, the mesh's rebuilds,
// the craft's pitch, bank and height (its steadiness). Shots before and after. Figures in remote-results/runway-mesh.
// Done when: both runways are flown stabilised, each with its mesh cut along the runway, every mesh in flight taken ready from
// the worker (none made in a frame), no GPU error.
// Duration: ~1.5 min (this Mac, in a window).
const OUT = process.env.RM_OUT ?? "remote-results/runway-mesh";
afterAll(stopServer);
const SITES = [
  { name: "kennedy", lat: 28.6328, lon: -80.7061, rwy: 150 },
  { name: "le-bourget", lat: 48.974, lon: 2.45825, rwy: 249 },
];
const STATS = `(() => { const s = __bh.renderer.terrainRasterStats; return { level: s.level, conforming: s.conforming, cutTriangles: s.cutTriangles,
  triangles: s.triangles, meshBuilds: s.meshBuilds, meshAhead: s.meshAhead, meshInFrame: s.meshInFrame, rings: s.rings, error: s.error, reason: s.reason }; })()`;

test.skipIf(!E2E)(
  "the ground's mesh cut along the runways: conforming, rebuilt in flight without a hitch",
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
      step("the F-35 in");
      for (const s of SITES) {
        // (1 000 m back along the runway's heading: the 20 s at 85 m/s end 700 m past the middle, over the runway)
        const back = 1000 / 6.371e6,
          h = (s.rwy * Math.PI) / 180;
        const lat0 = s.lat - (back * Math.cos(h) * 180) / Math.PI,
          lon0 = s.lon - ((back * Math.sin(h)) / Math.cos((s.lat * Math.PI) / 180)) * (180 / Math.PI);
        const place = `__bh.game.flyAt(${lat0}, ${lon0}, 60, ${s.rwy}, 85); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
        await app.js(`(() => { __bh.game.setDate("2026-07-10T15:00:00Z"); ${place} __bh.freeze(true); return 1; })()`);
        const tiles = await app.waitFor(`__bh.renderer.earthTiles.pending <= 2`, 45_000).then(
          () => true,
          () => false,
        );
        await app.js(`(() => { ${place} return 1; })()`);
        await app.settled(30_000);
        const held = await app.js<Record<string, unknown>>(STATS);
        step(`${s.name}: tiles ${tiles ? "in" : "NOT all in after 45 s"}; held over the runway ${JSON.stringify(held)}`);
        await app.shot(`${OUT}/${s.name}-start.png`);
        // (12 s down the runway, the autopilot holding the height: the frame times and the mesh's rebuilds)
        const flown = await app.js<
          Record<string, unknown>
        >(`(async () => { const R = __bh.renderer, c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(() => q(1)));
          const meter = () => document.querySelector('[data-testid="data-meter"]')?.textContent || "";
          const b0 = R.terrainRasterStats.meshBuilds; let cut = 0, conf = 0, n = 0, builds = R.terrainRasterStats.meshBuilds; const ms = [], withBuild = [], worst = [];
          let last = performance.now();
          // (stabilised: gear down at once, the autopilot on the height and the runway's heading, the autothrottle at 85 m/s)
          // (the world running first — modes engaged while frozen are dropped at the next step: the craft not flown as a plane yet)
          __bh.freeze(false); await frame(); await frame();
          c.gearDown = true; c.gearExt = 1; c.gearInit = true;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          c.jetModes.alt = c.jetFigures()?.h ?? c.jetModes.alt; c.jetModes.hdg = ${h}; c.jetModes.spd = 85;
          const s0 = performance.now(); while (performance.now() - s0 < 8000) await frame();
          const engaged = { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null, throttle: +c.pilot.throttle.toFixed(2) };
          last = performance.now(); builds = R.terrainRasterStats.meshBuilds; const bs = builds, ah0 = R.terrainRasterStats.meshAhead, if0 = R.terrainRasterStats.meshInFrame;
          const deg = 180 / Math.PI; let pMin = 1e9, pMax = -1e9, bMax = 0, aMin = 1e9, aMax = -1e9;
          const t0 = performance.now();
          while (performance.now() - t0 < 12000) { await frame(); const now = performance.now(), dt = now - last; last = now; n++; ms.push(dt);
            const at = c.attitudeNow(), g = c.geoNow?.();
            if (at.pitch !== undefined) { pMin = Math.min(pMin, at.pitch * deg); pMax = Math.max(pMax, at.pitch * deg); bMax = Math.max(bMax, Math.abs(at.bank * deg)); }
            if (g) { aMin = Math.min(aMin, g.alt); aMax = Math.max(aMax, g.alt); }
            const st = R.terrainRasterStats; if (st.conforming) conf++; cut = Math.max(cut, st.cutTriangles);
            // (a frame whose mesh was rebuilt — the rebuild ran in the frame before this one's end)
            if (st.meshBuilds !== builds) { withBuild.push(+dt.toFixed(1)); builds = st.meshBuilds; }
            if (dt > 40) worst.push({ ms: +dt.toFixed(1), at: +((now - t0) / 1000).toFixed(1), loading: meter() }); }
          __bh.freeze(true); ms.sort((a, b) => a - b);
          return { frames: n, frameMs: +ms[n >> 1].toFixed(1), p95: +ms[Math.floor(0.95 * n)].toFixed(1), maxMs: +ms[n - 1].toFixed(1),
            meshBuilds: R.terrainRasterStats.meshBuilds - bs, meshAhead: R.terrainRasterStats.meshAhead - ah0, meshInFrame: R.terrainRasterStats.meshInFrame - if0, workerMs: R.terrainRasterStats.meshWorkerMs, upcoming: [__bh.renderer.terrainSurfaceCache?.upcomingTaken, __bh.renderer.terrainSurfaceCache?.upcomingMissed], gear: c.gearDown, engaged, ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null,
            pitchDeg: [+pMin.toFixed(1), +pMax.toFixed(1)], bankMaxDeg: +bMax.toFixed(1), altRangeM: +(aMax - aMin).toFixed(1), buildFrameMs: withBuild, slow: worst.slice(0, 8), conformingShare: +(conf / n).toFixed(2), maxCut: cut, gpuErrors: R.gpuErrors }; })()`);
        step(`${s.name}: flown 12 s ${JSON.stringify(flown)}`);
        await app.settled(20_000);
        await app.shot(`${OUT}/${s.name}-end.png`);
        out[s.name] = { tiles, held, flown };
      }
      writeFileSync(`${OUT}/runway-mesh.json`, JSON.stringify(out, null, 1));
      for (const s of SITES) {
        const r = out[s.name] as {
          held: { error: unknown };
          flown: {
            gpuErrors: number;
            meshInFrame: number;
            buildFrameMs: number[];
            conformingShare: number;
            ap: boolean;
            athr: boolean;
            altRangeM: number;
          };
        };
        expect(r.held.error).toBeFalsy();
        expect(r.flown.gpuErrors).toBe(0);
        expect(r.flown.conformingShare, `${s.name}: the mesh never cut along the runway`).toBeGreaterThan(0);
        // (stabilised: the autopilot and the autothrottle still on at the end, the height held within 15 m)
        expect(r.flown.ap && r.flown.athr, `${s.name}: the autopilot or the autothrottle dropped`).toBe(true);
        expect(r.flown.altRangeM, `${s.name}: the height not held`).toBeLessThan(15);
        // (no mesh made in a frame in flight: every one taken ready from the worker — made ahead for the next window; the frames
        // with a rebuild then only upload it: their times logged, a slower machine's not judged against a fixed bound)
        expect(r.flown.meshInFrame, `${s.name}: a mesh made in the frame in flight`).toBe(0);
      }
    } finally {
      app.close();
    }
  },
  4 * 60_000,
);
