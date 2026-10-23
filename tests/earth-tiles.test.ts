import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import {
  EarthTiles,
  edge,
  FINE_Z,
  orthoLayers,
  sampleLevel,
  TILE,
  TILE_PARAM_VEC4S,
  TILE_REACH,
  Z0,
  Z1,
  ZG1,
} from "../src/system/earth-tiles";
import { EARTH_RUNWAYS, runwayGrade, runwayWeight } from "../src/game/sites";
import { earthHeightSampler, tileFallbackSampler } from "../src/terrain";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";

// The terrain tiles round the camera (src/system/earth-tiles.ts): the levels it wants, the heights it
// gives the ship (the tracer's weights, trace.wgsl: earthH) — fed here with a known field instead of
// the network.

// (no GPU, no network: the textures a stub, the loads never answering — the tiles put in by hand)
(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2 };
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
const fakeDevice = () =>
  ({
    createTexture: (d: { size: number[] }) => ({ size: d.size, destroy() {} }),
    queue: { writeTexture() {}, onSubmittedWorkDone: () => Promise.resolve() },
  }) as unknown as GPUDevice;
const deg = Math.PI / 180;
const dir = (lat: number, lon: number): Vec3 => [
  Math.cos(lat * deg) * Math.cos(lon * deg),
  Math.cos(lat * deg) * Math.sin(lon * deg),
  Math.sin(lat * deg),
];
/** the camera h [m] above the ellipsoid at a geodetic place, on the Earth's axes [its equatorial radii] */
const camAt = (lat: number, lon: number, h: number): Vec3 => geodeticToCart(1, WGS84_F, lat * deg, lon * deg, h / WGS84_A);
// (a smooth field of heights [m] over the sphere, linear enough to be sampled exactly by the levels)
const field = (lat: number, lon: number) => 1000 + 2000 * Math.sin(lat * deg * 40) + 1500 * Math.cos(lon * deg * 30);

/** fills every tile the windows want from the field, at its pixels' centres */
function fill(t: EarthTiles) {
  for (const [z, x, y] of t.wanted()) {
    const n = 2 ** z,
      h = new Float32Array(TILE * TILE);
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
  t.update(camAt(45.9, 6.87, 2), pix);
  expect(new Set(t.wanted().map((w) => w[0])).size).toBe(Z1 - Z0 + 1);
  expect(t.wanted().length).toBe(16 * (Z1 - Z0 + 1));
  // (from 400 km: none finer than the ground's footprint under the camera)
  const t2 = new EarthTiles(fakeDevice());
  t2.update(camAt(45.9, 6.87, 400e3), pix);
  expect(Math.max(...t2.wanted().map((w) => w[0]))).toBeLessThanOrEqual(10);
  // (from the Moon's distance: none)
  const t3 = new EarthTiles(fakeDevice());
  t3.update(dir(45.9, 6.87).map((c) => c * 60) as Vec3, pix);
  expect(t3.wanted().length).toBe(0);
});

test("the heights near the camera are the tiles', the global map's beyond them", () => {
  const t = new EarthTiles(fakeDevice());
  const cam = camAt(45.9, 6.87, 2);
  t.update(cam, 1e-3);
  expect(t.pending).toBe(16 * (Z1 - Z0 + 1));
  // (no level drawn before all its tiles are in)
  expect(t.heightAt(dir(45.9, 6.87), 1).rem).toBe(1);
  fill(t);
  expect(t.pending).toBe(0);
  expect(t.finest).toBe(Z1);
  for (const [lat, lon] of [
    [45.9, 6.87],
    [45.905, 6.88],
    [45.89, 6.86],
  ] as const) {
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
  t.update(camAt(45.9, 6.87, 2), 1e-3);
  fill(t);
  // (2 km east: the finest window shifts a column; until its new tiles are in, what it keeps is drawn)
  t.update(camAt(45.9, 6.896, 2), 1e-3);
  expect(t.pending).toBeGreaterThan(0);
  expect(t.heightAt(dir(45.9, 6.896), 1).rem).toBe(0);
  fill(t);
  expect(t.pending).toBe(0);
});

test("the sources switched (the IGN's relief, the orthophotos): the tiles drawn stay the ground until each is in again", () => {
  // (dropped at once, the ground fell to the global map's: at Chamonix the valley filled, a jet flying low in it
  // hundreds of metres in the ground — flung out by its gear, burnt)
  const t = new EarthTiles(fakeDevice());
  const cam = camAt(45.912, 6.858, 2);
  t.update(cam, 1e-3);
  fill(t);
  const at = dir(45.912, 6.858);
  const before = t.heightAt(at, 1);
  expect(before.rem).toBe(0);
  for (const flip of [() => (t.reliefOn = false), () => (t.orthoOn = false), () => (t.reliefOn = true)]) {
    flip();
    t.update(cam, 1e-3);
    const stamp = t.stamp;
    // (every tile asked again — the finer levels off without the relief —, the ground the same meanwhile)
    expect(t.pending).toBeGreaterThan(0);
    const s = t.heightAt(at, 1);
    expect(s.rem).toBe(0);
    expect(Math.abs(s.h - before.h)).toBeLessThan(5);
    fill(t);
    expect(t.pending).toBe(0);
    // (taken again whole: the ground built from the tiles redone)
    expect(t.stamp).toBeGreaterThan(stamp);
    expect(Math.abs(t.heightAt(at, 1).h - before.h)).toBeLessThan(5);
  }
  expect(t.finest).toBe(Z1);
});

test("a level's samples: bilinear and the monotone cubic exact on a ramp, the windows' edges faded", () => {
  const ramp = (i: number, j: number) => 3 * i + 5 * j;
  for (const [x, y] of [
    [10.3, 20.7],
    [100.5, 3.25],
  ] as const) {
    expect(sampleLevel(ramp, x, y, 0)).toBeCloseTo(3 * (x - 0.5) + 5 * (y - 0.5), 9);
    expect(sampleLevel(ramp, x, y, 3)).toBeCloseTo(3 * (x - 0.5) + 5 * (y - 0.5), 9);
  }
  expect(edge(1, 500, 1024, 1024)).toBe(0);
  expect(edge(512, 512, 1024, 1024)).toBe(1);
  expect(edge(25, 512, 1024, 1024)).toBeGreaterThan(0.3);
});

test("tiles that will not load keep the ground: a runway's the same, no terrace anywhere", () => {
  // (a map of 0.5° texels whose heights jump by up to 400 m from one texel to the next)
  const W = 720,
    H = 360;
  const map = new Int16Array(W * H).map((_, k) => 500 + (((k % W) * 37 + Math.floor(k / W) * 91) % 400));
  const t = new EarthTiles(fakeDevice());
  t.fallback = tileFallbackSampler(map, W, H);
  const ground = earthHeightSampler(map, W, H, (q, foot) => t.heightAt(q, foot), runwayGrade);
  // (Edwards's runway 22, the craft rolling down it: the ground before any tile, then with every tile failed in)
  t.update(camAt(34.905, -117.884, 2), 1e-3);
  const rwy = EARTH_RUNWAYS.find((r) => r.site.name.includes("Edwards"))!;
  // (every 100 m of its 4.5 km, as the relief is read: the geodetic direction)
  const along = Array.from({ length: 46 }, (_, k): Vec3 => {
    const g = cartToGeodetic(WGS84_A, WGS84_F, rwy.origin.map((o, i) => o + rwy.along[i]! * k * 100) as Vec3);
    return dir(g.lat / deg, g.lon / deg);
  });
  const off = Array.from({ length: 201 }, (_, k) => dir(34.95, -117.95 + k * 2e-4));
  const before = along.map((q) => ground(q, 1));
  const tiles = t as unknown as { levels: unknown[]; fromFallback(L: unknown, x: number, y: number): Float32Array };
  for (const [z, x, y] of t.wanted()) t.put(z, x, y, tiles.fromFallback(tiles.levels[z - Z0], x, y));
  expect(t.pending).toBe(0);
  // (on the graded runway: the same ground to a decimetre — read at the nearest texel it rose by tens of metres)
  along.forEach((q, k) => {
    expect(runwayWeight(q)).toBe(1);
    expect(Math.abs(ground(q, 1) - before[k]!)).toBeLessThan(0.1);
  });
  // (off it, 20 m apart: no step — the terraces were the map's texel-to-texel jumps, up to 400 m here)
  const h = off.map((q) => ground(q, 1));
  for (let k = 1; k < h.length; k++) expect(Math.abs(h[k]! - h[k - 1]!)).toBeLessThan(15);
  // (every wanted tile filled from the map: 3 s here, over the 5 s default on GitHub's runner)
}, 30_000);

test("the imagery: every level; EOX's colours brought into the Blue Marble's; finer nights from z 8's lights", async () => {
  const { IMG_Z1, ZG1, GIBS_Z1, eoxColour, EOX_FIT, nightOf, eoxUrl } = await import("../src/system/earth-tiles");
  // (imagery on every level of the global data — the IGN's finer relief levels, z 15 … 17, have none: the orthophotos')
  expect(IMG_Z1).toBe(ZG1);
  // black stays black; bright ground (snow, sand, rock) as it is — neutral, never tinted
  expect(eoxColour(0, 0, 0)).toEqual([0, 0, 0]);
  for (const v of [200, 240, 255]) for (const c of eoxColour(v, v, v)) expect(Math.abs(c - v)).toBeLessThanOrEqual(1);
  for (const v of [60, 120, 160]) {
    const [r, g, b] = eoxColour(v, v, v);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(26);
  }
  // the grey ramp stays a ramp (no channel turning back)
  for (let c = 0; c < 3; c++) {
    let last = -1;
    for (let v = 0; v < 256; v += 5) {
      const out = eoxColour(v, v, v)[c]!;
      expect(out).toBeGreaterThanOrEqual(last - 2);
      last = out;
    }
  }
  expect(EOX_FIT.power[2]).toBeGreaterThan(EOX_FIT.power[0]);
  // a forest's EOX green (the Vosges' z 8 tile's mean) lands near the Blue Marble's own
  const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const toS = (l: number) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
  const forest = eoxColour(toS(0.0162), toS(0.0413), toS(0.0129)).map(lin);
  expect(forest[0]).toBeCloseTo(0.0197, 2);
  expect(forest[1]).toBeCloseTo(0.0331, 2);
  expect(forest[2]).toBeCloseTo(0.0068, 2);
  // the nights: own to z 8; beyond, the parent's square
  expect(nightOf(GIBS_Z1, 10, 20)).toEqual({ z: GIBS_Z1, x: 10, y: 20, crop: null });
  expect(nightOf(GIBS_Z1 + 1, 21, 41)).toEqual({ z: GIBS_Z1, x: 10, y: 20, crop: [128, 128, 128] });
  expect(nightOf(13, 4266, 2924)).toEqual({ z: 8, x: 133, y: 91, crop: [80, 96, 8] });
  expect(eoxUrl(13, 4266, 2924)).toBe(
    "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/13/2924/4266.jpg",
  );
});

test("the windows led where the view looks: ahead by up to 1¼ tile of each level, the camera still inside", () => {
  const t = new EarthTiles(fakeDevice());
  const c = camAt(36, -5.4, 400);
  t.update(c, 0.001);
  const still = new Map(t.wanted().map(([z, x, y]) => [`${z}/${x}/${y}`, z]));
  // (looking north, 6 km ahead)
  const north: Vec3 = [0, 0, 6000 / WGS84_A];
  const t2 = new EarthTiles(fakeDevice());
  t2.update(c, 0.001, [0, 0, 0], north);
  const led = t2.wanted();
  const finest = Math.max(...led.map(([z]) => z));
  const ys = (L: [number, number, number][]) => L.filter(([z]) => z === finest).map(([, , y]) => y);
  // (tiles' y grows southwards: the led window's rows further north)
  expect(Math.min(...ys(led))).toBeLessThan(
    Math.min(...ys([...still.keys()].map((k) => k.split("/").map(Number) as [number, number, number]))),
  );
  // (the camera's own tile still in the finest window)
  const n = 2 ** finest;
  const cy = Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + (36 * deg) / 2)) / Math.PI) / 2) * n);
  expect(ys(led)).toContain(cy);
});

test("the detail's reach: windows of 8 tiles, the tiles left kept and drawn again from memory, the ring loaded ahead", () => {
  const t = new EarthTiles(fakeDevice());
  let resized = 0;
  t.onResize = () => resized++;
  const cam = camAt(45.9, 6.87, 2);
  t.update(cam, 1e-3);
  fill(t);
  // (Far: the texture made again, 2048 texels a side, every level drawn anew — the fine ones 8 × 8 tiles, the coarser 4 × 4)
  t.setReach(TILE_REACH.far);
  expect(resized).toBe(1);
  // (and the orthophotos' four 1024² quadrants in one more layer — I1)
  expect((t.texture as unknown as { size: number[] }).size).toEqual([2048, 2048, Z1 - Z0 + 1 + orthoLayers(2048)]);
  t.update(cam, 1e-3);
  // (the IGN's relief levels over France, z 15 … 17, 4 × 4 tiles whatever the reach)
  expect(t.wanted().length).toBe(64 * (ZG1 - FINE_Z + 1) + 16 * (FINE_Z - Z0) + 16 * (Z1 - ZG1));
  expect(t.heightAt(dir(45.9, 6.87), 1).rem).toBe(1);
  fill(t);
  expect(t.pending).toBe(0);
  // (the heights the same as through 4 tiles, out farther: 8 km off on the finest level — a 4-tile window's 2.5 km)
  for (const [lat, lon] of [
    [45.9, 6.87],
    [45.92, 6.95],
    [45.85, 6.8],
  ] as const) {
    const s = t.heightAt(dir(lat, lon), 1);
    expect(s.rem).toBe(0);
    expect(Math.abs(s.h - field(lat, lon))).toBeLessThan(2);
    expect(s.res).toBeLessThan(30);
  }
  // (the windows whole: the next ring round the finest levels asked for ahead — the loads never answer here)
  const inner = t as unknown as {
    inflight: Map<string, unknown>;
    cache: Map<string, unknown>;
    levels: { z: number; want: unknown; valid: unknown }[];
  };
  // (the loads answered: the windows' — put in by hand here — gone from the ones in flight)
  inner.inflight.clear();
  t.update(cam, 1e-3);
  expect([...inner.inflight.keys()].some((k) => k.startsWith(`${Z1}/`) || k.startsWith(`${Z1 - 1}/`))).toBe(true);
  // (12 km east and back: the finest windows' columns left kept, drawn again from memory — none to load)
  t.update(camAt(45.9, 7.025, 2), 1e-3);
  expect(t.pending).toBeGreaterThan(0);
  fill(t);
  expect(inner.cache.size).toBeGreaterThan(0);
  t.update(cam, 1e-3);
  // (the finest two levels — the ring's — whole again at once: their windows drawn entire)
  for (const L of inner.levels.filter((L) => L.z >= Z1 - 1)) expect(L.valid).toEqual(L.want);
  const s = t.heightAt(dir(45.9, 6.87), 1);
  expect(Math.abs(s.h - field(45.9, 6.87))).toBeLessThan(2);
  expect(s.res).toBeLessThan(30);
  // (back to Normal: 4 tiles, the memory let go)
  t.setReach(TILE_REACH.normal);
  expect(resized).toBe(2);
  expect(inner.cache.size).toBe(0);
});

test("the detail's reach on a device that cannot hold its texture: back to 4 tiles, not asked again", async () => {
  // (the 2048² texture's 256 MiB refused — out of memory, an iPad's —: the reach kept at 4 tiles, the next frames'
  // setReach(far) not trying it again)
  let made = 0;
  const dev = {
    createTexture: (d: { size: number[] }) => (made++, { size: d.size, destroy() {} }),
    pushErrorScope() {},
    popErrorScope: () => Promise.resolve(made > 1 && made % 2 === 0 ? { message: "out of memory" } : null),
    queue: { writeTexture() {}, onSubmittedWorkDone: () => Promise.resolve() },
  } as unknown as GPUDevice;
  const t = new EarthTiles(dev);
  let resized = 0;
  t.onResize = () => resized++;
  t.setReach(TILE_REACH.far);
  expect((t.texture as unknown as { size: number[] }).size[0]).toBe(2048);
  await Promise.resolve();
  await Promise.resolve();
  expect((t.texture as unknown as { size: number[] }).size[0]).toBe(1024);
  expect(resized).toBe(2);
  t.setReach(TILE_REACH.far);
  t.setReach(TILE_REACH.veryFar);
  expect(resized).toBe(2);
  expect((t.texture as unknown as { size: number[] }).size[0]).toBe(1024);
});
