import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "./ellipsoid";
import { TERRAIN_CACHE_N, TERRAIN_CACHE_ROUNDS, type TerrainWindow } from "./terrain-cache-layout";
import { RUNWAY_HALF_WIDTH, RUNWAY_GRADE } from "../game/sites";

// Four runways, sixteen candidate knots per axis each. Every row/column spans the patch: no T junctions.
export const RASTER_MESH_MAX_SIDE = TERRAIN_CACHE_N + 64;
// Cells crossed by a runway edge are cut along it. The cuts have their own bounded budget; past it the mesh
// falls back to the rectilinear grid, which is still watertight.
export const RASTER_MESH_EXTRA_VERTICES = 12288;
export const RASTER_MESH_EXTRA_TRIANGLES = 24576;
export const RASTER_MESH_VERTEX_BYTES = (RASTER_MESH_MAX_SIDE ** 2 + RASTER_MESH_EXTRA_VERTICES) * 12;
export const RASTER_MESH_INDEX_BYTES = ((RASTER_MESH_MAX_SIDE - 1) ** 2 * 2 + RASTER_MESH_EXTRA_TRIANGLES) * 3 * 4;

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

type Pt = [number, number];
/** A runway outline edge in grid coordinates; `priority` 0 is the paved ribbon, 1 the levelled zone. */
interface Edge {
  p: Pt;
  q: Pt;
}

/**
 * Outline corners, and cut points near a knot, closer than this (2e-3 cell: 0.3 m at level 2, 1 cm at level 0) are
 * the same place. A runway nearly aligned with the axes thus makes no sliver thinner than the tolerances below.
 */
const SNAP = 2e-3;
const KNOT_MERGE = SNAP;
// The cut line is the one through the chord's two (snapped) end points: they are on it exactly, and every other
// vertex is on one side of it.
const ON_LINE = 1e-10;
const SAME = 1e-6;

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < SAME && Math.abs(a[1] - b[1]) < SAME;
const snapTo = (v: number, lo: number, hi: number) => (Math.abs(v - lo) < SNAP ? lo : Math.abs(v - hi) < SNAP ? hi : v);

/** The coordinate of `edge` on the line axis = at (axis 0: u = at, axis 1: v = at); null when it does not span it. */
function crossing(edge: Edge, axis: 0 | 1, at: number): number | null {
  const o = axis === 0 ? 1 : 0;
  const d = edge.q[axis] - edge.p[axis];
  if (Math.abs(d) < 1e-12) return null;
  const t = (at - edge.p[axis]) / d;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  if (t < 1e-9) return edge.p[o];
  if (t > 1 - 1e-9) return edge.q[o];
  return edge.p[o] + t * (edge.q[o] - edge.p[o]);
}

/**
 * Where an edge meets one cell's sides, and the chord between its two end points when it truly crosses the cell.
 * A hit on a shared side is a vertex of both neighbours even if one of them has no chord of its own to cut.
 */
function cellHits(edge: Edge, x0: number, x1: number, y0: number, y1: number): { hits: Pt[]; chord: [Pt, Pt] | null } {
  const hits: Pt[] = [];
  const push = (pt: Pt) => {
    if (!hits.some((o) => same(o, pt))) hits.push(pt);
  };
  for (const x of [x0, x1]) {
    const v = crossing(edge, 0, x);
    if (v !== null && v >= y0 - SNAP && v <= y1 + SNAP) push([x, snapTo(v, y0, y1)]);
  }
  for (const y of [y0, y1]) {
    const u = crossing(edge, 1, y);
    if (u !== null && u >= x0 - SNAP && u <= x1 + SNAP) push([snapTo(u, x0, x1), y]);
  }
  if (hits.length < 2) return { hits, chord: null };
  let best: [Pt, Pt] = [hits[0]!, hits[1]!];
  let far = -1;
  for (let i = 0; i < hits.length; i++)
    for (let j = i + 1; j < hits.length; j++) {
      const d = Math.hypot(hits[i]![0] - hits[j]![0], hits[i]![1] - hits[j]![1]);
      if (d > far) {
        far = d;
        best = [hits[i]!, hits[j]!];
      }
    }
  const mu = (best[0][0] + best[1][0]) / 2,
    mv = (best[0][1] + best[1][1]) / 2;
  // Along a cell side the cut adds nothing: the grid already has that edge.
  if (mu <= x0 + 1e-7 || mu >= x1 - 1e-7 || mv <= y0 + 1e-7 || mv >= y1 - 1e-7) return { hits, chord: null };
  return { hits, chord: best };
}

interface Rectilinear extends RasterMesh {
  grid: { xs: number[]; ys: number[]; vertices: Float32Array; per: number };
}

export interface RasterMesh {
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  columns: number;
  rows: number;
  /** Extra vertices and triangles added by cutting cells along runway outlines. */
  cutVertices: number;
  cutTriangles: number;
  /** False when the cut budget was exceeded or no outline touches the patch: the grid alone is drawn. */
  conforming: boolean;
}

/**
 * Triangulate a convex ring (counter-clockwise, collinear vertices allowed) without dropping any vertex:
 * a vertex on a side belongs to the neighbouring cell too, and must stay a triangle corner.
 */
function earClip(ring: number[], at: (i: number) => Pt, out: number[]) {
  const r = ring.slice();
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  while (r.length > 3) {
    // Twice the ring's area: an ear that is all of it would leave a flat remainder, losing the vertices on it.
    let whole = 0;
    const o = at(r[0]!);
    for (let i = 1; i + 1 < r.length; i++) whole += cross(o, at(r[i]!), at(r[i + 1]!));
    let cut = -1;
    let bestArea = 1e-14;
    for (let i = 0; i < r.length; i++) {
      const area = cross(at(r[(i + r.length - 1) % r.length]!), at(r[i]!), at(r[(i + 1) % r.length]!));
      if (area > bestArea && whole - area > 1e-12) {
        bestArea = area;
        cut = i;
      }
    }
    if (cut < 0) return;
    out.push(r[(cut + r.length - 1) % r.length]!, r[cut]!, r[(cut + 1) % r.length]!);
    r.splice(cut, 1);
  }
  if (r.length === 3 && cross(at(r[0]!), at(r[1]!), at(r[2]!)) > 1e-14) out.push(r[0]!, r[1]!, r[2]!);
}

const runwayCount = (runways: Float32Array) => Math.min(4, Math.max(0, Math.floor(runways[0] ?? 0)));

/** A point of runway k, `a` m along and `c` m across it from its threshold, in the patch's grid coordinates. */
function runwayPoint(window: TerrainWindow, level: number, runways: Float32Array, k: number, a: number, c: number): Pt {
  const round = TERRAIN_CACHE_ROUNDS[level]!;
  const per = round / (2 * Math.PI);
  const at = 4 + 16 * k;
  const p = geodeticToCart(WGS84_A, WGS84_F, Math.asin(runways[at + 2]!), Math.atan2(runways[at + 1]!, runways[at]!), 0);
  const point = p.map((v, i) => v + a * runways[at + 4 + i]! + c * runways[at + 8 + i]!) as [number, number, number];
  const g = cartToGeodetic(WGS84_A, WGS84_F, point);
  let x = g.lon * per;
  x += Math.round((window.i + (TERRAIN_CACHE_N - 1) / 2 - x) / round) * round;
  return [x - window.i, g.lat * per - window.j];
}

/** Runway outlines in grid coordinates: for each runway, the paved ribbon, then the levelled zone. */
export function runwayOutlines(window: TerrainWindow, level: number, runways: Float32Array): Pt[][] {
  const quads: Pt[][] = [];
  const G = RUNWAY_GRADE;
  for (let k = 0; k < runwayCount(runways); k++) {
    const length = runways[4 + 16 * k + 3]!;
    const corner = (a: number, c: number) => runwayPoint(window, level, runways, k, a, c);
    for (const [a0, a1, c0, c1] of [
      [0, length, -RUNWAY_HALF_WIDTH, RUNWAY_HALF_WIDTH],
      [-G.levelPast, length + G.levelPast, -G.levelSide, G.levelSide],
    ] as const)
      quads.push([corner(a0, c0), corner(a1, c0), corner(a1, c1), corner(a0, c1)]);
  }
  return quads;
}

/**
 * The patch as an indexed mesh. A rectilinear grid (every runway corner on a vertex) whose cells that an
 * outline crosses are cut along it, so that a runway's sides and thresholds are mesh edges whatever its
 * heading. A cut point on a shared side is computed from the outline and that side alone, so both
 * neighbours get the very same vertex: no T junction, no crack.
 */
export function terrainRasterMesh(window: TerrainWindow, level: number, runways: Float32Array): RasterMesh {
  const quads = runwayOutlines(window, level, runways);
  if (quads.length) {
    // Only the outline corners need vertices: the cuts supply everything else.
    const base = rectilinearMesh(level, quads.flat(), KNOT_MERGE);
    const mesh = conformMesh(base, quads);
    if (mesh) return mesh;
  }
  // The grid alone (no outline touches the patch, or the cuts exceed their budget): refine at the lattice.
  const lattice: Pt[] = [];
  const G = RUNWAY_GRADE;
  for (let k = 0; k < runwayCount(runways); k++) {
    const length = runways[4 + 16 * k + 3]!;
    for (const a of [-G.levelPast, 0, length, length + G.levelPast])
      for (const c of [-G.levelSide, -RUNWAY_HALF_WIDTH, RUNWAY_HALF_WIDTH, G.levelSide])
        lattice.push(runwayPoint(window, level, runways, k, a, c));
  }
  const { grid: _grid, ...mesh } = rectilinearMesh(level, lattice, 1e-4);
  return mesh;
}

function conformMesh(base: Rectilinear, quads: Pt[][]): RasterMesh | null {
  const { xs, ys, vertices: gridVertices, per } = base.grid;
  const columns = xs.length,
    rows = ys.length;
  const last = TERRAIN_CACHE_N - 1;
  const nearest = (values: number[], v: number): number => {
    let best = v;
    let d = 2 * KNOT_MERGE;
    for (const k of values) if (Math.abs(k - v) < d) (d = Math.abs(k - v)), (best = k);
    return best;
  };
  const edges: Edge[] = [];
  for (const quad of quads)
    for (let i = 0; i < 4; i++) {
      // A corner inside the patch is a grid vertex; snap to it exactly. Outside, it only gives the direction.
      const snap = (pt: Pt): Pt =>
        pt[0] >= 0 && pt[0] <= last && pt[1] >= 0 && pt[1] <= last ? [nearest(xs, pt[0]), nearest(ys, pt[1])] : pt;
      const edge = { p: snap(quad[i]!), q: snap(quad[(i + 1) % 4]!) };
      if (!same(edge.p, edge.q)) edges.push(edge);
    }
  // The side hits and the chords, per cell.
  const cell = new Map<number, { hits: Pt[]; chords: [Pt, Pt][] }>();
  const range = (values: number[], lo: number, hi: number): [number, number] => {
    let a = 0;
    while (a + 2 < values.length && values[a + 1]! <= lo) a++;
    let b = a;
    while (b + 1 < values.length - 1 && values[b + 1]! < hi) b++;
    return [Math.max(0, a - 1), Math.min(values.length - 2, b + 1)];
  };
  for (const edge of edges) {
    const [ia, ib] = range(xs, Math.min(edge.p[0], edge.q[0]), Math.max(edge.p[0], edge.q[0]));
    const [ja, jb] = range(ys, Math.min(edge.p[1], edge.q[1]), Math.max(edge.p[1], edge.q[1]));
    for (let j = ja; j <= jb; j++)
      for (let i = ia; i <= ib; i++) {
        const { hits, chord } = cellHits(edge, xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!);
        if (!hits.length) continue;
        const key = j * (columns - 1) + i;
        let entry = cell.get(key);
        if (!entry) cell.set(key, (entry = { hits: [], chords: [] }));
        entry.hits.push(...hits);
        if (chord) entry.chords.push(chord);
      }
  }
  if (!cell.size) return null;

  const stride = WGS84_A / per / 2;
  const added: number[] = [];
  const known = new Map<string, number>();
  const gridCount = columns * rows;
  const coordinate = (id: number): Pt =>
    id < gridCount ? [xs[id % columns]!, ys[Math.floor(id / columns)]!] : [added[3 * (id - gridCount)]!, added[3 * (id - gridCount) + 1]!];
  const vertexAt = (pt: Pt, size: number, cellCorners?: [number, number]): number => {
    // A grid vertex keeps its own index and footprint.
    if (cellCorners) {
      const i = cellCorners[0],
        j = cellCorners[1];
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        if (pt[0] === xs[i + dx]! && pt[1] === ys[j + dy]!) return (j + dy) * columns + i + dx;
    }
    const key = `${pt[0]},${pt[1]}`;
    const found = known.get(key);
    if (found !== undefined) {
      const at = 3 * (found - gridCount) + 2;
      added[at] = Math.max(added[at]!, size);
      return found;
    }
    const id = gridCount + added.length / 3;
    added.push(pt[0], pt[1], size);
    known.set(key, id);
    return id;
  };

  const triangles: number[] = [];
  let cutCells = 0;
  const at = (id: number) => coordinate(id);
  for (const [key, { hits, chords }] of cell) {
    const i = key % (columns - 1),
      j = Math.floor(key / (columns - 1));
    const x0 = xs[i]!,
      x1 = xs[i + 1]!,
      y0 = ys[j]!,
      y1 = ys[j + 1]!;
    const size = Math.max(0.05, stride * Math.max(x1 - x0, y1 - y0));
    const corners: [number, number] = [i, j];
    const onSide: Pt[][] = [[], [], [], []];
    const insert = (pt: Pt) => {
      const sides: [number, boolean][] = [
        [0, pt[1] === y0 && pt[0] > x0 && pt[0] < x1],
        [1, pt[0] === x1 && pt[1] > y0 && pt[1] < y1],
        [2, pt[1] === y1 && pt[0] > x0 && pt[0] < x1],
        [3, pt[0] === x0 && pt[1] > y0 && pt[1] < y1],
      ];
      for (const [s, hit] of sides) if (hit && !onSide[s]!.some((o) => same(o, pt))) onSide[s]!.push(pt);
    };
    for (const hit of hits) insert(hit);
    onSide[0]!.sort((a, b) => a[0] - b[0]);
    onSide[1]!.sort((a, b) => a[1] - b[1]);
    onSide[2]!.sort((a, b) => b[0] - a[0]);
    onSide[3]!.sort((a, b) => b[1] - a[1]);
    const id = (pt: Pt) => vertexAt(pt, size, corners);
    const ring: number[] = [
      id([x0, y0]),
      ...onSide[0]!.map(id),
      id([x1, y0]),
      ...onSide[1]!.map(id),
      id([x1, y1]),
      ...onSide[2]!.map(id),
      id([x0, y1]),
      ...onSide[3]!.map(id),
    ];
    let pieces: number[][] = [ring];
    for (const [a, b] of chords) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const next: number[][] = [];
      for (const piece of pieces) {
        const s = piece.map((v) => {
          const p = at(v);
          const d = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
          return d > ON_LINE ? 1 : d < -ON_LINE ? -1 : 0;
        });
        if (!s.includes(1) || !s.includes(-1)) {
          next.push(piece);
          continue;
        }
        const left: number[] = [],
          right: number[] = [];
        for (let k = 0; k < piece.length; k++) {
          const m = (k + 1) % piece.length;
          if (s[k]! >= 0) left.push(piece[k]!);
          if (s[k]! <= 0) right.push(piece[k]!);
          if (s[k]! * s[m]! < 0) {
            // Always from the lexicographically smaller end, so a side shared by two pieces gets one point.
            let p = at(piece[k]!),
              q = at(piece[m]!);
            if (p[0] > q[0] || (p[0] === q[0] && p[1] > q[1])) [p, q] = [q, p];
            const dp = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
            const dq = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
            const t = dp / (dp - dq);
            const x = vertexAt([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])], size);
            left.push(x);
            right.push(x);
          }
        }
        if (left.length >= 3) next.push(left);
        if (right.length >= 3) next.push(right);
      }
      pieces = next;
    }
    for (const piece of pieces) earClip(piece, at, triangles);
    cutCells++;
    if (added.length / 3 > RASTER_MESH_EXTRA_VERTICES) return null;
  }
  const uncut = (columns - 1) * (rows - 1) - cutCells;
  if (uncut * 2 + triangles.length / 3 > (columns - 1) * (rows - 1) * 2 + RASTER_MESH_EXTRA_TRIANGLES) return null;

  const vertices = new Float32Array(gridCount * 3 + added.length);
  vertices.set(gridVertices);
  vertices.set(added, gridCount * 3);
  const indices = new Uint32Array(uncut * 6 + triangles.length);
  let n = 0;
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < columns - 1; i++) {
      if (cell.has(j * (columns - 1) + i)) continue;
      const a = j * columns + i;
      indices.set([a, a + 1, a + columns, a + 1, a + columns + 1, a + columns], n);
      n += 6;
    }
  indices.set(triangles, n);
  return {
    vertices,
    indices,
    columns,
    rows,
    cutVertices: added.length / 3,
    cutTriangles: triangles.length / 3 - cutCells * 2,
    conforming: true,
  };
}

function rectilinearMesh(level: number, points: Pt[], merge: number): Rectilinear {
  const per = TERRAIN_CACHE_ROUNDS[level]! / (2 * Math.PI);
  const xs: number[] = [],
    ys: number[] = [];
  const add = (values: number[], v: number) => {
    if (Number.isFinite(v) && v > 0 && v < TERRAIN_CACHE_N - 1) values.push(Math.fround(v));
  };
  // A runway outside the patch must not refine unrelated strips inside it.
  for (const [u, v] of points)
    if (u >= 0 && u <= TERRAIN_CACHE_N - 1 && v >= 0 && v <= TERRAIN_CACHE_N - 1) {
      add(xs, u);
      add(ys, v);
    }
  const knots = (extra: number[]) => {
    const values = [
      ...Array.from({ length: TERRAIN_CACHE_N }, (_, i) => i),
      ...extra.filter((v) => Math.abs(v - Math.round(v)) >= merge),
    ].sort((a, b) => a - b);
    // Preserve every original integer node; avoid near-duplicate/sliver intervals in float32.
    const out: number[] = [];
    for (const v of values) if (!out.length || Number.isInteger(v) || v - out[out.length - 1]! >= merge) out.push(v);
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
  return {
    vertices,
    indices,
    columns: x.length,
    rows: y.length,
    cutVertices: 0,
    cutTriangles: 0,
    conforming: false,
    grid: { xs: x, ys: y, vertices, per },
  };
}
