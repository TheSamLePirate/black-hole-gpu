import { describe, expect, test } from "bun:test";
import { analyse, type CamSample } from "../src/camera/metrics";

// The camera's smoothness sensor (src/camera/metrics.ts, PLAN-CAMERA-AAA CAM0): a smooth flight has no fault, a
// teleport is a jump, a snapped aim a turn jump, a cut marked on purpose is forgiven, a scale change is no jump.

function run(n: number, at: (k: number) => Partial<CamSample>): CamSample[] {
  const out: CamSample[] = [];
  for (let k = 0; k < n; k++)
    out.push({ t: k * 16.7, ref: "earth", P: [0, 0, 7e6], h: 6e5, fwd: [0, 0, -1], up: [0, 1, 0], fov: 60, moving: true, ...at(k) });
  return out;
}

describe("camera smoothness sensor", () => {
  test("a steady glide and an accelerating climb have no fault", () => {
    const glide = analyse(run(120, (k) => ({ P: [k * 100, 0, 7e6] })));
    expect(glide.faults).toEqual([]);
    // (speed ∝ height: the climb exponential, as the free camera's law wants)
    const climb = analyse(run(240, (k) => ({ P: [0, 0, 6.4e6 + 1000 * Math.exp(k * 0.03)], h: 1000 * Math.exp(k * 0.03) })));
    expect(climb.faults).toEqual([]);
  });

  test("a teleport is a jump, a snapped aim a turn jump, a field change a fov jump", () => {
    const r = analyse(
      run(60, (k) => ({
        P: [k * 100 + (k >= 30 ? 50_000 : 0), 0, 7e6],
        fwd: k >= 40 ? [1, 0, 0] : [0, 0, -1],
        fov: k >= 50 ? 30 : 60,
      })),
    );
    expect(r.counts.jump).toBe(1);
    expect(r.counts.turn).toBe(1);
    expect(r.counts.fov).toBe(1);
    expect(r.faults.find((f) => f.kind === "jump")!.i).toBe(30);
  });

  test("a cut marked on purpose is forgiven; a change of reference body is no jump", () => {
    const S = run(60, (k) => ({ P: [k * 100 + (k >= 30 ? 50_000 : 0), 0, 7e6] }));
    expect(analyse(S, [{ at: 30, label: "cut" }]).counts.jump).toBe(0);
    const R = run(60, (k) => ({ ref: k >= 30 ? "moon" : "earth", P: k >= 30 ? [k * 100, 0, 3e8] : [k * 100, 0, 7e6] }));
    expect(analyse(R).counts.jump).toBe(0);
  });

  test("a speed handed over without its velocity is a speed break", () => {
    const S = run(60, (k) => ({ P: [k < 30 ? k * 2000 : 60_000 + (k - 30) * 200, 0, 7e6], h: 1e4 }));
    expect(analyse(S).counts.speed).toBe(1);
  });
});
