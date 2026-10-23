import { expect, test } from "bun:test";
import { loadHeights } from "../src/system/heights-file";
import { geoidN } from "../src/system/geoid-grid";

const D = Math.PI / 180;
const file = () => loadHeights("geoid", async () => new Response(Bun.file(`${import.meta.dir}/../assets/earth/geoid-egm2008-15.bin`)));

test("the geoid's map: EGM2008 N within 0.6 m of GeographicLib's 5′ grid", async () => {
  const g = await file();
  expect([g.W, g.H]).toEqual([1440, 720]);
  // (the 5′ grid read bilinearly: scripts/build-geoid.py's source; New Guinea's mountains the farthest, 0.52 m)
  const refs: [string, number, number, number][] = [
    ["Timbuktu", 16.7758, -3.0094, 28.788],
    ["Paris", 48.8566, 2.3522, 44.61],
    ["Chamonix", 45.9237, 6.8694, 53.194],
    ["Colombo", 6.93, 79.85, -97.269],
    ["New Guinea", -5, 145, 70.239],
    ["Kennedy", 28.5729, -80.649, -29.644],
    ["Tarifa", 36.013, -5.6, 42.06],
    ["the North Pole", 90, 0, 14.898],
    ["the date line", 10, 180, 12.852],
  ];
  for (const [, lat, lon, n] of refs) expect(Math.abs(geoidN(lat * D, lon * D, g) - n)).toBeLessThan(0.6);
  // continuous across the date line and the map's edges
  expect(Math.abs(geoidN(10 * D, 179.999 * D, g) - geoidN(10 * D, -179.999 * D, g))).toBeLessThan(0.01);
  expect(Math.abs(geoidN(-89.99 * D, 0, g) - geoidN(-89.99 * D, Math.PI, g))).toBeLessThan(0.6);
});

test("no map: N is 0 (the sea on the ellipsoid)", () => {
  expect(geoidN(0.8, 0.04, null)).toBe(0);
});
