import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import trace from "../src/shaders/trace.wgsl" with { type: "text" };

// The tracer's blue noise (PLAN-GEANTES-VOLUME V6: scripts/build-blue-noise.ts, noise3d.ts's last slice, trace.wgsl
// blueDraws): each channel a ranking of the 128² pixels — every rank once —, blue (its power at low frequencies a few
// thousandths of white noise's), the channels independent; and no draw left as fract(k × another).

const W = 128,
  N = W * W;
const ranks = new Uint16Array(readFileSync(new URL("../assets/noise/blue-noise-128.bin", import.meta.url)).buffer.slice(0));
const chan = (c: number) => Float64Array.from({ length: N }, (_, i) => (ranks[i * 4 + c]! + 0.5) / N - 0.5);

test("each channel a permutation of the 16 384 ranks", () => {
  expect(ranks.length).toBe(4 * N);
  for (let c = 0; c < 4; c++) {
    const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) seen[ranks[i * 4 + c]!] = 1;
    expect(seen.every((x) => x === 1)).toBe(true);
  }
});

test("blue: little power at low frequencies; the channels independent", () => {
  // (the power at the radii 1–8 — the DFT along a few directions —, against white noise's 1/12 a coefficient)
  for (let c = 0; c < 4; c++) {
    const v = chan(c);
    let low = 0,
      n = 0;
    for (const [fx, fy] of [
      [1, 0],
      [0, 1],
      [2, 3],
      [5, 0],
      [4, 4],
      [0, 8],
    ] as const) {
      let re = 0,
        im = 0;
      for (let i = 0; i < N; i++) {
        const a = (2 * Math.PI * (fx * (i % W) + fy * Math.floor(i / W))) / W;
        re += v[i]! * Math.cos(a);
        im -= v[i]! * Math.sin(a);
      }
      low += (re * re + im * im) / N;
      n++;
    }
    expect(low / n).toBeLessThan(0.01 / 12);
  }
  for (let a = 0; a < 4; a++)
    for (let b = a + 1; b < 4; b++) {
      const x = chan(a),
        y = chan(b);
      let s = 0;
      for (let i = 0; i < N; i++) s += x[i]! * y[i]!;
      expect(Math.abs(s / (N / 12))).toBeLessThan(0.05);
    }
});

test("the tracer's draws: the blue noise's, never a multiple of another draw", () => {
  expect(trace).toContain("fn blueDraws(p: vec2u, n: u32) -> vec4f {");
  expect(trace).not.toMatch(/fract\((rnd|RND|jit) \* [\d.]+/);
});
