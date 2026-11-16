// The e2e's Earth data on disk (PLAN-J8 J8-T — Sam, 16 Nov 2026: « désactivable, mais activée par défaut … partageables par chaque
// session e2e »): every tile the game asks — the relief, the imagery, the IGN's heights, orthophotos and buildings, OpenFreeMap's vector
// tiles, WorldCover's and Overture's byte ranges, swisstopo's, the USA's — served from a folder shared by every e2e of the machine,
// fetched once by Bun the first time and kept (written whole: a temporary file renamed). The line here is ~4.5 Mb/s: the downloads made
// the scenery's and the IGN's e2e slow and flaky (32 « tiles », 5 « IGN 429 » in E2E-VOLS's history) and forced one IGN e2e at a time.
//
// Through Chrome's Fetch domain (tile-replay.ts's, T8h, generalised): on the page's own session and on every dedicated worker's
// (the scenery's, the building cells', the surface's, the KTX transcoder's — attached as they start, Target.setAutoAttach flatten:
// their fetches are their own targets'). What is kept is what the PWA keeps (src/pwa/rules.ts `classify` → "tile"), plus WorldCover's
// COGs; never the live data (weather, METAR, traffic, the solar wind, Overpass, geocoding — `classify` passes them), never OpenStreetMap's
// own map tiles (their policy), EOX's only as asked (nothing is ever fetched ahead). A Range request is its own answer (206, its
// Content-Range). Kept: the 2xx and the 404s (the IGN's « none there »); anything else passed on to the page as it came. OpenFreeMap's
// `latest` and Overture's releases' listing kept 30 days, the rest for good (a tile's URL names its version).
//
// E2E_EARTH_DATA: `on` (the default: the disk, else the network once), `off` (the network, as before), `offline` (a tile not on the
// disk fails the request and is reported with its URL — the test fails at its close), `refresh` (fetched again, kept anew). The folder:
// KERR_EARTH_DATA, else ~/.kerr-lab/config.json's `earthData`, else ~/Documents/DEV/earth-data — on kerr-mini ~/kerr-lab/earth-data
// (not under ~/Documents: macOS's TCC stops the nightly bench there under launchd). Suspended while `app.offline()` or
// `app.throttle()` holds (their tests measure the network). An e2e that measures the network keeps it: a Service Worker's boot
// (`sw: true` — its fetches are its own target's, not intercepted) and the files whose header says `// Earth data: network`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { classify } from "../../../src/pwa/rules";
import type { Cdp } from "./cdp";

export type EarthDataMode = "on" | "off" | "offline" | "refresh";

/** the mode asked (E2E_EARTH_DATA) — `on` by default since T0's witness passed (16 Nov 2026, earth-cache-witness: the scenery worker's
 *  72 BD TOPO tiles and the cell worker's 6 all from the disk offline at the second boot, the same 32 000 buildings) */
export const EARTH_DATA_DEFAULT: EarthDataMode = "on";
export function earthDataMode(): EarthDataMode {
  const m = (process.env.E2E_EARTH_DATA ?? EARTH_DATA_DEFAULT).toLowerCase();
  return m === "off" || m === "offline" || m === "refresh" ? m : "on";
}

/** the machine's folder: KERR_EARTH_DATA, ~/.kerr-lab/config.json `earthData`, else this lab's own place */
export function earthDataDir(): string {
  if (process.env.KERR_EARTH_DATA) return process.env.KERR_EARTH_DATA;
  try {
    const c = JSON.parse(readFileSync(join(homedir(), ".kerr-lab", "config.json"), "utf8")) as { earthData?: string };
    if (c.earthData) return c.earthData.replace(/^~(?=\/)/, homedir());
  } catch {}
  return /mini/i.test(hostname()) ? join(homedir(), "kerr-lab", "earth-data") : join(homedir(), "Documents", "DEV", "earth-data");
}

/** Whether a test file keeps the network: its header's `// Earth data: network` line (an e2e that measures the downloads). */
export function wantsNetwork(src: string): boolean {
  const head: string[] = [];
  for (const l of src.split("\n")) {
    if (l.startsWith("import ") || l.trim() === "") continue;
    if (!l.startsWith("//")) break;
    head.push(l);
  }
  return head.some((l) => /^\/\/\s*Earth data:\s*network\b/i.test(l));
}

/** whether a URL is kept: a tile as the PWA says, WorldCover's COGs; never OpenStreetMap's map tiles */
export function keptUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.hostname === "tile.openstreetmap.org") return false;
  if (/^esa-worldcover(-s2)?\.s3\.eu-central-1\.amazonaws\.com$/.test(u.hostname)) return true;
  return classify(url, "http://localhost/") === "tile";
}

/** how long a kept answer holds [ms]: OpenFreeMap's `latest` and Overture's releases' listing 30 days, the rest for good */
export function ttlOf(url: string): number {
  try {
    const u = new URL(url);
    if (u.hostname === "tiles.openfreemap.org" && /^\/planet\/?$/.test(u.pathname)) return 30 * 864e5;
    if (u.hostname.startsWith("overturemaps") && /\.json$|release/i.test(u.pathname) && !/\.pmtiles$/.test(u.pathname)) return 30 * 864e5;
  } catch {}
  return Number.POSITIVE_INFINITY;
}

/** a kept answer's files: `<dir>/<host>/<sha1 of the URL and its range>.bin` (gzipped) and `.json` */
export function keyFiles(dir: string, url: string, range: string | null) {
  let host = "other";
  try {
    host = new URL(url).hostname;
  } catch {}
  const h = createHash("sha1")
    .update(range ? `${url}\n${range}` : url)
    .digest("hex");
  const base = join(dir, host, h);
  return { bin: `${base}.bin`, meta: `${base}.json` };
}

interface Meta {
  status: number;
  type: string;
  url: string;
  range: string | null;
  contentRange: string | null;
  at: string;
  bytes: number;
}

/** written whole: a temporary file renamed (two e2e filling the same tile at once never read half of it) */
function writeAtomic(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** A kept answer read: its meta and its bytes, or null (none, or past its time). */
export function readKept(dir: string, url: string, range: string | null): { meta: Meta; body: Uint8Array } | null {
  const f = keyFiles(dir, url, range);
  if (!existsSync(f.meta) || !existsSync(f.bin)) return null;
  try {
    const meta = JSON.parse(readFileSync(f.meta, "utf8")) as Meta;
    if (Date.now() - Date.parse(meta.at) > ttlOf(url)) return null;
    return { meta, body: Bun.gunzipSync(readFileSync(f.bin)) };
  } catch {
    return null;
  }
}

/** An answer fetched by Bun and kept when it is a 2xx or a 404. */
export async function fetchKeep(dir: string, url: string, range: string | null): Promise<{ meta: Meta; body: Uint8Array }> {
  const res = await fetch(url, { headers: { "user-agent": "kerr-e2e earth-data", ...(range ? { range } : {}) } });
  const body = new Uint8Array(await res.arrayBuffer());
  const meta: Meta = {
    status: res.status,
    type: res.headers.get("content-type") ?? "application/octet-stream",
    url,
    range,
    contentRange: res.headers.get("content-range"),
    at: new Date().toISOString(),
    bytes: body.byteLength,
  };
  if (res.ok || res.status === 404) {
    const f = keyFiles(dir, url, range);
    writeAtomic(f.bin, Bun.gzipSync(body));
    writeAtomic(f.meta, JSON.stringify(meta));
  }
  return { meta, body };
}

export interface EarthCounts {
  hits: number;
  misses: number;
  /** bytes served from the disk, fetched by Bun (and kept) */
  hitBytes: number;
  missBytes: number;
  failed: number;
  /** offline mode: the URLs not on the disk */
  missing: string[];
  /** the requests seen, by source (page or worker) */
  bySource: Record<string, number>;
  /** each kept-kind request: its source, its URL, from the disk or not (the witnesses read it) */
  /** each request kept or served: its source, URL, from the disk or not, when [ms since the epoch], the network's time if fetched [ms] */
  log: { src: string; url: string; hit: boolean; nid?: string; at?: number; ms?: number }[];
}

/** the hosts' patterns paused (Fetch.enable); without tiles (`App.boot({ tiles: false })`), the relief's and GIBS's left to the block */
function patterns(tiles: boolean) {
  const hosts = [
    "*data.geopf.fr*",
    "*tiles.openfreemap.org*",
    "*esa-worldcover*",
    "*tiles.maps.eox.at*",
    "*overturemaps*",
    "*geo.admin.ch*",
    "*basemap.nationalmap.gov*",
    "*tiles.mapterhorn.com*",
    "*mapproxy.terrascope.be*",
    ...(tiles ? ["*s3.amazonaws.com/elevation-tiles*", "*gibs.earthdata.nasa.gov*"] : []),
  ];
  return hosts.map((urlPattern) => ({ urlPattern, requestStage: "Request" as const }));
}

/**
 * The cache on a page and its workers (App.boot, before the page's first navigation). `suspend(true)` lets the requests go to the network
 * (app.offline, app.throttle) and back.
 */
export async function earthCache(cdp: Cdp, o: { tiles: boolean; mode?: EarthDataMode; dir?: string; port?: number }) {
  const mode = o.mode ?? earthDataMode();
  const dir = o.dir ?? earthDataDir();
  const counts: EarthCounts = { hits: 0, misses: 0, hitBytes: 0, missBytes: 0, failed: 0, missing: [], bySource: {}, log: [] };
  if (mode === "off")
    return {
      mode,
      dir,
      counts,
      attribute: () => ({ workerFetch: {} as Record<string, string>, pausedOn: {} as Record<string, number>, workersSeen: [] as string[] }),
      attached: () => [] as { sessionId: string; url: string }[],
      suspend: async (_on: boolean) => {},
      stop: async () => {},
    };
  mkdirSync(dir, { recursive: true });
  const sessions = new Map<string, string>();
  const attached = new Map<string, string>(); // (the dedicated workers' sessions, their full URL — lib/worker-profile.ts seeds from it)
  // (which worker asked a URL: its own session's Network events — Chrome pauses a dedicated worker's requests on the page's Fetch
  // session too, so the paused request alone says "page"; T0, 16 Nov 2026)
  const askedBy = new Map<string, string>(); // (Network requestId → worker: the Fetch pause's networkId names it — two workers may ask one URL)
  const workerFetch: Record<string, string> = {};
  const pausedOn: Record<string, number> = {}; // (which session Chrome paused each request on)
  let suspended = false;
  const call = (sid: string | undefined, method: string, params: object) =>
    (sid ? cdp.sendTo(sid, method, params) : cdp.send(method, params)).catch(() => {});
  const enable = (sid?: string) => call(sid, "Fetch.enable", { patterns: patterns(o.tiles) });
  const offA = cdp.on("Target.attachedToTarget", (p) => {
    const t = p.targetInfo as { type: string; url: string };
    const sid = String(p.sessionId);
    sessions.set(sid, t.url.split("/").pop() || t.type);
    if (t.type === "worker") attached.set(sid, t.url);
    void (async () => {
      if (t.type === "worker" || t.type === "shared_worker") {
        const name = sessions.get(sid)!;
        await cdp.sendTo(sid, "Network.enable").catch(() => {});
        if (!suspended)
          workerFetch[name] = await cdp.sendTo(sid, "Fetch.enable", { patterns: patterns(o.tiles) }).then(
            () => "enabled",
            (e: unknown) => `refused: ${String(e).slice(0, 120)}`,
          );
      }
      await call(sid, "Runtime.runIfWaitingForDebugger", {});
    })();
  });
  const offN = cdp.on("Network.requestWillBeSent", (p, sid) => {
    const w = sid && sessions.get(sid);
    if (w) askedBy.set(String(p.requestId), w);
  });
  /** a request paused — the page's, a worker's (on the page's session or its own), the Service Worker's (its own target) —: let go,
   *  served from the disk, or fetched once and kept; `reply` answers on the session it was paused on */
  const paused = (raw: Record<string, unknown>, src: string, reply: (method: string, params: object) => Promise<unknown>) => {
    const p = raw as { requestId: string; networkId?: string; request: { url: string; method: string; headers: Record<string, string> } };
    counts.bySource[src] = (counts.bySource[src] ?? 0) + 1;
    pausedOn[src] = (pausedOn[src] ?? 0) + 1;
    void (async () => {
      const url = p.request.url;
      const range = p.request.headers.Range ?? p.request.headers.range ?? null;
      if (suspended || p.request.method !== "GET" || !keptUrl(url)) return void reply("Fetch.continueRequest", { requestId: p.requestId });
      try {
        let got = mode === "refresh" ? null : readKept(dir, url, range);
        if (got) {
          counts.hits++;
          counts.hitBytes += got.body.byteLength;
          if (counts.log.length < 20_000) counts.log.push({ src, url, hit: true, nid: p.networkId, at: Date.now() });
        } else if (mode === "offline") {
          counts.missing.push(url);
          console.error(`  e2e Earth data (offline): not on the disk — ${url}${range ? ` [${range}]` : ""}`);
          return void reply("Fetch.failRequest", { requestId: p.requestId, errorReason: "InternetDisconnected" });
        } else {
          const t0 = Date.now();
          got = await fetchKeep(dir, url, range);
          counts.misses++;
          counts.missBytes += got.body.byteLength;
          if (counts.log.length < 20_000) counts.log.push({ src, url, hit: false, nid: p.networkId, at: t0, ms: Date.now() - t0 });
        }
        const h = [
          { name: "content-type", value: got.meta.type },
          { name: "access-control-allow-origin", value: "*" },
          { name: "access-control-expose-headers", value: "content-range, content-length" },
          { name: "cache-control", value: "no-store" },
          ...(got.meta.contentRange ? [{ name: "content-range", value: got.meta.contentRange }] : []),
        ];
        await reply("Fetch.fulfillRequest", {
          requestId: p.requestId,
          responseCode: got.meta.status,
          responseHeaders: h,
          body: Buffer.from(got.body).toString("base64"),
        });
      } catch {
        // (the host refused, the page gone, the request cancelled: failed, as the network would)
        counts.failed++;
        await reply("Fetch.failRequest", { requestId: p.requestId, errorReason: "Failed" });
      }
    })();
  };
  const offP = cdp.on("Fetch.requestPaused", (raw, sid) =>
    paused(raw, sid ? (sessions.get(sid) ?? "worker") : "page", (m, q) => call(sid, m, q)),
  );
  /** the log's and bySource's sources resolved: a URL a worker's own session saw asked is that worker's, whichever session paused it */
  const attribute = () => {
    counts.bySource = {};
    for (const r of counts.log) {
      const w = r.nid && askedBy.get(r.nid);
      if (r.src === "page" && w) r.src = w;
      counts.bySource[r.src] = (counts.bySource[r.src] ?? 0) + 1;
    }
    return { workerFetch, pausedOn, workersSeen: [...new Set(sessions.values())] };
  };
  // (the Service Worker's own fetches — a zone's download, its tiles' cache filled —: another DevTools target, not the page's child —
  // attached by its own socket as it appears (the browser's target list read every second), Fetch enabled there; PLAN-J8 J8-6 (b),
  // Sam's decision of 16 Nov 2026: a zone downloaded once for every e2e)
  const swSockets = new Map<string, { ws: WebSocket; send: (method: string, params: object) => Promise<unknown> }>();
  const swAttach = async () => {
    if (!o.port) return;
    const list = await fetch(`http://127.0.0.1:${o.port}/json`)
      .then((r) => r.json() as Promise<{ id: string; type: string; webSocketDebuggerUrl?: string }[]>)
      .catch(() => []);
    for (const t of list) {
      if (t.type !== "service_worker" || !t.webSocketDebuggerUrl || swSockets.has(t.id)) continue;
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      let next = 1;
      const waiting = new Map<number, (v: unknown) => void>();
      const send = (method: string, params: object) =>
        new Promise<unknown>((ok) => {
          const id = next++;
          waiting.set(id, ok);
          try {
            ws.send(JSON.stringify({ id, method, params }));
          } catch {
            ok(null);
          }
          setTimeout(() => waiting.delete(id) && ok(null), 30_000);
        });
      ws.onmessage = (m) => {
        const d = JSON.parse(String(m.data)) as { id?: number; method?: string; params?: Record<string, unknown> };
        if (d.id) waiting.get(d.id)?.(d);
        if (d.id) waiting.delete(d.id);
        if (d.method === "Fetch.requestPaused" && d.params) paused(d.params, "service-worker", send);
      };
      ws.onclose = () => swSockets.delete(t.id);
      swSockets.set(t.id, { ws, send });
      await new Promise((ok) => {
        ws.onopen = ok;
        ws.onerror = ok;
      });
      if (!suspended) workerFetch["service-worker"] = (await send("Fetch.enable", { patterns: patterns(o.tiles) })) ? "enabled" : "refused";
    }
  };
  const swTimer = o.port ? setInterval(() => void swAttach(), 1000) : null;
  await enable();
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  return {
    mode,
    dir,
    counts,
    /** the cache let go (true) — the requests to the network — or taken back (false) */
    async suspend(on: boolean) {
      suspended = on;
      for (const sid of [undefined, ...sessions.keys()]) await (on ? call(sid, "Fetch.disable", {}) : enable(sid));
      for (const w of swSockets.values()) await w.send(on ? "Fetch.disable" : "Fetch.enable", on ? {} : { patterns: patterns(o.tiles) });
    },
    attribute,
    /** the dedicated workers attached so far (Chrome tells a later Target.setAutoAttach only of the new ones) */
    attached: () => [...attached].map(([sessionId, url]) => ({ sessionId, url })),
    async stop() {
      offA();
      offP();
      offN();
      if (swTimer) clearInterval(swTimer);
      for (const w of swSockets.values()) w.ws.close();
      swSockets.clear();
      await call(undefined, "Fetch.disable", {});
    },
  };
}

/** The network's requests by host (PLAN-J8 J8-9 (3): each host's measured rate): how many fetched, their span [s] — first start to last
 *  end — and rate over it [/s], their time on the wire (median, 95th) [ms]. The Géoplateforme's WMS-R grids, its WMTS, its BD TOPO apart. */
export function hostStats(log: EarthCounts["log"]) {
  const kind = (u: string) => {
    try {
      const h = new URL(u).hostname;
      if (h !== "data.geopf.fr") return h;
      return u.includes("/BDTOPO/")
        ? "geopf BD TOPO"
        : u.includes("wms-r")
          ? "geopf WMS-R"
          : /wmts/i.test(u)
            ? "geopf WMTS"
            : "geopf other";
    } catch {
      return "?";
    }
  };
  const by = new Map<string, { n: number; t0: number; t1: number; ms: number[] }>();
  for (const r of log) {
    if (r.hit || r.at === undefined) continue;
    const k = kind(r.url);
    const b = by.get(k) ?? { n: 0, t0: Number.POSITIVE_INFINITY, t1: 0, ms: [] };
    b.n++;
    b.t0 = Math.min(b.t0, r.at);
    b.t1 = Math.max(b.t1, r.at + (r.ms ?? 0));
    b.ms.push(r.ms ?? 0);
    by.set(k, b);
  }
  const q = (a: number[], f: number) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] ?? 0;
  return [...by].map(([host, b]) => {
    const span = Math.max(0.001, (b.t1 - b.t0) / 1000);
    return { host, n: b.n, spanS: Math.round(span), perS: +(b.n / span).toFixed(2), p50ms: q(b.ms, 0.5), p95ms: q(b.ms, 0.95) };
  });
}
