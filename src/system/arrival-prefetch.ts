// The landing zone asked ahead (Sam, 26 Nov 2026: « la zone d'atterrissage doit déjà être chargée quand on arrive vers 10–20 km
// d'altitude »). While the entry autopilot brings the craft down to a runway, the tiles its windows will want over the approach —
// the final's places at the heights it flies them, the threshold, the rollout — are fetched from the deorbit on: the relief's
// heights, imagery and lights (each chain's first link, as the loads ask them — zones.ts reliefChains) and the orthophotos, into
// the Service Worker's tile cache (sw.ts tile: its LRU, 300 MB) — or the browser's HTTP cache without one —, the loads then
// answered without the network. The game's own streaming first: nothing asked while the windows' tiles are pending; the IGN's
// grids through the relief's own rate gate (earth-tiles.ts ignTurn), the Service Worker's spacing behind it.
// Measured on Edwards, 26 Nov 2026 (kerr-mini, before): the site's relief drawn z 8 at 35 km up, z 12 at 20 km, z 14 at the
// touchdown — its contact level z 17 never.

import type { Site } from "../game/sites";
import { type EarthTiles, ignTurn } from "./earth-tiles";
import { orthoUrls, reliefChains, type ZoneSources } from "./zones";

/** the approach's places [km before the threshold along the runway's axis, height over the ground m] — the final's (its gate 12 km
 *  out ~2 km up, the steep slope, the flare) and the field's: what the windows want there at that height */
export const ARRIVAL_PROFILE: readonly (readonly [number, number])[] = [
  [40, 12000],
  [25, 6000],
  [12, 2000],
  [6, 800],
  [2.5, 250],
  [0, 20],
  [-1.5, 3],
  [-3, 3],
];

/** the fetches in flight at once (the IGN's under their gate besides) */
const CONCURRENCY = 6;
/** the bytes asked at most [B] — under the Service Worker's tile cache (sw.ts TILE_BUDGET, 300 MB, LRU): Le Bourget's whole approach
 *  was 706 MB in 3 726 fetches (its IGN grids float32, ~190 kB each; kerr-mini 26 Nov 2026), Edwards's 93 MB */
export const ARRIVAL_BUDGET = 150 * 1024 * 1024;
/** the windows' tiles pending past which the arrival's wait — the view's own first */
const BUSY_PENDING = 4;

/** The approach's places over a runway [° and m]: along its landing heading back from its threshold (a flat local frame — tens of
 *  km —; the heights are over the ground, the windows' own measure). */
export function arrivalPoints(site: Pick<Site, "lat" | "lon" | "rwy">): { lat: number; lon: number; agl: number }[] {
  const D = Math.PI / 180;
  const hd = (site.rwy ?? 0) * D;
  const kmLat = 111.32,
    kmLon = 111.32 * Math.cos(site.lat * D);
  return ARRIVAL_PROFILE.map(([km, agl]) => ({
    lat: site.lat - (km * Math.cos(hd)) / kmLat,
    lon: site.lon - (km * Math.sin(hd)) / kmLon,
    agl,
  }));
}

/** The URLs to ask for those tiles: each relief tile's chains' first links (its heights, its surface, its imagery, its lights —
 *  the others only where these fall short: left to the loads), each orthophoto's. Deduplicated, in the tiles' order. */
export function arrivalUrls(t: { relief: [number, number, number][]; ortho: [number, number, number][] }, src: ZoneSources): string[] {
  // (the relief's and the orthophotos' levels together, coarse first: the order the fall needs them — what the budget leaves out
  // is the field's finest, asked by the windows in its last kilometres)
  const all: [number, () => string[]][] = [
    ...t.relief.map(
      ([z, x, y]) =>
        [
          z,
          () =>
            reliefChains(z, x, y, src)
              .map((ch) => ch[0]!)
              .filter(Boolean),
        ] as [number, () => string[]],
    ),
    ...t.ortho.map(([z, x, y]) => [z, () => orthoUrls(z, x, y)] as [number, () => string[]]),
  ];
  all.sort((a, b) => a[0] - b[0]);
  const out = new Set<string>();
  for (const [, urls] of all) for (const u of urls()) out.add(u);
  return [...out];
}

const isIgn = (u: string) => u.includes("geopf.fr") || u.includes("ign.fr");

/** The arrival's fetches: started for a site, cancelled when the entry ends or goes elsewhere. */
export class ArrivalPrefetch {
  /** the site fetched for (its name and runway), null: none */
  key: string | null = null;
  /** what was asked, fetched, failed, its bytes; when it began and ended [ms, performance.now] */
  stats = { urls: 0, done: 0, failed: 0, bytes: 0, relief: 0, ortho: 0, t0: 0, t1: 0 };
  /** (the budget reached before the end: what was left out) */
  get capped() {
    return this.stats.bytes >= ARRIVAL_BUDGET;
  }
  private gen = 0;

  constructor(
    private tiles: EarthTiles,
    private sources: () => ZoneSources,
  ) {}

  /** the fetches for a site (nothing if under way for it already); `pixAngle` the view's pixel's angle now [rad] */
  start(site: Pick<Site, "name" | "lat" | "lon" | "rwy">, pixAngle: number) {
    const key = `${site.name}|${site.rwy ?? ""}`;
    if (key === this.key) return;
    this.cancel();
    this.key = key;
    const gen = this.gen;
    const t = this.tiles.arrivalTiles(arrivalPoints(site), pixAngle);
    const urls = arrivalUrls(t, this.sources());
    this.stats = {
      urls: urls.length,
      done: 0,
      failed: 0,
      bytes: 0,
      relief: t.relief.length,
      ortho: t.ortho.length,
      t0: performance.now(),
      t1: 0,
    };
    let k = 0;
    let running = CONCURRENCY;
    const run = async () => {
      while (k < urls.length && gen === this.gen && this.stats.bytes < ARRIVAL_BUDGET) {
        // (the view's tiles first)
        if (this.tiles.pending > BUSY_PENDING) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        const u = urls[k++]!;
        try {
          if (isIgn(u)) await ignTurn();
          if (gen !== this.gen) return;
          const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
          const b = await r.arrayBuffer();
          if (gen !== this.gen) return;
          if (r.ok || r.status === 404) {
            this.stats.done++;
            this.stats.bytes += b.byteLength;
          } else this.stats.failed++;
        } catch {
          if (gen === this.gen) this.stats.failed++;
        }
      }
      if (--running === 0 && gen === this.gen) this.stats.t1 = performance.now();
    };
    for (let i = 0; i < CONCURRENCY; i++) void run();
  }

  /** stopped (the entry over, or another site) — what is in flight let finish */
  cancel() {
    this.gen++;
    this.key = null;
  }

  /** the share fetched (failed counted as done: asked again by the loads) 0…1; 1 with nothing to fetch */
  get progress() {
    const s = this.stats;
    return s.urls ? (s.done + s.failed) / s.urls : 1;
  }
}
