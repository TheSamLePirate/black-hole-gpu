import { WGS84_A } from "./ellipsoid";

// The experimental surface cache shares the tracer's existing read-only table binding.
// Eight bounded, world-fixed grids. Two vec4s of metadata and one scalar height per node. Their nodes 1.2, 2.4, 9.5, 38,
// 153, 611 m … apart (a whole turn of the equator in so many): each four times the next finer's — the last two, 1.2 and
// 2.4 m, twice (I3: the IGN's relief near the raster's camera, docs/ANALYSE-IGN-LIDAR.md).
export const TERRAIN_CACHE_N = 257;
export const TERRAIN_CACHE_ROUNDS = [2 ** 25, 2 ** 24, 2 ** 22, 2 ** 20, 2 ** 18, 2 ** 16, 2 ** 14, 2 ** 12] as const;
/** the level the raster's patch was before I3 (153 m nodes, ~20 km): its tolerances and shading rate the reference — finer
 *  levels are drawn as it was, coarser ones as its far rings were (trace.wgsl RHINT_TOL, TUNE_RING_RATE) */
export const TERRAIN_CACHE_PATCH_REF = 4;
/** the coarsest level the raster draws (its far rings' last: 2.4 km nodes, ~300 km) */
export const TERRAIN_CACHE_RING_LAST = 6;
export const TERRAIN_CACHE_LEVELS = TERRAIN_CACHE_ROUNDS.length;
export const TERRAIN_CACHE_HEADER = 2 * TERRAIN_CACHE_LEVELS;
export const TERRAIN_CACHE_NODE_VEC4S = Math.ceil((TERRAIN_CACHE_N * TERRAIN_CACHE_N) / 4);
export const TERRAIN_CACHE_VEC4S = TERRAIN_CACHE_HEADER + TERRAIN_CACHE_LEVELS * TERRAIN_CACHE_NODE_VEC4S;
export const TERRAIN_CACHE_MAX_LAT = (70 * Math.PI) / 180;

export interface TerrainWindow {
  /** Indices of the first node, on this level's global angular lattice. Longitude is unwrapped. */
  i: number;
  j: number;
}

/** how far ahead along the motion a window is placed when it moves (T4), in its nodes: the camera then crosses 24 + 32 of
 *  them before it moves again, not 32 — the finest levels' bakes in flight × 0.57 —, the detail kept ahead */
export const TERRAIN_CACHE_LEAD = 24;

/**
 * Keep a window until the camera moves a quarter of its width; wrap longitude before comparing. Moved, it is placed ahead along
 * `dir` (the motion's direction on the lattice — longitude, latitude —, unit; none: centred) by TERRAIN_CACHE_LEAD nodes.
 */
export function terrainWindow(
  previous: TerrainWindow | null,
  lon: number,
  lat: number,
  round: number,
  dir: readonly [number, number] | null = null,
): TerrainWindow | null {
  if (!Number.isFinite(lon + lat) || Math.abs(lat) > TERRAIN_CACHE_MAX_LAT) return null;
  const per = round / (2 * Math.PI);
  const centre = (TERRAIN_CACHE_N - 1) / 2;
  let x = lon * per;
  const y = lat * per;
  if (previous) {
    x += Math.round((previous.i + centre - x) / round) * round;
    if (Math.abs(x - previous.i - centre) <= centre / 2 && Math.abs(y - previous.j - centre) <= centre / 2) return previous;
  }
  const lx = dir ? dir[0] * TERRAIN_CACHE_LEAD : 0,
    ly = dir ? dir[1] * TERRAIN_CACHE_LEAD : 0;
  return { i: Math.floor(x + lx) - centre, j: Math.floor(y + ly) - centre };
}

/**
 * The window a level will move to next — the camera still in its window, within half the hold distance (64 nodes with
 * 257) of the edge it moves toward: where it will cross, and the window terrainWindow places there, led along the motion.
 * Null: at rest, or the edge still far. The cache commits to it (TerrainCache.upcomingWindow): the patch's mesh — cut
 * along the runways on the CPU — made for it ahead, in a worker, ready when the window moves.
 */
export function terrainWindowNext(
  previous: TerrainWindow,
  lon: number,
  lat: number,
  round: number,
  dir: readonly [number, number] | null,
): TerrainWindow | null {
  if (!dir || !Number.isFinite(lon + lat)) return null;
  const per = round / (2 * Math.PI);
  const centre = (TERRAIN_CACHE_N - 1) / 2,
    hold = centre / 2;
  let x = lon * per;
  const y = lat * per;
  x += Math.round((previous.i + centre - x) / round) * round;
  // (the nodes along the motion to the hold box's edge, each axis)
  const toEdge = (p: number, c: number, d: number) => (d > 1e-9 ? (c + hold - p) / d : d < -1e-9 ? (c - hold - p) / d : Infinity);
  const t = Math.min(toEdge(x, previous.i + centre, dir[0]), toEdge(y, previous.j + centre, dir[1]));
  if (!Number.isFinite(t) || t < 0 || t > hold) return null;
  // (a node past the edge: there, the window terrainWindow would place)
  const cx = x + dir[0] * (t + 1),
    cy = y + dir[1] * (t + 1);
  const next = { i: Math.floor(cx + dir[0] * TERRAIN_CACHE_LEAD) - centre, j: Math.floor(cy + dir[1] * TERRAIN_CACHE_LEAD) - centre };
  return Math.abs(next.j + centre) <= TERRAIN_CACHE_MAX_LAT * per + centre ? next : null;
}

/** Whether a window still holds the camera (terrainWindow would keep it). */
export function terrainWindowHolds(window: TerrainWindow, lon: number, lat: number, round: number): boolean {
  return terrainWindow(window, lon, lat, round) === window;
}

/** Reference and scale in the tracer's table; ready is published only with the matching GPU copy. */
export function terrainWindowParams(window: TerrainWindow, round: number, ready: boolean): Float32Array<ArrayBuffer> {
  const lon = (window.i / round) * 2 * Math.PI;
  const lat = (window.j / round) * 2 * Math.PI;
  const per = round / (2 * Math.PI);
  // The source's footprint cuts the noise before wavelengths fall below twice the node spacing.
  const foot = WGS84_A / per / 2;
  return new Float32Array([Math.cos(lon), Math.sin(lon), Math.sin(lat), Math.cos(lat), per, foot, ready ? 1 : 0, 0]);
}
