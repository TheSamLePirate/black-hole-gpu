// PLAN-J8 J8-8 lot (2) — the near buildings drawn from their mesh cells (docs/PLAN-J8-BATIMENTS.md §8 J8-8; the format kerr-mesh-v1,
// mesh-cells.ts — the approaches session's lot (1)): the mesh cells within NEAR_MESH_REACH_M of the eye asked of the mesh pool
// (cell-workers.ts meshPool), the nearest first (building-layer.ts cellPriority); each cell's vertices and triangles put into a GPU
// reserve by blocks (scenery-raster.ts nearInit: NEAR_VERT_BLOCK vertices, NEAR_TRI_BLOCK triangles), its frame in the scene's
// written (building-layer.ts cellFrameInScene), each building set on the relief drawn — the lowest of five samples under its
// footprint (its corners and centre: the renderer's groundBare), once, when its cell becomes resident (the format's heights are over
// the building's foot, its walls from SKIRT_M under it). Drawn by SceneryRaster (nearCellVs → meshFs: the building mesh's code).
// The far layer leaves those cells to it (building-far.ts setHidden). First step of lot (2): the triangles drawn with the generic near
// material (no leaf); the records (rasterBuilding's exact faces and windows) next — lot (2b); the contacts and shadows lot (3); the
// near scene without buildings lot (4). A lever (renderer.nearCellsOn), off until those are in.
import { CELL_Z, cellKey, cellOf, fromCell, MESH_NEAR_M, toCell } from "./building-cells";
import { cellFrameInScene, cellPriority, type EyeState } from "./building-layer";
import type { CellPool, CellPrepared, CellWant } from "./cell-pool";
import { MeshCellFlag, type MeshCellHeader, meshViews, readMeshBuilding, readMeshHeader } from "./mesh-cells";
import { sceneryFrame } from "./scenery-data";
import { NEAR_REC_BLOCK, NEAR_REGION_MARK, NEAR_TRI_BLOCK, NEAR_VERT_BLOCK, type SceneryRaster } from "./scenery-raster";

/** the cells asked round the eye [m] — the « full mesh » distance (building-cells.ts MESH_NEAR_M) and a margin for the turn ahead */
export const NEAR_MESH_REACH_M = MESH_NEAR_M + 500;
/** the reserve's bytes: its vertices' and triangles' (16 bytes each) — ~55 MB resident within 2 km in central Paris, estimated
 *  (PLAN-J8 J8-8, the lot (1) measure) */
export const NEAR_MESH_BUDGET_BYTES = 128 * 1024 * 1024;
/** the cells' frames held at once */
export const NEAR_MESH_SLOTS = 256;
/** the page's time the cells' arrival takes at most a frame [ms] (their ground sampled, their upload) */
export const NEAR_PUT_MS = 3;
/** lot (2b): the region past the scene's bytes in the scenery buffer (scenery.ts setRegion) — the cells' frames, their record blocks'
 *  table, their records (packScenery's, in the cell's frame, heights over the ellipsoid) — read by the tracer's near material
 *  (trace.wgsl rasterBuilding, nearCellFrame) as the scene's own: ~26 MB of records within 2 km in central Paris (the lot (1) measure) */
export const NEAR_REGION_BYTES = 48 * 1024 * 1024;
/** a triangle without a record (no region): its leaf 0 — the generic near material */
export const NO_RECORD = 0xffffffff;

/** the region's layout [vec4s from its start]: the frames, the table (a u32 a record block), the records; the last vec4 the tail */
export function nearRegionLayout(vec4s: number) {
  const frames = 0;
  const table = NEAR_MESH_SLOTS * 4;
  const blocks = Math.max(0, Math.floor((vec4s - table - 1) / (NEAR_REC_BLOCK + 0.25)));
  const records = table + Math.ceil(blocks / 4);
  return { frames, table, records, blocks, tail: vec4s - 1 };
}

/**
 * A cell's records for the region (packScenery's leaves — mesh-cells.ts's records section, copied), each building's heights lifted by
 * its ground (`grounds[rank]`, m over the ellipsoid): a leaf's bottom and top (its first vec4's x, y), its walls' top (its roof
 * colour's w), its roof planes' heights (their z) — its leaves walked from the identity table (a leaf: 4 + edges + planes vec4s).
 */
export function nearCellRecords(buf: ArrayBuffer, grounds: ArrayLike<number>): Float32Array {
  const h = readMeshHeader(buf)!;
  const rec = new Float32Array(meshViews(buf, h).records);
  for (let r = 0; r < h.buildings; r++) {
    const b = readMeshBuilding(buf, r);
    const g = grounds[r] ?? 0;
    let o = b.firstRecord;
    for (let l = 0; l < b.records && o < h.records; l++) {
      const count = Math.round(rec[4 * o + 2]!);
      const np = (Math.floor(rec[4 * (o + 2) + 3]!) >> 14) & 15;
      rec[4 * o]! += g;
      rec[4 * o + 1]! += g;
      rec[4 * (o + 3 + count) + 3]! += g;
      for (let k = 0; k < np; k++) rec[4 * (o + 4 + count + k) + 2]! += g;
      o += 4 + count + np;
    }
  }
  return rec;
}

/** A pool of equal blocks: a cell's in whole blocks, the lowest free first. */
class BlockPool {
  private free: number[];
  constructor(readonly blocks: number) {
    this.free = Array.from({ length: blocks }, (_, i) => blocks - 1 - i);
  }
  get freeBlocks() {
    return this.free.length;
  }
  alloc(n: number): number[] | null {
    if (n > this.free.length) return null;
    return this.free.splice(this.free.length - n, n).reverse();
  }
  release(b: readonly number[]) {
    this.free.push(...b);
    this.free.sort((a, c) => c - a);
  }
}

/** lot (3): a cell's buildings for the walker's contacts — its records (heights set on the relief), its origin, its leaves by bins of
 *  CONTACT_BIN_M (each leaf's float index in `rec`) */
export const CONTACT_BIN_M = 32;
interface CellContact {
  rec: Float32Array;
  origin: { lat: number; lon: number };
  bins: Map<number, number[]>;
}
const binKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
/** a cell's contact: its leaves binned by their footprint's box (their edges) */
export function cellContact(buf: ArrayBuffer, rec: Float32Array): CellContact {
  const h = readMeshHeader(buf)!;
  const bins = new Map<number, number[]>();
  for (let r = 0; r < h.buildings; r++) {
    const b = readMeshBuilding(buf, r);
    let o = b.firstRecord;
    for (let l = 0; l < b.records && o < h.records; l++) {
      const base = 4 * o,
        count = Math.round(rec[base + 2]!);
      const np = (Math.floor(rec[base + 11]!) >> 14) & 15;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let e = 0; e < count; e++) {
        const x = rec[base + 12 + 4 * e]!,
          y = rec[base + 13 + 4 * e]!;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      if (count > 0)
        for (let i = Math.floor(minX / CONTACT_BIN_M); i <= Math.floor(maxX / CONTACT_BIN_M); i++)
          for (let j = Math.floor(minY / CONTACT_BIN_M); j <= Math.floor(maxY / CONTACT_BIN_M); j++) {
            const k = binKey(i, j);
            const list = bins.get(k);
            if (list) list.push(base);
            else bins.set(k, [base]);
          }
      o += 4 + count + np;
    }
  }
  return { rec, origin: { lat: h.originLat, lon: h.originLon }, bins };
}
/** is p (its cell's east, north [m]) within `radius` of the leaf's footprint (its edges at base + 12: the scene's records' — scenery-contact.ts) */
function inLeaf(f: Float32Array, base: number, px: number, py: number, radius: number) {
  let inside = false,
    edge = false;
  for (let i = base + 12; i < base + 12 + f[base + 2]! * 4; i += 4) {
    const x = f[i]!,
      y = f[i + 1]!,
      dx = f[i + 2]! - x,
      dy = f[i + 3]! - y;
    const t = Math.max(0, Math.min(1, ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy || 1)));
    edge ||= (px - x - t * dx) ** 2 + (py - y - t * dy) ** 2 < radius * radius;
    if (y > py !== f[i + 3]! > py && px < x + ((py - y) * dx) / dy) inside = !inside;
  }
  return inside || edge;
}
/** a leaf's top over (x, y): its roof planes' least, its own top else (scenery-contact.ts topAt) */
function leafTop(f: Float32Array, base: number, x: number, y: number) {
  const top = f[base + 1]!;
  if (f[base + 3] !== 1) return top;
  const planes = (f[base + 11]! >>> 14) & 15,
    at = base + 12 + f[base + 2]! * 4 + 4;
  let z = top;
  for (let k = 0; k < planes; k++) z = Math.min(z, f[at + k * 4]! * x + f[at + k * 4 + 1]! * y + f[at + k * 4 + 2]!);
  return z;
}

/** the capsule at (east, north [m] in the cell's frame, hM over the ellipsoid) against a cell's buildings: blocked, its support */
export function contactIn(C: CellContact, east: number, north: number, hM: number, radius = 0.3, height = 1.8, step = 0.25) {
  let blocked = false,
    support = Number.NEGATIVE_INFINITY;
  const seen = new Set<number>();
  for (let bi = Math.floor((east - radius) / CONTACT_BIN_M); bi <= Math.floor((east + radius) / CONTACT_BIN_M); bi++)
    for (let bj = Math.floor((north - radius) / CONTACT_BIN_M); bj <= Math.floor((north + radius) / CONTACT_BIN_M); bj++)
      for (const base of C.bins.get(binKey(bi, bj)) ?? []) {
        if (seen.has(base)) continue;
        seen.add(base);
        if (!inLeaf(C.rec, base, east, north, radius)) continue;
        const bottom = C.rec[base]!,
          top = leafTop(C.rec, base, east, north);
        if (top <= hM + step && top >= hM - 2) support = Math.max(support, top - hM);
        else if (bottom < hM + height - 0.02 && top > hM + 0.02) blocked = true;
      }
  return { blocked, support };
}

interface Resident {
  x: number;
  y: number;
  slot: number;
  vert: number[];
  tri: number[];
  rec: number[];
  records: number;
  buildings: number;
  triangles: number;
  /** lot (3): its buildings for the walker's contacts */
  contact?: CellContact;
}

/** each building's box in its cell's frame (min east, min north, max east, max north; NaN: no vertex) — its ground's samples */
export function buildingBoxes(buf: ArrayBuffer, h: MeshCellHeader): Float32Array {
  const pos = meshViews(buf, h).positions;
  const out = new Float32Array(4 * h.buildings).fill(Number.NaN);
  for (let r = 0; r < h.buildings; r++) {
    const b = readMeshBuilding(buf, r);
    const end = r + 1 < h.buildings ? readMeshBuilding(buf, r + 1).firstVertex : h.vertices;
    if (end <= b.firstVertex) continue;
    let minE = Infinity,
      minN = Infinity,
      maxE = -Infinity,
      maxN = -Infinity;
    for (let i = b.firstVertex; i < end; i++) {
      minE = Math.min(minE, pos[3 * i]!);
      maxE = Math.max(maxE, pos[3 * i]!);
      minN = Math.min(minN, pos[3 * i + 1]!);
      maxN = Math.max(maxN, pos[3 * i + 1]!);
    }
    out.set([minE, minN, maxE, maxN], 4 * r);
  }
  return out;
}

/**
 * A cell's vertices for the GPU (4 floats each: east, north, height over the ellipsoid, 0) and its triangles (4 u32 each: the pool's
 * vertex indices, its leaf's record — the format's tag), each building's vertices lifted by its ground (heights over its foot + the
 * relief drawn under it), the vertex indices mapped to the cell's vertex blocks. `groundOf(rank, minE, minN, maxE, maxN)`: a building's
 * ground [m over the ellipsoid] from its footprint's box in the cell's frame.
 */
export function nearCellArrays(
  buf: ArrayBuffer,
  vertBlocks: readonly number[],
  groundOf: (rank: number, minE: number, minN: number, maxE: number, maxN: number) => number,
  recBlocks: readonly number[] | null = null,
): { pos: Float32Array; tris: Uint32Array; grounds: Float32Array } | null {
  const h = readMeshHeader(buf);
  if (!h) return null;
  const v = meshViews(buf, h);
  const pos = new Float32Array(h.vertices * 4);
  const grounds = new Float32Array(h.buildings);
  for (let i = 0; i < h.vertices; i++) {
    pos[4 * i] = v.positions[3 * i]!;
    pos[4 * i + 1] = v.positions[3 * i + 1]!;
    pos[4 * i + 2] = v.positions[3 * i + 2]!;
  }
  for (let r = 0; r < h.buildings; r++) {
    const b = readMeshBuilding(buf, r);
    const end = r + 1 < h.buildings ? readMeshBuilding(buf, r + 1).firstVertex : h.vertices;
    if (end <= b.firstVertex) continue;
    let minE = Infinity,
      minN = Infinity,
      maxE = -Infinity,
      maxN = -Infinity;
    for (let i = b.firstVertex; i < end; i++) {
      minE = Math.min(minE, pos[4 * i]!);
      maxE = Math.max(maxE, pos[4 * i]!);
      minN = Math.min(minN, pos[4 * i + 1]!);
      maxN = Math.max(maxN, pos[4 * i + 1]!);
    }
    const g = groundOf(r, minE, minN, maxE, maxN);
    grounds[r] = g;
    for (let i = b.firstVertex; i < end; i++) pos[4 * i + 2]! += g;
  }
  const at = (i: number) => vertBlocks[Math.floor(i / NEAR_VERT_BLOCK)]! * NEAR_VERT_BLOCK + (i % NEAR_VERT_BLOCK);
  const tris = new Uint32Array(h.triangles * 4);
  for (let t = 0; t < h.triangles; t++) {
    tris[4 * t] = at(v.indices[3 * t]!);
    tris[4 * t + 1] = at(v.indices[3 * t + 1]!);
    tris[4 * t + 2] = at(v.indices[3 * t + 2]!);
    // (its leaf's record in the region's records — through the cell's record blocks; none without them)
    const tg = v.tags[t]!;
    tris[4 * t + 3] = recBlocks ? recBlocks[Math.floor(tg / NEAR_REC_BLOCK)]! * NEAR_REC_BLOCK + (tg % NEAR_REC_BLOCK) : NO_RECORD;
  }
  return { pos, tris, grounds };
}

export class NearMeshes {
  private vertPool: BlockPool;
  private triPool: BlockPool;
  private residents = new Map<string, Resident>();
  /** (PLAN-J8 §0 criterion 1, the drawn side) the cells drawn here: resident and put */
  drawnCells(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const r of this.residents.values()) if (r.slot >= 0) out.push({ x: r.x, y: r.y });
    return out;
  }
  private freeSlots = Array.from({ length: NEAR_MESH_SLOTS }, (_, i) => NEAR_MESH_SLOTS - 1 - i);
  private wanted = new Map<string, CellWant>();
  private wantedAt: { lat: number; lon: number; heading: number; t: number } | null = null;
  private sceneKey = "";
  private frame: ReturnType<typeof sceneryFrame> | null = null;
  private unlisten: (() => void) | null = null;
  private initing = false;
  readonly counts = { handed: 0, put: 0, evicted: 0, refused: 0, empty: 0, buildings: 0, triangles: 0, records: 0, groundMs: 0 };
  /** the ground as drawn at a place [°] → its height over the ellipsoid [m] (the renderer's: groundBare) */
  groundAt: ((lat: number, lon: number) => number) | null = null;
  /** lot (2b): the scenery buffer's region (its first vec4, its bytes — scenery.ts region) and how to write into it [vec4 from its
   *  start]; null: none — the triangles drawn without their records (the generic near material) */
  region: (() => { base: number; bytes: number } | null) | null = null;
  writeRegion: ((at: number, data: Float32Array | Uint32Array) => void) | null = null;
  private layout: (ReturnType<typeof nearRegionLayout> & { base: number }) | null = null;
  private recPool: BlockPool | null = null;

  constructor(
    private raster: SceneryRaster,
    private cells: () => CellPool,
    budgetBytes = NEAR_MESH_BUDGET_BYTES,
  ) {
    // (the budget shared: a third the vertices', two thirds the triangles' — a building's ~2 triangles a vertex)
    this.vertPool = new BlockPool(Math.max(1, Math.floor(budgetBytes / 3 / (NEAR_VERT_BLOCK * 16))));
    this.triPool = new BlockPool(Math.max(1, Math.floor((budgetBytes * 2) / 3 / (NEAR_TRI_BLOCK * 16))));
  }

  /** lot (2b): the scenery buffer made again (its region lost or moved): every cell let go — asked again, from the mesh pool's cache —,
   *  the region's layout taken anew */
  regionChanged() {
    for (const key of [...this.residents.keys()]) this.evict(key);
    if (this.job) this.cells().forget(this.job.c.x, this.job.c.y);
    for (const c of this.queue) this.cells().forget(c.x, c.y);
    this.job = null;
    this.queue = [];
    this.layout = null;
    this.recPool = null;
  }
  /** the region's layout (made once it is there: its tail written — the tracer and the raster read it) */
  private regionReady(): boolean {
    if (this.layout) return true;
    const r = this.region?.();
    if (!r || !this.writeRegion) return false;
    const L = nearRegionLayout(r.bytes / 16);
    if (L.blocks <= 0) return false;
    this.layout = { ...L, base: r.base };
    this.recPool = new BlockPool(L.blocks);
    this.writeRegion(L.tail, new Float32Array([NEAR_REGION_MARK, r.base + L.frames, r.base + L.table, r.base + L.records]));
    return true;
  }
  /** the cells resident with buildings drawn (their keys: the far layer leaves them — building-far.ts setHidden) */
  residentKeys(): Set<string> {
    const s = new Set<string>();
    for (const [k, r] of this.residents) if (r.slot >= 0) s.add(k);
    return s;
  }

  /** each frame: the eye (null: away), the drawn scene's centre (its frame) */
  update(eye: EyeState | null, scene: { lat: number; lon: number } | null, now: number) {
    if (!this.raster.nearReady) {
      if (!this.initing) {
        this.initing = true;
        void this.raster.nearInit(this.vertPool.blocks, this.triPool.blocks, NEAR_MESH_SLOTS).then(() => {
          this.unlisten = this.cells().listen((c) => this.put(c));
        });
      }
      return;
    }
    const key = scene ? `${scene.lat.toFixed(6)}:${scene.lon.toFixed(6)}` : "";
    if (key !== this.sceneKey) {
      this.sceneKey = key;
      this.frame = scene ? sceneryFrame(scene.lat, scene.lon) : null;
      if (this.frame) for (const r of this.residents.values()) if (r.slot >= 0) this.writeFrame(r);
    }
    this.raster.nearOn = !!this.frame;
    // (the region there: the cells put before it — drawn without their records — let go once, put again with them)
    if (!this.layout && this.regionReady()) for (const key of [...this.residents.keys()]) this.evict(key);
    this.pump();
    if (!eye) return;
    const w = this.wantedAt;
    const cosL = Math.cos((eye.lat * Math.PI) / 180);
    const moved = !w || Math.hypot((eye.lat - w.lat) * 111320, (eye.lon - w.lon) * 111320 * cosL) > 200;
    if (moved || now - (w?.t ?? 0) > 2000) {
      this.wantedAt = { lat: eye.lat, lon: eye.lon, heading: eye.heading, t: now };
      this.want(eye);
    }
  }

  private want(eye: EyeState) {
    const c = cellOf(eye.lat, eye.lon);
    const side = (40075016 * Math.cos((eye.lat * Math.PI) / 180)) / 2 ** CELL_Z;
    const k = Math.ceil(NEAR_MESH_REACH_M / side) + 1;
    const list: CellWant[] = [];
    const n = 2 ** CELL_Z;
    this.wanted.clear();
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        const x = (((c.x + i) % n) + n) % n,
          y = c.y + j;
        if (y < 0 || y >= n) continue;
        const [priority, d] = cellPriority(x, y, eye);
        if (d > NEAR_MESH_REACH_M) continue;
        const want = { x, y, priority: priority as CellWant["priority"], d };
        this.wanted.set(cellKey(x, y), want);
        if (!this.residents.has(cellKey(x, y))) list.push(want);
      }
    this.cells().want(list);
    for (const [key, r] of this.residents)
      if (!this.wanted.has(key) && cellPriority(r.x, r.y, eye)[1] > NEAR_MESH_REACH_M * 1.3) this.evict(key);
  }

  /** a cell handed: queued — its ground sampled and its upload made over the frames (pump: NEAR_PUT_MS a frame) */
  private put(c: CellPrepared) {
    this.counts.handed++;
    const key = cellKey(c.x, c.y);
    if (this.residents.has(key) || this.queue.some((q) => q.x === c.x && q.y === c.y)) return;
    this.queue.push(c);
  }
  private queue: CellPrepared[] = [];
  /** the cell whose ground is being sampled: its buildings' boxes, their grounds, the next rank */
  private job: { c: CellPrepared; h: MeshCellHeader; boxes: Float32Array; grounds: Float32Array; rank: number; ms: number } | null = null;
  /** each frame: the queued cells advanced within NEAR_PUT_MS of the page's time (a cell's ~1 000 buildings × 5 ground samples were
   *  ~30 ms in one go on this Mac — a hitch a cell) */
  private pump() {
    const t0 = performance.now();
    while (performance.now() - t0 < NEAR_PUT_MS) {
      if (!this.job) {
        const c = this.queue.shift();
        if (!c) return;
        const key = cellKey(c.x, c.y);
        const h = readMeshHeader(c.buf);
        if (!this.frame || !h || !this.wanted.has(key) || this.residents.has(key)) {
          if (!this.residents.has(key)) this.cells().forget(c.x, c.y);
          continue;
        }
        if (h.triangles === 0 || h.flags & MeshCellFlag.SourceLater) {
          this.counts.empty++;
          this.residents.set(key, { x: c.x, y: c.y, slot: -1, vert: [], tri: [], rec: [], records: 0, buildings: 0, triangles: 0 });
          continue;
        }
        this.job = { c, h, boxes: buildingBoxes(c.buf, h), grounds: new Float32Array(h.buildings), rank: 0, ms: 0 };
      }
      const J = this.job;
      const s0 = performance.now();
      const g = this.groundAt;
      const origin = { lat: J.h.originLat, lon: J.h.originLon };
      // (each building's ground: the lowest of its box's corners and centre on the relief drawn — no wall standing over a slope's
      // foot —; without the relief, its source's foot)
      while (J.rank < J.h.buildings && performance.now() - t0 < NEAR_PUT_MS) {
        const r = J.rank++;
        const [minE, minN, maxE, maxN] = J.boxes.subarray(4 * r, 4 * r + 4) as unknown as number[];
        if (!g || !Number.isFinite(minE!)) {
          const foot = readMeshBuilding(J.c.buf, r).foot;
          J.grounds[r] = Number.isFinite(foot) ? foot : 0;
          continue;
        }
        let lo = Infinity;
        for (const [e, n] of [
          [minE!, minN!],
          [maxE!, minN!],
          [minE!, maxN!],
          [maxE!, maxN!],
          [(minE! + maxE!) / 2, (minN! + maxN!) / 2],
        ] as const) {
          const p = fromCell(origin, e, n);
          lo = Math.min(lo, g(p.lat, p.lon));
        }
        J.grounds[r] = lo;
      }
      J.ms += performance.now() - s0;
      if (J.rank < J.h.buildings) return;
      this.job = null;
      this.counts.groundMs += J.ms;
      this.finish(J.c, J.h, J.grounds);
    }
  }
  /** a cell whose ground is in: into the reserve's blocks (none free: refused, asked again when next wanted) */
  private finish(c: CellPrepared, h: MeshCellHeader, grounds: Float32Array) {
    const key = cellKey(c.x, c.y);
    if (!this.frame || !this.wanted.has(key) || this.residents.has(key)) {
      if (!this.residents.has(key)) this.cells().forget(c.x, c.y);
      return;
    }
    const vert = this.vertPool.alloc(Math.ceil(h.vertices / NEAR_VERT_BLOCK));
    const tri = vert ? this.triPool.alloc(Math.ceil(h.triangles / NEAR_TRI_BLOCK)) : null;
    // (lot 2b: its records' blocks in the region — none there: drawn without them)
    const rec = vert && tri && this.layout && this.recPool ? this.recPool.alloc(Math.ceil(h.records / NEAR_REC_BLOCK)) : [];
    const slot = vert && tri && rec ? this.freeSlots.pop() : undefined;
    if (!vert || !tri || !rec || slot === undefined) {
      if (vert) this.vertPool.release(vert);
      if (tri) this.triPool.release(tri);
      if (rec?.length) this.recPool?.release(rec);
      this.counts.refused++;
      this.cells().forget(c.x, c.y);
      return;
    }
    const arrays = nearCellArrays(c.buf, vert, (rank) => grounds[rank]!, rec.length ? rec : null)!;
    // (its records, their heights set on the relief: the region's and the walker's contacts')
    const records = nearCellRecords(c.buf, arrays.grounds);
    const r: Resident = {
      x: c.x,
      y: c.y,
      slot,
      vert,
      tri,
      rec,
      records: 0,
      buildings: h.buildings,
      triangles: h.triangles,
      contact: cellContact(c.buf, records),
    };
    this.writeFrame(r);
    this.raster.nearUpload(vert, arrays.pos, tri, arrays.tris, slot);
    // (lot 2b: its records into the region's blocks, each block's slot into the table)
    const L = this.layout;
    if (rec.length && L && this.writeRegion) {
      for (let b = 0; b < rec.length; b++) {
        const lo = b * NEAR_REC_BLOCK,
          cnt = Math.min(NEAR_REC_BLOCK, h.records - lo);
        this.writeRegion(L.records + rec[b]! * NEAR_REC_BLOCK, records.subarray(lo * 4, (lo + cnt) * 4));
      }
      this.counts.records += h.records;
      r.records = h.records;
      // (the table: a u32 a block — written as whole vec4s, their four blocks' slots, from the residents)
      const touched = new Set(rec.map((b) => Math.floor(b / 4)));
      for (const v4 of touched) this.writeTable(v4, rec, slot);
    }
    this.residents.set(key, r);
    this.counts.put++;
    this.counts.buildings += h.buildings;
    this.counts.triangles += h.triangles;
  }

  /** the table's vec4 `v4` (its four record blocks' slots), this cell's blocks given `slot`, the others' their owner's */
  private tableSlots = new Uint32Array(0);
  private writeTable(v4: number, blocks: readonly number[], slot: number) {
    const L = this.layout;
    if (!L || !this.writeRegion) return;
    if (this.tableSlots.length !== L.blocks + 4) this.tableSlots = new Uint32Array(L.blocks + 4);
    for (const b of blocks) this.tableSlots[b] = slot;
    this.writeRegion(L.table + v4, this.tableSlots.subarray(4 * v4, 4 * v4 + 4));
  }
  private writeFrame(r: Resident) {
    if (!this.frame || r.slot < 0) return;
    const f = cellFrameInScene(r.x, r.y, this.frame);
    this.raster.nearFrame(r.slot, f);
    // (lot 2b: the tracer's copy — its records turned into the scene's frame there)
    if (this.layout && this.writeRegion) this.writeRegion(this.layout.frames + 4 * r.slot, f);
  }

  private evict(key: string) {
    const r = this.residents.get(key);
    if (!r) return;
    if (r.tri.length) {
      this.raster.nearClear(r.tri);
      this.triPool.release(r.tri);
    }
    if (r.vert.length) this.vertPool.release(r.vert);
    if (r.rec.length) {
      this.recPool?.release(r.rec);
      this.counts.records -= r.records;
    }
    if (r.slot >= 0) this.freeSlots.push(r.slot);
    this.counts.buildings -= r.buildings;
    this.counts.triangles -= r.triangles;
    this.residents.delete(key);
    this.cells().forget(r.x, r.y);
    this.counts.evicted++;
  }

  /**
   * Lot (3): the walker's capsule against the resident cells' buildings (as scenery-contact.ts at() against the scene's): at a place
   * [°] and its height over the ellipsoid [m], a capsule `radius` wide and `height` tall — blocked by a wall, or standing on a roof
   * within `step` above or 2 m below (`support`: that top less the height [m]); the cells round it (their buildings straddle their edges)
   */
  contactAt(lat: number, lon: number, hM: number, radius = 0.3, height = 1.8, step = 0.25): { blocked: boolean; support: number } {
    let blocked = false,
      support = Number.NEGATIVE_INFINITY;
    const c = cellOf(lat, lon);
    const n = 2 ** CELL_Z;
    for (let j = -1; j <= 1 && !blocked; j++)
      for (let i = -1; i <= 1 && !blocked; i++) {
        const r = this.residents.get(cellKey((((c.x + i) % n) + n) % n, c.y + j));
        const C = r?.contact;
        if (!C) continue;
        const p = toCell(C.origin, lat, lon);
        const k = contactIn(C, p.east, p.north, hM, radius, height, step);
        blocked ||= k.blocked;
        support = Math.max(support, k.support);
      }
    return { blocked, support };
  }

  /** what is resident: cells, the pools' free blocks; the cells wanted, those missing */
  stats() {
    return {
      cells: [...this.residents.values()].filter((r) => r.slot >= 0).length,
      wanted: this.wanted.size,
      missing: [...this.wanted.keys()].filter((k) => !this.residents.has(k)).length,
      vertBlocks: this.vertPool.blocks,
      freeVertBlocks: this.vertPool.freeBlocks,
      triBlocks: this.triPool.blocks,
      freeTriBlocks: this.triPool.freeBlocks,
      recBlocks: this.layout?.blocks ?? 0,
      freeRecBlocks: this.recPool?.freeBlocks ?? 0,
      ...this.counts,
      groundMs: Math.round(this.counts.groundMs),
    };
  }

  dispose() {
    this.unlisten?.();
    this.unlisten = null;
    this.residents.clear();
    this.raster.nearRelease();
  }
}
