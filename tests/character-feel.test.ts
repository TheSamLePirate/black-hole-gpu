// The explorer's feel and its obstacles: the jump's buffer and coyote time, the air's steering, the landing's
// give, the gait's ground speed, and the landed vessel's hull as a wall for the walk, the camera and the exits.
import { afterEach, expect, test } from "bun:test";
import { CameraController } from "../src/controls";
import { defaultSettings } from "../src/settings";
import { setSceneTime } from "../src/wormhole";
import { add, dot, len, scale, sub, unit } from "../src/math/vec3";
import { toBodyFixed } from "../src/system/our-surface";
import { M_METRES } from "../src/system/solar";
import type { Vec3 } from "../src/physics";
import { flight, resetFlights } from "./helpers/flight";
import { ourGroundPose } from "../src/game/place";
import { AIR_RESPONSE, COYOTE_S, GROUND_RESPONSE, JUMP_BUFFER_S, tangent } from "../src/controller/character";
import { capsuleInHull, hullDistance, outOfHull, placeHull } from "../src/controller/vessel-hull";
import type { SceneryContact } from "../src/system/scenery-contact";

afterEach(resetFlights);
function walker(body = "moon", lat = 0, lon = 0) {
  setSceneTime(0);
  const c = new CameraController({} as HTMLCanvasElement, defaultSettings(), () => {}, true);
  expect(c.character.start(body, lat, lon)).toBeNull();
  return c;
}
const events = (c: CameraController) => {
  const seen: string[] = [];
  c.character.onEvent = (kind) => seen.push(kind);
  return seen;
};
/** steps of 1/120 s until the condition holds (at most n): how many it took */
const until = (c: CameraController, f: () => boolean, n = 2400) => {
  for (let i = 0; i < n; i++) {
    if (f()) return i;
    c.character.step(1 / 120, 0, null);
  }
  throw new Error("never");
};

test("the tuning constants are a game's: a short buffer and coyote time, steering in the air a fraction of the ground's", () => {
  expect(JUMP_BUFFER_S).toBeGreaterThan(0.08);
  expect(JUMP_BUFFER_S).toBeLessThan(0.25);
  expect(COYOTE_S).toBeGreaterThan(0.06);
  expect(COYOTE_S).toBeLessThan(0.2);
  expect(AIR_RESPONSE / GROUND_RESPONSE).toBeLessThan(0.3);
});

test("a jump asked just before landing is made on landing; one asked too early is dropped", () => {
  for (const [lead, again] of [
    [0.08, true],
    [0.4, false],
  ] as const) {
    const c = walker("earth");
    const seen = events(c);
    c.character.jump();
    c.character.step(1 / 120, 0, null);
    expect(c.character.vertical).toBeGreaterThan(0);
    // (falling, `lead` seconds from the ground: v·t + g t²/2 above it)
    const g = 9.8;
    until(c, () => c.character.vertical < 0 && c.character.height() < -c.character.vertical * lead + 0.5 * g * lead * lead);
    c.character.jump();
    until(c, () => c.character.grounded);
    for (let i = 0; i < 6; i++) c.character.step(1 / 120, 0, null);
    expect(seen.filter((k) => k === "jump").length).toBe(again ? 2 : 1);
  }
});

test("walking off a ledge, a jump is still made for a moment (coyote time), not after", () => {
  for (const [after, jumps] of [
    [0.04, true],
    [0.3, false],
  ] as const) {
    const c = walker("earth");
    const start = [...c.character.q] as Vec3;
    const up = c.character.up();
    const forward = c.character.forward;
    // (a platform a metre high under the start, 2 m long ahead: its top is the support, as the OSM contact gives it)
    c.character.contact = () =>
      ({
        at: (q: Vec3, _r = 0.3, _h = 1.8, step = 0.25) => {
          const along = dot(sub(q, start), forward);
          const top = 1 - c.character.rawHeight(q);
          return { blocked: false, support: along < 2 && top <= step && top >= -2 ? top : -Infinity };
        },
        grass: () => false,
      }) as unknown as SceneryContact;
    c.character.q = add(start, up, 1.012);
    c.character.move(1, 0, 10);
    until(c, () => !c.character.grounded);
    const left = c.character.q;
    for (let i = 0; i < Math.round(after * 120); i++) c.character.step(1 / 120, 0, null);
    c.character.jump();
    c.character.step(1 / 120, 0, null);
    expect(c.character.vertical > 0).toBe(jumps);
    expect(dot(sub(left, start), forward)).toBeGreaterThan(1.9);
  }
});

test("in the air the momentum is kept: a turn asked mid-jump steers a little, on the ground it is taken at once", () => {
  const sideways = (air: boolean) => {
    const c = walker("moon");
    if (air) {
      c.character.jump();
      c.character.step(1 / 120, 0, null);
    }
    c.character.move(0, 1, 1);
    for (let i = 0; i < 36; i++) c.character.step(1 / 120, 0, null);
    return len(c.character.velocity);
  };
  const ground = sideways(false),
    air = sideways(true);
  expect(ground).toBeGreaterThan(1.3);
  expect(air).toBeLessThan(ground * 0.6);
  expect(air).toBeGreaterThan(0.1);
});

test("a jump in place does not walk: the gait's speed is along the ground; landing the legs give, then stand", () => {
  const c = walker("earth");
  c.character.jump();
  let fastest = 0,
    deepest = 0;
  for (let i = 0; i < 240; i++) {
    c.character.step(1 / 120, 0, null);
    fastest = Math.max(fastest, c.character.speed);
    const frame = c.character.frame();
    if (frame) deepest = Math.min(deepest, frame.dip);
  }
  expect(fastest).toBeLessThan(0.05);
  expect(c.character.grounded).toBe(true);
  // (a 3.6 m/s landing: a few centimetres, at most 15)
  expect(deepest).toBeLessThan(-0.02);
  expect(deepest).toBeGreaterThanOrEqual(-0.15);
  for (let i = 0; i < 120; i++) c.character.step(1 / 120, 0, null);
  expect(Math.abs(c.character.frame()!.dip)).toBeLessThan(0.002);
  expect(c.character.state().airborneS).toBe(0);
});

test("the vessel's box: placed by its origin and axes, distances, a capsule against it, a point pushed out", () => {
  const axes: [Vec3, Vec3, Vec3] = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ];
  const h = placeHull([10, 0, 0], axes, [-4, -1, -7], [4, 3, 7]);
  expect(h.centre).toEqual([10, 0, 1]);
  expect(h.half).toEqual([4, 2, 7]);
  expect(hullDistance(h, [10, 0, 1])).toBe(0);
  expect(hullDistance(h, [10, 6, 1])).toBeCloseTo(2, 9);
  expect(hullDistance(h, [20, 6, 1])).toBeCloseTo(Math.hypot(3, 2), 9);
  // (standing 0.2 m beside its side: the capsule's 0.3 m radius meets it; 0.4 m: clear)
  expect(capsuleInHull(h, [10, 4.2, -1], [0, 0, 1])).toBe(true);
  expect(capsuleInHull(h, [10, 4.4, -1], [0, 0, 1])).toBe(false);
  // (over it: clear; under its belly: in it)
  expect(capsuleInHull(h, [10, 0, 3.4], [0, 0, 1])).toBe(false);
  expect(capsuleInHull(h, [10, 0, -2.5], [0, 0, 1])).toBe(true);
  const out = outOfHull(h, [10, 1, 0], [0, 1, 0], 0.6);
  expect(hullDistance(h, out)).toBeGreaterThanOrEqual(0.6);
  expect(out[1]).toBeLessThan(5.9);
  expect(outOfHull(h, [10, 9, 0], [0, 1, 0])).toEqual([10, 9, 0]);
});

test("the landed vessel's hull stops the walk and the camera; the exits stand clear of it", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  // (a box as the Ranger's: 8.3 m span, 14.8 m long, gear to the ground)
  c.character.hullBounds = () => ({ lo: [-4.15, -2.6, -7.4], hi: [4.15, 2.2, 7.4] });
  expect(c.character.disembark()).toBeNull();
  const hull = c.character.vesselHull()!;
  expect(hull).not.toBeNull();
  const up = c.character.up();
  expect(capsuleInHull(hull, c.character.q, up)).toBe(false);
  expect(hullDistance(hull, add(c.character.q, up, 0.9))).toBeGreaterThan(0.3);
  // (towards the hull's centre, ten seconds of walking: stopped against it, never in it)
  const towards = tangent(up, sub(hull.centre, c.character.q));
  (c.character as unknown as { heading: Vec3 }).heading = towards;
  c.character.yaw = 0;
  const before = hullDistance(hull, add(c.character.q, up, 0.9));
  c.character.move(1, 0, 10);
  let closest = Infinity;
  for (let i = 0; i < 1200; i++) {
    c.character.step(1 / 120, 0, null);
    expect(capsuleInHull(hull, c.character.q, c.character.up())).toBe(false);
    closest = Math.min(closest, hullDistance(hull, add(c.character.q, c.character.up(), 0.9)));
  }
  expect(closest).toBeLessThan(Math.min(before, 1.2));
  expect(closest).toBeGreaterThanOrEqual(0.29);
  expect(c.character.state().hull!.distanceM).toBeGreaterThan(0.29);
  // (the camera, behind the astronaut facing the hull, outside it too)
  c.character.yaw = Math.PI;
  for (let i = 0; i < 120; i++) c.character.step(1 / 120, 0, null);
  const frame = c.character.frame()!;
  expect(frame.origin.every(Number.isFinite)).toBe(true);
  // (a hatch estimated inside a wider craft: pushed out of its box)
  c.character.hullBounds = () => ({ lo: [-14, -2.6, -7.4], hi: [14, 2.2, 7.4] });
  c.character.stop();
  expect(c.character.disembark()).toBeNull();
  const wide = c.character.vesselHull()!;
  expect(capsuleInHull(wide, c.character.q, c.character.up())).toBe(false);
  expect(unit(sub(c.character.q, wide.centre)).every(Number.isFinite)).toBe(true);
});

test("the vessel's box stands on the vessel's own origin (not the pilot's eye), whatever the mount", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  c.character.hullBounds = () => ({ lo: [-2, -1, -3], hi: [2, 1, 3] });
  expect(c.character.disembark()).toBeNull();
  const w = c.rigWorld()!;
  const origin = scale(toBodyFixed("moon", w.X, c.nowTime()), M_METRES);
  for (const mount of ["cockpit", "chase"] as const) {
    c.s.shipMount = mount;
    const h = c.character.vesselHull()!;
    expect(len(sub(h.centre, origin))).toBeLessThan(0.01);
  }
});

test("a jump leaves the ground at any launch speed, and running up a slope", () => {
  setSceneTime(0);
  const s = defaultSettings();
  s.jumpSpeed = 1;
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  expect(c.character.start("earth", 0, 0)).toBeNull();
  c.character.jump();
  let top = 0;
  for (let i = 0; i < 60; i++) {
    c.character.step(1 / 120, 0, null);
    top = Math.max(top, c.character.height());
  }
  // (1 m/s on the Earth: v²/2g ≈ 5 cm)
  expect(top).toBeGreaterThan(0.04);
  // (running up a 40° slope: the ground rising under the feet does not cancel the take-off)
  const r = walker("earth");
  const up = r.character.up();
  r.character.rawHeight = (p: Vec3) =>
    dot(sub(p, r.character.q), up) - Math.tan((40 * Math.PI) / 180) * dot(sub(p, r.character.q), r.character.forward);
  r.character.groundPatch.clear();
  const seen = events(r);
  r.character.move(1, 0, 2, true);
  for (let i = 0; i < 24; i++) r.character.step(1 / 120, 0, null);
  r.character.jump();
  for (let i = 0; i < 6; i++) r.character.step(1 / 120, 0, null);
  expect(seen.filter((k) => k === "jump").length).toBe(1);
  expect(r.character.vertical).toBeGreaterThan(0);
});

test("he stands on the vessel's back: landed there, grounded, jumping off again", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  c.character.hullBounds = () => ({ lo: [-4, -0.5, -6], hi: [4, 1.5, 6] });
  expect(c.character.disembark()).toBeNull();
  const h = c.character.vesselHull()!;
  const up = c.character.up();
  // (above the box's middle, half a metre over its top)
  const top = add(h.centre, h.axes[1], h.half[1]);
  c.character.q = add(top, up, 0.5);
  c.character.grounded = false;
  const seen = events(c);
  for (let i = 0; i < 240; i++) c.character.step(1 / 120, 0, null);
  expect(c.character.grounded).toBe(true);
  expect(seen).toContain("landed");
  expect(Math.abs(dot(sub(c.character.q, top), up) - 0.012)).toBeLessThan(0.03);
  c.character.jump();
  for (let i = 0; i < 6; i++) c.character.step(1 / 120, 0, null);
  expect(c.character.vertical).toBeGreaterThan(0);
});

test("a save restored standing on the vessel's back: there again, on it, no landing", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  c.character.hullBounds = () => ({ lo: [-4, -0.5, -6], hi: [4, 1.5, 6] });
  expect(c.character.disembark()).toBeNull();
  const h = c.character.vesselHull()!;
  const up = c.character.up();
  const top = add(h.centre, h.axes[1], h.half[1]);
  c.character.q = add(top, up, 0.3);
  c.character.grounded = false;
  for (let i = 0; i < 240; i++) c.character.step(1 / 120, 0, null);
  expect(c.character.grounded).toBe(true);
  const saved = c.character.snapshot()!;
  c.s.animate = false;
  c.character.stop();
  const seen = events(c);
  expect(c.character.restore(saved)).toBeNull();
  // (where it was saved — not the ground under the vessel, not refused as blocked —, standing, the pause kept)
  expect(len(sub(c.character.q, saved.q))).toBeLessThan(1e-9);
  expect(c.character.grounded).toBe(true);
  expect(c.s.animate).toBe(false);
  for (let i = 0; i < 60; i++) c.character.step(1 / 120, 0, null);
  expect(seen).not.toContain("landed");
  expect(seen).not.toContain("disembarked");
  expect(Math.abs(dot(sub(c.character.q, top), up) - 0.012)).toBeLessThan(0.03);
});

test("pushed against the hull the legs stop: the stride follows the ground covered", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  c.character.hullBounds = () => ({ lo: [-4.15, -2.6, -7.4], hi: [4.15, 2.2, 7.4] });
  expect(c.character.disembark()).toBeNull();
  const hull = c.character.vesselHull()!;
  (c.character as unknown as { heading: Vec3 }).heading = tangent(c.character.up(), sub(hull.centre, c.character.q));
  c.character.yaw = 0;
  c.character.move(1, 0, 10);
  for (let i = 0; i < 600; i++) c.character.step(1 / 120, 0, null);
  // (against it now: a second more of pushing)
  const phase = c.character.phase;
  for (let i = 0; i < 120; i++) c.character.step(1 / 120, 0, null);
  expect(c.character.phase - phase).toBeLessThan(0.5);
});
