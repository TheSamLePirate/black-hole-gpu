// Living a capture (ui/livecapture.ts): the stack keeps the brightest; the time left.
import { expect, test } from "bun:test";
import { lighten, timeLeft } from "../src/ui/livecapture";

test("the stack keeps each channel's brightest, opaque", () => {
  const s = new Uint8ClampedArray([10, 200, 30, 0, 0, 0, 0, 0]);
  lighten(s, new Uint8Array([50, 100, 30, 9, 255, 1, 2, 3]));
  expect([...s]).toEqual([50, 200, 30, 255, 255, 1, 2, 255]);
});

test("the time left from the pace so far", () => {
  expect(timeLeft(10, 40, 20)).toBe(60);
  expect(timeLeft(40, 40, 80)).toBe(0);
  expect(Number.isNaN(timeLeft(0, 40, 0))).toBe(true);
});
