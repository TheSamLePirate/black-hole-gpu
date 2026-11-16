import { describe, expect, test } from "bun:test";
import { bdtopoUrl } from "../src/system/bdtopo";
import { cellBounds } from "../src/system/building-cells";
import { prepareBdtopoCell } from "../src/system/cell-prep";
import {
  encodeStreetCell,
  JUNCTION_BYTES,
  LAMP_BYTES,
  PLACE_BYTES,
  PLACE_MAX,
  PlaceFlag,
  readJunction,
  readPlace,
  readLamp,
  readSegment,
  readStreetHeader,
  SEGMENT_BYTES,
  SEGMENT_MAX_M,
  SegmentFlag,
  STREET_HEADER_BYTES,
  CellStreetFlag,
  StreetFlag,
} from "../src/system/street-cells";
import { placesOf, prepareStreetCells, simplify } from "../src/system/street-prep";
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

test("a place's bytes (VB4): its centre, heading, side, 24-bit seed and the carriageway's width", () => {
  const buf = encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 0, originLat: 43, originLon: 6 },
    [],
    [],
    [],
    [{ east: 10.25, north: -3.5, heading: Math.PI / 2, kind: 0, flags: PlaceFlag.Left, seed: 0xabcdef, width: 7.2 }],
    CellStreetFlag.Thinned,
  );
  expect(buf.byteLength).toBe(STREET_HEADER_BYTES + PLACE_BYTES);
  const h = readStreetHeader(buf)!;
  expect([h.placeCount, h.flags]).toEqual([1, CellStreetFlag.Thinned]);
  const p = readPlace(buf, 0);
  expect([p.east, p.north, p.kind, p.flags, p.seed, p.width]).toEqual([10.25, -3.5, 0, PlaceFlag.Left, 0xabcdef, 7.2]);
  expect(p.heading).toBeCloseTo(Math.PI / 2, 3);
});

test("the places (VB4): along an urban street both sides, none near a junction or a building, thinned evenly past the bound", () => {
  const street = (a: [number, number], b: [number, number], extra = {}) => ({
    a,
    b,
    width: 8,
    lanes: 2,
    cls: "minor" as const,
    flags: SegmentFlag.Urban,
    level: 0,
    speed: 11,
    s0: 0,
    roadId: 42,
    ...extra,
  });
  // (an eastward street 240 m long: both sides, ~40 places a side before the seeds' 0.6)
  const one = placesOf([street([0, 0], [240, 0])], [], []);
  expect(one.places.length).toBeGreaterThan(30);
  expect(one.places.length).toBeLessThan(65);
  // (the right of an eastward street is south: north < 0, heading east; the left north, heading west)
  for (const p of one.places) {
    if (p.flags & PlaceFlag.Left) {
      expect(p.north).toBeCloseTo(8 / 2 - 1.1, 3);
      expect(Math.cos(p.heading)).toBeLessThan(-0.99);
    } else {
      expect(p.north).toBeCloseTo(-(8 / 2 - 1.1), 3);
      expect(Math.cos(p.heading)).toBeGreaterThan(0.99);
    }
  }
  // (a junction at 120 m: none within 12 m of it; a building over the first 60 m on the south side: none there)
  const ex = placesOf(
    [street([0, 0], [240, 0])],
    [{ east: 120, north: 0, degree: 3, width: 8, flags: 0 }],
    [{ e: 30, n: -8, hl: 30, hw: 3, h: 0 }],
  );
  for (const p of ex.places) {
    expect(Math.hypot(p.east - 120, p.north)).toBeGreaterThanOrEqual(12);
    if (p.north < 0) expect(p.east).toBeGreaterThan(60);
  }
  // (an urban one way of 4 m: an assumed lane off the carriageway, the right side alone; none against a service road 2 m beside it)
  const lane = placesOf([street([0, 0], [240, 0], { width: 4, flags: SegmentFlag.Urban | SegmentFlag.OnewayAlong })], [], []);
  expect(lane.places.length).toBeGreaterThan(10);
  for (const p of lane.places) {
    expect(p.flags & PlaceFlag.AssumedLane).toBeTruthy();
    expect(p.north).toBeCloseTo(-(4 / 2 + 1.1), 3);
  }
  const besides = placesOf(
    [
      street([0, 0], [240, 0], { width: 4, flags: SegmentFlag.Urban | SegmentFlag.OnewayAlong }),
      street([0, -5], [240, -5], { width: 3, cls: "service", roadId: 7 }),
    ],
    [],
    [],
  );
  expect(besides.places.filter((p) => p.flags & PlaceFlag.AssumedLane).length).toBe(0);
  // (a main road, a path, a narrow street, a bridge: none)
  expect(placesOf([street([0, 0], [240, 0], { cls: "primary" })], [], []).places.length).toBe(0);
  expect(placesOf([street([0, 0], [240, 0], { width: 4 })], [], []).places.length).toBe(0);
  expect(placesOf([street([0, 0], [240, 0], { flags: SegmentFlag.Urban | SegmentFlag.Bridge })], [], []).places.length).toBe(0);
  // (past PLACE_MAX: thinned to it, evenly — both halves of a long row kept alike)
  const many = Array.from({ length: 300 }, (_, i) => street([0, i * 20], [240, i * 20], { roadId: i }));
  const t = placesOf(many, [], []);
  expect(t.thinned).toBe(true);
  expect(t.places.length).toBe(PLACE_MAX);
  const low = t.places.filter((p) => p.north < 3000).length;
  expect(Math.abs(low - PLACE_MAX / 2) / PLACE_MAX).toBeLessThan(0.05);
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
        true,
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
      const placed = sum((c) => c.places.length),
        onLanes = sum((c) => c.places.filter((p) => p.flags & PlaceFlag.AssumedLane).length);
      console.log(
        `  ${P.name}: places ${cells.map((c) => `${c.places.length}${c.thinned ? " (thinned)" : ""}`).join(" · ")} (${placed}) — without the assumed lanes ${cells.map((c) => c.placesBefore).join(" · ")} (${sum((c) => c.placesBefore)}); on assumed lanes ${((100 * onLanes) / Math.max(1, placed)).toFixed(0)} %`,
      );
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
