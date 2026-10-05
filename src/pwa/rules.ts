// The Service Worker's rules, pure (tested): what kind of request a URL is, and which cached tiles to
// evict when the tiles' cache is over its budget. Shared by src/sw.ts (the worker) and the tests.

/** How a request is served:
 *  - `immutable`: a hashed build asset (index-a1b2c3d4.js, earth-3z05cvb5.ktx2…) — cache first, forever;
 *  - `shell`: the page and its unhashed files (/, index.html, version.json, the workers, the WASM, docs/) —
 *    network first, the cache when offline;
 *  - `tile`: the Earth's relief (S3 terrarium) and imagery (GIBS) — cache first, under a budget, LRU;
 *  - `elements`: the station's orbital elements (CelesTrak) — network first, the cache when offline;
 *  - `pass`: anything else (POSTs, dev routes, other origins) — straight to the network. */
export type Kind = "immutable" | "shell" | "tile" | "elements" | "pass";

/** the bundler's hash: a dash, eight [a-z0-9], then the extension */
const HASHED = /-[a-z0-9]{8}\.[a-z0-9]+$/;

export function classify(url: string, origin: string, method = "GET"): Kind {
  if (method !== "GET") return "pass";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "pass";
  }
  if (u.origin === origin) {
    if (u.pathname.startsWith("/__")) return "pass";
    return HASHED.test(u.pathname) ? "immutable" : "shell";
  }
  if (u.hostname === "s3.amazonaws.com" && u.pathname.startsWith("/elevation-tiles-prod/")) return "tile";
  if (u.hostname === "gibs.earthdata.nasa.gov") return "tile";
  if (u.hostname === "celestrak.org") return "elements";
  return "pass";
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

/** The cache's names: the shell's carries the build, so a new build starts clean; the tiles' outlives builds. */
export const SHELL_CACHE = (build: string) => `kerr-shell-${build}`;
export const TILE_CACHE = "kerr-tiles-v1";
export const isShellCache = (name: string) => name.startsWith("kerr-shell-");
