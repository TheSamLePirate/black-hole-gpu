import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { earthGround } from "../src/system/our-side";
import {
  dragAccel,
  fromBodyFixed,
  gearHeight,
  groundRelief,
  groundSpeeds,
  groundVelocity,
  setGroundHeights,
  toBodyFixed,
} from "../src/system/our-surface";
import { M_METRES, M_SECONDS, solarState } from "../src/system/solar";
import { mapHeightSampler } from "../src/terrain";

// Our universe's grounds: a ship resting at the Kennedy Space Center turns with the Earth, the air
// drags it, and the body's own coordinates carry it without drift.

const C = 299792458;
const t0 = 109.6; // 2067-01-01 15:00 UTC (the game's start)

test("on the pad: the gear on the ground, moving with it (408 m/s eastwards at 28.6° N)", () => {
  const g = earthGround(t0);
  expect(Math.abs(gearHeight("earth", g.X, t0))).toBeLessThan(1e-3);
  const sp = groundSpeeds("earth", g.X, g.vel, t0);
  expect(Math.abs(sp.vv) + sp.vh).toBeLessThan(1e-6);
  const E = solarState("earth", t0).vel;
  const vRot = Math.hypot(...g.vel.map((v, i) => v - E[i]!)) * C;
  expect(vRot).toBeGreaterThan(400);
  expect(vRot).toBeLessThan(415);
  // (the nose east: along the ground's turning)
  const dv = g.vel.map((v, i) => v - E[i]!) as Vec3;
  expect(g.fwd[0] * dv[0] + g.fwd[1] * dv[1] + g.fwd[2] * dv[2]).toBeGreaterThan(0.999 * Math.hypot(...dv));
});

test("the body's own coordinates: a place kept over an hour, the ground velocity their rate", () => {
  const g = earthGround(t0);
  const q = toBodyFixed("earth", g.X, t0);
  expect(Math.hypot(...q.map((x, i) => x - g.landed.q[i]!)) * M_METRES).toBeLessThan(1e-3);
  const t1 = t0 + 3600 / M_SECONDS;
  expect(Math.abs(gearHeight("earth", fromBodyFixed("earth", q, t1), t1))).toBeLessThan(1e-3);
  // (a finite difference of the carried place over ±1 min: the ground's velocity, to 5 mm/s — the
  // scene's days carry the time to ~0.3 µs)
  const h = 60 / M_SECONDS;
  const a = fromBodyFixed("earth", q, t0 - h),
    b = fromBodyFixed("earth", q, t0 + h);
  const fd = a.map((x, i) => (b[i]! - x) / (2 * h)) as Vec3;
  const gv = groundVelocity("earth", g.X, t0);
  expect(Math.hypot(...fd.map((x, i) => x - gv[i]!)) * C).toBeLessThan(5e-3);
});

test("the air's drag: ½ ρ v² / B against the motion through the air, the thermosphere's above it", () => {
  const g = earthGround(t0);
  const up = groundSpeeds("earth", g.X, g.vel, t0).up;
  // 100 m/s straight up, at the pad: 0.5 · 1.225 · 100² / 900 ≈ 6.8 m/s², downwards
  const V = g.vel.map((v, i) => v + (100 / C) * up[i]!) as Vec3;
  const a = dragAccel("earth", g.X, V, t0);
  const aM = ((a[0] * up[0] + a[1] * up[1] + a[2] * up[2]) * (C * C)) / M_METRES;
  expect(aM).toBeCloseTo(-(0.5 * 1.225 * 100 * 100) / 900, 1);
  const high = g.X.map((x, i) => x + (400e3 / M_METRES) * up[i]!) as Vec3;
  // (above the flight's air, the thermosphere's drag only: billions of times less)
  const thin = Math.hypot(...dragAccel("earth", high, V, t0));
  expect(thin).toBeGreaterThan(0);
  expect(thin).toBeLessThan(1e-9 * Math.hypot(...a));
});

test("the ephemeris' velocities: the rate of its places (the Moon's turning node and perigee too)", () => {
  const h = 60 / M_SECONDS;
  for (const id of ["earth", "moon", "sun", "saturn", "jupiter", "titan"]) {
    const a = solarState(id, t0 - h).pos,
      b = solarState(id, t0 + h).pos,
      v = solarState(id, t0).vel;
    const err = Math.hypot(...a.map((x, i) => (b[i]! - x) / (2 * h) - v[i]!)) * C;
    expect(err).toBeLessThan(0.02);
  }
});

test("a world's measured heights under its craters: the ground the gear stands on, while they are drawn", () => {
  // (a map rising 1 m per texel eastwards from the date line, 2 048 m at 0° east: the B-spline exact on
  // a linear ramp, half floats whole metres below 2 048)
  const W = 64,
    H = 32;
  const map = new Int16Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) map[j * W + i] = 1000 + 30 * i;
  const dem = mapHeightSampler(map, W, H);
  const q: Vec3 = [Math.cos(0.3), Math.sin(0.3), 0];
  // (0.3 rad east: texel 0.5 + 0.3/2π of 64, less half a texel)
  const x = (0.5 + 0.3 / (2 * Math.PI)) * W - 0.5;
  expect(dem(q)).toBeCloseTo(1000 + 30 * x, 6);
  const craters = groundRelief("moon", q);
  setGroundHeights("moon", dem);
  expect(groundRelief("moon", q)).toBeCloseTo(craters + dem(q), 9);
  setGroundHeights("moon", null);
  expect(groundRelief("moon", q)).toBe(craters);
  // (a world without craters of its own: the heights alone, then none)
  setGroundHeights("mars", dem);
  expect(groundRelief("mars", q)).toBeCloseTo(dem(q), 9);
  setGroundHeights("mars", null);
  expect(groundRelief("mars", q)).toBe(0);
});
