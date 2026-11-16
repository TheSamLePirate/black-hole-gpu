import { describe, expect, test } from "bun:test";
import { bdtopoUrl } from "../src/system/bdtopo";
import { cellBounds } from "../src/system/building-cells";
import { prepareBdtopoCell } from "../src/system/cell-prep";
import {
  encodeStreetCell,
  LAMP_BYTES,
  PIECE_BYTES,
  readLamp,
  readPiece,
  readStreetHeader,
  STREET_HEADER_BYTES,
  StreetFlag,
} from "../src/system/street-cells";
import { prepareStreetCells } from "../src/system/street-prep";
import { PIECE_M } from "../src/system/traffic";
import { earthDataDir, readKept } from "./e2e/lib/earth-cache";

// PLAN-J8 J8-L — the streets' cells (src/system/street-cells.ts, street-prep.ts; the format agreed with the render session, 16 Nov 2026):
// the bytes round-trip; and on Toulon's centre (its OpenMapTiles z 14 tile and its four BD TOPO cells, from the e2e's Earth data on disk
// when present): lamps along the town's streets, the main roads' pieces, each in the cell of its foot or middle, no piece over PIECE_M.

test("a street cell's bytes: its header, lamps and pieces read back", () => {
  const buf = encodeStreetCell(
    { z: 15, x: 16922, y: 12024, generation: 20261116, originLat: 43.12, originLon: 5.93 },
    [{ east: 12.5, north: -30.25, height: 9, cls: "secondary", flags: StreetFlag.Left }],
    [{ a: [0, 0], b: [200, 10], cls: "primary", flags: StreetFlag.OnewayAlong, speed: 22, seed: 0xdeadbeef }],
  );
  expect(buf.byteLength).toBe(STREET_HEADER_BYTES + LAMP_BYTES + PIECE_BYTES);
  const h = readStreetHeader(buf)!;
  expect([h.z, h.x, h.y, h.lampCount, h.pieceCount, h.generation]).toEqual([15, 16922, 12024, 1, 1, 20261116]);
  expect(h.originLat).toBe(43.12);
  expect(readLamp(buf, 0)).toEqual({ east: 12.5, north: -30.25, height: 9, cls: "secondary", flags: StreetFlag.Left });
  expect(readPiece(buf, 0)).toEqual({
    a: [0, 0],
    b: [200, 10],
    cls: "primary",
    flags: StreetFlag.OnewayAlong,
    speed: 22,
    seed: 0xdeadbeef,
  });
  // (not a street cell: null)
  expect(readStreetHeader(new ArrayBuffer(64))).toBeNull();
});

// (Toulon's centre: the z 14 tile 8461/6012 and its four cells, from the e2e's Earth data on disk)
const X14 = 8461,
  Y14 = 6012;
const osm = readKept(earthDataDir(), `https://tiles.openfreemap.org/planet/latest/14/${X14}/${Y14}.pbf`, null);
const bd = (x: number, y: number) => readKept(earthDataDir(), bdtopoUrl(x, y), null);
const have = !!osm && [0, 1, 2, 3].every((k) => bd(X14 * 2 + (k % 2), Y14 * 2 + Math.floor(k / 2)));

describe.skipIf(!have)("Toulon's centre (the e2e's Earth data on disk)", () => {
  test("lamps along the town's streets, the main roads' pieces, each in its cell", () => {
    const buildings = (x: number, y: number) => {
      const b = bd(x, y);
      return b ? prepareBdtopoCell(b.body, x, y, () => 0).buf : null;
    };
    const t0 = performance.now();
    const cells = prepareStreetCells(osm!.body, X14, Y14, buildings, 20261116);
    const ms = performance.now() - t0;
    const lamps = cells.reduce((s, c) => s + c.lamps.length, 0),
      pieces = cells.reduce((s, c) => s + c.pieces.length, 0);
    console.log(
      `  Toulon z 14 ${X14}/${Y14}: ${lamps} lamps, ${pieces} pieces (${cells.map((c) => `${c.lamps.length}/${c.pieces.length}`).join(" · ")}), ${ms.toFixed(0)} ms`,
    );
    expect(lamps).toBeGreaterThan(200);
    expect(pieces).toBeGreaterThan(10);
    for (const c of cells) {
      const h = readStreetHeader(c.buf)!;
      expect([h.x, h.y, h.lampCount, h.pieceCount]).toEqual([c.x, c.y, c.lamps.length, c.pieces.length]);
      // (each in its cell: its foot, or its middle, within the cell's half side and a little — ~0.6 km at 43°)
      const b = cellBounds(c.x, c.y);
      const half = ((b.east - b.west) * 111_320 * Math.cos(((b.north + b.south) / 2) * (Math.PI / 180))) / 2 + 2;
      for (const l of c.lamps) expect(Math.max(Math.abs(l.east), Math.abs(l.north))).toBeLessThan(half);
      for (const p of c.pieces) {
        expect(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1])).toBeLessThanOrEqual(PIECE_M + 1);
        expect(Math.max(Math.abs((p.a[0] + p.b[0]) / 2), Math.abs((p.a[1] + p.b[1]) / 2))).toBeLessThan(half);
      }
    }
  });
});
