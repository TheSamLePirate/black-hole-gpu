import { afterEach, describe, expect, test } from "bun:test";
import { airAt } from "../src/aero";
import { a320Forces, restSurfaces } from "../src/a320/aero";
import { limits, n2Of, newEngine, stepEngine, thrustAt } from "../src/a320/fadec";
import { fleet } from "../src/fleet";
import { ourGroundPose } from "../src/game/place";
import { solarBody } from "../src/system/solar";
import { flight, resetFlights } from "./helpers/flight";

// The A320's performance (docs/PLAN-A320.md, A3): FlightGear's JSBSim aerodynamics with its lift calibrated on
// Airbus's stall speeds, its FADEC and CFM56s — measured against the aircraft's published figures: the stall speeds
// by configuration (FlightGear's own FMGC tables), the take-off thrust and its spool, the cruise's fuel flow, a take-off
// run, a landing roll on the autobrake.

afterEach(resetFlights);

const atm = solarBody("earth")!.atmosphere!;
const KT = 0.514444;
const D = Math.PI / 180;

function clMax(slat: number, flap: number) {
  const air = airAt(atm, 300);
  let best = 0;
  for (let a = 0; a < 25 * D; a += 0.05 * D)
    best = Math.max(
      best,
      a320Forces([0, -70 * Math.sin(a), 70 * Math.cos(a)], air, [0, 0, 0], { ...restSurfaces(), slat, flap, gear: 0 }, undefined).cl,
    );
  return best;
}
const vs1g = (m: number, cl: number) => Math.sqrt((2 * m * 9.80665) / (1.225 * 122.6125 * cl)) / KT;

describe("A320 performance", () => {
  test("the stall speeds by configuration: Airbus's, within a knot (60 t, 70 t)", () => {
    // (FlightGear's FMGC VS1G tables, Systems/a320-fmgc.xml)
    const ref = [
      [0, 0, 150.81, 162.65],
      [18, 0, 124.84, 135.1],
      [18, 10, 117.97, 127.54],
      [22, 15, 110.94, 119.99],
      [22, 20, 109.1, 118.16],
      [27, 35, 106.01, 114.67],
    ] as const;
    for (const [s, f, k60, k70] of ref) {
      const c = clMax(s, f);
      expect(Math.abs(vs1g(60000, c) - k60)).toBeLessThan(1);
      expect(Math.abs(vs1g(70000, c) - k70)).toBeLessThan(1);
    }
  });

  test("the engines: 27 000 lbf at take-off, idle to take-off power in some 8 s, climb thrust at FL350", () => {
    const sl = { altFt: 0, densFt: 0, tatC: 15, mach: 0, onGround: true, flapLever: 1 };
    const L = limits(sl);
    const toga = thrustAt(n2Of(L.toga), sl);
    expect(toga / 1000).toBeGreaterThan(114);
    expect(toga / 1000).toBeLessThan(122);
    let e = newEngine();
    let t = 0;
    while (e.thrust < 0.95 * toga && t < 20) {
      e = stepEngine(e, { n1: L.toga, reverse: 0 }, sl, 0.05);
      t += 0.05;
    }
    console.log(`  TOGA ${(toga / 1000).toFixed(1)} kN (N1 ${L.toga}) · idle → 95 % in ${t.toFixed(1)} s`);
    expect(t).toBeLessThan(9);
    const cr = { altFt: 35000, densFt: 35000, tatC: -28, mach: 0.78, onGround: false, flapLever: 0 };
    const clb = thrustAt(n2Of(limits(cr).clb), cr) / 1000;
    expect(clb).toBeGreaterThan(28);
    expect(clb).toBeLessThan(38);
  });

  test("cruise at FL350, Mach 0.78, 64 t: some 2.4 t of fuel an hour", () => {
    const air = airAt(atm, 10668);
    const V = 0.78 * air.a;
    // (level flight: the incidence holding the weight, the drag then)
    let lo = -2 * D,
      hi = 10 * D;
    const at = (a: number) => a320Forces([0, -V * Math.sin(a), V * Math.cos(a)], air, [0, 0, 0], { ...restSurfaces(), gear: 0 }, undefined);
    for (let i = 0; i < 50; i++) {
      const a = (lo + hi) / 2;
      const o = at(a);
      if (o.F[1] * Math.cos(a) + o.F[2] * Math.sin(a) < 64000 * 9.80665) lo = a;
      else hi = a;
    }
    const a = (lo + hi) / 2;
    const o = at(a);
    const drag = -(o.F[2] * Math.cos(a) - o.F[1] * Math.sin(a));
    // (the N1 giving half the drag from each engine, its fuel flow)
    const ea = { altFt: 35000, densFt: 35000, tatC: -28, mach: 0.78, onGround: false, flapLever: 0 };
    let n1 = 60;
    while (thrustAt(n2Of(n1), ea) < drag / 2 && n1 < 104) n1 += 0.05;
    const e = stepEngine({ ...newEngine(), n1, n2: n2Of(n1) }, { n1, reverse: 0 }, ea, 0.05);
    const tph = (2 * e.ff * 3600) / 1000;
    console.log(`  α ${(a / D).toFixed(2)}°, L/D ${((64000 * 9.80665) / drag).toFixed(1)}, N1 ${n1.toFixed(1)} %, ${tph.toFixed(2)} t/h`);
    expect(a / D).toBeGreaterThan(1.5);
    expect(a / D).toBeLessThan(4);
    expect(tph).toBeGreaterThan(2.1);
    expect(tph).toBeLessThan(2.8);
  });

  test("a take-off at TOGA, CONF 1+F, 64 t: rotated at 145 kt, off the ground in some 1 km", () => {
    const g = ourGroundPose("earth", 34.905, -117.884, 0);
    const run = flight({ ...g, landed: g.landed }, false, "a320");
    const { c, fly } = run;
    c.s.flightMode = "plane";
    c.airFlight.cfg.flaps = 0.25;
    c.pilot.throttle = 1;
    const input = c.pilotInput.bind(c);
    // (the run measured through the air — still air: along the ground; the home frame turns with the Earth)
    let dist = 0,
      t = 0;
    for (let i = 0; i < 90 * 30; i++) {
      const v = c.airFlight.last?.speed ?? 0;
      const rot = v > 145 * KT && (c.rolling || c.ourLanded);
      c.pilotInput = (pad) => ({ ...input(pad), pitch: rot ? 0.45 : 0 });
      fly(1 / 30);
      dist += v / 30;
      t += 1 / 30;
      if (!c.rolling && !c.ourLanded && v > 60) break;
    }
    c.pilotInput = input;
    console.log(
      `  lift-off after ${t.toFixed(1)} s, ${dist.toFixed(0)} m, ${((c.airFlight.last?.speed ?? 0) / KT).toFixed(0)} kt, ${fleet.massProps().mass.toFixed(0)} kg`,
    );
    expect(c.rolling || c.ourLanded).toBeFalsy();
    // (T/W 0.38 at full thrust: the roll some v² / 2a ≈ 1 km — the published take-off distance, to 35 ft, 1.6 km)
    expect(dist).toBeGreaterThan(800);
    expect(dist).toBeLessThan(2200);
  }, 120_000);

  test("a rejected take-off at 120 kt: the autobrake MED holds 3 m/s², the reversers help; stopped within 1.1 km", () => {
    // (on the runway at full thrust to 120 kt, the levers to idle: the ground spoilers, the autobrake — MED here —, the
    // reversers)
    const g = ourGroundPose("earth", 34.905, -117.884, 0);
    const run = flight({ ...g, landed: g.landed }, false, "a320");
    const { c, fly } = run;
    c.s.flightMode = "plane";
    c.pilot.throttle = 1;
    fly(1 / 30, () => false);
    c.a320!.autobrake = 2;
    fly(60, () => (c.airFlight.last?.speed ?? 0) > 120 * KT);
    c.pilot.throttle = 0;
    c.groundSpoilers = true;
    fly(1.5);
    const v0 = c.airFlight.last?.speed ?? 0;
    fly(4);
    const v4 = c.airFlight.last?.speed ?? 0;
    const med = (v0 - v4) / 4;
    c.a320ReverseToggle();
    let dist = ((v0 + v4) / 2) * 4,
      t = 4;
    while ((c.airFlight.last?.speed ?? 0) > 1 && t < 90) {
      dist += (c.airFlight.last?.speed ?? 0) / 30;
      fly(1 / 30);
      t += 1 / 30;
    }
    console.log(`  MED: ${med.toFixed(2)} m/s² (from ${(v0 / KT).toFixed(0)} kt), stopped ${dist.toFixed(0)} m in ${t.toFixed(1)} s`);
    expect(med).toBeGreaterThan(2.4);
    expect(med).toBeLessThan(3.8);
    expect(dist).toBeLessThan(1100);
  }, 120_000);
});
