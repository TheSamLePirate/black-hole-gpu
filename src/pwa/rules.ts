// The Service Worker's rules, pure (tested): what kind of request a URL is, and which cached tiles to
// evict when the tiles' cache is over its budget. Shared by src/sw.ts (the worker) and the tests.

/** How a request is served:
 *  - `immutable`: a hashed build asset (index-a1b2c3d4.js, earth-3z05cvb5.ktx2…) — cache first, forever;
 *  - `shell`: the page and its unhashed files (/, index.html, version.json, the workers, the WASM, docs/) —
 *    network first, the cache when offline;
 *  - `tile`: the Earth's relief (S3 terrarium) and imagery (GIBS) — cache first, under a budget, LRU;
 *  - `elements`: the station's orbital elements (CelesTrak) — network first, the cache when offline;
 *  - `pass`: anything else (POSTs, dev routes, other origins, the same origin outside this worker's own
 *    app) — straight to the network.
 * A worker's own app is its scope less the directories its build did not make (`dirs`, the build's
 * top-level directories; null — the dev server — the whole scope): the site shares its origin with a
 * preview deployed under it (the CI's test/ — its own worker, its own scope), and the site's worker must
 * neither serve nor cache that app's pages, nor be the one serving them before its worker takes over. */
export type Kind = "immutable" | "shell" | "tile" | "elements" | "pass";

/** the bundler's hash: a dash, eight [a-z0-9], then the extension */
const HASHED = /-[a-z0-9]{8}\.[a-z0-9]+$/;

export function classify(url: string, scope: string, method = "GET", dirs: readonly string[] | null = null): Kind {
  if (method !== "GET") return "pass";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "pass";
  }
  const home = new URL(scope);
  if (u.origin === home.origin) {
    if (!u.pathname.startsWith(home.pathname)) return "pass";
    const path = u.pathname.slice(home.pathname.length);
    if (path.startsWith("__")) return "pass";
    const dir = path.includes("/") ? path.slice(0, path.indexOf("/")) : null;
    if (dirs && dir !== null && !dirs.includes(dir)) return "pass";
    return HASHED.test(u.pathname) ? "immutable" : "shell";
  }
  if (u.hostname === "s3.amazonaws.com" && u.pathname.startsWith("/elevation-tiles-prod/")) return "tile";
  if (u.hostname === "gibs.earthdata.nasa.gov") return "tile";
  if (u.hostname === "celestrak.org") return "elements";
  return "pass";
}

/** The app's own page — its scope's root or index.html, whatever the query —: what an offline navigation
 *  falls back on (not a page of docs/, nor another app's). */
export function isAppPage(url: string, scope: string): boolean {
  const u = new URL(url),
    home = new URL(scope);
  return u.origin === home.origin && (u.pathname === home.pathname || u.pathname === `${home.pathname}index.html`);
}

/** the tiles' cache budget [bytes]: ~300 MB — a few hundred relief tiles and their imagery */
export const TILE_BUDGET = 300 * 1024 * 1024;

export interface TileEntry {
  url: string;
  /** when it was last served [ms] */
  t: number;
  /** its body [bytes] */
  size: number;
}

/** The tiles to evict, oldest first, until the cache is under 90 % of the budget (none when under it). */
export function evictions(entries: TileEntry[], budget = TILE_BUDGET): string[] {
  let total = 0;
  for (const e of entries) total += e.size;
  if (total <= budget) return [];
  const out: string[] = [];
  const goal = 0.9 * budget;
  for (const e of [...entries].sort((a, b) => a.t - b.t)) {
    if (total <= goal) break;
    out.push(e.url);
    total -= e.size;
  }
  return out;
}

/**
 * The caches' names. A shell's carries its worker's scope and its build: the apps sharing an origin
 * (the site, its preview under test/) share its Cache Storage too, and each drops only its own older
 * builds' shells. The tiles' — other origins' bytes, the same for every app — is shared, under one
 * budget (its index: the "kerr-sw" database), and outlives builds. (The colon: the workers of before,
 * which drop every `kerr-shell-…` but their own, leave these alone.)
 */
export const SHELL_CACHE = (scope: string, build: string) => `kerr-shell:${new URL(scope).pathname}:${build}`;
export const TILE_CACHE = "kerr-tiles-v1";
export const isOwnShellCache = (name: string, scope: string) => name.startsWith(`kerr-shell:${new URL(scope).pathname}:`);

/** a shell named before the scope was in the name (`kerr-shell-<build>`: one worker per origin assumed) */
export const isLegacyShell = (name: string) => name.startsWith("kerr-shell-");

/**
 * Such a legacy shell is this worker's to drop when it is an older build of this very app: it holds the
 * scope's page, and nothing of this origin outside the scope (a nested app's has no page at this root;
 * the parent's, when this worker is the nested one's, holds the parent's page).
 */
export function ownsLegacyShell(urls: readonly string[], scope: string): boolean {
  const origin = new URL(scope).origin;
  return urls.includes(scope) && urls.every((u) => !u.startsWith(`${origin}/`) || u.startsWith(scope));
}
