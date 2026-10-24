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
  tileKind,
} from "./pwa/rules";
import { decodeRelief, encodeRelief, isReliefGrid, RELIEF_CODEC } from "./pwa/relief-codec";
import { OVERTURE_LIST, overtureReleases, overtureUrl, parseOvertureZoneUrl, parseRange, PmTiles, rangeKey } from "./system/pmtiles";

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
  ZONE_TILES = "zone-tiles",
  META = "meta";
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const q = indexedDB.open(DB, 3);
    q.onupgradeneeded = () => {
      const names = q.result.objectStoreNames;
      if (!names.contains(STORE)) q.result.createObjectStore(STORE, { keyPath: "url" });
      if (!names.contains(ZONES)) q.result.createObjectStore(ZONES, { keyPath: "id" });
      if (!names.contains(ZONE_TILES)) q.result.createObjectStore(ZONE_TILES, { keyPath: "url" });
      // (the worker's own choices, kept across its restarts: the tiles' budget — Settings › Offline, I8b)
      if (!names.contains(META)) q.result.createObjectStore(META, { keyPath: "k" });
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

// ---- the tiles' budget: the player's (Settings › Offline), TILE_BUDGET until one is chosen
let budgetNow: number | null = null;
async function budget(): Promise<number> {
  budgetNow ??= (await storeGet<{ k: string; v: number }>(META, "tileBudget"))?.v ?? TILE_BUDGET;
  return budgetNow;
}
async function setBudget(bytes: number) {
  budgetNow = Math.max(16 * 1024 * 1024, Math.round(bytes));
  await storePut(META, { k: "tileBudget", v: budgetNow });
  await enforceBudget();
  return { ok: true, tileBudget: budgetNow };
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
  const m = ev.data as { type?: string; id?: string; chains?: string[][]; zone?: ZoneRecord; fresh?: boolean; bytes?: number } | null;
  const answer = (p: Promise<unknown>) => ev.waitUntil(p.then((v) => ev.ports[0]?.postMessage(v)));
  if (m?.type === "skip-waiting") void self.skipWaiting();
  if (m?.type === "stats") answer(stats());
  if (m?.type === "clear-tiles") answer(clearTiles().then(() => ({ ok: true })));
  if (m?.type === "tile-budget" && typeof m.bytes === "number") answer(setBudget(m.bytes));
  // (the zones: a batch fetched in, a record kept, the list, one dropped)
  if (m?.type === "zone-fetch" && m.id && m.chains) answer(zoneFetch(m.id, m.chains, !!m.fresh));
  if (m?.type === "zone-save" && m.zone) answer(storePut(ZONES, m.zone).then(() => ({ ok: true })));
  if (m?.type === "zones") answer(storeAll<ZoneRecord>(ZONES));
  if (m?.type === "zone-delete" && m.id) answer(zoneDelete(m.id));
});

/** what the tiles were served from since this worker started (the tests: a flight within a zone asks the network nothing),
 *  by kind too (the scenery worker's fetches, out of the page's sight, among them), the last few asked of the network */
const served = { zone: 0, lru: 0, network: 0 };
const servedKinds: Record<string, { zone: number; lru: number; network: number }> = {};
const servedNetwork: string[] = [];
function serving(url: string, from: "zone" | "lru" | "network") {
  served[from]++;
  (servedKinds[tileKind(url)] ??= { zone: 0, lru: 0, network: 0 })[from]++;
  if (from === "network") {
    servedNetwork.push(url.slice(0, 240));
    if (servedNetwork.length > 12) servedNetwork.shift();
  }
}
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
// ---- the relief's grids kept small (pwa/relief-codec.ts, I8c): packed as they are kept, unpacked as they are served
/** A tile's response as kept: a relief grid packed (its type and the codec named in its headers), anything else as it came. */
async function keepable(url: string, body: ArrayBuffer, from: Headers): Promise<Response> {
  if (!isReliefGrid(url, body.byteLength)) return new Response(body, { status: 200, headers: from });
  const packed = await encodeRelief(body);
  const headers = new Headers(from);
  headers.set("x-kerr-codec", RELIEF_CODEC);
  headers.set("x-kerr-type", from.get("content-type") ?? "image/x-bil;bits=32");
  headers.set("content-type", "application/octet-stream");
  headers.set("content-length", String(packed.byteLength));
  headers.delete("content-encoding");
  return new Response(packed as BlobPart, { status: 200, headers });
}
/** A kept tile's bytes as the source sent them (a packed grid unpacked; null: a packing not read). */
async function rawOf(kept: Response): Promise<ArrayBuffer | null> {
  const body = await kept.arrayBuffer();
  return kept.headers.get("x-kerr-codec") === RELIEF_CODEC ? decodeRelief(body) : body;
}
/** A kept tile served: its source's bytes and type, `mark` added to its headers (null: a packing not read). */
async function serve(kept: Response, mark?: [string, string]): Promise<Response | null> {
  const packed = kept.headers.get("x-kerr-codec") === RELIEF_CODEC;
  if (!packed && !mark) return kept;
  const headers = new Headers(kept.headers);
  if (mark) headers.set(...mark);
  if (!packed) return new Response(kept.body, { status: kept.status, headers });
  const raw = await decodeRelief(await kept.arrayBuffer());
  if (!raw) return null;
  headers.set("content-type", kept.headers.get("x-kerr-type") ?? "image/x-bil;bits=32");
  headers.set("content-length", String(raw.byteLength));
  return new Response(raw, { status: 200, headers });
}

/**
 * A batch of a zone's chains into the zones' cache, ZONE_PARALLEL at a time (the WMS-R's spaced apart all the same —
 * gentle): a chain's links one after the other while each falls
 * short or is refused (a 404 counted as none); a link already in (another zone's, or this one's before a pause) only
 * marked as this zone's too — its body read again to know whether the next is wanted; `fresh` (an update): every link
 * asked again, the one kept where the network fails. Answers the batch's tally, the chains that failed after every try.
 */
async function zoneFetch(id: string, chains: string[][], fresh = false) {
  const cache = await caches.open(ZONE_CACHE);
  const out = { done: 0, bytes: 0, none: 0, failed: [] as string[][] };
  /** a range of an archive into this zone (its key's record marked this zone's too): its bytes */
  const keepRange = async (url: string, offset: number, length: number): Promise<Uint8Array> => {
    const key = rangeKey(url, offset, length);
    const t = await storeGet<ZoneTile>(ZONE_TILES, key);
    const kept = t && !fresh && (await cache.match(key));
    if (t && kept) {
      if (!t.zones.includes(id)) await storePut(ZONE_TILES, { ...t, zones: [...t.zones, id] });
      return new Uint8Array(await kept.arrayBuffer());
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
        if (res.status !== 206) {
          void res.body?.cancel();
          throw new Error(`HTTP ${res.status}`);
        }
        const body = await res.arrayBuffer();
        if (body.byteLength !== length) throw new Error(`range ${body.byteLength} of ${length}`);
        await cache.put(key, new Response(body.slice(0), { status: 200, headers: { "content-length": String(length) } }));
        await storePut(ZONE_TILES, { url: key, zones: t?.zones.includes(id) ? t.zones : [...(t?.zones ?? []), id], size: length });
        out.bytes += length;
        return new Uint8Array(body);
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
      }
    }
  };
  /** Overture's archive this batch reads (the release the scenery's worker would: the listing's latest that answers) */
  let archive: Promise<PmTiles | null> | null = null;
  const overture = () =>
    (archive ??= (async () => {
      const list = await listing(new Request(OVERTURE_LIST)).then((r) => r.text());
      for (const r of overtureReleases(list)) {
        const p = new PmTiles(overtureUrl(r), keepRange);
        try {
          await p.header();
          return p;
        } catch {
          /* gone: the next release */
        }
      }
      return null;
    })());
  /** one link: its body (in, now or before), "none" (404), null (failed after every try) */
  const link = async (url: string): Promise<ArrayBuffer | "none" | null> => {
    // (an Overture tile: its directories' and its bytes' ranges kept, each under its key)
    const ov = parseOvertureZoneUrl(url);
    if (ov)
      try {
        const p = await overture();
        if (!p) return null;
        const b = await p.tile(ov.z, ov.x, ov.y);
        return b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : "none";
      } catch {
        return null;
      }
    const t = await storeGet<ZoneTile>(ZONE_TILES, url);
    const kept = t && (await cache.match(url));
    // (a source's none kept as such — its 404 —: the next link asked, as the first time)
    if (t && kept?.status === 404 && !fresh) {
      if (!t.zones.includes(id)) await storePut(ZONE_TILES, { ...t, zones: [...t.zones, id] });
      return "none";
    }
    // (an update — the sources' new vintage —: asked again, the one kept if the network fails)
    const keptRaw = t && kept?.ok && !fresh ? await rawOf(kept!.clone()) : null;
    if (t && keptRaw) {
      if (!t.zones.includes(id)) await storePut(ZONE_TILES, { ...t, zones: [...t.zones, id] });
      out.bytes += t.size;
      return keptRaw;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await gentle(url);
        const res = await fetch(url);
        // (none there — out at sea, abroad —, though the IGN's WMTS answers a 404 now and then for a tile it has: asked
        // once more before the chain's next link, or nothing, is taken)
        if (res.status === 404) {
          if (attempt === 0) throw new Error("HTTP 404");
          // (kept too: offline, the game told there is none — as the network tells it — not left asking the network)
          await cache.put(url, new Response(null, { status: 404, headers: { "x-kerr-none": "1" } }));
          const zones = t?.zones.includes(id) ? t.zones : [...(t?.zones ?? []), id];
          await storePut(ZONE_TILES, { url, zones, size: 0 } satisfies ZoneTile);
          return "none";
        }
        // (a refusal over the rate — the WMS-R's 400 —, a 5xx: a while, then again)
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.arrayBuffer();
        // (kept as small as it can be: a relief grid packed — its size the one kept)
        const keep = await keepable(url, body, res.headers);
        const size = Number(keep.headers.get("content-length")) || body.byteLength;
        await cache.put(url, keep);
        const zones = t?.zones.includes(id) ? t.zones : [...(t?.zones ?? []), id];
        await storePut(ZONE_TILES, { url, zones, size } satisfies ZoneTile);
        out.bytes += size;
        return body;
      } catch {
        await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
      }
    }
    // (an update failing: the tile kept as it was)
    const old = t && kept?.ok ? await rawOf(kept.clone()) : null;
    if (t && old) {
      if (!t.zones.includes(id)) await storePut(ZONE_TILES, { ...t, zones: [...t.zones, id] });
      out.bytes += t.size;
      return old;
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
  // (by kind: the tiles and their bytes kept — the relief's packed grids' mean measured)
  const kinds: Record<string, { lru: number; lruBytes: number; zone: number; zoneBytes: number }> = {};
  const kind = (url: string) => (kinds[tileKind(url)] ??= { lru: 0, lruBytes: 0, zone: 0, zoneBytes: 0 });
  for (const e of tiles) {
    const k = kind(e.url);
    k.lru++;
    k.lruBytes += e.size;
  }
  for (const t of zoned) {
    const k = kind(t.url);
    k.zone++;
    k.zoneBytes += t.size;
  }
  return {
    build: BUILD,
    shell: (await shell.keys()).length,
    tiles: tiles.length,
    tileBytes,
    tileBudget: await budget(),
    zoneTiles: zoned.length,
    zoneBytes,
    kinds,
    served: { ...served, kinds: structuredClone(servedKinds), recent: [...servedNetwork] },
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
  // (a byte range of an archive — Overture's —: kept under a key of its own; the releases' listing: network first)
  const range = parseRange(request.headers.get("range"));
  if (range) return rangeTile(request, range.offset, range.length);
  if (request.url === OVERTURE_LIST) return listing(request);
  // (an offline zone's first: kept whatever the budget)
  const zoned = await (await caches.open(ZONE_CACHE)).match(request);
  // (marked as a zone's: the page — the tests — tells it from the network's)
  const fromZone = zoned && (await serve(zoned, ["x-kerr-zone", "1"]));
  if (fromZone) {
    serving(request.url, "zone");
    return fromZone;
  }
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request);
  const fromCache = hit && (await serve(hit));
  if (hit && fromCache) {
    serving(request.url, "lru");
    void indexPut({ url: request.url, t: Date.now(), size: Number(hit.headers.get("content-length")) || 0 });
    return fromCache;
  }
  serving(request.url, "network");
  const res = await fetch(request);
  if (res.ok && res.type !== "opaque") {
    const copy = res.clone();
    void (async () => {
      const body = await copy.arrayBuffer();
      // (in flight too: a relief grid kept packed — the budget holds four to six times more of them)
      const keep = await keepable(request.url, body, copy.headers);
      await cache.put(request, keep);
      await indexPut({ url: request.url, t: Date.now(), size: Number(keep.headers.get("content-length")) || body.byteLength });
      evicting ??= enforceBudget().finally(() => (evicting = null));
    })();
  }
  return res;
}

/** A range served as a 206 (its key's whole body as kept), `zone` marked. */
function partial(body: ArrayBuffer, offset: number, zone: boolean): Response {
  const headers = new Headers({
    "content-type": "application/octet-stream",
    "content-length": String(body.byteLength),
    "content-range": `bytes ${offset}-${offset + body.byteLength - 1}/*`,
  });
  if (zone) headers.set("x-kerr-zone", "1");
  return new Response(body, { status: 206, headers });
}
/** A byte range of an archive (the Cache API keeps no partial response: each range a whole one under rangeKey): a zone's,
 *  the cache's, else the network's — kept under the budget as any tile. */
async function rangeTile(request: Request, offset: number, length: number): Promise<Response> {
  const key = rangeKey(request.url, offset, length);
  const zoned = await (await caches.open(ZONE_CACHE)).match(key);
  if (zoned) {
    serving(key, "zone");
    return partial(await zoned.arrayBuffer(), offset, true);
  }
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(key);
  if (hit) {
    serving(key, "lru");
    void indexPut({ url: key, t: Date.now(), size: length });
    return partial(await hit.arrayBuffer(), offset, false);
  }
  serving(key, "network");
  const res = await fetch(request);
  if (res.status !== 206) return res;
  const body = await res.arrayBuffer();
  if (body.byteLength === length) {
    void (async () => {
      await cache.put(key, new Response(body.slice(0), { status: 200, headers: { "content-length": String(length) } }));
      await indexPut({ url: key, t: Date.now(), size: length });
      evicting ??= enforceBudget().finally(() => (evicting = null));
    })();
  }
  return partial(body, offset, false);
}
/** Overture's releases' listing: the network's (kept), else a zone's or the cache's — a release may have gone since */
async function listing(request: Request): Promise<Response> {
  const cache = await caches.open(TILE_CACHE);
  try {
    const res = await fetch(request, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const body = await res.arrayBuffer();
      void cache.put(request.url, new Response(body.slice(0), { status: 200, headers: res.headers }));
      void indexPut({ url: request.url, t: Date.now(), size: body.byteLength });
      serving(request.url, "network");
      return new Response(body, { status: 200, headers: res.headers });
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    const zoned = await (await caches.open(ZONE_CACHE)).match(request.url);
    if (zoned) {
      serving(request.url, "zone");
      return serve(zoned, ["x-kerr-zone", "1"]).then((r) => r ?? zoned);
    }
    const hit = await cache.match(request.url);
    if (hit) {
      serving(request.url, "lru");
      return hit;
    }
    throw e;
  }
}

async function enforceBudget() {
  const all = await indexAll();
  const out = evictions(all, await budget());
  if (!out.length) return;
  const cache = await caches.open(TILE_CACHE);
  await Promise.all(out.map((u) => cache.delete(u)));
  await indexDelete(out);
}
