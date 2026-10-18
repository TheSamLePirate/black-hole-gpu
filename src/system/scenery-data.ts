// Shared worker/GPU contract: local WGS84 metres, stackless BVH, exact polygon extrusions.
import { geodeticToCart, WGS84_A, WGS84_F } from "./ellipsoid";
import { type ForestFrame, forestVec4s, writeForest } from "./forest";
import type { Vec3 } from "../physics";

export const SCENERY_BYTES = 16 * 1024 * 1024;
/** The detail's reach (settings.detailReach): the scenery's box, its land cover's raster and its rays this many times the
 *  normal ones, its budgets as its area — its buffer 16, 36 or 64 MiB, its raster 512, 768 or 1024 px (~10 m a pixel
 *  kept). */
export const DETAIL_REACH = { normal: 1, far: 1.5, veryFar: 2 } as const;
export type DetailReach = keyof typeof DETAIL_REACH;
export const sceneryBudget = (reach: number) => Math.ceil((SCENERY_BYTES * reach * reach) / (1024 * 1024)) * 1024 * 1024;
export const sceneryGrid = (reach: number) => Math.round((SCENERY_GRID * reach) / 64) * 64;
export const SCENERY_VEC4S = 6;
export const SCENERY_STORAGE_LIMIT = 9;
export const SCENERY_GRID = 512;
export type SceneryMode = "off" | "balanced" | "high";
export const D = Math.PI / 180;
export const wrapLon = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
/** a place kept clear of the scenery: a runway's strip (its heading, length and half width, 300 m past each end),
 *  or a disc (`radius` [m]: a landscape's viewpoint, where the photographer stood) */
export type SceneryExclusion = { lat: number; lon: number; heading: number; length: number; halfWidth: number; radius?: number };
export function sceneryExcluded(lat: number, lon: number, zones: SceneryExclusion[]) {
  return zones.some((v) => {
    const north = (lat - v.lat) * 111320,
      east = wrapLon(lon - v.lon) * 111320 * Math.cos(v.lat * D),
      h = v.heading * D;
    if (v.radius !== undefined) return north * north + east * east < v.radius * v.radius;
    const along = north * Math.cos(h) + east * Math.sin(h),
      across = east * Math.cos(h) - north * Math.sin(h);
    return along > -300 && along < v.length + 300 && Math.abs(across) < v.halfWidth;
  });
}
export function rasterParts(bounds: [number, number, number, number], width: number) {
  const cuts = [bounds[0], ...[-180, 180].filter((v) => v > bounds[0] && v < bounds[2]), bounds[2]];
  return cuts
    .slice(0, -1)
    .map((west, i) => {
      const east = cuts[i + 1]!,
        shift = west < -180 ? 360 : east > 180 ? -360 : 0;
      const x = Math.round(((west - bounds[0]) / (bounds[2] - bounds[0])) * width),
        end = Math.round(((east - bounds[0]) / (bounds[2] - bounds[0])) * width);
      return { bounds: [west + shift, bounds[1], east + shift, bounds[3]], x, width: end - x };
    })
    .filter((v) => v.width > 0);
}
export function sceneryFrame(lat: number, lon: number) {
  const a = lat * D,
    b = lon * D;
  return {
    origin: geodeticToCart(WGS84_A, WGS84_F, a, b, 0),
    east: [-Math.sin(b), Math.cos(b), 0] as Vec3,
    north: [-Math.sin(a) * Math.cos(b), -Math.sin(a) * Math.sin(b), Math.cos(a)] as Vec3,
    up: [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)] as Vec3,
  };
}
export function localPoint(frame: ReturnType<typeof sceneryFrame>, lat: number, lon: number, h: number): Vec3 {
  const p = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, h).map((v, i) => v - frame.origin[i]!) as Vec3;
  return [frame.east, frame.north, frame.up].map((v) => v[0] * p[0] + v[1] * p[1] + v[2] * p[2]) as Vec3;
}
export function sceneryCentre(lat: number, lon: number) {
  const y = Math.round(lat / 0.005) * 0.005;
  const step = 0.005 / Math.max(Math.cos(y * D), 0.12);
  const x = wrapLon(Math.round(lon / step) * step);
  return { lat: y, lon: x, key: `${y.toFixed(5)}:${x.toFixed(5)}` };
}
export function worldCoverUrl(lat: number, lon: number, rgb = false) {
  const span = rgb ? 1 : 3;
  const a = Math.floor(lat / span) * span,
    b = Math.floor(wrapLon(lon) / span) * span;
  const ns = `${a >= 0 ? "N" : "S"}${Math.abs(a).toString().padStart(2, "0")}`;
  const ew = `${b >= 0 ? "E" : "W"}${Math.abs(b).toString().padStart(3, "0")}`;
  return rgb
    ? `https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021/${ns}/ESA_WorldCover_10m_2021_v200_${ns}${ew}_S2RGBNIR.tif`
    : `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${ns}${ew}_Map.tif`;
}
export function seed(x: number, y: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export interface Primitive {
  min: Vec3;
  max: Vec3;
  data: number[];
}
/** a scenery's forest (forest.ts): its grid's frame, a word a cell, the trees in it */
export interface ForestSection {
  frame: ForestFrame;
  cells: Uint32Array;
  trees: number;
}
function sceneryBVH(prims: Primitive[]) {
  const nodes: number[] = [],
    geometries: number[] = [];
  const build = (p: Primitive[]) => {
    const at = nodes.length;
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const v of p)
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, v.min[i]!);
        hi[i] = Math.max(hi[i]!, v.max[i]!);
      }
    nodes.push(...lo, 0, ...hi, -1);
    if (p.length === 1) {
      nodes[at + 7] = geometries.length / 4;
      geometries.push(...p[0]!.data);
    } else {
      let axis = 0;
      for (let i = 1; i < 3; i++) if (hi[i]! - lo[i]! > hi[axis]! - lo[axis]!) axis = i;
      p.sort((a, b) => a.min[axis]! + a.max[axis]! - b.min[axis]! - b.max[axis]!);
      const mid = Math.floor(p.length / 2);
      build(p.slice(0, mid));
      build(p.slice(mid));
    }
    nodes[at + 3] = nodes.length / 8;
  };
  if (prims.length) build([...prims]);
  return { nodes, geometries };
}
// A separate planar BVH keeps roads/water out of every primary and shadow ray; the trees are a grid of
// their own (forest.ts), after the raster.
//   vec4 0 (nodes, geometries at, raster at, raster side)  1 (surfaces' nodes at, count, geometries at, surfaces)
//   2 (forest at: 0 none, —, —, —)  3 (—)  then the nodes, geometries, surfaces, raster, forest
export function packScenery(
  prims: Primitive[],
  pixels: Uint32Array,
  surfaces: Primitive[] = [],
  forest?: ForestSection,
  grid = SCENERY_GRID,
  budget = SCENERY_BYTES,
) {
  const { nodes, geometries } = sceneryBVH(prims);
  const surface = sceneryBVH(surfaces);
  const nodeCount = nodes.length / 8,
    geomOffset = 4 + nodes.length / 4,
    surfaceOffset = geomOffset + geometries.length / 4,
    surfaceGeom = surfaceOffset + surface.nodes.length / 4,
    pixelOffset = surfaceGeom + surface.geometries.length / 4,
    forestOffset = pixelOffset + Math.ceil(pixels.length / 4);
  const bytes = (forestOffset + (forest ? forestVec4s(forest.frame) : 0)) * 16;
  if (bytes > budget) throw new Error("scenery budget exceeded");
  const buffer = new ArrayBuffer(bytes),
    f = new Float32Array(buffer),
    u = new Uint32Array(buffer);
  f.set([nodeCount, geomOffset, pixelOffset, grid], 0);
  f.set([surfaceOffset, surface.nodes.length / 8, surfaceGeom, surfaces.length], 4);
  if (forest) {
    f[8] = forestOffset;
    writeForest(f, u, forestOffset, forest.frame, forest.cells, forest.trees);
  }
  f.set(nodes, 16);
  f.set(geometries, geomOffset * 4);
  f.set(surface.nodes, surfaceOffset * 4);
  f.set(surface.geometries, surfaceGeom * 4);
  u.set(pixels, pixelOffset * 4);
  return buffer;
}
export interface SceneryRequest {
  id: number;
  lat: number;
  lon: number;
  mode: SceneryMode;
  satellite: boolean;
  exclusions: SceneryExclusion[];
  /** the detail's reach (DETAIL_REACH: 1, 1.5, 2) and the bytes the GPU takes for it */
  reach: number;
  budget: number;
}
export interface SceneryReply {
  id: number;
  buffer?: ArrayBuffer;
  lat: number;
  lon: number;
  bounds?: [number, number, number, number];
  trees?: number;
  forestCells?: number;
  forestCellM?: number;
  buildings?: number;
  vertices?: number;
  roads?: number;
  railways?: number;
  waterways?: number;
  waterPolygons?: number;
  pavedPolygons?: number;
  bridges?: number;
  bridgePiers?: number;
  osmLayers?: Record<string, { features: number; fields: string[] }>;
  coverPixels?: number;
  rgbPixels?: number;
  networkBytes?: number;
  workerMs?: number;
  errors?: string[];
  budgetLimited?: boolean;
  error?: string;
}
