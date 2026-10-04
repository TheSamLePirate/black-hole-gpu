import { expect, test } from "bun:test";
import { ourMouthPose, ourNearPose, theirMouthPose } from "../src/game/place";
import { defaultSettings, presets } from "../src/settings";
import { M_METRES, SOLAR_BODIES, solarState } from "../src/system/solar";
import { soiOf } from "../src/system/our-side";
import { mouth } from "../src/wormhole";

// Beside a body and before the wormhole (src/game/place.ts): where the ship is put, at rest against
// what it is put beside, nose on it.

const t = 109.6;
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
const len = (a: number[]) => Math.hypot(...a);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

test("beside a body: two radii above it by default (within its sphere of influence), at rest against it, nose on it", () => {
  for (const id of ["earth", "moon", "mars", "jupiter", "phobos", "sun"]) {
    const b = SOLAR_BODIES.find((q) => q.id === id)!;
    const p = ourNearPose(id, t);
    const B = solarState(id, t);
    const r = sub(p.X, B.pos);
    const want = Math.min(3 * b.radius, 0.7 * soiOf(id, t));
    expect(len(r) / want).toBeCloseTo(1, 6);
    expect(len(sub(p.vel, B.vel))).toBeLessThan(1e-15);
    expect(dot(p.fwd, r) / len(r)).toBeCloseTo(-1, 9);
    expect(Math.abs(dot(p.fwd, p.up))).toBeLessThan(1e-9);
  }
  // (a height asked: kept)
  const p = ourNearPose("earth", t, 1000);
  const E = SOLAR_BODIES.find((q) => q.id === "earth")!;
  expect((len(sub(p.X, solarState("earth", t).pos)) - E.radius) * M_METRES).toBeCloseTo(1e6, 0);
});

test("before the wormhole: four throat radii from either mouth, at rest, nose on it", () => {
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"] };
  const rho = mouth(s, t).w.rho;
  const o = ourMouthPose(s, t);
  expect(o.frame).toBe("ours");
  expect(len(o.X) / (4 * rho)).toBeCloseTo(1, 12);
  expect(dot(o.fwd, o.X) / len(o.X)).toBeCloseTo(-1, 12);
  expect(len(o.vel)).toBe(0);
  const g = theirMouthPose(s, t);
  expect(g.frame).toBe("mouth");
  expect(len(g.X) / (4 * rho)).toBeCloseTo(1, 12);
  // (on the side away from the hole — the mouth's x points at it —, looking at the mouth and the hole beyond)
  expect(g.X[0]).toBeLessThan(0);
  expect(g.fwd).toEqual([1, 0, 0]);
});
