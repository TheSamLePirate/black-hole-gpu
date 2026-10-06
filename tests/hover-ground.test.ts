import { afterEach, expect, test } from "bun:test";
import { toBodyFixed } from "../src/system/our-surface";
import { apart, overPlace, resetFlights } from "./helpers/flight";

// The hover low over a ground holds its place over it — carried by the ground's turning, not at rest against
// the body's centre while the ground slides under it (the Earth's 400 m/s at Kennedy) —, level on its thrust.

afterEach(resetFlights);

test("the hover 1 km over Kennedy holds its place over the turning Earth for a minute", () => {
  const { c, fly, here } = overPlace("earth", 28.6, -80.6, 1);
  const h0 = here();
  const q0 = toBodyFixed("earth", h0.q, h0.t);
  fly(60);
  const h1 = here();
  expect(apart(toBodyFixed("earth", h1.q, h1.t), q0)).toBeLessThan(2);
  expect(c.hubNote.drift!).toBeLessThan(0.2);
  expect(c.pilot.auto).toBe("hover");
  // (level: its gear under it)
  const a = c.attitudeNow() as { pitch?: number; bank?: number };
  expect(Math.abs(a.pitch ?? 9)).toBeLessThan(0.05);
  expect(Math.abs(a.bank ?? 9)).toBeLessThan(0.05);
});
