import traceWGSL from "./shaders/trace.wgsl" with { type: "text" };
import { bodyAxes, M_METRES, mapIndex, seenFrom, solarBody, solarState, sunShare, type MapName } from "./system/solar";
import { HD_SETS, loadHdMap, placeholderHd, type HdMap } from "./system/hd-maps";
import { bakeNoise3d } from "./noise3d";
import { guessTier, type Tier } from "./tier";
import displayWGSL from "./shaders/display.wgsl" with { type: "text" };
import postWGSL from "./shaders/post.wgsl" with { type: "text" };
import skyWGSL from "./shaders/sky.wgsl" with { type: "text" };
import shipWGSL from "./shaders/ship.wgsl" with { type: "text" };
import enduranceWGSL from "./shaders/endurance.wgsl" with { type: "text" };
import stationWGSL from "./shaders/station.wgsl" with { type: "text" };
import { ENV_H, ShipRenderer, type Reentry, type ShipInstance, type Thrust } from "./ship";
import { fleet } from "./fleet";
import { vesselHulls } from "./system/collide";
import { EnduranceRenderer } from "./endurance";
import { StationRenderer, type StationView } from "./station";
import { issAxes, issTrack, refreshIssElements, stationAngles } from "./system/iss";
import { GpuProfiler } from "./gpuprof";
import { shipToCamera, type Mount, type MountPose } from "./mounts";
import milkyWayUrl from "../assets/sky/milkyway.webp";
import { loading } from "./loading";
import starCatalogueUrl from "../assets/sky/stars.bin";
import starLodUrl from "../assets/sky/starlod.bin";
import { SkyTextureBuilder, loadPackedTexture, loadStarCatalogue, skyMatrix } from "./sky";
import { ChartOverlay } from "./chartoverlay";
import overlayWGSL from "./shaders/overlay.wgsl" with { type: "text" };
import { cameraFrame, gpuTheta, homePosition, type CameraFrame } from "./camera";
import { mouth, radius, setSceneTime } from "./wormhole";
import {
  BODY_PLANET,
  BODY_STAR,
  BODY_VEC4,
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
import { loadEarthMaps, placeholderEarth, type EarthMaps, type EarthTier } from "./system/earth-maps";
import { EarthTiles, TILE_PARAM_VEC4S } from "./system/earth-tiles";
import { setGroundRelief } from "./system/our-surface";
import { EARTH_RM, earthHeightSampler } from "./terrain";
import { AIR_K, sunThroughY } from "./system/earth-air";
import { homeOf, homeToRep } from "./system/our-side";
import type { Vec3 } from "./physics";
import { bodyPlace, localPatch } from "./system/local-patch";
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
/** every feature of the tracer kept (the general pipelines) */
const FEATURES_ALL = 255;
/** how long a block size's measured frame time is remembered [ms] (then tried again) */
const BLOCK_MEMORY = 20000;
const PARAM_VEC4S = 69 + TILE_PARAM_VEC4S;
/** the probe's harmonics as the tracer reads them: 9 × rgb, then the dominant direction */
const SH_BYTES = 10 * 16;
/** Camera free-fall path drawn in the render: points, then bounding spheres of chunks of 16 segments. */
const PATH_MAX = 256;
const PATH_CHUNK = 16;
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
/** realtime pass under the temporal reprojection: rays prefiltered over their pixel, not their block */
const FLAG_REPROJECT = 16;
/** the far field's LUT is there (trace.wgsl: farLut) */
const FLAG_LUT = 32;
/** the features under which the far field's LUT is not used: radio, polarization, jet, hot spot, hot flow,
 *  the wormhole, bodies — what a ray between two clean samples could meet unseen */
const LUT_BLOCKERS = 1 | 2 | 4 | 8 | 16 | 32 | 128;

/**
 * Bun's dev server sometimes serves a `type: "text"` import as an asset URL after a hot reload
 * (the production bundle inlines it). Accept both.
 */
async function wgsl(src: string): Promise<string> {
  if (/^(\/|https?:)\S*\.wgsl$/.test(src.trim())) return (await fetch(src.trim())).text();
  return src;
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
}

export interface FrameStats {
  phase: "realtime" | "converging" | "converged" | "offline";
  block: number;
  spp: number;
  gpuMs: number;
  width: number;
  height: number;
  offline?: OfflineStatus;
}

interface Target {
  width: number;
  height: number;
  accum: GPUBuffer;
  moments: GPUBuffer;
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
  polGrid: GPUBuffer; // per tick cell Σ I, Q, U, n
  polGridBuf: GPUBuffer; // cell px, grid W, grid H, image W
  polGridPass: GPUBindGroup;
  beam: { level: number; tex: GPUTexture; buf: GPUBuffer; h: GPUBindGroup; v: GPUBindGroup } | null;
  denoise: { tex: GPUTexture; bufs: GPUBuffer[]; binds: GPUBindGroup[] } | null;
  /** the temporal reprojection's history (ping-pong) and its uniform (made on first use, live only) */
  temporal: { hist: GPUTexture[]; buf: GPUBuffer; binds: GPUBindGroup[]; idx: number; valid: boolean } | null;
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
  shown: boolean;
  /** the terrain tiles drawn when it started (EarthTiles.stamp): restarted when more come in */
  tiles: number;
}

export class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private tracePipeline!: GPUComputePipeline; // realtime kernel
  private qualityPipeline!: GPUComputePipeline; // + error-controlled integrator
  private traceLayout: GPUBindGroupLayout;
  private displayPipeline: GPURenderPipeline; // SDR canvas (preferred format)
  private sdrFormat: GPUTextureFormat;
  private hdrActive = false;
  private export8Pipeline: GPURenderPipeline;
  private export16Pipeline: GPURenderPipeline;
  private postResolve: GPUComputePipeline;
  private postGatherH: GPUComputePipeline;
  private postDown: GPUComputePipeline;
  private postDownShip: GPUComputePipeline;
  private postDof: GPUComputePipeline;
  private postFlare: GPUComputePipeline;
  /** (bound where a target has no depth-of-field image yet) */
  private dofDummy: GPUTexture;
  private postUp: GPUComputePipeline;
  private postPolGrid: GPUComputePipeline;
  private postBeamH: GPUComputePipeline;
  private postAtrous: GPUComputePipeline;
  private postTemporal: GPUComputePipeline;
  private noise3d!: GPUTexture;
  private noiseSampler!: GPUSampler;
  private postBeamV: GPUComputePipeline;
  private params = new ArrayBuffer(PARAM_VEC4S * 16);
  /** The spaceship carrying the camera, and the light probe that lights it. */
  readonly ship: ShipRenderer;
  readonly endurance: EnduranceRenderer;
  private enduranceLoading: Promise<void> | null = null;
  /** The International Space Station on its real orbit (station.ts, system/iss.ts). */
  readonly station: StationRenderer;
  private stationLoading: Promise<void> | null = null;
  /** the disk's reference luminance (log10 Y) of the last frame's parameters: the stars' scale */
  private lastLogY = 0;
  /** the last frame's bodies (the stars' radius, temperature, brightness) */
  private lastBodies: GpuBody[] = [];
  /** the camera frame and time of the last image traced (the Endurance is drawn with them) */
  private lastCam: CameraFrame | null = null;
  private lastTime = 0;
  /** GPU time per pass (timestamp queries; off unless switched on) */
  readonly prof: GpuProfiler;
  private envPipeline!: GPUComputePipeline;
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
   * Cinematic liquid throat: its clock [s] (advanced by the app, or by the video renderer) and the
   * splash left where the camera last went through (centre on the throat, clock then).
   */
  water = { clock: 0, splash: [0, 0, 1] as [number, number, number], splashAt: -1e9, side: 0 };
  private paramsF = new Float32Array(this.params);
  private paramsU = new Uint32Array(this.params);
  private paramBuf: GPUBuffer;
  private displayBuf: GPUBuffer;
  private lutBuf: GPUBuffer;
  private syncLutBuf: GPUBuffer;
  private bgTexture: GPUTexture;
  private mwTexture: GPUTexture;
  private starLodTexture: GPUTexture;
  /** the solar system's maps and Saturn's rings (placeholders until loaded, on first use) */
  private planetMaps: PlanetMaps;
  private mapsRequested = false;
  /** the Earth's maps (placeholders until loaded; the finer ones when the camera comes near it) */
  private earthMaps: EarthMaps;
  /** the Earth's real ground near the camera, streamed (src/system/earth-tiles.ts) */
  readonly earthTiles: EarthTiles;
  private earthWant: EarthTier | null = null;
  /** the finest Earth tier this GPU's memory held (lowered when one ran out) */
  private earthCap: EarthTier | "none" = "high";
  /** the Earth maps' latest request (an older one landing late is dropped) */
  private earthJob = 0;
  /** when its disk was last over 12 pixels [ms] */
  private earthSeenAt = 0;
  /** the finer maps of the body near the camera (one at a time), and the one being loaded */
  private hdMap!: HdMap;
  private hdLoading: MapName | null = null;
  // auto exposure: the light meter (a histogram of the image, read back), its state
  private meterPipeline!: GPUComputePipeline;
  private histBuf!: GPUBuffer;
  private histStage!: GPUBuffer;
  private meterPending = false;
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
  private pathBuf!: GPUBuffer;
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
  /** the tracer's general pipelines compiled (create() waits for it: nothing is drawn before) */
  private tracerCompiled: Promise<void>;
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
  private realtimeBlock = 2;
  /** the realtime subsampling in use (one ray per block × block pixels) */
  get realtimeBlockNow() {
    return this.realtimeBlock;
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
  private lastPhase: FrameStats["phase"] = "realtime";
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
    src: { trace: string; display: string; post: string; sky: string; ship: string; endurance: string; station: string; overlay: string },
  ) {
    this.device = device;
    this.context = context;
    this.sdrFormat = format;
    this.traceSource = src.trace;

    const traceModule = device.createShaderModule({ code: src.trace, label: "trace" });
    const displayModule = device.createShaderModule({ code: src.display, label: "display" });
    const postModule = device.createShaderModule({ code: src.post, label: "post" });
    // explicit layout shared by the realtime and quality variants of the tracer
    const C = GPUShaderStage.COMPUTE;
    this.traceLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: "uniform" } },
        { binding: 1, visibility: C, buffer: { type: "storage" } },
        { binding: 2, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: C, texture: { sampleType: "float" } },
        { binding: 4, visibility: C, sampler: { type: "filtering" } },
        { binding: 5, visibility: C, buffer: { type: "storage" } },
        { binding: 6, visibility: C, buffer: { type: "storage" } },
        { binding: 7, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 8, visibility: C, texture: { sampleType: "float" } },
        { binding: 9, visibility: C, texture: { sampleType: "float" } },
        { binding: 10, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 11, visibility: C, buffer: { type: "storage" } },
        { binding: 13, visibility: C, buffer: { type: "read-only-storage" } },
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
        { binding: 28, visibility: C, texture: { sampleType: "unfilterable-float", viewDimension: "2d-array" } },
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
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout] });
    // (the far field's LUT: written by its own pass, read by the main kernel — a second bind group)
    this.lutWriteLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, storageTexture: { access: "write-only", format: "rgba32float" } },
        { binding: 1, visibility: C, storageTexture: { access: "write-only", format: "r32float" } },
      ],
    });
    this.lutReadLayout = device.createBindGroupLayout({
      entries: [
        { binding: 2, visibility: C, texture: { sampleType: "unfilterable-float" } },
        { binding: 3, visibility: C, texture: { sampleType: "unfilterable-float" } },
      ],
    });
    this.mainLayout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, this.lutReadLayout] });
    this.lutLayout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, this.lutWriteLayout] });
    // (compiled asynchronously, all at once: the tracer is a huge shader — on Windows (D3D12) one takes a
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
        entries: [
          { binding: 2, resource: tx[0]!.createView() },
          { binding: 3, resource: tx[1]!.createView() },
        ],
      });
    }
    this.tracerCompiled = Promise.all([
      mkLut(false),
      mkLut(true),
      mkTrace(true),
      mkTrace(false),
      device.createComputePipelineAsync({
        layout,
        compute: { module: traceModule, entryPoint: "env", constants: { QUALITY_PIPELINE: 0 } },
      }),
    ]).then(([lut, lutq, q, rt, env]) => {
      this.lutPipeline = lut;
      this.lutQPipeline = lutq;
      this.qualityPipeline = q;
      this.tracePipeline = rt;
      this.envPipeline = env;
    });
    this.traceModule = traceModule;
    this.tracePipeLayout = layout;
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
    this.prof = new GpuProfiler(device);
    // (on whenever the GPU has timestamps: no measurable cost, and the realtime subsampling uses it)
    this.prof.enabled = this.prof.supported;
    this.ship.prof = this.prof;
    const mkDisplay = (fmt: GPUTextureFormat) =>
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module: displayModule, entryPoint: "vs" },
        fragment: { module: displayModule, entryPoint: "fs", targets: [{ format: fmt }] },
        primitive: { topology: "triangle-list" },
      });
    this.displayPipeline = mkDisplay(format);
    this.export8Pipeline = mkDisplay("rgba8unorm");
    this.export16Pipeline = mkDisplay("rgba16float");
    const mkPost = (entryPoint: string) => device.createComputePipeline({ layout: "auto", compute: { module: postModule, entryPoint } });
    this.postResolve = mkPost("resolve");
    this.postGatherH = mkPost("gatherH");
    this.postDown = mkPost("down");
    this.postDownShip = mkPost("downShip");
    this.postDof = mkPost("dof");
    this.postFlare = mkPost("flareMeter");
    this.dofDummy = device.createTexture({ size: [1, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.postUp = mkPost("up");
    this.postPolGrid = mkPost("polgrid");
    this.postBeamH = mkPost("beamH");
    this.postAtrous = mkPost("atrous");
    this.postTemporal = mkPost("temporal");
    this.postBeamV = mkPost("beamV");
    this.meterPipeline = mkPost("meter");
    this.histBuf = device.createBuffer({ size: 512, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.histStage = device.createBuffer({ size: 512, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    this.pathBuf = device.createBuffer({
      size: (PATH_MAX + PATH_MAX / PATH_CHUNK) * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // (after the bodies: the light probe's harmonics, copied there on the GPU — see dispatchEnv; the
    // compute stage has no storage-buffer slot left for them)
    this.bodyBuf = device.createBuffer({
      size: this.bodyData.byteLength + SH_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.paramBuf = device.createBuffer({ size: this.params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.probeBuf = device.createBuffer({ size: PROBE_W * PROBE_H * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.probeStage = device.createBuffer({ size: PROBE_W * PROBE_H * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.displayBuf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.chart = new ChartOverlay(device, src.overlay);
    const lut = buildBlackbodyLUT();
    this.lutBuf = device.createBuffer({ size: lut.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.lutBuf, 0, lut);
    const sync = buildSynchrotronLUT();
    this.syncLutBuf = device.createBuffer({ size: sync.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.syncLutBuf, 0, sync);
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
   * procedural sky is shown until it is ready.
   */
  async loadSky(): Promise<void> {
    loading.stage("sky", "Milky Way — the Gaia DR2 map", { weight: 2 });
    loading.stage("stars", "Stars — the Hipparcos & HYG catalogue", { weight: 2 });
    const stars = Promise.all([
      loadPackedTexture(this.device, starLodUrl, (u) => loading.fetch(u, "stars")),
      loadStarCatalogue(this.device, starCatalogueUrl, (u) => loading.fetch(u, "stars")),
    ]);
    const [bitmap, [lod, cat]] = await Promise.all([
      loading.track(
        "sky",
        "",
        loading
          .fetch(milkyWayUrl, "sky")
          .then((r) => r.blob())
          .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" })),
      ),
      loading.track("stars", "", stars),
    ]);
    this.mwTexture = this.skyBuilder.build(bitmap, "log16", this.device.limits.maxTextureDimension2D);
    this.starLodTexture = lod;
    this.catalogue = cat;
    this.skyReady = true;
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    this.invalidate();
  }

  /** Loads the solar system's maps in the background, the first time a scene needs them. */
  private requestPlanetMaps() {
    this.mapsRequested = true;
    loading.stage("maps", "Planets & moons — the solar system's maps", { weight: 3 });
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
    if (first) loading.stage("earth", "The Earth — day, night, clouds and relief", { weight: 3 });
    // (out of GPU memory while the maps load: the tier below, or none — not a lost device)
    this.device.pushErrorScope("out-of-memory");
    const job = loadEarthMaps(this.device, tier, first ? (u) => loading.fetch(u, "earth") : undefined);
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
        // (the ground the ship stands on: the heights drawn — the terrain tiles over the map)
        if (maps.heights) {
          const { map, W, H } = maps.heights;
          setGroundRelief(
            "earth",
            earthHeightSampler(map, W, H, (q, foot) => this.earthTiles.heightAt(q, foot)),
          );
          // (a tile that will not load: the map's heights there)
          this.earthTiles.fallback = (q) => {
            const x = (0.5 + Math.atan2(q[1], q[0]) / (2 * Math.PI)) * W - 0.5,
              y = (0.5 - Math.asin(q[2]) / Math.PI) * H - 0.5;
            const i = ((Math.floor(x) % W) + W) % W,
              j = Math.min(Math.max(Math.floor(y), 0), H - 1);
            return Math.max(map[j * W + i]!, 0);
          };
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

  /** Frees the Earth's maps (it is a few pixels across, or out of the scene): the placeholder back. */
  private releaseEarthMaps() {
    this.earthWant = null;
    this.earthJob++;
    const old = this.earthMaps;
    if (!old.tier) return;
    this.earthMaps = placeholderEarth(this.device);
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    void this.device.queue.onSubmittedWorkDone().then(() => [old.cube, old.night, old.elev].forEach((t) => t.destroy()));
    this.invalidate();
  }

  /** Frees the GPU at once (the page going away). */
  release() {
    this.device.destroy();
  }

  /** Frees the finer maps (the camera left their world): the placeholder back. */
  private releaseHd() {
    const old = this.hdMap;
    this.hdMap = placeholderHd(this.device);
    this.hdLoading = null;
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    void this.device.queue.onSubmittedWorkDone().then(() => (old.color.destroy(), old.relief.destroy()));
    this.invalidate();
  }

  /** Streams in a world's finer maps (the previous ones freed once loaded). */
  private requestHd(name: MapName) {
    if (this.hdMap.name === name || this.hdLoading === name) return;
    this.hdLoading = name;
    loadHdMap(this.device, name)
      .then((m) => {
        // (superseded while it loaded: both its textures freed — the relief leaked before)
        if (!m || this.hdLoading !== name) {
          if (m) m.color.destroy(), m.relief.destroy();
          return;
        }
        const old = this.hdMap;
        this.hdMap = m;
        this.hdLoading = null;
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
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser.");
    loading.stage("gpu", "WebGPU — the graphics device", { weight: 0.5, indeterminate: true, eta: 0.5 });
    loading.stage("shaders", "Shaders — geodesics, disk, sky, Ranger", { weight: 1 });
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter found.");
    // (the tracer's bind group holds 10 storage buffers: said plainly here rather than by a layout's validation error)
    const storageBuffers = adapter.limits.maxStorageBuffersPerShaderStage;
    if (storageBuffers < 10) throw new Error(`This GPU binds ${storageBuffers} storage buffers per shader stage; the ray tracer needs 10.`);
    const device = await adapter.requestDevice({
      // (the GPU profiler's timestamps, when the adapter has them)
      // (and the compressed textures it samples: the colour maps' KTX2, transcoded to BC7 or ASTC)
      requiredFeatures: (["timestamp-query", "texture-compression-bc", "texture-compression-astc"] as GPUFeatureName[]).filter((f) =>
        adapter.features.has(f),
      ),
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBuffersPerShaderStage: 10,
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      },
    });
    // (the device lost — a driver reset, the GPU's memory exhausted —: said to the page, which saves the
    // flight and offers a reload; nothing more is sent to it)
    const lost = device.lost.then((info) => {
      console.error("WebGPU device lost:", info.message);
      return info;
    });
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Could not create a WebGPU canvas context.");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    loading.done("gpu");
    const src = {
      trace: await wgsl(traceWGSL),
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
    const r = new Renderer(device, context, format, src);
    r.tier = guessTier(adapter);
    void lost.then((info) => {
      r.lost = info.reason === "destroyed" ? "released" : info.message || "the GPU was reset";
      if (info.reason !== "destroyed") r.onLost?.(r.lost);
    });
    // (errors the code did not scope: counted, the first ones told — a silent black image otherwise)
    device.addEventListener("uncapturederror", (e) => {
      const m = (e as GPUUncapturedErrorEvent).error.message;
      r.gpuErrors++;
      console.error("WebGPU error:", m);
      if (r.gpuErrors <= 3) r.onGpuError?.(m);
    });
    // (the pipelines compile in the GPU process: the tracer's awaited below, the others' by the first frame)
    loading.stage("pipelines", "Compiling the ray tracer — first image", { weight: 4, indeterminate: true, eta: 3 });
    // (its failure held as a value: told after the WGSL's own messages, which name the line)
    const tracerFailure = r.tracerCompiled.then(
      () => null,
      (e: Error) => e,
    );
    let checked = 0;
    for (const [name, code] of Object.entries(src)) {
      const info = await device.createShaderModule({ code }).getCompilationInfo();
      loading.set("shaders", 0.3 + (0.7 * ++checked) / Object.keys(src).length);
      const errors = info.messages.filter((m) => m.type === "error");
      if (errors.length) {
        throw new Error(`${name}.wgsl failed to compile:\n` + errors.map((m) => `  ${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
      }
    }
    const failure = await tracerFailure;
    if (failure) throw new Error(`The ray tracer's pipelines failed to compile: ${failure.message}`);
    const err = await device.popErrorScope();
    if (err) throw new Error(`WebGPU pipeline creation failed: ${err.message}`);
    loading.done("shaders");
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
    this.device.queue.writeBuffer(this.pathBuf, 0, data);
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
    const accum = d.createBuffer({ size: px * 16, usage: GPUBufferUsage.STORAGE });
    const moments = d.createBuffer({ size: px * 8, usage: GPUBufferUsage.STORAGE }); // Σ l², depth
    const stamps = d.createBuffer({ size: px * 4, usage: GPUBufferUsage.STORAGE });
    // realtime reconstruction of stale pixels (live view only): horizontal pass of the gather
    const gather = d.createBuffer({ size: live ? px * 16 : 16, usage: GPUBufferUsage.STORAGE });
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
      stamps,
      gather,
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
    for (const b of [t.accum, t.moments, t.stamps, t.gather, t.resolveBuf, t.shipRect, t.polAcc, t.polGrid, t.polGridBuf]) b.destroy();
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
    t.lut?.tex.forEach((x) => x.destroy());
    t.temporal?.buf.destroy();
  }

  private bindTarget(t: Target) {
    this.eventFrames = 3; // (new resources: the next frames' times are not the scene's)
    const d = this.device;
    t.traceBind = d.createBindGroup({
      layout: this.traceLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuf } },
        { binding: 1, resource: { buffer: t.accum } },
        { binding: 2, resource: { buffer: this.lutBuf } },
        { binding: 3, resource: this.bgTexture.createView() },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: { buffer: t.moments } },
        { binding: 6, resource: { buffer: t.stamps } },
        { binding: 7, resource: { buffer: this.syncLutBuf } },
        { binding: 8, resource: this.mwTexture.createView() },
        { binding: 9, resource: this.starLodTexture.createView() },
        { binding: 10, resource: { buffer: this.catalogue } },
        { binding: 11, resource: { buffer: t.polAcc } },
        { binding: 13, resource: { buffer: this.pathBuf } },
        { binding: 14, resource: { buffer: this.ship.envBuf } },
        { binding: 15, resource: { buffer: this.bodyBuf } },
        { binding: 16, resource: srgbView(this.planetMaps.hi, "2d-array") },
        { binding: 17, resource: this.planetMaps.rings.createView({ dimension: "2d", format: SRGB }) },
        { binding: 18, resource: srgbView(this.planetMaps.lo, "2d-array") },
        { binding: 19, resource: srgbView(this.earthMaps.cube, "cube") },
        { binding: 20, resource: this.earthMaps.night.createView({ dimension: "cube" }) },
        { binding: 21, resource: this.earthMaps.elev.createView() },
        { binding: 22, resource: this.hdMap.color.createView({ format: SRGB }) },
        { binding: 23, resource: this.hdMap.relief.createView() },
        { binding: 24, resource: this.noise3d.createView({ dimension: "3d" }) },
        { binding: 25, resource: this.noiseSampler },
        { binding: 26, resource: this.ship.shadowView },
        { binding: 28, resource: this.earthTiles.texture.createView({ dimension: "2d-array" }) },
      ],
    });
    t.probeBind = d.createBindGroup({
      layout: this.traceLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuf } },
        { binding: 1, resource: { buffer: t.accum } },
        { binding: 2, resource: { buffer: this.lutBuf } },
        { binding: 3, resource: this.bgTexture.createView() },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: { buffer: t.moments } },
        { binding: 6, resource: { buffer: t.stamps } },
        { binding: 7, resource: { buffer: this.syncLutBuf } },
        { binding: 8, resource: this.mwTexture.createView() },
        { binding: 9, resource: this.starLodTexture.createView() },
        { binding: 10, resource: { buffer: this.catalogue } },
        { binding: 11, resource: { buffer: t.polAcc } },
        { binding: 13, resource: { buffer: this.pathBuf } },
        { binding: 14, resource: { buffer: this.probeBuf } },
        { binding: 15, resource: { buffer: this.bodyBuf } },
        { binding: 16, resource: srgbView(this.planetMaps.hi, "2d-array") },
        { binding: 17, resource: this.planetMaps.rings.createView({ dimension: "2d", format: SRGB }) },
        { binding: 18, resource: srgbView(this.planetMaps.lo, "2d-array") },
        { binding: 19, resource: srgbView(this.earthMaps.cube, "cube") },
        { binding: 20, resource: this.earthMaps.night.createView({ dimension: "cube" }) },
        { binding: 21, resource: this.earthMaps.elev.createView() },
        { binding: 22, resource: this.hdMap.color.createView({ format: SRGB }) },
        { binding: 23, resource: this.hdMap.relief.createView() },
        { binding: 24, resource: this.noise3d.createView({ dimension: "3d" }) },
        { binding: 25, resource: this.noiseSampler },
        { binding: 26, resource: this.ship.shadowView },
        { binding: 28, resource: this.earthTiles.texture.createView({ dimension: "2d-array" }) },
      ],
    });
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
    for (const p of [this.displayPipeline, this.export8Pipeline, this.export16Pipeline]) {
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
    // (its polarization buffer — 8 bytes a pixel — only while polarization is drawn)
    this.livePol = this.wantPol;
    this.live = this.createTarget(width, height, this.livePol, true);
    if (old) this.device.queue.onSubmittedWorkDone().then(() => this.destroyTarget(old));
    this.blockMs.clear(); // (their times were measured at the old size)
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
      /** a planet's light probe: a camera at its centre, the planet itself left out */
      probe?: { cam: CameraFrame; hide: string; slice?: number };
    },
  ) {
    const f = this.paramsF;
    const u = this.paramsU;
    this.featureKey = this.featuresOf(s);
    const cam = o.probe?.cam ?? cameraFrame(s);
    if (!o.probe) (this.lastCam = cam), (this.lastTime = time);
    // (none flown: a craft of the fleet near the camera brings the craft's pass and its light probe)
    if (!o.probe) this.craftsShown = !s.ship && this.shipOthers(s).some((q) => Math.hypot(...q.t) < 2e4);
    const dc = this.diskConstants(s);
    const a = s.spin;
    const tanH = Math.tan((s.fov * Math.PI) / 360);
    const pixelAngle = (2 * tanH) / t.height;
    const set = (i: number, x: number, y: number, z: number, w: number) => f.set([x, y, z, w], i * 4);

    set(0, t.width, t.height, o.block, o.sampleIndex);
    set(1, cam.r, gpuTheta(cam.theta), cam.phi, tanH);
    set(2, ...cam.right, t.width / t.height);
    set(3, ...cam.up, pixelAngle);
    set(4, ...cam.fwd, 0);
    set(5, cam.zamo.alpha, cam.zamo.omega, cam.zamo.varpi, cam.zamo.sqrtSig);
    set(6, cam.zamo.sqrtSigOverDel, 0, 0, 0);
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
    set(16, s.jetLength, s.jetCutoff, s.jetKnots, 0);
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
    // (the Ranger's shadow on the near ground: its bounding sphere in the camera's axes; 0: none)
    const sb = !o.probe && s.ship && this.ship.ready && near ? this.ship.shadowBound : null;
    set(65, sb?.c[0] ?? 0, sb?.c[1] ?? 0, sb?.c[2] ?? 0, sb?.r ?? 0);
    // (the far field's LUT: the live view, a scene with nothing a ray between clean samples could meet)
    this.lutOn = t === this.live && !o.probe && (this.featureKey & LUT_BLOCKERS) === 0 && s.farFieldLut;
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
      this.meterIncident = this.incidentLight(s, cam, bodies, origin, dc.logY, near);
      this.meterGain = s.tonemap === "Film" ? 4 : 1;
      this.earthIsNear = !!near && bodies[near.index]?.id === "earth";
      this.meterInAir = this.earthIsNear && !!this.earthMaps.tier;
      // (a landscape by day — the camera low in the Earth's air, the Sun over 4–15° there, not eclipsed —:
      // its shade kept from "AgX punchy"'s deepening, a dark grey as the eye sees it, not black; dusk, night,
      // totality and the views from orbit keep their depth)
      this.shadowKeep = 0;
      if (this.meterInAir && near) {
        const r = Math.hypot(...near.centre);
        const mu = -(near.centre[0] * near.light[0] + near.centre[1] * near.light[1] + near.centre[2] * near.light[2]) / r;
        const ecl = this.meterHome ? sunShare(this.meterHome, this.meterTime) : 1;
        const smooth = (a: number, b: number, x: number) => {
          const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
          return t * t * (3 - 2 * t);
        };
        this.shadowKeep = smooth(0.07, 0.26, mu) * smooth(0.3, 0.9, ecl) * (1 - smooth(20, 60, (r - 1) * 6371));
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
      this.envEvery = this.envReset || spread || !slow ? 1 : 4;
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
      if (want === "high" && this.earthCap !== "high") want = this.earthCap === "med" ? "med" : null;
      if (want === "med" && this.earthCap === "none") want = null;
      if (want !== have) {
        if (want) this.requestEarthMaps(want);
        else this.releaseEarthMaps();
      }
    }
    const tSec = time * 4.925490947e-6 * s.massSolar;
    const drift = ((tSec / (20 * 86400)) % 1) * 2 * Math.PI;
    // (the cities' lights: drawn bright from orbit — they show on the night side; near the ground, a
    // twentieth: seen from below, lit areas would glare like a sunlit field)
    const altKm = near && near.index === earthK ? (Math.hypot(...near.centre) - 1) * 6371 : 1e4;
    const lights = 0.6 * 20 ** Math.min(Math.max(Math.log10(Math.max(altKm, 1) / 300) / Math.log10(300 / 5), -1), 0);
    set(58, this.earthMaps.tier ? 1 : 0, drift, lights, 4);
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
      if (nearMap && HD_SETS[nearMap] && dN < hdAt) this.requestHd(nearMap);
      else if (this.hdMap.name && !(nearMap === this.hdMap.name && dN < 2 * hdAt)) this.releaseHd();
    }
    const hd = this.hdMap;
    const hdOn = !!hd.name && bodies.some((b) => solarBody(b.id)?.map === hd.name);
    const hdRelief = !hd.hasRelief ? 0 : HD_SETS[hd.name!]?.height ? 1 : 1.2;
    set(62, hdOn ? mapIndex(hd.name!) : -1, (this.planetMaps.mean.get(hd.name!) ?? hd.mean) / hd.mean, hdRelief, hd.color.width);
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
    set(59, 6000 / 6.371e6, s.earthClouds, 0.8, AIR_K);
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
      moon = [q[0]!, q[1]!, q[2]!, (1 + cosPhase) / 2];
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
    if (near) {
      const c = near.axes.map((a) => -(a[0] * near.centre[0] + a[1] * near.centre[1] + a[2] * near.centre[2]));
      const A = c.map((x) => Math.fround(x));
      set(67, A[0]!, A[1]!, A[2]!, A[0]! * A[0]! + A[1]! * A[1]! + A[2]! * A[2]! - 1);
      set(68, c[0]! - A[0]!, c[1]! - A[1]!, c[2]! - A[2]!, 1);
    } else {
      set(67, 0, 0, 0, 0);
      set(68, 0, 0, 0, 0);
    }
    // the Earth's terrain tiles round the camera (on its own maps, the camera near it)
    if (!o.probe) {
      const onEarth = s.earthTerrain && !!near && near.index === earthK && !!this.earthMaps.tier;
      this.earthTiles.update(
        onEarth ? (near!.axes.map((a) => -(a[0] * near!.centre[0] + a[1] * near!.centre[1] + a[2] * near!.centre[2])) as Vec3) : null,
        pixelAngle,
      );
    }
    f.set(this.earthTiles.params(), 69 * 4);
    f[61 * 4 + 1] = sunAng; // (earth4.y)
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
      s.renderMode === "physical" ? 0 : 1,
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
      0,
    ]);
    // (the lens flare's strength: after the HDR peak)
    d[14] = s.lensFlare;
    d[15] = this.shadowKeep;
    this.device.queue.writeBuffer(this.displayBuf, 0, d);
  }

  private dofOn(s: Settings, t: Target) {
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
    this.device.queue.writeBuffer(t.resolveBuf, 16, new Float32Array([preExposure(this.ev(s)), 0, 0, 0]));
    if (s.polarization) {
      const { cs, gw, gh } = this.polCells(s, t);
      this.device.queue.writeBuffer(t.polGridBuf, 0, new Uint32Array([cs, gw, gh, t.width]));
    }
  }

  /** The light probe around the camera (after the frame's params are written), then its mips and SH. */
  private dispatchEnv(enc: GPUCommandEncoder, t: Target, s: Settings) {
    if (!s.ship && !this.craftsShown) {
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
    const pass = enc.beginComputePass(this.prof.pass("ship probe: trace"));
    pass.setPipeline(this.traceVariant("env"));
    pass.setBindGroup(0, t.traceBind);
    pass.dispatchWorkgroups(32 / k, 16 / k);
    pass.end();
    // (its filtering: every other frame when it changes slowly)
    if (k !== 4 || this.envPhase % 2 === 0) this.ship.encodeEnv(enc);
    enc.copyBufferToBuffer(this.ship.shBuf, 0, this.bodyBuf, this.bodyData.byteLength, SH_BYTES);
    this.envReset = false;
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
      if (s.system === "none" || this.probeBusy || performance.now() - this.probeAt < 2000) return;
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
    const pass = enc.beginComputePass(this.prof.pass("planet probe"));
    pass.setPipeline(this.traceVariant("env"));
    pass.setBindGroup(0, t.probeBind);
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
  private lutWriteLayout!: GPUBindGroupLayout;
  private lutReadLayout!: GPUBindGroupLayout;
  private mainLayout!: GPUPipelineLayout;
  private lutLayout!: GPUPipelineLayout;
  private lutPipeline!: GPUComputePipeline;
  private lutQPipeline!: GPUComputePipeline;
  /** this frame's params want the far field's LUT (set with them) */
  private lutOn = false;
  /** the LUT's epoch on the live target (refining a still view: computed once) */
  private lutEpoch = -1;
  private tracePipeLayout!: GPUPipelineLayout;
  /** the scene's features (bits: radio, polarization, jet, hot spot, hot flow, wormhole, thick disk) — set with its params */
  private featureKey = FEATURES_ALL;
  private variants = new Map<
    number,
    {
      rt: GPUComputePipeline | null;
      q: GPUComputePipeline | null;
      env: GPUComputePipeline | null;
      lut: GPUComputePipeline | null;
      lutq: GPUComputePipeline | null;
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
    ); // (bodies: 128, added with them)
  }

  /**
   * The tracer for the scene's features: a pipeline with the unused ones compiled out (built in the
   * background the first time — ~10 s —, the general one drawing meanwhile).
   */
  private traceVariant(kind: "rt" | "q" | "env" | "lut" | "lutq"): GPUComputePipeline {
    const general = {
      rt: this.tracePipeline,
      q: this.qualityPipeline,
      env: this.envPipeline,
      lut: this.lutPipeline,
      lutq: this.lutQPipeline,
    }[kind];
    const key = this.featureKey;
    if (key === FEATURES_ALL) return general;
    let v = this.variants.get(key);
    if (!v) {
      v = { rt: null, q: null, env: null, lut: null, lutq: null };
      this.variants.set(key, v);
      const has = (bit: number) => ((key & bit) !== 0 ? 1 : 0);
      const constants = {
        HAS_RADIO: has(1),
        HAS_POL: has(2),
        HAS_JET: has(4),
        HAS_SPOT: has(8),
        HAS_VOL: has(16),
        HAS_WH: has(32),
        HAS_THICK: has(64),
        HAS_BODIES: has(128),
      };
      const mk = (entryPoint: string, quality: boolean) =>
        this.device.createComputePipelineAsync({
          layout: entryPoint === "main" ? this.mainLayout : entryPoint === "lut" ? this.lutLayout : this.tracePipeLayout,
          compute: { module: this.traceModule, entryPoint, constants: { ...constants, QUALITY_PIPELINE: quality ? 1 : 0 } },
        });
      const slot = v;
      void mk("main", false)
        .then((p) => ((slot.rt = p), mk("env", false)))
        .then((p) => ((slot.env = p), mk("main", true)))
        .then((p) => ((slot.q = p), (key & LUT_BLOCKERS) === 0 ? mk("lut", false) : null))
        .then((p) => ((slot.lut = p), (key & LUT_BLOCKERS) === 0 ? mk("lut", true) : null))
        .then(
          (p) => (slot.lutq = p),
          (e) => console.warn("Specialised tracer unavailable:", e),
        );
    }
    return v[kind] ?? general;
  }

  private dispatchTrace(enc: GPUCommandEncoder, t: Target, x: number, y: number, quality: boolean) {
    // (the far field's LUT first: every realtime frame, once an epoch while a still view refines)
    if (this.lutOn && t.lut && (!quality || this.lutEpoch !== this.epoch)) {
      this.lutEpoch = quality ? this.epoch : -1;
      const lp = enc.beginComputePass(this.prof.pass("far-field LUT"));
      lp.setPipeline(this.traceVariant(quality ? "lutq" : "lut"));
      lp.setBindGroup(0, t.traceBind);
      lp.setBindGroup(1, t.lut.write);
      lp.dispatchWorkgroups(Math.ceil(t.lut.w / 8), Math.ceil(t.lut.h / 8));
      lp.end();
    }
    const pass = enc.beginComputePass(this.prof.pass(quality ? "trace (converging)" : "trace"));
    pass.setPipeline(this.traceVariant(quality ? "q" : "rt"));
    pass.setBindGroup(0, t.traceBind);
    pass.setBindGroup(1, t.lut ? t.lut.read : this.lutDummy!);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(x / 8)), Math.max(1, Math.ceil(y / 8)));
    pass.end();
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
        entries: [
          { binding: 0, resource: tex[0]!.createView() },
          { binding: 1, resource: tex[1]!.createView() },
        ],
      }),
      read: d.createBindGroup({
        layout: this.lutReadLayout,
        entries: [
          { binding: 2, resource: tex[0]!.createView() },
          { binding: 3, resource: tex[1]!.createView() },
        ],
      }),
    };
  }
  /** (targets without a LUT: a texel's worth, never read — the flag is off) */
  private lutDummy: GPUBindGroup | null = null;

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
  } | null = null;
  /** the reprojection's weights: a pixel a ray landed on, one between rays; the clamp's width [σ] */
  taParams: [number, number, number] = [0.25, 0.05, 2.0];
  /** the near body's ground reprojected when the camera is carried with it (a switch for comparisons) */
  carryGround = true;
  /** (the last reprojection: the camera standing still on the near body's ground) */
  taStill: { still: boolean; mMetres: number; turn: number } | null = null;
  /** the history is dropped on the next frame (a new scene, a jump) */
  resetTemporal() {
    this.taPrev = null;
  }

  /**
   * Temporal reprojection (realtime, the camera moving): the previous frame's image, found by the
   * camera's rotation (exact for the sky and everything far, whatever the lensing), clamped to the
   * range of the current frame's samples at the block's scale, blended in (post.wgsl: temporal); on
   * the refining frames, or after a jump, the history is only refreshed from the image.
   */
  private encodeTemporal(enc: GPUCommandEncoder, t: Target, s: Settings) {
    const d = this.device;
    const cam = this.lastCam;
    if (!cam) return;
    if (!t.temporal) {
      const hist = [0, 1].map(() =>
        d.createTexture({
          size: [t.width, t.height],
          format: "rgba16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        }),
      );
      const buf = d.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
            { binding: 5, resource: { buffer: t.resolveBuf } },
            { binding: 6, resource: { buffer: t.stamps } },
            { binding: 11, resource: { buffer: t.moments } },
            { binding: 21, resource: { buffer: buf } },
          ],
        }),
      );
      t.temporal = { hist, buf, binds, idx: 0, valid: false };
    }
    const ta = t.temporal;
    const tanH = Math.tan((s.fov * Math.PI) / 360);
    const asp = t.width / t.height;
    const pre = preExposure(this.ev(s));
    const prev = this.taPrev;
    // (a jump: the other region, or the distance to the hole changed by more than 5 % in a frame)
    const jumped = !prev || prev.region !== cam.region || Math.abs(cam.r - prev.r) > 0.05 * Math.max(cam.r, 1e-9);
    const on = s.temporalReprojection && this.taPhase === "realtime" && ta.valid && !jumped;
    const ln = this.lastNear;
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
    };
    if (!on) {
      // (refresh the history from the image: the next moving frame starts from it)
      enc.copyTextureToTexture({ texture: t.hdr, mipLevel: 0 }, { texture: ta.hist[ta.idx]! }, [t.width, t.height]);
      ta.valid = true;
      return;
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
        // (the history's exposure to this frame's; on; the weight of a pixel a ray landed on, of one between)
        pre / p.pre,
        1,
        this.taParams[0],
        this.taParams[1],
        // (w: the ground's reach — negative: carried with it, the same pixel)
        ...move,
        near ? (still ? -30 : 30) * near.radius : 0,
      ]),
    );
    const pass = enc.beginComputePass(this.prof.pass("temporal"));
    pass.setPipeline(this.postTemporal);
    pass.setBindGroup(0, ta.binds[ta.idx]!);
    pass.dispatchWorkgroups(Math.ceil(t.width / 8), Math.ceil(t.height / 8));
    pass.end();
    ta.idx = 1 - ta.idx;
    enc.copyTextureToTexture({ texture: ta.hist[ta.idx]! }, { texture: t.hdr, mipLevel: 0 }, [t.width, t.height]);
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
      if (s && i === r0 && t === this.live) this.encodeTemporal(enc, t, s);
      // the space station, where it is on its orbit (before the Ranger: its glass reflects it)
      if (s && i === r0) this.encodeStation(enc, t, s);
      if (s && i === r0 && (s.ship || this.craftsShown) && this.ship.ready) {
        this.ship.encodeShip(
          enc,
          t.hdr,
          {
            vessel: s.ship ? s.vessel : undefined,
            others: this.shipOthers(s),
            mPerM: 1476.625 * (s.massSolar || 1),
            inside: s.ship && (s.shipMount === "cockpit" || s.shipMount === "cabin"),
            dash: this.cockpitDash ?? undefined,
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
          this.station.depthTexture() ? { depth: this.station.depthTexture()!, rect: this.station.rect } : undefined,
          t.moments,
        );
        // (where it was drawn: the display reads its image there, the bloom too)
        const rect = new Float32Array(this.ship.rectFor(t.hdr));
        this.device.queue.writeBuffer(this.displayBuf, 112, rect);
        this.device.queue.writeBuffer(t.shipRect, 0, rect);
      } else if (i === r0) this.device.queue.writeBuffer(t.shipRect, 0, new Float32Array(4));
      // the Endurance, over the traced image (before the bloom's levels are made from it)
      if (s && i === r0 && s.endurance && this.lastCam) {
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
          this.endurance.encode(enc, t.hdr, t.moments, s, this.lastCam, this.lastTime, pre, pre / 2 ** this.ev(s));
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
    if (s?.autoExposure && t === this.live && !this.meterPending) {
      this.device.queue.writeBuffer(this.histBuf, 0, new Uint32Array(128));
      const pass = enc.beginComputePass(this.prof.pass("light meter"));
      pass.setPipeline(this.meterPipeline);
      pass.setBindGroup(
        0,
        this.device.createBindGroup({
          layout: this.meterPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: t.hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
            { binding: 20, resource: { buffer: this.histBuf } },
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

  /** Craft of the fleet in view with none flown (the camera near them): their pass, their light probe. */
  craftsShown = false;

  /**
   * The craft not flown (fleet.ts), where they are seen from the camera's eye: within 60 km, on our side;
   * in the shadow map those within 150 m of the flown one (docked, alongside). Their transforms: the craft's
   * axes on the camera's (rows: the camera's axes on the craft's), the origin [m].
   */
  private shipOthers(s: Settings): ShipInstance[] {
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
    for (const o of fleet.others(time, !s.ship)) {
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
    const hE = (Math.hypot(Xc[0] - E.pos[0], Xc[1] - E.pos[1], Xc[2] - E.pos[2]) * mR) / 1e3 - 6371;
    if (!(hE < 3000)) return;
    void refreshIssElements();
    if (!this.station.ready) {
      this.stationLoading ??= loading
        .track(
          "iss",
          "The space station",
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
    const rE = (6371e3 + 30e3) / mR;
    const rhoE = Math.asin(Math.min(rE / dE, 1));
    const rhoS = Math.asin(Math.min((sunB?.radius ?? 0.00471 * dS) / dS, 1));
    const sep = Math.acos(Math.max(-1, Math.min(1, (sunH[0] * toE[0] + sunH[1] * toE[1] + sunH[2] * toE[2]) / dE)));
    const x = Math.max(-1, Math.min(1, (sep - rhoE) / Math.max(rhoS, 1e-6)));
    const share = 0.5 + (x * Math.sqrt(1 - x * x) + Math.asin(x)) / Math.PI;
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
    const cosCap = Math.cos(Math.asin(Math.min(6371e3 / mR / dE, 1)));
    const aux: Vec3 = Math.abs(eDir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const ex = unitV([eDir[1] * aux[2] - eDir[2] * aux[1], eDir[2] * aux[0] - eDir[0] * aux[2], eDir[0] * aux[1] - eDir[1] * aux[0]]);
    const ey: Vec3 = [eDir[1] * ex[2] - eDir[2] * ex[1], eDir[2] * ex[0] - eDir[0] * ex[2], eDir[0] * ex[1] - eDir[1] * ex[0]];
    const N = 96;
    const dOmega = (2 * Math.PI * (1 - cosCap)) / N;
    const earthCol = [0.85, 0.93, 1.0];
    const rEm = 6371e3 / mR;
    for (let k = 0; k < N; k++) {
      // (a Fibonacci spiral over the cap)
      const cz = 1 - ((k + 0.5) / N) * (1 - cosCap);
      const sz = Math.sqrt(1 - cz * cz);
      const ph = k * 2.399963229728653;
      const d: Vec3 = [0, 1, 2].map((i) => eDir[i]! * cz + (ex[i]! * Math.cos(ph) + ey[i]! * Math.sin(ph)) * sz) as Vec3;
      // where it meets the ground, the Sun's height there
      const b = d[0] * toE[0] + d[1] * toE[1] + d[2] * toE[2];
      const c2 = dE * dE - rEm * rEm;
      const tt = b - Math.sqrt(Math.max(b * b - c2, 0));
      const P: Vec3 = [st.X[0] + d[0] * tt - E.pos[0], st.X[1] + d[1] * tt - E.pos[1], st.X[2] + d[2] * tt - E.pos[2]];
      const pl = Math.hypot(...P);
      const mu = Math.max(0, (P[0] * sunH[0] + P[1] * sunH[1] + P[2] * sunH[2]) / pl);
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
    this.station.encode(enc, t.hdr, t.moments, view);
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
      E += 10 ** (this.logYOf(T) - logYRef) * b.brightness * (b.radius / Math.max(d, b.radius)) ** 2 * this.earthSunlight(bodies, near);
    });
    return 0.3 * E;
  }

  /**
   * Near the Earth (its local patch), the share of the sunlight reaching the camera: through its air,
   * reddened and dimmed low, none in its shadow — a quarter at least (twilight, night: 2
   * stops more; the cities show already, more and the stars fade, the ship's own lights blind).
   */
  private earthSunlight(bodies: GpuBody[], near: ReturnType<typeof localPatch>) {
    if (!near || bodies[near.index]?.id !== "earth" || !this.earthMaps.tier) return 1;
    const r = Math.hypot(...near.centre);
    const mu = -(near.centre[0] * near.light[0] + near.centre[1] * near.light[1] + near.centre[2] * near.light[2]) / r;
    // (and an eclipse: the Sun's disk the Moon leaves — the totality's twilight, ten stops down)
    const home = this.meterHome;
    const ecl = home ? sunShare(home, this.meterTime) : 1;
    return Math.max(sunThroughY((r - 1) * EARTH_RM, mu), 0.25) * Math.max(ecl, 0.002);
  }
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
    // (in the Earth's air, its sky is the scene, not a backdrop: a camera's meter besides — no more than a
    // fiftieth of the image over white once the tone map's own gain is in (a sunset's glow round the sun;
    // the disk itself is fewer pixels). Only ever less exposure: night and space as the light sets them)
    if (this.meterInAir) {
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
    rp.setBindGroup(0, t.displayBinds.get(pipeline)!);
    rp.draw(3);
    rp.end();
  }

  private submit(enc: GPUCommandEncoder, done: (ms: number) => void) {
    const t0 = performance.now();
    this.prof.end(enc);
    this.device.queue.submit([enc.finish()]);
    this.inFlight++;
    this.device.queue.onSubmittedWorkDone().then(() => {
      this.inFlight--;
      // (this frame's own time: from when the GPU could start on it — after the one before)
      const now = performance.now();
      const ms = now - Math.max(t0, this.lastDoneAt);
      this.lastDoneAt = now;
      this.lastGpuMs = ms;
      done(ms);
    });
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
  /** the device was lost (its reason), or null */
  lost: string | null = null;
  onLost?: (why: string) => void;
  /** uncaptured GPU errors so far, and who hears of them */
  gpuErrors = 0;
  onGpuError?: (message: string) => void;

  frame(s: Settings, time: number, sceneChanged: boolean, timeChanged: boolean, displayChanged: boolean): FrameStats | null {
    if (this.lost) return null;
    if (this.busy) return null;
    // (polarization turned on or off: the live target remade with or without its buffer)
    this.wantPol = !!s.polarization;
    if (this.live && this.livePol !== this.wantPol) this.resize(this.live.width, this.live.height);
    if (this.offline) return this.offlineFrame(s, displayChanged);
    const t = this.live;
    if (!t) return null;
    const cv = this.context.canvas as HTMLCanvasElement;
    if (cv.width !== t.width || cv.height !== t.height) return null;

    if ((sceneChanged && !this.evRedraw) || timeChanged) this.sceneAt = performance.now();
    this.evRedraw = false;
    if (sceneChanged) this.invalidate();
    this.configureOutput(s);
    this.prof.begin();
    this.probePlanets(t, s, time);
    const enc = this.device.createCommandEncoder();
    let phase: FrameStats["phase"];
    let rows = 0;

    if (sceneChanged || timeChanged) {
      phase = "realtime";
      this.frameStamp++;
      this.updateValidFrom(time);
      this.sampleIndex = 0;
      this.bandY = 0;
      const block = s.realtimeSubsampling === "auto" ? this.realtimeBlock : s.realtimeSubsampling;
      if (block !== this.lastBlock) this.interleaveIndex = 0;
      let order = this.orders.get(block);
      if (!order) this.orders.set(block, (order = interleaveOrder(block)));
      const offset = order[this.interleaveIndex++ % order.length]!;
      let flags = FLAG_INTERLEAVED;
      if (s.temporalBlend < 1) flags |= FLAG_TEMPORAL;
      if (s.temporalReprojection) flags |= FLAG_REPROJECT;
      this.writeParams(t, s, time, {
        block,
        eps: s.realtimeEps,
        steps: s.realtimeSteps,
        y0: 0,
        y1: t.height,
        accumulate: false,
        sampleIndex: 0,
        flags,
        offset,
      });
      this.dispatchTrace(enc, t, Math.ceil(t.width / block), Math.ceil(t.height / block), false);
      this.dispatchEnv(enc, t, s);
      this.lastBlock = block;
      this.lastOffset = offset;
    } else if (this.sampleIndex < s.targetSpp) {
      phase = "converging";
      this.frameStamp++;
      this.validFrom = this.epoch;
      this.frameTimes.length = 0;
      const y0 = this.bandY;
      const y1 = Math.min(t.height, y0 + this.bandRows);
      rows = y1 - y0;
      let flags = 0;
      if (s.adaptiveIntegrator) flags |= FLAG_ADAPTIVE_RK;
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
        noise: s.noiseThreshold,
        minSpp: 8,
      });
      this.dispatchTrace(enc, t, t.width, rows, s.adaptiveIntegrator);
      if (this.sampleIndex < 32) this.dispatchEnv(enc, t, s);
      this.bandY = y1;
      if (this.bandY >= t.height) {
        this.bandY = 0;
        this.sampleIndex++;
      }
    } else {
      phase = "converged";
      if (this.lastPhase === "converged" && !displayChanged && !this.chartDirty) return this.stats(phase, t);
    }

    this.writeResolve(t, s);
    this.writeDisplay(s, t, t.width, t.height, false, true, this.hdrActive);
    this.taPhase = phase;
    this.encodePost(enc, t, s);
    const outTex = this.context.getCurrentTexture();
    this.encodeDisplay(enc, t, this.canvasPipeline, outTex.createView());
    this.encodeChart(enc, s, t, outTex.createView(), outTex.format, outTex.width, outTex.height, false);
    this.chartDirty = false;
    const auto = s.realtimeSubsampling === "auto";
    const used = this.lastBlock;
    this.submit(enc, (ms) => {
      if (phase === "realtime" && auto) this.adaptBlock(ms, this.frameBudget(s), used);
      if (phase === "converging" && rows > 0) {
        const perRow = ms / rows;
        // (the bands sized to the quality's frame budget — the Game's 16 ms keeps 60 fps while the image
        // refines —, 28 ms at most for the finer qualities)
        const band = Math.min(28, this.frameBudget(s));
        this.bandRows = Math.round(Math.min(t.height, Math.max(8, 0.5 * this.bandRows + 0.5 * (band / Math.max(perRow, 1e-3)))));
      }
    });
    this.lastPhase = phase;
    return this.stats(phase, t);
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

  private stats(phase: FrameStats["phase"], t: Target): FrameStats {
    const frac = this.bandY / Math.max(t.height, 1);
    return {
      phase,
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
      !this.earthTiles.pending && !(this.earthWant && this.earthWant !== this.earthMaps.tier) && !(this.earthIsNear && !this.earthMaps.tier)
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
    const working = !job.paused && !job.done;
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
    });
    if (!working && job.shown && !displayChanged) return result();

    const enc = this.device.createCommandEncoder();
    let rows = 0;
    // (the terrain tiles come in while it renders: started again on them)
    if (job.tiles !== this.earthTiles.stamp) {
      job.tiles = this.earthTiles.stamp;
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
      if (o.tolerance > 0) flags |= FLAG_ADAPTIVE_RK;
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
      this.dispatchTrace(enc, t, t.width, rows, o.tolerance > 0);
      this.dispatchEnv(enc, t, s);
      job.bandY = y1;
      if (job.bandY >= t.height) {
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
    return this.offline?.target ?? this.live!;
  }

  /** Tone-mapped image of a target at its native resolution (8- or 16-bit float output). */
  private async renderDisplayed(s: Settings, t: Target, bits: 8 | 16): Promise<Uint8Array> {
    const format: GPUTextureFormat = bits === 8 ? "rgba8unorm" : "rgba16float";
    const pipeline = bits === 8 ? this.export8Pipeline : this.export16Pipeline;
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
