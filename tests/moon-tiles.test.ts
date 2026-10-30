import { afterAll, expect, test } from "bun:test";
import traceWGSL from "../src/shaders/trace.wgsl" with { type: "text" };
import { LOLA_TILE, lolaEncode } from "../src/system/lola-codec";
import { clemLevel, latFrom, MOON_PARAM_VEC4S, MoonTiles } from "../src/system/moon-tiles";

// PLAN-PLANETES-AAA P6: the Moon's relief tiles on the page — their windows round the camera, a tile the server has not yet
// filled from the global map, the heights the walker stands on (heightAt) the tiles' own at their texels, the tracer's
// constants the same.

type V3 = [number, number, number];
const deg = Math.PI / 180;
const dir = (lat: number, lon: number): V3 => [
  Math.cos(lat * deg) * Math.cos(lon * deg),
  Math.cos(lat * deg) * Math.sin(lon * deg),
  Math.sin(lat * deg),
];
// (a tile's heights: a plane in its texels, [half-metres] — z, row, column, i, j)
const value = (z: number, y: number, x: number, i: number, j: number) => 100 * z + ((y * 7 + x * 3 + i + 2 * j) % 400);

const fetch0 = globalThis.fetch;
// (WebGPU's usage flags, absent outside a browser)
(globalThis as { GPUTextureUsage?: object }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2 };
afterAll(() => {
  globalThis.fetch = fetch0;
  delete (globalThis as { __lolaBase?: string }).__lolaBase;
});

test("the windows round the camera, a missing tile from the global map, heightAt the tiles' texels", async () => {
  (globalThis as { __lolaBase?: string }).__lolaBase = "http://lola";
  const asked: string[] = [];
  globalThis.fetch = (async (u: string) => {
    asked.push(String(u));
    const m = /lola\/(\d)\/(\d+)\/(\d+)\.bin$/.exec(String(u));
    // (z 0's tile at row 80, column 180 missing — the server's build under way —; Clementine's none)
    if (!m || (m[1] === "0" && m[2] === "80" && m[3] === "180")) return new Response(null, { status: 404 });
    const [z, y, x] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const h = new Int16Array(LOLA_TILE * LOLA_TILE);
    for (let j = 0; j < LOLA_TILE; j++) for (let i = 0; i < LOLA_TILE; i++) h[j * LOLA_TILE + i] = value(z, y, x, i, j);
    return new Response(lolaEncode(h, z).slice().buffer);
  }) as typeof fetch;
  const writes: number[][] = [];
  const device = {
    createTexture: () => ({ destroy() {} }),
    queue: { writeTexture: (d: { origin: number[] }) => writes.push(d.origin) },
  } as unknown as GPUDevice;
  const t = new MoonTiles(device);
  t.fallback = () => -1234;
  // (the camera 3 km over 9.5° N, 0.5° E)
  const c = dir(9.5, 0.5);
  for (let k = 0; k < 40 && (t.pending > 0 || k === 0); k++) {
    t.update(c, 3000, 1e-3);
    await Bun.sleep(5);
  }
  expect(t.drawn).toBe(true);
  // (z 0's window: 4 × 4 tiles of 1° round the camera — rows 79 … 82, columns 179 … 182)
  expect(asked.some((u) => u.endsWith("/0/80/181.bin"))).toBe(true);
  expect(asked.some((u) => u.endsWith("/0/79/179.bin"))).toBe(true);
  expect(asked.some((u) => u.endsWith("/0/82/182.bin"))).toBe(true);
  expect(asked.some((u) => u.endsWith("/0/78/181.bin"))).toBe(false);
  expect(writes.length).toBeGreaterThanOrEqual(64);
  // (a texel's centre: its value, in metres — z 0, the tile at row 80 / column 181, texel (37, 100))
  const at = (y: number, x: number, i: number, j: number, D = 1) =>
    dir(90 - (y + (j + 0.5) / LOLA_TILE) * D, -180 + (x + (i + 0.5) / LOLA_TILE) * D);
  expect(t.heightAt(at(80, 181, 37, 100), 0.05).h).toBeCloseTo(0.5 * value(0, 80, 181, 37, 100), 3);
  // (the missing tile: the global map's height there)
  expect(t.heightAt(at(80, 180, 128, 128), 0.05).h).toBeCloseTo(-1234, 3);
  // (seen from afar — a footprint of 1.5 km —: z 3 alone (948 m) in part, the global map the rest; at 2 km, the map alone)
  const far = t.heightAt(at(80, 181, 37, 100), 1500);
  expect(far.rem).toBeGreaterThan(0.3);
  expect(far.rem).toBeLessThan(1);
  expect(t.heightAt(at(80, 181, 37, 100), 2000).rem).toBe(1);
  // (the params: −1 the Moon's mark, z 0's window 1024 texels a side)
  const p = t.params();
  expect(p[3]).toBe(-1);
  expect(p[4 + 4 + 3]).toBe(1024);
  expect(p.length).toBe((MOON_PARAM_VEC4S + 1) * 4);
  t.clear();
  expect(t.drawn).toBe(false);
});

test("a latitude's difference from the reference: exact near it, as the tracer's atan2", () => {
  const q = dir(10.0000001, 3);
  expect(latFrom(q, Math.sin(10 * deg)) / deg).toBeCloseTo(1e-7, 12);
  expect(latFrom(dir(-30, 100), Math.sin(20 * deg)) / deg).toBeCloseTo(-50, 9);
});

test("Clementine's level by the window's, and the tracer's constants the codec's", () => {
  expect([0, 1, 2, 3].map(clemLevel)).toEqual([6, 6, 6, 5]);
  expect(traceWGSL).toContain("const MOON_LEVELS = 4u;");
  expect(traceWGSL).toContain("const MOON_R = 1737400.0;");
});
