// Worldwide data preparation is isolated from the render loop. No complete COG download.
import { carsAlong, LANE_M, PIECE_M, ROAD_TRAFFIC, TRAFFIC_MAX, TRAFFIC_REACH_M } from "./traffic";
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
import { PlaceFlag, readPlace, readStreetHeader, STREET_CACHE, streetCacheUrl } from "./street-cells";

/** (PLAN-J8 VB4) the parked cars kept round the scene's centre [m] and at most (the nearest places first) */
export const PARKED_REACH_M = 900;
export const PARKED_MAX = 2500;
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
  // (lot 3: every cell under the frame prepared and usable — none missing, none without the canopy the scene has)
  const forestWhole = preparedP.then((p) => !!p && p.missing === 0 && p.noCanopy === 0 && p.cases > 0);
  // (Q8 D1: the main roads' segments for the traffic, and the cars on them)
  const roadLines: { segs: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }[]; cls: string; oneway: number }[] = [];
  // (Q8 D1: the vineyards' and orchards' polygons, for the decals alone)
  const rowCrops: Primitive[] = [];
  // (Q8 L10: the town streets' runs near, the lamps set along them at the end)
  const lampLines: { xy: [number, number][]; geo: { lat: number; lon: number }[]; cls: string; width: number }[] = [];
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
    bridgePiers = 0;
  const surfaces: Primitive[] = [];
  const bridgeLines: { line: { lat: number; lon: number }[]; width: number; layer: number; d: number; water: boolean }[] = [];
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
          const color = water
            ? [0.018, 0.052, 0.055]
            : rail
              ? [0.1, 0.085, 0.06]
              : props.surface === "unpaved" || cls === "track"
                ? [0.19, 0.145, 0.095]
                : [0.095, 0.098, 0.1];
          for (const line of f.loadGeometry()) {
            const locals = line.map(point);
            // (Q8 D1: a main road's segments — their middles in the tile — for the traffic, not on a bridge nor in a tunnel)
            if (!water && !rail && ROAD_TRAFFIC[cls] && !props.brunnel) {
              const segs: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }[] = [];
              for (let j = 0; j < line.length - 1; j++) {
                const mx = (line[j]!.x + line[j + 1]!.x) / 2,
                  my = (line[j]!.y + line[j + 1]!.y) / 2;
                if (mx < 0 || mx >= e || my < 0 || my >= e) continue;
                if (Math.min(Math.hypot(locals[j]![0], locals[j]![1]), Math.hypot(locals[j + 1]![0], locals[j + 1]![1])) > TRAFFIC_REACH_M)
                  continue;
                segs.push({ a: geo(line[j]!), b: geo(line[j + 1]!) });
              }
              if (segs.length) roadLines.push({ segs, cls, oneway: Number(props.oneway) || 0 });
            }
            // (Q8 L10: a town street's runs — its consecutive segments with their middles in the tile, near — for the lamps)
            if (!water && !rail && LAMP_CLASSES[cls] && !props.brunnel) {
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
                  run = { xy: [[locals[j]![0], locals[j]![1]]], geo: [geo(line[j]!)], cls, width };
                  lampLines.push(run);
                }
                run.xy.push([locals[j + 1]![0], locals[j + 1]![1]]);
                run.geo.push(geo(line[j + 1]!));
              }
            }
            if (props.brunnel === "bridge") {
              // Buffered whole lines are owned by their midpoint's tile; omit duplicate volumes.
              const mid = line[Math.floor(line.length / 2)];
              if (mid && mid.x >= 0 && mid.x < e && mid.y >= 0 && mid.y < e && line.length < 512) {
                const d = Math.min(...locals.map((p) => Math.hypot(p[0], p[1])));
                if (d < radius + 250)
                  bridgeLines.push({ line: line.map(geo), width, layer: Math.max(1, Math.min(5, Number(props.layer) || 1)), d, water });
              }
              if (!water) continue; // Ground markings must not appear underneath a raised deck.
            }
            for (let j = 0; j < locals.length - 1; j++) {
              const a = locals[j]!,
                b = locals[j + 1]!,
                aa = line[j]!,
                bb = line[j + 1]!;
              const mx = (aa.x + bb.x) / 2,
                my = (aa.y + bb.y) / 2;
              if (mx < 0 || mx >= e || my < 0 || my >= e || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.1) continue;
              const p = surfaceSegment(a, b, width, water ? 3 : rail ? 2 : 1, color);
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
  const bridgeLimit = Math.round((q.mode === "high" ? 256 : 128) * k2);
  if (bridgeLines.length + bridgeAreas.length > bridgeLimit) budgetLimited = true;
  // (a bridge's part with its triangles — a flat-topped prism, buildingMesh's —: the trees' and buildings' shadow map draws it
  // as it is, whatever its outline — a deck's OSM area, a strip —, scenery-raster.ts; the view leaves it to the tracer's test)
  const addSolid = (p: Primitive | null, rings?: number[][][]) => {
    const mesh =
      p && rings
        ? buildingMesh(
            rings.map((r) => r.map((v) => [v[0]!, v[1]!] as [number, number])),
            p.data[0]!,
            p.data[0]!,
            [[0, 0, p.data[1]! - p.data[0]!]],
          )
        : null;
    const meshB = mesh ? mesh.positions.length * 4 + mesh.triangles.length * 4 : 0;
    if (!p || storedBytes + 64 + p.data.length * 4 + meshB > budget - 6 * 1024 * 1024 * room) {
      budgetLimited = true;
      return false;
    }
    if (mesh && mesh.triangles.length) p.mesh = mesh;
    prims.push(p);
    storedBytes += 64 + p.data.length * 4 + meshB;
    return true;
  };
  const selectedAreas: Primitive[] = [];
  bridgeAreas.sort((a, b) => a.d - b.d);
  for (const v of bridgeAreas.slice(0, bridgeLimit)) {
    try {
      const outer = v.rings[0]!;
      const lat = outer.reduce((sum, p) => sum + p.lat, 0) / outer.length,
        lon = outer.reduce((sum, p) => sum + p.lon, 0) / outer.length;
      // (its deck over its banks — the highest of its outline's ground, as a bridge line's —, not over the water at its middle:
      // a deck 4 m over the river, under its quays, its shadow hidden beneath it)
      let base = localPoint(frame, lat, lon, await height(lat, lon))[2];
      const step = Math.max(1, Math.floor(outer.length / 16));
      for (let i = 0; i < outer.length; i += step)
        base = Math.max(base, localPoint(frame, outer[i]!.lat, outer[i]!.lon, await height(outer[i]!.lat, outer[i]!.lon))[2]);
      const rings = v.rings.map((r) => r.map((at) => localPoint(frame, at.lat, at.lon, 0)));
      const p = polygonPrimitive(rings, base + 4 * v.layer - 1.2, base + 4 * v.layer, 2, [0.095, 0.098, 0.1]);
      if (addSolid(p, rings)) {
        bridges++;
        selectedAreas.push(v.footprint);
      }
    } catch (e) {
      if (!errors.length) errors.push(String(e).slice(0, 220));
    }
  }
  for (const v of bridgeLines) {
    if (bridges >= bridgeLimit) break;
    try {
      const mid = v.line[Math.floor(v.line.length / 2)]!;
      const at = localPoint(frame, mid.lat, mid.lon, 0);
      if (selectedAreas.some((p) => surfaceContains(at, p))) continue;
      const points = [];
      for (const at of v.line) points.push(localPoint(frame, at.lat, at.lon, await height(at.lat, at.lon)));
      const top = Math.max(...points.map((p) => p[2])) + 4 * v.layer;
      let made = false,
        distance = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!,
          b = points[i + 1]!,
          length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 0.5) continue;
        // (each part with its triangles — its strip's outline —: the view draws them as the buildings', 2 Nov 2026; before, their
        // boxes marked the pixels the tracer's rays then shaded, 6.5 ms of kerr-mini's frame over the Seine)
        const deck = [stripPolygon(a, b, v.width)];
        made =
          addSolid(polygonPrimitive(deck, top - 1.2, top, v.water ? 4 : 2, v.water ? [0.018, 0.052, 0.055] : [0.095, 0.098, 0.1]), deck) ||
          made;
        for (const side of [-1, 1]) {
          const rail = [stripPolygon(a, b, 0.28, (side * v.width) / 2)];
          addSolid(polygonPrimitive(rail, top, top + 1, 3, [0.28, 0.27, 0.25]), rail);
        }
        // Generic piers every 40 m, excluding the short spans. Anchored below the filtered DEM.
        for (let d = 20 - (distance % 40); d < length; d += 40) {
          if (d < 2 || d > length - 2) continue;
          const t = d / length,
            p: [number, number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
          const pier = [stripPolygon([p[0] - 1, p[1], 0], [p[0] + 1, p[1], 0], Math.min(3, v.width * 0.5))];
          if (addSolid(polygonPrimitive(pier, p[2] - 5, top - 1.2, 3, [0.27, 0.26, 0.24]), pier)) bridgePiers++;
        }
        distance += length;
      }
      if (made) bridges++;
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
  for (const v of [...keptSurfaces, ...prims.filter((p) => p.data[3] === 2 || p.data[3] === 4)]) {
    for (let y = Math.floor((v.min[1] - 7) / 64); y <= Math.floor((v.max[1] + 7) / 64); y++)
      for (let x = Math.floor((v.min[0] - 7) / 64); x <= Math.floor((v.max[0] + 7) / 64); x++) {
        const key = cellKey(x, y),
          cell = surfaceCells.get(key) ?? [];
        cell.push(v);
        surfaceCells.set(key, cell);
      }
  }
  const networkExcludedAt = (p: Vec3) =>
    surfaceCells.get(cellKey(Math.floor(p[0] / 64), Math.floor(p[1] / 64)))?.some((v) => surfaceContains(p, v, 7)) ?? false;
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
      return networkExcludedAt(p) || housedAt(p);
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
  const decals = makeDecals([...keptSurfaces, ...rowCrops]);
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
  try {
    // (the ground's height already in only — the scene not held for the traffic: a point without it ends the run there)
    const at = (q: { lat: number; lon: number }) => {
      const h = heightNow(q.lat, q.lon);
      return h === undefined ? null : (localPoint(frame, q.lat, q.lon, h) as [number, number, number]);
    };
    // (a line's runs: its consecutive segments, each cut every PIECE_M at most on the ground)
    const runs: { pts: [number, number, number][]; cls: string; oneway: number }[] = [];
    for (const r of roadLines) {
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
          pc.a[2] = groundOn(run.pts, pc.a[0], pc.a[1]);
          pc.b[2] = groundOn(run.pts, pc.b[0], pc.b[1]);
          const d = Math.hypot((pc.a[0] + pc.b[0]) / 2, (pc.a[1] + pc.b[1]) / 2);
          if (d <= TRAFFIC_REACH_M && pc.cars.length) pieces.push({ d, cars: pc.cars });
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
  let parkedCars = 0;
  if (q.parkedCars && typeof caches !== "undefined")
    try {
      const store = await caches.open(STREET_CACHE);
      const dLat = PARKED_REACH_M / 111_000,
        dLon = PARKED_REACH_M / (111_000 * Math.max(0.1, Math.cos(q.lat * D)));
      const a = cellOf(q.lat - dLat, q.lon - dLon),
        b = cellOf(q.lat + dLat, q.lon + dLon);
      const found: { p: [number, number, number]; d: [number, number]; seed: number; r: number }[] = [];
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
        for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
          const res = await store.match(streetCacheUrl(self.location.origin, x, y));
          if (!res) continue;
          const buf = await res.arrayBuffer();
          const h = readStreetHeader(buf);
          if (!h) continue;
          const o = cellOrigin(x, y);
          for (let i = 0; i < h.placeCount; i++) {
            const pl = readPlace(buf, i);
            const g = fromCell(o, pl.east, pl.north);
            const z = heightNow(g.lat, g.lon);
            if (z === undefined) continue;
            const p = localPoint(frame, g.lat, g.lon, z) as [number, number, number];
            const r = Math.hypot(p[0], p[1]);
            if (r > PARKED_REACH_M) continue;
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
    } catch (e) {
      if (surveyErrors.length < 4) surveyErrors.push(`parked cars: ${String(e).slice(0, 200)}`);
    }
  // (Q8 L10: the streets' lamps — along the town streets' runs where buildings stand about, the nearest first, their feet on the
  // ground already in (none without it) — and their light's grid; none on any failure)
  try {
    const town = builtUp(
      prims.filter((p) => p.data[3] === 1).map((p) => [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2] as [number, number]),
    );
    const all: (StreetLamp & { d: number })[] = [];
    for (const r of q.lamps === false ? [] : lampLines)
      for (const l of lampsAlong(r.xy, r.cls, r.width)) {
        const d = Math.hypot(l.foot[0], l.foot[1]);
        if (d > LAMP_REACH_M || !town(l.foot[0], l.foot[1])) continue;
        const a = r.geo[l.seg]!,
          b = r.geo[l.seg + 1]!;
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
    storedBytes += lamps.length * (8 * 12 + 4 * 16) + (lampGrid?.length ?? 0);
  } catch (e) {
    if (surveyErrors.length < 4) surveyErrors.push(`lamps: ${String(e).slice(0, 200)}`);
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
    lamps.map((l) =>
      lampMesh(l, lampShape(q.lat + l.foot[1] / 111_132, q.lon + l.foot[0] / (111_320 * Math.max(0.05, Math.cos(q.lat * D))))),
    ),
    lampGrid,
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
    parkedCars,
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
