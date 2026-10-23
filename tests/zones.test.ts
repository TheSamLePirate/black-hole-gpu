import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { zoneRelease } from "../src/pwa/rules";
import {
  EarthTiles,
  eoxUrl,
  IGN_LIDAR,
  IGN_MNS_LIDAR,
  IGN_RGEALTI,
  ignHeightUrl,
  nightUrl,
  orthoUrl,
  TILE_REACH,
  tileUrl,
} from "../src/system/earth-tiles";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { swissimageUrl } from "../src/system/national";
import { reliefChains, reliefUrls, ZONE_PROFILES, zoneChains, zoneDuration, zoneEstimate, zoneTiles, zoneUrls } from "../src/system/zones";

// (no GPU: the textures a stub; the network a recorder refusing every request — the URLs the loads ask, kept)
(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2 };
const asked = new Set<string>();
globalThis.fetch = ((url: string | URL | Request) => {
  asked.add(String(url instanceof Request ? url.url : url));
  return Promise.reject(new Error("offline"));
}) as unknown as typeof fetch;
const fakeDevice = () =>
  ({
    createTexture: (d: { size: number[] }) => ({ size: d.size, destroy() {} }),
    queue: { writeTexture() {}, onSubmittedWorkDone: () => Promise.resolve() },
  }) as unknown as GPUDevice;
const D = Math.PI / 180;
const camAt = (lat: number, lon: number, h: number): Vec3 => geodeticToCart(1, WGS84_F, lat * D, lon * D, h / WGS84_A);
const east = (lat: number, lon: number, m: number): [number, number] => [lat, lon + m / (111_195 * Math.cos(lat * D))];
const north = (lat: number, lon: number, m: number): [number, number] => [lat + m / 111_195, lon];

test("a zone's tiles: every one the game's windows want with the camera anywhere in it — the farthest reach, any gaze", () => {
  const lat0 = 45.92,
    lon0 = 6.87,
    radius = 3000,
    profile = ZONE_PROFILES.airport;
  const z = zoneTiles(lat0, lon0, radius, profile);
  const key = (v: readonly number[]) => v.join("/");
  const relief = new Set(z.relief.map(key)),
    ortho = new Set(z.ortho.map(key));
  const t = new EarthTiles(fakeDevice());
  t.setReach(TILE_REACH.veryFar);
  let wanted = 0;
  // (the camera at the centre, on the rim, half-way, low and higher; looking every way: its windows led up to their most)
  for (const [dn, de] of [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
    [0.7 * radius, 0.7 * radius],
    [-0.5 * radius, 0.3 * radius],
  ])
    for (const h of [1200, 1500, 3000])
      for (const a of [0, 90, 180, 270]) {
        const [la1, lo1] = north(lat0, lon0, dn!);
        const [la, lo] = east(la1, lo1, de!);
        const c = camAt(la, lo, h);
        const gaze = [Math.cos(a * D) * 0.01, Math.sin(a * D) * 0.01, 0.005] as Vec3;
        t.update(c, 2e-4, [0, 0, 0], gaze, h - 1000);
        for (const w of t.wanted()) {
          wanted++;
          expect(relief.has(key(w))).toBe(true);
        }
        for (const w of t.orthoWanted()) expect(ortho.has(key(w))).toBe(true);
      }
  expect(wanted).toBeGreaterThan(1000);
  // (the finer levels and the orthophotos to the profile's)
  expect(Math.max(...z.relief.map((v) => v[0]))).toBe(profile.reliefZ1);
  expect(Math.max(...z.ortho.map((v) => v[0]))).toBe(profile.orthoZ1);
});

test("a zone's URLs: every one the loads ask in flight within it is in the zone's list", async () => {
  asked.clear();
  const lat0 = 45.92,
    lon0 = 6.87,
    radius = 2000;
  // (the airfield's profile: down to the orthophotos' z 18 a flight at 400 m asks)
  const urls = new Set(zoneUrls(lat0, lon0, radius, ZONE_PROFILES.airport, { ortho: true, relief: true, hlod: true }));
  const t = new EarthTiles(fakeDevice());
  // (flown across the zone, the loads refused: each tile asked once — its first URLs —, the windows moving on)
  for (let k = 0; k <= 40; k++) {
    const [la, lo] = east(lat0, lon0, -radius + (2 * radius * k) / 40);
    t.update(camAt(la, lo, 1400), 3e-4, [0, 0, 0], [0, 0, 0], 400);
    await new Promise((r) => setTimeout(r, 5));
  }
  const tiles = [...asked].filter((u) => !u.includes("3d.geo.admin.ch"));
  expect(tiles.length).toBeGreaterThan(50);
  const missing = tiles.filter((u) => !urls.has(u));
  expect(missing).toEqual([]);
});

test("a tile's URLs: its source's heights and their fallbacks, the global data's, its imagery and lights — the loads' own", () => {
  const o = { ortho: true, relief: true, hlod: true };
  // (a French z 16: the LiDAR, RGE ALTI under it, Terrarium's z 15 parent)
  const n16 = 2 ** 16,
    x = Math.floor(((6.87 + 180) / 360) * n16),
    y = Math.floor(((1 - Math.asinh(Math.tan(45.92 * D)) / Math.PI) / 2) * n16);
  const u16 = reliefUrls(16, x, y, o);
  expect(u16).toContain(ignHeightUrl(IGN_LIDAR, 16, x, y));
  expect(u16).toContain(ignHeightUrl(IGN_RGEALTI, 16, x, y));
  expect(u16).toContain(tileUrl(15, x >> 1, y >> 1));
  // (a z 12: the overground's surface at 512², the orthophotos and EOX's, the lights' z 8 parent)
  const x12 = x >> 4,
    y12 = y >> 4;
  const u12 = reliefUrls(12, x12, y12, o);
  expect(u12).toContain(ignHeightUrl(IGN_MNS_LIDAR, 12, x12, y12, 512));
  expect(u12).toContain(orthoUrl(12, x12, y12));
  expect(u12).toContain(eoxUrl(12, x12, y12));
  expect(u12).toContain(nightUrl(8, x12 >> 4, y12 >> 4));
  // (the surveys off: Terrarium's and EOX's alone)
  const off = reliefUrls(12, x12, y12, { ortho: false, relief: false, hlod: false });
  expect(off.some((u) => u.includes("geopf"))).toBe(false);
  // (Switzerland's: SWISSIMAGE and the terrain's meshes)
  const xs = Math.floor(((7.9625 + 180) / 360) * 4096),
    ys = Math.floor(((1 - Math.asinh(Math.tan(46.5367 * D)) / Math.PI) / 2) * 4096);
  const us = reliefUrls(12, xs, ys, o);
  expect(us).toContain(swissimageUrl(12, xs, ys));
  expect(us.some((u) => u.includes("3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/20250101/11/"))).toBe(true);
});

test("a zone's size, and a zone dropped: its tiles no other holds deleted, the shared ones kept for the others", () => {
  const urls = zoneUrls(45.92, 6.87, 5000, ZONE_PROFILES.airport, { ortho: true, relief: true, hlod: false });
  // (an airfield's 5 km: its relief's and orthophotos' tiles, their windows' margin round the disc — ~20 000 chains)
  expect(urls.length).toBeGreaterThan(15000);
  expect(urls.length).toBeLessThan(45000);
  expect(new Set(urls).size).toBe(urls.length);
  const chains = zoneChains(45.92, 6.87, 5000, ZONE_PROFILES.airport, { ortho: true, relief: true, hlod: false });
  expect(chains.flat().length).toBe(urls.length);
  expect(zoneEstimate(chains)).toBeGreaterThan(100e6);
  const { drop, keep } = zoneRelease(
    [
      { url: "a", zones: ["z1"], size: 1 },
      { url: "b", zones: ["z1", "z2"], size: 1 },
      { url: "c", zones: ["z2"], size: 1 },
    ],
    "z1",
  );
  expect(drop).toEqual(["a"]);
  expect(keep).toEqual([{ url: "b", zones: ["z2"], size: 1 }]);
});

test("a tile's chains: the next link asked only where the one before falls short — the loads' own order", () => {
  const o = { ortho: true, relief: true, hlod: true };
  const n16 = 2 ** 16,
    x = Math.floor(((6.87 + 180) / 360) * n16),
    y = Math.floor(((1 - Math.asinh(Math.tan(45.92 * D)) / Math.PI) / 2) * n16);
  // (the LiDAR, RGE ALTI in its holes, Terrarium in theirs)
  expect(reliefChains(16, x, y, o)).toEqual([
    [ignHeightUrl(IGN_LIDAR, 16, x, y), ignHeightUrl(IGN_RGEALTI, 16, x, y), tileUrl(15, x >> 1, y >> 1)],
  ]);
  // (a z 12: its ground's chain, its surface's — the LiDAR's, RGE ALTI's past a fiftieth of holes —, the orthophoto over
  // EOX's, the lights)
  const c12 = reliefChains(12, x >> 4, y >> 4, o);
  expect(c12[0]![0]).toBe(ignHeightUrl(IGN_RGEALTI, 12, x >> 4, y >> 4));
  expect(c12[1]![0]).toBe(ignHeightUrl(IGN_MNS_LIDAR, 12, x >> 4, y >> 4, 512));
  expect(c12[2]).toEqual([orthoUrl(12, x >> 4, y >> 4), eoxUrl(12, x >> 4, y >> 4)]);
  expect(c12[3]).toEqual([nightUrl(8, x >> 8, y >> 8)]);
  // (Switzerland's meshes each their own: one or two wanted together, Terrarium beside)
  const xs = Math.floor(((7.9625 + 180) / 360) * 4096),
    ys = Math.floor(((1 - Math.asinh(Math.tan(46.5367 * D)) / Math.PI) / 2) * 4096);
  const cs = reliefChains(12, xs, ys, o);
  const meshes = cs.filter((c) => c[0]!.includes(".terrain"));
  expect(meshes.length).toBeGreaterThanOrEqual(1);
  for (const c of meshes) expect(c.length).toBe(1);
  expect(cs).toContainEqual([tileUrl(12, xs, ys)]);
});

test("a zone's download time: the WMS-R's grids 5 a second, the rest 35 chains a second, the two at once", () => {
  expect(zoneDuration([])).toBe(0);
  const wms = Array.from({ length: 50 }, () => ["https://data.geopf.fr/wms-r?REQUEST=GetMap"]);
  const rest = Array.from({ length: 350 }, () => ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/1/2.png"]);
  expect(zoneDuration(wms)).toBeCloseTo(10);
  expect(zoneDuration(rest)).toBeCloseTo(10);
  expect(zoneDuration([...wms, ...rest, ...rest])).toBeCloseTo(20);
});
