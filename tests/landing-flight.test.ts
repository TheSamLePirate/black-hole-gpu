import { afterEach, expect, test } from "bun:test";
import { orbitOver, ourGroundPose, ourOrbitPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { bodyFixedOf, gearHeight, groundVelocity, setGroundRelief, toBodyFixed } from "../src/system/our-surface";
import { M_METRES } from "../src/units";
import { apart, flight, overPlace, resetFlights, TRANQUILITY, touchdown } from "./helpers/flight";

// Our powered landings flown frame by frame by the controller itself (no page): the landing autopilot from
// a hover over a place and from an orbit to a site — its guidance (descent.ts), its pilot law and attitude
// (level on its vectored thrust at the end: its gear under its belly), the touchdown's verdict —, over
// grounds lower than their body's mean sphere (a mare, a crater); the Lander handed over by its entry.

afterEach(resetFlights);

test("the landing autopilot from a hover 1.5 km over a lunar mare: down on its gear, gently, on the spot", () => {
  setGroundRelief("moon", () => -2000);
  const { c, msgs, fly, here } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 1.5);
  fly(2);
  const h0 = here();
  const q0 = toBodyFixed("moon", h0.q, h0.t);
  c.pilot.auto = "none";
  c.pilot.setAuto("land");
  const took = fly(240, () => !!c.ourLanded && c.pilot.auto === "none");
  const td = touchdown(msgs);
  expect(td.said).toMatch(/Touchdown on Moon/);
  expect(td.sink!).toBeLessThanOrEqual(1);
  expect(td.drift!).toBeLessThan(0.5);
  // (on the place it hovered over, within a minute and a half)
  expect(apart(c.ourLanded!.q, q0)).toBeLessThan(5);
  expect(took).toBeLessThan(90);
  const h1 = here();
  expect(gearHeight("moon", h1.q, h1.t)).toBeLessThan(1);
});

test("on Tranquility's own sloped ground: one touchdown said as the craft settles on its legs, standing at last", () => {
  // (the first leg down, the craft turned by it lifted it off the ground for a sub-step: it was said twice)
  const { c, msgs, fly } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 1.5);
  fly(2);
  c.pilot.auto = "none";
  c.pilot.setAuto("land");
  fly(240, () => !!c.ourLanded && c.pilot.auto === "none");
  expect(msgs.filter((m) => /Touchdown|Hard landing|Airborne/.test(m))).toHaveLength(1);
  expect(touchdown(msgs).sink!).toBeLessThanOrEqual(1);
  expect(c.ourLanded).not.toBeNull();
});

test("over Kennedy's pad, 1 km up: the landing autopilot through the air, onto the spot", () => {
  const { c, msgs, fly, here } = overPlace("earth", 28.6, -80.6, 1);
  fly(2);
  const h0 = here();
  const q0 = toBodyFixed("earth", h0.q, h0.t);
  c.pilot.auto = "none";
  c.pilot.setAuto("land");
  fly(240, () => !!c.ourLanded && c.pilot.auto === "none");
  const td = touchdown(msgs);
  expect(td.said).toMatch(/Touchdown on Earth/);
  expect(td.sink!).toBeLessThanOrEqual(1);
  expect(td.drift!).toBeLessThan(0.5);
  expect(apart(c.ourLanded!.q, q0)).toBeLessThan(5);
});

test("from a 50 km lunar orbit to Tranquility: the descent orbit, the coast, the braking, on the pad", () => {
  setGroundRelief("moon", () => -2000);
  const site = { body: "moon", name: "Tranquility Base", ...TRANQUILITY };
  const w = orbitOver("moon", bodyFixedOf("moon", site.lat, site.lon, 0), 0, { inc: 5, argPe: 0, retrograde: false });
  // (the pad a quarter turn ahead)
  const { c, msgs, fly } = flight(ourOrbitPose({ body: "moon", altKm: 50, inc: w.inc, raan: w.raan, nu: w.nu - 90 }, 0), false);
  c.pilot.auto = "none";
  c.pilot.setAuto("land");
  c.landRun = { body: "moon", site, q: null, heading: null, cmd: null };
  fly(3600, () => !!c.ourLanded && c.pilot.auto === "none");
  const td = touchdown(msgs);
  expect(td.said).toMatch(/Touchdown on Moon/);
  expect(td.sink!).toBeLessThanOrEqual(1);
  expect(td.drift!).toBeLessThan(0.5);
  expect(apart(c.ourLanded!.q, bodyFixedOf("moon", site.lat, site.lon, 0))).toBeLessThan(50);
});

test("the Lander handed over by its Martian entry (9 km up, 350 m/s, Jezero 9 km ahead): on its engines, onto the site", () => {
  setGroundRelief("mars", () => -2600);
  const site = { body: "mars", name: "Jezero crater", lat: 18.44, lon: 77.45 };
  // (9 km short of the site, on its meridian: heading north towards it, coming down)
  const g = ourGroundPose("mars", site.lat - 9 / 59.16, site.lon, 0);
  const to = ourGroundPose("mars", site.lat, site.lon, 0).X;
  const X = add(g.X, scale(g.up, 9e3 / M_METRES));
  const d = [to[0] - X[0], to[1] - X[1], to[2] - X[2]] as [number, number, number];
  const along = add(d, scale(g.up, -(d[0] * g.up[0] + d[1] * g.up[1] + d[2] * g.up[2])));
  const u = scale(along, 1 / Math.hypot(...along));
  const vel = add(add(groundVelocity("mars", X, 0), scale(u, 350 / 299792458)), scale(g.up, -60 / 299792458));
  const { c, msgs, fly } = flight({ ...g, X, fwd: u, up: g.up, vel, landed: undefined }, false, "lander");
  c.pilot.auto = "none";
  c.pilot.setAuto("land");
  c.landRun = { body: "mars", site, q: null, heading: null, cmd: null };
  fly(400, () => !!c.ourLanded && c.pilot.auto === "none");
  const td = touchdown(msgs);
  expect(td.said).toMatch(/Touchdown on Mars/);
  expect(td.sink!).toBeLessThanOrEqual(1);
  expect(td.drift!).toBeLessThan(0.5);
  expect(apart(c.ourLanded!.q, bodyFixedOf("mars", site.lat, site.lon, 0))).toBeLessThan(50);
});

test("the Lander's Martian entry still at Mach 3, 9 km up, falling 180 m/s: its engines take over — no fall to the ground at Mach 2", () => {
  setGroundRelief("mars", () => -2600);
  const site = { body: "mars", name: "Jezero crater", lat: 18.44, lon: 77.45 };
  const g = ourGroundPose("mars", site.lat - 60 / 59.16, site.lon, 0);
  const to = ourGroundPose("mars", site.lat, site.lon, 0).X;
  const X = add(g.X, scale(g.up, 9e3 / M_METRES));
  const d = [to[0] - X[0], to[1] - X[1], to[2] - X[2]] as [number, number, number];
  const along = add(d, scale(g.up, -(d[0] * g.up[0] + d[1] * g.up[1] + d[2] * g.up[2])));
  const u = scale(along, 1 / Math.hypot(...along));
  const vel = add(add(groundVelocity("mars", X, 0), scale(u, 700 / 299792458)), scale(g.up, -180 / 299792458));
  const { c, msgs, fly } = flight({ ...g, X, fwd: u, up: g.up, vel, landed: undefined }, false, "lander");
  c.entrySite = site as never;
  c.pilot.auto = "none";
  c.pilot.setAuto("entry");
  fly(600, () => !!c.ourLanded || !!c.airFlight.failure || (c.pilot.auto === "none" && !!c.rolling));
  expect(c.airFlight.failure).toBeNull();
  expect(msgs.some((m) => /the engines land the Lander/.test(m))).toBe(true);
  expect(touchdown(msgs).sink!).toBeLessThanOrEqual(1.5);
}, 60_000);

test("the Lander handed over by an Earth entry at Mach 2, 22 km up, its site 130 km on: whole, down gently", () => {
  // (through the thick air on its engines: the site out of reach, down where it stops)
  const site = { body: "earth", name: "a far pad", lat: 28.6 + 130 / 111.2, lon: -80.6 };
  const g = ourGroundPose("earth", 28.6, -80.6, 0);
  const to = ourGroundPose("earth", site.lat, site.lon, 0).X;
  const X = add(g.X, scale(g.up, 22e3 / M_METRES));
  const d = [to[0] - X[0], to[1] - X[1], to[2] - X[2]] as [number, number, number];
  const u = scale(add(d, scale(g.up, -(d[0] * g.up[0] + d[1] * g.up[1] + d[2] * g.up[2]))), 1);
  const uu = scale(u, 1 / Math.hypot(...u));
  const vel = add(add(groundVelocity("earth", X, 0), scale(uu, 600 / 299792458)), scale(g.up, -240 / 299792458));
  const { c, msgs, fly } = flight({ ...g, X, fwd: uu, up: g.up, vel, landed: undefined }, false, "lander");
  c.pilot.auto = "none";
  c.pilot.setAuto("land");
  c.landRun = { body: "earth", site, q: null, heading: null, cmd: null };
  fly(600, () => !!c.ourLanded && c.pilot.auto === "none");
  expect(c.airFlight.failure).toBeNull();
  const td = touchdown(msgs);
  expect(td.said).toMatch(/Touchdown on Earth/);
  expect(td.sink!).toBeLessThanOrEqual(1.5);
});
