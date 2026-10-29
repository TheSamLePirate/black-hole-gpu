import { describe, expect, test } from "bun:test";
import { softHeight } from "../src/camera/speed";

// The free camera's speed law (src/camera/speed.ts, PLAN-CAMERA-AAA CAM3): the soft nearest height — the least when
// alone, continuous as another body comes nearer (no jump of speed when the nearest changes).
describe("the free camera's soft height", () => {
  test("alone, or far below the others: the least", () => {
    expect(softHeight([1000])).toBe(1000);
    expect(softHeight([1000, 1e9, 3e11])).toBeCloseTo(1000, 6);
    expect(softHeight([])).toBe(Number.POSITIVE_INFINITY);
  });
  test("continuous as the nearest changes: never faster than the heights themselves", () => {
    let pa = 1e7,
      pb = 2e7,
      prev = softHeight([pa, pb]);
    for (let k = 1; k <= 190; k++) {
      const a = 1e7 + k * 1e5, // (receding from one)
        b = 2e7 - k * 1e5; // (nearing the other)
      const h = softHeight([a, b]);
      const most = Math.max(Math.abs(a / pa - 1), Math.abs(b / pb - 1));
      expect(Math.abs(h / prev - 1)).toBeLessThanOrEqual(1.05 * most);
      prev = h;
      pa = a;
      pb = b;
    }
  });
});
