import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Offline zones with the world scenery (docs/ANALYSE-IGN-LIDAR.md §9; src/system/zones.ts sceneryZoneChains,
// src/system/scenery-sources.ts): a zone holds, beside its ground, every source the scenery's scenes ask with the camera
// anywhere in it — the land cover's cells (WorldCover), OpenFreeMap's vector tiles, the IGN's canopy and ground blocks, its
// BD TOPO's buildings. Over Chamonix, a 1.5 km zone of the airfield's profile (the relief to z 17, the orthophotos to z 18:
// every level a flight at 450 m over the ground asks — none finer left to the network), the scenery high at the detail's
// normal reach, the IGN's relief on (its survey and buildings with it): the valley flown online first (its trees and buildings
// counted, shot), the zone fetched, the tiles' own cache emptied, the network cut, the page loaded again; then placed over
// the valley in the cockpit, held still — its trees and buildings there, every scene's response from the zone —, and flown
// 1.8 km up the valley at 450 m over its floor: the scenes asked anew as it goes, the Service Worker's figures by kind
// (pwa/rules.ts tileKind: the scenery worker's fetches, out of the page's sight) and the page's own — none from the network.
// (E2E_SHOTS=<dir>: zones-scenery-online, zones-scenery-offline — the cockpit over the valley, held still.)
// Duration: ~9 min on kerr-mini (the download ~6 of them).
// Done when: the zone ready, the offline scenes' trees and buildings drawn from it, no tile of any kind from the network,
// the zone dropped.

const ZONE = { name: "Chamonix décor (e2e)", lat: 45.92, lon: 6.87, radiusKm: 1.5, profile: "airport" };
const D = Math.PI / 180;
// (the flight: 1.1 km south-west of the centre, up the valley's axis at 45° — tests/e2e/zones.e2e.test.ts's)
const START = {
  lat: ZONE.lat - (1.1 * Math.cos(45 * D)) / 111.2,
  lon: ZONE.lon - (1.1 * Math.sin(45 * D)) / (111.2 * Math.cos(ZONE.lat * D)),
};
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true, earthIgnSilhouettes: false, earthScenery: "high", earthSurface: "satellite", detailReach: "normal", f35AutoProtect: false }`;
/** the scenery's kinds, counted by the Service Worker (and the ground's: every kind, from every client — none from the
 *  network); the profile's finest orthophotos (finer ones, were any asked, counted apart by the page) */
const ORTHO_Z1 = 18;
const SCENERY_KINDS = ["osm", "buildings", "cover", "canopy"];

type Served = {
  zone: number;
  lru: number;
  network: number;
  kinds?: Record<string, { zone: number; lru: number; network: number }>;
  recent?: string[];
};
type Scene = {
  status: string;
  trees: number;
  surveyedTrees: number;
  buildings: number;
  bdtopoBuildings: number;
  coverPixels: number;
  rgbPixels: number;
  zoneResponses: number;
  otherResponses: number;
  lastError: string | null;
  lat: number | null;
  lon: number | null;
};

/** the progress on screen (top middle, French as the user reads it) — put back after each load */
const PROGRESS = `(() => {
  document.getElementById("zone-progress")?.remove();
  const el = Object.assign(document.createElement("div"), { id: "zone-progress" });
  el.style.cssText = "position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:99999;padding:8px 16px;border-radius:8px;background:rgba(10,14,20,.82);color:#e8f1ff;font:13px/1.45 ui-monospace,monospace;text-align:center;pointer-events:none;white-space:pre";
  document.body.append(el);
  window.__zonePhase ??= "";
  clearInterval(window.__zoneTimer);
  const mb = (b) => (b / 1e6).toFixed(0) + " Mo";
  const state = { downloading: "téléchargement", paused: "en pause", ready: "prête" };
  window.__zoneTimer = setInterval(async () => {
    const z = (await __bh.pwa?.zones?.list().catch(() => []))?.find((v) => v.name === ${JSON.stringify(ZONE.name)});
    const s = __bh.renderer.earthScenery.stats();
    el.textContent = "Zone hors ligne « Chamonix » avec le décor — 1,5 km, profil aéroport\\n" + (window.__zonePhase || "") +
      (z ? "\\n" + z.cursor + " / " + z.total + " tuiles · " + mb(z.bytes) + " · " + (state[z.state] ?? z.state) : "") +
      "\\ndécor : " + s.trees + " arbres · " + s.buildings + " bâtiments · " + s.zoneResponses + " réponses de la zone, " + s.otherResponses + " d'ailleurs";
  }, 1500);
  return 1; })()`;

describe.skipIf(!E2E)("an offline zone with the world scenery", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const phase = (text: string) => app.js(`(window.__zonePhase = ${JSON.stringify(text)}, 1)`);
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", sw: true, tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
    await app.js(PROGRESS);
  }, 300_000);
  afterAll(async () => {
    await app?.cdp
      .send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      .catch(() => {});
    app?.close();
    stopServer();
  });

  const zone = () =>
    app.js<{ state: string; done: number; total: number; cursor: number; bytes: number; none: number; failed: number } | null>(
      `(async () => (await __bh.pwa.zones.list()).find((z) => z.name === ${JSON.stringify(ZONE.name)}) ?? null)()`,
    );
  const scene = () => app.js<Scene>(`__bh.renderer.earthScenery.stats()`);
  const served = async () => (await app.js<{ served: Served }>(`__bh.pwa.stats()`)).served;
  /** the network's responses by kind since `from` */
  const fromNetwork = (from: Served, to: Served) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(to.kinds ?? {})) {
      const d = v.network - (from.kinds?.[k]?.network ?? 0);
      if (d) out[k] = d;
    }
    return out;
  };
  // (the flight's start: the date, a second for the clock, the jump; held while the ground comes in, placed again on it —
  // 450 m over the valley's floor —; the scenery's scene there awaited, drawn; held still and shot; then flown level at
  // 120 m/s on the autopilot, in the cockpit)
  const fly = async (label: "online" | "offline", before?: () => Promise<void>) => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    const place = `__bh.game.flyAt(${START.lat}, ${START.lon}, 450, 45, 120); __bh.settings.shipMount = "cockpit";`;
    await app.js(`(() => { ${place} __bh.freeze(true); return 1; })()`);
    await Bun.sleep(2000);
    await before?.();
    const until = (cond: string, what: string, ms = 120_000) =>
      app
        .waitFor(`(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return ${cond}; })()`, ms)
        .catch(async (e) => {
          throw new Error(`${what} never came in: ${JSON.stringify(await scene())} — ${e}`);
        });
    await until("t.finest >= 14 && t.pending === 0", "the relief");
    const at = await app.js<{ alt: number; ground: number }>(`(() => { ${place} const g = __bh.camera.geoNow();
      return { alt: g.alt, ground: __bh.sys.groundAt(g.lat, g.lon) }; })()`);
    await until("t.orthoPending === 0 && t.pending === 0", "the orthophotos");
    // (the scene where the cockpit looks: its trees and buildings drawn)
    await until(`s.status === "ready" && s.trees > 0 && s.buildings > 0`, "the scenery", 180_000);
    expect(at.alt - at.ground).toBeGreaterThan(350);
    expect(at.alt - at.ground).toBeLessThan(500);
    const held = await scene();
    // (held still, every pixel shaded, the raster's: shot)
    await app.js(
      `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; return 1; })()`,
    );
    await app.settled();
    await app.js(`(__bh.game.pause(true), 1)`);
    await app.waitFor(`__bh.renderer.lastPhase !== "realtime"`, 20_000).catch(() => {});
    await Bun.sleep(6000);
    expect(await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`)).toBe("raster");
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/zones-scenery-${label}.png`);
    }
    await app.js(
      `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, earthRasterScale: 0.75, motionBlur: 0.5 }); __bh.game.pause(false); return 1; })()`,
    );
    await app.js(`(__bh.freeze(false), 1)`);
    await Bun.sleep(1500);
    const modes = await app.js<{ alt: number | null; spd: number | null }>(`(() => { const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      if (c.jetModes.spd !== null) c.jetModes.spd = 120; return { alt: c.jetModes.alt, spd: c.jetModes.spd }; })()`);
    expect(modes.alt).not.toBeNull();
    // (15 s up the valley: 1.8 km, the scene's centre stepping on — new scenes asked)
    await Bun.sleep(15_000);
    const flown = await app.js<{ agl: number; gs: number }>(`(() => { const g = __bh.camera.geoNow();
      return { agl: g.alt - __bh.sys.groundAt(g.lat, g.lon), gs: g.gs }; })()`);
    expect(flown.agl).toBeGreaterThan(250);
    await app.js(`(__bh.freeze(true), 1)`);
    await until(`s.status === "ready" && s.trees > 0`, "the scenery after the flight", 180_000);
    return { held, after: await scene(), flown };
  };

  test("Chamonix's valley with its trees and buildings: fetched ahead, then flown offline — not one tile from the network", async () => {
    await phase("En ligne : le décor de la vallée");
    const online = await fly("online");
    console.log(
      `  online, held: ${online.held.trees} trees (${online.held.surveyedTrees} by the IGN's canopy), ${online.held.buildings} buildings (${online.held.bdtopoBuildings} BD TOPO), cover ${online.held.coverPixels} px, colours ${online.held.rgbPixels} px`,
    );
    const est = await app.js<{ chains: number; urls: number; bytes: number; seconds: number }>(
      `__bh.pwa.zones.estimate(${JSON.stringify(ZONE)})`,
    );
    console.log(`  the zone: ${est.chains} chains, ${est.urls} URLs, ≈ ${(est.bytes / 1e6).toFixed(0)} MB, ≈ ${est.seconds.toFixed(0)} s`);
    await phase("Téléchargement de la zone et de son décor");
    const id = await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(ZONE)})`);
    expect(id).toBeTruthy();
    const t0 = Date.now();
    await app.waitFor(
      `(async () => { const z = (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}); return z && (z.state === "ready" || (z.state === "paused" && z.cursor >= z.total)); })()`,
      1_200_000,
    );
    const z = await zone();
    const kept = await app.js<{ zoneTiles: number; zoneBytes: number; kinds?: Record<string, { zone: number; zoneBytes: number }> }>(
      `__bh.pwa.stats()`,
    );
    console.log(
      `  ready in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${z?.done} links in, ${z?.none} none, ${z?.failed} failed, ${((z?.bytes ?? 0) / 1e6).toFixed(0)} MB, state ${z?.state}`,
    );
    console.log(
      `  kept by kind: ${Object.entries(kept.kinds ?? {})
        .filter(([, v]) => v.zone)
        .map(([k, v]) => `${k} ${v.zone} (${(v.zoneBytes / v.zone / 1e3).toFixed(0)} kB)`)
        .join(", ")}`,
    );
    expect(z?.failed).toBe(0);
    for (const k of SCENERY_KINDS) expect(kept.kinds?.[k]?.zone ?? 0).toBeGreaterThan(0);
    // (only the zone's then: the tiles' own cache emptied, the network cut, the page loaded again)
    await app.js(`__bh.pwa.clearTiles()`);
    // (the ground's tiles the page asks counted from its first script — tests/e2e/zones.e2e.test.ts's —: a zone's marked by
    // the worker, any other the network's, the orthophotos finer than the profile's apart)
    await app.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { const hosts = ["s3.amazonaws.com", "gibs.earthdata.nasa.gov", "tiles.maps.eox.at", "data.geopf.fr", "geo.admin.ch"];
        const f = window.fetch.bind(window); window.__tiles = { zone: 0, other: 0, failed: 0, finer: 0, others: [] };
        const finer = (url) => /ORTHOIMAGERY|swissimage/.test(url) && Number(url.match(/TILEMATRIX=(\\d+)/)?.[1] ?? url.match(/\\/(\\d+)\\/\\d+\\/\\d+\\.jpe?g/)?.[1]) > ${ORTHO_Z1};
        window.fetch = async (input, init) => { const url = String(input instanceof Request ? input.url : input);
          const tile = hosts.some((h) => url.includes(h));
          if (tile && finer(url)) { window.__tiles.finer++; return f(input, init); }
          try { const r = await f(input, init); if (tile) { if (r.headers.get("x-kerr-zone") === "1") window.__tiles.zone++; else { window.__tiles.other++; if (window.__tiles.others.length < 8) window.__tiles.others.push(r.status + " " + url.slice(0, 240)); } } return r; }
          catch (e) { if (tile) { window.__tiles.failed++; if (window.__tiles.others.length < 8) window.__tiles.others.push("failed " + url.slice(0, 150)); } throw e; } }; })();`,
    });
    await app.cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await app.load("scene=game:artemis");
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 120_000);
    await app.js(PROGRESS);
    await app
      .waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.pending === 0 && t.orthoPending === 0; })()`, 60_000)
      .catch(() => {});
    await phase("Réseau coupé, page rechargée : vol bas dans la vallée, son décor de la zone");
    // (counted from two seconds after the jump: what the scene's start asked — far from the zone, its scenery's worker ended
    // by the jump — out of the count)
    let s0: Served = { zone: 0, lru: 0, network: 0 };
    const offline = await fly("offline", async () => {
      s0 = await served();
      await app.js(`(() => { Object.assign(window.__tiles, { zone: 0, other: 0, failed: 0, finer: 0, others: [] }); return 1; })()`);
    });
    const s1 = await served();
    const page = await app.js<{ zone: number; other: number; failed: number; finer: number; others: string[] }>(`window.__tiles`);
    const net = fromNetwork(s0, s1);
    const zoned: Record<string, number> = {};
    for (const [k, v] of Object.entries(s1.kinds ?? {})) {
      const d = v.zone - (s0.kinds?.[k]?.zone ?? 0);
      if (d) zoned[k] = d;
    }
    console.log(
      `  offline, held: ${offline.held.trees} trees (${offline.held.surveyedTrees} by the canopy), ${offline.held.buildings} buildings (${offline.held.bdtopoBuildings} BD TOPO), cover ${offline.held.coverPixels} px; the scene's responses ${offline.held.zoneResponses} from the zone, ${offline.held.otherResponses} from elsewhere`,
    );
    console.log(
      `  offline, after the flight (scene at ${offline.after.lat?.toFixed(4)}, ${offline.after.lon?.toFixed(4)}): ${offline.after.trees} trees, ${offline.after.buildings} buildings, ${offline.after.zoneResponses} from the zone, ${offline.after.otherResponses} from elsewhere, ${offline.flown.agl.toFixed(0)} m over the floor`,
    );
    console.log(`  the worker served from the zone by kind: ${JSON.stringify(zoned)}; from the network: ${JSON.stringify(net)}`);
    console.log(
      `  the page's ground: ${page.zone} tiles from the zone, ${page.other} from elsewhere, ${page.failed} failed, ${page.finer} orthophotos finer than the profile's${page.others.length ? ` (${page.others.join(" · ")})` : ""}`,
    );
    if (s1.recent?.length) console.log(`  the network's last: ${s1.recent.join(" · ")}`);
    await app.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await phase(
      `Hors ligne : ${offline.held.trees} arbres, ${offline.held.buildings} bâtiments — ${Object.values(zoned).reduce((a, b) => a + b, 0)} tuiles de la zone, ${Object.entries(
        net,
      ).reduce((a, [k, b]) => a + (k === "map" ? 0 : b), 0)} du réseau (carte tactique OSM à part : ${net.map ?? 0})`,
    );
    // (the scenery drawn offline as online: its trees, the IGN's canopy's among them, its buildings, the BD TOPO's, its cover)
    expect(offline.held.trees).toBeGreaterThan(0.8 * online.held.trees);
    expect(offline.held.surveyedTrees).toBeGreaterThan(0);
    expect(offline.held.buildings).toBeGreaterThan(0.8 * online.held.buildings);
    expect(offline.held.bdtopoBuildings).toBeGreaterThan(0);
    expect(offline.held.coverPixels).toBeGreaterThan(0.9 * online.held.coverPixels);
    expect(offline.held.zoneResponses).toBeGreaterThan(50);
    expect(offline.held.otherResponses).toBe(0);
    expect(offline.after.otherResponses).toBe(0);
    for (const k of SCENERY_KINDS) expect(zoned[k] ?? 0).toBeGreaterThan(0);
    // (not one tile of any kind — the scenery's, the ground's — from the network; the tactical map's OSM tiles apart — the
    // cockpit's TSD —: their policy keeps them out of any zone, the budgeted cache's or none offline)
    const { map = 0, ...rest } = net;
    console.log(`  the tactical map's OSM tiles from the network: ${map}`);
    expect(rest).toEqual({});
    expect(page.zone).toBeGreaterThan(100);
    expect(page.other + page.failed).toBe(0);
    await app.js(`__bh.pwa.zones.remove(${JSON.stringify(id)})`);
    await phase("Zone supprimée");
    expect((await app.js<{ zoneTiles: number }>(`__bh.pwa.stats()`)).zoneTiles).toBe(0);
  }, 1_800_000);
});
