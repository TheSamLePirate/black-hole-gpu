// PLAN-J8 J8-L — the far street lamps (Sam, 16 Nov 2026: « idem pour les lampadaires, charger toute la vue »; the analysis session: the far
// lamps take the night's grey's place): the street cells round the eye (cell-workers.ts streetPool — the approaches session's: their lamps,
// street-cells.ts) asked within LAMP_FAR_REACH_M, the nearest first (building-layer.ts cellPriority); each cell's lamps put into a GPU pool
// by blocks of 256 (building-layer.ts RecordPool, its blocks counted for 16-byte lamps), its frame in the scene's written (its drawn ground's
// plane in its axes' w — the cells give no ground); drawn by SceneryRaster (farLampVs: a head as the near ones', lit at night by shadeLite).
// The near scene keeps its own lamps (streetlamps.ts, LAMP_REACH_M round the eye): none drawn within it.
import { CELL_Z, cellKey, cellOf, cellOrigin, fromCell } from "./building-cells";
import { BLOCK_RECORDS, cellFrameInScene, cellPriority, type EyeState, POOL_RECORD_BYTES, RecordPool } from "./building-layer";
import type { CellPool, CellPrepared, CellWant } from "./cell-pool";
import { sceneryFrame } from "./scenery-data";
import type { SceneryRaster } from "./scenery-raster";
import { readLamp, readStreetHeader } from "./street-cells";
import { LAMP_REACH_M } from "./streetlamps";

/** the far lamps' reach round the eye [m] (agreed with the approaches session: 12 km — past it night-roads' baked points) */
export const LAMP_FAR_REACH_M = 12000;
/** the lamps the pool holds (in blocks of 256) */
export const LAMP_FAR_CAPACITY = 262144;
/** the cells' frames held at once */
export const LAMP_FAR_SLOTS = 2048;

interface Resident {
  x: number;
  y: number;
  slot: number;
  blocks: number[];
  lamps: number;
  plane?: [number, number, number];
}

export class StreetFar {
  private pool = new RecordPool((LAMP_FAR_CAPACITY / BLOCK_RECORDS) * BLOCK_RECORDS * POOL_RECORD_BYTES);
  private residents = new Map<string, Resident>();
  private freeSlots = Array.from({ length: LAMP_FAR_SLOTS }, (_, i) => LAMP_FAR_SLOTS - 1 - i);
  private wanted = new Map<string, CellWant>();
  private wantedAt: { lat: number; lon: number; heading: number; t: number } | null = null;
  private sceneKey = "";
  private frame: ReturnType<typeof sceneryFrame> | null = null;
  private unlisten: (() => void) | null = null;
  private initing = false;
  readonly counts = { handed: 0, put: 0, evicted: 0, refused: 0, empty: 0, lamps: 0 };
  /** the ground as drawn at a place [°] → its height over the ellipsoid [m] (the renderer's: groundBare) */
  groundAt: ((lat: number, lon: number) => number) | null = null;

  constructor(
    private raster: SceneryRaster,
    private cells: () => CellPool,
  ) {}

  /** each frame: the eye (null: away), the drawn scene's centre (its frame), whether it is night (the heads drawn) */
  update(eye: EyeState | null, scene: { lat: number; lon: number } | null, night: boolean, now: number) {
    if (!this.raster.lampsReady) {
      if (!this.initing) {
        this.initing = true;
        void this.raster.lampInit(this.pool.blocks, LAMP_FAR_SLOTS).then(() => {
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
    this.raster.lampsOn = !!this.frame && night;
    this.raster.lampParams(LAMP_REACH_M, LAMP_FAR_REACH_M, night);
    if (!eye) return;
    const w = this.wantedAt;
    const cosL = Math.cos((eye.lat * Math.PI) / 180);
    const moved = !w || Math.hypot((eye.lat - w.lat) * 111320, (eye.lon - w.lon) * 111320 * cosL) > 300;
    if (moved || now - (w?.t ?? 0) > 2000) {
      this.wantedAt = { lat: eye.lat, lon: eye.lon, heading: eye.heading, t: now };
      this.want(eye);
    }
  }

  private want(eye: EyeState) {
    const c = cellOf(eye.lat, eye.lon);
    const side = (40075016 * Math.cos((eye.lat * Math.PI) / 180)) / 2 ** CELL_Z;
    const k = Math.ceil(LAMP_FAR_REACH_M / side) + 1;
    const list: CellWant[] = [];
    const n = 2 ** CELL_Z;
    this.wanted.clear();
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        const x = (((c.x + i) % n) + n) % n,
          y = c.y + j;
        if (y < 0 || y >= n) continue;
        const [priority, d] = cellPriority(x, y, eye);
        if (d > LAMP_FAR_REACH_M) continue;
        const want = { x, y, priority: priority as CellWant["priority"], d };
        this.wanted.set(cellKey(x, y), want);
        if (!this.residents.has(cellKey(x, y))) list.push(want);
      }
    this.cells().want(list);
    for (const [key, r] of this.residents)
      if (!this.wanted.has(key) && cellPriority(r.x, r.y, eye)[1] > LAMP_FAR_REACH_M * 1.3) this.evict(key);
  }

  private put(c: CellPrepared) {
    this.counts.handed++;
    const key = cellKey(c.x, c.y);
    if (this.residents.has(key)) return;
    const h = readStreetHeader(c.buf);
    if (!this.frame || !h || !this.wanted.has(key)) {
      this.cells().forget(c.x, c.y);
      return;
    }
    if (h.lampCount === 0) {
      this.counts.empty++;
      this.residents.set(key, { x: c.x, y: c.y, slot: -1, blocks: [], lamps: 0 });
      return;
    }
    const blocks = this.pool.alloc(key, h.lampCount);
    const slot = blocks ? this.freeSlots.pop() : undefined;
    if (!blocks || slot === undefined) {
      if (blocks) this.pool.release(blocks);
      this.counts.refused++;
      this.cells().forget(c.x, c.y);
      return;
    }
    const data = new Float32Array(h.lampCount * 4);
    for (let i = 0; i < h.lampCount; i++) {
      const l = readLamp(c.buf, i);
      data[4 * i] = l.east;
      data[4 * i + 1] = l.north;
      data[4 * i + 2] = l.height;
    }
    const r: Resident = { x: c.x, y: c.y, slot, blocks, lamps: h.lampCount };
    this.writeFrame(r);
    this.raster.lampUpload(blocks, data, slot);
    this.residents.set(key, r);
    this.counts.put++;
    this.counts.lamps += h.lampCount;
  }

  /** a resident cell's frame in the scene's, its drawn ground's plane in its axes' w (five samples, as the far buildings') */
  private writeFrame(r: Resident) {
    if (!this.frame || r.slot < 0) return;
    const f = cellFrameInScene(r.x, r.y, this.frame);
    f[3] = 1;
    r.plane ??= this.groundPlane(r.x, r.y);
    f[7] = r.plane[0];
    f[11] = r.plane[1];
    f[15] = r.plane[2];
    this.raster.lampFrame(r.slot, f);
  }
  private groundPlane(x: number, y: number): [number, number, number] {
    const g = this.groundAt;
    if (!g) return [0, 0, 0];
    const o = cellOrigin(x, y);
    const D = 300;
    const at = (e: number, n: number) => {
      const p = fromCell(o, e, n);
      return g(p.lat, p.lon);
    };
    return [at(0, 0), (at(D, 0) - at(-D, 0)) / (2 * D), (at(0, D) - at(0, -D)) / (2 * D)];
  }

  private evict(key: string) {
    const r = this.residents.get(key);
    if (!r) return;
    if (r.blocks.length) {
      this.raster.lampClear(r.blocks);
      this.pool.release(r.blocks);
      this.counts.lamps -= r.lamps;
    }
    if (r.slot >= 0) this.freeSlots.push(r.slot);
    this.residents.delete(key);
    this.cells().forget(r.x, r.y);
    this.counts.evicted++;
  }

  /** what is resident: cells, lamps, the pool's free blocks; the cells wanted, those missing */
  stats() {
    return {
      cells: this.residents.size,
      freeBlocks: this.pool.freeBlocks,
      blocks: this.pool.blocks,
      wanted: this.wanted.size,
      missing: [...this.wanted.keys()].filter((k) => !this.residents.has(k)).length,
      ...this.counts,
    };
  }

  dispose() {
    this.unlisten?.();
    this.unlisten = null;
    this.residents.clear();
    this.raster.lampRelease();
  }
}
