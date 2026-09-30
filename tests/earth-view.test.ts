import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { bodyView, earthView, ourState } from "../src/system/our-side";
import { gearHeight } from "../src/system/our-surface";
import { presets } from "../src/settings";

// The Earth's scenes' placements: on the ground, the ship level on its gear, its nose under the body
// it looks at; in orbit, its nose on it (the north up when it looks straight down).

const t0 = 109.6;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

test("on the ground: on the gear, level, the nose under the Moon", () => {
  const v = earthView(t0, { at: [-25.34, 131.03], look: "moon" });
  expect(v.landed?.body).toBe("earth");
  expect(Math.abs(gearHeight("earth", v.X, t0))).toBeLessThan(1e-3);
  expect(Math.abs(dot(v.fwd, v.up))).toBeLessThan(1e-9);
  const M = ourState("moon", t0).pos;
  const d = unit([M[0] - v.X[0], M[1] - v.X[1], M[2] - v.X[2]]);
  const h = unit([d[0] - v.up[0] * dot(d, v.up), d[1] - v.up[1] * dot(d, v.up), d[2] - v.up[2] * dot(d, v.up)]);
  expect(dot(h, v.fwd)).toBeGreaterThan(0.999999);
});

test("in orbit: the nose on the Earth's centre, the north up, a circular speed", () => {
  const v = earthView(t0, { at: [-10, -40], altKm: 15000, look: "earth" });
  const E = ourState("earth", t0);
  const r: Vec3 = [v.X[0] - E.pos[0], v.X[1] - E.pos[1], v.X[2] - E.pos[2]];
  expect(dot(v.fwd, unit(r))).toBeLessThan(-0.999999);
  expect(Math.abs(dot(v.fwd, v.up))).toBeLessThan(1e-9);
  // (the up: towards the north pole's side)
  expect(v.landed).toBeUndefined();
  const rel: Vec3 = [v.vel[0] - E.vel[0], v.vel[1] - E.vel[1], v.vel[2] - E.vel[2]];
  expect(Math.abs(dot(unit(rel), unit(r)))).toBeLessThan(1e-9);
});

test("the Earth's scenes all place the camera", () => {
  const names = Object.keys(presets).filter((n) => n.startsWith("Earth:"));
  expect(names.length).toBe(13);
  for (const n of names) {
    const p = presets[n]!;
    expect(typeof p.pose).toBe("object");
    const v = earthView(p.time!, p.pose as Parameters<typeof earthView>[1]);
    expect(v.X.every(Number.isFinite)).toBe(true);
  }
});

// Any of our worlds: an orbit placed by its phase (the angle at the body from the Sun to the camera),
// a place on the ground by the Sun's height there, the ship tilted off the body (its back to it)
test("other worlds: the phase, the Sun's height, the tilt", () => {
  const deg = 180 / Math.PI;
  for (const [body, phase] of [["mars", 35], ["moon", 80], ["saturn", 150]] as const) {
    const v = bodyView(t0, { body, altKm: 5000, phase, look: body });
    const B = ourState(body, t0).pos, S = ourState("sun", t0).pos;
    const c = unit([v.X[0] - B[0], v.X[1] - B[1], v.X[2] - B[2]]), s = unit([S[0] - B[0], S[1] - B[1], S[2] - B[2]]);
    expect(Math.abs(Math.acos(dot(c, s)) * deg - phase)).toBeLessThan(0.5);
  }
  const g = bodyView(t0, { body: "mars", at: [-4.6, 0], sunEl: 2, look: "sun" });
  expect(g.landed?.body).toBe("mars");
  const S = ourState("sun", t0).pos;
  const el = Math.asin(dot(g.up, unit([S[0] - g.X[0], S[1] - g.X[1], S[2] - g.X[2]]))) * deg;
  expect(Math.abs(el - 2)).toBeLessThan(0.5);
  // tilted 60°: the body 60° above the nose, the ship's axes orthonormal
  const t = bodyView(t0, { body: "jupiter", altKm: 200000, phase: 30, look: "jupiter", tilt: 60 });
  const J = ourState("jupiter", t0).pos;
  const d = unit([J[0] - t.X[0], J[1] - t.X[1], J[2] - t.X[2]]);
  expect(Math.abs(dot(d, t.fwd) - 0.5)).toBeLessThan(1e-6);
  expect(dot(d, t.up)).toBeGreaterThan(0.866 - 1e-6);
  expect(Math.abs(dot(t.fwd, t.up))).toBeLessThan(1e-9);
});

test("every world's scene has its gallery entry", async () => {
  const { PRESET_INFO } = await import("../src/ui/schema");
  const worlds = Object.keys(presets).filter((n) => typeof presets[n]!.pose === "object");
  expect(worlds.length).toBe(13 + 27);
  for (const n of worlds) expect(PRESET_INFO[n]?.group).toBeDefined();
});
