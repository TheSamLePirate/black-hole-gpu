// The feet's IK: the knee solved with the leg's lengths kept and in its own plane, the shortest-arc turn, a
// matrix turned about a joint — and the whole skeleton's feet on a slope (AstronautModel.placeFeet, no GPU).
import { expect, test } from "bun:test";
import { jointAt, rotateAbout, rotationBetween, solveKnee } from "../src/character-ik";
import { AstronautModel } from "../src/character-model";

type V = [number, number, number];
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

test("the knee: lengths kept, the target reached, bent forward as it was; out of reach, the leg straight towards it", () => {
  const hip: V = [0, 1, 0],
    knee: V = [0, 0.55, 0.05],
    ankle: V = [0, 0.1, 0];
  const a = dist(hip, knee),
    b = dist(knee, ankle);
  for (const target of [
    [0, 0.25, 0],
    [0, 0.15, 0.1],
    [0.05, 0.3, -0.05],
  ] as V[]) {
    const k = solveKnee(hip, knee, ankle, target);
    expect(dist(k, hip)).toBeCloseTo(a, 6);
    expect(dist(k, target)).toBeCloseTo(b, 6);
    // (bent the way it was: the knee on the same side of the hip–target line)
    const d = target.map((v, i) => v - hip[i]!),
      n = Math.hypot(...d);
    const off = (p: V) => {
      const v = p.map((x, i) => x - hip[i]!),
        t = (v[0]! * d[0]! + v[1]! * d[1]! + v[2]! * d[2]!) / (n * n);
      return v.map((x, i) => x - d[i]! * t);
    };
    const now = off(k),
      was = off(knee);
    expect(now[0]! * was[0]! + now[1]! * was[1]! + now[2]! * was[2]!).toBeGreaterThan(0);
  }
  const far: V = [0, -2, 0];
  const k = solveKnee(hip, knee, ankle, far);
  expect(dist(k, hip)).toBeCloseTo(a, 6);
  // (straight: the knee on the hip–target line, a millimetre short of locked)
  expect(Math.abs(k[2])).toBeLessThan(0.03);
});

test("the shortest arc turns one direction onto another, and a matrix turns about its joint", () => {
  for (const [from, to] of [
    [
      [0, 1, 0],
      [1, 0, 0],
    ],
    [
      [0.3, -1, 0.2],
      [0.1, -0.9, 0.5],
    ],
    [
      [0, 0, 1],
      [0, 0, -1],
    ],
  ] as [V, V][]) {
    const R = rotationBetween(from, to);
    const r = [0, 1, 2].map((i) => R[i * 3]! * from[0] + R[i * 3 + 1]! * from[1] + R[i * 3 + 2]! * from[2]);
    const n = Math.hypot(...from) / Math.hypot(...to);
    to.forEach((v, i) => expect(r[i]!).toBeCloseTo(v * n, 6));
    // (a rotation: orthonormal rows)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        expect(R[i * 3]! * R[j * 3]! + R[i * 3 + 1]! * R[j * 3 + 1]! + R[i * 3 + 2]! * R[j * 3 + 2]!).toBeCloseTo(i === j ? 1 : 0, 6);
  }
  const m = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1]);
  rotateAbout(m, [2, 3, 4], rotationBetween([0, 1, 0], [1, 0, 0]));
  expect(jointAt(m)).toEqual([2, 3, 4]);
  expect([m[4]!, m[5]!, m[6]!].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0]);
});

/** A two-legged skeleton (Armature, root, pelvis, each leg's thigh, calf, foot, ball): the astronaut's names. */
function skeleton() {
  const q = [0, 0, 0, 1],
    s = [1, 1, 1];
  const nodes = [
    { name: "Armature", t: [0, 0, 0], r: q, s, parent: -1 },
    { name: "root", t: [0, 0, 0], r: q, s, parent: 0 },
    { name: "pelvis", t: [0, 0.95, 0], r: q, s, parent: 1 },
  ];
  for (const [side, x] of [
    ["l", 0.1],
    ["r", -0.1],
  ] as const) {
    const t = nodes.length;
    nodes.push({ name: `thigh_${side}`, t: [x, -0.05, 0], r: q, s, parent: 2 });
    // (the knee a little forward: the leg bent as in a stride's rest)
    nodes.push({ name: `calf_${side}`, t: [0, -0.43, 0.03], r: q, s, parent: t });
    nodes.push({ name: `foot_${side}`, t: [0, -0.4, -0.03], r: q, s, parent: t + 1 });
    nodes.push({ name: `ball_${side}`, t: [0, -0.05, 0.12], r: q, s, parent: t + 2 });
  }
  const joints = nodes.map((_, i) => i);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return {
    nodes,
    joints,
    inverse: joints.flatMap(() => identity),
    clips: [0, 1, 2].map((k) => ({ name: `clip${k}`, duration: 1, tracks: [] })),
    nv: 0,
    ni: 0,
    stride: 84,
  };
}
function model() {
  (globalThis as { GPUBufferUsage?: unknown }).GPUBufferUsage ??= { STORAGE: 128, COPY_DST: 8 };
  const device = {
    createBuffer: () => ({}),
    createSampler: () => ({}),
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice;
  const m = new AstronautModel(device);
  (m as unknown as { prepare(x: unknown): void }).prepare(skeleton());
  return m;
}
const feet = (m: AstronautModel) => {
  const g = (m as unknown as { global: Float32Array[] }).global;
  return [jointAt(g[5]!), jointAt(g[9]!)];
};

test("on flat ground the feet stay as the clip holds them; on a slope the body drops for the low foot, the high one is lifted", () => {
  const m = model();
  m.evaluate(0, 0, false, () => 0);
  const flat = feet(m);
  expect(m.footDrop).toBe(0);
  // (a slope rising to the left, +x: 20 %)
  const slope = (x: number) => 0.2 * x;
  for (let i = 0; i < 120; i++) m.evaluate(i / 60, 0, false, slope);
  const [left, right] = feet(m);
  // (the right foot is 2 cm lower: the body lowered by as much, the left foot raised by 4 cm over the body)
  expect(m.footDrop).toBeCloseTo(-0.02, 3);
  expect(left![1] + m.footDrop - flat[0]![1]).toBeCloseTo(0.02, 3);
  expect(right![1] + m.footDrop - flat[1]![1]).toBeCloseTo(-0.02, 3);
  // (the feet keep their place across the ground: only their height changes, a few millimetres at most)
  expect(Math.abs(left![0] - flat[0]![0]) + Math.abs(left![2] - flat[0]![2])).toBeLessThan(0.01);
  // (the legs' lengths kept)
  const g = (m as unknown as { global: Float32Array[] }).global;
  expect(dist(jointAt(g[3]!), jointAt(g[4]!))).toBeCloseTo(Math.hypot(0.43, 0.03), 5);
  expect(dist(jointAt(g[4]!), jointAt(g[5]!))).toBeCloseTo(Math.hypot(0.4, 0.03), 5);
  // (in the air: back to the clip's pose, the body up again)
  for (let i = 0; i < 120; i++) m.evaluate(2 + i / 60, 0, true, null);
  expect(Math.abs(m.footDrop)).toBeLessThan(1e-4);
  expect(dist(feet(m)[0]!, flat[0]!)).toBeLessThan(1e-5);
  // (a wall's foot or an edge — more than 35 cm —: that foot left as the clip has it)
  for (let i = 0; i < 120; i++) m.evaluate(4 + i / 60, 0, false, (x) => (x > 0 ? 2 : 0));
  expect(m.footDrop).toBeCloseTo(0, 4);
  expect(dist(feet(m)[0]!, flat[0]!)).toBeLessThan(1e-4);
});
