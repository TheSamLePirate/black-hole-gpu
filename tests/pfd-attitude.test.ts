import { test, expect } from "bun:test";
import { pfdAttitude } from "../src/ui/cockpitscreens";

// The ship's axes: x left, y up, z nose. Banked right by φ (the right wing low, the left one high), the
// local up has the left axis's sine: up = (sin φ, cos φ, 0).
const D = Math.PI / 180;

/** Where the HUD's attitude ball puts the sky: its pixel (u right, v up) looks along (−u, v, ·). */
const ballSkyRight = (up: number[]) => {
  // the horizon's slope on the ball: −u·up.x + v·up.y = 0 → v = u·up.x / up.y (> 0: its right end up)
  return up[0]! / up[1]!;
};
/** The PFD's horizon turned by −roll on the canvas (y down): its slope (y up) is tan(roll). */
const pfdSlope = (roll: number) => Math.tan(roll);

test("banked right: positive roll, the horizon's right end up — as on the attitude ball", () => {
  const up = [Math.sin(30 * D), Math.cos(30 * D), 0];
  const { roll, pitch } = pfdAttitude(up);
  expect(roll / D).toBeCloseTo(30, 6);
  expect(pitch).toBeCloseTo(0, 9);
  expect(Math.sign(pfdSlope(roll))).toBe(Math.sign(ballSkyRight(up)));
  expect(pfdSlope(roll)).toBeCloseTo(ballSkyRight(up), 9);
});

test("banked left: negative roll, the same horizon as the ball", () => {
  const up = [-Math.sin(56.7 * D), Math.cos(56.7 * D), 0];
  const { roll } = pfdAttitude(up);
  expect(roll / D).toBeCloseTo(-56.7, 6);
  expect(pfdSlope(roll)).toBeCloseTo(ballSkyRight(up), 9);
});

test("nose up: positive pitch (the nose's axis has the local up's sine)", () => {
  // nose up by θ: the nose points θ above the horizon, so up · nose = sin θ
  const up = [0, Math.cos(13.2 * D), Math.sin(13.2 * D)];
  const { pitch } = pfdAttitude(up);
  expect(pitch / D).toBeCloseTo(13.2, 6);
});
