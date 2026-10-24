// The world scenery's sources (scenery-worker.ts): what a scene asks of the network, from its centre and its settings —
// the land cover's raster by fixed cells, OpenFreeMap's vector tiles, the global relief under its features; over France the
// IGN's survey (ign-canopy.ts) and buildings (bdtopo.ts), over Switzerland swisstopo's ground. The worker's fetches and the
// offline zones' (system/zones.ts sceneryZoneChains) from these very functions: a zone holds a scene's sources only if both
// ask the same URLs, to the character.

import { BDTOPO_Z, bdtopoUrl } from "./bdtopo";
import { tileUrl } from "./earth-tiles";
import { inIgnBox, surveyChains, tilesWithin } from "./ign-canopy";
import { SWISSTOPO, SWISS_GROUND_G, swissGroundTiles, swissTerrainUrl } from "./national";
import { D, type SceneryMode, wrapLon } from "./scenery-data";

/** A scene's box round its centre [°]: its radius [m] (its trees', its buildings'), its half-sides [°], its bounds
 *  [west, south, east, north] (the land cover's raster over them, the vector tiles under them). */
export function sceneryBox(lat: number, lon: number, mode: SceneryMode, reach: number) {
  const radius = (mode === "high" ? 3000 : 2000) * reach,
    span = (radius + 650) / 111320;
  const lonSpan = span / Math.max(Math.cos(lat * D), 0.12);
  const bounds: [number, number, number, number] = [lon - lonSpan, lat - span, lon + lonSpan, lat + span];
  return { radius, span, lonSpan, bounds };
}

// ---- the land cover (ESA WorldCover through Terrascope's WMS): by fixed cells — the same cell for every scene over it, a
// URL the caches and the zones can hold (a raster centred on each scene was a new request at each of its steps)
/** a cell's side [°] (7 × 4.6 km at 49°) */
export const COVER_CELL = 1 / 16;
/** its rows [px]: 8.1 µ° a pixel, ~9 m — WorldCover's 10 m */
export const COVER_ROWS = 768;
/** a row of cells' columns [px]: as many metres a pixel across as down */
export const coverWidth = (row: number) => Math.max(16, Math.round(COVER_ROWS * Math.cos((row + 0.5) * COVER_CELL * D)));
const COVER_LAYER = { map: "esa-worldcover-map-10m-2021-v2_map", rgb: "esa-worldcover-s2rgbnir-10m-2021-v2_tcc" };
/** a cell's image: its classes' colours (`rgb` false) or Sentinel-2's true colours; `col` counted from 180° W (wrapped) */
export function coverUrl(rgb: boolean, col: number, row: number) {
  const n = 360 / COVER_CELL,
    west = (((col % n) + n) % n) * COVER_CELL - 180,
    south = row * COVER_CELL;
  const query = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: rgb ? COVER_LAYER.rgb : COVER_LAYER.map,
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: [west, south, west + COVER_CELL, south + COVER_CELL].join(","),
    WIDTH: String(coverWidth(row)),
    HEIGHT: String(COVER_ROWS),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  });
  return `https://mapproxy.terrascope.be/mapproxy/service?${query}`;
}
/** the cells over a box [°]: their column (unwrapped: a box across the date line goes on past it), row, and box */
export function coverCells(bounds: readonly [number, number, number, number]) {
  const out: { col: number; row: number; west: number; south: number }[] = [];
  for (let row = Math.floor(bounds[1] / COVER_CELL); row <= Math.floor(bounds[3] / COVER_CELL); row++)
    for (let col = Math.floor((bounds[0] + 180) / COVER_CELL); col <= Math.floor((bounds[2] + 180) / COVER_CELL); col++)
      out.push({ col, row, west: col * COVER_CELL - 180, south: row * COVER_CELL });
  return out;
}

// ---- OpenFreeMap's vector tiles (z 14: the roads, the water, the airfields, OSM's buildings)
export const OSM_Z = 14;
export const osmUrl = (x: number, y: number) => {
  const n = 2 ** OSM_Z;
  return `https://tiles.openfreemap.org/planet/latest/${OSM_Z}/${((x % n) + n) % n}/${y}.pbf`;
};
const tx = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const ty = (lat: number, z: number) => ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * 2 ** z;
/** the vector tiles under a scene's box, the nearest first, at most 64 a unit of reach² (x unwrapped: the worker's
 *  geometry) */
export function osmTiles(lat: number, lon: number, bounds: readonly [number, number, number, number], reach: number) {
  const n = 2 ** OSM_Z,
    all: { x: number; y: number; d: number }[] = [];
  const cx = tx(lon, OSM_Z),
    cy = ty(lat, OSM_Z),
    m = (0.98 * 40075016 * Math.cos(lat * D)) / n;
  for (let y = Math.floor(ty(bounds[3], OSM_Z)); y <= Math.floor(ty(bounds[1], OSM_Z)); y++)
    for (let x = Math.floor(tx(bounds[0], OSM_Z)); x <= Math.floor(tx(bounds[2], OSM_Z)); x++)
      if (y >= 0 && y < n) all.push({ x, y, d: m * Math.hypot(Math.max(x - cx, 0, cx - x - 1), Math.max(y - cy, 0, cy - y - 1)) });
  all.sort((a, b) => a.d - b.d);
  const tiles = Math.ceil(64 * reach * reach);
  return { tiles: all.slice(0, tiles), limited: all.length > tiles };
}

// ---- the global relief under the features (Terrarium; the IGN's ground first over France)
/** its level: a tile at least 1.8 km wide at high latitudes (the root data's memory bounded) */
export const sceneryDemZoom = (lat: number) => Math.min(13, Math.max(6, Math.floor(Math.log2((40075016 * Math.cos(lat * D)) / 1800))));
/** a place's Terrarium tile at that level */
export function demTile(lat: number, lon: number, z: number) {
  return { x: Math.floor(tx(wrapLon(lon), z)), y: Math.floor(ty(lat, z)) };
}
/** the tiles a scene's features may stand on: under its vector tiles (a line's points run past the box) */
function demTiles(lat: number, bounds: readonly [number, number, number, number]): string[] {
  const z = sceneryDemZoom(lat),
    k = 2 ** (OSM_Z - z),
    out = new Set<string>();
  const n = 2 ** z;
  for (let y = Math.floor(ty(bounds[3], OSM_Z) / k) - 1; y <= Math.floor(ty(bounds[1], OSM_Z) / k) + 1; y++)
    for (let x = Math.floor(tx(bounds[0], OSM_Z) / k) - 1; x <= Math.floor(tx(bounds[2], OSM_Z) / k) + 1; x++)
      if (y >= 0 && y < n) out.add(tileUrl(z, ((x % n) + n) % n, y));
  return [...out];
}

/** what a scene asks for: its centre (sceneryCentre's), its settings */
export interface SceneryAsk {
  lat: number;
  lon: number;
  mode: SceneryMode;
  /** the land cover's true colours too (settings.earthSurface on) */
  satellite: boolean;
  /** DETAIL_REACH's */
  reach: number;
  /** the IGN's survey and buildings over France, swisstopo's ground over Switzerland (settings.earthIgnRelief) */
  ign: boolean;
}
/** the BD TOPO's tiles a scene asks (the nearest first, at most 256 a unit of reach²; fewer once its nearest buildings
 *  are in) */
export const bdtopoTiles = (lat: number, lon: number, radius: number, reach: number) =>
  tilesWithin(BDTOPO_Z, lat, lon, radius).slice(0, Math.ceil(256 * reach * reach));
/** whose survey a scene's centre is under: the IGN's, swisstopo's, none */
export const surveyOf = (q: { lat: number; lon: number; ign?: boolean }) =>
  !q.ign ? null : inIgnBox(q.lat, q.lon) ? "ign" : SWISSTOPO.holds(q.lat, q.lon) ? "swisstopo" : null;
/** the survey's reach round a scene's centre [m]: its forest's disc */
export const surveyReach = (radius: number) => radius + 250;

/**
 * Every fetch a scene may make, as chains (system/zones.ts ZoneChain: a link asked when the one before falls short): the
 * land cover's cells, the vector tiles, the relief under them, the IGN's or swisstopo's survey, the BD TOPO's buildings.
 * Its upper bound — the worker stops short of the farther BD TOPO tiles once its nearest buildings are in.
 */
export function sceneryChains(q: SceneryAsk): string[][] {
  if (q.mode === "off") return [];
  const { radius, bounds } = sceneryBox(q.lat, q.lon, q.mode, q.reach);
  const out: string[][] = [];
  for (const c of coverCells(bounds)) {
    out.push([coverUrl(false, c.col, c.row)]);
    if (q.satellite) out.push([coverUrl(true, c.col, c.row)]);
  }
  for (const t of osmTiles(q.lat, q.lon, bounds, q.reach).tiles) out.push([osmUrl(t.x, t.y)]);
  for (const u of demTiles(q.lat, bounds)) out.push([u]);
  const survey = surveyOf(q);
  if (survey === "ign") {
    out.push(...surveyChains(q.lat, q.lon, surveyReach(radius)));
    for (const t of bdtopoTiles(q.lat, q.lon, radius, q.reach)) out.push([bdtopoUrl(t.x, t.y)]);
  } else if (survey === "swisstopo")
    for (const [x, y] of swissGroundTiles(q.lat, q.lon, surveyReach(radius))) out.push([swissTerrainUrl(SWISS_GROUND_G, x, y)]);
  return out;
}
