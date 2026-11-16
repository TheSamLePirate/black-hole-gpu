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
import { CELL_Z, cellKey, cellOf, fromCell, MESH_NEAR_M } from "./building-cells";
import { cellFrameInScene, cellPriority, type EyeState } from "./building-layer";
import type { CellPool, CellPrepared, CellWant } from "./cell-pool";
import { MeshCellFlag, meshViews, readMeshBuilding, readMeshHeader } from "./mesh-cells";
import { sceneryFrame } from "./scenery-data";
import { NEAR_TRI_BLOCK, NEAR_VERT_BLOCK, type SceneryRaster } from "./scenery-raster";

/** the cells asked round the eye [m] — the « full mesh » distance (building-cells.ts MESH_NEAR_M) and a margin for the turn ahead */
export const NEAR_MESH_REACH_M = MESH_NEAR_M + 500;
/** the reserve's bytes: its vertices' and triangles' (16 bytes each) — ~55 MB resident within 2 km in central Paris, estimated
 *  (PLAN-J8 J8-8, the lot (1) measure) */
export const NEAR_MESH_BUDGET_BYTES = 128 * 1024 * 1024;
/** the cells' frames held at once */
export const NEAR_MESH_SLOTS = 256;

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

interface Resident {
  x: number;
  y: number;
  slot: number;
  vert: number[];
  tri: number[];
  buildings: number;
  triangles: number;
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
): { pos: Float32Array; tris: Uint32Array } | null {
  const h = readMeshHeader(buf);
  if (!h) return null;
  const v = meshViews(buf, h);
  const pos = new Float32Array(h.vertices * 4);
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
    for (let i = b.firstVertex; i < end; i++) pos[4 * i + 2]! += g;
  }
  const at = (i: number) => vertBlocks[Math.floor(i / NEAR_VERT_BLOCK)]! * NEAR_VERT_BLOCK + (i % NEAR_VERT_BLOCK);
  const tris = new Uint32Array(h.triangles * 4);
  for (let t = 0; t < h.triangles; t++) {
    tris[4 * t] = at(v.indices[3 * t]!);
    tris[4 * t + 1] = at(v.indices[3 * t + 1]!);
    tris[4 * t + 2] = at(v.indices[3 * t + 2]!);
    tris[4 * t + 3] = v.tags[t]!;
  }
  return { pos, tris };
}

export class NearMeshes {
  private vertPool: BlockPool;
  private triPool: BlockPool;
  private residents = new Map<string, Resident>();
  private freeSlots = Array.from({ length: NEAR_MESH_SLOTS }, (_, i) => NEAR_MESH_SLOTS - 1 - i);
  private wanted = new Map<string, CellWant>();
  private wantedAt: { lat: number; lon: number; heading: number; t: number } | null = null;
  private sceneKey = "";
  private frame: ReturnType<typeof sceneryFrame> | null = null;
  private unlisten: (() => void) | null = null;
  private initing = false;
  readonly counts = { handed: 0, put: 0, evicted: 0, refused: 0, empty: 0, buildings: 0, triangles: 0, groundMs: 0 };
  /** the ground as drawn at a place [°] → its height over the ellipsoid [m] (the renderer's: groundBare) */
  groundAt: ((lat: number, lon: number) => number) | null = null;

  constructor(
    private raster: SceneryRaster,
    private cells: () => CellPool,
    budgetBytes = NEAR_MESH_BUDGET_BYTES,
  ) {
    // (the budget shared: a third the vertices', two thirds the triangles' — a building's ~2 triangles a vertex)
    this.vertPool = new BlockPool(Math.max(1, Math.floor(budgetBytes / 3 / (NEAR_VERT_BLOCK * 16))));
    this.triPool = new BlockPool(Math.max(1, Math.floor((budgetBytes * 2) / 3 / (NEAR_TRI_BLOCK * 16))));
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

  private put(c: CellPrepared) {
    this.counts.handed++;
    const key = cellKey(c.x, c.y);
    if (this.residents.has(key)) return;
    const h = readMeshHeader(c.buf);
    if (!this.frame || !h || !this.wanted.has(key)) {
      this.cells().forget(c.x, c.y);
      return;
    }
    if (h.triangles === 0 || h.flags & MeshCellFlag.SourceLater) {
      this.counts.empty++;
      this.residents.set(key, { x: c.x, y: c.y, slot: -1, vert: [], tri: [], buildings: 0, triangles: 0 });
      return;
    }
    const vert = this.vertPool.alloc(Math.ceil(h.vertices / NEAR_VERT_BLOCK));
    const tri = vert ? this.triPool.alloc(Math.ceil(h.triangles / NEAR_TRI_BLOCK)) : null;
    const slot = vert && tri ? this.freeSlots.pop() : undefined;
    if (!vert || !tri || slot === undefined) {
      if (vert) this.vertPool.release(vert);
      if (tri) this.triPool.release(tri);
      this.counts.refused++;
      this.cells().forget(c.x, c.y);
      return;
    }
    const t0 = performance.now();
    const g = this.groundAt;
    const origin = { lat: h.originLat, lon: h.originLon };
    const ground = (lat: number, lon: number) => (g ? g(lat, lon) : 0);
    const arrays = nearCellArrays(c.buf, vert, (rank, minE, minN, maxE, maxN) => {
      const foot = readMeshBuilding(c.buf, rank).foot;
      if (!g) return Number.isFinite(foot) ? foot : 0;
      // (the lowest of its box's corners and centre on the relief drawn: no wall standing over a slope's foot)
      let lo = Infinity;
      for (const [e, n] of [
        [minE, minN],
        [maxE, minN],
        [minE, maxN],
        [maxE, maxN],
        [(minE + maxE) / 2, (minN + maxN) / 2],
      ] as const) {
        const p = fromCell(origin, e, n);
        lo = Math.min(lo, ground(p.lat, p.lon));
      }
      return lo;
    })!;
    this.counts.groundMs += performance.now() - t0;
    const r: Resident = { x: c.x, y: c.y, slot, vert, tri, buildings: h.buildings, triangles: h.triangles };
    this.writeFrame(r);
    this.raster.nearUpload(vert, arrays.pos, tri, arrays.tris, slot);
    this.residents.set(key, r);
    this.counts.put++;
    this.counts.buildings += h.buildings;
    this.counts.triangles += h.triangles;
  }

  private writeFrame(r: Resident) {
    if (!this.frame || r.slot < 0) return;
    this.raster.nearFrame(r.slot, cellFrameInScene(r.x, r.y, this.frame));
  }

  private evict(key: string) {
    const r = this.residents.get(key);
    if (!r) return;
    if (r.tri.length) {
      this.raster.nearClear(r.tri);
      this.triPool.release(r.tri);
    }
    if (r.vert.length) this.vertPool.release(r.vert);
    if (r.slot >= 0) this.freeSlots.push(r.slot);
    this.counts.buildings -= r.buildings;
    this.counts.triangles -= r.triangles;
    this.residents.delete(key);
    this.cells().forget(r.x, r.y);
    this.counts.evicted++;
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
