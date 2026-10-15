import { describe, expect, test } from "bun:test";
import { type FlightKnot, fitFlight, flightAt, flightLaws, isaDensity } from "../src/game/flightpath";

// A real aircraft's path between its reports (docs/PLAN-AVIATION-AAA.md, T2; game/flightpath.ts): its flight — speed,
// track, climb — smoothed from noisy reports and integrated, near the truth, its bank continuous at an airliner's
// roll rate; the flight's laws — a coordinated turn's bank, the incidence its lift asks in cruise, on approach, in a
// turn.

const D = Math.PI / 180;

/** The truth, flown every 10 ms: 150 m/s east; a right turn at 2°/s rolled into from 60 s and out from 100 s, 5 s
 *  each; a descent at 5 m/s from 40 s, reached in 5 s. */
const truth = (() => {
  const dt = 0.01;
  const tab: { x: number[]; trk: number; vs: number; w: number }[] = [];
  let e = 0,
    n = 0,
    u = 3000,
    psi = Math.PI / 2;
  const ramp = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  for (let i = 0; i <= 200 / dt; i++) {
    const t = i * dt;
    const w = 2 * D * (ramp(t, 60, 65) - ramp(t, 100, 105));
    const vs = -5 * ramp(t, 40, 45);
    tab.push({ x: [e, n, u], trk: psi, vs, w });
    e += 150 * Math.sin(psi) * dt;
    n += 150 * Math.cos(psi) * dt;
    u += vs * dt;
    psi += w * dt;
  }
  return (t: number) => tab[Math.max(0, Math.round(t / dt))]!;
})();

/** A seeded noise in [-1, 1]. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
}

describe("the path through the reports", () => {
  test("reports 8 s apart — ±12 m, ±0.1 s, ±0.2°, their height in 25 ft steps —: within metres of the truth, its bank continuous", () => {
    const r = noise(7);
    const knots: FlightKnot[] = [];
    for (let t = 0; t <= 180; t += 8) {
      const T = truth(t + r() * 0.1);
      knots.push({
        t,
        x: [T.x[0]! + r() * 12, T.x[1]! + r() * 12, Math.round(T.x[2]! / 7.62) * 7.62],
        gs: 150 + r() * 0.3,
        trk: T.trk + r() * 0.2 * D,
        vs: Math.round(T.vs / 0.325) * 0.325,
      });
    }
    const F = fitFlight(knots);
    let worst = 0,
      worstU = 0,
      roll = 0,
      bankMid = 0,
      prev: number | null = null;
    for (let t = 16; t <= 164; t += 0.1) {
      const f = flightAt(F, t)!;
      const T = truth(t);
      worst = Math.max(worst, Math.hypot(f.x[0]! - T.x[0]!, f.x[1]! - T.x[1]!));
      worstU = Math.max(worstU, Math.abs(f.x[2]! - T.x[2]!));
      const b = flightLaws(f.v, f.a, f.x[2]!, 5500, f.omega).bank / D;
      if (prev !== null) roll = Math.max(roll, Math.abs(b - prev) / 0.1);
      prev = b;
      if (Math.abs(t - 85) < 0.05) bankMid = b;
    }
    const want = Math.atan2(150 * 2 * D, 9.80665) / D;
    console.log(
      `  within ${worst.toFixed(1)} m of the truth, ${worstU.toFixed(1)} m in height; mid-turn banked ${bankMid.toFixed(1)}° (${want.toFixed(1)}°); its roll rate ${roll.toFixed(1)}°/s at most (the truth's 5.6)`,
    );
    expect(worst).toBeLessThan(15);
    expect(worstU).toBeLessThan(6);
    expect(Math.abs(bankMid - want)).toBeLessThan(2);
    expect(roll).toBeLessThan(7);
  });
});

describe("the flight's laws", () => {
  test("a coordinated turn's bank; the incidence: cruise, approach (flaps), a 30° turn's more", () => {
    expect(isaDensity(0)).toBeCloseTo(1.225, 3);
    expect(isaDensity(11_000)).toBeCloseTo(0.364, 2);
    // (a 2°/s turn at 150 m/s: tan φ = Vω/g)
    const turn = flightLaws([150, 0, 0], [0, -150 * 2 * D, 0], 3000, 5500);
    expect(turn.bank / D).toBeCloseTo(Math.atan2(150 * 2 * D, 9.80665) / D, 1);
    const cruise = flightLaws([0, 230, 0], [0, 0, 0], 11_000, 5500);
    const approach = flightLaws([0, 72, -3.8], [0, 0, 0], 300, 5500);
    const banked = flightLaws([0, 230, 0], [(230 * Math.tan(30 * D) * 9.80665) / 230, 0, 0], 11_000, 5500);
    console.log(
      `  incidence: cruise ${(cruise.alpha / D).toFixed(1)}°, approach ${(approach.alpha / D).toFixed(1)}° (path ${(approach.gamma / D).toFixed(1)}°), in a 30° turn ${(banked.alpha / D).toFixed(1)}° (n ${banked.n.toFixed(2)})`,
    );
    expect(cruise.alpha / D).toBeGreaterThan(1.5);
    expect(cruise.alpha / D).toBeLessThan(4.5);
    expect(approach.alpha / D).toBeGreaterThan(2);
    expect(approach.alpha / D).toBeLessThan(9);
    expect(banked.n).toBeCloseTo(1 / Math.cos(30 * D), 2);
    expect(banked.alpha).toBeGreaterThan(cruise.alpha);
  });
});
