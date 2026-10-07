import { test, expect } from "bun:test";
import { aeroForces, airAt, airTop, coldSkin, equilibriumT, heatFlux, heatStep, us76, type V3 } from "../src/aero";
import { VESSELS } from "../src/vessels";
import { solarBody } from "../src/system/solar";

const earth = solarBody("earth")!.atmosphere!;
const R = VESSELS.ranger.aero,
  L = VESSELS.lander.aero;
// (a velocity at an angle of attack α, the nose along z: the flow from below for α > 0)
const at = (V: number, a: number, b = 0): V3 => [V * Math.sin(b), -V * Math.sin(a) * Math.cos(b), V * Math.cos(a) * Math.cos(b)];
const deg = Math.PI / 180;

test("the 1976 standard atmosphere: its densities and temperatures", () => {
  const ref: [number, number, number][] = [
    [0, 1.225, 288.15],
    [11e3, 0.36392, 216.77],
    [20e3, 0.08891, 216.65],
    [32e3, 0.013555, 228.49],
    [50e3, 1.0269e-3, 270.65],
    [80e3, 1.846e-5, 198.64],
  ];
  for (const [h, rho, T] of ref) {
    const a = us76(h);
    expect(Math.abs(a.rho / rho - 1)).toBeLessThan(0.01);
    expect(Math.abs(a.T - T)).toBeLessThan(1);
  }
  expect(airAt(earth, 0).a).toBeCloseTo(340.3, 0);
  // (above 86 km, the table, continuous)
  expect(Math.abs(us76(86e3 - 1).rho / us76(86e3 + 1).rho - 1)).toBeLessThan(0.02);
  expect(us76(400e3).rho).toBeCloseTo(2.803e-12, 14);
  // the top: ~230 km; Mars's measured profile (NASA Glenn's fit at the datum), its CO₂
  expect(airTop(earth) / 1e3).toBeGreaterThan(200);
  expect(airTop(earth) / 1e3).toBeLessThan(250);
  const mars = airAt(solarBody("mars")!.atmosphere, 0);
  expect(mars.rho).toBeCloseTo(0.01459, 6);
  expect(mars.a).toBeGreaterThan(220);
  // (Glenn's 250 K at the datum: ~247 m/s)
  expect(mars.a).toBeLessThan(255);
});

test("the Ranger glides: lift up, L/D ≈ 6, an approach near 100 m/s; stable in pitch", () => {
  const air = airAt(earth, 0);
  let best = 0,
    at16 = 0;
  for (let a = 0; a <= 30; a++) {
    const o = aeroForces(R, at(100, a * deg), air);
    best = Math.max(best, o.L / o.D);
    if (a === 16) at16 = o.F[1];
  }
  expect(best).toBeGreaterThan(4.5);
  expect(best).toBeLessThan(8);
  // the weight carried at 16° by ~100 m/s
  const W = VESSELS.ranger.mass * 9.81;
  const v16 = 100 * Math.sqrt(W / at16);
  expect(v16).toBeGreaterThan(85);
  expect(v16).toBeLessThan(115);
  // nose up (α > 0): the lift behind the centre of mass pitches it down (+x, right-handed: nose to −y)
  expect(aeroForces(R, at(100, 8 * deg), air).M[0]).toBeGreaterThan(0);
  // sideslip: the nose turns into the wind (yaw moment about y towards the motion)
  const side = aeroForces(R, at(100, 0, 8 * deg), air);
  expect(side.F[0]).toBeLessThan(0);
  expect(side.M[1]).toBeGreaterThan(0);
  // stalled past ~23°
  expect(aeroForces(R, at(100, 30 * deg), air).stalled).toBe(true);
});

test("hypersonic entry at 40°: L/D ≈ 1, Shuttle-like heating, its shield below its limit at equilibrium", () => {
  const air = airAt(earth, 70e3);
  const o = aeroForces(R, at(7000, 40 * deg), air);
  expect(o.mach).toBeGreaterThan(20);
  expect(o.L / o.D).toBeGreaterThan(0.7);
  expect(o.L / o.D).toBeLessThan(1.4);
  // ~50 W/cm² at the nose (Sutton–Graves)
  expect(o.heat / 1e4).toBeGreaterThan(30);
  expect(o.heat / 1e4).toBeLessThan(80);
  const Teq = equilibriumT(o.heat, R.shield!.eps);
  expect(Teq).toBeGreaterThan(1600);
  expect(Teq).toBeLessThan(R.shield!.tMax);
  // radiation: nothing at 7 km/s, much at 11 km/s (a lunar return)
  const fast = airAt(earth, 65e3);
  expect(heatFlux(fast, 7000, 2) / (1.7415e-4 * Math.sqrt(fast.rho / 2) * 7000 ** 3)).toBeCloseTo(1, 6);
  const conv = 1.7415e-4 * Math.sqrt(fast.rho / 2) * 11000 ** 3;
  expect(heatFlux(fast, 11000, 2)).toBeGreaterThan(conv * 1.05);
});

test("the skin: heats to the radiative equilibrium under a steady flux, the shield taking it belly-first", () => {
  const air = airAt(earth, 70e3);
  const u: V3 = [0, -Math.sin(40 * deg), Math.cos(40 * deg)];
  const o = aeroForces(R, [u[0] * 7000, u[1] * 7000, u[2] * 7000], air);
  let th = coldSkin();
  for (let i = 0; i < 600; i++) th = heatStep(R, th, air, o, u, 0.5);
  const Teq = equilibriumT(o.heat, R.shield!.eps);
  expect(Math.abs(th.shield / Teq - 1)).toBeLessThan(0.05);
  expect(th.hull).toBeLessThan(th.shield * 0.75);
  // nose-on the other way (tail first): the hull takes it, past its limit
  const back: V3 = [0, 0, -1];
  const ob = aeroForces(R, [0, 0, -7000], air);
  let tb = coldSkin();
  for (let i = 0; i < 600; i++) tb = heatStep(R, tb, air, ob, back, 0.5);
  expect(tb.hull).toBeGreaterThan(R.hull.tMax);
  // cooling down in slow air
  const low = airAt(earth, 5e3);
  const os = aeroForces(R, at(150, 5 * deg), low);
  let tc = { ...th, hull: 900 };
  for (let i = 0; i < 1200; i++) tc = heatStep(R, tc, low, os, [0, 0, 1], 0.5);
  expect(tc.shield).toBeLessThan(400);
});

test("the Lander falls belly-first, stable; the Endurance has no shield", () => {
  const air = airAt(earth, 0);
  // terminal speed belly-first: ~85 m/s (a 160 t flat plate, 304 m²)
  const o = aeroForces(L, [0, -85, 0], air);
  const W = VESSELS.lander.mass * 9.81;
  expect(o.F[1] / W).toBeGreaterThan(0.8);
  expect(o.F[1] / W).toBeLessThan(1.25);
  // tilted (the motion towards +z a little): the moment turns the belly back into the flow
  const t = aeroForces(L, [0, -60 * Math.cos(0.15), 60 * Math.sin(0.15)], air);
  // (belly to the motion: the rotation about +x that brings −y towards +z is negative)
  expect(t.M[0]).toBeLessThan(0);
  expect(VESSELS.endurance.aero.shield).toBeNull();
});

test("an entry from low orbit, full lift up: the Ranger within its limits, the Endurance burns", () => {
  const atm = solarBody("earth")!.atmosphere!;
  const fly = (id: "ranger" | "endurance", alpha: number) => {
    const A = VESSELS[id].aero,
      m = VESSELS[id].mass;
    const mu = 3.986e14,
      Re = 6371e3;
    let r = Re + 120e3,
      v = 7800,
      g = -1.2 * deg,
      skin = coldSkin(),
      gMax = 0,
      hot = 0,
      hull = 0;
    const u: V3 = [0, -Math.sin(alpha), Math.cos(alpha)];
    for (let t = 0; t < 4000 && r > Re && v > 150; t += 0.2) {
      const air = airAt(atm, r - Re);
      const o = aeroForces(A, [0, u[1] * v, u[2] * v], air);
      skin = heatStep(A, skin, air, o, u, 0.2);
      const gr = mu / (r * r);
      v += (-o.D / m - gr * Math.sin(g)) * 0.2;
      g += (o.L / (m * v) - (gr / v - v / r) * Math.cos(g)) * 0.2;
      r += v * Math.sin(g) * 0.2;
      gMax = Math.max(gMax, Math.hypot(o.L, o.D) / m / 9.80665);
      hot = Math.max(hot, skin.shield);
      hull = Math.max(hull, skin.hull);
    }
    return { gMax, hot, hull };
  };
  const r = fly("ranger", 40 * deg);
  expect(r.gMax).toBeLessThan(3);
  expect(r.hot).toBeGreaterThan(1500);
  expect(r.hot).toBeLessThan(VESSELS.ranger.aero.shield!.tMax);
  expect(r.hull).toBeLessThan(VESSELS.ranger.aero.hull.tMax);
  const e = fly("endurance", 0);
  expect(e.hull).toBeGreaterThan(VESSELS.endurance.aero.hull.tMax);
});

test("a low orbit in the thermosphere: its thin hot gas does not bake the hull — the Endurance at 220 km stays cold", () => {
  // (the gas there ~900 K: once the skin's radiative sink, the hull went to 890 K, past the Endurance's 700)
  const atm = solarBody("earth")!.atmosphere;
  for (const hk of [160, 220]) {
    const air = airAt(atm, hk * 1e3);
    expect(air.rho).toBeGreaterThan(0);
    expect(air.T).toBeGreaterThan(600);
    const A = VESSELS.endurance.aero;
    const v: V3 = [0, 0, 7800];
    const o = aeroForces(A, v, air);
    let th = coldSkin();
    for (let i = 0; i < 3600; i++) th = heatStep(A, th, air, o, [0, 0, 1], 1);
    expect(th.hull).toBeLessThan(350);
  }
});
