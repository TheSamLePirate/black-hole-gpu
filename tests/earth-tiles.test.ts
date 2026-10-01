import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { EarthTiles, edge, sampleLevel, TILE, TILE_PARAM_VEC4S, Z0, Z1 } from "../src/system/earth-tiles";

// The terrain tiles round the camera (src/system/earth-tiles.ts): the levels it wants, the heights it
// gives the ship (the tracer's weights, trace.wgsl: earthH) — fed here with a known field instead of
// the network.

// (no GPU, no network: the textures a stub, the loads never answering — the tiles put in by hand)
(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2 };
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
const fakeDevice = () => ({ createTexture: () => ({}), queue: { writeTexture() {} } }) as unknown as GPUDevice;
const deg = Math.PI / 180;
const dir = (lat: number, lon: number): Vec3 => [Math.cos(lat * deg) * Math.cos(lon * deg), Math.cos(lat * deg) * Math.sin(lon * deg), Math.sin(lat * deg)];
// (a smooth field of heights [m] over the sphere, linear enough to be sampled exactly by the levels)
const field = (lat: number, lon: number) => 1000 + 2000 * Math.sin(lat * deg * 40) + 1500 * Math.cos(lon * deg * 30);

/** fills every tile the windows want from the field, at its pixels' centres */
function fill(t: EarthTiles) {
  for (const [z, x, y] of t.wanted()) {
    const n = 2 ** z, h = new Float32Array(TILE * TILE);
    for (let j = 0; j < TILE; j++) {
      const lat = Math.atan(Math.sinh((0.5 - (y + (j + 0.5) / TILE) / n) * 2 * Math.PI)) / deg;
      for (let i = 0; i < TILE; i++) h[j * TILE + i] = field(lat, ((x + (i + 0.5) / TILE) / n) * 360 - 180);
    }
    t.put(z, x, y, h);
  }
}

test("the levels wanted follow the camera's height", () => {
  const t = new EarthTiles(fakeDevice());
  const pix = 1e-3;
  // (on the ground: every level, 4 × 4 tiles each)
  t.update(dir(45.9, 6.87).map((c) => c * (1 + 2 / 6.371e6)) as Vec3, pix);
  expect(new Set(t.wanted().map((w) => w[0])).size).toBe(Z1 - Z0 + 1);
  expect(t.wanted().length).toBe(16 * (Z1 - Z0 + 1));
  // (from 400 km: none finer than the ground's footprint under the camera)
  const t2 = new EarthTiles(fakeDevice());
  t2.update(dir(45.9, 6.87).map((c) => c * (1 + 400e3 / 6.371e6)) as Vec3, pix);
  expect(Math.max(...t2.wanted().map((w) => w[0]))).toBeLessThanOrEqual(10);
  // (from the Moon's distance: none)
  const t3 = new EarthTiles(fakeDevice());
  t3.update(dir(45.9, 6.87).map((c) => c * 60) as Vec3, pix);
  expect(t3.wanted().length).toBe(0);
});

test("the heights near the camera are the tiles', the global map's beyond them", () => {
  const t = new EarthTiles(fakeDevice());
  const cam = dir(45.9, 6.87).map((c) => c * (1 + 2 / 6.371e6)) as Vec3;
  t.update(cam, 1e-3);
  expect(t.pending).toBe(16 * (Z1 - Z0 + 1));
  // (no level drawn before all its tiles are in)
  expect(t.heightAt(dir(45.9, 6.87), 1).rem).toBe(1);
  fill(t);
  expect(t.pending).toBe(0);
  expect(t.finest).toBe(Z1);
  for (const [lat, lon] of [[45.9, 6.87], [45.905, 6.88], [45.89, 6.86]]) {
    const s = t.heightAt(dir(lat, lon), 1);
    expect(s.rem).toBe(0);
    expect(Math.abs(s.h - field(lat, lon))).toBeLessThan(2);
    expect(s.res).toBeLessThan(30);
  }
  // (a coarse footprint: a coarse level, the same ground)
  const c = t.heightAt(dir(45.95, 6.9), 400);
  expect(c.res).toBeGreaterThan(200);
  expect(Math.abs(c.h - field(45.95, 6.9))).toBeLessThan(25);
  // (far off: the global map)
  expect(t.heightAt(dir(10, 100), 1).rem).toBe(1);
  // (the tracer's params: the reference, a level on)
  const p = t.params();
  expect(p.length).toBe(TILE_PARAM_VEC4S * 4);
  expect(p[3]).toBe(1);
});

test("a level moves with the camera: the part it keeps stays drawn", () => {
  const t = new EarthTiles(fakeDevice());
  t.update(dir(45.9, 6.87).map((c) => c * (1 + 2 / 6.371e6)) as Vec3, 1e-3);
  fill(t);
  // (2 km east: the finest window shifts a column; until its new tiles are in, what it keeps is drawn)
  t.update(dir(45.9, 6.896).map((c) => c * (1 + 2 / 6.371e6)) as Vec3, 1e-3);
  expect(t.pending).toBeGreaterThan(0);
  expect(t.heightAt(dir(45.9, 6.896), 1).rem).toBe(0);
  fill(t);
  expect(t.pending).toBe(0);
});

test("a level's samples: bilinear and B-spline exact on a ramp, the windows' edges faded", () => {
  const ramp = (i: number, j: number) => 3 * i + 5 * j;
  for (const [x, y] of [[10.3, 20.7], [100.5, 3.25]]) {
    expect(sampleLevel(ramp, x, y, 0)).toBeCloseTo(3 * (x - 0.5) + 5 * (y - 0.5), 9);
    expect(sampleLevel(ramp, x, y, 3)).toBeCloseTo(3 * (x - 0.5) + 5 * (y - 0.5), 9);
  }
  expect(edge(1, 500, 1024, 1024)).toBe(0);
  expect(edge(512, 512, 1024, 1024)).toBe(1);
  expect(edge(25, 512, 1024, 1024)).toBeGreaterThan(0.3);
});
