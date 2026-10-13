import { describe, expect, test } from "bun:test";
import { dot3, len3, sub3, type V3 } from "../src/cine/rig";
import { travelPose, travelTime } from "../src/controller/travel";

// (Earth to Mars in units of 1e6 km: the camera 40 000 km off the Earth, Mars 78 million km away)
const X0: V3 = [150, 0.04, 0];
const goal = { X: [228, 1e-2, 0.004] as V3, fwd: [0, -1, 0] as V3, up: [0, 0, 1] as V3, C: [228, 0, 0] as V3 };

describe("the camera's travel", () => {
  test("from where it was to the framing, exactly", () => {
    const a = travelPose(X0, [1, 0, 0], [0, 0, 1], goal, 0);
    const b = travelPose(X0, [1, 0, 0], [0, 0, 1], goal, 1);
    expect(len3(sub3(a.X, X0))).toBeLessThan(1e-9);
    expect(len3(sub3(b.X, goal.X))).toBeLessThan(1e-9);
    expect(dot3(a.fwd, [1, 0, 0])).toBeCloseTo(1, 9);
    expect(dot3(b.fwd, goal.fwd)).toBeCloseTo(1, 9);
  });
  test("the distance to the goal falls steadily on a log scale; the look turns without a jump", () => {
    let prevD = Infinity,
      prevF: V3 | null = null,
      worst = 0;
    for (let k = 0; k <= 1.00001; k += 0.005) {
      const p = travelPose(X0, [1, 0, 0], [0, 0, 1], goal, k);
      const d = len3(sub3(p.X, goal.C));
      expect(d).toBeLessThanOrEqual(prevD * (1 + 1e-12));
      prevD = d;
      if (prevF) worst = Math.max(worst, Math.acos(Math.min(1, dot3(p.fwd, prevF))));
      prevF = p.fwd;
      expect(p.X.every(Number.isFinite)).toBe(true);
    }
    expect((worst * 180) / Math.PI).toBeLessThan(4);
  });
  test("midway it looks at the goal", () => {
    const p = travelPose(X0, [1, 0, 0], [0, 0, 1], goal, 0.5);
    const to = sub3(goal.C, p.X);
    expect(dot3(p.fwd, to) / len3(to)).toBeGreaterThan(0.999);
  });
  test("its time: longer across more orders of magnitude, within 1.2 … 6 s", () => {
    expect(travelTime(1, 1, 1.2)).toBeCloseTo(1.2, 9);
    expect(travelTime(7.8e10, 1e7, 1.2)).toBeGreaterThan(2.5);
    expect(travelTime(1e20, 1, 1.2)).toBe(6);
  });
});
