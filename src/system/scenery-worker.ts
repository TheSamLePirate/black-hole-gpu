// Worldwide data preparation is isolated from the render loop. No complete COG download.
import { carsAlong, LANE_M, PIECE_M, ROAD_TRAFFIC, TRAFFIC_MAX, TRAFFIC_REACH_M, trafficRunwayMask } from "./traffic";
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { installNetActivity } from "./net-activity";
import type { Vec3 } from "../physics";
import { earthDetail, toHalf } from "../terrain";
import { gradeAt } from "../game/runway-grade";
import { geodeticToCart as cartOf, WGS84_A as RA, WGS84_F as RF } from "./ellipsoid";
import { forestFrame, forestVec4s, growForest } from "./forest";
import { BDTOPO_Z, bdtopoHeight, bdtopoStands, bdtopoUrl, clipRing, inBdtopoBox } from "./bdtopo";
import { CANOPY_NEAR, IgnLand, tilesWithin } from "./ign-canopy";
import {
  lineVolts,
  PYLON_MAX,
  PYLON_MIN_VOLTS,
  PYLON_REACH_M,
  type Pylon,
  pylonHeight,
  pylonMesh,
  pylonSpan,
  cableMesh,
  CABLE_REACH_M,
  CABLE_SPANS_MAX,
} from "./pylons";
import { fetchRange, OVERTURE_BUCKET, OVERTURE_LIST, OVERTURE_Z, overtureReleases, overtureUrl, PmTiles } from "./pmtiles";
import {
  overtureBaseUrl,
  TURBINE_MAX,
  TURBINE_REACH_M,
  TURBINE_Z,
  type Turbine,
  type TurbineMesh,
  turbineMesh,
  turbineOf,
} from "./turbines";
import { SwissGround } from "./national";
import { MapterhornGround } from "./usa-ground";
import {
  bdtopoTiles as bdtopoWanted,
  COVER_CELL,
  COVER_ROWS,
  coverCells,
  coverUrl,
  coverWidth,
  demTile,
  OVERTURE_REACH_M,
  STACKS_M,
  osmTiles,
  osmUrl,
  sceneryBox,
  sceneryDemZoom,
  surveyOf,
  surveyReach,
} from "./scenery-sources";
import {
  makeDecals,
  roadWidth,
  ROW_ORCHARD,
  ROW_VINE,
  surfaceSegment,
  polygonPrimitive,
  stripPolygon,
  surfaceContains,
} from "./scenery-geometry";
import { forestCacheUrl, FOREST_CACHE } from "./forest-cells";
import { preparedForest } from "./forest-assembly";
import { cellOf, cellOrigin, fromCell } from "./building-cells";
import { parkedKind } from "./car-shapes";
import {
  type BridgeRecord,
  BridgeFlag,
  BridgeKind,
  CellStreetFlag,
  PIER_MIN_M,
  readBridges,
  streetCellComplete,
  VIADUCT_M,
  FurnitureFlag,
  FurnitureKind,
  type FurnitureRecord,
  PlaceFlag,
  readFurniture,
  readPlace,
  readStreetHeader,
  STREET_CACHE,
  streetCacheUrl,
} from "./street-cells";
import { bridgeCanonicalKey, clipLineToTile, fillHeights, type GeoBridge, joinBridgeHalves, joinDeckPieces } from "./bridge-ports";
import { BridgeContinuousProfile, SupportSurfaceRegistry } from "./bridge-surface-service";
import { buildContinuousPierMesh, buildContinuousRailMesh, buildContinuousSliceMesh, computeSlicePlane, mitres } from "./bridge-mesh";
import { BRIDGE_SHARE, selectBridgeLOD } from "./bridge-lod";
import { NOTABLE_BRIDGES } from "./bridge-catalogue";
import { notableDeckAxis, notableParts } from "./bridge-notable";
import {
  ALEXANDRE_III,
  buildAlexandreIIIPylonsMesh,
  buildArchRibsMesh,
  classifyBridgeStructure,
  computeStructurePierLocations,
  lineUnderDeck,
} from "./bridge-structures";
import { isDeckRoad, markRoad, roadClassCode } from "./road-markings";
import { inferRoadSurface, type RoadSurface, roadSurfaceColour } from "./road-surface";
import { catenaryMasts, cellRoadSurfaces } from "./cell-roads";

/** (B3) a notable bridge built in the scene within this of the eye or the centre [m] — its towers seen from tens of kilometres */
export const NOTABLE_REACH_M = 45_000;
/** (review A5) a deck clears the trees under it where its intrados is within this of the ground [m] — a tree taller pokes through */
export const TREE_UNDER_DECK_M = 25;
/** (PLAN-J8 VB4) the parked cars kept round the scene's centre [m] and at most (the nearest places first) */
export const PARKED_REACH_M = 900;
export const PARKED_MAX = 2500;
/** (PLAN-J8 VB7) the junctions' furniture kept round the scene's centre [m] and at most (the nearest first) */
export const FURNITURE_REACH_M = 900;
export const FURNITURE_MAX = 4000;
/** (PLAN-J8 J8-RP RP2) the street cells whose roads the scene draws in place of OpenMapTiles' — within this of its centre [m] */
export const CELL_ROAD_REACH_M = 2500;
import { buildingMesh } from "./roof-mesh";
import { buildingLeaves, lidarRoof as measuredRoof, partMeshes, STACK_BYTES } from "./building-mesh-prep";
import { builtUp, LAMP_CLASSES, LAMP_MAX, LAMP_REACH_M, lampLight, lampMesh, lampShape, lampsAlong, type StreetLamp } from "./streetlamps";
import {
  partyEdges,
  planBuilding,
  type RoofInput,
  type RoofPart,
  type Pt,
  regionOf,
  overtureRoofMaterial,
  overtureShape,
  overtureWallMaterial,
  RoofMaterial,
  roofMaterial,
  WallMaterial,
  wallMaterial,
} from "./roofs";
import {
  type SceneryProgress,
  BUILDING_MESH_M,
  IGN_GATE_SW,
  BUILDING_PARTS_M,
  D,
  localPoint,
  packScenery,
  type SceneryCar,
  sceneryFrame,
  sceneryGrid,
  SCENERY_BYTES,
  wrapLon,
  sceneryExcluded,
  seed,
  DECK_PLANE,
  BRIDGE_PAINT,
  structCableTag,
  type Primitive,
  type SceneryRequest,
  type SceneryReply,
} from "./scenery-data";

// ---- (T8m) the worker kept from one scene to the next (system/scenery.ts), and its network's answers with it: a scene rebuilt
// as the craft flies on covers most of the last one's box and of its 15 km of infrastructure — its land cover's cells, its
// vector tiles, BD TOPO's, Overture's archives' ranges, the canopy's survey —; each scene fetched its ~52 MB again (a
// rebuild on a final at Toulon-Hyères: 27 s, 9 of them waiting for Overture's infrastructure tiles — 6 Nov 2026). The GET
// answers kept (their range with them), the least recently used dropped past FETCH_CACHE_BYTES.
// (192 MiB where the browser says 8 GB or more of memory, 96 MiB else — and where it says nothing, Safari's, an iPad's)
const FETCH_CACHE_BYTES =
  ((globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory ?? 4) >= 8 ? 192 * 1024 * 1024 : 96 * 1024 * 1024;
/** one answer at most this big kept */
const FETCH_CACHE_ONE = 24 * 1024 * 1024;
/** the BD TOPO's tiles loading at once in a scene (the Service Worker's budget orders them with the IGN's other requests) */
const BDTOPO_RUNNERS = 6;
const fetchCache = new Map<string, { status: number; headers: [string, string][]; body: ArrayBuffer }>();
let fetchCacheBytes = 0;
/** this worker's hits and misses (the scene's stats) */
export const fetchCacheStats = { hits: 0, misses: 0, hitBytes: 0 };
// (the network counted under the cache: its hits are no download — net-activity.ts)
installNetActivity("scenery");
const rawFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.method !== "GET") return rawFetch(input, init);
  const key = `${req.url}|${req.headers.get("range") ?? ""}`;
  const hit = fetchCache.get(key);
  if (hit) {
    fetchCache.delete(key);
    fetchCache.set(key, hit);
    fetchCacheStats.hits++;
    fetchCacheStats.hitBytes += hit.body.byteLength;
    return new Response(hit.body.slice(0), { status: hit.status, headers: hit.headers });
  }
  fetchCacheStats.misses++;
  const r = await rawFetch(input, init);
  if (r.status !== 200 && r.status !== 206) return r;
  const body = await r.arrayBuffer();
  const headers = [...r.headers.entries()];
  if (body.byteLength <= FETCH_CACHE_ONE) {
    fetchCache.set(key, { status: r.status, headers, body: body.slice(0) });
    fetchCacheBytes += body.byteLength;
    for (const [k, v] of fetchCache) {
      if (fetchCacheBytes <= FETCH_CACHE_BYTES) break;
      fetchCache.delete(k);
      fetchCacheBytes -= v.body.byteLength;
    }
  }
  return new Response(body, { status: r.status, headers });
}) as typeof fetch;

// ---- (the scenery's loading, Sam, 6 Nov 2026: « les détails, buildings se chargent lentement » — each re-centring re-planned
// every roof of its 32 000 buildings, 5–10 s of a 15–26 s scene, though two scenes in a row share three quarters of them)
// The buildings' roofs planned once — roofs.ts planBuilding, its simple plan and its parts' — kept by the building's identity
// (its first point, its rings' counts, its heights, its attributes, its party walls) relative to its first point: a next scene
// takes them moved to its own frame (a translation: the frames of two scenes a few km apart turn by hundredths of a degree —
// centimetres over a building).
type PlanKey = string;
const PLAN_CACHE_MAX = 80_000;
const planCache = new Map<PlanKey, { one?: RoofPart[]; parts?: RoofPart[] }>();
export const planCacheStats = { hits: 0, misses: 0 };
/** a building's identity for its plans: its footprint's geodetic points (to 1e-7°, ~1 cm — the same whatever the scene's
 *  frame: its local metres turn with it, two centimetres over a building between two scenes), its inputs */
function planKey(input: RoofInput, geo: { lat: number; lon: number }[][]): PlanKey {
  const rel = geo.map((r) => r.map((p) => `${Math.round(p.lat * 1e7)},${Math.round(p.lon * 1e7)}`).join(";")).join("|");
  return `${rel}#${input.height.toFixed(2)}#${input.top ?? ""}#${input.roof ?? ""}#${input.storeys ?? ""}#${input.roofMat ?? ""}#${input.wallMat ?? ""}#${input.usage ?? ""}#${input.nature ?? ""}#${input.light ?? ""}#${input.hint ?? ""}#${JSON.stringify(input.region)}#${input.seed}#${(input.party ?? []).map((p) => (p ? 1 : 0)).join("")}`;
}
/** plans moved by (dx, dy): their rings, their planes (z = a x + b y + c: c − a dx − b dy) */
function movePlans(plans: RoofPart[], dx: number, dy: number): RoofPart[] {
  return plans.map((p) => ({
    ...p,
    rings: p.rings.map((r) => r.map(([x, y]) => [x + dx, y + dy] as Pt)),
    planes: p.planes.map(([a, b, c]) => [a, b, c - a * dx - b * dy] as [number, number, number]),
    blind: p.blind ? [...p.blind] : undefined,
  }));
}
/** a building's plans — `maxParts` 1: its simple plan, else its parts' — from the cache, else planned and kept */
function plansOf(input: RoofInput, maxParts: number, geo: { lat: number; lon: number }[][]): RoofPart[] {
  const key = planKey(input, geo);
  const which = maxParts === 1 ? "one" : "parts";
  const [ax, ay] = input.rings[0]![0]!;
  const hit = planCache.get(key);
  if (hit?.[which]) {
    planCacheStats.hits++;
    planCache.delete(key);
    planCache.set(key, hit);
    return movePlans(hit[which]!, ax, ay);
  }
  planCacheStats.misses++;
  const plans = planBuilding(input, maxParts);
  const e = hit ?? {};
  e[which] = movePlans(plans, -ax, -ay);
  planCache.set(key, e);
  if (planCache.size > PLAN_CACHE_MAX) planCache.delete(planCache.keys().next().value!);
  return plans;
}

/** the water polygons of a river's kind (OpenMapTiles' water class): drawn in a river's style, not a lake's */
const RIVER_CLASSES = new Set(["river", "canal", "stream", "ditch", "drain"]);
/** their colour — its blue under 0.05: trace.wgsl sceneryWaterAt tells a river by it */
const RIVER_COLOUR = [0.02, 0.05, 0.04];
/** the sea's polygons near the coast (class "ocean") — their blue under 0.035: the sea's style, not a lake's */
const OCEAN_COLOUR = [0.018, 0.05, 0.03];

const g = globalThis as unknown as { onmessage: unknown; postMessage(v: SceneryReply, t?: Transferable[]): void };
const tx = (lon: number, z = 14) => ((lon + 180) / 360) * 2 ** z;
const ty = (lat: number, z = 14) => ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * 2 ** z;

/** a scene's network request's time [ms] — each its own */
const FETCH_MS = 25_000;

async function prepare(q: SceneryRequest): Promise<SceneryReply> {
  // (each request its own time — FETCH_MS —, not one deadline from the scene's start: the ground's Terrarium tiles asked
  // late, under a survey's block that failed, failed at once past it, "signal timed out", the scene degraded and built again)
  const started = performance.now();
  // (the scene given up — the page's cancel —: its fetches in flight aborted, the later ones refused at once, not sent; they had
  // gone on to their end and their retries — a first scene's IGN survey at Le Bourget still asked during a flight at JFK, its
  // Overture under the starting orbit: zones-usa-night, 10 Nov 2026; ANALYSE-STREAMING ST2)
  const gone = new AbortController();
  aborts.set(q.id, gone);
  if (cancelled.has(q.id)) gone.abort();
  const live = (s: AbortSignal) => AbortSignal.any([gone.signal, s]);
  // (where the time goes — each step's end from the start [ms]: the scene's stats, T8)
  const phases: Record<string, number> = {};
  // (and the step under way told as it goes — the loading status in the interface: what the scenery waits for)
  const tell = (p: SceneryProgress) => g.postMessage({ id: q.id, lat: q.lat, lon: q.lon, progress: p });
  const next: Record<string, SceneryProgress["step"]> = {
    cover: "osm",
    osm: "buildings",
    bdtopo: "forest",
    overture: "forest",
    forest: "pack",
  };
  const planHits0 = planCacheStats.hits,
    planMisses0 = planCacheStats.misses;
  const phase = (name: string) => {
    if (cancelled.has(q.id)) throw new Error("cancelled");
    phases[name] = Math.round(performance.now() - started);
    const n = next[name];
    if (n) tell({ step: n });
  };
  tell({ step: "cover" });
  // (the detail's reach: the box, its raster — ~10 m a pixel kept —, its budgets this many times the normal ones)
  // (a quick first scene: its box a share of the reach's — the buffer's budget the full one's)
  const k = (q.reach ?? 1) * (q.quick ?? 1),
    k2 = k * k,
    N = sceneryGrid(k),
    budget = q.budget ?? SCENERY_BYTES,
    room = budget / SCENERY_BYTES;
  const { radius, bounds } = sceneryBox(q.lat, q.lon, q.mode, k);
  const frame = sceneryFrame(q.lat, q.lon),
    pixels = new Uint32Array(N * N),
    classes = new Uint8Array(N * N);
  let networkBytes = 0,
    rgbPixels = 0;
  // (the responses an offline zone served — the Service Worker marks them —, and the others)
  const served = { zone: 0, other: 0 };
  const count = (r: Response) => {
    if (r.headers.get("x-kerr-zone") === "1") served.zone++;
    else served.other++;
  };
  const errors: string[] = [];
  const fetchCount = async (url: string, within: AbortSignal = AbortSignal.timeout(FETCH_MS)) => {
    const r = await fetch(url, { signal: live(within) });
    count(r);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
    const b = await r.arrayBuffer();
    networkBytes += b.byteLength;
    return b;
  };
  const index = (lat: number, lon: number) => {
    const x = Math.floor(((lon - bounds[0]) / (bounds[2] - bounds[0])) * N),
      y = Math.floor(((bounds[3] - lat) / (bounds[3] - bounds[1])) * N);
    return x >= 0 && x < N && y >= 0 && y < N ? y * N + x : -1;
  };
  // Official CORS-enabled WMS, already colour-rendered: this is visual guidance, not scientific classification.
  const palette = [
    [10, 0, 100, 0],
    [20, 255, 187, 34],
    [30, 255, 255, 76],
    [40, 240, 150, 255],
    [50, 250, 0, 0],
    [60, 180, 180, 180],
    [70, 240, 240, 240],
    [80, 0, 100, 200],
    [90, 0, 150, 160],
    [95, 0, 207, 117],
    [100, 250, 230, 160],
  ];
  // (the land cover's fixed cells — scenery-sources.ts — drawn over the scene's box, nearest pixel: its classes' colours
  // kept exact; a cell failed left transparent, the scene's error said)
  async function raster(rgb: boolean) {
    try {
      const canvas = new OffscreenCanvas(N, N),
        ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false;
      const sx = N / (bounds[2] - bounds[0]),
        sy = N / (bounds[3] - bounds[1]);
      const cells = coverCells(bounds);
      let next = 0,
        failed: unknown = null;
      const run = async () => {
        while (next < cells.length) {
          const c = cells[next++]!;
          try {
            const bytes = await fetchCount(coverUrl(rgb, c.col, c.row));
            const image = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
            if (image.width !== coverWidth(c.row) || image.height !== COVER_ROWS) throw new Error(`cell ${image.width}×${image.height}`);
            ctx.drawImage(image, (c.west - bounds[0]) * sx, (bounds[3] - c.south - COVER_CELL) * sy, COVER_CELL * sx, COVER_CELL * sy);
            image.close();
          } catch (e) {
            failed ??= e;
          }
        }
      };
      await Promise.all(Array.from({ length: 6 }, run));
      if (failed) errors.push(String(failed).slice(0, 220));
      const data = ctx.getImageData(0, 0, N, N).data;
      for (let i = 0; i < N * N; i++) {
        const r = data[i * 4]!,
          g0 = data[i * 4 + 1]!,
          b = data[i * 4 + 2]!;
        if (data[i * 4 + 3]! < 200) continue;
        if (rgb) {
          pixels[i] = (pixels[i]! & 0xff000000) | r | (g0 << 8) | (b << 16);
          rgbPixels++;
        } else {
          let distance = Infinity,
            cls = 0;
          for (const c of palette) {
            const d = (r - c[1]!) ** 2 + (g0 - c[2]!) ** 2 + (b - c[3]!) ** 2;
            if (d < distance) {
              distance = d;
              cls = c[0]!;
            }
          }
          if (distance < 1600) {
            classes[i] = cls;
            pixels[i] = (pixels[i]! & 0xffffff) | (cls << 24);
          }
        }
      }
    } catch (e) {
      errors.push(String(e).slice(0, 220));
    }
  }
  // (over France, the IGN's survey — I4 —: its canopy and its ground over the forest's disc, fetched beside the land cover
  // within its own time — the blocks late past it left to the land cover —, the scene's sources not held back by it)
  const surveyed = live(AbortSignal.timeout(45_000));
  const fetchSurvey = async (url: string) => {
    const r = await fetch(url, { signal: surveyed });
    count(r);
    if (!r.ok) throw new Error(`HTTP ${r.status} (${(await r.text()).replace(/\s+/g, " ").slice(0, 160)}): ${url}`);
    const b = await r.arrayBuffer();
    networkBytes += b.byteLength;
    return b;
  };
  // (over Switzerland, swisstopo's ground under the trees and the buildings — I7 —, its canopy none: the land cover's)
  const survey = surveyOf(q);
  // (and over the USA, Mapterhorn's 3DEP ground — lot D —, the tracer's own there: the feet not on Terrarium's 10–30 m)
  const land: IgnLand | SwissGround | MapterhornGround | null =
    survey === "ign"
      ? new IgnLand(fetchSurvey, q.swGate ? IGN_GATE_SW : undefined)
      : survey === "swisstopo"
        ? new SwissGround(fetchSurvey)
        : survey === "usa"
          ? new MapterhornGround(fetchSurvey)
          : null;
  const landReady = land?.prepare(q.lat, q.lon, surveyReach(radius));
  await raster(false);
  if (q.satellite) await raster(true);
  phase("cover");
  // Keep each DEM tile at least 1.8 km wide at high latitudes, bounding root-data memory.
  const demZoom = sceneryDemZoom(q.lat);
  const heights = new Map<string, Promise<Uint8ClampedArray>>();
  // (the sea's surface over the ellipsoid — the geoid's plane round the centre —: the ground as the tracer has it)
  const [n0, nLat, nLon] = q.geoid ?? [0, 0, 0];
  const sea = (lat: number, lon: number) => n0 + nLat * (lat - q.lat) + nLon * wrapLon(lon - q.lon);
  // (the runways near — game/runway-grade.ts, the gear's and the tracer's calculation —: their airfields levelled, the detail off there and
  // under their approaches' funnels — PLAN-J7 J7-1: a tree on a bump the ground no longer has would float)
  const runways = q.runways ?? [];
  const graded = (lat: number, lon: number) => (runways.length ? gradeAt(cartOf(RA, RF, lat * D, lon * D, 0), runways) : null);
  // (a survey's ground — the IGN's, swisstopo's, 3DEP's: data, no detail added —: an airfield's level alone)
  const levelled = (h: number, lat: number, lon: number) => {
    const g = graded(lat, lon);
    return g && g.level > 0 ? h + (g.elev - h) * g.level : h;
  };
  // (the heights at hand without waiting — the IGN's ground once its survey is in, a Terrarium tile once decoded —: the forest's
  // ~700 000 nodes and the 32 000 buildings' feet read at once, not each through a promise)
  let landDone = !land;
  void landReady?.then(
    () => void (landDone = true),
    () => void (landDone = true),
  );
  const resolved = new Map<string, Uint8ClampedArray>();
  const terrariumAt = (px: Uint8ClampedArray, lat: number, lon: number) => {
    const xx = tx(wrapLon(lon), demZoom),
      yy = ty(lat, demZoom),
      { x, y } = demTile(lat, lon, demZoom);
    const fx = (xx - x) * 256 - 0.5,
      fy = (yy - y) * 256 - 0.5;
    const weights = (t: number) => [
      (1 - t) ** 3 / 6,
      (4 - 6 * t * t + 3 * t * t * t) / 6,
      (1 + 3 * t + 3 * t * t - 3 * t * t * t) / 6,
      (t * t * t) / 6,
    ];
    const wx = weights(fx - Math.floor(fx)),
      wy = weights(fy - Math.floor(fy));
    let h0 = 0;
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) {
        const ix = Math.min(255, Math.max(0, Math.floor(fx) + k - 1)),
          iy = Math.min(255, Math.max(0, Math.floor(fy) + j - 1)),
          i = (iy * 256 + ix) * 4;
        h0 += wx[k]! * wy[j]! * toHalf(px[i]! * 256 + px[i + 1]! + px[i + 2]! / 256 - 32768);
      }
    // Match the terrain's filtered DEM plus its existing fine relief; otherwise short buildings vanish under it.
    const a = lat * D,
      b = lon * D,
      res = Math.max(25, (40075016 * Math.cos(a)) / (2 ** demZoom * 256));
    const g = graded(lat, lon);
    if (g && g.level > 0) h0 += (g.elev - h0) * g.level;
    const cut = g ? g.cut : 0;
    const detail = cut < 1 ? (1 - cut) * earthDetail([Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)], h0, 0.5, res) : 0;
    return Math.max(0, h0 + detail) + sea(lat, lon);
  };
  const heightNow = (lat: number, lon: number): number | undefined => {
    if (land) {
      if (!landDone) return undefined;
      const h = land.ground(lat, lon);
      if (Number.isFinite(h)) return Math.max(0, levelled(h, lat, lon)) + sea(lat, lon);
    }
    const { x, y } = demTile(lat, lon, demZoom);
    const px = resolved.get(`${x}/${y}`);
    return px ? terrariumAt(px, lat, lon) : undefined;
  };
  const height = async (lat: number, lon: number) => {
    const now = heightNow(lat, lon);
    if (now !== undefined) return now;
    // (the IGN's ground where it has one: the tracer's over France since I2 — its normal heights over the sea's surface)
    if (land) {
      await landReady;
      const h = land.ground(lat, lon);
      if (Number.isFinite(h)) return Math.max(0, levelled(h, lat, lon)) + sea(lat, lon);
    }
    const { x, y } = demTile(lat, lon, demZoom),
      key = `${x}/${y}`;
    let p = heights.get(key);
    if (!p) {
      p = fetchCount(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${demZoom}/${key}.png`).then(async (b) => {
        const im = await createImageBitmap(new Blob([b]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const c = new OffscreenCanvas(256, 256),
          ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(im, 0, 0);
        im.close();
        const px = ctx.getImageData(0, 0, 256, 256).data;
        resolved.set(key, px);
        return px;
      });
      heights.set(key, p);
    }
    return terrariumAt(await p, lat, lon);
  };
  const excluded = (lat: number, lon: number) => sceneryExcluded(lat, lon, q.exclusions);
  const prims: Primitive[] = [];
  // (the forest's grid: its bytes held from the start — the networks' and buildings' budgets after it)
  const reach = radius + 250;
  const ff = forestFrame(q.lat, q.lon, reach, (lat, lon) => localPoint(frame, lat, lon, 0));
  // (PLAN-J8 J8-8b: the forest's prepared cells under the frame read now, beside the data — lot 3: all of them there, the BD TOPO's
  // buildings not fetched at all (with meshCells they only kept the trees off their footprints, the cells' words have that))
  let preparedError = "";
  const preparedP: Promise<Awaited<ReturnType<typeof preparedForest>>> =
    q.forestPrepared && typeof caches !== "undefined"
      ? (async () => {
          const store = await caches.open(FOREST_CACHE);
          // (the cache's keys read once for the scene — a keys() or match() with ignoreSearch per cell walks the whole cache: Paris's
          // 272 cells against its 869 took the M1 Max's full scene from ~25 s to 61 s, 17 Nov 2026), each cell's best kept: any
          // generation, the newest, the canopy's first (cell-workers.ts forestStore)
          const rank = (r: Request) => {
            const s = new URL(r.url).searchParams;
            return Number(s.get("c") ?? 0) * 1e9 + Number(s.get("g") ?? 0);
          };
          const best = new Map<string, Request>();
          for (const r of await store.keys()) {
            const path = new URL(r.url).pathname;
            const had = best.get(path);
            if (!had || rank(r) > rank(had)) best.set(path, r);
          }
          return preparedForest(
            ff,
            async (x, y) => {
              const key = best.get(new URL(forestCacheUrl(self.location.origin, x, y, 0, false)).pathname);
              const r = key ? await store.match(key) : undefined;
              return r ? await r.arrayBuffer() : null;
            },
            land instanceof IgnLand,
          );
        })().catch((e) => {
          preparedError = String(e).slice(0, 200);
          return null;
        })
      : Promise.resolve(null);
  // (lot 3: the prepared cells cover the planting disc, even when the frame's corners have no cells)
  const forestWhole = preparedP.then((p) => p?.complete ?? false);
  // (Q8 D1: the main roads' segments for the traffic, and the cars on them)
  const roadLines: {
    segs: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }[];
    cls: string;
    oneway: number;
    /** (PLAN-J8 J8-RP RP6) on a bridge: its cars on the deck (deckHeightAt) */
    bridge?: boolean;
    layer?: number;
  }[] = [];
  // (Q8 D1: the vineyards' and orchards' polygons, for the decals alone)
  const rowCrops: Primitive[] = [];
  // (Q8 L10: the town streets' runs near, the lamps set along them at the end)
  const lampLines: {
    xy: [number, number][];
    geo: { lat: number; lon: number }[];
    cls: string;
    width: number;
    /** (PLAN-J8 J8-RP RP6) on a bridge: its lamps on the deck */
    bridge?: boolean;
    layer?: number;
  }[] = [];
  let lamps: StreetLamp[] = [];
  let lampGrid: Uint8Array | undefined;
  const cars: SceneryCar[] = [];
  let pieceCount = 0;
  // (PLAN-J8 J8-L: the reach round the frame's centre within which the scene keeps its own lamps and cars — shorter where their caps
  // cut, 0 where it has none (a failure, the lamps not asked): the far layer's (street-far.ts) left out within it, no double, no gap)
  let lampReachM = 0,
    trafficReachM = 0;
  let storedBytes = 64 + pixels.byteLength + forestVec4s(ff) * 16,
    budgetLimited = false;
  let trees = 0,
    buildings = 0,
    vertices = 0;
  let bridges = 0,
    bridgePiers = 0,
    notableBridges = 0;
  /** (B3) the notable bridges' cables (packScenery's structCables) */
  const structCables: { positions: number[]; triangles: number[]; tag: number }[] = [];
  const surfaces: Primitive[] = [];
  /** (B1) OpenMapTiles' road segments' surface material, until markRoad packs it */
  const omtMaterial = new Map<Primitive, RoadSurface>();
  const bridgeLines: {
    line: { lat: number; lon: number }[];
    width: number;
    layer: number;
    d: number;
    water: boolean;
    rail?: boolean;
    foot?: boolean;
    /** BridgeFlag.OpenA / OpenB: an end cut by the tile's square (review A1) */
    flags: number;
  }[] = [];
  const bridgeAreas: { rings: { lat: number; lon: number }[][]; footprint: Primitive; layer: number; d: number }[] = [];
  const osmLayers: NonNullable<SceneryReply["osmLayers"]> = {};
  const surfaceDistance = (p: Primitive) => Math.hypot(Math.max(p.min[0], 0, -p.max[0]), Math.max(p.min[1], 0, -p.max[1]));
  // All source layers/fields remain inspectable in telemetry. Only physical geometry is rendered.
  const readNetworks = (layers: VectorTile["layers"], x: number, y: number) => {
    for (const [name, l] of Object.entries(layers)) {
      const entry = (osmLayers[name] ??= { features: 0, fields: [] });
      entry.features += l.length;
      const fields = new Set(entry.fields);
      for (let i = 0; i < l.length; i++) for (const field of Object.keys(l.feature(i).properties)) fields.add(field);
      entry.fields = [...fields].sort();
    }
    // (Q8 D1: the vineyards and orchards — OpenMapTiles' landcover, subclass vineyard / orchard —: their polygons for the decals
    // alone, drawn as rows along their longest edge — trace.wgsl rowCrop —, not painted, not in the surfaces' tree)
    const lc = layers.landcover;
    if (lc)
      for (let i = 0; i < lc.length; i++) {
        const f = lc.feature(i);
        const sub = String(f.properties.subclass ?? "");
        if (f.type !== 3 || (sub !== "vineyard" && sub !== "orchard")) continue;
        const e = f.extent;
        const point = (v: { x: number; y: number }) => {
          const lon = ((x + v.x / e) / 2 ** 14) * 360 - 180,
            lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / 2 ** 14))) / D;
          return localPoint(frame, lat, lon, 0);
        };
        for (const rings of classifyRings(f.loadGeometry())) {
          if (rings.reduce((sum, r) => sum + r.length, 0) > 4096) continue;
          const locals = rings.map((r) => r.map(point));
          // (the rows along the outer ring's longest edge — a plot's are along its length)
          let best = 0,
            bear = 0;
          const outer = locals[0]!;
          for (let j = 0; j + 1 < outer.length; j++) {
            const dx = outer[j + 1]![0] - outer[j]![0],
              dy = outer[j + 1]![1] - outer[j]![1];
            const l = Math.hypot(dx, dy);
            if (l > best) [best, bear] = [l, Math.atan2(dy, dx)];
          }
          bear = (((bear % Math.PI) + Math.PI) % Math.PI) / Math.PI;
          const p = polygonPrimitive(locals, 0, 0, sub === "vineyard" ? ROW_VINE : ROW_ORCHARD, [0.5, 0.5, bear]);
          if (p && surfaceDistance(p) <= radius + 500) rowCrops.push(p);
        }
      }
    for (const name of ["water", "waterway", "transportation", "aeroway"]) {
      const l = layers[name];
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const f = l.feature(i),
          props = f.properties;
        if (props.brunnel === "tunnel" || props.indoor === 1 || Number(props.level) < 0) continue;
        const e = f.extent;
        const geo = (v: { x: number; y: number }) => ({
          lon: ((x + v.x / e) / 2 ** 14) * 360 - 180,
          lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / 2 ** 14))) / D,
        });
        const point = (v: { x: number; y: number }) => {
          const g0 = geo(v);
          return localPoint(frame, g0.lat, g0.lon, 0);
        };
        const cls = String(props.class ?? ""),
          subclass = String(props.subclass ?? "");
        const water = name === "water" || name === "waterway";
        // (OpenMapTiles' aeroway polygons: the pavements — runway, taxiway, apron, helipad, gate —, and the aerodrome's or
        // heliport's whole outline, which is not one: painted paved, it took every blade of grass, every bush and the grass's
        // own material off an airfield's grass between its runways — VIPER B5, 5 Nov 2026)
        if (name === "aeroway" && (cls === "aerodrome" || cls === "heliport")) continue;
        if (f.type === 3 && (name === "water" || name === "aeroway" || name === "transportation")) {
          for (const rings of classifyRings(f.loadGeometry())) {
            const total = rings.reduce((sum, r) => sum + r.length, 0);
            if (total > 4096) {
              budgetLimited = true;
              continue;
            }
            const p = polygonPrimitive(
              rings.map((r) => r.map(point)),
              0,
              0,
              water ? 4 : 5,
              // (a river's polygon — OpenMapTiles' class — told from a lake's by its colour's blue: trace.wgsl sceneryWaterAt —
              // the material's inland water, a river's style or a lake's)
              water
                ? cls === "ocean"
                  ? OCEAN_COLOUR
                  : RIVER_CLASSES.has(cls)
                    ? RIVER_COLOUR
                    : [0.018, 0.052, 0.055]
                : [0.12, 0.12, 0.115],
            );
            if (p && surfaceDistance(p) <= radius + 500) {
              if (props.brunnel === "bridge" || cls === "bridge") {
                const outer = rings[0]!;
                const cx = outer.reduce((sum, v) => sum + v.x, 0) / outer.length,
                  cy = outer.reduce((sum, v) => sum + v.y, 0) / outer.length;
                if (cx >= 0 && cx < e && cy >= 0 && cy < e)
                  bridgeAreas.push({
                    rings: rings.map((r) => r.map(geo)),
                    footprint: p,
                    layer: Math.max(1, Math.min(5, Number(props.layer) || 1)),
                    d: surfaceDistance(p),
                  });
              } else surfaces.push(p);
            }
          }
        } else if (f.type === 2 && (name === "transportation" || name === "waterway")) {
          if (["ferry", "aerialway"].includes(cls)) continue;
          const rail =
            cls === "rail" ||
            cls === "transit" ||
            ["tram", "light_rail", "narrow_gauge", "monorail", "funicular", "preserved"].includes(subclass);
          const width = water
            ? cls === "river"
              ? 14
              : cls === "canal"
                ? 8
                : cls === "stream"
                  ? 3
                  : 1.5
            : roadWidth(rail ? "rail" : cls.replace("_construction", ""), subclass) * (props.ramp === 1 ? 0.65 : 1);
          // (B1: a road's surface material — OpenMapTiles' surface, its class, its place: road-surface.ts — and its colour)
          const material = inferRoadSurface({
            cls: cls.replace("_construction", ""),
            subclass,
            surface: String(props.surface ?? ""),
            lat: q.lat,
            lon: q.lon,
          });
          const color = water ? [0.018, 0.052, 0.055] : rail ? [0.1, 0.085, 0.06] : roadSurfaceColour(material);
          for (const line of f.loadGeometry()) {
            const locals = line.map(point);
            // (Q8 D1: a main road's segments — their middles in the tile — for the traffic, not on a bridge nor in a tunnel)
            if (!water && !rail && ROAD_TRAFFIC[cls] && props.brunnel !== "tunnel" && props.brunnel !== "ford") {
              const segs: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }[] = [];
              for (let j = 0; j < line.length - 1; j++) {
                const mx = (line[j]!.x + line[j + 1]!.x) / 2,
                  my = (line[j]!.y + line[j + 1]!.y) / 2;
                if (mx < 0 || mx >= e || my < 0 || my >= e) continue;
                if (Math.min(Math.hypot(locals[j]![0], locals[j]![1]), Math.hypot(locals[j + 1]![0], locals[j + 1]![1])) > TRAFFIC_REACH_M)
                  continue;
                segs.push({ a: geo(line[j]!), b: geo(line[j + 1]!) });
              }
              if (segs.length)
                roadLines.push({
                  segs,
                  cls,
                  oneway: Number(props.oneway) || 0,
                  bridge: props.brunnel === "bridge",
                  layer: Math.max(1, Number(props.layer) || 1),
                });
            }
            // (Q8 L10: a town street's runs — its consecutive segments with their middles in the tile, near — for the lamps)
            if (!water && !rail && LAMP_CLASSES[cls] && props.brunnel !== "tunnel" && props.brunnel !== "ford") {
              let run: (typeof lampLines)[number] | null = null;
              for (let j = 0; j < line.length - 1; j++) {
                const mx = (line[j]!.x + line[j + 1]!.x) / 2,
                  my = (line[j]!.y + line[j + 1]!.y) / 2;
                const inside =
                  mx >= 0 &&
                  mx < e &&
                  my >= 0 &&
                  my < e &&
                  Math.min(Math.hypot(locals[j]![0], locals[j]![1]), Math.hypot(locals[j + 1]![0], locals[j + 1]![1])) <=
                    LAMP_REACH_M + 100;
                if (!inside) {
                  run = null;
                  continue;
                }
                if (!run) {
                  run = {
                    xy: [[locals[j]![0], locals[j]![1]]],
                    geo: [geo(line[j]!)],
                    cls,
                    width,
                    bridge: props.brunnel === "bridge",
                    layer: Math.max(1, Number(props.layer) || 1),
                  };
                  lampLines.push(run);
                }
                run.xy.push([locals[j + 1]![0], locals[j + 1]![1]]);
                run.geo.push(geo(line[j + 1]!));
              }
            }
            if (props.brunnel === "bridge") {
              // (review A1: each tile's own part of the line — clipped to its square, the buffer's overhang its neighbour's —, its ends
              // open where the square cut it: joined to the neighbour's part before its profile — joinBridgeHalves)
              if (line.length < 512) {
                const foot = !water && !rail && (cls === "path" || cls === "pedestrian" || cls === "steps" || cls === "track");
                for (const part of clipLineToTile(line, e)) {
                  const d = Math.min(...part.points.map((v) => Math.hypot(point(v)[0], point(v)[1])));
                  if (d < radius + 250)
                    bridgeLines.push({
                      line: part.points.map(geo),
                      width,
                      layer: Math.max(1, Math.min(5, Number(props.layer) || 1)),
                      d,
                      water,
                      rail,
                      foot,
                      flags: (part.openA ? BridgeFlag.OpenA : 0) | (part.openB ? BridgeFlag.OpenB : 0),
                    });
                }
              }
              if (!water) continue; // Ground markings must not appear underneath a raised deck.
            }
            // (B2: the abscissa along the line — its dashes run on from one segment to the next)
            let along = 0;
            for (let j = 0; j < locals.length - 1; j++) {
              const a = locals[j]!,
                b = locals[j + 1]!,
                aa = line[j]!,
                bb = line[j + 1]!;
              const mx = (aa.x + bb.x) / 2,
                my = (aa.y + bb.y) / 2;
              const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
              const s0 = along;
              along += L;
              if (mx < 0 || mx >= e || my < 0 || my >= e || L < 0.1) continue;
              const p = surfaceSegment(a, b, width, water ? 3 : rail ? 2 : 1, color);
              // (PLAN-J8 VB2: a road's class and way kept for its markings — roadMarkings, once the town is known; B1 its material)
              if (!water && !rail) {
                p.data[6] = roadClassCode(cls);
                p.data[7] = Number(props.oneway) || 0;
                p.data[11] = -s0;
                omtMaterial.set(p, material);
              }
              if (surfaceDistance(p) <= radius + 500) surfaces.push(p);
            }
          }
        }
      }
    }
    if (surfaces.length > 48000 * k2) {
      surfaces.sort((a, b) => surfaceDistance(a) - surfaceDistance(b));
      surfaces.length = Math.round(48000 * k2);
      budgetLimited = true;
    }
  };
  // Buildings use actual OSM footprints, all rings including courtyard holes.
  const n = 2 ** 14;
  const osm = osmTiles(q.lat, q.lon, bounds, k);
  if (osm.limited) budgetLimited = true;
  const limit = Math.round((q.mode === "high" ? 8000 : 5000) * k2);
  // (what the data say of a building: its height — the BD TOPO's to the eave, OSM's to the top —, its roof's measured height,
  // its storeys and materials, its use; roofs.ts plans its roof from them)
  type Attr = {
    top: boolean;
    roof: number | null;
    storeys: number | null;
    roofMat: RoofMaterial;
    wallMat: WallMaterial;
    usage?: string;
    nature?: string;
    light?: boolean;
    colour?: unknown;
    /** the roof's colour and shape as the data name them (Overture's roof_color, roof_shape…) */
    roofColour?: unknown;
    hint?: RoofInput["hint"];
  };
  type Choice = { geo: { lat: number; lon: number }[][]; lat: number; lon: number; h: number; low: number; d: number; a: Attr };
  const choices: Choice[] = [];
  // (the buildings the cap — `limit`, the nearest the centre kept — left out: counted; their footprints kept
  // for the survey's trees alone — its canopy holds them too: without, a cut block's roofs drew a wood —, PROBLEMES 12 Nov 2026)
  const cut: Choice[] = [];
  let cutBuildings = 0,
    keptReachM = 0;
  let meshLeft = 0;
  const trim = () => {
    choices.sort((a, b) => a.d - b.d);
    if (choices.length <= limit) return;
    cutBuildings += choices.length - limit;
    for (let i = limit; i < choices.length; i++) cut.push(choices[i]!);
    choices.length = limit;
    keptReachM = Math.round(choices[limit - 1]!.d);
    budgetLimited = true;
  };
  const distance = (lat: number, lon: number) => Math.hypot((lat - q.lat) * 111320, wrapLon(lon - q.lon) * 111320 * Math.cos(q.lat * D));
  // (PLAN-J2 §9 undecies — Sam, 13 Nov 2026: the cap's distance to the corridor the craft flies, q.corridor — the segment from the eye
  // at the request, A, through the centre to −A, as far past it —, not to the centre alone: in flight over Paris the craft outran the
  // 2.5 km disc the 32 000 kept and none was in view. A craft at rest (A under 50 m): the centre's disc as before)
  const cosC = Math.cos(q.lat * D);
  const corridorA: [number, number] | null = (() => {
    if (!q.corridor || !q.eye) return null;
    const ax = wrapLon(q.eye[1] - q.lon) * 111320 * cosC,
      ay = (q.eye[0] - q.lat) * 111320;
    return Math.hypot(ax, ay) > 50 ? [ax, ay] : null;
  })();
  const corridorM = corridorA ? Math.round(Math.hypot(corridorA[0], corridorA[1])) : 0;
  const capDistance = (lat: number, lon: number) => {
    if (!corridorA) return distance(lat, lon);
    const px = wrapLon(lon - q.lon) * 111320 * cosC,
      py = (lat - q.lat) * 111320;
    const [ax, ay] = corridorA;
    const t = Math.min(Math.max((px * ax + py * ay) / (ax * ax + ay * ay), -1), 1);
    return Math.hypot(px - t * ax, py - t * ay);
  };
  // (a tile's distance to the corridor: the least of its rectangle's from 17 points along it — tilesWithin's own measure)
  const tileCorridorD = (z: number, x: number, y: number) => {
    const n = 2 ** z,
      m = (2 * Math.PI * 6378137 * cosC) / n;
    let best = Infinity;
    for (let i = 0; i <= 16; i++) {
      const s = i / 8 - 1;
      const lat = q.lat + (s * corridorA![1]) / 111320,
        lon = q.lon + (s * corridorA![0]) / (111320 * cosC);
      const fx = ((lon + 180) / 360) * n,
        fy = ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n;
      best = Math.min(best, m * Math.hypot(Math.max(x - fx, 0, fx - x - 1), Math.max(y - fy, 0, fy - y - 1)));
    }
    return best;
  };
  // ---- over France, the IGN's buildings (I5, bdtopo.ts): the BD TOPO's footprints and measured heights for OSM's, its z 15
  // tiles nearest first until the nearest `limit` buildings are in; OSM's kept only where a BD TOPO tile failed
  const bdKey = (lat: number, lon: number) => {
    const t = 2 ** BDTOPO_Z;
    return `${Math.floor(((lon + 180) / 360) * t)}/${Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * t)}`;
  };
  const surveyErrors: string[] = [];
  // (PLAN-J8 J8-RP RP2: the roads drawn from the street cells, and their cells)
  let cellRoadCount = 0,
    cellRoadCells = 0,
    cellBridgeCount = 0,
    catenaryCount = 0;
  const region = regionOf(q.lat, q.lon);
  const bdtopoTiles = async () => {
    const out: Choice[] = [],
      covered = new Set<string>();
    let tileCount = 0;
    // (the corridor's: the nearest it first, the stop judged against it — capDistance)
    const want = corridorA
      ? bdtopoWanted(q.lat, q.lon, radius, k)
          .map((w) => ({ ...w, d: tileCorridorD(BDTOPO_Z, w.x, w.y) }))
          .sort((p, r) => p.d - r.d)
      : bdtopoWanted(q.lat, q.lon, radius, k);
    const t = 2 ** BDTOPO_Z;
    const one = async (x: number, y: number) => {
      let raw: ArrayBuffer | null = null;
      for (let attempt = 0; attempt < 3 && !raw; attempt++)
        try {
          raw = await fetchCount(bdtopoUrl(x, y));
        } catch (e) {
          // (a tile failed: OSM's buildings there — the scene not degraded for it)
          if (attempt === 2) {
            if (surveyErrors.length < 4) surveyErrors.push(String(e).slice(0, 320));
          } else await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
        }
      if (!raw) return;
      covered.add(`${x}/${y}`);
      tileCount++;
      const layer = new VectorTile(new PbfReader(raw)).layers.batiment;
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        if (feature.type !== 3 || !bdtopoStands(feature.properties)) continue;
        const e = feature.extent,
          pr = feature.properties,
          h = bdtopoHeight(pr);
        // (the roof's measured height: its ridge less its eave, both over the sea — I5's `hauteur` is to the eave)
        const ridge = pr.altitude_maximale_toit,
          eave = pr.altitude_minimale_toit;
        const a: Attr = {
          top: false,
          roof: typeof ridge === "number" && typeof eave === "number" && ridge >= eave ? Math.min(30, ridge - eave) : null,
          storeys: typeof pr.nombre_d_etages === "number" && pr.nombre_d_etages > 0 ? pr.nombre_d_etages : null,
          roofMat: roofMaterial(pr.materiaux_de_la_toiture, region),
          wallMat: wallMaterial(pr.materiaux_des_murs),
          usage: typeof pr.usage_1 === "string" ? pr.usage_1 : undefined,
          nature: typeof pr.nature === "string" ? pr.nature : undefined,
          light: pr.construction_legere === true,
        };
        for (const rings of classifyRings(feature.loadGeometry())) {
          // (its part in this tile: the copy in the next one makes the rest)
          const clipped = rings.map((r) => clipRing(r, e));
          if (clipped[0]!.length < 4) continue;
          const geo = clipped
            .filter((r) => r.length >= 4)
            .map((r) =>
              r.map((v) => ({
                lon: ((x + v.x / e) / t) * 360 - 180,
                lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / t))) / D,
              })),
            );
          const outer = geo[0]!;
          // (a footprint of thousands of corners simplified within 256 — roofs.ts simplifyFootprint —, not left out)
          if (geo.reduce((s, r) => s + r.length, 0) > 8192) continue;
          const lat = outer.reduce((s, v) => s + v.lat, 0) / outer.length,
            lon = outer.reduce((s, v) => s + v.lon, 0) / outer.length;
          if (index(lat, lon) < 0 || excluded(lat, lon)) continue;
          out.push({ geo, lat, lon, h, low: 0, d: capDistance(lat, lon), a });
        }
      }
    };
    // (their count said at once: the indicator's "buildings 0/N" before the first batch is in)
    tell({ step: "buildings", done: 0, of: want.length });
    // (the network audit, 6 Nov 2026: BDTOPO_RUNNERS loads going on, each taking the next nearest tile as one ends — in
    // batches of 4 each waited for its slowest, the first scene of a cold final 37 s in this step)
    let next = 0,
      done = 0,
      enough = false;
    const runner = async () => {
      while (!enough && next < want.length) {
        // (enough: the nearest `limit` closer than every tile left — looked at every 4 tiles)
        if (out.length >= limit && next % 4 === 0) {
          out.sort((a, b) => a.d - b.d);
          if (out[limit - 1]!.d < want[next]!.d) {
            enough = true;
            break;
          }
        }
        const w = want[next++]!;
        await one(w.x, w.y);
        done++;
        tell({ step: "buildings", done, of: want.length });
      }
    };
    await Promise.all(Array.from({ length: BDTOPO_RUNNERS }, runner));
    return { out, covered, tileCount };
  };
  // (J8-8b lot 3: with the near buildings from their mesh cells and the forest whole from its cells, the BD TOPO's tiles serve nothing
  // here — not fetched, not decoded: null in the promise)
  let bdtopoSkipped = false;
  const bdtopo =
    survey === "ign"
      ? (q.meshCells ? forestWhole : Promise.resolve(false)).then((whole) => {
          bdtopoSkipped = whole;
          return whole ? null : bdtopoTiles();
        })
      : null;
  // ---- elsewhere, Overture Maps' buildings near the centre (B7, pmtiles.ts): OSM's with the ML footprints of Microsoft's
  // and Google's, their roofs' shapes, heights, colours and materials where mapped — a z 14 tile 0.5–1.6 MB, so within
  // OVERTURE_REACH_M alone; OSM's own buildings kept beyond, and where an Overture tile failed
  const fetchRanged = async (url: string, init: RequestInit) => {
    const r = await fetch(url, { ...init, signal: live(AbortSignal.timeout(FETCH_MS)) });
    count(r);
    networkBytes += Number(r.headers.get("content-length")) || 0;
    return r;
  };
  const overtureTiles = async () => {
    const out: Choice[] = [],
      covered = new Set<string>();
    let tileCount = 0;
    let pm: PmTiles | null = null;
    try {
      const list = await fetch(OVERTURE_LIST, { signal: live(AbortSignal.timeout(FETCH_MS)) });
      count(list);
      if (!list.ok) throw new Error(`HTTP ${list.status}: ${OVERTURE_LIST}`);
      // (the latest release whose archive answers: the bucket keeps three, the one a zone holds among them)
      for (const r of overtureReleases(await list.text())) {
        const p = new PmTiles(overtureUrl(r), fetchRange(fetchRanged));
        try {
          await p.header();
          pm = p;
          break;
        } catch (e) {
          if (surveyErrors.length < 4) surveyErrors.push(String(e).slice(0, 240));
        }
      }
    } catch (e) {
      if (surveyErrors.length < 4) surveyErrors.push(String(e).slice(0, 240));
    }
    if (!pm) return { out, covered, tileCount };
    const n14 = 2 ** OVERTURE_Z;
    const want = osm.tiles.filter((t) => t.d <= OVERTURE_REACH_M);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const one = async (x: number, y: number) => {
      const raw = await pm!.tile(OVERTURE_Z, ((x % n14) + n14) % n14, y);
      covered.add(`${x}/${y}`);
      tileCount++;
      if (!raw) return;
      const layers = new VectorTile(new PbfReader(raw)).layers;
      // (a building with its parts in the tile: its parts drawn — a tower, a nave, a spire —, not its outline)
      const parted = new Set<string>();
      const part = layers.building_part;
      if (part) for (let i = 0; i < part.length; i++) parted.add(String(part.feature(i).properties.building_id));
      const add = (layer: (typeof layers)[string] | undefined, parts: boolean) => {
        if (!layer) return;
        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i);
          const pr = feature.properties;
          if (feature.type !== 3 || pr.is_underground === true) continue;
          if (!parts && pr.has_parts === true && parted.has(String(pr.id))) continue;
          for (const rings of classifyRings(feature.loadGeometry())) {
            const e = feature.extent;
            const centre = rings[0];
            if (!centre?.length) continue;
            const cx = centre.reduce((t, v) => t + v.x, 0) / centre.length,
              cy = centre.reduce((t, v) => t + v.y, 0) / centre.length;
            if (cx < 0 || cx >= e || cy < 0 || cy >= e) continue;
            const geo = rings.map((r) =>
              r.map((v) => ({
                lon: ((x + v.x / e) / n14) * 360 - 180,
                lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / n14))) / D,
              })),
            );
            const outer = geo[0]!;
            if (geo.reduce((t, r) => t + r.length, 0) > 8192) continue;
            const lat = outer.reduce((t, v) => t + v.lat, 0) / outer.length,
              lon = outer.reduce((t, v) => t + v.lon, 0) / outer.length;
            if (index(lat, lon) < 0 || excluded(lat, lon)) continue;
            const floors = num(pr.num_floors);
            const top = Math.min(500, Math.max(2, num(pr.height) ?? (floors !== null ? floors * 3.2 + 1 : 6)));
            const low = Math.min(top - 1, Math.max(0, num(pr.min_height) ?? (num(pr.min_floor) ?? 0) * 3.2));
            // (a measured roof: the walls under it, the roof its own — as the BD TOPO's —; else OSM's way, all to the top)
            const rh = num(pr.roof_height);
            const measured = rh !== null && rh > 0 && rh < top - low - 1;
            const shape = overtureShape(pr.roof_shape);
            out.push({
              geo,
              lat,
              lon,
              h: measured ? top - rh! : top,
              low,
              d: capDistance(lat, lon),
              a: {
                top: !measured,
                roof: measured ? rh! : null,
                storeys: floors,
                roofMat: overtureRoofMaterial(pr.roof_material),
                wallMat: overtureWallMaterial(pr.facade_material),
                colour: pr.facade_color,
                roofColour: pr.roof_color,
                hint: shape
                  ? { shape, across: pr.roof_orientation === "across", direction: num(pr.roof_direction) ?? undefined }
                  : undefined,
              },
            });
          }
        }
      };
      add(layers.building, false);
      add(part, true);
    };
    tell({ step: "buildings", done: 0, of: want.length });
    for (let k0 = 0; k0 < want.length; k0 += 4) {
      await Promise.all(
        want.slice(k0, k0 + 4).map((w) =>
          one(w.x, w.y).catch((e) => {
            // (a tile failed: OSM's buildings there — the scene not degraded for it)
            covered.delete(`${w.x}/${w.y}`);
            if (surveyErrors.length < 4) surveyErrors.push(String(e).slice(0, 240));
          }),
        ),
      );
      tell({ step: "buildings", done: Math.min(k0 + 4, want.length), of: want.length });
    }
    return { out, covered, tileCount };
  };
  const overture = !bdtopo && q.overture ? overtureTiles() : null;
  // (Q8 D1: the base theme's infrastructure tiles round the centre — turbines, power lines — asked now, beside the other sources,
  // read at the end: the scene not held for them — 21.6 s at Allaines from 60 m when they were asked last, 5 Nov 2026)
  const infraTiles = (async () => {
    try {
      const list = await fetch(OVERTURE_LIST, { signal: live(AbortSignal.timeout(FETCH_MS)) });
      count(list);
      if (!list.ok) return null;
      let pm: PmTiles | null = null;
      for (const r of overtureReleases(await list.text())) {
        const p = new PmTiles(overtureBaseUrl(OVERTURE_BUCKET, r), fetchRange(fetchRanged));
        try {
          await p.header();
          pm = p;
          break;
        } catch {
          // (that release's archive refused: the next)
        }
      }
      if (!pm) return null;
      const n13 = 2 ** TURBINE_Z;
      // (the tiles six at a time, the nearest first)
      const tiles = tilesWithin(TURBINE_Z, q.lat, q.lon, TURBINE_REACH_M);
      const raws: { t: (typeof tiles)[number]; raw: Uint8Array | null }[] = [];
      for (let i = 0; i < tiles.length; i += 6)
        raws.push(
          ...(await Promise.all(
            tiles
              .slice(i, i + 6)
              .map(async (t) => ({ t, raw: await pm!.tile(TURBINE_Z, ((t.x % n13) + n13) % n13, t.y).catch(() => null) })),
          )),
        );
      return raws;
    } catch (e) {
      if (surveyErrors.length < 4) surveyErrors.push(`infrastructure: ${String(e).slice(0, 200)}`);
      return null;
    }
  })();
  const osmChoices: Choice[] = [];
  phase("before osm");
  // (the tiles asked six at a time, ahead — one after the other, Paris's took 34 s —; read in their order still: the same scene)
  const osmRaw = new Map<string, Promise<Uint8Array | ArrayBuffer>>();
  {
    let next = 0;
    const tiles = osm.tiles;
    const run = async () => {
      while (next < tiles.length) {
        const t = tiles[next++]!;
        const p = fetchCount(osmUrl(t.x, t.y));
        osmRaw.set(`${t.x}/${t.y}`, p);
        await p.catch(() => {});
      }
    };
    for (let k = 0; k < 6; k++) void run();
  }
  for (const { x, y } of osm.tiles) {
    try {
      // (asked by now — the six runners take the tiles in this order)
      while (!osmRaw.has(`${x}/${y}`)) await new Promise((done) => setTimeout(done, 5));
      const raw = await osmRaw.get(`${x}/${y}`)!;
      const layers = new VectorTile(new PbfReader(raw)).layers;
      readNetworks(layers, x, y);
      const layer = layers.building;
      if (!layer) continue;
      // (with the BD TOPO's, OSM's set aside: kept where it failed)
      const into = bdtopo || overture ? osmChoices : choices;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        if (feature.type !== 3 || feature.properties.hide_3d === true) continue;
        // Low-zoom tiles group many disconnected buildings with identical heights into one feature.
        for (const rings of classifyRings(feature.loadGeometry())) {
          const e = feature.extent;
          const centre = rings[0];
          if (!centre?.length) continue;
          const cx = centre.reduce((s, v) => s + v.x, 0) / centre.length,
            cy = centre.reduce((s, v) => s + v.y, 0) / centre.length;
          if (cx < 0 || cx >= e || cy < 0 || cy >= e) continue; // Discard buffered copies owned by an adjacent tile.
          const geo = rings.map((r) =>
            r.map((v) => ({
              lon: ((x + v.x / e) / n) * 360 - 180,
              lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / e)) / n))) / D,
            })),
          );
          const outer = geo[0];
          if (!outer?.length || geo.reduce((s, r) => s + r.length, 0) > 8192) continue;
          const lat = outer.reduce((s, v) => s + v.lat, 0) / outer.length,
            lon = outer.reduce((s, v) => s + v.lon, 0) / outer.length;
          if (index(lat, lon) < 0 || excluded(lat, lon)) continue;
          const h = Math.min(500, Math.max(2, Number(feature.properties.render_height) || 6));
          const low = Math.min(h - 1, Math.max(0, Number(feature.properties.render_min_height) || 0));
          into.push({
            geo,
            lat,
            lon,
            h,
            low,
            d: capDistance(lat, lon),
            a: {
              top: true,
              roof: null,
              storeys: null,
              roofMat: RoofMaterial.Unknown,
              wallMat: WallMaterial.Unknown,
              colour: feature.properties.colour,
            },
          });
        }
      }
      trim();
    } catch (e) {
      errors.push(String(e).slice(0, 220));
    }
  }
  let bdtopoBuildings = 0,
    bdtopoTileCount = 0;
  phase("osm");
  const b = bdtopo ? await bdtopo : null;
  if (bdtopo && !b) {
    // (lot 3: the BD TOPO skipped — OSM's within its box drawn by the cells, as when it was read)
    phase("bdtopo");
    for (const v of osmChoices)
      if (inBdtopoBox(...(bdKey(v.lat, v.lon).split("/").map(Number) as [number, number]))) {
        cut.push(v);
        meshLeft++;
      } else choices.push(v);
    trim();
  }
  if (b) {
    phase("bdtopo");
    bdtopoTileCount = b.tileCount;
    // (one by one: Paris's tens of thousands would overflow a spread's arguments)
    // (PLAN-J8 J8-8 lot 4: drawn from their mesh cells — out of the scene, their footprints kept for the trees as the cut ones')
    if (q.meshCells) {
      for (const v of b.out) cut.push(v);
      meshLeft += b.out.length;
    } else for (const v of b.out) choices.push(v);
    // (lot 4: OSM's within the BD TOPO's box too — past the tiles fetched, the far layer's BD TOPO cells draw them: none twice)
    for (const v of osmChoices)
      if (b.covered.has(bdKey(v.lat, v.lon))) continue;
      else if (q.meshCells && inBdtopoBox(...(bdKey(v.lat, v.lon).split("/").map(Number) as [number, number]))) {
        cut.push(v);
        meshLeft++;
      } else choices.push(v);
    trim();
    bdtopoBuildings = choices.filter((v) => b.covered.has(bdKey(v.lat, v.lon))).length;
  }
  let overtureBuildings = 0,
    overtureTileCount = 0;
  if (overture) {
    const o = await overture;
    phase("overture");
    overtureTileCount = o.tileCount;
    const z14 = (lat: number, lon: number) =>
      `${Math.floor(((lon + 180) / 360) * 2 ** OVERTURE_Z)}/${Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * 2 ** OVERTURE_Z)}`;
    // (PLAN-J8 J8-8 lot 4: Overture's drawn from their mesh cells too (lot 1, ad07a44c) — out of the scene, their footprints kept for
    // the trees; OSM's in Overture's tiles with them — where Overture has none, OSM's kept: its cells have no mesh, SourceLater)
    if (q.meshCells) {
      for (const v of o.out) cut.push(v);
      meshLeft += o.out.length;
    } else for (const v of o.out) choices.push(v);
    for (const v of osmChoices)
      if (o.covered.has(z14(v.lat, v.lon))) {
        if (q.meshCells) {
          cut.push(v);
          meshLeft++;
        }
      } else choices.push(v);
    trim();
    overtureBuildings = choices.filter((v) => o.covered.has(z14(v.lat, v.lon))).length;
  }
  // Estimated bridge elevation is explicit: tile data provides layer, not surveyed deck/pier geometry.
  bridgeLines.sort((a, b) => a.d - b.d);
  // (a bridge's part with its triangles — continuous 3D mesh when provided, buildingMesh for buildings:
  // scenery-raster.ts draws it; the view leaves it to the tracer's test)
  const addSolid = (p: Primitive | null, rings?: number[][][], customMesh?: { positions: number[]; triangles: number[] }) => {
    const mesh =
      customMesh ??
      (p && rings
        ? buildingMesh(
            rings.map((r) => r.map((v) => [v[0]!, v[1]!] as [number, number])),
            p.data[0]!,
            p.data[0]!,
            [[0, 0, p.data[1]! - p.data[0]!]],
          )
        : null);
    const meshB = mesh ? mesh.positions.length * 4 + mesh.triangles.length * 4 : 0;
    if (!p || storedBytes + 64 + p.data.length * 4 + meshB > budget - 6 * 1024 * 1024 * room) {
      budgetLimited = true;
      return false;
    }
    if (mesh?.triangles.length) p.mesh = mesh;
    prims.push(p);
    storedBytes += 64 + p.data.length * 4 + meshB;
    return true;
  };
  const selectedAreas: Primitive[] = [];
  // (PLAN-J8 J8-RP RP2: in France the roads within CELL_ROAD_REACH_M from the street cells in the cache — the BD TOPO's axis and
  // measured width, their markings the cells' — in place of OpenMapTiles' in each cell found (their rails and waterways kept); a cell
  // not in the cache: OpenMapTiles' there as before)
  const cellRoads = new Set<Primitive>();
  // (the street cells read for the roads, kept for the parked cars and the furniture: null a cell not in the cache)
  const streetBufs = new Map<string, ArrayBuffer | null>();
  // (RP4: the cells' bridges — whole within a z 14 tile, the same identity in each cell that carries them: kept once)
  const cellBridges = new Map<string, { b: BridgeRecord; o: { lat: number; lon: number } }>();
  const roadCellsFound = new Set<string>();
  /** the street cells wanted and not in the cache (review A3: the page asks the scene again when the pool hands them) */
  const streetMissing: string[] = [];
  if (q.cellRoads && typeof caches !== "undefined")
    try {
      const store = await caches.open(STREET_CACHE);
      const dLat = CELL_ROAD_REACH_M / 111_000,
        dLon = CELL_ROAD_REACH_M / (111_000 * Math.max(0.1, Math.cos(q.lat * D)));
      const centres: [number, number][] = [[q.lat, q.lon]];
      if (q.eye && Number.isFinite(q.eye[0]) && Number.isFinite(q.eye[1])) {
        const dEye = Math.hypot((q.eye[0] - q.lat) * 111_320, wrapLon(q.eye[1] - q.lon) * 111_320 * Math.cos(q.lat * D));
        if (dEye <= radius + CELL_ROAD_REACH_M) centres.push([q.eye[0], q.eye[1]]);
      }
      const wantedCells = new Map<string, { x: number; y: number }>();
      for (const [cLat, cLon] of centres) {
        const a = cellOf(cLat - dLat, cLon - dLon),
          b = cellOf(cLat + dLat, cLon + dLon);
        for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
          for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) wantedCells.set(`${x}/${y}`, { x, y });
      }
      const found = new Set<string>();
      const fresh: Primitive[] = [];
      // (review A3, 24 Nov 2026: the cells come from the streets' pool alone — cell-workers.ts streetPool, its workers, its budget,
      // their building cells with them —; a cell not cached yet is named in the reply (streetMissing): the page asks the scene again
      // once the pool hands it (scenery.ts streetCellArrived). This scene no longer prepares a cell itself — it did since e633d82b, its
      // buildings left out and its generation 0, into the pool's cache, serially and silently)
      for (const { x, y } of wantedCells.values()) {
        const res = await store.match(streetCacheUrl(self.location.origin, x, y));
        if (!res) {
          streetBufs.set(`${x}/${y}`, null);
          streetMissing.push(`${x}/${y}`);
          continue;
        }
        const buf = await res.arrayBuffer();
        // (an incomplete cell — prepared without its building cells: no lamps, no places — read as missing: the pool replaces it)
        if (!streetCellComplete(buf)) {
          streetBufs.set(`${x}/${y}`, null);
          streetMissing.push(`${x}/${y}`);
          continue;
        }
        streetBufs.set(`${x}/${y}`, buf);
        const o = cellOrigin(x, y);
        const roads = cellRoadSurfaces(
          buf,
          (e, n) => {
            const g = fromCell(o, e, n);
            return localPoint(frame, g.lat, g.lon, 0) as [number, number, number];
          },
          true,
        );
        found.add(`${x}/${y}`);
        roadCellsFound.add(`${x}/${y}`);
        // (RP9: the catenary's masts of the cell's electrified railways — on the ground already in; a steel mast, its arm over the
        // tracks)
        for (const m of catenaryMasts(buf, (e, n) => {
          const g = fromCell(o, e, n);
          const z = heightNow(g.lat, g.lon);
          return localPoint(frame, g.lat, g.lon, z ?? Number.NaN) as [number, number, number];
        })) {
          if (!Number.isFinite(m.foot[2]) || Math.hypot(m.foot[0], m.foot[1]) > radius) continue;
          const f = m.foot;
          const mast = [stripPolygon([f[0] - 0.15, f[1], 0], [f[0] + 0.15, f[1], 0], 0.3)];
          addSolid(polygonPrimitive(mast, f[2] - 0.5, f[2] + 7.4, 3, [0.36, 0.37, 0.37]), mast);
          const tip: [number, number, number] = [f[0] + m.across[0] * m.reach, f[1] + m.across[1] * m.reach, 0];
          const arm = [stripPolygon([f[0], f[1], 0], tip, 0.12)];
          addSolid(polygonPrimitive(arm, f[2] + 6.9, f[2] + 7.15, 3, [0.36, 0.37, 0.37]), arm);
          catenaryCount++;
        }
        for (const br of readBridges(buf)) {
          const g0 = fromCell(o, br.points[0]![0], br.points[0]![1]);
          const key = bridgeCanonicalKey(br.id, g0);
          if (!cellBridges.has(key)) cellBridges.set(key, { b: br, o });
        }
        for (const p of roads) {
          cellRoads.add(p);
          fresh.push(p);
        }
      }
      if (found.size) {
        // (OpenMapTiles' roads — kind 1 with a class kept — in the cells found: out; their middle's cell by the frame's flat inverse)
        const cosL = Math.max(0.05, Math.cos(q.lat * D));
        // (one pass, the kept ones moved down in place — a splice each, tens of thousands of surfaces, made Paris's scene twice as slow
        // on kerr-mini, 17 Nov 2026)
        let kept = 0;
        for (let i = 0; i < surfaces.length; i++) {
          const v = surfaces[i]!;
          const d = v.data;
          // (their roads — kind 1 with a class kept — and, KSC5, their rails — kind 2 — the cells' in each cell found)
          if ((d[5] === 1 && d[6]! > 0) || d[5] === 2) {
            const c = cellOf(q.lat + (d[1]! + d[3]!) / 2 / 111_132, q.lon + (d[0]! + d[2]!) / 2 / (111_320 * cosL));
            if (found.has(`${c.x}/${c.y}`)) continue;
          }
          surfaces[kept++] = v;
        }
        surfaces.length = kept;
        for (const p of fresh) surfaces.push(p);
        cellRoadCells = found.size;
        cellRoadCount = fresh.length;
      }
    } catch (e) {
      if (surveyErrors.length < 4) surveyErrors.push(`cell roads: ${String(e).slice(0, 200)}`);
    }
  // (RP4: OpenMapTiles' bridges in a cell whose street cell is cached — France —: out; the cells' own bridges built below)
  if (roadCellsFound.size) {
    for (let i = bridgeLines.length - 1; i >= 0; i--) {
      const mid = bridgeLines[i]!.line[Math.floor(bridgeLines[i]!.line.length / 2)]!;
      const c = cellOf(mid.lat, mid.lon);
      if (roadCellsFound.has(`${c.x}/${c.y}`)) bridgeLines.splice(i, 1);
    }
  }
  // (a bridge's axis on the ground every 20 m at most — its deck's clearance judged on what lies under its whole span, not its few
  // points)
  // (`values`: one a point — the surveyed heights, format 6 — carried to the points added, linear: `vals`; each point's place: `at`)
  const groundLine = async (
    geo: readonly { lat: number; lon: number }[],
    values?: readonly number[],
  ): Promise<Vec3[] & { vals: number[]; at: { lat: number; lon: number }[] }> => {
    const out = Object.assign([] as Vec3[], { vals: [] as number[], at: [] as { lat: number; lon: number }[] });
    for (let i = 0; i < geo.length; i++) {
      const a = geo[i]!;
      if (i > 0) {
        const b = geo[i - 1]!;
        const pa = localPoint(frame, a.lat, a.lon, 0),
          pb = localPoint(frame, b.lat, b.lon, 0);
        const n = Math.floor(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) / 20);
        for (let k = 1; k <= n; k++) {
          const f = k / (n + 1);
          const lat = b.lat + (a.lat - b.lat) * f,
            lon = b.lon + (a.lon - b.lon) * f;
          out.push(localPoint(frame, lat, lon, await height(lat, lon)));
          out.at.push({ lat, lon });
          if (values) out.vals.push(values[i - 1]! + (values[i]! - values[i - 1]!) * f);
        }
      }
      out.push(localPoint(frame, a.lat, a.lon, await height(a.lat, a.lon)));
      out.at.push(a);
      if (values) out.vals.push(values[i]!);
    }
    return out;
  };
  // (review A7: the approach road's grade beyond each closed end — the ground 15 m out along the axis — that the deck meets; an open end
  // none: level with its other half)
  const approachGrades = async (
    geo: readonly { lat: number; lon: number }[],
    pts: readonly Vec3[],
    flags: number,
  ): Promise<[number | undefined, number | undefined]> => {
    const out: [number | undefined, number | undefined] = [undefined, undefined];
    if (pts.length < 2) return out;
    const cosL = Math.max(0.05, Math.cos(q.lat * D));
    for (const end of [0, 1] as const) {
      if (flags & (end ? BridgeFlag.OpenB : BridgeFlag.OpenA)) continue;
      const p = end ? pts[pts.length - 1]! : pts[0]!,
        n = end ? pts[pts.length - 2]! : pts[1]!;
      const g = end ? geo[geo.length - 1]! : geo[0]!;
      const L = Math.hypot(p[0] - n[0], p[1] - n[1]);
      if (L < 0.5) continue;
      const ox = ((p[0] - n[0]) / L) * 15,
        oy = ((p[1] - n[1]) / L) * 15;
      const lat = g.lat + oy / 111_132,
        lon = g.lon + ox / (111_320 * cosL);
      const z = localPoint(frame, lat, lon, await height(lat, lon))[2];
      // (along A → B: at A the ground rises from the outside to A; at B from B to the outside)
      out[end] = end ? (z - p[2]) / 15 : (p[2] - z) / 15;
    }
    return out;
  };
  // (PLAN-PONT-ROUTES-AAA PR2/PR5: the decks' registry — the world's support surfaces, queried by place and level: the cars, the lamps
  // and the guardrails on a bridge; review A4: indexed by a grid)
  const bridgeRegistry = new SupportSurfaceRegistry();
  /** the decks of an authoritative source — the catalogue's notable bridges, the street cells' — a later source's double is left out
   *  under (not the same source's own neighbours: a motorway's twin decks side by side) */
  const notableDecks = new SupportSurfaceRegistry(),
    cellDecks = new SupportSurfaceRegistry();
  let deckSerial = 0;
  /** a data bridge under another source's deck: its double (bridge-structures.ts lineUnderDeck) */
  const underDeckOf = (line: readonly { lat: number; lon: number }[], regs: readonly SupportSurfaceRegistry[]) =>
    lineUnderDeck(
      line.map((p) => localPoint(frame, p.lat, p.lon, 0)),
      (x, y) => regs.some((r) => r.queryBridgeAt(x, y, { margin: 10 }) !== null),
    );
  /** the deck's drawn top at a frame point (its parapets' band read as the deck's), the deck by height (`expectedZ`) or by layer, or null */
  const deckHeightAt = (x: number, y: number, expectedZ?: number, expectedLayer?: number, margin = 1): number | null =>
    bridgeRegistry.queryBridgeAt(x, y, { expectedZ, expectedLevel: expectedLayer, margin, deckTop: true })?.elevation ?? null;
  // (RP5: a bridge's build by its kind — a road's concrete deck and parapets; a railway's deeper deck (its ballast's trough) and
  // taller parapets; a footbridge's thin deck, its steel railings, its slender piers)
  const BRIDGE_STYLES = {
    road: { thick: 1.2, viaductThick: 1.8, railW: 0.28, railH: 1, railColour: [0.42, 0.41, 0.39], pierMax: 3, viaductPier: 5 },
    rail: { thick: 1.5, viaductThick: 2.2, railW: 0.25, railH: 1.2, railColour: [0.4, 0.39, 0.37], pierMax: 3.5, viaductPier: 5.5 },
    foot: { thick: 0.45, viaductThick: 0.9, railW: 0.07, railH: 1.1, railColour: [0.3, 0.29, 0.27], pierMax: 0.8, viaductPier: 1.5 },
  };
  type BridgeStyle = (typeof BRIDGE_STYLES)["road"];
  /** a part's footprint from its prism's top corners (bridge-mesh.ts: 0, 1 at a; 2, 3 at b) */
  const ringOf = (m: { positions: number[] }): Vec3[] => {
    const v = (i: number): Vec3 => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, 0];
    return [v(0), v(3), v(2), v(1), v(0)];
  };
  /** (review A2) a deck's or a parapet's slice: its top's plane after its edges — scenery-data.ts DECK_PLANE, the contact's
   *  (scenery-contact.ts topAt): the drawn top, not its box's */
  const withPlane = (p: Primitive | null, plane: [number, number, number], thick: number): Primitive | null => {
    if (!p) return p;
    p.data[11] = DECK_PLANE;
    p.data.push(plane[0], plane[1], plane[2], thick);
    return p;
  };
  interface DeckBuild {
    /** its axis on the ground (the scene's frame, z the ground's) */
    points: Vec3[];
    width: number;
    kind: number;
    colour: number[];
    clearance: number;
    style: BridgeStyle;
    flags: number;
    layer: number;
    geoPoints?: readonly { lat: number; lon: number }[];
    approach: [number | undefined, number | undefined];
    maxGrade: number;
    /** its distance to the eye or the scene's centre [m] (its LOD — bridge-lod.ts) */
    d: number;
    /** its piers by its family (default) — none: a notable bridge's, its towers its supports (B3) */
    piers?: boolean;
    /** a registry it is listed in besides the scene's (its source's: notableDecks, cellDecks) */
    also?: SupportSurfaceRegistry;
    /** (street cells' format 6) its deck's surveyed top at each point [the frame's z] — bridge-surface-service.ts `measured` */
    measured?: number[];
    /** (25 Nov 2026) an end's height given — a neighbouring deck's top where this one meets it (bridge-ports.ts joinDeckPieces) */
    endZ?: [number | undefined, number | undefined];
    /** (25 Nov 2026) the decks' share already used, 0 … 1 (bridge-lod.ts selectBridgeLOD) */
    pressure?: number;
  }
  // (PLAN-J8 J8-RP RP4/RP5, PLAN-PONT-ROUTES-AAA, review A1/A2/A7/A8/A9: one deck for every bridge — its profile decided once
  // (bridge-surface-service.ts), drawn in slices between its stations (their corners mitred: no crack at a bend), each slice's top a
  // plane the contact reads; its parapets the same; its piers by its structure; registered with its real layer. Returns whether a
  // part was made)
  const deckBridge = (o: DeckBuild): BridgeContinuousProfile | null => {
    const { points, width, kind, colour, clearance, style, flags } = o;
    let totalLen = 0;
    for (let i = 0; i < points.length - 1; i++)
      totalLen += Math.hypot(points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1]);
    const family = classifyBridgeStructure({
      length: totalLen,
      width,
      geoStart: o.geoPoints?.[0],
      geoEnd: o.geoPoints?.[o.geoPoints.length - 1],
      clearance,
    });
    const viaduct = family === "viaduct" || totalLen > VIADUCT_M;
    const thick = viaduct ? style.viaductThick : style.thick;
    const lod = selectBridgeLOD(o.d, o.pressure ?? 0);
    const profile = new BridgeContinuousProfile({
      points: points as [number, number, number][],
      width,
      thickness: thick,
      clearance,
      flags,
      approachSlopeA: o.approach[0],
      approachSlopeB: o.approach[1],
      maxGrade: o.maxGrade,
      endZA: o.endZ?.[0],
      endZB: o.endZ?.[1],
      measured: o.measured,
      railW: lod.drawParapets ? style.railW : 0,
      railH: style.railH,
      sliceM: lod.sliceLengthM,
    });
    const total = profile.totalLength;
    if (total < 1) return null;
    const serial = deckSerial++;
    const ref = { assetId: `bridge_${serial}`, surfaceId: `surface_${serial}`, revision: String(q.id) };
    bridgeRegistry.registerBridge(ref, profile, o.layer);
    o.also?.registerBridge(ref, profile, o.layer);
    const st = profile.stations;
    const axis = st.map((s) => profile.axisAt(s));
    const across = mitres(
      axis.map((a) => [a.x, a.y] as [number, number]),
      width / 2,
    );
    let made = false;
    for (let k = 0; k + 1 < st.length; k++) {
      const A = axis[k]!,
        B = axis[k + 1]!;
      const pa: [number, number, number] = [A.x, A.y, 0],
        pb: [number, number, number] = [B.x, B.y, 0];
      if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < 0.05) continue;
      const top0 = profile.deckAt(st[k]!),
        top1 = profile.deckAt(st[k + 1]!);
      const isStart = k === 0,
        isEnd = k === st.length - 2;
      const deckMesh = buildContinuousSliceMesh({
        pa,
        pb,
        width,
        top0,
        top1,
        thick,
        isStart,
        isEnd,
        flags,
        acrossA: across[k],
        acrossB: across[k + 1],
      });
      const plane = computeSlicePlane(pa, pb, top0, top1);
      const ring = ringOf(deckMesh);
      const minZ = Math.min(top0, top1) - thick,
        maxZ = Math.max(top0, top1);
      made = addSolid(withPlane(polygonPrimitive([ring], minZ, maxZ, kind, colour), plane, thick), [ring], deckMesh) || made;
      if (!lod.drawParapets) continue;
      for (const side of [-1, 1] as const) {
        const railMesh = buildContinuousRailMesh({
          pa,
          pb,
          width,
          railW: style.railW,
          railH: style.railH,
          side,
          top0,
          top1,
          isStart,
          isEnd,
          flags,
          acrossA: across[k],
          acrossB: across[k + 1],
        });
        const rail = ringOf(railMesh);
        addSolid(
          withPlane(
            polygonPrimitive([rail], Math.min(top0, top1), maxZ + style.railH, 3, style.railColour),
            [plane[0], plane[1], plane[2] + style.railH],
            style.railH,
          ),
          [rail],
          railMesh,
        );
      }
    }
    // (PLAN-PONT-ROUTES-AAA PR6: the piers by the structural family — Alexandre III none in the Seine —, each where the intrados
    // stands PIER_MIN_M over the ground at its foot; review A9: its mesh turned along the axis as its collision strip is)
    // (the coarsest level drops a girder's piers — under a pixel —, never a viaduct's: its silhouette)
    if ((lod.drawPiers || viaduct) && o.piers !== false)
      for (const d of computeStructurePierLocations(total, family)) {
        if (d < 2 || d > total - 2) continue;
        const z = profile.intradosAt(d),
          g = profile.groundAt(d);
        if (z - g < PIER_MIN_M) continue;
        const a = profile.axisAt(d);
        const pierWidth = Math.min(viaduct ? style.viaductPier : style.pierMax, width * 0.5);
        const pier = [stripPolygon([a.x - a.tx, a.y - a.ty, 0], [a.x + a.tx, a.y + a.ty, 0], pierWidth)];
        const pierMesh = buildContinuousPierMesh({
          p: [a.x, a.y, 0],
          width,
          pierWidth,
          groundFooting: g - 2,
          intradosTop: z,
          axis: [a.tx, a.ty],
          halfLength: 1,
        });
        if (addSolid(polygonPrimitive(pier, g - 2, z, 3, [0.5, 0.49, 0.46]), pier, pierMesh)) bridgePiers++;
      }
    // (PLAN-PONT-ROUTES-AAA PR6: Pont Alexandre III — its four corner pylons, each its own solids (review A9: they hung on one corner's
    // primitive); 25 Nov 2026: in their parts — base, pedestal, column, capital in granite, the gilded group with its wings —, and its
    // steel arch from springings 6.3 m under its crown to the intrados, its open spandrels, each piece its own solid (the river under
    // the arch open): painted parts, tagged as the notable bridges' (BRIDGE_PAINT | paint — the raster's palette))
    if (family === "monumental_alexandre_iii") {
      const pStart = points[0]!,
        pEnd = points[points.length - 1]!;
      const deckZ0 = profile.deckAt(0),
        deckZ1 = profile.deckAt(total);
      const painted = (so: {
        positions: number[];
        triangles: number[];
        footprint: [number, number][];
        bottom: number;
        top: number;
        paint: number;
      }) => {
        const foot = [[...so.footprint, so.footprint[0]!].map((v) => [v[0], v[1], 0] as Vec3)];
        const p = polygonPrimitive(foot, so.bottom, so.top, 3, [0.58, 0.56, 0.52]);
        if (p) p.meshTag = (BRIDGE_PAINT | so.paint) >>> 0;
        addSolid(p, foot, so);
      };
      const pyl = buildAlexandreIIIPylonsMesh({
        pStart: pStart as [number, number, number],
        pEnd: pEnd as [number, number, number],
        width,
        deckZ0,
        deckZ1,
      });
      for (const one of pyl.pylons) painted(one);
      const arch = buildArchRibsMesh({
        pStart: pStart as [number, number, number],
        pEnd: pEnd as [number, number, number],
        width,
        deckZ0,
        deckZ1,
        deckZMid: profile.deckAt(total / 2),
        thick,
        riseM: ALEXANDRE_III.rise,
      });
      for (const one of arch.parts) painted(one);
    }
    return made ? profile : null;
  };
  const bridgeNearD = (lat: number, lon: number) => {
    const p = localPoint(frame, lat, lon, 0);
    const dCenter = Math.hypot(p[0], p[1]);
    if (!q.eye) return dCenter;
    const dEye = Math.hypot((lat - q.eye[0]) * 111_320, wrapLon(lon - q.eye[1]) * 111_320 * Math.cos(q.lat * D));
    return Math.min(dCenter, dEye);
  };
  const nearestD = (geo: readonly { lat: number; lon: number }[]) => {
    let d = Infinity;
    const step = Math.max(1, Math.floor(geo.length / 8));
    for (let i = 0; i < geo.length; i += step) d = Math.min(d, bridgeNearD(geo[i]!.lat, geo[i]!.lon));
    return Math.min(d, bridgeNearD(geo[geo.length - 1]!.lat, geo[geo.length - 1]!.lon));
  };
  /** a road bridge's steepest grade by its width (a fast road's 5 %, a minor one's 8 %), a railway's 3.5 %, a footbridge's 8 % */
  const gradeOf = (kind: number, width: number) =>
    kind === BridgeKind.Rail ? 0.035 : kind === BridgeKind.Foot ? 0.08 : width >= 14 ? 0.05 : 0.08;
  // (25 Nov 2026 — every bridge in the scene drawn: no count's cap — 256 × k², 1 024 in Paris, its farther bridges left out — but the
  // decks' share of the scene's bytes (bridge-lod.ts BRIDGE_SHARE), nearest first, each deck's detail coarsened as the share fills;
  // past it a deck left out, counted)
  const bridgeShare = BRIDGE_SHARE * budget;
  let bridgeBytes = 0,
    bridgeCandidates = 0,
    bridgesDropped = 0,
    measuredBridges = 0;
  const shareDeck = (o: DeckBuild): BridgeContinuousProfile | null => {
    bridgeCandidates++;
    if (bridgeBytes >= bridgeShare) {
      bridgesDropped++;
      budgetLimited = true;
      return null;
    }
    const before = storedBytes;
    const made = deckBridge({ ...o, pressure: bridgeBytes / bridgeShare });
    bridgeBytes += storedBytes - before;
    if (made) bridges++;
    else if (budgetLimited) bridgesDropped++;
    return made;
  };
  /** (25 Nov 2026, bridge-ports.ts joinDeckPieces) a branch's ends on the deck it meets — its drawn top there, the registry's (that
   *  deck built first); a surveyed deck's only within 3 m of its own survey (two structures, not one, beyond) */
  const branchEnds = (
    pts: readonly Vec3[],
    layer: number,
    branchA: boolean,
    branchB: boolean,
    measured?: readonly number[],
  ): [number | undefined, number | undefined] => {
    const out: [number | undefined, number | undefined] = [undefined, undefined];
    for (const end of [0, 1] as const) {
      if (!(end ? branchB : branchA) || pts.length < 2) continue;
      const p = end ? pts[pts.length - 1]! : pts[0]!;
      const r = bridgeRegistry.queryBridgeAt(p[0], p[1], { expectedLevel: layer, sameLevel: true, margin: 2, deckTop: true });
      if (!r) continue;
      const own = measured ? (end ? measured[measured.length - 1]! : measured[0]!) : undefined;
      if (own === undefined || Math.abs(r.elevation - own) < 3) out[end] = r.elevation;
    }
    return out;
  };
  // (PLAN-PONT-ROUTES-AAA B3: the catalogue's notable bridges within NOTABLE_REACH_M of the eye or the centre — their towers seen from
  // tens of kilometres —, first: their own deck (drivable, the same profile, contact and registry as any — deckBridge), their painted
  // solids (towers, girders, anchorages: collidable, in the shadow map), their cables (widened to a pixel by the raster); the data's
  // decks under them left out — the registry finds them there)
  for (const nb of NOTABLE_BRIDGES) {
    const mid = { lat: (nb.ends[0].lat + nb.ends[1].lat) / 2, lon: (nb.ends[0].lon + nb.ends[1].lon) / 2 };
    const d = Math.min(
      bridgeNearD(nb.ends[0].lat, nb.ends[0].lon),
      bridgeNearD(nb.ends[1].lat, nb.ends[1].lon),
      bridgeNearD(mid.lat, mid.lon),
    );
    if (d > NOTABLE_REACH_M) continue;
    try {
      const grounds = new Map<string, number>();
      for (const g of [...nb.ends, ...nb.towers]) grounds.set(`${g.lat},${g.lon}`, await height(g.lat, g.lon));
      const nf = {
        local: (lat: number, lon: number, h: number) => localPoint(frame, lat, lon, h) as Vec3,
        geoid: sea,
        ground: (lat: number, lon: number) => grounds.get(`${lat},${lon}`) ?? sea(lat, lon),
      };
      const slab = { ...BRIDGE_STYLES.road, thick: 0.6, viaductThick: 0.6 };
      const deckProfile = deckBridge({
        points: notableDeckAxis(nb, nf),
        width: nb.deckWidth,
        kind: 2,
        colour: [0.095, 0.098, 0.1],
        // (its points are the roadway's heights: no clearance asked over them — the catalogue's deck is the deck)
        clearance: -slab.thick,
        style: slab,
        flags: 0,
        layer: 1,
        approach: [undefined, undefined],
        maxGrade: 0.065,
        d,
        piers: false,
        also: notableDecks,
      });
      if (!deckProfile) continue;
      bridges++;
      // (its structure hung on the deck just built — one owner: the profile's drawn top)
      const parts = notableParts(nb, nf, (x) => deckProfile.deckAt(x));
      for (const so of parts.solids) {
        const p = polygonPrimitive([so.ring], so.bottom, so.top, 3, [0.5, 0.5, 0.5]);
        if (p) p.meshTag = (BRIDGE_PAINT | so.paint) >>> 0;
        addSolid(p, [so.ring], so);
      }
      for (const c of parts.cables) {
        const bytes = c.positions.length * 4 + (c.triangles.length / 3) * 16;
        if (storedBytes + bytes > budget - 2 * 1024 * 1024) {
          budgetLimited = true;
          break;
        }
        storedBytes += bytes;
        structCables.push({ positions: c.positions, triangles: c.triangles, tag: structCableTag(c.diameter, c.vertical, c.paint) });
      }
      notableBridges++;
    } catch (e) {
      if (surveyErrors.length < 4) surveyErrors.push(`notable bridge ${nb.id}: ${String(e).slice(0, 200)}`);
    }
  }
  // (RP4 / PLAN-PONT-ROUTES-AAA PR3/PR5: the street cells' canonical bridges FIRST — the BD TOPO's axis, width with its sides,
  // clearance —, the nearest to the camera or scene centre first, before distant OMT bridgeLines can exhaust bridgeLimit)
  {
    // (review A1: a half whose open end's other half lies in a cell not read — beyond the reach — has that cell read for its bridges)
    const geoOf = (e: { b: BridgeRecord; o: { lat: number; lon: number } }): GeoBridge => ({
      id: e.b.id,
      kind: e.b.kind,
      flags: e.b.flags,
      width: e.b.width,
      layer: e.b.layer,
      crossed: e.b.crossed,
      clearance: e.b.clearance,
      points: e.b.points.map(([east, north]) => fromCell(e.o, east, north)),
      ...(e.b.heights ? { heights: e.b.heights } : {}),
    });
    const extra = new Set<string>();
    const cosL = Math.max(0.05, Math.cos(q.lat * D));
    for (const e of cellBridges.values()) {
      const g = geoOf(e);
      for (const end of [0, 1] as const) {
        if (!(g.flags & (end ? BridgeFlag.OpenB : BridgeFlag.OpenA)) || g.points.length < 2) continue;
        const p = end ? g.points[g.points.length - 1]! : g.points[0]!,
          n = end ? g.points[g.points.length - 2]! : g.points[1]!;
        const dy = (p.lat - n.lat) * 111_132,
          dx = (p.lon - n.lon) * 111_320 * cosL;
        const L = Math.hypot(dx, dy) || 1;
        const c = cellOf(p.lat + ((dy / L) * 3) / 111_132, p.lon + ((dx / L) * 3) / (111_320 * cosL));
        if (!streetBufs.has(`${c.x}/${c.y}`)) extra.add(`${c.x}/${c.y}`);
      }
    }
    if (extra.size && typeof caches !== "undefined")
      try {
        const store = await caches.open(STREET_CACHE);
        for (const k of [...extra].slice(0, 24)) {
          const [x, y] = k.split("/").map(Number) as [number, number];
          const res = await store.match(streetCacheUrl(self.location.origin, x, y));
          const buf = res ? await res.arrayBuffer() : null;
          if (!buf || !streetCellComplete(buf)) {
            // (not among the scene's own wanted cells: no rebuild waits on it — its half stays open, held at its clearance)
            continue;
          }
          const o = cellOrigin(x, y);
          for (const br of readBridges(buf)) {
            const key = bridgeCanonicalKey(br.id, fromCell(o, br.points[0]![0], br.points[0]![1]));
            if (!cellBridges.has(key)) cellBridges.set(key, { b: br, o });
          }
        }
      } catch (e) {
        if (surveyErrors.length < 4) surveyErrors.push(`bridge halves: ${String(e).slice(0, 200)}`);
      }
    // (25 Nov 2026: the halves joined, then the pieces that meet — end to end: one axis; a branch: built after, its end on the other
    // deck's top —, the nearest first)
    const list = joinDeckPieces(joinBridgeHalves([...cellBridges.values()].map(geoOf)))
      .map((j) => ({ ...j, d: nearestD(j.bridge.points) }))
      .sort((a, b) => Number(a.branchA || a.branchB) - Number(b.branchA || b.branchB) || a.d - b.d);
    for (const { bridge: b, branchA, branchB, d } of list) {
      try {
        // (a notable bridge's deck already there: this one its data's double)
        if (underDeckOf(b.points, [notableDecks])) continue;
        // (format 6: its surveyed deck — the BD TOPO's Z over the sea, the geoid's N added: over the ellipsoid, in the frame)
        const surveyed = b.flags & BridgeFlag.Measured ? fillHeights(b.points, b.heights) : null;
        const pts = await groundLine(b.points, surveyed ?? undefined);
        const measured = surveyed
          ? pts.vals.map((h, i) => localPoint(frame, pts.at[i]!.lat, pts.at[i]!.lon, h + sea(pts.at[i]!.lat, pts.at[i]!.lon))[2])
          : undefined;
        if (measured) measuredBridges++;
        const rail = b.kind === BridgeKind.Rail,
          foot = b.kind === BridgeKind.Foot;
        const colour = rail ? [0.2, 0.19, 0.17] : foot ? [0.3, 0.29, 0.27] : [0.095, 0.098, 0.1];
        const style = rail ? BRIDGE_STYLES.rail : foot ? BRIDGE_STYLES.foot : BRIDGE_STYLES.road;
        const width = Math.max(foot ? 2 : 4, b.width);
        const layer = Math.max(1, b.layer);
        const flags = b.flags | (branchA ? BridgeFlag.OpenA : 0) | (branchB ? BridgeFlag.OpenB : 0);
        if (
          shareDeck({
            points: pts,
            width,
            kind: 2,
            colour,
            clearance: b.clearance > 0 ? b.clearance : 5.5,
            style,
            flags,
            layer,
            geoPoints: b.points,
            approach: await approachGrades(b.points, pts, flags),
            maxGrade: gradeOf(b.kind, width),
            also: cellDecks,
            d,
            measured,
            endZ: branchEnds(pts, layer, branchA, branchB, measured),
          })
        )
          cellBridgeCount++;
      } catch (err) {
        if (!errors.length) errors.push(String(err).slice(0, 220));
      }
    }
  }
  // (OpenMapTiles' bridges — abroad, and in France where no street cell is cached —: each tile's part, the halves joined as the cells'
  // (review A1); none where a cell's deck already stands — the registry's grid, not a scan of every cell bridge (review A9))
  {
    const water = new Set<GeoBridge>();
    const geo: GeoBridge[] = bridgeLines.map((v) => {
      const g: GeoBridge = {
        id: 0,
        kind: v.rail ? BridgeKind.Rail : v.foot ? BridgeKind.Foot : BridgeKind.Road,
        flags: v.flags,
        width: v.width,
        layer: v.layer,
        crossed: 0,
        clearance: 0,
        points: v.line,
      };
      if (v.water) water.add(g);
      return g;
    });
    const joined = joinDeckPieces(joinBridgeHalves(geo))
      .map((j) => ({ ...j, d: nearestD(j.bridge.points), water: water.has(j.bridge) }))
      .sort((a, b) => Number(a.branchA || a.branchB) - Number(b.branchA || b.branchB) || a.d - b.d);
    for (const { bridge: b, branchA, branchB, d, water: aqueduct } of joined) {
      try {
        const mid = b.points[Math.floor(b.points.length / 2)]!;
        const at = localPoint(frame, mid.lat, mid.lon, 0);
        if (underDeckOf(b.points, [notableDecks, cellDecks])) continue;
        if (selectedAreas.some((p) => surfaceContains(at, p))) continue;
        const points = await groundLine(b.points);
        const style =
          b.kind === BridgeKind.Rail ? BRIDGE_STYLES.rail : b.kind === BridgeKind.Foot ? BRIDGE_STYLES.foot : BRIDGE_STYLES.road;
        const colour = aqueduct
          ? [0.018, 0.052, 0.055]
          : b.kind === BridgeKind.Rail
            ? [0.2, 0.19, 0.17]
            : b.kind === BridgeKind.Foot
              ? [0.3, 0.29, 0.27]
              : [0.095, 0.098, 0.1];
        const flags = b.flags | (branchA ? BridgeFlag.OpenA : 0) | (branchB ? BridgeFlag.OpenB : 0);
        shareDeck({
          points,
          width: b.width,
          kind: aqueduct ? 4 : 2,
          colour,
          clearance: 5.5 + 4 * Math.max(0, b.layer - 1),
          style,
          flags,
          layer: b.layer,
          geoPoints: b.points,
          approach: await approachGrades(b.points, points, flags),
          maxGrade: gradeOf(b.kind, b.width),
          d,
          endZ: branchEnds(points, b.layer, branchA, branchB),
        });
      } catch (e) {
        if (!errors.length) errors.push(String(e).slice(0, 220));
      }
    }
  }
  bridgeAreas.sort((a, b) => a.d - b.d);
  // (PLAN-PONT-ROUTES-AAA PR3: OMT's bridge areas — a flat slab — only where no deck stands: their centre and outline tested against the
  // registry each (review A9: they were all dropped once any cell bridge existed, none checked otherwise but their centre)
  for (const v of bridgeAreas) {
    if (bridgeBytes >= bridgeShare) {
      bridgesDropped++;
      budgetLimited = true;
      continue;
    }
    try {
      const outer = v.rings[0]!;
      const lat = outer.reduce((sum, p) => sum + p.lat, 0) / outer.length,
        lon = outer.reduce((sum, p) => sum + p.lon, 0) / outer.length;
      const c = localPoint(frame, lat, lon, 0);
      if (deckHeightAt(c[0], c[1], undefined, undefined, 3) !== null) continue;
      const step = Math.max(1, Math.floor(outer.length / 16));
      let covered = false;
      for (let i = 0; i < outer.length && !covered; i += step) {
        const p = localPoint(frame, outer[i]!.lat, outer[i]!.lon, 0);
        covered = deckHeightAt(p[0], p[1], undefined, undefined, 3) !== null;
      }
      if (covered) continue;
      let base = localPoint(frame, lat, lon, await height(lat, lon))[2];
      for (let i = 0; i < outer.length; i += step)
        base = Math.max(base, localPoint(frame, outer[i]!.lat, outer[i]!.lon, await height(outer[i]!.lat, outer[i]!.lon))[2]);
      const rings = v.rings.map((r) => r.map((at) => localPoint(frame, at.lat, at.lon, 0)));
      const p = polygonPrimitive(rings, base + 4 * v.layer - 1.2, base + 4 * v.layer, 2, [0.095, 0.098, 0.1]);
      bridgeCandidates++;
      const before = storedBytes;
      if (addSolid(p, rings)) {
        bridges++;
        selectedAreas.push(v.footprint);
      } else bridgesDropped++;
      bridgeBytes += storedBytes - before;
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  // Reserve the planar network before vegetation; analytic distance tests keep even narrow paths sharp.
  surfaces.sort((a, b) => surfaceDistance(a) - surfaceDistance(b));
  const surfaceLimit = Math.round((q.mode === "high" ? 24000 : 16000) * k2);
  if (surfaces.length > surfaceLimit) {
    surfaces.length = surfaceLimit;
    budgetLimited = true;
  }
  const keptSurfaces: Primitive[] = [];
  for (const v of surfaces) {
    const bytes = 64 + v.data.length * 4;
    if (storedBytes + bytes > budget - 4 * 1024 * 1024 * room) {
      budgetLimited = true;
      continue;
    }
    keptSurfaces.push(v);
    storedBytes += bytes;
  }
  // (the cells' keys numbers, not strings — the forest asks them ~2 M times)
  const cellKey = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
  const surfaceCells = new Map<number, Primitive[]>();
  // (review A5: a deck's road is not the ground's — its trees kept; a deck itself clears the trees under it only where its intrados is
  // within TREE_UNDER_DECK_M of the ground — under a viaduct they grow)
  for (const v of [...keptSurfaces.filter((p) => !isDeckRoad(p)), ...prims.filter((p) => p.data[3] === 2 || p.data[3] === 4)]) {
    for (let y = Math.floor((v.min[1] - 7) / 64); y <= Math.floor((v.max[1] + 7) / 64); y++)
      for (let x = Math.floor((v.min[0] - 7) / 64); x <= Math.floor((v.max[0] + 7) / 64); x++) {
        const key = cellKey(x, y),
          cell = surfaceCells.get(key) ?? [];
        cell.push(v);
        surfaceCells.set(key, cell);
      }
  }
  const networkExcludedAt = (p: Vec3, lat: number, lon: number) =>
    surfaceCells.get(cellKey(Math.floor(p[0] / 64), Math.floor(p[1] / 64)))?.some((v) => {
      if (!surfaceContains(p, v, 7)) return false;
      if (v.data[11] !== DECK_PLANE) return true;
      // (a deck's slice: its intrados over the ground there)
      const h = heightNow(lat, lon);
      if (h === undefined) return true;
      const at = 12 + v.data[2]! * 4;
      const under = v.data[at]! * p[0] + v.data[at + 1]! * p[1] + v.data[at + 2]! - v.data[at + 3]!;
      return under - localPoint(frame, lat, lon, h)[2] < TREE_UNDER_DECK_M;
    }) ?? false;
  // ---- the forests: at most one tree a cell of the world-fixed grid (forest.ts), decided here once —
  // the same tree at the same place whichever scenery holds it (the class, the roads, the ground at its foot)
  // (the survey's canopy holds the buildings too — its surface less its ground —: none of its trees in an OSM footprint)
  // (the cap's cut ones too — their own grid, the trees they refuse counted —: the lever clearCut, on by Sam's decision, retired with
  // its old path — the kept ones only —, lot R1, 13 Nov 2026)
  const houses = new Map<number, Primitive[]>(),
    cutHouses = new Map<number, Primitive[]>();
  const houseGrid = (into: Map<number, Primitive[]>, list: Choice[]) => {
    for (const v of list) {
      const p = polygonPrimitive(
        v.geo.map((r) => r.map((at) => localPoint(frame, at.lat, at.lon, 0))),
        0,
        1,
        1,
        [0, 0, 0],
      );
      if (!p) continue;
      for (let y = Math.floor((p.min[1] - 2) / 32); y <= Math.floor((p.max[1] + 2) / 32); y++)
        for (let x = Math.floor((p.min[0] - 2) / 32); x <= Math.floor((p.max[0] + 2) / 32); x++) {
          const key = cellKey(x, y);
          const cell = into.get(key) ?? [];
          cell.push(p);
          into.set(key, cell);
        }
    }
  };
  let cutHousesMs = 0;
  if (land) {
    await landReady;
    houseGrid(houses, choices);
    const t0 = performance.now();
    if (cut.length) houseGrid(cutHouses, cut);
    cutHousesMs = Math.round(performance.now() - t0);
  }
  const inGrid = (grid: Map<number, Primitive[]>, p: Vec3) =>
    grid.size > 0 && (grid.get(cellKey(Math.floor(p[0] / 32), Math.floor(p[1] / 32)))?.some((v) => surfaceContains(p, v, 1.5)) ?? false);
  let clearedTrees = 0;
  const housedAt = (p: Vec3) => inGrid(houses, p) || (inGrid(cutHouses, p) && ++clearedTrees > 0);
  phase("before forest");
  // (PLAN-J8 J8-8b lot 2: the forest's prepared cells under the frame — their cases taken as they were decided, the rest as before;
  // read early, beside the data — preparedP)
  const prepared = await preparedP;
  if (preparedError && surveyErrors.length < 4) surveyErrors.push(`forest cells: ${preparedError}`);
  phase("forest cells");
  const grown = await growForest(ff, {
    cover: (lat, lon) => {
      const k = index(lat, lon);
      return k < 0 ? 0 : classes[k]!;
    },
    // (the point in the scene's metres made once for both indexes — it was made twice a cell)
    excluded: (lat, lon) => {
      if (excluded(lat, lon)) return true;
      const p = localPoint(frame, lat, lon, 0);
      return networkExcludedAt(p, lat, lon) || housedAt(p);
    },
    canopy: land instanceof IgnLand ? (lat, lon, r) => land.canopyNear(lat, lon, r) : undefined,
    ...(prepared ? { prepared, excludedLive: excluded } : {}),
    ground: height,
    groundNow: heightNow,
    sea,
    local: (lat, lon, h) => localPoint(frame, lat, lon, h),
    error: (e) => void (errors.length < 12 && errors.push(String(e).slice(0, 220))),
  });
  const cells = grown.cells;
  const shapes: Record<string, number> = {};
  trees = grown.trees;
  const surveyedTrees = grown.surveyed;
  // Select individual buildings by distance, so a dense tile cannot consume the budget before closer neighbours.
  // (their footprints in the scene's metres first — the party walls are found among them all —, then each roof planned
  // — roofs.ts —, packed with its planes, and the nearer ones' meshes for the raster — roof-mesh.ts)
  const local = choices.map((v) =>
    v.geo.map((ring) => ring.slice(0, -1).map((at) => localPoint(frame, at.lat, at.lon, 0).slice(0, 2) as Pt)),
  );
  const party = partyEdges(local);
  phase("party walls");
  // (the bytes before the buildings: the forest, the land cover's raster, the networks, the bridges)
  const bytesBefore = storedBytes;
  let meshBytes = 0,
    meshed = 0;
  const meshBudget = budget / 4;
  // (in two passes within the budget: every building first as one leaf — a complex outline's roof flat —, the nearest
  // first until the budget is spent: the count as before; then the nearer ones' detail — their outlines cut into convex
  // parts each with its roof, their triangles for the shadow map — nearest first, while it fits)
  // (a terrace's parapet, its leaves, its meshes: building-mesh-prep.ts — the cells' worker makes the same, J8-8)
  type Planned = {
    i: number;
    base: number;
    seed: number;
    input: RoofInput;
    plans: RoofPart[];
    mesh: (Primitive["mesh"] | undefined)[];
    bytes: number;
  };
  const room4 = budget - 4 * 1024 * 1024 * room;
  const leafBytes = (plans: RoofPart[]) =>
    plans.reduce((t, p) => t + 112 + p.rings.reduce((e, r) => e + r.length, 0) * 16 + 16 + p.planes.length * 16, 0);
  // (B6: a BD TOPO roof without its ridge — Paris's — measured by the IGN's canopy model, its surface over its ground
  // (I4: ~3 m a texel within CANOPY_NEAR, a texel the mean over it): its footprint's inner points, 1.5 m in from its walls,
  // the 85th percentile of their heights its top — the roof the eave's to it; a measure of fewer than six points none)
  // (shared with the cells' worker — building-mesh-prep.ts lidarRoof: the same building the same roof, J8-8)
  const lidarRoof = (rings: Pt[][], lat: number, lon: number, eave: number): number | null => {
    if (!(land instanceof IgnLand)) return null;
    const [cx, cy] = localPoint(frame, lat, lon, 0);
    return measuredRoof(rings, eave, (x, y) => land.canopy(lat + (y - cy) / 111320, lon + (x - cx) / (111320 * Math.cos(lat * D))));
  };
  phase("forest");
  let lidarRoofs = 0;
  const planned: Planned[] = [];
  for (const [i, v] of choices.entries()) {
    try {
      const { lat, lon, h, low, a } = v;
      const rings = local[i]!.filter((r) => r.length >= 3);
      if (!rings.length) continue;
      const base = localPoint(frame, lat, lon, heightNow(lat, lon) ?? (await height(lat, lon)))[2];
      const s = seed(Math.round(lat * 1e5), Math.round(lon * 1e5));
      // (its ridge measured by the LiDAR where the BD TOPO has none — the near ones)
      let roofH = a.roof;
      if (roofH === null && !a.top && v.d < CANOPY_NEAR) {
        roofH = lidarRoof(rings, lat, lon, h);
        if (roofH !== null) lidarRoofs++;
      }
      const input: RoofInput = {
        rings,
        party: party[i]![0],
        height: h - low,
        top: a.top,
        roof: roofH,
        storeys: a.storeys,
        roofMat: a.roofMat,
        wallMat: a.wallMat,
        usage: a.usage,
        nature: a.nature,
        light: a.light,
        region,
        seed: s,
        hint: a.hint,
      };
      const plans = plansOf(input, 1, v.geo);
      const bytes = leafBytes(plans);
      if (storedBytes + bytes > room4) {
        budgetLimited = true;
        break;
      }
      storedBytes += bytes;
      planned.push({ i, base, seed: s, input, plans, mesh: [], bytes });
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  phase("roofs");
  // (the detail — parts, triangles — by the nearer of the centre and the camera: the centre led along the view, up to a few
  // km ahead of the craft, the buildings under it had stayed boxes — at the Étoile looking ahead, the nearest 1.5 km)
  const eyeD = (lat: number, lon: number) =>
    q.eye ? Math.hypot((lat - q.eye[0]) * 111320, wrapLon(lon - q.eye[1]) * 111320 * Math.cos(q.lat * D)) : Infinity;
  const nearOf = new Map<Planned, number>();
  for (const b of planned) {
    const v = choices[b.i]!;
    nearOf.set(b, Math.min(v.d, eyeD(v.lat, v.lon)));
  }
  for (const b of [...planned].sort((x, y) => nearOf.get(x)! - nearOf.get(y)!)) {
    const v = choices[b.i]!;
    const near = nearOf.get(b)!;
    if (near >= BUILDING_MESH_M && near >= BUILDING_PARTS_M) break;
    try {
      const floor = b.base + v.low,
        bottom = b.base + v.low - 1;
      const plans = near < BUILDING_PARTS_M ? plansOf(b.input, 24, v.geo) : b.plans;
      const bytes = leafBytes(plans);
      const mesh = near < BUILDING_MESH_M && meshBytes < meshBudget ? partMeshes(v.a, plans, bottom, floor) : [];
      const mb = mesh.reduce((t, m) => t + m.positions.length * 4 + (m.triangles.length / 3) * 12, 0);
      if (storedBytes + bytes - b.bytes + mb > room4) continue;
      storedBytes += bytes - b.bytes + mb;
      meshBytes += mb;
      b.plans = plans;
      b.bytes = bytes;
      b.mesh = mesh.map((m) => (m.triangles.length ? m : undefined));
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  phase("detail");
  // (the roofs taken from the previous scenes' — planCache —, their share in this one [%])
  {
    const h = planCacheStats.hits - planHits0,
      m = planCacheStats.misses - planMisses0;
    phases["roofs kept %"] = h + m ? Math.round((100 * h) / (h + m)) : 0;
  }
  // (the chimneys near the camera — B9 —, within the budget)
  let stacks = 0;
  for (const b of planned) {
    const v = choices[b.i]!;
    const leaves = buildingLeaves({
      plans: b.plans,
      a: v.a,
      region,
      seed: b.seed,
      floor: b.base + v.low,
      bottom: b.base + v.low - 1,
      mesh: b.mesh,
      stacks: () => v.d < STACKS_M && storedBytes + 400 < room4,
      onStack: () => void (storedBytes += STACK_BYTES),
    });
    for (const p of leaves.prims) prims.push(p);
    for (const plan of b.plans) shapes[plan.shape] = (shapes[plan.shape] ?? 0) + 1;
    vertices += leaves.vertices;
    meshed += leaves.meshed;
    stacks += leaves.stacks;
    buildings++;
  }
  // (Q3 B4: the map's surfaces drawn once for the raster's ground — a texel read a pixel, not the surfaces' tree walked)
  // (review A5: the decals are the ground's — a deck's road not among them)
  const decals = makeDecals([...keptSurfaces.filter((p) => !isDeckRoad(p)), ...rowCrops]);
  phase("decals");
  // (Q8 D1: the wind turbines round the centre — Overture's base theme, its latest release that answers —, their triangles after
  // the bridges'; none on any failure, the scene whole)
  const turbines: TurbineMesh[] = [];
  const pylons: { positions: number[]; triangles: number[]; foot: [number, number, number]; h: number; along: number }[] = [];
  const pylonAt = new Map<string, Pylon & { lat: number; lon: number; d: number }>();
  // (each line's pylons in order — their keys —, its span: the conductors between consecutive ones)
  const cableChains: { keys: string[]; span: number }[] = [];
  const cables: { positions: number[]; triangles: number[] }[] = [];
  try {
    const infra = await infraTiles;
    if (infra) {
      const n13 = 2 ** TURBINE_Z;
      const found: (Turbine & { d: number })[] = [];
      for (const { t, raw } of infra) {
        if (!raw) continue;
        const layer = new VectorTile(new PbfReader(raw)).layers.infrastructure;
        if (!layer) continue;
        const geoOf = (gx: number, gy: number, e: number) => ({
          lon: ((t.x + gx / e) / n13) * 360 - 180,
          lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + gy / e)) / n13))) * 180) / Math.PI,
        });
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          // (a high-voltage line: a pylon at each of its vertices inside the tile — its nodes are its towers —, its arms across
          // the line's bearing there; a tower shared by two circuits once, the taller)
          if (f.type === 2 && f.properties.class === "power_line" && t.d <= PYLON_REACH_M) {
            let tags: Record<string, unknown> = {};
            try {
              tags = JSON.parse(String(f.properties.source_tags ?? "{}"));
            } catch {
              tags = {};
            }
            const volts = lineVolts(tags);
            if (volts < PYLON_MIN_VOLTS) continue;
            const e = f.extent;
            for (const line of f.loadGeometry()) {
              const pts = line.map((g) => {
                const q = geoOf(g.x, g.y, e);
                const lp = localPoint(frame, q.lat, q.lon, 0);
                return { ...q, x: lp[0], y: lp[1], inside: g.x > 0 && g.y > 0 && g.x < e && g.y < e };
              });
              const h = pylonHeight(volts),
                span = pylonSpan(volts);
              const chain: string[] = [];
              cableChains.push({ keys: chain, span });
              const put = (x: number, y: number, lat: number, lon: number, along: number) => {
                const d = Math.hypot(x, y);
                if (d > PYLON_REACH_M) return;
                const key = `${Math.round(x / 3)},${Math.round(y / 3)}`;
                chain.push(key);
                const had = pylonAt.get(key);
                if (!had || had.h < h) pylonAt.set(key, { x, y, h, along, lat, lon, d });
              };
              pts.forEach((p, k) => {
                const a = pts[Math.max(0, k - 1)]!,
                  b = pts[Math.min(pts.length - 1, k + 1)]!;
                if (p.inside) put(p.x, p.y, p.lat, p.lon, Math.atan2(b.y - a.y, b.x - a.x));
                // (along the segment to the next vertex at the span, its part inside the tile only)
                if (k + 1 >= pts.length) return;
                const nx = pts[k + 1]!,
                  L = Math.hypot(nx.x - p.x, nx.y - p.y),
                  n = Math.floor(L / span);
                for (let j = 1; j <= n && L - j * span > 0.4 * span; j++) {
                  const f = (j * span) / L;
                  const gx = line[k]!.x + (line[k + 1]!.x - line[k]!.x) * f,
                    gy = line[k]!.y + (line[k + 1]!.y - line[k]!.y) * f;
                  if (!(gx > 0 && gy > 0 && gx < e && gy < e)) continue;
                  put(
                    p.x + (nx.x - p.x) * f,
                    p.y + (nx.y - p.y) * f,
                    p.lat + (nx.lat - p.lat) * f,
                    p.lon + (nx.lon - p.lon) * f,
                    Math.atan2(nx.y - p.y, nx.x - p.x),
                  );
                }
              });
            }
            continue;
          }
          if (f.type !== 1 || f.properties.class !== "generator") continue;
          const g0 = f.loadGeometry()[0]?.[0];
          if (!g0) continue;
          const lon = ((t.x + g0.x / f.extent) / n13) * 360 - 180,
            lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + g0.y / f.extent)) / n13))) * 180) / Math.PI;
          const tb = turbineOf(f.properties as Record<string, unknown>, lat, lon);
          if (!tb) continue;
          const p = localPoint(frame, lat, lon, 0);
          const d = Math.hypot(p[0], p[1]);
          if (d <= TURBINE_REACH_M) found.push({ ...tb, d });
        }
      }
      found.sort((a, b) => a.d - b.d);
      for (const tb of found.slice(0, TURBINE_MAX)) {
        const p = localPoint(frame, tb.lat, tb.lon, heightNow(tb.lat, tb.lon) ?? (await height(tb.lat, tb.lon)));
        const m = turbineMesh(p[0], p[1], p[2], tb);
        const bytes = m.positions.length * 4 + m.triangles.length * 4 + (m.triangles.length / 3) * 4;
        if (storedBytes + bytes > budget - 2 * 1024 * 1024) break;
        storedBytes += bytes;
        turbines.push(m);
      }
    }
    const placedPylon = new Map<string, { p: Pylon & { d: number }; z0: number }>();
    for (const py of [...pylonAt.values()].sort((a, b) => a.d - b.d).slice(0, PYLON_MAX)) {
      const z0 = localPoint(frame, py.lat, py.lon, heightNow(py.lat, py.lon) ?? (await height(py.lat, py.lon)))[2];
      const m = pylonMesh(py, z0);
      const bytes = m.positions.length * 4 + m.triangles.length * 4 + (m.triangles.length / 3) * 4 + 32;
      if (storedBytes + bytes > budget - 2 * 1024 * 1024) break;
      storedBytes += bytes;
      pylons.push({ ...m, foot: [py.x, py.y, z0], h: py.h, along: py.along });
      placedPylon.set(`${Math.round(py.x / 3)},${Math.round(py.y / 3)}`, { p: py, z0 });
    }
    // (the conductors: between consecutive pylons of a line, both drawn, a span's length apart or so, within CABLE_REACH_M)
    let spans = 0;
    for (const c of cableChains)
      for (let k = 0; k + 1 < c.keys.length && spans < CABLE_SPANS_MAX; k++) {
        const A = placedPylon.get(c.keys[k]!),
          B = placedPylon.get(c.keys[k + 1]!);
        if (!A || !B || A === B) continue;
        const L = Math.hypot(B.p.x - A.p.x, B.p.y - A.p.y);
        if (L < 0.25 * c.span || L > 1.8 * c.span || Math.min(A.p.d, B.p.d) > CABLE_REACH_M) continue;
        const m = cableMesh(A.p, A.z0, B.p, B.z0);
        const bytes = m.positions.length * 4 + (m.triangles.length / 3) * 16;
        if (storedBytes + bytes > budget - 2 * 1024 * 1024) break;
        storedBytes += bytes;
        cables.push(m);
        spans++;
      }
  } catch (e) {
    if (surveyErrors.length < 4) surveyErrors.push(`turbines: ${String(e).slice(0, 200)}`);
  }
  // (Q8 D1: the cars — PLAN-J8 VB6 since 17 Nov 2026: each road's line, on the ground, one stream each way (traffic.ts carsAlong, the
  // approaches session's: one speed, phases from the abscissa — a car leaving a piece is the one entering the next), the nearest pieces
  // first; none on any failure)
  const onRunway = trafficRunwayMask(frame, runways, TRAFFIC_REACH_M + PIECE_M);
  let runwayCarsRejected = 0;
  try {
    // (the ground's height already in only — the scene not held for the traffic: a point without it ends the run there)
    // (RP6: a bridge's road on its deck — deckHeightAt; none where no deck was built: its cars left out there)
    let onBridge = false;
    let bridgeLayer = 1;
    const at = (q: { lat: number; lon: number }) => {
      if (onBridge) {
        const g = localPoint(frame, q.lat, q.lon, 0);
        const z = deckHeightAt(g[0], g[1], undefined, bridgeLayer);
        return z === null ? null : ([g[0], g[1], z] as [number, number, number]);
      }
      const h = heightNow(q.lat, q.lon);
      return h === undefined ? null : (localPoint(frame, q.lat, q.lon, h) as [number, number, number]);
    };
    // (a line's runs: its consecutive segments, each cut every PIECE_M at most on the ground)
    const runs: { pts: [number, number, number][]; cls: string; oneway: number }[] = [];
    for (const r of roadLines) {
      onBridge = !!r.bridge;
      bridgeLayer = r.layer ?? 1;
      let run: [number, number, number][] = [];
      let last: { lat: number; lon: number } | null = null;
      const close = () => {
        if (run.length >= 2) runs.push({ pts: run, cls: r.cls, oneway: r.oneway });
        run = [];
      };
      for (const sg of r.segs) {
        if (!last || last.lat !== sg.a.lat || last.lon !== sg.a.lon) {
          close();
          const pa = at(sg.a);
          if (pa) run.push(pa);
        }
        last = sg.b;
        const A = localPoint(frame, sg.a.lat, sg.a.lon, 0),
          B = localPoint(frame, sg.b.lat, sg.b.lon, 0);
        const n = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / PIECE_M));
        for (let k = 1; k <= n; k++) {
          const f1 = k / n;
          const pb = at({ lat: sg.a.lat + (sg.b.lat - sg.a.lat) * f1, lon: sg.a.lon + (sg.b.lon - sg.a.lon) * f1 });
          if (!pb) {
            close();
            last = null;
            break;
          }
          run.push(pb);
        }
      }
      close();
    }
    // (a piece's ends on the ground: carsAlong keeps the line's chords — its heights between them straight —, the run's own heights
    // read back at each end, the nearest point of the run)
    const groundOn = (pts: [number, number, number][], x: number, y: number) => {
      let best = Infinity,
        z = pts[0]![2];
      for (let k = 0; k + 1 < pts.length; k++) {
        const A = pts[k]!,
          B = pts[k + 1]!;
        const dx = B[0] - A[0],
          dy = B[1] - A[1];
        const t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (y - A[1]) * dy) / (dx * dx + dy * dy || 1)));
        const ex = A[0] + dx * t - x,
          ey = A[1] + dy * t - y;
        const d2 = ex * ex + ey * ey;
        if (d2 < best) {
          best = d2;
          z = A[2] + (B[2] - A[2]) * t;
        }
      }
      return z;
    };
    const pieces: { d: number; cars: SceneryCar[] }[] = [];
    runs.forEach((run, i) => {
      const ways: [number, number, number][][] = [];
      if (run.oneway >= 0) ways.push(run.pts);
      if (run.oneway <= 0) ways.push([...run.pts].reverse());
      ways.forEach((line, w) => {
        for (const pc of carsAlong(line, run.cls, i * 2 + 1 + w)) {
          if (!pc.cars.length) continue;
          if (onRunway?.(pc.a, pc.b)) {
            runwayCarsRejected += pc.cars.length;
            continue;
          }
          pc.a[2] = groundOn(run.pts, pc.a[0], pc.a[1]);
          pc.b[2] = groundOn(run.pts, pc.b[0], pc.b[1]);
          const d = Math.hypot((pc.a[0] + pc.b[0]) / 2, (pc.a[1] + pc.b[1]) / 2);
          if (d <= TRAFFIC_REACH_M) pieces.push({ d, cars: pc.cars });
        }
      });
    });
    pieces.sort((x, y) => x.d - y.d);
    pieceCount = pieces.length;
    let reach = TRAFFIC_REACH_M;
    for (const pc of pieces) {
      if (cars.length >= TRAFFIC_MAX) {
        reach = pc.d;
        break;
      }
      cars.push(...pc.cars);
    }
    cars.length = Math.min(cars.length, TRAFFIC_MAX);
    trafficReachM = reach;
    storedBytes += cars.length * (24 * 12 + 20 * 16 + 32);
  } catch (e) {
    if (surveyErrors.length < 4) surveyErrors.push(`traffic: ${String(e).slice(0, 200)}`);
  }
  // (PLAN-J8 VB4: the parked cars — the street cells' places within PARKED_REACH_M (street-cells.ts, the approaches' VB4 data; their
  // cells in the street cache — the far lamps' pool and the zones fill it), the nearest PARKED_MAX: each a car at rest (speed 0, its
  // piece a metre ahead) on its place, its shape by its seed (no bus), its lamps dark; on the left of its street it faces the other
  // way (driving on the right); the ground already in only, none on any failure)
  let parkedCars = 0,
    furnitureCount = 0;
  // (PLAN-J8 VB7: the junctions' furniture of the same cells — stop and yield lines, crossings, signals, guardrails —, its place and
  // way in the scene's frame, the ground under it)
  const furniture: {
    p: [number, number, number];
    u: [number, number];
    f: FurnitureRecord;
    r: number;
    o: { lat: number; lon: number };
    /** its cell writes FurnitureFlag.OnBridge (review A4) */
    bridgeFlagged: boolean;
  }[] = [];
  // (VB7: the signals' lit heads, drawn among the lamps' heads — packScenery's `signal`)
  const signalHeads: { positions: number[]; triangles: number[]; signal: number }[] = [];
  if ((q.parkedCars || q.furniture) && typeof caches !== "undefined")
    try {
      const store = await caches.open(STREET_CACHE);
      const dLat = PARKED_REACH_M / 111_000,
        dLon = PARKED_REACH_M / (111_000 * Math.max(0.1, Math.cos(q.lat * D)));
      const a = cellOf(q.lat - dLat, q.lon - dLon),
        b = cellOf(q.lat + dLat, q.lon + dLon);
      const found: { p: [number, number, number]; d: [number, number]; seed: number; r: number }[] = [];
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
        for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
          // (the road pass's read kept — a cell read once a scene: Cache Storage's match costs, 17 Nov 2026)
          const k = `${x}/${y}`;
          let buf = streetBufs.get(k);
          if (buf === undefined) {
            const res = await store.match(streetCacheUrl(self.location.origin, x, y));
            buf = res ? await res.arrayBuffer() : null;
          }
          if (!buf) continue;
          const h = readStreetHeader(buf);
          if (!h) continue;
          const o = cellOrigin(x, y);
          if (q.furniture)
            for (let i = 0; i < h.furnitureCount; i++) {
              const fr = readFurniture(buf, i);
              const g = fromCell(o, fr.east, fr.north);
              const z = heightNow(g.lat, g.lon);
              if (z === undefined) continue;
              const p = localPoint(frame, g.lat, g.lon, z) as [number, number, number];
              const r = Math.hypot(p[0], p[1]);
              if (r > FURNITURE_REACH_M) continue;
              const g2 = fromCell(o, fr.east + Math.cos(fr.heading), fr.north + Math.sin(fr.heading));
              const p2 = localPoint(frame, g2.lat, g2.lon, z);
              const L = Math.hypot(p2[0] - p[0], p2[1] - p[1]) || 1;
              furniture.push({
                p,
                u: [(p2[0] - p[0]) / L, (p2[1] - p[1]) / L],
                f: fr,
                r,
                o,
                bridgeFlagged: (h.flags & CellStreetFlag.FurnitureBridges) !== 0,
              });
            }
          for (let i = 0; i < (q.parkedCars ? h.placeCount : 0); i++) {
            const pl = readPlace(buf, i);
            const g = fromCell(o, pl.east, pl.north);
            const z = heightNow(g.lat, g.lon);
            if (z === undefined) continue;
            const p = localPoint(frame, g.lat, g.lon, z) as [number, number, number];
            const r = Math.hypot(p[0], p[1]);
            if (r > PARKED_REACH_M) continue;
            if (onRunway?.(p)) {
              runwayCarsRejected++;
              continue;
            }
            // (its direction in the scene's frame: a metre along the street's heading, the left side's turned round)
            const hd = pl.heading + (pl.flags & PlaceFlag.Left ? Math.PI : 0);
            const g2 = fromCell(o, pl.east + Math.cos(hd), pl.north + Math.sin(hd));
            const p2 = localPoint(frame, g2.lat, g2.lon, z);
            const dx = p2[0] - p[0],
              dy = p2[1] - p[1],
              L = Math.hypot(dx, dy) || 1;
            found.push({ p, d: [dx / L, dy / L], seed: pl.seed, r });
          }
        }
      found.sort((u, v) => u.r - v.r);
      for (const f of found.slice(0, Math.min(PARKED_MAX, 0x7fff - cars.length))) {
        // (the shapes are built in their lane LANE_M to the right of their piece: the piece moved as far to its left)
        const start: [number, number, number] = [f.p[0] - f.d[1] * LANE_M, f.p[1] + f.d[0] * LANE_M, f.p[2]];
        cars.push({
          start,
          end: [start[0] + f.d[0], start[1] + f.d[1], start[2]],
          speed: 0,
          phase: 0,
          kind: parkedKind(f.seed),
          lamps: false,
        });
        parkedCars++;
      }
      storedBytes += parkedCars * (16 * 12 + 22 * 16 + 32);
      // (VB7: the nearest pieces of furniture — the lines and crossings painted on the road (surface segments of kind 5 across it,
      // their pattern in data[6]: 0 a line, 1 a zebra, 2 a yield's dashes — trace.wgsl scenerySurface, over the road), the signals
      // and guardrails solids as a bridge's rails are)
      furniture.sort((u, v) => u.r - v.r);
      const WHITE = [0.62, 0.61, 0.55];
      for (const it of furniture.slice(0, FURNITURE_MAX)) {
        const { p, u, f } = it;
        const across: [number, number] = [-u[1], u[0]];
        const ends = (len: number) =>
          [
            [p[0] - (across[0] * len) / 2, p[1] - (across[1] * len) / 2, p[2]],
            [p[0] + (across[0] * len) / 2, p[1] + (across[1] * len) / 2, p[2]],
          ] as [[number, number, number], [number, number, number]];
        if (f.kind === FurnitureKind.StopLine || f.kind === FurnitureKind.Crossing) {
          const cross = f.kind === FurnitureKind.Crossing;
          const [a, b] = ends(f.length);
          const seg = surfaceSegment(a, b, cross ? 4 : 0.5, 5, WHITE);
          seg.data[6] = cross ? 1 : f.flags & FurnitureFlag.Yield ? 2 : 0;
          keptSurfaces.push(seg);
          storedBytes += 64 + seg.data.length * 4;
        } else if (f.kind === FurnitureKind.Signal) {
          const pole = [stripPolygon([p[0] - u[0] * 0.07, p[1] - u[1] * 0.07, 0], [p[0] + u[0] * 0.07, p[1] + u[1] * 0.07, 0], 0.14)];
          addSolid(polygonPrimitive(pole, p[2], p[2] + 3.3, 3, [0.12, 0.12, 0.13]), pole);
          const head = [stripPolygon([p[0] - u[0] * 0.13, p[1] - u[1] * 0.13, 0], [p[0] + u[0] * 0.13, p[1] + u[1] * 0.13, 0], 0.32)];
          addSolid(polygonPrimitive(head, p[2] + 2.3, p[2] + 3.2, 3, [0.04, 0.04, 0.045]), head);
          // (its light: a lamp's head quad on the head's face towards the traffic coming in — u the way out of the junction —, its
          // phase the junction's (its place to 40 m) and its axis's (the two crossing ways half a cycle apart))
          const hx = p[0] + u[0] * 0.2,
            hy = p[1] + u[1] * 0.2,
            hz = p[2] + 2.75;
          const jx = Math.round(p[0] / 40),
            jy = Math.round(p[1] / 40);
          const seed = Math.abs(Math.sin(jx * 12.9898 + jy * 78.233) * 43758.5453) % 1;
          const axis = Math.abs(u[0]) >= Math.abs(u[1]) ? 0 : 0.5;
          signalHeads.push({
            positions: Array.from({ length: 12 }, () => [hx, hy, hz]).flat(),
            triangles: [0, 1, 3, 0, 3, 2, 4, 5, 7, 4, 7, 6, 8, 9, 10, 8, 10, 11],
            signal: (seed + axis) % 1,
          });
        } else if (f.kind === FurnitureKind.TunnelPortal) {
          // (PLAN-J8 J8-RP RP8: a tunnel's mouth — its heading into the tunnel, its length the carriageway's width —: two concrete
          // jambs and a lintel over the road's width, the mouth's dark a metre inside)
          const w = Math.max(4, f.length) / 2 + 0.6;
          const jamb = (k: number) => {
            const c: [number, number, number] = [p[0] + across[0] * k * w, p[1] + across[1] * k * w, 0];
            return [stripPolygon([c[0] - u[0] * 0.6, c[1] - u[1] * 0.6, 0], [c[0] + u[0] * 0.6, c[1] + u[1] * 0.6, 0], 1.2)];
          };
          for (const k of [-1, 1]) addSolid(polygonPrimitive(jamb(k), p[2] - 1, p[2] + 6.5, 3, [0.46, 0.45, 0.42]), jamb(k));
          const [la, lb] = ends(2 * w + 1.2);
          const lintel = [stripPolygon(la, lb, 1.2)];
          addSolid(polygonPrimitive(lintel, p[2] + 5.2, p[2] + 6.5, 3, [0.46, 0.45, 0.42]), lintel);
          const [da, db] = ends(2 * w - 0.4);
          const shift: [number, number] = [u[0] * 1.2, u[1] * 1.2];
          const dark = [stripPolygon([da[0] + shift[0], da[1] + shift[1], 0], [db[0] + shift[0], db[1] + shift[1], 0], 0.3)];
          addSolid(polygonPrimitive(dark, p[2] - 0.5, p[2] + 5.3, 3, [0.008, 0.008, 0.009]), dark);
        } else if (f.kind === FurnitureKind.Guardrail) {
          // (its rail in pieces of 20 m at most. Review A4: a bridge's rail — FurnitureFlag.OnBridge, written since the flag; an older
          // cell's: a rail lying along a deck within its width — on the deck the registry finds there by place (the ground under it
          // asked for that deck's height found none: every bridge rail fell to the ground), a beam following the deck's slope, its
          // top's plane the contact's; the others on the ground at their middle)
          const n = Math.max(1, Math.ceil(f.length / 20));
          const maybeBridge = it.bridgeFlagged ? (f.flags & FurnitureFlag.OnBridge) !== 0 : true;
          for (let k = 0; k < n; k++) {
            const s0 = -f.length / 2 + (f.length * k) / n,
              s1 = -f.length / 2 + (f.length * (k + 1)) / n;
            const at = (sv: number) => fromCell(it.o, f.east + Math.cos(f.heading) * sv, f.north + Math.sin(f.heading) * sv);
            const ga = at(s0),
              gb = at(s1),
              gm = at((s0 + s1) / 2);
            const m0 = localPoint(frame, gm.lat, gm.lon, 0);
            const deck = maybeBridge ? bridgeRegistry.queryBridgeAt(m0[0], m0[1], { margin: 1.5, deckTop: true }) : null;
            const along = deck
              ? Math.abs(deck.tangent[0] * u[0] + deck.tangent[1] * u[1]) / (Math.hypot(deck.tangent[0], deck.tangent[1]) || 1)
              : 0;
            if (deck && (it.bridgeFlagged || along > 0.98)) {
              const a = localPoint(frame, ga.lat, ga.lon, 0),
                b = localPoint(frame, gb.lat, gb.lon, 0);
              const za = deckHeightAt(a[0], a[1], deck.elevation, undefined, 1.5) ?? deck.elevation,
                zb = deckHeightAt(b[0], b[1], deck.elevation, undefined, 1.5) ?? deck.elevation;
              const beam = buildContinuousSliceMesh({
                pa: [a[0], a[1], 0],
                pb: [b[0], b[1], 0],
                width: 0.12,
                top0: za + 0.8,
                top1: zb + 0.8,
                thick: 0.25,
                isStart: true,
                isEnd: true,
              });
              const ring = ringOf(beam);
              addSolid(
                withPlane(
                  polygonPrimitive([ring], Math.min(za, zb) + 0.55, Math.max(za, zb) + 0.8, 3, [0.48, 0.49, 0.5]),
                  computeSlicePlane([a[0], a[1], 0], [b[0], b[1], 0], za + 0.8, zb + 0.8),
                  0.25,
                ),
                [ring],
                beam,
              );
              continue;
            }
            const z0 = heightNow(gm.lat, gm.lon);
            if (z0 === undefined) continue;
            const a = localPoint(frame, ga.lat, ga.lon, z0),
              b = localPoint(frame, gb.lat, gb.lon, z0);
            const rail = [stripPolygon(a, b, 0.12)];
            const base = localPoint(frame, gm.lat, gm.lon, z0)[2];
            addSolid(polygonPrimitive(rail, base + 0.55, base + 0.8, 3, [0.48, 0.49, 0.5]), rail);
          }
        }
        furnitureCount++;
      }
    } catch (e) {
      if (surveyErrors.length < 4) surveyErrors.push(`parked cars: ${String(e).slice(0, 200)}`);
    }
  // (Q8 L10: the streets' lamps — along the town streets' runs where buildings stand about, the nearest first, their feet on the
  // ground already in (none without it) — and their light's grid; none on any failure)
  try {
    // (the town: the scene's buildings and those left to their mesh cells — `cut`'s footprints: with J8-8 the BD TOPO's are all there,
    // none in `prims`; without them the near lamps of France were gone, the far layer's left out within LAMP_REACH_M all the same — a
    // dark hole round the scene at night, 17 Nov 2026)
    const town = builtUp([
      ...prims.filter((p) => p.data[3] === 1).map((p) => [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2] as [number, number]),
      ...cut.map((v) => {
        const c = localPoint(frame, v.lat, v.lon, 0);
        return [c[0], c[1]] as [number, number];
      }),
    ]);
    const all: (StreetLamp & { d: number })[] = [];
    for (const r of q.lamps === false ? [] : lampLines)
      for (const l of lampsAlong(r.xy, r.cls, r.width)) {
        const d = Math.hypot(l.foot[0], l.foot[1]);
        if (d > LAMP_REACH_M || !town(l.foot[0], l.foot[1])) continue;
        const a = r.geo[l.seg]!,
          b = r.geo[l.seg + 1]!;
        // (RP6: a bridge's lamp on its deck — none where no deck was built)
        if (r.bridge) {
          // (review A9: its foot — set beside the carriageway, often past the deck's edge — brought onto the deck inside its parapet,
          // on the deck's top there: none where no deck stands)
          const foot = bridgeRegistry.snapOnDeck(l.foot[0], l.foot[1], { expectedLevel: r.layer, margin: 3, inset: 0.4 });
          if (!foot) continue;
          const [fx, fy, zd] = foot;
          all.push({ ...l, foot: [fx, fy, zd], d });
          continue;
        }
        const h = heightNow(a.lat + (b.lat - a.lat) * l.frac, a.lon + (b.lon - a.lon) * l.frac);
        if (h === undefined) continue;
        // (the ground's height over the frame's plane there: the frame's local z of the foot at that height)
        const z = localPoint(frame, a.lat + (b.lat - a.lat) * l.frac, a.lon + (b.lon - a.lon) * l.frac, h)[2];
        all.push({ ...l, foot: [l.foot[0], l.foot[1], z], d });
      }
    all.sort((x, y) => x.d - y.d);
    lamps = all.slice(0, LAMP_MAX);
    lampReachM = q.lamps === false ? 0 : all.length > LAMP_MAX ? all[LAMP_MAX]!.d : LAMP_REACH_M;
    if (lamps.length) lampGrid = lampLight(lamps);
    storedBytes += lamps.length * (12 * 12 + 6 * 16) + (lampGrid?.length ?? 0);
  } catch (e) {
    if (surveyErrors.length < 4) surveyErrors.push(`lamps: ${String(e).slice(0, 200)}`);
  }
  // (PLAN-J8 J8-VB VB2: the roads' markings, kerbs and pavements — street-detail-prep.ts segmentSurface's rules, KSC3's —, from the
  // scene's own lines: their class, their width (OpenMapTiles' by class — the BD TOPO's measured ones are the cells'), their lanes by
  // the width (3.25 m each, two at least both ways), their way, the town at their middle; packed in the segment's free pair: data[6]
  // the flags (SurfaceFlag) + 16 one way + 32 lane lines + 512 the pavement [dm], data[7] the carriageway's half-width — a kerbed one's
  // record widened by its pavements (trace.wgsl scenerySurface paints them))
  try {
    const town = builtUp([
      ...prims.filter((p) => p.data[3] === 1).map((p) => [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2] as [number, number]),
      ...cut.map((v) => {
        const c = localPoint(frame, v.lat, v.lon, 0);
        return [c[0], c[1]] as [number, number];
      }),
    ]);
    for (const p of keptSurfaces)
      if (!cellRoads.has(p)) markRoad(p, town((p.data[0]! + p.data[2]!) / 2, (p.data[1]! + p.data[3]!) / 2), omtMaterial.get(p));
  } catch (e) {
    if (surveyErrors.length < 4) surveyErrors.push(`road markings: ${String(e).slice(0, 200)}`);
  }
  phase("turbines");
  const buffer = packScenery(
    prims,
    pixels,
    keptSurfaces,
    { frame: ff, cells, trees },
    N,
    budget,
    decals,
    turbines,
    pylons,
    cables,
    cars,
    // (PLAN-J8 VB5a: each lamp's shape from its foot's place — the frame's flat inverse, to the metre)
    [
      ...lamps.map((l) =>
        lampMesh(l, lampShape(q.lat + l.foot[1] / 111_132, q.lon + l.foot[0] / (111_320 * Math.max(0.05, Math.cos(q.lat * D))))),
      ),
      ...signalHeads,
    ],
    lampGrid,
    structCables,
  );
  return {
    id: q.id,
    lat: q.lat,
    lon: q.lon,
    bounds,
    buffer,
    trees,
    surveyedTrees,
    cutBuildings,
    keptReachM,
    meshLeft,
    forestPrepared: prepared
      ? { cells: prepared.cells, missing: prepared.missing, noCanopy: prepared.noCanopy, cases: prepared.cases, bdtopoSkipped }
      : null,
    clearedTrees,
    cutHousesMs,
    corridor: q.corridor === true,
    corridorM,
    corridorA,
    bdtopoBuildings,
    bdtopoTiles: bdtopoTileCount,
    overtureBuildings,
    overtureTiles: overtureTileCount,
    turbines: turbines.length,
    pylons: pylons.length,
    cables: cables.length,
    cars: cars.length,
    runwayCarsRejected,
    parkedCars,
    furniture: furnitureCount,
    cellRoads: cellRoadCount,
    cellRoadCells,
    streetMissing: [...new Set(streetMissing)].slice(0, 256),
    cellBridges: cellBridgeCount,
    catenaryMasts: catenaryCount,
    trafficRoads: roadLines.length,
    lamps: lamps.length,
    lampReachM,
    trafficReachM,
    rowCrops: rowCrops.length,
    roadPieces: pieceCount,
    surveyRequests: land?.requests ?? 0,
    // (a block failed: its trees the land cover's — the scene not degraded for it)
    surveyError: land?.errors[0] ?? surveyErrors[0],
    forestCells: ff.w * ff.h,
    forestCellM: ff.cell,
    buildings,
    vertices,
    roofShapes: shapes,
    meshedBuildings: meshed,
    lidarRoofs,
    stacks,
    meshBytes,
    bytes: {
      forest: forestVec4s(ff) * 16,
      raster: pixels.byteLength,
      before: bytesBefore,
      buildings: storedBytes - bytesBefore - meshBytes,
      budget,
    },
    roads: keptSurfaces.filter((v) => v.data.length === 12 && v.data[5] === 1).length,
    railways: keptSurfaces.filter((v) => v.data.length === 12 && v.data[5] === 2).length,
    waterways: keptSurfaces.filter((v) => v.data.length === 12 && v.data[5] === 3).length,
    waterPolygons: keptSurfaces.filter((v) => v.data.length > 12 && v.data[3] === 4).length,
    pavedPolygons: keptSurfaces.filter((v) => v.data.length > 12 && v.data[3] === 5).length,
    bridges,
    bridgePiers,
    notableBridges,
    // (25 Nov 2026: the decks considered, left out past their share, their bytes and share; those on a surveyed profile — format 6)
    bridgeCandidates,
    bridgesDropped,
    bridgeBytes,
    bridgeShare: Math.round(bridgeShare),
    measuredBridges,
    osmLayers,
    coverPixels: classes.reduce((s, v) => s + Number(v > 0), 0),
    rgbPixels,
    networkBytes,
    zoneResponses: served.zone,
    otherResponses: served.other,
    workerMs: performance.now() - started,
    phases,
    fetchCache: { ...fetchCacheStats, bytes: fetchCacheBytes },
    errors: errors.slice(0, 12),
    budgetLimited,
  };
}
/** the scenes given up by the page (their ids): dropped at their next step, their fetches aborted, the worker and its caches kept */
const cancelled = new Set<number>();
/** the scenes under way, their fetches' abort */
const aborts = new Map<number, AbortController>();
g.onmessage = async (e: MessageEvent<SceneryRequest | { cancel: number }>) => {
  if ("cancel" in e.data) {
    cancelled.add(e.data.cancel);
    aborts.get(e.data.cancel)?.abort();
    if (cancelled.size > 64) cancelled.delete(cancelled.values().next().value!);
    return;
  }
  try {
    const r = await prepare(e.data);
    g.postMessage(r, [r.buffer!]);
  } catch (e0) {
    g.postMessage({ id: e.data.id, lat: e.data.lat, lon: e.data.lon, error: String(e0).slice(0, 240) });
  } finally {
    aborts.delete(e.data.id);
  }
};
