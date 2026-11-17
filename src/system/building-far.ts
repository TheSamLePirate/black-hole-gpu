// PLAN-J8 J8-4 — the far buildings' layer in the page (docs/PLAN-J8-BATIMENTS.md §2): the cells round the eye asked of the preparation
// pool (cell-workers.ts cellPool — J8-3: the BD TOPO's z 15 tiles decoded into the contract's records, from the prepared cache first),
// in the order of residence (building-layer.ts: in view and near, on the track, a reserve behind, the rest); each cell handed put into
// the GPU's record pool by blocks (building-layer.ts RecordPool) under its declared budget — the farthest of the least wanted let go
// when a nearer one does not fit —, its frame in the scene's written (moved with the scene); drawn by SceneryRaster (culled by the
// GPU, boxes and quads, the shadow map). The near scene keeps its own buildings: those within its reach are left out (maskR).
import { CELL_Z, cellKey, cellOf, cellOrigin, fromCell, readHeader, recordWords } from "./building-cells";
import { cellFrameInScene, cellPriority, type EyeState, POOL_RECORD_BYTES, RecordPool } from "./building-layer";
import type { CellPool, CellPrepared, CellWant } from "./cell-pool";
import { type Region, regionOf } from "./roofs";
import { sceneryFrame } from "./scenery-data";
import type { SceneryRaster } from "./scenery-raster";

/** the layer's reach round the eye [m] (the pixel's limit: ~15 km for a 10 m building, ~30 km for 20 m — §0; the first lot's) */
export const FAR_REACH_M = 20000;
/** its pool's budget [bytes] — 72 MiB (Sam's decision of 16 Nov 2026 ~18:45 UTC, « ok 72 »: all Paris resident — 1 947 cells, 1,12 M
 *  buildings — for +1.9 ms on the M1 Max, +3.7 ms on kerr-mini; the nearest first, the flight's corridor first, past it) */
export const FAR_BUDGET_BYTES = 72 * 1024 * 1024;
/** the cells' frames held at once */
export const FAR_SLOTS = 4096;
/** under this projected size [px] a building one quad facing the camera (Sam's decision of 16 Nov 2026) */
export const FAR_QUAD_PX = 8;

interface Resident {
  x: number;
  y: number;
  slot: number;
  blocks: number[];
  records: number;
  /** when it was put [ms]: its fade-in over FAR_FADE_MS (its frame's origin.w, farFs's scatter) */
  at: number;
  /** its drawn ground's plane (groundPlane), sampled once */
  plane?: [number, number, number];
}
/** PLAN-J8 J8-5: the near scene's buildings within this of its corridor alone while the layer draws [m] (§2: the meshes' reach) */
export const FAR_NEAR_ONLY_M = 2000;
/** the regions in the order trace.wgsl's farRoofAlbedo / farWallAlbedo read them (roofs.ts Region: their roofs' default, their colours) */
export const FAR_REGIONS: readonly Region[] = [
  "paris",
  "france-west",
  "france-north",
  "france-south",
  "alpine",
  "mediterranean",
  "north",
  "temperate",
];
/** a cell refused for the budget asked again once the eye moved this far [m] */
export const REFUSED_MOVE_M = 2000;
/** a cell's fade-in once put [ms] */
export const FAR_FADE_MS = 1000;

export class BuildingFar {
  private pool: RecordPool;
  private residents = new Map<string, Resident>();
  private freeSlots: number[];
  private wantedAt: { lat: number; lon: number; heading: number; t: number } | null = null;
  private wanted = new Map<string, CellWant>();
  /** cells refused for the budget, and where the eye was then: not asked again until it moved REFUSED_MOVE_M (a city past the pool
   *  asked its refused cells every 2 s — Paris: 3 735 refusals, the preparation pool kept busy for nothing, 16 Nov 2026) */
  private refused = new Map<string, { lat: number; lon: number }>();
  private sceneKey = "";
  private frame: ReturnType<typeof sceneryFrame> | null = null;
  private unlisten: (() => void) | null = null;
  private initing = false;
  /** under this projected size [px] one quad facing the camera (FAR_QUAD_PX; 0: boxes all — a lever to compare their looks) */
  quadPx = FAR_QUAD_PX;
  /** the far buildings drawn with their own materials (PLAN-J8 J8-A: their roof's and walls' from the record, farMat — the near mesh's
   *  colours); false: the look of a near building without a leaf (generic) — a lever to compare */
  materials = true;
  /** PLAN-J8 J8-8: the cells drawn as the near meshes' (near-meshes.ts residents) — theirs not drawn here (their frame's share −1) */
  private hidden = new Set<string>();
  /** the cells now drawn as the near meshes': those changed have their frame written again */
  setHidden(keys: ReadonlySet<string>, now: number) {
    const changed: string[] = [];
    for (const k of keys) if (!this.hidden.has(k)) changed.push(k);
    for (const k of this.hidden) if (!keys.has(k)) changed.push(k);
    if (!changed.length) return;
    this.hidden = new Set(keys);
    for (const k of changed) {
      const r = this.residents.get(k);
      if (r && r.slot >= 0) this.writeFrame(r, now);
    }
  }
  /** the region the eye is in (FAR_REGIONS' index) */
  private region = 0;
  /** the counts: cells handed, put, let go, too big to fit */
  readonly counts = { handed: 0, put: 0, evicted: 0, refused: 0, empty: 0 };

  /**
   * The ground as drawn at a place [°] → its height over the ellipsoid [m] (the renderer's: groundBare): the cells whose records give
   * none (Overture's, OSM's — building-cells.ts, GroundKnown absent) set on a plane through it; null: none (their ground 0)
   */
  groundAt: ((lat: number, lon: number) => number) | null = null;

  constructor(
    private raster: SceneryRaster,
    private cells: () => CellPool,
    budgetBytes = FAR_BUDGET_BYTES,
  ) {
    this.pool = new RecordPool(budgetBytes);
    this.freeSlots = Array.from({ length: FAR_SLOTS }, (_, i) => FAR_SLOTS - 1 - i);
  }

  /**
   * Each frame the layer may draw: the eye (null: away — nothing asked), the drawn scene's centre (the frame the GPU draws in) and the
   * reach its own buildings keep [m] from its corridor (its end at the eye from the centre, m east and north — null: from the centre),
   * a building's leaf (the material, for now).
   */
  update(
    eye: EyeState | null,
    scene: { lat: number; lon: number } | null,
    maskR: number,
    leaf: number,
    now: number,
    corridor: readonly [number, number] | null = null,
  ) {
    if (!this.raster.farReady) {
      if (!this.initing) {
        this.initing = true;
        void this.raster.farInit(this.pool.blocks, FAR_SLOTS).then(() => {
          this.unlisten = this.cells().listen((c) => this.put(c));
        });
      }
      return;
    }
    // (the scene moved — a new one published —: every resident cell's frame in the new scene's)
    const key = scene ? `${scene.lat.toFixed(6)}:${scene.lon.toFixed(6)}` : "";
    if (key !== this.sceneKey) {
      this.sceneKey = key;
      this.frame = scene ? sceneryFrame(scene.lat, scene.lon) : null;
      if (this.frame) for (const r of this.residents.values()) if (r.slot >= 0) this.writeFrame(r, now);
    }
    // (the cells fading in: their share written each frame until whole)
    if (this.frame) for (const r of this.residents.values()) if (r.slot >= 0 && now - r.at < FAR_FADE_MS + 100) this.writeFrame(r, now);
    this.raster.farOn = !!this.frame;
    this.raster.farParams(maskR, leaf, this.quadPx, this.materials ? 0.5 : 0, corridor, this.region);
    if (!eye) return;
    this.region = Math.max(0, FAR_REGIONS.indexOf(regionOf(eye.lat, eye.lon)));
    // (the cells wanted asked again when the eye moved 300 m, turned 10°, or 2 s on)
    const w = this.wantedAt;
    const cosL = Math.cos((eye.lat * Math.PI) / 180);
    const moved = !w || Math.hypot((eye.lat - w.lat) * 111320, (eye.lon - w.lon) * 111320 * cosL) > 300;
    const turned = !!w && Math.abs(Math.atan2(Math.sin(eye.heading - w.heading), Math.cos(eye.heading - w.heading))) > 0.17;
    if (moved || turned || now - (w?.t ?? 0) > 2000) {
      this.wantedAt = { lat: eye.lat, lon: eye.lon, heading: eye.heading, t: now };
      this.want(eye);
    }
  }

  /** the cells within reach, their order, asked of the preparation pool; those resident not asked again */
  private want(eye: EyeState) {
    const c = cellOf(eye.lat, eye.lon);
    const side = (40075016 * Math.cos((eye.lat * Math.PI) / 180)) / 2 ** CELL_Z;
    const k = Math.ceil(FAR_REACH_M / side) + 1;
    const list: CellWant[] = [];
    const n = 2 ** CELL_Z;
    this.wanted.clear();
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        const x = (((c.x + i) % n) + n) % n,
          y = c.y + j;
        if (y < 0 || y >= n) continue;
        const [priority, d] = cellPriority(x, y, eye);
        if (d > FAR_REACH_M) continue;
        const want = { x, y, priority: priority as CellWant["priority"], d };
        this.wanted.set(cellKey(x, y), want);
        const r = this.refused.get(cellKey(x, y));
        if (r && Math.hypot((eye.lat - r.lat) * 111320, (eye.lon - r.lon) * 111320 * Math.cos((eye.lat * Math.PI) / 180)) < REFUSED_MOVE_M)
          continue;
        if (r) this.refused.delete(cellKey(x, y));
        if (!this.residents.has(cellKey(x, y))) list.push(want);
      }
    this.cells().want(list);
    // (resident cells past the reach and a margin let go: their blocks for the nearer)
    for (const [key, r] of this.residents) if (!this.wanted.has(key) && cellPriority(r.x, r.y, eye)[1] > FAR_REACH_M * 1.3) this.evict(key);
  }

  /** a cell handed: into the pool's blocks — the least wanted farthest let go first when it does not fit */
  private put(c: CellPrepared) {
    this.counts.handed++;
    const key = cellKey(c.x, c.y);
    if (this.residents.has(key)) return;
    // (not taken — no scene's frame yet, not wanted any more, not a cell —: asked again when next wanted)
    const h = readHeader(c.buf);
    const want = this.wanted.get(key);
    if (!this.frame || !h || !want) {
      this.cells().forget(c.x, c.y);
      return;
    }
    if (h.count === 0) {
      this.counts.empty++;
      this.residents.set(key, { x: c.x, y: c.y, slot: -1, blocks: [], records: 0, at: 0 });
      return;
    }
    let blocks = this.pool.alloc(key, h.count);
    while (!blocks) {
      // (the worst resident — its order's class, then its distance — let go if worse than this one)
      let worst: [string, number, number] | null = null;
      for (const [k2, r] of this.residents) {
        if (!r.blocks.length) continue;
        const p = this.wanted.get(k2);
        const rank = p ? p.priority : 4,
          d = p ? p.d : Number.POSITIVE_INFINITY;
        if (!worst || rank > worst[1] || (rank === worst[1] && d > worst[2])) worst = [k2, rank, d];
      }
      if (!worst || worst[1] < want.priority || (worst[1] === want.priority && worst[2] <= want.d)) {
        this.counts.refused++;
        if (this.wantedAt) this.refused.set(key, { lat: this.wantedAt.lat, lon: this.wantedAt.lon });
        this.cells().forget(c.x, c.y);
        return;
      }
      this.evict(worst[0]);
      blocks = this.pool.alloc(key, h.count);
    }
    const slot = this.freeSlots.pop();
    if (slot === undefined) {
      this.pool.release(blocks);
      this.counts.refused++;
      this.cells().forget(c.x, c.y);
      return;
    }
    const r: Resident = { x: c.x, y: c.y, slot, blocks, records: h.count, at: performance.now() };
    this.writeFrame(r, r.at);
    this.raster.farUpload(blocks, recordWords(c.buf), slot);
    this.residents.set(key, r);
    this.counts.put++;
  }

  /** a resident cell's frame in the scene's, its fade-in's share in its origin's w, its drawn ground's plane in its axes' w */
  private writeFrame(r: Resident, now: number) {
    if (!this.frame) return;
    const f = cellFrameInScene(r.x, r.y, this.frame);
    // (its fade-in share; −1: drawn as the near meshes' — hidden, none of it culled in)
    f[3] = this.hidden.has(cellKey(r.x, r.y)) ? -1 : Math.min(Math.max((now - r.at) / FAR_FADE_MS, 0), 1);
    r.plane ??= this.groundPlane(r.x, r.y);
    f[7] = r.plane[0];
    f[11] = r.plane[1];
    f[15] = r.plane[2];
    this.raster.farFrame(r.slot, f);
  }
  /** the drawn ground under a cell as a plane: its height at the origin [m over the ellipsoid], its slopes east and north [m/m] — five
   *  samples (the origin, 300 m each way) */
  private groundPlane(x: number, y: number): [number, number, number] {
    const g = this.groundAt;
    if (!g) return [0, 0, 0];
    const o = cellOrigin(x, y);
    const D = 300;
    const at = (e: number, n: number) => {
      const p = fromCell(o, e, n);
      return g(p.lat, p.lon);
    };
    const h0 = at(0, 0);
    const se = (at(D, 0) - at(-D, 0)) / (2 * D),
      sn = (at(0, D) - at(0, -D)) / (2 * D);
    return [h0, se, sn];
  }

  private evict(key: string) {
    const r = this.residents.get(key);
    if (!r) return;
    if (r.blocks.length) {
      this.raster.farClear(r.blocks);
      this.pool.release(r.blocks);
    }
    if (r.slot >= 0) this.freeSlots.push(r.slot);
    this.residents.delete(key);
    this.cells().forget(r.x, r.y);
    this.counts.evicted++;
  }

  /** what is resident: cells, their records, the pool's blocks free, its budget [bytes]; the cells wanted, those still missing */
  stats() {
    let records = 0;
    for (const r of this.residents.values()) records += r.records;
    return {
      cells: this.residents.size,
      records,
      freeBlocks: this.pool.freeBlocks,
      blocks: this.pool.blocks,
      budgetBytes: this.pool.bytes,
      recordBytes: POOL_RECORD_BYTES,
      wanted: this.wanted.size,
      /** the cells wanted not resident yet (the empty ones count as resident; those refused for the budget stay missing: a city past the
       *  pool is not « all in ») — __bh.sys.flightReady (J8-A) */
      missing: [...this.wanted.keys()].filter((k) => !this.residents.has(k)).length,
      /** of those, refused for the budget (the pool full of nearer ones — the farthest go first) */
      missingRefused: [...this.wanted.keys()].filter((k) => !this.residents.has(k) && this.refused.has(k)).length,
      /** the nearest cell wanted and not resident [m] (null: none missing) — whether a missing one can be seen (J8-A, Paris: 20 km past
       *  72 MiB, 16 Nov 2026) */
      missingNearestM: (() => {
        let d = Number.POSITIVE_INFINITY;
        for (const [k, w] of this.wanted) if (!this.residents.has(k)) d = Math.min(d, w.d);
        return Number.isFinite(d) ? Math.round(d) : null;
      })(),
      ...this.counts,
    };
  }

  dispose() {
    this.unlisten?.();
    this.unlisten = null;
    this.residents.clear();
    this.raster.farRelease();
  }
}
