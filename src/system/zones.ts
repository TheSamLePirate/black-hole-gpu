// Offline zones (docs/ANALYSE-IGN-LIDAR.md §9, I8a): a region's tiles fetched ahead into the Service Worker's zones' cache
// (kerr-zones-v1, never evicted by the tiles' budget), so that a flight within it asks the network nothing for its ground.
// This module, pure: the tiles a zone holds — every one the game's windows would want with the camera anywhere within it
// (earth-tiles.ts: the relief's levels and their imagery, the orthophotos' levels) — and their URLs, from the very
// functions the loads use (the Service Worker finds a tile by its URL: one character off and the zone is useless).
//
// Not in a zone (yet): the world scenery's sources (OSM, WorldCover, the IGN's canopy and buildings), the regional pilot,
// the map's tiles (OSM's policy forbids it — §9.4).

import {
  eoxUrl,
  dayUrl,
  FINE_Z,
  GIBS_Z1,
  IMG_Z1,
  NATIONAL,
  nightOf,
  nightUrl,
  ORTHO_SPAN,
  ORTHO_Z0,
  SPAN,
  tileUrl,
  Z0,
  Z1,
  ZG1,
} from "./earth-tiles";
import { WGS84_A } from "./ellipsoid";
import { tileSource } from "./national";

/** a zone's levels: its relief's finest, its orthophotos' finest — §9.3's profiles */
export interface ZoneProfile {
  reliefZ1: number;
  orthoZ1: number;
}
export const ZONE_PROFILES = {
  /** an airfield, its taxiing: the orthophotos to 0.4 m */
  airport: { reliefZ1: 17, orthoZ1: 18 },
  /** a low flight: to 0.8 m */
  low: { reliefZ1: 16, orthoZ1: 17 },
  /** a valley, a massif */
  valley: { reliefZ1: 15, orthoZ1: 16 },
  /** a region flown over */
  overflight: { reliefZ1: 14, orthoZ1: 15 },
} as const satisfies Record<string, ZoneProfile>;
export type ZoneProfileId = keyof typeof ZONE_PROFILES;

/** the settings the URLs follow (earth-tiles.ts orthoOn, reliefOn, hlodOn; the fine levels' windows' side: setReach's
 *  TILE_REACH span, 4 or 8) */
export interface ZoneSources {
  ortho: boolean;
  relief: boolean;
  hlod: boolean;
  span?: number;
}
/**
 * A tile's fetches as the loads make them: a chain, each link asked only if the one before falls short — a height grid
 * (the WMS-R's float32) with holes (its no-data; the surface's over a fiftieth, as earth-tiles.ts ignGround), an image or a
 * mesh refused —; the chains' first links what a flight asks, the others only where its sources leave holes.
 */
export type ZoneChain = string[];

/**
 * The tiles of a zone of `radius` metres round a place [°], to its profile's levels: at each level, those the game's window
 * holds with the camera anywhere in the disc — its half-side (SPAN; 8 at the farthest reach from FINE_Z to ZG1, the IGN's
 * finer levels 4 whatever the reach), the lead ahead where the view looks (half a side less three quarters of a tile), the
 * window's recentring (0.8 of a tile off) and the ring of one tile loaded past it on the finest levels: a side and a half
 * round the camera. A flight lower than the profile's finest asks finer tiles: the
 * network's.
 * The levels finer than the global data's (z 15 … 17) only where a national source holds the tile and its relief is on
 * (`relief`), the orthophotos only where a national source holds it.
 */
export function zoneTiles(
  lat: number,
  lon: number,
  radius: number,
  profile: ZoneProfile,
  fineSpan = 8,
  relief = true,
): { relief: [number, number, number][]; ortho: [number, number, number][] } {
  const D = Math.PI / 180;
  const reliefs: [number, number, number][] = [],
    ortho: [number, number, number][] = [];
  const level = (z: number, margin: number, out: [number, number, number][], national: boolean) => {
    const n = 2 ** z,
      tileM = (2 * Math.PI * WGS84_A * Math.cos(lat * D)) / n;
    const cx = ((lon + 180) / 360) * n,
      cy = ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n;
    const r = radius / tileM,
      reach = Math.ceil(r + margin + 1);
    for (let y = Math.max(0, Math.floor(cy) - reach); y <= Math.min(n - 1, Math.floor(cy) + reach); y++)
      for (let x = Math.floor(cx) - reach; x <= Math.floor(cx) + reach; x++) {
        // (a camera within the disc whose window — `margin` tiles round it — holds the tile: the disc meets the tile's square
        // widened by it)
        const dx = Math.max(x - margin - cx, 0, cx - (x + 1 + margin)),
          dy = Math.max(y - margin - cy, 0, cy - (y + 1 + margin));
        if (dx * dx + dy * dy > r * r) continue;
        const xw = ((x % n) + n) % n;
        if (national && !tileSource(NATIONAL, n, xw, y)) continue;
        out.push([z, xw, y]);
      }
  };
  for (let z = Z0; z <= Math.min(profile.reliefZ1, relief ? Z1 : ZG1); z++) {
    const span = z >= FINE_Z && z <= ZG1 ? fineSpan : SPAN;
    level(z, span + 1.5, reliefs, z > ZG1);
  }
  for (let z = ORTHO_Z0; z <= profile.orthoZ1; z++) level(z, ORTHO_SPAN + 0.5, ortho, true);
  return { relief: reliefs, ortho };
}

/** A relief's tile's chains (earth-tiles.ts load): its heights — its national source's, their fallbacks, the global data's
 *  under them (Terrarium, its z 15 parent past it) —, the overground's surface and its fallback; to IMG_Z1 its imagery (the
 *  source's orthophotos, EOX's under them; GIBS's) and its night's lights (their z 8 parent) */
export function reliefChains(z: number, x: number, y: number, o: ZoneSources): ZoneChain[] {
  const n = 2 ** z,
    src = tileSource(NATIONAL, n, x, y);
  const out: ZoneChain[] = [];
  const k = Math.max(z - 15, 0);
  const terrarium = tileUrl(z - k, x >> k, y >> k);
  if (o.relief && src?.id === "swisstopo" && z >= src.heightsFrom) {
    // (swisstopo's meshes each wanted — the tile's one or two —, Terrarium under them)
    for (const u of src.heightUrls(z, x, y, o.hlod)) out.push([u]);
    out.push([terrarium]);
  } else if (o.relief && src && z >= src.heightsFrom) {
    const urls = src.heightUrls(z, x, y, o.hlod);
    // (the surface's — the overground's, at 512² below z 13 — its own chain; the ground's ending on Terrarium)
    const surface = urls.filter((u) => u.includes("_MNS") || u.includes(".MNS"));
    const ground = urls.filter((u) => !surface.includes(u));
    out.push([...ground, terrarium]);
    if (surface.length) out.push(surface);
  } else out.push([terrarium]);
  if (z <= IMG_Z1) {
    if (z > GIBS_Z1) out.push(o.ortho && src ? [src.orthoUrl(z, x, y), eoxUrl(z, x, y)] : [eoxUrl(z, x, y)]);
    else out.push([dayUrl(z, x, y)]);
    const night = nightOf(z, x, y);
    out.push([nightUrl(night.z, night.x, night.y)]);
  }
  return out;
}
/** every URL a relief's tile may fetch (its chains' links, all of them) */
export const reliefUrls = (z: number, x: number, y: number, o: ZoneSources): string[] => reliefChains(z, x, y, o).flat();
/** an orthophotos' tile's URL (its national source's) */
export function orthoUrls(z: number, x: number, y: number): string[] {
  const src = tileSource(NATIONAL, 2 ** z, x, y);
  return src ? [src.orthoUrl(z, x, y)] : [];
}

/** a zone's chains, each once (a parent's Terrarium, a lights' parent, shared by many tiles: the first's), the coarse
 *  levels first (a download cut short still holds the overview) */
export function zoneChains(lat: number, lon: number, radius: number, profile: ZoneProfile, o: ZoneSources): ZoneChain[] {
  // (the relief's survey off: no level finer than the global data's asked)
  const t = zoneTiles(lat, lon, radius, profile, o.span, o.relief);
  const tiles = [...t.relief.map((v) => ["r", ...v] as const), ...(o.ortho ? t.ortho.map((v) => ["o", ...v] as const) : [])];
  tiles.sort((a, b) => a[1] - b[1]);
  const seen = new Set<string>(),
    out: ZoneChain[] = [];
  for (const [kind, z, x, y] of tiles)
    for (const chain of kind === "r" ? reliefChains(z, x, y, o) : [orthoUrls(z, x, y)]) {
      const c = chain.filter((u) => !seen.has(u));
      for (const u of c) seen.add(u);
      if (c.length) out.push(c);
    }
  return out;
}
/** a zone's URLs, every link of every chain, once each */
export const zoneUrls = (lat: number, lon: number, radius: number, profile: ZoneProfile, o: ZoneSources): string[] =>
  zoneChains(lat, lon, radius, profile, o).flat();

/** a URL's size by its kind's measured mean [bytes] (2026-10-23) */
const sizeOf = (u: string) =>
  u.includes("wms-r")
    ? u.includes("WIDTH=512")
      ? 1_048_576
      : 262_144
    : u.includes(".terrain")
      ? 250_000
      : u.includes("terrarium")
        ? 90_000
        : u.includes("VIIRS")
          ? 30_000
          : 18_000;
/** a zone's size before it is fetched [bytes]: its chains' first links, a tenth of the fallbacks after them (the sea, a
 *  survey's gap) */
export function zoneEstimate(chains: readonly ZoneChain[]): number {
  let bytes = 0;
  for (const c of chains) for (let i = 0; i < c.length; i++) bytes += sizeOf(c[i]!) * (i ? 0.1 : 1);
  return bytes;
}
/** a zone's download time before it is fetched [s]: the WMS-R's grids spaced 8 a second (sw.ts gentle), the other
 *  tiles ~35 chains a second (measured on kerr-mini, 2026-10-23: 4 190 chains in 2 min) — the two at once */
export function zoneDuration(chains: readonly ZoneChain[]): number {
  let wms = 0;
  for (const c of chains) if (c[0]!.includes("wms-r")) wms++;
  return Math.max((chains.length - wms) / 35, wms / 8);
}
