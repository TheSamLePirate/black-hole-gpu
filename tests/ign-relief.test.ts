import { expect, test } from "bun:test";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { EarthTiles, ignHeightUrl, IGN_RGEALTI, isFine, markFine, TILE, TILE_RES_FINE, TILE_RES_MIN, ZG1 } from "../src/system/earth-tiles";
import type { Vec3 } from "../src/physics";

// The IGN's relief (I2, src/system/earth-tiles.ts): a height's source in its float's last bit — a survey's (the IGN's) or the
// global data's —, the data's own resolution taken from it, and one WMS-R request a Web Mercator tile.

globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2 };
const fakeDevice = () =>
  ({
    createTexture: (d: { size: number[] }) => ({ size: d.size, destroy() {} }),
    queue: { writeTexture() {}, onSubmittedWorkDone: () => Promise.resolve() },
  }) as unknown as GPUDevice;
const deg = Math.PI / 180;

test("a height's source in its last bit: marked a survey's, Terrarium's never so — its k/256 values leave that bit clear", () => {
  const h = new Float32Array([1035.25, -12.5, 4808.7, 0]);
  markFine(h, true);
  expect([...h].every(isFine)).toBe(true);
  // (the mark moves a height by one ulp: a tenth of a millimetre at 1 000 m)
  expect(Math.abs(h[0]! - 1035.25)).toBeLessThan(1e-3);
  markFine(h, false);
  expect([...h].some(isFine)).toBe(false);
  // (every height Terrarium can say from 11 000 m under the sea to 9 000 m up, a step of 1/256 m, is unmarked)
  const t = new Float32Array(1);
  for (let k = -11000 * 256; k <= 9000 * 256; k += 97) {
    t[0] = k / 256;
    expect(isFine(t[0]!)).toBe(false);
  }
});

test("one WMS-R request a tile: its Web Mercator box exactly, 256² float32 heights", () => {
  const C = Math.PI * WGS84_A,
    z = 17,
    x = 66391,
    y = 45092,
    s = (2 * C) / 2 ** z;
  const u = new URL(ignHeightUrl(IGN_RGEALTI, z, x, y));
  expect(u.searchParams.get("CRS")).toBe("EPSG:3857");
  expect(u.searchParams.get("LAYERS")).toBe(IGN_RGEALTI);
  expect([u.searchParams.get("WIDTH"), u.searchParams.get("HEIGHT")]).toEqual([String(TILE), String(TILE)]);
  const b = u.searchParams.get("BBOX")!.split(",").map(Number);
  expect(b[0]).toBeCloseTo(x * s - C, 6);
  expect(b[1]).toBeCloseTo(C - (y + 1) * s, 6);
  expect(b[2]! - b[0]!).toBeCloseTo(s, 6);
  expect(b[3]! - b[1]!).toBeCloseTo(s, 6);
});

test("the data's own resolution from the source: a survey's its texel's, the global data's no finer than SRTM's", () => {
  const res = (fine: boolean) => {
    const t = new EarthTiles(fakeDevice());
    t.reliefOn = false;
    const c = geodeticToCart(1, WGS84_F, 45.9 * deg, 6.87 * deg, 2000 / WGS84_A) as Vec3;
    t.update(c, 1e-3);
    for (const [z, x, y] of t.wanted()) {
      const h = new Float32Array(TILE * TILE).fill(1000);
      markFine(h, fine && z === ZG1);
      t.put(z, x, y, h);
    }
    const q: Vec3 = [Math.cos(45.9 * deg) * Math.cos(6.87 * deg), Math.cos(45.9 * deg) * Math.sin(6.87 * deg), Math.sin(45.9 * deg)];
    return t.heightAt(q, 1).res;
  };
  // (z 14's texel at 46°: 6.6 m — the IGN's says so; Terrarium's says 25 m, SRTM's under it)
  expect(res(true)).toBeLessThan(10);
  expect(res(true)).toBeGreaterThan(TILE_RES_FINE);
  expect(res(false)).toBeCloseTo(TILE_RES_MIN, 0);
});
