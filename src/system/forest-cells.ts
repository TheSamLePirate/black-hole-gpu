// PLAN-J8 J8-8b lot (1) — the forest's cell, kerr-forest-v1 (docs/PLAN-J8-BATIMENTS.md §6 point 12, Sam's decision of 17 Nov 2026): the
// world-fixed grid of the forest (forest.ts — 7 m cells in Web Mercator by 4° bands, at most one tree each, drawn from its global index:
// the same tree whichever scene holds it) cut by z 15 cell — a grid cell belongs to the z 15 cell holding its centre, unjittered: no seam,
// no double —, each cell's candidates decided once in the cells' workers (forest-prep.ts: the draw, the land cover, the canopy where an
// offline zone holds it, the data's exclusions) and kept in Cache Storage (FOREST_CACHE), counted in the zones and in `flightReady({ track
// })`. The scene (the render session's lot 2) assembles these cells instead of growForest: on its relief, a tree's kind, height and foot
// (forest.ts forestKind / canopyKind, packCell), the cliffs refused, the live exclusions (sceneryExcluded: the runways, the viewpoints).
// Agreed with the render session, 17 Nov 2026. Pure: the page, the workers and the tests share it.
//
// The bytes (little-endian):
//   header  0 u32 magic "KFC1"   4 u16 format (FOREST_FORMAT)   6 u8 z (15)   7 u8 flags (ForestCellFlag)   8 u32 x   12 u32 y
//          16 u32 generation (its sources': the cover's release, the buildings' and roads' tiles' — the newest)   20 u32 columns (the band's
//          grid cells round the world: forest.ts forestColumns)   24 i32 gi0   28 i32 gj0 (the window's first global cell — gi0 the
//          column unwrapped, gj0 the row)   32 u16 w   34 u16 h   36 u32 candidates (the cells with a word)
//          40 u32 columns2   44 i32 gi0b   48 i32 gj0b   52 u16 w2   54 u16 h2 — a second window, a cell across two 4° bands (each band
//          its own grid: the rows north of the boundary — 48°, 44° … — the next band's); columns2 0: none   56..63 reserved (0)
//   then `w × h` u16, row by row from gj0 (south), then `w2 × h2` likewise — a candidate's word: its land cover's class (low byte: ESA WorldCover's 10…100; 0
//   unknown) and its canopy's height measured within its crown's reach (high byte: CANOPY_STEP m a step, 0 none measured — the
//   cover's draw); 0: no tree there — refused, or not this cell's.
import { CELL_Z } from "./building-cells";

export const FOREST_FORMAT = 1;
export const FOREST_MAGIC = 0x3143464b; // "KFC1"
export const FOREST_HEADER_BYTES = 64;
/** the canopy's step in a word [m] (255 steps: 51 m — the survey's trees under it) */
export const CANOPY_STEP = 0.2;
/** a forest cell's bytes and its preparation's time — measured (j8-forest-cells, kerr-mini, 17 Nov 2026: 34 kB, 120–210 ms with its
 *  sources read) — for a zone's estimate */
export const FOREST_CELL_BYTES_EST = 34_000;
export const FOREST_CELL_SECONDS_EST = 0.2;
/** the prepared cache */
export const FOREST_CACHE = `kerr-forest-v${FOREST_FORMAT}`;
/** a forest cell's key (its sources' generation and whether the canopy served it — either changed, another key) */
export const forestCacheUrl = (origin: string, x: number, y: number, generation: number, canopy: boolean) =>
  `${origin}/__forest/${FOREST_FORMAT}/${CELL_Z}/${x}/${y}.kfc?g=${generation}&c=${canopy ? 1 : 0}`;

export enum ForestCellFlag {
  /** the IGN's canopy read (an offline zone held it): the measured heights in the words */
  Canopy = 1,
}

/** a window of the forest's grid: its band's columns, its first global cell, its size */
export interface ForestWindow {
  columns: number;
  gi0: number;
  gj0: number;
  w: number;
  h: number;
}
export interface ForestCellHeader {
  format: number;
  z: number;
  flags: number;
  x: number;
  y: number;
  generation: number;
  /** one window, or two across a band's boundary (the southern first) */
  windows: ForestWindow[];
  candidates: number;
}

/** a candidate's word: its class and its measured canopy (NaN: none — the cover's draw) */
export function forestWord(cls: number, canopy: number): number {
  const code = Number.isFinite(canopy) ? Math.max(1, Math.min(255, Math.round(canopy / CANOPY_STEP))) : 0;
  return ((cls & 0xff) | (code << 8)) & 0xffff;
}
/** a word's class and canopy [m] (NaN: none measured) */
export function readForestWord(word: number): { cls: number; canopy: number } {
  const code = word >>> 8;
  return { cls: word & 0xff, canopy: code ? code * CANOPY_STEP : Number.NaN };
}

/** The forest cell's bytes: its windows' words, each window's row by row from its gj0. */
export function encodeForestCell(h: Omit<ForestCellHeader, "format" | "candidates">, words: Uint16Array): ArrayBuffer {
  if (h.windows.length < 1 || h.windows.length > 2) throw new Error("one window or two");
  if (words.length !== h.windows.reduce((s, w) => s + w.w * w.h, 0)) throw new Error("the words are not the windows'");
  const buf = new ArrayBuffer(FOREST_HEADER_BYTES + words.length * 2);
  const dv = new DataView(buf);
  let candidates = 0;
  for (const v of words) if (v) candidates++;
  const [a, b] = h.windows as [ForestWindow, ForestWindow | undefined];
  dv.setUint32(0, FOREST_MAGIC, true);
  dv.setUint16(4, FOREST_FORMAT, true);
  dv.setUint8(6, h.z);
  dv.setUint8(7, h.flags);
  dv.setUint32(8, h.x, true);
  dv.setUint32(12, h.y, true);
  dv.setUint32(16, h.generation >>> 0, true);
  dv.setUint32(20, a.columns, true);
  dv.setInt32(24, a.gi0, true);
  dv.setInt32(28, a.gj0, true);
  dv.setUint16(32, a.w, true);
  dv.setUint16(34, a.h, true);
  dv.setUint32(36, candidates, true);
  if (b) {
    dv.setUint32(40, b.columns, true);
    dv.setInt32(44, b.gi0, true);
    dv.setInt32(48, b.gj0, true);
    dv.setUint16(52, b.w, true);
    dv.setUint16(54, b.h, true);
  }
  new Uint16Array(buf, FOREST_HEADER_BYTES, words.length).set(words);
  return buf;
}

/** the header, or null when the bytes are not a forest cell of this format */
export function readForestHeader(buf: ArrayBuffer): ForestCellHeader | null {
  if (buf.byteLength < FOREST_HEADER_BYTES) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== FOREST_MAGIC || dv.getUint16(4, true) !== FOREST_FORMAT) return null;
  const windows: ForestWindow[] = [
    {
      columns: dv.getUint32(20, true),
      gi0: dv.getInt32(24, true),
      gj0: dv.getInt32(28, true),
      w: dv.getUint16(32, true),
      h: dv.getUint16(34, true),
    },
  ];
  if (dv.getUint32(40, true))
    windows.push({
      columns: dv.getUint32(40, true),
      gi0: dv.getInt32(44, true),
      gj0: dv.getInt32(48, true),
      w: dv.getUint16(52, true),
      h: dv.getUint16(54, true),
    });
  const h: ForestCellHeader = {
    format: FOREST_FORMAT,
    z: dv.getUint8(6),
    flags: dv.getUint8(7),
    x: dv.getUint32(8, true),
    y: dv.getUint32(12, true),
    generation: dv.getUint32(16, true),
    windows,
    candidates: dv.getUint32(36, true),
  };
  return buf.byteLength === FOREST_HEADER_BYTES + windows.reduce((s, w) => s + w.w * w.h, 0) * 2 ? h : null;
}

/** each window's words as a view over the bytes (no copy), row by row from its gj0 */
export function forestWords(buf: ArrayBuffer, h: ForestCellHeader): Uint16Array[] {
  let at = FOREST_HEADER_BYTES;
  return h.windows.map((w) => {
    const v = new Uint16Array(buf, at, w.w * w.h);
    at += w.w * w.h * 2;
    return v;
  });
}
