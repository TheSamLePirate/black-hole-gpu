import { afterEach, describe, expect, test } from "bun:test";
import { fleet } from "../src/fleet";
import { cruise, withStick } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The F-35B's flight control law (docs/PLAN-AVIATION-AAA.md, V3): the stick asks a load — 1 g at rest, its limit
// at full aft, its negative one at full forward, in between in proportion —, built in about half a second, held as
// the speed bleeds, never past the limit; let go, the flight path held; its limit the setting's; the gear down, a
// gentler law.

afterEach(resetFlights);

/** The normal load [g] each frame while the stick is held `s` seconds, at height h and speed v. */
function loads(h: number, v: number, stick: number, s: number, setup?: (c: ReturnType<typeof cruise>["c"]) => void) {
  const { c, fly } = cruise(h, v, 1);
  setup?.(c);
  const n: number[] = [];
  withStick(c, { pitch: stick }, () => {
    for (let i = 0; i < s * 30; i++) {
      fly(1 / 30);
      n.push((c.airFlight.last?.out.F[1] ?? 0) / (fleet.massProps().mass * 9.80665));
    }
  });
  return { n, c, fly };
}
const at = (n: number[], s: number) => n[Math.min(n.length - 1, Math.round(s * 30))]!;

describe("the F-35B's flight control law", () => {
  test("full aft stick at 260 m/s: 7 g in about half a second, held, never past 7.3", () => {
    const { n } = loads(4000, 260, 1, 3);
    const rise = n.findIndex((x) => x >= 6.3) / 30;
    console.log(`  6.3 g after ${rise.toFixed(2)} s; ${Math.max(...n).toFixed(2)} g at most, ${at(n, 2.5).toFixed(2)} g at 2.5 s`);
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThan(1);
    expect(Math.max(...n)).toBeLessThan(7.3);
    expect(at(n, 2.5)).toBeGreaterThan(6.7);
  });

  test("half stick: half the way to the limit — some 4 g", () => {
    const { n } = loads(4000, 260, 0.5, 2.5);
    console.log(`  ${at(n, 2).toFixed(2)} g at 2 s`);
    expect(at(n, 2)).toBeGreaterThan(3.6);
    expect(at(n, 2)).toBeLessThan(4.4);
  });

  test("full forward stick: −3 g, never past −3.3", () => {
    const { n } = loads(4000, 260, -1, 2.5);
    console.log(`  ${Math.min(...n).toFixed(2)} g at least, ${at(n, 2).toFixed(2)} g at 2 s`);
    expect(Math.min(...n)).toBeGreaterThan(-3.3);
    expect(at(n, 2)).toBeLessThan(-2.7);
  });

  test("its limit the setting's: 9 g asked, 9 g given at 300 m/s", () => {
    const { n } = loads(4000, 300, 1, 3, (c) => {
      c.s.f35GLimit = 9;
    });
    console.log(`  ${Math.max(...n).toFixed(2)} g at most`);
    expect(Math.max(...n)).toBeGreaterThan(8.6);
    expect(Math.max(...n)).toBeLessThan(9.4);
  });

  test("let go after a pull: the flight path held — no more turn within a second and a half", () => {
    const { c, fly } = loads(4000, 240, 0.6, 1.5);
    fly(3);
    const n = (c.airFlight.last?.out.F[1] ?? 0) / (fleet.massProps().mass * 9.80665);
    console.log(`  let go: ${n.toFixed(2)} g 3 s on`);
    // (the path held: the load back to its weight's share across it, cos γ — near 1 g)
    expect(Math.abs(n - 1)).toBeLessThan(0.6);
  });

  test("the gear down: a gentler law — 4 g at most", () => {
    const { n } = loads(2000, 120, 1, 3, (c) => {
      c.gearDown = true;
      c.gearExt = 1;
    });
    console.log(`  ${Math.max(...n).toFixed(2)} g at most, gear down`);
    expect(Math.max(...n)).toBeLessThan(4.3);
  });
});
