import { test, expect } from "bun:test";
import { MapCamera, basisQuat, planeBasis, rotate, dot, len, type V3 } from "../src/ui/map3d/camera";

const close = (a: V3, b: V3, eps = 1e-9) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, -Math.log10(eps)));

test("a basis quaternion turns x, y, z onto the basis", () => {
  const [e1, e2, n] = planeBasis([0.3, -0.5, 0.8], [1, 0, 0]);
  const q = basisQuat(e1, e2, n);
  close(rotate(q, [1, 0, 0]), e1);
  close(rotate(q, [0, 1, 0]), e2);
  close(rotate(q, [0, 0, 1]), n);
});

test("the camera: top view looks down the plane's normal, the focus at the centre, zoom keeps the pointed spot", () => {
  const c = new MapCamera();
  c.resize(800, 600);
  const [e1, e2, n] = planeBasis([0, 1, 1]);
  c.goal = { focus: [5, -2, 1], plane: basisQuat(e1, e2, n), yaw: 0.4, pitch: Math.PI / 2 - 1e-6, dist: 3 };
  c.snap();
  close(c.fwd, n.map((x) => -x) as V3, 1e-5);
  const p = c.project([5, -2, 1]);
  expect(p.x).toBeCloseTo(400, 6);
  expect(p.y).toBeCloseTo(300, 6);
  expect(p.z).toBeCloseTo(3, 9);
  // (orthonormal, right-handed on screen: right × up = −fwd)
  expect(Math.abs(dot(c.right, c.up))).toBeLessThan(1e-12);
  expect(len(c.right)).toBeCloseTo(1, 12);
  // a point of the plane under the pointer stays under it through a zoom (at the focus's depth)
  const target: V3 = [5 + 0.5 * e1[0], -2 + 0.5 * e1[1], 1 + 0.5 * e1[2]];
  const before = c.project(target);
  c.zoom(0.25, before.x, before.y);
  c.snap();
  const after = c.project(target);
  expect(after.x).toBeCloseTo(before.x, 4);
  expect(after.y).toBeCloseTo(before.y, 4);
});

test("easing converges to the goal, the plane too", () => {
  const c = new MapCamera();
  c.resize(400, 400);
  c.snap();
  const [e1, e2, n] = planeBasis([1, 0, 0]);
  c.setPlane(e1, e2, n);
  c.goal.dist = 1e-4;
  c.goal.focus = [3, 4, 5];
  for (let i = 0; i < 400 && c.update(1 / 60); i++);
  expect(c.update(1 / 60)).toBe(false);
  expect(c.cur.dist).toBeCloseTo(1e-4, 9);
  close(c.cur.focus, [3, 4, 5], 1e-6);
});
