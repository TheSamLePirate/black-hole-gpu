// Living a capture (ui/livecapture.ts): the stack keeps the brightest; the time left.
import { expect, test } from "bun:test";
import { evenCrop, lapseFps, lighten, timeLeft } from "../src/ui/livecapture";

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

test("the time-lapse: about four seconds of growth; frames cropped to even sides", () => {
  expect(lapseFps(48)).toBe(12);
  expect(lapseFps(5)).toBe(4);
  expect(lapseFps(400)).toBe(24);
  const img = new Uint8Array(3 * 3 * 4).map((_, i) => i);
  const c = evenCrop(img, 3, 3);
  expect([c.w, c.h]).toEqual([2, 2]);
  expect([...c.data.subarray(0, 8)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect([...c.data.subarray(8, 16)]).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
  const even = new Uint8Array(4 * 2 * 4);
  expect(evenCrop(even, 4, 2).data.buffer).toBe(even.buffer);
});
