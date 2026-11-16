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

/** the mode asked (E2E_EARTH_DATA) — `off` by default until T0's witnesses pass (16 Nov 2026: the checkout is shared, remote.ts syncs it
 *  to kerr-mini — an untried cache must not change another session's runs); `on` once proven (J8-T T2) */
export const EARTH_DATA_DEFAULT: EarthDataMode = "off";
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
  log: { src: string; url: string; hit: boolean }[];
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
export async function earthCache(cdp: Cdp, o: { tiles: boolean; mode?: EarthDataMode; dir?: string }) {
  const mode = o.mode ?? earthDataMode();
  const dir = o.dir ?? earthDataDir();
  const counts: EarthCounts = { hits: 0, misses: 0, hitBytes: 0, missBytes: 0, failed: 0, missing: [], bySource: {}, log: [] };
  if (mode === "off") return { mode, dir, counts, suspend: async (_on: boolean) => {}, stop: async () => {} };
  mkdirSync(dir, { recursive: true });
  const sessions = new Map<string, string>();
  let suspended = false;
  const call = (sid: string | undefined, method: string, params: object) =>
    (sid ? cdp.sendTo(sid, method, params) : cdp.send(method, params)).catch(() => {});
  const enable = (sid?: string) => call(sid, "Fetch.enable", { patterns: patterns(o.tiles) });
  const offA = cdp.on("Target.attachedToTarget", (p) => {
    const t = p.targetInfo as { type: string; url: string };
    const sid = String(p.sessionId);
    sessions.set(sid, t.url.split("/").pop() || t.type);
    void (async () => {
      if (!suspended && (t.type === "worker" || t.type === "shared_worker")) await enable(sid);
      await call(sid, "Runtime.runIfWaitingForDebugger", {});
    })();
  });
  const offP = cdp.on("Fetch.requestPaused", (raw, sid) => {
    const p = raw as { requestId: string; request: { url: string; method: string; headers: Record<string, string> } };
    const src = sid ? (sessions.get(sid) ?? "worker") : "page";
    counts.bySource[src] = (counts.bySource[src] ?? 0) + 1;
    void (async () => {
      const url = p.request.url;
      const range = p.request.headers.Range ?? p.request.headers.range ?? null;
      if (suspended || p.request.method !== "GET" || !keptUrl(url)) return call(sid, "Fetch.continueRequest", { requestId: p.requestId });
      try {
        let got = mode === "refresh" ? null : readKept(dir, url, range);
        if (got) {
          counts.hits++;
          counts.hitBytes += got.body.byteLength;
          if (counts.log.length < 20_000) counts.log.push({ src, url, hit: true });
        } else if (mode === "offline") {
          counts.missing.push(url);
          console.error(`  e2e Earth data (offline): not on the disk — ${url}${range ? ` [${range}]` : ""}`);
          return call(sid, "Fetch.failRequest", { requestId: p.requestId, errorReason: "InternetDisconnected" });
        } else {
          got = await fetchKeep(dir, url, range);
          counts.misses++;
          counts.missBytes += got.body.byteLength;
          if (counts.log.length < 20_000) counts.log.push({ src, url, hit: false });
        }
        const h = [
          { name: "content-type", value: got.meta.type },
          { name: "access-control-allow-origin", value: "*" },
          { name: "access-control-expose-headers", value: "content-range, content-length" },
          { name: "cache-control", value: "no-store" },
          ...(got.meta.contentRange ? [{ name: "content-range", value: got.meta.contentRange }] : []),
        ];
        await call(sid, "Fetch.fulfillRequest", {
          requestId: p.requestId,
          responseCode: got.meta.status,
          responseHeaders: h,
          body: Buffer.from(got.body).toString("base64"),
        });
      } catch {
        // (the host refused, the page gone, the request cancelled: failed, as the network would)
        counts.failed++;
        await call(sid, "Fetch.failRequest", { requestId: p.requestId, errorReason: "Failed" });
      }
    })();
  });
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
    },
    async stop() {
      offA();
      offP();
      await call(undefined, "Fetch.disable", {});
    },
  };
}
