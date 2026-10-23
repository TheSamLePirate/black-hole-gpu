import { expect, test } from "bun:test";
import { decodeRelief, encodeRelief, isReliefGrid, packGrid, unpackGrid } from "../src/pwa/relief-codec";

// The relief's grids kept small (src/pwa/relief-codec.ts, I8c): every height back to the centimetre, the holes as the
// source gave them, a cliff past ±327 m through its escape, a smooth relief a fraction of its float32 bytes.

/** a valley's 256² grid: two slopes, a ripple, a river's bed — in metres over the sea */
function valley(w = 256): Float32Array {
  const g = new Float32Array(w * w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2) / w;
      g[y * w + x] = 1035 + 2400 * u * u + 18 * Math.sin(x / 7) * Math.cos(y / 11) + 0.37 * ((x * 7919 + y * 104729) % 13);
    }
  return g;
}

test("every height back to the centimetre (≤ 5 mm), a smooth relief under a third of its bytes", async () => {
  const src = valley();
  const enc = await encodeRelief(src.buffer as ArrayBuffer);
  const back = new Float32Array((await decodeRelief(enc.buffer as ArrayBuffer))!);
  expect(back.length).toBe(src.length);
  let worst = 0;
  for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(back[i]! - src[i]!));
  expect(worst).toBeLessThanOrEqual(0.005 + 1e-4);
  console.log(
    `  a valley 256²: ${src.byteLength} → ${enc.byteLength} bytes (${((100 * enc.byteLength) / src.byteLength).toFixed(1)} %), worst ${(worst * 1000).toFixed(2)} mm`,
  );
  expect(enc.byteLength).toBeLessThan(src.byteLength / 3);
});

test("the holes as the source gave them (its no-data, NaN), the game's own bounds (under −100 m, over 9 000 m)", () => {
  const src = valley(16);
  src[3] = -99999;
  src[40] = -99999;
  src[17] = -150;
  src[200] = 9500;
  const back = unpackGrid(packGrid(src))!;
  // (the first hole's value for every hole: the game reads them all as holes, earth-tiles.ts ignGrid)
  for (const i of [3, 40, 17, 200]) expect(back[i]).toBe(-99999);
  expect(Math.abs(back[4]! - src[4]!)).toBeLessThanOrEqual(0.0051);
  const nan = valley(16);
  nan[5] = Number.NaN;
  expect(Number.isNaN(unpackGrid(packGrid(nan))![5]!)).toBe(true);
  // (a grid of holes only — the sea)
  const sea = new Float32Array(256).fill(-99999);
  expect([...unpackGrid(packGrid(sea))!].every((h) => h === -99999)).toBe(true);
});

test("a cliff past ±327 m between neighbours through its escape; a grid not the codec's refused", () => {
  const src = new Float32Array(64 * 64).fill(12.34);
  for (let i = 0; i < 64; i++) src[i * 64 + 32] = 4807.81; // (a wall, Mont Blanc's height, a texel wide)
  src[0] = -99.99;
  const back = unpackGrid(packGrid(src))!;
  for (let i = 0; i < src.length; i++) expect(Math.abs(back[i]! - src[i]!)).toBeLessThanOrEqual(0.0051);
  expect(unpackGrid(new Uint8Array(40))).toBeNull();
  expect(isReliefGrid("https://data.geopf.fr/wms-r?…&FORMAT=image/x-bil;bits=32", 262_144)).toBe(true);
  expect(isReliefGrid("https://data.geopf.fr/wms-r?…&FORMAT=image/x-bil;bits=32", 1000)).toBe(false);
  expect(isReliefGrid("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/1/2.png", 262_144)).toBe(false);
});
