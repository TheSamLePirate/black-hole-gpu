// Offline zones (docs/ANALYSE-IGN-LIDAR.md §9, I8a): a region's tiles fetched ahead into the Service Worker's zones' cache
// (kerr-zones-v1, never evicted by the tiles' budget), so that a flight within it asks the network nothing for its ground.
// This module, pure: the tiles a zone holds — every one the game's windows would want with the camera anywhere within it
// (earth-tiles.ts: the relief's levels and their imagery, the orthophotos' levels) — and their URLs, from the very
// functions the loads use (the Service Worker finds a tile by its URL: one character off and the zone is useless).
//
// And the world scenery's (`scenery`: scenery-sources.ts — the land cover's cells, OpenFreeMap's vector tiles, the relief under
// them, the IGN's canopy and ground blocks and its BD TOPO's buildings, swisstopo's ground) for every scene the camera
// anywhere within it asks. Not in a zone: the regional pilot, the map's tiles (OSM's policy forbids it — §9.4).

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
  ORTHO_Z1,
  SPAN,
  tileUrl,
  Z0,
  Z1,
  ZG1,
} from "./earth-tiles";
import { WGS84_A } from "./ellipsoid";
import { BDTOPO_Z, bdtopoUrl } from "./bdtopo";
import { blockChains, blockSides, CANOPY_NEAR, CANOPY_Z, tilesWithin } from "./ign-canopy";
import { SWISS_GROUND_G, swissTerrainUrl, tileSource } from "./national";
import { D as DEG, type SceneryMode } from "./scenery-data";
import { OVERTURE_LIST, OVERTURE_Z, overtureZoneUrl } from "./pmtiles";
import {
  COVER_CELL,
  coverUrl,
  OSM_Z,
  osmUrl,
  OVERTURE_REACH_M,
  sceneryBox,
  sceneryDemZoom,
  surveyOf,
  surveyReach,
} from "./scenery-sources";

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
/** a zone's detailed core (its record's coreKm: a disc round its centre): the airfield's levels there whatever its profile
 *  — what a flight under ~1 km over the ground asks, full screen (earth-tiles.ts: the orthophotos' z 18 from the eye's
 *  height and the pixel's angle; the relief's z 17 under ~1.7 km) —, its profile's past it */
export const ZONE_CORE: ZoneProfile = ZONE_PROFILES.airport;

/** the settings the URLs follow (earth-tiles.ts orthoOn, reliefOn, hlodOn; the fine levels' windows' side: setReach's
 *  TILE_REACH span, 4 or 8) */
export interface ZoneSources {
  ortho: boolean;
  relief: boolean;
  hlod: boolean;
  span?: number;
  /** the world scenery as the game draws it (quality-policy.ts earthDetailFor: its mode, DETAIL_REACH's reach; the land
   *  cover's true colours with settings.earthSurface on) — none, off or absent; its survey follows `relief` */
  scenery?: { mode: SceneryMode; satellite: boolean; reach: number; overture?: boolean } | null;
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
 * round the camera. A flight lower than the profile's finest asks finer tiles: the network's — or, within the
 * detailed core (`core` [m], capped at the radius), the airfield's levels (ZONE_CORE), held to its own radius.
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
  core = 0,
): { relief: [number, number, number][]; ortho: [number, number, number][] } {
  const D = Math.PI / 180;
  const reliefs: [number, number, number][] = [],
    ortho: [number, number, number][] = [];
  const coreR = Math.min(Math.max(core, 0), radius);
  const level = (z: number, margin: number, out: [number, number, number][], national: boolean, radius: number) => {
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
  const top =
    coreR > 0
      ? { reliefZ1: Math.max(profile.reliefZ1, ZONE_CORE.reliefZ1), orthoZ1: Math.max(profile.orthoZ1, ZONE_CORE.orthoZ1) }
      : profile;
  for (let z = Z0; z <= Math.min(top.reliefZ1, relief ? Z1 : ZG1); z++) {
    const span = z >= FINE_Z && z <= ZG1 ? fineSpan : SPAN;
    level(z, span + 1.5, reliefs, z > ZG1, z <= profile.reliefZ1 ? radius : coreR);
  }
  for (let z = ORTHO_Z0; z <= top.orthoZ1; z++) level(z, ORTHO_SPAN + 0.5, ortho, true, z <= profile.orthoZ1 ? radius : coreR);
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

/** how far a scene's centre lies from the camera [m]: led where the view looks (renderer.ts: 0.6 of the scene's radius) or
 *  by its motion (streaming-focus.ts: 650 m at most), snapped to sceneryCentre's 0.005° grid (≤ 400 m off) */
export const sceneryLead = (radius: number) => Math.max(650, 0.6 * radius) + 400;
/**
 * The world scenery's chains for a zone (scenery-sources.ts sceneryChains, their union over every scene a camera within the
 * disc asks): the scenes' centres anywhere within the disc widened by their lead; each source's tiles those a scene's box —
 * or its survey's disc — round such a centre meets. The IGN's survey and buildings where a centre is the IGN's (`ign`: the
 * relief's setting), swisstopo's ground where it is swisstopo's.
 */
export function sceneryZoneChains(
  lat: number,
  lon: number,
  radius: number,
  s: NonNullable<ZoneSources["scenery"]>,
  ign: boolean,
): ZoneChain[] {
  if (s.mode === "off") return [];
  const box = sceneryBox(lat, lon, s.mode, s.reach);
  const rc = radius + sceneryLead(box.radius);
  // (in degrees round the zone's centre: a degree east the fewest metres at the disc's poleward edge, a degree north the
  // fewest the meridian has — every cell a scene meets kept, a few more)
  const edge = Math.min(84, Math.abs(lat) + rc / 110_500);
  const kx = 111_320 * Math.max(Math.cos(edge * DEG), 0.1),
    ky = 110_500;
  const spanLat = box.span,
    spanLon = box.span / Math.max(Math.cos(edge * DEG), 0.12);
  /** whether a cell's box [°, west unwrapped near the zone's], widened by half-sides [°], meets the centres' disc */
  const meets = (west: number, south: number, east: number, north: number, padLon: number, padLat: number) => {
    const dx = Math.max(west - padLon - lon, 0, lon - east - padLon) * kx,
      dy = Math.max(south - padLat - lat, 0, lat - north - padLat) * ky;
    return dx * dx + dy * dy <= rc * rc;
  };
  const dLon = rc / kx,
    dLat = rc / ky;
  /** a Web Mercator level's tiles meeting it (x unwrapped) */
  const mercator = (z: number, padLon: number, padLat: number) => {
    const n = 2 ** z,
      out: [number, number][] = [];
    const mx = (v: number) => ((v + 180) / 360) * n,
      my = (v: number) => ((1 - Math.asinh(Math.tan(Math.max(-85, Math.min(85, v)) * DEG)) / Math.PI) / 2) * n,
      latOf = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / DEG;
    for (let y = Math.max(0, Math.floor(my(lat + dLat + padLat))); y <= Math.min(n - 1, Math.floor(my(lat - dLat - padLat))); y++)
      for (let x = Math.floor(mx(lon - dLon - padLon)); x <= Math.floor(mx(lon + dLon + padLon)); x++)
        if (meets((x / n) * 360 - 180, latOf(y + 1), ((x + 1) / n) * 360 - 180, latOf(y), padLon, padLat)) out.push([x, y]);
    return out;
  };
  const out: ZoneChain[] = [];
  // (the land cover's cells, their true colours with them)
  for (let row = Math.floor((lat - dLat - spanLat) / COVER_CELL); row <= Math.floor((lat + dLat + spanLat) / COVER_CELL); row++)
    for (
      let col = Math.floor((lon - dLon - spanLon + 180) / COVER_CELL);
      col <= Math.floor((lon + dLon + spanLon + 180) / COVER_CELL);
      col++
    ) {
      const west = col * COVER_CELL - 180,
        south = row * COVER_CELL;
      if (!meets(west, south, west + COVER_CELL, south + COVER_CELL, spanLon, spanLat)) continue;
      out.push([coverUrl(false, col, row)]);
      if (s.satellite) out.push([coverUrl(true, col, row)]);
    }
  // (the vector tiles under the boxes)
  for (const [x, y] of mercator(OSM_Z, spanLon, spanLat)) out.push([osmUrl(x, y)]);
  // (the global relief under them: their parents at the scenes' level, one more round — a line's points run past its tile)
  const seen = new Set<string>();
  for (const at of [lat - dLat, lat, lat + dLat]) {
    const z = sceneryDemZoom(at),
      n = 2 ** z,
      pad = 360 / n + 360 / 2 ** OSM_Z;
    for (const [x, y] of mercator(z, spanLon + pad, spanLat + pad * Math.cos(lat * DEG))) {
      const u = tileUrl(z, ((x % n) + n) % n, y);
      if (!seen.has(u)) out.push([u]);
      seen.add(u);
    }
  }
  // (the surveys: where a scene's centre is under one — the disc's points every few hundred metres asked)
  const step = Math.max(500, rc / 40);
  const under = { ign: false, swisstopo: false, other: false };
  for (let dy = -rc; dy <= rc; dy += step)
    for (let dx = -rc; dx <= rc; dx += step) {
      if (dx * dx + dy * dy > rc * rc) continue;
      const v = surveyOf({ lat: lat + dy / ky, lon: lon + dx / kx, ign });
      under[v ?? "other"] = true;
      if (v === "swisstopo") under.other = true;
    }
  const reach = surveyReach(box.radius),
    slack = 0.02 * rc + 100;
  if (under.ign) {
    // (the IGN's blocks: the far ones' sides out to the forest's disc, the near ones' within CANOPY_NEAR of a centre)
    for (const b of tilesWithin(CANOPY_Z, lat, lon, rc + reach + slack)) {
      out.push(...blockChains(b.x, b.y, blockSides(Number.POSITIVE_INFINITY)));
      if (b.d <= rc + CANOPY_NEAR + slack) out.push(...blockChains(b.x, b.y, blockSides(0)));
    }
    // (the BD TOPO's buildings within the scenes' radius)
    for (const t of tilesWithin(BDTOPO_Z, lat, lon, rc + box.radius + slack)) out.push([bdtopoUrl(t.x, t.y)]);
  }
  if (under.swisstopo) {
    const s0 = 180 / 2 ** SWISS_GROUND_G,
      padLat = reach / 111_195,
      padLon = reach / (111_195 * Math.max(Math.cos(edge * DEG), 0.12));
    for (let y = Math.floor((lat - dLat - padLat + 90) / s0); y <= Math.floor((lat + dLat + padLat + 90) / s0); y++)
      for (let x = Math.floor((lon - dLon - padLon + 180) / s0); x <= Math.floor((lon + dLon + padLon + 180) / s0); x++)
        if (meets(x * s0 - 180, y * s0 - 90, (x + 1) * s0 - 180, (y + 1) * s0 - 90, padLon, padLat))
          out.push([swissTerrainUrl(SWISS_GROUND_G, x, y)]);
  }
  // (Overture's buildings where a centre is not the BD TOPO's: its listing, its tiles near the centres — pseudo-URLs whose
  // byte ranges the Service Worker resolves and keeps)
  if (s.overture && under.other) {
    out.push([OVERTURE_LIST]);
    for (const t of tilesWithin(OVERTURE_Z, lat, lon, rc + OVERTURE_REACH_M + slack)) out.push([overtureZoneUrl(t.x, t.y)]);
  }
  return out;
}

/** a zone's chains, each link asked once at most where it is sure to be (a parent's Terrarium, a lights' parent, shared by
 *  many tiles: the first's), the coarse
 *  levels first (a download cut short still holds the overview), the world scenery's last */
export function zoneChains(lat: number, lon: number, radius: number, profile: ZoneProfile, o: ZoneSources, core = 0): ZoneChain[] {
  // (the relief's survey off: no level finer than the global data's asked)
  const t = zoneTiles(lat, lon, radius, profile, o.span, o.relief, core);
  const tiles = [...t.relief.map((v) => ["r", ...v] as const), ...(o.ortho ? t.ortho.map((v) => ["o", ...v] as const) : [])];
  tiles.sort((a, b) => a[1] - b[1]);
  // (a link left out only where an earlier chain asks it first — surely fetched —: one met only as a fallback, past a link
  // that may suffice, is never asked there — a scene's Terrarium under the relief's IGN grids)
  const sure = new Set<string>(),
    out: ZoneChain[] = [];
  const add = (chain: ZoneChain) => {
    const c = chain.filter((u) => !sure.has(u));
    if (!c.length) return;
    sure.add(c[0]!);
    out.push(c);
  };
  for (const [kind, z, x, y] of tiles) for (const chain of kind === "r" ? reliefChains(z, x, y, o) : [orthoUrls(z, x, y)]) add(chain);
  // (the world scenery's after the ground's)
  if (o.scenery) for (const chain of sceneryZoneChains(lat, lon, radius, o.scenery, o.relief)) add(chain);
  return out;
}
/** a zone's URLs, every link of every chain, once each */
export const zoneUrls = (lat: number, lon: number, radius: number, profile: ZoneProfile, o: ZoneSources, core = 0): string[] => [
  ...new Set(zoneChains(lat, lon, radius, profile, o, core).flat()),
];

/** a zone as its record keeps it (pwa/rules.ts ZoneRecord) */
export interface ZonePlace {
  lat: number;
  lon: number;
  radiusKm: number;
  profile: string;
  coreKm?: number;
  sources: Pick<ZoneSources, "ortho" | "relief">;
}
/** a place's distance [m] from a zone's centre [°] as zoneTiles measures its disc: in Web Mercator, at the centre's scale */
export function zoneDistance(lat0: number, lon0: number, lat: number, lon: number): number {
  const D = Math.PI / 180,
    C = 2 * Math.PI * WGS84_A * Math.cos(lat0 * D);
  const merc = (la: number) => Math.asinh(Math.tan(la * D)) / (2 * Math.PI);
  let dl = (lon - lon0) / 360;
  dl -= Math.round(dl);
  return Math.hypot(dl * C, (merc(lat) - merc(lat0)) * C);
}
/**
 * The finest levels the zones hold with the camera at a place [°] — their profile's within their disc, the airfield's
 * within their core, none where their sources were off (the relief's survey: the global data's levels alone) —; null out
 * of every zone. Offline the game asks nothing finer there (earth-tiles.ts held): those tiles are in no zone, each request
 * would fail.
 */
export function zoneLevelsAt(zones: readonly ZonePlace[], lat: number, lon: number): ZoneProfile | null {
  let out: ZoneProfile | null = null;
  for (const z of zones) {
    const d = zoneDistance(z.lat, z.lon, lat, lon);
    if (d > z.radiusKm * 1000) continue;
    const p: ZoneProfile = ZONE_PROFILES[z.profile as ZoneProfileId] ?? ZONE_PROFILES.low;
    const core = (z.coreKm ?? 0) > 0 && d <= Math.min(z.coreKm!, z.radiusKm) * 1000;
    const relief = z.sources.relief ? Math.max(p.reliefZ1, core ? ZONE_CORE.reliefZ1 : 0) : Math.min(p.reliefZ1, ZG1);
    const ortho = z.sources.ortho ? Math.min(Math.max(p.orthoZ1, core ? ZONE_CORE.orthoZ1 : 0), ORTHO_Z1) : ORTHO_Z0 - 1;
    out = out ? { reliefZ1: Math.max(out.reliefZ1, relief), orthoZ1: Math.max(out.orthoZ1, ortho) } : { reliefZ1: relief, orthoZ1: ortho };
  }
  return out;
}

/** a URL's size by its kind's measured mean [bytes] (2026-10-23; the relief's grids as the worker keeps them, packed —
 *  pwa/relief-codec.ts, I8c: scripts/relief-codec-bench.ts, 2026-10-24; the scenery's, 2026-10-24: a sample of each kind
 *  round Saint-Lô, Chamonix, Paris, Lauterbrunnen, Garmisch — the canopy's grids packed too) */
const sizeOf = (u: string) =>
  u.includes("wms-r")
    ? u.includes("LIDAR-HD_MNH")
      ? u.includes("WIDTH=512")
        ? 162_000
        : 51_000
      : u.includes("WIDTH=512")
        ? 180_000
        : u.includes("WIDTH=128")
          ? 13_000
          : 44_000
    : u.includes(".terrain")
      ? u.includes(`/${SWISS_GROUND_G}/`)
        ? 74_000
        : 250_000
      : u.includes("terrarium")
        ? 90_000
        : u.includes("VIIRS")
          ? 30_000
          : u.includes("terrascope")
            ? u.includes("tcc")
              ? 171_000
              : 64_000
            : u.includes("openfreemap")
              ? 73_000
              : u.includes("/BDTOPO/")
                ? 135_000
                : 18_000;
/** a zone's size before it is fetched [bytes]: its chains' first links, a tenth of the fallbacks after them (the sea, a
 *  survey's gap) */
export function zoneEstimate(chains: readonly ZoneChain[]): number {
  let bytes = 0;
  for (const c of chains) for (let i = 0; i < c.length; i++) bytes += sizeOf(c[i]!) * (i ? 0.1 : 1);
  return bytes;
}
/** a zone's download time before it is fetched [s]: the WMS-R's grids ~5 a second (sw.ts gentle spaces them 8 a second,
 *  their answers slower: 2 987 in 588 s on kerr-mini, 2026-10-24), the other tiles ~35 chains a second (4 190 chains in
 *  2 min, 2026-10-23) — the two at once */
export function zoneDuration(chains: readonly ZoneChain[]): number {
  let wms = 0;
  for (const c of chains) if (c[0]!.includes("wms-r")) wms++;
  return Math.max((chains.length - wms) / 35, wms / 5);
}
