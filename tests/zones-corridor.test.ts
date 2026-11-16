import { expect, test } from "bun:test";
import { corridorDisc, corridorDistance, ZONE_CORE, ZONE_PROFILES, zoneLevelsAt, zoneTiles } from "../src/system/zones";

// PLAN-J8 J8-9 (2) — a zone's corridor (Sam, 16 Nov 2026: « ok couloir »; src/system/zones.ts): the airfield's levels (ZONE_CORE) along a
// track, half-width either side, the profile elsewhere in its disc; the disc it needs; the levels the game keeps to offline there.

// (a track across Paris — J8-A's own is system/j8a-tracks.ts —)
const COR = {
  points: [
    [48.898, 2.095],
    [48.858, 2.294],
    [48.853, 2.35],
  ] as [number, number][],
  halfWidthM: 1000,
};

test("a corridor's distance: on the track 0, a kilometre off it ~1 000 m, past its end measured to the end", () => {
  const d = corridorDisc(COR);
  expect(corridorDistance(d.lat, d.lon, COR, 48.858, 2.294)).toBeLessThan(1);
  // (0.009° — 1 km — north of the last segment where it passes 2.33° E, at 48.8548°: almost east–west)
  const off = corridorDistance(d.lat, d.lon, COR, 48.8548 + 0.009, 2.33);
  expect(off).toBeGreaterThan(950);
  expect(off).toBeLessThan(1010);
  expect(corridorDistance(d.lat, d.lon, COR, 48.853, 2.37)).toBeGreaterThan(1300);
});

test("the disc a corridor needs holds every point with its half-width", () => {
  const d = corridorDisc(COR);
  expect(d.radius).toBeGreaterThan(9000);
  expect(d.radius).toBeLessThan(12_000);
});

test("its tiles: the profile's levels over the disc, the airfield's along the track only", () => {
  const d = corridorDisc(COR);
  const flat = zoneTiles(d.lat, d.lon, d.radius, ZONE_PROFILES.overflight, 4, true, 0, null);
  const cor = zoneTiles(d.lat, d.lon, d.radius, ZONE_PROFILES.overflight, 4, true, 0, COR);
  const max = (a: [number, number, number][]) => Math.max(...a.map((t) => t[0]));
  expect(max(flat.relief)).toBe(ZONE_PROFILES.overflight.reliefZ1);
  expect(max(cor.relief)).toBe(ZONE_CORE.reliefZ1);
  expect(max(cor.ortho)).toBe(ZONE_CORE.orthoZ1);
  // (the profile's own levels the same; the finer ones far fewer than the disc's would be)
  const at = (a: [number, number, number][], z: number) => a.filter((t) => t[0] === z).length;
  expect(at(cor.relief, 14)).toBe(at(flat.relief, 14));
  const disc = zoneTiles(d.lat, d.lon, d.radius, ZONE_CORE, 4, true, 0, null);
  expect(at(cor.ortho, 18)).toBeLessThan(at(disc.ortho, 18) / 3);
});

test("offline the game keeps to the corridor's levels on the track, to the profile's off it", () => {
  const d = corridorDisc(COR);
  const zone = {
    lat: d.lat,
    lon: d.lon,
    radiusKm: d.radius / 1000,
    profile: "overflight",
    corridor: COR,
    sources: { ortho: true, relief: true },
  };
  expect(zoneLevelsAt([zone], 48.858, 2.294)).toEqual({ reliefZ1: ZONE_CORE.reliefZ1, orthoZ1: ZONE_CORE.orthoZ1 });
  expect(zoneLevelsAt([zone], 48.84, 2.2)).toEqual({
    reliefZ1: ZONE_PROFILES.overflight.reliefZ1,
    orthoZ1: ZONE_PROFILES.overflight.orthoZ1,
  });
});
