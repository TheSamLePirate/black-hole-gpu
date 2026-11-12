import { expect, test } from "bun:test";
import { craftInstanceOf, craftSurfaceId, decodeSurface, halfs, packSurfaceId, unpackSurfaceId } from "../src/system/surface-id";
import { RASTER_CODE, RASTER_CODE_SCALE } from "../src/system/terrain-raster-hint";

// PLAN-J1 J1-2: the surface's identity at a pixel, read from the visibility target as it is drawn today.

test("the contract's word: 20 bits of object, 12 of generation, 0 nothing", () => {
  expect(packSurfaceId(0, 7)).toBe(0);
  const id = packSurfaceId(872_356, 4095);
  expect(unpackSurfaceId(id)).toEqual({ object: 872_356, generation: 4095 });
  // (the generation wraps at 4096; the object at 2²⁰)
  expect(unpackSurfaceId(packSurfaceId(5, 4096 + 3))).toEqual({ object: 5, generation: 3 });
  expect(id).toBeGreaterThan(0);
});

test("each kind the visibility pass writes, decoded as the tracer reads it", () => {
  const S = RASTER_CODE_SCALE;
  // (the patch's ground: code 1, its normal in the low bits)
  expect(decodeSurface([812.5, 0, 812.5, 1 * S + 300 * 512 + 200], 9)).toMatchObject({ kind: "ground", level: 0, object: 0, id: 0 });
  // (a coarser ring: code 1 + rank 2 + 8 × step 1)
  expect(decodeSurface([5000, 0, 5000, 11 * S], 9).level).toBe(10);
  // (a tree's proxy: g its cell + 1, a 0)
  const tree = decodeSurface([0, 4242, 95.5, 0], 9);
  expect(tree).toMatchObject({ kind: "tree", object: 4242, nearest: 95.5 });
  expect(unpackSurfaceId(tree.id)).toEqual({ object: 4242, generation: 9 });
  // (a building's triangles: g its leaf)
  expect(decodeSurface([0, 77, 210, RASTER_CODE.mesh * S], 9)).toMatchObject({ kind: "building", object: 77 });
  // (marks without an object)
  expect(decodeSurface([300, 0, 300, RASTER_CODE.box * S], 9)).toMatchObject({ kind: "box", object: 0, id: 0 });
  expect(decodeSurface([300, 0, 300, RASTER_CODE.bridgeMark * S], 9).kind).toBe("bridge");
  expect(decodeSurface([0, 0, 0, RASTER_CODE.cloud * S], 9).kind).toBe("cloud");
  // (nothing drawn: the sky)
  expect(decodeSurface([0, 0, 0, 0], 9)).toMatchObject({ kind: "none", id: 0 });
});

test("half floats: a motion texel's", () => {
  // (1, −2, 0.5, 0 — 0x3c00, 0xc000, 0x3800, 0)
  expect(halfs([0x3c00, 0xc000, 0x3800, 0])).toEqual([1, -2, 0.5, 0]);
});

test("PLAN-J1 J1-5: the craft's words at the top of the object space, the instance and generation read back", () => {
  const w = craftSurfaceId(0, 7);
  expect(unpackSurfaceId(w)).toEqual({ object: (1 << 20) - 1, generation: 7 });
  expect(craftInstanceOf(w)).toBe(0);
  expect(craftInstanceOf(craftSurfaceId(5, 4095))).toBe(5);
  // (ship.wgsl composeSurface: 0xfffff − min(instance, 63) | generation << 20)
  expect(craftSurfaceId(3, 2)).toBe(((0xfffff - 3) | (2 << 20)) >>> 0);
  expect(craftInstanceOf(packSurfaceId(1234, 1))).toBeNull();
  expect(craftInstanceOf(0)).toBeNull();
});
