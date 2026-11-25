// The streets' levelling of the relief, whatever arrives first (26 Nov 2026; PROBLEMES « Ponts et routes » — street-level.ts levelled a
// national relief tile with the street cells cached when it came: a tile before its cells kept its survey's steps until it was fetched
// again, the ground depending on the order of two arrivals). Each tile levelled with the cells about it (its own z 15 cell and its eight
// neighbours'); while one of them is missing its survey is kept (the heights as they came, before any levelling), and when a cell
// arrives every tile it touches is levelled again from its survey with the cells there now — the same ground as if the cells had come
// first. A tile whose cells are all in keeps no survey. Pure but for what it is given: the cells' reader and the levelling (the decode
// worker's in the game — tile-decode.ts "level" —, levelTile itself in the tests).
import { STREET_CELL_Z } from "./street-level";

/** the surveys kept at most (256² heights each, 256 KiB): the farthest behind dropped first — such a tile stays as it was levelled */
export const SURVEYS_KEPT = 48;

/** the z 15 cells about a relief tile (z ≥ 15): its own and its eight neighbours' — a road's reach crosses a cell's edge */
export function cellsAbout(z: number, x: number, y: number): [number, number][] {
  const k = 2 ** (z - STREET_CELL_Z);
  const cx = Math.floor(x / k),
    cy = Math.floor(y / k);
  const out: [number, number][] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push([cx + dx, cy + dy]);
  return out;
}
/** whether a z 15 cell is about a tile */
export function touches(z: number, x: number, y: number, cx: number, cy: number): boolean {
  const k = 2 ** (z - STREET_CELL_Z);
  return Math.abs(Math.floor(x / k) - cx) <= 1 && Math.abs(Math.floor(y / k) - cy) <= 1;
}

/** a tile levelled again: its key, its place, its heights (its survey levelled with every cell about it now) */
export interface Relevelled {
  key: string;
  z: number;
  x: number;
  y: number;
  h: Float32Array;
}

export class StreetLevelBook<T> {
  /** the tiles levelled while a cell about them was missing: their survey (insertion order: the oldest first dropped) */
  private surveys = new Map<string, { z: number; x: number; y: number; h: Float32Array }>();
  /** the tiles being levelled now; a cell arrived meanwhile marks them to be levelled again from their survey at once */
  private pending = new Map<string, { z: number; x: number; y: number; again: boolean }>();
  /** each tile's latest levelling asked: an older one finishing after it is dropped (two cells come close together) */
  private ticket = new Map<string, number>();
  private take(key: string) {
    const t = (this.ticket.get(key) ?? 0) + 1;
    this.ticket.set(key, t);
    if (this.ticket.size > 4 * this.max) this.ticket.delete(this.ticket.keys().next().value!);
    return t;
  }
  readonly stats = { tiles: 0, moved: 0, relevelled: 0, dropped: 0 };
  constructor(
    /** a cell's payload (its bytes), null while it is not there */
    private cell: (cx: number, cy: number) => Promise<T | null>,
    /** the levelling of heights in place with the cells given — the pixels moved */
    private run: (h: Float32Array, z: number, x: number, y: number, cells: T[]) => Promise<number>,
    private max = SURVEYS_KEPT,
  ) {}

  /** the surveys kept now */
  get kept() {
    return this.surveys.size;
  }

  private async gather(z: number, x: number, y: number): Promise<{ cells: T[]; missing: number }> {
    const got = await Promise.all(cellsAbout(z, x, y).map(([cx, cy]) => this.cell(cx, cy).catch(() => null)));
    const cells = got.filter((c): c is Awaited<T> => c !== null) as T[];
    return { cells, missing: got.length - cells.length };
  }
  private keep(key: string, z: number, x: number, y: number, h: Float32Array) {
    this.surveys.delete(key);
    this.surveys.set(key, { z, x, y, h });
    while (this.surveys.size > this.max) {
      this.surveys.delete(this.surveys.keys().next().value!);
      this.stats.dropped++;
    }
  }

  /**
   * A tile's heights as they came (z ≥ STREET_CELL_Z; `h` its TILE² ground, levelled in place) levelled with the cells about it — its
   * survey kept while one is missing. Returns the pixels moved.
   */
  async level(key: string, z: number, x: number, y: number, h: Float32Array): Promise<number> {
    if (z < STREET_CELL_Z) return 0;
    const survey = h.slice();
    this.take(key);
    const mark = { z, x, y, again: false };
    this.pending.set(key, mark);
    try {
      let moved = 0;
      for (;;) {
        mark.again = false;
        const { cells, missing } = await this.gather(z, x, y);
        if (missing) this.keep(key, z, x, y, survey);
        else this.surveys.delete(key);
        h.set(survey);
        moved = cells.length ? await this.run(h, z, x, y, cells) : 0;
        // (a cell come while it was levelled: once more, with it)
        if (!mark.again) break;
      }
      this.stats.tiles++;
      this.stats.moved += moved;
      return moved;
    } finally {
      if (this.pending.get(key) === mark) this.pending.delete(key);
    }
  }

  /**
   * Cells arrived (z 15): the tiles about them levelled while one was missing, levelled again from their survey — their new heights
   * returned for their owner to keep and draw (earth-tiles.ts). A tile being levelled now is levelled again by its own call instead.
   */
  async arrived(cells: readonly [number, number][]): Promise<Relevelled[]> {
    const near = (z: number, x: number, y: number) => cells.some(([cx, cy]) => touches(z, x, y, cx, cy));
    for (const m of this.pending.values()) if (near(m.z, m.x, m.y)) m.again = true;
    const out: Relevelled[] = [];
    for (const [key, s] of [...this.surveys]) {
      if (this.pending.has(key) || !near(s.z, s.x, s.y)) continue;
      const tk = this.take(key);
      const { cells: got, missing } = await this.gather(s.z, s.x, s.y);
      // (levelled meanwhile by a new arrival of its own: that one's survey holds)
      if (this.pending.has(key) || this.surveys.get(key) !== s) continue;
      if (!missing) this.surveys.delete(key);
      const h = s.h.slice();
      if (got.length) await this.run(h, s.z, s.x, s.y, got);
      // (a newer levelling of it asked meanwhile — a cell come after this one's reading —: this one dropped)
      if (this.pending.has(key) || this.ticket.get(key) !== tk) continue;
      this.stats.relevelled++;
      out.push({ key, z: s.z, x: s.x, y: s.y, h });
    }
    return out;
  }

  /** the sources changed (earth-tiles.ts gen): every survey forgotten */
  clear() {
    this.surveys.clear();
    for (const m of this.pending.values()) m.again = false;
  }
}
