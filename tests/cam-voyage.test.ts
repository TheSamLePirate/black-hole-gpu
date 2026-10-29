import { describe, expect, test } from "bun:test";
import { accelForBeta, AUTO_G, flipTimes, G_PER_M, planVoyage, type VoyageEnds } from "../src/camera/voyage";
import type { Vec3 } from "../src/physics";
import { AU_M, M_METRES, M_SECONDS } from "../src/units";

// The relativistic voyage (src/camera/voyage.ts, PLAN-CAMERA-AAA CAM4): the rocket's times exact in the void, the
// speed chosen or the duration, the ground's bound near a body, a moving goal met where it is, a body in the way cleared.

const AU = AU_M / M_METRES;
const still = (X: Vec3) => () => X;

describe("the relativistic voyage", () => {
  test("in the void, unbounded: the world's and the traveller's times are the rocket's to 1e-6", () => {
    const D = 1.5 * AU;
    const a = accelForBeta(D, 0.9);
    const e: VoyageEnds = { A: still([0, 0, 0]), B: still([D, 0, 0]), bodies: [] };
    const p = planVoyage(e, { kind: "beta", beta: 0.9 }, 0, { k: 1e9 });
    const f = flipTimes(D, a);
    expect(Math.abs(p.T / f.T - 1)).toBeLessThan(1e-6);
    expect(Math.abs(p.Tau / f.Tau - 1)).toBeLessThan(1e-6);
    expect(Math.abs(p.betaPeak - 0.9)).toBeLessThan(1e-3);
    // (Earth → Mars at 0.9 c: ~1e5 g, 20 min for the world, 14 for the traveller)
    expect(a / G_PER_M).toBeGreaterThan(9e4);
    expect(a / G_PER_M).toBeLessThan(1.2e5);
    expect((p.T * M_SECONDS) / 60).toBeCloseTo(19.8, 0);
    expect((p.Tau * M_SECONDS) / 60).toBeCloseTo(14.2, 0);
    // (midway the peak, the end at the goal at rest)
    const mid = p.at(p.T / 2);
    expect(mid.beta).toBeCloseTo(0.9, 2);
    expect(Math.abs(mid.X[0] / D - 0.5)).toBeLessThan(1e-3);
    const end = p.at(p.T);
    expect(end.X[0]).toBeCloseTo(D, 9);
    expect(end.beta).toBeLessThan(1e-3);
  });

  test("a duration chosen: the traveller's τ or the world's t met", () => {
    const D = 5 * AU;
    const e: VoyageEnds = { A: still([0, 0, 0]), B: still([D, 0, 0]), bodies: [] };
    const tau = planVoyage(e, { kind: "tau", seconds: 1800 }, 0, { k: 1e9 });
    expect(Math.abs((tau.Tau * M_SECONDS) / 1800 - 1)).toBeLessThan(1e-4);
    const t = planVoyage(e, { kind: "t", seconds: 3000 }, 0, { k: 1e9 });
    expect(Math.abs((t.T * M_SECONDS) / 3000 - 1)).toBeLessThan(1e-4);
    // (light takes 2 494 s over 5 au: no world time below it)
    const fast = planVoyage(e, { kind: "t", seconds: 2000 }, 0, { k: 1e9 });
    expect(fast.T * M_SECONDS).toBeGreaterThan(2494);
  });

  test("the ground's bound: slow by a body, the speed under k × height all the way", () => {
    const R = 6.371e6 / M_METRES;
    const earth = { id: "earth", C: still([0, 0, 0]), R };
    const e: VoyageEnds = { A: still([R + 4e5 / M_METRES, 0, 0]), B: still([AU, 0, 0]), bodies: [earth] };
    const p = planVoyage(e, { kind: "auto" }, 0);
    for (let i = 1; i < 400; i++) {
      const s = p.at((p.T * i) / 400);
      const h = Math.hypot(...s.X) - R;
      expect(s.beta).toBeLessThanOrEqual(h * M_SECONDS * 1.05 + 1e-9);
    }
    expect(p.betaPeak).toBeGreaterThan(0.5);
    // (the auto voyage's acceleration: AUTO_G)
    expect(p.a / G_PER_M).toBeCloseTo(AUTO_G, -2);
  });

  test("a moving goal met where it is; its velocity matched at the end", () => {
    const D = 0.5 * AU;
    const v: Vec3 = [0, 1e-4, 0]; // (30 km/s)
    const e: VoyageEnds = { A: still([0, 0, 0]), B: (t) => [D, v[1] * t, 0], bodies: [] };
    const p = planVoyage(e, { kind: "beta", beta: 0.5 }, 100, { k: 1e9 });
    const end = p.at(100 + p.T);
    const goal = e.B(100 + p.T);
    expect(Math.hypot(end.X[0] - goal[0], end.X[1] - goal[1], end.X[2] - goal[2]) / D).toBeLessThan(1e-9);
    expect(Math.abs(end.V[1] - v[1]) / v[1]).toBeLessThan(0.02);
  });

  test("a body in the way is cleared", () => {
    const R = 0.01 * AU;
    const e: VoyageEnds = { A: still([-AU, 0, 0]), B: still([AU, 0, 0]), bodies: [{ id: "x", C: still([0, 0, 0]), R }] };
    const p = planVoyage(e, { kind: "beta", beta: 0.5 }, 0);
    expect(p.bend).toBeGreaterThan(0);
    let closest = Infinity;
    for (let i = 0; i <= 1000; i++) closest = Math.min(closest, Math.hypot(...p.at((p.T * i) / 1000).X));
    expect(closest).toBeGreaterThan(1.2 * R);
  });
});
