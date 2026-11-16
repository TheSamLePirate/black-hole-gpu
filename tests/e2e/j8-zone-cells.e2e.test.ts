import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-6 — an offline zone carries its building cells prepared (src/system/zone-cells.ts, src/pwa-zones.ts, cell-workers.ts
// zoneCellsIO): over Toulon, a small zone of the « overflight » profile with the scenery balanced, the IGN's relief on, no orthophotos
// (89 BD TOPO tiles among ~4 300 chains — the high scenery with the orthophotos, 4 618, was 70 % in after 20 min, 16 Nov 2026) is
// downloaded; once its tiles are in, each BD TOPO tile is prepared into its cell — its record says how many cells, buildings, bytes
// (Settings › Offline shows them). Then the network cut and the page loaded again: every cell of the zone asked of the game's pool
// (__bh.sys.cells) comes from the prepared cache, none decoded, within seconds. Back online, the zone removed: its cells dropped from
// the prepared cache (no other zone holds them).
// Earth data: network (a zone's download goes through the Service Worker — its boot keeps the network)
// Done when: the zone ready with its cells prepared (none failed); offline, every one of them handed from the prepared cache, none
// prepared, in under 20 s; after the removal, none of them left.
// Duration: ~35–45 min (the zone's download: 16 Nov 2026 on this Mac, its first 2 000 chains in 2.5 min, the rest — the Géoplateforme's
// — ~1.3 a second: 4 160 of 4 320 after 30 min; its estimate said 175 s. One heavy IGN load at a time; then two reloads). Never passed
// yet: both runs of 16 Nov stopped at the download's cap before the cells.

const ZONE = { name: "Toulon cellules (e2e)", lat: 43.124, lon: 5.93, radiusKm: 0.5, profile: "overflight" };
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, earthPipeline: "raster", earthOrtho: false, earthIgnRelief: true, earthIgnSilhouettes: false, earthScenery: "balanced", earthSurface: "off", detailReach: "normal", f35AutoProtect: false }`;
const CELLS = `(async () => (await (await caches.open("kerr-cells-v1")).keys()).map((r) => r.url.match(/\\/(\\d+)\\/(\\d+)\\.kbc$/)).filter(Boolean).map((m) => ({ x: +m[1], y: +m[2] })))()`;

type Rec = {
  id: string;
  state: string;
  cursor: number;
  total: number;
  done: number;
  failed: number;
  bytes: number;
  cells?: { count: number; buildings: number; bytes: number; failed: number; ms: number };
};

describe.skipIf(!E2E)("PLAN-J8 J8-6: an offline zone carries its building cells prepared", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", sw: true, tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); __bh.renderer.farBuildingsOn = false; return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
  }, 180_000);
  afterAll(async () => {
    await app?.offline(false).catch(() => {});
    app?.close();
    stopServer();
  });
  const rec = (id: string) =>
    app.js<Rec | null>(`(async () => (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}) ?? null)()`);

  test("downloaded with its cells, offline every cell from the prepared cache, dropped with the zone", async () => {
    await app.scenario("Toulon · the zone downloaded, its cells prepared");
    const est = await app.js<{ chains: number; bytes: number; seconds: number }>(`__bh.pwa.zones.estimate(${JSON.stringify(ZONE)})`);
    console.log(`  the zone: ${est.chains} chains, ≈ ${(est.bytes / 1e6).toFixed(0)} MB, ≈ ${est.seconds.toFixed(0)} s`);
    const id = (await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(ZONE)})`))!;
    expect(id).toBeTruthy();
    // (its progress said every 30 s; it fails when the download stops moving for 3 minutes, or past 20 minutes — what is missing said)
    const t0 = Date.now();
    let last = -1;
    let moved = Date.now();
    for (let k = 0; ; k++) {
      const z = await rec(id);
      if (z && z.state !== "downloading") break;
      const at = (z?.cursor ?? 0) + (z?.cells ? 1 : 0);
      if (at !== last) {
        last = at;
        moved = Date.now();
      }
      if (Date.now() - moved > 180_000) throw new Error(`the zone's download stopped moving for 3 min: ${JSON.stringify(z)}`);
      if (Date.now() - t0 > 3_000_000) throw new Error(`the zone not in after 50 min: ${JSON.stringify(z)}`);
      if (k % 15 === 0) console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)} s] ${JSON.stringify(z)}`);
      await Bun.sleep(2000);
    }
    const z = (await rec(id))!;
    console.log(`  ready in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${JSON.stringify(z)}`);
    expect(z.state).toBe("ready");
    expect(z.cells?.count ?? 0).toBeGreaterThan(0);
    expect(z.cells?.failed).toBe(0);
    const kept = await app.js<{ x: number; y: number }[]>(CELLS);
    console.log(`  the prepared cache: ${kept.length} cells`);
    expect(kept.length).toBe(z.cells!.count);

    await app.scenario("Toulon · offline, the cells from the prepared cache");
    await app.offline(true);
    await app.load("scene=game:artemis");
    await app.offline(true);
    // (the far layer off: its own want, every 2 s, would replace the cells this test asks of the pool — J8-4 on by default since 16 Nov)
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); __bh.renderer.farBuildingsOn = false; return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 120_000);
    await app.js(
      `(() => { __bh.freeze(true); __bh.game.flyAt(${ZONE.lat}, ${ZONE.lon}, 500, 0, 0); __bh.settings.shipMount = "cockpit"; return 1; })()`,
    );
    const t1 = Date.now();
    await app.js(
      `(async () => { const l = await ${CELLS}; __bh.sys.cells.want(l.map((t, i) => ({ x: t.x, y: t.y, priority: 0, d: i }))); return l.length; })()`,
    );
    await app.waitFor(`__bh.sys.cells.got().length >= ${kept.length}`, 20_000);
    const off = await app.js<{ prepared: number; cached: number; failed: number }>(`__bh.sys.cells.stats()`);
    console.log(`  offline: ${kept.length} cells handed in ${((Date.now() - t1) / 1000).toFixed(2)} s — ${JSON.stringify(off)}`);
    await app.shot("remote-results/j8-zone-cells/offline.png");
    // (J8-A's « ready » signal read offline in the zone — said, not asserted here: the zone holds no far cells, J8-9)
    const ready = await app.js<{ ready: boolean; why: string[] }>(
      `(async () => { const r = await __bh.sys.flightReady(); return { ready: r.ready, why: r.why }; })()`,
    );
    console.log(`  flightReady offline: ${JSON.stringify(ready)}`);
    expect(off.cached).toBe(kept.length);
    expect(off.prepared).toBe(0);
    expect(off.failed).toBe(0);

    await app.scenario("Toulon · the zone removed, its cells dropped");
    await app.offline(false);
    await app.js(`__bh.pwa.zones.remove(${JSON.stringify(id)})`);
    const left = await app.js<unknown[]>(CELLS);
    console.log(`  after the removal: ${left.length} cells left`);
    expect(left.length).toBe(0);
    expect(app.cdp.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|net::/.test(e))).toEqual([]);
  }, 3_400_000);
});
