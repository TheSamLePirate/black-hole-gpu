import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { earthView, ourState } from "../src/system/our-side";
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
  expect(names.length).toBe(12);
  for (const n of names) {
    const p = presets[n]!;
    expect(typeof p.pose).toBe("object");
    const v = earthView(p.time!, p.pose as Parameters<typeof earthView>[1]);
    expect(v.X.every(Number.isFinite)).toBe(true);
  }
});
