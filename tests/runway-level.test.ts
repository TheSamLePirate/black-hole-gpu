import { expect, test } from "bun:test";
import { runwayLevelOf, SEA_DATA_GAP, SEA_DATA_M } from "../src/world/runways3d";

// (25 Nov 2026) A world runway's level: the relief's median under it, unless the relief has the sea where the publication puts the strip
// well above it (Hong Kong's Chek Lap Kok: 0–1 m in the global relief, published 7–9 m — PROBLEMES 25 Nov 2026).
const at = (...h: number[]) => h;

test("the relief's median is the level where the relief holds the field", () => {
  // (Nice: published 3 m, the relief 3–3.6 m under its strips)
  expect(runwayLevelOf(at(3.6, 3.5, 3.6, 3.7, 3.6, 3.6, 3.6, 3.5, 3.6, 3.7, 3.6), 3)).toBeCloseTo(3.6, 5);
  // (a field inland: the relief's 120 m kept over a publication 6 m off — another datum, the tiles' trees)
  expect(runwayLevelOf(at(118, 119, 120, 120, 121, 120, 119, 120, 121, 122, 120), 126)).toBeCloseTo(120, 5);
  // (Schiphol: below the sea in the publication and in the relief)
  expect(runwayLevelOf(at(-4.2, -4, -4.1, -3.9, -4, -4, -4.1, -4, -3.8, -4, -4), -4)).toBeCloseTo(-4, 5);
});

test("the published height where the relief has the sea under a field published well above it", () => {
  // (Hong Kong's 07C: the global relief 0–1.2 m, published 7 m)
  expect(runwayLevelOf(at(0, 0, 0.4, 1.2, 0, -0.7, 0, 0.3, 0.9, 0, 0), 7)).toBe(7);
  // (the edges of the rule: the median at SEA_DATA_M with the publication SEA_DATA_GAP over it takes the publication…)
  expect(runwayLevelOf(Array(11).fill(SEA_DATA_M), SEA_DATA_M + SEA_DATA_GAP)).toBe(SEA_DATA_M + SEA_DATA_GAP);
  // (… a publication nearer, or a relief above the sea, keeps the measure)
  expect(runwayLevelOf(Array(11).fill(SEA_DATA_M), SEA_DATA_M + SEA_DATA_GAP - 0.5)).toBeCloseTo(SEA_DATA_M, 5);
  expect(runwayLevelOf(Array(11).fill(SEA_DATA_M + 0.5), 9)).toBeCloseTo(SEA_DATA_M + 0.5, 5);
});
