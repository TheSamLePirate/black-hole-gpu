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
    await app?.cdp
      .send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      .catch(() => {});
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
    await app.js(
      `(() => { __bh.freeze(false); __bh.game.flyAt(${ZONE.lat - 0.004}, ${ZONE.lon + 0.006}, 260, 315, 140); __bh.settings.shipMount = "chase"; return 1; })()`,
    );
    await Bun.sleep(1500);
    await app.js(`(__bh.freeze(true), 1)`);
    await app
      .waitFor(
        `(() => { const s = __bh.renderer.earthScenery.stats(); return !s.pending && s.status === "ready" && s.overtureBuildings > 0; })()`,
        240_000,
      )
      .catch(async () => console.log(`  (${label}: no Overture building after 240 s — ${JSON.stringify(await scene())})`));
    const s = await scene();
    const credit = await app.js<boolean>(`!document.querySelector('[data-testid="overture-credit"]')?.hidden`);
    console.log(
      `  ${label}: ${s.buildings} buildings, ${s.overtureBuildings} Overture's (${s.overtureTiles} tiles), roofs ${JSON.stringify(s.roofShapes)}, ${s.zoneResponses} from a zone, ${s.otherResponses} from elsewhere${s.surveyError ? ` (${s.surveyError.slice(0, 160)})` : ""}; credit ${credit}`,
    );
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.js(`(__bh.camera.setLook(0, -22), 1)`);
      await app.settled();
      await Bun.sleep(3000);
      await app.shot(`${shots}/overture-munich-${label}.png`);
    }
    return { s, credit, overture: kind(before, await served(), "overture") };
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
    console.log(`  the ranges again: ${JSON.stringify(cached.overture)}`);
    expect(cached.s.overtureBuildings).toBeGreaterThan(0.9 * online.s.overtureBuildings);
    expect(cached.overture.lru).toBeGreaterThan(0);
    expect(cached.overture.network).toBe(0);
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
    await app.cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await app.load("scene=game:artemis");
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 120_000);
    const offline = await arrive("offline");
    console.log(`  offline, the ranges: ${JSON.stringify(offline.overture)}`);
    const after = await served();
    console.log(
      `  offline, the network's by kind: ${JSON.stringify(Object.fromEntries(Object.entries(after.kinds ?? {}).filter(([, v]) => v.network)))}; its last: ${JSON.stringify((after as { recent?: string[] }).recent ?? [])}`,
    );
    await app.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    expect(offline.s.overtureBuildings).toBeGreaterThan(0.9 * online.s.overtureBuildings);
    expect(offline.overture.zone).toBeGreaterThan(0);
    expect(offline.overture.network).toBe(0);
    // (the releases' listing alone from elsewhere: network first by design — CDP's offline does not cut the Service Worker's own
    // fetches, the network's then; truly offline, the zone's)
    expect(offline.s.otherResponses).toBeLessThanOrEqual(1);
    await app.js(`__bh.pwa.zones.remove(${JSON.stringify(id)})`);
  }, 1_800_000);
});
