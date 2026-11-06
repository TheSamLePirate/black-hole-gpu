// The network's activity, live — every request the page and its workers have in flight, by kind (Sam, 6 Nov 2026: « un
// indicateur temps réel pendant le téléchargement des tuiles ; en vol on devrait toujours être en téléchargement »).
//
// Each scope (the page, each worker) wraps its own `fetch` once (installNetActivity): a request counts from its call until its
// body is read (arrayBuffer/json/text/blob — the decode's input in), it fails, or — a body read as a stream, or never — its
// resource-timing entry comes or NET_STALE_MS passes. A worker posts its counts on the BroadcastChannel NET_CHANNEL when they
// change (coalesced to one post a frame's worth); the page sums its own and the workers' (netSnapshot) — the indicator in the
// screen's corner and `__bh.netLight` read that.
//
// Kinds by the URL: the relief (Terrarium, national DEMs), the photographs (orthoimagery, Sentinel-2, GIBS), the IGN (its WMS-R/
// WMTS: relief, photos, LiDAR, BD TOPO), the scenery (OSM vector tiles, Overture, WorldCover, Overpass), the weather, the
// traffic, the game's own files (assets), the rest.

export type NetKind = "relief" | "photos" | "ign" | "scenery" | "weather" | "traffic" | "assets" | "other";

/** one scope's counts: its requests in flight now (by kind), and since its start the requests begun, ended, failed
 * (an HTTP error or a network failure — not an abort), aborted, rate-limited (429/503), and the bytes read */
export type NetCounts = {
  inflight: number;
  byKind: Partial<Record<NetKind, number>>;
  started: number;
  done: number;
  failed: number;
  aborted: number;
  limited: number;
  /** of those done, answered by the Service Worker's caches (its LRU, an offline zone): no download */
  cached: number;
  bytes: number;
  /** the time (performance.now() of its scope's origin, made absolute: Date.now()) of its last failure, its last 429 */
  failAt: number;
  limitAt: number;
  /** by source — the IGN's by its layer, the others by their host —: [requests ended, bytes read, of those a URL (its range)
   *  asked before in this scope — a download made again unless a cache answered it] */
  bySource: Record<string, [number, number, number]>;
  /** the failures by source and answer — « host 404 », « host 429 », « host network » —: what lights the light red */
  failBy: Record<string, number>;
};

/** a request's source, for the audit: the IGN's layer (its LAYER(S) parameter, shortened), else its host */
export function netSource(url: string): string {
  try {
    const u = new URL(url, "http://local/");
    if (u.hostname.endsWith("geopf.fr")) {
      const layer = u.searchParams.get("LAYERS") ?? u.searchParams.get("LAYER") ?? u.searchParams.get("layer") ?? u.pathname.split("/")[1];
      return `ign:${(layer ?? "?").replace(/\.(ELEVATIONGRIDCOVERAGE|WGS84G|ORTHOPHOTOS|BDORTHO)/gi, "").slice(0, 40)}`;
    }
    return u.hostname === "local" ? "self" : u.hostname;
  } catch {
    return "?";
  }
}

export const NET_CHANNEL = "bh-net";
/** a request's longest count with no sign of its end (a body read as a stream, or dropped unread) */
export const NET_STALE_MS = 30_000;

export function netKind(url: string): NetKind {
  const u = url.toLowerCase();
  if (u.includes("geopf.fr") || u.includes("ign.fr") || u.includes("/ign/")) return "ign";
  if (
    u.includes("terrarium") ||
    u.includes("elevation") ||
    u.includes("geo.admin.ch") ||
    u.includes("/dem") ||
    u.includes("relief") ||
    u.includes("lola") ||
    u.includes("mola")
  )
    return "relief";
  if (
    u.includes("imagery") ||
    u.includes("s2maps") ||
    u.includes("eox.at") ||
    u.includes("gibs.") ||
    u.includes("ortho") ||
    u.includes("arcgis")
  )
    return "photos";
  if (
    u.includes("openfreemap") ||
    u.includes("overture") ||
    u.includes("overpass") ||
    u.includes("worldcover") ||
    u.includes("terrascope") ||
    u.includes("openstreetmap") ||
    u.includes(".pmtiles") ||
    u.includes("bdtopo")
  )
    return "scenery";
  if (u.includes("open-meteo") || u.includes("metar") || u.includes("weather")) return "weather";
  if (u.includes("adsb") || u.includes("opensky") || u.includes("traffic") || u.includes("celestrak")) return "traffic";
  const self = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!/^[a-z]+:\/\//.test(u) || (self && u.startsWith(self.toLowerCase()))) return "assets";
  return "other";
}

const zero = (): NetCounts => ({
  inflight: 0,
  byKind: {},
  started: 0,
  done: 0,
  failed: 0,
  aborted: 0,
  limited: 0,
  cached: 0,
  bytes: 0,
  failAt: 0,
  limitAt: 0,
  bySource: {},
  failBy: {},
});

/** this scope's counts */
const mine: NetCounts = zero();
/** the workers' last posted counts, by their id (dropped when stale: a worker terminated posts nothing more) */
const theirs = new Map<string, { c: NetCounts; at: number }>();
let installed = false;
let channel: BroadcastChannel | null = null;
let postQueued = false;
let scopeId = "";
/** the URLs (their ranges) asked in this scope — a request made again told (50 000 at most, then forgotten) */
const seen = new Set<string>();
let isPage = false;

const urlOf = (input: RequestInfo | URL) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

function post() {
  if (isPage || !channel || postQueued) return;
  postQueued = true;
  setTimeout(() => {
    postQueued = false;
    channel?.postMessage({ id: scopeId, c: mine, at: Date.now() });
  }, 16);
}

/** wrap this scope's fetch: `scope` names it ("page", "scenery", …); in a worker its counts go to the page */
export function installNetActivity(scope: string) {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  scopeId = `${scope}:${Math.random().toString(36).slice(2, 8)}`;
  isPage = typeof (globalThis as { document?: unknown }).document !== "undefined";
  try {
    channel = new BroadcastChannel(NET_CHANNEL);
    if (isPage) {
      channel.onmessage = (e: MessageEvent<{ id: string; c: NetCounts; at: number }>) => {
        if (e.data?.id && e.data.c) theirs.set(e.data.id, { c: e.data.c, at: e.data.at });
      };
      channel.postMessage({ ask: 1 });
    } else
      channel.onmessage = (e: MessageEvent<{ ask?: number }>) => {
        if (e.data?.ask) post();
      };
  } catch {
    channel = null;
  }
  // (the requests waiting for their end, by URL: a resource-timing entry ends the oldest of its URL)
  const open = new Map<string, Set<() => void>>();
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const s = open.get(e.name);
        if (!s?.size) continue;
        const end = s.values().next().value as () => void;
        end();
      }
    }).observe({ type: "resource", buffered: false });
  } catch {
    /* (no resource timing here: the bodies' reads and the stale limit end them) */
  }
  const raw = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.startsWith("data:") || url.startsWith("blob:")) return raw(input, init);
    const kind = netKind(url);
    const range = init?.headers ? new Headers(init.headers).get("range") : input instanceof Request ? input.headers.get("range") : null;
    const seenKey = range ? `${url}|${range}` : url;
    const again = seen.has(seenKey);
    if (seen.size > 50_000) seen.clear();
    seen.add(seenKey);
    const source = netSource(url);
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failNote = (why: string) => {
      const k = `${source} ${why}`;
      mine.failBy[k] = (mine.failBy[k] ?? 0) + 1;
    };
    const end = (how: "done" | "failed" | "aborted", bytes = 0) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      open.get(url)?.delete(end as () => void);
      if (open.get(url)?.size === 0) open.delete(url);
      mine.inflight--;
      mine.byKind[kind] = (mine.byKind[kind] ?? 1) - 1;
      mine[how]++;
      mine.bytes += bytes;
      if (how === "done") {
        const b = (mine.bySource[source] ??= [0, 0, 0]);
        b[0]++;
        b[1] += bytes;
        if (again) b[2]++;
      }
      if (how === "failed") mine.failAt = Date.now();
      post();
    };
    const endDone = () => end("done");
    mine.inflight++;
    mine.started++;
    mine.byKind[kind] = (mine.byKind[kind] ?? 0) + 1;
    post();
    timer = setTimeout(endDone, NET_STALE_MS);
    let res: Response;
    try {
      res = await raw(input, init);
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      if (!aborted) failNote("network");
      end(aborted ? "aborted" : "failed");
      throw e;
    }
    if (res.headers.get("x-kerr-cache") || res.headers.get("x-kerr-zone")) mine.cached++;
    if (res.status === 429 || res.status === 503) {
      mine.limited++;
      mine.limitAt = Date.now();
    }
    if (!res.ok && res.status !== 304) {
      failNote(String(res.status));
      end("failed");
      return res;
    }
    if (!res.body) {
      end("done");
      return res;
    }
    // (its end: the body read whole — the usual way —, else its timing entry, else the stale limit)
    let set = open.get(url);
    if (!set) open.set(url, (set = new Set()));
    set.add(endDone);
    const len = Number(res.headers.get("content-length") ?? 0) || 0;
    for (const m of ["arrayBuffer", "json", "text", "blob"] as const) {
      const orig = res[m].bind(res) as () => Promise<unknown>;
      Object.defineProperty(res, m, {
        configurable: true,
        value: () =>
          orig().then(
            (v) => {
              const n = v instanceof ArrayBuffer ? v.byteLength : v instanceof Blob ? v.size : typeof v === "string" ? v.length : len;
              end("done", n);
              return v;
            },
            (e) => {
              end((e as Error)?.name === "AbortError" ? "aborted" : "failed");
              throw e;
            },
          ),
      });
    }
    return res;
  }) as typeof fetch;
}

/** the page's sum of its own counts and its workers' (a worker's dropped when it said some in flight and has said nothing for
 * 2 × NET_STALE_MS: terminated mid-request). A limit: the channel is the origin's — two tabs of the game on one origin mix
 * their workers' counts */
export function netSnapshot(): NetCounts & { scopes: number } {
  const s = { ...zero(), byKind: { ...mine.byKind }, scopes: 1 };
  for (const k of ["inflight", "started", "done", "failed", "aborted", "limited", "cached", "bytes"] as const) s[k] = mine[k];
  s.failAt = mine.failAt;
  s.limitAt = mine.limitAt;
  s.bySource = Object.fromEntries(Object.entries(mine.bySource).map(([k, v]) => [k, [...v] as [number, number, number]]));
  s.failBy = { ...mine.failBy };
  const now = Date.now();
  for (const [id, { c, at }] of theirs) {
    if (c.inflight && now - at > 2 * NET_STALE_MS) {
      theirs.delete(id);
      continue;
    }
    s.scopes++;
    for (const k of ["inflight", "started", "done", "failed", "aborted", "limited", "cached", "bytes"] as const) s[k] += c[k];
    for (const [k, v] of Object.entries(c.byKind)) s.byKind[k as NetKind] = (s.byKind[k as NetKind] ?? 0) + (v ?? 0);
    for (const [k, v] of Object.entries(c.bySource ?? {})) {
      const b = (s.bySource[k] ??= [0, 0, 0]);
      for (let i = 0; i < 3; i++) b[i]! += v[i]!;
    }
    for (const [k, v] of Object.entries(c.failBy ?? {})) s.failBy[k] = (s.failBy[k] ?? 0) + v;
    s.failAt = Math.max(s.failAt, c.failAt);
    s.limitAt = Math.max(s.limitAt, c.limitAt);
  }
  return s;
}
