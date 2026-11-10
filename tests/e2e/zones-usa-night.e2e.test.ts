import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// An offline zone in the USA, flown at night through the PWA (docs/ANALYSE-STREAMING-2026-11-06.md, lot ST1; Sam, 6 Nov 2026:
// « s'assurer que les nouvelles données — lampadaires, routes, buildings, USA… — fassent partie du mode téléchargement de zone
// du PWA ; lancer des e2e à travers la PWA »). The Service Worker in control (App.boot sw), a 1 km zone of the low flight's
// profile on JFK's final 13R over Howard Beach: its ground (Terrarium under Mapterhorn's 3DEP relief — Terrarium its own chain
// since ZONE_SCHEMA 2 —, the USGS's imagery to z 16, the night's street tiles of NU1 at z 12–13), its scenery (the land cover,
// OpenFreeMap's z 14 — the roads, the lamps, the cars are made from it —, Mapterhorn's ground under the trees, Overture's
// buildings and its infrastructure — the base theme: pylons, turbines). The zone fetched (its progress said every 15 s, failed
// when none comes for 90 s), the tiles' own cache emptied, the network cut, the page loaded again; the F-35 placed in the zone
// at night (2026-11-08 01:30 UTC, 20:30 in New York), held while its world comes in, shot, flown 6 s on its autopilot within the zone:
// what the zone served by kind, what went to the network — nothing but the tactical map's OSM tiles.
// Output: remote-results/zones-usa-night/ (ZUN_OUT): held.png, flown.png, report.json.
// Done when: the zone ready with nothing failed; offline, the scenery drawn (buildings, lamps) and not one tile of the ground
// or the scenery from the network; the zone removed.
// Duration: ~6 min here (the download ~3–4 of them).
const OUT = process.env.ZUN_OUT ?? "remote-results/zones-usa-night";
const ZONE = { name: "JFK nuit (e2e)", lat: 40.6595, lon: -73.836, radiusKm: 1, profile: "low" };
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true, earthIgnSilhouettes: false, earthScenery: "high", earthSurface: "satellite", earthOverture: true, detailReach: "normal", f35AutoProtect: false }`;
const NIGHT = "2026-11-08T01:30:00Z";
type Served = {
  zone: number;
  lru: number;
  network: number;
  kinds?: Record<string, { zone: number; lru: number; network: number }>;
  recent?: string[];
};

describe.skipIf(!E2E)("an offline zone in the USA, flown at night through the PWA", () => {
  let app: App;
  beforeAll(async () => {
    await Bun.$`mkdir -p ${OUT}`;
    app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", sw: true, tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    // (a second visit, online, the worker in control from its first byte: the game's own files — the planets' maps, the texture
    // decoder — are kept as they are used, and the first visit loaded them before the worker had the page; truly offline after
    // a single visit they failed, the world black — 10 Nov 2026, docs/PROBLEMES-A-REGLER.md)
    await app.load("scene=game:artemis");
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
  }, 300_000);
  afterAll(async () => {
    await app?.offline(false).catch(() => {});
    app?.close();
    stopServer();
  });
  const served = async () => (await app.js<{ served: Served }>(`__bh.pwa.stats()`)).served;

  test("JFK's final at night: the zone's ground, street lights, buildings, lamps and pylons — offline, nothing from the network", async () => {
    // (a zone of an earlier run removed first: its tiles would count as this one's)
    await app.js(
      `(async () => { for (const z of await __bh.pwa.zones.list()) if (z.name === ${JSON.stringify(ZONE.name)}) await __bh.pwa.zones.remove(z.id); return 1; })()`,
    );
    const est = await app.js<{ chains: number; urls: number; bytes: number; seconds: number }>(
      `__bh.pwa.zones.estimate(${JSON.stringify(ZONE)})`,
    );
    console.log(`  the zone: ${est.chains} chains, ${est.urls} URLs, ≈ ${(est.bytes / 1e6).toFixed(0)} MB, ≈ ${est.seconds.toFixed(0)} s`);
    const id = await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(ZONE)})`);
    expect(id).toBeTruthy();
    // (its progress every 15 s; failed when none comes for 90 s — what stalls said)
    const t0 = Date.now();
    let last = -1,
      lastAt = Date.now();
    type Z = { state: string; done: number; total: number; cursor: number; bytes: number; none: number; failed: number; schema?: number };
    let z: Z | null = null;
    for (;;) {
      z = await app.js<Z | null>(`(async () => (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}) ?? null)()`);
      if (z && (z.state === "ready" || (z.state === "paused" && z.cursor >= z.total))) break;
      if (z && z.cursor !== last) {
        last = z.cursor;
        lastAt = Date.now();
        console.log(
          `  ${((Date.now() - t0) / 1000).toFixed(0)} s: ${z.cursor} / ${z.total} chains, ${(z.bytes / 1e6).toFixed(0)} MB, ${z.failed} failed`,
        );
      }
      if (Date.now() - lastAt > 90_000) throw new Error(`the zone's download stalled at ${z?.cursor} / ${z?.total} (${z?.state})`);
      await Bun.sleep(15_000);
    }
    const kept = await app.js<{ kinds?: Record<string, { zone: number; zoneBytes: number }> }>(`__bh.pwa.stats()`);
    const keptKinds = Object.fromEntries(
      Object.entries(kept.kinds ?? {})
        .filter(([, v]) => v.zone)
        .map(([k, v]) => [k, v.zone]),
    );
    console.log(
      `  ready in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${z?.done} links, ${z?.none} none, ${z?.failed} failed, ${((z?.bytes ?? 0) / 1e6).toFixed(0)} MB, schema ${z?.schema}; kept by kind ${JSON.stringify(keptKinds)}`,
    );
    expect(z?.failed).toBe(0);
    expect(z?.schema).toBe(2);
    for (const k of ["terrarium", "mapterhorn", "osm", "overture", "cover"]) expect(keptKinds[k] ?? 0).toBeGreaterThan(0);

    // (the zone's alone then: the tiles' own cache emptied, the network cut, the page loaded again)
    await app.js(`__bh.pwa.clearTiles()`);
    // (the page's and its Service Worker's — app.offline: the page's session alone left the worker online, a tile the zone
    // lacked came from the network unseen, 10 Nov 2026 —; again after the reload, a worker started meanwhile cut too)
    // (what the page asks and does not get, offline, by path — said at the end)
    const asked = new Map<string, string>();
    const lostPaths = new Map<string, number>();
    app.cdp.on("Network.requestWillBeSent", (p) => asked.set(String(p.requestId), String((p.request as { url: string }).url)));
    app.cdp.on("Network.loadingFailed", (p) => {
      const u = asked.get(String(p.requestId)) ?? "?";
      const k = u
        .replace(/^https?:\/\/localhost:\d+/, "")
        .replace(/\?.*$/, "")
        .replace(/\/\d+\/\d+\/\d+(\.\w+)?$/, "/z/x/y$1")
        .replace(/-[0-9a-z]{8}\./, "-HASH.")
        .slice(0, 110);
      lostPaths.set(k, (lostPaths.get(k) ?? 0) + 1);
    });
    console.log(`  offline: ${await app.offline(true)} worker targets cut`);
    await app.load("scene=game:artemis");
    await app.offline(true);
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 120_000);
    await app.js(`(() => { __bh.game.setDate(${JSON.stringify(NIGHT)}); return 1; })()`);
    await Bun.sleep(1000);
    // (in the zone, 450 m over the ground, down the final's line; held while its world comes in — the tiles, the scenery)
    // (300 m before the centre on the final's course, so that 6 s at 110 m/s keep it in the zone — out of it nothing is held,
    // the game asks what the network has: a first run flew 15 s, left the 1 km zone, its z 17 relief asked)
    const D = Math.PI / 180;
    const sLat = ZONE.lat - (0.3 * Math.cos(134 * D)) / 111.2,
      sLon = ZONE.lon - (0.3 * Math.sin(134 * D)) / (111.2 * Math.cos(ZONE.lat * D));
    const place = `__bh.game.flyAt(${sLat}, ${sLon}, 450, 134, 110); __bh.settings.shipMount = "cockpit";`;
    await app.js(`(() => { __bh.freeze(false); ${place} return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(__bh.freeze(true), 1)`);
    await app.dataSettled("the zone's world, offline", { maxMs: 180_000 });
    // (counted from here: the page's first scene — its default place's, before the jump — went on reading Overture's
    // infrastructure there, its fetches not cancelled with the scene: 38 ranges of another region counted as this flight's in
    // a first run; an open defect — ANALYSE-STREAMING ST2, cancellable fetches)
    const s0 = await served();
    // (the ground loaded offline: its tiles that failed within the zone — a level's tile, or an orthophoto's, whose box holds
    // the zone's centre —: none; the page's first place — under its orbit, far from any zone — fails its own, not counted)
    const lost = await app.js<string[]>(`(() => { const t = __bh.renderer.earthTiles, D = Math.PI / 180, out = [];
      for (const [key, f] of t.failures ?? []) { const m = /^(o?)(\\d+)\\/(\\d+)\\/(\\d+)$/.exec(key); if (!m) continue;
        const z = +m[2], n = 2 ** z, x = Math.floor(((${ZONE.lon} + 180) / 360) * n), y = Math.floor(((1 - Math.asinh(Math.tan(${ZONE.lat} * D)) / Math.PI) / 2) * n);
        if (+m[3] === x && +m[4] === y) out.push(key + " ×" + f.n); }
      return out; })()`);
    console.log(
      `  the ground's tiles failed over the zone's centre, offline: ${lost.length ? lost.join(", ") : "none"} (failed in all: ${await app.js<number>("__bh.renderer.earthTiles.failed")})`,
    );
    const held = await app.js<Record<string, number | string | null>>(`(() => { const s = __bh.renderer.earthScenery.stats();
      return { status: s.status, buildings: s.buildings, trees: s.trees, roads: s.roads, zone: s.zoneResponses, other: s.otherResponses, city: +(__bh.renderer.cityLight * 1e5).toFixed(2) }; })()`);
    await app.js(
      `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.camera.setLook(0, -10); return 1; })()`,
    );
    await app.settled();
    await Bun.sleep(4000);
    await app.shot(`${OUT}/held.png`);
    // (flown 6 s on its autopilot, within the zone: new tiles, all from the zone)
    await app.js(`(() => { __bh.freeze(false); const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      c.jetModes.alt = Math.round(c.geoNow().alt); c.jetModes.hdg = c.attitudeNow().heading; c.jetModes.spd = 110; return 1; })()`);
    await Bun.sleep(6_000);
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(3000);
    await app.shot(`${OUT}/flown.png`);
    const s1 = await served();
    const net: Record<string, number> = {},
      zoned: Record<string, number> = {};
    for (const [k, v] of Object.entries(s1.kinds ?? {})) {
      const n = v.network - (s0.kinds?.[k]?.network ?? 0),
        zz = v.zone - (s0.kinds?.[k]?.zone ?? 0);
      if (n) net[k] = n;
      if (zz) zoned[k] = zz;
    }
    // (the zone's ranges of Overture's base theme against the ones the network served: the same archive's, which?)
    const zoneBase = await app.js<string[]>(
      `(async () => (await (await caches.open("kerr-zones-v1")).keys()).map((r) => r.url).filter((u) => u.includes("base.pmtiles")).map((u) => u.split("kerr-range=")[1]).sort())()`,
    );
    const netBase = (s1.recent ?? []).filter((u) => u.includes("base.pmtiles")).map((u) => u.split("kerr-range=")[1]);
    console.log(
      `  base.pmtiles: ${zoneBase.length} ranges in the zone (${zoneBase.slice(0, 4).join(", ")}…); from the network ${netBase.length} (${netBase.slice(0, 6).join(", ")}…)`,
    );
    const report = {
      est,
      zone: z,
      keptKinds,
      held,
      lost,
      lostPaths: [...lostPaths],
      zoned,
      net,
      recent: s1.recent ?? [],
      zoneBase,
      netBase,
    };
    await Bun.write(`${OUT}/report.json`, JSON.stringify(report, null, 1));
    console.log(`  offline, held: ${JSON.stringify(held)}`);
    console.log(`  served from the zone by kind: ${JSON.stringify(zoned)}; from the network: ${JSON.stringify(net)}`);
    if (s1.recent?.length) console.log(`  the network's last: ${s1.recent.join(" · ")}`);
    const lostList = [...lostPaths].sort((x, y) => y[1] - x[1]);
    console.log(
      `  the page's requests that failed offline, by path (${lostList.length}): ${
        lostList
          .slice(0, 40)
          .map(([k, n]) => `${n} × ${k}`)
          .join(" · ") || "none"
      }`,
    );
    await app.offline(false);
    expect(lost).toEqual([]);
    // (drawn from the zone: its buildings, its lamps' roads; not one ground or scenery tile from the network — the tactical map's
    // OSM tiles apart, kept out of every zone by their policy)
    expect(held.status).toBe("ready");
    expect(Number(held.buildings)).toBeGreaterThan(100);
    // (the scene's own: two infrastructure tiles at the turbines' reach's very edge may fall past the zone's disc)
    expect(Number(held.other)).toBeLessThanOrEqual(Math.max(2, 0.02 * Number(held.zone)));
    const { map = 0, ...rest } = net;
    console.log(`  the tactical map's OSM tiles from the network: ${map}`);
    expect(rest).toEqual({});
    await app.js(`__bh.pwa.zones.remove(${JSON.stringify(id)})`);
    expect(app.cdp.errors).toEqual([]);
  }, 1_800_000);
});
