// PLAN-J8 J8-4 — the far buildings' layer, its CPU side (docs/PLAN-J8-BATIMENTS.md §2): which cells are resident on the GPU and where.
// Pure: no WebGPU (the renderer's part uploads what this decides). Three things:
//  - the record pool: the GPU's buffer of records (building-cells.ts, 12 words a building) handed out in blocks of BLOCK_RECORDS, a
//    cell's records in whole blocks (its tail block's rest unused), a budget declared in bytes — never past it: a cell that does not
//    fit waits for an older one let go;
//  - the order of residence, the same from the eye to the GPU (§2): in view and near first, then along the trajectory (the speed's
//    lead), then a reserve behind, then the rest — each cell a rank and, within it, its distance;
//  - each cell's frame in the scene's (scenery-data.ts sceneryFrame): its origin and its east-north-up axes in the scene's frame, the
//    16 floats (4 vec4s) the GPU turns a record's east, north and height with (the scene moves: computed again, a cell's own data untouched).
import { cellOrigin } from "./building-cells";
import { localPoint, type sceneryFrame } from "./scenery-data";

/** a block of the pool: its records */
export const BLOCK_RECORDS = 256;
/** a record's bytes on the GPU (building-cells.ts RECORD_BYTES) */
export const POOL_RECORD_BYTES = 48;

/** The GPU's record pool, by blocks: a cell's records in whole blocks, the free ones reused first, lowest first. */
export class RecordPool {
  readonly blocks: number;
  private free: number[];
  private owner: (string | null)[];
  constructor(budgetBytes: number) {
    this.blocks = Math.max(0, Math.floor(budgetBytes / (BLOCK_RECORDS * POOL_RECORD_BYTES)));
    this.free = Array.from({ length: this.blocks }, (_, i) => this.blocks - 1 - i);
    this.owner = new Array(this.blocks).fill(null);
  }
  /** the bytes the pool holds on the GPU (its declared budget, in whole blocks) */
  get bytes() {
    return this.blocks * BLOCK_RECORDS * POOL_RECORD_BYTES;
  }
  get freeBlocks() {
    return this.free.length;
  }
  /** blocks for `records` records of a cell, lowest first; null: not enough free (nothing taken) */
  alloc(cell: string, records: number): number[] | null {
    const n = Math.ceil(records / BLOCK_RECORDS);
    if (n > this.free.length) return null;
    const got = this.free.splice(this.free.length - n, n).reverse();
    for (const b of got) this.owner[b] = cell;
    return got;
  }
  /** a cell's blocks back to the pool */
  release(blocks: readonly number[]) {
    for (const b of blocks) {
      if (this.owner[b] === null) continue;
      this.owner[b] = null;
      this.free.push(b);
    }
    // (lowest first next: the pool's front fills before its back — a smaller draw range)
    this.free.sort((a, b) => b - a);
  }
  /** the cell owning a block (null: free) */
  ownerOf(block: number) {
    return this.owner[block] ?? null;
  }
}

/** Where the eye is and goes: its place [°], its heading [rad from north, clockwise], its ground speed [m/s], its half field [rad]. */
export interface EyeState {
  lat: number;
  lon: number;
  heading: number;
  speed: number;
  halfFov: number;
}
/** the lead along the trajectory a cell is looked for at [s of flight] (§2: « sur la trajectoire prédite ») */
export const TRAJECTORY_S = 60;
/** a reserve kept behind [m] */
export const BEHIND_M = 3000;

/**
 * A cell's place in the order of residence (lower first): [its rank, its distance [m]]. Rank 0: in the field of view (its centre
 * within the half field plus its own angular size) and within `nearM`; 1: within the trajectory's lead (speed × TRAJECTORY_S ahead,
 * a corridor a field's width) or in view farther; 2: within BEHIND_M behind or beside; 3: the rest.
 */
export function cellPriority(x: number, y: number, eye: EyeState, nearM = 15000): [number, number] {
  const o = cellOrigin(x, y);
  const cosL = Math.cos((eye.lat * Math.PI) / 180);
  const e = (o.lon - eye.lon) * 111320 * cosL,
    n = (o.lat - eye.lat) * 111320;
  const d = Math.hypot(e, n);
  // (its bearing from the eye against the heading — both from north, clockwise)
  const bearing = Math.atan2(e, n);
  let off = bearing - eye.heading;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  // (a cell is ~0.9 km a side: its own half angle seen from d)
  const own = Math.atan2(650, Math.max(d, 1));
  const inView = Math.abs(off) <= eye.halfFov + own || d < 1300;
  if (inView && d <= nearM) return [0, d];
  const along = d * Math.cos(off),
    across = Math.abs(d * Math.sin(off));
  const lead = eye.speed * TRAJECTORY_S;
  if ((along > 0 && along <= lead && across <= Math.max(1500, along * Math.tan(eye.halfFov))) || inView) return [1, d];
  if (d <= BEHIND_M) return [2, d];
  return [3, d];
}

/** cells in their order of residence (cellPriority), nearest first within a rank */
export function orderCells<T extends { x: number; y: number }>(cells: readonly T[], eye: EyeState, nearM?: number): T[] {
  const keyed = cells.map((c) => ({ c, p: cellPriority(c.x, c.y, eye, nearM) }));
  keyed.sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  return keyed.map((k) => k.c);
}

/**
 * A cell's frame in the scene's: 16 floats (4 vec4s) — its origin [m], then its east, north and up axes, each in the scene's frame (vec4s, w 0)
 * — so a record's point (east, north, height over the ellipsoid) goes to the scene's frame as origin + east·e + north·n + (h − 0)·u,
 * the tangent plane's own curvature left out (a cell is under 1 km: under 8 cm). The axes taken by differences of localPoint 1 m
 * apart: the scene's frame and the cell's on the same ellipsoid (WGS84).
 */
export function cellFrameInScene(x: number, y: number, frame: ReturnType<typeof sceneryFrame>): Float32Array {
  const o = cellOrigin(x, y);
  const p0 = localPoint(frame, o.lat, o.lon, 0);
  const D = 180 / Math.PI;
  const R = 6378137;
  const cosL = Math.cos(o.lat / D);
  const pe = localPoint(frame, o.lat, o.lon + (1 / (R * cosL)) * D, 0),
    pn = localPoint(frame, o.lat + (1 / R) * D, o.lon, 0),
    pu = localPoint(frame, o.lat, o.lon, 1);
  const axis = (p: number[]) => {
    const v = [p[0]! - p0[0], p[1]! - p0[1], p[2]! - p0[2]];
    const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return [v[0]! / l, v[1]! / l, v[2]! / l, 0];
  };
  return new Float32Array([p0[0], p0[1], p0[2], 0, ...axis(pe), ...axis(pn), ...axis(pu)]);
}
