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
// of the track at its height: `__bh.sys.flightReady({ track })` at each (the track's zone and its cells within reach too) — the ground's tiles, none failed (`standIns`), the near scene, the
// far cells — and the Service Worker's figures (nothing from the network).
// Done when: the zone ready (or its download's progress said every minute until it stops moving for 10 min, or 4 h), its time, its
// estimate and its hosts written; offline, every point of the track ready with no tile failed, nothing from the network.
// Duration: hours the first time (~31 000 Géoplateforme chains — the IGN's height grids 0.3 s at the median, 3 s at the 95th: a long
// IGN slot of its own, both Macs), minutes once on the disk.

afterAll(stopServer);
const TRACK = process.env.J8_TRACK ?? "paris";
const OUT = "remote-results/j8-zone-paris";
/** a hard stop (J8Z_DEADLINE: an ISO time — the night bench's slot): none by default */
const DEADLINE = process.env.J8Z_DEADLINE ? Date.parse(process.env.J8Z_DEADLINE) : 0;

describe.skipIf(!E2E)(`PLAN-J8 J8-9: J8-A's corridor zone « ${TRACK} », downloaded then flown offline`, () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", sw: true, tiles: true });
    await app.js(`(() => { Object.assign(__bh.settings, { ship: false, traffic: false, earthClouds: 0, weather: "fair", earthPipeline: "raster",
      earthOrtho: true, earthIgnRelief: true }); __bh.renderer.debugSkipShip = true;
      __bh.renderer.farBudgetMiB = ${Number(process.env.J8A_BUDGET ?? 72)}; return 1; })()`);
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
        meshes?: { count: number; buildings: number; bytes: number; failed: number; ms: number };
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
        // (a hard stop — J8Z_DEADLINE, an ISO time: Sam, 16 Nov 2026, « arrête-le proprement à 3 h 15 » before kerr-mini's night bench —:
        // the zone paused, what is in kept on the disk, the hosts' rates so far written)
        if (DEADLINE && Date.now() > DEADLINE) {
          await app.js(`__bh.pwa.zones.pause(${JSON.stringify(id)})`);
          const hosts = app.earth ? hostStats(app.earth.counts) : [];
          writeFileSync(
            `${OUT}/${TRACK}.json`,
            `${JSON.stringify({ track: TRACK, zone, estimate: est, stoppedAt: new Date().toISOString(), realS: (Date.now() - t0) / 1000, record: z, hosts }, null, 1)}\n`,
          );
          for (const h of hosts) console.log(`  host ${JSON.stringify(h)}`);
          throw new Error(
            `stopped at the deadline (${process.env.J8Z_DEADLINE}) after ${((Date.now() - t0) / 60_000).toFixed(0)} min: ${z?.cursor}/${z?.total} chains in, kept on the disk`,
          );
        }
        if (k % 30 === 0)
          console.log(
            `  [${((Date.now() - t0) / 60_000).toFixed(1)} min] ${z?.cursor}/${z?.total} chains, ${((z?.bytes ?? 0) / 1e6).toFixed(0)} MB`,
          );
        await Bun.sleep(2000);
      }
      const z = (await rec())!;
      const realS = (Date.now() - t0) / 1000;
      const hosts = app.earth ? hostStats(app.earth.counts) : [];
      console.log(`  ready in ${(realS / 60).toFixed(1)} min (estimated ${(est.seconds / 60).toFixed(1)}): ${JSON.stringify(z)}`);
      for (const h of hosts) console.log(`  host ${JSON.stringify(h)}`);
      writeFileSync(`${OUT}/${TRACK}.json`, `${JSON.stringify({ track: TRACK, zone, estimate: est, realS, record: z, hosts }, null, 1)}\n`);
      // (PLAN-J8 J8-8: its near mesh cells — within MESH_NEAR_M of the track —, those whose roofs the zone's canopy measured: the key's c=1)
      const meshes = await app.js<{ canopy: number; guessed: number; measured: number }>(`(async () => {
        const c = await caches.open("kerr-mesh-v1"); let canopy = 0, guessed = 0, measured = 0;
        for (const r of await c.keys()) { if (r.url.endsWith("c=1")) canopy++; else guessed++;
          const b = await (await c.match(r)).arrayBuffer(); const v = new DataView(b); const n = v.getUint32(20, true);
          for (let i = 0; i < n; i++) if (v.getUint16(64 + 24 * i + 6, true) & 4) measured++; }
        return { canopy, guessed, measured }; })()`);
      console.log(
        `  mesh cells: ${JSON.stringify(z.meshes ?? null)} · keyed with the canopy ${meshes.canopy}, without ${meshes.guessed} · buildings measured ${meshes.measured}`,
      );
      expect(z.state).toBe("ready");
      expect(z.failed).toBe(0);

      await app.scenario(`${TRACK} · offline, the track's points`);
      await app.offline(true);
      await app.load("scene=game:artemis");
      await app.offline(true);
      await app.js(`(() => { Object.assign(__bh.settings, { ship: false, traffic: false, earthClouds: 0, weather: "fair", earthPipeline: "raster",
      earthOrtho: true, earthIgnRelief: true }); __bh.renderer.debugSkipShip = true;
      __bh.renderer.farBudgetMiB = ${Number(process.env.J8A_BUDGET ?? 72)}; return 1; })()`);
      const st0 = await app.js<{ served: { network: number; kinds?: Record<string, { network: number }> } }>(`__bh.pwa.stats()`);
      const before = st0.served.network;
      const ready: { point: number; ready: boolean; why: string[]; notes?: string[] }[] = [];
      for (let k = 0; k < track.points.length; k++) {
        const [lat, lon, alt] = track.points[k]!;
        const why = await app.js<string | null>(
          `(() => { __bh.freeze(true); return __bh.viewAt(${lat}, ${lon}, { altM: ${alt} + __bh.sys.geoid(${lat}, ${lon}), pitch: -8, fov: 50 }) ?? null; })()`,
        );
        if (why) throw new Error(`viewAt point ${k + 1}: ${why}`);
        await app
          .dataSettled(`point ${k + 1}`, { maxMs: 120_000 })
          .catch((e) => console.log(`  (point ${k + 1} not settled: ${String(e).slice(0, 160)})`));
        // (J8-A's whole flight: the track given — its zone, its far and street cells within reach, not only the view at the point)
        const T = JSON.stringify({ points: track.points });
        // (ready for 5 s in a row, 120 s at most: right after a jump of kilometres the new view has asked nothing yet — dataSettled and
        // flightReady said done before its tiles began, then 67 to 142 tiles pending at the read: the race, 17 Nov 2026; its why at
        // each change said)
        const t0 = Date.now();
        let now = { ready: false, why: [] as string[], notes: [] as string[] },
          since = 0,
          lastWhy = "";
        while (Date.now() - t0 < 120_000) {
          now = await app.js<{ ready: boolean; why: string[]; notes: string[] }>(
            `(async () => { const r = await __bh.sys.flightReady({ track: ${T} }); return { ready: r.ready, why: r.why, notes: r.notes ?? [] }; })()`,
          );
          if (!now.ready) since = 0;
          else if (!since) since = Date.now();
          if (since && Date.now() - since >= 5_000) break;
          const w = now.why.join(" · ");
          if (w && w !== lastWhy) console.log(`  … point ${k + 1}: ${Math.round((Date.now() - t0) / 1000)} s — ${w.slice(0, 200)}`);
          lastWhy = w;
          await Bun.sleep(1_000);
        }
        now.ready = !!since && Date.now() - since >= 5_000;
        ready.push({ point: k + 1, ready: !!now.ready, why: now.why ?? [], ...(now.notes?.length ? { notes: now.notes } : {}) });
        // (a far layer's wanted cells not resident: its reserve refusing — refused, no block free — or still filling — the render's
        // reading, 17 Nov 2026)
        const far = await app.js<Record<string, unknown> | null>(
          `(async () => { const f = await __bh.renderer.farBuildings?.(); const l = f?.layer; return l ? { wanted: l.wanted, missing: l.missing, cells: l.cells, refused: l.refused, freeBlocks: l.freeBlocks, blocks: l.blocks } : null; })()`,
        );
        console.log(`  point ${k + 1}: ${JSON.stringify(ready[k])} · far layer ${JSON.stringify(far)}`);
        if (k === 2) await app.shot(`${OUT}/${TRACK}-offline-point3.png`);
      }
      const st = await app.js<{ served: { network: number; kinds?: Record<string, { network: number }>; recent?: string[] } }>(
        `__bh.pwa.stats()`,
      );
      const after = st.served.network;
      // (counted before the fetch: a tile asked of the network — in neither the zone nor the worker's cache —, failed offline)
      console.log(`  the Service Worker's requests to the network offline (in neither the zone nor its cache): ${after - before}`);
      console.log(
        `  … by kind ${JSON.stringify(
          Object.fromEntries(
            // (offline's alone: the worker's counts since it started, less those before the network was cut)
            Object.entries(st.served.kinds ?? {})
              .map(([k, v]) => [k, v.network - (st0.served.kinds?.[k]?.network ?? 0)] as const)
              .filter(([, n]) => n > 0),
          ),
        )}`,
      );
      for (const u of (st.served.recent ?? []).slice(-12)) console.log(`  … ${u}`);
      expect(ready.every((p) => p.ready)).toBe(true);
      expect(after - before).toBe(0);
    },
    5 * 3_600_000,
  );
});
