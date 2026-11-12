import { expect, test } from "bun:test";
import { withGpuStubs } from "./lib/gpu-stubs";
import { published } from "./lib/published-tiles";
import type { Vec3 } from "../src/physics";
import { ANCHOR_AGL_M, contactOf, EarthTiles, TILE, Z0, Z1, ZG1 } from "../src/system/earth-tiles";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";

// PLAN-J2 J2-2 — the contact ground belongs to the world, not to the camera (strategy §19.4; CLAUDE.md: "the graphics' quality or the
// camera's move must not decide the craft's contact ground"): the tiles under the flown craft held round it (EarthTiles.setAnchors),
// the contact (groundAt) the drawn ground wherever it holds the contact's level, the held tiles else — whatever the camera does.

(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2 };
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
const deg = Math.PI / 180;
const dir = (lat: number, lon: number): Vec3 => [
  Math.cos(lat * deg) * Math.cos(lon * deg),
  Math.cos(lat * deg) * Math.sin(lon * deg),
  Math.sin(lat * deg),
];
const camAt = (lat: number, lon: number, h: number): Vec3 => geodeticToCart(1, WGS84_F, lat * deg, lon * deg, h / WGS84_A);
/** each level's heights its own: the field plus z metres — the level a sample comes from read in it */
const field = (lat: number, lon: number) => 400 + 300 * Math.sin(lat * deg * 400) + 200 * Math.cos(lon * deg * 300);
function tileOf(z: number, x: number, y: number) {
  const n = 2 ** z,
    h = new Float32Array(TILE * TILE);
  for (let j = 0; j < TILE; j++) {
    const lat = Math.atan(Math.sinh((0.5 - (y + (j + 0.5) / TILE) / n) * 2 * Math.PI)) / deg;
    for (let i = 0; i < TILE; i++) h[j * TILE + i] = field(lat, ((x + (i + 0.5) / TILE) / n) * 360 - 180) + z;
  }
  return h;
}
function fill(t: EarthTiles) {
  for (const [z, x, y] of t.wanted()) t.put(z, x, y, tileOf(z, x, y));
}
/** a writing device: each writeTexture's words kept by the texture's origin */
function recording() {
  const writes: { origin: number[]; data: Uint32Array }[] = [];
  const dev = withGpuStubs({
    createTexture: (d: { size: number[] }) => ({ size: d.size, destroy() {} }),
    queue: {
      writeTexture(dst: { origin: number[] }, data: Uint32Array) {
        writes.push({ origin: [...dst.origin], data: new Uint32Array(data) });
      },
      onSubmittedWorkDone: () => Promise.resolve(),
    },
  } as unknown as GPUDevice);
  return { dev, writes };
}
const fakeDevice = () =>
  withGpuStubs({
    createTexture: (d: { size: number[] }) => ({ size: d.size, destroy() {} }),
    queue: { writeTexture() {}, onSubmittedWorkDone: () => Promise.resolve() },
  } as unknown as GPUDevice);

// (a craft 300 m over the Chamonix valley — France: the IGN's z 17 its contact level)
const CRAFT = [45.912, 6.868] as const;
const craft = () => ({ c: camAt(CRAFT[0], CRAFT[1], 1300), agl: 300 });

test("the contact level: the IGN's z 17 in its box with its relief on, the global data's z 14 elsewhere — never the camera's", () => {
  const t = new EarthTiles(fakeDevice());
  expect(t.contactLevel(45.9, 6.87)).toBe(Z1);
  expect(t.contactLevel(10, 100)).toBe(ZG1);
  t.reliefOn = false;
  expect(t.contactLevel(45.9, 6.87)).toBe(ZG1);
  t.reliefOn = true;
  t.held = () => ({ reliefZ1: 16, orthoZ1: 18 });
  expect(t.contactLevel(45.9, 6.87)).toBe(16);
});

test("the camera in the cockpit: the contact is the drawn ground (the CPU's = the GPU's), the craft's tiles held from the windows", () => {
  const t = published(new EarthTiles(fakeDevice()));
  t.update(camAt(CRAFT[0], CRAFT[1], 1300), 1e-3, [0, 0, 0], [0, 0, 0], 300);
  fill(t);
  t.setAnchors([craft()]);
  // (every tile round the craft taken from the windows' slots — the same arrays, no load)
  expect(t.contactStats.tiles).toBeGreaterThan(0);
  expect(t.contactStats.held).toBe(t.contactStats.tiles);
  expect(t.contactStats.loads).toBe(0);
  const q = dir(CRAFT[0], CRAFT[1]);
  const drawn = t.heightAt(q, 0.05);
  const g = t.groundAt(q, 0.05);
  expect(drawn.z).toBe(Z1);
  expect(drawn.zw).toBe(1);
  // (the very same sample: the drawn ground holds the contact level in full)
  expect(g).toEqual(drawn);
  expect(t.contactAt(CRAFT[0], CRAFT[1]).src).toBe("drawn");
});

test("the camera 5 km off: the drawn ground under the craft coarser, the contact the same z 17 ground as from the cockpit", () => {
  const t = published(new EarthTiles(fakeDevice()));
  t.update(camAt(CRAFT[0], CRAFT[1], 1300), 1e-3, [0, 0, 0], [0, 0, 0], 300);
  fill(t);
  t.setAnchors([craft()]);
  const q = dir(CRAFT[0], CRAFT[1]);
  const ref = t.groundAt(q, 0.05);
  expect(ref.z).toBe(Z1);
  // (the camera 5 km east, as high: its windows follow it — the craft's tile out of the fine levels)
  const far = camAt(CRAFT[0], CRAFT[1] + 0.065, 1300);
  for (let i = 0; i < 3; i++) {
    t.update(far, 1e-3, [0, 0, 0], [0, 0, 0], 300);
    fill(t);
    t.setAnchors([craft()]);
  }
  const drawn = t.heightAt(q, 0.05);
  expect(drawn.z).toBeLessThan(Z1);
  // (the drawn ground a coarser level's — its heights + z: metres off; the contact the cockpit's to the nanometre — the same texels,
  // read from the tile's corner instead of the window's)
  expect(Math.abs(drawn.h - ref.h)).toBeGreaterThan(0.5);
  const g = t.groundAt(q, 0.05);
  expect(g.z).toBe(Z1);
  expect(g.h).toBeCloseTo(ref.h, 6);
  expect(g.res).toBe(ref.res);
  const c = t.contactAt(CRAFT[0], CRAFT[1]);
  expect(c.src).toBe("anchor");
  expect(c.contactZ).toBe(Z1);
  // (a point 3 km from the craft: no held tile there — the drawn ground)
  const q2 = dir(CRAFT[0], CRAFT[1] + 0.04);
  expect(t.groundAt(q2, 0.05)).toEqual(t.heightAt(q2, 0.05));
});

test("the craft's tiles that no window wants loaded into the world's memory, kept as they arrive, the contact from them", () => {
  const t = published(new EarthTiles(fakeDevice()));
  // (the camera 8 km off from the start)
  const far = camAt(CRAFT[0] + 0.07, CRAFT[1], 1300);
  t.update(far, 1e-3, [0, 0, 0], [0, 0, 0], 300);
  fill(t);
  t.setAnchors([craft()]);
  expect(t.contactStats.tiles).toBeGreaterThan(0);
  expect(t.contactStats.held).toBe(0);
  expect(t.contactStats.loads).toBe(t.contactStats.tiles);
  const q = dir(CRAFT[0], CRAFT[1]);
  // (none in: the drawn ground, coarse)
  expect(t.groundAt(q, 0.05)).toEqual(t.heightAt(q, 0.05));
  // (the camera far: the windows cleared — the craft's loads kept)
  const inflight = (t as unknown as { inflight: Map<string, AbortController> }).inflight;
  const keys = [...(t as unknown as { anchorTiles: Map<string, unknown> }).anchorTiles.keys()];
  expect(keys.length).toBe(t.contactStats.tiles);
  for (const k of keys) expect(inflight.has(k)).toBe(true);
  t.update(null, 1e-3);
  for (const k of keys) {
    expect(inflight.has(k)).toBe(true);
    expect(inflight.get(k)!.signal.aborted).toBe(false);
  }
  // (they arrive — put by hand, out of every window: kept for the craft alone)
  for (const k of keys) {
    const [z, x, y] = k.split("/").map(Number) as [number, number, number];
    t.put(z, x, y, tileOf(z, x, y));
  }
  t.setAnchors([craft()]);
  expect(t.contactStats.held).toBe(t.contactStats.tiles);
  const g = t.groundAt(q, 0.05);
  expect(g.z).toBe(Z1);
  expect(g.rem).toBe(0);
  // (the level's own field, + 17 m: within the cubic's error of a 1 m texel)
  expect(Math.abs(g.h - (field(CRAFT[0], CRAFT[1]) + Z1))).toBeLessThan(0.5);
});

test("a craft high over the ground (≥ ANCHOR_AGL_M) or none: nothing held, the contact the drawn ground", () => {
  const t = published(new EarthTiles(fakeDevice()));
  t.update(camAt(CRAFT[0] + 0.07, CRAFT[1], 1300), 1e-3, [0, 0, 0], [0, 0, 0], 300);
  fill(t);
  t.setAnchors([{ c: camAt(CRAFT[0], CRAFT[1], 1000 + ANCHOR_AGL_M + 10), agl: ANCHOR_AGL_M + 10 }]);
  expect(t.contactStats.tiles).toBe(0);
  const q = dir(CRAFT[0], CRAFT[1]);
  expect(t.groundAt(q, 0.05)).toEqual(t.heightAt(q, 0.05));
  t.setAnchors([]);
  expect(t.contactStats.anchors).toBe(0);
});

test("led along the craft's motion: the tiles where it will be in 3 s held too", () => {
  const t = new EarthTiles(fakeDevice());
  const lat = CRAFT[0];
  const n = 2 ** Z1;
  // (eastward at ~140 m/s: 0.0018° a second at 45.9°)
  const lonAt = (s: number) => CRAFT[1] + 0.0018 * s;
  const realNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    for (let i = 0; i <= 20; i++) {
      now = 1000 + i * 50;
      t.setAnchors([{ c: camAt(lat, lonAt(i * 0.05), 1300), agl: 300 }]);
    }
  } finally {
    performance.now = realNow;
  }
  const xs = [...(t as unknown as { anchorTiles: Map<string, unknown> }).anchorTiles.keys()].map((k) => Number(k.split("/")[1]));
  const xNow = Math.floor(((lonAt(1) + 180) / 360) * n);
  const xAhead = Math.floor(((lonAt(1 + 3) + 180) / 360) * n);
  expect(xAhead).toBeGreaterThan(xNow);
  expect(Math.max(...xs)).toBeGreaterThanOrEqual(xAhead - 1);
  expect(Math.max(...xs)).toBeGreaterThan(xNow);
});

test("the contact's choice: the drawn ground wherever it holds the contact's level in full, the held tiles else", () => {
  const a = { h: 1, res: 1, rem: 0, z: 17, zw: 1 };
  expect(contactOf({ h: 2, res: 1, rem: 0, z: 17, zw: 1 }, a).h).toBe(2);
  expect(contactOf({ h: 2, res: 1, rem: 0, z: 17, zw: 0.5 }, a).h).toBe(1);
  expect(contactOf({ h: 2, res: 1, rem: 0, z: 15, zw: 1 }, a).h).toBe(1);
  expect(contactOf({ h: 2, res: 1, rem: 0, z: 15, zw: 1 }, null).h).toBe(2);
});

test("heightAt reads the words the GPU holds: each published page's texels the bits of the heights the CPU samples", () => {
  const { dev, writes } = recording();
  const t = published(new EarthTiles(dev));
  t.update(camAt(CRAFT[0], CRAFT[1], 1300), 1e-3, [0, 0, 0], [0, 0, 0], 300);
  fill(t);
  const L = (t as unknown as { levels: { z: number; pubData: (Float32Array | null)[] }[] }).levels[Z1 - Z0]!;
  // (every page of z 17 published: its words among the writes, bit for bit)
  const pages = L.pubData.filter((d): d is Float32Array => !!d);
  expect(pages.length).toBe(16);
  for (const d of pages) {
    const bits = new Uint32Array(d.buffer, d.byteOffset, TILE * TILE);
    // (the heights alone where the imagery is filtered — r32uint —, interleaved with it else: every per-th word)
    const w = writes.find((x) => {
      const per = x.data.length / (TILE * TILE);
      return (per === 1 || per === 2) && x.data[0] === bits[0] && x.data[per * (TILE * TILE - 1)] === bits[TILE * TILE - 1];
    });
    expect(w).toBeDefined();
    const per = w!.data.length / (TILE * TILE);
    expect(Array.from({ length: TILE * TILE }, (_, i) => w!.data[per * i]!)).toEqual(Array.from(bits));
  }
});

test("the sources switched: a craft's held tiles kept its ground until the new ones are in", () => {
  const t = published(new EarthTiles(fakeDevice()));
  t.update(camAt(CRAFT[0] + 0.07, CRAFT[1], 1300), 1e-3, [0, 0, 0], [0, 0, 0], 300);
  fill(t);
  t.setAnchors([craft()]);
  for (const k of (t as unknown as { anchorTiles: Map<string, unknown> }).anchorTiles.keys()) {
    const [z, x, y] = k.split("/").map(Number) as [number, number, number];
    t.put(z, x, y, tileOf(z, x, y));
  }
  t.setAnchors([craft()]);
  const q = dir(CRAFT[0], CRAFT[1]);
  const before = t.groundAt(q, 0.05);
  expect(before.z).toBe(Z1);
  // (the orthophotos switched: every source's tile taken again — the craft's asked again, its old ones its ground meanwhile)
  t.orthoOn = false;
  t.update(camAt(CRAFT[0] + 0.07, CRAFT[1], 1300), 1e-3, [0, 0, 0], [0, 0, 0], 300);
  t.setAnchors([craft()]);
  expect(t.contactStats.held).toBe(0);
  expect(t.contactStats.loads).toBeGreaterThan(0);
  expect(t.groundAt(q, 0.05)).toEqual(before);
});

test("two crafts held — the flown one and the one the camera follows —: each led along its own motion, a jump teaching none", () => {
  const t = new EarthTiles(fakeDevice());
  const n = 2 ** Z1;
  const xOf = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const keys = () => [...(t as unknown as { anchorTiles: Map<string, unknown> }).anchorTiles.keys()].map((k) => k.split("/").map(Number));
  const realNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  // (the flown craft still at 45.912° 6.868°; the followed airliner 5 km south, eastward at ~140 m/s)
  const ship = { c: camAt(CRAFT[0], CRAFT[1], 1300), agl: 300, id: "ship" };
  const subLon = (s: number) => CRAFT[1] + 0.0018 * s;
  try {
    for (let i = 0; i <= 20; i++) {
      now = 1000 + i * 50;
      t.setAnchors([ship, { c: camAt(CRAFT[0] - 0.045, subLon(i * 0.05), 1300), agl: 300, id: "subject" }]);
    }
    const yShip = Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + (CRAFT[0] * Math.PI) / 360)) / Math.PI) / 2) * n);
    const shipXs = keys()
      .filter((k) => k[2] === yShip)
      .map((k) => k[1]!);
    const subXs = keys()
      .filter((k) => k[2] !== yShip)
      .map((k) => k[1]!);
    // (the flown craft: its own tile alone — still, no lead lent by the other)
    expect(Math.max(...shipXs) - Math.min(...shipXs)).toBeLessThanOrEqual(1);
    expect(Math.max(...shipXs)).toBeLessThanOrEqual(xOf(CRAFT[1]) + 1);
    // (the followed one: its tiles ahead too)
    expect(Math.max(...subXs)).toBeGreaterThan(xOf(subLon(1)));
    // (placed 5 km away at once: no motion learnt from the jump — its own tile alone)
    now += 50;
    t.setAnchors([ship, { c: camAt(CRAFT[0] - 0.045, CRAFT[1] + 0.07, 1300), agl: 300, id: "subject" }]);
    now += 50;
    t.setAnchors([ship, { c: camAt(CRAFT[0] - 0.045, CRAFT[1] + 0.07, 1300), agl: 300, id: "subject" }]);
    const sub2 = keys()
      .filter((k) => k[2] !== yShip)
      .map((k) => k[1]!);
    expect(Math.max(...sub2) - Math.min(...sub2)).toBeLessThanOrEqual(1);
    // (the camera follows none: the flown craft's alone, its place kept)
    t.setAnchors([ship]);
    expect(t.contactStats.anchors).toBe(1);
  } finally {
    performance.now = realNow;
  }
});
