import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { CellSource, readHeader, readRecord } from "../src/system/building-cells";
import { colourCode, prepareOvertureCells, releaseDay } from "../src/system/cell-prep-overture";

// PLAN-J8 J8-7 — the building cells from Overture's z 14 tiles (src/system/cell-prep-overture.ts): a tile gives its four z 15 cells;
// each building once — kept in the first (north, then west) tile and cell it touches —; the scenery worker's count on the same tile (its
// rule: a ring's centre within the tile) within a few per cent; the contract's header (Overture, the release's day). Tarifa's tile is the
// fixture (tests/fixtures/overture: 2026-10-21.0, z 14 7936/6432); a 2 × 2 block of Brussels from ~/.kerr-cache/overture when present
// (the seams: no building twice).

const RELEASE = "2026-10-21.0";
const TARIFA = new URL("./fixtures/overture/2026-10-21.0-14-7936-6432.mvt", import.meta.url);

/** the scenery worker's own count (scenery-worker.ts overtureTiles: the outlines whose first ring's centre is within the tile) */
function workerCount(bytes: Uint8Array): number {
  const layer = new VectorTile(new PbfReader(bytes)).layers.building;
  let n = 0;
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.is_underground === true) continue;
    const e = f.extent;
    for (const rings of classifyRings(f.loadGeometry())) {
      const r = rings[0];
      if (!r?.length) continue;
      const cx = r.reduce((t, v) => t + v.x, 0) / r.length,
        cy = r.reduce((t, v) => t + v.y, 0) / r.length;
      if (cx >= 0 && cx < e && cy >= 0 && cy < e) n++;
    }
  }
  return n;
}

test("the release's day and a colour's code", () => {
  expect(releaseDay("2026-10-21.0")).toBe(20261021);
  expect(releaseDay("nonsense")).toBe(0);
  expect(colourCode("#B4A995")).toBe(0xb4a995);
  expect(colourCode("#abc")).toBe(0xaabbcc);
  expect(colourCode("beige")).toBe(0);
  expect(colourCode(null)).toBe(0);
});

test("Tarifa's tile: four z 15 cells, each building in one, the contract's header, the worker's count within 3 %", () => {
  const bytes = new Uint8Array(readFileSync(TARIFA));
  const cells = prepareOvertureCells(bytes, 7936, 6432, RELEASE);
  expect(cells.map((c) => readHeader(c.buf)).map((h) => [h?.x, h?.y, h?.z, h?.source, h?.generation])).toEqual([
    [15872, 12864, 15, CellSource.Overture, 20261021],
    [15873, 12864, 15, CellSource.Overture, 20261021],
    [15872, 12865, 15, CellSource.Overture, 20261021],
    [15873, 12865, 15, CellSource.Overture, 20261021],
  ]);
  const kept = cells.reduce((s, c) => s + c.records.length, 0);
  const keys = cells.flatMap((c) => c.records.map((r) => r.sourceKey));
  expect(new Set(keys).size).toBe(keys.length);
  const w = workerCount(bytes);
  console.log(`  Tarifa: ${kept} buildings in the four cells (${cells.map((c) => c.records.length).join(" · ")}), the worker's rule ${w}`);
  expect(kept).toBeGreaterThan(500);
  expect(Math.abs(kept - w) / w).toBeLessThan(0.03);
  // (each record within its cell — its box's centre at most half a cell past its square, ~0.4 km at 36° —, a height, no ground)
  for (const c of cells)
    for (let i = 0; i < c.records.length; i++) {
      const r = readRecord(c.buf, i);
      expect(Math.abs(r.east)).toBeLessThan(800);
      expect(Math.abs(r.north)).toBeLessThan(800);
      expect(r.eave + r.roof).toBeGreaterThanOrEqual(2);
      expect(r.ground).toBe(0);
      expect(r.rank).toBe(i);
    }
});

const BLOCK = join(homedir(), ".kerr-cache", "overture");
const tile = (x: number, y: number) => join(BLOCK, `${RELEASE}-14-${x}-${y}.mvt`);
const have = [
  [8390, 5496],
  [8391, 5496],
  [8390, 5497],
  [8391, 5497],
].every(([x, y]) => existsSync(tile(x!, y!)));

describe.skipIf(!have)("Brussels, a 2 × 2 block (~/.kerr-cache/overture)", () => {
  test("no building twice across the seams; the block's count against the worker's within 2 %", () => {
    const keys = new Map<number, string>();
    let twice = 0,
      kept = 0,
      worker = 0,
      ms = 0;
    for (const [x, y] of [
      [8390, 5496],
      [8391, 5496],
      [8390, 5497],
      [8391, 5497],
    ] as const) {
      const bytes = new Uint8Array(readFileSync(tile(x, y)));
      worker += workerCount(bytes);
      const cells = prepareOvertureCells(bytes, x, y, RELEASE);
      ms += cells[0]!.stats.ms;
      for (const c of cells)
        for (const r of c.records) {
          kept++;
          if (keys.has(r.sourceKey)) twice++;
          else keys.set(r.sourceKey, `${x}/${y}`);
        }
    }
    console.log(`  Brussels 2 × 2: ${kept} kept, ${twice} twice, the worker's rule ${worker}; ${(ms / 4).toFixed(0)} ms a tile`);
    expect(twice).toBe(0);
    expect(Math.abs(kept - worker) / worker).toBeLessThan(0.02);
  });
});
