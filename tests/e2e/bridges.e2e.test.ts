import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PONT-ROUTES-AAA (review A10, B1–B3, 24 Nov 2026): the bridges and roads in their real places, the game's default setup — a
// Seine bridge cut by a z 14 tile's edge drawn whole (Pont de Grenelle), Pont Alexandre III's pylons and arch, the Millau viaduct's
// masts, stays and guardrails on its deck, the Golden Gate from the Marin Headlands at ~2 km and from ~30 km over the sea, a wet
// asphalt street in Paris — each view waited on its conditions (the scene full, its bridges in, the compiles done), shot, its GPU
// time read (renderer.lastGpuMs, p50 and p95 over 90 images), nothing assumed: a condition not met is said and the view still shot.
// Duration: ~6 min on kerr-mini (IGN and OSM tiles from the Earth data on disk).
// Done when: the six views shot with their GPU times, the scene's bridge counts asserted, no page error.

const OUT = process.env.BRIDGES_OUT ?? "remote-results/bridges";

/** a view: where the camera stands, what it aims at, the date (its Sun's noon) */
interface View {
  key: string;
  label: string;
  at: [number, number];
  altKm: number;
  aim: [number, number];
  /** the scene must hold this (a page expression over `sc`, earthScenery.stats()) */
  holds: string;
  rain?: boolean;
}

const VIEWS: View[] = [
  {
    key: "grenelle-tile-edge",
    label: "Paris — Pont de Grenelle, cut by a z 14 tile's edge (48.85026° N): one deck",
    at: [48.8478, 2.2842],
    altKm: 0.12,
    aim: [48.8499, 2.2797],
    holds: "sc.cellBridges > 0",
  },
  {
    key: "alexandre-iii",
    label: "Paris — Pont Alexandre III: its four pylons, its arch, its deck",
    at: [48.8616, 2.3156],
    altKm: 0.1,
    aim: [48.8637, 2.3135],
    holds: "sc.cellBridges > 0",
  },
  {
    key: "paris-wet-street",
    label: "Paris — a wet asphalt street in the rain (rue de Rivoli): its wheel paths, puddles, sheen",
    at: [48.8603, 2.3392],
    altKm: 0.025,
    aim: [48.8612, 2.3352],
    holds: "sc.cellRoads > 0",
    rain: true,
  },
  {
    key: "millau",
    label: "Millau — the viaduct's masts, stays and guardrails on its deck",
    at: [44.0745, 3.0395],
    altKm: 0.45,
    aim: [44.08, 3.0224],
    holds: "sc.notableBridges >= 1",
  },
  {
    key: "golden-gate-2km",
    label: "San Francisco — the Golden Gate from the Marin Headlands, ~2 km",
    at: [37.8335, -122.4985],
    altKm: 0.25,
    aim: [37.8197, -122.4786],
    holds: "sc.notableBridges >= 1",
  },
  {
    key: "golden-gate-30km",
    label: "San Francisco — the Golden Gate from ~30 km over the sea: its towers and cables",
    at: [37.62, -122.73],
    altKm: 0.45,
    aim: [37.8197, -122.4786],
    holds: "sc.notableBridges >= 1",
  },
];

describe.skipIf(!E2E)("bridges and roads AAA: real places, default setup", () => {
  let app: App;
  const results: Record<string, unknown>[] = [];

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
    app.steps(VIEWS.map((v) => v.label));
    app.estimate(360);
  }, 180_000);

  afterAll(async () => {
    console.log(JSON.stringify(results, null, 1));
    app?.close();
    stopServer();
  });

  for (const v of VIEWS)
    test(v.label, async () => {
      await app.step(v.label);
      const noon = new Date(Date.UTC(2026, 5, 21, 12) - (v.at[1] / 15) * 3600_000 + 2 * 3600_000).toISOString();
      await app.js(`(() => {
        __bh.freeze(true);
        __bh.game.setDate(${JSON.stringify(noon)});
        __bh.settings.weather = ${JSON.stringify(v.rain ? "rain" : "fair")};
        __bh.presets["bridges ${v.key}"] = {
          ...__bh.presets["Earth: the Blue Marble"],
          animate: false,
          ship: false,
          time: __bh.sim.time,
          earthScenery: "high",
          earthSurface: "satellite",
          earthTerrain: true,
          earthClouds: 0,
          pose: { body: "earth", at: ${JSON.stringify(v.at)}, altKm: ${v.altKm}, aim: ${JSON.stringify(v.aim)} },
        };
        __bh.preset("bridges ${v.key}");
        __bh.refresh();
        return true;
      })()`);
      // (the scene full — not the quick one — and what this view needs in it; 60 s at most, said if not met)
      await app.progress("the scene: full, its bridges in");
      const ready = await app.waitOptional(
        `(() => { const sc = __bh.renderer.earthScenery?.stats?.(); return !!sc && sc.status === "ready" && !sc.quick && (${v.holds}); })()`,
        60_000,
      );
      await app.dataSettled(v.label, { maxMs: 60_000 });
      // (review A3: the street cells it lacked come from the pool, the scene made again with them — waited 45 s at most, said)
      await app.waitOptional(`__bh.renderer.earthScenery.stats().streetMissing === 0`, 45_000);
      await app.settled(60_000);
      const gpu = await app.js<{ p50: number; p95: number; n: number }>(`(async () => {
        const R = __bh.renderer, ms = [];
        for (let i = 0; i < 90; i++) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); if (R.lastGpuMs > 0) ms.push(R.lastGpuMs); }
        ms.sort((a, b) => a - b);
        const q = (p) => +(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] ?? 0).toFixed(2);
        return { p50: q(0.5), p95: q(0.95), n: ms.length };
      })()`);
      const sc = await app.js<Record<string, number | string | boolean>>(`(() => {
        const s = __bh.renderer.earthScenery.stats();
        return { status: s.status, quick: s.quick, bridges: s.bridges, bridgePiers: s.bridgePiers, cellBridges: s.cellBridges,
          notableBridges: s.notableBridges, cellRoads: s.cellRoads, streetMissing: s.streetMissing, streetRevision: s.streetRevision,
          furniture: s.furniture, gpuErrors: __bh.renderer.gpuErrors ?? 0 };
      })()`);
      await app.shot(`${OUT}/${v.key}.png`);
      results.push({ view: v.key, ready: !!ready, gpu, ...sc });
      await app.stepDone(
        `${v.key}: GPU p50 ${gpu.p50} ms p95 ${gpu.p95} ms · ponts ${sc.bridges} (cellules ${sc.cellBridges}, remarquables ${sc.notableBridges})`,
        !!ready,
      );
      expect(ready, `${v.label}: the scene never held ${v.holds} (${JSON.stringify(sc)})`).toBeTruthy();
      expect(sc.bridges as number).toBeGreaterThan(0);
      expect(sc.gpuErrors).toBe(0);
      expect(gpu.n).toBeGreaterThan(30);
    }, 300_000);

  test("no page error over the views", () => {
    expect(app.cdp.errors).toEqual([]);
  });
});
