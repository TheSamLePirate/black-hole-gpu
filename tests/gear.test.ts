import { expect, test } from "bun:test";
import { GEARS, gearForces, tippedOver, touchdownVerdict, tyreGrip, type Ground } from "../src/gear";
import type { V3 } from "../src/mounts";

// The landing gear (phase 2): the Ranger dropped onto a flat runway settles on its three wheels at the
// gear's height, its bounce damped; braking at the anti-skid's peak; a sideways drift taken out by the
// tyres; the touchdown judged by its sink rate; tipping over past the gear's base.

const flat: Ground = { at: (p) => ({ h: p[1], n: [0, 1, 0], v: [0, 0, 0] }) };
const def = GEARS.ranger!;
const m = 40e3,
  g = 9.80665;
// (the ship's axes in the world: left = +x, up = +y, nose = +z; its inertia, as the vessel's)
const axes: [V3, V3, V3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** A short flight on the gear: the reference point's height, its vertical speed; pitch held (2-D). */
function drop(h0: number, vy0: number, vz0 = 0, brake = 0, seconds = 6) {
  let X: V3 = [0, h0, 0],
    V: V3 = [0, vy0, vz0];
  const dt = 0.002;
  let peak = 0;
  let out = gearForces(def, { mass: m, X, V, axes, w: [0, 0, 0], brake, steer: 0 }, flat);
  for (let t = 0; t < seconds; t += dt) {
    out = gearForces(def, { mass: m, X, V, axes, w: [0, 0, 0], brake, steer: 0 }, flat);
    const a: V3 = [out.F[0] / m, out.F[1] / m - g, out.F[2] / m];
    V = [V[0] + a[0] * dt, V[1] + a[1] * dt, V[2] + a[2] * dt];
    X = [X[0] + V[0] * dt, X[1] + V[1] * dt, X[2] + V[2] * dt];
    peak = Math.max(peak, out.squash);
  }
  return { X, V, out, peak };
}

test("dropped at 2 m/s, it settles at the gear's height on its three wheels, the bounce damped", () => {
  const r = drop(6.2, -2);
  expect(r.X[1]).toBeGreaterThan(5.95);
  expect(r.X[1]).toBeLessThan(6.05);
  expect(Math.abs(r.V[1])).toBeLessThan(0.02);
  expect(r.out.contact).toBe(3);
  // (the weight carried whole)
  const total = r.out.legs.reduce((s, l) => s + l.load, 0);
  expect(total / (m * g)).toBeCloseTo(1, 2);
  expect(r.peak).toBeLessThan(1);
});

test("a 3 m/s drop takes half the stroke; a 9 m/s one bottoms it out (the oleo's gas stiffening)", () => {
  expect(drop(6.2, -3, 0, 0, 1).peak).toBeLessThan(0.7);
  expect(drop(6.2, -9, 0, 0, 1).peak).toBeGreaterThan(1);
});

test("braking at the anti-skid's peak: about μ times the mains' share of g", () => {
  const r = drop(6.0, 0, 30, 1, 1);
  const decel = (30 - r.V[2]) / 1;
  const mains = def.legs.filter((l) => l.brakes).reduce((s, l) => s + l.share, 0);
  expect(decel).toBeGreaterThan(0.8 * def.muBrake * mains * g);
  expect(decel).toBeLessThan(1.2 * (def.muBrake * mains + def.roll) * g);
});

test("parked, the brakes on, on a 9° slope of the Moon: it stands — no creep down it", () => {
  // (the slope as gravity's share along the ground; the motion's own 4 ms steps)
  const gm = 1.62,
    th = (9 * Math.PI) / 180;
  let X: V3 = [0, 6.0, 0],
    V: V3 = [0, 0, 0];
  const dt = 0.004;
  for (let t = 0; t < 20; t += dt) {
    const o = gearForces(def, { mass: m, X, V, axes, w: [0, 0, 0], brake: 1, steer: 0 }, flat);
    V = [V[0] + (o.F[0] / m) * dt, V[1] + (o.F[1] / m - gm * Math.cos(th)) * dt, V[2] + (o.F[2] / m - gm * Math.sin(th)) * dt];
    X = [X[0] + V[0] * dt, X[1] + V[1] * dt, X[2] + V[2] * dt];
  }
  // (still by the craft's own measure: under 5 cm/s)
  expect(Math.abs(V[2])).toBeLessThan(0.05);
});

test("a sideways drift is taken out by the tyres' grip", () => {
  let X: V3 = [0, 6.0, 0],
    V: V3 = [3, 0, 40];
  const dt = 0.002;
  for (let t = 0; t < 2; t += dt) {
    const o = gearForces(def, { mass: m, X, V, axes, w: [0, 0, 0], brake: 0, steer: 0 }, flat);
    V = [V[0] + (o.F[0] / m) * dt, V[1] + (o.F[1] / m - g) * dt, V[2] + (o.F[2] / m) * dt];
    X = [X[0] + V[0] * dt, X[1] + V[1] * dt, X[2] + V[2] * dt];
  }
  expect(Math.abs(V[0])).toBeLessThan(0.3);
  expect(V[2]).toBeGreaterThan(38);
});

test("the tyre's grip peaks near 8–10° of slip and falls off past it", () => {
  const at = (deg: number) => tyreGrip((deg * Math.PI) / 180, 1);
  expect(at(9)).toBeGreaterThan(at(3));
  expect(at(9)).toBeGreaterThan(at(30));
  expect(at(9)).toBeGreaterThan(0.95);
});

test("the touchdown: a landing to 2/3 of the crash speed, hard to it, a crash past; forgiving ×3", () => {
  expect(touchdownVerdict(2.5, 4.5)).toBe("landed");
  expect(touchdownVerdict(3.8, 4.5)).toBe("hard");
  expect(touchdownVerdict(5, 4.5)).toBe("crashed");
  expect(touchdownVerdict(12, 4.5, true)).toBe("hard");
});

test("tipping over past the gear's base, not in a gentle lean", () => {
  const n: V3 = [0, 1, 0];
  expect(tippedOver(def, [0, 1, 0], n)).toBe(false);
  expect(tippedOver(def, [Math.sin(0.2), Math.cos(0.2), 0], n)).toBe(false);
  expect(tippedOver(def, [Math.sin(0.8), Math.cos(0.8), 0], n)).toBe(true);
});
