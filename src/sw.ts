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
//   · the station's elements: network first, the cache when offline.
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
  STORE = "tiles";
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE, { keyPath: "url" });
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
  const m = ev.data as { type?: string } | null;
  if (m?.type === "skip-waiting") void self.skipWaiting();
  if (m?.type === "stats") void stats().then((s) => ev.ports[0]?.postMessage(s));
  if (m?.type === "clear-tiles") void clearTiles().then(() => ev.ports[0]?.postMessage({ ok: true }));
});

async function stats() {
  const shell = await caches.open(SHELL);
  const tiles = await indexAll();
  let tileBytes = 0;
  for (const e of tiles) tileBytes += e.size;
  return { build: BUILD, shell: (await shell.keys()).length, tiles: tiles.length, tileBytes, tileBudget: TILE_BUDGET };
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
    const hit = (await cache.match(request)) ?? (request.mode === "navigate" ? await cache.match(ROOT) : undefined);
    if (hit) return hit;
    throw e;
  }
}

/** A tile: from the cache (its last use refreshed), else fetched and kept — the budget enforced after. */
let evicting: Promise<void> | null = null;
async function tile(request: Request): Promise<Response> {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request);
  if (hit) {
    void indexPut({ url: request.url, t: Date.now(), size: Number(hit.headers.get("content-length")) || 0 });
    return hit;
  }
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
