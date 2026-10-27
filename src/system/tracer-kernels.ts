// The tracer's kernels: its entry points and the override constants a pipeline is compiled with, from a features key
// (renderer.ts featureKey: the bits of what the scene shows — the rest compiled out). Pure: the renderer's pipelines
// (Renderer.mkVariant) and the tools that measure them (scripts/wgsl-inline-size.ts, scripts/d3d12-compile-proxy.ts)
// read the same constants. On D3D12 every distinct set of constants is a compile of its own (WGSL → HLSL → DXIL, every
// function inlined): what a key turns on is what a player waits for (docs/PLAN-LEAN-TRACER-KERNELS.md).

/** every feature of the tracer kept (the general pipelines): bits 0–13 */
export const FEATURES_ALL = 16383;
/** the terrain height cache read by the realtime kernels */
export const FEATURE_TERRAIN_CACHE = 1 << 15;
/** the realtime kernel's ground march starts from the raster patch's distances (bits 16–27: the cost view and the tune) */
export const FEATURE_TERRAIN_RASTER = 1 << 30;
/**
 * The raster is the near Earth's primary visibility (renderer: rasterPrimary): its material kernels draw the ground, the
 * traced kernels the sky, the far ground beyond the raster's rings and the light probe. The Earth-raster profile
 * (docs/PLAN-LEAN-TRACER-KERNELS.md P3): one set of constants for the whole flight, whatever comes and goes —
 * - the material kernels carry the regional surface's and the scenery's code (as they do the runways'), their parameters
 *   saying whether there is any;
 * - the traced kernels do not: the surface's pages and the scenery's buildings and trees are the raster's (a tree against
 *   the sky is shade's, traced by main only while shade compiles);
 * - all carry the weather's, the aurora's and a body's shadow's code, their parameters saying whether they are there:
 *   these bits came and went in flight — each a recompile of minutes on D3D12 while the image waited.
 */
export const FEATURE_RASTER_PRIMARY = 1 << 29;

/** the pipelines the renderer makes from trace.wgsl ("discs": main compiled with DISC_ONLY) */
export type TracerEntry =
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
  | "clouds";

/** the WGSL entry point a pipeline runs */
export function tracerEntryPoint(entry: TracerEntry): string {
  return entry === "discs" ? "main" : entry;
}

/** the realtime kernels that read the raster's distances and the terrain cache */
const REALTIME_GROUND: ReadonlySet<TracerEntry> = new Set([
  "main",
  "shade",
  "shadeMark",
  "shadeLite",
  "shadeWater",
  "shadeStars",
  "clouds",
]);
/** the raster's material kernels: the runways' code always in (their parameters say whether one is near) */
const RASTER_RUNWAYS: ReadonlySet<TracerEntry> = new Set(["shade", "shadeMark", "shadeLite", "shadeWater"]);
/** the raster's material kernels (the Earth-raster profile: the surface's and the scenery's code always in) */
const MATERIAL: ReadonlySet<TracerEntry> = new Set(["shade", "shadeMark", "shadeLite", "shadeWater", "shadeStars", "clouds"]);

export interface TracerConstantsOptions {
  /** the refining (adaptive) pipeline */
  quality?: boolean;
  /** the device takes the raster's hint texture (renderer.rasterHint) */
  rasterHint?: boolean;
  /** a debug tuning's constants (renderer.tune: the key's bits 20–27 name it) */
  tune?: Record<string, number>;
  /** the raster's companion kernels lean (NEAR_DETAIL off in the Earth-raster profile's main and discs; renderer.leanMain) */
  companion?: boolean;
}

/** The override constants of a tracer pipeline for a features key. */
export function tracerConstants(key: number, entry: TracerEntry, o: TracerConstantsOptions = {}): Record<string, number> {
  const quality = !!o.quality;
  const ground = REALTIME_GROUND.has(entry) && !quality;
  // (the Earth-raster profile: the bits that came and went in flight fixed — FEATURE_RASTER_PRIMARY)
  const profile = !quality && (key & FEATURE_RASTER_PRIMARY) !== 0;
  const fixed: Record<number, number> = profile
    ? { 1024: 1, 16384: 1, 2048: 1, 4096: MATERIAL.has(entry) ? 1 : 0, 8192: MATERIAL.has(entry) ? 1 : 0 }
    : {};
  const has = (bit: number) => fixed[bit] ?? ((key & bit) !== 0 ? 1 : 0);
  return {
    DISC_ONLY: entry === "discs" ? 1 : 0,
    HAS_RADIO: has(1),
    HAS_POL: has(2),
    HAS_JET: has(4),
    HAS_SPOT: has(8),
    HAS_VOL: has(16),
    HAS_WH: has(32),
    HAS_THICK: has(64),
    HAS_BODIES: has(128),
    // (the raster's kernels: the runways' code in whether one is near or not — its parameters say — with the raster's
    // primary visibility; the key then without its bit, writeParams)
    HAS_RWY: has(256) || (RASTER_RUNWAYS.has(entry) && !quality && has(FEATURE_TERRAIN_RASTER)) ? 1 : 0,
    HAS_KERR: has(512),
    HAS_WX: has(1024),
    HAS_SHADE: has(2048),
    HAS_SURFACE: has(4096),
    HAS_SCENERY: has(8192),
    HAS_AURORA: has(16384),
    HAS_TERRAIN_CACHE: ground ? has(FEATURE_TERRAIN_CACHE) : 0,
    HAS_TERRAIN_RASTER: ground && o.rasterHint ? has(FEATURE_TERRAIN_RASTER) : 0,
    // (the raster's companion: the traced kernels of the Earth-raster profile without the near ground's sub-pixel detail —
    // the raster draws it; the probe's coarse ground is P5's)
    NEAR_DETAIL: profile && o.companion !== false && (entry === "main" || entry === "discs") ? 0 : 1,
    COST_VIEW: (key >> 16) & 15,
    ...(o.tune ?? {}),
    QUALITY_PIPELINE: quality ? 1 : 0,
  };
}
