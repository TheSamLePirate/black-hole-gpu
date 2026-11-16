import { expect, test } from "bun:test";
import { cellOf, cellOrigin, toCell } from "../src/system/building-cells";
import { BLOCK_RECORDS, cellFrameInScene, cellPriority, orderCells, POOL_RECORD_BYTES, RecordPool } from "../src/system/building-layer";
import { localPoint, sceneryFrame } from "../src/system/scenery-data";

// PLAN-J8 J8-4, its CPU side: the record pool by blocks, the order of residence, a cell's frame in the scene's.

test("the pool: blocks by the budget, a cell in whole blocks, none past the budget, the freed ones reused lowest first", () => {
  const p = new RecordPool(10 * BLOCK_RECORDS * POOL_RECORD_BYTES + 100);
  expect(p.blocks).toBe(10);
  expect(p.bytes).toBe(10 * BLOCK_RECORDS * POOL_RECORD_BYTES);
  const a = p.alloc("a", 2497)!;
  expect(a).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].slice(0, Math.ceil(2497 / BLOCK_RECORDS)));
  expect(p.alloc("b", 2 * BLOCK_RECORDS)).toBeNull();
  expect(p.freeBlocks).toBe(0);
  p.release(a.slice(2));
  const b = p.alloc("b", BLOCK_RECORDS + 1)!;
  expect(b).toEqual([2, 3]);
  expect(p.ownerOf(2)).toBe("b");
  expect(p.ownerOf(0)).toBe("a");
  p.release(a);
  expect(p.ownerOf(0)).toBeNull();
  expect(p.alloc("c", 1)).toEqual([0]);
});

test("the order: in view and near, then the trajectory, then behind, then the rest", () => {
  const eye = { lat: 43.06, lon: 6.32, heading: (270 * Math.PI) / 180, speed: 140, halfFov: (35 * Math.PI) / 180 };
  const at = (eastKm: number, northKm: number) =>
    cellOf(eye.lat + (northKm * 1000) / 111320, eye.lon + (eastKm * 1000) / (111320 * Math.cos((eye.lat * Math.PI) / 180)));
  const ahead = at(-8, 0),
    farAhead = at(-20, 0),
    behind = at(2.5, 0),
    side = at(0, -12);
  expect(cellPriority(ahead.x, ahead.y, eye)[0]).toBe(0);
  // (20 km ahead: in view, past the near reach (15 km) — rank 1, after the near ones)
  expect(cellPriority(farAhead.x, farAhead.y, eye)[0]).toBe(1);
  expect(cellPriority(behind.x, behind.y, eye)[0]).toBe(2);
  expect(cellPriority(side.x, side.y, eye)[0]).toBe(3);
  const order = orderCells([side, behind, farAhead, ahead], eye);
  expect(order).toEqual([ahead, farAhead, behind, side]);
});

test("a cell's frame in the scene's: a record's point there as localPoint puts it, to centimetres", () => {
  const scene = { lat: 43.12, lon: 6.0 };
  const frame = sceneryFrame(scene.lat, scene.lon);
  const c = cellOf(43.13, 5.97);
  const o = cellOrigin(c.x, c.y);
  const f = cellFrameInScene(c.x, c.y, frame);
  expect(f.length).toBe(16);
  // (a building 300 m east, 200 m north of the cell's origin, its ground at 60 m over the ellipsoid)
  const lat = o.lat + 200 / 111132,
    lon = o.lon + 300 / (111320 * Math.cos((o.lat * Math.PI) / 180) * 1.0022);
  const r = toCell(o, lat, lon);
  const want = localPoint(frame, lat, lon, 60);
  const got = [0, 1, 2].map((i) => f[i]! + r.east * f[4 + i]! + r.north * f[8 + i]! + 60 * f[12 + i]!);
  for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!)).toBeLessThan(0.1);
});
