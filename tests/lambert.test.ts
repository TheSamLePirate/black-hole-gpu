import { expect, test } from "bun:test";
import { keplerProp } from "../src/system/our-plan";
import { lambertAll } from "../src/system/lambert";
import type { Vec3 } from "../src/math/vec3";

// Lambert's problem by Izzo's method (phase 2, audit P7): every arc found lands on r2 after tof (checked
// by Kepler's propagation), the 180° transfer the universal-variable solver could not do, the long
// way, the multi-revolution pairs when the flight lasts long enough, and none when it does not.

const hits = (mu: number, r1: Vec3, r2: Vec3, tof: number, v1: Vec3, v2: Vec3) => {
  const p = keplerProp(mu, r1, v1, tof);
  return Math.max(Math.hypot(p.r[0] - r2[0], p.r[1] - r2[1], p.r[2] - r2[2]), Math.hypot(p.v[0] - v2[0], p.v[1] - v2[1], p.v[2] - v2[2]));
};
const hz = (r: Vec3, v: Vec3) => r[0] * v[1] - r[1] * v[0];

test("the direct arc: on r2 after tof, round the normal's way", () => {
  for (const [r2, tof] of [
    [[0, 1.5, 0], 3],
    [[0.3, 1.1, 0.2], 0.5],
    [[-0.8, -0.9, 0.1], 6],
  ] as [Vec3, number][]) {
    const [L] = lambertAll(1, [1, 0, 0], r2, tof, [0, 0, 1]);
    expect(L).toBeDefined();
    expect(hits(1, [1, 0, 0], r2, tof, L!.v1, L!.v2)).toBeLessThan(1e-10);
    expect(hz([1, 0, 0], L!.v1)).toBeGreaterThan(0);
  }
});

test("the long way (the normal the other side) and the 180° transfer", () => {
  const [L] = lambertAll(1, [1, 0, 0], [0, 1.5, 0], 3, [0, 0, -1]);
  expect(hits(1, [1, 0, 0], [0, 1.5, 0], 3, L!.v1, L!.v2)).toBeLessThan(1e-10);
  expect(hz([1, 0, 0], L!.v1)).toBeLessThan(0);
  // (Hohmann's half ellipse from 1 to 1.5: π √(a³/μ), a = 1.25)
  const tH = Math.PI * Math.sqrt(1.25 ** 3);
  const [H] = lambertAll(1, [1, 0, 0], [-1.5, 0, 0], tH, [0, 0, 1]);
  expect(hits(1, [1, 0, 0], [-1.5, 0, 0], tH, H!.v1, H!.v2)).toBeLessThan(1e-9);
  expect(H!.v1[1]).toBeCloseTo(Math.sqrt(2 - 1 / 1.25), 8);
  expect(Math.abs(H!.v1[0])).toBeLessThan(1e-8);
});

test("multi-revolution: a left and a right arc for each turn the flight allows, all on target", () => {
  const r1: Vec3 = [1, 0, 0],
    r2: Vec3 = [0.3, 1.1, 0.2];
  const all = lambertAll(1, r1, r2, 25, [0, 0, 1], 5);
  const revs = all.map((L) => L.revs);
  expect(revs.filter((n) => n === 0).length).toBe(1);
  expect(Math.max(...revs)).toBeGreaterThanOrEqual(2);
  for (let n = 1; n <= Math.max(...revs); n++) expect(revs.filter((m) => m === n).length).toBe(2);
  for (const L of all) expect(hits(1, r1, r2, 25, L.v1, L.v2)).toBeLessThan(1e-9);
  // (a flight shorter than one orbit: no turn to make)
  expect(lambertAll(1, r1, r2, 2, [0, 0, 1], 5).every((L) => L.revs === 0)).toBe(true);
});
