import { WGS84_A } from "./ellipsoid";

// The experimental surface cache shares the tracer's existing read-only table binding.
// Six bounded, world-fixed grids. Two vec4s of metadata and one scalar height per node.
export const TERRAIN_CACHE_N = 129;
export const TERRAIN_CACHE_ROUNDS = [2 ** 22, 2 ** 20, 2 ** 18, 2 ** 16, 2 ** 14, 2 ** 12] as const;
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

/** Keep a window until the camera moves a quarter of its width; wrap longitude before comparing. */
export function terrainWindow(previous: TerrainWindow | null, lon: number, lat: number, round: number): TerrainWindow | null {
  if (!Number.isFinite(lon + lat) || Math.abs(lat) > TERRAIN_CACHE_MAX_LAT) return null;
  const per = round / (2 * Math.PI);
  const centre = (TERRAIN_CACHE_N - 1) / 2;
  let x = lon * per;
  const y = lat * per;
  if (previous) {
    x += Math.round((previous.i + centre - x) / round) * round;
    if (Math.abs(x - previous.i - centre) <= centre / 2 && Math.abs(y - previous.j - centre) <= centre / 2) return previous;
  }
  return { i: Math.floor(x) - centre, j: Math.floor(y) - centre };
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
