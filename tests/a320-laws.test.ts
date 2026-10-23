import { afterEach, describe, expect, test } from "bun:test";
import { alphaLimits } from "../src/a320/fbw";
import { fleet } from "../src/fleet";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's flight control laws (docs/PLAN-A320.md, A4 — src/a320/fbw.ts) flown frame by frame by the controller:
// the bank held to 33° let go and limited to 67°, the load factor's limits, the pitch attitude's, the flight path held
// let go, the high incidence's protection and α floor, the high speed's.

afterEach(resetFlights);

const D = Math.PI / 180;
const KT = 0.514444;

/** The A320 in the air over the Atlantic: h up, v m/s eastwards, the levers at `thr`, CONF clean. */
function cruise(h = 3048, v = 128, thr = 0.62) {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, h / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, v / C_MPS)), landed: undefined }, false, "a320");
  run.c.s.flightMode = "plane";
  run.c.gearDown = false;
  run.c.gearExt = 0;
  run.c.gearInit = true;
  run.c.pilot.throttle = thr;
  run.fly(2);
  // (the engines spooled to the levers)
  run.fly(6);
  return run;
}
function withStick(c: ReturnType<typeof flight>["c"], s: { pitch?: number; roll?: number }, f: () => void) {
  const input = c.pilotInput.bind(c);
  c.pilotInput = (pad) => ({ ...input(pad), ...s });
  f();
  c.pilotInput = input;
}
const bank = (c: ReturnType<typeof flight>["c"]) => (c.attitudeNow() as { bank: number }).bank;
const pitch = (c: ReturnType<typeof flight>["c"]) => (c.attitudeNow() as { pitch: number }).pitch;

describe("A320 laws", () => {
  test("the roll: 15°/s at full stick, 67° at most held there; let go past 33°, back to 33°", () => {
    const { c, fly } = cruise();
    let peak = 0,
      maxBank = 0;
    withStick(c, { roll: 1 }, () => {
      for (let i = 0; i < 30 * 8; i++) {
        fly(1 / 30);
        peak = Math.max(peak, Math.abs(c.pilot.omega[2]));
        maxBank = Math.max(maxBank, Math.abs(bank(c)));
      }
    });
    fly(15);
    const settled = Math.abs(bank(c));
    console.log(`  roll rate ${(peak / D).toFixed(1)}°/s · bank held ${(maxBank / D).toFixed(1)}° · let go ${(settled / D).toFixed(1)}°`);
    expect(peak / D).toBeGreaterThan(12);
    expect(peak / D).toBeLessThan(18);
    expect(maxBank / D).toBeGreaterThan(62);
    expect(maxBank / D).toBeLessThan(70);
    expect(Math.abs(settled / D - 33)).toBeLessThan(3);
  }, 120_000);

  test("let go, the flight path held; full aft: the load at most 2.5 g, the pitch at most 30°", () => {
    const { c, fly } = cruise(3048, 150, 0.7);
    const p0 = pitch(c);
    fly(15);
    const drift = Math.abs(pitch(c) - p0);
    let nMax = 0,
      pMax = 0;
    withStick(c, { pitch: 1 }, () => {
      for (let i = 0; i < 30 * 12; i++) {
        fly(1 / 30);
        const L = c.airFlight.last!;
        nMax = Math.max(nMax, L.out.F[1] / (9.80665 * fleet.massProps().mass));
        pMax = Math.max(pMax, pitch(c));
      }
    });
    console.log(
      `  let go 15 s: the pitch moved ${(drift / D).toFixed(2)}° · full aft: ${nMax.toFixed(2)} g, pitch ${(pMax / D).toFixed(1)}°`,
    );
    expect(drift / D).toBeLessThan(1.5);
    expect(nMax).toBeLessThan(2.75);
    expect(nMax).toBeGreaterThan(2.0);
    expect(pMax / D).toBeLessThan(31);
  }, 120_000);

  test("slow, full aft at idle: the incidence held under α max, α floor's TOGA", () => {
    const { c, fly } = cruise(3048, 105, 0);
    c.pilot.throttle = 0;
    let aMax = 0,
      floor = false;
    withStick(c, { pitch: 1 }, () => {
      for (let i = 0; i < 30 * 40; i++) {
        fly(1 / 30);
        aMax = Math.max(aMax, c.airFlight.last!.out.alpha);
        floor ||= c.a320!.alphaFloor;
      }
    });
    const lim = alphaLimits(c.airFlight.last!.out.mach, 0, 0);
    console.log(
      `  α reached ${(aMax / D).toFixed(1)}° (α max ${lim.max.toFixed(1)}°, α floor ${lim.floor}°) · α floor ${floor ? "TOGA" : "no"} · N1 ${c.a320!.engines[0].n1.toFixed(0)} %`,
    );
    expect(aMax / D).toBeLessThan(lim.max + 0.8);
    expect(floor).toBeTrue();
  }, 120_000);

  test("past VMO in a dive, the nose brought up: never 20 kt past it", () => {
    const { c, fly } = cruise(5000, 175, 1);
    let vMax = 0;
    withStick(c, { pitch: -0.6 }, () => {
      for (let i = 0; i < 30 * 40; i++) {
        fly(1 / 30);
        vMax = Math.max(vMax, Math.sqrt((2 * c.airFlight.last!.out.q) / 1.225) / KT);
      }
    });
    console.log(`  the speed at most ${vMax.toFixed(0)} kt (VMO 350)`);
    expect(vMax).toBeLessThan(372);
  }, 120_000);
});

describe("A320 laws, pure", () => {
  const state = (o: Partial<import("../src/a320/fbw").LawState> = {}) => ({
    alpha: 5 * D,
    beta: 0,
    gamma: -3 * D,
    bank: 0,
    path: [0, 0, 0] as [number, number, number],
    speed: 70,
    mach: 0.2,
    nz: 1,
    ground: false,
    ...o,
  });
  test("the flare mode: below 50 ft the attitude memorised, then 2° nose down over 8 s", async () => {
    const { AirbusLaw } = await import("../src/a320/fbw");
    const L = new AirbusLaw();
    const A = { pitch: 2 * D, slat: 27, flap: 35, ias: 135, agl: 14, law: "normal" as const };
    const o = L.step(state(), A, { pitch: 0, roll: 0, yaw: 0 }, 1 / 30);
    expect(o.flare).toBeTrue();
    // (8 s on, the attitude asked 2° lower: the law pitches down at the memorised one)
    let w = 0;
    for (let i = 0; i < 30 * 8; i++) w = L.step(state(), { ...A, agl: 5 }, { pitch: 0, roll: 0, yaw: 0 }, 1 / 30).want[0];
    expect(w).toBeCloseTo(0.8 * -2 * D, 3);
  });
  test("the alternate law: no bank limit of 33° let go, no α protection", async () => {
    const { AirbusLaw } = await import("../src/a320/fbw");
    const L = new AirbusLaw();
    const A = { pitch: 5 * D, slat: 0, flap: 0, ias: 250, law: "alternate" as const };
    // (let go at 50° of bank: held there — no spiral stability brought back to 33°)
    let o = L.step(state({ bank: 50 * D, gamma: 0, alpha: 3 * D }), A, { pitch: 0, roll: 0, yaw: 0 }, 1 / 30);
    expect(Math.abs(o.want[2])).toBeLessThan(1e-6);
    o = L.step(state({ alpha: 14 * D, gamma: 0 }), A, { pitch: 1, roll: 0, yaw: 0 }, 1 / 30);
    expect(o.alphaProt).toBeFalse();
    expect(o.alphaFloor).toBeFalse();
  });
});
