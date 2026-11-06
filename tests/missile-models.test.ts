import { expect, test } from "bun:test";
import { airDensity, finCommand, MISSILE_MESH, MISSILE_SHAPES, missileAxes } from "../src/game/missile-models";

// The missiles drawn (src/game/missile-models.ts): their axes from the velocity and the guidance's command, their four control
// fins' deflections — opposite fins together for a pitch or a yaw, clamped to their throw, nil without a command.

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("axes: the nose along the velocity, leading it into the turn; the top the world's up off the nose", () => {
  const [left, up, nose] = missileAxes([1000, 0, 0], undefined);
  expect(nose[0]).toBeCloseTo(1, 6);
  expect(up[2]).toBeCloseTo(1, 6);
  expect(Math.abs(dot(left, up))).toBeLessThan(1e-9);
  // (a 20 g pull up: the nose 5° above the velocity)
  const [, , n2] = missileAxes([1000, 0, 0], [0, 0, 20 * 9.81]);
  expect((Math.atan2(n2[2], n2[0]) * 180) / Math.PI).toBeCloseTo(5, 1);
  // (straight up: still an orthonormal frame)
  const [l3, u3, f3] = missileAxes([0, 0, 500], undefined);
  expect(Math.abs(dot(l3, f3)) + Math.abs(dot(u3, f3))).toBeLessThan(1e-9);
});

test("fins: a pull up turns the X's fins by pairs, clamped to their throw; none without a command", () => {
  const S = MISSILE_SHAPES["msl-aim120"];
  const axes = missileAxes([900, 0, 0], undefined);
  const rho = airDensity(4500);
  const none = finCommand(S, axes, undefined, 900, rho, 0);
  for (const f of none) expect(Math.abs(f)).toBeLessThan(0.03);
  const up = finCommand(S, axes, [0, 0, 15 * 9.81], 900, rho, 0);
  // (an X — fins at 45°, 135°, 225°, 315° —: a pitch turns 0 with 3 and 1 with 2, the two pairs opposite; the trim aside)
  expect(Math.abs(up[0]!)).toBeGreaterThan(0.05);
  expect(up[0]!).toBeCloseTo(up[3]!, 6);
  expect(up[1]!).toBeCloseTo(up[2]!, 6);
  expect(up[0]! * up[1]!).toBeLessThan(0);
  const hard = finCommand(S, axes, [0, 0, 80 * 9.81], 300, airDensity(10000), 0);
  for (const f of hard) expect(Math.abs(f)).toBeLessThanOrEqual(S.finMax + 1e-9);
});

test("every missile kind has its mesh and shape", () => {
  for (const id of Object.values(MISSILE_MESH)) expect(MISSILE_SHAPES[id]).toBeDefined();
});
