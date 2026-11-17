import { expect, test } from "bun:test";
import { catenaryMasts, cellRoadSurfaces } from "../src/system/cell-roads";
import {
  encodeStreetCell,
  NEXT_NONE,
  type RoadSegmentRecord,
  SegmentFlag,
  type SegmentSurface,
  SurfaceFlag,
} from "../src/system/street-cells";

// PLAN-J8 J8-RP RP2 — the scene's roads in France from the street cells (src/system/cell-roads.ts): a cell's segments as surface
// segments at their measured width, their markings and pavement from the cell's surfaces, none on a bridge nor in a tunnel.

const seg = (a: [number, number], b: [number, number], extra: Partial<RoadSegmentRecord> = {}): RoadSegmentRecord => ({
  a,
  b,
  width: 9,
  lanes: 2,
  cls: "secondary",
  flags: SegmentFlag.Urban,
  level: 0,
  speed: 14,
  s0: 0,
  roadId: 1,
  ...extra,
});

test("RP2: a cell's roads as surface segments — measured width, the cell's markings and pavement, no bridge, no tunnel", () => {
  const segs = [
    seg([0, 0], [100, 0]),
    seg([100, 0], [200, 0], { flags: SegmentFlag.Urban | SegmentFlag.Bridge }),
    seg([0, 50], [80, 50], { roadId: 2, width: 4, flags: SegmentFlag.OnewayAlong }),
    seg([0, 90], [80, 90], { roadId: 3, flags: SegmentFlag.Tunnel }),
  ];
  const next = segs.map(() => ({ a: NEXT_NONE, b: NEXT_NONE }));
  const surfaces: SegmentSurface[] = [
    { flags: SurfaceFlag.CentreDashed | SurfaceFlag.Kerb, laneLines: 0, pavement: 3, bridge: 0xff },
    { flags: SurfaceFlag.CentreDashed, laneLines: 0, pavement: 0, bridge: 0 },
    { flags: 0, laneLines: 0, pavement: 0, bridge: 0xff },
    { flags: 0, laneLines: 0, pavement: 0, bridge: 0xff },
  ];
  const buf = encodeStreetCell({ z: 15, x: 1, y: 2, generation: 0, originLat: 43, originLon: 6 }, [], segs, [], [], 0, next, [], surfaces);
  const out = cellRoadSurfaces(buf, (e, n) => [e + 1000, n - 500, 0]);
  expect(out.length).toBe(2);
  const [main, lane] = out as [(typeof out)[0], (typeof out)[0]];
  // (the main road: 9 m, its frame moved; its dashed centre and kerb with 3 m pavements — its record widened to 4.5 + 3)
  expect(main.data.slice(0, 4)).toEqual([1000, -500, 1100, -500]);
  expect(main.data[5]).toBe(1);
  expect(main.data[7]).toBe(4.5);
  expect(main.data[4]).toBe(7.5);
  const pk = main.data[6]!;
  expect(pk & 15).toBe(SurfaceFlag.CentreDashed | SurfaceFlag.Kerb);
  expect(pk >> 9).toBe(30);
  // (the one way: its bit, its 4 m)
  expect(lane.data[6]! & 16).toBe(16);
  expect(lane.data[7]).toBe(2);
});

test("RP9 (KSC5): a railway's segment — its tracks as the scene's rails, 4.5 m apart, no marking", () => {
  const segs = [seg([0, 0], [100, 0], { cls: "rail", lanes: 2, width: 7.5, flags: 0 })];
  const buf = encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 0, originLat: 43, originLon: 6 },
    [],
    segs,
    [],
    [],
    0,
    [{ a: NEXT_NONE, b: NEXT_NONE }],
    [],
    [{ flags: 0, laneLines: 0, pavement: 0, bridge: 0xff }],
  );
  const out = cellRoadSurfaces(buf, (e, n) => [e, n, 0]);
  expect(out.length).toBe(2);
  for (const p of out) {
    expect(p.data[5]).toBe(2);
    expect(p.data[4]).toBe(1.5);
  }
  expect(Math.abs(out[0]!.data[1]! - out[1]!.data[1]!)).toBeCloseTo(4.5, 6);
});

test("RP9: the catenary's masts — every 60 m along an electrified railway, beside its outer track, none on a plain one", () => {
  const segs = [
    seg([0, 0], [300, 0], { cls: "rail", lanes: 2, width: 7.5, flags: 0, roadId: 1 }),
    seg([0, 50], [300, 50], { cls: "rail", lanes: 1, width: 3, flags: 0, roadId: 2 }),
  ];
  const buf = encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 0, originLat: 43, originLon: 6 },
    [],
    segs,
    [],
    [],
    0,
    segs.map(() => ({ a: NEXT_NONE, b: NEXT_NONE })),
    [],
    [
      { flags: SurfaceFlag.Electrified, laneLines: 0, pavement: 0, bridge: 0xff },
      { flags: 0, laneLines: 0, pavement: 0, bridge: 0xff },
    ],
  );
  const masts = catenaryMasts(buf, (e, n) => [e, n, 0]);
  expect(masts.length).toBe(5);
  for (const m of masts) {
    expect(Math.abs(m.foot[1])).toBeCloseTo(2.25 + 3.2, 6);
    expect(m.foot[0] % 60).toBeCloseTo(0, 6);
  }
});
