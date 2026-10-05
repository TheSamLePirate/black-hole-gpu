import { expect, test } from "bun:test";
import { IAU_ROTATION } from "../src/system/iau-data";
import { iauAngles, iauRate } from "../src/system/orientation";
import { bodyAxes, M_SECONDS, solarBody, spinVector, utcOf } from "../src/system/solar";
import { tdbOf } from "../src/system/timescale";

const DAY = 86400;
const H = 60;
/** W is unwrapped: do not reduce the angles modulo 360 before differencing. */
const numericRate = (id: string, et: number) => (iauAngles(id, et + H)!.W - iauAngles(id, et - H)!.W) / ((2 * H) / DAY);

for (const id of ["moon", "mercury"]) {
  test(`${id}: IAU rate matches W's numerical derivative across 22 years`, () => {
    let maxError = 0;
    // Negative and positive epochs around J2000, sampled every two days, including J2000.
    for (let days = -4018; days <= 4018; days += 2) {
      maxError = Math.max(maxError, Math.abs(iauRate(id, days * DAY)! - numericRate(id, days * DAY)));
    }
    expect(maxError).toBeLessThan(1e-6); // °/day; accommodates cancellation and finite-difference truncation
  });
}

test("the derivative also covers the other IAU bodies and quadratic meridian terms", () => {
  for (const id of Object.keys(IAU_ROTATION).filter((id) => id !== "moon" && id !== "mercury")) {
    let maxError = 0;
    for (let k = -20; k <= 20; k++) {
      const et = k * 182.625 * DAY;
      // Fourth-order stencil: a 60 s second-order difference truncates Phobos' fast librations.
      const near = iauAngles(id, et + H)!.W - iauAngles(id, et - H)!.W;
      const far = iauAngles(id, et + 2 * H)!.W - iauAngles(id, et - 2 * H)!.W;
      const rate = (8 * near - far) / ((12 * H) / DAY);
      maxError = Math.max(maxError, Math.abs(iauRate(id, et)! - rate));
    }
    expect(maxError, id).toBeLessThan(1e-5); // rapid moons' larger W increases subtraction noise
  }
});

test("unknown models remain null and retrograde rotation retains its sign", () => {
  expect(iauRate("unknown-body", 0)).toBeNull();
  expect(iauAngles("unknown-body", 0)).toBeNull();
  expect(iauRate("venus", 0)).toBe(-1.4813688);
});

test("time-dependent lunar and Mercury spin vectors use W's derivative in scene units", () => {
  for (const id of ["moon", "mercury"]) {
    const body = solarBody(id)!;
    for (let days = -360; days <= 360; days += 30) {
      const t = (days * DAY) / M_SECONDS; // dates around the simulation epoch in 2067
      const pole = bodyAxes(body, t)[2];
      const spin = spinVector(body, t);
      const projection = spin.reduce((sum, component, i) => sum + component * pole[i]!, 0);
      const expected = (numericRate(id, tdbOf(utcOf(t))) * Math.PI * M_SECONDS) / (180 * DAY);
      expect(Math.abs(projection / expected - 1)).toBeLessThan(1e-7);
    }
  }
});
