import { expect, test } from "bun:test";
import { measure, RocketSynth } from "../src/audio/rocket";

// PLAN-AUDIO S2: the granular rocket — louder and brighter with the thrust, crackling in the air (a skewed
// waveform: the Mach waves' shocks), only a low rumble in vacuum, silent at idle, cheap enough to run live.

const R = 48000;
function run(throttle: number, air: number, seconds = 2, pitch = 1) {
  const synth = new RocketSynth(R, 12345);
  const block = new Float32Array(128);
  const out = new Float32Array(Math.round(seconds * R));
  for (let i = 0; i + 128 <= out.length; i += 128) {
    synth.process(block, { throttle, air, pitch });
    out.set(block, i);
  }
  // (the first half second out: the controls eased in)
  return out.subarray(R / 2);
}

test("idle is silent; full thrust far louder than a whisper", () => {
  expect(measure(run(0, 1), R).rms).toBeLessThan(1e-6);
  const low = measure(run(0.1, 1), R).rms;
  const full = measure(run(1, 1), R).rms;
  expect(full).toBeGreaterThan(2 * low);
  expect(full).toBeGreaterThan(0.05);
  expect(full).toBeLessThan(1.5);
});

test("in the air it crackles (a positively skewed waveform) and is brighter; in vacuum a dull rumble", () => {
  const a = measure(run(1, 1), R);
  const v = measure(run(1, 0), R);
  expect(a.skew).toBeGreaterThan(0.3);
  expect(Math.abs(v.skew)).toBeLessThan(0.3);
  expect(a.centroid).toBeGreaterThan(v.centroid * 1.2);
});

test("the Doppler's pitch moves the spectrum", () => {
  const up = measure(run(1, 0, 2, 2), R);
  const base = measure(run(1, 0, 2, 1), R);
  // (the zero crossings' rate is the low rumble's mostly: a rough centroid, ×1.29 for an octave up)
  expect(up.centroid).toBeGreaterThan(base.centroid * 1.2);
});

test("finite everywhere, and fast: a second of full thrust in well under 50 ms", () => {
  const x = run(1, 2, 1.5);
  expect(x.every((v) => Number.isFinite(v))).toBe(true);
  const synth = new RocketSynth(R, 7);
  const block = new Float32Array(128);
  const t0 = performance.now();
  for (let i = 0; i < R / 128; i++) synth.process(block, { throttle: 1, air: 1, pitch: 1 });
  expect(performance.now() - t0).toBeLessThan(50);
});
