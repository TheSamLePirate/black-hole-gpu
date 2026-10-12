import { describe, expect, test } from "bun:test";
import { cameraInWorld, greyOut, speedFxLevel } from "../src/ui/speedfx";

describe("the speed felt", () => {
  test("none slow or in vacuum; more fast, low, with the afterburner", () => {
    expect(speedFxLevel({ speed: 40, rho: 1.2, agl: 300, boost: 1 })).toBe(0);
    expect(speedFxLevel({ speed: 300, rho: 0, agl: 300, boost: 1 })).toBe(0);
    const high = speedFxLevel({ speed: 250, rho: 0.6, agl: 8000, boost: 1 });
    const low = speedFxLevel({ speed: 250, rho: 1.2, agl: 100, boost: 1 });
    const ab = speedFxLevel({ speed: 250, rho: 1.2, agl: 100, boost: 1.5 });
    expect(high).toBeGreaterThan(0.2);
    expect(low).toBeGreaterThan(high);
    expect(ab).toBeGreaterThanOrEqual(low);
    expect(ab).toBeLessThanOrEqual(1);
  });
  test("the grey-out from 5 g, full at 9", () => {
    expect(greyOut(4)).toBe(0);
    expect(greyOut(7)).toBeCloseTo(0.5, 9);
    expect(greyOut(12)).toBe(1);
  });
  test("the camera's axes in the world: looking north level, its right is east", () => {
    const M = cameraInWorld([0, 1, 0], [0, 0, 1]);
    const near = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 12));
    near(M[0], [0, 1, 0]);
    near(M[1], [0, 0, 1]);
    near(M[2], [1, 0, 0]);
  });
});
