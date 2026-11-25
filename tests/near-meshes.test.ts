import { expect, test } from "bun:test";
import { CellSource } from "../src/system/building-cells";
import { encodeMeshCell } from "../src/system/mesh-cells";
import {
  cellContact,
  cellMirrorIndex,
  contactIn,
  MIRROR_BIN_M,
  NEAR_MESH_SLOTS,
  NO_RECORD,
  nearCellArrays,
  nearCellRecords,
  nearRegionLayout,
} from "../src/system/near-meshes";
import { NEAR_REC_BLOCK, NEAR_VERT_BLOCK } from "../src/system/scenery-raster";

// PLAN-J8 J8-8 lot (2): a mesh cell's arrays for the GPU reserve — each building lifted by its own ground, the vertex indices mapped
// into the cell's vertex blocks, each triangle's record kept.

const square = (x: number, z0: number, z1: number) => ({
  positions: [x, 0, z0, x + 10, 0, z0, x + 10, 10, z1],
  triangles: [0, 1, 2],
});
const cell = () =>
  encodeMeshCell({ source: CellSource.BdTopo, z: 15, x: 1, y: 2, flags: 0, generation: 7, originLat: 43.1, originLon: 5.9 }, [
    { leaves: [[1, 2, 3, 4]], parts: [{ leaf: 0, ...square(0, -3, 12) }], flags: 0, foot: Number.NaN },
    {
      leaves: [
        [5, 6, 7, 8],
        [9, 10, 11, 12],
      ],
      parts: [{ leaf: 1, ...square(100, -3, 20) }],
      flags: 0,
      foot: 55,
    },
  ]);

test("each building lifted by its own ground; its box given to the ground's sampling", () => {
  const boxes: number[][] = [];
  const a = nearCellArrays(cell(), [3], (rank, ...box) => {
    boxes.push([rank, ...box]);
    return rank === 0 ? 100 : 200;
  })!;
  expect(boxes).toEqual([
    [0, 0, 0, 10, 10],
    [1, 100, 0, 110, 10],
  ]);
  // (4 floats a vertex: east, north, height over the ellipsoid, 0)
  expect(Array.from(a.pos.subarray(0, 12))).toEqual([0, 0, 97, 0, 10, 0, 97, 0, 10, 10, 112, 0]);
  expect(a.pos[4 * 3 + 2]).toBe(197);
  expect(a.pos[4 * 5 + 2]).toBe(220);
});

test("the vertex indices into the cell's blocks; each triangle its leaf's record through the record blocks, none without", () => {
  const base = 3 * NEAR_VERT_BLOCK;
  const none = nearCellArrays(cell(), [3], () => 0)!;
  expect(Array.from(none.tris)).toEqual([base, base + 1, base + 2, NO_RECORD, base + 3, base + 4, base + 5, NO_RECORD]);
  const a = nearCellArrays(cell(), [3], () => 0, [5])!;
  expect(Array.from(a.tris)).toEqual([base, base + 1, base + 2, 5 * NEAR_REC_BLOCK, base + 3, base + 4, base + 5, 5 * NEAR_REC_BLOCK + 2]);
});

test("a cell's records lifted by their building's ground: bottom, top, walls' top, roof planes' heights", () => {
  // (a leaf: [bottom, top, edges, 1], its box, [wall rgb, packed], its edges, [roof rgb, walls' top], its planes)
  const packed = (np: number) => np << 14;
  const leaf = [0, 12, 1, 1, 9, 9, 9, 9, 0.5, 0.5, 0.5, packed(1), 1, 2, 3, 4, 0.3, 0.3, 0.3, 10, 0.1, 0.2, 12, 0];
  const buf = encodeMeshCell({ source: CellSource.BdTopo, z: 15, x: 1, y: 2, flags: 0, generation: 7, originLat: 43.1, originLon: 5.9 }, [
    { leaves: [leaf], parts: [{ leaf: 0, ...square(0, -3, 12) }], flags: 0, foot: Number.NaN },
  ]);
  const r = Array.from(nearCellRecords(buf, [100]));
  expect(r).toEqual([
    100,
    112,
    1,
    1,
    9,
    9,
    9,
    9,
    0.5,
    0.5,
    0.5,
    packed(1),
    1,
    2,
    3,
    4,
    0.30000001192092896,
    0.30000001192092896,
    0.30000001192092896,
    110,
    0.10000000149011612,
    0.20000000298023224,
    112,
    0,
  ]);
});

test("the walker against a cell's building: its wall blocks, its roof carries, beside it nothing", () => {
  // (a 10 m square, walls 0–12 m over its foot, a flat roof at 12: no plane — its top)
  const edges = [0, 0, 10, 0, 10, 0, 10, 10, 10, 10, 0, 10, 0, 10, 0, 0];
  const leaf = [-3, 12, 4, 1, 5, 5, 5, 5, 0.5, 0.5, 0.5, 0, ...edges, 0.3, 0.3, 0.3, 12];
  const buf = encodeMeshCell({ source: CellSource.BdTopo, z: 15, x: 1, y: 2, flags: 0, generation: 7, originLat: 43.1, originLon: 5.9 }, [
    { leaves: [leaf], parts: [{ leaf: 0, ...square(0, -3, 12) }], flags: 0, foot: Number.NaN },
  ]);
  const C = cellContact(buf, nearCellRecords(buf, [100]));
  // (at its foot, inside: the wall's)
  expect(contactIn(C, 5, 5, 100).blocked).toBe(true);
  // (on its roof: carried, 0 m up)
  const roof = contactIn(C, 5, 5, 112);
  expect(roof.blocked).toBe(false);
  expect(roof.support).toBeCloseTo(0, 5);
  // (beside it, 2 m off its wall)
  expect(contactIn(C, 12, 5, 100)).toEqual({ blocked: false, support: Number.NEGATIVE_INFINITY });
});

// (26 Nov 2026 — PROBLEMES « les reflets de la Seine »: the water's mirror of the near cells' buildings, trace.wgsl nearMirror) a cell's
// index: its leaves' boxes binned by MIRROR_BIN_M, each leaf in every bin its box touches, their records' places as recordAt gives them
test("a cell's mirror index: each leaf's box in every bin it touches, its bottom, top and record's place", () => {
  const sq = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
  // (a 10 m square at the origin; a block 70 m long from 40 to 110 m east — three bins of 32 m)
  const a = [-3, 12, 4, 1, 5, 5, 5, 5, 0.5, 0.5, 0.5, 0, ...sq(0, 0, 10, 10), 0.3, 0.3, 0.3, 12];
  const b = [-3, 20, 4, 1, 75, 5, 35, 5, 0.6, 0.5, 0.4, 0, ...sq(40, 0, 110, 10), 0.3, 0.3, 0.3, 20];
  const buf = encodeMeshCell({ source: CellSource.BdTopo, z: 15, x: 1, y: 2, flags: 0, generation: 7, originLat: 43.1, originLon: 5.9 }, [
    { leaves: [a], parts: [{ leaf: 0, ...square(0, -3, 12) }], flags: 0, foot: Number.NaN },
    { leaves: [b], parts: [{ leaf: 0, ...square(40, -3, 20) }], flags: 0, foot: Number.NaN },
  ]);
  const rec = nearCellRecords(buf, [100, 50]);
  const idx = cellMirrorIndex(buf, rec, (o) => 1_000_000 + o)!;
  const u = new Uint32Array(idx.buffer);
  const [i0, j0, nx, ny, bin, binsAt, entriesAt, entries] = Array.from(idx.subarray(0, 8));
  expect([i0, j0, nx, ny, bin]).toEqual([0, 0, 4, 1, MIRROR_BIN_M]);
  // (the square in bin 0; the block in bins 1, 2, 3)
  expect(entries).toBe(4);
  const binOf = (k: number) => [idx[4 * binsAt! + 2 * k]!, idx[4 * binsAt! + 2 * k + 1]!];
  expect([0, 1, 2, 3].map(binOf)).toEqual([
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  const entry = (e: number) => {
    const at = 4 * (entriesAt! + 2 * e);
    return { box: Array.from(idx.subarray(at, at + 4)), lo: idx[at + 4], hi: idx[at + 5], rec: u[at + 6] };
  };
  // (its bottom and top lifted by its ground, its record's place: the leaf's first vec4 through recordAt)
  expect(entry(0)).toEqual({ box: [0, 0, 10, 10], lo: 97, hi: 112, rec: 1_000_000 });
  const second = 4 + 4;
  expect(entry(2)).toEqual({ box: [40, 0, 110, 10], lo: 47, hi: 70, rec: 1_000_000 + second });
  // (a cell without a leaf: none)
  const empty = encodeMeshCell(
    { source: CellSource.BdTopo, z: 15, x: 1, y: 2, flags: 0, generation: 7, originLat: 43.1, originLon: 5.9 },
    [],
  );
  expect(cellMirrorIndex(empty, nearCellRecords(empty, []), (o) => o)).toBeNull();
});

test("the region's layout: the mirror's list right after the frames (trace.wgsl nearMirror finds it at NEAR_MESH_SLOTS · 4), its indexes, the table, the records", () => {
  const L = nearRegionLayout((48 * 1024 * 1024) / 16);
  expect(L.list).toBe(NEAR_MESH_SLOTS * 4);
  expect(L.index).toBeGreaterThan(L.list);
  expect(L.table).toBeGreaterThan(L.index);
  expect(L.records).toBeGreaterThan(L.table);
  expect(L.records + L.blocks * 1024).toBeLessThanOrEqual(L.tail);
});
