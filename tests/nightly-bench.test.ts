import { expect, test } from "bun:test";
import { baseline, judge, type NightRow } from "../scripts/nightly-bench";

// The nightly bench's verdict (audit 2026-11-10, QA-12): a night's GPU p50 against the median of the last seven measured nights;
// over by more than 10 %: a regression. The witnesses: a night 20 % slower is caught, one 5 % slower and an identical one are not;
// too few nights, the nights not measured — no verdict.

const night = (gpuP50: number, ok = true): NightRow => ({ at: `${Math.random()}`, commit: "x", ok, gpuP50 });

test("the baseline: the median of the last seven measured nights; fewer than three — none", () => {
  expect(baseline([night(20), night(22)])).toBeNull();
  expect(baseline([night(20), night(30, false), night(22), night(21)])).toBe(21);
  expect(baseline([1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((v) => night(v)))).toBe(7);
});

test("the verdict: 20 % slower caught, 5 % and the same not; a night not measured — none", () => {
  const before = [20, 20.4, 19.8, 20.1, 20].map((v) => night(v));
  expect(judge(night(24), before).regressed).toBe(true);
  expect(judge(night(21), before).regressed).toBe(false);
  expect(judge(night(20), before)).toMatchObject({ regressed: false, over: 0 });
  expect(judge(night(99, false), before).regressed).toBe(false);
  expect(judge(night(99), before.slice(0, 2)).regressed).toBe(false);
});
