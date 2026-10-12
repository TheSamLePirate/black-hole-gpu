import { expect, test } from "bun:test";
import { VEGETATION } from "../src/grass-layout";
import {
  packStones,
  STONE_CAPACITY,
  STONE_LATTICE,
  STONE_REACH,
  STONE_SPACING,
  STONE_VERTICES,
  STONES,
  stoneMesh,
  stoneRadius,
} from "../src/ground-stones";

test("the stones' mesh: a closed unit icosphere, 80 faces, every edge shared by two of them", () => {
  const m = stoneMesh();
  expect(m.length).toBe(STONE_VERTICES * 3);
  const key = (i: number) => [m[3 * i]!, m[3 * i + 1]!, m[3 * i + 2]!].map((v) => v.toFixed(5)).join(",");
  const edges = new Map<string, number>();
  for (let f = 0; f < STONE_VERTICES / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const i = 3 * f + k;
      expect(Math.hypot(m[3 * i]!, m[3 * i + 1]!, m[3 * i + 2]!)).toBeCloseTo(1, 6);
      const a = key(i),
        b = key(3 * f + ((k + 1) % 3));
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
    // (wound outwards: the face's normal along its centre)
    const p = [0, 1, 2].map((k) => [m[9 * f + 3 * k]!, m[9 * f + 3 * k + 1]!, m[9 * f + 3 * k + 2]!]);
    const u = p[1]!.map((x, i) => x - p[0]![i]!),
      v = p[2]!.map((x, i) => x - p[0]![i]!);
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const c = [0, 1, 2].map((i) => p[0]![i]! + p[1]![i]! + p[2]![i]!);
    expect(n[0]! * c[0]! + n[1]! * c[1]! + n[2]! * c[2]!).toBeGreaterThan(0);
  }
  expect(edges.size).toBe(120);
  for (const n of edges.values()) expect(n).toBe(2);
});

test("where stones lie: a row for every vegetation kind, none on roads or water, scree the most; mostly pebbles", () => {
  for (const v of VEGETATION) expect(STONES[v.name]).toBeDefined();
  const t = packStones();
  expect(t.length).toBe(VEGETATION.length * 4);
  const at = (name: string) => t[VEGETATION.findIndex((v) => v.name === name) * 4]!;
  expect(at("none")).toBe(0);
  expect(at("reeds")).toBe(0);
  expect(at("sparse")).toBeGreaterThan(at("forest floor"));
  expect(at("forest floor")).toBeGreaterThan(at("meadow"));
  expect(at("meadow")).toBeGreaterThan(at("crop"));
  for (let k = 0; k < VEGETATION.length; k++) {
    expect(t[k * 4]).toBeLessThanOrEqual(0.3);
    expect(t[k * 4 + 2]).toBeLessThanOrEqual(1);
  }
  // sizes: 4 cm to 70 cm; half of them under 5 cm, one in twenty over 40 cm
  expect(stoneRadius(0, 1)).toBeCloseTo(0.04, 6);
  expect(stoneRadius(0.9999, 1)).toBeCloseTo(0.7, 3);
  expect(stoneRadius(0.5, 1)).toBeLessThan(0.09);
  expect(stoneRadius(0.95, 1)).toBeGreaterThan(0.4);
  // the lattice covers the reach; the capacity holds a scree's worth (its density on every point, thrice on steep ground)
  expect((STONE_LATTICE - 2) * STONE_SPACING).toBeGreaterThanOrEqual(2 * STONE_REACH);
  expect(STONE_CAPACITY).toBeGreaterThan(Math.PI * (STONE_REACH / STONE_SPACING) ** 2 * at("sparse") * 1.5);
});

test("the boulders on the CPU: stonesGrow's own (the same hash), none where nothing lies, more on a slope", async () => {
  const { bouldersNear, packStones: table, STONES: kinds, STONE_SPACING: sp } = await import("../src/ground-stones");
  const { VEGETATION: veg } = await import("../src/grass-layout");
  const sparse = veg.findIndex((v) => v.name === "sparse");
  const ground = (kind: number, slope = 0) => ({
    ready: true,
    cellAt: () => (kind << 24) >>> 0,
    heightAt: (x: number) => x * slope,
  });
  const area = 40;
  const flat = bouldersNear(ground(sparse), 0, 0, area, 0.2);
  // (the share of lattice points with a stone, the share of those over 20 cm: (0.2/size − 0.04)/0.66)^(1/4) up)
  const s = kinds.sparse!;
  const big = 1 - ((0.2 / s.size - 0.04) / 0.66) ** 0.25;
  const expected = ((Math.PI * (area + 1) ** 2) / (sp * sp)) * s.density * big;
  expect(flat.length).toBeGreaterThan(expected * 0.75);
  expect(flat.length).toBeLessThan(expected * 1.25);
  for (const b of flat) {
    expect(b.r).toBeGreaterThanOrEqual(0.2);
    expect(b.top).toBeGreaterThan(b.base);
  }
  expect(bouldersNear(ground(sparse), 0, 0, area, 0.2)).toEqual(flat);
  expect(bouldersNear(ground(0), 0, 0, area, 0.2).length).toBe(0);
  expect(bouldersNear({ ...ground(sparse), ready: false }, 0, 0, area, 0.2).length).toBe(0);
  // scree: three to five times as many on steep ground
  expect(bouldersNear(ground(sparse, 0.9), 0, 0, area, 0.2).length).toBeGreaterThan(flat.length * 3);
  expect(table().length).toBe(veg.length * 4);
});

test("the ground grid as the GPU reads it: the nearest cell, the height bilinear", async () => {
  const { GrassGround } = await import("../src/system/grass-ground");
  const { GRASS_GRID } = await import("../src/grass-layout");
  const g = new GrassGround();
  g.centre = [8, -16];
  const half = (GRASS_GRID - 1) / 2;
  for (let j = 0; j < GRASS_GRID; j++)
    for (let i = 0; i < GRASS_GRID; i++) {
      g.heights[j * GRASS_GRID + i] = i + 2 * j;
      g.cells[j * GRASS_GRID + i] = i * 1000 + j;
    }
  // (cell (i, j) holds the metre round its centre: x = centre − half + i)
  expect(g.cellAt(8 - half + 3.4, -16 - half + 5.49)).toBe(3 * 1000 + 5);
  expect(g.cellAt(8 - half + 3.6, -16 - half + 5.51)).toBe(4 * 1000 + 6);
  expect(g.cellAt(8 - half - 2, 0)).toBe(0);
  expect(g.heightAt(8 - half + 3.25, -16 - half + 5.5)).toBeCloseTo(3.25 + 2 * 5.5, 6);
});
