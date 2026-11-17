import { expect, test } from "bun:test";
import { BridgeKind, Crossed, encodeStreetCell, type RoadSegmentRecord, readStreetHeader, SegmentFlag } from "../src/system/street-cells";
import { farBridges, farCars } from "../src/system/street-far";
import { ROAD_TRAFFIC } from "../src/system/traffic";

// PLAN-J8 J8-L: the far cars of a street cell — on its busy roads only, each way allowed, spaced by their class, none in a tunnel.

const seg = (cls: RoadSegmentRecord["cls"], len: number, flags = 0, roadId = 7): RoadSegmentRecord => ({
  a: [0, 0],
  b: [len, 0],
  width: 7,
  lanes: 2,
  cls,
  flags,
  level: 0,
  speed: 13,
  s0: 0,
  roadId,
});
const cell = (segments: RoadSegmentRecord[]) =>
  encodeStreetCell({ z: 15, x: 1, y: 2, generation: 20261116, originLat: 48.85, originLon: 2.35 }, [], segments, []);

test("cars on the busy roads, each way, spaced by their class; none on a minor road nor in a tunnel", () => {
  const buf = cell([seg("motorway", 210), seg("minor", 250), seg("primary", 240, SegmentFlag.Tunnel)]);
  const h = readStreetHeader(buf)!;
  const c = farCars(buf, h.segmentCount);
  const n = c.length / 8;
  // (a motorway of 210 m: 3 a way (70 m), both ways)
  expect(n).toBe(2 * Math.floor(210 / ROAD_TRAFFIC.motorway!.spacing));
  for (let i = 0; i < n; i++) {
    const [sx, , rx, , phase, speed] = Array.from(c.subarray(8 * i, 8 * i + 6));
    expect(Math.abs(rx!)).toBeCloseTo(210, 3);
    expect(sx === 0 ? rx! > 0 : rx! < 0).toBe(true);
    expect(phase!).toBeGreaterThanOrEqual(0);
    expect(phase!).toBeLessThan(1);
    expect(speed!).toBeGreaterThan(0.84 * ROAD_TRAFFIC.motorway!.speed);
    expect(speed!).toBeLessThan(1.16 * ROAD_TRAFFIC.motorway!.speed);
  }
});

test("a one way: its cars one way only", () => {
  const along = cell([seg("primary", 240, SegmentFlag.OnewayAlong)]);
  const c = farCars(along, 1);
  expect(c.length / 8).toBe(Math.floor(240 / ROAD_TRAFFIC.primary!.spacing));
  for (let i = 0; i < c.length / 8; i++) expect(c[8 * i + 2]!).toBeGreaterThan(0);
});

test("RP7: a cell's bridges as far decks among its cars — each segment's run, its half-width and height; a bridge from another cell's first point left out", () => {
  const bridge = (id: number, start: [number, number]) => ({
    id,
    kind: BridgeKind.Road,
    flags: 0,
    width: 14,
    layer: 1,
    crossed: Crossed.Water,
    clearance: 7,
    length: 160,
    points: [start, [start[0] + 80, start[1]] as [number, number], [start[0] + 160, start[1]] as [number, number]],
  });
  const buf = encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 0, originLat: 48.86, originLon: 2.3 },
    [],
    [],
    [],
    [],
    0,
    [],
    [],
    [],
    [bridge(1, [0, 0]), bridge(2, [5000, 0])],
  );
  const d = farBridges(buf, (e) => Math.abs(e) < 600);
  expect(d.length).toBe(2 * 8);
  expect(Array.from(d.slice(0, 7))).toEqual([0, 0, 80, 0, 0.5, 0, 7]);
  expect(d[7]).toBeCloseTo(7.6, 5);
});
