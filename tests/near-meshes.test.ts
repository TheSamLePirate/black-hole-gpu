import { expect, test } from "bun:test";
import { CellSource } from "../src/system/building-cells";
import { encodeMeshCell } from "../src/system/mesh-cells";
import { NO_RECORD, nearCellArrays, nearCellRecords } from "../src/system/near-meshes";
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
