import { afterEach, expect, test } from "bun:test";
import { ASSIST } from "../src/controller/assistlevel";
import { cruise, withStick } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// PLAN-AVIATION-AAA A1: the F-35's levels of assistance — back to stable flight at a key from an inverted dive; the
// beginner's ring: the stick turns it 90° and raises it, the jet flies there; the assisted level: the throttle a
// speed, the incidence held under 20° where the real law lets it reach 35°; manual: the direct law.

afterEach(() => resetFlights());

const D = Math.PI / 180;
const bankOf = (c: ReturnType<typeof cruise>["c"]) => (c.attitudeNow() as { bank?: number }).bank ?? 0;
const gammaOf = (c: ReturnType<typeof cruise>["c"]) => {
  const g = c.geoNow()!;
  return Math.atan2(g.vs, g.gs);
};

test("back to stable flight from an inverted dive: the wings level, climbing, then the holds", () => {
  const { c, fly } = cruise(5000, 230, 0.7);
  // (rolled past the vertical, the nose pushed down)
  withStick(c, { roll: 1 }, () => fly(1.1));
  withStick(c, { pitch: -0.4 }, () => fly(2));
  const b0 = bankOf(c),
    g0 = gammaOf(c),
    h0 = c.geoNow()!.alt;
  expect(c.recoverStart()).toMatch(/wings level/);
  const t = fly(30, () => !c.recovering);
  const h1 = c.geoNow()!.alt;
  console.log(
    `  from ${(b0 / D).toFixed(0)}° of bank, ${(g0 / D).toFixed(0)}° down: stable in ${t.toFixed(1)} s, ${(h0 - h1).toFixed(0)} m lost, bank ${(bankOf(c) / D).toFixed(1)}°, path ${(gammaOf(c) / D).toFixed(1)}°`,
  );
  expect(Math.abs(b0)).toBeGreaterThan(90 * D);
  expect(g0).toBeLessThan(-5 * D);
  expect(c.recovering).toBeFalsy();
  expect(t).toBeLessThan(15);
  expect(Math.abs(bankOf(c))).toBeLessThan(10 * D);
  expect(c.jetModes.alt).not.toBeNull();
  expect(c.jetModes.hdg).not.toBeNull();
  expect(h0 - h1).toBeLessThan(1500);
}, 60_000);

test("the beginner's ring: the stick turns it 90° and raises it 12°, the jet flies there and stays", () => {
  const { c, fly } = cruise(4000, 220, 0.7);
  c.s.f35Assist = "beginner";
  fly(0.5);
  const h0 = (c.attitudeNow() as { heading?: number }).heading!;
  withStick(c, { roll: 1 }, () => fly(2));
  withStick(c, { pitch: 1 }, () => fly(1));
  fly(25);
  const h1 = (c.attitudeNow() as { heading?: number }).heading!;
  let dh = (h1 - h0) / D;
  dh = ((dh + 540) % 360) - 180;
  const g = gammaOf(c) / D;
  console.log(
    `  turned ${dh.toFixed(1)}°, climbing at ${g.toFixed(1)}° (the ring: ${(c.aimRing!.gamma / D).toFixed(1)}°), at ${c.airFlight.last!.speed.toFixed(0)} m/s`,
  );
  // (the ring turned by the stick — its input eased in —, the jet's heading on it)
  let dr = (h1 - c.aimRing!.hdg) / D;
  dr = ((dr + 540) % 360) - 180;
  expect(dh).toBeGreaterThan(75);
  expect(Math.abs(dr)).toBeLessThan(2);
  expect(Math.abs(g - 12)).toBeLessThan(2);
  expect(Math.abs(c.airFlight.last!.speed - 220)).toBeLessThan(25);
}, 60_000);

test("assisted: the throttle a speed, the incidence under 20° in a full pull where the real law reaches 35°", () => {
  const pullAlpha = (level: "realistic" | "assisted") => {
    const { c, fly } = cruise(4000, 150, 0.5);
    c.s.f35Assist = level;
    fly(0.5);
    const spd = c.jetModes.spd;
    let peak = 0;
    withStick(c, { pitch: 1 }, () => {
      for (let i = 0; i < 120; i++) {
        fly(1 / 30);
        peak = Math.max(peak, c.airFlight.last!.out.alpha);
      }
    });
    resetFlights();
    return { peak, spd };
  };
  const real = pullAlpha("realistic");
  const asst = pullAlpha("assisted");
  console.log(
    `  a full pull at 150 m/s: realistic ${(real.peak / D).toFixed(1)}°, assisted ${(asst.peak / D).toFixed(1)}° (its auto-throttle on ${asst.spd} m/s)`,
  );
  expect(real.peak / D).toBeGreaterThan(30);
  expect(asst.peak).toBeLessThan(ASSIST.alphaMax + 1.5 * D);
  expect(real.spd).toBeNull();
  expect(asst.spd).toBeGreaterThan(140);
}, 60_000);
