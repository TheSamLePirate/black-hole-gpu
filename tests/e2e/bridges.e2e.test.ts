import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { type BridgeView, gpuTimes, sceneStats, showView, widestRoad } from "./lib/bridge-views";

// PLAN-PONT-ROUTES-AAA (review A10, B1–B3, 24 Nov 2026): the bridges and roads in their real places, the game's default setup — a
// Seine bridge cut by a z 14 tile's edge drawn whole (Pont de Grenelle, seen from over the river), Pont Alexandre III's pylons and arch,
// the Millau viaduct's masts, stays and guardrails, the Golden Gate from Battery Spencer at ~1 km and from ~30 km over the sea, a wet
// asphalt street in Paris (rue de Rivoli, found as the widest road there) at a bus driver's height, dry then in the rain — each from a free camera set over the
// ground loaded there (lib/bridge-views.ts: an altitude guessed over the sea stood it under the streets on 24 Nov 2026), each view waited
// on its conditions (the scene about the place, its bridges in, its data, its street cells, its compiles), shot, its GPU time read
// (renderer.lastGpuMs, p50 and p95 over 90 images), nothing assumed: a condition not met is said and the view still shot.
// (25 Nov 2026) Every bridge in the scene drawn — no count's cap, the decks' share of the bytes (bridge-lod.ts): none left out
// (bridgesDropped 0) in the Paris views; the Golden Gate from Battery Spencer shot again with the trees' material cut (liteSkip 64), the
// far buildings off and the near trees' geometry off — which of them makes the grey stair-stepped blocks before the north tower.
// Duration: ~8 min on kerr-mini (400 s on 24 Nov 2026, the Earth data on disk).
// Done when: the six views shot with their GPU times (and the three diagnostic shots), the scene's bridge counts asserted, no page error.

// (an A/B — scripts/ab-e2e.ts —: each side its own folder)
const OUT = `${process.env.BRIDGES_OUT ?? "remote-results/bridges"}${process.env.AB_SIDE ? `-${process.env.AB_SIDE}` : ""}`;

const VIEWS: (BridgeView & { label: string })[] = [
  {
    key: "grenelle-tile-edge",
    label: "Paris — Pont de Grenelle, cut by a z 14 tile's edge (48.85026° N): one deck, from over the Seine",
    at: [48.8484, 2.2771],
    aglM: 12,
    look: [48.8503, 2.28],
    lookAglM: 8,
    holds: "sc.cellBridges > 0",
  },
  {
    key: "alexandre-iii",
    label: "Paris — Pont Alexandre III: its four pylons, its arch, its deck, from over the Seine",
    // (over the Seine 120 m downstream — east — of it, 7 m over the water, aimed at its middle: 48.8638 N, 2.3136 E)
    at: [48.8636, 2.3152],
    aglM: 7,
    look: [48.8638, 2.3136],
    lookAglM: 5,
    holds: "sc.cellBridges > 0",
  },
  {
    key: "paris-wet-street",
    label: "Paris — a wet asphalt street in the rain (rue de Rivoli): its wheel paths, puddles, sheen",
    at: [48.8628, 2.3365],
    aglM: 60,
    look: [48.8638, 2.333],
    holds: "sc.cellRoads > 0",
    weather: "rain",
  },
  {
    key: "millau",
    label: "Millau — the viaduct's masts, stays and guardrails on its deck",
    at: [44.0745, 3.0395],
    aglM: 120,
    look: [44.08, 3.0224],
    lookAglM: 250,
    holds: "sc.notableBridges >= 1",
  },
  {
    key: "golden-gate-1km",
    label: "San Francisco — the Golden Gate from Battery Spencer (Marin), ~1 km",
    // (the classic viewpoint 450 m north-west of the north tower, 40 m over its ground — clear of its scrub —, aimed at the main span's
    // middle at the deck's height: the hill behind the headlands' former spot hid the bridge)
    at: [37.8277, -122.4836],
    aglM: 40,
    look: [37.8197, -122.4786],
    lookAglM: 70,
    holds: "sc.notableBridges >= 1",
  },
  {
    key: "golden-gate-30km",
    label: "San Francisco — the Golden Gate from ~30 km over the sea: its towers and cables",
    at: [37.62, -122.73],
    aglM: 450,
    look: [37.8197, -122.4786],
    lookAglM: 120,
    holds: "sc.notableBridges >= 1",
    dataMs: 60_000,
  },
];
// (a witness, not a bridge — run only when BRIDGES_ONLY names it, 25 Nov 2026: the crowns' edges against the sky fixed at Battery
// Spencer — RASTER_SKY —, a forest seen from above, no sky behind its crowns, must not change: the Maures, 60 m over the canopy)
const WITNESSES: (BridgeView & { label: string; witness?: boolean })[] = [
  {
    key: "maures-canopy",
    label: "Witness — the Maures' forest from 60 m over its canopy: crowns with no sky behind them",
    at: [43.19, 6.25],
    aglM: 60,
    look: [43.1925, 6.2545],
    lookAglM: 0,
    holds: "true",
    witness: true,
  },
];
// (BRIDGES_ONLY=<key>,<key>: those views alone — the witnesses among them —, e.g. golden-gate-1km,maures-canopy for an A/B)
const only = process.env.BRIDGES_ONLY?.split(",").filter(Boolean);
const RUN: (BridgeView & { label: string; witness?: boolean })[] = only
  ? [...VIEWS, ...WITNESSES].filter((v) => only.includes(v.key))
  : VIEWS;

describe.skipIf(!E2E)("bridges and roads AAA: real places, default setup", () => {
  let app: App;
  const results: Record<string, unknown>[] = [];

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
    app.steps(RUN.map((v) => v.label));
    app.estimate(480);
  }, 180_000);

  afterAll(async () => {
    console.log(JSON.stringify(results, null, 1));
    await Bun.write(`${OUT}/results.json`, JSON.stringify(results, null, 1));
    app?.close();
    stopServer();
  });

  for (const v of RUN)
    test(v.label, async () => {
      await app.step(v.label);
      let view = await showView(app, v);
      if (v.key === "paris-wet-street") {
        // (the street itself: the widest road within 120 m along 115° — rue de Rivoli —, the camera on its axis at a walker's eyes, 70 m along it)
        const road = await widestRoad(app, v.at, 120, 115);
        console.log(`  the widest road there: ${JSON.stringify(road)}`);
        if (road) {
          const lenM = Math.hypot(
            (road.b[0] - road.a[0]) * 111132,
            (road.b[1] - road.a[1]) * 111320 * Math.cos((road.a[0] * Math.PI) / 180),
          );
          const k = 70 / Math.max(lenM, 1);
          const ahead: [number, number] = [road.a[0] + (road.b[0] - road.a[0]) * k, road.a[1] + (road.b[1] - road.a[1]) * k];
          view = await showView(app, { ...v, at: road.a, aglM: 2.5, look: ahead, lookAglM: 0 });
          // (the same street dry, first: its paving and markings — the rain's shot after)
          await app.js(`(() => { __bh.settings.weather = "fair"; __bh.touch(); return 1; })()`);
          await app.settled(60_000);
          await app.shot(`${OUT}/${v.key}-dry.png`);
          await app.js(`(() => { __bh.settings.weather = "rain"; __bh.touch(); return 1; })()`);
          await app.settled(60_000);
          await Bun.sleep(1500);
        }
      }
      const gpu = await gpuTimes(app);
      const sc = await sceneStats(app);
      await app.shot(`${OUT}/${v.key}.png`);
      const diag: string[] = [];
      if (v.key === "golden-gate-1km") {
        // (the grey stair-stepped blocks before the north tower — PROBLEMES, campaign 2 —: shot again with one part cut each time)
        for (const [name, on, off] of [
          [
            "trees-material-cut",
            "__bh.renderer.liteSkip = (__bh.renderer.liteSkip | 64)",
            "__bh.renderer.liteSkip = (__bh.renderer.liteSkip & ~64)",
          ],
          ["far-buildings-off", "__bh.renderer.farBuildingsOn = false", "__bh.renderer.farBuildingsOn = true"],
          ["near-trees-off", "__bh.renderer.nearTreeGeometryOn = false", "__bh.renderer.nearTreeGeometryOn = true"],
        ] as const) {
          await app.js(`(() => { ${on}; __bh.touch(); return 1; })()`);
          await app.settled(30_000);
          await Bun.sleep(1500);
          const f = `${OUT}/${v.key}-${name}.png`;
          await app.shot(f);
          diag.push(f);
          await app.js(`(() => { ${off}; __bh.touch(); return 1; })()`);
        }
        await app.settled(30_000);
      }
      results.push({
        view: v.key,
        ...view,
        gpu,
        ...sc,
        shots: [`${OUT}/${v.key}.png`, ...(v.key === "paris-wet-street" ? [`${OUT}/${v.key}-dry.png`] : []), ...diag],
      });
      await app.stepDone(
        `${v.key}: GPU p50 ${gpu.p50} ms p95 ${gpu.p95} ms · ponts ${sc.bridges} (cellules ${sc.cellBridges}, remarquables ${sc.notableBridges})`,
        view.ready,
      );
      expect(view.ready, `${v.label}: the scene never held ${v.holds} (${JSON.stringify(sc)})`).toBe(true);
      if (!v.witness) expect((sc.bridges as number) + (sc.notableBridges as number)).toBeGreaterThan(0);
      expect(sc.streetMissing).toBe(0);
      expect(sc.gpuErrors).toBe(0);
      expect(gpu.n).toBeGreaterThan(30);
      // (every bridge of the scene drawn — the stats exist since 25 Nov 2026)
      if (sc.bridgeCandidates !== null) expect(sc.bridgesDropped, `${v.key}: decks left out past their share`).toBe(0);
    }, 360_000);

  test("no page error over the views", () => {
    expect(app.cdp.errors).toEqual([]);
  });
});
