import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Overture Maps' buildings (docs/PLAN-BATIMENTS-AAA.md B7; src/system/pmtiles.ts): outside France, the scenery's near
// buildings read from Overture's PMTiles archive by byte ranges — the Service Worker keeping each range under a key of its
// own (sw.ts rangeTile), an offline zone resolving its tiles' ranges itself (sw.ts zoneFetch, `kerr-overture:` links).
// Over Munich's old town: the scene online (its Overture buildings counted, their roofs' shapes, the credit shown), loaded
// again (the ranges from the tiles' cache, none from the network), a 1 km zone fetched, the tiles' cache emptied, the
// network cut, the page loaded again: the same buildings, every range from the zone.
// (E2E_SHOTS=<dir>: overture-munich-online, overture-munich-offline.)
// Duration: ~6 min.
// Done when: Overture's buildings in the scene online, from the cache, then offline from the zone; none from the network.

const ZONE = { name: "Munich Overture (e2e)", lat: 48.1374, lon: 11.5755, radiusKm: 1, profile: "low" };
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthScenery: "high", detailReach: "normal", earthOverture: true, f35AutoProtect: false, f35Invulnerable: true }`;

type Served = { zone: number; lru: number; network: number; kinds?: Record<string, { zone: number; lru: number; network: number }> };
type Scene = {
  status: string;
  buildings: number;
  overtureBuildings: number;
  overtureTiles: number;
  roofShapes: Record<string, number>;
  zoneResponses: number;
  otherResponses: number;
  surveyError: string | null;
  lat: number | null;
  lon: number | null;
  lastError: string | null;
};

describe.skipIf(!E2E)("Overture Maps' buildings", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", sw: true, tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
  }, 300_000);
  afterAll(async () => {
    await app?.offline(false).catch(() => {});
    app?.close();
    stopServer();
  });

  const scene = () => app.js<Scene>(`__bh.renderer.earthScenery.stats()`);
  const served = async () => (await app.js<{ served: Served }>(`__bh.pwa.stats()`)).served;
  const kind = (a: Served, b: Served, k: string) => ({
    zone: (b.kinds?.[k]?.zone ?? 0) - (a.kinds?.[k]?.zone ?? 0),
    lru: (b.kinds?.[k]?.lru ?? 0) - (a.kinds?.[k]?.lru ?? 0),
    network: (b.kinds?.[k]?.network ?? 0) - (a.kinds?.[k]?.network ?? 0),
  });
  // (south-east of the Marienplatz, 260 m up, held: the scene there awaited, its buildings Overture's)
  const arrive = async (label: string) => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T09:00:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    const before = await served();
    // (100 m/s: under the scenery's fast flight — 120 m/s and more, T8m —, whose quick scenes alone hold 980 buildings at most)
    await app.js(
      `(() => { __bh.freeze(false); __bh.game.flyAt(${ZONE.lat - 0.004}, ${ZONE.lon + 0.006}, 260, 315, 100); __bh.settings.shipMount = "chase"; return 1; })()`,
    );
    await Bun.sleep(1500);
    // (frozen, then placed again at the very place: the scene's centre the same online and reloaded — flown 1.5 s at the frames'
    // pace, the craft stood a little apart each time, the scene's tiles not the same: 9 online, 8 reloaded, ranges asked anew)
    await app.js(
      `(() => { __bh.freeze(true); __bh.game.flyAt(${ZONE.lat - 0.004}, ${ZONE.lon + 0.006}, 260, 315, 100); __bh.settings.shipMount = "chase"; return 1; })()`,
    );
    await app
      .waitFor(
        // (the full scene, not the quick first one — its box 0.35 of the reach's, its buildings 980 at most: QUICK_SHARE)
        `(() => { const s = __bh.renderer.earthScenery.stats(); return !s.pending && !s.quick && s.status === "ready" && s.overtureBuildings > 0; })()`,
        240_000,
      )
      .catch(async () => console.log(`  (${label}: no Overture building after 240 s — ${JSON.stringify(await scene())})`));
    const s = await scene();
    const credit = await app.js<boolean>(`!document.querySelector('[data-testid="overture-credit"]')?.hidden`);
    console.log(
      `  ${label}: ${s.buildings} buildings, ${s.overtureBuildings} Overture's (${s.overtureTiles} tiles, the scene at ${s.lat?.toFixed(5)}, ${s.lon?.toFixed(5)}), roofs ${JSON.stringify(s.roofShapes)}, ${s.zoneResponses} from a zone, ${s.otherResponses} from elsewhere${s.surveyError ? ` (${s.surveyError.slice(0, 160)})` : ""}; credit ${credit}`,
    );
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.js(`(__bh.camera.setLook(0, -22), 1)`);
      await app.settled();
      await Bun.sleep(3000);
      await app.shot(`${shots}/overture-munich-${label}.png`);
    }
    const after = await served();
    return { s, credit, overture: kind(before, after, "overture"), base: kind(before, after, "overture-base") };
  };

  test("Munich's old town from Overture: online, from the cache, then offline from a zone", async () => {
    const online = await arrive("online");
    expect(online.s.overtureBuildings).toBeGreaterThan(1000);
    expect(online.s.overtureTiles).toBeGreaterThan(0);
    expect(online.credit).toBe(true);
    // (Overture's roofs as mapped: Munich's gables, hips)
    expect((online.s.roofShapes.gabled ?? 0) + (online.s.roofShapes.hipped ?? 0)).toBeGreaterThan(500);
    // (loaded again: its ranges from the tiles' cache, none from the network)
    await app.load("scene=game:artemis");
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 120_000);
    const cached = await arrive("cached");
    console.log(`  the ranges again: buildings ${JSON.stringify(cached.overture)}, base theme ${JSON.stringify(cached.base)}`);
    console.log(
      `  the tiles' cache: ${JSON.stringify(await app.js("(async () => { const s = await __bh.pwa.stats(); return s && { tiles: s.tiles, mb: Math.round(s.tileBytes / 1e6), budgetMb: Math.round(s.tileBudget / 1e6) }; })()"))}`,
    );
    console.log(
      `  the ranges cut before their end (not kept): ${JSON.stringify(((await app.js<{ served?: { rangesCut?: string[] } } | null>("__bh.pwa.stats()"))?.served?.rangesCut ?? []).map((u) => u.replace(/^.*tiles\//, "")))}`,
    );
    console.log(
      `  the network's last Overture asks: ${JSON.stringify(((await app.js<{ served?: { recent?: string[] } } | null>("__bh.pwa.stats()"))?.served?.recent ?? []).filter((u) => u.includes("overturemaps")).map((u) => u.replace(/^.*tiles\//, "")))}`,
    );
    expect(cached.s.overtureBuildings).toBeGreaterThan(0.9 * online.s.overtureBuildings);
    expect(cached.overture.lru).toBeGreaterThan(0);
    // (the scene's centre follows the streaming's lead along the track — its moment —: reloaded at the same place it stood 1.4 km
    // from the online one (48.145, 11.562 → 48.135, 11.575, 11 Nov 2026), a tile or two not the same — their ranges the network's;
    // the rest the cache's. Offline, below, every range the zone's)
    expect(cached.overture.network).toBeLessThanOrEqual(3);
    expect(cached.overture.lru).toBeGreaterThan(3 * cached.overture.network);
    // (the zone: its Overture tiles' ranges resolved and kept by the Service Worker)
    const id = await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(ZONE)})`);
    expect(id).toBeTruthy();
    await app.waitFor(
      `(async () => { const z = (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}); return z && (z.state === "ready" || (z.state === "paused" && z.cursor >= z.total)); })()`,
      1_200_000,
    );
    const kept = await app.js<{ kinds?: Record<string, { zone: number; zoneBytes: number }> }>(`__bh.pwa.stats()`);
    const z = await app.js<{ failed: number; bytes: number; done: number }>(
      `(async () => (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}))()`,
    );
    console.log(
      `  the zone: ${z.done} links, ${z.failed} failed, ${(z.bytes / 1e6).toFixed(0)} MB; Overture's ranges kept ${JSON.stringify(kept.kinds?.overture)}`,
    );
    expect(z.failed).toBe(0);
    expect(kept.kinds?.overture?.zone ?? 0).toBeGreaterThan(3);
    // (offline: the tiles' cache emptied, the network cut, the page loaded again)
    await app.js(`__bh.pwa.clearTiles()`);
    // (the page and its Service Worker cut — lib/cdp.ts offline: the page's alone left the worker's fetches on the network)
    await app.offline(true);
    await app.load("scene=game:artemis");
    // (again after the load: its new worker targets)
    await app.offline(true);
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 120_000);
    const offline = await arrive("offline");
    console.log(`  offline, the ranges: ${JSON.stringify(offline.overture)}`);
    const after = await served();
    console.log(
      `  offline, the network's by kind: ${JSON.stringify(Object.fromEntries(Object.entries(after.kinds ?? {}).filter(([, v]) => v.network)))}; its last: ${JSON.stringify((after as { recent?: string[] }).recent ?? [])}`,
    );
    await app.offline(false);
    expect(offline.s.overtureBuildings).toBeGreaterThan(0.9 * online.s.overtureBuildings);
    expect(offline.overture.zone).toBeGreaterThan(0);
    expect(offline.overture.network).toBe(0);
    // (the releases' listing alone from elsewhere: network first by design — CDP's offline does not cut the Service Worker's own
    // fetches, the network's then; truly offline, the zone's)
    expect(offline.s.otherResponses).toBeLessThanOrEqual(1);
    await app.js(`__bh.pwa.zones.remove(${JSON.stringify(id)})`);
  }, 1_800_000);
});
