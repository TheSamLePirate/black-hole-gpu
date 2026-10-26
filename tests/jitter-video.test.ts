import { describe, expect, test } from "bun:test";
import { flickerCells, tileJitter, tileShift, trackTiles } from "../scripts/lib/jitter-video";

// The video's jitter (scripts/lib/jitter-video.ts): a tile's sub-pixel shift found, a steady pan has none, a shaken one has.

/** a textured grey frame, shifted by (sx, sy) px (smooth noise sampled bilinearly) */
function frame(w: number, h: number, sx: number, sy: number) {
  const f = new Uint8Array(w * h);
  const v = (x: number, y: number) =>
    128 +
    40 * Math.sin(x * 0.21 + Math.sin(y * 0.07) * 3) +
    30 * Math.sin(y * 0.17 + Math.cos(x * 0.05) * 2) +
    20 * Math.sin((x + y) * 0.31);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = Math.max(0, Math.min(255, Math.round(v(x - sx, y - sy))));
  return f;
}

describe("the video's jitter", () => {
  test("phase correlation finds a sub-pixel shift", () => {
    const a = frame(128, 128, 0, 0);
    for (const [sx, sy] of [
      [2.4, -1.3],
      [-3, 2],
      [0.5, 0.25],
    ] as const) {
      const m = tileShift(a, frame(128, 128, sx, sy), 128, 128, 32, 32, 64);
      expect(Math.abs(m.dx - sx)).toBeLessThan(0.05);
      expect(Math.abs(m.dy - sy)).toBeLessThan(0.05);
    }
  });

  test("a steady pan has no jitter, a shaken one has its size", () => {
    const n = 40;
    const times = Array.from({ length: n }, (_, i) => i / 25);
    const steady = times.map((t) => frame(192, 128, 30 * t, 0));
    const shaken = times.map((t, i) => frame(192, 128, 30 * t + (i % 2 ? 1.5 : -1.5), 0));
    const js = tileJitter(trackTiles(steady, 192, 128), times, 1);
    const jk = tileJitter(trackTiles(shaken, 192, 128), times, 1);
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1]!;
    expect(med(js.map((t) => t.rms))).toBeLessThan(0.3);
    expect(med(jk.map((t) => t.rms))).toBeGreaterThan(2);
  });
});

describe("the video's flicker", () => {
  test("a cell blinking every other frame is found, at its frequency; a slow fade is not a blink", () => {
    const w = 128,
      h = 64,
      n = 60;
    const frames = Array.from({ length: n }, (_, k) => {
      const f = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          // (the left half fades slowly; the right top cell blinks every 4 frames — 2 on, 2 off)
          const blink = x >= 96 && y < 32 && k % 4 < 2 ? 30 : 0;
          f[y * w + x] = 80 + k + blink;
        }
      return f;
    });
    const cells = flickerCells(frames, w, h, 30, 32);
    const at = (c: number, r: number) => cells.find((x) => x.col === c && x.row === r)!;
    expect(at(3, 0).blink).toBeGreaterThan(10);
    expect(Math.abs(at(3, 0).freqHz - 7.5)).toBeLessThan(0.5);
    expect(at(0, 0).blink).toBeLessThan(0.01);
    expect(at(3, 1).blink).toBeLessThan(0.01);
  });
});
