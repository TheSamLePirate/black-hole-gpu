import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// (25 Nov 2026, PROBLEMES « Un trait clair … mont Faron ».) The sea's surface (terrain-raster.ts seaFs) keeps a crest standing over
// the land behind it — a cliff over a bay —; it tested the ground's distance alone (the visibility's r), not the nearest surface's
// (b: a tree, a building's proxy before the ground). On Mont Faron the sea's horizon 25–57 km off, lifted by the air (R4b), stood
// in front of the land's line there: kept over the trees 10 m from the camera — the pale straight streak by the parked F-35.

const src = readFileSync(`${import.meta.dir}/../src/system/terrain-raster.ts`, "utf8");

/** seaFs's test for a pixel neither the open sea's nor the sky's: the crest at ds kept? (r: the ground behind, b: the nearest) */
const keepOld = (ds: number, r: number) => r > ds + 1;
const keepNew = (ds: number, r: number, b: number) => r > ds + 1 && (b > 0 ? b : r) > ds + 1;

test("a crest before the land is kept; before a tree in front of that land, not", () => {
  // (a cliff over a bay: the crest at 800 m, the cliff at 1 200 m, nothing before it)
  expect(keepNew(800, 1200, 1200)).toBe(true);
  // (Mont Faron: the lifted horizon at 49 900 m, the land behind at 50 000 m, a tree 10 m from the camera — the old test kept it)
  expect(keepOld(49_900, 50_000)).toBe(true);
  expect(keepNew(49_900, 50_000, 10)).toBe(false);
  // (no proxy there: the ground's own distance)
  expect(keepNew(49_900, 50_000, 0)).toBe(true);
});

test("seaFs carries the test: the nearest surface's distance before the crest", () => {
  const fs = src.slice(src.indexOf("@fragment fn seaFs("), src.indexOf("fn seaResolve("));
  expect(fs).toContain("let dn = select(dg, vis.b, vis.b > 0.0);");
  expect(fs).toContain("if (!(dg > ds + 1.0) || !(dn > ds + 1.0)) { discard; }");
});
