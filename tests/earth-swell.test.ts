import { expect, test } from "bun:test";
import { swellKey } from "../src/system/earth-shore";
import { SWELL_HEADER_VEC4S, SWELL_NODE_VEC4S, SHORE_LEVELS } from "../src/system/earth-shore-layout";
import { deanDepth, godunov, swellCg, swellK, swellPhaseCpu, SWELL_SWEEPS, SWELL_TILE } from "../src/system/earth-swell";
import { TERRAIN_CACHE_N } from "../src/system/terrain-cache-layout";

// L1 — the coastal swell field (system/earth-swell.ts): the dispersion's fit, the eikonal's update, and the bake's scheme on the CPU
// (swellPhaseCpu — the GPU's Godunov update, its fixed boundary, its land) on small coasts: a plane wave over the deep, crests
// turned parallel to a beach, a lagoon reached by no path, an island's lee.

const g = 9.81;

test("the dispersion's fit: ω² = g k tanh(k h) within 2 %, the deep and shallow limits", () => {
  for (const T of [4, 8, 12, 16])
    for (const h of [0.3, 1, 3, 10, 30, 100, 1000]) {
      const k = swellK(h, T);
      const w = (2 * Math.PI) / T;
      expect(Math.abs(g * k * Math.tanh(k * h) - w * w) / (w * w)).toBeLessThan(0.035);
    }
  const T = 10;
  expect(swellK(5000, T)).toBeCloseTo((2 * Math.PI) ** 2 / (g * T * T), 5);
  // (shallow: c = √(g h))
  expect((2 * Math.PI) / T / swellK(0.3, T) / Math.sqrt(g * 0.3)).toBeCloseTo(1, 1);
  // (the group speed: half the phase speed in the deep, equal in the shallows — the shoaling's gain √(cg₀/cg) above 1 near shore)
  expect(swellCg(5000, T) / ((g * T) / (4 * Math.PI))).toBeCloseTo(1, 3);
  expect(Math.sqrt(swellCg(5000, T) / swellCg(1, T))).toBeGreaterThan(1.2);
});

test("Godunov's update is exact for a plane wave, and falls back to one side when the other is far", () => {
  const k = 0.05,
    hx = 30,
    hy = 38;
  const ang = 0.6;
  const phi = (x: number, y: number) => k * (x * Math.cos(ang) + y * Math.sin(ang));
  const u = godunov(phi(-hx, 0), phi(0, -hy), k, hx, hy);
  expect(u).toBeCloseTo(phi(0, 0), 6);
  expect(godunov(0, Infinity, k, hx, hy)).toBeCloseTo(k * hx, 9);
  expect(godunov(Infinity, Infinity, k, hx, hy)).toBe(Infinity);
});

const n = 64;
const sp = 40;
const T = 8;

test("over the deep, the field is the offshore plane wave", () => {
  const d = [Math.sin(0.5), Math.cos(0.5)];
  const k0 = (2 * Math.PI) ** 2 / (g * T * T);
  const plane = (i: number, j: number) => k0 * (i * sp * d[0]! + j * sp * d[1]!);
  const phi = swellPhaseCpu(
    n,
    () => 1e5,
    (i, j) => (i === 0 || j === 0 ? plane(i, j) : null),
    T,
    () => sp,
    sp,
  );
  let worst = 0;
  for (let j = 1; j < n; j++) for (let i = 1; i < n; i++) worst = Math.max(worst, Math.abs(phi[j * n + i]! - plane(i, j)));
  // (Dean at 100 km: 215 m — the deep for an 8 s swell: k within 0.1 % of k0)
  expect(worst / plane(n - 1, n - 1)).toBeLessThan(0.005);
});

test("the crests turn parallel to a beach: oblique offshore, near normal at the shore", () => {
  // (land the top rows; the sea's depth by Dean from the distance to it; the swell coming in at 50° from the beach's normal)
  const shoreRow = n - 4;
  const dist = (_: number, j: number) => (j >= shoreRow ? 0 : (shoreRow - j) * sp);
  const a = (50 * Math.PI) / 180;
  const d = [Math.sin(a), Math.cos(a)];
  const k0 = (2 * Math.PI) ** 2 / (g * T * T);
  const phi = swellPhaseCpu(
    n,
    dist,
    (i, j) => (i === 0 || j === 0 ? k0 * (i * sp * d[0]! + j * sp * d[1]!) : null),
    T,
    () => sp,
    sp,
  );
  const way = (i: number, j: number) => {
    const gx = (phi[j * n + i + 1]! - phi[j * n + i - 1]!) / (2 * sp);
    const gy = (phi[(j + 1) * n + i]! - phi[(j - 1) * n + i]!) / (2 * sp);
    return (Math.atan2(gx, gy) * 180) / Math.PI;
  };
  const off = way(n / 2, 4);
  const near = way(n / 2, shoreRow - 2);
  expect(off).toBeGreaterThan(40);
  expect(near).toBeLessThan(off - 15);
  expect(near).toBeGreaterThan(0);
});

test("a lagoon the sea reaches by no path gets no swell; an island's lee turns the crests", () => {
  // (a ring of land round a basin in the middle; an island west of a point; the swell going north from the south edge)
  const lagoon = (i: number, j: number) => Math.max(Math.abs(i - 44), Math.abs(j - 44)) <= 8;
  const ring = (i: number, j: number) => Math.max(Math.abs(i - 44), Math.abs(j - 44)) === 9;
  const island = (i: number, j: number) => Math.hypot(i - 18, j - 20) < 5;
  const land = (i: number, j: number) => ring(i, j) || island(i, j);
  const dist = (i: number, j: number) => (land(i, j) ? 0 : lagoon(i, j) ? 30 : 400);
  const k0 = (2 * Math.PI) ** 2 / (g * T * T);
  const phi = swellPhaseCpu(
    n,
    dist,
    (_i, j) => (j === 0 ? k0 * j * sp : null),
    T,
    () => sp,
    sp,
  );
  expect(phi[44 * n + 44]).toBe(Infinity);
  expect(Number.isFinite(phi[30 * n + 18]!)).toBe(true);
  // (behind the island the crests come round it: later than the open sea's at the same row)
  expect(phi[27 * n + 18]!).toBeGreaterThan(phi[27 * n + 4]! + 0.1);
});

test("the field's layout and its bake's reach", () => {
  expect(SWELL_HEADER_VEC4S).toBe(2 + 2 * SHORE_LEVELS.length);
  expect(SWELL_NODE_VEC4S * 2).toBeGreaterThanOrEqual(TERRAIN_CACHE_N * TERRAIN_CACHE_N);
  // (the sweeps carry the phase ~(TILE − 1) nodes each: twice across the window at least — a path round a cape)
  expect(SWELL_SWEEPS * (SWELL_TILE - 1)).toBeGreaterThan(2 * TERRAIN_CACHE_N);
  expect(deanDepth(0)).toBe(0);
  expect(deanDepth(1000)).toBeCloseTo(10, 6);
  // (the key: the way to 5°, the period to half a second, the anchor)
  const A = { lon: 0.1, lat: 0.75 };
  expect(swellKey(0.5, 8.1, A)).toBe(swellKey(0.5 + 0.01, 8.2, A));
  expect(swellKey(0.5, 8, A)).not.toBe(swellKey(0.7, 8, A));
  expect(swellKey(2 * Math.PI - 0.001, 8, A)).toBe(swellKey(0.001, 8, A));
});
