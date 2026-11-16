import { expect, test } from "bun:test";
import { bdtopoUrl } from "../src/system/bdtopo";
import { CellSource, encodeCell } from "../src/system/building-cells";
import type { CellExecutor, CellStore } from "../src/system/cell-pool";
import { cellsOnlyIn, prepareZoneCells, zoneCellTiles } from "../src/system/zone-cells";

// PLAN-J8 J8-6 — an offline zone's building cells (src/system/zone-cells.ts): its BD TOPO tiles read from its chains, each prepared
// (or found ready) by a pool of its own, counted (cells, buildings, bytes, failed); a removal drops only the cells no other zone holds.

const cell = (x: number, y: number, n: number) =>
  encodeCell(
    { source: CellSource.BdTopo, x, y, z: 15, generation: 1, originLat: 43, originLon: 6 },
    Array.from({ length: n }, () => ({}) as never),
  );

test("a zone's cells: its BD TOPO z 15 tiles among its chains, each once", () => {
  const chains = [
    ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2100/1490.png"],
    [bdtopoUrl(16971, 12014)],
    [bdtopoUrl(16972, 12014)],
    [bdtopoUrl(16971, 12014)],
    ["https://data.geopf.fr/tms/1.0.0/BDTOPO/14/8485/6007.pbf"],
  ];
  expect(zoneCellTiles(chains)).toEqual([
    { x: 16971, y: 12014 },
    { x: 16972, y: 12014 },
  ]);
});

test("prepared or found ready, counted; a failure counted, the rest prepared", async () => {
  const runs: string[] = [];
  const exec: CellExecutor = {
    size: 1,
    async run(x, y) {
      runs.push(`${x}/${y}`);
      if (x === 3) throw new Error("no tile");
      return { buf: cell(x, y, 2), ms: 1 };
    },
  };
  const store: CellStore = { get: async (x, y) => (x === 1 ? cell(x, y, 5) : null) };
  const seen: number[] = [];
  const r = await prepareZoneCells(
    [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
    exec,
    store,
    { progress: (d) => seen.push(d) },
  );
  // (the first from the store — not run —, the second prepared, the third failed)
  expect(runs).toEqual(["2/0", "3/0"]);
  expect(r.count).toBe(2);
  expect(r.buildings).toBe(7);
  expect(r.failed).toBe(1);
  expect(r.bytes).toBe(cell(1, 0, 5).byteLength + cell(2, 0, 2).byteLength);
  expect(seen).toEqual([1, 2, 3]);
});

test("no tile: nothing to do", async () => {
  const r = await prepareZoneCells([], { size: 1, run: async () => ({ buf: new ArrayBuffer(0), ms: 0 }) }, null);
  expect(r).toMatchObject({ count: 0, failed: 0 });
});

test("a removal drops only the cells no other zone holds", () => {
  const a = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ];
  expect(cellsOnlyIn(a, [[{ x: 2, y: 1 }], [{ x: 9, y: 9 }]])).toEqual([
    { x: 1, y: 1 },
    { x: 3, y: 1 },
  ]);
});
