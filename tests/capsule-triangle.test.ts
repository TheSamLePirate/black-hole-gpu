import { expect, test } from "bun:test";
import { TriBVH } from "../src/system/collide";
const bvh = new TriBVH(new Float32Array([0, -5, -5, 0, 5, -5, 0, 0, 5]), new Uint32Array([0, 1, 2]));
test("capsule contacts the face, edge and a thin triangle without entering the hull", () => {
  expect(bvh.capsule([0.2, 0, -1], [0.2, 0, 1], 0.3)).toBe(true);
  expect(bvh.capsule([0.4, 0, -1], [0.4, 0, 1], 0.3)).toBe(false);
  expect(bvh.capsule([-1, 0, 0], [1, 0, 0], 0.01)).toBe(true);
  expect(bvh.capsule([0, 5, -5.1], [0, 5, -5.1], 0.2)).toBe(true);
  expect(bvh.capsule([100, 100, 100], [101, 101, 101], 0.3)).toBe(false);
});
