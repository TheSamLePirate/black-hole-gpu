import { describe, expect, test } from "bun:test";
import {
  BLEND_STYLES,
  blendCurve,
  bindingTarget,
  Follow,
  type FollowOptions,
  Impulses,
  qAxes,
  qExp,
  qFromAxes,
  qLog,
  qMul,
  qConj,
  qRot,
  RotSpring,
} from "../src/cine/follow";
import { dot3, len3, sub3, type V3 } from "../src/cine/rig";

const D = Math.PI / 180;
const angle = (a: [number, number, number, number], b: [number, number, number, number]) => len3(qLog(qMul(a, qConj(b)))) / D;

describe("quaternions", () => {
  test("axes round trip, log and exp", () => {
    const q = qExp([0.3, -1.1, 0.7]);
    const [x, y, z] = qAxes(q);
    const r = qFromAxes(x, y, z);
    expect(angle(q, r)).toBeLessThan(1e-6);
    const v = qLog(q);
    expect(v[0]).toBeCloseTo(0.3, 9);
    expect(v[1]).toBeCloseTo(-1.1, 9);
    expect(qRot(qExp([0, 0, Math.PI / 2]), [1, 0, 0])[1]).toBeCloseTo(1, 9);
  });
});

describe("the rotation's damping", () => {
  test("a steady turn followed without lag (the Endurance's spin, its rate fed forward)", () => {
    const s = new RotSpring();
    const w = 1.2; // rad/s about y
    let err = 0;
    for (let k = 0; k <= 600; k++) {
      const t = k / 60;
      const target = qExp([0, w * t, 0]);
      const q = s.step(target, [0.3, 0.3, 0.3], 1 / 60);
      if (k > 480) err = Math.max(err, angle(q, target));
    }
    expect(err).toBeLessThan(0.3);
  });
  test("a jolt (60°/s for half a second, then held): smoothed, hardly overshot, caught up", () => {
    const s = new RotSpring();
    let peak = 0,
      lagMax = 0,
      a = 0,
      q = s.step(qExp([0, 0, 0]), [0.25, 0.25, 0.25], 1 / 60);
    for (let k = 1; k < 300; k++) {
      a = Math.min(k / 60, 0.5) * 60;
      q = s.step(qExp([0, a * D, 0]), [0.25, 0.25, 0.25], 1 / 60);
      const turned = (qLog(q)[1] ?? 0) / D;
      peak = Math.max(peak, turned);
      lagMax = Math.max(lagMax, a - turned);
    }
    expect(lagMax).toBeGreaterThan(2);
    expect(peak).toBeLessThan(30 + 2);
    expect((qLog(q)[1] ?? 0) / D).toBeCloseTo(30, 0);
  });
  test("a rigid axis follows at once, the others lag", () => {
    const s = new RotSpring();
    s.step(qExp([0, 0, 0]), [0.5, 0, 0.5], 1 / 60);
    const q = s.step(qExp([0, 20 * D, 0]), [0.5, 0, 0.5], 1 / 60);
    expect(len3(qLog(q)) / D).toBeCloseTo(20, 1);
  });
  test("stable on a long frame", () => {
    const s = new RotSpring();
    s.step(qExp([0, 0, 0]), [0.05, 0.05, 0.05], 1 / 60);
    const q = s.step(qExp([0, 1, 0]), [0.05, 0.05, 0.05], 0.5);
    expect(Number.isFinite(q[3])).toBe(true);
    expect(angle(q, qExp([0, 1, 0]))).toBeLessThan(15);
  });
});

const opts = (o: Partial<FollowOptions> = {}): FollowOptions => ({
  binding: "lockToTarget",
  rotDamp: [0, 0, 0],
  posDamp: 0,
  lookahead: 0,
  screen: [0, 0],
  dutch: 0,
  noise: "none",
  noiseAmp: 1,
  noiseFreq: 1,
  impulse: 1,
  ...o,
});
const chase = { eye: [0, 4.4, -13.5] as V3, aim: [0, 1.3, 12] as V3 };
const input = (q: [number, number, number, number], vel: V3 = [0, 0, 100], time = 0) => ({
  q,
  centre: qRot(q, [0, 1.2, 0]),
  vel,
  up: [0, 1, 0] as V3,
  ...chase,
  tanH: Math.tan(30 * D),
  aspect: 16 / 9,
  time,
});

describe("a hull view softened", () => {
  test("no damping: the rigid attach point", () => {
    const f = new Follow();
    const q = qExp([0.2, 0.5, -0.3]);
    const o = f.step(input(q), opts(), 1 / 60);
    expect(len3(sub3(o.eye, chase.eye))).toBeLessThan(1e-9);
    expect(len3(sub3(o.aim, chase.aim))).toBeLessThan(1e-9);
    expect(o.up[1]).toBeCloseTo(1, 9);
  });
  test("damped: settles on the rigid attach point; a pull-up lags the view, then it catches up", () => {
    const f = new Follow();
    const o0 = opts({ rotDamp: [0.3, 0.3, 0.3] });
    for (let k = 0; k < 120; k++) f.step(input(qExp([0, 0, 0])), o0, 1 / 60);
    // (the nose up 20° at once: the camera, in the craft's frame, swings — then back to its place)
    const q = qExp([-20 * D, 0, 0]);
    const a = f.step(input(q), o0, 1 / 60);
    expect(len3(sub3(a.eye, chase.eye))).toBeGreaterThan(1);
    let o = a;
    for (let k = 0; k < 240; k++) o = f.step(input(q), o0, 1 / 60);
    expect(len3(sub3(o.eye, chase.eye))).toBeLessThan(0.05);
  });
  test("the world's up: the craft rolls 45°, the view's up stays the world's", () => {
    const f = new Follow();
    const q = qExp([0, 0, 45 * D]);
    const o = f.step(input(q), opts({ binding: "worldUp" }), 1 / 60);
    const upWorld = qRot(q, o.up);
    expect(upWorld[1]).toBeGreaterThan(0.99);
  });
  test("without the roll: the nose kept, the top up", () => {
    const q = qExp([0, 0, 60 * D]);
    const b = bindingTarget("lockNoRoll", q, [0, 1, 0], null);
    const [, y, z] = qAxes(b);
    expect(dot3(z, qAxes(q)[2])).toBeCloseTo(1, 9);
    expect(y[1]).toBeCloseTo(1, 6);
  });
  test("the position's damping: an acceleration leaves the camera behind, bounded", () => {
    const f = new Follow();
    const o0 = opts({ posDamp: 0.4 });
    let o = f.step(input(qExp([0, 0, 0]), [0, 0, 100]), o0, 1 / 60);
    for (let k = 1; k < 120; k++) o = f.step(input(qExp([0, 0, 0]), [0, 0, 100 + 30 * (k / 60)]), o0, 1 / 60);
    // (30 m/s² forwards: the eye further back)
    expect(o.eye[2]).toBeLessThan(chase.eye[2] - 1);
    expect(o.eye[2]).toBeGreaterThan(chase.eye[2] - 0.36 * 26);
  });
  test("the composer's offset and the dutch", () => {
    const f = new Follow();
    const o = f.step(input(qExp([0, 0, 0])), opts({ screen: [0.2, 0], dutch: 10 }), 1 / 60);
    // (the target right of centre: the look turned left — its aim's x the other way; the up rolled)
    expect(o.aim[0]).toBeGreaterThan(chase.aim[0] + 1);
    expect(Math.abs(o.up[0])).toBeGreaterThan(0.1);
  });
});

describe("the blends and the impulses", () => {
  test("every curve from 0 to 1, rising (a cut at once)", () => {
    for (const s of BLEND_STYLES) {
      if (s === "cut") {
        expect(blendCurve(s, 0)).toBe(1);
        continue;
      }
      expect(blendCurve(s, 0)).toBeCloseTo(0, 9);
      expect(blendCurve(s, 1)).toBeCloseTo(1, 9);
      let prev = -1;
      for (let t = 0; t <= 1; t += 0.05) {
        const v = blendCurve(s, t);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = v;
      }
    }
  });
  test("an impulse: a jolt, gone after a few of its decays", () => {
    const I = new Impulses();
    I.add(1, 10, 0.5);
    const now = I.angles(10.1, 1);
    expect(len3(now)).toBeGreaterThan(0);
    expect(len3(I.angles(13, 1))).toBe(0);
  });
});

describe("the blend between two views", () => {
  const centre: V3 = [0, 1, 0];
  test("forward-looking to backward-looking (cockpit → docking camera): no flip, the look turns steadily", async () => {
    const { blendPose } = await import("../src/cine/follow");
    const a = { eye: [1, 1.45, 3.1] as V3, aim: [1, 1.22, 13] as V3, up: [0, 1, 0] as V3 };
    const b = { eye: [0.04, 1.11, -5.5] as V3, aim: [0.04, 1.11, -40] as V3, up: [0, 1, 0] as V3 };
    let prevF: V3 | null = null;
    let worst = 0;
    for (let k = 0; k <= 1.0001; k += 0.01) {
      const p = blendPose(a, b, k, centre);
      const f = sub3(p.aim, p.eye);
      const l = len3(f);
      expect(l).toBeGreaterThan(1);
      const fu: V3 = [f[0] / l, f[1] / l, f[2] / l];
      if (prevF) worst = Math.max(worst, Math.acos(Math.min(1, dot3(fu, prevF))) / D);
      prevF = fu;
      expect(p.up[1]).toBeGreaterThan(0.5);
    }
    // (180° over 100 steps: about 2° a step at most at the curve's steepest)
    expect(worst).toBeLessThan(5);
  });
  test("the ends are the views", async () => {
    const { blendPose } = await import("../src/cine/follow");
    const a = { eye: [0, 4, -13] as V3, aim: [0, 1, 12] as V3, up: [0, 1, 0] as V3 };
    const b = { eye: [6, 3.9, -10] as V3, aim: [-3, 2.6, 14] as V3, up: [0, 1, 0] as V3 };
    const p0 = blendPose(a, b, 0, centre),
      p1 = blendPose(a, b, 1, centre);
    expect(len3(sub3(p0.eye, a.eye))).toBeLessThan(1e-9);
    expect(len3(sub3(p1.aim, b.aim))).toBeLessThan(1e-9);
  });
});
