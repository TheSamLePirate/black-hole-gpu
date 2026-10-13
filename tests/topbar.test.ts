// The top bar's overflow (ui/topbar.ts overflowed): which actions go into the ⋯ menu when the bar is too wide.
import { expect, test } from "bun:test";
import { overflowed } from "../src/ui/topbar";

const items = (...p: number[]) => p.map((prio) => ({ w: 32, prio }));

test("everything fits: nothing goes", () => {
  expect(overflowed(400, items(1, 5, 9), 600, 36)).toEqual([false, false, false]);
});

test("too wide: the highest priority number goes first, the ⋯ button counted", () => {
  // 400 + 3 × 32 = 496 > 480: the 9 goes (464), then ⋯ (+36 = 500 > 480): the 5 goes too (432 + 36 = 468)
  expect(overflowed(400, items(1, 5, 9), 480, 36)).toEqual([false, true, true]);
});

test("among equals, the last goes first", () => {
  expect(overflowed(400, items(3, 3, 3), 470, 0)).toEqual([false, false, true]);
});

test("priority 0 never goes, even when the bar stays too wide", () => {
  expect(overflowed(1000, items(0, 0, 4), 500, 36)).toEqual([false, false, true]);
});
