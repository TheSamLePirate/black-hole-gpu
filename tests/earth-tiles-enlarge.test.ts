import { expect, test } from "bun:test";
import { enlarge, markFine } from "../src/system/earth-tiles";

// A tile's square of its ancestor enlarged (earth-tiles.ts enlarge, 14 Nov 2026: a column's and a row's source and weight worked out
// once) — the very floats each pixel's own computation gave before, bit for bit, for random heights and every k and square tried.
const TILE = 256;
function before(h: Float32Array, k: number, x: number, y: number): Float32Array {
  const side = TILE >> k,
    ox = (x - ((x >> k) << k)) * side,
    oy = (y - ((y >> k) << k)) * side;
  const out = new Float32Array(TILE * TILE);
  for (let j = 0; j < TILE; j++)
    for (let i = 0; i < TILE; i++) {
      const fx = Math.min(Math.max(ox + ((i + 0.5) * side) / TILE - 0.5, 0), TILE - 1),
        fy = Math.min(Math.max(oy + ((j + 0.5) * side) / TILE - 0.5, 0), TILE - 1);
      const x0 = Math.min(Math.floor(fx), TILE - 2),
        y0 = Math.min(Math.floor(fy), TILE - 2);
      const tx = fx - x0,
        ty = fy - y0;
      const a = h[y0 * TILE + x0]! + (h[y0 * TILE + x0 + 1]! - h[y0 * TILE + x0]!) * tx;
      const b = h[(y0 + 1) * TILE + x0]! + (h[(y0 + 1) * TILE + x0 + 1]! - h[(y0 + 1) * TILE + x0]!) * tx;
      out[j * TILE + i] = a + (b - a) * ty;
    }
  markFine(out, false);
  return out;
}

test("enlarge gives the same floats as the pixel-by-pixel computation", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 4000 - 200;
  const h = new Float32Array(TILE * TILE).map(() => rnd());
  for (const k of [1, 2, 3, 7])
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [5, 3],
      [(1 << k) - 1, (1 << k) - 1],
      [1234567, 7654321],
    ]) {
      const a = new Uint32Array(enlarge(h, k, x!, y!).buffer);
      const b = new Uint32Array(before(h, k, x!, y!).buffer);
      expect(a).toEqual(b);
    }
});
