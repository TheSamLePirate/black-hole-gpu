import { expect, test } from "bun:test";
import { cabinHitOf } from "../src/cockpit/pick";
import { TriBVH } from "../src/system/collide";

// PLAN-COCKPIT: what a pixel's ray meets in the cabin — a screen (68) found with its display and the point on
// it (its baked uv: 2 × the display + u, v), a console (62) with its face towards the eye.

test("a ray meets a screen: its display and where on it; a console behind it hidden", () => {
  // a screen: a 1 × 1 m square at z = 2, facing −z, display 5 (uv.x = 10 + u); a console at z = 3
  const V = (x: number, y: number, z: number, mat: number, u: number, v: number) => [x, y, z, 0, 0, -1, mat, 1, u, v];
  const verts = new Float32Array([
    ...V(0, 0, 2, 68, 10, 0),
    ...V(1, 0, 2, 68, 10.999, 0),
    ...V(1, 1, 2, 68, 10.999, 0.999),
    ...V(0, 1, 2, 68, 10, 0.999),
    ...V(-5, -5, 3, 62, 0.4, 3.2),
    ...V(5, -5, 3, 62, 0.4, 3.2),
    ...V(0, 5, 3, 62, 0.4, 3.2),
  ]);
  const pos = new Float32Array(7 * 3);
  for (let i = 0; i < 7; i++) pos.set(verts.subarray(10 * i, 10 * i + 3), 3 * i);
  const bvh = new TriBVH(pos, new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6]));
  const h = cabinHitOf([0.25, 0.75, 0], [0, 0, 1], bvh, verts)!;
  expect(h.mat).toBe(68);
  expect(h.t).toBeCloseTo(2, 6);
  expect(h.screen!.slot).toBe(5);
  expect(h.screen!.u).toBeCloseTo(0.25, 2);
  expect(h.screen!.v).toBeCloseTo(0.75, 2);
  // (the face's normal turned towards the eye)
  expect(h.n[2]).toBeLessThan(0);
  const c = cabinHitOf([2, -2, 0], [0, 0, 1], bvh, verts)!;
  expect(c.mat).toBe(62);
  expect(c.screen).toBeUndefined();
  expect(cabinHitOf([30, 0, 0], [0, 0, 1], bvh, verts)).toBeNull();
});
