import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { tileKind, zoneRelease } from "../src/pwa/rules";
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
import { EarthScenery } from "../src/system/scenery";
import { DETAIL_REACH, type SceneryRequest } from "../src/system/scenery-data";
import { sceneryChains } from "../src/system/scenery-sources";
import { aheadFocus, gazeLead, streamingLead } from "../src/system/streaming-focus";
import {
  reliefChains,
  reliefUrls,
  sceneryZoneChains,
  ZONE_CORE,
  ZONE_PROFILES,
  zoneChains,
  zoneDistance,
  zoneDuration,
  zoneEstimate,
  zoneLevelsAt,
  zoneTiles,
  zoneUrls,
} from "../src/system/zones";

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

test("a low flight at 400 m over the ground: the z 18 orthophotos it asks within the core in the zone, none outside it offline", () => {
  const lat0 = 45.92,
    lon0 = 6.87,
    radius = 3000,
    core = 1500,
    profile = ZONE_PROFILES.low;
  const zone = {
    lat: lat0,
    lon: lon0,
    radiusKm: radius / 1000,
    profile: "low",
    coreKm: core / 1000,
    sources: { ortho: true, relief: true },
  };
  const z = zoneTiles(lat0, lon0, radius, profile, 4, true, core);
  const key = (v: readonly number[]) => v.join("/");
  const relief = new Set(z.relief.map(key)),
    ortho = new Set(z.ortho.map(key));
  // (the core's levels held to its radius, the profile's to the zone's)
  expect(Math.max(...z.ortho.map((v) => v[0]))).toBe(ZONE_CORE.orthoZ1);
  expect(Math.max(...z.relief.map((v) => v[0]))).toBe(ZONE_CORE.reliefZ1);
  const n18 = z.ortho.filter((v) => v[0] === 18).length;
  expect(n18).toBeLessThan(z.ortho.filter((v) => v[0] === 17).length * 4);
  expect(zoneTiles(lat0, lon0, radius, profile, 4, true).ortho.some((v) => v[0] === 18)).toBe(false);
  // (flown straight across the zone every 45°, a sample every 25 m, 400 m over the ground — full screen, a pixel 0.4 or
  // 1 mrad —, looking every way: the windows led to their most, recentred as they go)
  const fly = (offline: boolean, pix: number, a: number, gazeA: number) => {
    const t = new EarthTiles(fakeDevice());
    if (offline) t.held = (la, lo) => zoneLevelsAt([zone], la, lo);
    const got = { core18: 0, out18: 0, outside: [] as string[], inCore: [] as string[] };
    for (let s = -radius; s <= radius; s += 25) {
      const [la1, lo1] = north(lat0, lon0, s * Math.cos(a * D));
      const [la, lo] = east(la1, lo1, s * Math.sin(a * D));
      const d = zoneDistance(lat0, lon0, la, lo);
      if (d > radius) continue;
      const gaze = [Math.cos(gazeA * D) * 0.01, Math.sin(gazeA * D) * 0.01, 0.005] as Vec3;
      t.update(camAt(la, lo, 1500), pix, [0, 0, 0], gaze, 400);
      for (const w of t.orthoWanted()) {
        const inZone = ortho.has(key(w));
        if (w[0] === 18) d <= core ? got.core18++ : got.out18++;
        if (!inZone) (d <= core ? got.inCore : got.outside).push(`o${key(w)}`);
      }
      for (const w of t.wanted()) if (!relief.has(key(w))) (d <= core ? got.inCore : got.outside).push(`r${key(w)}`);
    }
    return got;
  };
  let core18 = 0;
  for (const pix of [4e-4, 1e-3])
    for (const a of [0, 45, 90, 135, 180, 225, 270, 315])
      for (const g of [0, 90, 180, 270]) {
        // (online: within the core, everything it asks in the zone; past it the z 18 the network's)
        const on = fly(false, pix, a, g);
        expect(on.inCore).toEqual([]);
        expect(on.out18).toBeGreaterThan(0);
        expect(on.outside.length).toBeGreaterThan(0);
        core18 += on.core18;
        // (offline: within the core the same, past it nothing finer than the profile's — every tile asked in the zone)
        const off = fly(true, pix, a, g);
        expect(off.inCore).toEqual([]);
        expect(off.outside).toEqual([]);
        expect(off.out18).toBe(0);
        expect(off.core18).toBe(on.core18);
      }
  expect(core18).toBeGreaterThan(1000);
  // (out of every zone, no cap: the automatic cache's chance)
  expect(zoneLevelsAt([zone], lat0 + 0.05, lon0)).toBeNull();
  expect(zoneLevelsAt([zone], lat0, lon0)).toEqual({ reliefZ1: 17, orthoZ1: 18 });
  expect(zoneLevelsAt([{ ...zone, sources: { ortho: false, relief: false } }], lat0, lon0)).toEqual({ reliefZ1: 14, orthoZ1: 14 });
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

// (the scenes a flight asks — EarthScenery's own requests, its worker a recorder —: the camera within the zone, its scene
// led where it looks or by its motion as renderer.ts leads it; every fetch of each scene — scenery-sources.ts sceneryChains,
// the worker's — in the zone)
function sceneryAsked(lat0: number, lon0: number, radius: number, mode: "balanced" | "high", reach: number, ign: boolean) {
  (globalThis as { GPUBufferUsage?: unknown }).GPUBufferUsage ??= { STORAGE: 128, COPY_DST: 8 };
  const device = {
    limits: { maxStorageBuffersPerShaderStage: 9 },
    createBuffer: () => ({ destroy() {} }),
    queue: { writeBuffer() {}, onSubmittedWorkDone: () => Promise.resolve() },
  } as unknown as GPUDevice;
  const asked: SceneryRequest[] = [];
  const recorder = () =>
    ({
      terminate() {},
      postMessage: (q: SceneryRequest) => asked.push(q),
    }) as unknown as Worker;
  const lead = 0.6 * (mode === "high" ? 3000 : 2000) * reach;
  for (let r = 0; r <= radius; r += radius / 3)
    for (let a = 0; a < 360; a += r ? 30 : 360) {
      const [la1, lo1] = north(lat0, lon0, r * Math.cos(a * D));
      const [la, lo] = east(la1, lo1, r * Math.sin(a * D));
      for (const h of [300, 1500])
        for (let g = 0; g < 360; g += 45) {
          const eye = camAt(la, lo, h);
          // (the view's direction on the Earth's axes: level or a little down, toward bearing g)
          const up = [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
          const e = [-Math.sin(lo * D), Math.cos(lo * D), 0],
            n = [-Math.sin(la * D) * Math.cos(lo * D), -Math.sin(la * D) * Math.sin(lo * D), Math.cos(la * D)];
          const dir = [0, 1, 2].map((i) => Math.sin(g * D) * e[i]! + Math.cos(g * D) * n[i]! - 0.05 * up[i]!) as Vec3;
          const velocity = [0, 1, 2].map((i) => 250 * dir[i]!) as Vec3;
          for (const ahead of [gazeLead(eye, dir, h, lead), streamingLead(eye, velocity)]) {
            const s0 = new EarthScenery(device, recorder);
            s0.ign = ign;
            s0.update(eye, mode, true, true, [], aheadFocus(eye, ahead), reach);
          }
        }
    }
  return asked;
}

test("a zone's scenery: every fetch of every scene the game asks with the camera anywhere in it — any gaze, any course", () => {
  const sources = (mode: "balanced" | "high", reach: number) => ({
    ortho: true,
    relief: true,
    hlod: false,
    span: 8,
    scenery: { mode, satellite: true, reach },
  });
  for (const [where, lat0, lon0, radius, mode, reach, kinds] of [
    // (the bocage at Saint-Lô: the IGN's canopy and ground blocks, its BD TOPO's buildings)
    ["Saint-Lô", 49.116, -1.09, 2000, "high", DETAIL_REACH.veryFar, ["terrascope", "openfreemap", "terrarium", "MNH", "BDTOPO"]],
    // (Lauterbrunnen: swisstopo's ground under the trees)
    ["Lauterbrunnen", 46.59, 7.91, 1500, "balanced", DETAIL_REACH.normal, ["terrascope", "openfreemap", ".terrain"]],
    // (Bavaria: no survey, the land cover's and OSM's alone)
    ["Garmisch", 47.49, 11.1, 1500, "high", DETAIL_REACH.far, ["terrascope", "openfreemap", "terrarium"]],
    // (Taveuni, on the date line: the cells, the tiles wrapped)
    ["Taveuni", -16.8, 179.99, 1500, "balanced", DETAIL_REACH.normal, ["terrascope", "openfreemap", "terrarium"]],
  ] as const) {
    const urls = new Set(zoneUrls(lat0, lon0, radius, ZONE_PROFILES.low, sources(mode, reach)));
    const asked = sceneryAsked(lat0, lon0, radius, mode, reach, true);
    expect(asked.length).toBeGreaterThan(100);
    const wanted = new Set<string>();
    for (const q of asked)
      for (const c of sceneryChains({ lat: q.lat, lon: q.lon, mode, satellite: q.satellite, reach: q.reach ?? 1, ign: !!q.ign }))
        for (const u of c) wanted.add(u);
    const missing = [...wanted].filter((u) => !urls.has(u));
    if (missing.length) console.log(where, missing.length, missing.slice(0, 3));
    expect(missing).toEqual([]);
    for (const k of kinds) expect([...wanted].some((u) => u.includes(k))).toBe(true);
    // (the zone not much more than its scenes: every source's tiles within a few of theirs)
    const extra = [...urls].filter((u) => !wanted.has(u) && /terrascope|openfreemap|BDTOPO|MNH/.test(u)).length;
    const theirs = [...wanted].filter((u) => /terrascope|openfreemap|BDTOPO|MNH/.test(u)).length;
    expect(extra).toBeLessThan(0.6 * theirs);
  }
  // (its kinds told apart in the caches' figures, its size counted)
  const sl = zoneChains(49.116, -1.09, 2000, ZONE_PROFILES.low, sources("high", DETAIL_REACH.veryFar));
  const kinds = new Set(sl.flat().map(tileKind));
  for (const k of ["canopy", "osm", "buildings", "cover", "relief"] as const) expect(kinds.has(k)).toBe(true);
  const bare0 = zoneChains(49.116, -1.09, 2000, ZONE_PROFILES.low, { ...sources("high", 2), scenery: null });
  // (the scenery high, very far, at Saint-Lô: some 300 MB over the ground's — its canopy's blocks, the BD TOPO's tiles)
  const more = zoneEstimate(sl) - zoneEstimate(bare0);
  expect(more).toBeGreaterThan(150e6);
  expect(more).toBeLessThan(600e6);
  // (a scene's Terrarium met first as the relief's last fallback — under the IGN's grids, maybe never asked — kept as its
  // own chain all the same)
  const first = new Set(sl.map((c) => c[0]!));
  const fallbacks = new Set(sl.flatMap((c) => c.slice(1)));
  const sceneDem = sceneryZoneChains(49.116, -1.09, 2000, { mode: "high", satellite: true, reach: DETAIL_REACH.veryFar }, true)
    .flat()
    .filter((u) => u.includes("terrarium/"));
  expect(sceneDem.length).toBeGreaterThan(0);
  for (const u of sceneDem) expect(first.has(u)).toBe(true);
  expect(sceneDem.some((u) => fallbacks.has(u))).toBe(true);
  // (the scenery off, or not asked: none of its sources)
  const bare = zoneUrls(49.116, -1.09, 2000, ZONE_PROFILES.low, { ortho: true, relief: true, hlod: false, scenery: null });
  expect(bare.some((u) => /terrascope|openfreemap|BDTOPO|MNH/.test(u))).toBe(false);
  // (the IGN's relief off: its survey's and buildings' left out, as the worker leaves them)
  const noIgn = zoneUrls(49.116, -1.09, 2000, ZONE_PROFILES.low, { ...sources("balanced", 1), relief: false });
  expect(noIgn.some((u) => /BDTOPO|MNH/.test(u))).toBe(false);
  expect(noIgn.some((u) => /openfreemap/.test(u))).toBe(true);
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
  expect(new Set(chains.flat()).size).toBe(urls.length);
  // (each link first in one chain at most: asked once where it is sure to be)
  const firsts = chains.map((c) => c[0]!);
  expect(new Set(firsts).size).toBe(firsts.length);
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
