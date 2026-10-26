import { describe, expect, test } from "bun:test";
import { CamShake, shownAt } from "../src/camshake";

// The camera shake kept to what the frames can show (docs/progress/JITTER-VOL.md): a band past the frame rate's Nyquist
// folds back to a slower, erratic shiver — the engine's 31 Hz hum at 25 frames a second read as a 6 Hz tremble.

const rms = (fps: number, inp: Partial<Parameters<CamShake["step"]>[0]>) => {
  const S = new CamShake();
  let s = 0;
  const n = fps * 4;
  for (let k = 0; k < n; k++) {
    const o = S.step({ dt: 1 / fps, roll: 0, buffet: 0, transonic: 0, ab: 0, engine: 0, jolt: 0, ...inp });
    if (k > fps) s += o.pitch ** 2 + o.yaw ** 2 + o.roll ** 2;
  }
  return Math.sqrt(s / (n - fps));
};

describe("the camera shake under the frame rate", () => {
  test("what the frames show of a frequency", () => {
    expect(shownAt(5, 25)).toBe(1);
    expect(shownAt(12, 25)).toBe(0);
    expect(shownAt(31, 60)).toBe(0);
    expect(shownAt(31, 144)).toBe(1);
  });

  test("the engine's hum: none at 25 or 60 frames a second, felt at 144", () => {
    expect(rms(25, { engine: 1 })).toBe(0);
    expect(rms(60, { engine: 1 })).toBe(0);
    expect(rms(144, { engine: 1 })).toBeGreaterThan(5e-5);
  });

  test("the buffet stays at 25 frames a second (its slow parts)", () => {
    expect(rms(25, { buffet: 1 })).toBeGreaterThan(0.5 * rms(120, { buffet: 1 }));
  });
});
