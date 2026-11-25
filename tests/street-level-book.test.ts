import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type LevelRoad, levelTile } from "../src/system/street-level";
import { cellsAbout, StreetLevelBook, touches } from "../src/system/street-level-book";

// (26 Nov 2026, PROBLEMES « Ponts et routes »: a relief tile come before its street cells kept its survey's steps — the ground depended
// on which arrived first.) The book levels a tile with the cells about it, keeps its survey while one is missing, and levels it again
// from that survey when a cell arrives: the same ground whatever the order.

const SIDE = 256;
const Z = 17,
  X = 66_400,
  Y = 45_100;
const D = Math.PI / 180;
const n = 2 ** Z;
const latOf = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) / D;
const lon0 = ((X + 0.5) / n) * 360 - 180,
  lat0 = latOf(Y + 0.5);
const kx = 111_320 * Math.cos(lat0 * D),
  ky = 111_132;
// (two roads crossing the tile — one west–east, one south–north —, each in its own cell of the 3×3 about the tile)
const ew: LevelRoad = {
  pts: [
    [lat0, lon0 - 120 / kx],
    [lat0, lon0 + 120 / kx],
  ],
  r: 5,
  R: 8,
  cls: "secondary",
  urban: true,
};
const ns: LevelRoad = {
  pts: [
    [lat0 - 120 / ky, lon0 + 40 / kx],
    [lat0 + 120 / ky, lon0 + 40 / kx],
  ],
  r: 4,
  R: 6,
  cls: "minor",
  urban: true,
};
const about = cellsAbout(Z, X, Y);
const cellA = about[4]!,
  cellB = about[5]!;

function survey(): Float32Array {
  const h = new Float32Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++)
    for (let i = 0; i < SIDE; i++) {
      const e = i - 128,
        nn = 128 - j;
      h[j * SIDE + i] = 30 + 0.02 * e + 0.3 * Math.sin(e * 1.7) * Math.cos(nn * 2.3) + (Math.abs(nn) > 7 ? 1 : 0);
    }
  return h;
}

/** a book over a store of cells (each a list of roads; absent: not there yet), the levelling levelTile's */
function bookOver(store: Map<string, LevelRoad[]>) {
  return new StreetLevelBook<LevelRoad[]>(
    async (cx, cy) => store.get(`${cx}/${cy}`) ?? null,
    async (h, z, x, y, cells) => levelTile(h, SIDE, z, x, y, cells.flat()),
  );
}
/** the cells' store with every other cell about the tile there, empty — as a town's are */
function emptyStore() {
  const s = new Map<string, LevelRoad[]>();
  for (const [cx, cy] of about) s.set(`${cx}/${cy}`, []);
  return s;
}

test("the cells about a tile: its own z 15 cell and its eight neighbours'", () => {
  expect(about.length).toBe(9);
  expect(about[4]).toEqual([Math.floor(X / 4), Math.floor(Y / 4)]);
  expect(touches(Z, X, Y, cellA[0] + 1, cellA[1] + 1)).toBe(true);
  expect(touches(Z, X, Y, cellA[0] + 2, cellA[1])).toBe(false);
});

test("the same ground whatever arrives first: the cells before the tile, or the tile before them, one by one", async () => {
  // (order 1: the cells there, then the tile)
  const s1 = emptyStore();
  s1.set(`${cellA[0]}/${cellA[1]}`, [ew]);
  s1.set(`${cellB[0]}/${cellB[1]}`, [ns]);
  const b1 = bookOver(s1);
  const first = survey();
  expect(await b1.level("t", Z, X, Y, first)).toBeGreaterThan(1000);
  expect(b1.kept).toBe(0);

  // (order 2: the tile, then cell A, then cell B — the tile levelled again from its survey at each arrival)
  const s2 = emptyStore();
  s2.delete(`${cellA[0]}/${cellA[1]}`);
  s2.delete(`${cellB[0]}/${cellB[1]}`);
  const b2 = bookOver(s2);
  const tile = survey();
  expect(await b2.level("t", Z, X, Y, tile)).toBe(0);
  expect(b2.kept).toBe(1);
  s2.set(`${cellA[0]}/${cellA[1]}`, [ew]);
  const r1 = await b2.arrived([cellA]);
  expect(r1.length).toBe(1);
  expect(b2.kept).toBe(1);
  s2.set(`${cellB[0]}/${cellB[1]}`, [ns]);
  const r2 = await b2.arrived([cellB]);
  expect(r2.length).toBe(1);
  expect(b2.kept).toBe(0);
  // (bit for bit the first order's ground)
  expect(Buffer.from(r2[0]!.h.buffer).equals(Buffer.from(first.buffer))).toBe(true);

  // (positive witness: levelled again from the heights already levelled with A — not from the survey — the ground differs: the
  // survey kept is what makes the orders agree)
  const stacked = r1[0]!.h.slice();
  levelTile(stacked, SIDE, Z, X, Y, [ew, ns]);
  let diff = 0;
  for (let i = 0; i < stacked.length; i++) diff = Math.max(diff, Math.abs(stacked[i]! - first[i]!));
  expect(diff).toBeGreaterThan(0.01);
});

test("a cell arriving while the tile is being levelled: levelled again at once by its own call", async () => {
  const s = emptyStore();
  s.delete(`${cellA[0]}/${cellA[1]}`);
  let gate: (() => void) | null = null;
  const book = new StreetLevelBook<LevelRoad[]>(
    async (cx, cy) => {
      // (the first reading of cell A — not there yet — answered only after the cell has arrived: the levelling went on without it)
      const v = s.get(`${cx}/${cy}`) ?? null;
      if (cx === cellA[0] && cy === cellA[1] && gate === null) await new Promise<void>((go) => (gate = go));
      return v;
    },
    async (h, z, x, y, cells) => levelTile(h, SIDE, z, x, y, cells.flat()),
  );
  const h = survey();
  const levelling = book.level("t", Z, X, Y, h);
  await Promise.resolve();
  s.set(`${cellA[0]}/${cellA[1]}`, [ew]);
  expect((await book.arrived([cellA])).length).toBe(0);
  gate!();
  expect(await levelling).toBeGreaterThan(1000);
  const ref = survey();
  levelTile(ref, SIDE, Z, X, Y, [ew]);
  expect(Buffer.from(h.buffer).equals(Buffer.from(ref.buffer))).toBe(true);
});

test("the surveys bounded: the oldest dropped", async () => {
  const s = new Map<string, LevelRoad[]>();
  const book = new StreetLevelBook<LevelRoad[]>(
    async (cx, cy) => s.get(`${cx}/${cy}`) ?? null,
    async () => 0,
    3,
  );
  for (let k = 0; k < 5; k++) await book.level(`t${k}`, Z, X + 8 * k, Y, survey());
  expect(book.kept).toBe(3);
  expect(book.stats.dropped).toBe(2);
});

test("the game's tiles levelled through the book, its levelling in the decode worker", () => {
  const src = readFileSync(`${import.meta.dir}/../src/system/earth-tiles.ts`, "utf8");
  expect(src).toContain('op: "level"');
  const dec = readFileSync(`${import.meta.dir}/../src/system/tile-decode.ts`, "utf8");
  expect(dec).toContain('if (q.op === "level")');
});
