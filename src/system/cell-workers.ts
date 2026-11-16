// PLAN-J8 J8-3 — the building cells' pool in the page (cell-pool.ts): its executor a bounded set of workers (cell-worker.js, each one
// cell at a time), its store the prepared cache (Cache Storage, CELL_CACHE). The workers' count: two, three on a machine with eight
// cores or more — the scenery's worker, the CPU worker and the page's own thread keep theirs.
import { CellPool, type CellExecutor, type CellStore, CELL_CACHE, cellCacheUrl } from "./cell-pool";
import { geoidMap } from "./geoid-grid";
import { STREET_CACHE, streetCacheUrl } from "./street-cells";
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
    /** the cells it prepares: the buildings' (J8-3), the streets' (J8-L) */
    private kind: "building" | "street" = "building",
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

  dispose() {
    for (const s of this.workers) s.w.terminate();
    this.workers = [];
  }
}

/** the prepared cache, read by the page */
export const cellStore: CellStore = {
  async get(x, y) {
    try {
      const r = await (await caches.open(CELL_CACHE)).match(cellCacheUrl(location.origin, x, y));
      return r ? await r.arrayBuffer() : null;
    } catch {
      return null;
    }
  },
};

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
      return r ? await r.arrayBuffer() : null;
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
export function streetPool(): CellPool {
  streets ??= new CellPool(new CellWorkers(2, "cell-worker.js", "street"), streetStore);
  return streets;
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
