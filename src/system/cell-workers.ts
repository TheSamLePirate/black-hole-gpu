// PLAN-J8 J8-3 — the building cells' pool in the page (cell-pool.ts): its executor a bounded set of workers (cell-worker.js, each one
// cell at a time), its store the prepared cache (Cache Storage, CELL_CACHE). The workers' count: two, three on a machine with eight
// cores or more — the scenery's worker, the CPU worker and the page's own thread keep theirs.
import { CellPool, type CellExecutor, type CellPrepared, type CellStore, CELL_CACHE, cellCacheUrl } from "./cell-pool";
import { readHeader } from "./building-cells";
import { geoidMap } from "./geoid-grid";
import { FOREST_CACHE, forestCacheUrl } from "./forest-cells";
import { MESH_CACHE, meshCacheUrl } from "./mesh-cells";
import { STREET_CACHE, streetCacheUrl, streetCellComplete } from "./street-cells";
import { prepareZoneCells, type ZoneCells } from "./zone-cells";

type Reply = { id: number; buf?: ArrayBuffer; ms?: number; error?: string };

/** the workers: each `run` given to an idle one; an abort cancels its fetch */
export class CellWorkers implements CellExecutor {
  readonly size: number;
  private workers: { w: Worker; busy: boolean }[] = [];
  private next = 1;
  /** the geoid's grid given to the workers (it may come in after them: given at the first run once it is) */
  private geoidGiven = false;
  private calls = new Map<number, { ok: (r: { buf: ArrayBuffer; ms: number }) => void; no: (e: Error) => void }>();

  constructor(
    size = (navigator.hardwareConcurrency ?? 4) >= 8 ? 3 : 2,
    url = "cell-worker.js",
    /** the cells it prepares: the buildings' (J8-3), the streets' (J8-L), the near meshes' (J8-8) */
    private kind: "building" | "street" | "mesh" | "forest" = "building",
  ) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL(url, location.href), { type: "module" });
      w.onmessage = (e: MessageEvent<Reply>) => {
        const c = this.calls.get(e.data.id);
        if (!c) return;
        this.calls.delete(e.data.id);
        if (e.data.buf) c.ok({ buf: e.data.buf, ms: e.data.ms ?? 0 });
        else c.no(new Error(e.data.error ?? "the cell worker failed"));
      };
      this.workers.push({ w, busy: false });
    }
  }

  run(x: number, y: number, signal: AbortSignal): Promise<{ buf: ArrayBuffer; ms: number }> {
    if (!this.geoidGiven) this.geoidIn();
    const slot = this.workers.find((s) => !s.busy) ?? this.workers[0]!;
    slot.busy = true;
    const id = this.next++;
    return new Promise<{ buf: ArrayBuffer; ms: number }>((ok, no) => {
      this.calls.set(id, { ok, no });
      signal.addEventListener("abort", () => {
        slot.w.postMessage({ cancel: id });
        this.calls.delete(id);
        no(new Error("cancelled"));
      });
      slot.w.postMessage({ id, x, y, kind: this.kind });
    }).finally(() => {
      slot.busy = false;
    });
  }

  /** the geoid's grid given to the workers once it is in (the page loads it with the Earth's maps) */
  geoidIn() {
    const geoid = geoidMap();
    if (!geoid) return;
    for (const s of this.workers) s.w.postMessage({ geoid });
    this.geoidGiven = true;
  }

  /** the workers ended — their calls under way failed (« disposed »), not left pending: a zone's preparation stopped mid-way never
   *  waits on a worker gone */
  dispose() {
    for (const s of this.workers) s.w.terminate();
    this.workers = [];
    const pending = [...this.calls.values()];
    this.calls.clear();
    for (const c of pending) c.no(new Error("the cell workers were disposed"));
  }
}

async function readBuildingCell(store: Cache, x: number, y: number): Promise<ArrayBuffer | null> {
  try {
    const response = await store.match(cellCacheUrl(location.origin, x, y));
    return response ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** the prepared cache, read by the page */
export const cellStore: CellStore = {
  async get(x, y) {
    try {
      return await readBuildingCell(await caches.open(CELL_CACHE), x, y);
    } catch {
      return null;
    }
  },
};

/** Read a census from the prepared cache with a bounded group of reads in flight. */
export async function readBuildingCells(tiles: readonly { x: number; y: number }[]) {
  const cells: { x: number; y: number; buf: ArrayBuffer }[] = [];
  const store = await globalThis.caches?.open(CELL_CACHE).catch(() => null);
  if (!store) return cells;
  const batchSize = 16;
  for (let i = 0; i < tiles.length; i += batchSize) {
    const batch = await Promise.all(
      tiles.slice(i, i + batchSize).map(async (tile) => {
        const buf = await readBuildingCell(store, tile.x, tile.y);
        return buf ? { ...tile, buf } : null;
      }),
    );
    for (const cell of batch) if (cell) cells.push(cell);
  }
  return cells;
}

/** the game's pool (made at its first use) */
let pool: CellPool | null = null;
export function cellPool(): CellPool {
  pool ??= new CellPool(new CellWorkers(), cellStore);
  return pool;
}

/** the prepared streets' cache, read by the page (PLAN-J8 J8-L) */
export const streetStore: CellStore = {
  async get(x, y) {
    try {
      const r = await (await caches.open(STREET_CACHE)).match(streetCacheUrl(location.origin, x, y));
      const buf = r ? await r.arrayBuffer() : null;
      // (review A3: an incomplete cell — prepared without its building cell — not a hit: prepared again, its entry replaced)
      return buf && streetCellComplete(buf) ? buf : null;
    } catch {
      return null;
    }
  },
};

/** the streets' pool (PLAN-J8 J8-L: the lamps and the cars' roads in cells — street-cells.ts), its own workers (two): made at its
 *  first use; the far layer asks it as it asks cellPool, its reach its own (the lamps' ~12 km — the render session's parameter) */
let streets: CellPool | null = null;
/** the streets' pool if it was made (null: never asked — flightReady reads it without making its workers) */
export const streetPoolMade = () => streets;
/** (25 Nov 2026) who hears the street cells handed — the relief's levelling (renderer.ts → EarthTiles.streetCellsArrived) —, the
 *  pool made or not yet: held here, listening once it is */
const streetHearers = new Set<(c: CellPrepared) => void>();
export function onStreetCell(fn: (c: CellPrepared) => void): () => void {
  streetHearers.add(fn);
  const off = streets?.listen(fn);
  return () => {
    streetHearers.delete(fn);
    off?.();
  };
}
export function streetPool(): CellPool {
  if (!streets) {
    void sweepStreetCaches();
    streets = new CellPool(new CellWorkers(2, "cell-worker.js", "street"), streetStore);
    for (const fn of streetHearers) streets.listen(fn);
  }
  return streets;
}

/** the older formats' street caches (kerr-street-v1, -v2: never read again — the format is in the name) deleted, once a page asks */
async function sweepStreetCaches() {
  try {
    for (const n of await caches.keys()) if (/^kerr-street-v\d+$/.test(n) && n !== STREET_CACHE) await caches.delete(n);
  } catch {
    /* (no Cache Storage: nothing kept to sweep) */
  }
}

/** the near meshes' prepared cache, read by the page (PLAN-J8 J8-8, mesh-cells.ts): a mesh cell is keyed by its building cell's
 *  generation — read first: no building cell, no mesh cell — and whether the canopy served it (that one first) */
export const meshStore: CellStore = {
  async get(x, y) {
    try {
      const cell = await cellStore.get(x, y);
      const h = cell ? readHeader(cell) : null;
      if (!h) return null;
      const c = await caches.open(MESH_CACHE);
      const r =
        (await c.match(meshCacheUrl(location.origin, x, y, h.generation, true))) ??
        (await c.match(meshCacheUrl(location.origin, x, y, h.generation, false)));
      return r ? await r.arrayBuffer() : null;
    } catch {
      return null;
    }
  },
};
/** the near meshes' pool (PLAN-J8 J8-8: made at its first use — the render session's GPU reserve asks it, lot 2 —), its own workers */
let meshes: CellPool | null = null;
/** the meshes' pool if it was made (null: never asked — flightReady reads it without making its workers) */
export const meshPoolMade = () => meshes;
export function meshPool(): CellPool {
  meshes ??= new CellPool(new CellWorkers(2, "cell-worker.js", "mesh"), meshStore);
  return meshes;
}

/** the forest cells' prepared cache, read by the page (PLAN-J8 J8-8b, forest-cells.ts): keyed by its building cell's generation (read
 *  first) and whether the canopy served it (that one first) */
export const forestStore: CellStore = {
  async get(x, y) {
    try {
      const cell = await cellStore.get(x, y);
      const h = cell ? readHeader(cell) : null;
      if (!h) return null;
      const c = await caches.open(FOREST_CACHE);
      const r =
        (await c.match(forestCacheUrl(location.origin, x, y, h.generation, true))) ??
        (await c.match(forestCacheUrl(location.origin, x, y, h.generation, false)));
      return r ? await r.arrayBuffer() : null;
    } catch {
      return null;
    }
  },
};
/** the forest cells' pool (PLAN-J8 J8-8b: made at its first use — the render session's scene asks it, lot 2 —), its own workers */
let forests: CellPool | null = null;
/** the forests' pool if it was made (null: never asked) */
export const forestPoolMade = () => forests;
export function forestPool(): CellPool {
  forests ??= new CellPool(new CellWorkers(2, "cell-worker.js", "forest"), forestStore);
  return forests;
}

/** an offline zone's cells (PLAN-J8 J8-6, pwa-zones.ts): prepared by a worker of their own — the download runs behind the game —,
 *  dropped from the prepared cache (the game's pool told: a cell dropped is prepared again when next wanted) */
export const zoneCellsIO = {
  async prepare(tiles: { x: number; y: number }[]): Promise<ZoneCells> {
    const w = new CellWorkers(1);
    try {
      return await prepareZoneCells(tiles, w, cellStore);
    } finally {
      w.dispose();
    }
  },
  /** its street cells (J8-L): a street worker of their own */
  async prepareStreets(tiles: { x: number; y: number }[]): Promise<ZoneCells> {
    const w = new CellWorkers(1, "cell-worker.js", "street");
    try {
      return await prepareZoneCells(tiles, w, streetStore);
    } finally {
      w.dispose();
    }
  },
  /** its mesh cells (J8-8): a mesh worker of their own */
  async prepareMeshes(tiles: { x: number; y: number }[]): Promise<ZoneCells> {
    const w = new CellWorkers(1, "cell-worker.js", "mesh");
    try {
      return await prepareZoneCells(tiles, w, meshStore);
    } finally {
      w.dispose();
    }
  },
  /** its forest cells (J8-8b): a forest worker of their own */
  async prepareForests(tiles: { x: number; y: number }[]): Promise<ZoneCells> {
    const w = new CellWorkers(1, "cell-worker.js", "forest");
    try {
      return await prepareZoneCells(tiles, w, forestStore);
    } finally {
      w.dispose();
    }
  },
  async dropForests(tiles: { x: number; y: number }[]): Promise<void> {
    try {
      const c = await caches.open(FOREST_CACHE);
      const gone = new Set(tiles.map((t) => `/${t.x}/${t.y}.kfc`));
      for (const k of await c.keys()) {
        const p = new URL(k.url).pathname;
        if (gone.has(p.slice(p.lastIndexOf("/", p.lastIndexOf("/") - 1)))) await c.delete(k);
      }
      for (const t of tiles) forests?.forget(t.x, t.y);
    } catch {
      /* no Cache Storage: nothing kept */
    }
  },
  /** (every generation's and canopy's key of these cells: the cache's keys listed once) */
  async dropMeshes(tiles: { x: number; y: number }[]): Promise<void> {
    try {
      const c = await caches.open(MESH_CACHE);
      const gone = new Set(tiles.map((t) => `/${t.x}/${t.y}.kmc`));
      for (const k of await c.keys()) {
        const p = new URL(k.url).pathname;
        if (gone.has(p.slice(p.lastIndexOf("/", p.lastIndexOf("/") - 1)))) await c.delete(k);
      }
      for (const t of tiles) meshes?.forget(t.x, t.y);
    } catch {
      /* no Cache Storage: nothing kept */
    }
  },
  async dropStreets(tiles: { x: number; y: number }[]): Promise<void> {
    try {
      const c = await caches.open(STREET_CACHE);
      for (const t of tiles) {
        await c.delete(streetCacheUrl(location.origin, t.x, t.y));
        streets?.forget(t.x, t.y);
      }
    } catch {
      /* no Cache Storage: nothing kept */
    }
  },
  async drop(tiles: { x: number; y: number }[]): Promise<void> {
    try {
      const c = await caches.open(CELL_CACHE);
      for (const t of tiles) {
        await c.delete(cellCacheUrl(location.origin, t.x, t.y));
        pool?.forget(t.x, t.y);
      }
    } catch {
      /* no Cache Storage: nothing kept */
    }
  },
};
