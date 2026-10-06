import { expect, test } from "bun:test";
import { blToCartesian, cameraFrame, setHolePose } from "../src/camera";
import { advance, fromZamo, type Massive } from "../src/geodesic";
import { lensesOf } from "../src/lenses";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { advanceToMouth, crossingSpan, driftToGlue } from "../src/system/wormhole-flight";
import { mouth, setSceneTime } from "../src/wormhole";

// The crossings of the gluing sphere — Kerr into Dneg (advanceToMouth), Dneg out to Kerr (driftToGlue),
// the code the live flight and the map's prediction share: found at any step size, in a bounded number
// of runs of the step, and a Kerr step out of the mouth's reach left to Kerr alone.

const scene = () => ({ ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, motion: "geodesic" as const, whOrbit: false });

/** A Kerr state passing the mouth at `b` from its centre (closest at t ≈ 2, at half the speed of light). */
function passing(b: number) {
  setSceneTime(0);
  const s = scene(),
    m = mouth(s, 0);
  const ex = m.C.map((x) => x / Math.hypot(...m.C)) as Vec3;
  const ey: Vec3 = [-ex[1], ex[0], 0].map((x, _, a) => x / Math.hypot(...a)) as Vec3;
  setHolePose(s, [0, 1, 2].map((i) => m.C[i]! + ex[i]! * b - ey[i]!) as Vec3, ey, [0, 0, 1], ey.map((x) => 0.5 * x) as Vec3);
  const c = cameraFrame(s, 0);
  const depth = (q: Massive) => {
    const p = blToCartesian(q.r, q.th, q.ph);
    return m.rGlue - Math.hypot(p[0] - m.C[0], p[1] - m.C[1], p[2] - m.C[2]);
  };
  return { s, m, st: fromZamo(c.r, c.theta, c.phi, c.beta, s.spin, 0), depth };
}

/** Flown in steps of `dt` for 8 M, or until inside the gluing sphere. */
function flyKerr(s: ReturnType<typeof scene>, st: Massive, dt: number, depth: (q: Massive) => number) {
  let q = st;
  for (let k = 0; k < 2000 && q.t < 8 - 1e-12; k++) {
    q = advanceToMouth(s, q, Math.min(dt, 8 - q.t), 0, [0, 0, 0], lensesOf(s)).st;
    if (depth(q) > 0) break;
  }
  return q;
}

test("grazing the gluing sphere: entered at the same time at any step, even dipping in and out within one", () => {
  for (const dip of [1e-1, 1e-2, 1e-3]) {
    const { s, m, st, depth } = passing(m0().rGlue * (1 - dip));
    const entries = [8, 1, 0.1, 0.02].map((dt) => flyKerr(s, st, dt, depth));
    for (const q of entries) {
      expect(depth(q)).toBeGreaterThan(0);
      expect(depth(q)).toBeLessThan(1e-9 * m.rGlue);
      expect(q.t).toBeCloseTo(entries[3]!.t, 9);
      // (the entry, before the closest approach — not the way out)
      expect(q.t).toBeLessThan(2);
    }
  }
  // (a near miss: never in, the steps run to their end)
  const { s, st, depth } = passing(m0().rGlue * (1 + 1e-3));
  for (const dt of [8, 0.1]) expect(flyKerr(s, st, dt, depth).t).toBeCloseTo(8, 12);
});

const m0 = () => mouth(scene(), 0);

test("a Kerr step out of the mouth's reach is Kerr's alone", () => {
  setSceneTime(0);
  const s = scene();
  const far = fromZamo(10, Math.PI / 2, 0, [0, 0, 0.35], s.spin, 0);
  // (advance starts from its last step's size, kept between calls: the same flight to its tolerance)
  const a = advanceToMouth(s, far, 50, 0, [0, 0, 0], lensesOf(s)).st,
    b = advance(far, s.spin, 50, 0.05, 0, [0, 0, 0], lensesOf(s)).st;
  for (const k of ["t", "r", "th", "ph"] as const) expect(a[k]).toBeCloseTo(b[k], 7);
});

test("the outgoing gluing event in a few runs of a many-substep Dneg step", () => {
  const m = m0();
  const pose = { l: m.lGlue - 0.005, n: [1, 0, 0] as Vec3, fwd: [1, 0, 0] as Vec3, up: [0, 0, 1] as Vec3, vel: [0.3, 0, 0] as Vec3 };
  let runs = 0;
  const velocityAt = (dt: number): Vec3 => {
    runs++;
    return [0.3 + 0.001 * dt, 0, 0];
  };
  const out = driftToGlue(m.w, pose, 0, 0.1, 400, true, m.lGlue, velocityAt);
  expect(runs).toBeLessThanOrEqual(17);
  expect(out.l).toBeGreaterThan(m.lGlue);
  // (the event's time: the drift there ends on the sphere)
  const at = driftToGlue(m.w, { ...pose, vel: velocityAt(out.elapsed) }, 0, out.elapsed * (1 - 1e-9), 400, true, m.lGlue);
  expect(at.l).toBeLessThanOrEqual(m.lGlue);
  expect(at.l).toBeGreaterThan(m.lGlue - 1e-9);
});

test("a crossing not converged within its runs still ends past the boundary, within its bracket", () => {
  let runs = 0;
  // (a boundary function with a kink: the false position's slowest case)
  const f = (x: number) => (x < 0.3 ? x - 0.3 : 1e3 * (x - 0.3));
  const run = (x: number) => {
    runs++;
    return { x, f: f(x), r: x };
  };
  const out = crossingSpan(run, 0, f(0), run(1), 0, 0, 10);
  expect(runs).toBe(11);
  expect(out.f).toBeGreaterThan(0);
  expect(out.r).toBeGreaterThan(0.3);
  expect(out.r).toBeLessThanOrEqual(1);
});
