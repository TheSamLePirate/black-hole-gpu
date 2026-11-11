// Offline zones (docs/ANALYSE-IGN-LIDAR.md §9, I8a): a region's tiles fetched ahead into the Service Worker's zones' cache
// (kerr-zones-v1, never evicted by the tiles' budget), so that a flight within it asks the network nothing for its ground.
// This module, pure: the tiles a zone holds — every one the game's windows would want with the camera anywhere within it
// (earth-tiles.ts: the relief's levels and their imagery, the orthophotos' levels) — and their URLs, from the very
// functions the loads use (the Service Worker finds a tile by its URL: one character off and the zone is useless).
//
// And the world scenery's (`scenery`: scenery-sources.ts — the land cover's cells, OpenFreeMap's vector tiles, the relief under
// them, the IGN's canopy and ground blocks and its BD TOPO's buildings, swisstopo's ground) for every scene the camera
// anywhere within it asks. Not in a zone: the regional pilot, the map's tiles (OSM's policy forbids it — §9.4).

import { mapterhornUrl, USA_GROUND_Z } from "./usa-ground";
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
  ORTHO_BIG_LEVELS,
  ORTHO_SPAN_BIG,
  ORTHO_Z0,
  ORTHO_Z1,
  roadsUrl,
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
import { OVERTURE_LIST, OVERTURE_Z, overtureBaseZoneUrl, overtureZoneUrl } from "./pmtiles";
import { ROAD_MVT_Z1, ROAD_Z0 } from "./night-roads";
import { TURBINE_REACH_M, TURBINE_Z } from "./turbines";
import { tilesAround as runwayTilesAround } from "../world/runways";
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
 * holds with the camera anywhere in the disc — its half-side (SPAN; 8 at a far reach from FINE_Z to ZG1, the IGN's
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
    // (the reach's span from FINE_Z up — the IGN's z 15–17 too since T8k, 6a3cd640: earth-tiles.ts levelSpan —; a zone kept
    // to 4 there missed the tiles a far reach's 8-tile windows ask, flown offline)
    const span = z >= FINE_Z ? fineSpan : SPAN;
    level(z, span + 1.5, reliefs, z > ZG1, z <= profile.reliefZ1 ? radius : coreR);
  }
  // (the orthophotos' z 15–16 in 8-tile windows at a far reach — earth-tiles.ts ORTHO_BIG_LEVELS, T8e —, 4-tile ones else)
  for (let z = ORTHO_Z0; z <= top.orthoZ1; z++) {
    const span = z - ORTHO_Z0 < ORTHO_BIG_LEVELS && fineSpan > SPAN ? ORTHO_SPAN_BIG : ORTHO_SPAN;
    level(z, span + 0.5, ortho, true, z <= profile.orthoZ1 ? radius : coreR);
  }
  return { relief: reliefs, ortho };
}

/**
 * The zones' set of sources, its version: a zone downloaded under an older one lacks the data added since — kept "ready" (what
 * it holds still serves), told "to update" in Settings › Offline (its Update fetches what it lacks). 1: before 6 Nov 2026;
 * 2: Terrarium its own chain under the national reliefs (the game draws every tile from it first), the night's street tiles
 * (NU1), Overture's infrastructure (turbines, pylons), the USA's and the world's Mapterhorn relief, the USGS's imagery to z 16,
 * the world's runways round the zone.
 */
export const ZONE_SCHEMA = 2;

/** the world's runways' files as the game asks them (world/runways.ts: relative to the page — the Service Worker's scope) */
export const RUNWAYS_PATH = "runways/v1/";
/** how far round a zone the runways' tiles are held [m]: the ILS's search (controller/ils.ts, 150 km), the METAR's nearest
 *  station (metar.ts, 150 km) — the 3D runways' 25 km and the sites' within it */
export const RUNWAYS_REACH_M = 150_000;
/**
 * A zone's runways (PLAN-RADAR-AAA RD10: OurAirports' 5° × 5° tiles): the index, then each tile within RUNWAYS_REACH_M of the
 * disc — a key the index lacks answers a 404, kept as none. Offline they had failed — the tiles' own cache emptied, no zone
 * holding them —, the runway undrawn, the ILS without a field (zones-usa-night, 10 Nov 2026).
 */
export function runwayZoneChains(lat: number, lon: number, radius: number): ZoneChain[] {
  const out: ZoneChain[] = [[`${RUNWAYS_PATH}index.json`]];
  for (const k of runwayTilesAround(lat, lon, radius + RUNWAYS_REACH_M)) out.push([`${RUNWAYS_PATH}t${k}.json`]);
  return out;
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
    // (the surface's — the overground's, at 512² below z 13 — its own chain; the ground's its own, Terrarium its own too: the game
    // draws every tile from Terrarium first and refines it after — earth-tiles.ts load —, a zone that held Terrarium only where
    // the survey fell short failed its tiles offline under the IGN, the USA, Mapterhorn; and a Mapterhorn tile's sea, its zeros,
    // is filled from it — a WebP the zone cannot read for holes. The streaming analysis, 6 Nov 2026)
    const surface = urls.filter((u) => u.includes("_MNS") || u.includes(".MNS"));
    const ground = urls.filter((u) => !surface.includes(u));
    if (ground.length) out.push(ground);
    out.push([terrarium]);
    if (surface.length) out.push(surface);
  } else out.push([terrarium]);
  if (z <= IMG_Z1) {
    if (z > GIBS_Z1) out.push(o.ortho && src?.orthoUrl ? [src.orthoUrl(z, x, y), eoxUrl(z, x, y)] : [eoxUrl(z, x, y)]);
    else out.push([dayUrl(z, x, y)]);
    const night = nightOf(z, x, y);
    out.push([nightUrl(night.z, night.x, night.y)]);
    // (NU1: the street levels' lights — OpenFreeMap's vector tile, z 13 at most, a z 14 tile's its parent's — for the zone's
    // nights too)
    if (z >= ROAD_Z0) {
      const rk = Math.max(z - ROAD_MVT_Z1, 0);
      out.push([roadsUrl(z - rk, x >> rk, y >> rk)]);
    }
  }
  return out;
}
/** every URL a relief's tile may fetch (its chains' links, all of them) */
export const reliefUrls = (z: number, x: number, y: number, o: ZoneSources): string[] => reliefChains(z, x, y, o).flat();
/** an orthophotos' tile's URL (its national source's) */
export function orthoUrls(z: number, x: number, y: number): string[] {
  const src = tileSource(NATIONAL, 2 ** z, x, y);
  // (none past its finest level — the USGS's z 16 —: the game asks none there)
  return src?.orthoUrl && z <= (src.orthoZ1 ?? 99) ? [src.orthoUrl(z, x, y)] : [];
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
  const under = { ign: false, swisstopo: false, usa: false, other: false };
  for (let dy = -rc; dy <= rc; dy += step)
    for (let dx = -rc; dx <= rc; dx += step) {
      if (dx * dx + dy * dy > rc * rc) continue;
      const v = surveyOf({ lat: lat + dy / ky, lon: lon + dx / kx, ign });
      under[v ?? "other"] = true;
      if (v === "swisstopo" || v === "usa") under.other = true;
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
  // (the USA's ground under the scenery — lot D —: Mapterhorn's tiles of USA_GROUND_Z over the scenes' box and its reach)
  if (under.usa) {
    const z = USA_GROUND_Z,
      nT = 2 ** z,
      padLat = reach / 111_195,
      padLon = reach / (111_195 * Math.max(Math.cos(edge * DEG), 0.12));
    const tx = (lo: number) => Math.floor(((lo + 180) / 360) * nT),
      ty = (la: number) => Math.floor(((1 - Math.asinh(Math.tan(la * DEG)) / Math.PI) / 2) * nT);
    for (let y = ty(lat + dLat + padLat); y <= ty(lat - dLat - padLat); y++)
      for (let x = tx(lon - dLon - padLon); x <= tx(lon + dLon + padLon); x++) out.push([mapterhornUrl(z, x, y)]);
  }
  // (Overture's buildings where a centre is not the BD TOPO's: its listing, its tiles near the centres — pseudo-URLs whose
  // byte ranges the Service Worker resolves and keeps)
  if (s.overture && under.other) {
    out.push([OVERTURE_LIST]);
    for (const t of tilesWithin(OVERTURE_Z, lat, lon, rc + OVERTURE_REACH_M + slack)) out.push([overtureZoneUrl(t.x, t.y)]);
  }
  // (Overture's infrastructure — the wind turbines, the pylons and their lines: scenery-worker.ts infraTiles, its base theme at
  // z 13 —, every scene asks it within the turbines' reach of its centre, 15 km: some 80 tiles of ~3.7 km round a small zone,
  // a few MB — the pylons' 5 km alone left the farther ones to the network, 79 requests on a flight at JFK; its listing too)
  out.push([OVERTURE_LIST]);
  for (const t of tilesWithin(TURBINE_Z, lat, lon, rc + TURBINE_REACH_M + slack)) out.push([overtureBaseZoneUrl(TURBINE_Z, t.x, t.y)]);
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
  // (the runways' round it — the airfields, the ILS —, whatever the sources)
  for (const chain of runwayZoneChains(lat, lon, radius)) add(chain);
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
              ? // (the night's street tiles at z 12–13 — NU1 —: 219 and 337 kB over Paris, 6 Nov 2026; the scenery's z 14 smaller)
                /\/planet\/latest\/1[23]\//.test(u)
                ? 250_000
                : 73_000
              : u.includes("/BDTOPO/")
                ? 135_000
                : // (Mapterhorn's 512² WebP heights — not measured in bulk, an estimate —; Overture's infrastructure tile, same)
                  u.includes("mapterhorn")
                  ? 200_000
                  : u.includes("kerr-overture-base")
                    ? 60_000
                    : // (a runways' tile: 8.5 kB on average, 184 kB at most — t6_-20, the eastern USA —, the index 15 kB)
                      u.startsWith(RUNWAYS_PATH)
                      ? 60_000
                      : 18_000;
/** a zone's size before it is fetched [bytes]: its chains' first links, a tenth of the fallbacks after them (the sea, a
 *  survey's gap) */
export function zoneEstimate(chains: readonly ZoneChain[]): number {
  let bytes = 0;
  for (const c of chains) for (let i = 0; i < c.length; i++) bytes += sizeOf(c[i]!) * (i ? 0.1 : 1);
  return bytes;
}
/** a zone's download time before it is fetched [s]: the Géoplateforme's chains — its WMS-R grids, its WMTS orthophotos, its
 *  BD TOPO, its canopy: one budget in sw.ts (GEOPF_PER_S, GEOPF_INFLIGHT) — ~4.6 a second (5 267 of them in ~1 140 s on kerr-mini,
 *  2026-11-11, Chamonix's airport-profile zone with its scenery: it was said 400 s, from the WMS-R's alone at 5 a second), the
 *  other tiles ~35 chains a second (4 190 chains in 2 min, 2026-10-23) — the two at once */
export function zoneDuration(chains: readonly ZoneChain[]): number {
  let geopf = 0;
  for (const c of chains) if (c[0]!.includes("data.geopf.fr")) geopf++;
  return Math.max((chains.length - geopf) / 35, geopf / 4.6);
}
