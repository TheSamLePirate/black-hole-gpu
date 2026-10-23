import { afterEach, expect, test } from "bun:test";
import { gcasForget } from "../src/controller/gcas";
import { orbitHeading, tfGamma } from "../src/game/jetmodes";
import { setGroundHeights } from "../src/system/our-surface";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// PLAN-AVIATION-AAA A3: the F-35's new autopilot modes — an orbit over a point held at its radius, round and round;
// the terrain following over hills 150 m over them, the Auto-GCAS never needed; the rendezvous with a tanker on its
// racetrack, to the observation slot behind its hose — the refuelling then (tests/aar.test.ts).

afterEach(() => {
  resetFlights();
  setGroundHeights("earth", null);
  gcasForget();
});

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

test("the orbit's heading: the tangent on the circle, bent in from outside, out from inside; the ski toe's climb", () => {
  // (east of the centre on the circle, flown to the right — clockwise: heading south)
  expect(orbitHeading([4000, 0], 4000, 1)).toBeCloseTo(180 * D, 5);
  expect(orbitHeading([4000, 0], 4000, -1)).toBeCloseTo(0, 5);
  // (outside: bent in — towards the west of south —; inside: out)
  expect(orbitHeading([6000, 0], 4000, 1)).toBeGreaterThan(180 * D - 1e-9 - 2 * Math.PI);
  const out = orbitHeading([6000, 0], 4000, 1);
  const inn = orbitHeading([2000, 0], 4000, 1);
  expect(Math.cos(out - 180 * D)).toBeLessThan(1);
  expect(Math.sin(out)).toBeLessThan(Math.sin(inn));
  // ski toe: a 600 m hill 3 km ahead from 200 m at 250 m/s, 150 m over it asks some 10° up; flat, a gentle descent
  const hill = (x: number) => (x > 2800 && x < 3600 ? 600 : 0);
  const g = tfGamma(200, 250, 150, hill);
  expect(g / D).toBeGreaterThan(9);
  // (flat, far over it: down — the farthest point asking the least)
  expect(tfGamma(800, 250, 150, () => 0) / D).toBeLessThan(-9);
});

test("an orbit to the right over a point 4 km off: held at its radius, round and round", () => {
  const { c, fly } = cruise(3000, 220, 0.7);
  c.jetToggle("ap");
  c.jetToggle("athr");
  expect(c.orbitStart({ radius: 4000, dir: 1 })).toMatch(/Orbit: 4.0 km/);
  const O = c.orbitMode!;
  let lo = Infinity,
    hi = 0,
    turned = 0;
  let last = c.geoNow()!.track;
  for (let i = 0; i < 300; i++) {
    fly(0.5);
    const g = c.geoNow()!;
    const r = Math.hypot((g.lon - O.lon) * D * R_EARTH * Math.cos(O.lat * D), (g.lat - O.lat) * D * R_EARTH);
    if (i > 40) (lo = Math.min(lo, r)), (hi = Math.max(hi, r));
    turned += Math.atan2(Math.sin(g.track - last), Math.cos(g.track - last));
    last = g.track;
  }
  console.log(`  the radius held ${lo.toFixed(0)}–${hi.toFixed(0)} m, turned ${(turned / D).toFixed(0)}° in 150 s`);
  expect(lo).toBeGreaterThan(3700);
  expect(hi).toBeLessThan(4300);
  expect(turned / D).toBeGreaterThan(300);
}, 120_000);

test("the terrain following at 150 m over hills: their tops cleared, the valleys followed, the GCAS never needed", () => {
  const { c, fly } = cruise(400, 230, 0.7);
  const g0 = c.geoNow()!;
  // (hills across the track — the jet flies east —: 0 to 500 m, every 8 km)
  const hills = (x: number) => (x < 2000 ? 0 : 250 - 250 * Math.cos((2 * Math.PI * (x - 2000)) / 8000));
  setGroundHeights("earth", (q) => {
    const lon = Math.atan2(q[1], q[0]) / D;
    return hills((lon - g0.lon) * D * R_EARTH * Math.cos(g0.lat * D));
  });
  gcasForget();
  c.jetToggle("ap");
  c.jetToggle("athr");
  expect(c.tfStart(150)).toMatch(/150 m/);
  let lo = Infinity,
    hi = 0,
    flyUps = 0;
  for (let i = 0; i < 600; i++) {
    fly(0.1);
    const g = c.geoNow()!;
    const x = (g.lon - g0.lon) * D * R_EARTH * Math.cos(g0.lat * D);
    const ground = hills(x);
    if (x > 4000) (lo = Math.min(lo, g.alt - ground)), (hi = Math.max(hi, g.alt - ground));
    if (c.gcas?.flyUp) flyUps++;
    if (c.airFlight.failure) break;
  }
  console.log(`  over the hills: ${lo.toFixed(0)}–${hi.toFixed(0)} m over the ground; GCAS flying ${flyUps} frames`);
  expect(c.airFlight.failure).toBeFalsy();
  expect(lo).toBeGreaterThan(60);
  expect(hi).toBeLessThan(500);
  expect(flyUps).toBe(0);
}, 120_000);

test("a tanker: set 25 km ahead on its racetrack, the rendezvous behind its hose, the refuelling's stage then", () => {
  const { c, fly } = cruise(6000, 240, 0.7);
  c.jetToggle("ap");
  c.jetToggle("athr");
  const msgs: string[] = [];
  c.onPilotMessage = (s) => msgs.push(s);
  expect(c.tankerStart()).toMatch(/TEXACO 11/);
  const t = fly(600, () => c.aar?.stage === "hose");
  const q = c.combat!.world.targets[0]!;
  const P = c.combat!.last!;
  const d = [q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]];
  console.log(
    `  behind its hose after ${t.toFixed(0)} s: ${Math.hypot(...d).toFixed(0)} m from it, ${(P.p[2] - q.p[2]).toFixed(1)} m above — ${msgs.filter((m) => /Behind|Refuelling|Intercept/.test(m)).join(" · ")}`,
  );
  expect(c.aar?.stage).toBe("hose");
  expect(c.icpt ?? null).toBeNull();
  // (the hose's stage begins within 70 m behind its basket — controller/aar.ts —, the basket some 35 m behind the
  // tanker's centre: within 110 m of it)
  expect(Math.hypot(...d)).toBeLessThan(110);
  expect(P.p[2] - q.p[2]).toBeLessThan(0);
  expect(c.gcas?.escape ?? null).toBeNull();
  // (again: the refuelling off; once more — the same tanker joined again, not a second one)
  expect(c.tankerStart()).toMatch(/off/);
  expect(c.aar ?? null).toBeNull();
  expect(c.tankerStart({ side: "left" })).toMatch(/left hose/);
  expect(c.combat!.world.targets.filter((x) => x.name === "TEXACO 11").length).toBe(1);
  expect(c.modesOff()).toMatch(/refuelling off/);
  expect(c.aar ?? null).toBeNull();
}, 200_000);
