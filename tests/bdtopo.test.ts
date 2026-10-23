import { expect, test } from "bun:test";
import { BDTOPO_Z, bdtopoHeight, bdtopoStands, bdtopoUrl, clipRing, type Point } from "../src/system/bdtopo";
import { tilesWithin } from "../src/system/ign-canopy";

const area = (r: Point[]) => {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i]!.x * r[i + 1]!.y - r[i + 1]!.x * r[i]!.y;
  return Math.abs(a) / 2;
};
const square = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
  { x: x0, y: y0 },
];

test("a building's height: its measured hauteur, else its storeys', else OSM's default — clamped as OSM's", () => {
  expect(bdtopoHeight({ hauteur: 34.9, nombre_d_etages: 7 })).toBe(34.9);
  expect(bdtopoHeight({ nombre_d_etages: 7 })).toBe(22);
  expect(bdtopoHeight({ hauteur: null })).toBe(6);
  expect(bdtopoHeight({ hauteur: 0 })).toBe(6);
  expect(bdtopoHeight({ hauteur: 0.8 })).toBe(2);
  expect(bdtopoHeight({ hauteur: 812 })).toBe(500);
});

test("the buildings that stand: in service or being built, not destroyed, a ruin or a project", () => {
  expect(bdtopoStands({ etat_de_l_objet: "En service" })).toBe(true);
  expect(bdtopoStands({ etat_de_l_objet: "En construction" })).toBe(true);
  expect(bdtopoStands({})).toBe(true);
  for (const s of ["Détruit", "En ruine", "En projet"]) expect(bdtopoStands({ etat_de_l_objet: s })).toBe(false);
});

test("a footprint clipped to its tile: inside kept whole, across an edge cut there, outside gone — the two copies' areas the whole's", () => {
  const e = 4096;
  const inside = square(100, 100, 300, 260);
  expect(clipRing(inside, e)).toEqual(inside);
  // (a building across the east edge: this tile's part, and the next tile's — the same ring moved by a tile — make it whole)
  const across = square(4000, 1000, 4200, 1100);
  const here = clipRing(across, e),
    next = clipRing(
      across.map((p) => ({ x: p.x - e, y: p.y })),
      e,
    );
  expect(Math.max(...here.map((p) => p.x))).toBe(e);
  expect(Math.min(...next.map((p) => p.x))).toBe(0);
  expect(area(here) + area(next)).toBeCloseTo(area(across), 6);
  expect(here[0]).toEqual(here.at(-1)!);
  // (in the buffer only: none)
  expect(clipRing(square(4100, 10, 4180, 60), e)).toEqual([]);
  // (an L, concave, across the south edge)
  const L: Point[] = [
    { x: 10, y: 4000 },
    { x: 200, y: 4000 },
    { x: 200, y: 4050 },
    { x: 60, y: 4050 },
    { x: 60, y: 4300 },
    { x: 10, y: 4300 },
    { x: 10, y: 4000 },
  ];
  expect(area(clipRing(L, e))).toBeCloseTo(190 * 50 + 50 * 46, 6);
});

test("the buildings' tiles: z 15, XYZ rows, the disc's nearest first", () => {
  expect(bdtopoUrl(16592, 11272)).toBe("https://data.geopf.fr/tms/1.0.0/BDTOPO/15/16592/11272.pbf");
  const t = tilesWithin(BDTOPO_Z, 48.8487, 2.2846, 3000);
  // (a 0.8 km tile at 48.8°: the 3 km disc's ~28 km² in ~45–70 tiles)
  expect(t.length).toBeGreaterThan(40);
  expect(t.length).toBeLessThan(80);
  expect(t[0]!.d).toBe(0);
  const n = 2 ** BDTOPO_Z;
  expect(t[0]!.x).toBe(Math.floor(((2.2846 + 180) / 360) * n));
  expect(t.map((v) => v.d)).toEqual([...t.map((v) => v.d)].sort((a, b) => a - b));
});
