// The Atlas's projections (game/mapproj.ts): Web Mercator and the plate carrée both ways, the terminator, the tiles.
import { expect, test } from "bun:test";
import { isNight, MERC_MAX, project, terminatorLat, tilesFor, unproject } from "../src/game/mapproj";

test("both projections, there and back; the centre; Mercator's edge", () => {
  for (const k of ["mercator", "equirect"] as const)
    for (const [lat, lon] of [
      [48.8566, 2.3522],
      [-33.86, 151.21],
      [0, -179.5],
      [60, 120],
    ] as const) {
      const [x, y] = project(k, lat, lon);
      const [la, lo] = unproject(k, x, y);
      expect(la).toBeCloseTo(lat, 8);
      expect(lo).toBeCloseTo(lon, 8);
    }
  expect(project("mercator", 0, 0)).toEqual([0.5, 0.5]);
  expect(project("equirect", 0, 0)).toEqual([0.5, 0.25]);
  expect(project("mercator", 90, 0)[1]).toBeCloseTo(0, 6);
  expect(unproject("mercator", 0.5, 0)[0]).toBeCloseTo(MERC_MAX, 6);
  // (x wrapped: one turn east is the same place)
  expect(unproject("equirect", 1.25, 0.25)[1]).toBeCloseTo(-90, 9);
});

test("the terminator: the Sun over the June tropic — the Arctic lit, the Antarctic dark at noon's opposite", () => {
  const sun = [23.44, 0] as const;
  expect(terminatorLat(0, ...sun)).toBeCloseTo(-66.56, 2);
  expect(terminatorLat(180, ...sun)).toBeCloseTo(66.56, 2);
  expect(isNight(80, 180, ...sun)).toBe(false);
  expect(isNight(-80, 0, ...sun)).toBe(true);
  expect(isNight(0, 0, ...sun)).toBe(false);
  expect(isNight(0, 180, ...sun)).toBe(true);
});

test("the tiles of a view: the level by the scale, the rows clamped, the columns wrapped", () => {
  const { z, tiles } = tilesFor(0.5, 0.5, 1024, 1024, 768, 13);
  expect(z).toBe(2);
  expect(tiles.every((t) => t.z === 2 && t.y >= 0 && t.y <= 3 && t.x >= 0 && t.x <= 3)).toBe(true);
  const w = tilesFor(0.01, 0.5, 4096, 800, 600, 13);
  expect(w.tiles.some((t) => t.tx < 0 && t.x === w.n - 1)).toBe(true);
  expect(tilesFor(0.5, 0.5, 1e9, 800, 600, 13).z).toBe(13);
});
