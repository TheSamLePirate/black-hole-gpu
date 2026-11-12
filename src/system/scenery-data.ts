// Shared worker/GPU contract: local WGS84 metres, stackless BVH, exact polygon extrusions.
import { carMesh } from "./traffic";
import { geodeticToCart, WGS84_A, WGS84_F } from "./ellipsoid";
import { type ForestFrame, forestVec4s, writeForest } from "./forest";
import type { Vec3 } from "../physics";

import { DECAL_FAR, DECAL_NEAR, type Decals } from "./scenery-geometry";
import { LAMP_GRID } from "./streetlamps";
export const SCENERY_BYTES = 16 * 1024 * 1024;
/** The detail's reach (settings.detailReach): the scenery's box, its land cover's raster and its rays this many times the
 *  normal ones, its budgets as its area — its buffer 16, 36 or 64 MiB, its raster 512, 768 or 1024 px (~10 m a pixel
 *  kept). */
/** the IGN's gates — the page's relief grids (earth-tiles.ts), the worker's survey (ign-canopy.ts) — opened to this many a second
 *  when the Service Worker controls the page: its own Géoplateforme budget holds the network's requests (sw.ts), the cache's
 *  answers never held (the 20 and 12 a second held those too: a warm start paid 15–35 s) */
export const IGN_GATE_SW = 200;
export const DETAIL_REACH = { normal: 1, far: 1.5, veryFar: 2 } as const;
export type DetailReach = keyof typeof DETAIL_REACH;
export const sceneryBudget = (reach: number) => Math.ceil((SCENERY_BYTES * reach * reach) / (1024 * 1024)) * 1024 * 1024;
export const sceneryGrid = (reach: number) => Math.round((SCENERY_GRID * reach) / 64) * 64;
export const SCENERY_VEC4S = 8;
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
/**
 * A building leaf's footprint as an oriented box — along its longest edge —: [centre x, centre y, its angle (rad), its
 * half-sides packed (ceil 10 × half along the angle) × 4096 + (ceil 10 × half across); −1 a side past 409.5 m]. In the leaf's
 * second vec4 (its frame bounds there before: read by nobody): the raster's solid box for a building without triangles
 * (scenery-raster.ts boxSolidVs) turned as the building is — not along the frame's east and north, a block of Paris at 30° a
 * box far wider than it, its lid the ground's photograph.
 */
export function orientedBox(edges: ArrayLike<number>): [number, number, number, number] {
  let best = -1,
    angle = 0;
  for (let i = 0; i + 3 < edges.length; i += 4) {
    const dx = edges[i + 2]! - edges[i]!,
      dy = edges[i + 3]! - edges[i + 1]!;
    const l = dx * dx + dy * dy;
    if (l > best) {
      best = l;
      angle = Math.atan2(dy, dx);
    }
  }
  const c = Math.cos(angle),
    s = Math.sin(angle);
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const x = edges[i]!,
      y = edges[i + 1]!;
    const u = x * c + y * s,
      v = -x * s + y * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const cu = (u0 + u1) / 2,
    cv = (v0 + v1) / 2;
  const hu = Math.ceil(((u1 - u0) / 2) * 10),
    hv = Math.ceil(((v1 - v0) / 2) * 10);
  const cx = cu * c - cv * s,
    cy = cu * s + cv * c;
  return [cx, cy, angle, hu > 4095 || hv > 4095 || !Number.isFinite(hu + hv) ? -1 : hu * 4096 + hv];
}

export function buildingPacked(
  roof: number,
  wall: number,
  storeys: number,
  planes: number,
  shape: string,
  mesh: boolean,
  parapet = false,
  work = false,
) {
  // (bit 23 — the last a float holds exactly —: a workplace's — BD TOPO's usage not a home's: its windows dark at night but its
  // shop floor's, Q3)
  return (
    (roof & 15) |
    ((wall & 15) << 4) |
    (Math.min(63, Math.max(0, Math.round(storeys))) << 8) |
    ((planes & 15) << 14) |
    (Math.max(0, SHAPES.indexOf(shape)) << 18) |
    (mesh ? 1 << 21 : 0) |
    (parapet ? 1 << 22 : 0) |
    (work ? 1 << 23 : 0)
  );
}
/** a coordinate as a float32 whose last bit says a flag (Q3: a building's edge's x — a blind side, a party wall): 0.2 mm at most
 *  off at the scenes' few kilometres */
const MARK_F = new Float32Array(1),
  MARK_U = new Uint32Array(MARK_F.buffer);
export function markedCoord(x: number, flag: boolean): number {
  MARK_F[0] = x;
  MARK_U[0] = (MARK_U[0]! & ~1) | (flag ? 1 : 0);
  return MARK_F[0]!;
}
/** a building's workplace bit's usages: BD TOPO's usage_1 not a home's (offices, shops, industry, farms, schools, churches…) */
export const isWorkUsage = (usage?: string) => !!usage && usage !== "Résidentiel" && usage !== "Indifférencié";
/** a scenery's forest (forest.ts): its grid's frame, a word a cell, the trees in it */
export interface ForestSection {
  frame: ForestFrame;
  cells: Uint32Array;
  trees: number;
}
// (`placed`: the leaves' records already written by another tree — their offsets there, nothing written here: the water's
// tree over the surfaces' records)
function sceneryBVH(prims: Primitive[], placed?: Map<Primitive, number>) {
  const nodes: number[] = [],
    geometries: number[] = [];
  const offsets = new Map<Primitive, number>();
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
      const there = placed?.get(p[0]!);
      if (there !== undefined) nodes[at + 7] = there;
      else {
        nodes[at + 7] = geometries.length / 4;
        offsets.set(p[0]!, geometries.length / 4);
        for (const v of p[0]!.data) geometries.push(v);
      }
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
  return { nodes, geometries, offsets };
}
/** a surface of water: a polygon of kind 4 (its colour's w the outer ring's edges), a line of kind 3 (scenery-geometry.ts) */
const isWater = (p: Primitive) => (p.data[11]! > 0.5 ? p.data[3] === 4 : p.data[5] === 3);
/** a water polygon's edges at most a band (waterBands) */
const BAND_EDGES = 24;
/**
 * A large water polygon cut into horizontal bands for the water's tree (TERRE-UNREAL U6): trace.wgsl sceneryPolygon counts
 * the edges a ray along +x crosses at the point's height — only the edges whose span takes in that height count, so a
 * band keeps those that reach into it (whole: the same crossings, the same answer), its box their x extent over its height
 * (left of them all: an even count, outside; right: none). The Seine through Paris, thousands of edges each tested at every
 * pixel inside its box, now a few dozen. The same record's layout (polygonPrimitive); its outer ring's edges first, their
 * count in the colour's w (the river's dry islands; ¾ for none: still a polygon's, over ½, its ring empty).
 */
export function waterBands(p: Primitive): Primitive[] {
  const d = p.data;
  const count = d[2]!,
    outer = d[11]!;
  if (count <= BAND_EDGES) return [p];
  const y0 = d[5]!,
    y1 = d[7]!;
  const n = Math.max(1, Math.ceil(count / BAND_EDGES));
  const h = Math.max((y1 - y0) / n, 1);
  const out: Primitive[] = [];
  for (let b = 0; b < n; b++) {
    const lo = y0 + b * h,
      hi = b === n - 1 ? y1 : y0 + (b + 1) * h;
    const edges: number[] = [];
    let kept = 0,
      x0 = Infinity,
      x1 = -Infinity;
    for (let i = 0; i < count; i++) {
      const e = 12 + 4 * i;
      const ya = d[e + 1]!,
        yb = d[e + 3]!;
      if (Math.max(ya, yb) < lo || Math.min(ya, yb) > hi) continue;
      edges.push(d[e]!, ya, d[e + 2]!, yb);
      x0 = Math.min(x0, d[e]!, d[e + 2]!);
      x1 = Math.max(x1, d[e]!, d[e + 2]!);
      if (i < outer) kept++;
    }
    if (!edges.length) continue;
    out.push({
      min: [x0, lo, p.min[2]],
      max: [x1, hi, p.max[2]],
      data: [d[0]!, d[1]!, edges.length / 4, d[3]!, x0, lo, x1, hi, d[8]!, d[9]!, d[10]!, Math.max(kept, 0.75), ...edges],
    });
  }
  return out;
}
// A separate planar BVH keeps roads/water out of every primary and shadow ray; the trees are a grid of
// their own (forest.ts), after the raster.
//   vec4 0 (nodes, geometries at, raster at, raster side)  1 (surfaces' nodes at, count, geometries at, surfaces)
//   2 (forest at: 0 none, the water's nodes at, their count, —)  3 (the buildings' mesh: vertices at, count, triangles at,
//   count)
//   (the water's own tree over the surfaces' records — trace.wgsl sceneryWaterAt, the raster's material at each pixel: the
//   surfaces' whole tree walked for the water alone was a third of its cost over a city — TERRE-UNREAL U6)
//   then the nodes, geometries, surfaces, raster, forest, the mesh's vertices (x, y, z floats packed), its triangles (three
//   vertex indices a triangle, u32, packed)
/** (Q8 D1) a wind turbine triangle's tag (packScenery: after the triangles) — scenery-raster.ts meshFs codes it RASTER_CODE.turbine */
export const TURBINE_TAG = 0xffffffff;
/** (Q8 D1) a turbine blade triangle's tag: this | the turbine's index (its rotor in the table after the tags) */
export const TURBINE_BLADE = 0xfffe0000;
/** (Q8 D1) a turbine head's triangle (nacelle, hub): this | its index — turned to the wind about the tower's axis */
export const TURBINE_HEAD = 0xfffd0000;
/** (Q8 D1) a turbine's obstruction light's triangle: this | its index — turned with the head, widened to a few pixels, lit at night */
export const TURBINE_LAMP = 0xfffa0000;
/** (Q8 D1) a pylon's triangle: this | its index (its entry in the pylons' table) — scenery-raster.ts meshFs: RASTER_CODE.pylon */
export const PYLON_TAG = 0xfffc0000;
/** (Q8 D1) a conductor's ribbon triangle — scenery-raster.ts meshVs widens it to a pixel, meshFs keeps its coverage's share */
export const CABLE_TAG = 0xfffb0000;
/** (Q8 D1) a car's triangles: its body, its headlights, its tail lights | its index */
export const CAR_BODY = 0xfff90000;
export const CAR_HEAD = 0xfff80000;
export const CAR_TAIL = 0xfff70000;
/** (Q8 L10) a street lamp's pole (a pair of vertices at its foot, a pair at its top: widened across the view, dithered) and its
 *  head (four vertices at its centre: opened to a quad) | its index */
export const LAMP_POLE = 0xfff60000;
export const LAMP_HEAD = 0xfff50000;
export function packScenery(
  prims: Primitive[],
  pixels: Uint32Array,
  surfaces: Primitive[] = [],
  forest?: ForestSection,
  grid = SCENERY_GRID,
  budget = SCENERY_BYTES,
  decals?: Decals,
  /** (Q8 D1) the wind turbines' triangles (system/turbines.ts), after the bridges', tagged TURBINE_TAG — their blades (the last
   *  `blades` triangles) TURBINE_BLADE | its index —, then, after a header vec4, a table of three vec4 a turbine after the tags: (hub, turn rate
   *  [rad/s]), (axis, phase [rad]), (the tower's axis x, y, its light's
   *  height z) */
  turbines: {
    positions: number[];
    triangles: number[];
    blades?: number;
    head?: number;
    lamp?: number;
    lampZ?: number;
    tower?: [number, number];
    hub?: [number, number, number];
    axis?: [number, number, number];
    omega?: number;
    phase?: number;
  }[] = [],
  /** (Q8 D1) the pylons' triangles (system/pylons.ts), after the turbines', tagged PYLON | its index — its entry in its table: (foot
   *  x, y, z, height), (the line's bearing, 0, 0, 0) */
  pylons: { positions: number[]; triangles: number[]; foot: [number, number, number]; h: number; along: number }[] = [],
  /** (Q8 D1) the conductors' ribbons (system/pylons.ts cableMesh: pairs of vertices), tagged CABLE_TAG, each pair from an even
   *  vertex (one vertex of padding before them when needed) */
  cables: { positions: number[]; triangles: number[] }[] = [],
  /** (Q8 D1) the cars (system/traffic.ts): each the shared car mesh, its body's, headlights' and tail lights' triangles tagged
   *  CAR_BODY / CAR_HEAD / CAR_TAIL | its index, from a vertex index ≡ 0 mod 4 (padding before them); its entry (start, speed),
   *  (end, phase) after the pylons' */
  cars: { start: [number, number, number]; end: [number, number, number]; speed: number; phase: number }[] = [],
  /** (Q8 L10) the streets' lamps (system/streetlamps.ts lampMesh: eight vertices, from a vertex index ≡ 0 mod 4), their pole's
   *  triangles tagged LAMP_POLE, their head's LAMP_HEAD; and their light's grid (LAMP_GRID's bytes) after the decals' far grid,
   *  its side and texel in the palette's unused entry 0 (0: none) */
  lamps: { positions: number[]; triangles: number[] }[] = [],
  lampGrid?: Uint8Array,
) {
  const car = cars.length ? carMesh() : { positions: [], triangles: [] };
  const { nodes, geometries, offsets } = sceneryBVH(prims);
  const surface = sceneryBVH(surfaces);
  // (the water's tree: the surfaces' own records, a large polygon's bands — waterBands — appended after them)
  const placed = new Map(surface.offsets);
  const bands: number[] = [];
  const leaves: Primitive[] = [];
  for (const p of surfaces.filter(isWater)) {
    const parts = p.data[11]! > 0.5 ? waterBands(p) : [p];
    if (parts.length === 1 && parts[0] === p) {
      leaves.push(p);
      continue;
    }
    for (const b of parts) {
      placed.set(b, (surface.geometries.length + bands.length) / 4);
      for (const v of b.data) bands.push(v);
      leaves.push(b);
    }
  }
  const water = sceneryBVH(leaves, placed);
  const nodeCount = nodes.length / 8,
    geomOffset = 4 + nodes.length / 4,
    surfaceOffset = geomOffset + geometries.length / 4,
    surfaceGeom = surfaceOffset + surface.nodes.length / 4,
    waterOffset = surfaceGeom + (surface.geometries.length + bands.length) / 4,
    pixelOffset = waterOffset + water.nodes.length / 4,
    // (Q3 B4: the decals right after the land cover's raster — its offset its end's: no header slot moved —: a vec4 of their
    // grids' sides and texels, the palette's 256, the near grid's bytes, the far's)
    decalOffset = pixelOffset + Math.ceil(pixels.length / 4),
    decalVec4s = decals
      ? 1 + 256 + Math.ceil(decals.near.length / 16) + Math.ceil(decals.far.length / 16) + (lampGrid ? Math.ceil(lampGrid.length / 16) : 0)
      : 1,
    forestOffset = decalOffset + decalVec4s;
  // (the buildings' triangles first — the view draws them alone —, the rest's — a bridge's deck — after: the shadow map's too)
  const meshed = [...prims.filter((p) => p.mesh && p.data[3] === 1), ...prims.filter((p) => p.mesh && p.data[3] !== 1)];
  let vertexCount = 0,
    triangleCount = 0,
    buildingTriangles = 0;
  for (const p of meshed) {
    vertexCount += p.mesh!.positions.length / 3;
    triangleCount += p.mesh!.triangles.length / 3;
    if (p.data[3] === 1) buildingTriangles += p.mesh!.triangles.length / 3;
  }
  for (const m of [...turbines, ...pylons]) {
    vertexCount += m.positions.length / 3;
    triangleCount += m.triangles.length / 3;
  }
  const cablePad = cables.length ? vertexCount % 2 : 0;
  vertexCount += cablePad;
  for (const m of cables) {
    vertexCount += m.positions.length / 3;
    triangleCount += m.triangles.length / 3;
  }
  const carPad = cars.length ? (4 - (vertexCount % 4)) % 4 : 0;
  vertexCount += carPad + cars.length * (car.positions.length / 3);
  triangleCount += cars.length * (car.triangles.length / 3);
  const lampPad = lamps.length ? (4 - (vertexCount % 4)) % 4 : 0;
  vertexCount += lampPad + lamps.length * 8;
  triangleCount += lamps.length * 4;
  const meshOffset = forestOffset + (forest ? forestVec4s(forest.frame) : 0),
    triangleOffset = meshOffset + Math.ceil((vertexCount * 3) / 4);
  // (after the triangles, a tag a triangle: a building triangle's leaf — its record's offset from geomOffset [vec4] —: the raster
  // writes it in its visibility, shadeLite finds the building there, its walls' and roof's material — Q3, C0-10 —; a bridge's 0;
  // a wind turbine's TURBINE_TAG — Q8 D1)
  // (then a header (turbines, pylons, 0, 0), three vec4 a turbine, two a pylon — Q8 D1)
  const bytes = (triangleOffset + triangleCount + 1 + 3 * turbines.length + 2 * pylons.length + 2 * cars.length) * 16;
  if (bytes > budget) throw new Error("scenery budget exceeded");
  const buffer = new ArrayBuffer(bytes),
    f = new Float32Array(buffer),
    u = new Uint32Array(buffer);
  f.set([nodeCount, geomOffset, pixelOffset, grid], 0);
  f.set([surfaceOffset, surface.nodes.length / 8, surfaceGeom, surfaces.length], 4);
  f[9] = waterOffset;
  f[10] = water.nodes.length / 8;
  if (forest) {
    f[8] = forestOffset;
    writeForest(f, u, forestOffset, forest.frame, forest.cells, forest.trees);
  }
  f.set(nodes, 16);
  f.set(geometries, geomOffset * 4);
  f.set(surface.nodes, surfaceOffset * 4);
  f.set(surface.geometries, surfaceGeom * 4);
  f.set(bands, surfaceGeom * 4 + surface.geometries.length);
  f.set(water.nodes, waterOffset * 4);
  u.set(pixels, pixelOffset * 4);
  if (decals) {
    const nN = Math.round(Math.sqrt(decals.near.length)),
      fN = Math.round(Math.sqrt(decals.far.length));
    f.set([nN, (2 * DECAL_NEAR.half) / nN, fN, (2 * DECAL_FAR.half) / fN], decalOffset * 4);
    f.set(decals.palette, (decalOffset + 1) * 4);
    const b = new Uint8Array(buffer);
    b.set(decals.near, (decalOffset + 257) * 16);
    b.set(decals.far, (decalOffset + 257 + Math.ceil(decals.near.length / 16)) * 16);
    if (lampGrid) {
      const lN = Math.round(Math.sqrt(lampGrid.length));
      f.set([lN, (2 * LAMP_GRID.half) / lN, 0, 0], (decalOffset + 1) * 4);
      b.set(lampGrid, (decalOffset + 257 + Math.ceil(decals.near.length / 16) + Math.ceil(decals.far.length / 16)) * 16);
    }
  }
  if (triangleCount) {
    f.set([meshOffset, vertexCount, triangleOffset, buildingTriangles], 12);
    f[11] = triangleCount;
    let v = 0,
      t = triangleOffset * 4;
    let tag = triangleOffset * 4 + triangleCount * 3;
    for (const p of meshed) {
      if (!p.mesh) continue;
      f.set(p.mesh.positions, meshOffset * 4 + v * 3);
      for (const k of p.mesh.triangles) u[t++] = v + k;
      v += p.mesh.positions.length / 3;
      u.fill(p.data[3] === 1 ? (offsets.get(p) ?? 0) : 0, tag, (tag += p.mesh.triangles.length / 3));
    }
    turbines.forEach((m, i) => {
      f.set(m.positions, meshOffset * 4 + v * 3);
      for (const k of m.triangles) u[t++] = v + k;
      v += m.positions.length / 3;
      const n = m.triangles.length / 3,
        b = Math.min(m.blades ?? 0, n),
        h = Math.min(m.head ?? 0, n - b),
        l = Math.min(m.lamp ?? 0, n - b - h);
      u.fill(TURBINE_TAG, tag, (tag += n - b - h - l));
      u.fill((TURBINE_LAMP | i) >>> 0, tag, (tag += l));
      u.fill((TURBINE_HEAD | i) >>> 0, tag, (tag += h));
      u.fill((TURBINE_BLADE | i) >>> 0, tag, (tag += b));
      const at = (triangleOffset + triangleCount + 1 + 3 * i) * 4;
      f.set([...(m.hub ?? [0, 0, 0]), m.omega ?? 0, ...(m.axis ?? [1, 0, 0]), m.phase ?? 0, ...(m.tower ?? [0, 0]), m.lampZ ?? 0, 0], at);
    });
    pylons.forEach((m, i) => {
      f.set(m.positions, meshOffset * 4 + v * 3);
      for (const k of m.triangles) u[t++] = v + k;
      v += m.positions.length / 3;
      u.fill((PYLON_TAG | i) >>> 0, tag, (tag += m.triangles.length / 3));
      f.set([...m.foot, m.h, m.along, 0, 0, 0], (triangleOffset + triangleCount + 1 + 3 * turbines.length + 2 * i) * 4);
    });
    v += cablePad;
    for (const m of cables) {
      f.set(m.positions, meshOffset * 4 + v * 3);
      for (const k of m.triangles) u[t++] = v + k;
      v += m.positions.length / 3;
      u.fill(CABLE_TAG, tag, (tag += m.triangles.length / 3));
    }
    v += carPad;
    const carTris = car.triangles.length / 3;
    cars.forEach((c, i) => {
      f.set(car.positions, meshOffset * 4 + v * 3);
      for (const k of car.triangles) u[t++] = v + k;
      v += car.positions.length / 3;
      u.fill((CAR_BODY | i) >>> 0, tag, (tag += 12));
      u.fill((CAR_HEAD | i) >>> 0, tag, (tag += 4));
      u.fill((CAR_TAIL | i) >>> 0, tag, (tag += carTris - 16));
      f.set(
        [...c.start, c.speed, ...c.end, c.phase],
        (triangleOffset + triangleCount + 1 + 3 * turbines.length + 2 * pylons.length + 2 * i) * 4,
      );
    });
    v += lampPad;
    lamps.forEach((m, i) => {
      f.set(m.positions, meshOffset * 4 + v * 3);
      for (const k of m.triangles) u[t++] = v + k;
      v += 8;
      u.fill((LAMP_POLE | i) >>> 0, tag, (tag += 2));
      u.fill((LAMP_HEAD | i) >>> 0, tag, (tag += 2));
    });
    f.set([turbines.length, pylons.length, cars.length, lamps.length], (triangleOffset + triangleCount) * 4);
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
  /** (Q8 L10) the streets' lamps and their light's grid (settings.earthStreetLamps; absent: on) */
  lamps?: boolean;
  /** the camera's place when asked [°: latitude, longitude] — the centre is led along the view, up to a few km ahead: the
   *  buildings' triangles and parts made round the camera too, nearest first (not only round the centre: the ones under
   *  the craft were left boxes) */
  eye?: [number, number];
  /** a first, nearer scene — its box this share of the reach's (QUICK_SHARE) — while none drawn covers the camera: the full one
   *  asked right after it (scenery.ts) */
  quick?: number;
  /** the Service Worker controls the page: the Géoplateforme's budget its (sw.ts) — the survey's own gate opened */
  swGate?: boolean;
  /** the survey's trees kept off the footprints of the buildings the cap left out too, not only the kept ones' (the
   *  scenery's `clearCut`, off by default — PROBLEMES-A-REGLER, 12 Nov 2026) */
  clearCut?: boolean;
}
/** the worker's progress through a scene, posted as it goes (the loading status's: ui — data meter): the last step ended,
 *  and in the buildings' step the BD TOPO's or Overture's tiles in and wanted */
export interface SceneryProgress {
  step: "start" | "cover" | "osm" | "buildings" | "forest" | "pack";
  done?: number;
  of?: number;
}
export interface SceneryReply {
  id: number;
  /** a progress message (not the scene): the step now */
  progress?: SceneryProgress;
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
  /** the buildings the cap left out (the nearest the centre kept), the farthest kept one's distance from the centre [m]
   *  (0: none cut); with `clearCut`, the survey's tree candidates their footprints refused and the time their grid took [ms] */
  cutBuildings?: number;
  keptReachM?: number;
  clearedTrees?: number;
  cutHousesMs?: number;
  /** the request's clearCut, as this scene was made */
  clearCut?: boolean;
  /** of the buildings, the IGN's BD TOPO's over France (I5, bdtopo.ts); its tiles taken */
  bdtopoBuildings?: number;
  bdtopoTiles?: number;
  /** of the buildings, Overture Maps' (B7); its z 14 tiles read */
  overtureBuildings?: number;
  overtureTiles?: number;
  /** (Q8 D1) the wind turbines drawn */
  turbines?: number;
  /** (Q8 D1) the high-voltage pylons drawn */
  pylons?: number;
  /** (Q8 D1) the spans of conductors drawn */
  cables?: number;
  /** (Q8 D1) the cars on the main roads */
  cars?: number;
  /** (Q8 D1) the main roads' lines the traffic read, their pieces */
  trafficRoads?: number;
  /** (Q8 L10) the streets' lamps */
  lamps?: number;
  /** (Q8 D1) the vineyards' and orchards' polygons drawn as rows */
  rowCrops?: number;
  roadPieces?: number;
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
  /** each step's end from the start [ms] (cover, osm, bdtopo, overture, forest, …): where the scene's time goes (T8) */
  phases?: Record<string, number>;
  /** (T8m) the worker's network answers kept from scene to scene: its hits and misses so far, the bytes kept */
  fetchCache?: { hits: number; misses: number; hitBytes: number; bytes: number };
  errors?: string[];
  budgetLimited?: boolean;
  error?: string;
}
