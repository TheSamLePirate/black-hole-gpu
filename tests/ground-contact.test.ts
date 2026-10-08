import { afterEach, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { gearHeight, groundVelocity, setGroundRelief } from "../src/system/our-surface";
import { M_METRES } from "../src/units";
import { flight, overPlace, resetFlights, TRANQUILITY, touchdown } from "./helpers/flight";

// A craft meeting a solid ground, flown by the controller (no autopilot): the ground is the relief — not the
// body's mean sphere, which a mare or a crater lies under (the Moon's Tranquility ~2 km) —, and a craft
// flown into it off its gear (its tail, its nose) crashes rather than standing there.

afterEach(resetFlights);

test("dropped level onto a lunar mare 2 km under the mean sphere: down on its gear on the relief, not stopped on the sphere", () => {
  setGroundRelief("moon", () => -2000);
  const { c, msgs, fly, here } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 0.005, false);
  fly(20, () => !!c.ourLanded);
  expect(touchdown(msgs).said).toMatch(/Touchdown on Moon/);
  const h = here();
  expect(gearHeight("moon", h.q, h.t)).toBeLessThan(1);
});

test("flown tail first into the ground, off its gear: a crash, not a craft left standing on its tail", () => {
  setGroundRelief("moon", () => -2000);
  const g = ourGroundPose("moon", TRANQUILITY.lat, TRANQUILITY.lon, 0);
  const X = add(g.X, scale(g.up, 300 / M_METRES));
  // (nose up — a rocket's braking —, falling at 20 m/s)
  const { c, msgs, fly } = flight(
    { ...g, X, fwd: g.up, up: scale(g.fwd, -1), vel: add(groundVelocity("moon", X, 0), scale(g.up, -20 / 299792458)), landed: undefined },
    false,
  );
  fly(30, () => !!c.ourLanded);
  // (a crash: the hull into the ground, or — the gear 1.8 m short, reaching the ground first — the gear
  // collapsing under it; not a craft left standing on its tail)
  expect(msgs.join(" | ")).toMatch(/crashed into Moon|gear collapsed on Moon/);
});
