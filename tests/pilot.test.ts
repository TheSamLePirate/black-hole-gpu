import { test, expect } from "bun:test";
import { circularSpeed, FlightComputer, type PilotInput } from "../src/pilot";
import { shipToCamera } from "../src/mounts";
import { keplerOmega, photonOrbits, zamo, type Vec3 } from "../src/physics";
import { advance, fromZamo } from "../src/geodesic";

const NONE: PilotInput = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 };

test("circular speed: Kerr equatorial orbits, none inside the photon orbit", () => {
  const a = 0.9;
  for (const r of [4, 8, 20, 60]) {
    const z = zamo(r, Math.PI / 2, a);
    const v = circularSpeed(r, a, true, z)!;
    expect(v).toBeCloseTo((z.varpi * (keplerOmega(r, a) - z.omega)) / z.alpha, 10);
  }
  const rp = photonOrbits(a).pro;
  expect(circularSpeed(rp * 0.9, a, true, zamo(rp * 0.9, Math.PI / 2, a))).toBeNull();
});

test("a circular orbit stays circular (geodesic, no thrust)", () => {
  const a = 0.9, r = 12;
  const z = zamo(r, Math.PI / 2, a);
  const v = circularSpeed(r, a, true, z)!;
  let st = fromZamo(r, Math.PI / 2, 0, [0, 0, v], a);
  const period = 2 * Math.PI * (r ** 1.5 + a);
  let rMin = r, rMax = r;
  for (let i = 0; i < 50; i++) {
    st = advance(st, a, period / 50).st;
    rMin = Math.min(rMin, st.r);
    rMax = Math.max(rMax, st.r);
  }
  expect(rMax - rMin).toBeLessThan(1e-3);
  expect(st.ph).toBeCloseTo(2 * Math.PI, 2);
});

test("attitude hold turns the nose onto prograde and stops there", () => {
  const S = shipToCamera("chase").S;
  // camera axes in a local frame (start: identity), the velocity somewhere behind and to the side
  let right: Vec3 = [1, 0, 0], up: Vec3 = [0, 1, 0], fwd: Vec3 = [0, 0, 1];
  const beta: Vec3 = [0.3, -0.2, -0.1];
  const fc = new FlightComputer();
  fc.setHold("prograde");
  const dt = 1 / 60;
  const lin = (v: Vec3, k: number, w: Vec3, m: number): Vec3 => [v[0] * k + w[0] * m, v[1] * k + w[1] * m, v[2] * k + w[2] * m];
  const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  for (let i = 0; i < 60 * 12; i++) {
    const out = fc.step({ dt, right, up, fwd, beta, S, thrust: 0.01, tauRate: 1, radialOut: [1, 0, 0], target: null }, NONE);
    // rotate the camera's axes by the rotation vector (camera coordinates → local)
    const A = lin(lin(right, out.rot[0], up, out.rot[1]), 1, fwd, out.rot[2]);
    const ang = Math.hypot(...A);
    if (ang > 0) {
      const k = lin(A, 1 / ang, A, 0);
      const rod = (v: Vec3) => lin(lin(v, Math.cos(ang), cross(k, v), Math.sin(ang)), 1, k, dot(k, v) * (1 - Math.cos(ang)));
      [right, up, fwd] = [rod(right), rod(up), rod(fwd)];
    }
  }
  const nose = lin(lin(right, S[0][2], up, S[1][2]), 1, fwd, S[2][2]);
  const pro = lin(beta, 1 / Math.hypot(...beta), beta, 0);
  expect(Math.acos(Math.min(1, dot(nose, pro))) * 180 / Math.PI).toBeLessThan(0.5);
  expect(Math.hypot(...fc.omega)).toBeLessThan(1e-3);
});

test("manual keys: rates follow the stick with SAS, the engine follows the throttle", () => {
  const fc = new FlightComputer();
  const S = shipToCamera("quarter").S;
  const ctx = { dt: 1 / 60, right: [1, 0, 0] as Vec3, up: [0, 1, 0] as Vec3, fwd: [0, 0, 1] as Vec3, beta: [0, 0, 0.1] as Vec3, S, thrust: 0.02, tauRate: 1, radialOut: null, target: null };
  for (let i = 0; i < 120; i++) fc.step(ctx, { ...NONE, pitch: 1, throttle: 1 });
  expect(Math.abs(fc.omega[0])).toBeCloseTo(0.75, 3); // full rate
  expect(fc.throttle).toBeCloseTo(1, 5); // 0.6 per second for 2 s, capped
  const out = fc.step(ctx, NONE);
  expect(Math.hypot(...out.acc)).toBeCloseTo(0.02, 6);
  for (let i = 0; i < 120; i++) fc.step(ctx, NONE);
  expect(Math.hypot(...fc.omega)).toBe(0); // SAS stops the rotation
});
