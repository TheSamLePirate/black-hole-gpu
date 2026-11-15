import { expect, test } from "bun:test";
import { MARKERS, markerOver, morseTimes } from "../src/game/approach-audio";

// The approach in the headset (docs/PLAN-APPROCHES.md AP9, src/game/approach-audio.ts): an ident's Morse keyed at its speed; the
// markers' tones and keying (ICAO Annex 10); the marker heard only inside its fan — along the course narrow, across it wide.

test("Morse: « E » one dot, « T » one dash three dots long; « IGWQ » its 13 elements, letters three dots apart (7 words a minute)", () => {
  const dot = 1.2 / 7;
  expect(morseTimes("E")).toEqual([{ at: 0, dur: dot }]);
  expect(morseTimes("T")).toEqual([{ at: 0, dur: 3 * dot }]);
  const k = morseTimes("IGWQ");
  // (I .. · G --. · W .-- · Q --.-)
  expect(k.length).toBe(2 + 3 + 3 + 4);
  // (I's two dots, then three dots of silence before G)
  expect(k[1]!.at).toBeCloseTo(2 * dot, 9);
  expect(k[2]!.at).toBeCloseTo(k[1]!.at + dot + 3 * dot, 9);
  // (some 6 s for a four-letter ident)
  const end = k.at(-1)!.at + k.at(-1)!.dur;
  expect(end).toBeGreaterThan(4);
  expect(end).toBeLessThan(8);
  // (what is not Morse left out)
  expect(morseTimes("I-G")).toEqual(morseTimes("IG"));
});

test("the markers' tones and keying: outer 400 Hz two dashes a second, middle 1 300 Hz dot-dash, inner 3 000 Hz six dots a second", () => {
  expect(MARKERS.O.hz).toBe(400);
  expect(1 / MARKERS.O.period).toBeCloseTo(2, 6);
  expect(MARKERS.M.hz).toBe(1300);
  expect(MARKERS.M.keys.length).toBe(2);
  expect(MARKERS.I.hz).toBe(3000);
  expect(1 / MARKERS.I.period).toBeCloseTo(6, 6);
  for (const k of Object.values(MARKERS)) for (const e of k.keys) expect(e.at + e.dur).toBeLessThanOrEqual(k.period + 1e-9);
});

test("a marker heard inside its fan only: along the course ±40° from the vertical, across ±75°; under 30 m none", () => {
  const D = Math.PI / 180,
    R = 6_371_008.8;
  const m = [{ kind: "O" as const, lat: 42.7, lon: 23.3 }];
  // (a place `along` m down a 090° course from the beacon, `across` to its right — south —, `h` over its ground at 500 m)
  const at = (along: number, across: number, h: number) => ({
    lat: 42.7 - across / (D * R),
    lon: 23.3 + along / (D * R * Math.cos(42.7 * D)),
    alt: 500 + h,
  });
  expect(markerOver(m, at(0, 0, 400), 90, 500)).toBe("O");
  // (400 m up: ±336 m along)
  expect(markerOver(m, at(300, 0, 400), 90, 500)).toBe("O");
  expect(markerOver(m, at(-380, 0, 400), 90, 500)).toBeNull();
  // (across: ±1 490 m)
  expect(markerOver(m, at(0, 1400, 400), 90, 500)).toBe("O");
  expect(markerOver(m, at(0, -1600, 400), 90, 500)).toBeNull();
  expect(markerOver(m, at(0, 0, 20), 90, 500)).toBeNull();
  expect(markerOver(undefined, at(0, 0, 400), 90, 500)).toBeNull();
});
