import { afterEach, describe, expect, test } from "bun:test";
import { aeroForces, airAt } from "../src/aero";
import { solarBody } from "../src/system/solar";
import { VESSELS } from "../src/vessels";
import { cruise, withStick } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The F-35B at high incidence (docs/PLAN-AVIATION-AAA.md, V2), flown frame by frame by the controller: its lift on
// past the wing's stall (its chines' vortices), its law holding 50° and keeping off the departures whatever the
// stick does; without the computer (the direct law — not the real aircraft's), the deep stall, the spin that
// sustains itself, and its recovery with the controls let go.

afterEach(resetFlights);

const D = Math.PI / 180;
type Stick = { pitch?: number; roll?: number; yaw?: number };
interface Sample {
  t: number;
  alpha: number;
  beta: number;
  r: number;
  p: number;
  V: number;
  h: number;
}

/** Flies phases of stick held, sampled 10 times a second (angles and rates in degrees). */
function fly(law: "normal" | "direct", h: number, v: number, thr: number, phases: { s: number; stick: Stick }[]) {
  const run = cruise(h, v, thr);
  run.c.s.f35Law = law;
  run.c.pilot.throttle = thr;
  const out: Sample[][] = [];
  let t = 0;
  for (const ph of phases) {
    const seg: Sample[] = [];
    withStick(run.c, ph.stick, () => {
      for (let i = 0; i < ph.s * 30; i++) {
        run.fly(1 / 30);
        t += 1 / 30;
        if (i % 3 === 0) {
          const L = run.c.airFlight.last;
          const w = run.c.pilot.omega;
          seg.push({
            t,
            alpha: (L?.out.alpha ?? 0) / D,
            beta: (L?.out.beta ?? 0) / D,
            r: w[1] / D,
            p: w[2] / D,
            V: L?.speed ?? 0,
            h: L?.h ?? 0,
          });
        }
      }
    });
    out.push(seg);
  }
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const maxAbs = (xs: number[]) => Math.max(...xs.map(Math.abs));

describe("the F-35B at high incidence", () => {
  test("its lift: on past the wing's stall to a peak of ~1.74 at 35°, still lifting at 50°", () => {
    const air = airAt(solarBody("earth")!.atmosphere!, 3000);
    const cl = (deg: number) => {
      const a = deg * D;
      return aeroForces(VESSELS.f35.aero, [0, -60 * Math.sin(a), 60 * Math.cos(a)], air).cl;
    };
    console.log(`  CL: 20° ${cl(20).toFixed(2)}, 35° ${cl(35).toFixed(2)}, 50° ${cl(50).toFixed(2)}, 70° ${cl(70).toFixed(2)}`);
    expect(cl(35)).toBeGreaterThan(1.65);
    expect(cl(35)).toBeGreaterThan(cl(25));
    expect(cl(50)).toBeGreaterThan(1.3);
    expect(cl(50)).toBeLessThan(cl(35));
  });

  test("its law: full aft stick at 140 m/s holds 50°, no sideslip", () => {
    const [pull] = fly("normal", 4000, 140, 0.8, [{ s: 6, stick: { pitch: 1 } }]);
    const a = pull!.map((s) => s.alpha);
    console.log(`  α ${Math.max(...a).toFixed(1)}° at most, β ${maxAbs(pull!.map((s) => s.beta)).toFixed(1)}° at most`);
    expect(Math.max(...a)).toBeGreaterThan(45);
    expect(Math.max(...a)).toBeLessThan(53);
    expect(maxAbs(pull!.map((s) => s.beta))).toBeLessThan(5);
  }, 60_000);

  test("its law kept from departing: full aft stick, full roll and full rudder together at 110 m/s", () => {
    const [, abuse] = fly("normal", 4000, 110, 0.8, [
      { s: 2, stick: { pitch: 1 } },
      { s: 8, stick: { pitch: 1, roll: 1, yaw: 1 } },
    ]);
    const s = abuse!;
    console.log(
      `  α ${Math.max(...s.map((x) => x.alpha)).toFixed(1)}°, β ${maxAbs(s.map((x) => x.beta)).toFixed(1)}°, yaw ${maxAbs(s.map((x) => x.r)).toFixed(0)}°/s at most`,
    );
    // (its yaw the roll's about the flight path, r = p tan α — coordinated, not a departure: the sideslip small)
    expect(Math.max(...s.map((x) => x.alpha))).toBeLessThan(53);
    expect(maxAbs(s.map((x) => x.beta))).toBeLessThan(10);
    expect(maxAbs(s.map((x) => x.r))).toBeLessThan(45);
  }, 60_000);

  test("its law keeps off the spin: the spin's inputs held 14 s — a coordinated pedal turn; let go, it stops", () => {
    const [, spin, out] = fly("normal", 6000, 110, 0, [
      { s: 4, stick: { pitch: 1 } },
      { s: 14, stick: { pitch: 1, yaw: 1 } },
      { s: 4, stick: {} },
    ]);
    const stopped = out!.find((x) => Math.abs(x.r) < 5);
    console.log(
      `  yaw ${maxAbs(spin!.map((x) => x.r)).toFixed(0)}°/s, β ${maxAbs(spin!.map((x) => x.beta)).toFixed(1)}°, α ${Math.max(...spin!.map((x) => x.alpha)).toFixed(1)}° at most; stopped ${stopped ? `${(stopped.t - out![0]!.t).toFixed(1)} s` : "never"} after letting go`,
    );
    expect(maxAbs(spin!.map((x) => x.beta))).toBeLessThan(10);
    expect(Math.max(...spin!.map((x) => x.alpha))).toBeLessThan(53);
    expect(stopped).toBeDefined();
    expect(stopped!.t - out![0]!.t).toBeLessThan(3);
  }, 60_000);

  test("without the computer, full aft stick: the deep stall — 55–90°, sinking, slow", () => {
    const [stall] = fly("direct", 6000, 110, 0, [{ s: 12, stick: { pitch: 1 } }]);
    const late = stall!.filter((s) => s.t > 6);
    const sink = (late[0]!.h - late.at(-1)!.h) / (late.at(-1)!.t - late[0]!.t);
    console.log(
      `  α ${mean(late.map((s) => s.alpha)).toFixed(0)}° on average, sinking ${sink.toFixed(0)} m/s at ${mean(late.map((s) => s.V)).toFixed(0)} m/s`,
    );
    expect(mean(late.map((s) => s.alpha))).toBeGreaterThan(55);
    expect(mean(late.map((s) => s.alpha))).toBeLessThan(90);
    expect(sink).toBeGreaterThan(20);
    expect(Math.max(...late.map((s) => s.alpha))).toBeLessThan(120);
  }, 60_000);

  test("without the computer, aft stick and full rudder: a spin that sustains itself; let go, it recovers", () => {
    const [, spin, out] = fly("direct", 6000, 110, 0, [
      { s: 4, stick: { pitch: 1 } },
      { s: 14, stick: { pitch: 1, yaw: 1 } },
      { s: 14, stick: {} },
    ]);
    const developed = spin!.filter((s) => s.t > 10);
    const r = mean(developed.map((s) => Math.abs(s.r)));
    const sink = (developed[0]!.h - developed.at(-1)!.h) / (developed.at(-1)!.t - developed[0]!.t);
    const back = out!.find((s, i) => out!.slice(i).every((x) => Math.abs(x.r) < 10 && x.alpha < 20 && x.alpha > -10));
    console.log(
      `  spinning ${r.toFixed(0)}°/s at α ${mean(developed.map((s) => s.alpha)).toFixed(0)}°, sinking ${sink.toFixed(0)} m/s; recovered ${back ? `${(back.t - out![0]!.t).toFixed(1)} s` : "never"} after letting go`,
    );
    expect(r).toBeGreaterThan(50);
    expect(sink).toBeGreaterThan(40);
    expect(back).toBeDefined();
    expect(back!.t - out![0]!.t).toBeLessThan(12);
  }, 60_000);
});
