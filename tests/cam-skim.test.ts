import { describe, expect, test } from "bun:test";
import { planSkim } from "../src/camera/skim";
import type { Vec3 } from "../src/physics";

// The cinematic voyage's low pass (src/camera/skim.ts, PLAN-CAMERA-AAA CAM7): over a ridge it climbs before it,
// never under the ground; low it is slow, high fast; it comes in from its entry height and leaves at its exit's.
describe("the low pass over a world", () => {
  const R = 1;
  // (a ridge 3 km high — in units of a 6 371 km sphere — across the track at 90°)
  const ridge = (u: Vec3) => {
    const lon = Math.atan2(u[1], u[0]);
    return (3 / 6371) * Math.exp(-(((lon - Math.PI / 2) / 0.02) ** 2));
  };
  const spec = {
    R,
    ground: ridge,
    start: [1, 0, 0] as Vec3,
    heading: [0, 1, 0] as Vec3,
    arc: Math.PI,
    hSkim: 0.3 / 6371,
    hIn: 0.5,
    hOut: 0.5,
  };
  test("never under the ground, the ridge climbed before it", () => {
    const p = planSkim(spec);
    let minAgl = Infinity;
    for (let i = 0; i <= 2000; i++) minAgl = Math.min(minAgl, p.at(i / 2000).agl);
    expect(minAgl).toBeGreaterThan(0.25 / 6371);
  });
  test("in and out at their heights; low in the middle", () => {
    const p = planSkim(spec);
    const r = (k: number) => Math.hypot(...p.at(k).P) - R;
    expect(r(0)).toBeCloseTo(0.5, 3);
    expect(r(1)).toBeCloseTo(0.5, 3);
    expect(r(0.5)).toBeLessThan(5 / 6371);
  });
});

describe("the low pass's schedule", () => {
  test("down, along, up at one steady screen rate; continuous", () => {
    const flat = () => 0;
    const p = planSkim({
      R: 1,
      ground: flat,
      start: [1, 0, 0],
      heading: [0, 1, 0],
      arc: 0.012,
      hSkim: 900 / 6371e3,
      hIn: 2.4,
      hOut: 2.4,
      ease: 0.3,
      shares: [0.38, 0.42, 0.2],
    });
    // (not plunged at once: still high a few % in, the descent a good share of the time)
    expect(p.at(0.03).agl).toBeGreaterThan(0.3);
    expect(p.at(0.15).agl).toBeGreaterThan((900 / 6371e3) * 2);
    // (the pass low; no jump of place between frames)
    expect(p.at(0.6).agl).toBeLessThan(1100 / 6371e3);
    // (each step a small share of the height: no jump at the hand-offs between descent, pass and climb)
    let prev = p.at(0);
    let worst = 0;
    for (let i = 1; i <= 2000; i++) {
      const q = p.at(i / 2000);
      worst = Math.max(worst, Math.hypot(q.P[0] - prev.P[0], q.P[1] - prev.P[1], q.P[2] - prev.P[2]) / Math.min(q.agl, prev.agl));
      prev = q;
    }
    expect(worst).toBeLessThan(0.15);
  });
});
