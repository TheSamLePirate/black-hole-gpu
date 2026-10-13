// Procedural forests: every tree of a world-fixed grid, made where the scenery says trees grow.
//
// The grid's cells are FOREST_CELL metres in Web Mercator, in latitude bands FOREST_BAND° high (the cell's
// Mercator size fixed per band, so a cell is FOREST_CELL m on the ground at the band's middle). A cell holds at
// most one tree, its place in the cell and its size drawn from the cell's global index (forestHash): the
// same tree at the same place whichever scenery holds it — a rebuild moves it only by what the frames'
// affine maps (exact at their origins) and tangent planes miss: < 8 cm within 400 m, < 25 cm at a kilometre —
// within a band: a scenery whose centre crosses a band's edge (every 445 km north–south) lays its trees anew.
//
// The worker (scenery-worker.ts) decides each cell's tree — its kind from the land cover and the climate,
// its height, its ground — and packs one u32 a cell, a coarse block grid (the lowest ground and the highest
// crown of 8 × 8 cells, dilated by one: what a ray may skip), the frame's affine maps and the kinds' table
// into the scenery buffer (forestSection). The tracer (shaders/forest.wgsl) walks the grid's dual cells: a
// crown never reaches more than half a cell beyond its own, so each dual cell's candidates are the 2 × 2 cells
// round its vertex — exact, four trees a step. This file is the TypeScript twin of forest.wgsl: the same
// hash, the same decoding, the same shapes (the collisions, the tests).

import type { Vec3 } from "../physics";

/** a cell's side on the ground [m] at its band's middle latitude */
export const FOREST_CELL = 7;
/** the steepest ground a tree grows on (rise over run: 1.2 ≈ 50°) — steeper, rock */
export const FOREST_MAX_SLOPE = 1.2;
/** cells a block's side (the empty space a ray skips) */
export const FOREST_BLOCK = 8;
/** the latitude bands' height [°] (a band's cells share one Mercator size) */
export const FOREST_BAND = 4;
/** the ground under a trunk sunk this deep [m] (the tracer's relief and the worker's grid differ by less) */
export const FOREST_SINK = 1;
const R = 6378137;
const Z_OFFSET = 20000;
const Z_MASK = 0x3fffff;

export const ForestKind = { none: 0, broadleaf: 1, conifer: 2, pine: 3, palm: 4, shrub: 5, columnar: 6 } as const;
export type ForestKind = (typeof ForestKind)[keyof typeof ForestKind];
export const FOREST_KINDS = 7;

/**
 * A kind's shape and colour, as fractions of the tree's height H and crown radius r (r ≤ half a cell):
 * - `cone`: a cone from `crown` × H (its base, radius `width` × r) to the top; else an ellipsoid centred at
 *   `crown` × H, radii `width` × r across and `depth` × H up;
 * - a trunk from the ground to `trunk` × H, radius `bark0` + `barkH` × H (none when `trunk` is 0);
 * - the leaves' albedo (linear) and their share of the satellite's colour, the bark's albedo;
 * - near, the leaves' carving (forest.wgsl forestCarved): clumps `clump` × r deep at most, `grain` metres
 *   across, a conifer's branch tiers `tiers` metres apart (0: none). Far, the plain shape shrunk by half
 *   the carving, its mean.
 */
export interface KindShape {
  cone: boolean;
  crown: number;
  width: number;
  depth: number;
  trunk: number;
  bark0: number;
  barkH: number;
  leaf: Vec3;
  tint: number;
  bark: Vec3;
  clump: number;
  grain: number;
  tiers: number;
  /** its leaves fall in the autumn (outside the tropics): 1, 0 evergreen, between: some of them */
  deciduous: number;
}
export const KIND_SHAPES: KindShape[] = [
  // (none)
  {
    cone: false,
    crown: 0,
    width: 0,
    depth: 0,
    trunk: 0,
    bark0: 0,
    barkH: 0,
    leaf: [0, 0, 0],
    tint: 0,
    bark: [0, 0, 0],
    clump: 0,
    grain: 1,
    tiers: 0,
    deciduous: 0,
  },
  // broadleaf: an oak, a beech — a round crown on a short trunk
  {
    cone: false,
    crown: 0.62,
    width: 1,
    depth: 0.34,
    trunk: 0.5,
    bark0: 0.08,
    barkH: 0.012,
    leaf: [0.05, 0.09, 0.03],
    tint: 0.6,
    bark: [0.09, 0.075, 0.06],
    clump: 0.3,
    grain: 1.4,
    tiers: 0,
    deciduous: 1,
  },
  // conifer: a spruce, a fir — a cone from low on the trunk
  {
    cone: true,
    crown: 0.1,
    width: 0.8,
    depth: 0,
    trunk: 0.2,
    bark0: 0.06,
    barkH: 0.01,
    leaf: [0.025, 0.05, 0.03],
    tint: 0.45,
    bark: [0.08, 0.06, 0.045],
    clump: 0.32,
    grain: 0.9,
    tiers: 1.1,
    deciduous: 0,
  },
  // pine: a Scots or stone pine — a flat crown high on a bare trunk
  {
    cone: false,
    crown: 0.8,
    width: 1,
    depth: 0.17,
    trunk: 0.78,
    bark0: 0.07,
    barkH: 0.01,
    leaf: [0.035, 0.06, 0.03],
    tint: 0.5,
    bark: [0.13, 0.08, 0.05],
    clump: 0.35,
    grain: 1.2,
    tiers: 0,
    deciduous: 0,
  },
  // palm: a thin stem, a flat head of fronds
  {
    cone: false,
    crown: 0.91,
    width: 0.85,
    depth: 0.09,
    trunk: 0.92,
    bark0: 0.16,
    barkH: 0,
    leaf: [0.06, 0.1, 0.035],
    tint: 0.5,
    bark: [0.16, 0.13, 0.1],
    clump: 0.4,
    grain: 0.8,
    tiers: 0,
    deciduous: 0,
  },
  // shrub, mangrove: a low dome to the ground
  {
    cone: false,
    crown: 0.45,
    width: 1,
    depth: 0.5,
    trunk: 0,
    bark0: 0,
    barkH: 0,
    leaf: [0.045, 0.07, 0.03],
    tint: 0.65,
    bark: [0, 0, 0],
    clump: 0.25,
    grain: 0.8,
    tiers: 0,
    deciduous: 0.4,
  },
  // columnar: a poplar, a cypress — a narrow spindle
  {
    cone: false,
    crown: 0.54,
    width: 0.42,
    depth: 0.46,
    trunk: 0.2,
    bark0: 0.06,
    barkH: 0.01,
    leaf: [0.03, 0.065, 0.03],
    tint: 0.5,
    bark: [0.1, 0.085, 0.07],
    clump: 0.18,
    grain: 0.9,
    tiers: 0,
    deciduous: 1,
  },
];

// ---- the hash (bit for bit forest.wgsl's)
export function forestPcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
export function forestHash(i: number, j: number, k: number): number {
  return forestPcg((Math.imul(i >>> 0, 1597334677) ^ forestPcg((Math.imul(j >>> 0, 3812015801) ^ k) >>> 0)) >>> 0);
}
/** a hash as a float in [0, 1), as the GPU's f32 conversion rounds it */
export const forestUnit = (h: number) => Math.fround(h) / 4294967296;

// ---- a cell's word: its ground (22 bits: cm above −20 km), its kind (4), its height's code (6)
export function packCell(z: number, kind: ForestKind, height: number): number {
  if (kind === ForestKind.none) return 0;
  const zc = Math.max(0, Math.min(Z_MASK, Math.round((z + Z_OFFSET) * 100)));
  const code = Math.max(0, Math.min(63, Math.round((height - 2) * 2)));
  return (zc | (kind << 22) | (code << 26)) >>> 0;
}
export function unpackCell(word: number): { z: number; kind: ForestKind; height: number } {
  return { z: (word & Z_MASK) / 100 - Z_OFFSET, kind: ((word >>> 22) & 15) as ForestKind, height: 2 + (word >>> 26) * 0.5 };
}

// ---- the grid
/** the band's middle latitude [°] */
export const forestBand = (lat: number) => (Math.floor(lat / FOREST_BAND) + 0.5) * FOREST_BAND;
/** the cells round the world in the band (a whole number: the grid closes on itself) */
export const forestColumns = (lat: number) =>
  Math.max(1, Math.round((2 * Math.PI * R * Math.cos((forestBand(lat) * Math.PI) / 180)) / FOREST_CELL));
/** a place's global cell coordinates (x eastwards from the antimeridian, y northwards), longitude unwrapped
 *  about `lon0` so an area across the antimeridian stays continuous */
export function forestCellOf(lat: number, lon: number, columns: number, lon0 = lon): [number, number] {
  const g = (2 * Math.PI * R) / columns;
  const dl = ((((lon - lon0 + 180) % 360) + 360) % 360) - 180;
  const x = (R * (((lon0 + dl + 180) * Math.PI) / 180)) / g;
  const y = (R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / g;
  return [x, y];
}
/** the place of global cell coordinates [°] */
export function forestPlaceOf(x: number, y: number, columns: number): [number, number] {
  const g = (2 * Math.PI * R) / columns;
  const lat = ((2 * Math.atan(Math.exp((y * g) / R)) - Math.PI / 2) * 180) / Math.PI;
  const lon = ((x * g) / R) * (180 / Math.PI) - 180;
  return [lat, lon];
}

/**
 * The frame's grid: the cells [i0, i0 + w) × [j0, j0 + h) round the scenery's origin, and the affine maps
 * between the frame's east/north metres and those cells' coordinates less (i0, j0) — the Mercator map's
 * tangent at the origin (`local` the scenery's own: lat, lon [°] → frame metres).
 */
export interface ForestFrame {
  i0: number;
  j0: number;
  w: number;
  h: number;
  columns: number;
  /** a cell's smaller side on the ground here [m] (a crown's radius stays under half of it) */
  cell: number;
  /** cell coordinates of frame metres: u = a0 + a1 x + a2 y, v = b0 + b1 x + b2 y */
  a: [number, number, number];
  b: [number, number, number];
  /** frame metres of cell coordinates: x = c0 + c1 u + c2 v, y = d0 + d1 u + d2 v */
  c: [number, number, number];
  d: [number, number, number];
  /** trees drawn within this distance of the origin [m] */
  reach: number;
}
/** the forests' last latitude [°] (the taiga's northernmost, ~72.5° N): beyond, no grid at all — the cells
 *  shrinking towards the poles would take the scenery's budget for nothing */
export const FOREST_MAX_LAT = 73;
export function forestFrame(lat0: number, lon0: number, reach: number, local: (lat: number, lon: number) => Vec3): ForestFrame {
  if (Math.abs(lat0) > FOREST_MAX_LAT) reach = 0;
  const columns = forestColumns(lat0);
  const [x0, y0] = forestCellOf(lat0, lon0, columns, lon0);
  // (the tangent: cell coordinates of the frame's metres a few metres out, differenced)
  const s = 10 / FOREST_CELL;
  const pe = forestPlaceOf(x0 + s, y0, columns),
    pn = forestPlaceOf(x0, y0 + s, columns);
  const o = local(lat0, lon0),
    e = local(pe[0], pe[1]),
    n = local(pn[0], pn[1]);
  // J: metres per cell along u and v (columns of the cell → metres map)
  const ju = [(e[0] - o[0]) / s, (e[1] - o[1]) / s],
    jv = [(n[0] - o[0]) / s, (n[1] - o[1]) / s];
  const det = ju[0]! * jv[1]! - jv[0]! * ju[1]!;
  const cells = Math.ceil(reach / Math.min(Math.hypot(ju[0]!, ju[1]!), Math.hypot(jv[0]!, jv[1]!))) + 2;
  const i0 = Math.floor(x0) - cells,
    j0 = Math.floor(y0) - cells;
  const u0 = x0 - i0,
    v0 = y0 - j0;
  // metres → cells: the inverse of J, about the origin's (u0, v0) at the frame's (o.x, o.y)
  const a1 = jv[1]! / det,
    a2 = -jv[0]! / det,
    b1 = -ju[1]! / det,
    b2 = ju[0]! / det;
  return {
    i0,
    j0,
    w: 2 * cells,
    h: 2 * cells,
    columns,
    cell: Math.min(Math.hypot(ju[0]!, ju[1]!), Math.hypot(jv[0]!, jv[1]!)),
    a: [u0 - a1 * o[0] - a2 * o[1], a1, a2],
    b: [v0 - b1 * o[0] - b2 * o[1], b1, b2],
    c: [o[0] - ju[0]! * u0 - jv[0]! * v0, ju[0]!, jv[0]!],
    d: [o[1] - ju[1]! * u0 - jv[1]! * v0, ju[1]!, jv[1]!],
    reach,
  };
}

/** A tree as drawn: its kind, the foot of its trunk (frame metres), its height and its crown's radius [m]. */
export interface ForestTree {
  kind: ForestKind;
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
  /** its own number in [0, 1) (the shade's variation) */
  seed: number;
}
/** where in its cell a cell's tree stands (fractions), and its size's draw */
export function forestJitter(gi: number, gj: number): [number, number, number] {
  return [
    0.12 + 0.76 * forestUnit(forestHash(gi, gj, 1)),
    0.12 + 0.76 * forestUnit(forestHash(gi, gj, 2)),
    forestUnit(forestHash(gi, gj, 3)),
  ];
}
/** the global column of a frame's cell (the grid closes round the world) */
export const forestColumn = (f: ForestFrame, i: number) => ((((f.i0 + i) % f.columns) + f.columns) % f.columns) | 0;
/** cell (i, j) of the frame's grid: its tree, or null */
export function forestTree(f: ForestFrame, word: number, i: number, j: number): ForestTree | null {
  const c = unpackCell(word);
  if (c.kind === ForestKind.none) return null;
  const [jx, jy, size] = forestJitter(forestColumn(f, i), f.j0 + j);
  const u = i + jx,
    v = j + jy;
  return {
    kind: c.kind,
    x: f.c[0] + f.c[1] * u + f.c[2] * v,
    y: f.d[0] + f.d[1] * u + f.d[2] * v,
    z: c.z,
    height: c.height,
    radius: f.cell * (0.3 + 0.17 * size),
    seed: forestUnit(forestHash(forestColumn(f, i), f.j0 + j, 4)),
  };
}
/** a tree's trunk: its radius and top [m] (radius 0: none) */
export function trunkOf(t: ForestTree): { radius: number; top: number } {
  const k = KIND_SHAPES[t.kind]!;
  return k.trunk > 0 ? { radius: k.bark0 + k.barkH * t.height, top: t.z + k.trunk * t.height } : { radius: 0, top: t.z };
}
/** A tree's crown as the tracer draws it plain: a cone (apex, base radius, height) or an ellipsoid (centre,
 *  radii) — near, the bound the leaves carve inwards; far, shrunk by half the carving (forest.wgsl), deeper
 *  for a bare deciduous crown (`bare`: the season's, 0 … 1). */
export function crownOf(t: ForestTree, near = false, bare = 0): { cone: boolean; c: Vec3; r: Vec3 } {
  const k = KIND_SHAPES[t.kind]!;
  // (the carving's depth: the leaves' clumps, and a deciduous crown's bareness in winter — forest.wgsl's amp)
  const shrink = near ? 0 : 0.5 * (k.clump + 0.55 * k.deciduous * bare) * t.radius;
  return k.cone
    ? { cone: true, c: [t.x, t.y, t.z + t.height], r: [k.width * t.radius - shrink, t.height * (1 - k.crown), 0] }
    : {
        cone: false,
        c: [t.x, t.y, t.z + k.crown * t.height],
        r: [k.width * t.radius - shrink, k.width * t.radius - shrink, k.depth * t.height - shrink],
      };
}

// ---- what grows where
/** The share of a land cover's cells holding a tree (ESA WorldCover: 10 trees, 95 mangroves, 20 shrubs,
 *  90 wetland, 30 grassland — its lone trees). */
/** a forest's cells holding a tree or, in its gaps, a shrub (the rest open ground) */
export const FOREST_UNDERSTORY = 0.96;
export function forestDensity(cls: number): number {
  return cls === 10 ? 0.86 : cls === 95 ? 0.8 : cls === 20 ? 0.22 : cls === 90 ? 0.12 : cls === 30 ? 0.025 : 0;
}
/**
 * A cell's tree from its land cover (ESA WorldCover's class), its latitude and altitude, and two draws in
 * [0, 1): whether one stands (the class's density) and which kind (the climate's mix). Climate zones are
 * broad (Köppen simplified by latitude and altitude); the canopy-height data (PLAN A2) refines heights.
 */
/** The tree line [m] at a latitude [°]: ~4 000 m in the tropics, ~2 100 m in the Alps, ~900 m in southern
 *  Norway, sea level beyond the Arctic's forests. */
export function treeline(lat: number): number {
  const a = Math.abs(lat);
  return a <= 20 ? 4000 : a <= 46 ? 4000 - ((a - 20) * 1900) / 26 : a <= 60 ? 2100 - (a - 46) * 86 : Math.max(0, 900 - (a - 60) * 60);
}
export function forestKind(cls: number, lat: number, altitude: number, present: number, pick: number): ForestKind {
  // (a forest's gaps: most of them its understory — shrubs, young trees —, a few left open)
  if (cls === 10 && present >= forestDensity(cls) && present < FOREST_UNDERSTORY && altitude <= treeline(lat) + 150)
    return ForestKind.shrub;
  if (present >= forestDensity(cls)) return ForestKind.none;
  if (cls === 95 || cls === 20) return ForestKind.shrub;
  const a = Math.abs(lat);
  const line = treeline(lat);
  if (altitude > line + 150) return ForestKind.none;
  const high = altitude > line - 600 ? 1 : altitude > line - 1100 ? 0.6 : 0;
  if (a < 23.5) return altitude < 250 && pick < 0.15 ? ForestKind.palm : high > 0.5 ? ForestKind.conifer : ForestKind.broadleaf;
  if (a < 35) return pick < 0.45 ? ForestKind.broadleaf : pick < 0.85 ? ForestKind.pine : ForestKind.columnar;
  if (a < 45 && altitude < 800) return pick < 0.55 ? ForestKind.broadleaf : pick < 0.88 ? ForestKind.pine : ForestKind.columnar;
  if (a < 58) {
    const conifers = Math.max(0.3, high * 0.95);
    return pick < conifers ? ForestKind.conifer : pick < conifers + 0.05 ? ForestKind.columnar : ForestKind.broadleaf;
  }
  return pick < 0.8 ? ForestKind.conifer : ForestKind.broadleaf;
}
/** A tree's height [m] from its kind, the place and a draw in [0, 1) (lower towards the tree line, taller in the tropics). */
export function forestHeight(kind: ForestKind, lat: number, altitude: number, draw: number): number {
  const [lo, hi] =
    kind === ForestKind.broadleaf
      ? Math.abs(lat) < 23.5
        ? [18, 34]
        : [12, 26]
      : kind === ForestKind.conifer
        ? [14, 31]
        : kind === ForestKind.pine
          ? [10, 21]
          : kind === ForestKind.palm
            ? [8, 18]
            : kind === ForestKind.shrub
              ? [2, 6]
              : [12, 24];
  const stunted = kind === ForestKind.shrub ? 1 : Math.max(0.35, Math.min(1, (treeline(lat) + 150 - altitude) / 900));
  return Math.max(2, (lo + (hi - lo) * draw) * stunted);
}

// ---- the packed section (scenery-data.ts places it; forest.wgsl reads it)
/** vec4s before the cells: the header (7), then four per kind (shape, trunk, colours, carving) */
export const FOREST_HEADER = 7 + 4 * FOREST_KINDS;
export const forestBlocks = (f: ForestFrame) => [Math.ceil((f.w + 1) / FOREST_BLOCK), Math.ceil((f.h + 1) / FOREST_BLOCK)] as const;
/** the section's size in vec4s */
export function forestVec4s(f: ForestFrame): number {
  const [bw, bh] = forestBlocks(f);
  return FOREST_HEADER + Math.ceil((f.w * f.h) / 4) + Math.ceil((bw * bh) / 2);
}
/**
 * The lowest ground and highest crown a ray may meet in each block of dual cells (8 × 8, the dual cell
 * (p, q) round the vertex between cells p − 1, p and q − 1, q): +∞, −∞ where it holds no tree.
 */
export function forestBlockBounds(f: ForestFrame, cells: Uint32Array): Float32Array {
  const [bw, bh] = forestBlocks(f);
  const out = new Float32Array(bw * bh * 2);
  for (let k = 0; k < bw * bh; k++) out.set([Infinity, -Infinity], k * 2);
  for (let j = 0; j < f.h; j++)
    for (let i = 0; i < f.w; i++) {
      const word = cells[j * f.w + i]!;
      if (!word) continue;
      const c = unpackCell(word);
      const lo = c.z - FOREST_SINK,
        hi = c.z + c.height;
      // (the cell is a candidate of dual cells p ∈ {i, i + 1}, q ∈ {j, j + 1})
      for (let q = j; q <= j + 1; q++)
        for (let p = i; p <= i + 1; p++) {
          const k = (Math.floor(q / FOREST_BLOCK) * bw + Math.floor(p / FOREST_BLOCK)) * 2;
          if (lo < out[k]!) out[k] = lo;
          if (hi > out[k + 1]!) out[k + 1] = hi;
        }
    }
  return out;
}
/**
 * Writes the section at vec4 `at` of the buffer (f, u: its float and word views; offsets in the header are
 * absolute vec4 indices): header, kinds' table, cells, blocks.
 *   +0 (w, h, blocks across, blocks down)   +1 (cells at, blocks at, cell [m], columns)
 *   +2 (a0, a1, a2, —) +3 (b0, b1, b2, —) +4 (c0, c1, c2, —) +5 (d0, d1, d2, —)
 *   +6 (i0, j0 as i32 bits, trees, reach [m])
 *   +7 + 4k: kind k — (cone, crown, width, depth), (trunk, bark0, barkH, tint), (leaf r, g, b, bark rgb10
 *            bits), (clump, grain, tiers, deciduous); kind 0's first: the season (fresh, autumn, bare, snow line)
 *            — rewritten as the date moves (forestKindTable)
 */
export function writeForest(fv: Float32Array, uv: Uint32Array, at: number, f: ForestFrame, cells: Uint32Array, trees: number) {
  const [bw, bh] = forestBlocks(f);
  const cellsAt = at + FOREST_HEADER,
    blocksAt = cellsAt + Math.ceil((f.w * f.h) / 4);
  const o = at * 4;
  fv.set([f.w, f.h, bw, bh, cellsAt, blocksAt, f.cell, f.columns, ...f.a, 0, ...f.b, 0, ...f.c, 0, ...f.d, 0], o);
  const ints = new Int32Array(fv.buffer, fv.byteOffset + (o + 24) * 4, 2);
  ints[0] = f.i0;
  ints[1] = f.j0;
  fv.set([trees, f.reach], o + 26);
  fv.set(forestKindTable(SUMMER), o + 28);
  uv.set(cells, cellsAt * 4);
  fv.set(
    forestBlockBounds(f, cells).map((v) => (Number.isFinite(v) ? v : v > 0 ? 3e38 : -3e38)),
    blocksAt * 4,
  );
}
// ---- the seasons
/** The forest's season at a place: the spring's fresh leaves, the autumn's colours, the deciduous crowns'
 *  bareness (0 … 1, nil in the tropics), and the altitude above which the evergreens carry snow [m]. */
export interface ForestSeason {
  fresh: number;
  autumn: number;
  bare: number;
  snowLine: number;
}
export const SUMMER: ForestSeason = { fresh: 0, autumn: 0, bare: 0, snowLine: 9000 };
const bell = (x: number) => Math.exp(-x * x);
const ramp = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
export function forestSeason(utcMs: number, lat: number): ForestSeason {
  const start = Date.UTC(new Date(utcMs).getUTCFullYear(), 0, 1);
  // (the day as the northern hemisphere's: the south half a year on)
  const d = ((((utcMs - start) / 86400000 + (lat < 0 ? 182.6 : 0)) % 365.25) + 365.25) % 365.25;
  const a = Math.abs(lat);
  // (deciduous forests outside the tropics; the seasons come earlier in autumn, later in spring, polewards)
  const temperate = ramp(18, 30, a);
  const shift = (a - 45) * 1.5;
  const leafOut = 112 + shift,
    colours = 288 - shift;
  const fresh = temperate * bell((d - (leafOut + 15)) / 18);
  const autumn = temperate * bell((d - colours) / 17);
  const fallen = d > colours ? ramp(colours + 8, colours + 32, d) : 1 - ramp(leafOut - 12, leafOut + 6, d);
  const bare = temperate * fallen;
  // the snow line on the trees: lowest in mid-January, gone by late spring (a mountain's winter)
  const winter = Math.max(0, Math.cos(((d - 15) / 365.25) * 2 * Math.PI));
  const winterLine = Math.max(0, 1800 - Math.max(0, a - 35) * 90);
  const snowLine = winterLine + (9000 - winterLine) * (1 - ramp(0.25, 0.75, winter));
  return { fresh, autumn, bare, snowLine };
}
/** The kinds' table for a season (the section's +7 onwards: four vec4s a kind; kind 0's first the season's) */
export function forestKindTable(season: ForestSeason): Float32Array<ArrayBuffer> {
  const out = new Float32Array(FOREST_KINDS * 16);
  for (let k = 0; k < FOREST_KINDS; k++) {
    const s = KIND_SHAPES[k]!;
    // (the spring's young leaves: lighter, yellower)
    const f = season.fresh * s.deciduous;
    const leaf: Vec3 = [s.leaf[0] * (1 + 0.6 * f), s.leaf[1] * (1 + 0.45 * f), s.leaf[2] * (1 - 0.2 * f)];
    out.set(
      [
        s.cone ? 1 : 0,
        s.crown,
        s.width,
        s.depth,
        s.trunk,
        s.bark0,
        s.barkH,
        s.tint,
        ...leaf,
        packRgb(s.bark),
        s.clump,
        s.grain,
        s.tiers,
        s.deciduous,
      ],
      k * 16,
    );
  }
  out.set([season.fresh, season.autumn, season.bare, season.snowLine], 0);
  return out;
}

/** an albedo packed in one float's bits (rgb10: 0 … 1 linear) — the bark's, beside the leaves' */
function packRgb(c: Vec3): number {
  const q = (v: number) => Math.max(0, Math.min(1023, Math.round(v * 1023)));
  const b = new Uint32Array([(q(c[0]) | (q(c[1]) << 10) | (q(c[2]) << 20)) >>> 0]);
  return new Float32Array(b.buffer)[0]!;
}

/** The section read back (the CPU's collisions): its frame and cells, from a packed buffer's views. */
export function readForest(fv: Float32Array, uv: Uint32Array): { frame: ForestFrame; cells: Uint32Array } | null {
  const at = fv[8]!;
  if (!(at > 0)) return null;
  const o = at * 4;
  const ints = new Int32Array(fv.buffer, fv.byteOffset + (o + 24) * 4, 2);
  const frame: ForestFrame = {
    w: fv[o]!,
    h: fv[o + 1]!,
    cell: fv[o + 6]!,
    columns: fv[o + 7]!,
    a: [fv[o + 8]!, fv[o + 9]!, fv[o + 10]!],
    b: [fv[o + 12]!, fv[o + 13]!, fv[o + 14]!],
    c: [fv[o + 16]!, fv[o + 17]!, fv[o + 18]!],
    d: [fv[o + 20]!, fv[o + 21]!, fv[o + 22]!],
    i0: ints[0]!,
    j0: ints[1]!,
    reach: fv[o + 27]!,
  };
  const cellsAt = fv[o + 4]! * 4;
  return { frame, cells: uv.subarray(cellsAt, cellsAt + frame.w * frame.h) };
}
/** The trees whose cells lie within `radius` of a frame point (their trunks, crowns), nearest first. */
export function forestTreesNear(frame: ForestFrame, cells: Uint32Array, x: number, y: number, radius: number): ForestTree[] {
  const u = frame.a[0] + frame.a[1] * x + frame.a[2] * y,
    v = frame.b[0] + frame.b[1] * x + frame.b[2] * y;
  const reach = Math.ceil(radius / frame.cell) + 1;
  const out: ForestTree[] = [];
  for (let j = Math.max(0, Math.floor(v) - reach); j <= Math.min(frame.h - 1, Math.floor(v) + reach); j++)
    for (let i = Math.max(0, Math.floor(u) - reach); i <= Math.min(frame.w - 1, Math.floor(u) + reach); i++) {
      const t = forestTree(frame, cells[j * frame.w + i]!, i, j);
      if (t && Math.hypot(t.x - x, t.y - y) <= radius + t.radius) out.push(t);
    }
  return out.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
}

// ---- growing a scenery's forest (the worker's pass, apart from its sources: tested alone)
export interface ForestSources {
  /** the land cover's class at a place (ESA WorldCover; 0 unknown) */
  cover(lat: number, lon: number): number;
  /** a place no tree may stand on (an airfield, a road, a river, a lake…) */
  excluded(lat: number, lon: number): boolean;
  /** the ground's height at a place [m] (the tracer's relief) */
  ground(lat: number, lon: number): Promise<number>;
  /** a place's frame metres at a height */
  local(lat: number, lon: number, h: number): Vec3;
  /** a source's failure (its trees left out) */
  error?(e: unknown): void;
}
/**
 * The frame's cells, decided: 1. where a tree may stand (the cover's density by the cell's own draw, the
 * exclusions); 2. the ground two cells apart in the grid's own coordinates, fetched together (the relief's
 * finest detail is ~25 m: a bilinear 14 m grid holds it to well under the trunk's sinking); 3. each tree's
 * kind and height from the climate, its foot on the ground sunk FOREST_SINK.
 */
export async function growForest(f: ForestFrame, io: ForestSources): Promise<{ cells: Uint32Array; trees: number }> {
  const cells = new Uint32Array(f.w * f.h);
  const candidates: number[] = [];
  const nodesW = (f.w >> 1) + 2,
    nodesH = (f.h >> 1) + 2;
  const wanted = new Uint8Array(nodesW * nodesH);
  for (let j = 0; j < f.h; j++)
    for (let i = 0; i < f.w; i++) {
      const gi = forestColumn(f, i),
        gj = f.j0 + j;
      const [jx, jy] = forestJitter(gi, gj);
      const u = i + jx,
        v = j + jy;
      const x = f.c[0] + f.c[1] * u + f.c[2] * v,
        y = f.d[0] + f.d[1] * u + f.d[2] * v;
      if (x * x + y * y > f.reach * f.reach) continue;
      const [lat, lon] = forestPlaceOf(f.i0 + u, f.j0 + v, f.columns);
      const cls = io.cover(lat, lon);
      if (forestUnit(forestHash(gi, gj, 5)) >= (cls === 10 ? FOREST_UNDERSTORY : forestDensity(cls)) || io.excluded(lat, lon)) continue;
      candidates.push(j * f.w + i);
      const a = Math.floor(u / 2),
        b = Math.floor(v / 2);
      wanted[b * nodesW + a] = wanted[b * nodesW + a + 1] = wanted[(b + 1) * nodesW + a] = wanted[(b + 1) * nodesW + a + 1] = 1;
    }
  const nodes = new Float64Array(nodesW * nodesH).fill(Number.NaN);
  const asked: Promise<void>[] = [];
  for (let k = 0; k < wanted.length; k++)
    if (wanted[k]) {
      const [lat, lon] = forestPlaceOf(f.i0 + 2 * (k % nodesW), f.j0 + 2 * Math.floor(k / nodesW), f.columns);
      asked.push(io.ground(lat, lon).then((h) => void (nodes[k] = h), io.error ?? (() => {})));
    }
  await Promise.all(asked);
  let trees = 0;
  for (const c of candidates) {
    const i = c % f.w,
      j = Math.floor(c / f.w);
    const gi = forestColumn(f, i),
      gj = f.j0 + j;
    const [jx, jy] = forestJitter(gi, gj);
    const u = i + jx,
      v = j + jy;
    const a = Math.floor(u / 2),
      b = Math.floor(v / 2),
      fx = u / 2 - a,
      fy = v / 2 - b;
    const n = (p: number, r: number) => nodes[(b + r) * nodesW + a + p]!;
    // (a node whose height failed: its trees left out, never at sea level)
    const ground = (n(0, 0) * (1 - fx) + n(1, 0) * fx) * (1 - fy) + (n(0, 1) * (1 - fx) + n(1, 1) * fx) * fy;
    if (!Number.isFinite(ground)) continue;
    // (no tree on a cliff: the ground's slope over the four nodes round it, two cells apart — past FOREST_MAX_SLOPE
    // the land cover's 10 m pixel is a wall's face, Lauterbrunnen's 300 m of rock drew a forest)
    const span = 2 * f.cell;
    const gx = (n(1, 0) - n(0, 0) + n(1, 1) - n(0, 1)) / (2 * span),
      gy = (n(0, 1) - n(0, 0) + n(1, 1) - n(1, 0)) / (2 * span);
    if (gx * gx + gy * gy > FOREST_MAX_SLOPE * FOREST_MAX_SLOPE) continue;
    const [lat, lon] = forestPlaceOf(f.i0 + u, f.j0 + v, f.columns);
    const kind = forestKind(io.cover(lat, lon), lat, ground, forestUnit(forestHash(gi, gj, 5)), forestUnit(forestHash(gi, gj, 6)));
    if (kind === ForestKind.none) continue;
    const tall = forestHeight(kind, lat, ground, forestUnit(forestHash(gi, gj, 7)));
    cells[c] = packCell(io.local(lat, lon, ground - FOREST_SINK)[2], kind, tall);
    trees++;
  }
  return { cells, trees };
}
