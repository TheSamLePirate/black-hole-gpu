import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { capEdges, devilSeason, marsLs, NORTH_CAP, SOUTH_CAP } from "../src/system/mars-season";
import { M_SECONDS } from "../src/units";

// Mars's seasons (system/mars-season.ts — trace.wgsl Params.mars: marsFrost, marsDevils): Ls from the game's ephemeris at known
// dates, the seasonal caps' edges by Ls (Piqueux et al. 2015, Kieffer et al. 2000, James & Cantor 2001), the dust devils'
// season by hemisphere.

const tOf = (iso: string) => (Date.parse(iso) - Date.UTC(2067, 0, 1)) / 1000 / M_SECONDS;
const near = (a: number, b: number, tol: number) => Math.abs(((a - b + 540) % 360) - 180) < tol;

test("Ls at known dates: Mars year 38's start (12 Nov 2024), its northern summer solstice (29 May 2025), MY 39's start (~30 Sep 2026)", () => {
  expect(near(marsLs(tOf("2024-11-12T00:00:00Z")), 0, 1.5)).toBe(true);
  expect(near(marsLs(tOf("2025-05-29T00:00:00Z")), 90, 1.5)).toBe(true);
  expect(near(marsLs(tOf("2026-09-30T00:00:00Z")), 0, 2)).toBe(true);
  // (half a degree a sol, about: a month later ~15–17°)
  const ls = marsLs(tOf("2026-10-31T00:00:00Z"));
  expect(ls).toBeGreaterThan(12);
  expect(ls).toBeLessThan(19);
});

test("the seasonal caps: widest in each hemisphere's winter, gone in its summer but for the residual caps", () => {
  expect(NORTH_CAP.length).toBe(13);
  expect(SOUTH_CAP.length).toBe(13);
  // (the northern winter, Ls ~300: the north cap to ~55° N; its summer, Ls 120–150: none)
  expect(capEdges(300).north).toBeLessThan(57);
  expect(capEdges(135).north).toBe(90);
  // (the southern winter, Ls ~135: the south cap to ~50° S; its summer, Ls 300–330: none)
  expect(capEdges(135).south).toBeGreaterThan(-51);
  expect(capEdges(315).south).toBe(-90);
  // (receding as the spring goes: the south's from Ls 180 to 270, the north's from Ls 0 to 90)
  for (let ls = 180; ls < 270; ls += 10) expect(capEdges(ls + 10).south).toBeLessThanOrEqual(capEdges(ls).south + 1e-9);
  for (let ls = 0; ls < 90; ls += 10) expect(capEdges(ls + 10).north).toBeGreaterThanOrEqual(capEdges(ls).north - 1e-9);
  // (continuous across Ls 360 → 0)
  expect(capEdges(359.99).north).toBeCloseTo(capEdges(0).north, 1);
});

test("the dust devils' season: the northern spring and summer, the southern's busier; and the tracer reads Params.mars", () => {
  expect(devilSeason(90).north).toBeGreaterThan(0.7);
  expect(devilSeason(90).south).toBe(0);
  expect(devilSeason(270).south).toBeGreaterThan(devilSeason(90).north);
  expect(devilSeason(270).north).toBe(0);
  const wgsl = readFileSync(new URL("../src/shaders/trace.wgsl", import.meta.url).pathname, "utf8");
  expect(wgsl).toContain("mars: vec4f,");
  expect(wgsl).toContain("fn marsFrost(");
  expect(wgsl).toContain("fn marsDevils(");
});
