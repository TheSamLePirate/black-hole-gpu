import { describe, expect, test } from "bun:test";
import { bdtopoUrl } from "../src/system/bdtopo";
import { cellBounds } from "../src/system/building-cells";
import { prepareBdtopoCell } from "../src/system/cell-prep";
import {
  encodeStreetCell,
  JUNCTION_BYTES,
  LAMP_BYTES,
  readJunction,
  readLamp,
  readSegment,
  readStreetHeader,
  SEGMENT_BYTES,
  SEGMENT_MAX_M,
  SegmentFlag,
  STREET_HEADER_BYTES,
  StreetFlag,
} from "../src/system/street-cells";
import { prepareStreetCells, simplify } from "../src/system/street-prep";
import { earthDataDir, readKept } from "./e2e/lib/earth-cache";

// PLAN-J8 J8-L and J8-VB (VB1) — the streets' cells, format 2 (src/system/street-cells.ts, street-prep.ts; agreed with the render session,
// 16 Nov 2026): the bytes round-trip; Douglas-Peucker keeps a line within its tolerance; and on Toulon's centre and Paris (their OpenMapTiles
// z 14 tiles and BD TOPO z 15 tiles, from the e2e's Earth data on disk when present): the lamps, every road's segments — the BD TOPO's in
// France with their widths and lanes —, none over SEGMENT_MAX_M, each in its cell; the junctions; the vertices before and after.

test("a street cell's bytes (format 2): its header, lamps, segments and junctions read back", () => {
  const buf = encodeStreetCell(
    { z: 15, x: 16922, y: 12024, generation: 20261116, originLat: 43.12, originLon: 5.93 },
    [{ east: 12.5, north: -30.25, height: 9, cls: "secondary", flags: StreetFlag.Left }],
    [
      {
        a: [0, 0],
        b: [200, 10],
        width: 6.5,
        lanes: 2,
        cls: "tertiary",
        flags: SegmentFlag.OnewayAlong | SegmentFlag.Bridge | SegmentFlag.Urban,
        level: 1,
        speed: 13.89,
        s0: 125.5,
        roadId: 0xdeadbeef,
      },
    ],
    [{ east: 200, north: 10, degree: 4, width: 6.4, flags: 0 }],
  );
  expect(buf.byteLength).toBe(STREET_HEADER_BYTES + LAMP_BYTES + SEGMENT_BYTES + JUNCTION_BYTES);
  const h = readStreetHeader(buf)!;
  expect([h.z, h.x, h.y, h.lampCount, h.segmentCount, h.junctionCount, h.placeCount, h.generation]).toEqual([
    15, 16922, 12024, 1, 1, 1, 0, 20261116,
  ]);
  expect(readLamp(buf, 0)).toEqual({ east: 12.5, north: -30.25, height: 9, cls: "secondary", flags: StreetFlag.Left });
  expect(readSegment(buf, 0)).toEqual({
    a: [0, 0],
    b: [200, 10],
    width: 6.5,
    lanes: 2,
    cls: "tertiary",
    flags: SegmentFlag.OnewayAlong | SegmentFlag.Bridge | SegmentFlag.Urban,
    level: 1,
    speed: 13.89,
    s0: 125.5,
    roadId: 0xdeadbeef,
  });
  expect(readJunction(buf, 0)).toEqual({ east: 200, north: 10, degree: 4, width: 6.4, flags: 0 });
  // (not a street cell of this format: null)
  expect(readStreetHeader(new ArrayBuffer(64))).toBeNull();
});

test("Douglas-Peucker: a line kept within its tolerance, a straight run to its ends", () => {
  const line: [number, number][] = Array.from({ length: 101 }, (_, i) => [i, 0.1 * Math.sin(i / 5)]);
  expect(simplify(line, 0.3)).toEqual([line[0]!, line[100]!]);
  const bend: [number, number][] = Array.from({ length: 21 }, (_, i) => [i < 10 ? i : 10, i < 10 ? 0 : i - 10]);
  const s = simplify(bend, 0.3);
  expect(s).toEqual([bend[0]!, bend[10]!, bend[20]!]);
});

/** a place's z 14 tile and its data from the e2e's Earth data on disk (null when missing) */
function place(x14: number, y14: number) {
  const osm = readKept(earthDataDir(), `https://tiles.openfreemap.org/planet/latest/14/${x14}/${y14}.pbf`, null);
  const bd = (x: number, y: number) => readKept(earthDataDir(), bdtopoUrl(x, y), null);
  const quads = [0, 1, 2, 3].map((k) => [x14 * 2 + (k % 2), y14 * 2 + Math.floor(k / 2)] as const);
  if (!osm || !quads.every(([x, y]) => bd(x, y))) return null;
  return {
    run: () =>
      prepareStreetCells(
        osm.body,
        x14,
        y14,
        (x, y) => {
          const b = bd(x, y);
          return b ? prepareBdtopoCell(b.body, x, y, () => 0).buf : null;
        },
        20261116,
        (x, y) => bd(x, y)?.body ?? null,
      ),
  };
}

const PLACES = [
  { name: "Toulon's centre", x14: 8461, y14: 6012 },
  { name: "Paris, the Marais", x14: 8299, y14: 5636 },
];
for (const P of PLACES) {
  const p = place(P.x14, P.y14);
  describe.skipIf(!p)(`${P.name} (the e2e's Earth data on disk)`, () => {
    test("lamps, every road's segments — the BD TOPO's widths and lanes —, junctions, each in its cell", () => {
      const t0 = performance.now();
      const cells = p!.run();
      const ms = performance.now() - t0;
      const sum = (f: (c: (typeof cells)[number]) => number) => cells.reduce((s, c) => s + f(c), 0);
      const segs = cells.flatMap((c) => c.segments);
      const given = segs.filter((s) => !(s.flags & SegmentFlag.InferredWidth)).length;
      console.log(
        `  ${P.name} z 14 ${P.x14}/${P.y14}: ${sum((c) => c.lamps.length)} lamps, ${segs.length} segments (${given} with the BD TOPO's width), ${sum((c) => c.junctions.length)} junctions; vertices ${sum((c) => c.vertices.before)} → ${sum((c) => c.vertices.after)} by the simplification; segments a cell ${cells.map((c) => c.segments.length).join(" · ")}; ${ms.toFixed(0)} ms`,
      );
      expect(segs.length).toBeGreaterThan(100);
      expect(given).toBeGreaterThan(segs.length / 3);
      expect(sum((c) => c.junctions.length)).toBeGreaterThan(20);
      expect(sum((c) => c.vertices.after)).toBeLessThan(sum((c) => c.vertices.before));
      for (const c of cells) {
        const h = readStreetHeader(c.buf)!;
        expect([h.x, h.y, h.lampCount, h.segmentCount, h.junctionCount]).toEqual([
          c.x,
          c.y,
          c.lamps.length,
          c.segments.length,
          c.junctions.length,
        ]);
        const b = cellBounds(c.x, c.y);
        const half = ((b.east - b.west) * 111_320 * Math.cos(((b.north + b.south) / 2) * (Math.PI / 180))) / 2 + 2;
        for (const s of c.segments) {
          expect(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])).toBeLessThanOrEqual(SEGMENT_MAX_M + 0.01);
          expect(Math.max(Math.abs((s.a[0] + s.b[0]) / 2), Math.abs((s.a[1] + s.b[1]) / 2))).toBeLessThan(half);
          expect(s.width).toBeGreaterThan(0);
        }
        for (const j of c.junctions) expect(j.degree).toBeGreaterThanOrEqual(3);
      }
    });
  });
}
