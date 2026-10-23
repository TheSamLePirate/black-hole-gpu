// The Service Worker (PLAN-MONDE M1): the application served from its cache — a hot reload instant, the
// last scene playable offline — and the Earth's tiles kept under a budget. Built on its own as sw.js
// (server.ts, scripts/build-pages.ts); registered by src/pwa.ts. The rules are in src/pwa/rules.ts.
//
//   · at install: the shell's core files (precache.json, written by the build: the page, its script and
//     styles, the workers, the WASM) fetched into the build's cache;
//   · hashed assets (textures, meshes, ephemerides…): cache first, forever — a new build has new names;
//   · the page, version.json, docs/: network first, the cache when the network fails;
//   · the relief's and imagery's tiles: cache first under TILE_BUDGET, the least recently served evicted
//     (their index — url, last use, size — in IndexedDB, since the Cache API keeps no dates);
//   · the station's elements: network first, the cache when offline;
//   · the offline zones' tiles (I8a): a second cache, kerr-zones-v1, out of the budget — looked in first —, filled by the
//     page's zones (src/pwa-zones.ts) a batch of URLs at a time (`zone-fetch`), a tile kept while a zone holds it.
// A new build's worker waits until the page tells it to take over (the page shows a toast), then claims
// the open pages and drops its own app's older shells' caches — the site and a preview under it (the
// CI's test/) share the origin's Cache Storage: each worker keeps to its own scope's caches and pages.

/// <reference lib="webworker" />
import {
  classify,
  evictions,
  isAppPage,
  isLegacyShell,
  isOwnShellCache,
  ownsLegacyShell,
  SHELL_CACHE,
  TILE_CACHE,
  TILE_BUDGET,
  type TileEntry,
  ZONE_CACHE,
  type ZoneRecord,
  zoneRelease,
  type ZoneTile,
} from "./pwa/rules";

declare const self: ServiceWorkerGlobalScope;
/** the build this worker belongs to (the build script substitutes it; dev: the time the worker was built) */
declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
/** the build's top-level directories (scripts/build-pages.ts; the dev server: none — the whole scope) */
declare const __DIRS__: string[];
const DIRS = typeof __DIRS__ === "object" ? __DIRS__ : null;
/** the scope's root: the page whatever its query or hash (a navigation offline falls back on it) */
const ROOT = self.registration.scope;
const SHELL = SHELL_CACHE(ROOT, BUILD);

// ---- the tiles' index (IndexedDB: one store, keyed by URL)
const DB = "kerr-sw",
  STORE = "tiles",
  ZONES = "zones",
  ZONE_TILES = "zone-tiles";
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const q = indexedDB.open(DB, 2);
    q.onupgradeneeded = () => {
      const names = q.result.objectStoreNames;
      if (!names.contains(STORE)) q.result.createObjectStore(STORE, { keyPath: "url" });
      if (!names.contains(ZONES)) q.result.createObjectStore(ZONES, { keyPath: "id" });
      if (!names.contains(ZONE_TILES)) q.result.createObjectStore(ZONE_TILES, { keyPath: "url" });
    };
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  return dbp;
}
const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
async function indexPut(e: TileEntry) {
  const d = await db();
  await req(d.transaction(STORE, "readwrite").objectStore(STORE).put(e));
}
async function indexAll(): Promise<TileEntry[]> {
  const d = await db();
  return req(d.transaction(STORE, "readonly").objectStore(STORE).getAll());
}
async function indexDelete(urls: string[]) {
  if (!urls.length) return;
  const d = await db();
  const st = d.transaction(STORE, "readwrite").objectStore(STORE);
  for (const u of urls) st.delete(u);
}

// ---- the zones' index
async function storeAll<T>(name: string): Promise<T[]> {
  const d = await db();
  return req(d.transaction(name, "readonly").objectStore(name).getAll()) as Promise<T[]>;
}
async function storeGet<T>(name: string, key: string): Promise<T | undefined> {
  const d = await db();
  return req(d.transaction(name, "readonly").objectStore(name).get(key)) as Promise<T | undefined>;
}
async function storePut(name: string, v: unknown) {
  const d = await db();
  await req(d.transaction(name, "readwrite").objectStore(name).put(v));
}
async function storeDelete(name: string, keys: string[]) {
  if (!keys.length) return;
  const d = await db();
  const st = d.transaction(name, "readwrite").objectStore(name);
  for (const k of keys) st.delete(k);
}

// ---- install: the shell's core
self.addEventListener("install", (ev) => {
  ev.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      let list: string[] = [];
      try {
        const r = await fetch("precache.json", { cache: "no-store" });
        if (r.ok) list = (await r.json()) as string[];
      } catch {
        /* no list (dev): the shell fills as the page loads */
      }
      // (each on its own: one missing file must not fail the install)
      await Promise.all(
        list.map(async (u) => {
          try {
            const r = await fetch(u, { cache: "no-store" });
            if (r.ok) await cache.put(u, r);
          } catch {
            /* offline, or gone: fetched later */
          }
        }),
      );
    })(),
  );
});

// ---- activate: this app's older builds' shells dropped (not another app's), the open pages claimed
self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    (async () => {
      for (const n of await caches.keys()) {
        const urls = async () => (await (await caches.open(n)).keys()).map((r) => r.url);
        const old = isOwnShellCache(n, ROOT) ? n !== SHELL : isLegacyShell(n) && ownsLegacyShell(await urls(), ROOT);
        if (old) await caches.delete(n);
      }
      await self.clients.claim();
    })(),
  );
});

// ---- messages from the page: take over now; the caches' figures (the tests, the settings)
self.addEventListener("message", (ev) => {
  const m = ev.data as { type?: string; id?: string; chains?: string[][]; zone?: ZoneRecord } | null;
  const answer = (p: Promise<unknown>) => ev.waitUntil(p.then((v) => ev.ports[0]?.postMessage(v)));
  if (m?.type === "skip-waiting") void self.skipWaiting();
  if (m?.type === "stats") answer(stats());
  if (m?.type === "clear-tiles") answer(clearTiles().then(() => ({ ok: true })));
  // (the zones: a batch fetched in, a record kept, the list, one dropped)
  if (m?.type === "zone-fetch" && m.id && m.chains) answer(zoneFetch(m.id, m.chains));
  if (m?.type === "zone-save" && m.zone) answer(storePut(ZONES, m.zone).then(() => ({ ok: true })));
  if (m?.type === "zones") answer(storeAll<ZoneRecord>(ZONES));
  if (m?.type === "zone-delete" && m.id) answer(zoneDelete(m.id));
});

/** what the tiles were served from since this worker started (the tests: a flight within a zone asks the network nothing) */
const served = { zone: 0, lru: 0, network: 0 };
/** the network's zones' requests to the Géoplateforme's WMS-R spaced (its 40 a second shared with the game's: 8 here) */
let wmsNext = 0;
async function gentle(url: string) {
  if (!url.includes("data.geopf.fr/wms-r")) return;
  const now = Date.now(),
    at = Math.max(now, wmsNext);
  wmsNext = at + 125;
  if (at > now) await new Promise((done) => setTimeout(done, at - now));
}
/** the zones' fetches at once (the browser's six an origin; the tiles' hosts several) */
const ZONE_PARALLEL = 16;
/** whether a link of a chain falls short — the next then asked (system/zones.ts ZoneChain): a height grid with holes (the
 *  surface's over a fiftieth, as earth-tiles.ts ignGround), anything else never (a refusal is the caller's) */
function shortOf(url: string, body: ArrayBuffer): boolean {
  if (!url.includes("image/x-bil")) return false;
  const v = new Float32Array(body);
  let holes = 0;
  for (let i = 0; i < v.length; i++) {
    const h = v[i]!;
    if (!Number.isFinite(h) || h < -100 || h > 9000) holes++;
  }
  return url.includes("MNS") ? holes > 0.02 * v.length : holes > 0;
}
/**
 * A batch of a zone's chains into the zones' cache, ZONE_PARALLEL at a time (the WMS-R's spaced apart all the same —
 * gentle): a chain's links one after the other while each falls
 * short or is refused (a 404 counted as none); a link already in (another zone's, or this one's before a pause) only
 * marked as this zone's too — its body read again to know whether the next is wanted. Answers the batch's tally, the
 * chains that failed after every try.
 */
async function zoneFetch(id: string, chains: string[][]) {
  const cache = await caches.open(ZONE_CACHE);
  const out = { done: 0, bytes: 0, none: 0, failed: [] as string[][] };
  /** one link: its body (in, now or before), "none" (404), null (failed after every try) */
  const link = async (url: string): Promise<ArrayBuffer | "none" | null> => {
    const t = await storeGet<ZoneTile>(ZONE_TILES, url);
    const kept = t && (await cache.match(url));
    if (t && kept) {
      if (!t.zones.includes(id)) await storePut(ZONE_TILES, { ...t, zones: [...t.zones, id] });
      out.bytes += t.size;
      return kept.arrayBuffer();
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await gentle(url);
        const res = await fetch(url);
        // (none there — out at sea, abroad —, though the IGN's WMTS answers a 404 now and then for a tile it has: asked
        // once more before the chain's next link, or nothing, is taken)
        if (res.status === 404) {
          if (attempt > 0) return "none";
          throw new Error("HTTP 404");
        }
        // (a refusal over the rate — the WMS-R's 400 —, a 5xx: a while, then again)
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.arrayBuffer();
        await cache.put(url, new Response(body, { status: 200, headers: res.headers }));
        await storePut(ZONE_TILES, { url, zones: [...(t?.zones ?? []), id], size: body.byteLength } satisfies ZoneTile);
        out.bytes += body.byteLength;
        return body;
      } catch {
        await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
      }
    }
    return null;
  };
  const one = async (chain: string[]) => {
    for (const url of chain) {
      const r = await link(url);
      if (r === null) {
        out.failed.push(chain);
        return;
      }
      if (r === "none") {
        out.none++;
        continue;
      }
      out.done++;
      if (!shortOf(url, r)) return;
    }
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: ZONE_PARALLEL }, async () => {
      while (next < chains.length) await one(chains[next++]!);
    }),
  );
  return out;
}
/** A zone dropped: its tiles no other zone holds deleted, its record gone. */
async function zoneDelete(id: string) {
  const { drop, keep } = zoneRelease(await storeAll<ZoneTile>(ZONE_TILES), id);
  const cache = await caches.open(ZONE_CACHE);
  await Promise.all(drop.map((u) => cache.delete(u)));
  await storeDelete(ZONE_TILES, drop);
  for (const t of keep) await storePut(ZONE_TILES, t);
  await storeDelete(ZONES, [id]);
  return { ok: true, dropped: drop.length };
}

async function stats() {
  const shell = await caches.open(SHELL);
  const tiles = await indexAll();
  let tileBytes = 0;
  for (const e of tiles) tileBytes += e.size;
  const zoned = await storeAll<ZoneTile>(ZONE_TILES);
  let zoneBytes = 0;
  for (const t of zoned) zoneBytes += t.size;
  return {
    build: BUILD,
    shell: (await shell.keys()).length,
    tiles: tiles.length,
    tileBytes,
    tileBudget: TILE_BUDGET,
    zoneTiles: zoned.length,
    zoneBytes,
    served: { ...served },
  };
}
async function clearTiles() {
  await caches.delete(TILE_CACHE);
  await indexDelete((await indexAll()).map((e) => e.url));
}

// ---- fetch
self.addEventListener("fetch", (ev) => {
  const kind = classify(ev.request.url, ROOT, ev.request.method, DIRS);
  if (kind === "pass") return;
  if (kind === "immutable") ev.respondWith(cacheFirst(ev.request, SHELL));
  else if (kind === "shell" || kind === "elements") ev.respondWith(networkFirst(ev.request, SHELL));
  else ev.respondWith(tile(ev.request));
});

async function cacheFirst(request: Request, name: string): Promise<Response> {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) void cache.put(request, res.clone());
  return res;
}

async function networkFirst(request: Request, name: string): Promise<Response> {
  const cache = await caches.open(name);
  try {
    const res = await fetch(request);
    if (res.ok) {
      void cache.put(request, res.clone());
      if (request.mode === "navigate" && isAppPage(request.url, ROOT)) void cache.put(ROOT, res.clone());
    }
    return res;
  } catch (e) {
    const hit =
      (await cache.match(request)) ?? (request.mode === "navigate" && isAppPage(request.url, ROOT) ? await cache.match(ROOT) : undefined);
    if (hit) return hit;
    throw e;
  }
}

/** A tile: from the cache (its last use refreshed), else fetched and kept — the budget enforced after. */
let evicting: Promise<void> | null = null;
async function tile(request: Request): Promise<Response> {
  // (an offline zone's first: kept whatever the budget)
  const zoned = await (await caches.open(ZONE_CACHE)).match(request);
  if (zoned) {
    served.zone++;
    // (marked as a zone's: the page — the tests — tells it from the network's)
    const headers = new Headers(zoned.headers);
    headers.set("x-kerr-zone", "1");
    return new Response(zoned.body, { status: zoned.status, headers });
  }
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request);
  if (hit) {
    served.lru++;
    void indexPut({ url: request.url, t: Date.now(), size: Number(hit.headers.get("content-length")) || 0 });
    return hit;
  }
  served.network++;
  const res = await fetch(request);
  if (res.ok && res.type !== "opaque") {
    const copy = res.clone();
    void (async () => {
      const body = await copy.arrayBuffer();
      await cache.put(request, new Response(body, { status: 200, headers: copy.headers }));
      await indexPut({ url: request.url, t: Date.now(), size: body.byteLength });
      evicting ??= enforceBudget().finally(() => (evicting = null));
    })();
  }
  return res;
}

async function enforceBudget() {
  const all = await indexAll();
  const out = evictions(all);
  if (!out.length) return;
  const cache = await caches.open(TILE_CACHE);
  await Promise.all(out.map((u) => cache.delete(u)));
  await indexDelete(out);
}
