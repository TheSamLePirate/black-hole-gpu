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

/**
 * J2 (the main thread's peaks — FICHE-J2-pointes): the tiles' main-thread work an image may take [ms] — the publication at its start,
 * then the loads started (`load`, `loadOrtho`: their `fetch` calls ≈ 0.15 ms each, measured), the halo's look — whatever calls them,
 * the frame's `update` or an arrival between two images.
 */
export const TILE_FRAME_MS = 2;
/** no image for this long [ms] (a still view converged, the frames stopped): a new budget all the same — well over a slow image's
 *  interval (40–60 ms seen in flight on the M1 Max: at 33 ms the budget opened again within such an image, twice the work in it) */
export const TILE_FRAME_IDLE_MS = 100;
/** the starts judged this far under the limit [ms]: a start's real cost passes its high estimate by up to 0.1–0.2 ms (the last one let
 *  in took an image to 2.1–2.4 ms — FICHE-J2-pointes, tour 8) */
export const TILE_START_MARGIN_MS = 0.3;
/** the starts whose costs make the high estimate (FrameBudget.estHi: the second dearest of them) */
export const TILE_START_WINDOW = 8;
/** images in a row with a start refused and none done: one let go at the next (the loads never held back for good — a cold load's
 *  backlog, its publication at 2 ms an image) */
export const TILE_STARVE_IMAGES = 3;

/**
 * The tiles' budget of the page's thread for an image (J2, the peaks): what the publication, the loads' starts and the halo's look
 * spent since the image began (`begin`, at an image's end or its publication; or `tick` after TILE_FRAME_IDLE_MS without one). A start
 * goes while its high cost (`estHi`: the second dearest of the last TILE_START_WINDOW — a start costs 0.2–0.7 ms on the M1 Max, 0.3–0.4
 * on average: judged on the mean, the last one let in passed the limit; on the dearest ever seen, slowly let down, a cold load's few
 * slow starts held the loads to one an image — `tile-arrival` 5 × slower) fits in what is left less TILE_START_MARGIN_MS — in their
 * order of priority, the rest at the next image —; one at least once TILE_STARVE_IMAGES images went without. Pure: the clock is the
 * caller's.
 */
export class FrameBudget {
  /** spent since the image began [ms] */
  spent = 0;
  /** when it began [ms] */
  at = Number.NEGATIVE_INFINITY;
  /** the images begun (a count: the requests of one image told apart) */
  image = 0;
  /** a start's cost [ms], a running mean; its high estimate (the second dearest of the last TILE_START_WINDOW, never under the
   *  mean) — what a start is judged by */
  est = 0.3;
  estHi = 0.5;
  private recent: number[] = [];
  /** the starts refused since the image began, and in all */
  refused = 0;
  refusedAll = 0;
  /** the starts' time since the image began [ms] */
  startSpent = 0;
  private started = 0;
  private starved = 0;
  /** [ms] — Infinity: unbounded (the tests that read what one request does) */
  constructor(public limit = TILE_FRAME_MS) {}
  /** an image begins (the publication, at its start) */
  begin(now: number) {
    if (this.refused && !this.started) this.starved++;
    else if (this.started) this.starved = 0;
    this.spent = 0;
    this.at = now;
    this.image++;
    this.started = 0;
    this.startSpent = 0;
    this.refused = 0;
  }
  /** no image for a while: a new budget */
  tick(now: number) {
    if (now - this.at > TILE_FRAME_IDLE_MS) this.begin(now);
  }
  /** what is left of the image's budget [ms] */
  left(now: number) {
    this.tick(now);
    return this.limit - this.spent;
  }
  /** may a load start now (its cost `estHi`)? Refused: counted, the caller stops there (its next starts wait for the next image) */
  mayStart(now: number): boolean {
    this.tick(now);
    if (this.spent + this.estHi <= this.limit - TILE_START_MARGIN_MS || (!this.started && this.starved >= TILE_STARVE_IMAGES)) return true;
    this.refused++;
    this.refusedAll++;
    return false;
  }
  /** a start done, its cost [ms] */
  didStart(ms: number) {
    this.spent += ms;
    this.startSpent += ms;
    this.started++;
    this.est = 0.8 * this.est + 0.2 * ms;
    this.recent.push(ms);
    if (this.recent.length > TILE_START_WINDOW) this.recent.shift();
    const r = [...this.recent].sort((a, b) => b - a);
    this.estHi = Math.max(r[Math.min(1, r.length - 1)]!, this.est);
  }
  /** other work of the tiles' in the image [ms] (the publication, the halo's look) */
  add(ms: number) {
    this.spent += ms;
  }
}

export class PagePublisher {
  private jobs = new Map<string, PageJob>();
  /** a page's write [ms per MiB of its parts], a running mean: the next page started only if it fits in the budget (the first
   *  always) — by its bytes: a relief page (heights, imagery, lights) costs three orthophotos' (FICHE-J2-pointes) */
  msPerMiB = 1;
  /** a page's write [ms], estimated from its bytes */
  estOf(j: PageJob) {
    let b = 0;
    for (const p of j.parts.values()) b += p.bytes;
    return (b / 1048576) * this.msPerMiB;
  }
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
   * The pages written, the nearest first (`rank`: lower first; then the oldest), each while it fits in `budgetMs` of the clock (its
   * cost from its bytes, `estOf` — a larger one passed over for a smaller one after it) — at least one page an image, whatever its
   * cost. Returns the pages written.
   */
  drain(budgetMs: number, rank: (j: PageJob) => number, clock: () => number): PageJob[] {
    if (!this.jobs.size) return [];
    const order = [...this.jobs.values()].map((j) => ({ j, r: rank(j) }));
    order.sort((a, b) => a.r - b.r || a.j.at - b.j.at);
    const t0 = clock();
    const done: PageJob[] = [];
    for (const { j } of order) {
      const t = clock();
      const est = this.estOf(j);
      // (a page that does not fit: the next ones — maybe smaller, an orthophoto — tried still, in order)
      if (done.length && t - t0 + est > budgetMs) continue;
      this.jobs.delete(j.slot);
      for (const p of j.parts.values()) p.run();
      done.push(j);
      const mib = est / this.msPerMiB;
      if (mib > 0) this.msPerMiB = 0.8 * this.msPerMiB + 0.2 * (Math.max(clock() - t, 0) / mib);
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
