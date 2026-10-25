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
  /** a building's triangles for the raster (roof-mesh.ts): its visibility and its shadow map */
  mesh?: { positions: number[]; triangles: number[] };
}
/** the buildings within this of the scene's centre [m] get their triangles — the shadow map's (its ±900 m round the camera)
 *  and the raster's visibility, the material's buildings (docs/progress/raster-aaa/TERRE-UNREAL.md U2: out to where they are
 *  cut into their parts, BUILDING_PARTS_M); the farther ones their boxes, drawn solid */
export const BUILDING_MESH_M = 2000;
/** the buildings within this of the centre [m] have their complex outlines cut into convex parts, each its roof (roofs.ts
 *  planBuilding: ~3 leaves a Paris block); the farther ones one leaf (a complex one flat) — the buffer's budget their count */
export const BUILDING_PARTS_M = 2000;
const SHAPES = ["flat", "gabled", "hipped", "mansard", "shed", "stack"];
/** a terrace's parapet over its roof [m] (trace.wgsl PARAPET) */
export const PARAPET_M = 0.8;
/** A building leaf's packed word (its geometry's vec4 2's w, an integer exact in a float): roof material (4 bits), wall
 *  material (4), storeys (6), roof planes (4), shape (3), has a mesh (1), has a parapet (1) — trace.wgsl reads it,
 *  scenery-raster.ts too. */
export function buildingPacked(roof: number, wall: number, storeys: number, planes: number, shape: string, mesh: boolean, parapet = false) {
  return (
    (roof & 15) |
    ((wall & 15) << 4) |
    (Math.min(63, Math.max(0, Math.round(storeys))) << 8) |
    ((planes & 15) << 14) |
    (Math.max(0, SHAPES.indexOf(shape)) << 18) |
    (mesh ? 1 << 21 : 0) |
    (parapet ? 1 << 22 : 0)
  );
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
      for (const v of p[0]!.data) geometries.push(v);
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
//   2 (forest at: 0 none, —, —, —)  3 (the buildings' mesh: vertices at, count, triangles at, count)
//   then the nodes, geometries, surfaces, raster, forest, the mesh's vertices (x, y, z floats packed), its triangles (three
//   vertex indices a triangle, u32, packed)
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
  let vertexCount = 0,
    triangleCount = 0;
  for (const p of prims)
    if (p.mesh) {
      vertexCount += p.mesh.positions.length / 3;
      triangleCount += p.mesh.triangles.length / 3;
    }
  const meshOffset = forestOffset + (forest ? forestVec4s(forest.frame) : 0),
    triangleOffset = meshOffset + Math.ceil((vertexCount * 3) / 4);
  const bytes = (triangleOffset + Math.ceil((triangleCount * 3) / 4)) * 16;
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
  if (triangleCount) {
    f.set([meshOffset, vertexCount, triangleOffset, triangleCount], 12);
    let v = 0,
      t = triangleOffset * 4;
    for (const p of prims) {
      if (!p.mesh) continue;
      f.set(p.mesh.positions, meshOffset * 4 + v * 3);
      for (const k of p.mesh.triangles) u[t++] = v + k;
      v += p.mesh.positions.length / 3;
    }
  }
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
  /** the geoid round the centre (system/geoid.ts): N [m] there and its slopes [m per degree of latitude, of
   *  longitude] — the ground over the ellipsoid, as the tracer's (a plane: within a few centimetres over the reach) */
  geoid?: [number, number, number];
  /** the IGN's survey over France (settings.earthIgnRelief — I4, ign-canopy.ts): the trees where its canopy stands, their
   *  feet and the buildings' on its ground */
  ign?: boolean;
  /** Overture Maps' buildings near the centre outside the BD TOPO's France (settings.earthOverture — B7, pmtiles.ts) */
  overture?: boolean;
}
export interface SceneryReply {
  id: number;
  buffer?: ArrayBuffer;
  lat: number;
  lon: number;
  bounds?: [number, number, number, number];
  trees?: number;
  /** of them, placed and sized by the IGN's canopy (I4); the survey's requests */
  surveyedTrees?: number;
  surveyRequests?: number;
  /** a survey block's failure (its trees the land cover's) */
  surveyError?: string;
  /** of the buildings, the IGN's BD TOPO's over France (I5, bdtopo.ts); its tiles taken */
  bdtopoBuildings?: number;
  bdtopoTiles?: number;
  /** of the buildings, Overture Maps' (B7); its z 14 tiles read */
  overtureBuildings?: number;
  overtureTiles?: number;
  forestCells?: number;
  forestCellM?: number;
  buildings?: number;
  vertices?: number;
  /** the buildings' roofs by shape (roofs.ts), those with triangles for the raster and their bytes */
  roofShapes?: Record<string, number>;
  meshedBuildings?: number;
  /** of the roofs, measured by the IGN's canopy model (B6: the BD TOPO without their ridge) */
  lidarRoofs?: number;
  /** the chimney stacks (B9) */
  stacks?: number;
  meshBytes?: number;
  /** where the buffer's bytes went: the forest's grid, the land cover's raster, all before the buildings, the buildings'
   *  leaves (their meshes apart), the budget */
  bytes?: { forest: number; raster: number; before: number; buildings: number; budget: number };
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
  /** its responses an offline zone served (the Service Worker's x-kerr-zone), and the others — the network's, the tiles'
   *  cache's (sw.ts) */
  zoneResponses?: number;
  otherResponses?: number;
  workerMs?: number;
  errors?: string[];
  budgetLimited?: boolean;
  error?: string;
}
