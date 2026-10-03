import { expect, test } from "bun:test";
import type { M3, V3 } from "../src/mounts";
import { FlightComputer, gyroscopic, inv3, type FlightContext } from "../src/pilot";

// The rigid body (phase 2, audit: "inertie scalaire, pas de ω × Iω"): a ship turning freely keeps its
// angular momentum in space — its rates coupling on an asymmetric body (Euler's equations) —, applied as
// the controller turns the camera (Rodrigues in its components, the ship's axes a left-handed set there).

const I: M3 = [
  [4e5, 0, 0],
  [0, 9e5, 0],
  [0, 0, 1.5e5],
];

/** Rodrigues's rotation of v about the rotation vector r, in the components (controls' rotateC). */
function rod(r: V3, v: V3): V3 {
  const a = Math.hypot(...r);
  if (a < 1e-15) return v;
  const k = r.map((x) => x / a) as V3;
  const c = Math.cos(a),
    s = Math.sin(a);
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x: V3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => v[i]! * c + x[i]! * s + k[i]! * kv * (1 - c)) as V3;
}

test("the inverse of an inertia tensor", () => {
  const m: M3 = [
    [5, 1, 0.5],
    [1, 4, 0.2],
    [0.5, 0.2, 3],
  ];
  const n = inv3(m);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const p = m[i]![0] * n[0]![j]! + m[i]![1] * n[1]![j]! + m[i]![2] * n[2]![j]!;
      expect(p).toBeCloseTo(i === j ? 1 : 0, 12);
    }
});

test("torque-free: the energy and the momentum's size kept by the coupling", () => {
  let w: V3 = [0.4, 0.05, 0.3];
  const E = (x: V3) => x[0] * x[0] * I[0][0] + x[1] * x[1] * I[1][1] + x[2] * x[2] * I[2][2];
  const L = (x: V3) => Math.hypot(x[0] * I[0][0], x[1] * I[1][1], x[2] * I[2][2]);
  const e0 = E(w),
    l0 = L(w);
  for (let i = 0; i < 2000; i++) w = gyroscopic(w, I, 1 / 60);
  expect(Math.abs(E(w) / e0 - 1)).toBeLessThan(1e-3);
  expect(Math.abs(L(w) / l0 - 1)).toBeLessThan(1e-3);
});

test("a ship turning freely keeps its angular momentum in space, as the camera turns it", () => {
  const fc = new FlightComputer();
  fc.sas = false;
  fc.omega = [0.35, 0.04, 0.25];
  // (the ship's axes in the camera's components: left, up, nose — a left-handed set there)
  const S: M3 = [
    [-1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  // (the camera's own axes, columns, in space: turned by each step's rotation vector, as rotateC does)
  let W: [V3, V3, V3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const ctx = (dt: number): FlightContext => ({
    dt,
    right: [1, 0, 0],
    up: [0, 1, 0],
    fwd: [0, 0, 1],
    beta: [0, 0, 0],
    S,
    thrust: 0,
    tauRate: 0,
    radialOut: null,
    target: null,
    inertia: I,
    torque: [1, 1, 1],
  });
  const none = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 };
  const Lspace = () => {
    // L on the ship's axes → the camera's components (S's columns) → space (W's columns)
    const Lb: V3 = [I[0][0] * fc.omega[0], I[1][1] * fc.omega[1], I[2][2] * fc.omega[2]];
    const Lc: V3 = [0, 1, 2].map((r) => S[r]![0]! * Lb[0] + S[r]![1]! * Lb[1] + S[r]![2]! * Lb[2]) as V3;
    return [0, 1, 2].map((r) => W[0]![r]! * Lc[0] + W[1]![r]! * Lc[1] + W[2]![r]! * Lc[2]) as V3;
  };
  const L0 = Lspace();
  const dt = 1 / 120;
  for (let i = 0; i < 2400; i++) {
    const out = fc.step(ctx(dt), none);
    // (the camera's columns turned in its own components: W ← W · Rod(rot))
    const cols = [0, 1, 2].map((k) => rod(out.rot, [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0] as V3));
    W = cols.map((c) => [0, 1, 2].map((r) => W[0]![r]! * c[0] + W[1]![r]! * c[1] + W[2]![r]! * c[2]) as V3) as [V3, V3, V3];
  }
  const L1 = Lspace();
  const drift = Math.hypot(L1[0] - L0[0], L1[1] - L0[1], L1[2] - L0[2]) / Math.hypot(...L0);
  expect(drift).toBeLessThan(0.01);
  // (and it did tumble: the rates moved between the axes)
  expect(Math.abs(fc.omega[0] - 0.35)).toBeGreaterThan(0.01);
});
