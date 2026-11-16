// PLAN-J8 J8-3 — the building cells' preparation pool (docs/PLAN-J8-BATIMENTS.md §2): the cells wanted, in their order — in view and
// near (0), on the predicted track (1), a reserve behind (2), the rest (3); within a class the nearest first —, prepared by a bounded
// number of workers (cell-worker.ts: the tile fetched, decoded by cell-prep.ts), each cell looked for in the prepared cache first
// (Cache Storage, keyed by the contract's format: a tile seen or downloaded is never decoded again), a want no longer wanted dropped
// from the queue and its work under way cancelled. The queue bounded: the wanted beyond it wait for the next `want` (the pressure
// passed upstream, strategy §7.19). The pool knows nothing of the GPU: a cell is handed to `onCell` as its bytes (J8-4 uploads them).
// The executor and the cache are given (the workers and Cache Storage in the game, fakes in the tests).
import { CELL_FORMAT, CELL_Z, cellKey } from "./building-cells";

/** the order a cell is wanted in: 0 in view and near, 1 on the predicted track, 2 the reserve behind, 3 the rest */
export type CellPriority = 0 | 1 | 2 | 3;
export interface CellWant {
  x: number;
  y: number;
  priority: CellPriority;
  /** its distance [m] (the order within a class) */
  d: number;
}
export interface CellPrepared {
  x: number;
  y: number;
  buf: ArrayBuffer;
  /** from the prepared cache, or prepared now (its time in the worker [ms]) */
  cached: boolean;
  ms: number;
}
/** what prepares a cell: a worker's tile fetched and decoded (cell-worker.ts) — `signal` aborts it */
export interface CellExecutor {
  readonly size: number;
  run(x: number, y: number, signal: AbortSignal): Promise<{ buf: ArrayBuffer; ms: number }>;
}
/** the prepared cache (Cache Storage under CELL_CACHE): a cell's bytes, or null */
export interface CellStore {
  get(x: number, y: number): Promise<ArrayBuffer | null>;
}

/** the prepared cache's name: the contract's format in it — a new format never reads an old one's cells */
export const CELL_CACHE = `kerr-cells-v${CELL_FORMAT}`;
/** a cell's key in the prepared cache (a URL: Cache Storage's keys are requests; never fetched) */
export const cellCacheUrl = (origin: string, x: number, y: number) => `${origin}/__cells/${CELL_FORMAT}/${CELL_Z}/${x}/${y}.kbc`;

export interface CellPoolOptions {
  /** the queue's bound (cells waiting, not counting those under way) */
  maxQueue?: number;
}

export class CellPool {
  private queue: CellWant[] = [];
  private running = new Map<string, { want: CellWant; abort: AbortController }>();
  private wanted = new Map<string, CellWant>();
  /** cells handed over (their key): asked again, not prepared again (`forget` lets one be) */
  private done = new Set<string>();
  private readonly maxQueue: number;
  /** who takes the cells (J8-4's GPU pool, the tools): each told every cell handed */
  private listeners = new Set<(c: CellPrepared) => void>();
  onError: ((x: number, y: number, e: unknown) => void) | null = null;
  /** `dropped`: queued cells that left the wanted set before their turn (a want repeated with the same list drops nothing) */
  readonly counts = { prepared: 0, cached: 0, cancelled: 0, dropped: 0, failed: 0, ms: 0 };
  /** the wanted cells waiting beyond the queue's bound at the last want (a gauge: they wait for the next) */
  private beyond = 0;

  constructor(
    private exec: CellExecutor,
    private store: CellStore | null = null,
    o: CellPoolOptions = {},
  ) {
    this.maxQueue = o.maxQueue ?? 256;
  }

  /** The cells wanted now (the whole set: what is not in it is no longer wanted — dropped, or its work cancelled). */
  want(list: readonly CellWant[]) {
    this.wanted = new Map(list.map((w) => [cellKey(w.x, w.y), w]));
    for (const [k, r] of this.running)
      if (!this.wanted.has(k)) {
        r.abort.abort();
        this.running.delete(k);
        this.counts.cancelled++;
      }
    const order = (a: CellWant, b: CellWant) => a.priority - b.priority || a.d - b.d;
    const fresh = [...this.wanted.values()].filter((w) => {
      const k = cellKey(w.x, w.y);
      return !this.done.has(k) && !this.running.has(k);
    });
    fresh.sort(order);
    // (the bound on those waiting: the free workers take theirs at once, outside it)
    const take = this.maxQueue + Math.max(0, this.exec.size - this.running.size);
    // (the queued no longer wanted: dropped — counted once each, 16 Nov 2026: a count of those beyond the bound at every want grew by
    // the list's size each call, 136 000 in five minutes of J8-4's want every 2 s)
    for (const q of this.queue) if (!this.wanted.has(cellKey(q.x, q.y))) this.counts.dropped++;
    this.beyond = Math.max(0, fresh.length - take);
    this.queue = fresh.slice(0, take);
    this.pump();
  }

  /** a listener of the cells handed; its removal returned */
  listen(fn: (c: CellPrepared) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** a cell to prepare again when next wanted (its source's newer generation, its bytes evicted) */
  forget(x: number, y: number) {
    this.done.delete(cellKey(x, y));
  }

  /** what the pool holds now */
  stats() {
    return { queued: this.queue.length, running: this.running.size, done: this.done.size, beyond: this.beyond, ...this.counts };
  }

  private pump() {
    while (this.running.size < this.exec.size && this.queue.length) {
      const w = this.queue.shift()!;
      const k = cellKey(w.x, w.y);
      if (this.done.has(k) || this.running.has(k)) continue;
      const abort = new AbortController();
      this.running.set(k, { want: w, abort });
      void this.one(w, k, abort);
    }
  }

  private async one(w: CellWant, k: string, abort: AbortController) {
    try {
      const hit = this.store ? await this.store.get(w.x, w.y) : null;
      if (abort.signal.aborted) return;
      if (hit) {
        this.counts.cached++;
        this.hand(k, { x: w.x, y: w.y, buf: hit, cached: true, ms: 0 });
        return;
      }
      const r = await this.exec.run(w.x, w.y, abort.signal);
      if (abort.signal.aborted) return;
      this.counts.prepared++;
      this.counts.ms += r.ms;
      this.hand(k, { x: w.x, y: w.y, buf: r.buf, cached: false, ms: r.ms });
    } catch (e) {
      if (abort.signal.aborted) return;
      this.counts.failed++;
      this.onError?.(w.x, w.y, e);
    } finally {
      if (this.running.get(k)?.abort === abort) this.running.delete(k);
      this.pump();
    }
  }

  private hand(k: string, c: CellPrepared) {
    this.done.add(k);
    for (const fn of this.listeners) fn(c);
  }
}
