// The surface's identity at a pixel (docs/PLAN-J1-OPAQUE-FORWARD.md J1-2; strategy §7.4): what the visibility pass drew there —
// its kind, its object, the publication it came from — read from the visibility target as it is today (terrain-raster.ts: rgba32float,
// r the ground's distance, g the scenery's instance, b the nearest surface's distance, a its code × 2¹⁸ + the ground's normal) and
// packed in the contract's one word: the object in 20 bits, the generation in 12 (0: nothing). The adapter of the old channels'
// several meanings into one typed answer, for the new readers (a selection, a diagnostic, later the history's rejection); the
// target itself unchanged — no image changes. Pure.

import { RASTER_CODE, RASTER_CODE_SCALE } from "./terrain-raster-hint";

export type SurfaceKind = "none" | "ground" | "tree" | "building" | "box" | "bridge" | "bridgeMesh" | "turbine" | "pylon" | "cloud";

export interface SurfaceAt {
  kind: SurfaceKind;
  /** the ground's distance [m] (r; 0 none) */
  ground: number;
  /** the nearest surface's distance [m] (b: the ground's, or an instance's proxy before it; 0 none) */
  nearest: number;
  /** the object within its kind (a tree's grid cell + 1, a building's record offset + 1; 0 for the ground and the marks) */
  object: number;
  /** the ground's level: 0 the patch, then its rings (1 + rank + 8 × step − 1), −1 not the ground */
  level: number;
  /** the contract's word: object (20 bits) | generation (12 bits) << 20; 0 nothing */
  id: number;
}

export const SURFACE_OBJECT_BITS = 20;
export const SURFACE_GENERATION_BITS = 12;
const OBJECT_MASK = (1 << SURFACE_OBJECT_BITS) - 1;
const GENERATION_MASK = (1 << SURFACE_GENERATION_BITS) - 1;

/** The contract's word: an object (its low 20 bits) of a generation (its low 12 bits); 0 when there is no object. */
export function packSurfaceId(object: number, generation: number): number {
  if (object <= 0) return 0;
  return ((object & OBJECT_MASK) | ((generation & GENERATION_MASK) << SURFACE_OBJECT_BITS)) >>> 0;
}
export function unpackSurfaceId(id: number): { object: number; generation: number } {
  return { object: id & OBJECT_MASK, generation: (id >>> SURFACE_OBJECT_BITS) & GENERATION_MASK };
}

/** PLAN-J1 J1-5 — the craft drawn into the scene (ship.wgsl composeSurface): the top of the object space, 2²⁰ − 1 − its instance
 *  (0 the flown one), of the craft's generation (ShipRenderer.craftGen: a new flown craft or mount, a new one) */
export const CRAFT_OBJECTS = 64;
export function craftSurfaceId(instance: number, generation: number): number {
  return packSurfaceId(OBJECT_MASK - Math.min(Math.max(instance, 0), CRAFT_OBJECTS - 1), generation);
}
/** the craft's instance a word names, or null (another object, or nothing) */
export function craftInstanceOf(id: number): number | null {
  const object = id & OBJECT_MASK;
  return id !== 0 && object > OBJECT_MASK - CRAFT_OBJECTS ? OBJECT_MASK - object : null;
}

const CODES: Record<number, SurfaceKind> = {
  [RASTER_CODE.turbine]: "turbine",
  [RASTER_CODE.pylon]: "pylon",
  [RASTER_CODE.cloud]: "cloud",
  [RASTER_CODE.box]: "box",
  [RASTER_CODE.bridgeMark]: "bridge",
  [RASTER_CODE.mesh]: "building",
  [RASTER_CODE.bridgeMesh]: "bridgeMesh",
};

/** A visibility texel (r, g, b, a) decoded — as trace.wgsl's terrainRasterId / Leaf / Code read it —, its object of the scenery's
 *  publication `generation` (scenery.ts revision). */
export function decodeSurface(texel: ArrayLike<number>, generation: number): SurfaceAt {
  const ground = texel[0] ?? 0,
    g = texel[1] ?? 0,
    nearest = texel[2] ?? 0,
    a = texel[3] ?? 0;
  const code = Math.floor(a / RASTER_CODE_SCALE);
  let kind: SurfaceKind = "none";
  let object = 0;
  let level = -1;
  if (CODES[code]) {
    kind = CODES[code]!;
    // (a building's own triangles: g its leaf; the boxes and marks carry none)
    if (code >= RASTER_CODE.mesh) object = Math.round(g);
  } else if (code > 0 || ground > 0 || nearest > 0) {
    // (a tree's proxy: g its cell + 1, a 0 — scenery-raster.ts proxyFs —; the ground: its code 1 + rank + 8 × step, g 0)
    if (g > 0) {
      kind = "tree";
      object = Math.round(g);
    } else {
      kind = "ground";
      level = Math.max(code - 1, 0);
    }
  }
  return { kind, ground, nearest, object, level, id: packSurfaceId(object, generation) };
}

/** Half floats (IEEE 754 binary16, as a rgba16float texel's) to numbers. */
export function halfs(h: ArrayLike<number>): number[] {
  return Array.from(h, (b) => {
    const e = (b >> 10) & 31,
      m = b & 1023,
      sign = b & 0x8000 ? -1 : 1;
    if (e === 0) return sign * m * 2 ** -24;
    if (e === 31) return m ? Number.NaN : sign * Number.POSITIVE_INFINITY;
    return sign * (1 + m / 1024) * 2 ** (e - 15);
  });
}
