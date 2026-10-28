import { holeFleet } from "./holefleet";
import { worldRunwaysNow, worldRunwaysUpdate } from "./world/runways3d";
import { streamingLead, aheadFocus, gazeLead } from "./system/streaming-focus";
import { TerrainCache } from "./system/terrain-cache";
import { composeTracer } from "./system/tracer-source";
import {
  FEATURES_ALL,
  FEATURE_RASTER_PRIMARY,
  FEATURE_TERRAIN_CACHE,
  FEATURE_TERRAIN_RASTER,
  NEAR_KIND_SHIFT,
  tracerConstants,
  tracerEntryPoint,
} from "./system/tracer-kernels";
import { WgslSpecialiser } from "./system/wgsl-specialise";
import { RASTER_HINT_BINDING, RASTER_HINT_TEXTURE_LIMIT, SUN_SHADOW_BINDING, SUN_SHADOW_TEXTURE_LIMIT } from "./system/terrain-raster-hint";
import {
  TERRAIN_CACHE_LEVELS,
  TERRAIN_CACHE_MAX_LAT,
  TERRAIN_CACHE_PATCH_REF,
  TERRAIN_CACHE_RING_LAST,
  TERRAIN_CACHE_ROUNDS,
  TERRAIN_CACHE_VEC4S,
  type TerrainWindow,
} from "./system/terrain-cache-layout";
import { TerrainRaster, type TerrainRing } from "./system/terrain-raster";
import {
  SCENERY_RASTER_LOD,
  SceneryRaster,
  type SceneryRasterLod,
  TREE_SHADOW_DEPTH_M,
  TREE_SHADOW_HALF_M,
  TREE_SHADOW_N,
} from "./system/scenery-raster";
import { CLOUD_PASS_BINDINGS, CLOUD_PASS_FLAG, CLOUD_PASS_TEXTURE_LIMIT } from "./system/cloud-pass";
import { Lightning } from "./system/lightning";
import { TREE_SHADOW_BINDING, TREE_SHADOW_TEXTURE_LIMIT } from "./system/tree-shadow";
import { CLOUD_SHADOW_BINDING, CLOUD_SHADOW_TEXTURE_LIMIT, CSM_HALF_M, CSM_N } from "./system/cloud-shadow";
import { TERRAIN_RASTER_MAX_PIXELS, terrainRasterFrame } from "./system/terrain-raster-frame";
import type { NetWalkerHome } from "./controller/netcraft";
import { CharacterRenderer, type GrassView } from "./character-renderer";
import type { PlanetCharacter } from "./controller/character";
import { dot as dot3 } from "./math/vec3";
import { sphericalFrame } from "./wormhole";
import traceWGSL from "./shaders/trace.wgsl" with { type: "text" };
import seafftWGSL from "./shaders/seafft.wgsl" with { type: "text" };
import { SEA_TEXTURE_LIMIT, SeaFft } from "./sea/fft-gpu";
import { normalQuantile, seaCascades, seaSystems } from "./sea/spectrum";
import { MarineFeed, type SeaState, windSea } from "./sea/marine";
import { forestSource } from "./forest-shader";
import { lampsOf } from "./cockpit/lights";
import { EARTH_RUNWAYS, landingEnd, RUNWAY_LENGTH, runwayGrade, runwayPaved } from "./game/sites";
import {
  bodyAxes,
  daysOf,
  M_METRES,
  mapIndex,
  SOLAR_BODIES,
  seenFrom,
  solarBody,
  solarState,
  sunShare,
  type MapName,
  utcOf,
} from "./system/solar";
import { buildDayClouds, dayCloudsFor, dayCloudsUrl } from "./system/day-clouds";
import { refractionParams, seaRefractivity } from "./system/refraction";
import { moonLightShare, SHADE_VEC4S, shadowParams } from "./eclipse/shadows-gpu";
import { lookOf } from "./skychart";
import { HD_SETS, hdColorFormat, loadHdMap, placeholderHd, type HdMap } from "./system/hd-maps";
import { bakeNoise3d } from "./noise3d";
import { AsyncResource, CompileQueue } from "./util/async-resource";
import { visibleTimeout } from "./util/visible-timeout";
import { automaticQuality, earthDetailFor, effectiveQuality, earthMapQuality } from "./quality-policy";
import { adapterId, guessTier, rememberedLevel, tierAt, type Tier } from "./tier";
import displayWGSL from "./shaders/display.wgsl" with { type: "text" };
import {
  PATH_CHUNK,
  PATH_MAX,
  SH_VEC4S,
  SKY_AMBIENT_VEC4S,
  CSM_VEC4S,
  TABLE_CSM,
  TABLE_TSM,
  TABLE_GEOID,
  TABLE_ORTHO,
  TABLE_LUT,
  TABLE_PATH,
  TABLE_SKY,
  TABLE_SUN,
  TABLE_VEC4S,
  TABLE_WALK,
  TABLE_WARP,
} from "./gpu-tables";
import postWGSL from "./shaders/post.wgsl" with { type: "text" };
import maskWGSL from "./shaders/mask.wgsl" with { type: "text" };
import { AERIAL_TEXTURE_LIMIT } from "./system/aerial";
import { detailMargin, horizonsReach, MapCells } from "./system/relief-ceiling";
import skyWGSL from "./shaders/sky.wgsl" with { type: "text" };
import shipWGSL from "./shaders/ship.wgsl" with { type: "text" };
import enduranceWGSL from "./shaders/endurance.wgsl" with { type: "text" };
import stationWGSL from "./shaders/station.wgsl" with { type: "text" };
import { ENV_H, ownPose, ShipRenderer, type Reentry, type ShipInstance, type ShipMeshId, type ShipView, type Thrust } from "./ship";
import type { VesselId } from "./vessels";
import type { F35Pose } from "./f35/model";
import { fleet } from "./fleet";
import { vesselHulls } from "./system/collide";
import { EnduranceRenderer } from "./endurance";
import { StationRenderer, type StationView } from "./station";
import { issAxes, issTrack, refreshIssElements, stationAngles } from "./system/iss";
import { GpuProfiler } from "./gpuprof";
import { shipToCamera, type M3, type Mount, type MountPose } from "./mounts";
import milkyWayUrl from "../assets/sky/milkyway.webp";
import { loading } from "./loading";
import { t, tf } from "./i18n";
import starCatalogueUrl from "../assets/sky/stars.bin";
import starLodUrl from "../assets/sky/starlod.bin";
import lensDirtUrl from "../assets/lens/lensdirt.jpg";
import { SkyTextureBuilder, loadPackedTexture, loadStarCatalogue, skyMatrix } from "./sky";
import { ChartOverlay } from "./chartoverlay";
import overlayWGSL from "./shaders/overlay.wgsl" with { type: "text" };
import { cameraFrame, gpuTheta, homePosition, type CameraFrame } from "./camera";
import { mouth, radius, setSceneTime } from "./wormhole";
import {
  BODY_PLANET,
  BODY_STAR,
  BODY_VEC4,
  bodyHasAir,
  MAX_BODIES,
  ourStart,
  packBodies,
  sceneBodies,
  SURFACE_MAPPED,
  throatLight,
  TRACED_RADIUS,
  type GpuBody,
} from "./system/scene-bodies";
import { loadPlanetMaps, placeholderMaps, type PlanetMaps } from "./system/planet-maps";
import {
  earthPrefetchWanted,
  loadEarthMaps,
  placeholderEarth,
  prefetchEarthMaps,
  type EarthMaps,
  type EarthTier,
} from "./system/earth-maps";
import { GEOID_MAX, geoidN, geoidTable, geoidUnder, loadGeoid } from "./system/geoid";
import { gpuDiagnostics } from "./gpu-diagnostics";
import { EarthTiles, TILE_PARAM_VEC4S, TILE_REACH } from "./system/earth-tiles";
import { WarpGrid } from "./system/warp-grid";
import { EarthSurface, SURFACE_VEC4S, SURFACE_TEXTURE_LIMIT } from "./system/earth-surface";
import { EarthScenery } from "./system/scenery";
import { DETAIL_REACH, SCENERY_VEC4S, SCENERY_STORAGE_LIMIT, type SceneryExclusion } from "./system/scenery-data";
import { LANDSCAPES, LANDSCAPE_CLEARING_M } from "./system/landscapes";
const SCENERY_EXCLUSIONS: SceneryExclusion[] = [
  ...EARTH_RUNWAYS.map((r) => ({
    lat: r.site.lat,
    lon: r.site.lon,
    heading: r.site.rwy ?? 0,
    length: RUNWAY_LENGTH,
    halfWidth: 340,
  })),
  // (the landscapes' viewpoints: no procedural tree where the photographer stood — the Cuernos del Paine's
  // forest grew on the lookout and hid the massif)
  ...LANDSCAPES.map((l) => ({
    lat: l.at[0],
    lon: l.at[1],
    heading: 0,
    length: 0,
    halfWidth: 0,
    radius: l.clearing ?? LANDSCAPE_CLEARING_M,
  })),
];
import {
  altitudeOver,
  bodyFixedOf,
  figureUp,
  groundRelief,
  heightOverGround,
  toBodyFixed,
  setGroundHeights,
  setGroundRelief,
} from "./system/our-surface";
import { EARTH_RM, earthHeightSampler, mapHeightSampler, tileFallbackSampler } from "./terrain";
import {
  cartToGeodetic,
  figureDiskShare,
  figureSourceElevation,
  flatteningOf,
  geodeticNormal,
  rayFigure,
  WGS84_A,
  WGS84_F,
} from "./system/ellipsoid";
import { AIR_K, sunThroughY } from "./system/earth-air";
import { homeOf, homeToRep } from "./system/our-side";
import type { Vec3 } from "./physics";
import { bodyPlace, localPatch, patchGeodetic } from "./system/local-patch";
import { GARGANTUA_SYSTEM } from "./system/bodies";
import { blendProbe, PROBE_H, PROBE_W, probeCamera, reduceProbe, type PlanetProbe } from "./system/planet-probe";
import { bodyVelocity, starOmega, type Body } from "./targeting";
import {
  blackbodyLogY,
  blackbodyXYZ,
  xyzToLinearSRGB,
  buildBlackbodyLUT,
  buildSynchrotronLUT,
  captureTolerance,
  horizon,
  isco,
  ntFluxMax,
  powerLawRGB,
} from "./physics";
import type { Settings } from "./settings";
import { encodeEXR, encodePNG16 } from "./exporters";
import { AU_M, C_MPS } from "./units";
import { windFrom } from "./wind";
import { weatherAt, weatherGpu, windFromAt, type WeatherState } from "./weather";

/** the space station's loading stage, as the loading screen names it */
const STATION_LOADING = t("The space station");

const RENDER_MODES = { physical: 0, redshift: 1, temperature: 2, order: 3, steps: 4 } as const;
const SHIFT_MODES = { full: 0, gravitational: 1, noBeaming: 2, none: 3 } as const;
const BG_MODES = { stars: 0, checker: 1, image: 2, real: 3, alien: 4 } as const;
const TONEMAPS = { AgX: 0, "AgX punchy": 1, ACES: 2, clamp: 3, Film: 4 } as const;
// the colour maps are read through sRGB views: decoded to linear by the GPU (the true curve, before
// filtering) — not pow(t, 2.2) after it
const SRGB: GPUTextureFormat = "rgba8unorm-srgb";
/** A colour map's view read as sRGB: an rgba8 one through its sRGB view format, a compressed one (already
 *  an sRGB format) as it is. */
const srgbView = (t: GPUTexture, dimension: GPUTextureViewDimension) =>
  t.createView({ dimension, ...(t.format === "rgba8unorm" ? { format: SRGB } : {}) });
const BLOCKS = [1, 2, 3, 4, 6, 8];
/** the trace's block while it draws the sky alone over the raster's ground, under RASTER_SKY_KM (frame) */
const RASTER_SKY_BLOCK = 16;
const RASTER_SKY_KM = 1.5;
/** how far the relief's finest windows are led towards the ground the view looks at [m], by the detail's reach */
const GAZE_TILES_M: Record<string, number> = { normal: 6000, far: 12000, veryFar: 20000 };
/** the camera's turn [px a second] past which the realtime rays are one block denser, and under which they go back
 *  (renderer motionBlock) */
const MOTION_DENSE_IN = 25;
const MOTION_DENSE_OUT = 18;
/** the seen ground's slide [px a second] past which the rays are denser in low flight (settings.motionDetail "low"),
 *  and under which they go back */
const GROUND_DENSE_IN = 12;
const GROUND_DENSE_OUT = 9;
/** how long a block size's measured frame time is remembered [ms] (then tried again) */
const BLOCK_MEMORY = 20000;
/** the raster's shading rates (settings.earthRasterShading: one pixel in so many shaded a frame) */
const RASTER_RATE_OF: Record<string, number | undefined> = { every: 1, half: 2, quarter: 4, eighth: 8, sixteenth: 16 };
/** the rates the automatic choice moves between (adaptRasterRate), finest first */
const RASTER_RATES_AUTO = [2, 4, 8, 16] as const;
/** the parameters' raster bit for the ground's albedo at every pixel (trace.wgsl RASTER_DETAIL_FLAG) */
const RASTER_DETAIL_FLAG = 64;
/** the parameters' raster bit for the ground's material pass (trace.wgsl RASTER_LITE_FLAG) */
const RASTER_LITE_FLAG = 128;
/** the parameters' raster bit for the water's own pass (trace.wgsl RASTER_WATER_FLAG) */
const RASTER_WATER_FLAG = 256;
/** the parameters' raster bit for "shade not compiled yet": the pixels the material does not take are traced (trace.wgsl
 *  RASTER_SHADE_LATE_FLAG) */
const RASTER_SHADE_LATE_FLAG = 1024;
/** the temporal pass's least weight of a fresh pixel with the raster's ground at every pixel (taParams[0]'s 1/16 otherwise) */
const RASTER_LITE_ALPHA = 0.3;
/** the automatic rate's start by the hardware's tier (tier.ts: 0 software … 4 high-end) — then by the measure */
const RASTER_RATE_START = [16, 8, 4, 4, 4] as const;
/** the camera held after moving: the refinement's full passes over which the history hands over to it (at most its samples) */
const HANDOVER_PASSES = 8;
/** the runways' block after the tiles' (trace.wgsl: Params.runways) */
const RUNWAY_VEC4S = 18;
/** the sea's resolved waves after the runways (trace.wgsl: Params.sea) */
const SEA_VEC4S = 15;
/** the weather near the camera, last (trace.wgsl: Params.wx) */
const WX_VEC4S = 8;
/** the Earth's shadow on the Moon as Danjon draws it: its radius at 45° of latitude, grown by its air */
const DANJON_SCALE = 0.99834 * (1 + 1 / 85);
/** the weather's clouds drift on a noise of this period [m] (trace.wgsl: wxAt) */
const WX_DRIFT_PERIOD = 204800;
const BASE_PARAM_VEC4S = 69 + TILE_PARAM_VEC4S + RUNWAY_VEC4S + SEA_VEC4S + 1 + 1 + SHADE_VEC4S + WX_VEC4S;
/** the ships' wakes near the camera: a count, then eight ships, two each (trace.wgsl: Params.wake, seaWake) */
const WAKE_VEC4S = 17;
/** the sea's FFT waves (trace.wgsl: Params.seafft) */
const SEAFFT_VEC4S = 4;
/** the mountains' warp's grids (trace.wgsl: Params.warp; system/warp-grid.ts) */
const WARP_VEC4S = 4;
/** our bodies a ray from the mouth's region may meet (trace.wgsl: Params.mouthList), after the warp's */
const MOUTH_LIST_AT = (BASE_PARAM_VEC4S + SURFACE_VEC4S + SCENERY_VEC4S + 5 + WAKE_VEC4S + SEAFFT_VEC4S + WARP_VEC4S) * 4;
const PARAM_VEC4S = BASE_PARAM_VEC4S + SURFACE_VEC4S + SCENERY_VEC4S + 5 + WAKE_VEC4S + SEAFFT_VEC4S + WARP_VEC4S + 2;
/**
 * The sea's twelve wave trains near the camera (trace.wgsl: seaWaves): wavenumbers in whole units of
 * 2π/1024 m on the wind's axes (along, across) — exact from an anchor of whole kilometres, in float32 —,
 * wavelengths 128 m down to 1.5 m, spread ±45° about the wind; their phases' offsets (fixed, scattered).
 */
const SEA_WAVES: { n: [number, number]; phase0: number }[] = [8, 12, 18, 27, 40, 60, 90, 135, 200, 300, 450, 680].map((k, i) => {
  const a = ([0, 25, -20, 35, -30, 15, -40, 30, -15, 45, -35, 20][i]! * Math.PI) / 180;
  return { n: [Math.round(k * Math.cos(a)), Math.round(k * Math.sin(a))], phase0: (i * 2.399963) % (2 * Math.PI) };
});
/** the probe's harmonics as the tracer reads them: 9 × rgb, then the dominant direction */
const SH_BYTES = SH_VEC4S * 16;
const BANDS = { visible: 0, "230GHz": 1, multi: 2 } as const;
const POL_FIELDS = { toroidal: 0, radial: 1, vertical: 2, spiral: 3 } as const;
/** Catalogue star flux per unit 10^(−0.4 m), in Milky Way map units (see scripts/build-sky.ts). */
const STAR_FLUX_SCALE = 1 / 4250;

const FLAG_ADAPTIVE_RK = 1;
const FLAG_ADAPTIVE_SPP = 2;
const FLAG_TEMPORAL = 4;
/** Realtime: samples older than this much simulated time [M] are not shown while time runs. */
const MAX_SAMPLE_AGE = 1.5;
const FLAG_INTERLEAVED = 8;
/** the clear sky's light's period [frames] (encodeSkyAmbient) */
const SKY_EVERY = 3;
/** the parameters' raster bit for the stars drawn at their own pixels (trace.wgsl RASTER_STARS_FLAG) */
const RASTER_STARS_FLAG = 512;
/** the catalogue's stars at most (trace.wgsl shadeStars: a thread a star — 119 614 HYG/Hipparcos) */
const STARS_MAX = 120_000;
/** the sky's discs drawn at most (renderer.skyDiscs, discRects; trace.wgsl main's layers) */
const SKY_DISCS_MAX = 4;
/** the light meter's period [frames] (encodePost) */
const METER_EVERY = 4;
/** how often the raster's sea is probed (renderer.seaProbeFor) [frames]; how long unseen before its FFT stops */
const SEA_PROBE_FRAMES = 15;
const SEA_UNSEEN_FRAMES = 120;
/** the exposure under which the stars are splatted (encodeStars): a day's sky (EV 14.6) hides them */
const STARS_MIN_EV = 15.5;
/** realtime pass under the temporal reprojection: rays prefiltered over their pixel, not their block */
const FLAG_REPROJECT = 16;
/** the far field's LUT is there (trace.wgsl: farLut) */
const FLAG_LUT = 32;
const FLAG_AERIAL = 64; // (trace.wgsl FLAG_AERIAL: the aerial perspective's table written this frame)
/** the features under which the far field's LUT is not used: radio, polarization, jet, hot spot, hot flow,
 *  the wormhole, bodies — what a ray between two clean samples could meet unseen */
const LUT_BLOCKERS = 1 | 2 | 4 | 8 | 16 | 32 | 128;
/** the flight's shake the cockpit's mask allows for [px]: its line of sight's turn, its up's roll (in its margin) */
const SHAKE_PX = 10;
/** the aerial perspective's table: directions across the image, slices along them (trace.wgsl AP_Z) */
const AERIAL_SIZE: [number, number, number] = [96, 54, 32];

/**
 * Bun's dev server sometimes serves a `type: "text"` import as an asset URL after a hot reload
 * (the production bundle inlines it). Accept both.
 */
async function wgsl(src: string): Promise<string> {
  if (/^(\/|https?:)\S*\.wgsl$/.test(src.trim())) return (await fetch(src.trim())).text();
  return src;
}

// (the sky's assets fetched before Renderer.create() even returns: their megabytes download while
// the shaders compile; loadSky consumes the buffers, wrapped back as Responses for its loaders)
const skyPrefetch = new Map<string, Promise<ArrayBuffer>>();
/** the sky's prefetch settled (its downloads in or failed): what the downloads ahead of need wait for — they
 *  would otherwise share the link with it and hold the real sky back (PLAN-TITRE-AAA E0) */
let skyPrefetched: Promise<unknown> = Promise.resolve();
/** Resolves once the sky's prefetch has settled, and at least `ms` from now. */
export const afterSkyPrefetch = (ms: number) => Promise.all([skyPrefetched, new Promise((r) => setTimeout(r, ms))]).then(() => {});

/**
 * Starts the sky's downloads (the Gaia map, the star catalogues) ahead of loadSky — idempotent. `after`: they
 * begin once it settles (the ephemerides: needed first, not to share the link with these 7 MB), loadSky waiting
 * on them meanwhile rather than fetching them again.
 */
export function prefetchSkyAssets(get: (url: string, id: string) => Promise<Response>, after: Promise<unknown> = Promise.resolve()): void {
  const gate = after.then(
    () => {},
    () => {},
  );
  for (const [url, id] of [
    [milkyWayUrl, "sky"],
    [starLodUrl, "stars"],
    [starCatalogueUrl, "stars"],
  ] as const) {
    if (skyPrefetch.has(url)) continue;
    const p = gate.then(() => get(url, id)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${url}: ${r.status}`))));
    void p.catch(() => {
      if (skyPrefetch.get(url) === p) skyPrefetch.delete(url);
    });
    skyPrefetch.set(url, p);
  }
  skyPrefetched = Promise.allSettled(skyPrefetch.values());
}

/**
 * A prefetched asset as a fresh Response, or null. One-shot: the first call takes the download over
 * (the map forgets it — no megabytes retained after loadSky), so a second call for the same URL — a
 * second loadSky — gets null and fetches through the normal path.
 */
function prefetched(url: string): Promise<Response> | null {
  const pending = skyPrefetch.get(url);
  skyPrefetch.delete(url);
  return pending?.then((buf) => new Response(buf)) ?? null;
}

/** Retry a failed speculative request once through the normal loading path. */
function skyAsset(url: string, id: string): Promise<Response> {
  return prefetched(url)?.catch(() => loading.fetch(url, id)) ?? loading.fetch(url, id);
}

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** Order in which the offsets of a block×block tile are visited (greedy farthest point on the torus). */
export function interleaveOrder(b: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = 0; y < b; y++) for (let x = 0; x < b; x++) cells.push([x, y]);
  if (b === 1) return cells;
  const order: [number, number][] = [cells.splice(Math.floor(cells.length / 2), 1)[0]!];
  while (cells.length) {
    let best = 0;
    let bestD = -1;
    cells.forEach(([x, y], i) => {
      let d = Infinity;
      for (const [ox, oy] of order) {
        const dx = Math.min(Math.abs(x - ox), b - Math.abs(x - ox));
        const dy = Math.min(Math.abs(y - oy), b - Math.abs(y - oy));
        d = Math.min(d, dx * dx + dy * dy);
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    });
    order.push(cells.splice(best, 1)[0]!);
  }
  return order;
}

export interface OfflineOptions {
  width: number;
  height: number;
  spp: number;
  tolerance: number; // adaptive RK4 local error tolerance (0 = fixed heuristic steps)
  eps: number; // heuristic step scale (upper bound when adaptive)
  maxSteps: number;
  noiseThreshold: number; // relative standard error at which a pixel stops sampling (0 = off)
  minSpp: number;
  shutter: number; // motion-blur exposure [M]
  budgetMs: number; // GPU time per frame
}

export interface OfflineStatus {
  width: number;
  height: number;
  progress: number; // 0..1
  spp: number;
  targetSpp: number;
  elapsed: number; // s
  eta: number; // s
  paused: boolean;
  done: boolean;
  error?: string;
}

export interface FrameStats {
  phase: "realtime" | "converging" | "converged" | "offline";
  block: number;
  spp: number;
  gpuMs: number;
  width: number;
  height: number;
  targetSpp?: number;
  qualityError?: string;
  offline?: OfflineStatus;
}

/** one frame of renderer.traceColumn's capture (staging buffers, the frame's stamp and valid stamp) */
interface ColFrame {
  acc: GPUBuffer;
  res: GPUBuffer;
  tem: GPUBuffer;
  mom: GPUBuffer;
  st: GPUBuffer;
  stamp: number;
  validFrom: number;
}

interface Target {
  width: number;
  height: number;
  accum: GPUBuffer;
  moments: GPUBuffer;
  /**
   * the occlusion depth the raster passes test against (one f32 [M] a pixel; post.wgsl occlusion, after the
   * temporal pass: fresh each frame — a stale pixel's own depth is the ground a trunk now covers)
   */
  sceneDepth: GPUBuffer;
  /** its pass's bind group (made on first use) */
  sceneDepthBind: GPUBindGroup | null;
  /** the main trace pass's bind group holding the raster patch's distance texture of this frame (made when it changes) */
  hintBind?: { tex: GPUTexture; bind: GPUBindGroup };
  /** the cloud pass's buffers (half the target's size), their write bind group, and the tracer's bind group for the pass
   *  itself (the raster's distances bound, the buffers' stand-ins) — trace.wgsl clouds, system/cloud-pass.ts */
  cloudA?: GPUTexture;
  cloudB?: GPUTexture;
  cloudWrite?: GPUBindGroup;
  cloudBind?: { tex: GPUTexture; bind: GPUBindGroup };
  /** this frame's march (the pass writes it), the history kept, whether it holds a frame, its pass's bind group */
  cloudCurA?: GPUTexture;
  cloudCurB?: GPUTexture;
  cloudHistA?: GPUTexture;
  cloudHistValid?: boolean;
  cloudTemporalBind?: { buf: GPUBuffer; bind: GPUBindGroup };
  stamps: GPUBuffer;
  gather: GPUBuffer;
  hdr: GPUTexture;
  bloomTex: GPUTexture;
  bloomLevels: number;
  resolveBuf: GPUBuffer;
  /** where the Ranger was drawn in this target's image (x, y, w, h; w = 0: not drawn) — the bloom's source */
  shipRect: GPUBuffer;
  /** the lens flare's meter: its uniform (exposure, level) and result (mean excess, centroid) */
  flare: { u: GPUBuffer; out: GPUBuffer; bind: GPUBindGroup | null };
  /** the image through the depth of field (made when it is first on) */
  dof: { tex: GPUTexture; buf: GPUBuffer; bind: GPUBindGroup; endTex: GPUTexture } | null;
  polAcc: GPUBuffer; // Σ Stokes Q, U per pixel
  /** the catalogue stars splatted by a realtime frame (R8: 3 × u32 fixed point per pixel; live view only) */
  stars: GPUBuffer;
  polGrid: GPUBuffer; // per tick cell Σ I, Q, U, n
  polGridBuf: GPUBuffer; // cell px, grid W, grid H, image W
  polGridPass: GPUBindGroup;
  beam: { level: number; tex: GPUTexture; buf: GPUBuffer; h: GPUBindGroup; v: GPUBindGroup } | null;
  denoise: { tex: GPUTexture; bufs: GPUBuffer[]; binds: GPUBindGroup[] } | null;
  /** the temporal reprojection's history (ping-pong) and its uniform (made on first use, live only) */
  /**
   * the temporal reprojection's history (ping-pong: idx the latest), its pre-exposure; held: the camera
   * stopped after moving, the refinement handed over to (the other image holds the hand-over, idx the
   * history it started from)
   */
  temporal: {
    hist: GPUTexture[];
    /** the ground's albedo history beside it (post.wgsl temporal, RASTER_DETAIL: r the albedo's luminance, g its coverage),
     *  ping-pong with hist; albOk: the one at idx was written with hist's — not after a copy, a hand-over, a resize */
    alb: GPUTexture[];
    albOk: boolean;
    buf: GPUBuffer;
    binds: GPUBindGroup[];
    idx: number;
    valid: boolean;
    pre: number;
    held: boolean;
    moving: boolean;
    /** the hand-over's first frame stamp: the pixels drawn since are the refinement's */
    from: number;
    /** the splatted stars over history k, into the image (post.wgsl stars) */
    starBinds: GPUBindGroup[];
  } | null;
  /** the camera's motion blur: its image and pass (on first use) — post.wgsl motionBlur */
  blur: { tex: GPUTexture; bind: GPUBindGroup } | null;
  /**
   * the temporal upsampling (post.wgsl taau — live, rendered under the canvas): its history at the canvas's size (ping-
   * pong: idx the latest), the image the display shows, its uniform, bind groups (by history and the native one read),
   * the display's bind groups on its image; on: drawn this frame (the display reads it)
   */
  taau: {
    w: number;
    h: number;
    hist: GPUTexture[];
    out: GPUTexture;
    buf: GPUBuffer;
    binds: Map<string, GPUBindGroup>;
    idx: number;
    valid: boolean;
    on: boolean;
    displayBinds: Map<GPURenderPipeline, GPUBindGroup>;
  } | null;
  /** the far field's LUT (live target): a ray every 8 pixels — directions + shift, clean flags */
  lut: { tex: GPUTexture[]; w: number; h: number; write: GPUBindGroup; read: GPUBindGroup } | null;
  traceBind: GPUBindGroup;
  /** the same, the light-probe buffer swapped for the planets' probe */
  probeBind: GPUBindGroup;
  postPasses: { pipeline: GPUComputePipeline; bind: GPUBindGroup; w: number; h: number; label?: string }[];
  displayBinds: Map<GPURenderPipeline, GPUBindGroup>;
}

interface OfflineJob {
  target: Target;
  settings: Settings;
  time: number;
  opts: OfflineOptions;
  sampleIndex: number;
  bandY: number;
  bandRows: number;
  elapsed: number; // active seconds
  lastTick: number;
  paused: boolean;
  done: boolean;
  error?: string;
  shown: boolean;
  /** the terrain tiles drawn when it started (EarthTiles.stamp): restarted when more come in */
  tiles: number;
  surface: number;
  scenery: number;
  /** the quality kernel failed: the error control off, the fixed steps for the whole job (no mix) */
  fixedSteps?: string;
}

/** Trees and buildings stand above the ground [m]: the nearest scenery's distance taken this much under the camera's height. */
const SCENERY_TOP_M = 60;

/** The camera's eye on its near body's axes [its radii] (float64): where the tracer's rays start (trace.wgsl nearCam). */
function bodyEye(near: { centre: Vec3; axes: Vec3[] }): Vec3 {
  return near.axes.map((a) => -(a[0]! * near.centre[0] + a[1]! * near.centre[1] + a[2]! * near.centre[2])) as Vec3;
}

/** The camera's place on its near body, in metres along the body's own axes (mPerM: metres per M): a rotation of the view leaves it unchanged. */
function placeOnBody(near: { centre: Vec3; radius: number; axes: Vec3[] }, mPerM: number): Vec3 {
  return bodyEye(near).map((x) => x * near.radius * mPerM) as Vec3;
}

export class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private tracePipeline: GPUComputePipeline | null = null; // realtime kernel, every feature (the general one: compiled after the scene's own)
  private qualityPipeline: GPUComputePipeline | null = null; // + error-controlled integrator (compiled in the background)
  private traceLayout: GPUBindGroupLayout;
  private rasterHint = false;
  private rasterDummy: GPUTexture | null = null;
  private displayPipeline!: GPURenderPipeline; // SDR canvas (preferred format) — set from the async compile (auxCompiled)
  private sdrFormat: GPUTextureFormat;
  private hdrActive = false;
  private export8Pipeline: GPURenderPipeline | null = null;
  private export8Compile!: AsyncResource<GPURenderPipeline>;
  private export16Pipeline!: GPURenderPipeline;
  private postResolve!: GPUComputePipeline;
  private postGatherH!: GPUComputePipeline;
  private postDown!: GPUComputePipeline;
  private postDownShip!: GPUComputePipeline;
  private postDof!: GPUComputePipeline;
  private postFlare!: GPUComputePipeline;
  /** (bound where a target has no depth-of-field image yet) */
  private dofDummy: GPUTexture;
  private postUp!: GPUComputePipeline;
  private postPolGrid!: GPUComputePipeline;
  private postBeamH!: GPUComputePipeline;
  private postAtrous!: GPUComputePipeline;
  private postTemporal!: GPUComputePipeline;
  private postTaau!: GPUComputePipeline;
  /** the cloud pass's history (post.wgsl cloudTemporal — docs/PLAN-NUAGES-AAA.md N1b) */
  private postCloudTemporal: GPUComputePipeline | null = null;
  private cloudCT: GPUBuffer | null = null;
  private postMotion!: GPUComputePipeline;
  private postOcclusion!: GPUComputePipeline;
  private postStars!: GPUComputePipeline;
  private noise3d!: GPUTexture;
  private noiseSampler!: GPUSampler;
  private postBeamV!: GPUComputePipeline;
  /** the display's and the post chain's pipelines (async compiles, awaited with the tracer's core) */
  private auxCompiled: Promise<void>;
  private params = new ArrayBuffer(PARAM_VEC4S * 16);
  /** The spaceship carrying the camera, and the light probe that lights it. */
  readonly ship: ShipRenderer;
  readonly endurance: EnduranceRenderer;
  private enduranceLoading: Promise<void> | null = null;
  /** The International Space Station on its real orbit (station.ts, system/iss.ts). */
  readonly station: StationRenderer;
  readonly characterRenderer: CharacterRenderer;
  character: PlanetCharacter | null = null;
  private stationLoading: Promise<void> | null = null;
  /** the disk's reference luminance (log10 Y) of the last frame's parameters: the stars' scale */
  private walkStamp = -1;
  /** when the light probe last ran [ms, performance.now()]: the astronaut reads it while it is fresh */
  private envAt = -Infinity;
  /** the probe's and the vessel's shadow map's views, as the astronaut binds them (made once) */
  private characterViews: { env: GPUTextureView; shadow: GPUTextureView } | null = null;
  /** the key light's direction the astronaut was last lit from (camera axes) */
  private characterSun: Vec3 | null = null;
  private lastLogY = 0;
  /** the last frame's bodies (the stars' radius, temperature, brightness) */
  private lastBodies: GpuBody[] = [];
  /** the camera frame and time of the last image traced (the Endurance is drawn with them) */
  private lastCam: CameraFrame | null = null;
  private lastTime = 0;
  /** GPU time per pass (timestamp queries; off unless switched on) */
  readonly prof: GpuProfiler;
  private envPipeline: GPUComputePipeline | null = null;
  private envReset = true;
  /** frames left of a spread reset (every texel written over, one of each 2×2 block a frame) */
  private envSpread = 0;
  // the Ranger's light probe: what it saw last frame (unit vectors from the camera to what lights it,
  // world axes; its velocity; its place around the hole), to size its running mean
  private probeSeen: { side: string; things: Map<string, Vec3>; beta: Vec3; er: Vec3; time: number; sky: number } | null = null;
  /** the camera's axes (right, up, forward) in the Ranger's probe's axes */
  private shipProbeAxes: [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  private envPhase = 0;
  /** the ship probe's refresh this frame: every texel (1), one of each 2×2 (2) or 4×4 (4) block */
  private envStride = 1;
  /** run it every nth frame (slow changes: 4) */
  private envEvery = 1;
  private envTick = 0;
  private shipLoading: Promise<void> | null = null;
  /** Where the camera sits on the ship now (the app sets it every frame: it moves between attach points). */
  shipPose: MountPose | null = null;
  /**
   * The flown ship seen from a spectator (controller/spectator.ts): its axes in the view camera's and its
   * origin there [m], its distance [m] — drawn within 20 km; null: the view is the ship's.
   */
  shipPlace: { S: M3; t: Vec3; dist: number } | null = null;
  /**
   * The flown ship (not a spectator's: main.ts): its body, its place on the body's axes [its radii] and its
   * height [km] — a prefetch hint only: the Earth's and a world's finer maps kept for the ground under its gear,
   * and the terrain tiles round it while the view is off the Earth's near patch. What is streamed and drawn
   * (tiles, surface, scenery) and where the rays start is the camera's.
   */
  shipFocus: { body: string; c: Vec3; altKm: number } | null = null;
  /** on foot: the view is the astronaut's — the ground and the scenery follow the view, not the vessel left on the ground */
  onFoot = false;
  /** the camera's velocity over the Earth's ground [m/s, on its axes] (the streaming's lead; null: off the Earth) */
  streamVelocity: Vec3 | null = null;
  /** the velocity over the Earth's ground [m/s, on its axes] of what carries the camera — the flown ship, its
   *  views riding with it (set by the app; null otherwise): the sim's own, true with the clock held */
  carrierVelocity: Vec3 | null = null;
  /** the camera's last place on the Earth [its radii] and when [ms]: its velocity measured from frame to frame */
  private eyeTrack: { c: Vec3; at: number } | null = null;
  streamingState = { leadM: 0, lookAheadSeconds: 6, gazeM: 0 };
  /** the spectator's view holds the flown ship (near enough to draw) */
  private get shipInView() {
    return !!this.shipPlace && this.shipPlace.dist < 2e4;
  }
  /**
   * The camera's velocity over the Earth's ground [m/s, on its axes], from its eye's place frame to frame (eye: on
   * the Earth's axes [its radii]; null: off it) — the ship's, a spectator's, a free camera's or a time warp's alike.
   * Smoothed over a quarter second; a jump (a teleport, a cut — faster than 12 km/s) starts it again from rest.
   */
  private cameraGroundVelocity(eye: Vec3 | null): Vec3 | null {
    if (!eye) {
      this.eyeTrack = null;
      return null;
    }
    const now = performance.now(),
      last = this.eyeTrack,
      v = this.streamVelocity ?? ([0, 0, 0] as Vec3);
    this.eyeTrack = { c: [...eye], at: now };
    // (riding with the ship: its velocity — a still image of a flight keeps its lead; measured, a held clock read 0)
    if (this.carrierVelocity) return [...this.carrierVelocity] as Vec3;
    if (!last) return [0, 0, 0];
    const dt = (now - last.at) / 1000;
    if (dt <= 0) return v;
    const step = eye.map((x, i) => ((x - last.c[i]!) * WGS84_A) / dt) as Vec3;
    if (dt > 0.5 || Math.hypot(...step) > 12000) return [0, 0, 0];
    const k = Math.min(1, dt / 0.25);
    return v.map((x, i) => x + (step[i]! - x) * k) as Vec3;
  }
  /**
   * Cinematic liquid throat: its clock [s] (advanced by the app, or by the video renderer) and the
   * splash left where the camera last went through (centre on the throat, clock then).
   */
  water = { clock: 0, splash: [0, 0, 1] as [number, number, number], splashAt: -1e9, side: 0 };
  private paramsF = new Float32Array(this.params);
  private paramsU = new Uint32Array(this.params);
  /** the weather near the camera's block of the params, as the kernel reads it (Params.wx: WX_VEC4S vec4s) */
  get weatherBlock(): Float32Array {
    return this.paramsF.subarray((BASE_PARAM_VEC4S - WX_VEC4S) * 4, BASE_PARAM_VEC4S * 4);
  }
  private paramBuf: GPUBuffer;
  private displayBuf: GPUBuffer;
  /** the blackbody's LUT, then the synchrotron's (one binding: the tracer's storage buffers are counted) */
  private bgTexture: GPUTexture;
  private mwTexture: GPUTexture;
  private starLodTexture: GPUTexture;
  /** the lens's dust (display.wgsl: lensDirtGlow) — black until loaded */
  private lensDirt: GPUTexture;
  /** the solar system's maps and Saturn's rings (placeholders until loaded, on first use) */
  private planetMaps: PlanetMaps;
  private mapsRequested = false;
  /** the Earth's maps (placeholders until loaded; the finer ones when the camera comes near it) */
  private earthMaps: EarthMaps;
  /** the clouds of the day over the Earth (PLAN-CIEL C2, system/day-clouds.ts): the real weather's, in
   *  the night cube's green — the day they are of (its date, its satellite layer), null: none in */
  dayCloudsOf: { date: string; layer: string } | null = null;
  /** the day's mosaic kept (new maps of the Earth: made again without fetching it again) */
  private dayCloudsImage: { date: string; layer: string; img: ImageBitmap } | null = null;
  /** the day being fetched, and a failure's (retried five minutes on) */
  private dayCloudsJob: string | null = null;
  private dayCloudsFail: { date: string; at: number } | null = null;
  /** off: the fixed map of clouds even with the real weather (a script's switch, an A/B) */
  dayCloudsOn = true;
  /** the Moon's sunlight left by the Earth's shadow, over its disc (1: no lunar eclipse — PLAN-CIEL C6) */
  moonLight = 1;
  /** the Earth's real ground near the camera, streamed (src/system/earth-tiles.ts) */
  readonly earthTiles: EarthTiles;
  readonly earthSurface: EarthSurface;
  readonly earthScenery: EarthScenery;
  private surfaceSampler: GPUSampler;
  /** the sea's FFT waves (null: the device takes no more textures — the trains then), their sampler */
  readonly seaFft: SeaFft | null;
  private seaSampler: GPUSampler;
  /** the sea's state about the camera (the marine model's, else the wind's), the spectrum's key, the waves' clock */
  private marine = new MarineFeed();
  seaState: SeaState | null = null;
  /** a sea imposed (the tests', a scene's: null — the marine model's, else the wind's) */
  seaOverride: SeaState | null = null;
  /** a swell's height imposed [m] (a qualification's heavy sea), else none */
  seaSwell: number | null = null;
  private seaKey = "";
  private seaFftT = 0;
  private seaFftDue = false;
  /** the choppiness of the FFT's crests */
  private seaLambda = 0.9;
  /** each FFT cascade's Jacobian under which its crests leave foam (seaFftParams; sea/fft-gpu.ts) */
  private seaFoamJ = [-9, -9, -9];
  /** the sea's significant height about the camera [m] (the ships' motion — controller/seatraffic.ts) */
  seaHs = 1;
  private earthWant: EarthTier | null = null;
  /** the finest Earth tier this GPU's memory held (lowered when one ran out) */
  private earthCap: EarthTier | "none" = "high";
  /** the Earth maps' latest request (an older one landing late is dropped) */
  private earthJob = 0;
  /** the geoid's map in the tracer's table (gpu-tables.ts TABLE_GEOID), once */
  private geoidIn = false;
  /** the orthophotos' levels last written to the tracer's table (gpu-tables.ts TABLE_ORTHO) */
  private orthoSent: Float32Array | null = null;
  /** when its disk was last over 12 pixels [ms] */
  private earthSeenAt = 0;
  /** the finer maps of the body near the camera (one at a time), and the one being loaded */
  private hdMap!: HdMap;
  private hdLoading: MapName | null = null;
  // auto exposure: the light meter (a histogram of the image, read back), its state
  private meterPipeline!: GPUComputePipeline;
  // the cockpit's mask (mask.wgsl): its pipeline, its parameters, whether the live view's moments hold one
  private maskPipeline?: GPUComputePipeline;
  /** the mask's first pass (mask.wgsl cell): each 8 × 8 cell covered whole or not, into the target's maskCells */
  private maskCellPipeline?: GPUComputePipeline;
  private maskCells = new WeakMap<object, GPUBuffer>();
  private maskBuf!: GPUBuffer;
  private maskSet = new WeakMap<object, boolean>();
  /** the realtime frame (frameStamp) the flown craft's own mask was last drawn in; −1: not drawn */
  private ownMaskStamp = -1;
  private histBuf!: GPUBuffer;
  private histStage!: GPUBuffer;
  private meterPending = false;
  /** frames since the light meter last ran (METER_EVERY) */
  private meterTick = 0;
  /** the telescope's spot meter (main.ts sets it each frame): the target's disc — its centre (fractions of the
   *  width, the height) and its radius (a fraction of the height) —, the exposure set by it alone; null: the image's */
  meterSpot: { x: number; y: number; r: number; key?: string; solid?: boolean } | null = null;
  /** what the spot last metered (a target's name; "": none): another one, the exposure found again at once */
  private spotKey = "";
  private spotBuf!: GPUBuffer;
  /** the reading in flight was a spot's */
  private meterSpotUsed = false;
  /** the spot meter's sky behind the target [radiance]: the telescope's black point (0: none) */
  private spotSky = 0;
  /** the spot meter's last reading (the tests') */
  spotRead: { core: number; sky: number; total: number; m: number; gain: number; hist: number[] } | null = null;
  private meterPre = 1;
  private meterSkyUsed = 0;
  /** the auto exposure the meter's sky threshold was scaled with */
  private meterEVUsed = 0;
  private meterSky = 0;
  private meterIncident = 0;
  /** the camera near the Earth: the meter reads the image too (a sunset's sky, its lit clouds: not a backdrop) */
  private meterInAir = false;
  /** what the tone map adds before its curve (the film look: 2 stops over) */
  private meterGain = 1;
  /** the shadows kept from "AgX punchy"'s deepening (display.wgsl: agx): a landscape by day */
  private shadowKeep = 0;
  private meterAt = 0;
  /** exposure the meter adds [EV] (auto exposure) */
  autoEV = 0;
  private autoEVSet = false;
  private autoEVDrawn = 0;
  /** when the scene last changed (not the meter's own redraws) [ms] */
  private sceneAt = 0;
  /** the meter asked for the last redraw */
  private evRedraw = false;
  /** called when assets loaded in the background change the image (the loop redraws) */
  onAssets: (() => void) | null = null;
  private catalogue: GPUBuffer;
  private bodyBuf!: GPUBuffer;
  /** the local patch for a body near the camera (off: traced like the others — for comparisons) */
  localPatchOn = true;
  /** re-entry glow on the Ranger: the air's flow in the camera frame, level 0…1 (from the controller) */
  shipPlasma: [number, number, number, number] = [0, 0, 1, 0];
  /** the camera's shake (the air buffeting the craft): the image's offset, a fraction of its size */
  shake: [number, number] = [0, 0];
  /** the flown craft's re-entry: its plasma and heat (ship.ts Reentry) */
  shipReentry: Reentry | null = null;
  /** the Ranger's thrusters firing (ship.ts: Thrust), or null */
  shipThrust: Thrust | null = null;
  /** The map's GPU (ui/map3d/gpu.ts): this device, and the tracer's maps as they stand (no second copy). */
  mapGpuSource() {
    return {
      device: this.device,
      textures: () => ({
        hi: this.planetMaps.hi,
        lo: this.planetMaps.lo,
        rings: this.planetMaps.rings,
        earthDay: this.earthMaps.cube,
        earthNight: this.earthMaps.night,
      }),
    };
  }

  /** the condensation trails (contrails.ts: segments in the ship's frame), or null */
  shipContrails: { data: Float32Array<ArrayBuffer>; n: number } | null = null;
  /** the last frame's local patch (inspection) */
  lastNear: ReturnType<typeof localPatch> = null;
  /** the body near the camera in the last camera frame is the Earth (its sky's and its clouds' shadow passes run then only) */
  private nearEarthNow = false;
  /** the planets' light probes (system/planet-probe.ts), by body id */
  readonly planetProbes = new Map<string, PlanetProbe>();
  private probeBuf!: GPUBuffer;
  private probeStage!: GPUBuffer;
  private probeBusy = false;
  private probeNext = 0;
  private probeAt = -Infinity;
  private bodyData = new Float32Array(MAX_BODIES * BODY_VEC4 * 4);
  private pathCount = 0;
  private pathFate = 0;
  private pathKey: { pts: [number, number, number][]; fate: string; at: number } | null = null;
  private skyBuilder: SkyTextureBuilder;
  private skyReady = false;
  private sampler: GPUSampler;
  private clampSampler: GPUSampler;

  private traceSource: string;
  /** the general tracer (realtime kernel + ship's probe, every feature compiled in): no longer what the
   *  first image waits for — on D3D12 it is minutes of compile (every function inlined), the scene's
   *  specialised kernel a fraction of that. Started once the scene's own has landed (or failed), the
   *  fallback of every later scene whose own is still compiling. */
  private generalCompile!: AsyncResource<[GPUComputePipeline, GPUComputePipeline]>;
  /** no tracer at all could be compiled before the first image (the scene's and the general one failed) */
  onTracerFailure?: (error: Error) => void;
  /** resolved when the first traced frame has completed on the GPU */
  private firstImage: Promise<void>;
  private resolveFirstImage!: () => void;
  /** Optional pipelines compile independently, after the first image or on demand. */
  private qualityCompile!: AsyncResource<GPUComputePipeline>;
  private lutCompile!: AsyncResource<GPUComputePipeline>;
  private lutQCompile!: AsyncResource<GPUComputePipeline>;
  private readonly variantQueue = new CompileQueue(60_000, true);
  private live: Target | null = null;
  private offline: OfflineJob | null = null;

  // live view state
  private frameStamp = 0;
  private epoch = 1;
  /** Oldest frame whose samples may still be shown (≥ epoch): while time runs, older samples are
   *  of a different moment of the flow and would smear it. */
  private validFrom = 1;
  private frameTimes: { stamp: number; time: number }[] = [];
  private sampleIndex = 0;
  private bandY = 0;
  private bandRows = 64;
  /** the refinement's trace pass's GPU time a row, last read back [ms] (0: not timed — no timestamps, or a new size) */
  private bandRowMs = 0;
  private realtimeBlock = 2;
  /** the realtime subsampling of the last realtime frame (one ray per block × block pixels) — the
   *  automatic choice, or the fixed one the settings ask for */
  get realtimeBlockNow() {
    return this.lastBlock;
  }
  private blockMs = new Map<number, { ms: number; at: number }>();
  private lastBlock = 2;
  private interleaveIndex = 0;
  private lastOffset: [number, number] = [0, 0];
  /** frames submitted and not yet done; when the last one finished */
  private inFlight = 0;
  private lastDoneAt = 0;
  /** The GPU has enough to do: the live view keeps two frames in flight (the CPU prepares the next one
   *  while the GPU draws — +60 % frame rate), the offline render one (its bands are sized by their time). */
  private get busy() {
    return this.inFlight >= (this.offline ? 1 : 2);
  }
  /** the live target holds a polarization buffer; the settings want one */
  private livePol = false;
  private wantPol = false;
  /** the display's refresh interval, measured by the main loop [ms] (0: not yet) */
  refreshMs = 0;
  /**
   * The frame time the automatic controls aim for [ms]: the quality's budget fitted to a whole number
   * of display refreshes, a tenth under — 16 ms on a 60 Hz screen is 15 (one refresh: no 30/60 judder),
   * on a 120 Hz one two refreshes, 15 —, and no less than the frame rate cap's interval.
   */
  frameBudget(s: Settings) {
    let b = Math.max(8, s.realtimeBudget);
    const r = this.refreshMs;
    if (r > 4) b = Math.max(1, Math.round(b / r)) * r * 0.9;
    if (s.fpsCap > 0) b = Math.max(b, (1000 / s.fpsCap) * 0.9);
    return b;
  }
  /** the last frame's GPU time [ms] */
  lastGpuMs = 0;
  /** the last completed frame drawn with the motion's denser rays (motionBlock): its time not the block's nor the
   *  scale's — the dynamic resolution (main.ts) and the automatic block (adaptBlock) leave it out */
  lastFrameDense = false;
  private lastPhase: FrameStats["phase"] = "realtime";
  /** the trace being encoded is a realtime frame's (dispatchTrace: the terrain cache's bakes keep its history) */
  private tracingRealtime = false;
  /** time spent over the budget, under it with room for a finer block [ms of frames] */
  private slowMs = 0;
  private fastMs = 0;
  /** the last frames' times (their median bounds a spike) */
  private recentMs: number[] = [];
  /** frames still to leave out of the measure (after new resources, a full probe reset) */
  private eventFrames = 0;
  private orders = new Map<number, [number, number][]>();

  private cache = { spin: NaN, rIn: 0, fmax: 1, temp: NaN, logY: 0, alpha: NaN, volColor: [1, 1, 1] as number[] };

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    src: {
      trace: string;
      display: string;
      post: string;
      sky: string;
      ship: string;
      endurance: string;
      station: string;
      overlay: string;
      seafft: string;
    },
  ) {
    this.device = device;
    // (the sea's FFT waves: where the device takes their texture — sea/fft-gpu.ts)
    this.seaFft = device.limits.maxSampledTexturesPerShaderStage >= SEA_TEXTURE_LIMIT ? new SeaFft(device, src.seafft) : null;
    this.seaSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });
    this.context = context;
    this.sdrFormat = format;
    this.traceSource = src.trace;

    const traceModule = device.createShaderModule({ code: src.trace, label: "trace" });
    // (kept on the instance: read back at start-up for their compilation messages, not re-parsed)
    const displayModule = (this.displayModule = device.createShaderModule({ code: src.display, label: "display" }));
    const postModule = (this.postModule = device.createShaderModule({ code: src.post, label: "post" }));
    // (the raster patch's distances for the ground march: where the device takes the one more texture; an empty one — no
    // hint, 0 — bound otherwise)
    this.rasterHint = device.limits.maxSampledTexturesPerShaderStage >= RASTER_HINT_TEXTURE_LIMIT;
    this.sunShadow = device.limits.maxSampledTexturesPerShaderStage >= SUN_SHADOW_TEXTURE_LIMIT;
    // (the cloud pass's buffers — docs/PLAN-NUAGES-AAA.md N1 —: per target, half its size; stand-ins where it writes them)
    this.cloudPass = device.limits.maxSampledTexturesPerShaderStage >= CLOUD_PASS_TEXTURE_LIMIT;
    if (this.cloudPass) {
      this.cloudDummies = (["rgba32float", "rgba32float"] as const).map((format) =>
        device.createTexture({ label: "cloud pass: none", size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING }),
      );
      this.cloudWriteLayout = device.createBindGroupLayout({
        label: "cloud pass write",
        entries: [
          { binding: 11, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
          { binding: 12, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
        ],
      });
    }
    // (the clouds' transmittance map — N3 —: one for all the targets, written by its kernel, read by the others; a
    // stand-in bound where it is written)
    this.cloudShadow = device.limits.maxSampledTexturesPerShaderStage >= CLOUD_SHADOW_TEXTURE_LIMIT;
    if (this.cloudShadow) {
      const U = GPUTextureUsage;
      this.csmTex = device.createTexture({
        label: "clouds' shadow map",
        size: [CSM_N, CSM_N],
        format: "rgba32float",
        usage: U.STORAGE_BINDING | U.TEXTURE_BINDING,
      });
      this.csmHead = device.createTexture({
        label: "clouds' shadow map: frame",
        size: [CSM_VEC4S, 1],
        format: "rgba32float",
        usage: U.STORAGE_BINDING | U.COPY_SRC,
      });
      this.csmDummy = device.createTexture({
        label: "clouds' shadow map: none",
        size: [1, 1],
        format: "rgba32float",
        usage: U.TEXTURE_BINDING,
      });
    }
    // (the trees' and buildings' shadow map — drawn by the scenery raster, bound to the tracer from the start: a stand-in
    // until the scenery raster first runs — its 16 MiB not taken on a device that never flies over the Earth's forests)
    this.treeShadow = device.limits.maxSampledTexturesPerShaderStage >= TREE_SHADOW_TEXTURE_LIMIT;
    if (this.treeShadow)
      this.tsmTex = device.createTexture({
        label: "trees' shadow map: none yet",
        size: [1, 1, 2],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    if (this.sunShadow)
      this.sunDummy = device.createTexture({
        label: "relief shadow map: none",
        size: [1, 1],
        format: "depth32float",
        usage: GPUTextureUsage.TEXTURE_BINDING,
      });
    if (this.rasterHint)
      this.rasterDummy = device.createTexture({
        label: "raster hint: none",
        size: [1, 1],
        format: "r32float",
        usage: GPUTextureUsage.TEXTURE_BINDING,
      });
    // explicit layout shared by the realtime and quality variants of the tracer
    const C = GPUShaderStage.COMPUTE;
    this.traceLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: "uniform" } },
        { binding: 1, visibility: C, buffer: { type: "storage" } },
        { binding: 3, visibility: C, texture: { sampleType: "float" } },
        { binding: 4, visibility: C, sampler: { type: "filtering" } },
        { binding: 5, visibility: C, buffer: { type: "storage" } },
        { binding: 6, visibility: C, buffer: { type: "storage" } },
        { binding: 7, visibility: C, buffer: { type: "storage" } },
        { binding: 8, visibility: C, texture: { sampleType: "float" } },
        { binding: 9, visibility: C, texture: { sampleType: "float" } },
        { binding: 10, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 11, visibility: C, buffer: { type: "storage" } },
        { binding: 14, visibility: C, buffer: { type: "storage" } },
        { binding: 15, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 16, visibility: C, texture: { sampleType: "float", viewDimension: "2d-array" } },
        { binding: 17, visibility: C, texture: { sampleType: "float" } },
        { binding: 18, visibility: C, texture: { sampleType: "float", viewDimension: "2d-array" } },
        { binding: 19, visibility: C, texture: { sampleType: "float", viewDimension: "cube" } },
        { binding: 20, visibility: C, texture: { sampleType: "float", viewDimension: "cube" } },
        { binding: 21, visibility: C, texture: { sampleType: "float" } },
        { binding: 22, visibility: C, texture: { sampleType: "float" } },
        { binding: 23, visibility: C, texture: { sampleType: "float" } },
        { binding: 24, visibility: C, texture: { sampleType: "float", viewDimension: "3d" } },
        { binding: 25, visibility: C, sampler: { type: "filtering" } },
        { binding: 26, visibility: C, texture: { sampleType: "depth" } },
        { binding: 28, visibility: C, texture: { sampleType: "uint", viewDimension: "2d-array" } },
        ...(device.limits.maxSampledTexturesPerShaderStage >= RASTER_HINT_TEXTURE_LIMIT
          ? [{ binding: RASTER_HINT_BINDING, visibility: C, texture: { sampleType: "unfilterable-float" } as GPUTextureBindingLayout }]
          : []),
        ...(device.limits.maxSampledTexturesPerShaderStage >= SUN_SHADOW_TEXTURE_LIMIT
          ? [{ binding: SUN_SHADOW_BINDING, visibility: C, texture: { sampleType: "depth" } as GPUTextureBindingLayout }]
          : []),
        ...(device.limits.maxSampledTexturesPerShaderStage >= CLOUD_PASS_TEXTURE_LIMIT
          ? CLOUD_PASS_BINDINGS.map((binding) => ({
              binding,
              visibility: C,
              texture: { sampleType: "unfilterable-float" } as GPUTextureBindingLayout,
            }))
          : []),
        ...(device.limits.maxSampledTexturesPerShaderStage >= CLOUD_SHADOW_TEXTURE_LIMIT
          ? [{ binding: CLOUD_SHADOW_BINDING, visibility: C, texture: { sampleType: "unfilterable-float" } as GPUTextureBindingLayout }]
          : []),
        ...(device.limits.maxSampledTexturesPerShaderStage >= TREE_SHADOW_TEXTURE_LIMIT
          ? [
              {
                binding: TREE_SHADOW_BINDING,
                visibility: C,
                texture: { sampleType: "depth", viewDimension: "2d-array" } as GPUTextureBindingLayout,
              },
            ]
          : []),
        ...(device.limits.maxStorageBuffersPerShaderStage >= SCENERY_STORAGE_LIMIT
          ? [{ binding: 32, visibility: C, buffer: { type: "read-only-storage" } as GPUBufferBindingLayout }]
          : []),
        ...(device.limits.maxSampledTexturesPerShaderStage >= SEA_TEXTURE_LIMIT
          ? [
              { binding: 33, visibility: C, texture: { sampleType: "float", viewDimension: "2d-array" } as GPUTextureBindingLayout },
              { binding: 34, visibility: C, sampler: { type: "filtering" } as GPUSamplerBindingLayout },
            ]
          : []),
        ...(device.limits.maxSampledTexturesPerShaderStage >= SURFACE_TEXTURE_LIMIT
          ? [
              { binding: 29, visibility: C, texture: { sampleType: "float", viewDimension: "2d-array" } as GPUTextureBindingLayout },
              { binding: 30, visibility: C, texture: { sampleType: "uint", viewDimension: "2d-array" } as GPUTextureBindingLayout },
              { binding: 31, visibility: C, sampler: { type: "filtering" } as GPUSamplerBindingLayout },
            ]
          : []),
      ],
    });
    // (the disk's turbulence: a tiling noise baked once)
    this.noise3d = bakeNoise3d(device);
    this.noiseSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
      addressModeW: "repeat",
    });
    this.aerialTex = [0, 1].map(() =>
      device.createTexture({
        size: AERIAL_SIZE,
        dimension: "3d",
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    this.aerialSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    // (the light probes' kernels — env — read the aerial perspective's table too: earthLook is theirs as well; never
    // with its flag on — the table stands for the camera's rays only —, but bound)
    this.envReadLayout = device.createBindGroupLayout({ entries: this.aerialReadLayout() });
    this.envRead = device.createBindGroup({ layout: this.envReadLayout, entries: this.aerialRead() });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, this.envReadLayout] });
    // (the far field's LUT: written by its own pass, read by the main kernel — a second bind group)
    this.lutWriteLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, storageTexture: { access: "write-only", format: "rgba32float" } },
        { binding: 1, visibility: C, storageTexture: { access: "write-only", format: "r32float" } },
        ...this.aerialReadLayout(),
      ],
    });
    this.lutReadLayout = device.createBindGroupLayout({
      entries: [
        { binding: 2, visibility: C, texture: { sampleType: "unfilterable-float" } },
        { binding: 3, visibility: C, texture: { sampleType: "unfilterable-float" } },
        // (the aerial perspective's table: trace.wgsl apInA, apInB, apSamp)
        ...this.aerialReadLayout(),
      ],
    });
    // (the aerial perspective's table: written by its own pass — trace.wgsl aerial —, one for the live view)
    this.aerialWriteLayout = device.createBindGroupLayout({
      entries: [
        { binding: 7, visibility: C, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
        { binding: 8, visibility: C, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
      ],
    });
    this.aerialLayout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, this.aerialWriteLayout] });
    this.aerialWrite = device.createBindGroup({
      layout: this.aerialWriteLayout,
      entries: [
        { binding: 7, resource: this.aerialTex[0]!.createView() },
        { binding: 8, resource: this.aerialTex[1]!.createView() },
      ],
    });

    this.mainLayout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, this.lutReadLayout] });
    if (this.cloudWriteLayout)
      this.cloudsLayout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, this.cloudWriteLayout] });
    this.lutLayout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, this.lutWriteLayout] });
    // (compiled asynchronously: the tracer is a huge shader — on Windows (D3D12) one takes a
    // minute or more, and a synchronous compile stalls the GPU process until the browser's watchdog kills it)
    const mkTrace = (quality: boolean) =>
      device.createComputePipelineAsync({
        layout: this.mainLayout,
        compute: { module: traceModule, entryPoint: "main", constants: { QUALITY_PIPELINE: quality ? 1 : 0 } },
      });
    const mkLut = (quality: boolean) =>
      device.createComputePipelineAsync({
        layout: this.lutLayout,
        compute: { module: traceModule, entryPoint: "lut", constants: { QUALITY_PIPELINE: quality ? 1 : 0 } },
      });
    {
      const tx = [
        device.createTexture({ size: [1, 1], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING }),
        device.createTexture({ size: [1, 1], format: "r32float", usage: GPUTextureUsage.TEXTURE_BINDING }),
      ];
      this.lutDummy = device.createBindGroup({
        layout: this.lutReadLayout,
        entries: [{ binding: 2, resource: tx[0]!.createView() }, { binding: 3, resource: tx[1]!.createView() }, ...this.aerialRead()],
      });
    }
    // (the first image needs only the scene's specialised realtime kernel — compiled at the first frame,
    // once the scene's features are known (traceVariant) —, not the general one: the general kernel, the
    // LUT and the quality kernel compile in the background; until they land a still view stays on the
    // realtime path and the LUT pass is skipped — see frame() and dispatchTrace)
    this.firstImage = new Promise<void>((resolve) => (this.resolveFirstImage = resolve));
    this.generalCompile = new AsyncResource(
      async () => {
        const t0 = performance.now();
        const pipelines = await Promise.all([
          mkTrace(false),
          device.createComputePipelineAsync({
            layout,
            compute: { module: traceModule, entryPoint: "env", constants: { QUALITY_PIPELINE: 0 } },
          }),
        ]).catch((e) => {
          this.noteCompile("general main + env", FEATURES_ALL, t0, false);
          throw e;
        });
        this.noteCompile("general main + env", FEATURES_ALL, t0, true);
        gpuDiagnostics.record("pipeline-compiled", `general tracer (main + env): ${((performance.now() - t0) / 1000).toFixed(1)} s`);
        return pipelines;
      },
      () => {
        const p = this.generalCompile.value;
        if (p) [this.tracePipeline, this.envPipeline] = p;
        else {
          gpuDiagnostics.record("optional-pipeline-failure", this.generalCompile.error);
          console.warn("General tracer unavailable:", this.generalCompile.error);
          // (nothing drawn yet: neither the scene's kernel nor the general one — the start has failed)
          if (!this.firstFrameDoneAt && !this.lost)
            this.onTracerFailure?.(new Error(this.generalCompile.error ?? "the ray tracer could not be compiled"));
        }
        this.onAssets?.();
      },
      // (minutes on a slow D3D12 driver: its landing late still taken)
      900_000,
      () => !this.lost,
    );
    // (the general kernel's start, held while the frame's own compiles run: retried when the queue goes idle)
    this.variantQueue.onIdle = () => this.maybeStartGeneral();
    // (a compile timed out but landing later, the device still there: taken after all)
    const optional = (label: string, make: () => Promise<GPUComputePipeline>, publish: (p: GPUComputePipeline) => void) => {
      const compile = async () => {
        const t0 = performance.now();
        try {
          const p = await make();
          this.noteCompile(label, FEATURES_ALL, t0, true);
          return p;
        } catch (e) {
          this.noteCompile(label, FEATURES_ALL, t0, false);
          throw e;
        }
      };
      const resource = new AsyncResource(
        compile,
        () => {
          if (resource.value) publish(resource.value);
          else {
            gpuDiagnostics.record("optional-pipeline-failure", resource.error);
            console.warn("Optional tracer pipeline unavailable:", resource.error);
          }
          this.onAssets?.();
        },
        undefined,
        () => !this.lost,
      );
      return resource;
    };
    this.qualityCompile = optional(
      "general main (quality)",
      () => mkTrace(true),
      (p) => {
        this.qualityPipeline = p;
        // (its LUT at once, not at the next completed frame: a converged view submits none)
        if (this.lutWanted) void this.lutQCompile.start();
      },
    );
    this.lutCompile = optional(
      "general lut",
      () => mkLut(false),
      (p) => {
        this.lutPipeline = p;
      },
    );
    this.lutQCompile = optional(
      "general lut (quality)",
      () => mkLut(true),
      (p) => {
        this.lutQPipeline = p;
      },
    );
    this.traceModule = traceModule;
    this.tracePipeLayout = layout;
    this.characterRenderer = new CharacterRenderer(device);
    this.ship = new ShipRenderer(device, src.ship);
    this.endurance = new EnduranceRenderer(device, src.endurance);
    this.station = new StationRenderer(device, src.station);
    this.station.onLoaded = () => this.invalidate();
    this.ship.onLoaded = () => this.invalidate();
    this.endurance.onLoaded = () => this.invalidate();
    this.earthTiles = new EarthTiles(device);
    this.earthTiles.onChange = () => {
      if (!this.offline) this.invalidate();
    };
    // (another window's texture — the detail's reach —: the bind groups holding the old one rebuilt)
    this.earthTiles.onResize = () => {
      if (this.live) this.bindTarget(this.live);
      if (this.offline) this.bindTarget(this.offline.target);
      if (!this.offline) this.invalidate();
    };
    this.earthSurface = new EarthSurface(device, undefined, device.limits.maxSampledTexturesPerShaderStage >= SURFACE_TEXTURE_LIMIT);
    this.surfaceSampler = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 4 });
    this.earthSurface.onChange = () => {
      if (this.live) this.bindTarget(this.live);
      if (this.offline) this.bindTarget(this.offline.target);
      if (!this.offline) this.invalidate();
    };
    this.earthSurface.onContent = () => {
      if (!this.offline) this.invalidate();
    };
    this.earthScenery = new EarthScenery(device);
    this.earthScenery.onChange = () => {
      if (this.live) this.bindTarget(this.live);
      if (this.offline) this.bindTarget(this.offline.target);
      if (!this.offline) this.invalidate();
    };
    this.earthScenery.onContent = () => {
      if (!this.offline) this.invalidate();
    };
    this.prof = new GpuProfiler(device);
    // (on whenever the GPU has timestamps: no measurable cost, and the realtime subsampling uses it)
    this.prof.enabled = this.prof.supported;
    this.ship.prof = this.prof;
    const mkDisplay = (fmt: GPUTextureFormat, label: string) =>
      device.createRenderPipelineAsync({
        label,
        layout: "auto",
        vertex: { module: displayModule, entryPoint: "vs" },
        fragment: { module: displayModule, entryPoint: "fs", targets: [{ format: fmt }] },
        primitive: { topology: "triangle-list" },
      });
    const mkPost = (entryPoint: string) =>
      device.createComputePipelineAsync({ layout: "auto", compute: { module: postModule, entryPoint } });
    // The live display/post chain is awaited at create. The 8-bit export compiles on demand;
    // rgba16float remains in the core because the HDR canvas uses it too. Vessel constructors
    // still create synchronous pipelines: model readiness does not defer that compilation work.
    this.dofDummy = device.createTexture({ size: [1, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.export8Compile = new AsyncResource(
      () => mkDisplay("rgba8unorm", "8-bit export"),
      () => {
        this.export8Pipeline = this.export8Compile.value;
      },
    );
    this.auxCompiled = Promise.all([
      mkDisplay(format, "SDR canvas").then((p) => (this.displayPipeline = p)),
      mkDisplay("rgba16float", "HDR canvas and 16-bit export").then((p) => (this.export16Pipeline = p)),
      mkPost("resolve").then((p) => (this.postResolve = p)),
      mkPost("gatherH").then((p) => (this.postGatherH = p)),
      mkPost("down").then((p) => (this.postDown = p)),
      mkPost("downShip").then((p) => (this.postDownShip = p)),
      mkPost("dof").then((p) => (this.postDof = p)),
      mkPost("flareMeter").then((p) => (this.postFlare = p)),
      mkPost("up").then((p) => (this.postUp = p)),
      mkPost("polgrid").then((p) => (this.postPolGrid = p)),
      mkPost("beamH").then((p) => (this.postBeamH = p)),
      mkPost("atrous").then((p) => (this.postAtrous = p)),
      mkPost("temporal").then((p) => (this.postTemporal = p)),
      mkPost("taau").then((p) => (this.postTaau = p)),
      mkPost("cloudTemporal").then((p) => (this.postCloudTemporal = p)),
      mkPost("motionBlur").then((p) => (this.postMotion = p)),
      mkPost("occlusion").then((p) => (this.postOcclusion = p)),
      mkPost("stars").then((p) => (this.postStars = p)),
      mkPost("beamV").then((p) => (this.postBeamV = p)),
      mkPost("meter").then((p) => (this.meterPipeline = p)),
    ]).then(() => {});
    // (the cockpit's mask: an optimisation, not waited for — a browser that refuses its shader keeps it off, the
    // renderer starting all the same)
    const maskModule = device.createShaderModule({ code: maskWGSL, label: "mask" });
    Promise.all(
      (["cell", "main"] as const).map((entryPoint) =>
        device.createComputePipelineAsync({ layout: "auto", compute: { module: maskModule, entryPoint } }),
      ),
    )
      .then(([cell, main]) => {
        this.maskCellPipeline = cell;
        this.maskPipeline = main;
      })
      .catch((e) => console.warn("cockpit mask unavailable:", e));
    this.maskBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.histBuf = device.createBuffer({ size: 512, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.histStage = device.createBuffer({ size: 512, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.spotBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // (the tracer's read-only tables, one buffer — gpu-tables.ts, PLAN-MONDE M9: the bodies; after them the
    // light probe's harmonics, copied there on the GPU — see dispatchEnv —; the colours' LUTs; the path)
    this.bodyBuf = device.createBuffer({
      size: TABLE_VEC4S * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // (the mountains' warp's grids in it, after the walking grid: system/warp-grid.ts)
    this.warpOut = new WarpGrid(device, this.bodyBuf, TABLE_WARP, traceWGSL);
    this.paramBuf = device.createBuffer({ size: this.params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.probeBuf = device.createBuffer({ size: PROBE_W * PROBE_H * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.probeStage = device.createBuffer({ size: PROBE_W * PROBE_H * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.displayBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.chart = new ChartOverlay(device, src.overlay);
    // (trace.wgsl: the colours' LUTs at LUT_OFF — the synchrotron's from LUT_N = BB_LUT_SIZE)
    const lut = buildBlackbodyLUT();
    const sync = buildSynchrotronLUT();
    device.queue.writeBuffer(this.bodyBuf, TABLE_LUT * 16, lut);
    device.queue.writeBuffer(this.bodyBuf, TABLE_LUT * 16 + lut.byteLength, sync);
    // trilinear + anisotropic: sky lookups use explicit gradients from the lensed pixel footprint
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 16,
      addressModeU: "repeat",
    });
    this.clampSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const placeholder = () => {
      const t = device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture({ texture: t }, new Uint8Array([0, 0, 0, 255]), {}, [1, 1]);
      return t;
    };
    this.bgTexture = placeholder();
    this.mwTexture = placeholder();
    this.starLodTexture = placeholder();
    this.lensDirt = placeholder();
    this.planetMaps = placeholderMaps(device);
    this.earthMaps = placeholderEarth(device);
    this.hdMap = placeholderHd(device);
    // empty catalogue: grid 1, no stars
    this.catalogue = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.catalogue, 0, new Uint32Array([0x31525453, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    this.skyBuilder = new SkyTextureBuilder(device, src.sky);
  }

  /**
   * Loads the real sky (Gaia DR2 Milky Way map + Hipparcos/HYG catalogue) in the background; the
   * procedural sky is shown until it is ready. Its downloads may already be running (started
   * before Renderer.create() returned — prefetchSkyAssets): the buffers then come from there.
   */
  async loadSky(): Promise<void> {
    const stars = Promise.all([
      loadPackedTexture(this.device, starLodUrl, (u) => skyAsset(u, "stars")),
      loadStarCatalogue(this.device, starCatalogueUrl, (u) => skyAsset(u, "stars")),
    ]);
    const [bitmap, [lod, cat]] = await Promise.all([
      loading.track(
        "sky",
        "",
        skyAsset(milkyWayUrl, "sky")
          .then((r) => r.blob())
          .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" })),
      ),
      loading.track("stars", "", stars),
    ]);
    this.mwTexture = this.skyBuilder.build(bitmap, "log16", this.device.limits.maxTextureDimension2D);
    this.starLodTexture = lod;
    // (the lens's dust: shown by the glare over white, with the flare — display.wgsl lensDirtGlow)
    await fetch(lensDirtUrl)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        const tex = this.device.createTexture({
          size: [bmp.width, bmp.height],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
        this.lensDirt = tex;
      })
      .catch(() => {});
    this.catalogue = cat;
    this.skyReady = true;
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    this.invalidate();
  }

  /** Loads the solar system's maps in the background, the first time a scene needs them. */
  private requestPlanetMaps() {
    this.mapsRequested = true;
    loading.stage("maps", t("Planets & moons — the solar system's maps"), { weight: 3 });
    loading
      .track(
        "maps",
        "",
        loadPlanetMaps(this.device, (u) => loading.fetch(u, "maps")),
      )
      .then((maps) => {
        this.planetMaps = maps;
        if (this.live) this.bindTarget(this.live);
        if (this.offline) this.bindTarget(this.offline.target);
        this.invalidate();
        this.onAssets?.();
      })
      .catch((e) => console.warn("Planet maps unavailable:", e));
  }

  /** Loads the Earth's maps of a tier in the background (the ones it has kept till they are in). */
  private requestEarthMaps(tier: EarthTier) {
    this.earthWant = tier;
    const token = ++this.earthJob;
    const first = !this.earthMaps.tier;
    if (first) loading.stage("earth", t("The Earth — day, night, clouds and relief"), { weight: 3 });
    // (out of GPU memory while the maps load: the tier below, or none — not a lost device)
    this.device.pushErrorScope("out-of-memory");
    const fetcher = first ? (u: string) => loading.fetch(u, "earth") : undefined;
    // (the geoid with them: the ground and the sea over the ellipsoid — system/geoid.ts — before the ground is stood on)
    // (none — its file refused —: N stays 0 on both sides, the sea on the ellipsoid as before)
    const geoidJob = loadGeoid(fetcher).catch((e) => (console.warn("Geoid unavailable:", e), null));
    const job = Promise.all([loadEarthMaps(this.device, tier, fetcher), geoidJob]).then(([maps, geoid]) => {
      if (geoid && !this.geoidIn) {
        this.device.queue.writeBuffer(this.bodyBuf, TABLE_GEOID * 16, geoidTable(geoid));
        this.geoidIn = true;
      }
      return maps;
    });
    const oom = this.device.popErrorScope();
    (first ? loading.track("earth", "", job) : job)
      .then(async (maps) => {
        // (a later request won — another tier, or none): these are not used
        if (token !== this.earthJob) return [maps.cube, maps.night, maps.elev].forEach((t) => t.destroy());
        if (await oom) {
          [maps.cube, maps.night, maps.elev].forEach((t) => t.destroy());
          console.warn(`Out of GPU memory for the Earth's ${tier} maps`);
          this.earthCap = tier === "high" ? "med" : "none";
          if (tier === "high") this.requestEarthMaps("med");
          else this.releaseEarthMaps();
          return;
        }
        const old = this.earthMaps;
        this.earthMaps = maps;
        // (a new night cube: the day's clouds made in it again)
        this.dayCloudsOf = null;
        // (the ground the ship stands on: the heights drawn — the terrain tiles over the map; the maps'
        // tier, hence the hardware's on a weak one, deliberately: quality-policy.ts, earthMapQuality)
        if (maps.heights) {
          const { map, W, H } = maps.heights;
          setGroundRelief(
            "earth",
            // (the runways graded: the gear rolls on them — game/sites.ts)
            earthHeightSampler(map, W, H, (q, foot) => this.earthTiles.heightAt(q, foot), runwayGrade),
          );
          // (a tile that will not load — offline, refused: the map's heights there, as the ground had them)
          this.earthTiles.fallback = tileFallbackSampler(map, W, H);
          // (the relief's ceiling round the camera: the map's highest in 1° cells)
          this.mapCells = new MapCells(map, W, H);
        }
        if (this.live) this.bindTarget(this.live);
        if (this.offline) {
          this.bindTarget(this.offline.target);
          // (an offline render begun before them: begun again)
          Object.assign(this.offline, { sampleIndex: 0, bandY: 0, done: false });
        }
        // (the old ones once the frames drawing with them are done)
        void this.device.queue.onSubmittedWorkDone().then(() => [old.cube, old.night, old.elev].forEach((t) => t.destroy()));
        this.invalidate();
        this.onAssets?.();
      })
      .catch((e) => console.warn("Earth maps unavailable:", e));
  }

  /**
   * The clouds of the day wanted now (the real weather chosen, the Earth's maps in, a mosaic that day): the
   * day's fetched and made if it is not here; true when they are in (the tracer reads them).
   */
  private dayCloudsWanted(s: Settings, time: number): boolean {
    if (s.weather !== "real" || !this.dayCloudsOn || !this.earthMaps.tier) return false;
    const w = dayCloudsFor(utcOf(time), Date.now());
    if (!w) return false;
    if (this.dayCloudsOf?.date === w.date) return true;
    const failed = this.dayCloudsFail?.date === w.date && Date.now() - this.dayCloudsFail.at < 5 * 60e3;
    if (this.dayCloudsJob !== w.date && !failed) this.loadDayClouds(w);
    return false;
  }

  /** The air's refractivity at sea level (n − 1): 2.93·10⁻⁴ at 15 °C and 1013.25 hPa, as the density —
   *  the real weather's temperature at the ground when it is in (refraction.ts). */
  refractivity(s: Settings): number {
    const m = s.weather === "real" ? this.weatherReal?.model : undefined;
    return seaRefractivity(m ? m.T : 15);
  }

  /** The satellites' mosaic of the day in force (the map's weather layer), or null. */
  dayCloudsMosaic(): { img: ImageBitmap; date: string; layer: string } | null {
    return this.dayCloudsOf && this.dayCloudsImage?.date === this.dayCloudsOf.date ? this.dayCloudsImage : null;
  }

  private loadDayClouds(w: { date: string; layer: string }) {
    this.dayCloudsJob = w.date;
    const kept = this.dayCloudsImage?.date === w.date ? Promise.resolve(this.dayCloudsImage.img) : null;
    (
      kept ??
      fetch(dayCloudsUrl(w.layer, w.date))
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))))
        .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
    )
      .then((img) => {
        if (img !== this.dayCloudsImage?.img) {
          this.dayCloudsImage?.img.close();
          this.dayCloudsImage = { ...w, img };
        }
        // (another day asked meanwhile, or the maps gone: not used)
        if (this.dayCloudsJob !== w.date || !this.earthMaps.tier) return;
        buildDayClouds(this.device, img, this.earthMaps.cube, this.earthMaps.night);
        this.dayCloudsOf = { date: w.date, layer: w.layer };
        this.dayCloudsJob = null;
        this.invalidate();
      })
      .catch((e) => {
        console.warn(`The clouds of ${w.date} unavailable:`, e);
        this.dayCloudsFail = { date: w.date, at: Date.now() };
        if (this.dayCloudsJob === w.date) this.dayCloudsJob = null;
      });
  }

  /** Frees the Earth's maps (it is a few pixels across, or out of the scene): the placeholder back. */
  private releaseEarthMaps() {
    this.earthWant = null;
    this.earthJob++;
    const old = this.earthMaps;
    if (!old.tier) return;
    this.earthMaps = placeholderEarth(this.device);
    this.dayCloudsOf = null;
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    void this.device.queue.onSubmittedWorkDone().then(() => [old.cube, old.night, old.elev].forEach((t) => t.destroy()));
    this.invalidate();
  }

  /** Frees the GPU at once (the page going away). */
  release() {
    this.earthScenery.dispose();
    this.earthSurface.dispose();
    this.terrainSurfaceCache?.dispose();
    this.terrainRaster?.dispose();
    this.sceneryRaster?.dispose();
    this.device.destroy();
  }

  /** Frees the finer maps (the camera left their world): the placeholder back. */
  private releaseHd() {
    const old = this.hdMap;
    this.groundHeights(old, null);
    this.hdMap = placeholderHd(this.device);
    this.hdLoading = null;
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    void this.device.queue.onSubmittedWorkDone().then(() => (old.color.destroy(), old.relief.destroy()));
    this.invalidate();
  }

  /** The ground a craft stands on: a world's measured heights while its finer maps are drawn (or not). */
  private groundHeights(m: HdMap, on: HdMap | null) {
    const id = m.name && m.dem ? SOLAR_BODIES.find((b) => b.map === m.name)?.id : undefined;
    if (!id) return;
    setGroundHeights(id, on?.dem ? mapHeightSampler(on.dem.map, on.dem.W, on.dem.H) : null);
  }

  /** Streams in a world's finer maps (the previous ones freed once loaded). */
  private requestHd(name: MapName) {
    if (this.hdMap.name === name || this.hdLoading === name) return;
    this.hdLoading = name;
    loadHdMap(this.device, name, this.tier)
      .then((m) => {
        // (superseded while it loaded: both its textures freed — the relief leaked before)
        if (!m || this.hdLoading !== name) {
          if (m) m.color.destroy(), m.relief.destroy();
          return;
        }
        const old = this.hdMap;
        this.groundHeights(old, null);
        this.hdMap = m;
        this.hdLoading = null;
        this.groundHeights(m, m);
        if (this.live) this.bindTarget(this.live);
        if (this.offline) this.bindTarget(this.offline.target);
        void this.device.queue.onSubmittedWorkDone().then(() => (old.color.destroy(), old.relief.destroy()));
        this.invalidate();
        this.onAssets?.();
      })
      .catch((e) => {
        this.hdLoading = null;
        console.warn("Finer maps unavailable:", e);
      });
  }

  get realSkyLoaded() {
    return this.skyReady;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    let device: GPUDevice | null = null;
    let abandoned = false;
    let cancelTimeout!: () => void;
    let rejectLost!: (error: Error) => void;
    // (180 s of the page seen: a tab left in the background while it starts is not declared hung)
    const unavailable = new Promise<never>((_, reject) => {
      rejectLost = reject;
      cancelTimeout = visibleTimeout(180_000, () => reject(new Error(`Graphics startup timed out after 180 s (${gpuDiagnostics.stage})`)));
    });
    try {
      return await Promise.race([
        Renderer.createGraphics(canvas, (created) => {
          device = created;
          if (abandoned) {
            created.destroy();
            throw new Error("Graphics startup already terminated");
          }
          void created.lost.then((info) =>
            rejectLost(new Error(`GPU lost during startup (${info.reason}): ${info.message || "No explanation supplied by browser"}`)),
          );
        }),
        unavailable,
      ]);
    } catch (error) {
      abandoned = true;
      (device as GPUDevice | null)?.destroy();
      throw error;
    } finally {
      cancelTimeout();
    }
  }

  private static async createGraphics(canvas: HTMLCanvasElement, onDevice: (device: GPUDevice) => void): Promise<Renderer> {
    gpuDiagnostics.enter("webgpu-availability");
    if (!navigator.gpu) throw new Error(t("WebGPU is not available in this browser."));
    loading.stage("gpu", t("WebGPU — the graphics device"), { weight: 0.5, indeterminate: true, eta: 0.5 });
    loading.stage("shaders", t("Shaders — geodesics, disk, sky, Ranger"), { weight: 1 });
    gpuDiagnostics.enter("adapter-request");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error(t("No WebGPU adapter found."));
    gpuDiagnostics.setContext({
      adapter: {
        vendor: adapter.info?.vendor,
        architecture: adapter.info?.architecture,
        device: adapter.info?.device,
        description: adapter.info?.description,
        features: [...adapter.features].sort(),
        limits: Object.fromEntries(
          [
            "maxStorageBuffersPerShaderStage",
            "maxBufferSize",
            "maxStorageBufferBindingSize",
            "maxTextureDimension2D",
            "maxComputeInvocationsPerWorkgroup",
            "maxComputeWorkgroupStorageSize",
          ].map((key) => [key, (adapter.limits as unknown as Record<string, number>)[key]]),
        ),
      },
    });
    // (the tracer's bind group holds 8 storage buffers — WebGPU's default, every adapter's: PLAN-MONDE M9;
    // before, 10 shut out a part of Android and Safari)
    gpuDiagnostics.enter("device-request");
    const device = await adapter.requestDevice({
      // (the GPU profiler's timestamps, when the adapter has them)
      // (and the compressed textures it samples: the colour maps' KTX2, transcoded to BC7 or ASTC)
      requiredFeatures: (["timestamp-query", "texture-compression-bc", "texture-compression-astc"] as GPUFeatureName[]).filter((f) =>
        adapter.features.has(f),
      ),
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
        maxSampledTexturesPerShaderStage: Math.min(
          Math.max(
            AERIAL_TEXTURE_LIMIT,
            RASTER_HINT_TEXTURE_LIMIT,
            SUN_SHADOW_TEXTURE_LIMIT,
            CLOUD_PASS_TEXTURE_LIMIT,
            CLOUD_SHADOW_TEXTURE_LIMIT,
            TREE_SHADOW_TEXTURE_LIMIT,
          ),
          adapter.limits.maxSampledTexturesPerShaderStage,
        ),
        maxStorageBuffersPerShaderStage: Math.min(SCENERY_STORAGE_LIMIT, adapter.limits.maxStorageBuffersPerShaderStage),
      },
    });
    onDevice(device);
    // (the device lost — a driver reset, the GPU's memory exhausted —: said to the page, which saves the
    // flight and offers a reload; nothing more is sent to it)
    const lost = device.lost.then((info) => {
      gpuDiagnostics.record(`device-lost:${info.reason}`, info.message || "Browser supplied no explanation", info.reason !== "destroyed");
      console.error("WebGPU device lost:", info.message);
      return info;
    });
    // Capture errors from canvas setup and constructors as well as later frame submissions (an error
    // repeated every frame is counted by the diagnostic, its write deferred — not one write a frame).
    device.addEventListener("uncapturederror", (e) => {
      gpuDiagnostics.record("uncaptured-gpu-error", (e as GPUUncapturedErrorEvent).error);
    });
    gpuDiagnostics.enter("canvas-configuration");
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error(t("Could not create a WebGPU canvas context."));
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    loading.done("gpu");
    gpuDiagnostics.enter("shader-download");
    const src = {
      trace: composeTracer(await wgsl(traceWGSL), await wgsl(forestSource), device.limits),
      seafft: await wgsl(seafftWGSL),
      display: await wgsl(displayWGSL),
      post: await wgsl(postWGSL),
      sky: await wgsl(skyWGSL),
      ship: await wgsl(shipWGSL),
      endurance: await wgsl(enduranceWGSL),
      station: await wgsl(stationWGSL),
      overlay: await wgsl(overlayWGSL),
    };
    loading.set("shaders", 0.3);
    device.pushErrorScope("validation");
    gpuDiagnostics.enter("pipeline-creation");
    const r = new Renderer(device, context, format, src);
    r.tier = guessTier(adapter);
    // (what the adapter is and can do: the benchmark's report)
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    const lim = adapter.limits as unknown as Record<string, number>;
    r.adapter = {
      vendor: info?.vendor ?? "",
      architecture: info?.architecture ?? "",
      device: info?.device ?? "",
      description: info?.description ?? "",
      fallback: !!(info as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | undefined)?.isFallbackAdapter,
      features: [...adapter.features].sort(),
      limits: Object.fromEntries(
        [
          "maxStorageBuffersPerShaderStage",
          "maxSampledTexturesPerShaderStage",
          "maxBufferSize",
          "maxStorageBufferBindingSize",
          "maxTextureDimension2D",
          "maxComputeInvocationsPerWorkgroup",
          "maxComputeWorkgroupStorageSize",
          "maxBindGroups",
        ].map((k) => [k, lim[k] ?? 0]),
      ),
    };
    // (this adapter's tier measured an earlier session: start from it rather than the guess — the
    // measure corrects the guess's known blindnesses, Apple's especially — plan §3.4)
    const remembered = rememberedLevel(adapterId(r.adapter));
    if (remembered !== null && remembered !== r.tier.level) r.tier = tierAt(remembered, `${r.tier.label} · remembered`);
    void lost.then((info) => {
      r.earthScenery.dispose();
      r.earthSurface.dispose();
      r.terrainSurfaceCache?.dispose();
      r.terrainRaster?.dispose();
      r.sceneryRaster?.dispose();
      // (a loss simulated — the e2e's, __bh.gpu.lose(): the device destroyed — told as a real one)
      r.lost = r.simulatedLoss ? "simulated" : info.reason === "destroyed" ? "released" : info.message || t("the GPU was reset");
      if (r.offline) r.offline.error = r.lost;
      if (info.reason !== "destroyed" || r.simulatedLoss) r.onLost?.(r.lost);
    });
    // (errors the code did not scope: counted, the first ones told — a silent black image otherwise;
    // the console has the first ten, the diagnostic counts them all)
    device.addEventListener("uncapturederror", (e) => {
      const m = (e as GPUUncapturedErrorEvent).error.message;
      r.gpuErrors++;
      if (r.gpuErrors <= 10) console.error("WebGPU error:", m);
      if (r.gpuErrors <= 3) r.onGpuError?.(m);
    });
    // (the pipelines compile in the GPU process: the display and post chain awaited below; the tracer —
    // the scene's specialised kernel — at the first frame, the general one after it; optional LUT/quality
    // pipelines start later. Their independent failures preserve realtime
    // rendering and are exposed through pipelineStatus, the HUD and offlineStatus.error.)
    loading.stage("pipelines", t("Compiling the ray tracer — first image"), {
      weight: 4,
      indeterminate: true,
      eta: 3,
      remaining: () => r.sceneCompileEta(),
    });
    // (its failure held as a value: told after the WGSL's own messages, which name the line; the
    // display's and the post chain's async compiles are part of what the first frame needs)
    const tracerFailure = r.auxCompiled.then(
      () => null,
      (e: Error) => e,
    );
    // (the shaders' own messages, which name the line: the modules the constructor already made
    // are read back — the tracer's 6 362 lines are not parsed twice — and all in parallel, the
    // loading bar advancing as each answers)
    const modules: [string, GPUShaderModule][] = [
      ["trace", r.traceModule],
      ["display", r.displayModule],
      ["post", r.postModule],
      ["sky", r.skyBuilder.module],
      ["ship", r.ship.module],
      ["endurance", r.endurance.module],
      ["station", r.station.module],
      ["character", r.characterRenderer.module],
      ["overlay", r.chart.module],
    ];
    let checked = 0;
    gpuDiagnostics.enter("shader-validation");
    const failures = await Promise.all(
      modules.map(async ([name, module]) => {
        const info = await module.getCompilationInfo();
        loading.set("shaders", 0.3 + (0.7 * ++checked) / modules.length);
        const errors = info.messages.filter((m) => m.type === "error");
        return errors.length
          ? `${tf("{0}.wgsl failed to compile:", name)}\n${errors.map((m) => `  ${m.lineNum}:${m.linePos} ${m.message}`).join("\n")}`
          : null;
      }),
    );
    const failure0 = failures.find((f) => f !== null);
    if (failure0) throw new Error(failure0);
    gpuDiagnostics.enter("core-pipeline-compilation");
    const failure = await tracerFailure;
    if (failure) throw new Error(tf("The ray tracer's pipelines failed to compile: {0}", failure.message));
    const err = await device.popErrorScope();
    if (err) throw new Error(tf("WebGPU pipeline creation failed: {0}", err.message));
    loading.done("shaders");
    // (the scene's tracer compiles from the first frame on: "first-frame" once it has landed)
    gpuDiagnostics.enter("tracer-compilation");
    return r;
  }

  /** Extended-range output currently active on the canvas. */
  get hdr() {
    return this.hdrActive;
  }

  /**
   * Switches the canvas between SDR (preferred 8-bit format) and extended range (rgba16float with
   * tone mapping "extended": values above 1 are shown brighter than SDR white on EDR/HDR screens).
   */
  private configureOutput(s: Settings) {
    const screenHdr = globalThis.matchMedia?.("(dynamic-range: high)").matches ?? false;
    const want = s.hdr === "on" || (s.hdr === "auto" && screenHdr);
    if (want === this.hdrActive) return;
    this.hdrActive = want;
    this.context.configure(
      want
        ? { device: this.device, format: "rgba16float", alphaMode: "opaque", toneMapping: { mode: "extended" } }
        : { device: this.device, format: this.sdrFormat, alphaMode: "opaque" },
    );
  }

  /** the sky chart's lines over the image (skychart.ts) */
  private chart: ChartOverlay;
  private chartDirty = false;
  /** the sky chart's lines from now on (skychart.ts's segments; none: null) — redrawn at once, even over a
   *  still image */
  setChart(segs: Float32Array | null, count: number) {
    if (!segs && !this.chart.active) return;
    this.chart.set(segs, count);
    this.chartDirty = true;
  }
  /** where the image lies in an output of outW × outH (uv_out = uv · (sx, sy) + (ox, oy)): writeDisplay's */
  private displayView(target: Target, outW: number, outH: number, letterbox: boolean): [number, number, number, number] {
    if (!letterbox) return [1, 1, 0, 0];
    const k = Math.min(outW / target.width, outH / target.height);
    const sx = (target.width * k) / outW,
      sy = (target.height * k) / outH;
    return [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
  }
  /** (the lines' widths are CSS pixels of the view: output pixels per CSS pixel on the page, or — an export —
   *  per CSS pixel of the image as the page shows it) */
  private encodeChart(
    enc: GPUCommandEncoder,
    s: Settings,
    t: Target,
    view: GPUTextureView,
    format: GPUTextureFormat,
    outW: number,
    outH: number,
    letterbox: boolean,
    toCanvas = true,
  ) {
    if (!this.chart.active) return;
    const cv = this.context.canvas as HTMLCanvasElement;
    const css = Math.max(cv.clientWidth || cv.width, 1);
    const shown = toCanvas ? css : this.offline ? this.displayView(t, cv.width, cv.height, true)[0] * css : css;
    const ship =
      (s.ship || this.craftsShown) && this.ship.ready
        ? { view: this.ship.target(t.hdr).resolved.createView(), rect: this.ship.rectFor(t.hdr) }
        : null;
    this.chart.encode(
      enc,
      view,
      format,
      outW,
      outH,
      this.displayView(t, outW, outH, letterbox),
      t.moments,
      t.width,
      t.height,
      outW / shown,
      ship,
    );
  }

  private get canvasPipeline() {
    return this.hdrActive ? this.export16Pipeline : this.displayPipeline;
  }

  get size() {
    return { width: this.live?.width ?? 0, height: this.live?.height ?? 0 };
  }

  /**
   * The camera's predicted free fall (black-hole frame, flat map of BL coordinates), drawn by the
   * tracer as a thin glowing dashed tube so that it is lensed like the rest of the scene. Points are
   * resampled to ≤ 256; w = fraction along the path (dashes, colour towards the end).
   */
  setCameraPath(path: { pts: [number, number, number][]; fate: string; at: number } | null) {
    if (path === this.pathKey) return false;
    this.pathKey = path;
    if (!path || path.pts.length < 2) {
      const changed = this.pathCount !== 0;
      this.pathCount = 0;
      return changed;
    }
    const n = Math.min(PATH_MAX, path.pts.length);
    const data = new Float32Array((PATH_MAX + PATH_MAX / PATH_CHUNK) * 4);
    for (let i = 0; i < n; i++) {
      const src = path.pts[Math.round((i * (path.pts.length - 1)) / (n - 1))]!;
      data.set([src[0], src[1], src[2], i / (n - 1)], i * 4);
    }
    // bounding sphere of each chunk of segments [16k, 16k + 16]
    for (let c = 0; c * PATH_CHUNK < n - 1; c++) {
      const i0 = c * PATH_CHUNK;
      const i1 = Math.min(n - 1, i0 + PATH_CHUNK);
      const ctr = [0, 0, 0];
      for (let i = i0; i <= i1; i++) for (let k = 0; k < 3; k++) ctr[k]! += data[i * 4 + k]! / (i1 - i0 + 1);
      let rad = 0;
      for (let i = i0; i <= i1; i++)
        rad = Math.max(rad, Math.hypot(data[i * 4]! - ctr[0]!, data[i * 4 + 1]! - ctr[1]!, data[i * 4 + 2]! - ctr[2]!));
      data.set([ctr[0]!, ctr[1]!, ctr[2]!, rad], (PATH_MAX + c) * 4);
    }
    this.device.queue.writeBuffer(this.bodyBuf, TABLE_PATH * 16, data);
    this.pathCount = n;
    this.pathFate = path.fate === "horizon" || path.fate === "star" ? 1 : path.fate === "escape" ? 2 : 0; // (red end: falls in)
    return true;
  }

  /** Largest offline render the device can hold (accumulation buffer + texture limits). */
  get maxRender() {
    const l = this.device.limits;
    return {
      dimension: l.maxTextureDimension2D,
      pixels: Math.floor(Math.min(l.maxBufferSize, l.maxStorageBufferBindingSize) / 16),
    };
  }

  /**
   * Realtime frames keep the samples of the last MAX_SAMPLE_AGE M of simulated time only: each pixel
   * is refreshed once every block² frames, so with time running older samples would show the disk
   * where it was up to seconds ago (smeared rotation). Still time: everything since the epoch.
   */
  private updateValidFrom(time: number) {
    const ft = this.frameTimes;
    ft.push({ stamp: this.frameStamp, time });
    while (ft.length > 1 && (ft[0]!.stamp < this.epoch || Math.abs(time - ft[0]!.time) > MAX_SAMPLE_AGE)) ft.shift();
    this.validFrom = Math.max(this.epoch, ft[0]!.stamp);
  }

  /** Scene changed: previous samples of the live view become stale. */
  invalidate() {
    this.frameTimes.length = 0;
    this.validFrom = this.frameStamp + 1;
    this.epoch = this.frameStamp + 1;
    this.sampleIndex = 0;
    this.bandY = 0;
  }

  // ------------------------------------------------------------------------------------ targets
  private createTarget(width: number, height: number, polarization = true, live = false): Target {
    const d = this.device;
    const px = width * height;
    const polAcc = d.createBuffer({ size: polarization ? px * 8 : 16, usage: GPUBufferUsage.STORAGE });
    const polGrid = d.createBuffer({
      size: Math.max(16, Math.ceil(width / 6) * Math.ceil(height / 6) * 16),
      usage: GPUBufferUsage.STORAGE,
    });
    const polGridBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const accum = d.createBuffer({ size: px * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    // (copied from by rasterColumn — a diagnostic)
    const moments = d.createBuffer({ size: px * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }); // Σ l², depth
    const sceneDepth = d.createBuffer({ size: px * 4, usage: GPUBufferUsage.STORAGE }); // the occlusion depth
    // (words past the image: the sky's discs' rectangles — trace.wgsl main's layers z ≥ 1, renderer discRects —, then the frame
    // the raster's sea was last drawn — its last word: trace.wgsl shadeWater, renderer seaProbe)
    const stamps = d.createBuffer({
      size: (px + 4 * SKY_DISCS_MAX + 12 + 4) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    // realtime reconstruction of stale pixels (live view only): horizontal pass of the gather
    const gather = d.createBuffer({ size: live ? px * 16 : 16, usage: GPUBufferUsage.STORAGE });
    const stars = d.createBuffer({
      size: live ? px * 12 : 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const bloomLevels = Math.max(2, Math.min(8, Math.floor(Math.log2(Math.min(width, height))) - 3));
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
    // (render attachment: the spaceship is composited over mip 0)
    const hdr = d.createTexture({
      size: [width, height],
      format: "rgba16float",
      mipLevelCount: bloomLevels,
      usage: usage | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    });
    const bloomTex = d.createTexture({
      size: [Math.max(1, width >> 1), Math.max(1, height >> 1)],
      format: "rgba16float",
      mipLevelCount: bloomLevels - 1,
      usage,
    });
    const resolveBuf = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const shipRect = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const t: Target = {
      width,
      height,
      accum,
      moments,
      sceneDepth,
      sceneDepthBind: null,
      stamps,
      gather,
      stars,
      hdr,
      bloomTex,
      bloomLevels,
      resolveBuf,
      shipRect,
      dof: null,
      flare: {
        u: d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        out: d.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }),
        bind: null,
      },
      polAcc,
      polGrid,
      polGridBuf,
      polGridPass: null as unknown as GPUBindGroup,
      beam: null,
      denoise: null,
      temporal: null,
      blur: null,
      taau: null,
      lut: live ? this.makeLut(width, height) : null,
      traceBind: null as unknown as GPUBindGroup,
      probeBind: null as unknown as GPUBindGroup,
      postPasses: [],
      displayBinds: new Map(),
    };
    this.bindTarget(t);
    return t;
  }

  private destroyTarget(t: Target | null) {
    if (!t) return;
    for (const b of [
      t.accum,
      t.moments,
      t.sceneDepth,
      t.stamps,
      t.gather,
      t.stars,
      t.resolveBuf,
      t.shipRect,
      t.polAcc,
      t.polGrid,
      t.polGridBuf,
    ])
      b.destroy();
    this.ship.forget(t.hdr);
    t.dof?.tex.destroy();
    t.flare.u.destroy();
    t.flare.out.destroy();
    t.dof?.buf.destroy();
    t.hdr.destroy();
    t.bloomTex.destroy();
    t.beam?.tex.destroy();
    t.beam?.buf.destroy();
    t.denoise?.tex.destroy();
    t.denoise?.bufs.forEach((b) => b.destroy());
    t.temporal?.hist.forEach((h) => h.destroy());
    t.temporal?.alb.forEach((h) => h.destroy());
    t.blur?.tex.destroy();
    this.dropTaau(t);
    this.dropClouds(t);
    t.lut?.tex.forEach((x) => x.destroy());
    t.temporal?.buf.destroy();
  }

  /** The trace kernels' bind group entries for a target; `binding14` is the buffer of the probe or of the light probe. */
  private traceEntries(t: Target, binding14: GPUBuffer, raster?: GPUTexture, clouds = true, csm = true): GPUBindGroupEntry[] {
    return [
      { binding: 0, resource: { buffer: this.paramBuf } },
      { binding: 1, resource: { buffer: t.accum } },
      { binding: 3, resource: this.bgTexture.createView() },
      { binding: 4, resource: this.sampler },
      { binding: 5, resource: { buffer: t.moments } },
      { binding: 6, resource: { buffer: t.stamps } },
      { binding: 7, resource: { buffer: t.stars } },
      { binding: 8, resource: this.mwTexture.createView() },
      { binding: 9, resource: this.starLodTexture.createView() },
      { binding: 10, resource: { buffer: this.catalogue } },
      { binding: 11, resource: { buffer: t.polAcc } },
      { binding: 14, resource: { buffer: binding14 } },
      { binding: 15, resource: { buffer: this.bodyBuf } },
      { binding: 16, resource: srgbView(this.planetMaps.hi, "2d-array") },
      { binding: 17, resource: this.planetMaps.rings.createView({ dimension: "2d", format: SRGB }) },
      { binding: 18, resource: srgbView(this.planetMaps.lo, "2d-array") },
      { binding: 19, resource: srgbView(this.earthMaps.cube, "cube") },
      { binding: 20, resource: this.earthMaps.night.createView({ dimension: "cube" }) },
      { binding: 21, resource: this.earthMaps.elev.createView() },
      { binding: 22, resource: this.hdMap.color.createView({ format: hdColorFormat(this.hdMap.color) }) },
      { binding: 23, resource: this.hdMap.relief.createView() },
      { binding: 24, resource: this.noise3d.createView({ dimension: "3d" }) },
      { binding: 25, resource: this.noiseSampler },
      { binding: 26, resource: this.ship.shadowView },
      { binding: 28, resource: this.earthTiles.texture.createView({ dimension: "2d-array" }) },
      ...(this.earthScenery.supported ? [{ binding: 32, resource: { buffer: this.earthScenery.buffer } }] : []),
      ...(this.seaFft
        ? [
            { binding: 33, resource: this.seaFft.texture.createView({ dimension: "2d-array" }) },
            { binding: 34, resource: this.seaSampler },
          ]
        : []),
      ...(this.earthSurface.supported
        ? [
            { binding: 29, resource: this.earthSurface.colorView() },
            { binding: 30, resource: this.earthSurface.cover.createView({ dimension: "2d-array" }) },
            { binding: 31, resource: this.surfaceSampler },
          ]
        : []),
      ...(this.rasterHint ? [{ binding: RASTER_HINT_BINDING, resource: (raster ?? this.rasterDummy!).createView() }] : []),
      // (the relief's shadow map: the raster's own, with its distances; a stand-in elsewhere)
      ...(this.sunShadow
        ? [{ binding: SUN_SHADOW_BINDING, resource: ((raster && this.terrainRaster?.sunDepth) || this.sunDummy!).createView() }]
        : []),
      // (the cloud pass's buffers: read by the kernels; stand-ins where the pass writes them, and before they exist)
      ...(this.cloudPass
        ? CLOUD_PASS_BINDINGS.map((binding, i) => ({
            binding,
            resource: ((clouds && (i === 0 ? t.cloudA : t.cloudB)) || this.cloudDummies[i]!).createView(),
          }))
        : []),
      // (the clouds' shadow map: the stand-in for its own kernel, which writes it)
      ...(this.cloudShadow ? [{ binding: CLOUD_SHADOW_BINDING, resource: ((csm && this.csmTex) || this.csmDummy!).createView() }] : []),
      ...(this.treeShadow ? [{ binding: TREE_SHADOW_BINDING, resource: this.tsmTex!.createView({ dimension: "2d-array" }) }] : []),
    ];
  }

  /** A target's cloud-pass textures released (destroyTarget, or before they are made at a new size). */
  private dropClouds(t: Target) {
    for (const x of [t.cloudA, t.cloudB, t.cloudCurA, t.cloudCurB, t.cloudHistA]) x?.destroy();
    t.cloudA = t.cloudB = t.cloudCurA = t.cloudCurB = t.cloudHistA = undefined;
    t.cloudWrite = undefined;
    t.cloudTemporalBind = undefined;
    t.cloudHistValid = false;
  }

  private bindTarget(t: Target) {
    this.eventFrames = 3; // (new resources: the next frames' times are not the scene's)
    const d = this.device;
    t.hintBind = undefined;
    t.cloudBind = undefined;
    this.csmBind0 = undefined;
    // (the cloud pass's textures: the live view's only — the pass runs there alone —, made again when its size changes —
    // not at every rebinding, an asset streamed in: their history kept)
    const cw = Math.ceil(t.width / 2);
    const ch = Math.ceil(t.height / 2);
    const cloudsLive = t.gather.size > 16;
    if (this.cloudPass && this.cloudWriteLayout && cloudsLive && (t.cloudA?.width !== cw || t.cloudA?.height !== ch)) {
      this.dropClouds(t);
      const size = [cw, ch];
      const U = GPUTextureUsage;
      const mk = (label: string, usage: number) => d.createTexture({ label, size, format: "rgba32float", usage });
      // (this frame's march, the history's result the kernels read, the history kept for the next frame)
      t.cloudCurA = mk("cloud pass: light, cover", U.STORAGE_BINDING | U.TEXTURE_BINDING | U.COPY_SRC);
      t.cloudCurB = mk("cloud pass: distance, bound, depth", U.STORAGE_BINDING | U.TEXTURE_BINDING | U.COPY_SRC);
      t.cloudA = mk("clouds: light, cover", U.STORAGE_BINDING | U.TEXTURE_BINDING | U.COPY_SRC | U.COPY_DST);
      t.cloudB = mk("clouds: distance, bound, depth", U.STORAGE_BINDING | U.TEXTURE_BINDING | U.COPY_DST);
      t.cloudHistA = mk("clouds' history", U.TEXTURE_BINDING | U.COPY_DST);
      t.cloudHistValid = false;
      t.cloudTemporalBind = undefined;
      t.cloudWrite = d.createBindGroup({
        layout: this.cloudWriteLayout,
        entries: [
          { binding: 11, resource: t.cloudCurA.createView() },
          { binding: 12, resource: t.cloudCurB.createView() },
        ],
      });
    }
    t.traceBind = d.createBindGroup({ layout: this.traceLayout, entries: this.traceEntries(t, this.ship.envBuf) });
    t.probeBind = d.createBindGroup({ layout: this.traceLayout, entries: this.traceEntries(t, this.probeBuf) });
    t.polGridPass = d.createBindGroup({
      layout: this.postPolGrid.getBindGroupLayout(0),
      entries: [
        { binding: 4, resource: { buffer: t.accum } },
        { binding: 7, resource: { buffer: t.polAcc } },
        { binding: 8, resource: { buffer: t.polGrid } },
        { binding: 9, resource: { buffer: t.polGridBuf } },
      ],
    });
    this.bindDisplay(t);

    // resolve → downsample hdr[0] → … → hdr[n-1] → upsample into bloom[k-1] = hdr[k] + tent(bloom[k])
    this.bindPost(t);
  }

  private bindDisplay(t: Target) {
    const d = this.device;
    t.displayBinds.clear();
    t.taau?.displayBinds.clear();
    for (const p of [this.displayPipeline, this.export8Pipeline, this.export16Pipeline]) {
      if (!p) continue;
      t.displayBinds.set(
        p,
        d.createBindGroup({
          layout: p.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: t.hdr.createView() },
            { binding: 1, resource: { buffer: this.displayBuf } },
            { binding: 2, resource: t.bloomTex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
            { binding: 3, resource: this.clampSampler },
            { binding: 4, resource: { buffer: t.polGrid } },
            // (the Ranger, composited here over the traced image: shipOn in the display's params)
            { binding: 5, resource: this.ship.target(t.hdr).resolved.createView() },
            { binding: 6, resource: this.ship.target(t.hdr).plume.createView() },
            { binding: 7, resource: (t.dof?.tex ?? this.dofDummy).createView() },
            { binding: 8, resource: t.bloomTex.createView() },
            { binding: 9, resource: { buffer: t.flare.out } },
            { binding: 10, resource: this.lensDirt.createView() },
          ],
        }),
      );
    }
  }

  /** The depth of field's image and pass for a target (on first use), the display rebound to it. */
  private ensureDof(t: Target) {
    if (t.dof) return t.dof;
    const d = this.device;
    // (half resolution: the blur has no fine detail; the display mixes it over the sharp image)
    const tex = d.createTexture({
      size: [Math.ceil(t.width / 2), Math.ceil(t.height / 2)],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const buf = d.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = d.createBindGroup({
      layout: this.postDof.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: t.hdr.createView() },
        { binding: 1, resource: this.clampSampler },
        { binding: 2, resource: tex.createView() },
        { binding: 11, resource: { buffer: t.moments } },
        { binding: 17, resource: { buffer: buf } },
        { binding: 20, resource: this.endurance.depthTexture().createView() },
      ],
    });
    t.dof = { tex, buf, bind, endTex: this.endurance.depthTexture() };
    this.bindDisplay(t);
    return t.dof;
  }

  private bindPost(t: Target) {
    const d = this.device;
    t.flare.bind = d.createBindGroup({
      layout: this.postFlare.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: t.hdr.createView() },
        { binding: 18, resource: { buffer: t.flare.u } },
        { binding: 19, resource: { buffer: t.flare.out } },
      ],
    });
    const hdrMip = (l: number) => t.hdr.createView({ baseMipLevel: l, mipLevelCount: 1 });
    const bloomMip = (l: number) => t.bloomTex.createView({ baseMipLevel: l - 1, mipLevelCount: 1 });
    const mipSize = (l: number) => [Math.max(1, t.width >> l), Math.max(1, t.height >> l)] as const;
    const n = t.bloomLevels;
    const live = t.gather.size > 16;
    t.postPasses = [];
    if (live) {
      t.postPasses.push({
        label: "gather",
        pipeline: this.postGatherH,
        w: t.width,
        h: t.height,
        bind: d.createBindGroup({
          layout: this.postGatherH.getBindGroupLayout(0),
          entries: [
            { binding: 4, resource: { buffer: t.accum } },
            { binding: 5, resource: { buffer: t.resolveBuf } },
            { binding: 6, resource: { buffer: t.stamps } },
            { binding: 11, resource: { buffer: t.moments } },
            { binding: 13, resource: { buffer: t.gather } },
          ],
        }),
      });
    }
    t.postPasses.push({
      label: "resolve",
      pipeline: this.postResolve,
      w: t.width,
      h: t.height,
      bind: d.createBindGroup({
        layout: this.postResolve.getBindGroupLayout(0),
        entries: [
          { binding: 2, resource: hdrMip(0) },
          { binding: 4, resource: { buffer: t.accum } },
          { binding: 5, resource: { buffer: t.resolveBuf } },
          { binding: 6, resource: { buffer: t.stamps } },
          { binding: 7, resource: { buffer: t.polAcc } },
          { binding: 11, resource: { buffer: t.moments } },
          { binding: 13, resource: { buffer: t.gather } },
        ],
      }),
    });
    for (let l = 1; l < n; l++) {
      const [w, h] = mipSize(l);
      // (the first level takes the Ranger and its jets over the traced image: the glare is the whole
      // picture's — without them, the blurred scene behind would show through the hull)
      const pipeline = l === 1 ? this.postDownShip : this.postDown;
      t.postPasses.push({
        label: `bloom down ${l}`,
        pipeline,
        w,
        h,
        bind: d.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: hdrMip(l - 1) },
            { binding: 1, resource: this.clampSampler },
            { binding: 2, resource: hdrMip(l) },
            ...(l === 1
              ? [
                  { binding: 14, resource: this.ship.target(t.hdr).resolved.createView() },
                  { binding: 15, resource: this.ship.target(t.hdr).plume.createView() },
                  { binding: 16, resource: { buffer: t.shipRect } },
                ]
              : []),
          ],
        }),
      });
    }
    for (let l = n - 2; l >= 1; l--) {
      const [w, h] = mipSize(l);
      t.postPasses.push({
        label: `bloom up ${l}`,
        pipeline: this.postUp,
        w,
        h,
        bind: d.createBindGroup({
          layout: this.postUp.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: l === n - 2 ? hdrMip(n - 1) : bloomMip(l + 1) },
            { binding: 1, resource: this.clampSampler },
            { binding: 2, resource: bloomMip(l) },
            { binding: 3, resource: hdrMip(l) },
          ],
        }),
      });
    }
  }

  resize(width: number, height: number) {
    if (width < 1 || height < 1) return;
    width = Math.max(8, Math.floor(width));
    height = Math.max(8, Math.floor(height));
    if (this.live && width === this.live.width && height === this.live.height && this.livePol === this.wantPol) return;
    const old = this.live;
    // (its last image kept for the new target's history — encodeTemporal)
    if (old?.temporal?.valid) this.keepHistory(old);
    // (its polarization buffer — 8 bytes a pixel — only while polarization is drawn)
    this.livePol = this.wantPol;
    this.live = this.createTarget(width, height, this.livePol, true);
    if (old) this.device.queue.onSubmittedWorkDone().then(() => this.destroyTarget(old));
    this.blockMs.clear(); // (their times were measured at the old size)
    this.bandRowMs = 0;
    this.invalidate();
  }

  async setBackgroundImage(file: Blob) {
    const bmp = await createImageBitmap(file, { colorSpaceConversion: "none" });
    // linear half floats + mips (footprint-filtered lookups)
    const tex = this.skyBuilder.build(bmp, "srgb", this.device.limits.maxTextureDimension2D);
    const old = this.bgTexture;
    this.bgTexture = tex;
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    this.device.queue.onSubmittedWorkDone().then(() => old.destroy());
    this.invalidate();
  }

  // ------------------------------------------------------------------------------------ uniforms
  private logYs = new Map<number, number>();
  /** log10 Y of a blackbody at T (cached: it integrates the spectrum) */
  private logYOf(T: number) {
    let v = this.logYs.get(T);
    if (v === undefined) this.logYs.set(T, (v = blackbodyLogY(T)));
    return v;
  }

  private diskConstants(s: Settings) {
    const c = this.cache;
    if (c.spin !== s.spin) {
      c.spin = s.spin;
      c.rIn = isco(s.spin);
      c.fmax = ntFluxMax(s.spin, c.rIn).fmax;
    }
    if (c.temp !== s.diskTemp) {
      c.temp = s.diskTemp;
      c.logY = blackbodyLogY(s.diskTemp);
    }
    if (c.alpha !== s.hotFlowAlpha) {
      c.alpha = s.hotFlowAlpha;
      c.volColor = powerLawRGB(s.hotFlowAlpha);
    }
    return c;
  }

  private writeParams(
    t: Target,
    s: Settings,
    time: number,
    o: {
      block: number;
      eps: number;
      steps: number;
      y0: number;
      y1: number;
      accumulate: boolean;
      sampleIndex: number;
      flags: number;
      offset?: [number, number];
      tol?: number;
      noise?: number;
      minSpp?: number;
      shutter?: number;
      /** the catalogue stars splatted (R8): radiance → fixed point (0: drawn by the rays) */
      stars?: number;
      /** a planet's light probe: a camera at its centre, the planet itself left out */
      probe?: { cam: CameraFrame; hide: string; slice?: number };
    },
  ) {
    const f = this.paramsF;
    const u = this.paramsU;
    this.featureKey = this.featuresOf(s) | ((this.costViewMode & 15) << 16) | (this.tuneKey << 20);
    const cam = o.probe?.cam ?? cameraFrame(s);
    if (!o.probe) (this.lastCam = cam), (this.lastTime = time);
    // (none flown: a craft of the fleet near the camera brings the craft's pass and its light probe)
    if (!o.probe) this.craftsShown = !s.ship && (this.shipInView || this.shipOthers(s).some((q) => Math.hypot(...q.t) < 2e4));
    const dc = this.diskConstants(s);
    const a = s.spin;
    const tanH = Math.tan((s.fov * Math.PI) / 360);
    const pixelAngle = (2 * tanH) / t.height;
    const set = (i: number, x: number, y: number, z: number, w: number) => f.set([x, y, z, w], i * 4);

    set(0, t.width, t.height, o.block, o.sampleIndex);
    set(1, cam.r, gpuTheta(cam.theta), cam.phi, tanH);
    set(2, ...cam.right, t.width / t.height);
    set(3, ...cam.up, pixelAngle);
    set(4, ...cam.fwd, o.stars ?? 0);
    set(5, cam.zamo.alpha, cam.zamo.omega, cam.zamo.varpi, cam.zamo.sqrtSig);
    // (y: the aerial table's scale — trace.wgsl apScale)
    set(6, cam.zamo.sqrtSigOverDel, this.aerialPreExposed ? preExposure(this.ev(s)) : 0, 0, 0);
    set(7, ...cam.beta, cam.gamma);
    set(8, a, horizon(a), dc.rIn, Math.max(s.diskOuter, dc.rIn + 0.5));
    set(9, s.diskTemp, dc.fmax, s.turbulence, dc.logY);
    if (!o.probe) this.lastLogY = dc.logY;
    set(10, o.eps, o.steps, this.escapeRadius(s), captureTolerance(a));
    // The GPU's "now" in float32: the absolute time only drives the disk's flow, the hot spot and the
    // jet (periodic patterns); bodies and the mouth get their places at `time` from the CPU (float64)
    // and are turned by Ω·Δt along the rays. After many flow periods it wraps (a rare jump of the
    // disk's pattern), so that it keeps its precision over years of simulated time.
    const wrap = Math.max(s.flowPeriod, 1) * 1024;
    const tGpu = time > wrap ? time % wrap : time;
    // (auto exposure: the sky — an artistic backdrop — keeps its brightness on screen)
    const bg = s.bgIntensity * this.skyScale(s);
    set(11, tGpu, s.flowPeriod, bg, pixelAngle * 0.35 * s.starSize);
    set(12, s.hotFlow ? 1 : 0, s.hotFlowHR, s.hotFlowAlpha, s.hotFlowIntensity);
    set(13, o.y0, o.y1, o.accumulate ? 1 : 0, Math.random());
    set(14, s.limbDarkening ? 1 : 0, s.diskEmission === "bolometric" ? 1 : 0, s.diskBrightness, s.diskTau);
    set(15, s.jet ? 1 : 0, Math.sqrt(1 - 1 / (s.jetLorentz * s.jetLorentz)), s.jetWidth, s.jetIntensity);
    set(16, s.jetLength, s.jetCutoff, s.jetKnots, this.liteSkip);
    u.set([this.frameStamp, t === this.live ? this.validFrom : 0, o.flags, o.minSpp ?? 0], 17 * 4);
    set(18, o.tol ?? 1e-5, o.noise ?? 0, o.shutter ?? 0, s.temporalBlend);
    set(19, o.offset?.[0] ?? 0, o.offset?.[1] ?? 0, s.diskThickness, 1); // w: opaque 1.0 (compensated sums)
    set(20, dc.volColor[0]!, dc.volColor[1]!, dc.volColor[2]!, 0);
    u.set([RENDER_MODES[s.renderMode], SHIFT_MODES[s.shiftMode], BG_MODES[s.background], s.disk ? 1 : 0], 21 * 4);
    const sky = skyMatrix(s);
    set(22, ...sky[0], s.starBrightness * STAR_FLUX_SCALE);
    set(23, ...sky[1], this.skyReady ? 1 : 0);
    set(24, ...sky[2], 0);
    // (polarization is not carried through the wormhole's gluing)
    set(25, s.polarization && !s.wormhole ? 1 : 0, s.polFraction, POL_FIELDS[s.polField], (s.polJetPitch * Math.PI) / 180);
    // returning radiation: offline renders only by default (≈ 6× the cost of the converged view)
    const ret = s.returningRadiation === "always" || (s.returningRadiation === "offline" && t !== this.live);
    set(26, ret ? 1 : 0, s.diskAlbedo, 3000, s.diskThickness > 0 ? s.diskHaze : 0);
    set(27, BANDS[s.band], s.radioTau, s.radioNuS, s.radioTe / 0.593);
    set(28, s.radioJet, s.hotFlowHR, s.diskThickness > 0 ? s.diskSmoke : 0, 0);
    set(29, s.hotSpot ? 1 : 0, Math.max(s.spotRadius, horizon(a) + 1.5 * s.spotSize), s.spotSize, s.spotTau);
    set(30, s.spotTemp, s.spotBrightness, (s.spotPhase * Math.PI) / 180, s.spotHeight);
    setSceneTime(time);
    const m = mouth(s, time);
    set(31, s.wormhole ? 1 : 0, m.w.rho, m.w.a, m.w.M);
    set(32, s.wormhole && cam.region === "throat" ? 1 : 0, cam.ell, m.rGlue, m.lGlue);
    set(33, ...cam.n, m.lFar);
    set(34, ...m.C, m.omega);
    set(35, ...m.ex, 0);
    set(36, ...m.ey, 0);
    set(37, ...m.ez, 0);
    // bodies (the companion star, a system's planets): places now, in float64 on the CPU — ours where
    // the light shows them from the camera (our mouth, seen from Gargantua's side)
    const bodies = sceneBodies(s, time, s.wormhole ? (homePosition(s) ?? [0, 0, 0]) : null);
    if (o.probe) {
      const k = bodies.findIndex((b) => b.id === o.probe!.hide);
      if (k >= 0) bodies[k]!.where = 3;
    }
    // planets lit as their light probes measured (the light they receive, in the far view's terms:
    // E/(π B) of the disk's reference radiance)
    for (const b of bodies) {
      const p = this.planetProbes.get(b.id);
      if (!p || b.kind !== BODY_PLANET || b.light >= 0 || !(p.tColour > 0)) continue;
      // (the light's colour temperature, rounded: log Y integrates a spectrum — cached per value)
      const T = Math.round(p.tColour / 50) * 50;
      const yRef = 10 ** (this.logYOf(T) - dc.logY) * s.diskBrightness;
      if (yRef > 0) {
        b.illum = p.eMax / (Math.PI * yRef);
        b.lightDir = p.worldDir;
        b.lightT = T;
      }
    }
    // a body near the camera: the local patch (floating origin), not a traced sphere
    const dRdL = s.wormhole && cam.region === "throat" ? radius(m.w, cam.ell)[1] : 1;
    const near =
      this.localPatchOn && !o.probe
        ? localPatch(
            cam,
            bodies.slice(0, MAX_BODIES),
            (k) =>
              bodies[k]!.where === 2 || bodies[k]!.where === 4
                ? solarState(bodies[k]!.id, time).vel
                : bodyVelocity(s, bodies[k]!.id as unknown as Body, time),
            dRdL,
            { time, spin: s.spin, massSolar: s.massSolar },
          )
        : null;
    if (near) bodies[near.index]!.where = 3;
    if (near && s.ship && this.shipPose) {
      // (the body seen from the camera's eye, not the ship's centre: its attach point, the outside
      // views' metres to kilometres — the ground where it is under the ship)
      const t = shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t;
      const k = 1 / (near.radius * 1476.625 * s.massSolar);
      near.centre = [0, 1, 2].map((i) => near.centre[i]! + (t[0] * cam.right[i]! + t[1] * cam.up[i]! + t[2] * cam.fwd[i]!) * k) as Vec3;
    }
    const earthSurface = near && bodies[near.index]?.id === "earth" ? patchGeodetic(near, WGS84_F) : null;
    // (the relief's ceiling round the camera — relief-ceiling.ts: the shell the ground's marches work in, radio2.w [m]
    // over the ellipsoid; 9 600 m at most, as before; 0: that)
    f[28 * 4 + 3] = 0;
    // (under 300 km: higher, the march hardly runs and the horizons take in half the globe — 9 600 m)
    if (earthSurface && this.mapCells && this.reliefCeiling && earthSurface.h * WGS84_A < 300_000) {
      const alt = earthSurface.h * WGS84_A;
      let top = Math.max(this.earthTiles.top(), 0);
      top = Math.max(top, this.mapCells.around(earthSurface.lat, earthSurface.lon, horizonsReach(alt, 9600)));
      // (both above the sea: the ground over the ellipsoid higher by the geoid — 86 m at most, anywhere)
      f[28 * 4 + 3] = Math.min(9600, top + detailMargin(top) + GEOID_MAX);
    }
    if (!o.probe) this.lastNear = near;
    set(48, ...(near?.centre ?? [0, 0, 0]), near ? 1 : 0);
    set(49, ...(near?.axes[0] ?? [1, 0, 0]), near?.index ?? 0);
    set(50, ...(near?.axes[1] ?? [0, 1, 0]), near?.radius ?? 0);
    // lit by the Ranger's probe when it runs (piloting: 1), else by the planet's own (2), else by its
    // source alone (0)
    const ownProbe = near ? this.planetProbes.get(bodies[near.index]!.id) : undefined;
    // (a star's planet: by its star alone — the Ranger's probe would bring the far scene's scale)
    const starLit = near ? bodies[near.index]!.light >= 0 : false;
    const lit = !near || starLit ? 0 : s.ship && this.ship.ready ? 1 : ownProbe ? 2 : 0;
    if (lit === 2) {
      const sh = new Float32Array(SH_BYTES / 4);
      ownProbe!.sh.forEach((c, k) => sh.set([...c, 0], 4 * k));
      // (then its dominant light, along the ZAMO axes like the harmonics)
      sh.set([...ownProbe!.dir, 1], 36);
      this.device.queue.writeBuffer(this.bodyBuf, this.bodyData.byteLength, sh);
    }
    set(51, ...(near?.axes[2] ?? [0, 0, 1]), lit);
    // metres per radius; the air (scale height, density, top), the clock of Miller's waves
    const nb = near ? GARGANTUA_SYSTEM.bodies.find((q) => q.id === bodies[near.index]!.id) : undefined;
    const mR = near ? near.radius * 1476.625 * s.massSolar : 1;
    set(52, ...(near?.light ?? [0, 0, 1]), mR);
    const atm = nb?.surface?.atmosphere;
    set(53, atm?.H ?? 8000, atm ? atm.rho0 / 1.225 : 0, atm ? 1 + (12 * atm.H) / mR : 1, 4.925490947e-6 * s.massSolar);
    // our universe: places relative to the camera there (else to the mouth); mapped bodies' albedo
    // over their map's mean
    const origin = s.wormhole && cam.region === "throat" && cam.ell < 0 ? homeOf(m.w, cam.ell, cam.n) : ([0, 0, 0] as Vec3);
    set(54, ...origin, 100 * m.w.rho);
    // (the hole's and the mouth's metrics in the kernel — O13 —, unless the camera is in our universe
    // beyond the mouth's Dneg region and the region is under a pixel: the Earth-only tracer)
    const dMouth = Math.hypot(...origin);
    const earthOnly = !o.probe && dMouth > 100 * m.w.rho && (100 * m.w.rho) / dMouth < pixelAngle;
    if (!earthOnly) this.featureKey |= 512;
    for (const b of bodies) {
      const map = b.surface >= SURFACE_MAPPED ? GARGANTUA_SYSTEM.bodies.find((q) => q.id === b.id)?.map : undefined;
      if (map) {
        if (!this.mapsRequested) this.requestPlanetMaps();
        b.brightness /= this.planetMaps.mean.get(map) ?? 0.25;
      }
    }
    packBodies(bodies, this.bodyData, origin);
    if (!o.probe) this.lastBodies = bodies;
    if (bodies.length) this.featureKey |= 128;
    // (the body near the camera, for the camera's rays: the other near paths out of the kernel — P7; the probes' frames
    // keep "any")
    if (!o.probe && this.nearKinds) {
      const nb = near ? bodies[near.index] : undefined;
      const kind = !nb ? 4 : !bodyHasAir(nb.kind, nb.surface) ? 3 : nb.id === "earth" ? 1 : 2;
      this.featureKey |= kind << NEAR_KIND_SHIFT;
    }
    // (the Ranger's shadow on the near ground: its bounding sphere in the camera's axes; 0: none)
    // (the ship seen from outside — a spectator, the astronaut on foot — casts its shadow too)
    const sb = !o.probe && (s.ship || this.shipInView) && this.ship.ready && near ? this.ship.shadowBound : null;
    set(65, sb?.c[0] ?? 0, sb?.c[1] ?? 0, sb?.c[2] ?? 0, sb?.r ?? 0);
    // (the far field's LUT: the live view, a scene with nothing a ray between clean samples could meet —
    // and a block of 2 at most: coarser, the tracer's few rays cost less than the LUT's pass, audit O1)
    this.lutWanted = t === this.live && !o.probe && (this.featureKey & LUT_BLOCKERS) === 0 && s.farFieldLut && o.block <= 2;
    const lutReady = (o.flags & FLAG_ADAPTIVE_RK) !== 0 ? this.lutQPipeline !== null : this.lutPipeline !== null;
    this.lutOn = this.lutWanted && lutReady; // (its pass skipped while the background compile runs — no FLAG_LUT on a LUT never written)
    if (this.lutOn) u[17 * 4 + 2] = (u[17 * 4 + 2] ?? 0) | FLAG_LUT;
    this.device.queue.writeBuffer(this.bodyBuf, 0, this.bodyData);
    const massive = bodies.findIndex((b) => b.id === "star" && b.mass > 0);
    const tl = s.wormhole ? throatLight(s) : null;
    set(38, Math.min(bodies.length, MAX_BODIES), massive, tl?.factor ?? 0, tl?.temperature ?? 0);
    // point sources at the catalogue stars' scale: a flux F (radiance units × sr) has the magnitude
    // m = −26.74 − 2.5 log(F / F☉,1AU); the catalogue draws 10^(−0.4 m) × fluxScale, × ½ × bgIntensity
    const lumSun = 10 ** (blackbodyLogY(5772) - dc.logY);
    const fSun1AU = lumSun * Math.PI * (6.957e8 / AU_M) ** 2;
    const pointScale = (0.5 * bg * s.starBrightness * STAR_FLUX_SCALE * 10 ** (0.4 * 26.74)) / fSun1AU;
    // highlight compression above magnitude −2: that flux spread over a glow of radius 0.75 pixel
    const f2 = 0.5 * bg * s.starBrightness * STAR_FLUX_SCALE * 10 ** (0.4 * 2);
    // (w: where our universe's bodies start in the list)
    set(39, pointScale, f2 / (Math.PI * (0.75 * pixelAngle) ** 2), f2, ourStart(bodies));
    // the light meter: the brightest the sky can be here (the scene is what shines beyond it), and the
    // light falling where the camera is
    if (!o.probe) {
      this.meterSky = (3 * f2) / (Math.PI * (0.75 * pixelAngle) ** 2);
      this.meterHome = s.wormhole ? homePosition(s) : null;
      this.meterTime = time;
      this.meterIncident =
        this.incidentLight(s, cam, bodies, origin, dc.logY, near, earthSurface) *
        this.eclipsedMoonMeter(s, cam, bodies, t.width / Math.max(t.height, 1));
      this.meterGain = s.tonemap === "Film" ? 4 : 1;
      this.earthIsNear = !!near && bodies[near.index]?.id === "earth";
      this.meterInAir = this.earthIsNear;
      // (a landscape by day — the camera low in the Earth's air, the Sun over 4–15° there, not eclipsed —:
      // its shade kept from "AgX punchy"'s deepening, a dark grey as the eye sees it, not black; dusk, night,
      // totality and the views from orbit keep their depth)
      this.shadowKeep = 0;
      if (this.meterInAir && near) {
        const surface = earthSurface!;
        const mu = surface.up.reduce((v, n, i) => v + n * near.light[i]!, 0);
        const ecl = this.meterHome ? sunShare(this.meterHome, this.meterTime) : 1;
        const smooth = (a: number, b: number, x: number) => {
          const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
          return t * t * (3 - 2 * t);
        };
        this.shadowKeep = smooth(0.07, 0.26, mu) * smooth(0.3, 0.9, ecl) * (1 - smooth(20, 60, (surface.h * EARTH_RM) / 1e3));
      }
    }
    // camera path tube: radius = 1.8 pixel angles × distance along the ray (constant apparent width)
    set(40, s.showGeodesic ? this.pathCount : 0, 1.8 * pixelAngle, this.pathFate, 0);
    // Gargantua and the star orbit their centre of mass (relative orbit with the total mass)
    set(41, s.sun && s.sunMass > 0 ? s.sunMass / (1 + s.sunMass) : 0, starOmega(s), 0, 0);
    // cinematic liquid surface across the throat; a splash where the camera goes through it
    const w = this.water;
    const side = s.wormhole && cam.region === "throat" ? Math.sign(cam.ell) : 0;
    if (side && w.side && side !== w.side) {
      w.splash = [...cam.n];
      w.splashAt = w.clock;
    }
    if (side) w.side = side;
    set(42, s.wormhole && s.cinematic ? 1 : 0, s.waterRipples, s.waterMirror, w.clock);
    set(43, ...w.splash, w.splashAt);
    // a pixel's footprint on the throat's sphere (radians): the ripples fade once unresolved
    let dThroat = Math.abs(cam.ell);
    if (cam.region !== "throat") {
      const st = Math.sin(cam.theta);
      const X = [cam.r * st * Math.cos(cam.phi), cam.r * st * Math.sin(cam.phi), cam.r * Math.cos(cam.theta)];
      dThroat = Math.hypot(X[0]! - m.C[0]!, X[1]! - m.C[1]!, X[2]! - m.C[2]!) - m.w.rho;
    }
    set(44, s.waterGlow, (pixelAngle * Math.max(dThroat, 0.02 * m.w.rho)) / m.w.rho, 0, 0);
    // the liquid's colour → absorption per unit path (the default "#3aa6c8" gives σ ≈ (0.55, 0.17, 0.09))
    const liquid = hexToLinear(s.waterColor);
    set(45, ...(liquid.map((c) => 0.17 * s.waterDensity * -Math.log(Math.max(c, 0.02))) as [number, number, number]), 0);
    set(46, ...hexToLinear(s.waterGlowColor), 0);
    // (our universe's bodies a ray from the camera may meet — trace.wgsl ourSegment's own test, reach against half
    // a pixel at its distance: the planets and moons under it skipped there anyway —, those with rings (their loop
    // keeps no such test) and the stars: their indices, 6 bits each, 4 a value — whole numbers under 2²⁴, exact in a
    // float — in water3.zw, water4.w, water5.w; their count in path.w — 0: every body)
    {
      const start = ourStart(bodies);
      const list: number[] = [];
      let all = !this.bodyList;
      for (let k = start; k < Math.min(bodies.length, MAX_BODIES) && !all; k++) {
        const b = bodies[k]!;
        const P = [b.pos[0] - origin[0], b.pos[1] - origin[1], b.pos[2] - origin[2]];
        const D = Math.hypot(P[0]!, P[1]!, P[2]!);
        // (the reach: its rings', its air's — at most twice its radius —; a star always: its disc, its corona)
        const reach = b.radius * Math.max(b.rings?.outer ?? 0, b.surface >= 4 ? 2 : 1);
        if (b.kind === 0 || (b.rings?.outer ?? 0) > 0 || reach >= 0.45 * pixelAngle * D) {
          if (list.length === 16) all = true;
          else list.push(k);
        }
      }
      const words = [0, 0, 0, 0];
      if (!all) list.forEach((k, i) => (words[i >> 2]! += k * 64 ** (i & 3)));
      f[44 * 4 + 2] = words[0]!;
      f[44 * 4 + 3] = words[1]!;
      f[45 * 4 + 3] = words[2]!;
      f[46 * 4 + 3] = words[3]!;
      f[40 * 4 + 3] = all ? 0 : list.length + 0.5;
      // (the same for the rays from the mouth's region — its pieces integrated there, the ray out of it (Saturn's sky:
      // 40 % of its trace was this loop over every body, at each piece) —: the bodies big enough seen from the region's
      // edge, its radius 100 ρ round the mouth (b.pos: from the mouth), those within it, those with rings, the stars —
      // a ray from there has travelled at least to the edge: ourSegment's test passes no other)
      const mouth: number[] = [];
      let mouthAll = !this.bodyList;
      for (let k = start; k < Math.min(bodies.length, MAX_BODIES) && !mouthAll; k++) {
        const b = bodies[k]!;
        const D = Math.max(Math.hypot(b.pos[0], b.pos[1], b.pos[2]) - 100 * m.w.rho, 0);
        const reach = b.radius * Math.max(b.rings?.outer ?? 0, b.surface >= 4 ? 2 : 1);
        if (b.kind === 0 || (b.rings?.outer ?? 0) > 0 || b.where === 4 || reach >= 0.45 * pixelAngle * D) {
          if (mouth.length === 16) mouthAll = true;
          else mouth.push(k);
        }
      }
      const mw = [0, 0, 0, 0];
      if (!mouthAll) mouth.forEach((k, i) => (mw[i >> 2]! += k * 64 ** (i & 3)));
      f.set(mw, MOUTH_LIST_AT);
      f.fill(0, MOUTH_LIST_AT + 4, MOUTH_LIST_AT + 8);
      f[MOUTH_LIST_AT + 4] = mouthAll ? 0 : mouth.length + 0.5;
      if (!o.probe)
        this.bodyListSizes = {
          ours: Math.min(bodies.length, MAX_BODIES) - start,
          camera: all ? -1 : list.length,
          mouth: mouthAll ? -1 : mouth.length,
        };
    }
    // light probe for the spaceship: a new frame's weight (1 after a scene reset: no stale light);
    // its axes: the planet's probe camera's, else fixed (the ZAMO's, or the throat's), so that it
    // keeps a long running mean while the camera turns — shortened as what it sees moves (a texel
    // refreshed every 4 frames lags N of them: N·4·drift within a texel; 4 at least — a light
    // lagging a few degrees does not show, a flickering one does)
    if (o.probe) {
      // (a sixteenth of it: one texel of each 4×4 block, written over)
      if (o.probe.slice !== undefined) set(47, 1, o.probe.slice, 2, 1);
      else set(47, 1, 0, 1, 1);
      set(55, ...cam.right, 0);
      set(56, ...cam.up, 0);
      set(57, ...cam.fwd, 0);
    } else {
      const drift = this.probeDrift(s, cam, bodies, origin, m, time, bg);
      if (!(drift < 0.1)) this.envReset = true;
      if (this.envReset) this.eventFrames = Math.max(this.eventFrames, 2);
      // (the sky's brightness changed a lot — the auto exposure —: every texel written over, a quarter a
      // frame, the old light kept meanwhile — not all 32 768 long rays in one frame)
      const spread = !this.envReset && this.envSpread > 0;
      // (what it sees moving slowly: one texel of each 4×4 block, every 4th frame — the probe's rays
      // are long and few, its pass lasts as long as the slowest: fewer rays save less than fewer runs)
      const texel = Math.PI / ENV_H;
      const slow = drift < texel / 256;
      this.envStride = this.envReset ? 1 : spread || !slow ? 2 : 4;
      // (the raster drawing the near Earth: every other frame at least — its rays are the sky's and the ground's around, a
      // light that turns slowly; 1.8 ms a frame on an M1 — TERRE-UNREAL U6)
      const every = this.rasterPrimaryOn ? Math.max(this.probeEveryMoving, 2) : this.probeEveryMoving;
      this.envEvery = this.envReset || spread ? 1 : !slow ? every : 4;
      const window = Math.round(Math.min(512, Math.max(4, texel / ((slow ? 64 : 4) * drift))));
      set(
        47,
        this.envReset || spread ? 1 : 0,
        this.envPhase % (slow && !spread ? 16 : 4),
        this.envReset ? 1 : slow && !spread ? 2 : 0,
        window,
      );
      set(55, 1, 0, 0, 0);
      set(56, 0, 1, 0, 0);
      set(57, 0, 0, 1, 0);
      this.shipProbeAxes = [cam.right, cam.up, cam.fwd];
    }
    // the Earth: its maps by what the camera sees of it — none while its disk is under ~24 pixels (the
    // solar system's map draws it), "med" above, "high" once a med texel outgrows a pixel under the
    // camera (d − 1 < (π/2 / 2048) / pixel: below ~2 radii at a 60° view), loaded directly; back to med
    // beyond 3.5 radii, freed under 12 pixels for 5 s (hysteresis: no reload back and forth); its
    // clouds drift eastwards, a turn in 20 days
    const earthK = bodies.findIndex((b) => b.id === "earth" && b.surface >= SURFACE_MAPPED);
    if (!o.probe) this.nearEarthNow = earthK >= 0 && !!near && near.index === earthK;
    if (!o.probe) {
      let dE = Infinity; // [its radii]
      if (earthK >= 0 && near && near.index === earthK) dE = Math.hypot(...near.centre);
      else if (earthK >= 0 && bodies[earthK]!.where !== 0 && bodies[earthK]!.where !== 1) {
        const b = bodies[earthK]!;
        dE = Math.hypot(b.pos[0] - origin[0], b.pos[1] - origin[1], b.pos[2] - origin[2]) / b.radius;
      }
      const diskPx = dE > 1 ? (2 * Math.asin(1 / dE)) / pixelAngle : Infinity;
      const highAt = 1 + Math.PI / 2 / 2048 / pixelAngle;
      const have = this.earthWant;
      let want: EarthTier | null = have;
      if (diskPx < 12) want = have && performance.now() - this.earthSeenAt > 5000 ? null : have;
      else {
        this.earthSeenAt = performance.now();
        if (dE < highAt) want = "high";
        else if (diskPx > 24 && (!have || dE > Math.max(3.5, 1.5 * highAt))) want = "med";
      }
      // (the ship by the Earth, the view away: its maps kept, the finer ones low over it)
      const F = this.shipFocus;
      if (F?.body === "earth") want = F.altKm < 2000 ? "high" : (want ?? "med");
      // (the tier's texture cap — plan §3.5: the live view only, exports keep their choice — and the
      // memory's: quality-policy.ts)
      want = earthMapQuality(want, automaticQuality(s), t !== this.live, this.tier, this.earthCap);
      if (want !== have) {
        if (want) this.requestEarthMaps(want);
        else this.releaseEarthMaps();
      }
    }
    const tSec = time * 4.925490947e-6 * s.massSolar;
    const drift = ((tSec / (20 * 86400)) % 1) * 2 * Math.PI;
    // (the cities' lights: drawn bright from orbit — they show on the night side; near the ground, a
    // twentieth: seen from below, lit areas would glare like a sunlit field)
    const altKm = earthSurface ? (earthSurface.h * EARTH_RM) / 1e3 : 1e4;
    if (!o.probe && t === this.live) this.liveAltKm = altKm;
    const lights = 0.6 * 20 ** Math.min(Math.max(Math.log10(Math.max(altKm, 1) / 300) / Math.log10(300 / 5), -1), 0);
    // (the real weather: the clouds of the day, held still — each region as the satellite saw it)
    const dayOn = this.dayCloudsWanted(s, time);
    set(58, this.earthMaps.tier ? (dayOn ? 2 : 1) : 0, dayOn ? 0 : drift, lights, 4);
    // (the night sky's light on the ground: as drawn from the ground; from orbit a quarter — the night
    // side dark round its cities)
    set(
      61,
      4 ** -Math.min(Math.max(Math.log10(Math.max(altKm, 1) / 5) / Math.log10(300 / 5), 0), 1),
      0,
      0,
      s.volumetricClouds && altKm < 30 ? 1 : 0,
    ); // (w: the clouds a volume — the camera low: 30 km)
    // a world's finer maps, the camera near it (within 40 of its radii): its map's index, its brightness
    // kept (the coarse map's mean over the finer's), its relief's strength (0: none), the map's width
    const nearMap = near ? (solarBody(bodies[near.index]!.id)?.map as MapName | undefined) : undefined;
    // (the finer maps once the coarse map's texel outgrows a pixel under the camera — within ~4 radii
    // at a 60° view; freed beyond twice that)
    if (!o.probe) {
      const dN = near ? Math.hypot(...near.centre) : Infinity;
      const hdAt = 1 + (1.3 * ((2 * Math.PI) / 4096)) / pixelAngle;
      // (the ship within three radii of a world with finer maps, the view away: its maps kept — its
      // measured ground under the gear —, whatever the view nears)
      const F = this.shipFocus;
      const fb = F ? solarBody(F.body) : undefined;
      const pin = fb && HD_SETS[fb.map as MapName] && (F!.altKm * 1e3) / (fb.radius * M_METRES) < 2 ? (fb.map as MapName) : undefined;
      if (pin) this.requestHd(pin);
      else if (nearMap && HD_SETS[nearMap] && dN < hdAt) this.requestHd(nearMap);
      else if (this.hdMap.name && !(nearMap === this.hdMap.name && dN < 2 * hdAt)) this.releaseHd();
    }
    const hd = this.hdMap;
    const hdOn = !!hd.name && bodies.some((b) => solarBody(b.id)?.map === hd.name);
    const hdRelief = !hd.hasRelief ? 0 : hd.dem || HD_SETS[hd.name!]?.height ? 1 : 1.2;
    set(62, hdOn ? mapIndex(hd.name!) : -1, (this.planetMaps.mean.get(hd.name!) ?? hd.mean) / hd.mean, hdRelief, hd.color.width);
    // (its measured heights: on, their highest and lowest [m] — the relief's shell —, the body's radius [m])
    const hdBody = hd.name ? SOLAR_BODIES.find((b) => b.map === hd.name) : undefined;
    set(
      69 + TILE_PARAM_VEC4S + RUNWAY_VEC4S + SEA_VEC4S,
      hdOn && hd.dem ? 1 : 0,
      hd.dem?.hi ?? 0,
      hd.dem?.lo ?? 0,
      hdBody ? hdBody.radius * M_METRES : 1,
    );
    // an airless world's finest ground (trace.wgsl: fineGround): the camera on the body's axes in metres,
    // in float64 — an anchor of whole metres (multiples of 64) near it, and the camera from the anchor
    const fineMap = near ? solarBody(bodies[near.index]!.id)?.map : undefined;
    const fm = fineMap ? mapIndex(fineMap) : -1;
    if (near && (fm === 1 || fm === 3 || (fm >= 7 && fm <= 18)) && Math.hypot(...near.centre) < 1.02) {
      const mR = near.radius * M_METRES;
      const cb = near.axes.map((a) => -(a[0] * near.centre[0] + a[1] * near.centre[1] + a[2] * near.centre[2]) * mR);
      const an = cb.map((c) => Math.round(c / 64) * 64);
      set(63, an[0]!, an[1]!, an[2]!, 1);
      set(64, cb[0]! - an[0]!, cb[1]! - an[1]!, cb[2]! - an[2]!, 0);
    } else {
      set(63, 0, 0, 0, 0);
      set(64, 0, 0, 0, 0);
    }
    set(59, 6000 / EARTH_RM, s.earthClouds, 0.8, AIR_K);
    // the Moon's light on the Earth at night: its direction on the Earth's axes, its phase (the sunlit
    // share of its disk seen from the Earth)
    let moon: [number, number, number, number] = [0, 0, 1, 0];
    let eclipse: [number, number, number, number] = [0, 0, 0, 0];
    let sunAng = 0;
    if (earthK >= 0) {
      const E = solarState("earth", time).pos,
        M = solarState("moon", time).pos,
        S = solarState("sun", time).pos;
      const m = [M[0] - E[0], M[1] - E[1], M[2] - E[2]],
        sn = [S[0] - M[0], S[1] - M[1], S[2] - M[2]];
      const ml = Math.hypot(...m),
        sl = Math.hypot(...sn);
      const A = bodyAxes(solarBody("earth")!, time);
      const q = A.map((a) => (a[0] * m[0]! + a[1] * m[1]! + a[2] * m[2]!) / ml);
      // (Sun–Moon–Earth angle: 0 at full Moon)
      const cosPhase = -(m[0]! * sn[0]! + m[1]! * sn[1]! + m[2]! * sn[2]!) / (ml * sl);
      // (its light dimmed by the Earth's shadow on it — a lunar eclipse: PLAN-CIEL C6)
      const shade = moonLightShare(E, M, S, solarBody("earth")!.radius * DANJON_SCALE, solarBody("moon")!.radius, solarBody("sun")!.radius);
      this.moonLight = shade;
      moon = [q[0]!, q[1]!, q[2]!, ((1 + cosPhase) / 2) * shade];
      // the eclipses: the Moon and the Sun where the light shows them from the camera (the Moon 1.3 s
      // ago — the shadow's place, to a kilometre), on the Earth's axes [its radii]; the Sun's angular radius
      const obs = homePosition(s) ?? E;
      const Ms = seenFrom("moon", time, obs).pos,
        Ss = seenFrom("sun", time, obs).pos;
      const RE = solarBody("earth")!.radius;
      const mv = [Ms[0] - E[0], Ms[1] - E[1], Ms[2] - E[2]];
      const mq = A.map((a) => (a[0] * mv[0]! + a[1] * mv[1]! + a[2] * mv[2]!) / RE);
      const sd = Math.hypot(Ss[0] - E[0], Ss[1] - E[1], Ss[2] - E[2]);
      // (only when the Moon is within 2° of the Sun, seen from the Earth's centre: the shader's test is cheap)
      const cosMS = ((Ss[0] - E[0]) * mv[0]! + (Ss[1] - E[1]) * mv[1]! + (Ss[2] - E[2]) * mv[2]!) / (sd * Math.hypot(...mv));
      eclipse = cosMS > Math.cos(2.5 * (Math.PI / 180)) ? [mq[0]!, mq[1]!, mq[2]!, solarBody("moon")!.radius / RE] : [0, 0, 0, 0];
      sunAng = Math.asin(Math.min(solarBody("sun")!.radius / sd, 1));
    }
    set(60, ...moon);
    set(66, ...eclipse);
    // the camera on the near body's axes [radii], in float64: an anchor in float32 and the rest (trace.wgsl:
    // nearCam — turned there in float32, the ground shook by its rounding)
    let runways: Float32Array = new Float32Array(RUNWAY_VEC4S * 4);
    if (near) {
      const c = near.axes.map((a) => -(a[0] * near.centre[0] + a[1] * near.centre[1] + a[2] * near.centre[2]));
      // (the Earth's on its squashed axes — z × a/b: its ellipsoid the unit sphere, trace.wgsl: EARTH_AB)
      if (near.index === earthK) c[2] = c[2]! / (1 - WGS84_F);
      const A = c.map((x) => Math.fround(x));
      set(67, A[0]!, A[1]!, A[2]!, A[0]! * A[0]! + A[1]! * A[1]! + A[2]! * A[2]! - 1);
      set(68, c[0]! - A[0]!, c[1]! - A[1]!, c[2]! - A[2]!, 1);
      // the runways within 150 km, nearest first: their frames, the camera from each threshold [m] — on the
      // physical body axes, in float64 (the markings to the centimetre: trace.wgsl runwayShade)
      if (near.index === earthK && this.earthMaps.tier) runways = this.nearRunways(c as Vec3, s, time);
      // (runways near: the kernel with their code — elsewhere compiled out, a tenth of the Earth's cost)
      // (the raster's material drawing the ground — its kernels with the runways' code always —: no bit, the key as it was —
      // an airfield coming into reach no longer compiles the tracer anew in flight; its sky and far ground without them)
      // (the choice, not the raster's state this frame: it is off while its kernels compile — the bit back then, the key
      // going back and forth, each side's kernels compiled in turn; the photo mode's still view traced, with them)
      // (on foot the raster stands aside — the tracer draws the walker's ground —: the bit kept)
      const rasterGround = this.earthPipelineNow(s) === "raster" && this.rasterLite && this.rasterHold && !this.character?.active;
      if (runways[0]! > 0 && !rasterGround) this.featureKey |= 256;
    } else {
      set(67, 0, 0, 0, 0);
      set(68, 0, 0, 0, 0);
    }
    f.set(runways, (69 + TILE_PARAM_VEC4S) * 4);
    f.set(this.seaParams(near, bodies, earthK, altKm, time, tSec, s), (69 + TILE_PARAM_VEC4S + RUNWAY_VEC4S) * 4);
    f.set(this.weatherParams(earthSurface, altKm, time, tSec, s, !o.probe), (BASE_PARAM_VEC4S - WX_VEC4S) * 4);
    // the shadows our bodies cast on one another (PLAN-CIEL C6): the pairs where one falls now
    // (a receiver under two pixels across left out: Io in Jupiter's shadow seen from the Earth would keep the
    // shadows' code in the kernel for a dot)
    const shade = shadowParams(bodies, ourStart(bodies), homePosition(s) ?? origin, (s.fov * Math.PI) / 180 / Math.max(t.height, 1));
    f.set(shade, (BASE_PARAM_VEC4S - WX_VEC4S - SHADE_VEC4S) * 4);
    // (a shadow falling: 2048 — none, its code out of the kernel: the kernel is register-bound, a pair's loop
    // cost 6–12 % over the Earth where no shadow ever fell)
    if (shade[8]! > 0) this.featureKey |= 2048;
    // the sky through the Earth's air (PLAN-CIEL C3): its refractivity at sea level, from the real weather's
    // air when it is in (cold air bends more), else the standard atmosphere's
    f.set(
      earthSurface && s.refraction ? refractionParams(this.refractivity(s), earthSurface.h * EARTH_RM, EARTH_RM) : [0, 0, 0, 0],
      (BASE_PARAM_VEC4S - WX_VEC4S - SHADE_VEC4S - 1) * 4,
    );
    // the Earth's terrain tiles, its regional surface and its scenery round the camera — the tracer's own eye
    // (near.centre, the mount's offset in): what is drawn, and the trees' and buildings' rays and shadows, start
    // there, never from the ship's centre (a spectator kilometres off, a flyby shot, the cockpit's 3.6 m)
    if (!o.probe) {
      const eye = near?.index === earthK && this.earthMaps.tier ? bodyEye(near) : null;
      const onEarth = s.earthTerrain && !!eye;
      // (the camera off the Earth's near patch, the ship low over it — never a spectator's: main.ts —: the tiles
      // kept round the ship, the ground under its gear; the camera's place wins whenever it is on the Earth)
      const F = this.shipFocus;
      const shipLow = s.earthTerrain && !this.onFoot && F?.body === "earth" && F.altKm < 60 && !!this.earthMaps.tier;
      const focus = onEarth ? eye : shipLow ? F!.c : null;
      // (the streaming's lead: the camera's own motion over the ground, whatever carries it — the live view's)
      if (t === this.live) this.streamVelocity = this.cameraGroundVelocity(eye);
      const lead = focus ? streamingLead(focus, this.streamVelocity) : ([0, 0, 0] as Vec3);
      this.streamingState.leadM = Math.hypot(...lead) * 6378137;
      // (where the view looks, on the Earth's axes, and the eye's height: the detail led there — the relief's finest
      // windows by up to 1¼ tile of each level, the scenery's box by 0.6 of its radius, out to the ground looked at)
      const gazeDir =
        eye && near && this.gazeStreaming
          ? (near.axes.map((a) => a[0]! * cam.fwd[0] + a[1]! * cam.fwd[1] + a[2]! * cam.fwd[2]) as Vec3)
          : null;
      const eyeH = eye && near ? Math.max(heightOverGround("earth", eye.map((x) => x * near.radius) as Vec3), 1) : 0;
      // (the detail's reach — settings.detailReach —: the scenery's box this many times wider, the relief's windows led
      // out to 6, 12 or 20 km; both as this device draws them — quality-policy.ts earthDetailFor: lighter on a modest one)
      const detail = earthDetailFor(s, this.tier);
      const reach = DETAIL_REACH[detail.reach] ?? 1;
      const gazeT = eye && gazeDir ? gazeLead(eye, gazeDir, eyeH, GAZE_TILES_M[detail.reach] ?? 6000) : ([0, 0, 0] as Vec3);
      const gazeS =
        eye && gazeDir ? gazeLead(eye, gazeDir, eyeH, 0.6 * (detail.scenery === "high" ? 3000 : 2000) * reach) : ([0, 0, 0] as Vec3);
      this.streamingState.gazeM = Math.hypot(...gazeT) * 6378137;
      // (and its windows 4 or 8 tiles a side, the tiles kept past them and the ring loaded ahead round them)
      this.earthTiles.setReach(TILE_REACH[detail.reach] ?? TILE_REACH.normal);
      // (over France, the IGN's orthophotos finer than the relief's imagery — I1)
      this.earthTiles.orthoOn = s.earthOrtho;
      // (and its relief — I2)
      this.earthTiles.reliefOn = s.earthIgnRelief;
      // (its far levels' overground — I6)
      this.earthTiles.hlodOn = s.earthIgnSilhouettes;
      this.earthTiles.update(focus, pixelAngle, lead, onEarth ? gazeT : [0, 0, 0], eye ? eyeH : undefined);
      this.earthSurface.update(eye, s.earthSurface, lead);
      // (its trees and their ground over France by the IGN's survey — I4)
      this.earthScenery.ign = s.earthIgnRelief;
      this.earthScenery.overture = s.earthOverture;
      this.earthScenery.update(
        eye,
        detail.scenery,
        s.earthSurface !== "off",
        s.earthTerrain,
        this.sceneryExclusions,
        eye ? aheadFocus(eye, Math.hypot(...gazeS) > 0 ? gazeS : lead) : null,
        reach,
      );
      this.earthScenery.shadows = s.earthSceneryShadows;
      this.earthScenery.season(utcOf(time));
      // (imagery come in over tiles already drawn — their heights unchanged, no onChange: a still view kept
      // its colours without them —: a converged view drawn anew, at most every half second, once for all those
      // in. Not one still refining: restarted at each arrival, on a slow machine whose tiles stream for minutes it
      // never converged — the samples to come read the imagery anyway; a moving view shows them as it goes)
      const now = performance.now();
      if (t === this.live && this.earthTiles.imagery !== this.imagerySeen && now - this.imageryAt > 500 && this.lastPhase === "converged") {
        this.imagerySeen = this.earthTiles.imagery;
        this.imageryAt = now;
        if (!this.offline) queueMicrotask(() => this.invalidate());
      }
    }
    f.set(this.earthTiles.params(), 69 * 4);
    // (the orthophotos' levels: in the tracer's table, written when they change)
    const ortho = this.earthTiles.orthoParams();
    if (!this.orthoSent || ortho.some((v, i) => v !== this.orthoSent![i])) {
      this.device.queue.writeBuffer(this.bodyBuf, TABLE_ORTHO * 16, ortho);
      this.orthoSent = ortho;
    }
    f.set(this.earthSurface.params(), BASE_PARAM_VEC4S * 4);
    f.set(this.earthScenery.params(), (BASE_PARAM_VEC4S + SURFACE_VEC4S) * 4);
    if (!o.probe && this.character?.active && this.character.body === "earth")
      this.character.groundPatch.build(this.character.q, this.character.up(), (q) => this.character!.rawHeight(q), this.earthTiles.stamp);
    const walking = this.character?.active && this.character.ours && this.character.body === "earth" ? this.character.groundPatch : null;
    const at = (BASE_PARAM_VEC4S + SURFACE_VEC4S + SCENERY_VEC4S) * 4;
    f.fill(0, at, at + 20);
    if (!o.probe && walking?.ready && near?.index === earthK) {
      const eye = homePosition(s)!;
      const q = toBodyFixed("earth", eye, time).map((v) => v * M_METRES) as Vec3;
      const delta = q.map((v, i) => v - walking.origin[i]!) as Vec3;
      f.set([dot3(delta, walking.right), dot3(delta, walking.up), dot3(delta, walking.forward), 1], at);
      f.set([...walking.right, TABLE_WALK], at + 4);
      f.set([...walking.up, walking.size], at + 8);
      f.set([...walking.forward, walking.step], at + 12);
      if (this.walkStamp !== walking.stamp) {
        this.device.queue.writeBuffer(this.bodyBuf, TABLE_WALK * 16, walking.values);
        this.walkStamp = walking.stamp;
      }
    }
    // the ships' wakes (controller/seatraffic.ts seaWakes): each from the eye on the Earth's axes [m] (float64 here)
    const wat = at + 20;
    f.fill(0, wat, wat + WAKE_VEC4S * 4);
    if (!o.probe && this.seaWakes.length && near?.index === earthK && altKm < 30) {
      // (the camera on the Earth's axes [m]: the trace's own — seaParams's —, not the craft's: an orbiting view's eye
      // is a hundred metres off it)
      const mR = near.radius * 1476.625 * s.massSolar;
      const q = near.axes.map((a) => -(a[0]! * near.centre[0]! + a[1]! * near.centre[1]! + a[2]! * near.centre[2]!) * mR);
      {
        const list = this.seaWakes.slice(0, 8);
        f[wat] = list.length;
        // (the flown craft's — a negative length —: where it is drawn, its centre in the camera's axes, marked by 10 more
        // below — an outside view's eye is metres to hundreds of metres off it, and the controller's place is the eye's)
        const sb = this.ship.ready ? this.ship.shadowBound : null;
        list.forEach((w, i) => {
          if (w.len < 0 && sb) f.set([sb.c[0], sb.c[1], sb.c[2], w.len - 10], wat + 4 + 8 * i);
          else f.set([w.p[0] - q[0]!, w.p[1] - q[1]!, w.p[2] - q[2]!, w.len], wat + 4 + 8 * i);
          f.set([w.fwd[0] * w.beam, w.fwd[1] * w.beam, w.fwd[2] * w.beam, w.U], wat + 8 + 8 * i);
        });
      }
    }
    // the sea's FFT waves (Params.seafft): its spectrum renewed when the sea changes, its frame's waves due
    f.set(this.seaFftParams(!o.probe, time, tSec, s), wat + WAKE_VEC4S * 4);
    // (the nearest carrier's sphere in the ship's shadow map: its shadow on the sea — Params.seafft[3])
    const sb2 = !o.probe && this.ship.ready && near?.index === earthK ? this.ship.shadowBound2 : null;
    if (sb2) f.set([sb2.c[0], sb2.c[1], sb2.c[2], sb2.r], wat + WAKE_VEC4S * 4 + 12);
    // the mountains' warp's grids round the camera (worked out at the frame's start: updateWarp)
    f.set(this.warpOut.params, wat + (WAKE_VEC4S + SEAFFT_VEC4S) * 4);
    f[61 * 4 + 1] = sunAng; // (earth4.y)
    f[61 * 4 + 2] = this.marsDust(s, near, bodies, time); // (earth4.z)
    // the auroras (S2 — trace.wgsl auroraLight: bary.z, bary.w): their activity (a Kp index) and their curtains'
    // clock (the scene's seconds, over 900 s); the Earth near only — their code in the kernel then alone
    const kp = near?.index === earthK ? Math.min(Math.max(Math.round(s.aurora ?? 0), 0), 9) : 0;
    f[41 * 4 + 2] = kp;
    f[41 * 4 + 3] = kp > 0 ? ((tSec % 900) + 900) % 900 : 0;
    if (kp > 0) this.featureKey |= 16384;
    // Keep reference rendering for optical/scientific kernels and contact with the walking patch.
    // (the raster inspector draws its own patch and reads the cache itself; it does not need the tracer to be free of the
    // wormhole's metric, which the Earth scenes always carry: only the tracer's *use* of the cache does)
    // (the pipeline the near Earth is drawn by: the setting's, unless the raster proved too heavy for this device —
    // rasterFellBack, main.ts's governor —, then traced)
    const rasterWanted = this.earthPipelineNow(s) === "raster";
    const terrainRasterEligible = !!(
      (s.earthTerrainCache || s.earthTerrainRasterView !== "off" || s.earthTerrainRasterUse || rasterWanted) &&
      s.earthTerrain &&
      this.earthMaps.tier &&
      t === this.live &&
      !o.probe &&
      !s.polarization &&
      s.band === "visible" &&
      s.renderMode === "physical" &&
      (this.tuneKey === 0 || rasterWanted) &&
      !walking &&
      earthSurface &&
      Math.abs(earthSurface.lat) <= TERRAIN_CACHE_MAX_LAT &&
      earthSurface.h * WGS84_A < 100_000
    );
    // (the raster's primary visibility keeps its path under the debug tunings — renderer.tune: what each part of its shading costs)
    const terrainCacheEligible = terrainRasterEligible && this.tuneKey === 0 && (this.featureKey & 512) === 0;
    const inspecting = terrainRasterEligible && s.earthTerrainRasterView !== "off";
    if (!o.probe && t === this.live) this.rasterEligibleNow = terrainRasterEligible && rasterWanted;
    // (the realtime kernel's ground march from the patch's distances: only where the device takes the texture, and in the
    // interleaved realtime frames — a still view converges on the quality kernel, which keeps the reference march)
    const hinting =
      terrainRasterEligible && (s.earthTerrainRasterUse || rasterWanted) && this.rasterHint && (o.flags & FLAG_INTERLEAVED) !== 0;
    // (the raster's primary visibility — docs/PLAN-RENDU-RASTER-AAA.md étape 1 —: the patch's pixels shaded one a pixel by
    // the kernel shade after the trace, which leaves them; trace.wgsl rasterPrimary reads it)
    const rasterPrimary = hinting && rasterWanted;
    if (!o.probe) this.rasterPrimaryOn = rasterPrimary;
    // (… and its shading rate: 1 every pixel, 2 one in two, 4 one in 2 × 2 … — trace.wgsl rasterRate; "auto": the
    // governor's, by the device's measured load — adaptRasterRate)
    this.rasterRate = this.rasterRateFor(s);
    // (the cloud pass's bit — CLOUD_PASS_FLAG — set once it is drawn this frame: dispatchTrace, when the frame's key is whole)
    this.cloudPassDrawn = false;
    // (16 written 15: the rate's four bits — trace.wgsl rasterRate)
    // (64: the ground's albedo read at every pixel — RASTER_DETAIL, trace.wgsl rasterAlbedo —, not with the temporal upsampling,
    // whose history has no albedo beside it)
    const detail = rasterPrimary && this.rasterDetail && !this.taauOn;
    f[MOUTH_LIST_AT + 5] = rasterPrimary
      ? Math.min(this.rasterRate, 15) + (this.rasterJitter === "halton" ? 16 : 0) + (detail ? RASTER_DETAIL_FLAG : 0)
      : 0;
    if (!o.probe) {
      this.rasterHaltonNow = rasterPrimary && this.rasterJitter === "halton";
      this.rasterDetailNow = detail;
    }
    // (the trees drawn as raster instances this frame: set once they are — encodeTerrainRasterVisibility)
    f[MOUTH_LIST_AT + 6] = 0;
    // Keep a stable key when a still frame starts refining; its quality kernel compiles the cache out.
    if (terrainCacheEligible) this.featureKey |= FEATURE_TERRAIN_CACHE;
    if (hinting) this.featureKey |= FEATURE_TERRAIN_RASTER;
    // (the Earth-raster profile: the raster draws the near Earth — its kernels' constants fixed for the flight, tracer-kernels.ts)
    if (rasterPrimary && this.stableProfiles) this.featureKey |= FEATURE_RASTER_PRIMARY;
    this.terrainCacheWanted = (terrainCacheEligible || inspecting || hinting) && (o.flags & FLAG_INTERLEAVED) !== 0;
    if (!o.probe) {
      this.terrainRasterRequested = inspecting || hinting;
      // (a diagnostic's own GPU work — the inspector, the cache, the hints alone —: the automatic quality held while it
      // runs; the raster pipeline is the image itself, governed as the traced one)
      this.terrainRasterDiagnostic = inspecting || (terrainCacheEligible && s.earthTerrainCache) || (hinting && !rasterPrimary);
      this.terrainRasterLevel = Number.isFinite(s.earthTerrainRasterLevel)
        ? Math.max(0, Math.min(TERRAIN_CACHE_LEVELS - 1, Math.round(s.earthTerrainRasterLevel)))
        : 0;
    }
    f[MOUTH_LIST_AT + 7] = terrainCacheEligible && this.terrainCacheWanted && s.earthTerrainCache ? 1 : 0;
    if (!o.probe) this.marsDustNow = f[61 * 4 + 2]!;
    // (the storm's diffuse light in the kernel's weather code: compiled in only then)
    if (f[61 * 4 + 2]! > 0) this.featureKey |= 1024;
    // the regional surface's and the scenery's code in the kernel (4096, 8192): their kernel compiled ahead,
    // from the moment their data is asked for — its compile (three of a ~7 000-line kernel, seconds of the GPU
    // process) falls while they load, not in the frame they appear (E2E campaign item 5) —, and their bits
    // switched on only once it is there: until then their params stay zero, the kernel without them draws on
    const surfaceAsked = this.earthSurface.active || this.earthSurface.pending;
    const sceneryAsked = this.earthScenery.active || this.earthScenery.pending;
    const ahead = this.featureKey | (surfaceAsked ? 4096 : 0) | (sceneryAsked ? 8192 : 0);
    if (!o.probe) {
      this.aheadKey = this.firstFrameDoneAt && ahead !== this.featureKey ? ahead : -1;
      if (this.aheadKey >= 0) this.traceVariant("rt", this.aheadKey);
    }
    const surfaceOn = this.earthSurface.active && this.kernelReady(this.featureKey | 4096) && this.rasterReady(this.featureKey | 4096);
    if (surfaceOn) this.featureKey |= 4096;
    else f.fill(0, BASE_PARAM_VEC4S * 4, (BASE_PARAM_VEC4S + SURFACE_VEC4S) * 4);
    const sceneryOn = this.earthScenery.active && this.kernelReady(this.featureKey | 8192) && this.rasterReady(this.featureKey | 8192);
    if (sceneryOn) this.featureKey |= 8192;
    else f.fill(0, (BASE_PARAM_VEC4S + SURFACE_VEC4S) * 4, (BASE_PARAM_VEC4S + SURFACE_VEC4S + SCENERY_VEC4S) * 4);
    if (!o.probe) {
      // (held back, the settled frame waits; let through, the image changes: drawn anew once this frame is out)
      const held = (this.earthSurface.active && !surfaceOn) || (this.earthScenery.active && !sceneryOn);
      if (this.earthHeld && !held && !this.offline) queueMicrotask(() => this.invalidate());
      this.earthHeld = held;
    }
    // (the aerial perspective's table: the live view's realtime frames, a world with air near the camera and the camera
    // within its air — its pass's kernel compiled for this key; else the rays march their own air)
    this.aerialPipe = null;
    if (t === this.live && !o.probe) this.aerialWanted = false;
    if (t === this.live && !o.probe && (o.flags & FLAG_INTERLEAVED) !== 0 && this.aerialTable && near && atm) {
      const inside = Math.hypot(...near.centre) < 1 + (0.9 * 12 * atm.H) / mR;
      const pipe = this.featureKey !== FEATURES_ALL ? (this.variants.get(this.featureKey)?.air ?? null) : null;
      this.aerialWanted = inside && this.aerialOK && (this.featureKey & 128) !== 0;
      if (inside && pipe) {
        this.aerialPipe = pipe;
        u[17 * 4 + 2] = (u[17 * 4 + 2] ?? 0) | FLAG_AERIAL;
      }
    }
    this.device.queue.writeBuffer(this.paramBuf, 0, this.params);
  }

  /**
   * Radius beyond which an outgoing ray has left all emitting matter; the rest of its path is
   * handled by the analytic weak-field deflection (error O(M²/r²)).
   */
  private escapeRadius(s: Settings) {
    let r = Math.max(60, 1.5 * s.diskOuter); // (the disk thins out to 1.3 of its outer radius)
    if (s.jet) r = Math.max(r, s.jetLength * 1.05);
    if (s.hotFlow) r = Math.max(r, 1.5 * s.diskOuter);
    if (s.sun) r = Math.max(r, s.sunOrbit + s.sunRadius + 5); // rays must meet the star inside
    // a system's traced bodies, and an orbiting mouth, likewise
    for (const b of sceneBodies(s, 0))
      if (b.parent < 0 && b.where === 0) r = Math.max(r, Math.min(Math.hypot(...b.pos), TRACED_RADIUS) + b.radius + 5);
    if (s.wormhole && s.whOrbit) r = Math.max(r, s.whDist + mouth(s).rGlue + 5);
    return r;
  }

  /** The target holds a multi-sample estimate (progressive / offline), not a realtime frame. */
  private accumulated(t: Target) {
    if (t === this.live) return this.lastPhase !== "realtime" && this.sampleIndex >= 2;
    return (this.offline?.sampleIndex ?? 0) >= 2;
  }

  /** Tick cell size in image pixels and grid dimensions. */
  private polCells(s: Settings, t: Target) {
    const cs = Math.max(6, Math.round((s.polTickSize * t.height) / 1080));
    return { cs, gw: Math.ceil(t.width / cs), gh: Math.ceil(t.height / cs) };
  }

  private writeDisplay(s: Settings, target: Target, outW: number, outH: number, letterbox: boolean, dither: boolean, hdr = false) {
    let [sx, sy, ox, oy] = this.displayView(target, outW, outH, letterbox);
    // (the live view shaken: offset, and zoomed in as much so no edge shows)
    const [kx, ky] = this.shake;
    if (target === this.live && (kx || ky)) {
      const z = 1 + 2.2 * Math.max(Math.abs(kx), Math.abs(ky));
      ox += kx - (sx * (z - 1)) / 2;
      oy += ky - (sy * (z - 1)) / 2;
      sx *= z;
      sy *= z;
    }
    const d = new Float32Array([
      outW,
      outH,
      2 ** this.ev(s) / preExposure(this.ev(s)) / (s.band === "230GHz" ? s.radioPeak : 1),
      TONEMAPS[s.tonemap],
      s.renderMode === "physical" && !this.costViewMode ? 0 : 1,
      s.bloom,
      target.bloomLevels - 1,
      dither ? 1 : 0,
      sx,
      sy,
      ox,
      oy,
      hdr ? 1 : 0,
      Math.max(1, s.hdrPeak),
      0,
      0,
      ...(() => {
        const { cs, gw, gh } = this.polCells(s, target);
        return [s.polarization ? 1 : 0, cs, gw, gh];
      })(),
      // fraction drawn at full length: synchrotron scenes vs the thermal disk's ≤ 11.7 %
      target.width,
      target.height,
      s.hotFlow || s.jet ? Math.max(0.05, s.polFraction) : 0.117,
      s.band === "230GHz" ? 1 : 0,
      this.beamSetup(s, target)?.level ?? 0,
      (s.ship || this.craftsShown) && this.ship.ready ? 1 : 0,
      this.dofOn(s, target) ? 1 : 0,
      // (the sharpening, RCAS — the live view and its refining; the instrument's beam left soft)
      s.sharpen,
    ]);
    // (the lens flare's strength: after the HDR peak)
    d[14] = s.lensFlare;
    d[15] = this.shadowKeep;
    this.device.queue.writeBuffer(this.displayBuf, 0, d);
    // (the eye: the night's Purkinje shift — display.wgsl eye.x —, by how dark the scene the exposure
    // adapts to is: daylight EV ~14.4, night ~16.3 — the shadows of a sunlit day stay in colour)
    const scotopic = Math.min(Math.max((this.ev(s) - 15) / 1.2, 0), 1);
    // (the telescope's spot — a sensor's frame, not the eye's —: no Purkinje shift; its black point, the sky behind
    // the target as the frame exposes it, a little under it)
    const spot = target === this.live && this.meterSpot && this.spotSky > 0;
    this.device.queue.writeBuffer(
      this.displayBuf,
      128,
      new Float32Array([spot ? 0 : s.purkinje * scotopic, spot ? 0.92 * this.spotSky * 2 ** this.ev(s) : 0, 0, 0]),
    );
    // (the rain — W5, display.wgsl rainLook —: its strength, a clock [s], in the cabin (its canopy's drops),
    // the vertical field's half tangent; the drops' velocity on the camera's axes [m/s], their speed)
    const r = target === this.live ? this.rain : null;
    const inside = !!r && !r.dust && s.ship && (s.shipMount === "cockpit" || s.shipMount === "cabin");
    const v = r?.v ?? [0, 0, 0];
    this.device.queue.writeBuffer(
      this.displayBuf,
      144,
      new Float32Array([
        r ? Math.min(r.rain, 1.3) : 0,
        this.rainClock % 3600,
        // (z: in the cabin 1; Mars's dust, not rain, 2)
        (inside ? 1 : 0) + (r?.dust ? 2 : 0),
        Math.tan((s.fov * Math.PI) / 360),
        ...v,
        Math.hypot(...v),
        // (rainX: the flown craft's distance from the camera [m] — outside it, the drops beyond it hidden —,
        // the gusts, the lens wet)
        r && !inside && s.ship && this.shipPose ? Math.hypot(...shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t) : 0,
        r?.gust ?? 0,
        // (outside, the camera's lens wet: a few soft drops — PLAN-PLUIE, the owner's choice)
        r && !r.dust && !inside ? 1 : 0,
        // (inside the A320: its windows' own drops, wiped — ship.wgsl a320Wet —, not the canopy's)
        inside && s.vessel === "a320" && this.a320Deck ? 1 : 0,
      ]),
    );
    // (the F-35's heat haze — display.wgsl haze —: its exhaust's column in the image, its radii, its strength,
    // a clock)
    // (the A320's: its two engines' columns)
    const clock = (performance.now() / 1000) % 3600;
    for (const k of [0, 1]) {
      const hz = target === this.live && s.ship && s.heatHaze ? this.ship.hazeView(k) : null;
      this.device.queue.writeBuffer(this.displayBuf, 192 + 32 * k, new Float32Array(hz ? [...hz, clock] : [0, 0, 0, 0, 0, 0, 0, 0]));
    }
  }

  /** the rain round the camera (main.ts, from the controller's rainView): its strength and the drops'
   *  velocity on the camera's axes [m/s]; null: none */
  rain: { rain: number; v: [number, number, number]; dust?: boolean; gust?: number } | null = null;
  /** the rain's clock [s] (main.ts): the frames' time while the time runs — paused, held: the drops stand
   *  still in the air and on the glass */
  rainClock = 0;
  private rainDrawn = -1;

  /**
   * The Earth's runways within 150 km of the camera (at most 4, nearest first) for the tracer: each its
   * threshold's geodetic direction and length, its landing direction and half width, its right, and the
   * camera from its threshold in physical body-fixed metres — c is in squashed radii. Their tangents
   * projected, the threshold's height drops out. Each landed into the weather's wind (W4: its lights and
   * PAPI at that end — across.w 1: the far one); [0].yzw the wind at 10 m at the nearest, blowing towards
   * [m/s, the Earth's axes] — the windsocks'.
   */
  private nearRunways(c: Vec3, s: Settings, time: number): Float32Array {
    // (the world's runways about the eye brought in — src/world/runways3d.ts, PLAN-RADAR-AAA RD13 —: graded, drawn;
    // the scenery kept off them)
    {
      const g = cartToGeodetic(WGS84_A, WGS84_F, [c[0] * WGS84_A, c[1] * WGS84_A, c[2] * (1 - WGS84_F) * WGS84_A]);
      if (worldRunwaysUpdate((g.lat * 180) / Math.PI, (g.lon * 180) / Math.PI, performance.now())) {
        this.sceneryExclusions = [
          ...SCENERY_EXCLUSIONS,
          ...worldRunwaysNow().map((r) => ({
            lat: r.site.lat,
            lon: r.site.lon,
            heading: r.site.rwy ?? 0,
            length: r.len,
            halfWidth: r.halfWidth + 40,
          })),
        ];
        this.invalidate();
      }
    }
    const out = new Float32Array(RUNWAY_VEC4S * 4);
    const near = EARTH_RUNWAYS.map((r) => {
      const d: Vec3 = [c[0] * WGS84_A - r.origin[0], c[1] * WGS84_A - r.origin[1], c[2] * (1 - WGS84_F) * WGS84_A - r.origin[2]];
      return { r, d, dist: Math.hypot(...d) };
    })
      .filter((x) => x.dist < 150e3)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 4);
    out[0] = near.length;
    const days = daysOf(time);
    near.forEach(({ r, d }, k) => {
      const rev = landingEnd(r.site, s, days, this.weatherReal).reverse ? 1 : 0;
      // (w: the runway's level [m] — its airfield graded to it (sites.ts runwayGrade), the windsocks' and the
      // buildings' feet)
      // (its across's w: the landing end and its flags — trace.wgsl runwayFlags)
      out.set([...r.p, r.len, ...r.along, r.halfWidth, ...r.across, rev | (r.flags & ~1), ...d, r.elev], 4 + 16 * k);
    });
    if (near.length) {
      const st = near[0]!.r.site;
      const w = weatherAt(s, st, days, this.weatherReal);
      const to = ((windFromAt(w, st, days) + 180) * Math.PI) / 180;
      const p = near[0]!.r.p;
      const eh = Math.hypot(p[0], p[1]) || 1;
      const east = [-p[1] / eh, p[0] / eh, 0];
      const north = [-p[2] * east[1]!, p[2] * east[0]!, p[0] * east[1]! - p[1] * east[0]!];
      out.set(
        [0, 1, 2].map((i) => w.wind.u10 * (east[i]! * Math.sin(to) + north[i]! * Math.cos(to))),
        1,
      );
      // (the lights' clock — their flashes, wall time — and the visibility there: under 3 km, fully up by day;
      // the published ends' designations, by twos, 37 to a place — A2)
      const des = [0, 1, 2, 3].map((k) => {
        const r = near[k]?.r.site.rwy;
        return r === undefined ? 0 : Math.round(r / 10) % 36 || 36;
      });
      out.set(
        [
          (performance.now() / 1000) % 600,
          1 - Math.min(Math.max((w.visibility - 3000) / 5000, 0), 1),
          des[0]! + 37 * des[1]!,
          des[2]! + 37 * des[3]!,
        ],
        17 * 4,
      );
    }
    return out;
  }

  private dofOn(s: Settings, t: Target) {
    if (this.costViewMode) return false;
    if (!s.dof || s.dofAperture <= 0) return false;
    this.ensureDof(t);
    return true;
  }

  private writeResolve(t: Target, s: Settings) {
    const view = s.polarization && s.polView === "intensity" ? 1 << 8 : 0;
    // x: block | view << 8 | image width << 16
    const r =
      t === this.live
        ? [this.lastBlock | view | (t.width << 16), ...this.lastOffset, this.validFrom]
        : [1 | view | (t.width << 16), 0, 0, 0];
    this.device.queue.writeBuffer(t.resolveBuf, 0, new Uint32Array(r));
    // (the cost view shown as it is: its heat map neither exposed nor tone-mapped — the display's bypass)
    // (y: the raster's shading rate — post.wgsl resolve and temporal: its wider reconstruction at 1 in 8 or 16)
    this.device.queue.writeBuffer(
      t.resolveBuf,
      16,
      // (z: the ground's albedo at every pixel — RASTER_DETAIL: the stale pixels rebuilt with their own)
      new Float32Array([
        this.costViewMode ? 1 : preExposure(this.ev(s)),
        this.rasterPrimaryOn ? this.rasterRate : 0,
        this.rasterDetailNow && !this.costViewMode ? 1 : 0,
        // (w: the horizon's fixes — docs/progress/HORIZON-FLICKER.md: 1 the raster's ground never rebuilt from the tracer's
        // samples, 2 its history longer where it barely moves; switches for comparisons)
        (this.horizonKeep ? 1 : 0) + (this.horizonFarAlpha ? 2 : 0),
      ]),
    );
    if (s.polarization) {
      const { cs, gw, gh } = this.polCells(s, t);
      this.device.queue.writeBuffer(t.polGridBuf, 0, new Uint32Array([cs, gw, gh, t.width]));
    }
  }

  /**
   * Mars's dust storm (PLAN-METEO W6; trace.wgsl setAir: earth4.z), 0 … 1: the weather's dust at the camera's
   * place when Mars is the body near it; else the Dust preset's, for all of Mars (a global storm) — a draw's
   * regional storms seen only from near.
   */
  private marsDustNow = 0;
  private marsDust(s: Settings, near: ReturnType<typeof localPatch>, bodies: GpuBody[], time: number): number {
    if (s.weather === "fair") return 0;
    if (near && bodies[near.index]?.id === "mars") {
      const g = patchGeodetic(near, flatteningOf("mars"));
      return weatherAt(s, { body: "mars", lat: (g.lat * 180) / Math.PI, lon: (g.lon * 180) / Math.PI }, daysOf(time), this.weatherReal)
        .dust;
    }
    return s.weather === "dust" ? 1 : 0;
  }

  /** the weather's clouds' drift with the wind [m, the Earth's axes] and the clock it was last moved at [s] */
  private wxDrift: [number, number, number] = [0, 0, 0];
  /** a storm's lightning about the camera (system/lightning.ts; N5): its flashes, the thunder's (main.ts drains them) */
  readonly lightning = new Lightning();
  /** the ground's wetness, accumulated in the rain and dried after it (N5), and the clock it was last stepped at */
  private wetness = 0;
  private wetAt = Number.NaN;
  /** the valleys' floor about the camera [m] (the fog's — N5: a valley fog), and where it was found */
  private fogFloor: { lat: number; lon: number; h: number } | null = null;
  private wxDriftAt = Number.NaN;

  /**
   * The weather near the camera (trace.wgsl: Params.wx; PLAN-METEO W3), under 30 km over the Earth (its
   * weight from 1 at 15 km to 0 at 30): weather.ts's state at the camera's place — the haze beyond the air's
   * own (Koschmieder: 3.912 / visibility), the fog and its top, the layers above the sea (the ground's height
   * there added), each with its optical thickness (~25 per 1.5 km: a storm's tower ~150) — and the clouds'
   * drift with the wind at their height (~2.5 × its 10 m speed), moved on with the clock. None (0): the fair
   * weather, its image as before — the Earth's own clouds and air.
   */
  private weatherParams(
    surface: ReturnType<typeof patchGeodetic> | null,
    altKm: number,
    time: number,
    tSec: number,
    s: Settings,
    live: boolean,
  ): Float32Array {
    const out = new Float32Array(WX_VEC4S * 4);
    if (live) this.wxLight = 1;
    if (!surface || !(altKm < 30) || !this.earthMaps.tier) return out;
    const lat = (surface.lat * 180) / Math.PI,
      lon = (surface.lon * 180) / Math.PI;
    const w = weatherAt(s, { body: "earth", lat, lon }, daysOf(time), this.weatherReal);
    if (w.layers.length === 0 && w.fogTop <= 0 && w.visibility >= 30e3) return out;
    // (the sea's surface at the geoid: the ground never under it)
    const ground = Math.max(groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)), geoidN(surface.lat, surface.lon));
    // (a fog's valleys' floor: the relief's lowest on rings 2–18 km about the camera, found again every 2 km)
    if (
      w.fogTop > 0 &&
      (!this.fogFloor || Math.hypot(this.fogFloor.lat - lat, (this.fogFloor.lon - lon) * Math.cos((lat * Math.PI) / 180)) > 0.02)
    ) {
      let h = ground;
      for (const km of [2, 5, 10, 18])
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * 2 * Math.PI;
          const la = lat + (km / 111.2) * Math.cos(a),
            lo = lon + ((km / 111.2) * Math.sin(a)) / Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
          h = Math.min(
            h,
            Math.max(groundRelief("earth", bodyFixedOf("earth", la, lo, 0)), geoidN((la * Math.PI) / 180, (lo * Math.PI) / 180)),
          );
        }
      this.fogFloor = { lat, lon, h };
    }
    const g = weatherGpu(w, ground, altKm, w.fogTop > 0 && this.fogFloor ? this.fogFloor.h : ground);
    if (live) this.wxLight = g.light;
    out.set(g.params, 0);
    // the drift: the wind at the clouds' height, blowing from `from` — on the place's east and north
    if (live) {
      const dt = tSec - this.wxDriftAt;
      this.wxDriftAt = tSec;
      if (dt > 0 && dt < 600) {
        const to = (windFromAt(w, { lat, lon }, daysOf(time)) * Math.PI) / 180 + Math.PI;
        const n = surface.normal;
        const eh = Math.hypot(n[0], n[1]) || 1;
        const east = [-n[1] / eh, n[0] / eh, 0];
        const north = [-n[2] * east[1]!, n[2] * east[0]!, n[0] * east[1]! - n[1] * east[0]!];
        const v = 2.5 * Math.max(w.wind.u10, 1) * dt;
        this.wxDrift = this.wxDrift.map((d, i) => {
          const x = d + v * (east[i]! * Math.sin(to) + north[i]! * Math.cos(to));
          return x - Math.floor(x / WX_DRIFT_PERIOD) * WX_DRIFT_PERIOD;
        }) as [number, number, number];
      }
    }
    out.set([ground, ...this.wxDrift], 16);
    // (the rain — PLAN-PLUIE P4 —: the ground's wetness, the rain now, its clock — the drops' rings. The wetness grows in the
    // rain — soaked in some 5 minutes of a steady rain, faster in a downpour — and dries after it in ~30 minutes, not at once)
    if (live) {
      const dt = tSec - this.wetAt;
      this.wetAt = tSec;
      if (dt > 0 && dt < 600) {
        const target = Math.min(1, w.rain * 1.6);
        this.wetness =
          this.wetness < target ? Math.min(target, this.wetness + (dt * w.rain) / 200) : Math.max(target, this.wetness - dt / 1800);
      } else if (!(dt >= 0)) this.wetness = Math.min(1, w.rain * 1.6);
    }
    if (w.rain > 0 || this.wetness > 1e-3) out.set([this.wetness, w.rain, this.rainClock % 3600, 0], 20);
    // (a storm's lightning — N5 —: the flash now, its place from the camera on the Earth's axes [m] and its light; the ground
    // under it, to the ground or not, its seed, its light's reach)
    if (live) {
      this.lightning.eyeH = altKm * 1e3;
      const deck = g.params.slice(4, 16);
      const storm = w.kind === "storm" ? 1 : w.rain > 0.7 && deck[1]! - deck[0]! > 4500 ? 0.5 : 0;
      this.lightning.step(tSec, storm, deck[0]! || 1000, deck[1]! || 8000);
    }
    const fl = this.lightning.light(tSec);
    if (fl) {
      const n = surface.normal;
      const eh = Math.hypot(n[0], n[1]) || 1;
      const east = [-n[1] / eh, n[0] / eh, 0];
      const north = [-n[2] * east[1]!, n[2] * east[0]!, n[0] * east[1]! - n[1] * east[0]!];
      const up = fl.f.h - altKm * 1e3;
      const at = [0, 1, 2].map((i) => east[i]! * fl.f.east + north[i]! * fl.f.north + n[i]! * up);
      out.set([...at, fl.i], 24);
      out.set([ground, fl.f.ground ? 1 : 0, fl.f.seed, 3000], 28);
    }
    // (the kernel with the weather's code: fair weather — every scene but these — without it, +20 % before)
    if (g.params[0]! > 0) this.featureKey |= 1024;
    return out;
  }

  /**
   * The sea's resolved waves near the camera (trace.wgsl: Params.sea, seaWaves), under 30 km over the
   * Earth: the flight's own wind there (wind.ts: its level's speed at 10 m, its direction), its axes on
   * the Earth's, the camera on them from an anchor of whole kilometres (float64: the waves' phases exact in
   * float32), the twelve trains — the resolved half of Cox–Munk's slope variance shared among them, cut
   * above the wind sea's peak (Pierson–Moskowitz: λp ≈ 0.83 U² m) — and their phases now (ω = √(g k)).
   */
  private seaParams(
    near: ReturnType<typeof localPatch>,
    bodies: GpuBody[],
    earthK: number,
    altKm: number,
    time: number,
    tSec: number,
    s: Settings,
  ): Float32Array {
    const out = new Float32Array(SEA_VEC4S * 4);
    this.seaHere = null;
    if (!near || near.index !== earthK || !(altKm < 30)) return out;
    // (in metres as the shader has it: P.near4.w)
    const mR = near.radius * 1476.625 * s.massSolar;
    const cb = near.axes.map((a) => -(a[0]! * near.centre[0]! + a[1]! * near.centre[1]! + a[2]! * near.centre[2]!) * mR);
    const surface = patchGeodetic(near, flatteningOf(bodies[near.index]!.id));
    const lat = (surface.lat * 180) / Math.PI,
      lon = (surface.lon * 180) / Math.PI;
    // (the waves' axes at a fixed anchor, not at the camera: on the camera's own tangent plane its place was always
    // ~0 on them — the sea carried along under the craft. The anchor kept while within 50 km of it.)
    const camUp = surface.normal;
    const A = this.seaAnchor;
    if (!A || A[0]! * camUp[0]! + A[1]! * camUp[1]! + A[2]! * camUp[2]! < Math.cos(50_000 / 6_371_000)) this.seaAnchor = [...camUp];
    const up = this.seaAnchor!;
    const eh = Math.hypot(up[0]!, up[1]!) || 1;
    const east = [-up[1]! / eh, up[0]! / eh, 0];
    const north = [up[1]! * east[2]! - up[2]! * east[1]!, up[2]! * east[0]! - up[0]! * east[2]!, up[0]! * east[1]! - up[1]! * east[0]!];
    // (the weather's wind — weather.ts, as the flight's —: blowing from it, towards the opposite way)
    const wx = weatherAt(s, { body: "earth", lat, lon }, daysOf(time), this.weatherReal).wind;
    const to = (wx.from === null ? windFrom(lat, lon, daysOf(time)) : (wx.from * Math.PI) / 180) + Math.PI;
    const tu = [0, 1, 2].map((i) => east[i]! * Math.sin(to) + north[i]! * Math.cos(to));
    const tc = [up[1]! * tu[2]! - up[2]! * tu[1]!, up[2]! * tu[0]! - up[0]! * tu[2]!, up[0]! * tu[1]! - up[1]! * tu[0]!];
    const U = Math.max(wx.u10, 0.5);
    const weight = Math.min(Math.max((30 - altKm) / 15, 0), 1);
    this.seaHere = { U, to, lat, lon, weight };
    const uc = cb[0]! * tu[0]! + cb[1]! * tu[1]! + cb[2]! * tu[2]!;
    const cc = cb[0]! * tc[0]! + cb[1]! * tc[1]! + cb[2]! * tc[2]!;
    const u0 = Math.round(uc / 1024) * 1024,
      c0 = Math.round(cc / 1024) * 1024;
    out.set([...tu, U, ...tc, weight, uc - u0, cc - c0, u0 / 256, c0 / 256], 0);
    // (the resolved range's share of the slopes' variance, among the trains below the peak)
    const lp = 0.83 * U * U;
    const cut = SEA_WAVES.map((w) => {
      const lam = 1024 / Math.hypot(...w.n);
      return Math.exp(-1.25 * (lam / lp) ** 2);
    });
    const sum = cut.reduce((a, b) => a + b, 0) || 1;
    const budget = 0.5 * (0.003 + 0.00512 * U);
    SEA_WAVES.forEach((w, i) => {
      const k = (2 * Math.PI * Math.hypot(...w.n)) / 1024;
      const a = Math.sqrt((2 * budget * cut[i]!) / sum);
      const phase = (Math.sqrt(9.81 * k) * tSec + w.phase0) % (2 * Math.PI);
      out.set([w.n[0], w.n[1], a, phase], 12 + 4 * i);
    });
    return out;
  }

  /** the sea's waves' anchor: the local vertical their axes are taken at (seaParams) */
  private seaAnchor: number[] | null = null;
  /** the wind and the place the sea's waves are drawn for this frame (seaParams; null: no sea near) */
  private seaHere: { U: number; to: number; lat: number; lon: number; weight: number } | null = null;

  /**
   * The sea's FFT waves for this frame (trace.wgsl: Params.seafft; sea/fft-gpu.ts): the sea's state about the camera
   * — the marine model's (sea/marine.ts), else the sea the wind raises —, its spectrum renewed when it changes (its
   * frame the wind's way: the trains' and the wakes' axes), the waves at the clock now due before the tracer; the
   * Cox–Munk slopes' variance finer than the cascades (what they leave of it — a quarter at least: the capillaries).
   */
  private seaFftParams(frame: boolean, time: number, tSec: number, s: Settings): Float32Array {
    const out = new Float32Array(SEAFFT_VEC4S * 4);
    const H = this.seaHere;
    if (!this.seaFft || !s.seaFft || !H || H.weight <= 0) return out;
    // (the raster drawing the water and no sea of it for a while — over Paris, 150 km inland —: the waves not computed, ~2 ms
    // on an M1; back within a probe's frames once some sea is drawn, its far trains meanwhile)
    if (this.rasterWaterNow && this.frameStamp - this.seaSeenStamp > SEA_UNSEEN_FRAMES) return out;
    const base = this.seaOverride ?? this.marine.peek(H.lat, H.lon, utcOf(time)) ?? windSea(H.U, H.to);
    // (a swell imposed — a heavy sea's qualification: controller/quals.ts —, from the wind's way)
    const state = this.seaSwell ? { ...base, swell: { hs: this.seaSwell, tp: 11, to: H.to } } : base;
    this.seaState = state;
    this.seaHs = Math.hypot(state.wind.hs, state.swell.hs);
    const r = (x: number, k: number) => Math.round(x * k);
    const deg = (a: number) => r(((a * 180) / Math.PI + 360) % 360, 0.2);
    const key = [
      r(state.wind.hs, 10),
      r(state.wind.tp, 4),
      deg(state.wind.to),
      r(state.swell.hs, 10),
      r(state.swell.tp, 2),
      deg(state.swell.to),
      deg(H.to),
    ].join();
    if (key !== this.seaKey) {
      this.seaKey = key;
      this.seaFft.setSpectrum(seaCascades(seaSystems(state, H.to), 1));
    }
    // (the waves at this clock due before the next trace — the probe's params and the frame's alike: the same sea)
    if (frame || !this.seaFftDue) this.seaFftT = tSec;
    this.seaFftDue = true;
    const st = this.seaFft.stats;
    const cmU = 0.00316 * H.U,
      cmC = 0.003 + 0.00192 * H.U;
    // (w: the dominant system's peak period [s] — the surf's bands, trace.wgsl seaShade)
    const tp = state.swell.hs > state.wind.hs ? state.swell.tp : state.wind.tp;
    out.set([1, this.seaLambda, Math.sqrt(st.height), tp], 0);
    out.set([1024, 128, 16, 256], 4);
    // (the whitecaps' threshold on the Jacobian: its spread from the long cascades' slopes — J ≈ 1 + λ k h —, the
    // level under which lies Monahan's cover at this wind)
    const sJ = this.seaLambda * Math.sqrt(st.slope01);
    const W = Math.min(Math.max(3.84e-6 * H.U ** 3.41, 1e-5), 0.1);
    out.set([Math.max(cmU - st.slopeX, 0.25 * cmU), Math.max(cmC - st.slopeZ, 0.25 * cmC), 1 + sJ * normalQuantile(W), sJ], 8);
    // (the foam each cascade makes — sea/fft-gpu.ts: where its own Jacobian falls under the level of Monahan's cover)
    this.seaFoamJ = st.slopeC.map((v) => 1 + this.seaLambda * Math.sqrt(v) * normalQuantile(W));
    return out;
  }

  /** The light probe around the camera (after the frame's params are written), then its mips and SH. */
  private dispatchEnv(enc: GPUCommandEncoder, t: Target, s: Settings) {
    // (on foot, the probe round the camera lights the astronaut and the grass: the ship's light, the same world)
    if (!s.ship && !this.craftsShown && !this.character?.active) {
      this.envReset = true; // stale by the time the ship comes back
      return;
    }
    if (!this.ship.ready) {
      this.shipLoading ??= loading
        .track(
          "ranger",
          "The Ranger — hull & mounts",
          this.ship.load((u) => loading.fetch(u, "ranger")),
        )
        .then(
          () => this.invalidate(),
          (e) => console.error("Ranger:", e),
        );
      return;
    }
    // (256 × 128 probe: everything after a reset, else one texel of each 2×2 or 4×4 block per run)
    if (this.envEvery > 1 && this.envTick++ % this.envEvery !== 0) return;
    const k = this.envStride;
    const pipeline = this.traceVariant("env");
    if (!pipeline) return; // (its epoch unmarked: the next frame tries again)
    const pass = enc.beginComputePass(this.prof.pass("ship probe: trace"));
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, t.traceBind);
    pass.setBindGroup(1, this.envRead);
    pass.dispatchWorkgroups(32 / k, 16 / k);
    pass.end();
    // (its filtering: every other frame when it changes slowly)
    if (k !== 4 || this.envPhase % 2 === 0) this.ship.encodeEnv(enc);
    enc.copyBufferToBuffer(this.ship.shBuf, 0, this.bodyBuf, this.bodyData.byteLength, SH_BYTES);
    this.envReset = false;
    this.envAt = performance.now();
    if (this.envSpread > 0) this.envSpread--;
    this.envPhase++;
  }

  /**
   * The planets' light probes, one planet every 2 s in turn (those lit by the disk: a star's planet is
   * lit by its star): the probe kernel from its centre, moving with it, itself left out; read back
   * and reduced on the CPU (planet-probe.ts). Its own params and submission, before the frame's.
   */
  private probePlanets(t: Target, s: Settings, time: number): void {
    // (traced a sixteenth at a time — one texel of each 4×4 block per frame, the whole probe in 16
    // frames: a 30 ms hitch every 2 s became ~2 ms a frame)
    const job = this.probeJob;
    if (!job) {
      // (not before the first image: the probe's params bring their own features key, whose kernel would
      // be compiled before the camera's)
      if (!this.firstFrameDoneAt || s.system === "none" || this.probeBusy || performance.now() - this.probeAt < 2000) return;
      // (the camera in our universe: they light nothing it can see — Gargantua's planets are specks
      // through the mouth — and the target's figures are ours)
      const cam0 = cameraFrame(s);
      if (s.wormhole && cam0.region === "throat" && cam0.ell < 0) return;
      const list = sceneBodies(s, time).filter((b) => b.kind === BODY_PLANET && b.light < 0 && b.where !== 2);
      if (!list.length) return;
      const b = list[this.probeNext++ % list.length]!;
      const vel = bodyVelocity(s, b.id as unknown as Body, time);
      this.probeJob = { b, cam: probeCamera(b.pos, vel, s.spin), time, slice: 0 };
      this.probeBusy = true;
      this.probePlanets(t, s, time);
      return;
    }
    this.writeParams(t, s, job.time, {
      block: 1,
      eps: s.realtimeEps,
      steps: s.realtimeSteps,
      y0: 0,
      y1: 1,
      accumulate: false,
      sampleIndex: 0,
      flags: 0,
      probe: { cam: job.cam, hide: job.b.id, slice: job.slice },
    });
    const enc = this.device.createCommandEncoder();
    const pipeline = this.traceVariant("env", this.featureKey, false);
    if (!pipeline) return; // (still compiling: the next slice's frame tries again)
    const pass = enc.beginComputePass(this.prof.pass("planet probe"));
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, t.probeBind);
    pass.setBindGroup(1, this.envRead);
    pass.dispatchWorkgroups(PROBE_W / 32, PROBE_H / 32);
    pass.end();
    const last = ++job.slice >= 16;
    if (last) enc.copyBufferToBuffer(this.probeBuf, 0, this.probeStage, 0, PROBE_W * PROBE_H * 16);
    this.device.queue.submit([enc.finish()]);
    if (!last) return;
    this.probeJob = null;
    this.probeAt = performance.now();
    const { b, cam } = job;
    const logY = this.diskConstants(s).logY;
    this.probeStage.mapAsync(GPUMapMode.READ).then(
      () => {
        const data = new Float32Array(this.probeStage.getMappedRange().slice(0));
        this.probeStage.unmap();
        // (colour temperatures up to what the disk can show: its peak, blueshifted by g ≤ 3)
        this.planetProbes.set(b.id, blendProbe(this.planetProbes.get(b.id), reduceProbe(data, cam, logY, b.brightness, 3 * s.diskTemp)));
        this.probeBusy = false;
      },
      () => (this.probeBusy = false),
    );
  }
  /** a planet's light probe under way: its camera, its time, the next sixteenth to trace */
  private probeJob: { b: GpuBody; cam: CameraFrame; time: number; slice: number } | null = null;

  // ------------------------------------------------------------------ kernel specialisation
  private traceModule!: GPUShaderModule;
  private displayModule!: GPUShaderModule;
  private postModule!: GPUShaderModule;
  private lutWriteLayout!: GPUBindGroupLayout;
  private lutReadLayout!: GPUBindGroupLayout;
  private mainLayout!: GPUPipelineLayout;
  private lutLayout!: GPUPipelineLayout;
  private lutPipeline: GPUComputePipeline | null = null; // (background compile — null until it lands)
  private lutQPipeline: GPUComputePipeline | null = null;
  /** this frame's params want the far field's LUT (set with them) */
  private lutOn = false;
  private lutWanted = false;
  /** the LUT's epoch on the live target (refining a still view: computed once) */
  private lutEpoch = -1;
  private tracePipeLayout!: GPUPipelineLayout;
  /** the scene's features (bits: radio, polarization, jet, hot spot, hot flow, wormhole, thick disk) — set with its params */
  private featureKey = FEATURES_ALL;
  /** the camera's features key, as the last trace dispatched had it (a planet probe's params, written
   *  since, bring their own) */
  private cameraKey = FEATURES_ALL;
  /** the key compiled ahead of the camera's (its surface's or scenery's data asked for, not yet drawn); −1: none */
  private aheadKey = -1;
  /** the tiles' imagery last seen (EarthTiles.imagery) and when [ms]: a still view redrawn for it */
  private imagerySeen = 0;
  private imageryAt = 0;
  /** the regional surface or the scenery is in, its kernel still compiling: not drawn yet (the settled frame waits) */
  private earthHeld = false;
  private variants = new Map<
    number,
    {
      rt: GPUComputePipeline | null;
      q: GPUComputePipeline | null;
      env: GPUComputePipeline | null;
      lut: GPUComputePipeline | null;
      lutq: GPUComputePipeline | null;
      /** the aerial perspective's table's pass (trace.wgsl aerial) */
      air: GPUComputePipeline | null;
      /** the raster's primary visibility, its pixels shaded one a pixel (trace.wgsl shade; a key with the raster's bit) */
      shade: GPUComputePipeline | null;
      /** the pixels its shading rate leaves this frame marked for resolve (trace.wgsl shadeMark) */
      shadeMark: GPUComputePipeline | null;
      /** the raster's ground at every pixel, every frame (trace.wgsl shadeLite — TERRE-UNREAL U1) */
      shadeLite: GPUComputePipeline | null;
      /** the raster's water, split from shadeLite (trace.wgsl shadeWater — TERRE-UNREAL U2d) */
      shadeWater: GPUComputePipeline | null;
      /** the catalogue's stars over the raster's sky (trace.wgsl shadeStars — TERRE-UNREAL U8) */
      shadeStars: GPUComputePipeline | null;
      /** the sky's discs' own kernel (trace.wgsl main, DISC_ONLY — TERRE-UNREAL U9) */
      discs: GPUComputePipeline | null;
      /** the cloud pass (trace.wgsl clouds) */
      clouds: GPUComputePipeline | null;
      /** the image while main compiles: the air beside the raster's ground (trace.wgsl skyFill) */
      skyFill: GPUComputePipeline | null;
      /** a still view asked for the quality cascade (q, lutq) */
      qWanted: boolean;
      /** a cascade under way (realtime: rt, env, lut; quality: q, lutq) — stopped, its queued compiles
       *  skipped, when the camera leaves the key; started again for what is missing when it comes back */
      busy: boolean;
      qBusy: boolean;
      /** a compile failed (not merely skipped): not tried again */
      failed: boolean;
      qFailed: boolean;
      /** the realtime kernel's compile failed or hung: the general one draws — what the timings measure */
      rtGivenUp: boolean;
    }
  >();

  /** The features the kernel must keep for these settings (trace.wgsl: HAS_*). */
  private featuresOf(s: Settings) {
    return (
      (BANDS[s.band] ? 1 : 0) |
      (s.polarization && !s.wormhole ? 2 : 0) |
      (s.jet ? 4 : 0) |
      (s.hotSpot ? 8 : 0) |
      (s.hotFlow ? 16 : 0) |
      (s.wormhole ? 32 : 0) |
      (s.diskThickness > 0 ? 64 : 0)
    ); // (bodies: 128, added with them; runways near: 256; the hole's metrics: 512, unless from afar — O13;
    // the weather near the camera: 1024, set with its params — fair, out of the kernel; a body's shadow on
    // another: 2048, with its params)
  }

  /**
   * The tracer for the scene's features: a pipeline with the unused ones compiled out (built in the
   * background the first time — ~10 s —, the general one drawing meanwhile). The first image waits for
   * the start's own (the general kernel is several times its compile on D3D12, where every function is
   * inlined): the general one is compiled after it, and until it lands a scene whose kernel is still
   * compiling is drawn by an earlier scene's covering its features, else not drawn (null).
   */
  private traceVariant(
    kind:
      | "rt"
      | "q"
      | "env"
      | "lut"
      | "lutq"
      | "air"
      | "shade"
      | "shadeMark"
      | "shadeLite"
      | "shadeWater"
      | "shadeStars"
      | "discs"
      | "clouds"
      | "skyFill",
    key = this.featureKey,
    create = true,
  ): GPUComputePipeline | null {
    const general = {
      rt: this.tracePipeline,
      q: this.qualityPipeline,
      env: this.envPipeline,
      lut: this.lutPipeline,
      lutq: this.lutQPipeline,
      air: null,
      shade: null,
      shadeMark: null,
      shadeLite: null,
      shadeWater: null,
      shadeStars: null,
      discs: null,
      clouds: null,
      skyFill: null,
    }[kind];
    if (key === FEATURES_ALL) {
      void this.generalCompile.start();
      return general;
    }
    let v = this.variants.get(key);
    if (v) {
      this.variants.delete(key);
      this.variants.set(key, v);
    } else {
      // (a planet probe's key: drawn by what there is — its own kernel would be compiled before the
      // camera's, for a light probe)
      if (!create) return general ?? this.coveringVariant(key, kind);
      v = {
        rt: null,
        q: null,
        env: null,
        lut: null,
        lutq: null,
        air: null,
        shade: null,
        shadeMark: null,
        shadeLite: null,
        shadeWater: null,
        shadeStars: null,
        discs: null,
        clouds: null,
        skyFill: null,
        qWanted: false,
        busy: false,
        qBusy: false,
        failed: false,
        qFailed: false,
        rtGivenUp: false,
      };
      this.variants.set(key, v);
      this.evictVariants();
    }
    const lutOk = (key & LUT_BLOCKERS) === 0;
    const airOk = (key & 128) !== 0 && this.aerialOK;
    const shadeOk = (key & FEATURE_TERRAIN_RASTER) !== 0;
    if (
      create &&
      !v.busy &&
      !v.failed &&
      (!v.rt ||
        !v.env ||
        (lutOk && !v.lut) ||
        (airOk && !v.air) ||
        (shadeOk &&
          ((this.shadeWanted && !v.shade) ||
            !v.shadeMark ||
            (this.rasterLite && (!v.shadeLite || !v.shadeWater)) ||
            (this.cloudPass && !v.clouds))))
    )
      this.realtimeCascade(key, v);
    if (kind === "q" || kind === "lutq") v.qWanted = true;
    if (create && v.qWanted && !v.qBusy && !v.qFailed && (!v.q || (lutOk && !v.lutq))) this.qualityCascade(key, v);
    return v[kind] ?? general ?? this.coveringVariant(key, kind) ?? this.rasterStandIn(key, kind);
  }

  /**
   * The raster's shading while a new key's compiles (no general one to cover it): the nearest key's that has it — the most
   * features in common, the latest used among equals —, the features it lacks (the buildings' bit switching on in flight,
   * the scenery's 8192) not drawn until the key's own lands. Without it the raster was given up for the compile — a minute
   * and more on an M1 —, the near Earth traced in blocks of 6 to 8 pixels: sharp in flight until the buildings came, then a
   * mush. The shading and its marks taken from the same key.
   */
  private rasterStandIn(key: number, kind: string): GPUComputePipeline | null {
    if (
      kind !== "shade" &&
      kind !== "shadeMark" &&
      kind !== "shadeLite" &&
      kind !== "shadeWater" &&
      kind !== "shadeStars" &&
      kind !== "discs" &&
      kind !== "clouds"
    )
      return null;
    let best: GPUComputePipeline | null = null;
    let bestN = -1;
    for (const [k, v] of this.variants) {
      if (k >>> 16 !== key >>> 16 || (k & FEATURE_TERRAIN_RASTER) === 0 || !v.shade || !v.shadeMark || !v[kind]) continue;
      let n = 0;
      for (let b = k & key & 0xffff; b; b &= b - 1) n++;
      // (later in the map: used more lately — ties go to it)
      if (n >= bestN) {
        bestN = n;
        best = v[kind];
      }
    }
    return best;
  }

  /** whether a key's queued compile is still wanted: its slot kept, the device there, the camera on it —
   *  a scene left, its remaining compiles (minutes each on a slow D3D12 driver) no longer hold the new
   *  scene's back */
  private wanted(key: number, slot: unknown) {
    return () =>
      this.variants.get(key) === slot && !this.lost && (key === this.cameraKey || key === this.aheadKey || this.prewarmKeys.has(key));
  }

  /** a key's realtime kernel is there — its own, an earlier scene's covering it, or the general one (every
   *  feature in: it draws the scene while the specialised compiles, as before the bits were held) —, or never will
   *  be (its compile failed or hung). Waiting for the specialised kernel itself held the scenery back for minutes
   *  on a cold shader cache (32 s for its main entry, 23 s for its probe, queued behind others) */
  /** a raster key's shading kernels are there too (its own or a covering key's), or never will be: the surface's and the
   *  scenery's bits switched on before them gave the raster up for their compile — a minute and more on an M1, the near
   *  Earth traced in blocks meanwhile: sharp in flight until the buildings came, then a mush */
  private rasterReady(key: number) {
    if ((key & FEATURE_TERRAIN_RASTER) === 0) return true;
    const v = this.variants.get(key);
    if (v?.failed) return true;
    const has = (kind: "shade" | "shadeMark" | "shadeLite" | "shadeWater") => !!v?.[kind] || !!this.coveringVariant(key, kind);
    // (the material's kernels — shade, the leftovers', may come after: its pixels traced meanwhile)
    if (this.rasterLite) return has("shadeLite") && has("shadeWater");
    return has("shade") && has("shadeMark");
  }
  private kernelReady(key: number) {
    if (key === FEATURES_ALL || this.tracePipeline) return true;
    const v = this.variants.get(key);
    return !!v?.rt || !!v?.failed || !!v?.rtGivenUp || !!this.coveringVariant(key, "rt");
  }

  /** the realtime kernel first, then its probe — then the general kernel, the later scenes' fallback —,
   *  and its LUT once the first image is on screen; the quality cascade only when a still view asks for
   *  it — five specialised compiles of a 6 362-line kernel are tens of seconds of GPU process, not spent
   *  while the player flies (plan §2.2-F). What is already there is not compiled again. */
  private realtimeCascade(key: number, slot: NonNullable<ReturnType<Renderer["variants"]["get"]>>) {
    slot.busy = true;
    const current = this.wanted(key, slot);
    // (the image's own kernels — the trace's, the raster's shading, its clouds, the probe — urgent: ahead of a quality kernel
    // a pause queued; the LUT and the aerial table after them, as queued)
    const compile = (
      entry:
        | "main"
        | "env"
        | "lut"
        | "aerial"
        | "shade"
        | "shadeMark"
        | "shadeLite"
        | "shadeWater"
        | "shadeStars"
        | "discs"
        | "clouds"
        | "skyFill",
      onStall?: () => void,
    ) =>
      this.variantQueue.run(
        current,
        () => this.timedVariant(key, entry),
        onStall,
        // (a key compiled ahead — the scenery's, the surfaces' coming — not urgent until it is the frame's: the frame's own
        // raster kernels went after its tracer, 102 s on an M1 Max, the near Earth traced meanwhile)
        () => entry !== "lut" && entry !== "aerial" && key === this.featureKey,
        // (the frame's own compiles pass a running one that is not — the title's probe, a LUT, a key compiled ahead — in a
        // second slot)
        true,
      );
    const R = (key & FEATURE_TERRAIN_RASTER) !== 0;
    // (the raster's kernels the image needs — the material, its water, the marks, the stars, the clouds: seconds each)
    const rasterEarly = async () => {
      if (!R) return;
      if (this.rasterLite) {
        if (!slot.shadeLite) slot.shadeLite = await compile("shadeLite");
        if (!slot.shadeWater) slot.shadeWater = await compile("shadeWater");
        if (!slot.shadeMark) slot.shadeMark = await compile("shadeMark");
        if (!slot.shadeStars) slot.shadeStars = await compile("shadeStars");
      } else {
        if (!slot.shade) slot.shade = await compile("shade");
        if (!slot.shadeMark) slot.shadeMark = await compile("shadeMark");
      }
      if (!slot.clouds && this.cloudPass) slot.clouds = await compile("clouds");
    };
    // (… and those it can wait for: the leftovers' — shade, a third of the tracer, its pixels traced meanwhile
    // (RASTER_SHADE_LATE) — and the discs' own kernel — main draws them meanwhile)
    const rasterLate = async () => {
      if (!R || !this.rasterLite) return;
      if (!slot.shade && this.shadeWanted) slot.shade = await compile("shade");
      if (!slot.discs && this.discsKernel) slot.discs = await compile("discs");
    };
    const run = async () => {
      // (the raster's first kernels before the tracer only when something already draws this key's trace — the general
      // kernel, or another key's covering it: the near Earth, the scene's look, comes first then. Otherwise the trace's own
      // kernel first: nothing draws the scene before it — another key's tracer that does not cover this one does not)
      const rasterFirst = R && (!!this.tracePipeline || !!this.coveringVariant(key, "rt"));
      if (rasterFirst) await rasterEarly();
      // (nothing to draw it until main — two minutes on a Windows PC, its driver's compile and DXC's, at every launch: the
      // browser's cache does not keep it there —: the material and the waiting sky first, seconds, an image meanwhile)
      else if (R && this.rasterLite && this.skyFillOn) {
        if (!slot.shadeLite) slot.shadeLite = await compile("shadeLite");
        if (!slot.skyFill) slot.skyFill = await compile("skyFill");
      }
      if (!slot.rt) {
        slot.rt = await compile("main", () => (slot.rtGivenUp = true));
        if (!slot.rt) return;
      }
      // (the raster's primary visibility: its kernels right after the image's — the trace leaves the patch's pixels to them)
      if (!rasterFirst) await rasterEarly();
      if (!slot.env) {
        slot.env = await compile("env");
        if (!slot.env) return;
      }
      await rasterLate();
      this.startGeneralWhenIdle();
      await this.firstImage;
      await this.backgroundFree();
      if (!slot.lut && (key & LUT_BLOCKERS) === 0) slot.lut = await compile("lut");
      // (the aerial perspective's table: a world near the camera — its bodies' bit)
      if (!slot.air && (key & 128) !== 0 && this.aerialOK) slot.air = await compile("aerial");
    };
    void run().then(
      () => (slot.busy = false),
      (e) => {
        slot.busy = false;
        slot.failed = true;
        slot.rtGivenUp ||= !slot.rt;
        console.warn("Specialised tracer unavailable:", e);
        void this.generalCompile.start();
      },
    );
  }

  /** the general kernel wanted (the later scenes' fallback), its start held while the frame's own compiles run */
  private generalWanted = false;
  /**
   * The general kernel — every feature, the slowest compile of all on D3D12 (115 s on kerr-mini, minutes on Windows) — started
   * once no compile of the frame's own is waiting or running, and not while the title holds the game: two compiles of this size
   * side by side slowed the scene's own (docs/PLAN-LEAN-TRACER-KERNELS.md P1). The queue's idle hook retries.
   */
  private startGeneralWhenIdle() {
    // (on demand only — P8: the scene's own kernels are what draws it; the general one — every feature, the slowest compile
    // of all — no longer compiled at every start: a scene's failure, the general key asked, an explicit start still compile it)
    if (this.generalOnDemand) return;
    this.generalWanted = true;
    this.maybeStartGeneral();
  }
  /**
   * The general kernel family (every feature: main, env, its quality kernel, its LUTs) compiled only when asked (P8): the
   * fallback of a scene whose own kernels fail, the FEATURES_ALL key, an explicit start (tests, the bench). Before, it was
   * compiled after every start — 5 min of DXC on a Windows PC, in the background of the flight — to draw later scenes while
   * theirs compiled; their own kernels are now a fraction of it. False: as before.
   */
  generalOnDemand = true;
  private maybeStartGeneral() {
    if (!this.generalWanted || this.generalCompile.state !== "idle" || this.lost) return;
    if (this.backgroundHold || this.variantQueue.urgentPending) return;
    void this.generalCompile.start();
  }
  /**
   * Background compiles held (main.ts: while the title screen holds the game): the general kernel, a key's LUT and aerial
   * table wait — the launch that follows compiles its own scene, which they would slow.
   */
  get backgroundHold() {
    return this.bgHold;
  }
  set backgroundHold(on: boolean) {
    if (on === this.bgHold) return;
    this.bgHold = on;
    if (!on) {
      for (const f of this.bgWaiters.splice(0)) f();
      this.maybeStartGeneral();
    }
  }
  private bgHold = false;
  private bgWaiters: (() => void)[] = [];
  private backgroundFree(): Promise<void> {
    return this.bgHold ? new Promise<void>((r) => this.bgWaiters.push(r)) : Promise.resolve();
  }

  private qualityCascade(key: number, slot: NonNullable<ReturnType<Renderer["variants"]["get"]>>) {
    slot.qBusy = true;
    const current = this.wanted(key, slot);
    const compile = (entry: "main" | "lut") => this.variantQueue.run(current, () => this.timedVariant(key, entry, true));
    const run = async () => {
      if (!slot.q) {
        slot.q = await compile("main");
        if (!slot.q) return;
      }
      if (!slot.lutq && (key & LUT_BLOCKERS) === 0) slot.lutq = await compile("lut");
    };
    void run().then(
      () => (slot.qBusy = false),
      (e) => {
        slot.qBusy = false;
        slot.qFailed = true;
        console.warn("Specialised tracer unavailable:", e);
      },
    );
  }

  /** An earlier scene's kernel with every feature of this key compiled in (the general one is the widest
   *  of them): it draws this scene as it would — the extra features are switched off by the params. */
  private coveringVariant(
    key: number,
    kind:
      | "rt"
      | "q"
      | "env"
      | "lut"
      | "lutq"
      | "air"
      | "shade"
      | "shadeMark"
      | "shadeLite"
      | "shadeWater"
      | "shadeStars"
      | "discs"
      | "clouds"
      | "skyFill",
  ): GPUComputePipeline | null {
    // (the same debug views and tuning — the bits from 16 on are ids, not features: none other's constants; the near body's
    // kind — P7 — only in the camera's kernels: elsewhere — a planet's probe, its key without it, on the camera's env —
    // left out of the comparison, and there a kernel for any near body covers a given one)
    const NEAR = 7 << NEAR_KIND_SHIFT;
    const nearMatters = kind === "rt" || kind === "q" || kind === "discs";
    const kq = key & ~NEAR;
    const nq = (key >> NEAR_KIND_SHIFT) & 7;
    for (const [k, v] of this.variants) {
      if (!v[kind]) continue;
      const kk = k & ~NEAR;
      if ((kk & kq) !== kq || kk >>> 16 !== kq >>> 16) continue;
      const nk = (k >> NEAR_KIND_SHIFT) & 7;
      if (nearMatters && nk !== nq && nk !== 0) continue;
      return v[kind];
    }
    return null;
  }

  /** mkVariant, its key and compile time in the diagnostic — every one, not only those the first image
   *  waits for: a scene's feature bit switching on in flight (the scenery's 8192) recompiles for seconds (R-M4) */
  private async timedVariant(
    key: number,
    entry:
      | "main"
      | "env"
      | "lut"
      | "aerial"
      | "shade"
      | "shadeMark"
      | "shadeLite"
      | "shadeWater"
      | "shadeStars"
      | "discs"
      | "clouds"
      | "skyFill",
    quality = false,
  ) {
    const t0 = performance.now();
    const label = this.compileLabel(key, entry, quality);
    this.compiling.add(label);
    if (entry === "main" && !quality) this.mainStartedAt.set(key, t0);
    let p: GPUComputePipeline;
    try {
      try {
        p = await this.mkVariant(key, entry, quality);
      } catch (e) {
        // (the specialised source rejected — a pruning the compiler disagrees with —: the pipeline from the whole module, as
        // before, and the diagnostic told: an image rather than none)
        if (!this.sourceSpecialise || this.lost) throw e;
        gpuDiagnostics.record(
          "optional-pipeline-failure",
          `specialised tracer ${entry}, features ${key}: ${String((e as Error)?.message ?? e)}`,
        );
        console.warn("Specialised tracer source rejected, the whole module used:", e);
        p = await this.mkVariant(key, entry, quality, false);
      }
    } catch (e) {
      this.noteCompile(`${entry}${quality ? " (quality)" : ""}`, key, t0, false);
      throw e;
    } finally {
      this.compiling.delete(label);
    }
    this.noteCompile(`${entry}${quality ? " (quality)" : ""}`, key, t0, true);
    // (the pace: a large kernel's cold compile — not one out of the browser's cache —, by its source's size)
    const took = (performance.now() - t0) / 1000;
    const kb = this.codeKB.get(`${key}:${entry}:${quality ? 1 : 0}`);
    if ((entry === "main" || entry === "env") && kb && took > 5) {
      this.pace.s += took;
      this.pace.kb += kb;
    }
    const s = took.toFixed(1);
    gpuDiagnostics.record(
      "pipeline-compiled",
      `tracer ${entry}${quality ? " (quality)" : ""}, features ${key}: ${s} s${this.firstFrameDoneAt ? "" : ", before the first image"}`,
    );
    if (!this.firstFrameDoneAt && entry === "main" && !quality) gpuDiagnostics.enter("first-frame");
    return p;
  }

  /** A specialised pipeline of the tracer for a features key (the unused ones compiled out). */
  private mkVariant(
    key: number,
    entryPoint:
      | "main"
      | "env"
      | "lut"
      | "aerial"
      | "shade"
      | "shadeMark"
      | "shadeLite"
      | "shadeWater"
      | "shadeStars"
      | "discs"
      | "clouds"
      | "skyFill",
    quality: boolean,
    specialised = this.sourceSpecialise,
  ): Promise<GPUComputePipeline> {
    const constants = tracerConstants(key, entryPoint, {
      quality,
      rasterHint: this.rasterHint,
      tune: this.tunes.get((key >> 20) & 63),
      companion: this.leanMain,
      coarseProbe: this.coarseProbe,
      leftovers: this.rasterLite && this.leanShade,
      otherUniverse: !this.otherUniverseOut,
    });
    const ep = tracerEntryPoint(entryPoint);
    // (the same pipeline asked again — another key whose constants are the same: the Earth-raster profile's keys, the
    // scenery's and the surface's bits coming and going —: the one compiled, not a second compile)
    const memoKey = `${entryPoint}|${quality ? 1 : 0}|${specialised ? 1 : 0}|${JSON.stringify(constants)}`;
    const hit = this.pipelineMemo.get(memoKey);
    if (hit) {
      this.pipelineMemo.delete(memoKey);
      this.pipelineMemo.set(memoKey, hit);
      return hit;
    }
    const made = this.device.createComputePipelineAsync({
      layout:
        entryPoint === "clouds"
          ? this.cloudsLayout!
          : entryPoint === "main" ||
              entryPoint === "shade" ||
              entryPoint === "shadeMark" ||
              entryPoint === "shadeLite" ||
              entryPoint === "shadeWater" ||
              entryPoint === "shadeStars" ||
              entryPoint === "skyFill" ||
              entryPoint === "discs"
            ? this.mainLayout
            : entryPoint === "lut"
              ? this.lutLayout
              : entryPoint === "aerial"
                ? this.aerialLayout
                : this.tracePipeLayout,
      compute: {
        module: specialised ? this.specialisedModule(constants, ep, `${key}:${entryPoint}:${quality ? 1 : 0}`) : this.traceModule,
        // (the sky's discs: main's own, its sky's layer and its ground compiled out — DISC_ONLY)
        entryPoint: ep,
        constants,
      },
    });
    this.pipelineMemo.set(memoKey, made);
    if (this.pipelineMemo.size > 64) this.pipelineMemo.delete(this.pipelineMemo.keys().next().value!);
    made.catch(() => this.pipelineMemo.delete(memoKey));
    return made;
  }
  /** the tracer's specialised pipelines by what defines them (entry, quality, source, constants), most recent last */
  private pipelineMemo = new Map<string, Promise<GPUComputePipeline>>();
  /** the Earth-raster profile on (FEATURE_RASTER_PRIMARY): off, every bit of the key its own compile, as before */
  stableProfiles = true;
  /** the profile's traced kernels lean — the near ground's sub-pixel detail out (NEAR_DETAIL), the raster drawing it (P4);
   *  false: the whole near ground in them, as before */
  leanMain = true;
  /** the light probe coarse — the near ground's sub-pixel detail out of env, whatever the scene (P5); false: as before */
  coarseProbe = true;
  /** the Earth-raster profile's kernels without the other universe's code — the wormhole, Gargantua's metric and disk: from
   *  the Earth's low flight never a pixel; a fifth of main, a quarter of env (docs/PLAN-LEAN-TRACER-KERNELS.md, after P10);
   *  false: kept, as before */
  otherUniverseOut = true;
  /** the raster's leftovers' kernel (shade, the material on) without the relief's procedural detail (GROUND_DETAIL — its
   *  heights the terrain cache's, which has it): half its size; false: kept, as before */
  leanShade = true;
  /** the sky's discs in their own kernel (main compiled with DISC_ONLY — TERRE-UNREAL U9); false: in main's layers z ≥ 1, one
   *  compile less (docs/PLAN-LEAN-TRACER-KERNELS.md P6) */
  discsKernel = true;
  /** the near body's kind in the key (NEAR_KIND — P7): false, every near path in the camera's kernels, as before */
  nearKinds = true;
  /**
   * While the scene's tracer compiles, the raster's ground and a waiting sky (trace.wgsl skyFill: the clear air, the day
   * map's far Earth) draw the image — their kernels compiled first, seconds. On a Windows PC main is two minutes of the
   * driver's compile and DXC's at every launch (the browser's cache does not keep it there): the Earth's first image waited
   * for it. False: no image before main, as before.
   */
  skyFillOn = true;
  /** this frame drawn by the waiting sky (main still compiling) */
  skyWaiting = false;
  /**
   * The leftovers' kernel (shade) wanted: without the material (rasterLite off) it draws the whole ground; with it, only
   * the pixels the material does not take — the scenery's: a tree against the sky, a box's margin. No scenery in, no
   * leftovers: not compiled (a third of the tracer — 50 s of DXC — for no pixel); compiled when the scenery comes
   * (docs/PLAN-LEAN-TRACER-KERNELS.md P6).
   */
  private get shadeWanted() {
    return !this.rasterLite || this.earthScenery.active;
  }

  /** keys compiled ahead of a launch (prewarm): their queued compiles wanted though the camera is elsewhere */
  private prewarmKeys = new Set<number>();
  /**
   * The likely next scene's kernels compiled ahead — the title open, the player choosing —: the Earth's low flight in the
   * raster (its profile: the scene's own features, the hole's metric when the universe has a wormhole, the bodies, the
   * raster's bits), its tracer, its probe and the raster's first kernels, as a launch would ask them. Not urgent: a launch
   * that wants another key passes them (CompileQueue's second slot); dropped (prewarmStop) once the title closes. The
   * browser keeps what lands in its shader cache: the next sessions find it too (docs/PLAN-LEAN-TRACER-KERNELS.md P3).
   */
  prewarmEarthFlight(s: Settings) {
    if (!this.stableProfiles || !this.rasterHint || s.earthPipeline !== "raster" || this.lost) return;
    const key =
      this.featuresOf(s) |
      (s.wormhole ? 512 : 0) |
      128 |
      FEATURE_TERRAIN_RASTER |
      FEATURE_RASTER_PRIMARY |
      ((this.costViewMode & 15) << 16);
    if (this.variants.get(key)?.rt) return;
    this.prewarmKeys.add(key);
    this.traceVariant("rt", key);
  }
  /** the compiles queued ahead of a launch dropped (the one running finishes: a compile cannot be cancelled) */
  prewarmStop() {
    this.prewarmKeys.clear();
  }

  /**
   * Each specialised pipeline from a module of its own, specialised as source: its constant-false branches and the functions
   * only they reached removed before the module is made (src/system/wgsl-specialise.ts — docs/PLAN-LEAN-TRACER-KERNELS.md
   * P1b). Tint keeps dead code in what it hands the driver's compiler, and DXC paid for it as for live code: key 516's main,
   * 41 s of DXC, 1.6 s specialised, the same DXIL. Off (false): every pipeline from the one module, as before.
   */
  sourceSpecialise = (globalThis as { __kernelSpecialise?: boolean }).__kernelSpecialise !== false;
  private specialiser: WgslSpecialiser | null = null;
  /** the specialised modules by their source (the same text, the same module: two keys whose constants prune alike share
   *  it — and the browser's shader cache keys on it, across sessions) */
  private specialisedModules = new Map<string, GPUShaderModule>();
  private specialisedModule(constants: Record<string, number>, entryPoint: string, id?: string): GPUShaderModule {
    this.specialiser ??= new WgslSpecialiser(this.traceSource);
    const code = this.specialiser.specialise(constants, entryPoint);
    if (id) this.codeKB.set(id, code.length / 1024);
    let m = this.specialisedModules.get(code);
    if (m) {
      // (most recently used last: the oldest dropped first)
      this.specialisedModules.delete(code);
    } else {
      m = this.device.createShaderModule({ code, label: `trace ${entryPoint} (specialised)` });
      if (this.specialisedModules.size >= 32) this.specialisedModules.delete(this.specialisedModules.keys().next().value!);
    }
    this.specialisedModules.set(code, m);
    return m;
  }

  /** At most four keys (LRU): the current one, the one compiled ahead and those the game goes back and forth
   *  between — the surface's and the scenery's bits come and go in play (the scenery cleared every 8 km, the
   *  surface's pages, the weather, the runways): two kept made each change a compile of seconds again. Each
   *  key is up to five specialised compiles — and the browser's shader disk cache has a budget (plan §2.2-F). */
  private evictVariants() {
    const keys = [...this.variants.keys()];
    for (const k of keys.slice(0, Math.max(0, keys.length - this.variantCacheMax))) this.variants.delete(k);
  }
  /** how many keys' variants are kept (four in play; a measuring bench that goes back and forth between many tunings keeps
   *  them all: each compiled once — tests/e2e/raster-shade-ablation.e2e.test.ts) */
  variantCacheMax = 4;

  /**
   * The cockpit's mask (mask.wgsl), before a realtime frame's trace: the tiles the flown craft's own opaque parts
   * covered last frame — the cabin, the panel, the frame —, a margin round them, marked not to be traced. Only from
   * the cockpit, the own mask drawn the frame before, with the head where it was then (the cabin holds still on the
   * image: it turns with the camera) — the free look, the lens, the eye on the craft the same; the flight's shake
   * (its line of sight turned, its up rolled) within SHAKE_PX of it, in the margin —, no depth of field; else, once,
   * the marks cleared. The margin: the reconstruction's reach (two blocks), 6 px, the shake's, the motion blur's
   * reach (40 px) when it is on. The shake weighed where a turn moves the image most: at its corners (sec² of their
   * angle off the axis — 1.8× the centre's at 60°). Not traced: −1; the own mask there but the rays traced (the look,
   * the shake past its margin): −2, the cabin still left out of the light meter — its exposure the same either way.
   * Off under the cost view (its heat maps and costStats read every pixel).
   */
  private encodeCockpitMask(enc: GPUCommandEncoder, t: Target, s: Settings, block: number) {
    if (!this.maskPipeline || !this.maskCellPipeline || t !== this.live) return;
    const own =
      this.cockpitMask && !this.costViewMode && s.ship && this.ship.ready && this.ownMaskStamp === this.frameStamp - 1 && !this.dofOn(s, t)
        ? this.ship.ownMaskOf(t.hdr)
        : null;
    let on = false;
    if (own && own.pose.length === 12) {
      const now = ownPose([s.shipLookYaw, s.shipLookPitch], s.fov, this.shipPose ?? (s.shipMount as Mount));
      const p = own.pose;
      const same = (i: number) => Math.abs(p[i]! - now[i]!) < 1e-3;
      // (the shake: the line of sight's and the up's turns, against the pixel's angle)
      const turn = (i: number) => Math.hypot(p[i]! - now[i]!, p[i + 1]! - now[i + 1]!, p[i + 2]! - now[i + 2]!);
      const tanH = Math.tan((s.fov * Math.PI) / 360);
      const pixelAngle = (2 * tanH) / t.height;
      // (a turn δ moves a pixel at an angle θ off the axis by δ sec²θ: the corners')
      const sec2 = 1 + tanH * tanH * (1 + (t.width / t.height) ** 2);
      // (not the telescope's view: the instrument's, the cabin's parts magnified past recognition — the canopy's bow, the
      // HUD's combiner, near clear — its cells left untraced kept the sky behind them stale, an old crescent in the eclipse)
      on =
        !s.telescope &&
        [0, 1, 2, 3, 4, 5].every(same) &&
        turn(6) * sec2 + turn(9) * 0.5 * Math.hypot(t.width, t.height) * pixelAngle < SHAKE_PX * pixelAngle;
    }
    // (1: not traced; 2: traced, the cabin only left out of the meter; 0: cleared once)
    const mode = on ? 1 : own && own.pose.length === 12 ? 2 : 0;
    if (!mode && !this.maskSet.get(t)) return;
    this.maskSet.set(t, mode !== 0);
    const r = own?.rect ?? [0, 0, 0, 0];
    const margin = 2 * block + 6 + SHAKE_PX + (s.motionBlur > 0 ? 40 : 0);
    const u = new ArrayBuffer(32);
    // (the same margin either way: the meter leaves out the same points whether the rays there are traced or not)
    new Uint32Array(u, 0, 4).set([t.width, t.height, mode, margin]);
    new Int32Array(u, 16, 4).set(r);
    this.device.queue.writeBuffer(this.maskBuf, 0, u);
    // (the cells, 8 × 8 px each: the target's own buffer)
    const cw = Math.ceil(t.width / 8),
      ch = Math.ceil(t.height / 8);
    let cells = this.maskCells.get(t);
    if (!cells || cells.size < cw * ch * 4) {
      cells?.destroy();
      cells = this.device.createBuffer({ size: Math.max(cw * ch * 4, 16), usage: GPUBufferUsage.STORAGE, label: "cockpit mask cells" });
      this.maskCells.set(t, cells);
    }
    const pass = enc.beginComputePass(this.prof.pass("cockpit mask"));
    if (mode) {
      pass.setPipeline(this.maskCellPipeline);
      pass.setBindGroup(
        0,
        this.device.createBindGroup({
          layout: this.maskCellPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: (own?.tex ?? this.ship.ownMaskDummy()).createView() },
            { binding: 2, resource: { buffer: this.maskBuf } },
            { binding: 3, resource: { buffer: cells } },
          ],
        }),
      );
      pass.dispatchWorkgroups(cw, ch);
    }
    pass.setPipeline(this.maskPipeline);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.maskPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: t.moments } },
          { binding: 2, resource: { buffer: this.maskBuf } },
          { binding: 3, resource: { buffer: cells } },
        ],
      }),
    );
    pass.dispatchWorkgroups(Math.ceil(t.width / 16), Math.ceil(t.height / 16));
    pass.end();
  }

  /** the trace's passes encoded; false: no kernel for the scene yet (still compiling) — nothing traced */
  private dispatchTrace(
    enc: GPUCommandEncoder,
    t: Target,
    x: number,
    y: number,
    quality: boolean,
    s?: Settings,
    timed?: (ms: number) => void,
  ): boolean {
    this.cameraKey = this.featureKey;
    // (the sea's FFT waves of this frame first: the tracer samples them)
    if (this.seaFftDue && this.seaFft) {
      this.seaFft.encode(enc, this.seaFftT, this.seaLambda, this.prof.pass("sea fft"), this.seaFoamJ);
      this.seaFftDue = false;
    }
    // (the far field's LUT first: every realtime frame, once an epoch while a still view refines —
    // skipped while its pipeline is still compiling in the background, the epoch left unmarked so
    // the next frame tries again)
    if (this.lutOn && t.lut && (!quality || this.lutEpoch !== this.epoch)) {
      const lut = this.traceVariant(quality ? "lutq" : "lut");
      if (lut) {
        this.lutEpoch = quality ? this.epoch : -1;
        const lp = enc.beginComputePass(this.prof.pass("far-field LUT"));
        lp.setPipeline(lut);
        lp.setBindGroup(0, t.traceBind);
        lp.setBindGroup(1, t.lut.write);
        lp.dispatchWorkgroups(Math.ceil(t.lut.w / 8), Math.ceil(t.lut.h / 8));
        lp.end();
      }
    }
    // A bounded surface level, prepared before the rays; all atmosphere/optics remain in their existing path.
    // Wait for the specialised kernel: the general fallback draws the reference surface.
    const pipeline = this.traceVariant(quality ? "q" : "rt");
    // (the scene's tracer still compiling: the raster's ground and the waiting sky — trace.wgsl skyFill — draw the image)
    const waiting = !pipeline && !quality && this.skyFillOn && this.rasterLite ? this.traceVariant("skyFill") : null;
    if (!quality && this.terrainCacheWanted && (pipeline ? pipeline !== this.tracePipeline : !!waiting)) {
      this.terrainSurfaceCache ??= TerrainCache.create(this.device, this.traceSource);
      this.terrainSurfaceCache.setSources({
        params: this.paramBuf,
        table: this.bodyBuf,
        elevation: this.earthMaps.elev,
        tiles: this.earthTiles.texture,
        sampler: this.sampler,
      });
      const near = this.lastNear;
      const geo = near ? patchGeodetic(near, WGS84_F) : null;
      const at = geo && geo.h * WGS84_A < 100_000 ? geo : null;
      const changed = this.terrainSurfaceCache.encode(
        enc,
        at,
        `${this.earthTiles.stamp}:${this.earthMaps.tier}`,
        () => this.prof.pass("terrain surface cache"),
        this.terrainRasterRequested ? this.terrainRasterLevel : -1,
      );
      // (realtime: nothing rejected — a bake is the same ground, its window moved or its heights refined by new tiles, and
      // the temporal pass's clamp takes the change; rejecting the history there threw it away for the eight frames of the
      // levels' bakes at every tile landing — on an M1 at one pixel shaded in 64, a blur every second in low flight)
      if (changed && !this.tracingRealtime && this.paramsF[MOUTH_LIST_AT + 7]! > 0.5) {
        // The level affects this submission: reject older samples/history in this very frame.
        this.frameTimes.length = 0;
        this.epoch = this.validFrom = this.frameStamp;
        this.paramsU[17 * 4 + 1] = this.validFrom;
        this.device.queue.writeBuffer(this.paramBuf, 17 * 16, this.paramsU.subarray(17 * 4, 18 * 4));
        if (t.temporal) t.temporal.valid = false;
      }
    }
    // The raster patch's visibility, after the cache it reads and before the rays that start from it.
    this.tsmDrawn = false;
    this.sunDrawn = false;
    if (!quality && s) this.encodeTerrainRasterVisibility(enc, t, s);
    // (the same for the relief's shadow map)
    if (!quality && !this.sunDrawn && this.sunTableOn) {
      this.device.queue.writeBuffer(this.bodyBuf, (TABLE_SUN + 3) * 16, new Float32Array(4));
      this.sunTableOn = false;
    }
    // (no shadow map this frame — the raster off, the traced pipeline —: its frame cleared, not the last one's read)
    if (!quality && !this.tsmDrawn && this.tsmTableOn) {
      this.device.queue.writeBuffer(this.bodyBuf, (TABLE_TSM + 3) * 16, new Float32Array(4));
      this.tsmTableOn = false;
    }
    const hint = !quality && this.rasterHint ? (this.terrainRaster?.distanceTexture() ?? null) : null;
    // (the clouds' shadow map — trace.wgsl cloudShadow — before every kernel that reads it)
    if (!quality) this.encodeCloudShadow(enc, t);
    // (the clear sky's light — trace.wgsl skyAmbient — before every kernel that reads it: the ground's, the clouds')
    this.encodeSkyAmbient(enc, t);
    // (the aerial perspective's table before the rays that read it)
    if (!quality && this.aerialPipe) {
      const ap = enc.beginComputePass(this.prof.pass("aerial perspective"));
      ap.setPipeline(this.aerialPipe);
      ap.setBindGroup(0, t.traceBind);
      ap.setBindGroup(1, this.aerialWrite);
      ap.dispatchWorkgroups(Math.ceil(AERIAL_SIZE[0] / 8), Math.ceil(AERIAL_SIZE[1] / 8));
      ap.end();
    }
    // (the raster's shading kernels compile after the image's — realtimeCascade —: until they are there for this key, its
    // pixels traced as before, not left by the trace to a pass that cannot run — the ground missing for seconds, minutes on
    // a slow D3D12 driver)
    // (with the material — shadeLite — the old per-pixel kernel, shade, is a leftover's: the pixels the material does not take,
    // a tree against the sky, a box's margin. Its compile — a third of the tracer — no longer holds the raster back: until it
    // is in, those pixels are the trace's (RASTER_SHADE_LATE, trace.wgsl main) — docs/PLAN-LEAN-TRACER-KERNELS.md P1)
    let shadeLate = false;
    if (!quality && hint && this.rasterPrimaryOn) {
      const lite = this.rasterLite && !!this.traceVariant("shadeLite");
      const sh = this.traceVariant("shade");
      const ready = !!sh && (this.rasterRate === 1 || !!this.traceVariant("shadeMark"));
      if (!ready && !lite) this.dropRasterPrimary(t);
      shadeLate = !ready && lite;
    }
    // (the ground at every pixel — shadeLite, TERRE-UNREAL U1 —: once its kernel is there, the parameters' bit written for this
    // submission; shade and shadeMark leave it its pixels)
    this.rasterLiteNow = false;
    this.rasterWaterNow = false;
    this.rasterShadeLate = false;
    if (!quality && hint && this.rasterPrimaryOn && this.rasterLite && this.traceVariant("shadeLite")) {
      this.rasterLiteNow = true;
      this.rasterShadeLate = shadeLate;
      // (its water's pass — shadeWater — once its kernel is there: shadeLite leaves it the water's pixels)
      this.rasterWaterNow = !!this.traceVariant("shadeWater");
      this.paramsF[MOUTH_LIST_AT + 5] =
        this.paramsF[MOUTH_LIST_AT + 5]! +
        RASTER_LITE_FLAG +
        (this.rasterWaterNow ? RASTER_WATER_FLAG : 0) +
        (shadeLate ? RASTER_SHADE_LATE_FLAG : 0);
      this.device.queue.writeBuffer(this.paramBuf, (MOUTH_LIST_AT + 4) * 4, this.paramsF.subarray(MOUTH_LIST_AT + 4, MOUTH_LIST_AT + 8));
    }
    // (the cloud pass: the clouds marched once a texel of half the image, before the rays that read them)
    if (!quality && hint && this.rasterPrimaryOn && this.cloudPass && this.cloudPassOn) {
      const cp = this.traceVariant("clouds");
      if (cp && t.cloudWrite) {
        if (t.cloudBind?.tex !== hint)
          t.cloudBind = {
            tex: hint,
            bind: this.device.createBindGroup({ layout: this.traceLayout, entries: this.traceEntries(t, this.ship.envBuf, hint, false) }),
          };
        const c = enc.beginComputePass(this.prof.pass("clouds (half)"));
        c.setPipeline(cp);
        c.setBindGroup(0, t.cloudBind.bind);
        c.setBindGroup(1, t.cloudWrite);
        c.dispatchWorkgroups(Math.ceil(t.width / 16), Math.ceil(t.height / 16));
        c.end();
        this.encodeCloudHistory(enc, t);
        // (drawn: the kernels read it — the parameters' bit written for this submission)
        this.cloudPassDrawn = true;
        this.paramsF[MOUTH_LIST_AT + 5] = this.paramsF[MOUTH_LIST_AT + 5]! + CLOUD_PASS_FLAG;
        this.device.queue.writeBuffer(this.paramBuf, (MOUTH_LIST_AT + 4) * 4, this.paramsF.subarray(MOUTH_LIST_AT + 4, MOUTH_LIST_AT + 8));
      }
    }
    // (the quality kernel still compiling — frame() keeps a still view on the realtime path until then;
    // the scene's realtime kernel still compiling at the start: no image yet — unless the raster's ground and the waiting sky
    // can draw it)
    this.skyWaiting = false;
    if (!pipeline) {
      if (!waiting || !hint || !this.rasterLiteNow) return false;
      this.starsRasterNow = false;
      this.discsDrawn = 0;
      const wp = enc.beginComputePass(this.prof.pass("sky (waiting)"));
      wp.setPipeline(waiting);
      wp.setBindGroup(0, this.hintBindFor(t, hint));
      wp.setBindGroup(1, t.lut ? t.lut.read : this.lutDummy!);
      wp.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
      wp.end();
      this.encodeLite(enc, t, hint);
      this.skyWaiting = true;
      return true;
    }
    const label = quality ? "trace (converging)" : "trace";
    // (the catalogue's stars at their own pixels — trace.wgsl shadeStars, TERRE-UNREAL U8 —: its kernel there, the stars
    // splatted this frame, the matrix given: the parameters' bit — the rays then draw the Milky Way's map alone —, the matrix
    // into the stamps' words after the discs')
    const starsPipe =
      !quality && this.rasterLiteNow && this.starsSplat && this.starMatrix && t === this.live ? this.traceVariant("shadeStars") : null;
    this.starsRasterNow = !!starsPipe;
    if (starsPipe) {
      this.paramsF[MOUTH_LIST_AT + 5] = this.paramsF[MOUTH_LIST_AT + 5]! + RASTER_STARS_FLAG;
      this.device.queue.writeBuffer(this.paramBuf, (MOUTH_LIST_AT + 4) * 4, this.paramsF.subarray(MOUTH_LIST_AT + 4, MOUTH_LIST_AT + 8));
      this.device.queue.writeBuffer(t.stamps, (t.width * t.height + 4 * SKY_DISCS_MAX) * 4, this.starMatrix!);
    }
    // (the sky's bodies' discs at one ray a pixel — trace.wgsl main's layers z ≥ 1, TERRE-UNREAL U8 —: their rectangles in the
    // stamps' words past the image, the dispatch as wide as the widest of them)
    const discs = !quality && this.rasterLiteNow && t === this.live ? this.discRects(t) : [];
    // (their own kernel once in — TERRE-UNREAL U9 —: a pass after the sky's, else main's layers z ≥ 1)
    const discsPipe = discs.length && this.discsKernel ? this.traceVariant("discs") : null;
    const gx = Math.max(1, Math.ceil(x / 8)),
      gy = Math.max(1, Math.ceil(y / 8));
    let dgx = 1,
      dgy = 1;
    // (written each frame, none as zeros: the sky's rays leave the rectangles to the discs' layers)
    if (t === this.live) {
      const words = new Uint32Array(4 * SKY_DISCS_MAX);
      discs.forEach((r, i) => words.set(r, 4 * i));
      this.device.queue.writeBuffer(t.stamps, t.width * t.height * 4, words);
      for (const r of discs) {
        // (a block of 2 × 2 a thread for an interleaved one — trace.wgsl main)
        const st = (r[3] >> 19) & 1 ? 4 : (r[3] >> 18) & 1 ? 2 : 1;
        // (a block more for an interleaved one: its blocks on the image's grid — trace.wgsl main)
        const extra = st > 1 ? st : 0;
        dgx = Math.max(dgx, Math.ceil((r[2] + extra) / st / 8));
        dgy = Math.max(dgy, Math.ceil(((r[3] & 0xffff) + extra) / st / 8));
      }
    }
    this.discsDrawn = discs.length;
    const pass = enc.beginComputePass(timed ? this.prof.timed(label, timed) : this.prof.pass(label));
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, hint ? this.hintBindFor(t, hint) : t.traceBind);
    pass.setBindGroup(1, t.lut ? t.lut.read : this.lutDummy!);
    if (discsPipe) pass.dispatchWorkgroups(gx, gy, 1);
    else pass.dispatchWorkgroups(Math.max(gx, dgx), Math.max(gy, dgy), 1 + discs.length);
    pass.end();
    if (discsPipe) {
      const dp = enc.beginComputePass(this.prof.pass("trace (discs)"));
      dp.setPipeline(discsPipe);
      dp.setBindGroup(0, hint ? this.hintBindFor(t, hint) : t.traceBind);
      dp.setBindGroup(1, t.lut ? t.lut.read : this.lutDummy!);
      dp.dispatchWorkgroups(dgx, dgy, 1 + discs.length);
      dp.end();
    }
    if (starsPipe && hint) {
      const sp = enc.beginComputePass(this.prof.pass("stars (raster)"));
      sp.setPipeline(starsPipe);
      sp.setBindGroup(0, this.hintBindFor(t, hint));
      sp.setBindGroup(1, t.lut ? t.lut.read : this.lutDummy!);
      sp.dispatchWorkgroups(Math.ceil(STARS_MAX / 64));
      sp.end();
    }
    // The raster's primary visibility (docs/PLAN-RENDU-RASTER-AAA.md étape 1): the patch's pixels, left by the trace,
    // shaded one a pixel at the image's full size — after it, before the reconstruction that reads both.
    // (a rate above 1: the frame's pattern alone, its threads packed — and the pixels it leaves marked for resolve)
    const shade = !quality && hint && this.rasterPrimaryOn && !this.rasterShadeLate ? this.traceVariant("shade") : null;
    const mark = shade && this.rasterRate > 1 ? this.traceVariant("shadeMark") : null;
    if (shade && hint && (this.rasterRate === 1 || mark)) {
      // (the frame's pattern's block — trace.wgsl rasterPixel: 2 × 1, 2 × 2, 4 × 2, 4 × 4 —: a thread a block)
      const bw = this.rasterRate >= 8 ? 4 : this.rasterRate > 1 ? 2 : 1;
      const bh = this.rasterRate >= 16 ? 4 : this.rasterRate > 2 ? 2 : 1;
      const sx = Math.ceil(t.width / bw);
      const sy = Math.ceil(t.height / bh);
      // (the material taking every pixel — each one shaded, its buildings their triangles —: the rays' kernel would only
      // return at each, a dispatch of the tracer's size over the whole image for nothing, ~0.6 ms on an M1 — TERRE-UNREAL U6)
      const liteAll = this.rasterLiteNow && this.rasterRate === 1 && (this.sceneryRaster?.meshes3d ?? true) && this.shadeSkip;
      if (!liteAll) {
        const sp = enc.beginComputePass(this.prof.pass("earth shade (raster)"));
        sp.setPipeline(shade);
        sp.setBindGroup(0, this.hintBindFor(t, hint));
        sp.setBindGroup(1, t.lut ? t.lut.read : this.lutDummy!);
        sp.dispatchWorkgroups(Math.ceil(sx / 8), Math.ceil(sy / 8));
        if (mark) {
          sp.setPipeline(mark);
          sp.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
        }
        sp.end();
      }
    }
    // (the material — shadeLite, its water — whether shade, the leftovers' kernel, is there or not: it was inside shade's block,
    // and while shade compiled (RASTER_SHADE_LATE) the ground went undrawn, the image black — kerr-mini, P3)
    if (!quality && hint && this.rasterLiteNow) this.encodeLite(enc, t, hint);
    return true;
  }

  /** the raster's material — shadeLite — and its water's pass, over the patch's pixels */
  private encodeLite(enc: GPUCommandEncoder, t: Target, hint: GPUTexture) {
    const lite = this.traceVariant("shadeLite");
    if (lite) {
      const lp = enc.beginComputePass(this.prof.pass("earth lite (raster)"));
      lp.setPipeline(lite);
      lp.setBindGroup(0, this.hintBindFor(t, hint));
      lp.setBindGroup(1, t.lut ? t.lut.read : this.lutDummy!);
      lp.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
      lp.end();
      const water = this.rasterWaterNow ? this.traceVariant("shadeWater") : null;
      if (water) {
        const wp = enc.beginComputePass(this.prof.pass("earth water (raster)"));
        wp.setPipeline(water);
        wp.setBindGroup(0, this.hintBindFor(t, hint));
        wp.setBindGroup(1, t.lut ? t.lut.read : this.lutDummy!);
        wp.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
        wp.end();
      }
    }
  }

  /**
   * Instrument beam: Gaussian of FWHM beamUas, with GM/c² subtending uasPerM, at the hole's distance
   * (1 M ≈ 1/r rad from the camera). Blurred on the coarsest mip level where σ ≥ 2 px; the display
   * samples that level (bilinear magnification of a band-limited image).
   */
  private beamSetup(s: Settings, t: Target) {
    if (s.band === "visible" || s.beamUas <= 0) return null;
    const pixelAngle = (2 * Math.tan((s.fov * Math.PI) / 360)) / t.height;
    const sigmaPx = s.beamUas / 2.3548 / s.uasPerM / Math.max(s.distance, 2) / pixelAngle;
    if (sigmaPx < 1) return null;
    const level = Math.max(0, Math.min(t.bloomLevels - 1, Math.floor(Math.log2(sigmaPx / 2))));
    return { level, sigma: sigmaPx / 2 ** level };
  }

  private encodeBeam(enc: GPUCommandEncoder, t: Target, s: Settings) {
    const b = this.beamSetup(s, t);
    if (!b) return;
    const d = this.device;
    const w = Math.max(1, t.width >> b.level);
    const h = Math.max(1, t.height >> b.level);
    if (!t.beam || t.beam.level !== b.level) {
      t.beam?.tex.destroy();
      t.beam?.buf.destroy();
      const tex = d.createTexture({
        size: [w, h],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      const buf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const lv = t.hdr.createView({ baseMipLevel: b.level, mipLevelCount: 1 });
      const mk = (p: GPUComputePipeline, src: GPUTextureView, dst: GPUTextureView) =>
        d.createBindGroup({
          layout: p.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: src },
            { binding: 2, resource: dst },
            { binding: 10, resource: { buffer: buf } },
          ],
        });
      t.beam = { level: b.level, tex, buf, h: mk(this.postBeamH, lv, tex.createView()), v: mk(this.postBeamV, tex.createView(), lv) };
    }
    d.queue.writeBuffer(t.beam.buf, 0, new Float32Array([b.sigma, Math.ceil(3 * b.sigma), 0, 0]));
    for (const [p, g] of [
      [this.postBeamH, t.beam.h],
      [this.postBeamV, t.beam.v],
    ] as const) {
      const pass = enc.beginComputePass(this.prof.pass("beam"));
      pass.setPipeline(p);
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      pass.end();
    }
  }

  /**
   * Variance-guided à-trous denoiser on the resolved image: 4 iterations (steps 1, 2, 4, 8 px,
   * footprint ±30 px) ping-ponging hdr[0] → tmp → hdr[0] → tmp → hdr[0]. Only for accumulated
   * images (progressive / offline), where every pixel knows the variance of its estimate.
   */
  /** the LUT's textures and bind groups for an image of W × H (a sample every 8 px, corners included) */
  private makeLut(W: number, H: number) {
    const d = this.device;
    const w = Math.ceil(W / 8) + 2,
      h = Math.ceil(H / 8) + 2;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    const tex = [
      d.createTexture({ size: [w, h], format: "rgba32float", usage }),
      d.createTexture({ size: [w, h], format: "r32float", usage }),
    ];
    return {
      tex,
      w,
      h,
      write: d.createBindGroup({
        layout: this.lutWriteLayout,
        entries: [{ binding: 0, resource: tex[0]!.createView() }, { binding: 1, resource: tex[1]!.createView() }, ...this.aerialRead()],
      }),
      read: d.createBindGroup({
        layout: this.lutReadLayout,
        entries: [{ binding: 2, resource: tex[0]!.createView() }, { binding: 3, resource: tex[1]!.createView() }, ...this.aerialRead()],
      }),
    };
  }
  /** (targets without a LUT: a texel's worth, never read — the flag is off) */
  private lutDummy: GPUBindGroup | null = null;
  // the aerial perspective's table (trace.wgsl aerial): its textures, layouts, bind group, its pass's pipeline this frame
  private aerialWriteLayout!: GPUBindGroupLayout;
  private aerialLayout!: GPUPipelineLayout;
  private aerialTex: GPUTexture[] = [];
  private aerialWrite!: GPUBindGroup;
  private aerialSampler!: GPUSampler;
  private aerialPipe: GPUComputePipeline | null = null;
  /** the live view's last realtime frame would read the aerial table (the camera in a world's air), its pass's kernel
   *  there or not (aerialPipe) */
  aerialWanted = false;
  private envReadLayout!: GPUBindGroupLayout;
  private envRead!: GPUBindGroup;
  /** the air before the near world's ground read from the aerial perspective's table (a switch for comparisons) */
  aerialTable = true;
  /** the aerial table's light stored × the frame's pre-exposure (trace.wgsl apScale; false: raw, as before the 18/10
   *  audit — a switch for comparisons) */
  aerialPreExposed = true;
  /** the ground's marches in a shell as high as the relief round the camera can be, not 9 600 m (a switch for comparisons) */
  reliefCeiling = true;
  private mapCells: MapCells | null = null;
  /** the device binds the table's two textures more (AERIAL_TEXTURE_LIMIT) */
  private get aerialOK() {
    return this.device.limits.maxSampledTexturesPerShaderStage >= AERIAL_TEXTURE_LIMIT;
  }
  /** the table's entries in the kernels' second bind group layouts */
  private aerialReadLayout(): GPUBindGroupLayoutEntry[] {
    if (!this.aerialOK) return [];
    const C = GPUShaderStage.COMPUTE;
    return [
      { binding: 4, visibility: C, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 5, visibility: C, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 6, visibility: C, sampler: { type: "filtering" } },
    ];
  }
  /** the table's entries for the main kernel's second bind group */
  private aerialRead(): GPUBindGroupEntry[] {
    if (!this.aerialOK) return [];
    return [
      { binding: 4, resource: this.aerialTex[0]!.createView() },
      { binding: 5, resource: this.aerialTex[1]!.createView() },
      { binding: 6, resource: this.aerialSampler },
    ];
  }

  /** the live frame's phase, for the post chain (the temporal reprojection runs on realtime frames) */
  private taPhase: FrameStats["phase"] = "realtime";
  /** the previous live frame's camera (axes, tan of the half field, aspect), pre-exposure, place */
  private taPrev: {
    right: Vec3;
    up: Vec3;
    fwd: Vec3;
    tanH: number;
    asp: number;
    pre: number;
    r: number;
    region: string;
    time: number;
    near: { index: number; centre: Vec3; radius: number; axes: [Vec3, Vec3, Vec3] } | null;
    /** the camera's place on its near body, in metres (placeOnBody); null: no near body */
    at: Vec3 | null;
  } | null = null;
  /** the reprojection's weights: a pixel a ray landed on, one between rays; the clamp's width [σ] */
  // (the least α of a fresh pixel — 1/16: its history's weight capped at 15 frames (audit R2) —, a pixel
  // between rays' weight, the clamp's width in σ)
  taParams: [number, number, number] = [1 / 16, 0.05, 2.0];
  /** the last realtime frame splatted the catalogue stars (R8: t.stars, over its reprojected image) */
  private starsSplat = false;
  /** the catalogue stars splatted in realtime under the reprojection (R8; a switch for comparisons) */
  splatStars = true;
  /** the near body's ground reprojected when the camera is carried with it (a switch for comparisons) */
  carryGround = true;
  /** the near body's ground reprojected by its rigid motion while the camera moves over it (audit R4; a switch for comparisons) */
  reprojectGround = true;
  /** (the last reprojection: the camera standing still on the near body's ground) */
  taStill: { still: boolean; mMetres: number; turn: number } | null = null;
  /** the craft's raster passes left out — the flown one, the others — (a switch for measuring their cost) */
  debugSkipShip = false;
  /** the detail (the relief's finest windows, the scenery's box) led where the view looks (a switch for comparisons) */
  gazeStreaming = true;
  /** the rays the flown craft's own opaque parts hide from the cockpit not traced (mask.wgsl; a switch for comparisons) */
  cockpitMask = true;
  /** the craft's light probe traced every this many frames while what it sees moves (a switch for comparisons) */
  probeEveryMoving = 1;
  /** the bodies a ray from the camera may meet listed for the kernel (ourSegment), not all looked at (a switch for comparisons) */
  bodyList = true;
  /** the bodies of ours, those the camera's list and the mouth's hold (−1: every body — the list off or too long) */
  bodyListSizes = { ours: 0, camera: 0, mouth: 0 };
  /** The cost view (a debug view, trace.wgsl COST_VIEW): each ray's work as a heat map in place of the image —
   *  0 off, 1 all of it, 2 … 13 one kind (docs/BH-API.md: the ground's march, its heights, its shadows, the clouds,
   *  the air, the water, the scenery, the integrator, the noise, the stars, the bodies, the main loop) —, shown raw
   *  (no exposure, tone map, depth of field, motion blur), its own kernel variant; the image
   *  traced again (a held one too). 14 and 15: the raw counts, for costStats. */
  get costView() {
    return this.costViewMode;
  }
  set costView(v: number) {
    if (v === this.costViewMode) return;
    this.costViewMode = v;
    this.invalidate();
    this.resetTemporal();
  }
  private costViewMode = 0;
  /**
   * The cost view's raw counts read back (costView 14: the ground's march steps, its heights read, its shadows'
   * steps; 15: the main loop's steps, the bodies tested, the integrator's tries — each pixel's, its samples'
   * mean): for each, the share of the pixels where it is not nil, and there its mean, median, 90th and 99th
   * percentiles. Null outside those views.
   */
  async costStats(): Promise<{ share: number; mean: number; p50: number; p90: number; p99: number }[] | null> {
    const t = this.live;
    if ((this.costViewMode !== 14 && this.costViewMode !== 15) || !t) return null;
    const size = t.width * t.height * 16;
    const st = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(t.accum, 0, st, 0, size);
    this.device.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(st.getMappedRange().slice(0));
    st.unmap();
    st.destroy();
    const n = t.width * t.height;
    return [0, 1, 2].map((c) => {
      const v: number[] = [];
      for (let i = 0; i < n; i++) {
        const w = a[4 * i + 3]!;
        const x = w > 0 ? a[4 * i + c]! / w : 0;
        if (x > 0) v.push(x);
      }
      v.sort((x, y) => x - y);
      const q = (f: number) => v[Math.min(v.length - 1, Math.floor(f * v.length))] ?? 0;
      return { share: v.length / n, mean: v.reduce((s, x) => s + x, 0) / Math.max(v.length, 1), p50: q(0.5), p90: q(0.9), p99: q(0.99) };
    });
  }
  /**
   * Debug tuning (trace.wgsl TUNE_*: the air's samples, the relief's shadow steps…): its constants, a kernel
   * variant of their own — what a loop's count costs, A/B in one build. {} the kernel as it is.
   */
  get tune(): Record<string, number> {
    return this.tunes.get(this.tuneKey) ?? {};
  }
  set tune(t: Record<string, number>) {
    const json = JSON.stringify(t ?? {});
    let k = 0;
    if (json !== "{}") {
      for (const [key, v] of this.tunes) if (JSON.stringify(v) === json) k = key;
      if (!k) {
        k = (this.tunes.size % 63) + 1;
        this.tunes.set(k, { ...t });
      }
    }
    if (k === this.tuneKey) return;
    this.tuneKey = k;
    this.invalidate();
    this.resetTemporal();
  }
  private tuneKey = 0;
  private tunes = new Map<number, Record<string, number>>();
  /** the camera's move that breaks the history: the nearest ground's or scenery's shift on the image [px] (a switch for comparisons) */
  taParallaxPx = 64;
  /** the history is dropped on the next frame (a new scene, a jump) */
  resetTemporal() {
    this.taPrev = null;
  }
  /**
   * How far the nearest of the near body's ground or scenery may be [m]: the camera's height over the ground
   * (its relief where known), less the trees' and buildings' height where the Earth's scenery is drawn; a metre
   * at least.
   */
  private nearestSurfaceM(near: { index: number; centre: Vec3; radius: number; axes: Vec3[] }, mPerM: number) {
    const id = this.lastBodies[near.index]?.id;
    const eye = bodyEye(near);
    const h =
      id && solarBody(id) ? heightOverGround(id, eye.map((x) => x * near.radius) as Vec3) : (Math.hypot(...eye) - 1) * near.radius * mPerM;
    return Math.max(1, h - (id === "earth" && this.earthScenery.active ? SCENERY_TOP_M : 0));
  }

  /**
   * Temporal reprojection (realtime, the camera moving): the previous frame's image, found by the
   * camera's rotation (exact for the sky and everything far, whatever the lensing), clamped to the
   * range of the current frame's samples at the block's scale, blended in (post.wgsl: temporal); on
   * the refining frames, or after a jump, the history is only refreshed from the image.
   */
  /** The temporal reprojection's pass; true when it ran (its camera motion written: the motion blur may follow). */
  /** this frame's share of the usual frame (its time since the last one against their median, 1 at most): the motion blur's
   *  shutter is a frame's, not a late frame's */
  private shutterShare() {
    const now = performance.now();
    const dt = now - this.shutterAt;
    this.shutterAt = now;
    if (!(dt > 0 && dt < 1000)) return 1;
    const d = this.shutterDts;
    d.push(dt);
    if (d.length > 15) d.shift();
    const med = [...d].sort((a, b) => a - b)[d.length >> 1]!;
    return Math.min(1, (1.15 * med) / dt);
  }
  private shutterAt = 0;
  private shutterDts: number[] = [];

  private encodeTemporal(enc: GPUCommandEncoder, t: Target, s: Settings): boolean {
    const d = this.device;
    const retired = this.carryRetired;
    if (retired) {
      this.carryRetired = null;
      d.queue.onSubmittedWorkDone().then(() => retired.destroy());
    }
    const cam = this.lastCam;
    if (!cam) return false;
    if (!t.temporal) {
      const hist = [0, 1].map(() =>
        d.createTexture({
          size: [t.width, t.height],
          format: "rgba16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        }),
      );
      const alb = [0, 1].map(() =>
        d.createTexture({
          size: [t.width, t.height],
          format: "rgba16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }),
      );
      const buf = d.createBuffer({ size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const hdr0 = t.hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 });
      // (bind k: reads history k, writes history 1 − k)
      const binds = [0, 1].map((k) =>
        d.createBindGroup({
          layout: this.postTemporal.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: hdr0 },
            { binding: 1, resource: this.clampSampler },
            { binding: 2, resource: hist[1 - k]!.createView() },
            { binding: 3, resource: hist[k]!.createView() },
            { binding: 4, resource: { buffer: t.accum } },
            { binding: 5, resource: { buffer: t.resolveBuf } },
            { binding: 6, resource: { buffer: t.stamps } },
            { binding: 11, resource: { buffer: t.moments } },
            { binding: 21, resource: { buffer: buf } },
            { binding: 23, resource: { buffer: t.stars } },
            { binding: 28, resource: alb[k]!.createView() },
            { binding: 29, resource: alb[1 - k]!.createView() },
          ],
        }),
      );
      const starBinds = hist.map((h) =>
        d.createBindGroup({
          layout: this.postStars.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: h.createView() },
            { binding: 2, resource: hdr0 },
            { binding: 23, resource: { buffer: t.stars } },
          ],
        }),
      );
      t.temporal = { hist, alb, albOk: false, buf, binds, idx: 0, valid: false, pre: 1, held: false, moving: false, from: 0, starBinds };
      this.carryHistory(enc, t.temporal);
    }
    const ta = t.temporal;
    const tanH = Math.tan((s.fov * Math.PI) / 360);
    const asp = t.width / t.height;
    const pre = preExposure(this.ev(s));
    const prev = this.taPrev;
    const ln = this.lastNear;
    const mPerM = 1476.625 * (s.massSolar || 1);
    const at = ln ? placeOnBody(ln, mPerM) : null;
    // (the camera moved on its near body: each pixel is carried by its depth — the parallax, the ground's rigid
    // move (R4) —, but what the move uncovers, and a depth taken between rays, are wrong: the frame is traced
    // afresh once the move shifts the nearest ground or scenery by more than taParallaxPx of a pixel. High above
    // the body — a vessel in orbit, a cruise — the shift stays under it: the reprojection kept)
    const shift = at && prev?.at ? Math.hypot(at[0] - prev.at[0], at[1] - prev.at[1], at[2] - prev.at[2]) : 0;
    const moved =
      !!prev &&
      (prev.at !== null || at !== null) &&
      (prev.at === null ||
        at === null ||
        (shift > 0 &&
          // (not with the raster's ground at every pixel — shadeLite —: its depth exact at each, the reprojection right; dropped
          // there, the history came and went in bursts in flight, each frame's single jittered sample shimmering between)
          !this.rasterLiteNow &&
          shift / this.nearestSurfaceM(ln!, mPerM) > (this.taParallaxPx * 2 * tanH) / t.height));
    // (the image's motion this frame [px]: the camera's turn — its line of sight's and its up's — and the nearest ground's
    // parallax; what the motion's denser rays answer, next frame — motionBlock)
    if (prev && prev.region === cam.region) {
      // (the turn: the line of sight against its own 8 frames ago, over the time between — the flight's shake, a jitter
      // about the mean, cancels there; a frame's own difference took it for a turn, a few pixels in straight flight —
      // — in pixels a second: a frame's own pixels grow as the frames slow, the denser rays' then kept them denser)
      const past = this.fwdPast;
      const now = performance.now();
      past.push({ f: [...cam.fwd] as Vec3, at: now });
      if (past.length > 9) past.shift();
      const p0 = past[0]!;
      const turnRad =
        past.length > 1
          ? (Math.hypot(cam.fwd[0] - p0.f[0], cam.fwd[1] - p0.f[1], cam.fwd[2] - p0.f[2]) * 1000) / Math.max(now - p0.at, 1)
          : 0;
      const px = t.height / (2 * tanH);
      this.imageTurnPx = turnRad * px;
      // (the seen ground's slide [px a second]: fifteen of the view's directions, those below the horizon each to the
      // ground — its height over it, flat, no farther than 40 km —, the camera's move over the body across each over its
      // distance; their mean, the sky's nothing — as fast as the ground slides, as much of it as the view shows. Not the
      // ground under the craft — out of view, a few hundred metres off at any low height: every flight over the line)
      this.imageGroundPx = 0;
      const dt = (now - (past[past.length - 2]?.at ?? now)) / 1000;
      if (ln && at && prev.at && prev.near?.index === ln.index && dt > 0 && dt < 0.5) {
        const id = this.lastBodies[ln.index]?.id;
        const h = id && solarBody(id) ? heightOverGround(id, bodyEye(ln).map((x) => x * ln.radius) as Vec3) : 0;
        const r = Math.hypot(at[0], at[1], at[2]);
        if (h > 0 && r > 0) {
          const up = at.map((x) => x / r);
          const vel = at.map((x, i) => (x - prev.at![i]!) / dt);
          const body = (v: Vec3) => ln.axes.map((a) => a[0]! * v[0] + a[1]! * v[1] + a[2]! * v[2]);
          let sum = 0;
          for (const y of [-0.45, -0.15, 0.15])
            for (const x of [-0.7, -0.35, 0, 0.35, 0.7]) {
              const d = [0, 1, 2].map((k) => cam.fwd[k]! + x * tanH * asp * cam.right[k]! + y * tanH * cam.up[k]!) as Vec3;
              const dl = Math.hypot(d[0], d[1], d[2]);
              const db = body([d[0] / dl, d[1] / dl, d[2] / dl]);
              const down = -(db[0]! * up[0]! + db[1]! * up[1]! + db[2]! * up[2]!);
              if (down < 0.01) continue;
              const along = vel[0]! * db[0]! + vel[1]! * db[1]! + vel[2]! * db[2]!;
              const across = Math.hypot(vel[0]! - along * db[0]!, vel[1]! - along * db[1]!, vel[2]! - along * db[2]!);
              // (ground farther than 40 km — an orbit's, a high cruise's — left out, not counted as at 40 km: low
              // flight only)
              if (h / down > 40_000) continue;
              sum += across / (h / down);
            }
          this.imageGroundPx = (sum / 15) * px;
        }
      }
    } else {
      this.fwdPast.length = 0;
      this.imageTurnPx = this.imageGroundPx = 0;
    }
    // (a jump: the other region, or the distance to the hole changed by more than 5 % in a frame, or a translation)
    const jumped = !prev || prev.region !== cam.region || Math.abs(cam.r - prev.r) > 0.05 * Math.max(cam.r, 1e-9) || moved;
    const on = s.temporalReprojection && this.taPhase === "realtime" && ta.valid && !jumped;
    const near = ln
      ? { index: ln.index, centre: [...ln.centre] as Vec3, radius: ln.radius, axes: ln.axes.map((a) => [...a]) as [Vec3, Vec3, Vec3] }
      : null;
    this.taPrev = {
      right: [...cam.right],
      up: [...cam.up],
      fwd: [...cam.fwd],
      tanH,
      asp,
      pre,
      r: cam.r,
      region: cam.region,
      time: this.lastTime,
      near,
      at,
    };
    // (the camera stopped after moving — a pause between two inputs, or for good: the refinement's first
    // passes drawn in bands, the rest of the image the last frame's sparse rays; the history kept where no
    // band has passed yet, handed over to the refined pixels by their samples, its weight gone after
    // HANDOVER_PASSES full passes. It was replaced at once by that image: a pause of one frame between two
    // inputs dropped the history to the blocks of a single frame — 27 dB in a turn, ~0 accumulated weight)
    // (no refinement — its samples asked for: none —: the history and its stars kept as they are)
    const passes = Math.max(1, Math.min(HANDOVER_PASSES, s.targetSpp));
    const hold =
      !on &&
      s.temporalReprojection &&
      this.taPhase !== "realtime" &&
      ta.valid &&
      !jumped &&
      (ta.moving || ta.held) &&
      this.sampleIndex < passes;
    if (hold) {
      ta.albOk = false;
      this.encodeHandover(enc, t, ta, pre, passes);
      return false;
    }
    if (ta.held) {
      ta.idx = 1 - ta.idx; // (the hand-over: the latest image)
      ta.albOk = false;
    }
    ta.held = false;
    ta.moving = on;
    const stars = this.starsSplat && this.taPhase === "realtime";
    if (!on) {
      // (refresh the history from the image: the next moving frame starts from it — a realtime one, its
      // splatted stars then drawn over it)
      enc.copyTextureToTexture({ texture: t.hdr, mipLevel: 0 }, { texture: ta.hist[ta.idx]! }, [t.width, t.height]);
      ta.valid = true;
      ta.albOk = false;
      ta.pre = pre;
      if (stars) this.encodeStars(enc, t, ta.idx);
      return false;
    }
    const p = prev!;
    // (the camera's move against the near body: its centre's shift, the other way)
    let move: Vec3 = [0, 0, 0];
    if (near && p.near && p.near.index === near.index) {
      const k = near.radius;
      move = [(p.near.centre[0] - near.centre[0]) * k, (p.near.centre[1] - near.centre[1]) * k, (p.near.centre[2] - near.centre[2]) * k];
    }
    // (the near body's ground: within 30 of its radii — drawn afresh, not reprojected; unless the camera is
    // carried with it — on the body's own axes, where it was to a centimetre and turned less than a quarter
    // of a pixel: standing on a turning world, the view held or following the Sun. Its ground then stays
    // where it was in the image: taken from the same pixel (the sky still turned). Drawn afresh in 2×2
    // blocks each frame, its ridges — met by a ray march whose steps grow with the distance — came and
    // went: the ground shook)
    let still = false;
    if (near && p.near && p.near.index === near.index) {
      const onAxes = (v: Vec3, A: Vec3[]) => A.map((a) => v[0] * a[0]! + v[1] * a[1]! + v[2] * a[2]!);
      const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
      const mMetres =
        dist(onAxes(near.centre, near.axes), onAxes(p.near.centre, p.near.axes)) * near.radius * 1476.625 * (s.massSolar || 1);
      const turn =
        dist(onAxes(cam.fwd as Vec3, near.axes), onAxes(p.fwd, p.near.axes)) +
        dist(onAxes(cam.up as Vec3, near.axes), onAxes(p.up, p.near.axes));
      // (and the light not changed at once: a new date, the history lit as it was — within 5 s of the
      // scene's clock a frame, the Sun turns 0.02° over the ground)
      const step = Math.abs(this.lastTime - p.time) * (1476.625 / C_MPS) * (s.massSolar || 1);
      still = this.carryGround && mMetres < 0.01 && turn < (0.25 * 2 * tanH) / t.height && step < 5; // (the centre's round-off: tenths of a millimetre)
      this.taStill = { still, mMetres, turn };
    }
    // (rigid: the camera moving over the near body — its ground reprojected by the body's motion, R4)
    const rigid = !!(near && p.near && p.near.index === near.index && !still && this.reprojectGround);
    const turnRows: [Vec3, Vec3, Vec3] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    if (rigid) {
      const A = near!.axes,
        B = p.near!.axes;
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) turnRows[j]![k] = B[0]![j]! * A[0]![k]! + B[1]![j]! * A[1]![k]! + B[2]![j]! * A[2]![k]!;
    }
    d.queue.writeBuffer(
      ta.buf,
      0,
      new Float32Array([
        ...cam.right,
        tanH,
        ...cam.up,
        asp,
        ...cam.fwd,
        this.taParams[2],
        ...p.right,
        p.tanH,
        ...p.up,
        p.asp,
        ...p.fwd,
        0,
        // (the history's exposure to this frame's; on; a fresh pixel's least α, a pixel between rays' weight)
        pre / p.pre,
        1,
        // (the raster's ground fresh at every pixel each frame: a third of it — the history antialiases, it does not carry the
        // image, its resampling under the motion's magnification smearing the ground at 1/16)
        this.rasterLiteNow ? Math.max(this.taParams[0], RASTER_LITE_ALPHA) : this.taParams[0],
        this.taParams[1],
        // (w: the ground's reach — negative: carried with it, the same pixel)
        ...move,
        near ? (still ? -30 : 30) * near.radius : 0,
        // (the near body's centre now [M], its ground reprojected rigidly — moving over it, not carried: R4)
        ...(rigid ? near!.centre.map((c) => c * near!.radius) : [0, 0, 0]),
        rigid ? 1 : 0,
        // (its turn between the frames: an offset from its centre now → then, Σ a_prev[i] (a_now[i] · v))
        ...turnRows.flatMap((r) => [...r, 0]),
        // (the motion blur's shutter — over a frame of the usual length: a late frame's move, two or three times longer, smeared
        // the ground for that frame, a blur every second or so; w: the history's albedo beside it — RASTER_DETAIL)
        s.motionBlur * this.shutterShare(),
        0,
        0,
        this.rasterDetailNow && ta.albOk ? 1 : 0,
      ]),
    );
    const pass = enc.beginComputePass(this.prof.pass("temporal"));
    pass.setPipeline(this.postTemporal);
    pass.setBindGroup(0, ta.binds[ta.idx]!);
    pass.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
    pass.end();
    ta.idx = 1 - ta.idx;
    ta.albOk = true;
    ta.pre = pre;
    // (the canvas's own image from it and this frame's samples, before the image is overwritten by the native result)
    this.encodeTaau(enc, t, stars);
    if (stars) this.encodeStars(enc, t, ta.idx);
    else enc.copyTextureToTexture({ texture: ta.hist[ta.idx]! }, { texture: t.hdr, mipLevel: 0 }, [t.width, t.height]);
    return true;
  }

  /** the temporal upsampling (post.wgsl taau): on where the live image is rendered under the canvas, moving — off by
   *  default: in a turn at ⅛ or ¼ shading its samples are too few to beat the display's Catmull–Rom, for 2–3 ms more
   *  (docs/progress/raster-aaa/PERF-2026-10-21.md) */
  taauOn = false;
  /** its samples' kernel σ [output px] (×scale: render px) */
  taauSigma = 0.5;
  /** the native result's weight in its history each frame (post.wgsl taau: no drift where few samples land) */
  taauNative = 0.02;

  private dropTaau(t: Target) {
    const u = t.taau;
    if (!u) return;
    u.hist.forEach((h) => h.destroy());
    u.out.destroy();
    u.buf.destroy();
    t.taau = null;
  }

  /**
   * The temporal upsampling's pass, after the native temporal one (ta.idx its result): at the canvas's size where the live
   * image is rendered under it — else off, the display upscaling the render as before.
   */
  private encodeTaau(enc: GPUCommandEncoder, t: Target, stars: boolean) {
    const cv = this.context.canvas as HTMLCanvasElement;
    const W = cv.width,
      H = cv.height;
    const want =
      this.taauOn && !!this.postTaau && t === this.live && !!t.temporal && W > t.width * 1.01 && H > t.height * 1.01 && !this.costViewMode;
    if (!want) {
      if (t.taau) t.taau.on = false;
      return;
    }
    const d = this.device;
    if (!t.taau || t.taau.w !== W || t.taau.h !== H) {
      this.dropTaau(t);
      const mk = (label: string) =>
        d.createTexture({
          label,
          size: [W, H],
          format: "rgba16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        });
      t.taau = {
        w: W,
        h: H,
        hist: [mk("taau history 0"), mk("taau history 1")],
        out: mk("taau image"),
        buf: d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        binds: new Map(),
        idx: 0,
        valid: false,
        on: false,
        displayBinds: new Map(),
      };
    }
    const u = t.taau;
    const ta = t.temporal!;
    const key = `${u.idx}:${ta.idx}`;
    let bind = u.binds.get(key);
    if (!bind) {
      bind = d.createBindGroup({
        layout: this.postTaau.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: t.hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
          { binding: 1, resource: this.clampSampler },
          { binding: 2, resource: u.hist[1 - u.idx]!.createView() },
          { binding: 3, resource: u.hist[u.idx]!.createView() },
          { binding: 6, resource: { buffer: t.stamps } },
          { binding: 11, resource: { buffer: t.moments } },
          { binding: 21, resource: { buffer: ta.buf } },
          { binding: 23, resource: { buffer: t.stars } },
          { binding: 25, resource: ta.hist[ta.idx]!.createView() },
          { binding: 26, resource: u.out.createView() },
          { binding: 27, resource: { buffer: u.buf } },
        ],
      });
      u.binds.set(key, bind);
    }
    const scale = t.width / W;
    const f = new Float32Array(8);
    f.set([this.taauNative, 0, Math.max(this.taauSigma * scale, 0.3), u.valid ? 1 : 0]);
    new Uint32Array(f.buffer).set([this.frameStamp, this.rasterHaltonNow ? 1 : 0, stars ? 1 : 0, 0], 4);
    d.queue.writeBuffer(u.buf, 0, f);
    const pass = enc.beginComputePass(this.prof.pass("taau"));
    pass.setPipeline(this.postTaau);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.end();
    u.idx = 1 - u.idx;
    u.valid = true;
    u.on = true;
  }

  /** the display's bind group with the temporal upsampling's image in the render's place */
  private taauDisplayBind(t: Target, pipeline: GPURenderPipeline): GPUBindGroup | null {
    const u = t.taau!;
    let b = u.displayBinds.get(pipeline);
    if (!b) {
      const base = t.displayBinds.get(pipeline);
      if (!base) return null;
      b = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: u.out.createView() },
          { binding: 1, resource: { buffer: this.displayBuf } },
          { binding: 2, resource: t.bloomTex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
          { binding: 3, resource: this.clampSampler },
          { binding: 4, resource: { buffer: t.polGrid } },
          { binding: 5, resource: this.ship.target(t.hdr).resolved.createView() },
          { binding: 6, resource: this.ship.target(t.hdr).plume.createView() },
          { binding: 7, resource: (t.dof?.tex ?? this.dofDummy).createView() },
          { binding: 8, resource: t.bloomTex.createView() },
          { binding: 9, resource: { buffer: t.flare.out } },
          { binding: 10, resource: this.lensDirt.createView() },
        ],
      });
      u.displayBinds.set(pipeline, b);
    }
    return b;
  }

  /** The image: history k with the realtime frame's splatted stars over it (R8; it keeps none itself). */
  private encodeStars(enc: GPUCommandEncoder, t: Target, k: number) {
    const pass = enc.beginComputePass(this.prof.pass("stars"));
    pass.setPipeline(this.postStars);
    pass.setBindGroup(0, t.temporal!.starBinds[k]!);
    pass.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
    pass.end();
  }

  /**
   * The camera held after moving (post.wgsl temporal, TA.k.y = 2): the history it ended with (ta.idx,
   * the same pixels: the camera has not moved since) blended into the refined ones, into the other
   * image — the display's, and the next move's history (held).
   */
  /**
   * The live image carried over a resize: the camera held after moving, the image refines at the full scale — a new target,
   * its history empty: no hand-over (encodeHandover), the first pass's rows not yet refined showed the bare samples (the
   * raster's ground shaded one pixel in sixteen: black) for a pass's time, ~8 s on an M1. The old target's last history
   * copied here at its resize; the new one's made from it, resampled, in encodeTemporal (and back the other way when the
   * camera moves again: the refined image the motion's first history). Its weight a sample's at most (the history's α is
   * its accumulated weight, up to 15): resampled, blurred, it fills the rows the refinement has not reached and gives way to
   * it from the first pass — at its full weight the refined image was a fourteenth of a pixel after a pass, 8 s on an M1.
   */
  private historyCarry: { tex: GPUTexture; pre: number; moving: boolean } | null = null;
  private resamplePipe: GPUComputePipeline | null = null;
  private keepHistory(old: Target) {
    const ta = old.temporal!;
    const prev = this.historyCarry;
    if (prev) this.device.queue.onSubmittedWorkDone().then(() => prev.tex.destroy());
    const tex = this.device.createTexture({
      size: [old.width, old.height],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToTexture({ texture: ta.hist[ta.idx]! }, { texture: tex }, [old.width, old.height]);
    this.device.queue.submit([enc.finish()]);
    this.historyCarry = { tex, pre: ta.pre, moving: ta.moving || ta.held };
  }
  private carryHistory(enc: GPUCommandEncoder, ta: NonNullable<Target["temporal"]>) {
    const c = this.historyCarry;
    if (!c) return;
    this.historyCarry = null;
    this.resamplePipe ??= this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({
          code: `@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let size = textureDimensions(dst);
  if (g.x >= size.x || g.y >= size.y) { return; }
  let c = textureSampleLevel(src, samp, (vec2f(g.xy) + 0.5) / vec2f(size), 0.0);
  textureStore(dst, g.xy, vec4f(c.rgb, min(c.a, 1.0)));
}`,
        }),
        entryPoint: "main",
      },
    });
    const dst = ta.hist[ta.idx]!;
    const pass = enc.beginComputePass();
    pass.setPipeline(this.resamplePipe);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.resamplePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: c.tex.createView() },
          { binding: 1, resource: this.clampSampler },
          { binding: 2, resource: dst.createView() },
        ],
      }),
    );
    pass.dispatchWorkgroups(Math.ceil(dst.width / 8), Math.ceil(dst.height / 8));
    pass.end();
    ta.valid = true;
    ta.albOk = false;
    ta.pre = c.pre;
    ta.moving = c.moving;
    // (let go once this frame is submitted: the next encodeTemporal)
    this.carryRetired = c.tex;
  }
  private carryRetired: GPUTexture | null = null;

  private encodeHandover(enc: GPUCommandEncoder, t: Target, ta: NonNullable<Target["temporal"]>, pre: number, passes: number) {
    if (!ta.held) ta.from = this.frameStamp;
    const k = new Float32Array(52);
    // (k: the history's exposure to this frame's, the mode; mb.y: the history's weight left, z: the
    // hand-over's first frame — the history has the samples before, the realtime ones)
    k.set([pre / ta.pre, 2], 24);
    k[49] = Math.max(0, 1 - (this.sampleIndex + 1) / passes); // (0 on the last: no step when it ends)
    new Uint32Array(k.buffer)[50] = ta.from;
    this.device.queue.writeBuffer(ta.buf, 0, k);
    const pass = enc.beginComputePass(this.prof.pass("temporal"));
    pass.setPipeline(this.postTemporal);
    pass.setBindGroup(0, ta.binds[ta.idx]!);
    pass.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
    pass.end();
    ta.held = true;
    enc.copyTextureToTexture({ texture: ta.hist[1 - ta.idx]! }, { texture: t.hdr, mipLevel: 0 }, [t.width, t.height]);
  }

  /**
   * The camera's motion blur over the reprojected image (the temporal pass's camera motion and depth),
   * into its own image, copied back: the bloom, the ship over it, the display follow.
   */
  private encodeMotionBlur(enc: GPUCommandEncoder, t: Target) {
    const ta = t.temporal;
    if (!ta) return;
    if (!t.blur) {
      const tex = this.device.createTexture({
        size: [t.width, t.height],
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      const bind = this.device.createBindGroup({
        layout: this.postMotion.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: t.hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
          { binding: 2, resource: tex.createView() },
          { binding: 11, resource: { buffer: t.moments } },
          { binding: 21, resource: { buffer: ta.buf } },
        ],
      });
      t.blur = { tex, bind };
    }
    const pass = enc.beginComputePass(this.prof.pass("motion blur"));
    pass.setPipeline(this.postMotion);
    pass.setBindGroup(0, t.blur.bind);
    pass.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
    pass.end();
    enc.copyTextureToTexture({ texture: t.blur.tex }, { texture: t.hdr, mipLevel: 0 }, [t.width, t.height]);
  }

  /**
   * The occlusion depth (post.wgsl occlusion): each pixel's own traced depth where a ray landed this frame,
   * else the nearest of the fresh rays that enclose it — what the astronaut, the grass, the stones, the
   * vessels, the station and the Endurance are hidden by. moments.y stays the depth of field's.
   */
  private encodeSceneDepth(enc: GPUCommandEncoder, t: Target) {
    t.sceneDepthBind ??= this.device.createBindGroup({
      layout: this.postOcclusion.getBindGroupLayout(0),
      entries: [
        { binding: 5, resource: { buffer: t.resolveBuf } },
        { binding: 6, resource: { buffer: t.stamps } },
        { binding: 11, resource: { buffer: t.moments } },
        { binding: 24, resource: { buffer: t.sceneDepth } },
      ],
    });
    const pass = enc.beginComputePass(this.prof.pass("occlusion depth"));
    pass.setPipeline(this.postOcclusion);
    pass.setBindGroup(0, t.sceneDepthBind);
    pass.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
    pass.end();
  }

  private encodeDenoise(enc: GPUCommandEncoder, t: Target, s: Settings) {
    const d = this.device;
    if (!t.denoise) {
      const tex = d.createTexture({
        size: [t.width, t.height],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      const hdr0 = t.hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 });
      const tmp = tex.createView();
      const bufs = [0, 1, 2, 3].map(() => d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const binds = bufs.map((buf, i) =>
        d.createBindGroup({
          layout: this.postAtrous.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: i % 2 === 0 ? hdr0 : tmp },
            { binding: 2, resource: i % 2 === 0 ? tmp : hdr0 },
            { binding: 12, resource: { buffer: buf } },
          ],
        }),
      );
      t.denoise = { tex, bufs, binds };
    }
    t.denoise.bufs.forEach((b, i) => d.queue.writeBuffer(b, 0, new Float32Array([2 ** i, 1.5 * s.denoiseStrength, i, 0])));
    for (const g of t.denoise.binds) {
      const pass = enc.beginComputePass(this.prof.pass("denoise"));
      pass.setPipeline(this.postAtrous);
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
      pass.end();
    }
  }

  private encodePost(enc: GPUCommandEncoder, t: Target, s?: Settings) {
    // (the temporal upsampling's image shown only where its pass ran this frame — encodeTaau —; its history only if it ran the
    // last one too: a held camera's frames refine the native image alone, the history then a view ago)
    if (t.taau) {
      if (!t.taau.on) t.taau.valid = false;
      t.taau.on = false;
    }
    if (s?.polarization) {
      const { gw, gh } = this.polCells(s, t);
      const pass = enc.beginComputePass(this.prof.pass("polarization"));
      pass.setPipeline(this.postPolGrid);
      pass.setBindGroup(0, t.polGridPass);
      pass.dispatchWorkgroups(Math.ceil(gw / 8), Math.ceil(gh / 8));
      pass.end();
    }
    const r0 = t.gather.size > 16 ? 1 : 0; // index of the resolve pass (live view: after the gather pass)
    // (the bloom's levels only when something reads them: the glow, the lens flare's ghosts, an
    // instrument's beam; its upsampling only for the glow — the display weighs it by the glow's 0)
    const glow = !s || s.bloom > 0;
    const downs = glow || !s || s.lensFlare > 0 || !!this.beamSetup(s, t);
    t.postPasses.forEach((p, i) => {
      const label = p.label ?? "post";
      const skip = (label.startsWith("bloom down") && !downs) || (label.startsWith("bloom up") && !glow);
      if (!skip) {
        const pass = enc.beginComputePass(this.prof.pass(label));
        pass.setPipeline(p.pipeline);
        pass.setBindGroup(0, p.bind);
        pass.dispatchWorkgroups(Math.ceil(p.w / 8), Math.ceil(p.h / 8));
        pass.end();
      }
      // denoise right after the resolve; beam after the downsampling chain, before the bloom upsampling
      if (s && i === r0 && s.denoise && this.accumulated(t)) this.encodeDenoise(enc, t, s);
      const trace = s && i === r0 && t === this.live ? this.colTraceFrame(enc, t) : null;
      if (s && i === r0 && t === this.live && this.encodeTemporal(enc, t, s) && s.motionBlur > 0 && !this.costViewMode)
        this.encodeMotionBlur(enc, t);
      if (trace) trace(enc);
      // the occlusion depth the raster passes below test against (Z-P1: fresh, not the stale pixels' own)
      if (s && i === r0) this.encodeSceneDepth(enc, t);
      // the space station, where it is on its orbit (before the Ranger: its glass reflects it)
      if (s && i === r0) this.encodeStation(enc, t, s);
      if (s && i === r0) this.encodeCharacter(enc, t, s);
      if (s && i === r0 && (s.ship || this.craftsShown) && this.ship.ready && !this.debugSkipShip) {
        this.ship.encodeShip(
          enc,
          t.hdr,
          {
            vessel: s.ship || this.shipInView ? s.vessel : undefined,
            place: !s.ship && this.shipInView ? this.shipPlace! : undefined,
            others: this.shipOthers(s),
            sea: this.shipSea(s),
            mPerM: 1476.625 * (s.massSolar || 1),
            forceShadow: !!this.character?.active,
            inside: s.ship && (s.shipMount === "cockpit" || s.shipMount === "cabin"),
            // (the own mask only where the next frame's cockpit mask can use it: a realtime frame, no cost view, no
            // depth of field)
            ownMask:
              this.cockpitMask &&
              s.ship &&
              (s.shipMount === "cockpit" || s.shipMount === "cabin") &&
              t === this.live &&
              this.taPhase === "realtime" &&
              !this.costViewMode &&
              !this.dofOn(s, t),
            dash: this.cockpitDash ?? undefined,
            controls: this.cockpitControls ?? undefined,
            gear: this.shipGear ?? undefined,
            jet: s.vessel === "f35" && this.jetPose ? { ...this.jetPose, ...this.jetForce } : null,
            a320:
              s.vessel === "a320" && this.a320Pose
                ? { props: { ...this.a320Pose.props, ...this.a320Force }, spins: this.a320Pose.spins }
                : null,
            a320Deck: s.vessel === "a320" && this.a320Deck ? { ...this.a320Deck, ...this.a320Force } : null,
            cabin: lampsOf(s, this.cockpitGlow),
            pcd: s.vessel === "f35" ? this.pcdLook : null,
            a320Glass: s.vessel === "a320" && this.a320Deck ? this.a320Glass : null,
            lamps: { navLights: s.navLights, strobeLights: s.strobeLights, landingLights: s.landingLights, t: performance.now() / 1000 },
            glares: this.glaresNow(s),
            mount: this.shipPose ?? (s.shipMount as Mount),
            look: [s.shipLookYaw, s.shipLookPitch],
            fov: s.fov,
            aspect: t.width / t.height,
            albedo: s.shipAlbedo,
            metal: s.shipMetal,
            rough: s.shipRough,
            light: s.shipLight,
            coat: s.shipCoat,
            pre: preExposure(this.ev(s)),
            plasma: this.shipPlasma,
            reentry: this.shipReentry,
            probeAxes: this.shipProbeAxes,
            thrust: this.shipThrust,
            glow: preExposure(this.ev(s)) / 2 ** this.ev(s),
            contrails: this.shipContrails,
          },
          // (on foot: the astronaut and the grass before it hide the hull — else the station, before it in orbit)
          this.characterRenderer.occluder ??
            (this.station.depthTexture() ? { depth: this.station.depthTexture()!, rect: this.station.rect } : undefined),
          t.sceneDepth,
        );
        // (the own mask drawn this frame: the next realtime trace's cockpit mask — encodeCockpitMask)
        if (t === this.live) this.ownMaskStamp = this.ship.ownDrawn ? this.frameStamp : -1;
        // (where it was drawn: the display reads its image there, the bloom too)
        const rect = new Float32Array(this.ship.rectFor(t.hdr));
        this.device.queue.writeBuffer(this.displayBuf, 112, rect);
        this.device.queue.writeBuffer(t.shipRect, 0, rect);
      } else if (i === r0) {
        this.device.queue.writeBuffer(t.shipRect, 0, new Float32Array(4));
        if (t === this.live) this.ownMaskStamp = -1;
      }
      // the Endurance, over the traced image (before the bloom's levels are made from it)
      // (near it — 60 km —: drawn as a ship at its true size instead, holeShips)
      if (s && i === r0 && s.endurance && this.lastCam && !holeFleet.source?.()?.hideCinematic) {
        if (!this.endurance.ready) {
          this.enduranceLoading ??= loading
            .track(
              "endurance",
              "The Endurance",
              this.endurance.load((u) => loading.fetch(u, "endurance")),
            )
            .then(
              () => this.invalidate(),
              (e) => console.error("Endurance:", e),
            );
        } else {
          const pre = preExposure(this.ev(s));
          this.endurance.encode(enc, t.hdr, t.sceneDepth, s, this.lastCam, this.lastTime, pre, pre / 2 ** this.ev(s));
        }
      }
      if (s && i === r0 + t.bloomLevels - 1) this.encodeBeam(enc, t, s);
    });
    // the depth of field, from the finished image and its depths (the Ranger, composited later, sharp)
    if (s && this.dofOn(s, t)) {
      const dof = t.dof!;
      // (the largest circle: the aperture × 3 % of the image's height)
      this.device.queue.writeBuffer(dof.buf, 0, new Float32Array([s.dofFocus, s.dofAperture * 0.03 * t.height, 32, 0]));
      this.device.queue.writeBuffer(dof.buf, 16, new Uint32Array([t.width, t.height, 0, 0]));
      // (the Endurance's box and depth: nearer than the traced scene where it covers it)
      const er = s.endurance ? this.endurance.rect : [0, 0, 0, 0];
      this.device.queue.writeBuffer(dof.buf, 32, new Float32Array(er));
      const et = this.endurance.depthTexture();
      if (dof.endTex !== et) {
        dof.endTex = et;
        dof.bind = this.device.createBindGroup({
          layout: this.postDof.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: t.hdr.createView() },
            { binding: 1, resource: this.clampSampler },
            { binding: 2, resource: dof.tex.createView() },
            { binding: 11, resource: { buffer: t.moments } },
            { binding: 17, resource: { buffer: dof.buf } },
            { binding: 20, resource: et.createView() },
          ],
        });
      }
      const pass = enc.beginComputePass(this.prof.pass("depth of field"));
      pass.setPipeline(this.postDof);
      pass.setBindGroup(0, dof.bind);
      pass.dispatchWorkgroups(Math.ceil(t.width / 16), Math.ceil(t.height / 16));
      pass.end();
    }
    // the lens flare's meter: where the light that burns out is (a level ≤ 128 px wide)
    if (s && s.lensFlare > 0 && t.flare.bind) {
      const level = Math.min(t.bloomLevels - 1, Math.max(1, Math.ceil(Math.log2(t.width / 128))));
      this.device.queue.writeBuffer(t.flare.u, 0, new Float32Array([2 ** this.ev(s) / preExposure(this.ev(s)), level, 0, 0]));
      const pass = enc.beginComputePass(this.prof.pass("lens flare meter"));
      pass.setPipeline(this.postFlare);
      pass.setBindGroup(0, t.flare.bind);
      pass.dispatchWorkgroups(1);
      pass.end();
    }
    // the light meter, on the live view (the scene: the Ranger is composited at display)
    // (read every METER_EVERY frames — the exposure eases towards its reading each frame meanwhile —, at once while it is to
    // be found afresh or a spot is metered: a pass over the whole image for a value that moves slowly, ~0.8 ms on an M1 —
    // TERRE-UNREAL U6)
    const meterDue = !this.autoEVSet || !!this.meterSpot || this.meterTick + 1 >= METER_EVERY;
    if (s?.autoExposure && t === this.live && !this.meterPending) this.meterTick = meterDue ? 0 : this.meterTick + 1;
    if (s?.autoExposure && t === this.live && !this.meterPending && meterDue) {
      this.device.queue.writeBuffer(this.histBuf, 0, new Uint32Array(128));
      const sp = this.meterSpot;
      // (another target, the spot taken or let go: its exposure found at once — not eased from the last one's,
      // seconds of a burnt or a black frame)
      const key = sp ? (sp.key ?? "spot") : "";
      if (key !== this.spotKey) {
        this.spotKey = key;
        this.autoEVSet = false;
      }
      this.meterSpotUsed = !!sp;
      this.device.queue.writeBuffer(this.spotBuf, 0, new Float32Array(sp ? [sp.x, sp.y, sp.r, 1] : [0, 0, 0, 0]));
      const pass = enc.beginComputePass(this.prof.pass("light meter"));
      pass.setPipeline(this.meterPipeline);
      pass.setBindGroup(
        0,
        this.device.createBindGroup({
          layout: this.meterPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: t.hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
            { binding: 11, resource: { buffer: t.moments } },
            { binding: 20, resource: { buffer: this.histBuf } },
            { binding: 22, resource: { buffer: this.spotBuf } },
          ],
        }),
      );
      pass.dispatchWorkgroups(8, 8);
      pass.end();
      enc.copyBufferToBuffer(this.histBuf, 0, this.histStage, 0, 512);
      this.meterPending = true;
      this.meterPre = preExposure(this.ev(s));
      this.meterSkyUsed = this.meterSky;
      this.meterEVUsed = this.autoEVDrawn;
      this.device.queue.onSubmittedWorkDone().then(() =>
        this.histStage
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            const h = new Uint32Array(this.histStage.getMappedRange().slice(0));
            this.histStage.unmap();
            this.meterPending = false;
            this.readMeter(h);
          })
          .catch(() => (this.meterPending = false)),
      );
    }
  }

  /** the cockpit's dashboard (main.ts, from the flight's figures): the local up and the motion on the
   *  ship's axes, the speed [km/s], the height [km], the clock [s] */
  cockpitDash: { up: Vec3; fwd: Vec3; speed: number; alt: number; time: number } | null = null;
  /** the cockpit's controls' poses (cockpit/controls.ts poseData), set each frame the cabin is seen */
  cockpitControls: Float32Array<ArrayBuffer> | null = null;
  /** the Ranger's landing gear: out (0…1), each leg's oleo compression [m] (set each frame by main.ts) */
  shipGear: { ext: number; comp: number[] } | null = null;
  /** the flown F-35's moving parts (src/f35/pose.ts) */
  jetPose: import("./f35/model").F35Pose | null = null;
  /** parts of it held where a test or a capture wants them (scripts/f35-shots.ts: __bh.renderer.jetForce) */
  jetForce: Partial<import("./f35/model").F35Pose> = {};
  /** the flown A320's moving parts: its rig's properties and spins (src/a320/pose.ts), and properties held where a
   *  test or a capture wants them (FlightGear's paths: __bh.renderer.a320Force) */
  a320Pose: { props: import("./a320/rig").Props; spins: import("./a320/rig").Props } | null = null;
  /** the A320's ground vehicles (src/a320/services.ts — main.ts each frame): their meshes, places in its frame [m] and
   *  turns about its up axis [rad] — drawn with it while it is flown */
  a320Ground: import("./a320/services").GroundVehicle[] | null = null;
  a320Force: import("./a320/rig").Props = {};
  /** its displays (src/a320/du — main.ts: captures and tests read their canvases) */
  a320Du: import("./a320/du").DuSet | null = null;
  /** its flight deck's (src/a320/deck.ts — set each frame from inside by main.ts) */
  a320Deck: import("./a320/rig").Props | null = null;
  /** its windshield from inside (src/a320/glass.ts — main.ts): the rain on it, the wipers, the frost */
  a320Glass: import("./ship").ShipView["a320Glass"] = null;
  /** the cockpit's displays' mean colours (cockpit/lights.ts displayColours): the screens' light in the cabin */
  cockpitGlow: Float32Array | null = null;
  /** the F-35's panoramic display's look (set each frame its cockpit is seen — src/f35/pcd.ts look) */
  pcdLook: import("./ship").PcdLook | null = null;

  /** Craft of the fleet in view with none flown (the camera near them): their pass, their light probe. */
  craftsShown = false;

  /**
   * The craft not flown (fleet.ts), where they are seen from the camera's eye: within 60 km, on our side;
   * in the shadow map those within 150 m of the flown one (docked, alongside). Their transforms: the craft's
   * axes on the camera's (rows: the camera's axes on the craft's), the origin [m].
   */
  earthLandAt(q: Vec3): boolean | null {
    const cover = this.earthScenery.contact?.cover(q) ?? 0;
    if (cover) return cover !== 80;
    const h = this.earthMaps.heights;
    if (!h) return null;
    const normal = geodeticNormal(WGS84_A, WGS84_F, q);
    return mapHeightSampler(h.map, h.W, h.H)(normal) > 0;
  }

  /**
   * On foot: the light the astronaut stands in, read back from the probe — the key light's and the sky's
   * (irradiance luminances, in the tracer's units, on a surface facing up), the Sun's height (cosine) and how
   * deep a shadow falls there (the key's share of the light: ~1 on an airless world, less under a sky). Null
   * off foot, or with no fresh probe.
   */
  async characterLight(): Promise<{ key: number; sky: number; cosine: number; shadowDepth: number } | null> {
    const f = this.character?.frame(),
      L = this.characterSun;
    if (!f || !L || !this.characterRenderer.stats().probe) return null;
    const stage = this.device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.ship.shBuf, 0, stage, 0, 256);
    this.device.queue.submit([enc.finish()]);
    await stage.mapAsync(GPUMapMode.READ);
    const sh = new Float32Array(stage.getMappedRange().slice(0));
    stage.unmap();
    stage.destroy();
    // (the body's up in the probe's axes; Ramamoorthi & Hanrahan's irradiance there, as character.wgsl)
    const ax = this.shipProbeAxes,
      n = f.axes[1];
    const d = [0, 1, 2].map((k) => n[0] * ax[0][k]! + n[1] * ax[1][k]! + n[2] * ax[2][k]!);
    const [x, y, z] = d as [number, number, number];
    const basis = [
      0.282095,
      0.488603 * y,
      0.488603 * z,
      0.488603 * x,
      1.092548 * x * y,
      1.092548 * y * z,
      0.315392 * (3 * z * z - 1),
      1.092548 * x * z,
      0.546274 * (x * x - y * y),
    ];
    const A = [Math.PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398];
    const lum = (o: number) => 0.2126 * sh[o]! + 0.7152 * sh[o + 1]! + 0.0722 * sh[o + 2]!;
    const sky = Math.max(
      0,
      basis.reduce((e, b, k) => e + A[k]! * b * lum(k * 4), 0),
    );
    const key = sh[47]! > 0.5 ? Math.max(0, lum(44)) : 0;
    const cosine = Math.max(0, dot3(L, n) / Math.hypot(...L));
    const total = key * cosine + sky;
    return { key, sky, cosine, shadowDepth: total > 0 ? (key * cosine) / total : 0 };
  }

  /**
   * The camera on the Earth's near patch, for the living ground round it (what grows is placed round the camera,
   * whoever walks — or none: a free camera, a tripod, a photo, the cockpit of a landed ship): its eye [m,
   * body-fixed], the body's up there, the body's axes in the camera's (those the tracer draws the ground on), the
   * walker's own height query. Null: the camera is not by the Earth.
   */
  private grassView(): GrassView | null {
    const near = this.lastNear,
      cam = this.lastCam;
    if (!near || !cam || this.lastBodies[near.index]?.id !== "earth") return null;
    const q = bodyEye(near).map((x) => x * near.radius * M_METRES) as Vec3;
    const A = near.axes;
    const toCamera = (v: Vec3): Vec3 => {
      const r = [0, 1, 2].map((i) => v[0] * A[0][i]! + v[1] * A[1][i]! + v[2] * A[2][i]!) as Vec3;
      return [dot3(r, cam.right), dot3(r, cam.up), dot3(r, cam.fwd)];
    };
    // (the ellipsoid's normal: the walker's own up, controller/character.ts)
    const a = WGS84_A,
      b = a * (1 - WGS84_F);
    const n: Vec3 = [q[0] / (a * a), q[1] / (a * a), q[2] / (b * b)];
    const nl = Math.hypot(...n) || 1;
    return {
      q,
      up: [n[0] / nl, n[1] / nl, n[2] / nl],
      toCamera,
      raw: (p) => heightOverGround("earth", p.map((v) => v / M_METRES) as Vec3),
    };
  }

  /** the others on foot (docs/PLAN-RESEAU.md R5 — ui/netsession.ts): in the home frame; brought here onto the
   *  camera's axes for the character's renderer (and their name tags) */
  netWalkers: NetWalkerHome[] = [];
  /** their places from the camera this frame [m, its axes] (their name tags') */
  netWalkersCam: { slot: number; at: Vec3; dist: number }[] = [];

  /** The others on foot from the camera (as the fleet's others are: our side of the throat). */
  private netWalkersOnCamera(s: Settings): CharacterRenderer["remoteWalkers"] {
    const cam = this.lastCam;
    this.netWalkersCam = [];
    if (!this.netWalkers.length || !cam || s.system !== "gargantua" || !s.wormhole || cam.region !== "throat" || cam.ell >= 0) return [];
    const w = mouth(s).w;
    const Xc = homeOf(w, cam.ell, cam.n);
    const mR = 1476.625 * (s.massSolar || 1);
    const toCam = (v: Vec3): Vec3 => {
      const r = homeToRep(w, cam.ell, cam.n, v);
      return [dot3(r, cam.right), dot3(r, cam.up), dot3(r, cam.fwd)];
    };
    const unitV = (v: Vec3): Vec3 => {
      const l = Math.hypot(...v) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const out: CharacterRenderer["remoteWalkers"] = [];
    for (const o of this.netWalkers) {
      const origin = toCam([o.X[0] - Xc[0], o.X[1] - Xc[1], o.X[2] - Xc[2]]).map((c) => c * mR) as Vec3;
      const dist = Math.hypot(...origin);
      if (dist > 3000) continue;
      const axes = o.axes.map((a) => unitV(toCam(a))) as [Vec3, Vec3, Vec3];
      out.push({ key: o.slot, origin, axes, speed: o.speed, airborne: o.airborne });
      this.netWalkersCam.push({
        slot: o.slot,
        at: [origin[0] + axes[1][0] * 2, origin[1] + axes[1][1] * 2, origin[2] + axes[1][2] * 2],
        dist,
      });
    }
    return out;
  }

  private encodeCharacter(enc: GPUCommandEncoder, target: Target, s: Settings) {
    const c = this.character,
      frame = c?.frame() ?? null;
    this.characterRenderer.remoteWalkers = this.netWalkersOnCamera(s);
    // (the astronaut where he walks; the living ground round the camera on the Earth, with him or without)
    const view = s.earthGrass !== "off" ? this.grassView() : null;
    const cam = this.lastCam;
    if ((!frame && !view) || !cam) {
      if (this.characterRenderer.drawing) this.characterRenderer.reset();
      return;
    }
    const ours = frame ? frame.ours : true,
      body = frame ? frame.body : "earth";
    const sp = c && frame ? c.metres() : M_METRES;
    const planet = this.lastBodies.find((b) => b.id === body);
    const sunBody = ours
      ? this.lastBodies.find((b) => b.id === "sun")
      : planet && planet.light >= 0
        ? this.lastBodies[planet.light]
        : this.lastBodies.find((b) => b.id === "star");
    // (where the light is taken: the astronaut's place, else the camera's)
    const sunOrigin = frame ? frame.sunOrigin : (homePosition(s) ?? solarState("earth", this.lastTime).pos);
    const sunWorld = ours ? solarState("sun", this.lastTime).pos : ((sunBody?.pos ?? [0, 0, 0]) as Vec3);
    const d = !ours && planet?.lightDir ? planet.lightDir : (sunWorld.map((v, i) => v - sunOrigin[i]!) as Vec3);
    const dist = Math.hypot(...d) || 1;
    // The camera-frame Sun agrees with the traced scene and the same radiance normalization.
    let L: Vec3;
    if (ours) {
      const home = homeToRep(mouth(s).w, cam.ell, cam.n, d.map((v) => v / dist) as Vec3);
      L = [dot3(home, cam.right), dot3(home, cam.up), dot3(home, cam.fwd)];
    } else {
      const sf = sphericalFrame(sunOrigin);
      const d0 = d.map((v) => v / dist) as Vec3;
      const rep: Vec3 = [dot3(d0, sf.er), dot3(d0, sf.et), dot3(d0, sf.ep)];
      L = [dot3(rep, cam.right), dot3(rep, cam.up), dot3(rep, cam.fwd)];
    }
    const elevation = dot3(L, frame ? frame.axes[1] : view!.toCamera(view!.up));
    this.characterSun = L;
    const temp = (!ours ? planet?.lightT : undefined) ?? sunBody?.temperature ?? 5772;
    const E =
      Math.PI *
      10 ** (this.logYOf(Math.round(temp / 50) * 50) - this.lastLogY) *
      (sunBody?.brightness ?? 1) *
      (!ours && planet ? planet.illum : ((sunBody?.radius ?? 0) / dist) ** 2);
    const share = ours ? sunShare(sunOrigin, this.lastTime) : Math.max(0, Math.min(1, (elevation + 0.005) / 0.01));
    const transmission = body === "earth" ? Math.exp(-0.15 / Math.max(0.08, elevation)) : 0.98;
    const daylight = Math.max(0, Math.min(1, (elevation + 0.08) / 0.2));
    const e = E * share * transmission;
    this.characterRenderer.encode(
      enc,
      target.hdr,
      target.sceneDepth,
      c && frame ? { c, frame } : null,
      view,
      {
        sun: L,
        irradiance: [e, e * (0.7 + 0.3 * daylight), e * (0.45 + 0.55 * daylight)],
        sky: body === "earth" ? [E * 0.045 * daylight, E * 0.07 * daylight, E * 0.11 * daylight] : [E * 0.007, E * 0.007, E * 0.007],
        pre: preExposure(this.ev(s)),
        metres: sp,
        fov: s.fov,
      },
      s.earthTerrain ? this.earthScenery.contact : null,
      // (the ground's data: the scenery and the terrain tiles — the grass's grid made again when they change)
      this.earthScenery.stamp * 100000 + this.earthTiles.stamp,
      s.earthGrass !== "off" ? { density: s.earthGrassDensity, reach: s.earthGrassReach, wind: s.earthGrassWind } : null,
      this.prof,
      this.earthScenery.buffer,
      {
        sh: this.ship.shBuf,
        env: (this.characterViews ??= { env: this.ship.envSpecView, shadow: this.ship.shadowView }).env,
        mips: this.ship.specMips,
        shipShadow: this.characterViews.shadow,
        // (fresh: run within the last half second — the probe refreshes every frame or every fourth)
        axes: this.ship.ready && performance.now() - this.envAt < 500 ? this.shipProbeAxes : null,
        shipBound: (s.ship || this.shipInView) && this.ship.ready ? this.ship.shadowBound : null,
      },
      {
        wind: c?.wind() ?? null,
        paved: runwayPaved,
        // (the landed vessel's box: the walker's, else asked of the walk's own conversion — no walker out)
        hull: frame ? c!.hullNow() : view && c?.body === "earth" && c.ours ? c.vesselHull() : null,
      },
    );
  }

  /** a fight's aircraft (controller/combat.ts — sim.ts): each from the flown craft's origin on the camera's axes
   *  [m], its axes on them, its pose */
  combatOthers: {
    id: ShipMeshId;
    rel: Vec3;
    axes: [Vec3, Vec3, Vec3];
    jet?: F35Pose;
    hidden?: boolean;
    far?: boolean;
    big?: boolean;
    mirror?: boolean;
  }[] = [];
  /** the scenery's exclusions: the sites' runways, the landscapes' viewpoints, the world's runways near (RD13) */
  private sceneryExclusions: SceneryExclusion[] = SCENERY_EXCLUSIONS;
  /** a fight's flares burning (controller/combat.ts combatGlares — PLAN-RADAR-AAA RD8a): each from the flown craft's
   *  origin on the camera's axes [m], its size [m], its colour (display-referred) */
  combatGlares: { rel: Vec3; r: number; rgb: Vec3 }[] = [];
  /** the ships under way near the camera, for their wakes (controller/seatraffic.ts seaWakes) */
  seaWakes: { p: Vec3; fwd: Vec3; U: number; len: number; beam: number }[] = [];

  /** the others' craft (docs/PLAN-RESEAU.md R1 — controller/netcraft.ts, ui/netsession.ts): each from the flown
   *  craft's origin on the camera's axes [m], its axes on them, an F-35's pose, its engines */
  netOthers: {
    slot: number;
    /** Gargantua's side (R8): rel and axes already on the camera's axes (the hole's map, its rest frame) */
    side?: "hole";
    id: VesselId;
    rel: Vec3;
    axes: [Vec3, Vec3, Vec3];
    /** its place [M] and axes (left, top, nose) in the home frame: placed from the camera, wherever it is */
    X: Vec3;
    axesHome: [Vec3, Vec3, Vec3];
    jet?: F35Pose;
    thrust?: { throttle: number; boost: number; air: number };
  }[] = [];

  /** The A320's ground vehicles as instances: placed in its frame, turned about its up axis — on its pose from the
   *  camera. */
  private groundShips(s: Settings): ShipInstance[] {
    const G = this.a320Ground;
    if (!G?.length || !s.ship || s.vessel !== "a320" || !this.shipPose) return [];
    const P = shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch);
    const S = P.S as unknown as [Vec3, Vec3, Vec3];
    return G.filter((v) => this.ship.has(v.id)).map((v) => {
      const c = Math.cos(v.yaw),
        n = Math.sin(v.yaw);
      // (its axes: the ship's turned about y — x' = x c + z n, z' = −x n + z c —, then to the camera's)
      const Ry: [Vec3, Vec3, Vec3] = [
        [c, 0, n],
        [0, 1, 0],
        [-n, 0, c],
      ];
      const M = [0, 1, 2].map((r) => [0, 1, 2].map((k) => S[r]![0]! * Ry[0]![k]! + S[r]![1]! * Ry[1]![k]! + S[r]![2]! * Ry[2]![k]!)) as [
        Vec3,
        Vec3,
        Vec3,
      ];
      const t = [0, 1, 2].map((r) => S[r]![0]! * v.p[0] + S[r]![1]! * v.p[1] + S[r]![2]! * v.p[2] + P.t[r]!) as Vec3;
      // (on the ground beside the craft: not hidden by the traced ground's coarse depth — as the craft itself)
      return { id: v.id, S: M, t, shadow: true, far: false };
    });
  }

  private shipOthers(s: Settings): ShipInstance[] {
    const extra = [...this.groundShips(s), ...this.netShips(s), ...this.combatShips(s), ...this.holeShips(s)];
    return extra.length ? [...extra, ...this.fleetOthers(s)] : this.fleetOthers(s);
  }

  /** where the others' craft were drawn last (their tags): over each, from the eye [m] */
  netShipsCam: { slot: number; at: Vec3; dist: number }[] = [];

  /** The others' craft as instances: their place from the camera (as the fleet's: a walker far from his own craft
   *  sees another's beside him), their axes, their engines; near ones in the shadow map (a wingman's shadow on the
   *  flown craft, and its on his). */
  private netShips(s: Settings): ShipInstance[] {
    this.netShipsCam = [];
    const cam = this.lastCam;
    // (Gargantua's side — R8 —: placed from the camera already, on its axes)
    if (this.netOthers.length && cam?.region === "hole") {
      const eye = s.ship && this.shipPose ? shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t : ([0, 0, 0] as Vec3);
      return this.netOthers
        .filter((o) => o.side === "hole")
        .map((o) => ({
          id: o.id,
          S: [0, 1, 2].map((k) => [o.axes[0][k]!, o.axes[1][k]!, o.axes[2][k]!]) as [Vec3, Vec3, Vec3],
          t: [o.rel[0] + eye[0], o.rel[1] + eye[1], o.rel[2] + eye[2]] as Vec3,
          shadow: Math.hypot(...o.rel) < vesselHulls[o.id].radius + vesselHulls[s.vessel].radius + 60,
          jet: o.jet,
          thrust: o.thrust,
          far: true,
        }));
    }
    if (!this.netOthers.length || !cam || s.system !== "gargantua" || !s.wormhole || cam.region !== "throat" || cam.ell >= 0) return [];
    const w = mouth(s).w;
    const Xc = homeOf(w, cam.ell, cam.n);
    const mR = 1476.625 * (s.massSolar || 1);
    const toCam = (v: Vec3): Vec3 => {
      const r = homeToRep(w, cam.ell, cam.n, v);
      return [dot3(r, cam.right), dot3(r, cam.up), dot3(r, cam.fwd)];
    };
    const unitV = (v: Vec3): Vec3 => {
      const l = Math.hypot(...v) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const eye = s.ship && this.shipPose ? shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t : ([0, 0, 0] as Vec3);
    return this.netOthers
      .filter((o) => o.side !== "hole")
      .map((o) => {
        const t = toCam([o.X[0] - Xc[0], o.X[1] - Xc[1], o.X[2] - Xc[2]]).map((c, k) => c * mR + eye[k]!) as Vec3;
        const a = o.axesHome.map((v) => unitV(toCam(v))) as [Vec3, Vec3, Vec3];
        const sep = Math.hypot(...t.map((c, k) => c - eye[k]!));
        this.netShipsCam.push({ slot: o.slot, at: t, dist: Math.hypot(...t) });
        return {
          id: o.id,
          S: [0, 1, 2].map((k) => [a[0][k]!, a[1][k]!, a[2][k]!]) as [Vec3, Vec3, Vec3],
          t,
          shadow: sep < vesselHulls[o.id].radius + vesselHulls[s.vessel].radius + 60,
          jet: o.jet,
          thrust: o.thrust,
          far: true,
        };
      });
  }

  /**
   * The sea the craft are mirrored in (ship.ts ShipView.sea): within 20 km over the Earth on our side, its plane —
   * the ellipsoid's h = 0 under the flown craft (WGS84: its height, its normal there) — on the camera's axes from the
   * eye; whether the flown craft is over it (the relief under it at sea level); its waves' height.
   */
  private shipSea(s: Settings): ShipView["sea"] {
    const cam = this.lastCam;
    if (!cam || s.system !== "gargantua" || !s.wormhole || cam.region !== "throat" || cam.ell >= 0) return null;
    const time = this.lastTime;
    const w = mouth(s).w;
    const Xc = homeOf(w, cam.ell, cam.n);
    // (the height over the sea, its surface at the geoid)
    const Xb = toBodyFixed("earth", Xc, time);
    const sea = geoidUnder(Xb);
    const h = altitudeOver("earth", Xc, time) - sea;
    if (!(h < 20_000) || !(h > -50)) return null;
    const upH = figureUp("earth", Xc, time);
    const r = homeToRep(w, cam.ell, cam.n, upH);
    const n0: Vec3 = [dot3(r, cam.right), dot3(r, cam.up), dot3(r, cam.fwd)];
    const l = Math.hypot(...n0) || 1;
    const n: Vec3 = [n0[0] / l, n0[1] / l, n0[2] / l];
    const eye = s.ship && this.shipPose ? shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t : ([0, 0, 0] as Vec3);
    // (the flown craft's image under 500 m — higher, the waves have scattered it)
    const flown = h < 500 && groundRelief("earth", Xb) - sea < 0.5;
    return { n, d: dot3(n, eye) - h, hs: this.seaHs, t: (performance.now() / 1000) % 3600, flown };
  }

  /** The fight's flares as the lamps' glares: their place from the eye (as the fight's aircraft's). */
  private glaresNow(s: Settings): { c: Vec3; r: number; rgb: Vec3 }[] {
    if (!this.combatGlares.length || !s.ship || !this.shipPose) return [];
    const eye = shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t;
    return this.combatGlares.map((g) => ({ c: [g.rel[0] + eye[0], g.rel[1] + eye[1], g.rel[2] + eye[2]] as Vec3, r: g.r, rgb: g.rgb }));
  }

  /** The fight's aircraft as instances: their place from the eye, their axes. */
  private combatShips(s: Settings): ShipInstance[] {
    if (!this.combatOthers.length || !s.ship || !this.shipPose) return [];
    const eye = shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t;
    return this.combatOthers
      .filter((o) => !o.hidden)
      .map((o) => ({
        id: o.id,
        S: [0, 1, 2].map((k) => [o.axes[0][k]!, o.axes[1][k]!, o.axes[2][k]!]) as [Vec3, Vec3, Vec3],
        t: [o.rel[0] + eye[0], o.rel[1] + eye[1], o.rel[2] + eye[2]] as Vec3,
        shadow: false,
        jet: o.jet,
        // (a fight's aircraft always over the image; the traffic's hidden behind what it holds nearer — a cloud, a
        // mountain)
        far: o.far ?? false,
        big: o.big,
        mirror: o.mirror,
      }));
  }

  /** The fleet's Endurance on Gargantua's side, near the camera: at its true size (holefleet.ts). */
  private holeShips(s: Settings): ShipInstance[] {
    const h = this.lastCam?.region === "hole" ? holeFleet.source?.() : null;
    if (!h) return [];
    const eye = s.ship && this.shipPose ? shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t : ([0, 0, 0] as Vec3);
    return h.items.map((o) => ({
      id: o.id,
      S: [0, 1, 2].map((k) => [o.axes[0][k]!, o.axes[1][k]!, o.axes[2][k]!]) as [Vec3, Vec3, Vec3],
      t: [o.rel[0] + eye[0], o.rel[1] + eye[1], o.rel[2] + eye[2]] as Vec3,
      shadow: Math.hypot(...o.rel) < vesselHulls[o.id].radius + vesselHulls[s.vessel].radius + 60,
      far: true,
    }));
  }

  private fleetOthers(s: Settings): ShipInstance[] {
    const cam = this.lastCam;
    if (!cam || s.system !== "gargantua" || !s.wormhole || cam.region !== "throat" || cam.ell >= 0) return [];
    const time = this.lastTime;
    const w = mouth(s).w;
    const Xc = homeOf(w, cam.ell, cam.n);
    const mR = 1476.625 * (s.massSolar || 1);
    const toCam = (v: Vec3): Vec3 => {
      const r = homeToRep(w, cam.ell, cam.n, v);
      return [
        r[0] * cam.right[0] + r[1] * cam.right[1] + r[2] * cam.right[2],
        r[0] * cam.up[0] + r[1] * cam.up[1] + r[2] * cam.up[2],
        r[0] * cam.fwd[0] + r[1] * cam.fwd[1] + r[2] * cam.fwd[2],
      ];
    };
    const unitV = (v: Vec3): Vec3 => {
      const l = Math.hypot(...v) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const eye = s.ship && this.shipPose ? shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t : ([0, 0, 0] as Vec3);
    const out: ShipInstance[] = [];
    for (const o of fleet.others(time, !s.ship && !this.shipPlace)) {
      const rel = toCam([o.pose.X[0] - Xc[0], o.pose.X[1] - Xc[1], o.pose.X[2] - Xc[2]]).map((c, k) => c * mR + eye[k]!) as Vec3;
      // (the flown craft's origin is the camera's place: its distance from it, not from the eye)
      const sep = Math.hypot(...rel.map((c, k) => c - eye[k]!));
      if (Math.hypot(...rel) > 6e4) continue;
      const a = o.pose.ax.map((v) => unitV(toCam(v))) as [Vec3, Vec3, Vec3];
      const S: [Vec3, Vec3, Vec3] = [0, 1, 2].map((k) => [a[0][k]!, a[1][k]!, a[2][k]!]) as [Vec3, Vec3, Vec3];
      // (none flown: the craft near the camera in the shadow map)
      out.push({
        id: o.id,
        S,
        t: rel,
        shadow: s.ship ? sep < vesselHulls[o.id].radius + vesselHulls[s.vessel].radius + 150 : sep < 4 * (vesselHulls[o.id].radius || 40),
      });
    }
    return out;
  }

  /**
   * The International Space Station: on our side near the Earth (within 3 000 km), where SGP4 — or,
   * near the ship, the game's own fall — puts it; seen from the camera (rep vectors at the camera, its
   * axes), its arrays turned to the Sun. Lit by the Sun — its share above the Earth's limb, reddened
   * through the air there — and by the Earth's sunlit disc below it (on harmonics).
   */
  private encodeStation(enc: GPUCommandEncoder, t: Target, s: Settings) {
    this.station.rect = [0, 0, 0, 0];
    const cam = this.lastCam;
    if (!s.iss || !cam || s.system !== "gargantua" || !s.wormhole || cam.region !== "throat" || cam.ell >= 0) return;
    const time = this.lastTime;
    const w = mouth(s).w;
    const Xc = homeOf(w, cam.ell, cam.n);
    const E = solarState("earth", time);
    const mR = 1476.625 * (s.massSolar || 1);
    const hE = altitudeOver("earth", Xc, time) / 1e3;
    if (!(hE < 3000)) return;
    void refreshIssElements();
    if (!this.station.ready) {
      this.stationLoading ??= loading
        .track(
          "iss",
          STATION_LOADING,
          this.station.load((u) => loading.fetch(u, "iss")),
        )
        .then(
          () => this.invalidate(),
          (e) => console.error("ISS:", e),
        );
      return;
    }
    const st = issTrack.state(time, Xc);
    if (!st) return;
    const toCam = (v: Vec3): Vec3 => {
      const r = homeToRep(w, cam.ell, cam.n, v);
      return [
        r[0] * cam.right[0] + r[1] * cam.right[1] + r[2] * cam.right[2],
        r[0] * cam.up[0] + r[1] * cam.up[1] + r[2] * cam.up[2],
        r[0] * cam.fwd[0] + r[1] * cam.fwd[1] + r[2] * cam.fwd[2],
      ];
    };
    const unitV = (v: Vec3): Vec3 => {
      const l = Math.hypot(...v) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const relH: Vec3 = [st.X[0] - Xc[0], st.X[1] - Xc[1], st.X[2] - Xc[2]];
    const rel = toCam(relH).map((c) => c * mR) as Vec3;
    // (seen from the camera's eye — its attach point, or the outside views' place —, not the ship's centre)
    if (s.ship && this.shipPose) {
      const e = shipToCamera(this.shipPose, s.shipLookYaw, s.shipLookPitch).t;
      for (let k = 0; k < 3; k++) rel[k]! += e[k]!;
    }
    if (Math.hypot(...rel) > 3.5e6) return;
    const A = issAxes(st.X, st.V, time);
    const axes = A.map((a) => unitV(toCam(a))) as [Vec3, Vec3, Vec3];
    // the Sun from the station: its direction, its disc's share above the Earth's limb (the air's 30 km
    // counted in), reddened through it
    const bodies = this.lastBodies;
    const sunB = bodies.find((b) => b.id === "sun");
    const S = solarState("sun", time).pos;
    const toSun: Vec3 = [S[0] - st.X[0], S[1] - st.X[1], S[2] - st.X[2]];
    const dS = Math.hypot(...toSun);
    const sunH = unitV(toSun);
    const toE: Vec3 = [E.pos[0] - st.X[0], E.pos[1] - st.X[1], E.pos[2] - st.X[2]];
    const dE = Math.hypot(...toE);
    const earthAxes = bodyAxes(solarBody("earth")!, time);
    const inEarth = (v: Vec3): Vec3 => earthAxes.map((axis) => axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]) as Vec3;
    const observer = inEarth(toE.map((v) => -v) as Vec3);
    const source = inEarth(sunH);
    const rhoS = Math.asin(Math.min((sunB?.radius ?? 0.00471 * dS) / dS, 1));
    const airA = (WGS84_A + 30e3) / mR;
    const airF = (WGS84_A * WGS84_F) / (WGS84_A + 30e3);
    const share = figureDiskShare(observer, source, rhoS, airA, airF);
    const x = Math.max(-1, Math.min(1, figureSourceElevation(observer, source, airA, airF) / Math.max(rhoS, 1e-6)));
    const red = Math.sqrt(Math.max(0, Math.min(1, (x + 1) / 2)));
    const T = sunB?.temperature ?? 5772;
    const bb = blackbodyXYZ(T);
    const rgb0 = xyzToLinearSRGB([bb[0] / bb[1], 1, bb[2] / bb[1]]).map((c) => Math.max(c, 0)) as Vec3;
    const lum = 0.2126 * rgb0[0] + 0.7152 * rgb0[1] + 0.0722 * rgb0[2];
    const Esun =
      Math.PI * 10 ** (this.logYOf(Math.round(T / 50) * 50) - this.lastLogY) * (sunB?.brightness ?? 1) * ((sunB?.radius ?? 0) / dS) ** 2;
    const tint: Vec3 = [1, 0.5 + 0.5 * red, 0.25 + 0.75 * red];
    const sunE = rgb0.map((c, k) => (c / lum) * Esun * share * tint[k]!) as Vec3;
    // the Earth's sunlit disc below: its radiance (albedo 0.3, Lambert, a little blue) over the cap it
    // fills, on order-2 harmonics (camera frame)
    const sh = new Array<number>(27).fill(0);
    const eDir = unitV(toE);
    const cosCap = Math.cos(Math.asin(Math.min(EARTH_RM / mR / dE, 1)));
    const aux: Vec3 = Math.abs(eDir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const ex = unitV([eDir[1] * aux[2] - eDir[2] * aux[1], eDir[2] * aux[0] - eDir[0] * aux[2], eDir[0] * aux[1] - eDir[1] * aux[0]]);
    const ey: Vec3 = [eDir[1] * ex[2] - eDir[2] * ex[1], eDir[2] * ex[0] - eDir[0] * ex[2], eDir[0] * ex[1] - eDir[1] * ex[0]];
    const N = 96;
    const dOmega = (2 * Math.PI * (1 - cosCap)) / N;
    const earthCol = [0.85, 0.93, 1.0];
    const rEm = EARTH_RM / mR;
    for (let k = 0; k < N; k++) {
      // (a Fibonacci spiral over the cap)
      const cz = 1 - ((k + 0.5) / N) * (1 - cosCap);
      const sz = Math.sqrt(1 - cz * cz);
      const ph = k * 2.399963229728653;
      const d: Vec3 = [0, 1, 2].map((i) => eDir[i]! * cz + (ex[i]! * Math.cos(ph) + ey[i]! * Math.sin(ph)) * sz) as Vec3;
      // where it meets the ground, the Sun's height there
      const ray = inEarth(d);
      const tt = rayFigure(observer, ray, rEm, WGS84_F);
      if (tt === null) continue;
      const point = observer.map((v, i) => v + ray[i]! * tt) as Vec3;
      const normal = geodeticNormal(rEm, WGS84_F, point);
      const mu = Math.max(0, normal[0] * source[0] + normal[1] * source[1] + normal[2] * source[2]);
      if (mu <= 0) continue;
      const L = (0.3 / Math.PI) * Esun * mu;
      const dc = toCam(d);
      const dl = Math.hypot(...dc) || 1;
      const [nx, ny, nz] = [dc[0] / dl, dc[1] / dl, dc[2] / dl];
      const Y = [
        0.282095,
        0.488603 * ny,
        0.488603 * nz,
        0.488603 * nx,
        1.092548 * nx * ny,
        1.092548 * ny * nz,
        0.315392 * (3 * nz * nz - 1),
        1.092548 * nx * nz,
        0.546274 * (nx * nx - ny * ny),
      ];
      for (let q = 0; q < 9; q++) for (let ch = 0; ch < 3; ch++) sh[3 * q + ch]! += L * earthCol[ch]! * (rgb0[ch]! / lum) * Y[q]! * dOmega;
    }
    const view: StationView = {
      rel,
      axes,
      angles: stationAngles(time, st.X, st.V),
      sun: unitV(toCam(sunH)),
      sunRadius: rhoS,
      sunE,
      sh,
      tanH: Math.tan((s.fov * Math.PI) / 360),
      aspect: t.width / t.height,
      pre: preExposure(this.ev(s)),
      mPerM: mR,
    };
    this.station.encode(enc, t.hdr, t.sceneDepth, view);
  }

  /**
   * How far the Ranger's light probe's view moved since the last frame [rad]. Its axes do not turn
   * with the camera: only the camera's travel moves what it sees — the parallax of the bodies large
   * or bright enough to light the ship (and of the hole, of the mouth), the aberration of its changing
   * velocity, the ZAMO's axes turning as it goes round the hole. Infinity: a jump (the other side,
   * the sky's brightness changed).
   */
  private probeDrift(
    s: Settings,
    cam: CameraFrame,
    bodies: GpuBody[],
    origin: Vec3,
    m: ReturnType<typeof mouth>,
    time: number,
    sky: number,
  ) {
    const texel = Math.PI / ENV_H;
    const things = new Map<string, Vec3>();
    const add = (id: string, v: Vec3, radius: number, star: boolean) => {
      const d = Math.hypot(v[0], v[1], v[2]);
      if (d > 0 && (star || radius / d > 0.25 * texel)) things.set(id, [v[0] / d, v[1] / d, v[2] / d]);
    };
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const list = bodies.slice(0, MAX_BODIES);
    const start = ourStart(list);
    const side = cam.region === "hole" ? "hole" : cam.ell < 0 ? "ours" : "theirs";
    let er: Vec3 = [0, 0, 0];
    if (side === "ours") {
      list.forEach((b, k) => k >= start && add(b.id, sub(b.pos, origin), b.radius, b.kind === BODY_STAR));
    } else {
      const st = Math.sin(cam.theta);
      const X: Vec3 =
        side === "hole" ? [cam.r * st * Math.cos(cam.phi), cam.r * st * Math.sin(cam.phi), cam.r * Math.cos(cam.theta)] : (m.C as Vec3);
      if (side === "hole") er = [st * Math.cos(cam.phi), st * Math.sin(cam.phi), Math.cos(cam.theta)];
      add("hole", [-X[0], -X[1], -X[2]], Math.max(s.disk ? s.diskOuter : 0, 3), false);
      list.forEach((b, k) => k < start && add(b.id, sub(bodyPlace(list, k), X), b.radius, b.kind === BODY_STAR));
      if (s.wormhole && side === "hole") add("mouth", sub(m.C as Vec3, X), m.w.rho, false);
    }
    // (in the throat's region: the mouth around the camera)
    if (s.wormhole && side !== "hole")
      add("mouth", [-cam.n[0], -cam.n[1], -cam.n[2]], m.w.rho / Math.max(radius(m.w, cam.ell)[0], m.w.rho), false);
    const prev = this.probeSeen;
    this.probeSeen = { side, things, beta: [...cam.beta], er, time, sky };
    if (!prev || prev.side !== side) return Infinity;
    // (the sky's brightness follows the auto exposure: what the probe holds of it is then stale — by
    // half a stop or more, written over in 4 frames; less, its running mean shortened to a few frames)
    const skyStops = Math.abs(Math.log2(sky / prev.sky));
    if (skyStops > 0.5) this.envSpread = 4;
    const skyMoved = skyStops > 0.01 ? texel : 0;
    const angle = (a: Vec3, b: Vec3) => 2 * Math.asin(Math.min(1, 0.5 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));
    // the probe's axes turning: the ZAMO's around the hole, the throat's with the orbiting mouth
    const turn = side === "hole" ? angle(er, prev.er) : side === "theirs" ? Math.abs(m.omega * (time - prev.time)) : 0;
    let moved = Math.hypot(cam.beta[0] - prev.beta[0], cam.beta[1] - prev.beta[1], cam.beta[2] - prev.beta[2]);
    for (const [id, d] of things) {
      const p = prev.things.get(id);
      if (p) moved = Math.max(moved, angle(d, p));
    }
    return Math.max(turn + moved, skyMoved);
  }

  /** The Ranger is drawn (its mesh loaded). */
  get shipReady() {
    return this.ship.ready;
  }

  /** The light the Ranger's probe holds now: the luminance of its harmonics' L0 (read back). */
  async readShipLight(): Promise<number> {
    const st = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.ship.shBuf, 0, st, 0, 16);
    this.device.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(st.getMappedRange().slice(0));
    st.unmap();
    st.destroy();
    return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!;
  }

  /** Exposure in use [EV]: the setting, plus the meter's with auto exposure. */
  ev(s: Settings) {
    return s.exposure + (s.autoExposure ? this.autoEVDrawn : 0);
  }

  /** the meter's last reading [EV]: where the auto exposure is going */
  private meterTarget = NaN;
  /** The auto exposure come to the meter's reading (within a tenth of a stop) — a multiple exposure's frame waits for it. */
  get meterSettled() {
    return Number.isFinite(this.meterTarget) && Math.abs(this.meterTarget - this.autoEVDrawn) < 0.1;
  }

  /** The auto exposure's value in use [EV] — a take keeps it, a video sets it back frame by frame. */
  get autoExposureEV() {
    return this.autoEVDrawn;
  }
  set autoExposureEV(ev: number) {
    this.autoEV = this.autoEVDrawn = ev;
    this.autoEVSet = true;
  }

  /** The predicted path drawn now (setCameraPath's), for a take. */
  get cameraPath() {
    return this.pathKey;
  }

  /**
   * The meter opening for an eclipsed Moon in the frame (PLAN-CIEL C6), as a camera's would: the light it
   * reads lowered by the Moon's own dimming (a ten-thousandth at the totality's heart) — the brightest
   * pixels (the Moon) then hold it back; the sky, drawn at its own scale under the auto exposure, unchanged.
   */
  private eclipsedMoonMeter(s: Settings, cam: CameraFrame, bodies: GpuBody[], aspect: number): number {
    if (this.moonLight >= 0.5) return 1;
    const X = homePosition(s);
    const moon = bodies.find((b) => b.id === "moon");
    if (!X || !moon) return 1;
    const v: Vec3 = [moon.pos[0] - X[0], moon.pos[1] - X[1], moon.pos[2] - X[2]];
    const l = Math.hypot(...v);
    const f = lookOf(s, cam, [v[0] / l, v[1] / l, v[2] / l]);
    const half = Math.atan(Math.tan((s.fov * Math.PI) / 360) * Math.hypot(1, aspect));
    const c = f[0] * cam.fwd[0] + f[1] * cam.fwd[1] + f[2] * cam.fwd[2];
    return c > Math.cos(half) ? Math.max(this.moonLight, 2e-4) : 1;
  }

  /** The sky's brightness factor: auto exposure keeps the (artistic) sky as it looks on screen. */
  private skyScale(s: Settings) {
    return s.autoExposure ? 2 ** -this.autoEVDrawn : 1;
  }

  /**
   * The light falling where the camera is (the disk's units: luminance of a white surface over π,
   * albedo 0.3): the accretion disk seen from here (its face and lensed images, a first estimate —
   * scene-bodies.ts: planetLight) and the stars at their distance.
   */
  private incidentLight(
    s: Settings,
    cam: CameraFrame,
    bodies: GpuBody[],
    origin: Vec3,
    logYRef: number,
    near: ReturnType<typeof localPatch> = null,
    earthSurface: ReturnType<typeof patchGeodetic> | null = null,
  ) {
    const ours = s.wormhole && cam.region === "throat" && cam.ell < 0;
    let E = 0;
    let X: Vec3 | null = null;
    if (!ours) {
      X =
        cam.region === "hole"
          ? [cam.r * Math.sin(cam.theta) * Math.cos(cam.phi), cam.r * Math.sin(cam.theta) * Math.sin(cam.phi), cam.r * Math.cos(cam.theta)]
          : (mouth(s).C as Vec3);
      const r = Math.max(Math.hypot(...X), 2);
      // (near a world the disk lights — Miller, Mann —: the light its probe measured there, the disk as
      // its ground sees it, part of it hidden, not the disk's whole face)
      const nb = near ? bodies[near.index] : undefined;
      if (nb && nb.kind === BODY_PLANET && nb.light < 0 && nb.illum > 0) E += nb.illum;
      else if (s.disk) E += Math.min((0.75 * (Math.max(s.diskOuter, 2) ** 2 - 4)) / (r * r), 1);
    }
    const start = ourStart(bodies);
    bodies.slice(0, MAX_BODIES).forEach((b, k) => {
      if (b.kind !== BODY_STAR) return;
      let d: number;
      if (k >= start) {
        if (!ours) return;
        d = Math.hypot(b.pos[0] - origin[0], b.pos[1] - origin[1], b.pos[2] - origin[2]);
      } else {
        if (ours || !X) return;
        const P = bodyPlace(bodies, k);
        d = Math.hypot(P[0] - X[0], P[1] - X[1], P[2] - X[2]);
      }
      const T = Math.round(b.temperature / 50) * 50;
      E +=
        10 ** (this.logYOf(T) - logYRef) *
        b.brightness *
        (b.radius / Math.max(d, b.radius)) ** 2 *
        this.earthSunlight(bodies, near, earthSurface);
    });
    return 0.3 * E;
  }

  /**
   * Near the Earth (its local patch), the share of the sunlight reaching the camera: through its air,
   * reddened and dimmed low, none in its shadow — a quarter at least (twilight, night: 2
   * stops more; the cities show already, more and the stars fade, the ship's own lights blind).
   */
  private earthSunlight(bodies: GpuBody[], near: ReturnType<typeof localPatch>, surface: ReturnType<typeof patchGeodetic> | null) {
    // (Mars in a dust storm — W6 —: the day a third as bright under it; the eye opens to it)
    if (near && bodies[near.index]?.id === "mars") return 1 - 0.55 * this.marsDustNow;
    if (!near || bodies[near.index]?.id !== "earth") return 1;
    const place = surface ?? patchGeodetic(near, WGS84_F);
    const mu = place.up.reduce((v, n, i) => v + n * near.light[i]!, 0);
    // (and an eclipse: the Sun's disk the Moon leaves — the totality's twilight, ten stops down)
    const home = this.meterHome;
    const ecl = home ? sunShare(home, this.meterTime) : 1;
    return Math.max(sunThroughY(Math.max(place.h * EARTH_RM, 0), mu), 0.25) * Math.max(ecl, 0.002) * this.wxLight;
  }
  /** the share of the daylight the weather's decks and fog let down to the camera (weatherParams; 1: none) */
  private wxLight = 1;
  /** where the meter reads the light (home frame) and when */
  private meterHome: Vec3 | null = null;
  private meterTime = 0;

  /**
   * The meter's reading: exposure for the light falling here (a white surface in it well exposed),
   * held back when the scene's brightest 0.5 % (brighter than any sky) would burn out; eased.
   */
  private readMeter(h: Uint32Array) {
    let total = 0;
    for (const c of h) total += c;
    if (!total) return;
    const Lof = (b: number) => 2 ** ((b + 0.5) / 1.5 - 48) / this.meterPre;
    // (a quantile within its bin — its share of the bin's count, the bin's top down: the bins are 0.67 EV
    // wide, a quantile falling now in one, now in the next, jumped the exposure by that much, to and fro)
    const within = (b: number, before: number, need: number) =>
      2 ** ((b + 1 - (need - before) / Math.max(h[b]!, 1)) / 1.5 - 48) / this.meterPre;
    let acc = 0,
      Lhi = 0;
    // (the sky's brightest, as the exposure the light falling here asks for would draw it — not the
    // exposure in use: the sky's scale follows it, and a haze at that threshold made the meter swing
    // 0.3 EV from one reading to the next, the image pumping)
    const evRef = this.meterIncident > 0 ? Math.min(Math.max(Math.log2(0.4 / this.meterIncident), -6), 32) : this.meterEVUsed;
    const skyRef = this.meterSkyUsed * 2 ** (this.meterEVUsed - evRef);
    for (let b = 127; b >= 1; b--) {
      if (Lof(b) < skyRef) break;
      const before = acc;
      acc += h[b]!;
      if (acc >= 0.005 * total) {
        Lhi = within(b, before, 0.005 * total);
        break;
      }
    }
    let m = this.meterIncident > 0 ? 0.4 / this.meterIncident : 2 ** this.autoEV;
    if (Lhi > 0) m = Math.min(m, 6 / Lhi);
    // (the telescope's spot: the target's disc alone — its brightest part put just under white, the sky behind it
    // kept dark: a faint galaxy, the wormhole's mouth and the other universe in it drawn bright, the Moon not burnt.
    // Its brightest three per mille: the object's core however little of the disc it fills — at two per cent the
    // night's glow round a small object was read, and the whole field went grey)
    if (!this.meterSpotUsed) this.spotSky = 0;
    if (this.meterSpotUsed) {
      const quantile = (q: number) => {
        let a = 0;
        for (let b = 127; b >= 1; b--) {
          const before = a;
          a += h[b]!;
          if (a >= q * total) return within(b, before, q * total);
        }
        return 0;
      };
      const core = quantile(0.015),
        sky = quantile(0.5);
      // (a frame burnt flat — the image's own buffer full at an exposure pushed too far: every cell in a bin or two,
      // no contrast left to read — stepped down until it shows again; the spot never more than 6 EV over what the
      // image's own meter asks: a cloud's veil read as the object pushed it 10 EV and locked it there)
      // (burnt: that bin over white at the exposure now — a frame dark throughout, the Moon's night side over the telescope's
      // whole field at totality, is no burnt frame: read as one it stepped the exposure down to its floor and kept it there,
      // the corona and the beads after it black)
      let fb = 0;
      for (let b = 1; b < 128; b++) if (h[b]! > h[fb]!) fb = b;
      const flat = h[fb]! > 0.9 * total && fb > 0 && Lof(fb) * this.meterGain * 2 ** this.autoEV > 0.5;
      const base = m;
      if (flat) m = 2 ** (this.autoEV - 4);
      else if (core > 0) m = 0.85 / (this.meterGain * core);
      m = Math.min(m, base * 2 ** 6);
      // (the sky behind it — the night's own glow in front of a faint object, a few times dimmer than its core —:
      // its median taken as the black point, as an astrophotographer stretches a frame; the object then bright on
      // black, not on a grey veil. Not past half the way to white: a disc with no object in it stays a sky)
      if (sky > 0) m = Math.min(m, 0.5 / (this.meterGain * sky));
      // (an object over its sky, however thin a haze or a cloud's veil it shows through: stretched on black — not a solid
      // body's disc: the spot's median there is its own ground, the Moon's maria put to black, its highlands burnt orange)
      this.spotSky = !flat && !this.meterSpot?.solid && sky > 0 && core > 1.15 * sky ? sky : 0;
      this.spotRead = { core, sky, total, m, gain: this.meterGain, hist: Array.from(h) };
    }
    // (in the Earth's air, its sky is the scene, not a backdrop: a camera's meter besides — no more than a
    // fiftieth of the image over white once the tone map's own gain is in (a sunset's glow round the sun;
    // the disk itself is fewer pixels). Only ever less exposure: night and space as the light sets them)
    if (this.meterInAir && !this.meterSpotUsed) {
      let acc2 = 0;
      for (let b = 127; b >= 1; b--) {
        const before = acc2;
        acc2 += h[b]!;
        if (acc2 >= 0.02 * total) {
          m = Math.min(m, 1 / (this.meterGain * within(b, before, 0.02 * total)));
          break;
        }
      }
    }
    const target = Math.min(Math.max(Math.log2(m), -6), 32);
    this.meterTarget = target;
    const now = performance.now();
    const dt = Math.min((now - this.meterAt) / 1000, 1);
    this.meterAt = now;
    // (the scene still a quarter of a second — paused, the camera at rest —: the image refines, and its own noise
    // going moves the meter; the exposure held, a new image only for a real change, at once — before, each
    // drift of a twentieth of a stop restarted the refining, over and over)
    if (this.autoEVSet && now - this.sceneAt > 250) {
      this.meterAt = now;
      if (Math.abs(target - this.autoEVDrawn) > 1) {
        this.autoEV = this.autoEVDrawn = target;
        this.evRedraw = true;
        this.onAssets?.();
      }
      return;
    }
    // (eased over ~1 s, a third of the gap at most a reading — the eye's pace; the brightest pixels the
    // exposure itself clips made a bolder easing swing from one reading to the next; a jump of more than
    // 6 EV — a new scene — at once)
    if (!this.autoEVSet || Math.abs(target - this.autoEV) > 6) {
      this.autoEV = target;
      this.autoEVSet = true;
    } else this.autoEV += (target - this.autoEV) * Math.min(0.3, dt / 1.0);
    // (the scene moving — time running, the camera turning —: each frame is new anyway, the exposure
    // follows it smoothly; in steps of a twentieth of a stop it flickered, the ground's brightness 6 % up
    // and down from one frame to the next)
    if (now - this.sceneAt < 250) {
      this.autoEVDrawn = this.autoEV;
      return;
    }
    // (a new image only when it shows: the sky's scale is part of the scene)
    if (Math.abs(this.autoEV - this.autoEVDrawn) > 0.05) {
      this.autoEVDrawn = this.autoEV;
      this.evRedraw = true;
      this.onAssets?.();
    }
  }

  private encodeDisplay(enc: GPUCommandEncoder, t: Target, pipeline: GPURenderPipeline, view: GPUTextureView) {
    const rp = enc.beginRenderPass(
      this.prof.pass("display", {
        colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
      }),
    );
    rp.setPipeline(pipeline);
    // (the temporal upsampling's image where it was drawn this frame — at the canvas's size —, else the render's)
    const up = t.taau?.on ? this.taauDisplayBind(t, pipeline) : null;
    rp.setBindGroup(0, up ?? t.displayBinds.get(pipeline)!);
    rp.draw(3);
    rp.end();
  }

  /** The sky's discs' rectangles in the image's pixels [x0, y0, w, h | body << 16 | rays4 << 17] (skyDiscs, a margin of 3 px —
   *  the jitter, the edge's antialiasing —, clipped to the image; none off it). However wide — the telescope's Moon over the
   *  whole image, one ray a pixel (the sky's 16 × 16 blocks blurred it to a smear) —; four rays a pixel only for a small one
   *  (96 × 96 px at most: its limb far past white, a single jittered ray flickering white or sky — trace.wgsl main) */
  private discRects(t: Target): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const d of this.skyDiscs) {
      if (out.length >= SKY_DISCS_MAX) break;
      const cx = (0.5 + 0.5 * d.x) * t.width,
        cy = (0.5 - 0.5 * d.y) * t.height,
        r = 0.5 * d.r * t.height + 3;
      const x0 = Math.max(0, Math.floor(cx - r)),
        y0 = Math.max(0, Math.floor(cy - r)),
        x1 = Math.min(t.width, Math.ceil(cx + r)),
        y1 = Math.min(t.height, Math.ceil(cy + r));
      if (x1 <= x0 || y1 <= y0) continue;
      // (the body in the height's word's high bits: 1 the Moon — trace.wgsl DISC_KIND —, then the four rays' bit)
      const area = (x1 - x0) * (y1 - y0);
      // (a wide one held still in the view — discsStill: the stabilised telescope —: a 2 × 2 block's pixel a frame, in turn)
      // (the Sun and the Moon still to each other — half an arcsecond a second —: either held, both)
      const il = (this.discsStill === "moon" || this.discsStill === "sun") && area > 160 * 160;
      // (the widest — over 256² px, the telescope's Sun or Moon over the field —: a 4 × 4 block's pixel a frame, four rays
      // each — a quarter of a ray a pixel —, its full resolution in sixteen frames — the disc held to 0.05 px a frame)
      const il4 = il && area > 256 * 256;
      out.push([
        x0,
        y0,
        x1 - x0,
        (y1 - y0) | ((d.moon ? 1 : 0) << 16) | ((area <= 96 * 96 ? 1 : 0) << 17) | ((il ? 1 : 0) << 18) | ((il4 ? 1 : 0) << 19),
      ]);
    }
    return out;
  }
  /** the sea's probe (seaSeenStamp): its copy encoded every SEA_PROBE_FRAMES frames while the raster draws the water */
  private seaProbeFor(enc: GPUCommandEncoder): GPUBuffer | null {
    const t = this.live;
    if (!t || !this.rasterWaterNow || this.seaProbeBusy || this.frameStamp - this.seaProbeAt < SEA_PROBE_FRAMES) return null;
    this.seaProbe ??= this.device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(t.stamps, t.stamps.size - 4, this.seaProbe, 0, 4);
    this.seaProbeAt = this.frameStamp;
    return this.seaProbe;
  }
  private seaProbe: GPUBuffer | null = null;
  private seaProbeBusy = false;
  private seaProbeAt = 0;
  /** the frame the raster last drew some sea (shadeWater's stamp, read back) */
  private seaSeenStamp = 0;

  /** `traced`: the frame traced the scene (the first image: the first such frame completed) */
  private submit(enc: GPUCommandEncoder, done: (ms: number) => void, traced = true) {
    const t0 = performance.now();
    const dense = this.motionDenseOn;
    this.prof.end(enc);
    // (the frame the raster's sea was last drawn — the stamps' last word, trace.wgsl shadeWater —: read back now and then,
    // the FFT's waves computed only while some sea is in view — seaFftParams)
    const probe = this.seaProbeFor(enc);
    this.device.queue.submit([enc.finish()]);
    if (probe) {
      this.seaProbeBusy = true;
      probe
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const v = new Uint32Array(probe.getMappedRange())[0]!;
          probe.unmap();
          if (v > 0) this.seaSeenStamp = Math.max(this.seaSeenStamp, v);
        })
        .catch(() => {})
        .finally(() => (this.seaProbeBusy = false));
    }
    this.inFlight++;
    void this.device.queue.onSubmittedWorkDone().then(
      () => {
        this.inFlight--;
        const now = performance.now();
        const ms = now - Math.max(t0, this.lastDoneAt);
        this.lastDoneAt = now;
        this.lastGpuMs = ms;
        this.lastFrameDense = dense;
        this.completedFrames++;
        if (traced && !this.firstFrameDoneAt) {
          this.firstFrameDoneAt = now;
          this.resolveFirstImage();
          this.prefetchEarthSoon();
        }
        this.completedDurations.push(ms);
        if (this.completedDurations.length > 512) this.completedDurations.shift();
        this.onSubmitDone?.(t0, now);
        // Optional LUT work starts only after the first image has completed on the GPU — and the
        // general kernel, a heavier compile, has landed (its LUT is that kernel's companion).
        if (this.lutWanted && this.firstFrameDoneAt && this.generalCompile.state === "ready") void this.lutCompile.start();
        if (this.lutWanted && this.qualityCompile.state === "ready") void this.lutQCompile.start();
        done(ms);
      },
      (error: unknown) => {
        this.inFlight--;
        const message = error instanceof Error ? error.message : String(error);
        this.lost = message;
        if (this.offline) this.offline.error = message;
        this.onLost?.(message);
      },
    );
  }

  // ------------------------------------------------------------------------------------ live view
  /**
   * One frame of the live view.
   *  - A scene change (camera, parameters) starts a new epoch: earlier samples become stale.
   *  - Realtime (scene or time changing): one ray per block at a rotating offset. With a still
   *    camera the image fills in at full resolution over block² frames, temporally accumulated
   *    while time runs; stale pixels are reconstructed from the current frame's samples.
   *  - Still: progressive full-resolution refinement (error-controlled RK4, Gaussian-filtered
   *    jittered samples, adaptive sampling) in bands sized to ~28 ms of GPU time.
   */
  /** the hardware's tier (its pixel budget for the realtime image) */
  tier: Tier = { level: 2, capMpx: 2.2, label: "" };

  /** the adapter: what it is, its features and key limits (set at create) */
  adapter: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    fallback: boolean;
    features: string[];
    limits: Record<string, number>;
  } | null = null;
  /** Completed GPU submissions, independent of browser animation callbacks. */
  completedFrames = 0;
  /** each submission's time and its GPU end [performance.now() ms] (the jitter probe's — src/jitter/probe.ts) */
  onSubmitDone: ((submittedAt: number, doneAt: number) => void) | null = null;
  firstFrameDoneAt = 0;
  private completedDurations: number[] = [];
  /** what the ground's heights are made of now (the Earth's terrain tiles, a world's finer relief): it changes
   *  when finer heights come in — what stood on the coarser ground is set on them (main.ts) */
  get groundStamp() {
    return `${this.earthTiles.stamp}:${this.hdMap.name ?? ""}:${this.hdMap.dem ? 1 : 0}`;
  }
  get frameTelemetry() {
    return { completedFrames: this.completedFrames, firstFrameDoneAt: this.firstFrameDoneAt, durationsMs: [...this.completedDurations] };
  }
  /** The effective live quality used by both the renderer and diagnostics. */
  effectiveQuality(s: Settings) {
    return effectiveQuality(s, this.tier);
  }
  /**
   * Whether the image is the scene's own (the tests wait for it before they look): the first frame out, the scene's
   * specialised kernel there (or given up — the general one drawing), none still compiling ahead (the surface's,
   * the scenery's), the "compiling the ray tracer" pill gone.
   */
  get tracerSettled(): boolean {
    // (a kernel compiling ahead — the surface's, the scenery's, asked: its data may wait longer than its compile)
    if (!this.firstFrameDoneAt || this.sceneTracerShown || (this.aheadKey >= 0 && !this.kernelReady(this.aheadKey))) return false;
    // (the pills the player sees: "Compiling the ray tracer…" — the first image's, the scene's)
    if (loading.isActive("pipelines") || loading.isActive("scene-tracer")) return false;
    if (this.featureKey === FEATURES_ALL) return !!this.tracePipeline;
    const v = this.variants.get(this.featureKey);
    return !!v?.rt || !!v?.failed || !!v?.rtGivenUp;
  }

  /** Optional pipeline states are observable without starting a compilation. */
  get pipelineStatus() {
    return {
      general: this.generalCompile.state,
      quality: this.qualityCompile.state,
      qualityError: this.qualityCompile.error,
      lut: this.lutCompile.state,
      lutQuality: this.lutQCompile.state,
    };
  }
  /** Calibration excludes resource transitions and optional compilation load (a compile hung past
   * the queue's stall limit, or failed, no longer counts: the kernel drawing is then for good). */
  get calibrationReady() {
    return (
      !this.terrainRasterDiagnostic &&
      (this.variantReady || !!this.variants.get(this.featureKey)?.rtGivenUp) &&
      this.earthSettled &&
      this.variantQueue.pending === 0 &&
      ![this.generalCompile, this.qualityCompile, this.lutCompile, this.lutQCompile].some((r) => r.state === "pending")
    );
  }
  private timingGeneration = 0;
  /**
   * Forget the frames' timing (the blocks' measured times, the recent frames, frames still in flight)
   * when what they measured changed — a specialised kernel landing, a compile or a stream starting or
   * ending (calibrationReady), the tier. The image is left alone: none of those changes a pixel (a
   * specialised kernel draws what the general one does, faster; the Earth's tiles and the quality
   * kernel invalidate on their own as they land) — invalidating here restarted a converged still
   * view, and its temporal history, at every tile stream (audit M1).
   */
  resetQualityTiming() {
    this.timingGeneration++;
    this.blockMs.clear();
    this.rasterRateMs.clear();
    this.recentMs.length = 0;
    this.slowMs = this.fastMs = 0;
    this.rateSlowMs = this.rateFastMs = 0;
    this.lastGpuMs = 0;
  }
  /** A new hardware tier: its precision caps (effectiveQuality) change the image — drawn anew. */
  setTier(tier: Tier) {
    // (the automatic raster rate after a new tier: a demotion at least the new tier's start, coarser; a promotion — room
    // measured — at most it, finer than a coarse measure had left it)
    const start = RASTER_RATE_START[tier.level];
    if (tier.level < this.tier.level || !this.autoRasterRate) this.autoRasterRate = Math.max(this.autoRasterRate, start);
    else this.autoRasterRate = Math.min(this.autoRasterRate, start);
    this.tier = tier;
    this.resetQualityTiming();
    this.invalidate();
  }
  /** when the GPU last finished a frame [performance.now() ms] */
  get lastFrameDoneAt() {
    return this.lastDoneAt;
  }
  /** the scene's specialised tracer compiled (or none needed): the realtime image at full speed */
  /** the mountains' warp read from its grids round the camera (trace.wgsl earthWarp; false: worked out by each ray —
   *  a switch for comparisons) */
  get warpGrid() {
    return this.warpGridOn;
  }
  set warpGrid(v: boolean) {
    if (v === this.warpGridOn) return;
    this.warpGridOn = v;
    this.invalidate();
  }
  private warpGridOn = true;
  private warpOut: WarpGrid;
  private terrainSurfaceCache: TerrainCache | null = null;
  private terrainCacheWanted = false;
  private terrainRaster: TerrainRaster | null = null;
  private terrainRasterRequested = false;
  /** a terrain diagnostic adds its own GPU work this frame (the inspector, the cache, the hints without the raster
   *  pipeline): the automatic quality held — main.ts reads it as terrainRasterInspecting */
  private terrainRasterDiagnostic = false;
  private terrainRasterLevel = 0;
  /** the last camera frame shades the raster patch's pixels one a pixel (earthPipeline "raster", trace.wgsl shade) */
  private rasterPrimaryOn = false;
  /** a still view keeps the raster's realtime frames (main.ts: the raster pipeline, not the photo mode) — else it refines,
   *  traced */
  rasterHold = true;
  /** the sky's bodies' discs this frame (main.ts: the Moon's, the Sun's — bodyDisc): their centre in the image [ndc] and their
   *  radius [ndc of the height]; drawn at one ray a pixel over the raster's sky (trace.wgsl main, z ≥ 1) */
  skyDiscs: { x: number; y: number; r: number; moon: boolean }[] = [];
  /** the catalogue's ICRS directions to the camera's axes (main.ts starMatrixNow: three columns of four), or none — the
   *  stars over the raster's sky drawn one a thread at their own pixel (trace.wgsl shadeStars) */
  starMatrix: Float32Array<ArrayBuffer> | null = null;
  /** the stars drawn so this frame (tests) */
  starsRasterNow = false;
  /** the discs drawn in the last frame (tests) */
  discsDrawn = 0;
  /** the body held still in the view (main.ts: the telescope locked on it, stabilised; null: none): its disc, wide, drawn a
   *  2 × 2 block's pixel a frame (discRects) */
  discsStill: string | null = null;
  /** the sky's coarser block while the raster draws all the near ground (RASTER_SKY_BLOCK; a switch for comparisons) */
  rasterSkyBlock = true;
  /** the rays' raster kernel (shade) left out while the material takes every pixel (a switch for comparisons) */
  shadeSkip = true;
  /** the live view's height over the Earth's figure [km] (writeParams) */
  private liveAltKm = 1e4;
  /** parts of the raster's material cut at run time (trace.wgsl liteSkip: TUNE_LITE's bits — 1 water, 2 scenery shadows, 4
   *  relief shadow, 8 surfaces, 16 mesh normal, 32 cloud shadows, 64 trees, 128 imagery): a measure, the image then wrong */
  liteSkip = 0;
  /** the live view's raster wanted and eligible at the last frame (writeParams): what rasterHold holds */
  private rasterEligibleNow = false;
  /** the clouds' transmittance map seen from the Sun (trace.wgsl cloudShadow — docs/PLAN-NUAGES-AAA.md N3; read by
   *  cloudShadowAt): the device binds it; a switch for comparisons (off: the old shadows, the 2D covers) */
  private cloudShadow = false;
  cloudShadowOn = true;
  private csmTex: GPUTexture | null = null;
  private csmHead: GPUTexture | null = null;
  private csmDummy: GPUTexture | null = null;
  private csmPipe: GPUComputePipeline | null = null;
  private csmWanted = false;
  private csmWrite: GPUBindGroup | null = null;
  private csmTableOn = false;
  private csmBind0?: { t: Target; bind: GPUBindGroup };
  private encodeCloudShadow(enc: GPUCommandEncoder, t: Target) {
    const d = this.device;
    if (!this.cloudShadow || !this.cloudShadowOn || !this.lastNear || !this.nearEarthNow) {
      if (this.csmTableOn) d.queue.writeBuffer(this.bodyBuf, TABLE_CSM * 16, new Float32Array(CSM_VEC4S * 4));
      this.csmTableOn = false;
      return;
    }
    if (!this.csmPipe) {
      if (!this.csmWanted) {
        this.csmWanted = true;
        const st = { access: "write-only", format: "rgba32float" } as const;
        const layout = d.createBindGroupLayout({
          label: "clouds' shadow map write",
          entries: [
            { binding: 14, visibility: GPUShaderStage.COMPUTE, storageTexture: st },
            { binding: 15, visibility: GPUShaderStage.COMPUTE, storageTexture: st },
          ],
        });
        this.csmWrite = d.createBindGroup({
          layout,
          entries: [
            { binding: 14, resource: this.csmTex!.createView() },
            { binding: 15, resource: this.csmHead!.createView() },
          ],
        });
        // (the features the clouds need alone: the bodies, the weather — the rest compiled out, as the sky's ambient)
        const off = ["RADIO", "POL", "JET", "SPOT", "VOL", "WH", "THICK", "RWY", "KERR", "SHADE", "SURFACE", "SCENERY", "AURORA"];
        const t0 = performance.now();
        void d
          .createComputePipelineAsync({
            layout: d.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, layout] }),
            compute: {
              module: this.traceModule,
              entryPoint: "cloudShadow",
              constants: {
                ...Object.fromEntries(off.map((f) => [`HAS_${f}`, 0])),
                HAS_BODIES: 1,
                HAS_WX: 1,
                QUALITY_PIPELINE: 0,
                CSM_HALF_M,
              },
            },
          })
          .then(
            (p) => {
              this.csmPipe = p;
              gpuDiagnostics.record("pipeline-compiled", `clouds' shadow map: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
            },
            (e) => console.warn("Clouds' shadow map unavailable:", e),
          );
      }
      return;
    }
    // (its own group 0: the stand-in where the map is written)
    if (this.csmBind0?.t !== t)
      this.csmBind0 = {
        t,
        bind: d.createBindGroup({ layout: this.traceLayout, entries: this.traceEntries(t, this.ship.envBuf, undefined, false, false) }),
      };
    const p = enc.beginComputePass(this.prof.pass("clouds' shadow map"));
    p.setPipeline(this.csmPipe);
    p.setBindGroup(0, this.csmBind0.bind);
    p.setBindGroup(1, this.csmWrite!);
    p.dispatchWorkgroups(CSM_N / 8, CSM_N / 8);
    p.end();
    enc.copyTextureToBuffer({ texture: this.csmHead! }, { buffer: this.bodyBuf, offset: TABLE_CSM * 16 }, [CSM_VEC4S, 1]);
    this.csmTableOn = true;
  }
  /** the clear sky's light, physical and shared (trace.wgsl skyAmbient → skyIrradiance — docs/PLAN-NUAGES-AAA.md N2b): a
   *  switch for comparisons (off: the old constant bluish tenth of the sun's) */
  skyAmbientOn = true;
  private skyPipe: GPUComputePipeline | null = null;
  private skyWanted = false;
  private skyOut: GPUTexture | null = null;
  private skyBind: GPUBindGroup | null = null;
  private skyTableOn = false;
  private encodeSkyAmbient(enc: GPUCommandEncoder, t: Target) {
    const d = this.device;
    if (!this.skyAmbientOn || !this.lastNear || !this.nearEarthNow) {
      if (this.skyTableOn) d.queue.writeBuffer(this.bodyBuf, TABLE_SKY * 16, new Float32Array(4));
      this.skyTableOn = false;
      return;
    }
    if (!this.skyPipe) {
      if (!this.skyWanted) {
        this.skyWanted = true;
        const layout = d.createBindGroupLayout({
          label: "sky ambient write",
          entries: [{ binding: 13, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } }],
        });
        // (a texture, not a buffer: the tracer's layout already takes the storage buffers a stage may have)
        this.skyOut = d.createTexture({
          label: "sky ambient",
          size: [SKY_AMBIENT_VEC4S, 1],
          format: "rgba32float",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        this.skyBind = d.createBindGroup({ layout, entries: [{ binding: 13, resource: this.skyOut.createView() }] });
        // (every feature the air does not need compiled out — the overrides' defaults are all on: the black hole's, the
        // disk's, the Kerr metric's code with it, a compile that never ended)
        const off = ["RADIO", "POL", "JET", "SPOT", "VOL", "WH", "THICK", "RWY", "KERR", "SHADE", "SURFACE", "SCENERY", "AURORA"];
        const t0 = performance.now();
        void d
          .createComputePipelineAsync({
            layout: d.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, layout] }),
            compute: {
              module: this.traceModule,
              entryPoint: "skyAmbient",
              constants: {
                ...Object.fromEntries(off.map((f) => [`HAS_${f}`, 0])),
                HAS_BODIES: 1,
                // (the weather's haze and fog in the air's light — compiled in once and for all: a session begun in fair
                // weather or in space would keep them out for good; the decks themselves are left out by the kernel)
                HAS_WX: 1,
                QUALITY_PIPELINE: 0,
              },
            },
          })
          .then(
            (p) => {
              this.skyPipe = p;
              gpuDiagnostics.record("pipeline-compiled", `sky ambient: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
            },
            (e) => console.warn("Sky ambient unavailable:", e),
          );
      }
      return;
    }
    // (the clear sky's light changes as slowly as the Sun and the height: worked out every SKY_EVERY frames, the table kept
    // between — ~0.5 ms a run on an M1, TERRE-UNREAL U6)
    if (this.skyTableOn && ++this.skyTick < SKY_EVERY) return;
    this.skyTick = 0;
    const p = enc.beginComputePass(this.prof.pass("sky ambient"));
    p.setPipeline(this.skyPipe);
    p.setBindGroup(0, t.traceBind);
    p.setBindGroup(1, this.skyBind!);
    p.dispatchWorkgroups(5);
    p.end();
    enc.copyTextureToBuffer({ texture: this.skyOut! }, { buffer: this.bodyBuf, offset: TABLE_SKY * 16 }, [SKY_AMBIENT_VEC4S, 1]);
    this.skyTableOn = true;
  }
  private skyTick = 0;
  /** the cloud pass (trace.wgsl clouds — docs/PLAN-NUAGES-AAA.md N1): the device binds its buffers; a switch */
  private cloudPass = false;
  cloudPassOn = true;
  /** the cloud pass's own history (post.wgsl cloudTemporal; a switch for comparisons: off, each frame's march as it is) */
  cloudHistoryOn = true;
  private cloudDummies: GPUTexture[] = [];
  private cloudWriteLayout: GPUBindGroupLayout | null = null;
  private cloudPassDrawn = false;
  /** the cloud pass this frame: drawn, its history kept (tests, TARS) */
  get cloudPassStats() {
    return { drawn: this.cloudPassDrawn, history: !!this.live?.cloudHistValid, supported: this.cloudPass, on: this.cloudPassOn };
  }
  private cloudsLayout: GPUPipelineLayout | null = null;
  /** the relief's shadow map (terrain-raster.ts encodeSunShadow, trace.wgsl sunShadowFar): the device binds it; a switch */
  private sunShadow = false;
  private sunDummy: GPUTexture | null = null;
  sunShadowOn = true;
  private sunTableOn = false;
  private sunOut = new Float32Array(12);
  private sunTable = new Float32Array(20);
  /** the raster's shading rate (earthRasterShading): pixels a shaded one stands for, 1, 2 or 4 */
  private rasterRate = 1;
  /** the live image's height [px] (its render scale's) */
  get liveHeight() {
    return this.live?.height ?? 0;
  }
  /** the raster's shading rate this frame (1 every pixel … 16; the jitter probe's) */
  get rasterRateNow() {
    return this.rasterRate;
  }
  /** the raster's sub-pixel jitter: "gauss" — each ray its own, the raster unjittered —, or "halton" — one offset a frame
   *  for the raster's projection and its rays (trace.wgsl rasterJitter). Measured in motion (tests/e2e/raster-motion): the
   *  whole image moved half a pixel a frame and the history, reprojecting the pixels' centres, blurred it — 32.2 → 27.1 dB
   *  in the Alps, 38.5 → 37.4 at Tarifa —; kept as a switch for comparisons */
  rasterJitter: "halton" | "gauss" = "gauss";
  /** the raster's shading rays jittered by the Halton sequence this frame (post.wgsl taau: where they went) */
  private rasterHaltonNow = false;
  /**
   * The ground's detail at every pixel (RASTER_DETAIL — a switch for comparisons): the raster's shading is sparse (one pixel
   * in 4 to 64 a frame), its colour rebuilt between and carried by the temporal history; the orthophoto's albedo, cheap, is
   * read at every pixel each frame (trace.wgsl rasterAlbedo) and swapped in for the albedo of the pixels the colour came from
   * (post.wgsl resolve, temporal) — the light stays sparse, the texture sharp, as a converged view's.
   * Off by default (2026-10-25): in motion its swaps grained the ground and blotched it frame to frame, and the raster's way
   * forward is every pixel shaded each frame (docs/progress/raster-aaa/TERRE-UNREAL.md), where it brings nothing.
   */
  rasterDetail = false;
  /** the raster's ground shaded at every pixel, every frame, by the material pass (trace.wgsl shadeLite — TERRE-UNREAL U1);
   *  false: shade's, at the governor's rate, as before (a switch for comparisons) */
  rasterLite = true;
  /** this frame: the material draws the ground, the old per-pixel kernel (shade) not compiled yet — its leftover pixels traced */
  private rasterShadeLate = false;
  /** shadeLite this frame */
  private rasterLiteNow = false;
  /** shadeWater this frame (its water split from shadeLite) */
  private rasterWaterNow = false;
  /** the tracer's compiles queued or running (the specialised kernels, the general and quality ones, the LUTs' — main.ts's
   *  compile meter) */
  /** the shaders compiling now, as the player reads them (main.ts: the compile meter) — the kernel, and the scene's features
   *  that made its variant */
  private compiling = new Set<string>();
  /** every tracer compile of the session, in order (compileReport) */
  private compileLog: { pipeline: string; key: number; startedAt: number; seconds: number; ok: boolean; beforeFirstImage: boolean }[] = [];
  /** each specialised pipeline's source size [KB] ("key:entry:quality") — the measure of its compile's work */
  private codeKB = new Map<string, number>();
  /** the cold compiles of the large kernels this session (main, env): their seconds and their source's KB — the pace */
  private pace = { s: 0, kb: 0 };
  /** when each key's realtime tracer started compiling [performance.now ms] */
  private mainStartedAt = new Map<number, number>();
  /** the specialised size of each key's realtime tracer [KB] */
  private mainKB = new Map<number, number>();
  /**
   * The seconds left before the scene's own tracer is in (the "Compiling the ray tracer for this scene" stage), from the
   * pace of the large compiles this session — seconds per KB of specialised source, which is what DXC and Metal chew on —
   * and the size of this key's: null when nothing has been learnt yet (the first compile of a session: its stage tells how
   * long it has run instead) — docs/PLAN-LEAN-TRACER-KERNELS.md P2.
   */
  sceneCompileEta(): number | null {
    if (this.pace.kb <= 0 || !this.sourceSpecialise) return null;
    const key = this.featureKey;
    if (this.variants.get(key)?.rt || this.coveringVariant(key, "rt")) return 0;
    let kb = this.mainKB.get(key);
    if (kb === undefined) {
      this.specialiser ??= new WgslSpecialiser(this.traceSource);
      const c = tracerConstants(key, "main", {
        rasterHint: this.rasterHint,
        tune: this.tunes.get((key >> 20) & 63),
        companion: this.leanMain,
        coarseProbe: this.coarseProbe,
        otherUniverse: !this.otherUniverseOut,
      });
      kb = this.specialiser.specialise(c, "main").length / 1024;
      this.mainKB.set(key, kb);
    }
    const started = this.mainStartedAt.get(key);
    const ran = started !== undefined ? (performance.now() - started) / 1000 : 0;
    return Math.max(3, (kb * this.pace.s) / this.pace.kb - ran);
  }
  private noteCompile(pipeline: string, key: number, t0: number, ok: boolean) {
    this.compileLog.push({
      pipeline,
      key,
      startedAt: t0,
      seconds: (performance.now() - t0) / 1000,
      ok,
      beforeFirstImage: !this.firstFrameDoneAt,
    });
    if (this.compileLog.length > 400) this.compileLog.shift();
  }
  /** The tracer's compiles so far (docs/PLAN-LEAN-TRACER-KERNELS.md P0): each pipeline (its entry, "(quality)" for the
   *  refining one, "general …" for the every-feature ones), its features key, when it started [performance.now ms], how
   *  long it took [s] — under ~5 s: out of the browser's shader cache —, whether it compiled, whether before the first
   *  image; and the totals. */
  compileReport() {
    const log = this.compileLog.map((c) => ({ ...c, cached: c.ok && c.seconds < 5 }));
    return {
      compiles: log,
      count: log.length,
      cold: log.filter((c) => !c.cached).length,
      seconds: log.reduce((a, c) => a + c.seconds, 0),
      pending: this.compilesPending,
      firstFrameDoneAt: this.firstFrameDoneAt,
    };
  }
  get compilingNow(): string[] {
    const out = [...this.compiling];
    if (this.generalCompile.state === "pending") out.push(t("the general tracer"));
    if (this.qualityCompile.state === "pending") out.push(t("the refining tracer"));
    if (this.lutCompile.state === "pending" || this.lutQCompile.state === "pending") out.push(t("the far field"));
    return out;
  }
  private compileLabel(key: number, entry: string, quality: boolean): string {
    const names: Record<string, string> = {
      main: quality ? t("the refining tracer") : t("the tracer"),
      env: t("the light probe"),
      lut: t("the far field"),
      aerial: t("the aerial perspective"),
      shade: t("the ground's rays"),
      shadeMark: t("the ground's rays"),
      shadeLite: t("the ground's material"),
      shadeWater: t("the water"),
      shadeStars: t("the stars"),
      discs: t("the sky's discs"),
      clouds: t("the clouds"),
    };
    const f = [
      [8192, t("scenery")],
      [4096, t("surfaces")],
      [1024, t("weather")],
      [256, t("runways")],
      [2048, t("eclipses")],
      [16384, t("auroras")],
    ]
      .filter(([b]) => (key & (b as number)) !== 0)
      .map(([, n]) => n as string);
    return f.length ? `${names[entry] ?? entry} (${f.join(", ")})` : (names[entry] ?? entry);
  }
  get compilesPending() {
    const busy = [this.generalCompile, this.qualityCompile, this.lutCompile, this.lutQCompile].filter((r) => r.state === "pending").length;
    return this.variantQueue.pending + busy;
  }
  /** the raster's ground drawn by shadeLite this frame (main.ts: its scale held, not the governor's) */
  get rasterLiteActive() {
    return this.rasterLiteNow;
  }
  /** RASTER_DETAIL this frame */
  private rasterDetailNow = false;
  /** the world's trees as raster instances (system/scenery-raster.ts), made the first time the raster pipeline has them */
  private sceneryRaster: SceneryRaster | null = null;
  /** the trees' and buildings' shadow map (system/tree-shadow.ts, drawn by the scenery raster): the device binds it; a switch
   *  for comparisons (off: the rays towards the Sun, as before) */
  private treeShadow = false;
  treeShadowOn = true;
  /** the least projected radius [px] of a tree the raster draws (system/scenery-raster.ts: smaller ones left to the ground's
   *  imagery — micro-triangles); 0 every one */
  get treeMinPx() {
    return this.sceneryRaster?.minPx ?? 2.5;
  }
  set treeMinPx(px: number) {
    if (this.sceneryRaster) this.sceneryRaster.minPx = px;
  }
  private tsmTex: GPUTexture | null = null;
  /** the map's frame as drawn (its content's), the next one asked, the scenery's revision it was drawn from */
  private tsmFrame = new Float32Array(16);
  private tsmNext = new Float32Array(16);
  private tsmOff = new Float32Array(16);
  private tsmAsk = new Float32Array(16);
  private tsmValid = false;
  private tsmRedraw = false;
  private tsmRevision = -1;
  private tsmRevisionNext = -1;
  private tsmTableOn = false;
  private tsmDrawn = false;
  /** the relief's shadow map drawn this frame (encodeSunShadow): its frame cleared otherwise — not the last one's read */
  private sunDrawn = false;
  /** The Sun's view for the trees' shadow map in the scenery's frame (its axes and the camera in it: `scp`, P.scenery): right,
   *  up, towards the Sun — each with its half-extent —, the centre (the camera, snapped to the map's texels: no shimmer as it
   *  moves), drawn or not (the Sun up). */
  private treeShadowFrame(scp: Float32Array): Float32Array {
    const near = this.lastNear;
    const f = this.tsmAsk;
    f.fill(0);
    if (!near || !this.treeShadow || !this.treeShadowOn) return f;
    const Le = near.axes.map((a) => a[0]! * near.light[0]! + a[1]! * near.light[1]! + a[2]! * near.light[2]!);
    const dot = (o: number) => Le[0]! * scp[o]! + Le[1]! * scp[o + 1]! + Le[2]! * scp[o + 2]!;
    let L = [dot(0), dot(4), dot(8)];
    const ll = Math.hypot(...L) || 1;
    L = L.map((x) => x / ll);
    if (L[2]! < 0.03) return f;
    let r = [L[1]!, -L[0]!, 0];
    const rl = Math.hypot(...r);
    r = rl < 1e-6 ? [1, 0, 0] : r.map((x) => x / rl);
    const u = [r[1]! * L[2]! - r[2]! * L[1]!, r[2]! * L[0]! - r[0]! * L[2]!, r[0]! * L[1]! - r[1]! * L[0]!];
    const H = TREE_SHADOW_HALF_M;
    // (the centre on a grid of 128 m in the Sun's plane: the frame steady while the camera moves within it — drawn again
    // when it jumps, kept between)
    // (a whole number of the map's texels: after a jump its texels on the same lattice — no shadow's edge moving)
    const texel = Math.round(128 / ((2 * H) / TREE_SHADOW_N)) * ((2 * H) / TREE_SHADOW_N);
    const cam = [scp[12]!, scp[13]!, scp[14]!];
    const cr = cam[0]! * r[0]! + cam[1]! * r[1]! + cam[2]! * r[2]!;
    const cu = cam[0]! * u[0]! + cam[1]! * u[1]! + cam[2]! * u[2]!;
    const sr = Math.round(cr / texel) * texel - cr,
      su = Math.round(cu / texel) * texel - cu;
    const c = cam.map((x, i) => x + r[i]! * sr + u[i]! * su);
    // (its depth ±3 km about the camera along the Sun: the ground below a mesa's rim, a low Sun's long reach — depth32float
    // keeps a millimetre over it)
    f.set([...r, H, ...u, H, ...L, TREE_SHADOW_DEPTH_M, ...c, 1]);
    return f;
  }
  /** the trees drawn as raster instances under earthPipeline "raster" (a switch for comparisons: off, the grid walked) */
  sceneryRasterOn = true;
  /** the trees' proxies' detail (system/scenery-raster.ts SceneryRasterLod; a switch for comparisons) */
  get sceneryRasterLod(): SceneryRasterLod {
    return this.sceneryRaster?.getLod() ?? { ...SCENERY_RASTER_LOD };
  }
  set sceneryRasterLod(lod: SceneryRasterLod) {
    this.pendingSceneryLod = { ...this.sceneryRasterLod, ...lod };
    this.sceneryRaster?.setLod(this.pendingSceneryLod);
  }
  private pendingSceneryLod: SceneryRasterLod | null = null;
  /** Freeze automatic quality policy while a diagnostic adds its own GPU work (not the raster pipeline: the image itself). */
  get terrainRasterInspecting() {
    return this.terrainRasterDiagnostic;
  }
  /** the near Earth drawn by the raster pipeline in the last camera frame (main.ts: its render scale in motion) */
  get rasterPrimaryNow() {
    return this.rasterPrimaryOn;
  }
  /** Geometry inspector only; its metric depth does not yet replace the scene's occlusion depth. */
  get terrainRasterStats() {
    return {
      requested: this.terrainRasterRequested,
      primary: this.rasterPrimaryOn,
      rate: this.rasterRate,
      scenery: this.sceneryRaster?.stats() ?? null,
      ...this.terrainRaster?.stats(),
    };
  }

  /**
   * The main trace pass's bind group with the patch's distance texture drawn this frame. The other passes keep the
   * group with the empty one: a texture retired by a resize is never in a group they use.
   */
  private hintBindFor(t: Target, tex: GPUTexture): GPUBindGroup {
    if (t.hintBind?.tex !== tex)
      t.hintBind = {
        tex,
        bind: this.device.createBindGroup({ layout: this.traceLayout, entries: this.traceEntries(t, this.ship.envBuf, tex) }),
      };
    return t.hintBind.bind;
  }

  /** half the relief's shadow map's width [m], the depth's half-range [m], the near march's reach [m] */
  static readonly SUN_HALF_M = 10_000;
  static readonly SUN_DEPTH_M = 20_000;
  static readonly SUN_NEAR_M = 300;
  /**
   * The relief seen from the Sun (its shadow map), after this frame's patch: an orthographic view centred on the camera,
   * the Earth's axes — the Sun's direction near.light (camera rest frame) on the body's axes — and its table entries
   * (TABLE_SUN); off where it is not drawn.
   */
  private encodeSunShadow(enc: GPUCommandEncoder, drawn: boolean) {
    const near = this.lastNear;
    const tr = this.terrainRaster;
    let on = false;
    if (drawn && this.sunShadow && this.sunShadowOn && this.rasterPrimaryOn && near && tr) {
      const L = near.axes.map((a) => a[0]! * near.light[0]! + a[1]! * near.light[1]! + a[2]! * near.light[2]!) as [number, number, number];
      const up = patchGeodetic(near, WGS84_F).normal;
      // (right: across the Sun and the vertical — any perpendicular when the Sun stands overhead)
      let r = [L[1] * up[2] - L[2] * up[1], L[2] * up[0] - L[0] * up[2], L[0] * up[1] - L[1] * up[0]];
      let rl = Math.hypot(...r);
      if (rl < 1e-6) {
        r = [L[1], -L[0], 0];
        rl = Math.hypot(...r) || 1;
      }
      r = r.map((x) => x / rl);
      const u = [r[1]! * L[2] - r[2]! * L[1], r[2]! * L[0] - r[0]! * L[2], r[0]! * L[1] - r[1]! * L[0]];
      const H = Renderer.SUN_HALF_M,
        D = Renderer.SUN_DEPTH_M;
      this.sunOut.set([...r, H, ...u, H, ...L, D]);
      on = tr.encodeSunShadow(
        enc,
        {
          params: this.paramBuf,
          table: this.bodyBuf,
          elevation: this.earthMaps.elev,
          tiles: this.earthTiles.texture,
          sampler: this.sampler,
        },
        this.sunOut,
        (label, descriptor) => this.prof.pass(label, descriptor),
      );
      if (on) {
        this.sunTable.set([...r, H, ...u, H, ...L, D, 1, Renderer.SUN_NEAR_M, H * 0.98, 0, ...up, 0]);
        this.device.queue.writeBuffer(this.bodyBuf, TABLE_SUN * 16, this.sunTable);
      }
    }
    if (!on && this.sunTableOn) this.device.queue.writeBuffer(this.bodyBuf, (TABLE_SUN + 3) * 16, new Float32Array(4));
    this.sunTableOn = on;
    this.sunDrawn = on;
  }

  /**
   * The cloud pass's history (post.wgsl cloudTemporal): this frame's march reprojected against the last frame's result with
   * the clouds' own depth, into the buffers the kernels read, then kept as the next frame's history. No temporal pass yet
   * (its camera uniform is the image's history's): this frame's march copied as it is.
   */
  private encodeCloudHistory(enc: GPUCommandEncoder, t: Target) {
    const size = { width: Math.ceil(t.width / 2), height: Math.ceil(t.height / 2) };
    const ta = t.temporal;
    if (!this.postCloudTemporal || !ta || !this.cloudHistoryOn) {
      enc.copyTextureToTexture({ texture: t.cloudCurA! }, { texture: t.cloudA! }, size);
      enc.copyTextureToTexture({ texture: t.cloudCurB! }, { texture: t.cloudB! }, size);
      t.cloudHistValid = false;
      return;
    }
    this.cloudCT ??= this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    if (t.cloudTemporalBind?.buf !== ta.buf)
      t.cloudTemporalBind = {
        buf: ta.buf,
        bind: this.device.createBindGroup({
          layout: this.postCloudTemporal.getBindGroupLayout(0),
          entries: [
            { binding: 21, resource: { buffer: ta.buf } },
            { binding: 40, resource: t.cloudCurA!.createView() },
            { binding: 41, resource: t.cloudCurB!.createView() },
            { binding: 42, resource: t.cloudHistA!.createView() },
            { binding: 44, resource: t.cloudA!.createView() },
            { binding: 45, resource: t.cloudB!.createView() },
            { binding: 46, resource: { buffer: this.cloudCT } },
          ],
        }),
      };
    this.device.queue.writeBuffer(this.cloudCT, 0, new Float32Array([t.cloudHistValid && ta.valid ? 1 : 0, 0, 0, 0]));
    const p = enc.beginComputePass(this.prof.pass("clouds' history"));
    p.setPipeline(this.postCloudTemporal);
    p.setBindGroup(0, t.cloudTemporalBind.bind);
    p.dispatchWorkgroups(Math.ceil(size.width / 8), Math.ceil(size.height / 8));
    p.end();
    enc.copyTextureToTexture({ texture: t.cloudA! }, { texture: t.cloudHistA! }, size);
    t.cloudHistValid = true;
  }

  /** the far raster rings about the patch (the relief's cache two levels coarser, each about the next finer): their ground
   *  drawn too, its hint the tracer's instead of a march from the camera (off: those pixels marched as before) */
  rasterRingsOn = true;
  /**
   * A diagnostic (docs/progress/HORIZON-FLICKER.md): one column of the raster's visibility target, at a fraction of the width —
   * each row's ground distance [m] (0: no triangle, the tracer's), its level step (0 the patch, 1 its first far ring …; −1
   * none) —, and the target's size.
   */
  async rasterColumn(
    xFrac = 0.5,
  ): Promise<{ width: number; height: number; rows: { d: number; step: number; m?: number; age?: number }[] } | null> {
    const tex = this.terrainRaster?.distanceTexture();
    if (!tex) return null;
    const x = Math.min(Math.max(Math.round(xFrac * tex.width), 0), tex.width - 1);
    const buf = this.device.createBuffer({ size: 256 * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex, origin: [x, 0] }, { buffer: buf, bytesPerRow: 256 }, [1, tex.height]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(buf.getMappedRange().slice(0));
    buf.unmap();
    buf.destroy();
    // (the live target's marks down the same column, when it is the visibility's size: moments.x — RASTER_MARK 1e30 and over a
    // raster pixel shaded, −3 one left —, the stamp against this frame's)
    const t = this.live;
    let marks: { m: number; age: number }[] | null = null;
    if (t && t.width === tex.width && t.height === tex.height) {
      const mb = this.device.createBuffer({ size: 8 * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const sb = this.device.createBuffer({ size: 4 * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const e2 = this.device.createCommandEncoder();
      for (let y = 0; y < tex.height; y++) {
        e2.copyBufferToBuffer(t.moments, (y * t.width + x) * 8, mb, y * 8, 8);
        e2.copyBufferToBuffer(t.stamps, (y * t.width + x) * 4, sb, y * 4, 4);
      }
      this.device.queue.submit([e2.finish()]);
      await Promise.all([mb.mapAsync(GPUMapMode.READ), sb.mapAsync(GPUMapMode.READ)]);
      const mf = new Float32Array(mb.getMappedRange().slice(0));
      const su = new Uint32Array(sb.getMappedRange().slice(0));
      mb.unmap();
      sb.unmap();
      mb.destroy();
      sb.destroy();
      marks = Array.from({ length: tex.height }, (_, y) => ({ m: mf[2 * y]!, age: this.frameStamp - su[y]! }));
    }
    const rows = Array.from({ length: tex.height }, (_, y) => {
      const a = f[y * 64 + 3]!;
      return { d: f[y * 64]!, step: a > 0 ? -Math.log2(Math.min(a, 1)) : -1, ...(marks ? marks[y] : {}) };
    });
    return { width: tex.width, height: tex.height, rows };
  }
  /** a column traced through the passes over a few frames (traceColumn — a diagnostic) */
  private colTrace: {
    x: number;
    y0: number;
    n: number;
    want: number;
    frames: ColFrame[];
    done: (f: ColFrame[]) => void;
  } | null = null;
  /**
   * A diagnostic (docs/progress/HORIZON-FLICKER.md): the next `frames` live frames, `n` rows of a 32 px wide strip from the
   * column at `xFrac`, from row `y0` [the target's px] — what the kernels wrote (accum: colour / weight), the reconstruction's
   * output (resolve), the temporal pass's: each row's mean luminance over the strip and its first pixel's —, the first pixel's
   * moments, and the frame's stamp.
   */
  traceColumn(xFrac: number, y0: number, n: number, frames: number) {
    const t = this.live;
    if (!t) return Promise.resolve(null);
    const x = Math.min(Math.max(Math.round(xFrac * t.width), 0), t.width - 32);
    type Rows = { mean: number[]; px: number[] };
    return new Promise<{ stamp: number; validFrom: number; acc: Rows; res: Rows; tem: Rows; m: number[]; stale: number[] }[]>((resolve) => {
      this.colTrace = {
        x,
        y0,
        n,
        want: frames,
        frames: [],
        done: async (fs) => {
          const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const out = [];
          for (const f of fs) {
            await Promise.all([f.acc, f.res, f.tem, f.mom, f.st].map((b) => b.mapAsync(GPUMapMode.READ)));
            const st = new Uint32Array(f.st.getMappedRange().slice(0));
            const acc = new Float32Array(f.acc.getMappedRange().slice(0));
            const mom = new Float32Array(f.mom.getMappedRange().slice(0));
            const half = (b: GPUBuffer) => {
              const u = new Uint16Array(b.getMappedRange().slice(0));
              const h = (v: number) => {
                const e = (v >> 10) & 31,
                  m = v & 1023;
                return (e ? 2 ** (e - 15) * (1 + m / 1024) : 2 ** -14 * (m / 1024)) * (v & 0x8000 ? -1 : 1);
              };
              const at = (k: number, i: number) => lum(h(u[k * 128 + 4 * i]!), h(u[k * 128 + 4 * i + 1]!), h(u[k * 128 + 4 * i + 2]!));
              return {
                mean: Array.from({ length: n }, (_, k) => Array.from({ length: 32 }, (_, i) => at(k, i)).reduce((a, b) => a + b, 0) / 32),
                px: Array.from({ length: n }, (_, k) => at(k, 0)),
              };
            };
            const accAt = (k: number, i: number) => {
              const o = 4 * (32 * k + i);
              return lum(acc[o]!, acc[o + 1]!, acc[o + 2]!) / Math.max(acc[o + 3]!, 1e-6);
            };
            out.push({
              stamp: f.stamp,
              acc: {
                mean: Array.from(
                  { length: n },
                  (_, k) => Array.from({ length: 32 }, (_, i) => accAt(k, i)).reduce((a, b) => a + b, 0) / 32,
                ),
                px: Array.from({ length: n }, (_, k) => accAt(k, 0)),
              },
              res: half(f.res),
              tem: half(f.tem),
              m: Array.from({ length: n }, (_, k) => mom[2 * k]!),
              validFrom: f.validFrom,
              // (each row's share of the strip's pixels older than the frame's valid stamp — the reconstruction's "stale")
              stale: Array.from(
                { length: n },
                (_, k) => Array.from({ length: 32 }, (_, i) => st[32 * k + i]!).filter((v) => v < f.validFrom).length / 32,
              ),
            });
            for (const b of [f.acc, f.res, f.tem, f.mom, f.st]) b.destroy();
          }
          resolve(out);
        },
      };
    });
  }
  /** this frame's capture, if one is asked: accum and the resolve's output now, the temporal's by the returned call */
  private colTraceFrame(enc: GPUCommandEncoder, t: Target) {
    const c = this.colTrace;
    if (!c || c.frames.length >= c.want) return null;
    const d = this.device;
    const mk = (size: number) => d.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const f = {
      acc: mk(512 * c.n),
      res: mk(256 * c.n),
      tem: mk(256 * c.n),
      mom: mk(8 * c.n),
      st: mk(128 * c.n),
      stamp: this.frameStamp,
      validFrom: this.validFrom,
    };
    for (let k = 0; k < c.n; k++) {
      enc.copyBufferToBuffer(t.stamps, ((c.y0 + k) * t.width + c.x) * 4, f.st, 128 * k, 128);
      enc.copyBufferToBuffer(t.accum, ((c.y0 + k) * t.width + c.x) * 16, f.acc, 512 * k, 512);
      enc.copyBufferToBuffer(t.moments, ((c.y0 + k) * t.width + c.x) * 8, f.mom, 8 * k, 8);
    }
    enc.copyTextureToBuffer({ texture: t.hdr, mipLevel: 0, origin: [c.x, c.y0] }, { buffer: f.res, bytesPerRow: 256 }, [32, c.n]);
    c.frames.push(f);
    return (e: GPUCommandEncoder) => {
      e.copyTextureToBuffer({ texture: t.hdr, mipLevel: 0, origin: [c.x, c.y0] }, { buffer: f.tem, bytesPerRow: 256 }, [32, c.n]);
      if (c.frames.length >= c.want) {
        const fs = c.frames;
        this.colTrace = null;
        void d.queue.onSubmittedWorkDone().then(() => c.done(fs));
      }
    };
  }
  /** the far rings asked last frame (a diagnostic: their level, step, window, hole) */
  private lastRings: TerrainRing[] = [];
  get rasterRingsInfo() {
    return {
      patchLevel: this.terrainRasterLevel,
      drawn: (this.terrainRaster as unknown as { ringsDrawn?: number } | null)?.ringsDrawn ?? 0,
      rings: this.lastRings.map((r) => ({ level: r.level, step: r.step, window: r.window, hole: r.hole, ratio: r.ratio })),
    };
  }
  /** the horizon's fixes (post.wgsl resolve and temporal — docs/progress/HORIZON-FLICKER.md): the raster's ground kept from the
   *  tracer's reconstruction; its history longer where it barely moves on the image — switches for comparisons */
  horizonKeep = true;
  horizonFarAlpha = true;
  /** the coarsest cache level drawn as a far ring (a lever — docs/progress/HORIZON-FLICKER.md: TERRAIN_CACHE_RING_LAST) */
  rasterRingLast = TERRAIN_CACHE_RING_LAST;
  /** The far rings to draw this frame: the cache's next coarser levels that are ready, each with its hole over the finer. */
  private terrainRings(frame: Float32Array, level: number, window: TerrainWindow, target: Target, s: Settings): TerrainRing[] {
    const out: TerrainRing[] = [];
    if (!this.rasterRingsOn || !this.lastNear || !this.lastCam) return out;
    const cv = this.context.canvas as HTMLCanvasElement;
    let finer = window;
    // (every coarser level out to the far rings' last — 2.4 km nodes —, each about the next finer; its step — the tracer's
    // tolerance and the rings' sparser shading — counted from the patch's level of before I3: the finer ones as that patch)
    const last = Math.max(this.rasterRingLast, level + 2);
    for (let lv = level + 1; lv <= last && lv < TERRAIN_CACHE_LEVELS; lv++) {
      const w = this.terrainSurfaceCache?.levelWindow(lv);
      // (a level not baked yet: none past it either — a ring's hole is the next finer one's)
      if (!w) break;
      const f = terrainRasterFrame(this.lastNear, this.lastCam, w, lv, target, { width: cv.width, height: cv.height }, "depth", s.fov, 1);
      f[30] = frame[30]!;
      f[31] = frame[31]!;
      // (its nodes on the finer grid: so many times its own index — the two rounds' ratio, 4 or 2 —, less the finer
      // window's — longitudes unwrapped, so modulo the finer level's round)
      const round = TERRAIN_CACHE_ROUNDS[lv - 1]!;
      const ratio = round / TERRAIN_CACHE_ROUNDS[lv]!;
      let dx = ratio * w.i - finer.i;
      dx -= Math.round(dx / round) * round;
      const step = Math.max(0, lv - Math.max(level, TERRAIN_CACHE_PATCH_REF));
      out.push({ frame: f, level: lv, window: w, hole: [dx, ratio * w.j - finer.j], ratio, step });
      finer = w;
    }
    return out;
  }

  private encodeTerrainRasterVisibility(enc: GPUCommandEncoder, target: Target, s: Settings) {
    // (the buildings' triangles drawn for the material's buildings — shadeLite, U2 —; without it, their boxes, the rays')
    if (this.sceneryRaster) this.sceneryRaster.meshes3d = this.rasterLite;
    if (!this.terrainRasterRequested || !this.lastNear || !this.lastCam) {
      this.terrainRaster?.suspend();
      return;
    }
    this.terrainRaster ??= new TerrainRaster(this.device, this.traceSource);
    if (target.width * target.height > TERRAIN_RASTER_MAX_PIXELS) {
      this.terrainRaster.idle("pixel-budget");
      return;
    }
    const level = this.terrainRasterLevel;
    const window = this.terrainSurfaceCache?.levelWindow(level);
    if (!window) {
      this.terrainRaster.idle("cache-not-ready");
      return;
    }
    const cv = this.context.canvas as HTMLCanvasElement;
    const frame = terrainRasterFrame(
      this.lastNear,
      this.lastCam,
      window,
      level,
      target,
      { width: cv.width, height: cv.height },
      s.earthTerrainRasterView === "off" ? "difference" : s.earthTerrainRasterView,
      s.fov,
      1476.625 * s.massSolar,
    );
    // (the frame's sub-pixel jitter, the rays' own — trace.wgsl rasterJitter, the same Halton index —, in NDC: output.zw)
    if (this.rasterJitter === "halton" && this.rasterPrimaryOn) {
      const i = (this.frameStamp % 16) + 1;
      const halton = (n: number, b: number) => {
        let f = 1,
          r = 0;
        while (n > 0) {
          f /= b;
          r += f * (n % b);
          n = Math.floor(n / b);
        }
        return r;
      };
      frame[30] = (2 * (halton(i, 2) - 0.5)) / target.width;
      frame[31] = (-2 * (halton(i, 3) - 0.5)) / target.height;
    }
    // The world's trees as raster instances (docs/PLAN-RENDU-RASTER-AAA.md étape 1b): culled before the pass, drawn in it
    // after the ground; the tracer told whether they were (mouthList[1].z — trace.wgsl RASTER_SCENERY), else it walks the
    // forest's grid as before.
    const sc = this.earthScenery;
    let trees = false;
    if (this.sceneryRasterOn && this.rasterPrimaryOn && s.earthScenery !== "off" && sc.supported && sc.forestCells > 0) {
      if (!this.sceneryRaster) {
        // (the trees' shadow map itself, now that it will be drawn: the targets bound to it again)
        if (this.treeShadow && this.tsmTex && this.tsmTex.width < TREE_SHADOW_N) {
          this.tsmTex = this.device.createTexture({
            label: "trees' shadow map",
            // (two layers: the trees', the buildings' — B8)
            size: [TREE_SHADOW_N, TREE_SHADOW_N, 2],
            format: "depth32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
          });
          if (this.live) this.bindTarget(this.live);
          if (this.offline) this.bindTarget(this.offline.target);
        }
        this.sceneryRaster = new SceneryRaster(this.device, this.traceSource, this.tsmTex);
        if (this.pendingSceneryLod) this.sceneryRaster.setLod(this.pendingSceneryLod);
      }
      const scp = sc.params();
      // (the shadow map drawn again only when its frame has moved — the camera 128 m in the Sun's plane, the Sun turned —, or
      // the scenery changed: the trees stand still, the Sun moves slowly; else the last one kept, read as it is)
      const fr = this.treeShadowFrame(scp);
      const moved =
        fr[15]! > 0.5 &&
        (!this.tsmValid ||
          this.tsmRevision !== sc.revision ||
          fr.some((x, i) => i !== 15 && Math.abs(x - this.tsmFrame[i]!) > (i >= 12 ? 1 : 1e-3)));
      this.tsmRedraw = moved;
      if (fr[15]! < 0.5) this.tsmValid = false;
      if (moved) {
        this.tsmNext.set(fr);
        this.tsmRevisionNext = sc.revision;
      }
      trees = this.sceneryRaster.encodeCull(
        enc,
        this.prof.pass("scenery raster cull"),
        frame,
        scp,
        sc.buffer,
        sc.forestCells,
        moved ? fr : this.tsmOff,
      );
    }
    const drawn = this.terrainRaster.encodeVisibility(
      enc,
      {
        params: this.paramBuf,
        table: this.bodyBuf,
        elevation: this.earthMaps.elev,
        tiles: this.earthTiles.texture,
        sampler: this.sampler,
      },
      frame,
      level,
      window,
      this.paramsF.subarray((69 + TILE_PARAM_VEC4S) * 4, (69 + TILE_PARAM_VEC4S + RUNWAY_VEC4S) * 4),
      (label, descriptor) => this.prof.pass(label, descriptor),
      trees ? (pass) => this.sceneryRaster!.draw(pass) : undefined,
      (this.lastRings = this.terrainRings(frame, level, window, target, s)),
    );
    this.encodeSunShadow(enc, drawn);
    // (the trees' and buildings' shadow map, from the Sun — its frame into the table where drawn; else off: the rays)
    if (drawn && trees && this.treeShadow && this.treeShadowOn && this.tsmRedraw) {
      if (this.sceneryRaster!.encodeShadow(enc, this.prof.pass("trees' shadow map").timestampWrites)) {
        this.tsmFrame.set(this.tsmNext);
        this.tsmRevision = this.tsmRevisionNext;
        this.tsmValid = true;
        this.device.queue.writeBuffer(this.bodyBuf, TABLE_TSM * 16, this.tsmFrame);
        this.tsmTableOn = true;
      }
    }
    // (the map valid and the raster on this frame: read — its frame put back if it was cleared —; else cleared after)
    const tsm = drawn && trees && this.treeShadow && this.treeShadowOn && this.tsmValid;
    if (tsm && !this.tsmTableOn) {
      this.device.queue.writeBuffer(this.bodyBuf, TABLE_TSM * 16, this.tsmFrame);
      this.tsmTableOn = true;
    }
    this.tsmDrawn = tsm;
    if (drawn && trees) {
      this.paramsF[MOUTH_LIST_AT + 6] = 1;
      this.device.queue.writeBuffer(this.paramBuf, (MOUTH_LIST_AT + 4) * 4, this.paramsF.subarray(MOUTH_LIST_AT + 4, MOUTH_LIST_AT + 8));
    }
  }

  /** The inspector's overlay on the final image, after the patch's visibility of this frame. */
  private encodeTerrainRasterInspector(enc: GPUCommandEncoder, target: Target, output: GPUTexture, s: Settings) {
    if (s.earthTerrainRasterView === "off" || !this.terrainRasterRequested) return;
    this.terrainRaster?.encodeInspector(enc, output, target.sceneDepth, (label, descriptor) => this.prof.pass(label, descriptor));
  }
  /** Experimental height-cache diagnostics, accessible through __bh.renderer. */
  get terrainCacheStats() {
    const stats = this.terrainSurfaceCache?.stats() ?? {
      compiled: false,
      error: null,
      levelsReady: 0,
      builds: 0,
      invalidations: 0,
      stagingBytes: 0,
      uniformBytes: 0,
    };
    return { requested: this.terrainCacheWanted, tableBytes: TERRAIN_CACHE_VEC4S * 16, ...stats };
  }
  /** The warp's grids kept round the camera near the Earth (its geodetic place), before any pass of the frame. */
  private updateWarp(s: Settings, time: number) {
    let at: { lon: number; lat: number } | null = null;
    const eye = homePosition(s);
    if (this.warpGrid && eye) {
      const q = toBodyFixed("earth", eye, time).map((v) => v * M_METRES) as Vec3;
      const g = cartToGeodetic(WGS84_A, WGS84_F, q);
      if (g.h < 300_000) at = { lon: g.lon, lat: g.lat };
    }
    this.warpOut.update(at);
  }
  get variantReady() {
    return this.featureKey === FEATURES_ALL || !!this.variants.get(this.featureKey)?.rt;
  }
  /** The current kernel settled: its own, its realtime cascade done (its probe's, its aerial table's pass), the
   *  surface and the scenery asked for in it — a measure taken now is this kernel's (variantReady alone let a
   *  tuned variant be measured without its aerial table, or its scenery: tests/e2e/perf-suite.e2e.test.ts). */
  get kernelsSettled() {
    if (this.featureKey === FEATURES_ALL) return false;
    const v = this.variants.get(this.featureKey);
    if (!v?.rt || v.busy) return false;
    if (this.earthSurface.active && (this.featureKey & 4096) === 0) return false;
    if (this.earthScenery.active && (this.featureKey & 8192) === 0) return false;
    return true;
  }
  /** the airfields' real weather when it came in (weather.ts, PLAN-METEO W7), the "real" setting's */
  weatherReal: WeatherState | null = null;
  /** the device was lost (its reason), or null */
  lost: string | null = null;
  onLost?: (why: string) => void;
  /** this renderer's generation: 1 at the start, one more for each made again after a loss (adopt) */
  generation = 1;
  /** the loss was simulated (simulateLoss) */
  private simulatedLoss = false;

  /**
   * The Earth's medium maps (22.7 MB) downloaded ahead of need — 3 s after the first image and once the sky is
   * in, not while the shaders compile (PLAN-MONDE M3): at 20 Mbit/s they put a scene without the Earth's first
   * image back from 7.2 to 11.1 s, and beside the sky they held it back 4 s more (PLAN-TITRE-AAA E0). Not on a
   * connection the user asked to spare (Save-Data: they come when a view needs them); no texture made — the
   * scene's loader keeps the GPU's residency.
   */
  private prefetchEarthSoon() {
    if (!earthPrefetchWanted()) return;
    const device = this.device;
    void afterSkyPrefetch(3000).then(() => {
      if (this.lost) return;
      void prefetchEarthMaps(device).catch((error) => {
        gpuDiagnostics.record("earth-prefetch", error);
        console.warn("Earth prefetch unavailable:", error);
      });
    });
  }

  /** The device lost on purpose — its recovery tested (PLAN-MONDE M2): destroyed, told as a reset. */
  simulateLoss() {
    this.earthScenery.dispose();
    this.simulatedLoss = true;
    this.earthSurface.dispose();
    this.terrainSurfaceCache?.dispose();
    this.terrainRaster?.dispose();
    this.sceneryRaster?.dispose();
    this.device.destroy();
  }

  /**
   * A renderer made on a new device after this one's was lost takes over what the page gave the old one
   * (PLAN-MONDE M2): its callbacks, the tier measured this session, the profiler's switch, the refresh
   * measured, the cockpit's dash. The rest the page sends each frame, or the renderer loads as it is
   * needed (the maps, the meshes) — the sky and the chart, the page sends again.
   */
  adopt(old: Renderer) {
    this.generation = old.generation + 1;
    this.onLost = old.onLost;
    this.onGpuError = old.onGpuError;
    this.onTracerFailure = old.onTracerFailure;
    this.onAssets = old.onAssets;
    this.exportWords = old.exportWords;
    this.tier = old.tier;
    this.refreshMs = old.refreshMs;
    this.cockpitDash = old.cockpitDash;
    this.cockpitControls = old.cockpitControls;
    this.shipGear = old.shipGear;
    this.jetPose = old.jetPose;
    this.a320Pose = old.a320Pose;
    this.a320Deck = old.a320Deck;
    this.prof.enabled = old.prof.enabled;
    this.water = { ...old.water };
    this.weatherReal = old.weatherReal;
    // (the old one silenced: a frame of it still in flight, failing, no longer starts a recovery)
    old.onLost = undefined;
    old.onGpuError = undefined;
    old.onTracerFailure = undefined;
    old.onAssets = null;
  }
  /** uncaptured GPU errors so far, and who hears of them */
  gpuErrors = 0;
  onGpuError?: (message: string) => void;

  frame(s: Settings, time: number, sceneChanged: boolean, timeChanged: boolean, displayChanged: boolean): FrameStats | null {
    if (this.lost) return null;
    if (this.busy) return null;
    if (s.earthTerrainRasterView === "off" && !s.earthTerrainRasterUse && s.earthPipeline !== "raster") this.terrainRaster?.suspend();
    else this.terrainRaster?.idle("waiting");
    // (polarization turned on or off: the live target remade with or without its buffer)
    this.wantPol = !!s.polarization;
    if (this.live && this.livePol !== this.wantPol) this.resize(this.live.width, this.live.height);
    if (this.offline) return this.offlineFrame(s, displayChanged);
    const t = this.live;
    if (!t) return null;
    const cv = this.context.canvas as HTMLCanvasElement;
    if (cv.width < 1 || cv.height < 1) return null;

    if ((sceneChanged && !this.evRedraw) || timeChanged) this.sceneAt = performance.now();
    this.evRedraw = false;
    if (sceneChanged) this.invalidate();
    this.configureOutput(s);
    this.prof.begin();
    this.updateWarp(s, time);
    this.probePlanets(t, s, time);
    const enc = this.device.createCommandEncoder();
    let phase: FrameStats["phase"];
    let rows = 0;
    // (the scene traced this frame — not yet while its kernel compiles at the start)
    let traced = false;

    // (the tier's convergence cap, plan §3.5: a still view on weak hardware refines less)
    const effective = effectiveQuality(s, this.tier);
    const targetSpp = effective.targetSpp;
    this.liveTargetSpp = targetSpp;
    this.liveQualityError = s.adaptiveIntegrator ? (this.qualityCompile.error ?? undefined) : undefined;
    // (the quality kernel failed: a still view converges on the fixed-step kernel — the path taken
    // with the error control off — rather than drawing realtime frames for ever)
    const adaptive = s.adaptiveIntegrator && this.qualityCompile.state !== "failed";
    const rasterInspecting =
      this.terrainRasterRequested &&
      s.earthTerrainRasterView !== "off" &&
      t.width * t.height <= TERRAIN_RASTER_MAX_PIXELS &&
      !this.terrainRaster?.unavailable;
    // (the raster drawing the near Earth, held — the camera still, the game paused —: realtime frames go on, the image the
    // flight's, its kernels the same — no other key, nothing to compile —; the tracer refines in the photo mode alone)
    // (wanted and eligible — the near Earth, the raster chosen —: held before its kernels are in too, a pause at the load)
    const rasterHeld = this.rasterHold && this.rasterEligibleNow;
    // (the general quality kernel — every feature, the later scenes' fallback — only once the general
    // realtime one is in: two kernels this size compiling side by side are minutes on a slow D3D12 driver,
    // 5 min each on an RX 5700 XT; the still view does not wait for it, below; not while the raster holds the view —
    // minutes of a compile for a refinement that will not come)
    if (
      this.firstFrameDoneAt &&
      this.generalCompile.state === "ready" &&
      !sceneChanged &&
      !timeChanged &&
      !this.terrainRasterDiagnostic &&
      !rasterHeld &&
      adaptive &&
      this.sampleIndex < targetSpp
    )
      void this.qualityCompile.start();
    // (the scene's quality kernel still compiling in the background — asked for here, the camera still:
    // traceVariant's quality cascade — a still view keeps the realtime path: sampleIndex stays at 0, the
    // convergence starts when the kernel lands)
    if (
      sceneChanged ||
      timeChanged ||
      rasterInspecting ||
      rasterHeld ||
      (adaptive && this.sampleIndex < targetSpp && !(this.firstFrameDoneAt && this.traceVariant("q", this.cameraKey)))
    ) {
      phase = "realtime";
      this.frameStamp++;
      this.updateValidFrom(time);
      this.sampleIndex = 0;
      this.bandY = 0;
      let block = this.motionBlock(s.realtimeSubsampling === "auto" ? this.realtimeBlock : s.realtimeSubsampling, s);
      // (the raster's material drawing all the near ground — under RASTER_SKY_KM its last ring, ±155 km, past the horizon —:
      // the trace's rays are the sky's alone, at infinity, the history reprojecting it exactly as the camera turns — one a
      // 16 × 16 block, not 8 × 8: 9–10 ms of the M1's frame a quarter of it — TERRE-UNREAL U6; the governor's own block
      // left as it was, for when the trace draws ground again)
      if (this.rasterSkyBlock && this.rasterLiteNow && this.liveAltKm < RASTER_SKY_KM && s.realtimeSubsampling === "auto")
        block = Math.max(block, RASTER_SKY_BLOCK);
      if (block !== this.lastBlock) this.interleaveIndex = 0;
      let order = this.orders.get(block);
      if (!order) this.orders.set(block, (order = interleaveOrder(block)));
      const offset = order[this.interleaveIndex++ % order.length]!;
      let flags = FLAG_INTERLEAVED;
      if (s.temporalBlend < 1) flags |= FLAG_TEMPORAL;
      if (s.temporalReprojection) flags |= FLAG_REPROJECT;
      // (R8: under the reprojection, the catalogue stars splatted where they fall — added over the
      // reprojected image, encodeTemporal; the pre-exposed radiance in 16.16 fixed point)
      // (not under a day's exposure near the ground — EV 14.6 over a sunlit Earth, 16.3 from the dusk on —: none would show,
      // the pass over the whole image for nothing, ~1 ms on an M1 — TERRE-UNREAL U6; elsewhere — the hole, its bright disk,
      // its lensed stars — always)
      this.starsSplat = s.temporalReprojection && this.splatStars && !(this.rasterEligibleNow && this.ev(s) < STARS_MIN_EV);
      if (this.starsSplat) enc.clearBuffer(t.stars);
      this.writeParams(t, s, time, {
        block,
        // (the tier's ceilings: the kernel's cost follows the hardware — plan §3.5)
        eps: effective.realtimeEps,
        steps: effective.realtimeSteps,
        y0: 0,
        y1: t.height,
        accumulate: false,
        sampleIndex: 0,
        flags,
        offset,
        stars: this.starsSplat ? preExposure(this.ev(s)) * 65536 : 0,
      });
      this.encodeCockpitMask(enc, t, s, block);
      this.tracingRealtime = true;
      traced = this.dispatchTrace(enc, t, Math.ceil(t.width / block), Math.ceil(t.height / block), false, s);
      this.tracingRealtime = false;
      this.dispatchEnv(enc, t, s);
      this.lastBlock = block;
      this.lastOffset = offset;
    } else if (this.sampleIndex < targetSpp) {
      phase = "converging";
      this.frameStamp++;
      this.validFrom = this.epoch;
      this.frameTimes.length = 0;
      const y0 = this.bandY;
      const y1 = Math.min(t.height, y0 + this.bandRows);
      rows = y1 - y0;
      let flags = 0;
      if (adaptive) flags |= FLAG_ADAPTIVE_RK;
      if (s.noiseThreshold > 0) flags |= FLAG_ADAPTIVE_SPP;
      this.writeParams(t, s, time, {
        block: 1,
        eps: s.qualityEps,
        steps: s.qualitySteps,
        y0,
        y1,
        accumulate: this.sampleIndex > 0,
        sampleIndex: this.sampleIndex,
        flags,
        tol: s.integratorTolerance,
        noise: effective.noiseThreshold,
        minSpp: 8,
      });
      // (the band's trace timed on the GPU: its own cost a row — the bands' measure below)
      traced = this.dispatchTrace(enc, t, t.width, rows, adaptive, undefined, (ms) => (this.bandRowMs = ms / rows));
      if (this.sampleIndex < 32) this.dispatchEnv(enc, t, s);
      // (no kernel yet: the band traced again next frame — the image does not converge on nothing)
      if (traced) {
        this.bandY = y1;
        if (this.bandY >= t.height) {
          this.bandY = 0;
          this.sampleIndex++;
        }
      }
    } else {
      phase = "converged";
      // (the rain moving over a still image: drawn every frame — held with the time, not)
      const rainMoves = !!this.rain && this.rainClock !== this.rainDrawn;
      this.rainDrawn = this.rainClock;
      if (this.lastPhase === "converged" && !displayChanged && !this.chartDirty && !rainMoves) return this.stats(phase, t);
    }

    this.writeResolve(t, s);
    this.writeDisplay(s, t, cv.width, cv.height, false, true, this.hdrActive);
    this.taPhase = phase;
    this.encodePost(enc, t, s);
    const outTex = this.context.getCurrentTexture();
    this.encodeDisplay(enc, t, this.canvasPipeline, outTex.createView());
    this.encodeTerrainRasterInspector(enc, t, outTex, s);
    this.encodeChart(enc, s, t, outTex.createView(), outTex.format, outTex.width, outTex.height, false);
    this.chartDirty = false;
    const auto = s.realtimeSubsampling === "auto";
    const used = this.lastBlock;
    // (the raster's shading rate this frame, when the governor chooses it — earthRasterShading "auto")
    const rate = this.rasterPrimaryOn && s.earthRasterShading === "auto" ? this.rasterRate : 0;
    const generation = this.timingGeneration;
    this.submit(
      enc,
      (ms) => {
        if (phase === "realtime" && auto && !this.terrainRasterDiagnostic && generation === this.timingGeneration) {
          // (the rate first: adaptBlock leaves out — and counts down — the frames after new resources)
          if (rate) this.adaptRasterRate(ms, this.frameBudget(s), rate, used);
          this.adaptBlock(ms, this.frameBudget(s), used);
        }
        if (phase === "converging" && rows > 0) {
          // (a row's cost: the trace pass's own, timed on the GPU — the frame's other passes, the cockpit's, the post's, are
          // no row's: on an M1 their ~60 ms against an 18 ms budget held the bands at 8 rows, ~8.5 s a pass —; the whole
          // frame's without the timestamps)
          const perRow = this.bandRowMs > 0 ? this.bandRowMs : ms / rows;
          // (the bands sized to the quality's frame budget — the Game's 16 ms keeps 60 fps while the image
          // refines —, 28 ms at most for the finer qualities; twice the last band at most: the sky's rows cost little, the
          // ground's below them much, and the time read back comes a frame or two late)
          const band = Math.min(28, this.frameBudget(s));
          const want = 0.5 * this.bandRows + 0.5 * (band / Math.max(perRow, 1e-3));
          this.bandRows = Math.round(Math.min(t.height, 2 * this.bandRows, Math.max(8, want)));
        }
      },
      traced,
    );
    // (a scene whose kernel still compiles, the general one not in yet: the last image stays — said)
    if (this.firstFrameDoneAt && phase !== "converged") this.noteSceneTracer(!traced);
    this.lastPhase = phase;
    return this.stats(phase, t);
  }

  private sceneTracerShown = false;
  /** the pill (splash.ts's AssetPill) while the scene's tracer compiles and nothing else can draw it */
  private noteSceneTracer(waiting: boolean) {
    if (waiting === this.sceneTracerShown) return;
    this.sceneTracerShown = waiting;
    if (waiting)
      loading.stage("scene-tracer", t("Compiling the ray tracer for this scene"), {
        indeterminate: true,
        eta: 30,
        remaining: () => this.sceneCompileEta(),
      });
    else loading.done("scene-tracer");
  }

  /**
   * Auto subsampling: coarser blocks when realtime frames exceed ~36 ms; finer ones when the
   * predicted cost at the next finer level (∝ number of rays) stays under ~26 ms.
   */
  /**
   * Picks the realtime block size for a GPU time budget per frame. Part of a frame's cost is fixed
   * (resolve, gather, bloom, display at full resolution — and what the browser's compositing makes it
   * wait, which no block size changes), so the cost of another block size is not simply ∝ its number
   * of rays: each size keeps its own measured time (EMA, remembered BLOCK_MEMORY ms); an unmeasured
   * finer size is predicted with half the frame assumed fixed. A coarser image only when it pays: the
   * coarser size not measured lately (tried), or measured a tenth faster at least; a finer one when it
   * fits the budget, or when it costs the frame no more than a tenth over the fastest size measured
   * (the frame bound elsewhere, the budget out of reach: the image kept sharp for nothing lost).
   */
  private adaptBlock(ms: number, budget: number, b: number) {
    const now = performance.now();
    const fresh = (x: number) => {
      const m = x ? this.blockMs.get(x) : undefined;
      return m && now - m.at < BLOCK_MEMORY ? m : undefined;
    };
    // (smoothed well: with two frames in flight, one frame's time swings from a third to twice the mean)
    // (a frame after new resources or a probe reset is left out; a spike is bounded by twice the recent
    // median: a hitch — the main thread busy, a compile — does not make the image coarser for seconds)
    if (this.eventFrames > 0) {
      this.eventFrames--;
      return;
    }
    // (a frame of the motion's denser rays: neither the block's time nor the recent median's — its block one finer
    // while the turn lasts, its cost not what the automatic choice weighs)
    if (this.lastFrameDense) return;
    const rec = this.recentMs;
    rec.push(ms);
    if (rec.length > 15) rec.shift();
    const med = [...rec].sort((x, y) => x - y)[rec.length >> 1]!;
    ms = Math.min(ms, 2 * med);
    const m = fresh(b);
    const est = m ? 0.85 * m.ms + 0.15 * ms : ms;
    this.blockMs.set(b, { ms: est, at: now });
    if (b !== this.realtimeBlock) return; // (a frame drawn before the last change)
    const i = BLOCKS.indexOf(b);
    const finer = i > 0 ? BLOCKS[i - 1]! : 0;
    const coarser = i < BLOCKS.length - 1 ? BLOCKS[i + 1]! : 0;
    const kf = fresh(finer),
      kc = fresh(coarser);
    let best = est;
    for (const x of BLOCKS) best = Math.min(best, fresh(x)?.ms ?? Infinity);
    // (what the frame may cost: the budget, or a tenth over the fastest size when none reaches it)
    const limit = Math.max(budget, 1.1 * best);
    // (the trace pass's own time from the GPU profiler: only it grows as (b / finer)²; without it,
    // half the frame assumed to)
    const trace = this.prof.traceMs();
    const guess = trace > 0 ? est + trace * ((b / finer) ** 2 - 1) : est * (0.5 + 0.5 * (b / finer) ** 2);
    const finerFits = !!finer && (kf ? kf.ms <= limit : guess < 0.9 * limit);
    const coarserPays = !!coarser && (kc ? kc.ms < 0.9 * est && est > 1.1 * limit : est > 1.1 * budget);
    // (decided on time, not frames: 150 ms over the budget for a coarser block, 400 ms of room for a
    // finer one — the same at 20 fps as at 120)
    if (coarserPays) {
      this.slowMs += ms;
      this.fastMs = 0;
    } else if (finerFits) {
      this.fastMs += ms;
      this.slowMs = 0;
    } else {
      this.slowMs = this.fastMs = 0;
    }
    if (this.slowMs >= 150) {
      this.realtimeBlock = coarser;
      this.slowMs = 0;
    } else if (this.fastMs >= 400) {
      this.realtimeBlock = finer;
      this.fastMs = 0;
    }
  }

  /** This frame without the raster's primary visibility (its shading kernels not compiled yet): the trace takes its pixels
   *  — the parameters' rate and the reconstruction's rewritten for this submission. */
  private dropRasterPrimary(t: Target) {
    this.rasterPrimaryOn = false;
    this.rasterHaltonNow = false;
    this.rasterDetailNow = false;
    this.paramsF[MOUTH_LIST_AT + 5] = 0;
    this.device.queue.writeBuffer(this.paramBuf, (MOUTH_LIST_AT + 4) * 4, this.paramsF.subarray(MOUTH_LIST_AT + 4, MOUTH_LIST_AT + 8));
    this.device.queue.writeBuffer(t.resolveBuf, 20, new Float32Array([0]));
  }
  /** The near Earth's pipeline this frame: the setting's, traced once the raster proved too heavy here (rasterFellBack). */
  earthPipelineNow(s: Pick<Settings, "earthPipeline">): "raster" | "trace" {
    return s.earthPipeline === "raster" && !this.rasterFellBack ? "raster" : "trace";
  }
  /** The raster's shading rate (1, 2, 4, 8, 16: one pixel in so many a frame): the setting's, or with "auto" the
   *  governor's — from the hardware tier's start (RASTER_RATE_START), then by the measured frame time. */
  private rasterRateFor(s: Pick<Settings, "earthRasterShading" | "realtimeSubsampling">): number {
    const fixed = RASTER_RATE_OF[s.earthRasterShading];
    if (fixed) return fixed;
    if (!this.autoRasterRate) this.autoRasterRate = RASTER_RATE_START[this.tier.level];
    return this.autoRasterRate;
  }
  /**
   * The raster's automatic shading rate (earthRasterShading "auto"), as adaptBlock the traced block: a pixel in so many
   * shaded a frame — the shading is the raster's main cost (docs/progress/raster-aaa/PERF-2026-10-21.md: 1/4 → 1/16, the
   * surfaces' shading 17–23 → 5–8 ms) —, coarser once the frame stays over its budget with the sky's block already
   * coarse (150 ms × 2: the block goes first), finer once it has had room for 1.5 s and the finer rate fits (measured,
   * or guessed: the shading's share doubled). Between one in two and one in sixteen; BLOCK_MEMORY per rate.
   */
  private adaptRasterRate(ms: number, budget: number, rate: number, block: number) {
    if (this.eventFrames > 0 || this.lastFrameDense) return;
    const now = performance.now();
    const fresh = (x: number) => {
      const m = x ? this.rasterRateMs.get(x) : undefined;
      return m && now - m.at < BLOCK_MEMORY ? m : undefined;
    };
    const rec = this.recentMs;
    if (rec.length) {
      const med = [...rec].sort((x, y) => x - y)[rec.length >> 1]!;
      ms = Math.min(ms, 2 * med);
    }
    const m = fresh(rate);
    const est = m ? 0.85 * m.ms + 0.15 * ms : ms;
    this.rasterRateMs.set(rate, { ms: est, at: now });
    if (rate !== this.autoRasterRate) return; // (a frame drawn before the last change)
    const i = (RASTER_RATES_AUTO as readonly number[]).indexOf(rate);
    const finer = i > 0 ? RASTER_RATES_AUTO[i - 1]! : 0;
    const coarser = i >= 0 && i < RASTER_RATES_AUTO.length - 1 ? RASTER_RATES_AUTO[i + 1]! : 0;
    const kf = fresh(finer);
    const coarserPays = !!coarser && est > 1.1 * budget && block >= 4;
    const finerFits = !!finer && (kf ? kf.ms <= 0.9 * budget : est < 0.55 * budget);
    if (coarserPays) {
      this.rateSlowMs += ms;
      this.rateFastMs = 0;
    } else if (finerFits) {
      this.rateFastMs += ms;
      this.rateSlowMs = 0;
    } else {
      this.rateSlowMs = this.rateFastMs = 0;
    }
    if (this.rateSlowMs >= 300) {
      this.autoRasterRate = coarser;
      this.rateSlowMs = 0;
    } else if (this.rateFastMs >= 1500) {
      this.autoRasterRate = finer;
      this.rateFastMs = 0;
    }
  }
  /** the automatic shading rate now (0: not chosen yet) and its frames' times by rate */
  private autoRasterRate = 0;
  private rasterRateMs = new Map<number, { ms: number; at: number }>();
  private rateSlowMs = 0;
  private rateFastMs = 0;
  /** the raster pipeline given up for the traced one on this device, for the session: main.ts's governor, the frame over
   *  its budget and a half at the coarsest rate and the smallest scale for 12 s (the setting changed: tried again) */
  rasterFellBack = false;
  /** the traced pipeline flown after a fallback and found no faster (main.ts): the raster kept, not given up again until the
   *  setting changes */
  rasterKept = false;
  /** the automatic shading rate (earthRasterShading "auto"): the coarsest it may go — main.ts's fallback watches it */
  get rasterRateCoarsest() {
    return this.rasterPrimaryOn && this.rasterRate >= RASTER_RATES_AUTO[RASTER_RATES_AUTO.length - 1]!;
  }

  /**
   * The realtime block while the image slides fast (settings.motionDetail): one finer — 4 → 3, 6 → 4, 8 → 6 — once the
   * camera's line of sight turns faster than MOTION_DENSE_IN pixels a second for 200 ms (over 8 frames: the shake's
   * jitter cancels), and with "low" once the seen ground slides faster than GROUND_DENSE_IN (imageGroundPx: low and
   * fast, straight on); back once both are under their lower lines for 300 ms. The history gives way then and the image
   * is the reconstruction of the frame's rays (docs/PLAN-RENDU-PERF.md 12., 13.): more of them, their cost while it
   * lasts. The automatic block and the dynamic resolution leave these frames out (lastFrameDense).
   */
  private motionBlock(block: number, s: Settings): number {
    const now = performance.now();
    if (s.motionDetail === "off" || block < 3) {
      this.motionDenseOn = false;
      return block;
    }
    // (on after 200 ms over the line — a gust's jolt in straight flight is not a turn —, off after 300 ms under the other)
    const low = s.motionDetail === "low";
    const over = this.imageTurnPx > MOTION_DENSE_IN || (low && this.imageGroundPx > GROUND_DENSE_IN);
    const under = this.imageTurnPx < MOTION_DENSE_OUT && (!low || this.imageGroundPx < GROUND_DENSE_OUT);
    if (over) {
      this.motionTurnSince ||= now;
      if (now - this.motionTurnSince > 200) this.motionDenseOn = true;
      this.motionCalmSince = 0;
    } else {
      this.motionTurnSince = 0;
      if (this.motionDenseOn && under) {
        this.motionCalmSince ||= now;
        if (now - this.motionCalmSince > 300) this.motionDenseOn = false;
      } else this.motionCalmSince = 0;
    }
    return this.motionDenseOn ? BLOCKS[BLOCKS.indexOf(block) - 1]! : block;
  }
  /** the camera's turn: its line of sight's over its last 8 frames [px a second] — motionBlock's measure in a turn */
  imageTurnPx = 0;
  /** the seen ground's slide: its mean over fifteen of the view's directions, the sky's nothing [px a second] —
   *  motionBlock's measure in low flight */
  imageGroundPx = 0;
  private fwdPast: { f: Vec3; at: number }[] = [];
  private motionDenseOn = false;
  private motionCalmSince = 0;
  private motionTurnSince = 0;

  private liveTargetSpp = 0;
  private liveQualityError: string | undefined;

  private stats(phase: FrameStats["phase"], t: Target): FrameStats {
    const frac = this.bandY / Math.max(t.height, 1);
    return {
      phase,
      targetSpp: this.liveTargetSpp,
      qualityError: this.liveQualityError,
      block: this.lastBlock,
      spp: phase === "realtime" ? 0 : this.sampleIndex + (phase === "converging" ? frac : 0),
      gpuMs: this.lastGpuMs,
      width: t.width,
      height: t.height,
    };
  }

  // ------------------------------------------------------------------------------------ offline
  get offlineActive() {
    return !!this.offline;
  }
  /** the offline render's scene (its settings, time, image size), or null */
  get offlineScene(): { settings: Settings; time: number; width: number; height: number } | null {
    const o = this.offline;
    return o ? { settings: o.settings, time: o.time, width: o.target.width, height: o.target.height } : null;
  }

  get offlineState(): OfflineStatus | null {
    return this.offline ? this.offlineStatus(this.offline) : null;
  }

  /** Starts a render of the current scene, frozen in time, at an arbitrary resolution. */
  /** The Earth's maps and terrain tiles the view wants are in (none loading). */
  get earthSettled() {
    return (
      !this.earthTiles.pending &&
      !this.earthSurface.pending &&
      !this.earthScenery.pending &&
      !this.earthHeld &&
      !(this.earthWant && this.earthWant !== this.earthMaps.tier) &&
      !(this.earthIsNear && !this.earthMaps.tier)
    );
  }
  /** the camera in the Earth's local patch (its maps wanted, whether or not asked for yet) */
  private earthIsNear = false;

  startOffline(s: Settings, time: number, opts: OfflineOptions) {
    this.envReset = true; // the spaceship's light probe: from this camera only (video frames)
    this.cancelOffline();
    this.offline = {
      target: this.createTarget(opts.width, opts.height, s.polarization),
      settings: structuredClone(s),
      time,
      opts,
      sampleIndex: 0,
      bandY: 0,
      bandRows: 8,
      elapsed: 0,
      lastTick: performance.now(),
      paused: false,
      done: false,
      shown: false,
      tiles: this.earthTiles.stamp,
      surface: this.earthSurface.stamp,
      scenery: this.earthScenery.stamp,
    };
  }

  pauseOffline(paused: boolean) {
    if (!this.offline) return;
    this.offline.paused = paused;
    this.offline.lastTick = performance.now();
    this.offline.shown = false;
  }

  /** Changes the per-frame GPU budget of a running job. */
  setOfflineBudget(ms: number) {
    if (this.offline) this.offline.opts.budgetMs = ms;
  }

  cancelOffline() {
    if (!this.offline) return;
    const t = this.offline.target;
    this.offline = null;
    this.device.queue.onSubmittedWorkDone().then(() => this.destroyTarget(t));
    this.invalidate();
  }

  private offlineStatus(job: OfflineJob): OfflineStatus {
    const { opts, target } = job;
    const spp = job.sampleIndex + job.bandY / target.height;
    const progress = job.done ? 1 : Math.min(1, spp / opts.spp);
    return {
      width: target.width,
      height: target.height,
      progress,
      spp,
      targetSpp: opts.spp,
      elapsed: job.elapsed,
      eta: progress > 0.002 && !job.done ? (job.elapsed * (1 - progress)) / progress : NaN,
      paused: job.paused,
      done: job.done,
      error: job.error,
    };
  }

  private offlineFrame(display: Settings, displayChanged: boolean): FrameStats | null {
    const job = this.offline!;
    const t = job.target;
    // the frozen scene, with the live exposure / tone mapping / bloom so they stay adjustable
    const s = {
      ...job.settings,
      exposure: display.exposure,
      tonemap: display.tonemap,
      bloom: display.bloom,
      hdr: display.hdr,
      hdrPeak: display.hdrPeak,
    };
    this.configureOutput(s);
    const cv = this.context.canvas as HTMLCanvasElement;
    const now = performance.now();
    const working = !job.paused && !job.done && !job.error;
    if (working) job.elapsed += (now - job.lastTick) / 1000;
    job.lastTick = now;
    const result = (): FrameStats => ({
      phase: "offline",
      block: 1,
      spp: job.sampleIndex,
      gpuMs: this.lastGpuMs,
      width: t.width,
      height: t.height,
      offline: this.offlineStatus(job),
      qualityError: job.fixedSteps,
    });
    if (!working && job.shown && !displayChanged) return result();
    // (the quality kernel still compiling: the job waits — the dialog polls offlineState.done; failed:
    // the job renders on the fixed-step kernel, as with the error control off, and the status says so)
    if (job.opts.tolerance > 0 && !this.qualityPipeline && !job.fixedSteps) {
      void this.qualityCompile.start();
      if (this.qualityCompile.state !== "failed") return result();
      job.fixedSteps = this.qualityCompile.error ?? "Quality pipeline unavailable";
    }
    const adaptive = job.opts.tolerance > 0 && !job.fixedSteps;
    if (job.error) return result();

    const enc = this.device.createCommandEncoder();
    let rows = 0;
    // (the terrain tiles come in while it renders: started again on them)
    if (job.tiles !== this.earthTiles.stamp || job.surface !== this.earthSurface.stamp || job.scenery !== this.earthScenery.stamp) {
      job.tiles = this.earthTiles.stamp;
      job.surface = this.earthSurface.stamp;
      job.scenery = this.earthScenery.stamp;
      job.sampleIndex = 0;
      job.bandY = 0;
      job.done = false;
    }
    if (working) {
      this.frameStamp++;
      const o = job.opts;
      const y0 = job.bandY;
      const y1 = Math.min(t.height, y0 + job.bandRows);
      rows = y1 - y0;
      let flags = 0;
      if (adaptive) flags |= FLAG_ADAPTIVE_RK;
      if (o.noiseThreshold > 0) flags |= FLAG_ADAPTIVE_SPP;
      this.writeParams(t, s, job.time, {
        block: 1,
        eps: o.eps,
        steps: o.maxSteps,
        y0,
        y1,
        accumulate: job.sampleIndex > 0,
        sampleIndex: job.sampleIndex,
        flags,
        tol: o.tolerance,
        noise: o.noiseThreshold,
        minSpp: o.minSpp,
        shutter: o.shutter,
      });
      // (the scene's kernel still compiling, the general one not in yet: the band traced again next frame)
      const traced = this.dispatchTrace(enc, t, t.width, rows, adaptive);
      this.dispatchEnv(enc, t, s);
      if (traced) job.bandY = y1;
      if (traced && job.bandY >= t.height) {
        job.bandY = 0;
        job.sampleIndex++;
        // (not before the Earth's maps and its terrain tiles are in: they would come into the next frame)
        if (job.sampleIndex >= o.spp && this.earthSettled) job.done = true;
      }
    }
    this.writeResolve(t, s);
    this.writeDisplay(s, t, cv.width, cv.height, true, true, this.hdrActive);
    this.encodePost(enc, t, s);
    const outTex = this.context.getCurrentTexture();
    this.encodeDisplay(enc, t, this.canvasPipeline, outTex.createView());
    this.encodeChart(enc, s, t, outTex.createView(), outTex.format, outTex.width, outTex.height, true);
    this.chartDirty = false;
    this.submit(enc, (ms) => {
      if (rows > 0) {
        const perRow = ms / rows;
        job.bandRows = Math.round(Math.min(t.height, Math.max(2, 0.5 * job.bandRows + 0.5 * (job.opts.budgetMs / Math.max(perRow, 1e-3)))));
      }
    });
    job.shown = true;
    return result();
  }

  // ------------------------------------------------------------------------------------ validation
  /**
   * Precision probe: integrates equatorial rays (impact parameter b, initial p_r at r0) on the GPU
   * with the quality integrator, with or without compensated summation, and returns their final
   * states (compare with scripts/precision-probe.ts, float64).
   */
  async precisionProbe(
    job: { a: number; rEscape: number; captureTol: number; rays: { r: number; theta: number; L: number; pr: number; pth: number }[] },
    tol: number,
    compensated: boolean,
  ) {
    const d = this.device;
    const module = d.createShaderModule({ code: this.traceSource });
    const pipeline = await d.createComputePipelineAsync({
      layout: "auto",
      compute: { module, entryPoint: "probe", constants: { QUALITY_PIPELINE: 1 } },
    });
    const params = new Float32Array(PARAM_VEC4S * 4);
    params.set([job.a, horizon(job.a), isco(job.a), 22], 8 * 4);
    params.set([0.02, 400000, job.rEscape, job.captureTol], 10 * 4);
    params.set([0, 0, 0, 1], 19 * 4);
    const pbuf = d.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(pbuf, 0, params);
    const io = new Float32Array(job.rays.length * 12);
    job.rays.forEach((r, i) => io.set([r.r, r.theta, r.L, r.pr, r.pth, tol, compensated ? 1 : 0, 0], i * 12));
    const buf = d.createBuffer({ size: io.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(buf, 0, io);
    const read = d.createBuffer({ size: io.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    // the integrator's helpers reach `bodies` (binding 15); with no bodies (P.bodyCfg.x = 0) it is never
    // read, but the layout wants it: an empty one rather than the scene's
    const bodies = d.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      d.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: pbuf } },
          { binding: 12, resource: { buffer: buf } },
          { binding: 15, resource: { buffer: bodies } },
        ],
      }),
    );
    pass.dispatchWorkgroups(Math.ceil(job.rays.length / 64));
    pass.end();
    enc.copyBufferToBuffer(buf, 0, read, 0, io.byteLength);
    d.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(read.getMappedRange().slice(0));
    read.unmap();
    for (const b of [pbuf, buf, read, bodies]) b.destroy();
    return job.rays.map((_, i) => ({
      state: Array.from(out.subarray(i * 12, i * 12 + 4)),
      fate: out[i * 12 + 6]!,
      steps: out[i * 12 + 7]!,
      crossings: Array.from(out.subarray(i * 12 + 8, i * 12 + 8 + out[i * 12 + 11]!)),
    }));
  }

  // ------------------------------------------------------------------------------------ export
  private async readTexture(tex: GPUTexture, w: number, h: number, bpp: number): Promise<Uint8Array> {
    const bytesPerRow = Math.ceil((w * bpp) / 256) * 256;
    const buf = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex, mipLevel: 0 }, { buffer: buf, bytesPerRow }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8Array(w * h * bpp);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * bpp), y * w * bpp);
    buf.unmap();
    buf.destroy();
    return out;
  }

  private exportTarget(): Target {
    if (this.lost || this.offline?.error) throw new Error(this.lost ?? this.offline!.error);
    return this.offline?.target ?? this.live!;
  }

  /** Tone-mapped image of a target at its native resolution (8- or 16-bit float output). */
  private async renderDisplayed(s: Settings, t: Target, bits: 8 | 16): Promise<Uint8Array> {
    if (bits === 8) {
      await this.export8Compile.start();
      if (!this.export8Pipeline) throw new Error(`Export pipeline unavailable: ${this.export8Compile.error}`);
      if (t !== this.exportTarget()) throw new Error("The export target changed while its pipeline compiled");
      this.bindDisplay(t);
    }
    const format: GPUTextureFormat = bits === 8 ? "rgba8unorm" : "rgba16float";
    const pipeline = bits === 8 ? this.export8Pipeline! : this.export16Pipeline;
    const tex = this.device.createTexture({
      size: [t.width, t.height],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const enc = this.device.createCommandEncoder();
    this.writeResolve(t, s);
    this.writeDisplay(s, t, t.width, t.height, false, bits === 8);
    this.encodePost(enc, t, s);
    this.encodeDisplay(enc, t, pipeline, tex.createView());
    this.encodeChart(enc, s, t, tex.createView(), format, t.width, t.height, false, false);
    this.device.queue.submit([enc.finish()]);
    const data = await this.readTexture(tex, t.width, t.height, bits === 8 ? 4 : 8);
    tex.destroy();
    return data;
  }

  /** Current image (the offline render if one exists, else the live view) as an 8-bit sRGB PNG. */
  /** Tone-mapped 8-bit sRGB pixels (RGBA) of the offline render (or the live view). */
  async exportRGBA(s: Settings): Promise<{ data: Uint8Array; width: number; height: number }> {
    const t = this.exportTarget();
    const px = await this.renderDisplayed(s, t, 8);
    const data = new Uint8Array(px.buffer, px.byteOffset, t.width * t.height * 4);
    if (!this.exportWords) return { data, width: t.width, height: t.height };
    const c = this.withWords(data, t.width, t.height);
    return {
      data: new Uint8Array(c.getContext("2d")!.getImageData(0, 0, t.width, t.height).data.buffer),
      width: t.width,
      height: t.height,
    };
  }

  async exportPNG(s: Settings): Promise<Blob> {
    const t = this.exportTarget();
    const px = await this.renderDisplayed(s, t, 8);
    return this.withWords(new Uint8Array(px.buffer, px.byteOffset, t.width * t.height * 4), t.width, t.height).convertToBlob({
      type: "image/png",
    });
  }

  /** words drawn over an exported image (the sky chart's labels: main.ts), its width and height [px] */
  exportWords: ((ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => void) | null = null;
  private withWords(px: Uint8Array, w: number, h: number) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, w * h * 4), w, h), 0, 0);
    this.exportWords?.(ctx, w, h);
    return canvas;
  }

  /** 16 bits per channel, tone-mapped sRGB PNG (no dithering). */
  async exportPNG16(s: Settings): Promise<Blob> {
    const t = this.exportTarget();
    const half = new Uint16Array((await this.renderDisplayed(s, t, 16)).buffer);
    const f = new Float32Array(half.length);
    for (let i = 0; i < half.length; i++) f[i] = halfToFloat(half[i]!);
    return encodePNG16(f, t.width, t.height);
  }

  /** Scene-referred linear radiance (× exposure) as half-float OpenEXR: no bloom, no tone mapping. */
  async exportEXR(s: Settings): Promise<Blob> {
    const t = this.exportTarget();
    const enc = this.device.createCommandEncoder();
    this.writeResolve(t, s);
    this.encodePost(enc, t, s);
    this.device.queue.submit([enc.finish()]);
    const half = new Uint16Array((await this.readTexture(t.hdr, t.width, t.height, 8)).buffer);
    const k = 2 ** this.ev(s) / preExposure(this.ev(s));
    const f = new Float32Array(half.length);
    for (let i = 0; i < half.length; i++) f[i] = halfToFloat(half[i]!) * k;
    return encodeEXR(f, t.width, t.height);
  }
}

/**
 * The factor the radiance is scaled by before it is stored in half floats (resolve), undone by the
 * display: 1 at the usual exposures, 2^(EV − 4) beyond (a sunlit Saturn at 9.5 AU is ~10⁻⁷ of the
 * disk's radiance, below the half floats' normal range).
 */
export function preExposure(ev: number) {
  return 2 ** Math.min(Math.max(ev - 4, 0), 40);
}

/** "#rrggbb" (sRGB) → linear RGB. */
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}
