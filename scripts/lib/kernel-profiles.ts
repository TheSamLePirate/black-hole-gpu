// The reference scenes' kernels, for the tools that size and compile them (scripts/wgsl-inline-size.ts,
// scripts/d3d12-compile-proxy.ts, tests/kernel-budget.test.ts): each a features key as the renderer builds it for that
// scene (renderer.ts writeParams → featureKey) and the pipelines its cascade compiles (realtimeCascade).
import forestWGSL from "../../src/shaders/forest.wgsl" with { type: "text" };
import traceWGSL from "../../src/shaders/trace.wgsl" with { type: "text" };
import {
  FEATURES_ALL,
  FEATURE_RASTER_PRIMARY,
  FEATURE_TERRAIN_CACHE,
  FEATURE_TERRAIN_RASTER,
  NEAR_KIND_SHIFT,
  type TracerEntry,
  tracerConstants,
} from "../../src/system/tracer-kernels";
import { FULL_TRACER_LIMITS, composeTracer } from "../../src/system/tracer-source";

/** the tracer as the full device composes it */
export function tracerSource(): string {
  return composeTracer(traceWGSL, forestWGSL, FULL_TRACER_LIMITS);
}

export interface KernelProfile {
  id: string;
  label: string;
  key: number;
  /** the pipelines a cold launch of the scene compiles, in the cascade's order */
  entries: TracerEntry[];
  /** compiled as the refining pipeline */
  quality?: boolean;
}

const BODIES = 128;
const RWY = 256;
const KERR = 512;
const WX = 1024;
const SHADE = 2048;
const SURFACE = 4096;
const SCENERY = 8192;
const AURORA = 16384;
/** the body near the camera (NEAR_KIND — P7): the Earth, a world with air, a world without air, none */
const NEAR_EARTH = 1 << NEAR_KIND_SHIFT;
const NEAR_AIR = 2 << NEAR_KIND_SHIFT;
const NEAR_AIRLESS = 3 << NEAR_KIND_SHIFT;
const NEAR_NONE = 4 << NEAR_KIND_SHIFT;
const RASTER_ENTRIES: TracerEntry[] = ["shade", "shadeMark", "shadeLite", "shadeWater", "shadeStars", "discs", "clouds", "skyFill"];

// (the game's universe — game:artemis — has Gargantua and the wormhole in it: their bits, 512, 64 and 32, stay on in every
// scene of it, the Earth's flight included — measured, kerr-mini, docs/progress/kernels/mac-mini-baseline.json)
const GAME = KERR | 64 | 32 | BODIES;
export const PROFILES: KernelProfile[] = [
  {
    id: "earth-raster",
    label: "Earth, low flight in the game, raster (Tarifa: surface, scenery; Gargantua and the wormhole in its universe)",
    // (the raster drawing the near Earth: the Earth-raster profile's constants — P3)
    key: GAME | SURFACE | SCENERY | FEATURE_TERRAIN_RASTER | FEATURE_RASTER_PRIMARY | NEAR_EARTH,
    entries: [...RASTER_ENTRIES, "main", "env", "aerial"],
  },
  {
    id: "earth-raster-wx",
    label: "Earth, raster, weather and aurora, the terrain cache (a cloudy night flight)",
    key: GAME | WX | AURORA | SURFACE | SCENERY | FEATURE_TERRAIN_CACHE | FEATURE_TERRAIN_RASTER | FEATURE_RASTER_PRIMARY | NEAR_EARTH,
    entries: [...RASTER_ENTRIES, "main", "env", "aerial"],
  },
  {
    id: "earth-trace",
    label: "Earth, traced (walking, the trace pipeline): runways, surface, scenery",
    key: GAME | RWY | SURFACE | SCENERY | NEAR_EARTH,
    entries: ["main", "env", "aerial"],
  },
  {
    id: "earth-photo",
    label: "Earth, photo mode (the refining kernel)",
    key: GAME | RWY | SURFACE | SCENERY | NEAR_EARTH,
    entries: ["main"],
    quality: true,
  },
  {
    id: "game-space",
    label: "The game's universe from space (key 736: the title, the Moon, the planets)",
    key: GAME | NEAR_NONE,
    entries: ["main", "env", "aerial"],
  },
  {
    id: "moon",
    label: "The Moon's surface in the game's universe (a world without air near)",
    key: GAME | NEAR_AIRLESS,
    entries: ["main", "env", "aerial"],
  },
  {
    id: "mars",
    label: "Mars's surface in the game's universe (a world with air near: its relief marched — PLAN-PLANETES-AAA P7)",
    key: GAME | NEAR_AIR,
    entries: ["main", "env", "aerial", "shadeLite"],
  },
  {
    id: "earth-only",
    label: "An Earth-only scene (bodies, weather; no hole)",
    key: BODIES | WX | NEAR_EARTH,
    entries: ["main", "env", "aerial"],
  },
  { id: "kerr-jet", label: "Kerr + jet (key 516)", key: KERR | 4 | NEAR_NONE, entries: ["main", "env", "lut"] },
  {
    id: "eclipse",
    label: "Earth-only, a body's shadow on it (an eclipse)",
    key: BODIES | SHADE | NEAR_EARTH,
    entries: ["main", "env", "aerial"],
  },
  { id: "general", label: "The general kernel (every feature)", key: FEATURES_ALL, entries: ["main", "env", "lut"] },
];

/** The constants of a profile's pipeline (the full device: the raster's hint taken). */
export function profileConstants(p: KernelProfile, entry: TracerEntry): Record<string, number> {
  return tracerConstants(p.key, entry, { quality: p.quality, rasterHint: true });
}
