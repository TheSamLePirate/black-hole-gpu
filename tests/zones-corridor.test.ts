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

test("a corridor's sharp turns (J8-A, Bercy's ~150°): a disc of turnRadiusM round each, the fine levels and the offline cap within it", async () => {
  const { sharpTurns, turnCentres, corridorOutside, corridorDisc, CORRIDOR_TURN_M } = await import("../src/system/zones");
  // (east, then back west-north-west: ~150°; a 45° bend after it — not sharp)
  const c = {
    points: [
      [48.8, 2.3],
      [48.8, 2.4],
      [48.82, 2.33],
      [48.86, 2.33],
    ] as [number, number][],
    halfWidthM: 1000,
    turnRadiusM: 2500,
  };
  const sharp = sharpTurns(c);
  expect(sharp).toEqual([[48.8, 2.4]]);
  // (the turn's circle: in east, turning left — its centre 2 km north of the point; its far side, 2 km east and 2 km north of the point —
  // where the flight swings, out of the half-width: within the disc; 2 km south, the turn's outer side: not)
  const k = 111_320 * Math.cos((48.8 * Math.PI) / 180);
  const centres = turnCentres(c);
  expect(centres[0]![0]).toBeCloseTo(48.8 + 2000 / 111_320, 4);
  expect(centres[0]![1]).toBeCloseTo(2.4, 4);
  const d = corridorDisc(c);
  const far = [48.8 + 2000 / 111_320, 2.4 + 2000 / k] as const;
  expect(corridorOutside(d.lat, d.lon, c, far[0], far[1])).toBeLessThan(0);
  expect(corridorOutside(d.lat, d.lon, { ...c, turnRadiusM: 0 }, far[0], far[1])).toBeGreaterThan(400);
  expect(corridorOutside(d.lat, d.lon, c, 48.8 - 2000 / 111_320, 2.4)).toBeGreaterThan(0);
  // (the zone's disc holds the turn's)
  expect(d.radius).toBeGreaterThan(corridorDisc({ ...c, turnRadiusM: 0 }).radius);
  expect(CORRIDOR_TURN_M).toBeGreaterThan(2000);
});

test("a turn's radius from the track's speed: v² / (g tan 25°) + 500 m", async () => {
  const { turnRadiusFor } = await import("../src/system/zones");
  expect(turnRadiusFor(120)).toBeCloseTo(3649, -1);
  expect(turnRadiusFor(100)).toBeCloseTo(2687, -1);
  expect(turnRadiusFor(120, 0)).toBeCloseTo(3149, -1);
});
