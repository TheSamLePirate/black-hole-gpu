import { expect, test } from "bun:test";
import type { V3 } from "../src/aero";
import { AirFlight, Q_FREE } from "../src/flightair";
import { solarBody } from "../src/system/solar";
import { VESSELS } from "../src/vessels";

// The flown craft in the air: the forces for the integrators, then once a frame the skin, the load and
// the limits — past them the craft is lost, unless the damage is off.

const earth = solarBody("earth")!.atmosphere!;
const axes: [V3, V3, V3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const deg = Math.PI / 180;
const belly = (v: number): V3 => [0, -v * Math.sin(40 * deg), v * Math.cos(40 * deg)];
const R = VESSELS.ranger;

test("in the vacuum: no force, not in the air", () => {
  const f = new AirFlight();
  f.reset("ranger");
  const acc = f.forceFn(undefined, "", R.mass, axes)(400e3, belly(7700));
  expect(Math.hypot(...acc)).toBe(0);
  expect(f.inAir).toBe(false);
  expect(f.after(1 / 60, [0, 0, 0], R.mass, 1e6, true)).toEqual([0, 0, 0]);
  expect(f.failure).toBeNull();
});

test("an entry at 70 km, 7.5 km/s belly first: a load of a fraction of g to a few g, the shield warming", () => {
  const f = new AirFlight();
  f.reset("ranger");
  const force = f.forceFn(earth, "earth", R.mass, axes);
  const T0 = f.skin.shield;
  for (let i = 0; i < 600; i++) {
    force(70e3, belly(7500));
    f.after(0.1, [0, 0, 0], R.mass, 1e6, true);
  }
  expect(f.last!.out.q).toBeGreaterThan(Q_FREE);
  expect(f.inAir).toBe(true);
  expect(f.g).toBeGreaterThan(0.1);
  expect(f.g).toBeLessThan(R.aero.gMax);
  expect(f.skin.shield).toBeGreaterThan(T0 + 300);
  expect(f.failure).toBeNull();
  const m = f.margins();
  expect(m.shield).toBeGreaterThan(0);
  expect(m.shield).toBeLessThan(1);
});

test("7 km/s at 20 km: the structure fails past a quarter second over its g limit — unless the damage is off", () => {
  for (const damage of [true, false]) {
    const f = new AirFlight();
    f.reset("ranger");
    const force = f.forceFn(earth, "earth", R.mass, axes);
    for (let i = 0; i < 30; i++) {
      force(20e3, belly(7000));
      f.after(1 / 60, [0, 0, 0], R.mass, 1e6, damage);
    }
    expect(f.g).toBeGreaterThan(R.aero.gMax);
    if (damage) expect(f.failure).toMatch(/broke up|shield|hull/);
    else expect(f.failure).toBeNull();
  }
});

test("the flight path's turn: the motion's direction swinging about the ship's x reads as a rate about x", () => {
  const f = new AirFlight();
  f.reset("ranger");
  const force = f.forceFn(earth, "earth", R.mass, axes);
  const w = 0.05; // [rad/s] about x
  for (let i = 0; i < 120; i++) {
    const a = w * i * 0.05;
    force(60e3, [0, 300 * Math.sin(a), 300 * Math.cos(a)]);
    f.after(0.05, [0, 0, 0], R.mass, 1e6, false);
  }
  expect(Math.abs(Math.abs(f.pathRate[0]!) - w)).toBeLessThan(0.01);
  expect(Math.abs(f.pathRate[1]!)).toBeLessThan(1e-6);
});
