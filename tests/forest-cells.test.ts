import { expect, test } from "bun:test";
import { cellBounds, cellOrigin } from "../src/system/building-cells";
import { forestFrame, forestColumn, growForest } from "../src/system/forest";
import {
  encodeForestCell,
  FOREST_HEADER_BYTES,
  forestCacheUrl,
  forestWord,
  forestWords,
  readForestHeader,
  readForestWord,
} from "../src/system/forest-cells";
import { forestWindows, prepareForestCell } from "../src/system/forest-prep";
import { localPoint, sceneryFrame } from "../src/system/scenery-data";

// PLAN-J8 J8-8b lot (1) — the forest's cell (forest-cells.ts kerr-forest-v1, forest-prep.ts), agreed with the render session (17 Nov
// 2026): the world-fixed grid's cells whose centres lie in a z 15 cell, decided as growForest decides them before the ground — the same
// candidates at the same global cells; their word the class and the canopy; 0 elsewhere.

test("the bytes: a word, the header and its two windows written and read back", () => {
  expect(readForestWord(forestWord(10, Number.NaN))).toEqual({ cls: 10, canopy: Number.NaN });
  const w = readForestWord(forestWord(30, 12.3));
  expect(w.cls).toBe(30);
  expect(w.canopy).toBeCloseTo(12.4, 5);
  const windows = [
    { columns: 100, gi0: 5, gj0: 7, w: 2, h: 2 },
    { columns: 99, gi0: 6, gj0: 9, w: 1, h: 3 },
  ];
  const words = new Uint16Array([0, 1, 2, 0, 3, 0, 4]);
  const buf = encodeForestCell({ z: 15, x: 3, y: 4, flags: 1, generation: 20210101, windows }, words);
  expect(buf.byteLength).toBe(FOREST_HEADER_BYTES + 14);
  const h = readForestHeader(buf)!;
  expect(h).toMatchObject({ x: 3, y: 4, flags: 1, generation: 20210101, windows, candidates: 4 });
  expect(forestWords(buf, h).map((v) => [...v])).toEqual([
    [0, 1, 2, 0],
    [3, 0, 4],
  ]);
  expect(readForestHeader(buf.slice(0, buf.byteLength - 2))).toBeNull();
  expect(forestCacheUrl("https://x", 3, 4, 7, false)).toBe("https://x/__forest/1/15/3/4.kfc?g=7&c=0");
});

test("a cell across a band's boundary: two windows, the rows each band's", () => {
  // (z 15 row whose cell spans 48° N: its windows the band 44–48° south and 48–52° north)
  const n = 2 ** 15;
  const yOf = (lat: number) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const y = yOf(48);
  const b = cellBounds(16590, y);
  expect(b.south < 48 && b.north > 48).toBe(true);
  const w = forestWindows(16590, y);
  expect(w.length).toBe(2);
  expect(w[0]!.columns).not.toBe(w[1]!.columns);
});

test("growForest's own candidates: every tree of a frame over Paris a candidate in its z 15 cell, at the same global cell", async () => {
  // (a cell of Paris's — 16596/11273 —, the frame at its centre, a reach inside it; the cover a forest everywhere, a road's strip excluded)
  const [x, y] = [16596, 11273];
  const o = cellOrigin(x, y);
  const frame = sceneryFrame(o.lat, o.lon);
  const local = (lat: number, lon: number, h = 0) => localPoint(frame, lat, lon, h);
  const f = forestFrame(o.lat, o.lon, 300, (lat, lon) => local(lat, lon));
  const excluded = (_lat: number, lon: number) => Math.abs(lon - o.lon) * 111_320 * Math.cos((o.lat * Math.PI) / 180) < 6;
  const grown = await growForest(f, {
    cover: () => 10,
    excluded,
    ground: async () => 60,
    groundNow: () => 60,
    sea: () => 45,
    local: (lat, lon, h) => local(lat, lon, h),
  });
  const cell = prepareForestCell(x, y, { cover: () => 10, excluded }, 1, false);
  const h = readForestHeader(cell.buf)!;
  const [win] = h.windows;
  const words = forestWords(cell.buf, h)[0]!;
  const word = (gi: number, gj: number) => {
    const i = gi - win!.gi0,
      j = gj - win!.gj0;
    return i >= 0 && i < win!.w && j >= 0 && j < win!.h ? words[j * win!.w + i]! : -1;
  };
  expect(grown.trees).toBeGreaterThan(500);
  let found = 0;
  for (let j = 0; j < f.h; j++)
    for (let i = 0; i < f.w; i++) {
      if (!grown.cells[j * f.w + i]) continue;
      // (the frame's cell as a global one: its column unwrapped by the window's — the same band's)
      const gc = forestColumn(f, i);
      const gi = win!.gi0 + ((((gc - win!.gi0) % win!.columns) + win!.columns) % win!.columns);
      const w = word(gi, f.j0 + j);
      expect(w).toBeGreaterThan(0);
      expect(readForestWord(w).cls).toBe(10);
      found++;
    }
  expect(found).toBe(grown.trees);
  // (the cell holds more — all of its ~800 m, the frame's reach 300 m —, never fewer)
  expect(cell.stats.candidates).toBeGreaterThan(grown.trees);
  expect(cell.stats.excluded).toBeGreaterThan(0);
  console.log(`  Paris's cell: ${JSON.stringify(cell.stats)} · the frame's ${grown.trees} trees all among them`);
});
