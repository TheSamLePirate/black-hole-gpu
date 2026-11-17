import { expect, test } from "bun:test";
import { markRoad, roadClassCode } from "../src/system/road-markings";
import { surfaceSegment } from "../src/system/scenery-geometry";
import { SurfaceFlag } from "../src/system/street-cells";

// PLAN-J8 J8-VB VB2 — a near road's markings packed in its surface segment (src/system/road-markings.ts) by KSC3's rules: the flags,
// the one way, the lane lines, the pavement; a kerbed one widened by its pavements; the rest untouched.

const road = (cls: string, width: number, oneway = 0) => {
  const p = surfaceSegment([0, 0, 0], [100, 0, 0], width, 1, [0.1, 0.1, 0.1]);
  p.data[6] = roadClassCode(cls);
  p.data[7] = oneway;
  return p;
};
const unpack = (v: number) => ({ flags: v & 15, oneway: (v & 16) !== 0, lanes: (v >> 5) & 15, pavement: (v >> 9) / 10 });

test("VB2: a motorway one way of three lanes — edge lines, two lane lines, no centre; out of town no kerb", () => {
  const p = road("motorway", 11, 1);
  markRoad(p, false);
  const m = unpack(p.data[6]!);
  expect(m.flags & SurfaceFlag.EdgeLines).toBeTruthy();
  expect(m.flags & (SurfaceFlag.CentreDashed | SurfaceFlag.CentreSolid)).toBe(0);
  expect(m.oneway).toBe(true);
  expect(m.lanes).toBe(2);
  expect(p.data[7]).toBe(5.5);
  expect(p.data[4]).toBe(5.5);
});

test("VB2: a town's minor street of 8 m both ways — a dashed centre, a kerb and 2 m pavements, its record widened by them", () => {
  const p = road("minor", 8);
  markRoad(p, true);
  const m = unpack(p.data[6]!);
  expect(m.flags & SurfaceFlag.CentreDashed).toBeTruthy();
  expect(m.flags & SurfaceFlag.Kerb).toBeTruthy();
  expect(m.pavement).toBeCloseTo(2, 6);
  expect(p.data[7]).toBe(4);
  expect(p.data[4]).toBe(6);
  expect(p.max[1]).toBe(6);
});

test("VB2: no class kept (a rail, water, an unknown way) — untouched", () => {
  const rail = surfaceSegment([0, 0, 0], [50, 0, 0], 4, 2, [0.1, 0.1, 0.1]);
  markRoad(rail, true);
  expect(rail.data[6]).toBe(0);
  const p = road("ferry", 6);
  markRoad(p, true);
  expect(p.data[6]).toBe(0);
  expect(p.data[4]).toBe(3);
});
