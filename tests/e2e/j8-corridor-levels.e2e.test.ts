import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { J8A_TRACKS } from "../../src/system/j8a-tracks";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-9 (2) — what the game asks along J8-A's track, to set the corridor's levels on it (Sam's « ok couloir »; zones.ts
// ZoneCorridor: today the airfield's — z 17 relief, z 18 orthophotos —, 36 551 chains at Paris). The free camera set at each point of
// the track (system/j8a-tracks.ts), at its height over the sea (the geoid's N added: viewAt takes the ellipsoid's), facing the next
// point, pitched a little down, the ground's data settled; every tile request read from the e2e's Earth data on disk (its log: the URL
// of each), the finest level asked by kind — the IGN's orthophotos (WMTS TILEMATRIX), its height grids (WMS-R: the box's side in Web
// Mercator metres gives the level), Terrarium's —, by point and over the track. No pass/fail on the levels: they are the measure
// (remote-results/j8-corridor-levels/<track>.json); it fails on no request seen.
// Done when: every point of the track settled (or its wait said), the finest level of each kind there and over the track written.
// Duration: ~6–10 min (six points at Paris; the IGN's tiles the first time — one heavy IGN load at a time).

afterAll(stopServer);
const TRACK = process.env.J8C_TRACK ?? "paris";
const OUT = "remote-results/j8-corridor-levels";

/** a tile request's kind and level (null: not a ground tile) */
function levelOf(url: string): { kind: string; z: number } | null {
  const tm = url.match(/TILEMATRIX=(\d+)/);
  if (tm && /ORTHOIMAGERY/.test(url)) return { kind: "orthophoto (IGN WMTS)", z: Number(tm[1]) };
  if (url.includes("wms-r")) {
    const b = url
      .match(/BBOX=([^&]+)/)?.[1]
      ?.split(",")
      .map(Number);
    const layer = url.match(/LAYERS=([^&]+)/)?.[1] ?? "?";
    if (b?.length !== 4) return null;
    return {
      kind: `heights ${layer.replace(/ELEVATION\.ELEVATIONGRIDCOVERAGE\.?/, "").replace(/_ELEVATION/, "") || "RGE ALTI"}`,
      z: Math.round(Math.log2(40075016.686 / (b[2]! - b[0]!))),
    };
  }
  const t = url.match(/terrarium\/(\d+)\//);
  if (t) return { kind: "Terrarium", z: Number(t[1]) };
  return null;
}

test.skipIf(!E2E)(
  `J8-9 (2): the levels the game asks along J8-A's « ${TRACK} » track at its height`,
  async () => {
    mkdirSync(OUT, { recursive: true });
    const track = J8A_TRACKS.find((t) => t.name === TRACK);
    if (!track) throw new Error(`no track ${TRACK}`);
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { ship: false, traffic: false, earthClouds: 0, weather: "fair", earthPipeline: "raster",
        earthOrtho: true, earthIgnRelief: true }); __bh.renderer.debugSkipShip = true; __bh.game.setDate("${track.dates.day}"); return 1; })()`);
      const log = () => app.earth!.counts.log;
      const out: { point: number; lat: number; lon: number; altMsl: number; finest: Record<string, number>; requests: number }[] = [];
      for (let k = 0; k < track.points.length; k++) {
        const [lat, lon, alt] = track.points[k]!;
        const next = track.points[Math.min(k + 1, track.points.length - 1)]!;
        const prev = track.points[Math.max(k - 1, 0)]!;
        const [a, b] = k + 1 < track.points.length ? [[lat, lon], next] : [prev, [lat, lon]];
        const D = Math.PI / 180;
        const heading = (Math.atan2((b[1]! - a[1]!) * Math.cos(lat * D), b[0]! - a[0]!) / D + 360) % 360;
        await app.scenario(`${track.label.split(":")[0]} · point ${k + 1}/${track.points.length}`);
        const n0 = log().length;
        const why = await app.js<string | null>(
          `__bh.viewAt(${lat}, ${lon}, { altM: ${alt} + __bh.sys.geoid(${lat}, ${lon}), heading: ${heading.toFixed(1)}, pitch: -8, fov: 50 }) ?? null`,
        );
        if (why) throw new Error(`viewAt point ${k + 1}: ${why}`);
        await app
          .dataSettled(`point ${k + 1}`, { maxMs: 90_000 })
          .catch((e) => console.log(`  (point ${k + 1} not settled: ${String(e).slice(0, 160)})`));
        const finest: Record<string, number> = {};
        for (const r of log().slice(n0)) {
          const l = levelOf(r.url);
          if (l) finest[l.kind] = Math.max(finest[l.kind] ?? 0, l.z);
        }
        out.push({ point: k + 1, lat, lon, altMsl: alt, finest, requests: log().length - n0 });
        console.log(`  point ${k + 1} (${lat}, ${lon}, ${alt} m): ${log().length - n0} requests · finest ${JSON.stringify(finest)}`);
        if (k === 0) await app.shot(`${OUT}/${TRACK}-point1.png`);
      }
      const over: Record<string, number> = {};
      for (const p of out) for (const [kind, z] of Object.entries(p.finest)) over[kind] = Math.max(over[kind] ?? 0, z);
      console.log(`  over the track: ${JSON.stringify(over)}`);
      writeFileSync(
        `${OUT}/${TRACK}.json`,
        `${JSON.stringify({ track: TRACK, at: new Date().toISOString(), over, points: out }, null, 1)}\n`,
      );
      expect(out.reduce((s, p) => s + p.requests, 0)).toBeGreaterThan(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  1_200_000,
);
