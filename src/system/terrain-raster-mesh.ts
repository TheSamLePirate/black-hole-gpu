import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "./ellipsoid";
import { TERRAIN_CACHE_N, TERRAIN_CACHE_ROUNDS, type TerrainWindow } from "./terrain-cache-layout";
import { RUNWAY_HALF_WIDTH, RUNWAY_GRADE } from "../game/sites";

// Four runways, sixteen candidate knots per axis each. Every row/column spans the patch: no T junctions.
export const RASTER_MESH_MAX_SIDE = TERRAIN_CACHE_N + 64;
export const RASTER_MESH_VERTEX_BYTES = RASTER_MESH_MAX_SIDE ** 2 * 12;
export const RASTER_MESH_INDEX_BYTES = (RASTER_MESH_MAX_SIDE - 1) ** 2 * 6 * 4;

/** Only geometry determines topology. Wind, clock, landing direction and camera offsets do not. */
export function runwayMeshKey(runways: Float32Array): string {
  const count = Math.min(4, Math.max(0, Math.floor(runways[0] ?? 0)));
  const values: string[] = [];
  for (let k = 0; k < count; k++) {
    const at = 4 + 16 * k;
    values.push(runways.subarray(at, at + 11).join(","));
  }
  return values.sort().join(";");
}

export function terrainRasterMesh(window: TerrainWindow, level: number, runways: Float32Array) {
  const per = TERRAIN_CACHE_ROUNDS[level]! / (2 * Math.PI);
  const xs: number[] = [],
    ys: number[] = [];
  const add = (values: number[], v: number) => {
    if (Number.isFinite(v) && v > 0 && v < TERRAIN_CACHE_N - 1) values.push(Math.fround(v));
  };
  for (let k = 0; k < Math.min(4, Math.max(0, Math.floor(runways[0] ?? 0))); k++) {
    const at = 4 + 16 * k;
    const p = geodeticToCart(WGS84_A, WGS84_F, Math.asin(runways[at + 2]!), Math.atan2(runways[at + 1]!, runways[at]!), 0);
    const length = runways[at + 3]!;
    for (const a of [-RUNWAY_GRADE.levelPast, 0, length, length + RUNWAY_GRADE.levelPast])
      for (const c of [-RUNWAY_GRADE.levelSide, -RUNWAY_HALF_WIDTH, RUNWAY_HALF_WIDTH, RUNWAY_GRADE.levelSide]) {
        const point = p.map((v, i) => v + a * runways[at + 4 + i]! + c * runways[at + 8 + i]!) as [number, number, number];
        const g = cartToGeodetic(WGS84_A, WGS84_F, point);
        let x = g.lon * per;
        const round = TERRAIN_CACHE_ROUNDS[level]!;
        x += Math.round((window.i + (TERRAIN_CACHE_N - 1) / 2 - x) / round) * round;
        const u = x - window.i,
          v = g.lat * per - window.j;
        // A runway outside the patch must not refine unrelated strips inside it.
        if (u >= 0 && u <= TERRAIN_CACHE_N - 1 && v >= 0 && v <= TERRAIN_CACHE_N - 1) {
          add(xs, u);
          add(ys, v);
        }
      }
  }
  const knots = (extra: number[]) => {
    const values = [
      ...Array.from({ length: TERRAIN_CACHE_N }, (_, i) => i),
      ...extra.filter((v) => Math.abs(v - Math.round(v)) >= 1e-4),
    ].sort((a, b) => a - b);
    // Preserve every original integer node; avoid near-duplicate/sliver intervals in float32.
    const out: number[] = [];
    for (const v of values) if (!out.length || Number.isInteger(v) || v - out[out.length - 1]! >= 1e-4) out.push(v);
    return out;
  };
  const x = knots(xs),
    y = knots(ys);
  const vertices = new Float32Array(x.length * y.length * 3);
  const step = (values: number[], i: number) =>
    Math.max(i ? values[i]! - values[i - 1]! : 0, i + 1 < values.length ? values[i + 1]! - values[i]! : 0);
  for (let j = 0; j < y.length; j++)
    for (let i = 0; i < x.length; i++) {
      vertices.set([x[i]!, y[j]!, Math.max(0.05, (WGS84_A / per / 2) * Math.max(step(x, i), step(y, j)))], 3 * (j * x.length + i));
    }
  const indices = new Uint32Array((x.length - 1) * (y.length - 1) * 6);
  let n = 0;
  for (let j = 0; j < y.length - 1; j++)
    for (let i = 0; i < x.length - 1; i++) {
      const a = j * x.length + i;
      indices.set([a, a + 1, a + x.length, a + 1, a + x.length + 1, a + x.length], n);
      n += 6;
    }
  return { vertices, indices, columns: x.length, rows: y.length };
}
