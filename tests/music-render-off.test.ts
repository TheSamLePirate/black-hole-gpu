import { expect, test } from "bun:test";
import { type NoteJob, renderNotes } from "../src/audio/music/instruments";

// PLAN-J7 J7-8b: the music's rendered notes made off the page (the CPU worker's job « notes ») — the same code, the same samples;
// a note handed out once not rendered again until a new theme forgets them.

const JOBS: NoteJob[] = [
  { inst: "piano", dur: 1, note: 40, vel: 0.6, beat: Number.NaN },
  { inst: "horn", dur: 0.3, note: 55, vel: 0.8, beat: Number.NaN },
  { inst: "trumpet", dur: 0.3, note: 67, vel: 0.5, beat: Number.NaN },
  { inst: "harp", dur: 1, note: 72, vel: 0.5, beat: Number.NaN },
  { inst: "timpani", dur: 1, note: 43, vel: 0.9, beat: Number.NaN },
  { inst: "taiko", dur: 0.5, note: 36, vel: 0.8, beat: Number.NaN },
  { inst: "organ", dur: 0.25, note: 48, vel: 0.6, beat: Number.NaN },
];

test("the same notes rendered twice from a fresh start: the same keys, the same samples (deterministic)", () => {
  const a = renderNotes(48000, JOBS, true).map((n) => ({ key: n.key, sr: n.sr, data: n.data.slice() }));
  const b = renderNotes(48000, JOBS, true);
  expect(a.length).toBeGreaterThanOrEqual(JOBS.length);
  expect(b.map((n) => n.key)).toEqual(a.map((n) => n.key));
  for (const [i, n] of b.entries()) {
    expect(n.sr).toBe(a[i]!.sr);
    expect(n.data.length).toBe(a[i]!.data.length);
    let diff = 0;
    for (let j = 0; j < n.data.length; j++) diff = Math.max(diff, Math.abs(n.data[j]! - a[i]!.data[j]!));
    expect(diff).toBe(0);
    // (a sound, normalised to 0.9)
    let peak = 0;
    for (const x of n.data) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeGreaterThan(0.5);
  }
});

test("a note handed out is not rendered again; a fresh start forgets them", () => {
  renderNotes(44100, JOBS, true);
  expect(renderNotes(44100, JOBS)).toEqual([]);
  // (one new note among the old: only it)
  const one = renderNotes(44100, [...JOBS, { inst: "celesta", dur: 1, note: 84, vel: 0.5, beat: Number.NaN }]);
  expect(one.map((n) => n.key)).toEqual(["celesta|84"]);
  expect(renderNotes(44100, JOBS, true).length).toBeGreaterThanOrEqual(JOBS.length);
});

test("the low piano notes at half the rate, as on the page", () => {
  const low = renderNotes(48000, [{ inst: "piano", dur: 1, note: 30, vel: 0.6, beat: Number.NaN }], true);
  expect(low.length).toBe(1);
  expect(low[0]!.sr).toBe(24000);
});
