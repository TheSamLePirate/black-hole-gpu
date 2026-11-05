import { expect, test } from "bun:test";
import { packScenery } from "../src/system/scenery-data";
import { DECAL_FAR, DECAL_NEAR, makeDecals, polygonPrimitive, rasterDecals, surfaceSegment } from "../src/system/scenery-geometry";

// Q3 B4 — the map's surfaces drawn once (scenery-geometry.ts rasterDecals): the tracer's ranks (a road over a field, a rail over
// a road), the water left out, the palette shared; packed after the land cover's raster where trace.wgsl sceneryDecal reads it.

const field = polygonPrimitive(
  [
    [
      [-50, -50, 0],
      [50, -50, 0],
      [50, 50, 0],
      [-50, 50, 0],
      [-50, -50, 0],
    ],
  ],
  0,
  0,
  0,
  [0.4, 0.5, 0.2],
)!;
const road = surfaceSegment([-60, 0, 0], [60, 0, 0], 6, 1, [0.3, 0.3, 0.3]);
const rail = surfaceSegment([0, -60, 0], [0, 60, 0], 3, 2, [0.25, 0.2, 0.15]);
const lake = polygonPrimitive(
  [
    [
      [60, 60, 0],
      [90, 60, 0],
      [90, 90, 0],
      [60, 60, 0],
    ],
  ],
  0,
  0,
  4,
  [0.02, 0.05, 0.06],
)!;

test("a field, a road over it, a rail over the road; the water left out", () => {
  const colours: number[][] = [];
  const colour = (c: number[]) => {
    const k = colours.findIndex((x) => x.every((v, i) => v === c[i]));
    if (k >= 0) return k + 1;
    colours.push(c);
    return colours.length;
  };
  const g = rasterDecals([field, road, rail, lake], 100, 2, colour);
  const N = 100;
  const at = (x: number, y: number) => g[Math.floor((y + 100) / 2) * N + Math.floor((x + 100) / 2)]!;
  expect(colours[at(-30, 30) - 1]).toEqual([0.4, 0.5, 0.2]);
  expect(colours[at(-30, 1) - 1]).toEqual([0.3, 0.3, 0.3]);
  expect(colours[at(0.5, 1) - 1]).toEqual([0.25, 0.2, 0.15]);
  expect(at(80, 70)).toBe(0);
  expect(at(-80, 80)).toBe(0);
});

test("a path narrower than half a texel still drawn; the grids' sizes", () => {
  const path = surfaceSegment([-40, 3, 0], [40, 3, 0], 1, 1, [0.5, 0.45, 0.4]);
  const d = makeDecals([path]);
  expect(d.near.length).toBe(((2 * DECAL_NEAR.half) / DECAL_NEAR.texel) ** 2);
  expect(d.far.length).toBe(((2 * DECAL_FAR.half) / DECAL_FAR.texel) ** 2);
  const N = (2 * DECAL_NEAR.half) / DECAL_NEAR.texel;
  const j = Math.floor((3 + DECAL_NEAR.half) / DECAL_NEAR.texel);
  let drawn = 0;
  for (let i = 0; i < N; i++) if (d.near[j * N + i]) drawn++;
  expect(drawn).toBeGreaterThan(35);
  expect(d.palette[4]).toBeCloseTo(0.5, 2);
});

test("packed after the land cover's raster: the header, the palette, the near grid's bytes where the shader reads them", () => {
  const d = makeDecals([field, road]);
  const grid = 64;
  const buffer = packScenery([], new Uint32Array(grid * grid), [field, road], undefined, grid, 64 * 1024 * 1024, d);
  const f = new Float32Array(buffer);
  const at = f[2]! + (grid * grid) / 4;
  expect(f[at * 4]).toBe(Math.sqrt(d.near.length));
  expect(f[at * 4 + 1]).toBe(DECAL_NEAR.texel);
  expect(f[at * 4 + 3]).toBe(DECAL_FAR.texel);
  const b = new Uint8Array(buffer);
  const N = Math.sqrt(d.near.length);
  const n = Math.floor(DECAL_NEAR.half / DECAL_NEAR.texel) * N + Math.floor((-30 + DECAL_NEAR.half) / DECAL_NEAR.texel);
  const k = b[(at + 257) * 16 + n]!;
  expect(k).toBe(d.near[n]!);
  expect(f[(at + 1 + k) * 4]).toBeCloseTo(0.3, 2);
});

test("Q8 D1: a vineyard's polygon in the decals as a row entry — its palette's w 1, its bearing in blue —, an orchard's w 2", async () => {
  const { makeDecals, polygonPrimitive, ROW_VINE, ROW_ORCHARD } = await import("../src/system/scenery-geometry");
  const sq = (x0: number, y0: number, s: number) => [
    [
      [x0, y0, 0],
      [x0 + s, y0, 0],
      [x0 + s, y0 + s, 0],
      [x0, y0 + s, 0],
      [x0, y0, 0],
    ] as [number, number, number][],
  ];
  const vine = polygonPrimitive(sq(0, 0, 40), 0, 0, ROW_VINE, [0.5, 0.5, 0.25])!;
  const orch = polygonPrimitive(sq(100, 0, 40), 0, 0, ROW_ORCHARD, [0.5, 0.5, 0.25])!;
  const d = makeDecals([vine, orch]);
  const ws = [1, 2].map((k) => d.palette[4 * k + 3]);
  expect(ws.sort()).toEqual([1, 2]);
  // (the same colour, two entries: the kind told apart)
  expect(d.palette[4 * 1 + 2]).toBeCloseTo(64 / 255, 6);
  expect(d.near.some((v) => v !== 0)).toBe(true);
});
