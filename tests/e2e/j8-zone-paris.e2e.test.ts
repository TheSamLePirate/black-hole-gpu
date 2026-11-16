import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { j8aTrack } from "../../src/system/j8a-tracks";
import { corridorDisc } from "../../src/system/zones";
import { App, E2E, stopServer } from "./lib/app";
import { hostStats } from "./lib/earth-cache";

// PLAN-J8 J8-9 — the real measure of J8-A's zone (Sam, 16 Nov 2026: « tous chargés avant le vol »; « ok couloir »): the corridor zone
// on J8-A's track (system/j8a-tracks.ts — J8_TRACK, `paris` by default), the airfield's levels along it — z 17 heights, z 18
// orthophotos, what the game asks at 500 m (j8-corridor-levels, 16 Nov) —, « overflight » elsewhere in its disc, the far cells to
// 20 km; downloaded through the Service Worker (and the e2e's Earth data on disk: a second run reads it there). Its real time against
// its estimate, each host's measured rate (PLAN-J8 J8-9 (3)); then the network cut, the page loaded again, the camera set at each point
// of the track at its height: `__bh.sys.flightReady()` at each — the ground's tiles, none failed (`standIns`), the near scene, the
// far cells — and the Service Worker's figures (nothing from the network).
// Done when: the zone ready (or its download's progress said every minute until it stops moving for 10 min, or 4 h), its time, its
// estimate and its hosts written; offline, every point of the track ready with no tile failed, nothing from the network.
// Duration: hours the first time (~31 000 Géoplateforme chains — the IGN's height grids 0.3 s at the median, 3 s at the 95th: a long
// IGN slot of its own, both Macs), minutes once on the disk.

afterAll(stopServer);
const TRACK = process.env.J8_TRACK ?? "paris";
const OUT = "remote-results/j8-zone-paris";

describe.skipIf(!E2E)(`PLAN-J8 J8-9: J8-A's corridor zone « ${TRACK} », downloaded then flown offline`, () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", sw: true, tiles: true });
    await app.js(`(() => { Object.assign(__bh.settings, { ship: false, traffic: false, earthClouds: 0, weather: "fair", earthPipeline: "raster",
      earthOrtho: true, earthIgnRelief: true }); __bh.renderer.debugSkipShip = true; return 1; })()`);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
  }, 180_000);
  afterAll(async () => {
    await app?.offline(false).catch(() => {});
    app?.close();
  });

  test(
    "downloaded: its real time against its estimate, each host's rate; offline, every point of the track ready",
    async () => {
      const track = j8aTrack(TRACK);
      const corridor = { points: track.points.map((p) => [p[0], p[1]] as [number, number]), halfWidthM: track.halfWidthM };
      const d = corridorDisc(corridor);
      const zone = { name: `J8-A ${TRACK} (e2e)`, lat: d.lat, lon: d.lon, radiusKm: d.radius / 1000, profile: "overflight", corridor };
      await app.scenario(`${TRACK} · the corridor zone downloaded`);
      const est = await app.js<{ chains: number; bytes: number; seconds: number }>(`__bh.pwa.zones.estimate(${JSON.stringify(zone)})`);
      console.log(`  the zone: ${est.chains} chains, ≈ ${(est.bytes / 1e6).toFixed(0)} MB, estimated ${(est.seconds / 60).toFixed(0)} min`);
      const id = (await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(zone)})`))!;
      expect(id).toBeTruthy();
      // (its progress said every minute; it fails when the download stops moving for 10 minutes, or past 4 hours — what is missing said)
      const t0 = Date.now();
      let last = -1,
        moved = Date.now();
      type Rec = {
        state: string;
        cursor: number;
        total: number;
        done: number;
        failed: number;
        bytes: number;
        cells?: Record<string, number>;
      };
      const rec = () =>
        app.js<Rec | null>(`(async () => (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}) ?? null)()`);
      for (let k = 0; ; k++) {
        const z = await rec();
        if (z && z.state !== "downloading") break;
        const at = (z?.cursor ?? 0) + (z?.cells ? 1 : 0);
        if (at !== last) {
          last = at;
          moved = Date.now();
        }
        if (Date.now() - moved > 600_000) throw new Error(`the zone's download stopped moving for 10 min: ${JSON.stringify(z)}`);
        if (Date.now() - t0 > 4 * 3_600_000) throw new Error(`the zone not in after 4 h: ${JSON.stringify(z)}`);
        if (k % 30 === 0)
          console.log(
            `  [${((Date.now() - t0) / 60_000).toFixed(1)} min] ${z?.cursor}/${z?.total} chains, ${((z?.bytes ?? 0) / 1e6).toFixed(0)} MB`,
          );
        await Bun.sleep(2000);
      }
      const z = (await rec())!;
      const realS = (Date.now() - t0) / 1000;
      const hosts = app.earth ? hostStats(app.earth.counts.log) : [];
      console.log(`  ready in ${(realS / 60).toFixed(1)} min (estimated ${(est.seconds / 60).toFixed(1)}): ${JSON.stringify(z)}`);
      for (const h of hosts) console.log(`  host ${JSON.stringify(h)}`);
      writeFileSync(`${OUT}/${TRACK}.json`, `${JSON.stringify({ track: TRACK, zone, estimate: est, realS, record: z, hosts }, null, 1)}\n`);
      expect(z.state).toBe("ready");
      expect(z.failed).toBe(0);

      await app.scenario(`${TRACK} · offline, the track's points`);
      await app.offline(true);
      await app.load("scene=game:artemis");
      await app.offline(true);
      await app.js(`(() => { Object.assign(__bh.settings, { ship: false, traffic: false, earthClouds: 0, weather: "fair", earthPipeline: "raster",
      earthOrtho: true, earthIgnRelief: true }); __bh.renderer.debugSkipShip = true; return 1; })()`);
      const before = (await app.js<{ served: { network: number } }>(`__bh.pwa.stats()`)).served.network;
      const ready: { point: number; ready: boolean; why: string[] }[] = [];
      for (let k = 0; k < track.points.length; k++) {
        const [lat, lon, alt] = track.points[k]!;
        const why = await app.js<string | null>(
          `__bh.viewAt(${lat}, ${lon}, { altM: ${alt} + __bh.sys.geoid(${lat}, ${lon}), pitch: -8, fov: 50 }) ?? null`,
        );
        if (why) throw new Error(`viewAt point ${k + 1}: ${why}`);
        await app
          .dataSettled(`point ${k + 1}`, { maxMs: 120_000 })
          .catch((e) => console.log(`  (point ${k + 1} not settled: ${String(e).slice(0, 160)})`));
        await app.waitOptional(`(async () => (await __bh.sys.flightReady()).ready)()`, 60_000);
        const now = await app.js<{ ready: boolean; why: string[] }>(
          `(async () => { const r = await __bh.sys.flightReady(); return { ready: r.ready, why: r.why }; })()`,
        );
        ready.push({ point: k + 1, ready: !!now.ready, why: now.why ?? [] });
        console.log(`  point ${k + 1}: ${JSON.stringify(ready[k])}`);
        if (k === 2) await app.shot(`${OUT}/${TRACK}-offline-point3.png`);
      }
      const after = (await app.js<{ served: { network: number } }>(`__bh.pwa.stats()`)).served.network;
      console.log(`  the Service Worker's network responses offline: ${after - before}`);
      expect(ready.every((p) => p.ready)).toBe(true);
      expect(after - before).toBe(0);
    },
    5 * 3_600_000,
  );
});
