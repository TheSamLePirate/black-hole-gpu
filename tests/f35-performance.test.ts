import { describe, expect, test } from "bun:test";
import { aeroForces, airAt } from "../src/aero";
import { dryThrust, F135, fuelFlow, wetThrust } from "../src/f35/engine";
import { solarBody } from "../src/system/solar";
import { VESSELS } from "../src/vessels";

// The F-35B's performance (docs/PLAN-F35.md, F3): its aerodynamics (aero.ts, VESSELS.f35.aero) and its engine
// (src/f35/engine.ts) against the real aircraft's published figures — level flight's speeds, the stall, the
// sustained turn, the approach, the endurance. Pure: the forces at trimmed states, no flight flown.

const V = VESSELS.f35;
const A = V.aero;
const atm = solarBody("earth")!.atmosphere!;
const G = 9.80665;
const FT = 0.3048;

/** Level flight at height h [m] and speed v [m/s], mass m, load n: the angle of attack holding n·W, the drag. */
export function trim(h: number, v: number, m: number, n = 1, flaps = 0) {
  const air = airAt(atm, h);
  let lo = -0.1,
    hi = 0.8;
  const lift = (a: number) => {
    const o = aeroForces(A, [0, -v * Math.sin(a), v * Math.cos(a)], air, [0, 0, 0], { flaps });
    // (the force across the motion, up the craft's plane: the lift; along it: the drag)
    return { L: o.F[1] * Math.cos(a) + o.F[2] * Math.sin(a), D: -(o.F[2] * Math.cos(a) - o.F[1] * Math.sin(a)), o };
  };
  for (let i = 0; i < 60; i++) {
    const a = (lo + hi) / 2;
    if (lift(a).L < n * m * G) lo = a;
    else hi = a;
  }
  const a = (lo + hi) / 2;
  const r = lift(a);
  return { alpha: a, D: r.D, ok: Math.abs(r.L - n * m * G) < 0.01 * m * G, air, mach: v / air.a, stalled: r.o.stalled };
}

const sigma = (h: number) => airAt(atm, h).rho / 1.225;
/** the fastest level speed at height h where the thrust (dry or wet) meets the drag */
function vMax(h: number, m: number, wet: boolean) {
  const a = airAt(atm, h).a;
  let best = 0;
  for (let M = 0.3; M < 2.4; M += 0.01) {
    const t = trim(h, M * a, m);
    const T = (wet ? wetThrust : dryThrust)(F135, M, sigma(h));
    if (t.ok && T >= t.D) best = M;
  }
  return best;
}
/** the highest sustained load at height h and Mach M, full afterburner */
function sustainedG(h: number, M: number, m: number) {
  const v = M * airAt(atm, h).a;
  const T = wetThrust(F135, M, sigma(h));
  let n = 1;
  while (n < 12) {
    const t = trim(h, v, m, n + 0.05);
    if (!t.ok || t.D > T) break;
    n += 0.05;
  }
  return n;
}

describe("the F-35B's performance", () => {
  const mTO = V.mass; // 20.9 t: full fuel
  const mMid = V.mass - 3000;
  test("its top speeds: ~Mach 1.6 high on the afterburner, some 0.9 dry; transonic at sea level", () => {
    const hi = vMax(11000, mMid, true);
    const hiDry = vMax(11000, mMid, false);
    const sl = vMax(0, mMid, true);
    console.log(`  top speed: M ${hi.toFixed(2)} at 11 km wet, M ${hiDry.toFixed(2)} dry; M ${sl.toFixed(2)} at sea level wet`);
    expect(hi).toBeGreaterThan(1.45);
    expect(hi).toBeLessThan(1.8);
    expect(hiDry).toBeGreaterThan(0.85);
    expect(hiDry).toBeLessThan(1.1);
    expect(sl).toBeGreaterThan(0.95);
    expect(sl).toBeLessThan(1.3);
  });
  test("its stall: ~125 kt clean at its take-off weight, the approach at ~12° with full flaps", () => {
    let vs = 40;
    while (vs < 150 && !trim(0, vs, mTO).ok) vs += 0.5;
    const app = trim(0, 72, 17500, 1, 1);
    console.log(
      `  stall ${vs.toFixed(1)} m/s (${(vs / 0.5144).toFixed(0)} kt); approach at 140 kt: α ${((app.alpha * 180) / Math.PI).toFixed(1)}°`,
    );
    expect(vs / 0.5144).toBeGreaterThan(110);
    expect(vs / 0.5144).toBeLessThan(145);
    expect((app.alpha * 180) / Math.PI).toBeGreaterThan(8);
    expect((app.alpha * 180) / Math.PI).toBeLessThan(16);
  });
  test("its sustained turn: ~5 g at Mach 0.8 and 15 000 ft on the afterburner", () => {
    const n = sustainedG(15000 * FT, 0.8, mMid);
    console.log(`  sustained ${n.toFixed(2)} g at M 0.8, 15 000 ft`);
    expect(n).toBeGreaterThan(4.3);
    expect(n).toBeLessThan(6.3);
  });
  test("its fuel: three quarters of an hour at full dry thrust, under ten minutes of full afterburner", () => {
    const dry = F135.dry,
      wet = F135.wet;
    const tDry = V.fuelKg! / fuelFlow(F135, dry, dry, 1) / 60;
    const tWet = V.fuelKg! / fuelFlow(F135, wet, dry, 1) / 60;
    console.log(`  ${tDry.toFixed(0)} min at military thrust, ${tWet.toFixed(1)} min wet (sea level, static)`);
    expect(tDry).toBeGreaterThan(30);
    expect(tDry).toBeLessThan(55);
    expect(tWet).toBeGreaterThan(6);
    expect(tWet).toBeLessThan(12);
  });
  test("its thrust over weight at take-off: ~0.85 on the afterburner", () => {
    const tw = wetThrust(F135, 0, 1) / (mTO * G);
    expect(tw).toBeGreaterThan(0.75);
    expect(tw).toBeLessThan(0.95);
  });
});
