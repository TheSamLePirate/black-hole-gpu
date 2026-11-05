import { expect, test } from "bun:test";
import { delightTile, predictShadow } from "../src/system/ortho-delight";

// L7b's prototype (src/system/ortho-delight.ts) on a made-up tile: a 10 m block on flat ground, the photo's Sun due south at
// 45°, its shadow 25 px north of it at 0.4 m a pixel, darkened by a known k per colour and bluer — found, relit to the sunlit
// ground's level; a tile without the survey left as it was.
const W = 256,
  M = 96,
  N = W + 2 * M,
  MPP = 0.4;
const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const srgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
const K = [7, 6, 4.5];
const SUN = [150, 140, 120];
function scene() {
  const mnh = new Float32Array(N * N);
  for (let y = 100; y < 140; y++) for (let x = 100; x < 140; x++) mnh[(M + y) * N + M + x] = 10;
  const px = new Uint8ClampedArray(4 * W * W);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.08;
  const shadow = predictShadow({ mnh, n: N, m: M, mpp: MPP }, new Uint8Array(W * W).fill(1), 180, 45);
  for (let i = 0; i < W * W; i++) {
    const y = Math.floor(i / W),
      x = i % W;
    const roof = y >= 100 && y < 140 && x >= 100 && x < 140;
    const n = 1 + rnd();
    for (let c = 0; c < 3; c++) {
      const v = roof ? lin(185) : (lin(SUN[c]!) * n) / (shadow[i] ? K[c]! : 1);
      px[4 * i + c] = srgb(Math.min(v, 1));
    }
    px[4 * i + 3] = 255;
  }
  return { mnh, px, shadow };
}
const mean = (px: Uint8ClampedArray, sel: (i: number) => boolean, c: number) => {
  let s = 0,
    n = 0;
  for (let i = 0; i < W * W; i++)
    if (sel(i)) {
      s += lin(px[4 * i + c]!);
      n++;
    }
  return s / n;
};

test("L7b prototype: the photo's Sun found from the canopy's shadows, the shadow relit to the sunlit ground", () => {
  const { mnh, px, shadow } = scene();
  let share = 0;
  for (const v of shadow) share += v;
  expect(share).toBeGreaterThan(800); // (the block's shadow: ~40 × 25 px)
  // (deep inside the shadow — away from its softened edges — and the sunlit ground)
  const core = (i: number) => {
    const y = Math.floor(i / W),
      x = i % W;
    return y >= 80 && y < 95 && x >= 105 && x < 135;
  };
  const lit = (i: number) => Math.floor(i / W) > 160;
  const before = mean(px, core, 1) / mean(px, lit, 1);
  const st = delightTile(px, { mnh, n: N, m: M, mpp: MPP, area: "test" });
  console.log(`  ${JSON.stringify(st)}; shadow/sunlit green ${before.toFixed(3)} before`);
  expect(st.done).toBe(true);
  expect(Math.abs(st.sun![0] - 180)).toBeLessThanOrEqual(10);
  expect(Math.abs(st.sun![1] - 45)).toBeLessThanOrEqual(8);
  for (let c = 0; c < 3; c++) {
    const r = mean(px, core, c) / mean(px, lit, c);
    expect(r).toBeGreaterThan(0.85);
    expect(r).toBeLessThan(1.15);
  }
  // (the roof untouched)
  const roof = (i: number) => {
    const y = Math.floor(i / W),
      x = i % W;
    return y >= 105 && y < 135 && x >= 105 && x < 135;
  };
  expect(Math.abs(mean(px, roof, 1) - lin(185))).toBeLessThan(0.002);
});

test("L7b prototype: no survey under the tile — left as it was", () => {
  const { px } = scene();
  const copy = px.slice();
  const st = delightTile(px, { mnh: new Float32Array(N * N).fill(Number.NaN), n: N, m: M, mpp: MPP, area: "none" });
  expect(st).toMatchObject({ done: false, why: "survey" });
  expect(px).toEqual(copy);
});
