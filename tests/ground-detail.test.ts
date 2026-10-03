import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { craterRelief } from "../src/terrain";
import { gearHeight } from "../src/system/our-surface";
import { bodyView } from "../src/system/our-side";
import { theirGroundPose } from "../src/game/place";
import { groundR, planetFrame, toLocal, GEAR } from "../src/landing";
import { betaToCoord } from "../src/landing";

// The airless worlds' finer ground (craters down to metres: the tracer's, the gear on it) and the
// ground poses on Gargantua's worlds.

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

test("craters: bowls and rims of every size, the same heights at any footprint finer than them", () => {
  const mR = 1.7374e6;
  let lo = 0, hi = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const q = unit([Math.cos(i * 0.001), Math.sin(i * 0.001), 0.3]);
    const h = craterRelief(1, q, mR);
    expect(Number.isFinite(h)).toBe(true);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    if (Math.abs(h - craterRelief(1, q, mR, 0.3)) < 1e-9) n++;
  }
  expect(lo).toBeLessThan(-5);
  expect(hi).toBeLessThan(500); // (the tracer's reliefMax for them)
  expect(n).toBe(4000);
});

test("on the Moon's ground: the gear on the craters' ground", () => {
  const t = 109.6;
  const v = bodyView(t, { body: "moon", at: [20, 0], sunEl: 18 });
  expect(v.landed?.body).toBe("moon");
  expect(Math.abs(gearHeight("moon", v.X, t))).toBeLessThan(1e-3);
});

test("on Gargantua's worlds: at rest on the ground, Gargantua at the asked height", () => {
  const t = 109.6, a = 0.998, M = 1e8;
  for (const [id, el] of [["miller", 25], ["mann", 15], ["edmunds", 3]] as const) {
    const p = theirGroundPose(id, el, 0, t, a, M);
    const F = planetFrame(id, t, a, M);
    const L = toLocal(F, p.X, betaToCoord(p.X, zamoOf(p.X, p.vel), a));
    const r = Math.hypot(...L.xi);
    expect(Math.abs((r - groundR(F, L.xi)) * F.mPerM - GEAR)).toBeLessThan(1);
    expect(Math.hypot(...L.w) * 299792458).toBeLessThan(1); // (at rest on it: < 1 m/s)
    // (in the world's proper axes: x away from its primary, y along its orbit, z north)
    const ex = unit([F.C[0] - F.H[0], F.C[1] - F.H[1], 0]), ey: Vec3 = [-ex[1], ex[0], 0];
    const g0 = unit([-F.C[0], -F.C[1], -F.C[2]]);
    const up = unit(L.xi), g = unit([dot(g0, ex) * F.S[0], dot(g0, ey) * F.S[1], g0[2] * F.S[2]]);
    expect(Math.abs((Math.asin(dot(up, g)) * 180) / Math.PI - el)).toBeLessThan(0.5);
  }
});

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// (the pose's velocity: β along the ZAMO axes as a map vector — back to its r̂ θ̂ φ̂ components)
import { sphericalFrame } from "../src/wormhole";
function zamoOf(X: Vec3, v: Vec3): Vec3 {
  const f = sphericalFrame(X);
  return [dot(v, f.er), dot(v, f.et), dot(v, f.ep)];
}
