// PLAN-J2 J2-1 (docs/PLAN-J2-PAGES-RECONSTRUCTION.md §3, §5; strategy §7.6, §7.19; C0-4 §5–6; ANALYSE-STREAMING ST5, ST9): the
// publication of the Earth's tile pages. A page is a tile of a level's window (the relief's z 6 … 17 — its heights, its imagery and
// its lights —, the orthophotos' z 15 … 18): its slot in the window, its key (z/x/y), its generation (12 bits, bumped at each write
// of the slot). A tile in from the network is kept on the CPU at once (its heights for the loads' bookkeeping, the memory cache), and
// its page queued here; once an image, at its start (EarthTiles.publish, before anything of the image is encoded), the queued pages
// are written to the GPU nearest the camera first under a budget of the page's thread [ms] — their texels, then every mip of every
// page written in one encoder and one submission —, and only then published: a level's rectangle the tracer reads grows over a page
// once its texels and its mips are in, the previous occupant of a slot never read once its bit is off, the same image reads the
// same table throughout (FrameDesc.pages). Pure: the queue, its merge, its budget and the mips' grouping — the GPU calls are the
// caller's (earth-tiles.ts).

/** a part of a page's write — its heights, its imagery, an orthophoto —: its bytes and its write */
export interface PagePart {
  bytes: number;
  run: () => void;
}
/** a page waiting for its publication: its slot (unique: a level and a slot of its window), its level and tile, its parts by name
 *  (a later write of the same part replaces the earlier one; other parts kept), when it was first queued [ms] */
export interface PageJob {
  slot: string;
  z: number;
  x: number;
  y: number;
  parts: Map<string, PagePart>;
  at: number;
}

/** the page's thread's budget for the publication of an image [ms] (J2-1: no publication peak over 2 ms) */
export const PUB_BUDGET_MS = 1.5;
/** a page waiting longer than this [ms]: the budget raised to PUB_CATCHUP_MS (a cold load's backlog drained, the coverage not
 *  held back) */
export const PUB_CATCHUP_AFTER_MS = 750;
export const PUB_CATCHUP_MS = 2;

export class PagePublisher {
  private jobs = new Map<string, PageJob>();
  /** a page's write [ms], a running mean: the next page started only if it fits in the budget (the first always) */
  estMs = 0.5;
  /** bumped at each publication that wrote a page: the table's version (the renderer's still view redrawn for it, FrameDesc.pages) */
  version = 0;
  get size() {
    return this.jobs.size;
  }
  get bytes() {
    let b = 0;
    for (const j of this.jobs.values()) for (const p of j.parts.values()) b += p.bytes;
    return b;
  }
  /** the oldest page waiting [ms] (0: none) */
  oldest(now: number) {
    let a = now;
    for (const j of this.jobs.values()) if (j.at < a) a = j.at;
    return now - a;
  }
  /** the pages waiting that `which` picks */
  count(which: (j: PageJob) => boolean) {
    let n = 0;
    for (const j of this.jobs.values()) if (which(j)) n++;
    return n;
  }
  has(slot: string) {
    return this.jobs.has(slot);
  }
  /** a part of a page queued (merged with what that slot already waits for) */
  queue(slot: string, z: number, x: number, y: number, part: string, bytes: number, run: () => void, now: number) {
    let j = this.jobs.get(slot);
    if (!j) {
      j = { slot, z, x, y, parts: new Map(), at: now };
      this.jobs.set(slot, j);
    }
    j.z = z;
    j.x = x;
    j.y = y;
    j.parts.set(part, { bytes, run });
  }
  /** the pages dropped (all, or those `which` picks): their textures remade, their sources switched */
  drop(which?: (j: PageJob) => boolean) {
    if (!which) return void this.jobs.clear();
    for (const [k, j] of this.jobs) if (which(j)) this.jobs.delete(k);
  }
  /**
   * The pages written, the nearest first (`rank`: lower first; then the oldest), while the next one fits in `budgetMs` of the clock
   * (its cost the running mean of the pages written, `estMs`) — at least one page an image, whatever its cost. Returns the pages
   * written.
   */
  drain(budgetMs: number, rank: (j: PageJob) => number, clock: () => number): PageJob[] {
    if (!this.jobs.size) return [];
    const order = [...this.jobs.values()].map((j) => ({ j, r: rank(j) }));
    order.sort((a, b) => a.r - b.r || a.j.at - b.j.at);
    const t0 = clock();
    const done: PageJob[] = [];
    for (const { j } of order) {
      const t = clock();
      if (done.length && t - t0 + this.estMs > budgetMs) break;
      this.jobs.delete(j.slot);
      for (const p of j.parts.values()) p.run();
      done.push(j);
      this.estMs = 0.8 * this.estMs + 0.2 * Math.max(clock() - t, 0);
    }
    return done;
  }
}

/** a region of a texture's layer whose mips are to be made (a tile's: its corner [texels at mip 0], 256²) */
export interface MipRegion {
  layer: number;
  ox: number;
  oy: number;
}

/**
 * The mips of an image's pages, gathered (J2-1, ST5): each texture's regions by layer, a region once however often written — one
 * render pass a texture, a mip and a layer, a draw a region (its viewport), every pass in one encoder: one submission an image
 * instead of one a tile and a layer.
 */
export class MipBatch<T> {
  private by = new Map<T, Map<number, Map<string, MipRegion>>>();
  get empty() {
    return this.by.size === 0;
  }
  add(tex: T, layer: number, ox: number, oy: number) {
    let layers = this.by.get(tex);
    if (!layers) this.by.set(tex, (layers = new Map()));
    let regions = layers.get(layer);
    if (!regions) layers.set(layer, (regions = new Map()));
    regions.set(`${ox},${oy}`, { layer, ox, oy });
  }
  clear() {
    this.by.clear();
  }
  /** each texture's layers and their regions (taken: the batch emptied) */
  take(): { tex: T; layers: { layer: number; regions: MipRegion[] }[] }[] {
    const out = [...this.by].map(([tex, layers]) => ({
      tex,
      layers: [...layers].map(([layer, r]) => ({ layer, regions: [...r.values()] })),
    }));
    this.by.clear();
    return out;
  }
}
