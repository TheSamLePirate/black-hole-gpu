// The geoid's map, without its file (so the workers and the ground's samplers take it without the asset): its grid —
// assets/earth/geoid-egm2008-15.bin, scripts/build-geoid.py: 15′ equirectangular, texel centres, N in centimetres —,
// the map once given (geoid.ts loadGeoid, or a worker handed the page's copy) and N read from it, the same on the CPU
// and in the tracer's table (gpu-tables.ts TABLE_GEOID, trace.wgsl geoidN).

import type { HeightMap } from "./heights-file";

export const GEOID_W = 1440;
export const GEOID_H = 720;
/** the geoid's highest [m] (New Guinea; its lowest −107 m, south of India) */
export const GEOID_MAX = 86;

let grid: HeightMap | null = null;

/** The map, when given (the GPU's copy, a worker's). */
export const geoidMap = (): HeightMap | null => grid;

/** Set the map (geoid.ts once loaded; a worker; the tests). */
export function setGeoid(g: HeightMap | null) {
  grid = g;
}

/** N [m] at a geodetic latitude and longitude [rad]: the sea's height over the ellipsoid there (0 without the map). */
export function geoidN(lat: number, lon: number, g: HeightMap | null = grid): number {
  if (!g) return 0;
  const { map, W, H } = g;
  // (texel centres: u = 0.5 + lon/2π, v = 0.5 − lat/π; longitude wrapped, latitude clamped at the rows' centres)
  let x = (lon / (2 * Math.PI) + 0.5) * W - 0.5;
  x -= Math.floor(x / W) * W;
  const y = Math.min(Math.max((0.5 - lat / Math.PI) * H - 0.5, 0), H - 1);
  const x0 = Math.min(Math.floor(x), W - 1),
    y0 = Math.min(Math.floor(y), H - 2);
  const fx = x - x0,
    fy = y - y0;
  const x1 = x0 + 1 === W ? 0 : x0 + 1;
  const r0 = y0 * W,
    r1 = r0 + W;
  const a = map[r0 + x0]! + (map[r0 + x1]! - map[r0 + x0]!) * fx;
  const b = map[r1 + x0]! + (map[r1 + x1]! - map[r1 + x0]!) * fx;
  return (a + (b - a) * fy) * 0.01;
}

/** N [m] at a geodetic latitude and longitude in degrees. */
export const geoidDeg = (lat: number, lon: number, g: HeightMap | null = grid): number =>
  geoidN((lat * Math.PI) / 180, (lon * Math.PI) / 180, g);

/** N [m] at a unit direction on the Earth's axes, geodetic (its z the sine of the geodetic latitude). */
export const geoidAt = (q: readonly number[], g: HeightMap | null = grid): number =>
  g ? geoidN(Math.asin(Math.max(-1, Math.min(1, q[2]!))), Math.atan2(q[1]!, q[0]!), g) : 0;

/** The map as the tracer's table holds it: N [m] node by node (gpu-tables.ts TABLE_GEOID). */
export function geoidTable(g: HeightMap): Float32Array<ArrayBuffer> {
  const out = new Float32Array(g.W * g.H);
  for (let i = 0; i < out.length; i++) out[i] = g.map[i]! * 0.01;
  return out;
}

/** N [m] under a point on the Earth's axes (any units): its geodetic latitude as on the ellipsoid (exact at the
 *  ground; at 10 km up, 3″ off — a few centimetres of N). */
export function geoidUnder(p: readonly number[], g: HeightMap | null = grid): number {
  if (!g) return 0;
  const b2 = (1 - 1 / 298.257223563) ** 2;
  return geoidN(Math.atan2(p[2]!, b2 * Math.hypot(p[0]!, p[1]!)), Math.atan2(p[1]!, p[0]!), g);
}
