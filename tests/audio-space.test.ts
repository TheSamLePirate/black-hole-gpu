import { expect, test } from "bun:test";
import { airCutoff, centroid, doppler, hearing, shipSource, soundSpeed } from "../src/audio/space";
import { shipToCamera } from "../src/mounts";
import { VESSELS } from "../src/vessels";

// PLAN-AUDIO S1: the sound's space — where the ship's sources are from the ear, how the views hear it.

const nozzle = centroid(VESSELS.ranger.jets.filter((j) => j.main).map((j) => j.p));

test("the cockpit and the cabin hear the ship from inside (the audit's § 12), the hull's mounts through it", () => {
  expect(hearing("cockpit")).toBe("cabin");
  expect(hearing("cabin")).toBe("cabin");
  expect(hearing("dorsal")).toBe("hull");
  expect(hearing("rear")).toBe("hull");
  expect(hearing("chase")).toBe("outside");
  expect(hearing("free")).toBe("outside");
  expect(hearing("cockpit", true)).toBe("outside");
});

test("the engine placed: behind the pilot, ahead of and below the chase camera", () => {
  // (the listener faces −z: behind is +z)
  const fromSeat = shipSource(shipToCamera("cockpit"), nozzle);
  expect(fromSeat[2]).toBeGreaterThan(5);
  const fromChase = shipSource(shipToCamera("chase"), nozzle);
  expect(fromChase[2]).toBeLessThan(0);
  expect(fromChase[1]).toBeLessThan(0);
  expect(Math.abs(fromChase[0])).toBeLessThan(0.5);
});

test("left is left: a point on the ship's left (+x) is on the pilot's left (−x in the listener's frame)", () => {
  const seat = shipToCamera("cockpit");
  const left = shipSource(seat, [5, 1.4, 3]);
  const right = shipSource(seat, [-5, 1.4, 3]);
  expect(left[0]).toBeLessThan(-3);
  expect(right[0]).toBeGreaterThan(3);
});

test("the Doppler: higher approaching, lower receding, none in vacuum or at rest", () => {
  const c = soundSpeed(1);
  expect(c).toBeGreaterThan(330);
  expect(c).toBeLessThan(350);
  expect(doppler(-34, c)).toBeCloseTo(c / (c - 34), 6);
  expect(doppler(-34, c)).toBeGreaterThan(1.1);
  expect(doppler(34, c)).toBeLessThan(0.92);
  expect(doppler(0, c)).toBe(1);
  expect(doppler(-100, soundSpeed(0))).toBe(1);
  // (held within an octave: a supersonic pass is the bang's)
  expect(doppler(-1000, c)).toBe(2);
});

test("the air's absorption: the high frequencies lost with the distance, none in vacuum", () => {
  expect(airCutoff(10, 1)).toBeGreaterThan(19000);
  expect(airCutoff(1000, 1)).toBeLessThan(5000);
  expect(airCutoff(1000, 1)).toBeGreaterThan(3000);
  expect(airCutoff(3000, 1)).toBeLessThan(airCutoff(1000, 1));
  expect(airCutoff(3000, 0)).toBe(20000);
});
