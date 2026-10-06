import { expect, test } from "bun:test";
import { Renderer } from "../src/renderer";
import { tierAt } from "../src/tier";

/** A renderer's timing and accumulation state alone (no device): what the quality policy touches. */
function still() {
  const state = {
    timingGeneration: 0,
    blockMs: new Map([[2, { ms: 9, at: 0 }]]),
    recentMs: [9, 10],
    slowMs: 1,
    fastMs: 1,
    lastGpuMs: 9,
    frameStamp: 40,
    epoch: 12,
    validFrom: 30,
    frameTimes: [{ stamp: 30, time: 0 }],
    sampleIndex: 7,
    bandY: 0,
    tier: tierAt(2, "test"),
  };
  const renderer = Object.assign(Object.create(Renderer.prototype), state) as Renderer;
  return { renderer, state: renderer as unknown as typeof state };
}

test("a calibration change resets the timings, not a converging image or its temporal history (audit M1)", () => {
  const { renderer, state } = still();
  renderer.resetQualityTiming();
  expect(state.timingGeneration).toBe(1);
  expect(state.blockMs.size).toBe(0);
  expect(state.recentMs).toEqual([]);
  expect(state.lastGpuMs).toBe(0);
  expect(state.sampleIndex).toBe(7);
  expect(state.epoch).toBe(12);
  expect(state.frameTimes).toHaveLength(1);
});

test("a new tier changes the precision caps: the image is drawn anew", () => {
  const { renderer, state } = still();
  renderer.setTier(tierAt(3, "measured"));
  expect(state.tier.level).toBe(3);
  expect(state.timingGeneration).toBe(1);
  expect(state.sampleIndex).toBe(0);
  expect(state.epoch).toBe(41);
});
