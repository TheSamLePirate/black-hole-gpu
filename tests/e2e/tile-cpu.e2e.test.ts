import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T8 — the tiles' work on the page's thread (docs/PLAN-REFRACTION-HORIZONS.md T8: "no long task of the main thread due to the
// tiles"): the F-35 low over Paris (450 m, 120 m/s, a July morning) on its autopilot for 25 s, its tiles streaming in —
// the relief, the imagery, the orthophotos —, the counters of src/system/earth-tiles.ts TILE_CPU reset at the start: the
// decoding (bitmaps drawn and read back, Terrarium's heights), the colours (EOX's, the orthophotos' fits, the lights), the
// writes (put); and the page's long tasks (PerformanceObserver "longtask", > 50 ms) over the same 25 s.
// Output: remote-results/tile-cpu/tile-cpu-<side><run>.json (AB_SIDE, AB_RUN: an A/B through scripts/ab-e2e.ts), a shot at
// the end.
// TC_PROFILE=1: Chrome's CPU profile over the flight, the long tasks' time given to the functions it was spent in (out.profile).
// Done when: the flight flown 25 s, the counters and the long tasks read, no GPU error.
// Duration: ~1.5 min (the airfield's start, 25 s of flight).
const OUT = process.env.TC_OUT ?? "remote-results/tile-cpu";
const TAG = `${process.env.AB_SIDE ?? "X"}${process.env.AB_RUN ?? "0"}`;
afterAll(stopServer);

test.skipIf(!E2E)(
  "T8: the tiles' work on the page's thread in a low flight over Paris — its total, its longest piece, the long tasks",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { tag: TAG };
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate("2026-07-10T08:30:00Z"); __bh.game.flyAt(48.80, 2.20, 450, 60, 120);
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
      await app.settled();
      await app.js(`(() => { const c = __bh.camera;
        if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        if (c.jetModes.spd !== null) c.jetModes.spd = 120; return 1; })()`);
      // (TC_PROFILE=1: Chrome's CPU profile over the flight — the long tasks' time given to the functions it was spent in)
      const profile = process.env.TC_PROFILE === "1";
      let p0 = 0;
      if (profile) {
        await app.cdp.send("Profiler.enable");
        await app.cdp.send("Profiler.setSamplingInterval", { interval: 500 });
        await app.cdp.send("Profiler.start");
        p0 = await app.js<number>(`performance.now()`);
      }
      // (the counters from now, the long tasks over the flight)
      out.flight = await app.js(`(async () => {
        const T = __bh.renderer.earthTiles.cpu ?? {}; // (none before T8a: the long tasks alone)
        for (const k of Object.keys(T)) Object.assign(T[k], { ms: 0, max: 0, n: 0 });
        const long = [];
        const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) { long.push(e.duration); window.__longs.push([e.startTime, e.duration]); } });
        window.__longs = [];
        obs.observe({ entryTypes: ["longtask"] });
        const r = __bh.renderer, f0 = r.completedFrames, t0 = performance.now(), loaded0 = r.earthTiles.loaded;
        while (performance.now() - t0 < 25000) { __bh.touch(); await new Promise((q) => setTimeout(q, 250)); }
        obs.disconnect();
        const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ms: +v.ms.toFixed(1), max: +v.max.toFixed(2), n: v.n }]));
        long.sort((a, b) => b - a);
        return { s: +((performance.now() - t0) / 1000).toFixed(1), frames: r.completedFrames - f0, tilesLoaded: r.earthTiles.loaded - loaded0,
          pending: r.earthTiles.pending, orthoPending: r.earthTiles.orthoPending, cpu: round(T),
          longTasks: { n: long.length, totalMs: Math.round(long.reduce((a, b) => a + b, 0)), worst: long.slice(0, 5).map((x) => Math.round(x)) },
          specialise: r.specialiseCpu ?? null, windows: window.__longs }; })()`);
      console.log(`  ${TAG} flight: ${JSON.stringify(out.flight)}`);
      if (profile) {
        const { profile: pr } = await app.cdp.send<{
          profile: {
            nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
            startTime: number;
            samples: number[];
            timeDeltas: number[];
          };
        }>("Profiler.stop", {}, 60);
        const longs = ((out.flight as { windows?: [number, number][] }).windows ?? []).slice();
        const name = new Map(pr.nodes.map((n) => [n.id, `${n.callFrame.functionName || "(anonymous)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`]));
        // (each sample's time on the page's clock: the profile's start taken as p0 — a few ms off at most)
        // (each node's parent: a sample's whole stack — the inclusive time of every function on it)
        const parent = new Map<number, number>();
        for (const n of pr.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
        const inclusive = new Map<string, number>();
        const inLong = new Map<string, number>();
        const perTask = longs.map(() => new Map<string, number>());
        let t = pr.startTime;
        for (let i = 0; i < pr.samples.length; i++) {
          t += pr.timeDeltas[i]!;
          const at = p0 + (t - pr.startTime) / 1000;
          const k = longs.findIndex(([s0, d]) => at >= s0 && at <= s0 + d);
          if (k < 0) continue;
          const f = name.get(pr.samples[i]!)!;
          const dt = (pr.timeDeltas[i + 1] ?? 500) / 1000;
          inLong.set(f, (inLong.get(f) ?? 0) + dt);
          const seen = new Set<string>();
          for (let id: number | undefined = pr.samples[i]!; id !== undefined; id = parent.get(id)) {
            const g = name.get(id)!;
            if (seen.has(g)) continue;
            seen.add(g);
            inclusive.set(g, (inclusive.get(g) ?? 0) + dt);
          }
          perTask[k]!.set(f, (perTask[k]!.get(f) ?? 0) + dt);
        }
        const top = (m: Map<string, number>, n: number) =>
          [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([f, ms]) => `${ms.toFixed(1)} ms ${f}`);
        out.profile = {
          inLongTasks: top(inLong, 15),
          inclusive: top(inclusive, 25),
          tasks: longs.map(([s0, d], k) => ({ at: Math.round(s0 - p0), ms: Math.round(d), top: top(perTask[k]!, 6) })),
        };
        console.log(`  ${TAG} profile: ${JSON.stringify(out.profile, null, 1)}`);
      }
      await app.shot(`${OUT}/${TAG}-end.png`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await app.close();
    }
    writeFileSync(`${OUT}/tile-cpu-${TAG}.json`, JSON.stringify(out, null, 2));
    expect(out.gpuErrors).toBe(0);
  },
  240_000,
);
